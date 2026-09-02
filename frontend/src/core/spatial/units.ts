/** Unit model + display formatting (§21–23). CRS native units are facts;
 *  display units are a presentation choice — never conflated. */

import type { UnitInfo } from "./reference";
import { DEGREE, METRE } from "./reference";

export type LinearUnitId = "metre" | "kilometre" | "foot" | "us-survey-foot" | "millimetre";
export type AngularUnitId = "degree" | "radian";
export type DisplayUnitId = LinearUnitId | AngularUnitId;

export const LINEAR_UNITS: Record<LinearUnitId, UnitInfo & { metresPerUnit: number }> = {
  metre: { ...METRE, metresPerUnit: 1 },
  kilometre: { category: "linear", symbol: "km", name: "kilometre", metresPerUnit: 1000 },
  foot: { category: "linear", symbol: "ft", name: "foot", metresPerUnit: 0.3048 },
  "us-survey-foot": { category: "linear", symbol: "ftUS", name: "US survey foot", metresPerUnit: 1200 / 3937 },
  millimetre: { category: "linear", symbol: "mm", name: "millimetre", metresPerUnit: 0.001 },
};

export const ANGULAR_UNITS: Record<AngularUnitId, UnitInfo & { radiansPerUnit: number }> = {
  degree: { ...DEGREE, radiansPerUnit: Math.PI / 180 },
  radian: { category: "angular", symbol: "rad", name: "radian", radiansPerUnit: 1 },
};

/** Convert a value from one linear unit to another (through metres). */
export function convertLinear(value: number, from: LinearUnitId, to: LinearUnitId): number {
  return (value * LINEAR_UNITS[from].metresPerUnit) / LINEAR_UNITS[to].metresPerUnit;
}

/** Convert an angular value (through radians). */
export function convertAngular(value: number, from: AngularUnitId, to: AngularUnitId): number {
  return (value * ANGULAR_UNITS[from].radiansPerUnit) / ANGULAR_UNITS[to].radiansPerUnit;
}

/* ------------------------------------------------------------- formatting */

export interface FormatOptions {
  /** Projected/linear: fraction digits (default 2–3 by magnitude). */
  linearDigits?: number;
  /** Geographic degrees: fraction digits (default 6 ≈ 0.1 m on the ground). */
  angularDigits?: number;
  /** Thousands separators for large linear values. */
  groupThousands?: boolean;
}

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Format a linear coordinate/measurement value with its unit (§23):
 *  683142.873 → "683,142.87 m" · geographic degrees use fixed precision. */
export function formatLinear(value: number, unit: LinearUnitId, opts?: FormatOptions): string {
  const u = LINEAR_UNITS[unit];
  const abs = Math.abs(value);
  const digits = opts?.linearDigits ?? (abs >= 10_000 ? 2 : abs >= 100 ? 3 : 3);
  let s = value.toFixed(digits);
  if (opts?.groupThousands !== false) {
    const [i, f] = s.split(".");
    s = group(i) + (f ? `.${f}` : "");
  }
  return `${s} ${u.symbol}`;
}

/** Format an angular value as decimal degrees: 31.520370° (§23; DMS later). */
export function formatAngular(value: number, opts?: FormatOptions): string {
  const digits = opts?.angularDigits ?? 6;
  return `${value.toFixed(digits)}°`;
}

/** Compact axis label for status/inspector (§24): E/N/Z vs lon/lat. */
export function axisLabels(kind: "projected" | "geographic" | "local" | "unknown"): [string, string, string] {
  if (kind === "geographic") return ["lon", "lat", "Z"];
  if (kind === "projected") return ["E", "N", "Z"];
  return ["X", "Y", "Z"];
}
