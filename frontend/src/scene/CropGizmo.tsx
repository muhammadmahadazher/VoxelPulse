import { useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { useStore, type RoiBounds } from "../store";

type HandleId = "xMin" | "xMax" | "yMin" | "yMax" | "zMin" | "zMax";

const HANDLE_INFO: Record<HandleId, { axis: "x" | "y" | "z"; sign: 1 | -1 }> = {
  xMin: { axis: "x", sign: -1 }, xMax: { axis: "x", sign: 1 },
  yMin: { axis: "y", sign: -1 }, yMax: { axis: "y", sign: 1 },
  zMin: { axis: "z", sign: -1 }, zMax: { axis: "z", sign: 1 },
};

function Handle({ id, position }: { id: HandleId; position: [number, number, number] }) {
  const dragging = useRef(false);
  const setRoi = useStore((s) => s.setRoi);
  const roi = useStore((s) => s.roi);
  const info = HANDLE_INFO[id];

  const applyDrag = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging.current) return;
    e.stopPropagation();
    const world: Record<"x" | "y" | "z", number> = { x: e.point.x, y: e.point.z, z: e.point.y };
    const v = world[info.axis];
    const patch: Partial<RoiBounds> = {};
    if (id === "xMin") patch.xMin = Math.min(v, roi.xMax - 2);
    if (id === "xMax") patch.xMax = Math.max(v, roi.xMin + 2);
    if (id === "yMin") patch.yMin = Math.min(v, roi.yMax - 2);
    if (id === "yMax") patch.yMax = Math.max(v, roi.yMin + 2);
    if (id === "zMin") patch.zMin = Math.min(v, roi.zMax - 1);
    if (id === "zMax") patch.zMax = Math.max(v, roi.zMin + 1);
    setRoi(patch);
  };

  return (
    <mesh
      position={position}
      onPointerDown={(e) => {
        e.stopPropagation();
        dragging.current = true;
        (e.target as unknown as Element).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={applyDrag}
      onPointerUp={(e) => {
        dragging.current = false;
        (e.target as unknown as Element).releasePointerCapture?.(e.pointerId);
      }}
    >
      <sphereGeometry args={[0.9, 14, 14]} />
      <meshBasicMaterial color="#F59E0B" transparent opacity={0.9} depthTest={false} />
    </mesh>
  );
}

/** Interactive 6-handle ROI crop box. Handles drag along their world axis;
 *  the point shader discards everything outside the bounds in real time. */
export function CropGizmo() {
  const active = useStore((s) => s.showCropGizmo);
  const roi = useStore((s) => s.roi);
  const boxRef = useRef<THREE.LineSegments>(null!);

  const geo = useMemo(() => {
    const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    return g;
  }, []);

  useFrame(() => {
    if (!boxRef.current) return;
    const sx = roi.xMax - roi.xMin, sy = roi.yMax - roi.yMin, sz = roi.zMax - roi.zMin;
    boxRef.current.scale.set(Math.max(sx, 0.1), Math.max(sz, 0.1), Math.max(sy, 0.1));
    boxRef.current.position.set(
      (roi.xMin + roi.xMax) / 2, (roi.zMin + roi.zMax) / 2, (roi.yMin + roi.yMax) / 2);
  });

  if (!active) return null;
  const cx = (roi.xMin + roi.xMax) / 2, cy = (roi.yMin + roi.yMax) / 2, cz = (roi.zMin + roi.zMax) / 2;
  return (
    <group>
      <lineSegments ref={boxRef} geometry={geo}>
        <lineBasicMaterial color="#F59E0B" transparent opacity={0.8} depthTest={false} />
      </lineSegments>
      <Handle id="xMin" position={[roi.xMin, cz, cy]} />
      <Handle id="xMax" position={[roi.xMax, cz, cy]} />
      <Handle id="yMin" position={[cx, cz, roi.yMin]} />
      <Handle id="yMax" position={[cx, cz, roi.yMax]} />
      <Handle id="zMin" position={[cx, roi.zMin, cy]} />
      <Handle id="zMax" position={[cx, roi.zMax, cy]} />
    </group>
  );
}
