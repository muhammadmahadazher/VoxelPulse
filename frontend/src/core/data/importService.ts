/** Import service (§50, §89, §91): one pipeline for Add Data, drag-drop and
 *  multi-file import. Stages: queued → probing → reading → decoding →
 *  creating-layer → completed/failed/cancelled. The app layer injects the
 *  two touch points that belong to it (layer creation, camera framing) —
 *  the service never touches stores or the renderer directly (§38). */
import { datasetManager } from "./datasetManager";
import { jobStore } from "./jobs/jobStore";
import { decodeChunkData } from "./workers/client";
import { LocalFileSource } from "./source/localFile";
import { isCancelledError, toVpDataError, VpDataError } from "./errors";
import type { DataSource } from "./source/types";
import type { DataFormat } from "./types";
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

const running = new Map<string, AbortController>();

/** §116–117: current decode paths are whole-file — refuse dangerous
 *  allocations up front with an honest message instead of crashing the tab. */
const WHOLE_FILE_LIMIT = 800 * 1024 * 1024; // 800 MB

function perfMark(name: string): void {
  // §97: real Performance marks make later optimization evidence-based.
  try { performance.mark(name); } catch { /* non-browser context */ }
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
      const size = await source.size().catch(() => undefined);
      if (size !== undefined && size > WHOLE_FILE_LIMIT) {
        throw new VpDataError("out-of-memory", "This dataset is too large for the current browser loader.", {
          detail: `${(size / 1e6).toFixed(0)} MB — large-file streaming support is planned for the massive-data phase.`,
        });
      }

      perfMark("vp:import:probe:start");
      jobStore.setStatus(job.id, "probing", { message: "detecting format" });
      const { dataset } = await datasetManager.openSource(source, {
        signal: ctrl.signal,
        decodeChunk: (format: DataFormat, buffer: ArrayBuffer, signal?: AbortSignal) =>
          decodeChunkData(format, buffer, { signal, priority: "interactive" }),
      });
      perfMark("vp:import:probe:end");

      jobStore.setStatus(job.id, "reading", {
        message: `reading ${dataset.info.metadata.pointCount ?? ""} points`.trim(),
      });
      perfMark("vp:import:decode:start");
      const chunk = await datasetManager.readChunk(dataset.id, 0, ctrl.signal);
      perfMark("vp:import:decode:end");
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
      const err = toVpDataError(e, "decode-failed", `Could not import ${label}`);
      jobStore.setStatus(job.id, "failed", {
        error: { code: err.code, message: err.message, detail: err.detail },
      });
      hooks.notifyError(`Could not open ${label}`, err.message, err.detail);
    } finally {
      running.delete(job.id);
    }
  },
};

/** Cancel an in-flight import (§31): signal propagates source→adapter→worker. */
export function cancelImport(jobId: string): boolean {
  const ctrl = running.get(jobId);
  if (!ctrl) return false;
  ctrl.abort();
  return true;
}
