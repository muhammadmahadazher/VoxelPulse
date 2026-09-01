import { useEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import type { SensorObject } from "../store";
import { OBJECT_VELOCITIES, useStore } from "../store";
import { labelDeclutterer } from "./labelManager";
import { useUiStore } from "../stores/uiStore";

const LABEL_COLORS: Record<string, string> = {
  car: "#5aa7e8", truck: "#9d8bef", cyclist: "#d99a3d", pedestrian: "#4bc493",
  agv: "#5aa7e8", forklift: "#d99a3d", drone: "#d877c9",
};
/** Short class abbreviations for the distant LOD. */
const CLASS_ABBR: Record<string, string> = {
  car: "CAR", truck: "TRK", cyclist: "CYC", pedestrian: "PED",
  agv: "AGV", forklift: "FLT", drone: "DRN",
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
  const color = LABEL_COLORS[obj.label] ?? "#5aa7e8";
  const selected = useStore((s) => s.selectedTrack === obj.id);
  const presentation = useUiStore((s) => s.theme === "presentation");
  const matRef = useRef<THREE.LineBasicMaterial>(null!);
  const fillRef = useRef<THREE.MeshBasicMaterial>(null!);
  const reticleRef = useRef<THREE.Mesh>(null!);
  const velGroup = useRef<THREE.Group>(null!);
  // label LOD DOM nodes, toggled imperatively — zero React re-renders per frame
  const nearRef = useRef<HTMLDivElement>(null);
  const midRef = useRef<HTMLDivElement>(null);
  const farRef = useRef<HTMLDivElement>(null);

  const velGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3));
    g.setIndex([0, 1]);
    return g;
  }, []);
  const brackets = useMemo(() => bracketGeometry(dx, dy, dz), [dx, dy, dz]);
  const outline = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(dx, dz, dy)), [dx, dy, dz]);
  const colorTint = useMemo(() => new THREE.Color(color), [color]);
  const center = useMemo(() => new THREE.Vector3(x, z, y), [x, y, z]);

  // register with the throttled declutter pass; unregister on unmount
  useEffect(() => {
    labelDeclutterer.register(obj.id, obj, center);
    return () => labelDeclutterer.unregister(obj.id);
  }, [obj, center]);

  useFrame(({ clock, camera }) => {
    const t = clock.elapsedTime;
    // analytical mode: steady precise edges; presentation/selected may pulse
    if (matRef.current) {
      matRef.current.opacity = selected
        ? 0.9 + 0.1 * Math.sin(t * 4)
        : presentation ? 0.62 + 0.2 * Math.sin(t * 4 + obj.id) : 0.72;
    }
    if (fillRef.current)
      fillRef.current.opacity = selected ? 0.1 : presentation ? 0.07 : 0.035;
    if (reticleRef.current) {
      const s = (selected ? 1.18 : 1) + (presentation || selected ? 0.1 * Math.sin(t * 4 + obj.id) : 0);
      reticleRef.current.scale.set(s, s, s);
    }
    const vel = OBJECT_VELOCITIES[obj.id];
    if (vel && velGroup.current) {
      const speed = Math.hypot(vel[0], vel[1]);
      velGroup.current.visible = speed > 0.4;
      velGroup.current.scale.x = Math.max(0.001, Math.min(speed * 0.4, 5.0));
      velGroup.current.rotation.y = -Math.atan2(vel[1], vel[0]);
    }

    // ---- label LOD (imperative; declutter results refresh at ~5 Hz) ----
    const st = labelDeclutterer.state(obj.id);
    const dist = center.distanceTo(camera.position);
    const showNear = selected || (st.detailed && dist < 45);
    const showMid = !showNear && st.detailed;
    const showFar = st.visible && !st.detailed;
    if (nearRef.current) nearRef.current.style.display = showNear ? "block" : "none";
    if (midRef.current) midRef.current.style.display = showMid ? "block" : "none";
    if (farRef.current) farRef.current.style.display = showFar ? "block" : "none";
    if (midRef.current) midRef.current.style.opacity = "0.85";
    if (farRef.current) farRef.current.style.opacity = "0.55";
  });

  const onSelect = (e: ThreeEvent<MouseEvent>) => {
    if (useStore.getState().rulerActive) return;
    e.stopPropagation();
    useStore.getState().selectTrack(selected ? null : obj.id);
    import("../stores/projectStore").then((m) =>
      m.useProjectStore.getState().select(selected ? { kind: "none" } : { kind: "track", id: obj.id }));
  };

  const dist = Math.hypot(x, y).toFixed(1);
  const labelBase: React.CSSProperties = {
    color, background: "rgba(12, 15, 22, 0.78)",
    border: `1px solid ${selected ? color : color + "38"}`,
    fontFamily: "var(--vp-font-mono)",
  };
  const className = obj.label[0].toUpperCase() + obj.label.slice(1);

  return (
    <group position={[x, z, y]} onClick={onSelect}>
      <group rotation={[0, -yaw, 0]}>
        <lineSegments geometry={brackets}>
          <lineBasicMaterial ref={matRef} color={color} transparent opacity={0.72} depthWrite={false} />
        </lineSegments>
        <lineSegments geometry={outline}>
          <lineBasicMaterial color={color} transparent opacity={selected ? 0.4 : 0.14} depthWrite={false} />
        </lineSegments>
        {/* translucent fill — near-invisible in analytical mode */}
        <mesh>
          <boxGeometry args={[dx, dz, dy]} />
          <meshBasicMaterial ref={fillRef} color={colorTint} transparent
            depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
      {/* target reticle — selected/presentation only */}
      {(selected || presentation) && (
        <mesh ref={reticleRef} position={[0, dz / 2 + 0.35, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.34, 0.42, 24]} />
          <meshBasicMaterial color={color} transparent opacity={0.7} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
      {/* velocity heading vector */}
      <group ref={velGroup} position={[0, dz / 2, 0]}>
        <lineSegments geometry={velGeo}>
          <lineBasicMaterial color={color} transparent opacity={0.75} depthWrite={false} />
        </lineSegments>
        <mesh position={[1, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <coneGeometry args={[0.12, 0.44, 10]} />
          <meshBasicMaterial color={color} transparent opacity={0.75} depthWrite={false} />
        </mesh>
      </group>

      {/* LOD labels — one DOM node per level, toggled imperatively.
          Fixed screen size (no distanceFactor): labels stay compact and
          legible at any range, per the Phase 1.6 label spec. */}
      <Html center position={[0, dz / 2 + 0.55, 0]} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div ref={nearRef} className="select-none whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold leading-tight"
          style={{ ...labelBase, display: selected ? "block" : "none" }}>
          {className} <span style={{ opacity: 0.85 }}>{(obj.conf * 100).toFixed(0)}%</span>
          <span style={{ opacity: 0.85 }}> · {dist} m</span>
        </div>
      </Html>
      <Html center position={[0, dz / 2 + 0.55, 0]} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div ref={midRef} className="select-none whitespace-nowrap rounded px-1 py-[1px] text-[9.5px] font-medium leading-tight"
          style={{ ...labelBase, display: "none" }}>
          {className} {(obj.conf * 100).toFixed(0)}%
        </div>
      </Html>
      <Html center position={[0, dz / 2 + 0.55, 0]} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div ref={farRef} className="select-none whitespace-nowrap text-[9px] font-semibold tracking-wide"
          style={{ ...labelBase, display: "none", padding: "0 4px" }}>
          {CLASS_ABBR[obj.label] ?? obj.label.toUpperCase()}
        </div>
      </Html>
    </group>
  );
}
