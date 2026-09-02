/** PCD point-cloud parser (§16). ascii + binary; binary_compressed is
 *  rejected with a structured error (§33). Header fields (FIELDS/SIZE/TYPE/
 *  COUNT) drive the record layout — no blind x y z assumptions. Pure
 *  function, worker-safe. */
import { VpDataError } from "../../errors";

export const MAX_PCD_POINTS = 400_000; // allocation guard (§113)

export interface PcdHeader {
  fields: string[];
  sizes: number[];
  types: string[];
  counts: number[];
  pointCount: number;
  encoding: "ascii" | "binary" | "binary_compressed";
  bodyOffset: number;
  pointStride: number;
}

export interface ParsedPcd {
  pointCount: number;
  positions: Float32Array;
  intensity: Float32Array;
  colors: Uint8Array | null;
  header: PcdHeader;
}

export function readPcdHeader(buf: ArrayBuffer): PcdHeader {
  const text = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 16 * 1024)));
  const lines = text.split(/\r?\n/);
  let bodyOffset = 0;
  let fields: string[] = [];
  let sizes: number[] = [];
  let types: string[] = [];
  let counts: number[] = [];
  let width = 0, height = 0, points = 0;
  let encoding: PcdHeader["encoding"] | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    const sp = line.indexOf(" ");
    const key = sp === -1 ? line : line.slice(0, sp);
    const rest = sp === -1 ? "" : line.slice(sp + 1).trim();
    switch (key) {
      case "FIELDS": fields = rest.split(/\s+/); break;
      case "SIZE": sizes = rest.split(/\s+/).map(Number); break;
      case "TYPE": types = rest.split(/\s+/); break;
      case "COUNT": counts = rest.split(/\s+/).map(Number); break;
      case "WIDTH": width = parseInt(rest, 10); break;
      case "HEIGHT": height = parseInt(rest, 10); break;
      case "POINTS": points = parseInt(rest, 10); break;
      case "VIEWPOINT": break;
      case "DATA":
        encoding = rest as PcdHeader["encoding"];
        // Body starts after this line's newline (ascii offset within `text`
        // is exact because header lines are 1-byte chars up to here).
        bodyOffset = Buffer_byteOffset(text, i);
        break;
    }
    if (encoding) break;
  }
  if (!encoding || !fields.length) {
    throw new VpDataError("invalid-data", "Not a valid PCD: no DATA line / FIELDS found.", {
      detail: `encoding=${String(encoding)}, fields=${fields.length}`,
    });
  }
  if (!sizes.length) sizes = fields.map(() => 4);
  if (!types.length) types = fields.map(() => "F");
  if (!counts.length) counts = fields.map(() => 1);
  const pointCount = height > 1 ? width * height : (points || width);
  const pointStride = sizes.reduce((s, size, i) => s + size * (counts[i] ?? 1), 0);
  if (pointCount <= 0) throw new VpDataError("invalid-data", "PCD header declares zero points.");
  return { fields, sizes, types, counts, pointCount, encoding, bodyOffset, pointStride };
}

/** Byte offset of the line AFTER line index `lineIndex` in a header-ascii buffer. */
function Buffer_byteOffset(text: string, lineIndex: number): number {
  let off = 0;
  for (let i = 0; i <= lineIndex; i++) {
    const nl = text.indexOf("\n", off);
    if (nl === -1) return off;
    off = nl + 1;
  }
  return off;
}

export function parsePcd(buf: ArrayBuffer, opts?: { maxPoints?: number }): ParsedPcd {
  const header = readPcdHeader(buf);
  if (header.encoding === "binary_compressed") {
    throw new VpDataError("unsupported-format", "This PCD uses binary_compressed encoding, which is not supported.", {
      detail: "re-export with DATA binary or DATA ascii",
      context: { format: "pcd", encoding: "binary_compressed" },
    });
  }
  const maxPoints = Math.min(opts?.maxPoints ?? MAX_PCD_POINTS, MAX_PCD_POINTS);
  const n = Math.min(header.pointCount, maxPoints);

  const xi = header.fields.indexOf("x");
  const yi = header.fields.indexOf("y");
  const zi = header.fields.indexOf("z");
  if (xi < 0 || yi < 0 || zi < 0) {
    throw new VpDataError("unsupported-format", "PCD has no x/y/z fields — not a point cloud.", {
      detail: `fields: ${header.fields.join(", ")}`,
    });
  }
  const floatField = (i: number) => header.types[i] === "F" && header.sizes[i] === 4 && (header.counts[i] ?? 1) === 1;
  if (!floatField(xi) || !floatField(yi) || !floatField(zi)) {
    throw new VpDataError("unsupported-format", "PCD x/y/z must be single 32-bit floats.", {
      detail: header.fields.map((f, i) => `${f}:${header.types[i]}${header.sizes[i]}`).join(" "),
    });
  }
  const ii = header.fields.indexOf("intensity");
  const ri = header.fields.indexOf("r");
  const gi = header.fields.indexOf("g");
  const bi = header.fields.indexOf("b");

  const positions = new Float32Array(n * 3);
  const intensity = new Float32Array(n);
  const colors = ri >= 0 && gi >= 0 && bi >= 0 ? new Uint8Array(n * 3) : null;

  // Per-point start offset of each named field within the record.
  const fieldOffsets = new Map<string, number>();
  const tokenOffsets = new Map<string, number>();
  {
    let cur = 0;
    let tok = 0;
    header.fields.forEach((f, i) => {
      fieldOffsets.set(f, cur);
      tokenOffsets.set(f, tok);
      cur += header.sizes[i] * (header.counts[i] ?? 1);
      tok += header.counts[i] ?? 1;
    });
  }

  if (header.encoding === "ascii") {
    const text = new TextDecoder().decode(new Uint8Array(buf, header.bodyOffset));
    const tokens = text.split(/\s+/).filter(Boolean);
    const perPoint = header.counts.reduce((s, c) => s + c, 0);
    if (tokens.length < n * perPoint) {
      throw new VpDataError("invalid-data", "PCD ascii body is truncated.", {
        detail: `${tokens.length} tokens, need ${n * perPoint}`,
      });
    }
    const tokOf = (field: string) => tokenOffsets.get(field) ?? 0;
    for (let i = 0; i < n; i++) {
      const t = i * perPoint;
      positions[i * 3] = Number(tokens[t + tokOf("x")]);
      positions[i * 3 + 1] = Number(tokens[t + tokOf("y")]);
      positions[i * 3 + 2] = Number(tokens[t + tokOf("z")]);
      if (ii >= 0) {
        const v = Number(tokens[t + tokOf("intensity")]);
        intensity[i] = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5;
      }
    }
  } else {
    const need = header.bodyOffset + n * header.pointStride;
    if (need > buf.byteLength) {
      throw new VpDataError("invalid-data", "PCD binary body is truncated.", {
        detail: `need ${need} bytes, have ${buf.byteLength}`,
      });
    }
    const dv = new DataView(buf, header.bodyOffset);
    const readF32 = (i: number, field: string) =>
      dv.getFloat32(i * header.pointStride + (fieldOffsets.get(field) ?? 0), true);
    const readU8 = (i: number, field: string) =>
      dv.getUint8(i * header.pointStride + (fieldOffsets.get(field) ?? 0));
    for (let i = 0; i < n; i++) {
      positions[i * 3] = readF32(i, "x");
      positions[i * 3 + 1] = readF32(i, "y");
      positions[i * 3 + 2] = readF32(i, "z");
      if (ii >= 0) {
        const off = fieldOffsets.get("intensity") ?? 0;
        const size = header.sizes[ii];
        const v = size === 4
          ? dv.getFloat32(i * header.pointStride + off, true)
          : size === 2 ? dv.getUint16(i * header.pointStride + off, true) / 65535
          : dv.getUint8(i * header.pointStride + off) / 255;
        intensity[i] = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5;
      }
      if (colors) {
        colors[i * 3] = readU8(i, "r");
        colors[i * 3 + 1] = readU8(i, "g");
        colors[i * 3 + 2] = readU8(i, "b");
      }
    }
  }
  return { pointCount: n, positions, intensity, colors, header };
}
