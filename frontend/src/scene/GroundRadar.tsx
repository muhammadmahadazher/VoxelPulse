import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
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

/** Glowing radar ground: concentric range rings, cross axes and a continuous
 * 360° sweep beam simulating a spinning mechanical LiDAR head. */
export function GroundRadar() {
  const showGround = useStore((s) => s.showGround);
  const showRadar = useStore((s) => s.showRadar);
  const sweepRef = useRef<THREE.Group>(null!);
  const sweepGeo = useMemo(() => {
    // thin triangle wedge trailing the sweep line
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
        <gridHelper args={[200, 50, "#123046", "#0c1a26"]} position={[0, -0.06, 0]} />
      )}
      {showRadar && (
        <group>
          {rings.map((geo, i) => (
            <lineSegments key={RING_RADII[i]} geometry={geo}>
              <lineBasicMaterial color="#00F5FF" transparent opacity={RING_RADII[i] >= 50 ? 0.14 : 0.3}
                blending={THREE.AdditiveBlending} depthWrite={false} />
            </lineSegments>
          ))}
          {/* cross axis lines */}
          {([0, 1] as const).map((axis) => (
            <lineSegments key={axis} geometry={lineGeo}
              rotation={axis === 1 ? [0, Math.PI / 2, 0] : [0, 0, 0]}>
              <lineBasicMaterial color="#7000FF" transparent opacity={0.25}
                blending={THREE.AdditiveBlending} depthWrite={false} />
            </lineSegments>
          ))}
          {/* sweep beam */}
          <group ref={sweepRef}>
            <mesh geometry={sweepGeo}>
              <meshBasicMaterial color="#00F5FF" transparent opacity={0.10} side={THREE.DoubleSide}
                blending={THREE.AdditiveBlending} depthWrite={false} />
            </mesh>
            <lineSegments geometry={lineGeo}>
              <lineBasicMaterial color="#7FFBFF" transparent opacity={0.85}
                blending={THREE.AdditiveBlending} depthWrite={false} />
            </lineSegments>
          </group>
          {/* ego sensor */}
          <mesh position={[0, 0.02, 0]}>
            <sphereGeometry args={[0.35, 16, 16]} />
            <meshBasicMaterial color="#00F5FF" />
          </mesh>
        </group>
      )}
    </group>
  );
}
