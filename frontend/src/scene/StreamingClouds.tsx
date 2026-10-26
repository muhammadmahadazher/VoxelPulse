/** Streaming point-cloud renderer (§55–61): one THREE.Points per prepared
 *  node under a shared shader material, engine-owned and imperative — node
 *  arrival/eviction never touches React state (§57). Disposal disposes each
 *  node's geometry only; the shared material outlives nodes (§58). */
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { streamingRegistry } from "../core/streaming/registry";
import { useStore } from "../store";
import { useProjectStore } from "../stores/projectStore";
import { vertexShader, fragmentShader, makeColormapUniforms, COLORMAP_INDEX } from "./shaders";

export function StreamingClouds() {
  const groupRef = useRef<THREE.Group>(null!);
  const pointsRef = useRef<Map<string, THREE.Points>>(new Map());
  const matRef = useRef<THREE.ShaderMaterial>(null!);
  const uniforms = useRef(makeColormapUniforms());
  const frameTick = useRef(0);
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    const group = groupRef.current;
    return () => {
      // dispose every node geometry on unmount; material disposed separately
      for (const [, pts] of pointsRef.current) {
        pts.geometry.dispose();
        group.remove(pts);
      }
      pointsRef.current.clear();
    };
  }, []);

  // height colormap normalization uses the DATASET's metadata bounds (§62) —
  // stable across streaming, not per-node.
  const datasets = useProjectStore((s) => s.datasets);

  useFrame(({ camera }) => {
    const mat = matRef.current;
    const st = useStore.getState();
    const runtimes = streamingRegistry.list();
    if (!runtimes.length) {
      if (groupRef.current.children.length) {
        for (const [, pts] of pointsRef.current) {
          pts.geometry.dispose();
          groupRef.current.remove(pts);
        }
        pointsRef.current.clear();
      }
      return;
    }

    // shared material uniforms (same analytical path as the live cloud)
    mat.uniforms.pointSize.value = st.pointSize;
    mat.uniforms.colormapMode.value = COLORMAP_INDEX[st.colormap] ?? 0;
    mat.uniforms.intensityMin.value = st.intensityMin;
    (mat.uniforms.roiMin.value as THREE.Vector3).set(st.roi.xMin, st.roi.yMin, st.roi.zMin);
    (mat.uniforms.roiMax.value as THREE.Vector3).set(st.roi.xMax, st.roi.yMax, st.roi.zMax);
    // stable global height range from dataset metadata (§62)
    for (const ds of datasets) {
      const b = ds.metadata.bounds as { min: number[]; max: number[] } | undefined;
      if (b) {
        mat.uniforms.heightMin.value = b.min[2];
        mat.uniforms.heightMax.value = b.max[2];
        break;
      }
    }
    mat.visible = st.showPoints;

    const cam = camera as THREE.PerspectiveCamera;
    const viewProj = new THREE.Matrix4()
      .multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const viewProjArr = [...viewProj.elements];
    const camPos: [number, number, number] = [cam.position.x, cam.position.y, cam.position.z];

    const runUpdate = frameTick.current % 6 === 0;
    for (const rt of runtimes) {
      // drive the scheduler at ~10 Hz (not every frame — §25/§35)
      if (runUpdate) {
        (rt as unknown as { lastFrameDebug?: unknown }).lastFrameDebug = {
          camPos, vpTop: viewProjArr.slice(12, 16), fov: cam.fov, tick: frameTick.current,
        };
        void rt.update(
          { position: camPos, fovYRadians: (cam.fov * Math.PI) / 180, aspect: cam.aspect, viewportHeight: window.innerHeight },
          viewProjArr,
        ).catch((e) => { console.error("[vp:streaming] update failed:", e?.message ?? e); });
      }
      // reflect ready/evicted nodes (imperative — no React)
      const want = new Set<string>();
      // runtime exposes its render set via node states; simplest correct
      // bridge: the runtime's prepared entries that the scheduler marked —
      // we approximate with all ready nodes; frustum culling per-Points is
      // done by three.js using geometry bounds (§20 coarse cull + GPU cull).
      for (const [nodeId, prepared] of rt.preparedNodes()) {
        want.add(nodeId);
        if (!pointsRef.current.has(nodeId)) {
          const geom = new THREE.BufferGeometry();
          geom.setAttribute("position", new THREE.BufferAttribute(prepared.positions, 3));
          geom.setAttribute("intensity", new THREE.BufferAttribute(prepared.intensity, 1));
          if (prepared.colors) {
            geom.setAttribute("colorRgb", new THREE.BufferAttribute(prepared.colors, 3));
          }
          if (prepared.classification) {
            geom.setAttribute("classification", new THREE.BufferAttribute(prepared.classification, 1));
          }
          geom.computeBoundingSphere();
          const pts = new THREE.Points(geom, mat);
          pts.frustumCulled = true;
          pointsRef.current.set(nodeId, pts);
          groupRef.current.add(pts);
        }
      }
      for (const [nodeId, pts] of pointsRef.current) {
        if (!want.has(nodeId)) {
          pts.geometry.dispose(); // node-owned geometry only (§58)
          groupRef.current.remove(pts);
          pointsRef.current.delete(nodeId);
        }
      }
    }
    frameTick.current++;
  });

  return (
    <>
      <group ref={groupRef} frustumCulled={false} />
      <shaderMaterial
        ref={matRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms.current}
        transparent
        depthWrite={true}
        blending={THREE.NormalBlending}
        visible={false}
      />
    </>
  );
}
