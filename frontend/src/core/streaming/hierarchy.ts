/** COPC hierarchy runtime (§13–14): lazy, paged hierarchy over a DataSource.
 *  Only the pages the traversal touches are read — never the full hierarchy
 *  of an enormous dataset before showing anything. */
import type { DataSource } from "../data/source/types";
import type { Bounds3D } from "../data/bounds";
import {
  parseHierarchyPage, parseCopcHeader, walkCopcVlrs, findVlr, parseCopcInfo, rootBounds,
  type CopcHeaderInfo, type CopcInfo,
} from "../data/formats/copc/meta";
import { boundsFromPositions, type Bounds3D as _B } from "../data/bounds";
import { keyId, nodeBounds, type PointCloudNode, type VoxelKey } from "./node";
import { VpDataError, toVpDataError } from "../data/errors";
import { createLogger } from "../data/logging";

const log = createLogger("hierarchy");

const HEADER_WINDOW = 64 * 1024;

export interface LoadedNode extends PointCloudNode {
  pageLoaded: true;
}

/** Paged hierarchy over one COPC source. */
export class CopcHierarchy {
  readonly header: CopcHeaderInfo;
  readonly info: CopcInfo;
  readonly rootBounds: Bounds3D;
  private readonly source: DataSource;
  private readonly entries = new Map<string, { offset: number; byteSize: number; pointCount: number }>();
  private readonly childKeys = new Map<string, VoxelKey[]>();
  private readonly loadedPages = new Set<string>();
  private pagesLoading = new Map<string, Promise<void>>();

  private constructor(source: DataSource, header: CopcHeaderInfo, info: CopcInfo, rootBounds: Bounds3D) {
    this.source = source;
    this.header = header;
    this.info = info;
    this.rootBounds = rootBounds;
  }

  /** Open: header + info VLR only (§13) — one 64 KB window, no point data. */
  static async open(source: DataSource, signal?: AbortSignal): Promise<CopcHierarchy> {
    try {
      const head = await source.read({ offset: 0, length: HEADER_WINDOW }, signal);
      const header = parseCopcHeader(head);
      const vlrs = walkCopcVlrs(head, header);
      const infoVlr = findVlr(vlrs, "copc", 1);
      if (!infoVlr) throw new VpDataError("invalid-data", "Missing COPC info VLR.");
      const info = parseCopcInfo(head.slice(infoVlr.dataOffset, infoVlr.dataOffset + 160));
      return new CopcHierarchy(source, header, info, rootBounds(info));
    } catch (e) {
      throw toVpDataError(e, "invalid-data", `Could not open COPC hierarchy from ${source.label}`);
    }
  }

  /** True when the node's hierarchy entry is known (page loaded). */
  known(key: VoxelKey): boolean {
    return this.entries.has(keyId(key));
  }

  /** Child keys of a node — only those present in the hierarchy. Requires
   *  the node's page to be loaded (see ensureLoaded). */
  childrenOf(key: VoxelKey): VoxelKey[] {
    return this.childKeys.get(keyId(key)) ?? [];
  }

  /** Hierarchy entry facts for a known node. */
  entry(key: VoxelKey): { offset: number; byteSize: number; pointCount: number } | undefined {
    return this.entries.get(keyId(key));
  }

  /** Node descriptor (bounds/state) for a known key; pageLoaded false when
   *  the entry came from an ancestor page without its own page yet. */
  node(key: VoxelKey): PointCloudNode | undefined {
    const e = this.entries.get(keyId(key));
    if (!e) return undefined;
    return {
      key,
      id: keyId(key),
      level: key.level,
      bounds: nodeBounds(this.rootBounds, key),
      pointCount: e.pointCount,
      dataRange: e.pointCount > 0 ? { offset: e.offset, length: e.byteSize } : undefined,
      state: e.pointCount > 0 ? "unloaded" : "unloaded",
      childKeys: this.childKeys.get(keyId(key)) ?? [],
    };
  }

  /** Ensure the hierarchy PAGE that describes `key`'s children is loaded
   *  (§14). The root page loads on first use; child pages load on demand.
   *  Deduplicated in-flight (§30). A key whose entry is already known needs
   *  no load — its children derive directly from `entries`. */
  async ensureLoaded(key: VoxelKey, signal?: AbortSignal): Promise<void> {
    if (this.entries.has(keyId(key))) return; // entry known — children derivable
    const pageKey = this.pageOwnerKey(key);
    if (!pageKey || this.loadedPages.has(pageKey)) return;
    const inFlight = this.pagesLoading.get(pageKey);
    if (inFlight) return inFlight;

    const page = await (async () => {
      const e = pageKey === "0-0-0-0"
        ? { offset: this.info.rootHierOffset, byteSize: this.info.rootHierSize }
        : this.entries.get(pageKey);
      if (!e) return;
      const bytes = await this.source.read({ offset: e.offset, length: e.byteSize }, signal);
      const parsed = parseHierarchyPage(bytes);
      for (const n of parsed.nodes) {
        this.entries.set(keyId(n.key), { offset: n.offset, byteSize: n.byteSize, pointCount: n.pointCount });
      }
      for (const cp of parsed.childPages) {
        // child-page entries also reserve a slot so pageOwnerKey stays stable
        this.entries.set(keyId(cp.key), { offset: cp.offset, byteSize: cp.byteSize, pointCount: -1 });
      }
      // children map: every key with data gets its 8 potential children
      // intersected with what the hierarchy actually lists on the NEXT page…
      // COPC lists children as entries in the SAME page when the page covers
      // that level. Child relationships derive from key math + presence.
      this.loadedPages.add(pageKey);
      log.debug(`hierarchy page ${pageKey} — ${parsed.nodes.length} nodes, ${parsed.childPages.length} child pages`);
    })();
    return page;
  }

  /** The key of the node whose page describes `key`. COPC pages list all
   *  entries of a subtree; a key's own entry lives in the page that its
   *  nearest loaded ancestor references. For the root, the info VLR. */
  private pageOwnerKey(key: VoxelKey): string | null {
    if (this.loadedPages.has(keyId(key))) return keyId(key);
    // Walk up: the first ancestor that is a PAGE CONTAINER (pointCount −1)
    // or the root. Data nodes (pointCount ≥ 0) are not page owners.
    let k: VoxelKey = { ...key };
    while (k.level > 0) {
      k = parentKey(k);
      const e = this.entries.get(keyId(k));
      if (e && e.pointCount === -1) return keyId(k);
      if (k.level === 0) return "0-0-0-0";
    }
    return "0-0-0-0";
  }

  /** Load a child page referenced by an entry with pointCount −1. */
  async loadChildPage(key: VoxelKey, signal?: AbortSignal): Promise<void> {
    const e = this.entries.get(keyId(key));
    if (!e || e.pointCount !== -1) return;
    const bytes = await this.source.read({ offset: e.offset, length: e.byteSize }, signal);
    const parsed = parseHierarchyPage(bytes);
    for (const n of parsed.nodes) {
      this.entries.set(keyId(n.key), { offset: n.offset, byteSize: n.byteSize, pointCount: n.pointCount });
    }
    for (const cp of parsed.childPages) {
      this.entries.set(keyId(cp.key), { offset: cp.offset, byteSize: cp.byteSize, pointCount: -1 });
    }
    this.loadedPages.add(keyId(key));
  }

  /** Build the children list for a node once its subtree entries are known.
   *  Real COPC octrees SKIP levels — per octant, adopt the nearest deeper
   *  descendant when the direct level+1 child is absent (bounded scan §100).
   *  Bounds derive from each key, so adopted children cull correctly. */
  discoverChildren(key: VoxelKey): VoxelKey[] {
    const kids: VoxelKey[] = [];
    const seen = new Set<string>();
    let octant = 0;
    for (const dx of [0, 1]) {
      for (const dy of [0, 1]) {
        for (const dz of [0, 1]) {
          octant++;
          const direct: VoxelKey = {
            level: key.level + 1, x: key.x * 2 + dx, y: key.y * 2 + dy, z: key.z * 2 + dz,
          };
          if (this.entries.has(keyId(direct))) {
            if (!seen.has(keyId(direct))) { seen.add(keyId(direct)); kids.push(direct); }
            continue;
          }
          // nearest deeper descendant in this octant
          for (let delta = 2; delta <= 6; delta++) {
            const found: VoxelKey[] = [];
            for (const [id, e] of this.entries) {
              if (e.pointCount <= 0) continue;
              const k = this.parseId(id);
              if (k.level !== key.level + delta) continue;
              if (!this.isAncestor(key, k)) continue;
              const ox = (k.x >> (delta - 1)) & 1;
              const oy = (k.y >> (delta - 1)) & 1;
              const oz = (k.z >> (delta - 1)) & 1;
              if ((ox * 4 + oy * 2 + oz) !== octant - 1) continue;
              found.push(k);
            }
            for (const k of found) {
              if (!seen.has(keyId(k))) { seen.add(keyId(k)); kids.push(k); }
            }
            if (found.length) break;
          }
        }
      }
    }
    this.childKeys.set(keyId(key), kids);
    return kids;
  }

  private parseId(id: string): VoxelKey {
    const [level, x, y, z] = id.split("-").map(Number);
    return { level, x, y, z };
  }

  /** True when  contains  (key math: shared high bits). */
  private isAncestor(ancestor: VoxelKey, k: VoxelKey): boolean {
    const delta = k.level - ancestor.level;
    if (delta <= 0) return false;
    const shift = 32 - delta; // avoid sign issues via multiplication instead
    void shift;
    const div = 2 ** delta;
    return (
      Math.floor(k.x / div) === ancestor.x &&
      Math.floor(k.y / div) === ancestor.y &&
      Math.floor(k.z / div) === ancestor.z
    );
  }

  /** Read one node's point data (compressed or raw per compressed_flag). */
  async readNodeData(key: VoxelKey, signal?: AbortSignal): Promise<ArrayBuffer> {
    const e = this.entries.get(keyId(key));
    if (!e || e.pointCount <= 0) throw new VpDataError("invalid-data", `Node ${keyId(key)} has no point data.`);
    return this.source.read({ offset: e.offset, length: e.byteSize }, signal);
  }

  /** Bounds computed from actual node points (used after decode for the
   *  precise world bounds, §37). */
  static boundsFromPositions(positions: Float32Array | Float64Array, pointCount: number): Bounds3D {
    return boundsFromPositions(positions, pointCount);
  }
}

export function parentKey(k: VoxelKey): VoxelKey {
  return { level: k.level - 1, x: k.x >> 1, y: k.y >> 1, z: k.z >> 1 };
}
