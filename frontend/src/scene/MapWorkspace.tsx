/** 2D Map workspace (§23): orthographic north-up raster rendering, engine-
 *  owned and imperative — tile arrival and eviction never touch React state.
 *  §37/§84: render origin derived from the dataset footprints (Phase 3
 *  precision strategy — Float32 mesh vertices hold origin-relative values,
 *  float64 world math stays outside the GPU). §42: tile geometry follows the
 *  full affine (rotated rasters render rotated). §25–28: textures are packed
 *  from raw samples by the bands module (display-only). Pan, wheel zoom,
 *  click probe. */
import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { rasterRegistry } from "../core/raster/registry";
import { useProjectStore } from "../stores/projectStore";
import { worldToPixel, type GeoTransform } from "../core/raster/transform";
import { packTileRgba } from "../core/raster/bands";
import type { RasterStreamRuntime } from "../core/raster/runtime";
import type { Bounds2D } from "../core/raster/tileScheduler";

/** Union footprint of all registered raster runtimes (project coords). */
function unionFootprint(rts: RasterStreamRuntime[]): Bounds2D | null {
  let min: [number, number] | null = null;
  let max: [number, number] | null = null;
  for (const rt of rts) {
    const fp = rt.footprint();
    if (!min) { min = [...fp.min]; max = [...fp.max]; continue; }
    min[0] = Math.min(min[0], fp.min[0]); min[1] = Math.min(min[1], fp.min[1]);
    max![0] = Math.max(max![0], fp.max[0]); max![1] = Math.max(max![1], fp.max[1]);
  }
  return min && max ? { min, max } : null;
}

function tileGeometry(quad: ReadonlyArray<[number, number]>, origin: [number, number]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const verts = new Float32Array(4 * 3);
  for (let i = 0; i < 4; i++) {
    verts[i * 3] = quad[i][0] - origin[0];
    verts[i * 3 + 1] = quad[i][1] - origin[1];
    verts[i * 3 + 2] = 0;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  // quad order [(c0,r0),(c1,r0),(c1,r1),(c0,r1)] = image TL,TR,BR,BL;
  // DataTexture row 0 = image top = v 0
  geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  return geo;
}

interface MeshRecord {
  mesh: THREE.Mesh;
  datasetId: string;
  styleEpoch: number;
}

function MapContents({ onProbe }: { onProbe: (text: string) => void }) {
  const groupRef = useRef<THREE.Group>(null!);
  const meshesRef = useRef<Map<string, MeshRecord>>(new Map());
  const originRef = useRef<[number, number]>([0, 0]);
  const framedRef = useRef<number>(-1);
  const frameTick = useRef(0);
  const { camera, size, gl } = useThree();
  const layers = useProjectStore((s) => s.layers);

  // §23 map navigation: left-drag pan + wheel zoom anchored at the cursor.
  useEffect(() => {
    const el = gl.domElement;
    const cam = () => camera as THREE.OrthographicCamera;
    const dragging = { active: false, moved: false };

    const toWorld = (clientX: number, clientY: number): [number, number] => {
      const rect = el.getBoundingClientRect();
      const z = cam().zoom;
      const wx = cam().position.x + (clientX - rect.left - rect.width / 2) / z;
      const wy = cam().position.y - (clientY - rect.top - rect.height / 2) / z;
      return [wx, wy];
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragging.active = true;
      dragging.moved = false;
      el.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging.active) return;
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 0) dragging.moved = true;
      const z = cam().zoom;
      // screen px → world: +x right, +y down on screen = −y in world
      cam().position.x -= e.movementX / z;
      cam().position.y += e.movementY / z;
    };
    const onPointerUp = (e: PointerEvent) => {
      dragging.active = false;
      try { el.releasePointerCapture(e.pointerId); } catch { /* released */ }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const before = toWorld(e.clientX, e.clientY);
      const factor = Math.exp(-e.deltaY * 0.0012);
      const c = cam();
      c.zoom = Math.min(1e5, Math.max(1e-5, c.zoom * factor));
      c.updateProjectionMatrix();
      // keep the world point under the cursor stationary
      const after = toWorld(e.clientX, e.clientY);
      c.position.x += before[0] - after[0];
      c.position.y += before[1] - after[1];
    };
    const isDrag = () => dragging.moved;
    (el as HTMLCanvasElement & { __vpIsDrag?: () => boolean }).__vpIsDrag = isDrag;

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("wheel", onWheel);
    };
  }, [gl, camera]);

  useFrame(() => {
    const rts = rasterRegistry.list();
    if (!rts.length) return;
    const cam = camera as THREE.OrthographicCamera;

    // ---- §37 render origin + framing (recomputed when the registry changes)
    if (rasterRegistry.version !== framedRef.current) {
      framedRef.current = rasterRegistry.version;
      const fp = unionFootprint(rts)!;
      const origin: [number, number] = [
        Math.round((fp.min[0] + fp.max[0]) / 2),
        Math.round((fp.min[1] + fp.max[1]) / 2),
      ];
      originRef.current = origin;
      const w = fp.max[0] - fp.min[0];
      const h = fp.max[1] - fp.min[1];
      cam.position.set(
        (fp.min[0] + fp.max[0]) / 2 - origin[0],
        (fp.min[1] + fp.max[1]) / 2 - origin[1], 100,
      );
      cam.zoom = Math.max(1e-5, Math.min(size.width / w, size.height / h) * 0.92);
      cam.updateProjectionMatrix();
      // dispose everything — coordinates rebase on the new origin
      for (const [key, rec] of meshesRef.current) {
        rec.mesh.geometry.dispose();
        (rec.mesh.material as THREE.MeshBasicMaterial).map?.dispose();
        (rec.mesh.material as THREE.MeshBasicMaterial).dispose();
        groupRef.current.remove(rec.mesh);
        meshesRef.current.delete(key);
      }
    }
    const origin = originRef.current;

    const halfH = (cam.top - cam.bottom) / 2 / cam.zoom;
    const halfW = (cam.right - cam.left) / 2 / cam.zoom;
    const viewport = {
      bounds: {
        min: [cam.position.x - halfW + origin[0], cam.position.y - halfH + origin[1]] as [number, number],
        max: [cam.position.x + halfW + origin[0], cam.position.y + halfH + origin[1]] as [number, number],
      },
      width: size.width,
      height: size.height,
    };

    if (frameTick.current % 6 === 0) {
      for (const rt of rts) {
        void rt.update(viewport).catch(() => { /* surfaced via metrics */ });
      }
    }
    frameTick.current++;

    // ---- tile meshes (dataset-scoped keys — Finding H)
    for (const rt of rts) {
      const layer = layers.find((l) => l.datasetId === rt.datasetId);
      const layerVisible = layer ? layer.visible : true;
      const layerOpacity = layer ? layer.opacity : 1;
      const want = new Set<string>();
      const nodata = rt.rasterDescriptor.bands.map((b) => b.nodata);
      // CP5: dataset-measured stretch is the fallback for float rasters
      const style = { ...rt.style, stretch: rt.style.stretch ?? rt.stretchStats ?? undefined };
      for (const [tileKey, decoded] of rt.readyTiles()) {
        const key = `${rt.datasetId}::${tileKey}`;
        want.add(key);
        let rec = meshesRef.current.get(key);
        if (!rec) {
          const rgba = packTileRgba({
            raw: decoded.raw, width: decoded.width, height: decoded.height,
            stride: decoded.bufWidth,
            samples: decoded.samples, sampleType: decoded.sampleType,
            nodata, style,
            spacingX: rt.texelMetres().x, spacingY: rt.texelMetres().y,
          });
          if (!rgba) continue;
          const tex = new THREE.DataTexture(
            rgba as unknown as BufferSource, decoded.width, decoded.height, THREE.RGBAFormat,
          );
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.magFilter = THREE.LinearFilter;
          tex.minFilter = THREE.LinearFilter;
          tex.generateMipmaps = false;
          tex.needsUpdate = true;
          const mesh = new THREE.Mesh(
            tileGeometry(decoded.tile.quad, origin),
            new THREE.MeshBasicMaterial({
              map: tex, transparent: true, toneMapped: false, side: THREE.DoubleSide,
            }),
          );
          mesh.userData = { tileKey, datasetId: rt.datasetId };
          mesh.visible = layerVisible;
          (mesh.material as THREE.MeshBasicMaterial).opacity = layerOpacity;
          meshesRef.current.set(key, { mesh, datasetId: rt.datasetId, styleEpoch: rt.styleEpoch });
          groupRef.current.add(mesh);
          rec = meshesRef.current.get(key)!;
        } else if (rec.styleEpoch !== rt.styleEpoch) {
          // style changed → re-pack (raw data untouched, display-only)
          const rgba = packTileRgba({
            raw: decoded.raw, width: decoded.width, height: decoded.height,
            stride: decoded.bufWidth,
            samples: decoded.samples, sampleType: decoded.sampleType,
            nodata, style,
            spacingX: rt.texelMetres().x, spacingY: rt.texelMetres().y,
          });
          if (rgba) {
            const mat = rec.mesh.material as THREE.MeshBasicMaterial;
            mat.map?.dispose();
            const tex = new THREE.DataTexture(
              rgba as unknown as BufferSource, decoded.width, decoded.height, THREE.RGBAFormat,
            );
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.magFilter = THREE.LinearFilter;
            tex.minFilter = THREE.LinearFilter;
            tex.generateMipmaps = false;
            tex.needsUpdate = true;
            mat.map = tex;
            mat.needsUpdate = true;
          }
          rec.styleEpoch = rt.styleEpoch;
        }
        rec.mesh.visible = layerVisible;
        (rec.mesh.material as THREE.MeshBasicMaterial).opacity = layerOpacity;
      }
      // evict only THIS dataset's stale tiles (§55: ownership is per dataset)
      for (const [key, rec] of meshesRef.current) {
        if (rec.datasetId !== rt.datasetId) continue;
        if (!want.has(key)) {
          rec.mesh.geometry.dispose();
          (rec.mesh.material as THREE.MeshBasicMaterial).map?.dispose();
          (rec.mesh.material as THREE.MeshBasicMaterial).dispose();
          groupRef.current.remove(rec.mesh);
          meshesRef.current.delete(key);
        }
      }
    }
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    // drags must not probe
    const el = gl.domElement as HTMLCanvasElement & { __vpIsDrag?: () => boolean };
    if (el.__vpIsDrag?.()) return;
    e.stopPropagation();
    const dsId = (e.object as THREE.Mesh).userData?.datasetId as string | undefined;
    const rt = dsId ? rasterRegistry.get(dsId) : undefined;
    if (!rt) { onProbe(""); return; }
    const desc = rt.rasterDescriptor;
    const gt: GeoTransform = desc.geotransform;
    // render space → world → full-res pixel (float64 math, no GPU precision)
    const origin = originRef.current;
    const [col, row] = worldToPixel(gt, e.point.x + origin[0], e.point.y + origin[1]);
    const ci = Math.floor(col), ri = Math.floor(row);
    if (ci < 0 || ri < 0 || ci >= desc.width || ri >= desc.height) { onProbe(""); return; }
    const sample = rt.samplePixel(ci, ri);
    if (!sample) { onProbe(`E ${(e.point.x + origin[0]).toFixed(1)} · N ${(e.point.y + origin[1]).toFixed(1)} · px ${ci},${ri} · tile not resident`); return; }
    const vals = sample.values.map((v) => (Number.isFinite(v) ? v.toFixed(2) : "nodata")).join(" / ");
    onProbe(`E ${(e.point.x + origin[0]).toFixed(1)} · N ${(e.point.y + origin[1]).toFixed(1)} · px ${ci},${ri} · ${desc.crs} · ${vals}${sample.factor > 1 ? ` · L${sample.factor}` : ""}`);
  };

  return <group ref={groupRef} onClick={handleClick} />;
}

/** 2D Map workspace panel (§23). */
export function MapWorkspace({ active }: { active: boolean }) {
  const [probeText, setProbeText] = useState<string | null>(null);

  if (!active) return null;

  return (
    <div className="absolute inset-0">
      <Canvas orthographic camera={{ position: [0, 0, 100], zoom: 0.25, near: 0.1, far: 10000 }}
        gl={{ antialias: true }} onCreated={({ gl }) => { gl.setClearColor("#0a0d14"); }}>
        <MapContents onProbe={setProbeText} />
      </Canvas>
      <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/40 px-1.5 py-0.5 font-[var(--vp-font-mono)] text-[9px] tracking-widest text-sky-400">
        2D MAP · NORTH-UP
      </div>
      <div className="pointer-events-none absolute bottom-8 left-2 rounded bg-black/60 px-2 py-1 font-[var(--vp-font-mono)] text-[11px] text-[var(--vp-text-1)]">
        {probeText ?? "click a pixel to probe · drag to pan · wheel to zoom"}
      </div>
    </div>
  );
}
