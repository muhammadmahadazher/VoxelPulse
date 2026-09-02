import { describe, expect, it } from "vitest";
import { serializeProject, deserializeProject } from "./projectIo";
import { useProjectStore } from "../stores/projectStore";
import { useUiStore } from "../stores/uiStore";

describe("projectIo round-trip", () => {
  it("serializes and deserializes v2 datasets, layers, layout and camera", () => {
    useProjectStore.getState().newProject();
    useProjectStore.getState().addDataset({
      id: "ds-1", name: "survey.las", format: "las", kind: "point-cloud",
      source: { kind: "local-file", name: "survey.las", size: 1234567 },
      metadata: { pointCount: 1234 },
    });
    useProjectStore.getState().addLayer({
      id: "lyr-1", name: "survey.las", type: "pointcloud", visible: true,
      locked: false, opacity: 0.8, datasetId: "ds-1",
      source: { kind: "file", name: "survey.las" },
      pointCount: 1234, bounds: [0, 0, 0, 10, 10, 10],
    });
    useUiStore.getState().setLayout({ leftWidth: 300, rightWidth: 320, bottomHeight: 150 });

    const cam = { position: [1, 2, 3] as [number, number, number], target: [0, 0, 0] as [number, number, number] };
    const doc = serializeProject(cam, "split");

    const restored = deserializeProject(JSON.parse(JSON.stringify(doc)));
    expect(restored.formatVersion).toBe(2);
    expect(restored.datasets).toHaveLength(1);
    expect(restored.datasets[0]).toMatchObject({ id: "ds-1", format: "las" });
    expect(restored.datasets[0].source).toMatchObject({ kind: "local-file" }); // §78: descriptor, not bytes
    expect(restored.layers).toHaveLength(1);
    expect(restored.layers[0].datasetId).toBe("ds-1");
    expect(restored.layers[0].bounds).toEqual([0, 0, 0, 10, 10, 10]);
    expect(restored.layout).toEqual({ left: 300, right: 320, bottom: 150 });
    expect(restored.workspace.viewLayout).toBe("split");
    expect(restored.workspace.camera?.position).toEqual([1, 2, 3]);
  });

  it("migrates Phase 1.6 (v1) projects: opens, layers map, demo layers usable (§77)", () => {
    const v1 = {
      formatVersion: 1,
      meta: { name: "Phase 1.6 Project", formatVersion: 1, created: "2026-09-01T00:00:00.000Z" },
      layers: [
        { id: "lyr-a", name: "LiDAR Point Cloud", type: "pointcloud", visible: true,
          locked: false, opacity: 1, source: { kind: "demo", name: "Demo Scene" },
          pointCount: 25000, bounds: [-40, -40, -2, 40, 40, 12] },
        { id: "lyr-b", name: "Reference Frame", type: "reference", visible: true,
          locked: false, opacity: 1, source: { kind: "demo", name: "Demo Scene" } },
      ],
      layout: { left: 264, right: 288, bottom: 128 },
      workspace: { type: "scene", viewLayout: "single", camera: null },
    };
    const migrated = deserializeProject(JSON.parse(JSON.stringify(v1)));
    expect(migrated.formatVersion).toBe(2);
    expect(migrated.meta.name).toBe("Phase 1.6 Project");
    expect(migrated.datasets).toEqual([]); // v1 had no dataset table
    expect(migrated.layers).toHaveLength(2);
    expect(migrated.layers[0].pointCount).toBe(25000);
    expect(migrated.layers[0].bounds?.[5]).toBe(12);
    expect(migrated.layers.every((l) => l.datasetId === undefined)).toBe(true); // synthetic
  });

  it("rejects foreign documents", () => {
    expect(() => deserializeProject({ hello: "world" })).toThrow(/not a valid VoxelPulse project/i);
    expect(() => deserializeProject({ formatVersion: 99 })).toThrow();
  });

  it("never embeds point data in the project file (§78)", () => {
    const doc = serializeProject(null, "single");
    const json = JSON.stringify(doc);
    expect(json).not.toContain("Float32Array");
    expect(json).not.toContain('"positions"');
    expect(doc.layers.every((l) => !("positions" in l))).toBe(true);
  });
});
