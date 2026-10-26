/** COPC metadata parsing (§10, §13–14, §143–146). Pure functions over byte
 *  ranges — no fetch, no worker. All u64 file offsets arrive as BigInt and
 *  are validated within Number.MAX_SAFE_INTEGER before byte-range use
 *  (§143–145). Layouts cross-checked against the COPC 1.0 spec (copc.io)
 *  and copc.js 0.0.9 (see ADR-0008). */
import { VpDataError } from "../../errors";
import type { Bounds3D } from "../../bounds";
import { createLogger } from "../../logging";

const log = createLogger("copc");

/** u64 → number with explicit safety validation (§143–145). */
export function u64asNumber(dv: DataView, offset: number, what: string): number {
  const v = dv.getBigUint64(offset, true);
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new VpDataError("invalid-data", `${what} exceeds the safe integer range for streaming.`, {
      detail: `u64 ${v} > 2^53`, context: { field: what },
    });
  }
  return Number(v);
}

export interface CopcInfo {
  centerX: number;
  centerY: number;
  centerZ: number;
  /** Root node halfsize (unscaled units — usually metres). */
  halfsize: number;
  /** Point spacing at root level; halved per level down. */
  spacing: number;
  rootHierOffset: number;
  rootHierSize: number;
  gpstimeMin: number;
  gpstimeMax: number;
}

export const COPC_INFO_LENGTH = 160;

export function parseCopcInfo(data: ArrayBuffer): CopcInfo {
  if (data.byteLength !== COPC_INFO_LENGTH) {
    throw new VpDataError("invalid-data", "Invalid COPC info VLR length.", {
      detail: `expected ${COPC_INFO_LENGTH}, got ${data.byteLength}`,
    });
  }
  const dv = new DataView(data);
  return {
    centerX: dv.getFloat64(0, true),
    centerY: dv.getFloat64(8, true),
    centerZ: dv.getFloat64(16, true),
    halfsize: dv.getFloat64(24, true),
    spacing: dv.getFloat64(32, true),
    rootHierOffset: u64asNumber(dv, 40, "root hierarchy offset"),
    rootHierSize: u64asNumber(dv, 48, "root hierarchy size"),
    gpstimeMin: dv.getFloat64(56, true),
    gpstimeMax: dv.getFloat64(64, true),
  };
}

/* --------------------------------------------------------------- hierarchy */

export interface VoxelKey {
  level: number;
  x: number;
  y: number;
  z: number;
}

export const keyToString = (k: VoxelKey): string => `${k.level}-${k.x}-${k.y}-${k.z}`;

export type NodeState =
  | "unloaded" | "queued" | "fetching" | "decoding" | "ready" | "evicted" | "failed";

/** A hierarchy entry (§10–12). pointCount −1 means the entry points at
 *  another hierarchy PAGE, not point data. */
export interface HierarchyEntry {
  key: VoxelKey;
  /** Absolute file offset (point data when pointCount ≥ 0, child page when −1). */
  offset: number;
  byteSize: number;
  pointCount: number;
}

export interface HierarchyPage {
  nodes: HierarchyEntry[];          // point-bearing entries
  childPages: { key: VoxelKey; offset: number; byteSize: number }[];
}

export const HIERARCHY_ENTRY_LENGTH = 32;

/** Parse one hierarchy page (§14, §100). Validates entry structure against
 *  absurd values; page size must be a multiple of 32. */
export function parseHierarchyPage(data: ArrayBuffer): HierarchyPage {
  if (data.byteLength === 0 || data.byteLength % HIERARCHY_ENTRY_LENGTH !== 0) {
    throw new VpDataError("invalid-data", "Invalid COPC hierarchy page length.", {
      detail: `${data.byteLength} bytes, must be a multiple of ${HIERARCHY_ENTRY_LENGTH}`,
    });
  }
  const dv = new DataView(data);
  const nodes: HierarchyEntry[] = [];
  const childPages: HierarchyPage["childPages"] = [];
  const count = Math.floor(data.byteLength / HIERARCHY_ENTRY_LENGTH);
  if (count > 100_000) {
    throw new VpDataError("invalid-data", "Hierarchy page is unreasonably large.", {
      detail: `${count} entries`,
    });
  }
  for (let i = 0; i < count; i++) {
    const o = i * HIERARCHY_ENTRY_LENGTH;
    const key: VoxelKey = {
      level: dv.getInt32(o, true),
      x: dv.getInt32(o + 4, true),
      y: dv.getInt32(o + 8, true),
      z: dv.getInt32(o + 12, true),
    };
    const offset = u64asNumber(dv, o + 16, "hierarchy entry offset");
    const byteSize = dv.getInt32(o + 24, true);
    const pointCount = dv.getInt32(o + 28, true);
    if (key.level < 0) continue; // invalid key — skip defensively (§100)
    if (pointCount < -1) {
      throw new VpDataError("invalid-data", "Invalid hierarchy point count.", {
        detail: `${pointCount} at ${keyToString(key)}`,
      });
    }
    if (pointCount === -1) {
      if (offset <= 0 || byteSize <= 0) {
        throw new VpDataError("invalid-data", "Hierarchy child-page entry has invalid range.", {
          detail: `${keyToString(key)} offset=${offset} size=${byteSize}`,
        });
      }
      childPages.push({ key, offset, byteSize });
    } else if (pointCount > 0) {
      if (offset <= 0 || byteSize <= 0) {
        throw new VpDataError("invalid-data", "Hierarchy node entry has invalid range.", {
          detail: `${keyToString(key)} offset=${offset} size=${byteSize}`,
        });
      }
      nodes.push({ key, offset, byteSize, pointCount });
    }
    // pointCount === 0 → no data, no page: nothing to record
  }
  return { nodes, childPages };
}

/* --------------------------------------------------------- header + VLRs */

export interface CopcHeaderInfo {
  headerLength: number;
  pointDataOffset: number;   // u64 field, validated (§144)
  pointFormat: number;       // 6–8 for COPC (compression bit masked)
  pointRecordLength: number;
  pointCount: number;        // u64 @247, validated
  vlrCount: number;
  evlrOffset: number;
  evlrCount: number;
}

export interface CopcVlr {
  userId: string;
  recordId: number;
  dataOffset: number; // absolute file offset of VLR data
  dataLength: number;
}

const VLR_HEADER_LENGTH = 54;

/** Walk VLRs (and EVLRs when present) with bounds discipline (§98, §146). */
export function walkCopcVlrs(buf: ArrayBuffer, header: CopcHeaderInfo): CopcVlr[] {
  const vlrs: CopcVlr[] = [];
  const dv = new DataView(buf);
  let off = header.headerLength;
  for (let i = 0; i < header.vlrCount; i++) {
    if (off + VLR_HEADER_LENGTH > buf.byteLength) break;
    const dataLength = dv.getUint16(off + 20, true); // record length @20 (spec)'
    const userId = new TextDecoder().decode(new Uint8Array(buf, off + 2, 16)).replace(/\0[\s\S]*$/, "").trim();
    const recordId = dv.getUint16(off + 18, true);
    vlrs.push({ userId, recordId, dataOffset: off + VLR_HEADER_LENGTH, dataLength });
    off += VLR_HEADER_LENGTH + dataLength;
  }
  // EVLRs live beyond the point data; only walk when the window we were
  // given covers them (callers pass the file tail for that).
  if (header.evlrOffset > 0 && header.evlrCount > 0 && header.evlrOffset < buf.byteLength) {
    let eoff = header.evlrOffset;
    for (let i = 0; i < header.evlrCount; i++) {
      if (eoff + VLR_HEADER_LENGTH + 8 > buf.byteLength) break;
      const dataLength = u64asNumber(dv, eoff + 52, "EVLR length"); // EVLR: u64 @52 (after 54-byte header + description)'
      if (dataLength > buf.byteLength) break;
      const userId = new TextDecoder().decode(new Uint8Array(buf, eoff + 2, 16)).replace(/\0[\s\S]*$/, "").trim();
      const recordId = dv.getUint16(eoff + 18, true);
      vlrs.push({ userId, recordId, dataOffset: eoff + VLR_HEADER_LENGTH + 8, dataLength });
      eoff += VLR_HEADER_LENGTH + 8 + dataLength;
    }
  }
  return vlrs;
}

export function findVlr(vlrs: CopcVlr[], userId: string, recordId: number): CopcVlr | undefined {
  return vlrs.find((v) => v.userId === userId && v.recordId === recordId);
}

/** Parse the fixed header fields we need (§13). Only the 375-byte header. */
export function parseCopcHeader(buf: ArrayBuffer): CopcHeaderInfo {
  if (buf.byteLength < 375) {
    throw new VpDataError("invalid-data", "Not a valid COPC: header too short.", {
      detail: `${buf.byteLength} < 375`,
    });
  }
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== "LASF") {
    throw new VpDataError("invalid-data", "Not a valid COPC: missing LASF signature.");
  }
  const headerLength = dv.getUint16(94, true);
  const pointDataOffset = u64asNumber(dv, 96, "point data offset");
  const rawFormat = dv.getUint8(104);
  const pointFormat = rawFormat & 0x3f; // mask compression bits (LAZ 1.4: 0x80; legacy 0x40)
  const pointRecordLength = dv.getUint16(105, true);
  const pointCount = u64asNumber(dv, 247, "point count");
  const numVlrs = dv.getUint32(100, true); // num VLRs u32 at offset 100
  const evlrOffset = u64asNumber(dv, 235, "EVLR offset");
  const numEvlrs = dv.getUint32(371, true);
  return {
    headerLength,
    pointDataOffset,
    pointFormat,
    pointRecordLength,
    pointCount,
    vlrCount: numVlrs,
    evlrOffset,
    evlrCount: numEvlrs,
  };
}

/** Bounds of the root cube from the info VLR (dataset bounds, unscaled). */
export function rootBounds(info: CopcInfo): Bounds3D {
  return {
    min: [info.centerX - info.halfsize, info.centerY - info.halfsize, info.centerZ - info.halfsize],
    max: [info.centerX + info.halfsize, info.centerY + info.halfsize, info.centerZ + info.halfsize],
  };
}

/** Quick structural validation from the first bytes (§98): LASF + "copc"
 *  userId of the first VLR + point format 6–8. */
export function looksLikeCopc(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 400) return false;
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== "LASF") return false;
  const fmt = dv.getUint8(104) & 0x3f;
  if (fmt < 6 || fmt > 8) return false;
  // First VLR begins at 375; its userId starts at +2 (offset 377).
  const userId = String.fromCharCode(dv.getUint8(377), dv.getUint8(378), dv.getUint8(379), dv.getUint8(380));
  return userId === "copc";
}

export function logMeta(info: CopcInfo): void {
  log.debug(`COPC center=(${info.centerX.toFixed(2)}, ${info.centerY.toFixed(2)}, ${info.centerZ.toFixed(2)}) spacing=${info.spacing}`);
}
