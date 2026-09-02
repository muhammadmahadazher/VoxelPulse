/** Branded ID types for the spatial data engine (§70–71).
 *  Brands are compile-time only; runtime values are plain strings. */
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type DatasetId = Brand<string, "DatasetId">;
export type ChunkId = Brand<string, "ChunkId">;
export type JobId = Brand<string, "JobId">;
export type ResourceId = Brand<string, "ResourceId">;

let seq = 0;
function makeId(prefix: string): string {
  seq = (seq + 1) % 0xffff;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}-${Math.floor(Math.random() * 0xffff).toString(36)}`;
}

export const asDatasetId = (s: string) => s as DatasetId;
export const asChunkId = (s: string) => s as ChunkId;
export const asJobId = (s: string) => s as JobId;
export const asResourceId = (s: string) => s as ResourceId;

export const newDatasetId = () => asDatasetId(makeId("ds"));
export const newChunkId = () => asChunkId(makeId("chk"));
export const newJobId = () => asJobId(makeId("job"));
export const newResourceId = () => asResourceId(makeId("res"));
