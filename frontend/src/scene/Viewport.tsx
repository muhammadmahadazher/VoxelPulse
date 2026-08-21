import { useMemo, useRef } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, ChromaticAberration } from "@react-three/postprocessing";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { BlendFunction } from "postprocessing";
import { useStore, EMPTY_FRAME } from "../store";
import { vertexShader, fragmentShader, makeColormapUniforms, COLORMAP_INDEX } from "./shaders";
import { BBox3D } from "./BBox3D";
import { GroundRadar } from "./GroundRadar";

const MAX_POINTS = 60000;
const EMPTY_OBJECTS: never[] = [];

export interface ViewportHandle {
  reset: () => void;
  topDown: () => void;
  chase: () => void;
}

/** Live point cloud: reuses one GPU buffer, swaps Float32Array data per frame.
 *  Hosts the raycast-driven inspector and measurement ruler interactions. */
function PointCloud() {
  const geomRef = useRef<THREE.BufferGeometry>(null!);
  const matRef = useRef<THREE.ShaderMaterial>(null!);
  const raycaster = useThree((s) => s.raycaster);
  raycaster.params.Points.threshold = 0.25;

  const buffers = useMemo(
    () => ({
      positions: new Float32Array(MAX_POINTS * 3),
      intensity: new Float32Array(MAX_POINTS),
    }),
    []
  );
  const uniforms = useMemo(() => makeColormapUniforms(), []);

  useFrame(({ clock }) => {
    const f = useStore.getState().lastFrame;
    const mat = matRef.current, geom = geomRef.current;
    if (!f || !mat || !geom) return;
    const n = Math.min(f.n, MAX_POINTS);
    buffers.positions.set(f.positions.subarray(0, n * 3));
    buffers.intensity.set(f.intensity.subarray(0, n));
    geom.setDrawRange(0, n);
    (geom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geom.attributes.intensity as THREE.BufferAttribute).needsUpdate = true;

    const s = useStore.getState();
    mat.uniforms.pointSize.value = s.pointSize;
    mat.uniforms.colormapMode.value = COLORMAP_INDEX[s.colormap] ?? 0;
    mat.uniforms.intensityMin.value = s.intensityMin;
    mat.uniforms.uTime.value = clock.elapsedTime;
    (mat.uniforms.roiMin.value as THREE.Vector3).set(s.roi.xMin, s.roi.yMin, s.roi.zMin);
    (mat.uniforms.roiMax.value as THREE.Vector3).set(s.roi.xMax, s.roi.yMax, s.roi.zMax);
  });

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    const s = useStore.getState();
    if (!s.inspectEnabled || s.rulerActive) return;
    const hit = e.intersections[0];
    if (!hit || hit.index === undefined) return;
    const f = s.lastFrame ?? EMPTY_FRAME;
    const i = hit.index;
    if (i >= f.n) return;
    const x = f.positions[i * 3], y = f.positions[i * 3 + 1], z = f.positions[i * 3 + 2];
    s.setInspect({
      x, y, z,
      range: Math.hypot(x, y),
      intensity: f.intensity[i],
    });
  };

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    const s = useStore.getState();
    if (!s.rulerActive) return;
    const hit = e.intersections[0];
    if (!hit || hit.index === undefined) return;
    s.addRulerPoint([hit.point.x, hit.point.y, hit.point.z]);
  };

  return (
    <points frustumCulled={false} onPointerMove={handlePointerMove} onClick={handleClick}>
      <bufferGeometry ref={geomRef}>
        <bufferAttribute attach="attributes-position" args={[buffers.positions, 3]} usage={THREE.DynamicDrawUsage} />
        <bufferAttribute attach="attributes-intensity" args={[buffers.intensity, 1]} usage={THREE.DynamicDrawUsage} />
      </bufferGeometry>
      <shaderMaterial
        ref={matRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

/** Ruler visualization: glowing line between measured points + meter labels. */
function Ruler() {
  const pts = useStore((s) => s.rulerPoints);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(
      [0, 0, 0, 1, 0, 0], 3));
    g.setIndex([0, 1]);
    return g;
  }, []);
  if (pts.length < 2) return null;
  const [a, b] = pts;
  const p = geo.attributes.position as THREE.BufferAttribute;
  p.setXYZ(0, a[0], a[2], a[1]);
  p.setXYZ(1, b[0], b[2], b[1]);
  p.needsUpdate = true;
  const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  return (
    <group>
      <lineSegments geometry={geo}>
        <lineBasicMaterial color="#FFD166" blending={THREE.AdditiveBlending} depthWrite={false} />
      </lineSegments>
      {[a, b].map((p, i) => (
        <mesh key={i} position={[p[0], p[2], p[1]]}>
          <sphereGeometry args={[0.18, 12, 12]} />
          <meshBasicMaterial color="#FFD166" />
        </mesh>
      ))}
      <Html center position={[(a[0] + b[0]) / 2, (a[2] + b[2]) / 2 + 1, (a[1] + b[1]) / 2]} zIndexRange={[10, 0]}>
        <div className="mono rounded px-2 py-0.5 text-xs font-bold text-[#FFD166]"
          style={{ background: "rgba(9,10,15,0.85)", border: "1px solid #FFD16666" }}>
          Δ {d.toFixed(2)} m
        </div>
      </Html>
    </group>
  );
}

function PostFx() {
  const enabled = useStore((s) => s.showPostFx);
  const caOffset = useMemo(() => new THREE.Vector2(0.0006, 0.0006), []);
  if (!enabled) return null;
  return (
    <EffectComposer>
      <Bloom intensity={0.55} luminanceThreshold={0.55} luminanceSmoothing={0.25} mipmapBlur />
      <ChromaticAberration offset={caOffset} radialModulation={false} modulationOffset={0} blendFunction={BlendFunction.NORMAL} />
      <Vignette eskil={false} offset={0.22} darkness={0.72} />
    </EffectComposer>
  );
}

function SceneContents() {
  const showBoxes = useStore((s) => s.showBoxes);
  const objects = useStore((s) => s.lastFrame?.objects ?? EMPTY_OBJECTS);
  return (
    <>
      <PointCloud />
      <GroundRadar />
      <Ruler />
      {showBoxes && objects.slice(0, 24).map((o) => <BBox3D key={o.id} obj={o} />)}
      <PostFx />
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2.05} dampingFactor={0.08} />
    </>
  );
}

export function Viewport({ handleRef }: { handleRef: React.MutableRefObject<ViewportHandle | null> }) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  const setView = (mode: "orbit" | "top" | "chase") => {
    const controls = controlsRef.current;
    if (!controls) return;
    const cam = controls.object;
    if (mode === "orbit") { cam.position.set(30, 24, 30); controls.target.set(20, 0, 0); }
    if (mode === "top") { cam.position.set(25, 90, 0.01); controls.target.set(25, 0, 0); }
    if (mode === "chase") { cam.position.set(-6, 4, 0); controls.target.set(25, 0, 0); }
    controls.update();
  };

  if (handleRef) {
    handleRef.current = {
      reset: () => setView("orbit"),
      topDown: () => setView("top"),
      chase: () => setView("chase"),
    };
  }

  return (
    <Canvas
      camera={{ position: [30, 24, 30], fov: 55, near: 0.1, far: 500 }}
      gl={{ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true }}
      onCreated={({ gl }) => gl.setClearColor("#090a0f")}
    >
      <fog attach="fog" args={["#090a0f", 60, 180]} />
      <ambientLight intensity={0.4} />
      <SceneContents />
      <ControlsBinder controlsRef={controlsRef} />
    </Canvas>
  );
}

/** Bridges drei's default controls into a typed ref for view presets. */
function ControlsBinder({ controlsRef }: { controlsRef: React.MutableRefObject<OrbitControlsImpl | null> }) {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  controlsRef.current = controls;
  return null;
}
