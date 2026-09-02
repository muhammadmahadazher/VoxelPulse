/** PLY point parser (§15). ascii + binary_little_endian + binary_big_endian.
 *  Vertex schema is read from the header (arbitrary float/uchar layouts with
 *  x/y/z); schemas that clearly are not point clouds (no vertex element / no
 *  x y z) are rejected with structured errors. Pure function, worker-safe. */
import { VpDataError } from "../../errors";
import type { Bounds3D } from "../../bounds";

export const MAX_PLY_POINTS = 400_000; // allocation guard (§113)

export type PlyScalarType =
  | "float" | "float32" | "double" | "float64"
  | "char" | "int8" | "uchar" | "uint8"
  | "short" | "int16" | "ushort" | "uint16"
  | "int" | "int32" | "uint" | "uint32";

export interface PlyProperty {
  name: string;
  type: PlyScalarType;
  offset: number;
  size: number;
}

export interface PlyHeader {
  encoding: "ascii" | "binary_little_endian" | "binary_big_endian";
  vertexCount: number;
  vertexProperties: PlyProperty[];
  vertexStride: number;
  bodyOffset: number;
  otherElements: string[];
}

export interface ParsedPly {
  pointCount: number;
  positions: Float32Array;
  intensity: Float32Array;
  colors: Uint8Array | null;
}

const TYPE_SIZES: Record<string, number> = {
  float: 4, float32: 4, double: 8, float64: 8,
  char: 1, int8: 1, uchar: 1, uint8: 1,
  short: 2, int16: 2, ushort: 2, uint16: 2,
  int: 4, int32: 4, uint: 4, uint32: 4,
};

export function readPlyHeader(buf: ArrayBuffer): PlyHeader {
  const bytes = new Uint8Array(buf, 0, Math.min(buf.byteLength, 256 * 1024));
  const marker = new TextEncoder().encode("end_header");
  let headerEnd = -1;
  outer: for (let i = 0; i <= bytes.length - marker.length; i++) {
    for (let j = 0; j < marker.length; j++) {
      if (bytes[i + j] !== marker[j]) continue outer;
    }
    headerEnd = i + marker.length;
    break;
  }
  if (headerEnd === -1) {
    throw new VpDataError("invalid-data", "Not a valid PLY: no end_header found.", {
      detail: "header never terminates",
    });
  }
  // Consume the single newline (or CRLF) after end_header.
  if (bytes[headerEnd] === 0x0d) headerEnd++;
  if (bytes[headerEnd] === 0x0a) headerEnd++;

  const headerText = new TextDecoder().decode(bytes.slice(0, headerEnd));
  const lines = headerText.split(/\r?\n/);
  if (lines[0]?.trim() !== "ply") {
    throw new VpDataError("invalid-data", "Not a valid PLY: missing 'ply' magic.");
  }
  let encoding: PlyHeader["encoding"] | null = null;
  let vertexCount = 0;
  let inVertex = false;
  const vertexProperties: PlyProperty[] = [];
  const otherElements: string[] = [];
  let offsetCursor = 0;

  for (const line of lines.slice(1)) {
    const parts = line.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    switch (parts[0]) {
      case "format":
        encoding = parts[1] as PlyHeader["encoding"];
        break;
      case "comment":
      case "obj_info":
        break;
      case "element":
        inVertex = parts[1] === "vertex";
        if (!inVertex) otherElements.push(parts[1]);
        if (inVertex) vertexCount = parseInt(parts[2], 10);
        break;
      case "property": {
        if (!inVertex) break;
        const type = parts[1];
        // List properties (e.g. "property list uchar int vertex_indices")
        // make this element non-point data; reject below.
        if (type === "list") {
          throw new VpDataError("unsupported-format", "This PLY vertex element contains list properties (mesh data).", {
            detail: line.trim(),
          });
        }
        const size = TYPE_SIZES[type];
        if (!size) {
          throw new VpDataError("unsupported-format", `Unknown PLY property type "${type}".`);
        }
        vertexProperties.push({ name: parts[2], type: type as PlyProperty["type"], offset: offsetCursor, size });
        offsetCursor += size;
        break;
      }
    }
  }
  if (!encoding) throw new VpDataError("invalid-data", "PLY header has no format line.");
  if (!vertexProperties.length || vertexCount <= 0) {
    throw new VpDataError("invalid-data", "PLY has no vertex element with properties.", {
      detail: `elements: ${["vertex", ...otherElements].join(", ") || "none"}`,
    });
  }
  const names = vertexProperties.map((p) => p.name);
  if (!names.includes("x") || !names.includes("y") || !names.includes("z")) {
    throw new VpDataError("unsupported-format", "This PLY has no x/y/z vertex properties — not a point cloud.", {
      detail: `properties: ${names.join(", ")}`,
    });
  }
  return {
    encoding,
    vertexCount,
    vertexProperties,
    vertexStride: offsetCursor,
    bodyOffset: headerEnd,
    otherElements,
  };
}

export function parsePly(buf: ArrayBuffer, opts?: { maxPoints?: number }): ParsedPly {
  const header = readPlyHeader(buf);
  const maxPoints = Math.min(opts?.maxPoints ?? MAX_PLY_POINTS, MAX_PLY_POINTS);
  const n = Math.min(header.vertexCount, maxPoints);
  const props = header.vertexProperties;
  const find = (name: string) => props.find((p) => p.name === name);

  const px = find("x")!, py = find("y")!, pz = find("z")!;
  const pIntensity = find("intensity") ?? find("i");
  const intensityScale = pIntensity && pIntensity.size === 1 ? 1 / 255 : 1; // uchar → 0..1
  const pr = find("red"); const pg = find("green"); const pb = find("blue");

  const positions = new Float32Array(n * 3);
  const intensity = new Float32Array(n);
  const colors = pr && pg && pb ? new Uint8Array(n * 3) : null;
  const le = header.encoding !== "binary_big_endian";

  const readScalar = (dv: DataView, p: PlyProperty, base: number): number => {
    switch (p.type) {
      case "float": case "float32": return dv.getFloat32(base + p.offset, le);
      case "double": case "float64": return dv.getFloat64(base + p.offset, le);
      case "uchar": case "uint8": return dv.getUint8(base + p.offset);
      case "char": case "int8": return dv.getInt8(base + p.offset);
      case "ushort": case "uint16": return dv.getUint16(base + p.offset, le);
      case "short": case "int16": return dv.getInt16(base + p.offset, le);
      case "uint": case "uint32": return dv.getUint32(base + p.offset, le);
      case "int": case "int32": return dv.getInt32(base + p.offset, le);
      default: return NaN;
    }
  };

  if (header.encoding === "ascii") {
    const text = new TextDecoder().decode(new Uint8Array(buf, header.bodyOffset));
    const tokens = text.split(/\s+/).filter(Boolean);
    if (tokens.length < header.vertexCount * props.length) {
      throw new VpDataError("invalid-data", "PLY ascii body is truncated.", {
        detail: `${tokens.length} tokens, need ${header.vertexCount * props.length}`,
      });
    }
    for (let i = 0; i < n; i++) {
      const t = i * props.length;
      positions[i * 3] = readAscii(props.indexOf(px), t, tokens);
      positions[i * 3 + 1] = readAscii(props.indexOf(py), t, tokens);
      positions[i * 3 + 2] = readAscii(props.indexOf(pz), t, tokens);
      if (pIntensity) intensity[i] = clamp01(readAscii(props.indexOf(pIntensity), t, tokens) * intensityScale);
      if (colors) {
        colors[i * 3] = readAscii(props.indexOf(pr!), t, tokens);
        colors[i * 3 + 1] = readAscii(props.indexOf(pg!), t, tokens);
        colors[i * 3 + 2] = readAscii(props.indexOf(pb!), t, tokens);
      }
    }
  } else {
    const need = header.bodyOffset + header.vertexCount * header.vertexStride;
    if (need > buf.byteLength) {
      throw new VpDataError("invalid-data", "PLY binary body is truncated.", {
        detail: `need ${need} bytes, have ${buf.byteLength}`,
      });
    }
    const dv = new DataView(buf, header.bodyOffset);
    const ix = props.indexOf(px), iy = props.indexOf(py), iz = props.indexOf(pz);
    const ii = pIntensity ? props.indexOf(pIntensity) : -1;
    const ir = pr ? props.indexOf(pr) : -1;
    const ig = pg ? props.indexOf(pg) : -1;
    const ib = pb ? props.indexOf(pb) : -1;
    for (let i = 0; i < n; i++) {
      const base = i * header.vertexStride;
      positions[i * 3] = readScalar(dv, px, base);
      positions[i * 3 + 1] = readScalar(dv, py, base);
      positions[i * 3 + 2] = readScalar(dv, pz, base);
      if (ii >= 0) intensity[i] = clamp01(readScalar(dv, props[ii], base) * intensityScale);
      if (colors) {
        colors[i * 3] = readScalar(dv, props[ir!], base);
        colors[i * 3 + 1] = readScalar(dv, props[ig!], base);
        colors[i * 3 + 2] = readScalar(dv, props[ib!], base);
      }
    }
  }
  return { pointCount: n, positions, intensity, colors };
}

function readAscii(propIndex: number, tokenBase: number, tokens: string[]): number {
  return Number(tokens[tokenBase + propIndex]);
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5;
}
