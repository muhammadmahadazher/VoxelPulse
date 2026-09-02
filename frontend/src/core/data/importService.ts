/** Import service (§50, §89, §91): one pipeline for Add Data, drag-drop and
 *  multi-file import. Stages: queued → probing → reading → decoding →
 *  creating-layer → completed/failed/cancelled. The app layer injects the
 *  two touch points that belong to it (layer creation, camera framing) —
 *  the service never touches stores or the renderer directly (§38). */
import { datasetManager } from "./datasetManager";
import { jobStore } from "./jobs/jobStore";
import { decodeChunkData } from "./workers/client";
import { LocalFileSource } from "./source/localFile";
import { isCancelledError } from "./errors";
import type { DataSource } from "./source/types";
import type { DecodedChunk } from "./formats/types";
import type { DatasetDescriptor } from "./types";

export interface ImportHooks {
  /** Create the workspace layer for a decoded dataset (app store concern). */
  createLayer: (ctx: {
    descriptor: DatasetDescriptor;
    chunk: DecodedChunk;
    sourceLabel: string;
  }) => void;
  /** Frame the camera on dataset bounds after import (§51). */
  frameBounds: (bounds: { min: [number, number, number]; max: [number, number, number] }) => void;
  /** Non-blocking user-facing failure notice (§33, §90). */
  notifyError: (title: string, message: string, detail?: string) => void;
}

export const importService = {
  /** Import Files (Add Data / drop) — each file is an independent job (§91). */
  importFiles(files: File[], hooks: ImportHooks): void {
    for (const file of files) {
      void this.importSource(new LocalFileSource(file), hooks);
    }
  },

  /** Import any source (URL, memory, …) through the identical pipeline (§92). */
  async importSource(source: DataSource, hooks: ImportHooks): Promise<void> {
    const label = source.descriptor().name ?? source.label;
    const job = jobStore.create(label);
    const ctrl = new AbortController();
    running.set(job.id, ctrl);
    try {
      jobStore.setStatus(job.id, "probing", { message: "detecting format" });
      const { dataset } = await datasetManager.openSource(source, {
        signal: ctrl.signal,
        decodeChunk: (format, buffer, signal) =>
          decodeChunkData(format, buffer, { signal, priority: "interactive" }),
      });

      jobStore.setStatus(job.id, "reading", {
        message: `reading ${dataset.info.metadata.pointCount ?? ""} points`.trim(),
      });
      const chunk = await datasetManager.readChunk(dataset.id, 0, ctrl.signal);
      if (jobStore.get(job.id)?.status === "cancelled") return; // late finish — drop (§64)

      jobStore.setStatus(job.id, "creating-layer", { message: "creating layer" });
      hooks.createLayer({
        descriptor: datasetManager.descriptor(dataset.id)!,
        chunk,
        sourceLabel: label,
      });
      hooks.frameBounds(chunk.bounds);

      jobStore.setStatus(job.id, "completed", {
        progress: 1,
        message: `${chunk.pointCount.toLocaleString()} points`,
      });
    } catch (e) {
      if (isCancelledError(e)) {
        jobStore.setStatus(job.id, "cancelled");
        return;
      }
      const err = e as { code?: string; message: string; detail?: string };
      jobStore.setStatus(job.id, "failed", {
        error: { code: err.code ?? "decode-failed", message: err.message, detail: err.detail },
      });
      hooks.notifyError(`Could not open ${label}`, err.message, err.detail);
    } finally {
      running.delete(job.id);
    }
  },
};

const running = new Map<string, AbortController>();

/** Cancel an in-flight import (§31): signal propagates source→adapter→worker. */
export function cancelImport(jobId: string): boolean {
  const ctrl = running.get(jobId);
  if (!ctrl) return false;
  ctrl.abort();
  return true;
}
