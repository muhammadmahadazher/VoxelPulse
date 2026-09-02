/** Typed dataset metadata + field/attribute model (§7–8). Common concepts are
 *  structured; format-specific values live under `formatSpecific`, never in an
 *  untyped junk drawer. */
import type { Bounds3D } from "./bounds";

export type ScalarType =
  | "float32" | "float64"
  | "uint8" | "uint16" | "uint32"
  | "int8" | "int16" | "int32";

export type FieldSemantic =
  | "position" | "color" | "intensity" | "classification"
  | "return-number" | "number-of-returns" | "gps-time" | "normal" | "custom";

export const SCALAR_BYTES: Record<ScalarType, number> = {
  float32: 4, float64: 8,
  uint8: 1, uint16: 2, uint32: 4,
  int8: 1, int16: 2, int32: 4,
};

export interface FieldDefinition {
  name: string;
  semantic?: FieldSemantic;
  scalarType: ScalarType;
  components: number;
  normalized?: boolean;
  unit?: string;
}

export interface DatasetMetadata {
  sourceName?: string;
  sourceSizeBytes?: number;

  pointCount?: number;
  bounds?: Bounds3D;

  fields?: FieldDefinition[];

  createdAt?: string;
  formatVersion?: string;

  /** Namespaced format-specific values, e.g. { las: { pointFormat: 3 } }. */
  formatSpecific?: Record<string, Record<string, unknown>>;
}

/** Estimated byte size of decoded point fields (memory accounting input). */
export function estimatePointsBytes(pointCount: number, fields: FieldDefinition[]): number {
  const stride = fields.reduce((sum, f) => sum + SCALAR_BYTES[f.scalarType] * f.components, 0);
  return pointCount * stride;
}
