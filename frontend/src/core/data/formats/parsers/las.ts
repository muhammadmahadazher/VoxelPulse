/** Binary LAS 1.0–1.4 point parser (§14). Formats 0–5 (no LAZ — compressed
 *  LAS is explicitly unsupported). Pure function, worker-safe. Positions are
 *  factual dataset coordinates (scale/offset applied); the import flow frames
 *  the camera on bounds instead of parser-side recentering. */
import { VpDataError } from "../../errors";
import { boundsFromPositions, type Bounds3D } from "../../bounds";
import type { FieldDefinition, ScalarType } from "../../metadata";

export const MAX_LAS_POINTS = 400_000; // allocation guard (§113)

export interface LasHeaderInfo {
  versionMajor: number;
  versionMinor: number;
  pointFormat: number; // 0–5, compression bit stripped
  compressed: boolean;
  recordLength: number;
  pointCount: number;
  scale: [number, number, number];
  offset: [number, number, number];
  headerBounds: Bounds3D | null;
  legacyCount: number;
  numVlrs: number;
}

export interface ParsedLas {
  pointCount: number;
  /** §87–88: geospatial LAS coordinates stay Float64 through decode —
   *  scale/offset in doubles; Float32 happens only after origin subtraction. */
  positions: Float64Array;
  intensity: Float32Array; // normalized 0..1
  colors: Uint8Array | null; // RGB, formats 2/3/5
  classification: Uint8Array | null; // formats 0/1/4
  header: LasHeaderInfo;
}

function recordLengthFor(fmt: number, headerValue: number): number {
  // Fallback layout when the header record length is missing/zero: the
  // mandated minimum per format.
  const base = 20;
  if (headerValue >= base) return headerValue;
  switch (fmt) {
    case 1: return base + 8;           // + GPS time
    case 2: return base + 6;           // + RGB
    case 3: return base + 8 + 6;       // + GPS + RGB
    case 4: return base + 8 + 29;      // + GPS + waveform
    case 5: return base + 8 + 6 + 29;  // + GPS + RGB + waveform
    default: return base;
  }
}

export function readLasHeader(buf: ArrayBuffer): LasHeaderInfo {
  if (buf.byteLength < 227) {
    throw new VpDataError("invalid-data", "Not a valid LAS file: header too short.", {
      detail: `${buf.byteLength} bytes < 227`,
    });
  }
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== "LASF") {
    throw new VpDataError("invalid-data", "Not a valid LAS file: missing LASF signature.", {
      detail: `magic ${JSON.stringify(magic)}`,
    });
  }
  const versionMajor = dv.getUint8(24);
  const versionMinor = dv.getUint8(25);
  const rawFmt = dv.getUint8(106);
  const compressed = (rawFmt & 0x80) !== 0;
  const pointFormat = rawFmt & 0x7f;
  if (pointFormat > 5) {
    throw new VpDataError("unsupported-format", `LAS point format ${pointFormat} is not supported.`, {
      detail: "formats 0–5 are supported; compressed (LAZ) data is not",
    });
  }
  const headerRecLen = dv.getUint16(107, true);
  const legacyCount = dv.getUint32(109, true);
  let pointCount = legacyCount;
  if (buf.byteLength >= 255) {
    const hi = dv.getUint32(247 + 4, true);
    const lo = dv.getUint32(247, true);
    if (hi !== 0 || lo !== 0) {
      // u64 count (LAS 1.4) — use it only when it looks sane against file size.
      const u64 = hi * 0x100000000 + lo;
      if (u64 > 0 && u64 < Number.MAX_SAFE_INTEGER) pointCount = u64;
    }
  }
  const scale: [number, number, number] = [
    dv.getFloat64(131, true), dv.getFloat64(139, true), dv.getFloat64(147, true),
  ];
  const offset: [number, number, number] = [
    dv.getFloat64(155, true), dv.getFloat64(163, true), dv.getFloat64(171, true),
  ];
  const hasBounds = buf.byteLength >= 227 && [179, 187, 195, 203, 211, 219].every((o) => {
    const v = dv.getFloat64(o, true);
    return Number.isFinite(v);
  });
  const headerBounds: Bounds3D | null = hasBounds ? {
    min: [dv.getFloat64(179, true), dv.getFloat64(187, true), dv.getFloat64(195, true)],
    max: [dv.getFloat64(203, true), dv.getFloat64(211, true), dv.getFloat64(219, true)],
  } : null;
  return {
    versionMajor: versionMajor || 1,
    versionMinor,
    pointFormat,
    compressed,
    recordLength: recordLengthFor(pointFormat, headerRecLen),
    pointCount,
    scale: scale.every(Number.isFinite) ? scale : [0.001, 0.001, 0.001],
    offset: offset.every(Number.isFinite) ? offset : [0, 0, 0],
    headerBounds,
    legacyCount,
    numVlrs: dv.getUint32(104, true),
  };
}

export function parseLas(buf: ArrayBuffer, opts?: { maxPoints?: number }): ParsedLas {
  const header = readLasHeader(buf);
  if (header.compressed) {
    throw new VpDataError("unsupported-format", "This is LAZ (compressed LAS) data, which is not supported yet.", {
      detail: "convert to uncompressed .las",
    });
  }
  const maxPoints = Math.min(opts?.maxPoints ?? MAX_LAS_POINTS, MAX_LAS_POINTS);
  if (header.pointCount <= 0) {
    throw new VpDataError("invalid-data", "LAS header declares zero points.");
  }
  const dv = new DataView(buf);
  const start = dv.getUint32(96, true);
  if (start < 227 || start >= buf.byteLength) {
    throw new VpDataError("invalid-data", "LAS point data offset is out of bounds.", {
      detail: `offset ${start}, file ${buf.byteLength} bytes`,
    });
  }
  const available = Math.floor((buf.byteLength - start) / header.recordLength);
  if (available < header.pointCount) {
    throw new VpDataError("invalid-data", "LAS file is truncated: fewer point records than the header declares.", {
      detail: `expected ${header.pointCount}, room for ${available}`,
    });
  }
  const n = Math.min(header.pointCount, maxPoints);
  const { scale, offset: off } = header;
  const positions = new Float64Array(n * 3);
  const intensity = new Float32Array(n);
  const hasRgb = header.pointFormat === 2 || header.pointFormat === 3 || header.pointFormat === 5;
  const hasClass = header.pointFormat === 0 || header.pointFormat === 1 || header.pointFormat === 4;
  const colors = hasRgb ? new Uint8Array(n * 3) : null;
  const classification = hasClass ? new Uint8Array(n) : null;

  for (let i = 0; i < n; i++) {
    const base = start + i * header.recordLength;
    positions[i * 3] = dv.getInt32(base, true) * scale[0] + off[0];
    positions[i * 3 + 1] = dv.getInt32(base + 4, true) * scale[1] + off[1];
    positions[i * 3 + 2] = dv.getInt32(base + 8, true) * scale[2] + off[2];
    intensity[i] = dv.getUint16(base + 12, true) / 65535;
    if (colors) {
      colors[i * 3] = dv.getUint16(base + 14, true) >> 8;
      colors[i * 3 + 1] = dv.getUint16(base + 16, true) >> 8;
      colors[i * 3 + 2] = dv.getUint16(base + 18, true) >> 8;
    }
    if (classification) {
      classification[i] = dv.getUint8(base + 15) & 0x1f;
    }
  }
  return { pointCount: n, positions, intensity, colors, classification, header };
}

export const LAS_FIELDS: FieldDefinition[] = [
  { name: "x", semantic: "position", scalarType: "float64", components: 3, unit: "m" },
  { name: "intensity", semantic: "intensity", scalarType: "float32", components: 1 },
  { name: "rgb", semantic: "color", scalarType: "uint8" as ScalarType, components: 3, normalized: true },
  { name: "classification", semantic: "classification", scalarType: "uint8", components: 1 },
];

/** Metadata-only read of the fixed header — 375 bytes, no points (§66). */
export const LAS_HEADER_BYTES = 375;

/* -------------------------------------------------- VLR / CRS metadata --- */

export interface LasVlr {
  userId: string;
  recordId: number;
  data: Uint8Array;
}

/** Parse the VLR region (between the header and point data). Bounded at
 *  64 KB; truncated files simply yield fewer records. Per LAS 1.4 R13:
 *  reserved u16, user_id[16], record_id u16, description[32], length u16. */
export function readLasVlrs(buf: ArrayBuffer): LasVlr[] {
  if (buf.byteLength < 227) return [];
  const dv = new DataView(buf);
  const headerLen = dv.getUint16(94, true) || 227;
  const numVlrs = dv.getUint32(104, true);
  const pointDataOffset = dv.getUint32(96, true);
  let off = headerLen;
  const end = Math.min(pointDataOffset > 0 ? pointDataOffset : buf.byteLength, buf.byteLength);
  const vlrs: LasVlr[] = [];
  const decoder = new TextDecoder();
  for (let i = 0; i < numVlrs && off + 54 <= end; i++) {
    const userId = decoder.decode(new Uint8Array(buf, off + 2, 16)).replace(/\0[\s\S]*$/, "").trim();
    const recordId = dv.getUint16(off + 18, true);
    const dataLen = dv.getUint16(off + 20, true); // record length u16 at offset 20 (spec)
    const dataStart = off + 54;
    if (dataStart + dataLen > end) break;
    vlrs.push({ userId, recordId, data: new Uint8Array(buf.slice(dataStart, dataStart + dataLen)) });
    off = dataStart + dataLen;
  }
  return vlrs;
}

/** The OGC WKT CRS from the LASF_Projection record 2112 (LAS 1.1+ WKT VLR),
 *  or null. GeoTIFF-key records (2111/2113/2114) are intentionally not
 *  parsed in Phase 3 — documented partial support (§13–14). */
export function lasProjectionWkt(buf: ArrayBuffer): string | null {
  for (const v of readLasVlrs(buf)) {
    if (v.userId === "LASF_Projection" && v.recordId === 2112) {
      const wkt = new TextDecoder().decode(v.data).replace(/\0[\s\S]*$/, "").trim();
      if (wkt) return wkt;
    }
  }
  return null;
}

/** EPSG code embedded in a WKT1 AUTHORITY clause, if any. WKT nests
 *  AUTHORITY clauses (ellipsoid, datum, CRS) — the CRS-level authority is
 *  the LAST one, so scanning must not stop at the first (e.g. GRS 1980 =
 *  EPSG:7019 inside a UTM WKT would otherwise win). */
export function epsgFromWkt(wkt: string): string | null {
  const matches = [...wkt.matchAll(/AUTHORITY\["EPSG","(\d{4,5})"\]/gi)];
  return matches.length ? matches[matches.length - 1][1] : null;
}
