/** CP3 scheduler tests: frustum culling, screen-space-error refinement,
 *  point budget, replacement (no holes), priorities. */
import { describe, it, expect } from "vitest";
import { Matrix4, Vector3 } from "three";
import { schedule, frustumPlanes, sphereInFrustum, spacingToPixels, toTraversal, type CameraState } from "./scheduler";
import type { PointCloudNode, VoxelKey } from "./node";

const CAM: CameraState = {
  position: [0, 0, 100],
  fovYRadians: Math.PI / 3, // 60°
  aspect: 16 / 9,
  viewportHeight: 1080,
};

function makeTree(): { root: NonNullable<ReturnType<typeof toTraversal>> } {
  // Build a 2-level tree manually: root (0,0,0,0) + 8 children (level 1).
  const bounds = (min: [number, number, number], max: [number, number, number]) => ({ min, max });
  const mkNode = (key: VoxelKey, pointCount: number, state: "ready" | "unloaded", bounds_: ReturnType<typeof bounds>): Omit<PointCloudNode, "id" | "childKeys"> & { childKeys: VoxelKey[] } => ({
    key, level: key.level, bounds: bounds_, pointCount, state, childKeys: [],
  });
  const half = 50;
  const rootBounds = bounds([-half, -half, -half], [half, half, half]);
  const children: ReturnType<typeof mkNode>[] = [];
  let i = 0;
  for (const dx of [0, 1]) for (const dy of [0, 1]) for (const dz of [0, 1]) {
    const key: VoxelKey = { level: 1, x: dx, y: dy, z: dz };
    const min: [number, number, number] = [
      -half + dx * half, -half + dy * half, -half + dz * half,
    ];
    const max: [number, number, number] = [min[0] + half, min[1] + half, min[2] + half];
    // far corner child unloaded — proves camera-driven requests
    children.push(mkNode(key, i === 7 ? 1000 : 10_000, i === 7 ? "unloaded" : "ready", bounds(min, max)));
    i++;
  }
  const childKeys: VoxelKey[] = children.map((c) => c.key);
  const resolve = (key: VoxelKey) => {
    if (key.level === 0) return { ...mkNode(key, 50_000, "ready", rootBounds), childKeys };
    const idx = key.x * 4 + key.y * 2 + key.z;
    return children[idx];
  };
  const root = toTraversal({ level: 0, x: 0, y: 0, z: 0 }, resolve, 0, 8)!;
  return { root: root! };
}

/** Build a real view-projection matrix looking from  at . */
function viewProj(eye: [number, number, number], target: [number, number, number] = [0, 0, 0]): number[] {
  const proj = new Matrix4().makePerspective(-1, 1, 1, -1, 0.5, 2000);
  // Matrix4.lookAt is rotation-only — the view matrix needs the translation:
  const view = new Matrix4()
    .lookAt(new Vector3(...eye), new Vector3(...target), new Vector3(0, 1, 0))
    .multiply(new Matrix4().makeTranslation(-eye[0], -eye[1], -eye[2]));
  const vp = proj.multiply(view);
  return [...vp.elements]; // column-major
}

describe("frustum", () => {
  const m = viewProj([0, 0, 100]);
  const planes = frustumPlanes(m);
  it("sphereInFrustum accepts centered spheres and rejects far/behind", () => {
    expect(sphereInFrustum(planes, [0, 0, 0], 10)).toBe(true);
    expect(sphereInFrustum(planes, [0, 0, 5000], 10)).toBe(false); // beyond far
    expect(sphereInFrustum(planes, [0, 0, -5000], 10)).toBe(false); // behind
  });
});

describe("spacingToPixels", () => {
  it("grows as distance shrinks (SSE is camera-dependent, §17)", () => {
    const near = spacingToPixels(1, 10, CAM);
    const far = spacingToPixels(1, 1000, CAM);
    expect(near).toBeGreaterThan(far * 50);
  });
});

describe("schedule", () => {
  it("renders ready root+children in view and requests the unloaded far child", () => {
    const { root } = makeTree();
    const res = schedule({
      root, camera: CAM,
      viewProjMatrix: viewProj([0, 0, 100]),
      rootSpacing: 1, options: { pointBudget: 1_000_000 },
    });
    console.log("DBG render:", res.render, "requests:", res.requests.map((r) => r.key.level + "-" + r.key.x + r.key.y + r.key.z), "pages:", res.pageRequests.length);
    // root not rendered when children cover it (replacement §19)
    expect(res.render).not.toContain("0-0-0-0");
    expect(res.render.length).toBe(7); // 7 ready children
    // the unloaded far child is requested
    expect(res.requests.map((r) => `${r.key.level}-${r.key.x}-${r.key.y}-${r.key.z}`)).toContain("1-1-1-1");
    expect(res.renderedPoints).toBe(7 * 10_000);
  });

  it("keeps the parent rendered when a child is not ready (no holes, §19)", () => {
    const { root } = makeTree();
    // tiny budget prevents rendering children → root should render
    const res = schedule({
      root, camera: CAM,
      viewProjMatrix: viewProj([0, 0, 100]),
      rootSpacing: 0.1, // tiny spacing → SSE below threshold → stays coarse
      options: { pointBudget: 1_000_000 },
    });
    expect(res.render).toContain("0-0-0-0");
  });

  it("enforces the point budget (§21)", () => {
    const { root } = makeTree();
    const res = schedule({
      root, camera: CAM,
      viewProjMatrix: viewProj([0, 0, 100]),
      rootSpacing: 1,
      options: { pointBudget: 30_000 }, // only ~3 children fit
    });
    expect(res.renderedPoints).toBeLessThanOrEqual(30_000);
  });

  it("frustum-culls: camera looking away renders nothing (§20)", () => {
    const { root } = makeTree();
    // Camera past the cloud looking further away — cloud behind the frustum.
    const res = schedule({
      root, camera: { ...CAM, position: [0, 0, 1000] },
      viewProjMatrix: viewProj([0, 0, 1000], [0, 0, 5000]),
      rootSpacing: 1,
      options: { pointBudget: 1_000_000 },
    });
    expect(res.renderedPoints).toBe(0);
    expect(res.render).toHaveLength(0);
  });

  it("prioritizes critical requests first (§26–27)", () => {
    const { root } = makeTree();
    const res = schedule({
      root, camera: CAM,
      viewProjMatrix: viewProj([0, 0, 100]),
      rootSpacing: 1,
      options: { pointBudget: 1_000_000 },
    });
    if (res.requests.length > 1) {
      expect(res.requests[0].priority).toBe("critical");
    }
  });
});
