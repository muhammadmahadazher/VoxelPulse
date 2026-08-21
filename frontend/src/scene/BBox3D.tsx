import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import type { SensorObject } from "../store";
import { OBJECT_VELOCITIES } from "../store";

const LABEL_COLORS: Record<string, string> = {
  car: "#00F5FF", truck: "#A78BFA", cyclist: "#FFB000", pedestrian: "#39FF6A",
  agv: "#00F5FF", forklift: "#FFB000", drone: "#FF5CF4",
};

/** Corner-bracket segments (3 short lines per corner, like FSD visualization). */
function bracketGeometry(dx: number, dy: number, dz: number): THREE.BufferGeometry {
  const L = 0.28; // bracket arm length in world units
  const sx = Math.max(0.12, Math.min(dx / 2, L));
  const sy = Math.max(0.12, Math.min(dy / 2, L));
  const sz = Math.max(0.12, Math.min(dz / 2, L));
  const pts: number[] = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) {
    // local corner in box space: x->x, z(height)->y, y->z (three.js Y-up)
    const corner = new THREE.Vector3(a * dx / 2, c * dz / 2, b * dy / 2);
    const dirX = new THREE.Vector3(-a * sx, 0, 0);
    const dirY = new THREE.Vector3(0, -c * sz, 0);
    const dirZ = new THREE.Vector3(0, 0, -b * sy);
    for (const d of [dirX, dirY, dirZ]) {
      pts.push(corner.x, corner.y, corner.z, corner.x + d.x, corner.y + d.y, corner.z + d.z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

export function BBox3D({ obj }: { obj: SensorObject }) {
  const [x, y, z, dx, dy, dz, yaw] = obj.box;
  const color = LABEL_COLORS[obj.label] ?? "#00F5FF";
  const groupRef = useRef<THREE.Group>(null!);
  const matRef = useRef<THREE.LineBasicMaterial>(null!);
  const reticleRef = useRef<THREE.Mesh>(null!);
  const velRef = useRef<THREE.LineSegments>(null!);

  const brackets = useMemo(() => bracketGeometry(dx, dy, dz), [dx, dy, dz]);
  const outline = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(dx, dz, dy)), [dx, dy, dz]);

  const velLine = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(
      [0, 0, 0, 1, 0, 0], 3));
    g.setIndex([0, 1]);
    return g;
  }, []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (matRef.current) matRef.current.opacity = 0.55 + 0.3 * Math.sin(t * 4 + obj.id);
    if (reticleRef.current) {
      const s = 1 + 0.12 * Math.sin(t * 4 + obj.id);
      reticleRef.current.scale.set(s, s, s);
    }
    const v = OBJECT_VELOCITIES[obj.id];
    if (v && velRef.current) {
      const speed = Math.hypot(v[0], v[1]);
      const scale = Math.min(speed * 0.35, 4.0);
      velRef.current.scale.x = Math.max(0.001, scale);
      velRef.current.visible = speed > 0.4;
    }
  });

  // distance from ego sensor (origin) to box center
  const dist = Math.hypot(x, y).toFixed(1);

  return (
    <group position={[x, z, y]}>
      <group rotation={[0, -yaw, 0]}>
        <lineSegments geometry={brackets}>
          <lineBasicMaterial ref={matRef} color={color} transparent opacity={0.9}
            depthWrite={false} blending={THREE.AdditiveBlending} />
        </lineSegments>
        <lineSegments geometry={outline}>
          <lineBasicMaterial color={color} transparent opacity={0.18} depthWrite={false} />
        </lineSegments>
      </group>
      {/* pulsating target reticle */}
      <mesh ref={reticleRef} position={[0, dz / 2 + 0.35, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.34, 0.42, 24]} />
        <meshBasicMaterial color={color} transparent opacity={0.8} side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* 3D velocity vector */}
      <lineSegments ref={velRef} geometry={velLine} rotation={[0, -Math.atan2(OBJECT_VELOCITIES[obj.id]?.[1] ?? 0, OBJECT_VELOCITIES[obj.id]?.[0] ?? 1), 0]}
        position={[0, dz / 2, 0]}>
        <lineBasicMaterial color={color} transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false} />
      </lineSegments>
      <Html center distanceFactor={55} position={[0, dz / 2 + 0.9, 0]} zIndexRange={[10, 0]}>
        <div className="mono select-none whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold"
          style={{ color, background: "rgba(9,10,15,0.82)", border: `1px solid ${color}66`,
                   boxShadow: `0 0 10px ${color}44` }}>
          {obj.label.toUpperCase()} · {dist}m · {(obj.conf * 100).toFixed(0)}%
        </div>
      </Html>
    </group>
  );
}
