import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { useStore } from "../store";

const RING_RADII = [10, 25, 50, 100];

function ringGeometry(radius: number, segments = 128): THREE.BufferGeometry {
  const pts: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

function axisLine(from: THREE.Vector3, to: THREE.Vector3): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(
    [from.x, from.y, from.z, to.x, to.y, to.z], 3));
  g.setIndex([0, 1]);
  return g;
}

/** Labeled reference axis with arrowhead cone. */
function Axis({ dir, color, label, length = 14 }: {
  dir: [number, number, number]; color: string; label: string; length?: number;
}) {
  const geo = useMemo(() => {
    const d = new THREE.Vector3(...dir).normalize().multiplyScalar(length);
    return axisLine(new THREE.Vector3(), d);
  }, [dir, length]);
  const tip: [number, number, number] = [
    dir[0] * length, dir[1] * length, dir[2] * length,
  ];
  const quat = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir).normalize()),
    [dir]
  );
  return (
    <group>
      <lineSegments geometry={geo}>
        <lineBasicMaterial color={color} transparent opacity={0.9} depthWrite={false} />
      </lineSegments>
      <mesh position={tip} quaternion={quat} renderOrder={2}>
        <coneGeometry args={[0.22, 0.7, 10]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <Html center position={[tip[0] * 1.12, tip[1] * 1.12 + 0.4, tip[2] * 1.12]} zIndexRange={[9, 0]}>
        <span className="mono select-none text-[11px] font-black" style={{ color }}>
          {label}
        </span>
      </Html>
    </group>
  );
}

/** Aerospace-grade ego sensor frame: XYZ triad (X red, Y green, Z blue),
 *  dynamic range rings (10/25/50/100 m) and an animated 360° radar sweep. */
export function EgoFrame() {
  const showGround = useStore((s) => s.showGround);
  const showRadar = useStore((s) => s.showRadar);
  const sweepRef = useRef<THREE.Group>(null!);
  const sweepGeo = useMemo(() => {
    const shape = new THREE.BufferGeometry();
    shape.setAttribute("position", new THREE.Float32BufferAttribute(
      [0, 0.01, 0, 0, 0.01, -100, 0.5, 0.01, -100], 3));
    shape.setIndex([0, 1, 2]);
    shape.computeVertexNormals();
    return shape;
  }, []);
  const lineGeo = useMemo(() => ringGeometry(100, 2), []);
  const rings = useMemo(() => RING_RADII.map((r) => ringGeometry(r)), []);

  useFrame((_, dt) => {
    if (sweepRef.current) sweepRef.current.rotation.y -= dt * Math.PI; // 0.5 Hz spin
  });

  if (!showGround && !showRadar) return null;
  return (
    <group>
      {showGround && (
        <gridHelper args={[200, 50, "#2a3348", "#1a2130"]} position={[0, -0.06, 0]} />
      )}
      {showRadar && (
        <group>
          {rings.map((geo, i) => (
            <lineSegments key={RING_RADII[i]} geometry={geo}>
              <lineBasicMaterial color="#4d8fe8" transparent opacity={RING_RADII[i] >= 50 ? 0.1 : 0.22}
                blending={THREE.AdditiveBlending} depthWrite={false} />
            </lineSegments>
          ))}
          {([0, 1] as const).map((axis) => (
            <lineSegments key={axis} geometry={lineGeo}
              rotation={axis === 1 ? [0, Math.PI / 2, 0] : [0, 0, 0]}>
              <lineBasicMaterial color="#F59E0B" transparent opacity={0.22}
                blending={THREE.AdditiveBlending} depthWrite={false} />
            </lineSegments>
          ))}
          <group ref={sweepRef}>
            <mesh geometry={sweepGeo}>
              <meshBasicMaterial color="#38BDF8" transparent opacity={0.10} side={THREE.DoubleSide}
                blending={THREE.AdditiveBlending} depthWrite={false} />
            </mesh>
            <lineSegments geometry={lineGeo}>
              <lineBasicMaterial color="#7DD3FC" transparent opacity={0.85}
                blending={THREE.AdditiveBlending} depthWrite={false} />
            </lineSegments>
          </group>
          {/* ego sensor body */}
          <mesh position={[0, 0.35, 0]}>
            <cylinderGeometry args={[0.32, 0.42, 0.5, 20]} />
            <meshBasicMaterial color="#1e293b" />
          </mesh>
          <mesh position={[0, 0.68, 0]}>
            <sphereGeometry args={[0.16, 14, 14]} />
            <meshBasicMaterial color="#38BDF8" />
          </mesh>
        </group>
      )}
      {/* labeled world axes: X red (east), Y green (north), Z blue (up) */}
      <Axis dir={[1, 0, 0]} color="#EF4444" label="X" />
      <Axis dir={[0, 0, 1]} color="#22C55E" label="Y" />
      <Axis dir={[0, 1, 0]} color="#3B82F6" label="Z" length={10} />
    </group>
  );
}
