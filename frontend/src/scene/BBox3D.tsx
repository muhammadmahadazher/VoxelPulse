import { useMemo } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import type { SensorObject } from "../store";

const LABEL_COLORS: Record<string, string> = {
  car: "#00F5FF",
  truck: "#7000FF",
  cyclist: "#FFB000",
  pedestrian: "#39FF6A",
};

/** Oriented wireframe box with glowing corner brackets + billboard label. */
export function BBox3D({ obj }: { obj: SensorObject }) {
  const [x, y, z, dx, dy, dz, yaw] = obj.box;
  const color = LABEL_COLORS[obj.label] ?? "#00F5FF";

  const { edges, brackets } = useMemo(() => {
    const geo = new THREE.BoxGeometry(dx, dz, dy);
    const eg = new THREE.EdgesGeometry(geo);
    geo.dispose();
    // 8 corner positions for glowing corner brackets
    const pts: THREE.Vector3[] = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1])
      pts.push(new THREE.Vector3(sx * dx / 2, sz * dz / 2, sy * dy / 2));
    const bg = new THREE.BufferGeometry().setFromPoints(pts);
    return { edges: eg, brackets: bg };
  }, [dx, dy, dz]);

  return (
    <group position={[x, z, y]} rotation={[0, -yaw, 0]}>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={color} transparent opacity={0.85} />
      </lineSegments>
      <points geometry={brackets}>
        <pointsMaterial color={color} size={0.35} sizeAttenuation />
      </points>
      <Html center distanceFactor={40} position={[0, dz / 2 + 0.6, 0]} zIndexRange={[10, 0]}>
        <div
          className="mono select-none whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold"
          style={{ color, background: "rgba(10,11,16,0.8)", border: `1px solid ${color}55` }}
        >
          {obj.label} {(obj.conf * 100).toFixed(0)}%
        </div>
      </Html>
    </group>
  );
}
