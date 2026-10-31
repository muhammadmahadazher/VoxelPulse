/** 2D Map workspace (§23): orthographic north-up raster rendering on a
 *  three.js plane per tile, engine-owned and imperative — tile arrival and
 *  eviction never touch React state. Pan, zoom, coordinate probe (click),
 *  shared layer visibility. */
import { useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { rasterRegistry } from "../core/raster/registry";
import { useProjectStore } from "../stores/projectStore";
import { worldToPixel } from "../core/raster/transform";

function MapContents({ onProbe }: { onProbe: (text: string) => void }) {
  const groupRef = useRef<THREE.Group>(null!);
  const meshesRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const { camera, size } = useThree();
  const frameTick = useRef(0);
  const layers = useProjectStore((s) => s.layers);

  useFrame(() => {
    const rts = rasterRegistry.list();
    if (!rts.length) return;
    const cam = camera as THREE.OrthographicCamera;

    const halfH = (cam.top - cam.bottom) / 2 / cam.zoom;
    const halfW = (cam.right - cam.left) / 2 / cam.zoom;
    const viewport = {
      bounds: {
        min: [cam.position.x - halfW, cam.position.y - halfH] as [number, number],
        max: [cam.position.x + halfW, cam.position.y + halfH] as [number, number],
      },
      width: size.width,
      height: size.height,
    };

    if (frameTick.current % 6 === 0) {
      for (const rt of rts) {
        void rt.update(viewport).catch(() => { /* via metrics */ });
      }
    }
    frameTick.current++;

    for (const rt of rts) {
      const layer = layers.find((l) => l.datasetId === rt.datasetId);
      const layerVisible = layer ? layer.visible : true;
      const want = new Set<string>();
      for (const [tileKey, decoded] of rt.readyTiles()) {
        want.add(tileKey);
        if (!meshesRef.current.has(tileKey)) {
          const tex = new THREE.DataTexture(
            decoded.pixels as unknown as BufferSource,
            decoded.width, decoded.height, THREE.RGBAFormat,
          );
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.magFilter = THREE.LinearFilter;
          tex.minFilter = THREE.LinearFilter;
          tex.needsUpdate = true;
          const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(
              decoded.tile.bounds.max[0] - decoded.tile.bounds.min[0],
              decoded.tile.bounds.max[1] - decoded.tile.bounds.min[1],
            ),
            new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }),
          );
          mesh.position.set(
            (decoded.tile.bounds.min[0] + decoded.tile.bounds.max[0]) / 2,
            (decoded.tile.bounds.min[1] + decoded.tile.bounds.max[1]) / 2, 0,
          );
          mesh.userData = { tileKey, datasetId: rt.datasetId };
          meshesRef.current.set(tileKey, mesh);
          groupRef.current.add(mesh);
        }
      }
      for (const [tileKey, mesh] of meshesRef.current) {
        mesh.visible = layerVisible;
        if (!want.has(tileKey)) {
          mesh.geometry.dispose();
          (mesh.material as THREE.MeshBasicMaterial).map?.dispose();
          (mesh.material as THREE.MeshBasicMaterial).dispose();
          groupRef.current.remove(mesh);
          meshesRef.current.delete(tileKey);
        }
      }
    }
  });

  const handleClick = (e: ThreeEvent<Click>) => {
    e.stopPropagation();
    const dsId = (e.object as THREE.Mesh).userData?.datasetId as string | undefined;
    const rt = dsId ? rasterRegistry.get(dsId) : undefined;
    if (!rt) { onProbe(""); return; }
    const desc = rt.rasterDescriptor;
    const [col, row] = worldToPixel(desc.geotransform, e.point.x, e.point.y);
    const ci = Math.floor(col), ri = Math.floor(row);
    if (ci < 0 || ri < 0 || ci >= desc.width || ri >= desc.height) { onProbe(""); return; }
    const sample = rt.samplePixel(ci, ri);
    if (!sample) { onProbe(`px ${ci},${ri} · tile not resident`); return; }
    onProbe(`px ${ci},${ri} · ${desc.crs} · ${sample.values.map((v) => (Number.isFinite(v) ? v.toFixed(2) : "nodata")).join(" / ")}`);
  };

  return <group ref={groupRef} onClick={handleClick} />;
}

/** 2D Map workspace panel. */
export function MapWorkspace({ active }: { active: boolean }) {
  const [probeText, setProbeText] = useState<string | null>(null);

  if (!active) return null;

  return (
    <div className="absolute inset-0">
      <Canvas orthographic camera={{ position: [500000, 4000000, 100], zoom: 0.25, near: 0.1, far: 10000 }}
        gl={{ antialias: true }} onCreated={({ gl }) => { gl.setClearColor("#0a0d14"); }}>
        <MapContents onProbe={setProbeText} />
      </Canvas>
      <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/40 px-1.5 py-0.5 font-[var(--vp-font-mono)] text-[9px] tracking-widest text-sky-400">
        2D MAP · NORTH-UP
      </div>
      <div className="pointer-events-none absolute bottom-8 left-2 rounded bg-black/60 px-2 py-1 font-[var(--vp-font-mono)] text-[11px] text-[var(--vp-text-1)]">
        {probeText ?? "click a pixel to probe"}
      </div>
    </div>
  );
}
