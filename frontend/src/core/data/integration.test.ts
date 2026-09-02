/** §59 integration: fixture File → LocalFileSource → FormatRegistry →
 *  Adapter → Dataset → Chunk → RenderResource, for every supported format.
 *  §61–62: resource cleanup and repeated import/dispose stability. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { LocalFileSource } from "./source/localFile";
import { datasetManager } from "./datasetManager";
import { resourceManager } from "./resources/manager";
import { registerBuiltinAdapters } from "./formats/index";
import { decodeChunkData } from "./workers/client";
import { chunkToRenderResource } from "./renderResource";
import { jobStore } from "./jobs/jobStore";
import { asDatasetId } from "./ids";

const FIX = ["../../../tests/fixtures", "../../../../tests/fixtures"]
  .map((rel) => join(__dirname, rel))
  .find((dir) => existsSync(join(dir, "tiny.xyz")))!;

beforeAll(() => {
  registerBuiltinAdapters();
});

function fileOf(name: string): File {
  const buf = readFileSync(join(FIX, name));
  return new File([buf], name, { lastModified: 1_700_000_000_000 });
}

describe.each([
  { file: "tiny.xyz", format: "xyz", points: 30 },
  { file: "tiny.las", format: "las", points: 40 },
  { file: "tiny.ply", format: "ply", points: 25 },
  { file: "tiny-binary.ply", format: "ply", points: 25 },
  { file: "tiny.pcd", format: "pcd", points: 25 },
  { file: "tiny-binary.pcd", format: "pcd", points: 25 },
])("full pipeline: $file", ({ file, format, points }) => {
  it("File → source → registry → adapter → dataset → chunk → render resource", async () => {
    const source = new LocalFileSource(fileOf(file));
    const { dataset } = await datasetManager.openSource(source, {
      decodeChunk: (format, buffer, signal) => decodeChunkData(format, buffer, { signal }),
    });
    expect(dataset.info.format).toBe(format);
    expect(dataset.info.metadata.pointCount).toBe(points);

    const chunk = await datasetManager.readChunk(dataset.id, 0);
    const resource = chunkToRenderResource(chunk, dataset.id);
    expect(resource.pointCount).toBe(points);
    expect(resource.positions).toBeInstanceOf(Float32Array);
    expect(resource.bounds.max[0]).toBeGreaterThanOrEqual(resource.bounds.min[0]);
    expect(resource.fields.length).toBeGreaterThan(0);

    // dataset manager observability
    expect(datasetManager.descriptor(dataset.id)?.name).toBe(file);
    datasetManager.releaseRef(dataset.id);
    expect(datasetManager.get(dataset.id)).toBeUndefined();
    expect(resourceManager.datasetResources(dataset.id)).toHaveLength(0); // §61
  });
});

describe("repeated import/remove stability (§62)", () => {
  it("20 import/dispose cycles keep registries bounded", async () => {
    const source = new LocalFileSource(fileOf("tiny.ply"));
    const resourcesBefore = resourceManager.report().resourceCount;
    let lastId = "";
    for (let i = 0; i < 20; i++) {
      const { dataset } = await datasetManager.openSource(source, {
        decodeChunk: (format, buffer, signal) => decodeChunkData(format, buffer, { signal }),
      });
      lastId = dataset.id;
      await datasetManager.readChunk(dataset.id, 0);
      datasetManager.releaseRef(dataset.id);
    }
    expect(datasetManager.get(lastId)).toBeUndefined();
    expect(resourceManager.datasetResources(asDatasetId(lastId))).toHaveLength(0);
    // resource registry returns to baseline (no per-cycle growth)
    expect(resourceManager.report().resourceCount).toBe(resourcesBefore);
    // job history stays bounded (§95)
    const jobs = jobStore.list();
    expect(jobs.length).toBeLessThanOrEqual(12);
  });

  it("failed imports do not poison later ones (§63, end-to-end)", async () => {
    const bad = new File([new Uint8Array(8).fill(7)], "broken.ply", { lastModified: 1 });
    const good = fileOf("tiny.pcd");
    for (const f of [bad, good, bad, good]) {
      const source = new LocalFileSource(f);
      const attempt = await datasetManager.openSource(source, {
        decodeChunk: (format, buffer, signal) => decodeChunkData(format, buffer, { signal }),
      })
        .then((r) => ({ ok: r.dataset.id as string }))
        .catch((e) => ({ err: e as Error }));
      if ("ok" in attempt) datasetManager.releaseRef(attempt.ok);
    }
    // The pool/manager still serve a fresh import:
    const { dataset } = await datasetManager.openSource(new LocalFileSource(good), {
        decodeChunk: (format, buffer, signal) => decodeChunkData(format, buffer, { signal }),
      });
    expect(dataset.info.metadata.pointCount).toBe(25);
    datasetManager.releaseRef(dataset.id);
  });
});
