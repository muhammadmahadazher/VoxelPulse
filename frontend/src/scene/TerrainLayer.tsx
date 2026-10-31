/** 3D terrain renderer (CP6): raster DEM tiles → tiled meshes in the SAME
 *  scene and render space as the point clouds ((E, N, Z) Z-up, render origin
 *  shared with the §84 pipeline). Engine-owned and imperative — mesh arrival
 *  and eviction never touch React state. The raster runtime's tile cache is
 *  SHARED with the 2D map (one LRU budget per dataset); this component drives
 *  rt.update with a viewport estimated from the 3D camera. Raw elevations are
 *  never rescaled — exaggeration is mesh.scale.z (visual only). */
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { rasterRegistry } from "../core/raster/registry";
import { useProjectStore } from "../stores/projectStore";
import { useStore } from "../store";
import { renderOrigin, setSessionOrigin } from "../utils/projectSpatial";
import { buildTerrainTile, type TerrainMeshData } from "../core/raster/terrain";

interface MeshRecord {
  mesh: THREE.Mesh;
  datasetId: string;
  exaggerationEpoch: number;
}

/** Project the camera onto the XY plane; extent grows with distance so the
 *  scheduler picks coarser overviews when the terrain is far. */
function terrainViewport(
  cam: THREE.PerspectiveCamera,
  origin: [number, number, number],
): { bounds: { min: [number, number]; max: [number, number] }; width: number; height: number } {
  const cx = cam.position.x + origin[0];
  const cy = cam.position.y + origin[1];
  const dist = Math.max(10, cam.position.length());
  const half = dist * Math.tan((cam.fov * Math.PI) / 360) * 1.6 + 50;
  return {
    bounds: { min: [cx - half, cy - half], max: [cx + half, cy + half] },
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

export function TerrainLayer() {
  const groupRef = useRef<THREE.Group>(null!);
  const meshesRef = useRef<Map<string, MeshRecord>>(new Map());
  const sunRef = useRef<THREE.DirectionalLight>(null!);
  const frameTick = useRef(0);
  const lastUpdate = useRef(0);
  const framedRef = useRef(false);
  const { camera, controls } = useThree();

  // e2e/diagnostics: 3D camera + controls handle
  useEffect(() => {
    (window as unknown as { __vp3d?: unknown }).__vp3d = { camera, controls };
  }, [camera, controls]);

  useFrame(() => {
    // e2e diagnostics: live terrain mesh bookkeeping
    const first = [...meshesRef.current.values()][0]?.mesh;
    (window as unknown as { __vpTerrain?: unknown }).__vpTerrain = {
      meshes: groupRef.current.children.filter((c) => c instanceof THREE.Mesh).length,
      datasetIds: [...new Set([...meshesRef.current.values()].map((r) => r.datasetId))],
      scaleZ: first?.scale.z ?? null,
      geoZMin: first?.geometry.boundingBox?.min.z ?? null,
      geoZMax: first?.geometry.boundingBox?.max.z ?? null,
    };
    const layers = useProjectStore.getState().layers;
    const terrainLayers = layers.filter((l) => l.type === "raster" && l.terrain && l.datasetId);
    const rts = rasterRegistry.list().filter((rt) => terrainLayers.some((l) => l.datasetId === rt.datasetId));

    // dispose meshes for datasets no longer terrain-enabled
    for (const [key, rec] of meshesRef.current) {
      if (!rts.some((rt) => rt.datasetId === rec.datasetId)) {
        rec.mesh.geometry.dispose();
        (rec.mesh.material as THREE.Material).dispose();
        groupRef.current.remove(rec.mesh);
        meshesRef.current.delete(key);
      }
    }
    if (!rts.length) return;

    // §37 precision: share the session render origin; a geospatial terrain in
    // a fresh session claims it first (clouds reuse the same origin later)
    let origin = renderOrigin().world;
    const fp = rts[0].footprint();
    if (origin[0] === 0 && origin[1] === 0 && (Math.abs(fp.min[0]) > 1e5 || Math.abs(fp.max[1]) > 1e5)) {
      setSessionOrigin([
        Math.round((fp.min[0] + fp.max[0]) / 2),
        Math.round((fp.min[1] + fp.max[1]) / 2),
        0,
      ]);
      origin = renderOrigin().world;
    }

    // drive the shared tile scheduler from the 3D camera (wall-clock throttle)
    const now = performance.now();
    if (now - lastUpdate.current > 150) {
      lastUpdate.current = now;
      const vp = terrainViewport(camera as THREE.PerspectiveCamera, origin as [number, number, number]);
      for (const rt of rts) {
        void rt.update(vp).catch(() => { /* surfaced via metrics */ });
      }
    }

    const exaggeration = useStore.getState().terrainExaggeration;
    for (const rt of rts) {
      const layer = terrainLayers.find((l) => l.datasetId === rt.datasetId)!;
      const desc = rt.rasterDescriptor;
      const nodata = desc.bands[0]?.nodata;
      for (const [tileKey, decoded] of rt.readyTiles()) {
        const key = `${rt.datasetId}::${tileKey}`;
        const existing = meshesRef.current.get(key);
        if (!existing) {
          const built: TerrainMeshData | null = buildTerrainTile({
            decoded, tile: decoded.tile, gt: desc.geotransform,
            origin: origin as [number, number, number],
            nodata: typeof nodata === "number" ? nodata : undefined,
          });
          if (!built) continue;
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.BufferAttribute(built.positions, 3));
          geo.setIndex(new THREE.BufferAttribute(built.indices, 1));
          geo.computeVertexNormals();
          geo.computeBoundingBox();
          const mat = new THREE.MeshStandardMaterial({
            color: "#9aa3ad", roughness: 0.95, metalness: 0,
            side: THREE.DoubleSide, transparent: true, opacity: 1,
            // geospatial terrain sits far outside the demo scene's fog range
            fog: false,
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.scale.z = exaggeration;
          mesh.userData = { datasetId: rt.datasetId, tileKey };
          mesh.visible = layer.visible;
          const rec: MeshRecord = { mesh, datasetId: rt.datasetId, exaggerationEpoch: exaggeration };
          meshesRef.current.set(key, rec);
          groupRef.current.add(mesh);

          // first terrain in an otherwise-empty scene → offer camera framing.
          // ViewportHandle.frameBounds expects bounds in (E, Z, N) order
          // (its internal swizzle targets the Z-up cloud convention).
          if (!framedRef.current) {
            framedRef.current = true;
            document.dispatchEvent(new CustomEvent("vp-frame-bounds", {
              detail: [
                built.bounds.min[0], built.bounds.min[2], built.bounds.min[1],
                built.bounds.max[0], built.bounds.max[2], built.bounds.max[1],
              ],
            }));
          }
        } else {
          if (existing.exaggerationEpoch !== exaggeration) {
            existing.mesh.scale.z = exaggeration;
            existing.exaggerationEpoch = exaggeration;
          }
          existing.mesh.visible = layer.visible;
          const mat = existing.mesh.material as THREE.MeshStandardMaterial;
          mat.opacity = layer.opacity;
        }
      }
      // evict tiles this dataset no longer holds (shared runtime eviction)
      const want = new Set(rt.readyTiles().keys());
      for (const [key, rec] of meshesRef.current) {
        if (rec.datasetId !== rt.datasetId) continue;
        const tileKey = key.split("::")[1];
        if (!want.has(tileKey)) {
          rec.mesh.geometry.dispose();
          (rec.mesh.material as THREE.Material).dispose();
          groupRef.current.remove(rec.mesh);
          meshesRef.current.delete(key);
        }
      }
    }
  });

  // key light for relief shading (clouds use a custom shader — unaffected)
  return (
    <group ref={groupRef}>
      <directionalLight ref={sunRef} position={[0.3, -0.5, 1]} intensity={1.1} />
    </group>
  );
}
