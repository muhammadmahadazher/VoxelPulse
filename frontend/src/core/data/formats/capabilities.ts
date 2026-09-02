/** Format capability matrix (§88) — one factual source, UI/README derive. */
import type { DataFormat, FormatCapabilities } from "../types";

export const FORMAT_CAPABILITIES: Record<DataFormat, FormatCapabilities> = {
  las: {
    browserImport: true,
    randomAccess: false, // header-inspect only; point decode is whole-file today (§66)
    streaming: false,
    export: false,
    notes: "LAS 1.0–1.4 formats 0–5; no LAZ (compressed) support",
  },
  ply: {
    browserImport: true,
    randomAccess: false,
    streaming: false,
    export: true,
    notes: "ascii + binary_little_endian; vertex clouds with x/y/z",
  },
  pcd: {
    browserImport: true,
    randomAccess: false,
    streaming: false,
    export: true,
    notes: "ascii + binary; binary_compressed not supported",
  },
  xyz: {
    browserImport: true,
    randomAccess: false,
    streaming: false,
    export: true,
    notes: "whitespace/comma-delimited X Y Z [intensity] text",
  },
  generated: {
    browserImport: true,
    randomAccess: false,
    streaming: false,
    export: false,
    notes: "in-app synthetic demo scenes",
  },
  "vpf1-stream": {
    browserImport: true,
    randomAccess: true,
    streaming: true,
    export: false,
    notes: "live VPF1 telemetry — temporal provider, not a static file",
  },
};
