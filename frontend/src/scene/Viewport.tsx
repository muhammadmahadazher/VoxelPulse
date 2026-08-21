import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, OrthographicCamera, Html } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, ChromaticAberration } from "@react-three/postprocessing";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { BlendFunction } from "postprocessing";
import { useStore, EMPTY_FRAME } from "../store";
import { useUiStore } from "../stores/uiStore";
import { vertexShader, fragmentShader, makeColormapUniforms, COLORMAP_INDEX } from "./shaders";
import { EyeDomeLighting } from "./edl";
import { BBox3D } from "./BBox3D";
import { EgoFrame } from "./EgoFrame";
import { CropGizmo } from "./CropGizmo";

const MAX_POINTS = 60000;
const EMPTY_OBJECTS: never[] = [];

export interface ViewportHandle {
  reset: () => void;
  topDown: () => void;
  chase: () => void;
  frameBounds: (b: [number, number, number, number, number, number]) => void;
  restoreCamera: (cam: { position: [number, number, number]; target: [number, number, number] }) => void;
  camera: () => { position: [number, number, number]; target: [number, number, number] } | null;
}

/** Live point cloud: single reused GPU buffer, zero React re-renders in the
 *  telemetry loop (buffer swaps + uniform updates happen inside useFrame). */
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

  useFrame(() => {
    const st = useStore.getState();
    const mat = matRef.current, geom = geomRef.current;
    if (!st.showPoints) { geom.setDrawRange(0, 0); return; }
    const f = st.displayFrame();
    if (!f || !mat || !geom) return;
    const n = Math.min(f.n, MAX_POINTS);
    if (n > 0) {
      buffers.positions.set(f.positions.subarray(0, n * 3));
      buffers.intensity.set(f.intensity.subarray(0, n));
    }
    geom.setDrawRange(0, n);
    (geom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geom.attributes.intensity as THREE.BufferAttribute).needsUpdate = true;

    const s = useStore.getState();
    mat.uniforms.pointSize.value = s.pointSize;
    mat.uniforms.colormapMode.value = COLORMAP_INDEX[s.colormap] ?? 0;
    mat.uniforms.intensityMin.value = s.intensityMin;
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
    s.setInspect({ x, y, z, range: Math.hypot(x, y), intensity: f.intensity[i] });
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

/** Dual-point laser measure: distance, ΔXYZ and slope angle. */
function Ruler() {
  const pts = useStore((s) => s.rulerPoints);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3));
    g.setIndex([0, 1]);
    return g;
  }, []);
  if (pts.length < 2) return null;
  const [a, b] = pts;
  const p = geo.attributes.position as THREE.BufferAttribute;
  p.setXYZ(0, a[0], a[2], a[1]);
  p.setXYZ(1, b[0], b[2], b[1]);
  p.needsUpdate = true;
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  const d = Math.hypot(dx, dy, dz);
  const horiz = Math.hypot(dx, dy);
  const slope = (Math.atan2(Math.abs(dz), Math.max(horiz, 1e-6)) * 180) / Math.PI;
  return (
    <group>
      <lineSegments geometry={geo}>
        <lineBasicMaterial color="#F59E0B" blending={THREE.AdditiveBlending} depthWrite={false} />
      </lineSegments>
      {[a, b].map((pt, i) => (
        <mesh key={i} position={[pt[0], pt[2], pt[1]]}>
          <sphereGeometry args={[0.18, 12, 12]} />
          <meshBasicMaterial color="#F59E0B" />
        </mesh>
      ))}
      <Html center
        position={[(a[0] + b[0]) / 2, (a[2] + b[2]) / 2 + 1, (a[1] + b[1]) / 2]} zIndexRange={[10, 0]}>
        <div className="mono rounded px-2 py-0.5 text-[10px] font-bold text-amber-400"
          style={{ background: "rgba(7,8,11,0.88)", border: "1px solid #F59E0B66" }}>
          Δ {d.toFixed(2)} m · ΔX {Math.abs(dx).toFixed(1)} ΔY {Math.abs(dy).toFixed(1)} ΔZ {Math.abs(dz).toFixed(1)} · {slope.toFixed(0)}°
        </div>
      </Html>
    </group>
  );
}

function PostFx() {
  const enabled = useStore((s) => s.showPostFx);
  const edl = useStore((s) => s.showEdl);
  const theme = useUiStore((s) => s.theme);
  const caOffset = useMemo(() => new THREE.Vector2(0.0006, 0.0006), []);
  if (!enabled) return null;
  return (
    <EffectComposer>
      {edl ? <EyeDomeLighting strength={1.4} radius={1.6} /> : <></>}
      <Bloom intensity={theme === "presentation" ? 0.9 : 0.35} luminanceThreshold={theme === "presentation" ? 0.5 : 0.62} luminanceSmoothing={0.25} mipmapBlur />
      <ChromaticAberration offset={caOffset} radialModulation={false} modulationOffset={0} blendFunction={BlendFunction.NORMAL} />
      <Vignette eskil={false} offset={0.22} darkness={theme === "presentation" ? 0.75 : 0.55} />
    </EffectComposer>
  );
}

function SceneContents({ perspective = true }: { perspective?: boolean }) {
  const showBoxes = useStore((s) => s.showBoxes);
  const objects = useStore((s) => s.lastFrame?.objects ?? EMPTY_OBJECTS);
  return (
    <>
      <PointCloud />
      <EgoFrame />
      <Ruler />
      <CropGizmo />
      {showBoxes && objects.slice(0, 24).map((o) => <BBox3D key={o.id} obj={o} />)}
      {perspective && <PostFx />}
    </>
  );
}

function ControlsBinder({ controlsRef }: { controlsRef: React.MutableRefObject<OrbitControlsImpl | null> }) {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  controlsRef.current = controls;
  return null;
}

/** Bird's-eye orthographic panel (pan + zoom only). */
function BevPanel() {
  return (
    <Canvas orthographic camera={{ position: [25, 90, 0.01], zoom: 8, near: 0.1, far: 400 }}
      gl={{ antialias: true }} onCreated={({ gl }) => gl.setClearColor("#07080B")}>
      <OrthographicCamera makeDefault position={[25, 90, 0.01]} zoom={8} near={0.1} far={400} />
      <ambientLight intensity={0.5} />
      <SceneContents perspective={false} />
      <OrbitControls makeDefault enableRotate={false} screenSpacePanning
        mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }} />
    </Canvas>
  );
}

/** Camera fusion panel: RGB feed + live projected point cloud overlay. */
function FusionPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const s = useStore.getState();
      const f = s.displayFrame();
      if (f.camW === 0) return;
      if (cv.width !== f.camW) { cv.width = f.camW; cv.height = f.camH; }
      const ctx = cv.getContext("2d")!;
      const img = ctx.createImageData(f.camW, f.camH);
      img.data.set(f.camRGB);
      for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
      ctx.putImageData(img, 0, 0);
      // projected point overlay
      const fx = f.camW * 1.1, cx = f.camW / 2, cy = f.camH / 2;
      ctx.fillStyle = "rgba(56,189,248,0.75)";
      for (let i = 0; i < f.n; i += 4) {
        const x = f.positions[i * 3], y = f.positions[i * 3 + 1], z = f.positions[i * 3 + 2];
        if (x <= 1 || Math.abs(y) > 35) continue;
        const u = fx * (-y / x) + cx;
        const v = fx * ((1.6 - z) / x) + cy;
        if (u < 0 || u >= f.camW || v < 0 || v >= f.camH) continue;
        ctx.fillRect(u, v, 1, 1);
      }
      ctx.strokeStyle = "#F59E0B";
      ctx.lineWidth = 1;
      for (const o of f.objects2d) {
        ctx.strokeRect(o.u * f.camW, o.v * f.camH, o.w * f.camW, o.h * f.camH);
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="relative h-full w-full">
      <canvas ref={canvasRef} className="h-full w-full object-contain" />
      <div className="mono absolute left-2 top-2 rounded bg-black/50 px-1.5 py-0.5 text-[9px] tracking-widest text-amber-400">
        CAM-01 · 2D/3D FUSION
      </div>
    </div>
  );
}

export function Viewport({ handleRef }: { handleRef: React.MutableRefObject<ViewportHandle | null> }) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const viewLayout = useStore((s) => s.viewLayout);

  const setView = (mode: "orbit" | "top" | "chase") => {
    const controls = controlsRef.current;
    if (!controls) return;
    const cam = controls.object;
    if (mode === "orbit") { cam.position.set(30, 24, 30); controls.target.set(20, 0, 0); }
    if (mode === "top") { cam.position.set(25, 90, 0.01); controls.target.set(25, 0, 0); }
    if (mode === "chase") { cam.position.set(-6, 4, 0); controls.target.set(25, 0, 0); }
    controls.update();
  };

  const snapshot = () => {
    const controls = controlsRef.current;
    if (!controls) return null;
    const p = controls.object.position, t = controls.target;
    return {
      position: [p.x, p.y, p.z] as [number, number, number],
      target: [t.x, t.y, t.z] as [number, number, number],
    };
  };

  if (handleRef) {
    handleRef.current = {
      reset: () => setView("orbit"),
      topDown: () => setView("top"),
      chase: () => setView("chase"),
      frameBounds: (b) => {
        const controls = controlsRef.current;
        if (!controls) return;
        const cx = (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2, cz = (b[2] + b[5]) / 2;
        const radius = Math.max(
          Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2, 2);
        controls.target.set(cx, cz, cy);
        controls.object.position.set(cx + radius * 0.9, cz + radius * 0.7, cy + radius * 0.9);
        controls.update();
      },
      restoreCamera: (cam) => {
        const controls = controlsRef.current;
        if (!controls) return;
        controls.object.position.set(...cam.position);
        controls.target.set(...cam.target);
        controls.update();
      },
      camera: snapshot,
    };
  }

  const secondary = viewLayout !== "single";
  return (
    <div className="absolute inset-0 flex">
      <div className="relative h-full" style={{ width: secondary ? "50%" : "100%" }}>
        <Canvas
          camera={{ position: [30, 24, 30], fov: 55, near: 0.1, far: 500 }}
          gl={{ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true }}
          onCreated={({ gl }) => gl.setClearColor("#07080B")}
        >
          <fog attach="fog" args={["#07080B", 60, 180]} />
          <ambientLight intensity={0.4} />
          <SceneContents />
          <OrbitControls makeDefault maxPolarAngle={Math.PI / 2.05} dampingFactor={0.08} />
          <ControlsBinder controlsRef={controlsRef} />
        </Canvas>
        <div className="mono pointer-events-none absolute bottom-2 left-2 rounded bg-black/40 px-1.5 py-0.5 text-[9px] tracking-widest text-sky-400">
          3D ORBIT {viewLayout !== "single" && "· PERSP"}
        </div>
      </div>
      {viewLayout === "split" && (
        <div className="relative h-full w-1/2 border-l border-white/10">
          <BevPanel />
          <div className="mono pointer-events-none absolute bottom-2 left-2 rounded bg-black/40 px-1.5 py-0.5 text-[9px] tracking-widest text-sky-400">
            BEV · ORTHO TOP-DOWN
          </div>
        </div>
      )}
      {viewLayout === "fusion" && (
        <div className="relative h-full w-1/2 border-l border-white/10 bg-black">
          <FusionPanel />
        </div>
      )}
    </div>
  );
}
