/** COPC adapter (§52): probe/inspect/open through the Phase 2 contract, with
 *  the hierarchy runtime exposed via capabilities (§53–54). Metadata is a
 *  genuine partial read (header + VLR window); point payload is never read
 *  during inspection (§13). */
import { VpDataError } from "../../errors";
import type { DataSource } from "../../source/types";
import type { DataFormat } from "../../types";
import type { FormatAdapter, ProbeContext, ProbeResult } from "../types";
import {
  parseCopcHeader, walkCopcVlrs, findVlr, parseCopcInfo, looksLikeCopc, rootBounds,
} from "./meta";
import { spatialReferenceRegistry } from "../../../spatial/registry";
import { epsgFromWkt } from "../parsers/las";
import { UNKNOWN_REFERENCE } from "../../../spatial/reference";

const COPC_HEADER_WINDOW = 64 * 1024;
const COPC_EXT = /\.(copc|copc\.laz|laz)$/i;

function copcProbe(ctx: ProbeContext): ProbeResult {
  if (!looksLikeCopc(ctx.header.buffer as ArrayBuffer)) {
    return { confidence: COPC_EXT.test(ctx.filename ?? "") ? 0.15 : 0, reason: "no copc info VLR" };
  }
  let confidence = 0.95;
  if (/\.copc(\.laz)?$/i.test(ctx.filename ?? "")) confidence = 1;
  return { confidence, format: "copc", reason: "copc info VLR" };
}

export const copcAdapter: FormatAdapter = {
  id: "copc" as DataFormat,
  label: "COPC point cloud (streamed)",

  probe: copcProbe,

  async inspect(source, signal) {
    try {
      const head = await source.read({ offset: 0, length: COPC_HEADER_WINDOW }, signal);
      const header = parseCopcHeader(head);
      const vlrs = walkCopcVlrs(head, header);
      const infoVlr = findVlr(vlrs, "copc", 1);
      if (!infoVlr) throw new VpDataError("invalid-data", "Missing COPC info VLR.");
      const info = parseCopcInfo(head.slice(infoVlr.dataOffset, infoVlr.dataOffset + 160));

      // CRS: LASF_Projection WKT VLR (same handling as LAS, §13/§53).
      const wktVlr = findVlr(vlrs, "LASF_Projection", 2112);
      let spatialReference;
      if (wktVlr && wktVlr.dataLength > 1) {
        const wkt = new TextDecoder().decode(
          head.slice(wktVlr.dataOffset, wktVlr.dataOffset + wktVlr.dataLength),
        ).replace(/\0[\s\S]*$/, "").trim();
        const epsg = epsgFromWkt(wkt);
        if (epsg) {
          spatialReference = {
            reference: spatialReferenceRegistry.resolve(`EPSG:${epsg}`),
            source: "embedded" as const,
            detail: `COPC WKT VLR → EPSG:${epsg}`,
          };
        } else if (wkt) {
          spatialReference = {
            reference: spatialReferenceRegistry.resolveDefinition(wkt),
            source: "embedded" as const,
            detail: "COPC WKT VLR (custom definition)",
          };
        }
      }
      if (!spatialReference) {
        spatialReference = {
          reference: UNKNOWN_REFERENCE, source: "none" as const,
          detail: "no WKT CRS VLR in file",
        };
      }

      return {
        name: source.descriptor().name ?? source.label,
        format: "copc" as DataFormat,
        kind: "point-cloud",
        metadata: {
          sourceName: source.descriptor().name,
          sourceSizeBytes: await source.size().catch(() => undefined),
          pointCount: header.pointCount,
          bounds: rootBounds(info),
          fields: [
            { name: "x", semantic: "position" as const, scalarType: "float64" as const, components: 3, unit: "m" },
            { name: "intensity", semantic: "intensity" as const, scalarType: "float32" as const, components: 1 },
            { name: "classification", semantic: "classification" as const, scalarType: "uint8" as const, components: 1 },
          ],
          createdAt: new Date().toISOString(),
          spatialReference,
          formatSpecific: {
            copc: {
              pointFormat: header.pointFormat,
              pointRecordLength: header.pointRecordLength,
              spacing: info.spacing,
              halfsize: info.halfsize,
              rootHierOffset: info.rootHierOffset,
              rootHierSize: info.rootHierSize,
              gpstimeMin: info.gpstimeMin,
              gpstimeMax: info.gpstimeMax,
            },
          },
        },
        chunkCount: 0, // hierarchical — nodes streamed, not chunk-0 (§53)
      };
    } catch (e) {
      if (e instanceof VpDataError) throw e;
      throw new VpDataError("invalid-data", `Could not inspect ${source.label} as COPC.`, {
        detail: (e as Error).message?.slice(0, 200),
      });
    }
  },

  async open() {
    // §53: the streaming runtime attaches to the dataset manager separately;
    // whole-file chunk decode does not apply to COPC.
    throw new VpDataError("unsupported-format",
      "COPC datasets stream through the hierarchical runtime and cannot be decoded whole.", {
        detail: "this adapter provides inspect/detection; node streaming is scheduler-driven",
      });
  },
};
