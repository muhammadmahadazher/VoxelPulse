import { describe, expect, it } from "vitest";
import { serializeProject, deserializeProject } from "./projectIo";
import { useProjectStore } from "../stores/projectStore";
import { useUiStore } from "../stores/uiStore";

describe("projectIo round-trip", () => {
  it("serializes and deserializes layers, layout and camera", () => {
    useProjectStore.getState().newProject();
    useProjectStore.getState().addLayer({
      id: "lyr-1", name: "survey.las", type: "pointcloud", visible: true,
      locked: false, opacity: 0.8, source: { kind: "file", name: "survey.las" },
      pointCount: 1234, bounds: [0, 0, 0, 10, 10, 10],
    });
    useUiStore.getState().setLayout({ leftWidth: 300, rightWidth: 320, bottomHeight: 150 });

    const cam = { position: [1, 2, 3] as [number, number, number], target: [0, 0, 0] as [number, number, number] };
    const doc = serializeProject(cam, "split");

    const restored = deserializeProject(JSON.parse(JSON.stringify(doc)));
    expect(restored.formatVersion).toBe(1);
    expect(restored.layers).toHaveLength(1);
    expect(restored.layers[0].name).toBe("survey.las");
    expect(restored.layers[0].bounds).toEqual([0, 0, 0, 10, 10, 10]);
    expect(restored.layout).toEqual({ left: 300, right: 320, bottom: 150 });
    expect(restored.workspace.viewLayout).toBe("split");
    expect(restored.workspace.camera?.position).toEqual([1, 2, 3]);
  });

  it("rejects foreign documents", () => {
    expect(() => deserializeProject({ hello: "world" })).toThrow(/not a valid VoxelPulse project/i);
    expect(() => deserializeProject({ formatVersion: 99 })).toThrow();
  });

  it("never embeds point data in the project file", () => {
    const doc = serializeProject(null, "single");
    expect(JSON.stringify(doc)).not.toContain("Float32Array");
    expect(doc.layers.every((l) => !("positions" in l))).toBe(true);
  });
});
