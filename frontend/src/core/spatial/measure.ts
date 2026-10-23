/** Measurement service (§61–64): spatial math lives here, not in UI
 *  components. Euclidean for local/projected CRS; geodesic for geographic
 *  (haversine on the horizontal pair + Δz) — never naive degree hypot (§62). */
import type { SpatialReference } from "./reference";

export interface Measurement {
  /** Horizontal distance in metres (geodesic when geographic CRS). */
  horizontal: number;
  /** Elevation difference (b.z − a.z) in the CRS vertical unit. */
  dz: number;
  /** Slope in degrees when horizontal > 0. */
  slopeDeg: number;
  method: "euclidean" | "geodesic";
}

const EARTH_RADIUS_M = 6_378_137; // WGS84 semi-major (approximation, documented)

export function measurePoints(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  crs: SpatialReference,
): Measurement {
  if (crs.kind === "geographic") {
    // Haversine on x=lon, y=lat degrees (§62) — sub-degree-latitude accuracy
    // is fine for tool feedback; documented approximation, not geodesy-grade.
    const rad = Math.PI / 180;
    const φ1 = a[1] * rad, φ2 = b[1] * rad;
    const dφ = (b[1] - a[1]) * rad;
    const dλ = (b[0] - a[0]) * rad;
    const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
    const horizontal = 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
    const dz = b[2] - a[2];
    return {
      horizontal,
      dz,
      slopeDeg: horizontal > 0 ? (Math.atan2(Math.abs(dz), horizontal) * 180) / Math.PI : 0,
      method: "geodesic",
    };
  }
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const horizontal = Math.hypot(dx, dy);
  const dz = b[2] - a[2];
  return {
    horizontal,
    dz,
    slopeDeg: horizontal > 0 ? (Math.atan2(Math.abs(dz), horizontal) * 180) / Math.PI : 0,
    method: "euclidean",
  };
}
