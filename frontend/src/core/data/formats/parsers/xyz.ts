/** XYZ / delimited-text point parser (§17, §104). Conservative by design:
 *  a line must parse as at least X Y Z numbers to count, otherwise the file
 *  is rejected rather than mangled into a bogus dataset. Pure function so it
 *  can run on the main thread or inside the decode worker. */
import { VpDataError } from "../../errors";
import type { FieldDefinition } from "../../metadata";

export const MAX_XYZ_POINTS = 400_000; // allocation guard (§113)

export interface ParsedPoints {
  pointCount: number;
  positions: Float32Array;
  intensity: Float32Array;
  hasIntensityColumn: boolean;
}

const INITIAL_CAPACITY = 8_192;

export function parseXyz(text: string, opts?: { maxPoints?: number }): ParsedPoints {
  const maxPoints = Math.min(opts?.maxPoints ?? MAX_XYZ_POINTS, MAX_XYZ_POINTS);
  let positions: Float32Array = new Float32Array(INITIAL_CAPACITY * 3);
  let intensity: Float32Array = new Float32Array(INITIAL_CAPACITY);
  let n = 0;
  let linesWithCoords = 0;
  let linesTotal = 0;
  let sawFourthColumn = false;

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
    linesTotal++;
    if (linesTotal > maxPoints * 4) break; // runaway-file guard
    const parts = trimmed.split(/[\s,;]+/).filter(Boolean);
    if (parts.length < 3) continue;
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    const z = Number(parts[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    if (n >= maxPoints) break;
    linesWithCoords++;
    if (n >= positions.length / 3) {
      positions = grow(positions, 3);
      intensity = grow(intensity, 1);
    }
    positions[n * 3] = x;
    positions[n * 3 + 1] = y;
    positions[n * 3 + 2] = z;
    const i4 = parts.length > 3 ? Number(parts[3]) : NaN;
    if (parts.length > 3) sawFourthColumn = true;
    intensity[n] = Number.isFinite(i4) ? Math.min(1, Math.max(0, i4)) : 0.5;
    n++;
  }

  if (n === 0) {
    throw new VpDataError("invalid-data", "No points parsed from text file.", {
      detail: linesTotal
        ? `${linesTotal} non-empty lines, none parsed as X Y Z coordinates`
        : "file is empty",
    });
  }
  // Conservative acceptance (§17): most lines must look like coordinates.
  if (linesWithCoords / linesTotal < 0.3) {
    throw new VpDataError("invalid-data", "This text file does not look like a point table.", {
      detail: `${linesWithCoords}/${linesTotal} lines parsed as coordinates`,
    });
  }
  return {
    pointCount: n,
    positions: positions.slice(0, n * 3),
    intensity: intensity.slice(0, n),
    hasIntensityColumn: sawFourthColumn,
  };
}

function grow(arr: Float32Array, factor: number): Float32Array {
  const next = new Float32Array(arr.length * factor);
  next.set(arr);
  return next;
}

/** Field schema reported by the XYZ adapter (§8). */
export const XYZ_FIELDS: FieldDefinition[] = [
  { name: "x", semantic: "position", scalarType: "float32", components: 3, unit: "m" },
  { name: "intensity", semantic: "intensity", scalarType: "float32", components: 1 },
];
