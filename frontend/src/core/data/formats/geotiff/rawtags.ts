/** Minimal raw TIFF geotag reader (§9, §56). geotiff.js v3 flattens
 *  ModelTransformation through origin/resolution accessors — rotation
 *  coefficients would be silently discarded. This reader pulls the
 *  georeferencing tags straight from the IFD so the full affine (including
 *  rotation/skew) is preserved. Classic TIFF (LE+BE) + BigTIFF IFD offsets.
 *  All reads stay inside the caller-provided window. */
import type { GeoTransform } from "../../../raster/transform";

export interface RawGeoTags {
  modelPixelScale?: number[];
  modelTiepoint?: number[];
  modelTransformation?: number[];
  geoKeyDirectory?: number[];
  geoAsciiParams?: string;
}

const TYPE_SIZES: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4,
};

/** Read georeferencing tags from a TIFF buffer (must contain header + IFD). */
export function readGeoTags(buf: ArrayBuffer): RawGeoTags {
  if (buf.byteLength < 8) return {};
  const dv = new DataView(buf);
  const le = dv.getUint8(0) === 0x49;
  const magic = le ? dv.getUint16(2, true) : dv.getUint16(2, false);
  const big = magic === 43;
  const tags: RawGeoTags = {};

  const readTypedArray = (type: number, count: number, offset: number): number[] | string | undefined => {
    if (offset < 0 || offset + (TYPE_SIZES[type] ?? 1) * count > buf.byteLength) return undefined;
    switch (type) {
      case 3: { // SHORT
        const out = [];
        for (let i = 0; i < count; i++) out.push(dv.getUint16(offset + i * 2, le));
        return out;
      }
      case 4: { // LONG
        const out = [];
        for (let i = 0; i < count; i++) out.push(dv.getUint32(offset + i * 4, le));
        return out;
      }
      case 12: { // DOUBLE
        const out = [];
        for (let i = 0; i < count; i++) out.push(dv.getFloat64(offset + i * 8, le));
        return out;
      }
      case 2: { // ASCII
        return new TextDecoder().decode(new Uint8Array(buf, offset, count)).replace(/\0[\s\S]*$/, "");
      }
      default: return undefined;
    }
  };

  /** Read one IFD entry's value. `entryOffset` = entry START (tag field);
   *  the value/offset field begins at +8 (classic) / +16 (BigTIFF). */
  const readTagValue = (entryOffset: number, type: number, count: number): number[] | string | undefined => {
    const size = (TYPE_SIZES[type] ?? 1) * count;
    const valueField = entryOffset + (big ? 16 : 8);
    if (size <= (big ? 8 : 4)) {
      // value fits inline in the value/offset field
      return readTypedArray(type, count, valueField);
    }
    const off = big ? Number(dv.getBigUint64(valueField, le)) : dv.getUint32(valueField, le);
    return readTypedArray(type, count, off);
  };

  try {
    if (!big) {
      const ifdOffset = dv.getUint32(4, le);
      if (ifdOffset + 2 > buf.byteLength) return tags;
      const count = dv.getUint16(ifdOffset, le);
      if (ifdOffset + 2 + count * 12 > buf.byteLength) return tags;
      for (let i = 0; i < count; i++) {
        const e = ifdOffset + 2 + i * 12;
        const tag = dv.getUint16(e, le);
        const type = dv.getUint16(e + 2, le);
        const c = dv.getUint32(e + 4, le);
        const val = readTagValue(e, type, c);
        assignTag(tags, tag, val);
      }
    } else {
      // BigTIFF: IFD offset u64 @8, entries 20 bytes, value/offset u64 @entry+12
      const ifdOffset = Number(dv.getBigUint64(8, le));
      if (ifdOffset + 8 > buf.byteLength) return tags;
      const count = Number(dv.getBigUint64(ifdOffset, le));
      if (count > 100_000 || ifdOffset + 8 + count * 20 > buf.byteLength) return tags;
      for (let i = 0; i < count; i++) {
        const e = ifdOffset + 8 + i * 20;
        const tag = dv.getUint16(e, le);
        const type = dv.getUint16(e + 2, le);
        const c = Number(dv.getBigUint64(e + 4, le));
        const val = readTagValue(e + 8, type, c);
        assignTag(tags, tag, val);
      }
    }
  } catch {
    return tags; // partial tags are fine — validation happens later
  }
  return tags;
}

function assignTag(tags: RawGeoTags, tag: number, val: number[] | string | undefined): void {
  if (val === undefined) return;
  switch (tag) {
    case 33550: tags.modelPixelScale = val as number[]; break;
    case 33922: tags.modelTiepoint = val as number[]; break;
    case 34264: tags.modelTransformation = val as number[]; break;
    case 34735: tags.geoKeyDirectory = val as number[]; break;
    case 34737: tags.geoAsciiParams = val as string; break;
  }
}

/** Extract the affine from raw tags: ModelTransformation first, then
 *  ModelPixelScale + ModelTiepoint (GDAL convention), else undefined. */
export function geotransformFromTags(tags: RawGeoTags): GeoTransform | undefined {
  const mt = tags.modelTransformation;
  if (mt && mt.length >= 16) {
    // ModelTransformation maps (col,row,0,1) → (X,Y,Z,1): row-major
    // [a b 0 c / d e 0 f / 0 0 1 0]. geotiff stores it column-major per
    // TIFF spec — entries 0..15 = a,b,0,c? No: the TIFF spec lays it out
    // as a 4x4 row-major matrix. GDAL writes:
    // [m0 m1 0 m2? ...] — empirical: m[0]=A, m[1]=D, m[4]=B, m[5]=E, m[12]=C, m[13]=F
    return { a: mt[0], b: mt[4], c: mt[12], d: mt[1], e: mt[5], f: mt[13] };
  }
  const s = tags.modelPixelScale;
  const t = tags.modelTiepoint;
  if (s && s.length >= 3 && t && t.length >= 6) {
    // tiepoint (i,j,k) ↔ (x,y,z): pixel (i,j) is at world (x,y)
    const i = t[0], j = t[1], x = t[3], y = t[4];
    return { a: s[0], b: 0, c: x - i * s[0], d: 0, e: -Math.abs(s[1]), f: y + j * Math.abs(s[1]) };
  }
  return undefined;
}

/** CRS from GeoKeyDirectory: ProjectedCSType (3072) then GeographicType (2048). */
export function epsgFromGeoKeyDirectory(dir: number[] | undefined): string | undefined {
  if (!dir || dir.length < 8) return undefined;
  const count = dir[3];
  for (let i = 0; i < count; i++) {
    const keyId = dir[4 + i * 4];
    const value = dir[7 + i * 4];
    if (keyId === 3072 && value > 0) return `EPSG:${value}`;
  }
  for (let i = 0; i < count; i++) {
    const keyId = dir[4 + i * 4];
    const value = dir[7 + i * 4];
    if (keyId === 2048 && value > 0) return `EPSG:${value}`;
  }
  return undefined;
}
