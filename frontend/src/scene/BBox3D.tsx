import { useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import type { SensorObject } from "../store";
import { OBJECT_VELOCITIES, useStore } from "../store";

const LABEL_COLORS: Record<string, string> = {
  car: "#38BDF8", truck: "#A78BFA", cyclist: "#F59E0B", pedestrian: "#34D399",
  agv: "#38BDF8", forklift: "#F59E0B", drone: "#F472B6",
};

/** Corner-bracket segments (3 short lines per corner, FSD-style). */
function bracketGeometry(dx: number, dy: number, dz: number): THREE.BufferGeometry {
  const L = 0.28;
  const sx = Math.max(0.12, Math.min(dx / 2, L));
  const sy = Math.max(0.12, Math.min(dy / 2, L));
  const sz = Math.max(0.12, Math.min(dz / 2, L));
  const pts: number[] = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) {
    const corner = new THREE.Vector3(a * dx / 2, c * dz / 2, b * dy / 2);
    const arms = [
      new THREE.Vector3(-a * sx, 0, 0),
      new THREE.Vector3(0, -c * sz, 0),
      new THREE.Vector3(0, 0, -b * sy),
    ];
    for (const d of arms) {
      pts.push(corner.x, corner.y, corner.z, corner.x + d.x, corner.y + d.y, corner.z + d.z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

export function BBox3D({ obj }: { obj: SensorObject }) {
  const [x, y, z, dx, dy, dz, yaw] = obj.box;
  const color = LABEL_COLORS[obj.label] ?? "#38BDF8";
  const selected = useStore((s) => s.selectedTrack === obj.id);
  const matRef = useRef<THREE.LineBasicMaterial>(null!);
  const reticleRef = useRef<THREE.Mesh>(null!);
  const velGroup = useRef<THREE.Group>(null!);
  const velGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3));
    g.setIndex([0, 1]);
    return g;
  }, []);

  const brackets = useMemo(() => bracketGeometry(dx, dy, dz), [dx, dy, dz]);
  const outline = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(dx, dz, dy)), [dx, dy, dz]);
  const colorTint = useMemo(() => new THREE.Color(color), [color]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (matRef.current)
      matRef.current.opacity = (selected ? 0.95 : 0.6) + 0.25 * Math.sin(t * 4 + obj.id);
    if (reticleRef.current) {
      const s = (selected ? 1.25 : 1) + 0.12 * Math.sin(t * 4 + obj.id);
      reticleRef.current.scale.set(s, s, s);
    }
    const v = OBJECT_VELOCITIES[obj.id];
    if (v && velGroup.current) {
      const speed = Math.hypot(v[0], v[1]);
      velGroup.current.visible = speed > 0.4;
      velGroup.current.scale.x = Math.max(0.001, Math.min(speed * 0.4, 5.0));
      velGroup.current.rotation.y = -Math.atan2(v[1], v[0]);
    }
  });

  const onSelect = (e: ThreeEvent<MouseEvent>) => {
    if (useStore.getState().rulerActive) return;
    e.stopPropagation();
    useStore.getState().selectTrack(selected ? null : obj.id);
    import("../stores/projectStore").then((m) =>
      m.useProjectStore.getState().select(selected ? { kind: "none" } : { kind: "track", id: obj.id }));
  };

  const dist = Math.hypot(x, y).toFixed(1);

  return (
    <group position={[x, z, y]} onClick={onSelect}>
      <group rotation={[0, -yaw, 0]}>
        <lineSegments geometry={brackets}>
          <lineBasicMaterial ref={matRef} color={color} transparent opacity={0.9}
            depthWrite={false} blending={THREE.AdditiveBlending} />
        </lineSegments>
        <lineSegments geometry={outline}>
          <lineBasicMaterial color={color} transparent opacity={selected ? 0.55 : 0.18} depthWrite={false} />
        </lineSegments>
        {/* translucent tinted faces */}
        <mesh>
          <boxGeometry args={[dx, dz, dy]} />
          <meshBasicMaterial color={colorTint} transparent opacity={selected ? 0.14 : 0.05}
            depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        {/* ground footprint shadow */}
        <mesh position={[0, -dz / 2 - 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[dx, dy]} />
          <meshBasicMaterial color="#000000" transparent opacity={0.4} depthWrite={false} />
        </mesh>
      </group>
      {/* pulsating target reticle */}
      <mesh ref={reticleRef} position={[0, dz / 2 + 0.35, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.34, 0.42, 24]} />
        <meshBasicMaterial color={color} transparent opacity={0.8} side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* 3D velocity heading vector: line + arrowhead cone */}
      <group ref={velGroup} position={[0, dz / 2, 0]}>
        <lineSegments geometry={velGeo}>
          <lineBasicMaterial color={color} transparent opacity={0.9}
            blending={THREE.AdditiveBlending} depthWrite={false} />
        </lineSegments>
        <mesh position={[1, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <coneGeometry args={[0.14, 0.5, 10]} />
          <meshBasicMaterial color={color} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>
      <Html center distanceFactor={55} position={[0, dz / 2 + 0.9, 0]} zIndexRange={[10, 0]}>
        <div className="mono select-none whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold"
          style={{
            color, background: "rgba(12, 15, 22, 0.82)",
            border: `1px solid ${selected ? color : color + "40"}`,
          }}>
          {obj.label.toUpperCase()} · {dist}m · {(obj.conf * 100).toFixed(0)}%
        </div>
      </Html>
    </group>
  );
}
