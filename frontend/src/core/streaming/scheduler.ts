/** LOD scheduler (§16–28): camera-driven octree traversal producing the
 *  rendered node set + prioritized node requests. Pure logic — no THREE, no
 *  React, no fetch — so it is unit-testable (§55–57: renderer integration is
 *  engine-owned elsewhere).
 *
 *  Refinement metric (§17): a node refines when its POINT SPACING, projected
 *  to screen space, would exceed ~1 px at the node's distance — the standard
 *  screen-space-error rule, not fixed distance thresholds.
 *
 *  Replacement (§19): a parent stays rendered until the children covering it
 *  are ready — no holes.
 */
import { keyId, levelSpacing, boundsCenter, type PointCloudNode, type VoxelKey } from "./node";
import type { Bounds3D } from "../data/bounds";

export interface CameraState {
  /** Camera position in WORLD space. */
  position: [number, number, number];
  fovYRadians: number;
  aspect: number;
  viewportHeight: number;
}

export type RequestPriority = "critical" | "interactive" | "normal" | "background";

export interface NodeRequest {
  key: VoxelKey;
  priority: RequestPriority;
  /** Projected error in px — larger = more urgent (§27). */
  ssePx: number;
  distance: number;
}

export interface SchedulerOptions {
  /** Refine when projected spacing exceeds this many px (default 1.5). */
  sseThresholdPx?: number;
  /** Max octree depth to traverse. */
  maxDepth?: number;
  /** Point budget: max rendered points (§21). */
  pointBudget: number;
}

export interface SchedulerResult {
  /** Node keys that should be rendered NOW (ready nodes only). */
  render: string[];
  /** Nodes needing data fetch + prepare, prioritized. */
  requests: NodeRequest[];
  /** Nodes whose hierarchy pages must load before their children are known. */
  pageRequests: VoxelKey[];
  renderedPoints: number;
}

interface FrustumPlanes {
  // each plane: [a, b, c, d] with ax+by+cz+d >= 0 inside
  planes: number[][]; // 6 planes
}

/** Extract the 6 frustum planes from a column-major view-projection matrix
 *  (Gribb–Hartmann). Matrix layout: m[col*4 + row]. */
export function frustumPlanes(m: number[]): FrustumPlanes {
  const row = (i: number) => [m[i], m[4 + i], m[8 + i], m[12 + i]];
  const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
  const mk = (a: number[], s: number) => {
    const len = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / len * s, a[1] / len * s, a[2] / len * s, a[3] / len * s];
  };
  return {
    planes: [
      mk([r3[0] + r0[0], r3[1] + r0[1], r3[2] + r0[2], r3[3] + r0[3]], 1),   // left
      mk([r3[0] - r0[0], r3[1] - r0[1], r3[2] - r0[2], r3[3] - r0[3]], 1),   // right
      mk([r3[0] + r1[0], r3[1] + r1[1], r3[2] + r1[2], r3[3] + r1[3]], 1),   // bottom
      mk([r3[0] - r1[0], r3[1] - r1[1], r3[2] - r1[2], r3[3] - r1[3]], 1),   // top
      mk([r3[0] + r2[0], r3[1] + r2[1], r3[2] + r2[2], r3[3] + r2[3]], 1),   // near
      mk([r3[0] - r2[0], r3[1] - r2[1], r3[2] - r2[2], r3[3] - r2[3]], 1),   // far
    ],
  };
}

/** Sphere-vs-frustum test (coarse node culling, §20). */
export function sphereInFrustum(planes: FrustumPlanes, center: [number, number, number], radius: number): boolean {
  for (const p of planes.planes) {
    if (p[0] * center[0] + p[1] * center[1] + p[2] * center[2] + p[3] < -radius) return false;
  }
  return true;
}

/** Projected screen-space size (px) of a spacing at a world distance. */
export function spacingToPixels(spacing: number, distance: number, cam: CameraState): number {
  const d = Math.max(distance, 1e-6);
  const pxPerWorld = cam.viewportHeight / (2 * Math.tan(cam.fovYRadians / 2));
  return (spacing / d) * pxPerWorld;
}

interface TraversalNode {
  key: VoxelKey;
  bounds: Bounds3D;
  pointCount: number;
  state: "unloaded" | "queued" | "fetching" | "decoding" | "ready" | "evicted" | "failed";
  children: TraversalNode[];
}

/** The scheduler operates on a snapshot view of the runtime's node tree. */
export interface SchedulerInput {
  root: TraversalNode;
  camera: CameraState;
  viewProjMatrix: number[];
  /** Root spacing (world units) from the COPC info VLR. */
  rootSpacing: number;
  options: SchedulerOptions;
}

export function schedule(input: SchedulerInput): SchedulerResult {
  const opts = { sseThresholdPx: 1.5, maxDepth: 8, ...input.options };
  const planes = frustumPlanes(input.viewProjMatrix);
  const cam = input.camera;
  const render: string[] = [];
  const requests: NodeRequest[] = [];
  const pageRequests: VoxelKey[] = [];
  let renderedPoints = 0;
  let budget = opts.pointBudget;

  /** Returns true when the node is "covered" by ready descendants (so the
   *  parent itself need not render). */
  const visit = (node: TraversalNode): { covered: boolean; points: number } => {
    const center = boundsCenter(node.bounds);
    const size = Math.max(
      node.bounds.max[0] - node.bounds.min[0],
      node.bounds.max[1] - node.bounds.min[1],
      node.bounds.max[2] - node.bounds.min[2],
    );
    // true bounding-sphere radius: half the space diagonal (a cube's half-
    // extent underestimates and wrongly culls nodes crossing near planes)
    const radius = Math.hypot(
      node.bounds.max[0] - node.bounds.min[0],
      node.bounds.max[1] - node.bounds.min[1],
      node.bounds.max[2] - node.bounds.min[2],
    ) / 2;
    const dx = center[0] - cam.position[0];
    const dy = center[1] - cam.position[1];
    const dz = center[2] - cam.position[2];
    const distance = Math.hypot(dx, dy, dz);

    // §20: frustum cull before any consideration
    if (distance > radius && !sphereInFrustum(planes, center, radius)) {
      return { covered: true, points: 0 }; // invisible — treated as covered
    }

    const spacing = levelSpacing(input.rootSpacing, node.key.level);
    const ssePx = spacingToPixels(spacing, distance, cam);
    const wantsRefine =
      node.children.length > 0 &&
      node.key.level < opts.maxDepth &&
      ssePx > opts.sseThresholdPx &&
      budget > 0;

    if (wantsRefine) {
      // Visit children best-first by projected error (§27).
      const visited: { child: TraversalNode; res: { covered: boolean; points: number } }[] = [];
      let childPoints = 0;
      let allCovered = true;
      const sorted = [...node.children].sort((a, b) => {
        const ca = boundsCenter(a.bounds), cb = boundsCenter(b.bounds);
        const da = Math.hypot(ca[0] - cam.position[0], ca[1] - cam.position[1], ca[2] - cam.position[2]);
        const db = Math.hypot(cb[0] - cam.position[0], cb[1] - cam.position[1], cb[2] - cam.position[2]);
        return da - db;
      });
      for (const child of sorted) {
        const res = visit(child);
        visited.push({ child, res });
        childPoints += res.points;
        if (!res.covered) allCovered = false;
      }
      if (childPoints > 0) {
        return { covered: allCovered, points: childPoints };
      }
      // children produced nothing (budget exhausted / none ready) → fall
      // through to rendering THIS node (replacement, §19).
    }

    // Render this node when it has data.
    if (node.pointCount > 0 && node.state === "ready") {
      if (budget >= node.pointCount) {
        budget -= node.pointCount;
        renderedPoints += node.pointCount;
        render.push(keyId(node.key));
        // §14: a rendered leaf whose subtree is not yet discovered must keep
        // asking for its hierarchy page — refinement happens after.
        if (node.children.length === 0 && node.key.level < opts.maxDepth) {
          pageRequests.push(node.key);
        }
        return { covered: false, points: node.pointCount };
      }
      // budget exhausted — §132: stability over density; stop refining here.
      return { covered: true, points: 0 };
    }

    // Node would refine but has no data yet → request it (§26–28).
    if (node.pointCount > 0 && node.state !== "ready") {
      const priority: RequestPriority =
        ssePx > opts.sseThresholdPx * 4 ? "critical"
        : distance < size * 6 ? "interactive"
        : "normal";
      requests.push({ key: node.key, priority, ssePx, distance });
      return { covered: false, points: 0 }; // not covered — hole until ready
    }

    // Leaf without data / hierarchy page missing → request the page (§14).
    if (node.children.length === 0 && node.key.level < opts.maxDepth) {
      pageRequests.push(node.key);
    }
    return { covered: false, points: 0 };
  };

  visit(input.root);
  // prioritize: critical → interactive → normal; larger SSE first (§27)
  const rank: Record<RequestPriority, number> = { critical: 0, interactive: 1, normal: 2, background: 3 };
  requests.sort((a, b) => rank[a.priority] - rank[b.priority] || b.ssePx - a.ssePx);
  return { render, requests, pageRequests, renderedPoints };
}

/** Convert a runtime node map into the traversal snapshot. */
export function toTraversal(
  key: VoxelKey,
  resolve: (key: VoxelKey) => (Omit<PointCloudNode, "id" | "childKeys"> & { childKeys: VoxelKey[] }) | undefined,
  depth = 0,
  maxDepth = 8,
): TraversalNode | null {
  const n = resolve(key);
  if (!n) return null;
  const children: TraversalNode[] = [];
  if (depth < maxDepth) {
    for (const ck of n.childKeys) {
      const c = toTraversal(ck, resolve, depth + 1, maxDepth);
      if (c) children.push(c);
    }
  }
  return {
    key: n.key,
    bounds: n.bounds,
    pointCount: n.pointCount,
    state: n.state,
    children,
  };
}
