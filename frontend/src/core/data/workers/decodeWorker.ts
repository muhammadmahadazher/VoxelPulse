/** Decode worker entry (§27). Owns the pure format parsers and returns
 *  decoded arrays as transferables — the main thread never re-copies the
 *  payload beyond the structured-clone boundary crossing. */
/// <reference lib="webworker" />
import { boundsFromPositions } from "../bounds";
import { VpDataError, toVpDataError } from "../errors";
import { prepareNodeInPlace } from "./prepareInPlace";
import type { WorkerJob, WorkerResponse } from "./protocol";
import { parseXyz } from "../formats/parsers/xyz";
import { parseLas } from "../formats/parsers/las";
import { parsePly } from "../formats/parsers/ply";
import { parsePcd } from "../formats/parsers/pcd";

function post(msg: WorkerResponse, transfer: Transferable[]): void {
  (self as unknown as Worker).postMessage(msg, transfer);
}

function decode(job: WorkerJob): void {
  const { format, buffer } = job.payload;
  try {
    let parsed: {
      pointCount: number;
      positions: Float32Array | Float64Array;
      intensity?: Float32Array;
      colors?: Uint8Array;
      classification?: Uint8Array;
    };
    switch (format) {
      case "xyz":
        parsed = parseXyz(new TextDecoder().decode(buffer));
        break;
      case "las": {
        const r = parseLas(buffer);
        parsed = { ...r, colors: r.colors ?? undefined, classification: r.classification ?? undefined };
        break;
      }
      case "ply": {
        const r = parsePly(buffer);
        parsed = { ...r, colors: r.colors ?? undefined };
        break;
      }
      case "pcd": {
        const r = parsePcd(buffer);
        parsed = { ...r, colors: r.colors ?? undefined };
        break;
      }
      default:
        throw new VpDataError("unsupported-format", `No worker decoder for format "${format}"`);
    }
    const bounds = boundsFromPositions(parsed.positions, parsed.pointCount);
    const transfers: Transferable[] = [
      parsed.positions.buffer as ArrayBuffer,
    ];
    if (parsed.intensity) transfers.push(parsed.intensity.buffer as ArrayBuffer);
    if (parsed.colors) transfers.push(parsed.colors.buffer as ArrayBuffer);
    if (parsed.classification) transfers.push(parsed.classification.buffer as ArrayBuffer);
    post({
      type: "result",
      id: job.id,
      pointCount: parsed.pointCount,
      positions: parsed.positions.buffer as ArrayBuffer,
      positionsType: (parsed.positions instanceof Float64Array ? "f64" : "f32") as "f32" | "f64",
      intensity: parsed.intensity?.buffer as ArrayBuffer | undefined,
      colors: parsed.colors?.buffer as ArrayBuffer | undefined,
      classification: parsed.classification?.buffer as ArrayBuffer | undefined,
      bounds,
      transfers: transfers.length,
    }, transfers);
  } catch (e) {
    const err = toVpDataError(e, "decode-failed", `Failed to decode ${format} data`);
    post({ type: "error", id: job.id, code: err.code, message: err.message, detail: err.detail }, []);
  }
}

/** §36, §104: full node preparation via the shared pipeline (identical math
 *  to the main-thread fallback) — runs in this worker with a cached laz-perf
 *  module (§103). */
async function prepareNode(job: WorkerJob): Promise<void> {
  const p = job.payload;
  try {
    const data = await prepareNodeInPlace({
      nodeId: undefined,
      buffer: p.buffer,
      pointFormat: p.pointFormat ?? 6,
      pointRecordLength: p.pointRecordLength ?? 36,
      pointCount: p.pointCount ?? 0,
      compressed: p.compressed ?? false,
      scales: p.scales ?? [1, 1, 1],
      offsets: p.offsets ?? [0, 0, 0],
      sourceProj: p.sourceProj,
      targetProj: p.targetProj,
      origin: p.origin ?? [0, 0, 0],
    });
    const transfers: Transferable[] = [
      data.positions.buffer as ArrayBuffer,
      data.intensity.buffer as ArrayBuffer,
    ];
    if (data.colors) transfers.push(data.colors.buffer as ArrayBuffer);
    if (data.classification) transfers.push(data.classification.buffer as ArrayBuffer);
    post({
      type: "result",
      id: job.id,
      pointCount: data.pointCount,
      positions: data.positions.buffer as ArrayBuffer,
      positionsType: "f32",
      nodeId: p.nodeId,
      intensity: data.intensity.buffer as ArrayBuffer,
      colors: data.colors?.buffer as ArrayBuffer | undefined,
      classification: data.classification?.buffer as ArrayBuffer | undefined,
      bounds: data.worldBounds,
      worldBounds: data.worldBounds,
      transfers: transfers.length,
    }, transfers);
  } catch (e) {
    const err = toVpDataError(e, "decode-failed", "Failed to prepare node data");
    post({ type: "error", id: job.id, code: err.code, message: err.message, detail: err.detail }, []);
  }
}

self.onmessage = (e: { data: WorkerJob }) => {
  const job = e.data;
  if (job.payload.format === "cancel-notice") return; // client already rejected
  if (job.type === "prepare-node") void prepareNode(job);
  else decode(job);
};
