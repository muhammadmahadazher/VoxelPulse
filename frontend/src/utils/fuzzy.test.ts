import { describe, expect, it } from "vitest";
import { fuzzyMatch, fuzzyRank } from "./fuzzy";

describe("fuzzyMatch", () => {
  it("matches exact prefix with a bonus", () => {
    const r = fuzzyMatch("col", "Colormap: Turbo");
    expect(r).not.toBeNull();
    expect(r!.indices.length).toBe(3);
  });

  it("matches scattered subsequences case-insensitively", () => {
    expect(fuzzyMatch("ldr", "LiDAR Point Cloud")).not.toBeNull();
    expect(fuzzyMatch("LDR", "lidar")).not.toBeNull();
  });

  it("rejects non-subsequences", () => {
    expect(fuzzyMatch("zzz", "Colormap")).toBeNull();
    expect(fuzzyMatch("layer", "lyr")).toBeNull();
  });

  it("empty query matches everything", () => {
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, indices: [] });
  });
});

describe("fuzzyRank", () => {
  it("ranks prefix and word-start matches above scattered ones", () => {
    const items = ["Layout: Split", "Colormap: class", "Export: LAS"];
    const ranked = fuzzyRank("la", items, (s) => s).map((r) => r.item);
    expect(ranked[0]).toBe("Layout: Split");
  });

  it("drops non-matching items", () => {
    expect(fuzzyRank("quad", ["Points", "Layers"], (s) => s)).toHaveLength(0);
  });
});
