/** Spatial reference model (§2–4, §11–12). A resolved, normalized description
 *  of a coordinate reference system. LOCAL and UNKNOWN are explicit values —
 *  a missing CRS is not the same as an intentional local frame (§11). */

export type SpatialReferenceKind =
  | "local" | "unknown" | "projected" | "geographic" | "geocentric";

export type UnitCategory = "linear" | "angular";

export interface UnitInfo {
  category: UnitCategory;
  /** Canonical symbol, e.g. "m", "°". */
  symbol: string;
  name: string;
}

export interface SpatialReference {
  /** Canonical id: "EPSG:32643" | "VP:LOCAL" | "VP:UNKNOWN". */
  id: string;
  kind: SpatialReferenceKind;
  authority?: string;
  code?: string;
  name?: string;
  /** proj4 definition for transformable CRS (projected/geographic). */
  projString?: string;
  horizontalUnit: UnitInfo;
  verticalUnit?: UnitInfo;
}

/** Where CRS knowledge came from (§12). Confidence is only set when the
 *  provenance is genuinely graded (inference); deterministic sources omit it. */
export type SpatialReferenceProvenance =
  | "embedded"    // read from file metadata (LAS WKT VLR, …)
  | "user"        // assigned by the user (assignment ≠ reprojection, §15)
  | "project"     // inherited from the project default
  | "inferred"    // derived (confidence may be set)
  | "generated"   // synthetic/demo data
  | "none";       // format carries no CRS container

export interface SpatialReferenceInfo {
  reference: SpatialReference;
  source: SpatialReferenceProvenance;
  confidence?: number; // 0..1, only for graded provenance
  /** Technical detail, e.g. the raw WKT or the VLR that provided it (§78). */
  detail?: string;
}

/* ------------------------------------------------------------------ units */

export const METRE: UnitInfo = { category: "linear", symbol: "m", name: "metre" };
export const DEGREE: UnitInfo = { category: "angular", symbol: "°", name: "degree" };

/* --------------------------------------------------- canonical references */

export const LOCAL_REFERENCE: SpatialReference = Object.freeze({
  id: "VP:LOCAL",
  kind: "local",
  name: "Local coordinates",
  horizontalUnit: METRE,
});

export const UNKNOWN_REFERENCE: SpatialReference = Object.freeze({
  id: "VP:UNKNOWN",
  kind: "unknown",
  name: "Unknown spatial reference",
  horizontalUnit: METRE,
});

export const SpatialReference = {
  local: (): SpatialReference => LOCAL_REFERENCE,
  unknown: (): SpatialReference => UNKNOWN_REFERENCE,
};

export function isKnownRef(r: SpatialReference): boolean {
  return r.kind === "projected" || r.kind === "geographic" || r.kind === "geocentric";
}

/** True when two references are transform-equivalent (same authority+code,
 *  or both LOCAL / both UNKNOWN). */
export function sameReference(a: SpatialReference, b: SpatialReference): boolean {
  if (a.id === b.id) return true;
  if (a.authority && a.code && a.authority === b.authority && a.code === b.code) return true;
  return false;
}
