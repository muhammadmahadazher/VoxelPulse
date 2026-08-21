import { useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import * as THREE from "three";
import { useStore } from "../store";
import { vertexShader, fragmentShader, makeColormapUniforms } from "./shaders";
import { BBox3D } from "./BBox3D";

const MAX_POINTS = 60000;

const EMPTY_OBJECTS: never[] = [];

/** Live point cloud: reuses one GPU buffer, swaps Float32Array data per frame. */
function PointCloud({ controlsRef }: { controlsRef: React.RefObject<any> }) {
  const store = useStore();
  const geomRef = useRef<THREE.BufferGeometry>(null!);
  const matRef = useRef<THREE.ShaderMaterial>(null!);

  const buffers = useMemo(() => {
    const positions = new Float32Array(MAX_POINTS * 3);
    const intensity = new Float32Array(MAX_POINTS);
    return { positions, intensity };
  }, []);

  useFrame(() => {
    const f = useStore.getState().lastFrame;
    const mat = matRef.current, geom = geomRef.current;
    if (!f || !mat || !geom) return;
    const n = Math.min(f.n, MAX_POINTS);
    buffers.positions.set(f.positions.subarray(0, n * 3));
    buffers.intensity.set(f.intensity.subarray(0, n));
    geom.setDrawRange(0, n);
    (geom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geom.attributes.intensity as THREE.BufferAttribute).needsUpdate = true;

    // sync uniforms from UI store (cheap; avoids re-rendering the material)
    mat.uniforms.pointSize.value = useStore.getState().pointSize;
    mat.uniforms.colormapMode.value = { turbo: 0, viridis: 1, cyber: 2 }[useStore.getState().colormap];
    mat.uniforms.intensityMin.value = useStore.getState().intensityMin;
  });

  const uniforms = useMemo(() => makeColormapUniforms(), []);

  return (
    <points frustumCulled={false}>
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

function Ground() {
  const show = useStore((s) => s.showGround);
  if (!show) return null;
  return (
    <Grid
      args={[160, 160]} cellSize={4} cellThickness={0.5} sectionSize={20}
      sectionThickness={1} cellColor="#123" sectionColor="#0ef"
      fadeDistance={120} fadeStrength={2.5} infiniteGrid position={[0, -0.05, 0]}
    />
  );
}

function CameraRig({ controlsRef }: { controlsRef: React.RefObject<any> }) {
  const { camera } = useThree();
  useFrame(() => {});
  // Keyboard view presets are handled in App.tsx via imperative camera moves.
  return null;
}

export interface ViewportHandle {
  reset: () => void;
  topDown: () => void;
  chase: () => void;
}

export function Viewport({ handleRef }: { handleRef: React.MutableRefObject<ViewportHandle | null> }) {
  const controlsRef = useRef<any>(null);
  const showBoxes = useStore((s) => s.showBoxes);
  const objects = useStore((s) => s.lastFrame?.objects ?? EMPTY_OBJECTS);

  if (handleRef) {
    handleRef.current = {
      reset: () => setView(controlsRef.current, "orbit"),
      topDown: () => setView(controlsRef.current, "top"),
      chase: () => setView(controlsRef.current, "chase"),
    };
  }

  return (
    <Canvas
      camera={{ position: [30, 24, 30], fov: 55, near: 0.1, far: 500 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => { gl.setClearColor("#0a0b10"); }}
    >
      <fog attach="fog" args={["#0a0b10", 60, 160]} />
      <ambientLight intensity={0.4} />
      <PointCloud controlsRef={controlsRef} />
      <Ground />
      <CameraRig controlsRef={controlsRef} />
      {showBoxes && objects.slice(0, 24).map((o) => <BBox3D key={o.id} obj={o} />)}
      <OrbitControls ref={controlsRef} maxPolarAngle={Math.PI / 2.05} dampingFactor={0.08} />
    </Canvas>
  );
}

function setView(controls: any, mode: "orbit" | "top" | "chase") {
  if (!controls) return;
  const cam = controls.object;
  if (mode === "orbit") { cam.position.set(30, 24, 30); controls.target.set(20, 0, 0); }
  if (mode === "top") { cam.position.set(25, 90, 0.01); controls.target.set(25, 0, 0); }
  if (mode === "chase") { cam.position.set(-6, 4, 0); controls.target.set(25, 0, 0); }
  controls.update();
}
