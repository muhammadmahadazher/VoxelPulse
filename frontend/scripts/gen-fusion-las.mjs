/** CP9 fixture: a georeferenced LiDAR block ON the dem-f32 surface —
 *  deterministic points at (E 500050..500290, N 3999750..3999950) with
 *  z = DEM elevation formula + 2 m (above-ground). EPSG:32643 WKT VLR.
 *  Run: node scripts/gen-fusion-las.mjs */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures", "fusion.las");

/** The dem-f32 fixture's elevation formula (r = (4000000 − N)/10). */
function demZ(e, n) {
  const c = (e - 500000) / 10;
  const r = (4000000 - n) / 10;
  return 200 + 50 * Math.sin(c / 8) + 30 * Math.cos(r / 6) + c * 0.5;
}

const pts = [];
for (let j = 0; j < 24; j++) {
  for (let i = 2; i < 26; i++) {
    const e = 500050 + i * 10;
    const n = 3999950 - j * 10;
    pts.push([e, n, demZ(e, n) + 2.0, 200]);
  }
}

const scale = [0.001, 0.001, 0.001];
const offset = [500000, 3999000, 0];
const wkt = 'PROJCS["WGS 84 / UTM zone 43N",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",75],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",0],UNIT["metre",1],AUTHORITY["EPSG","32643"]]';
const wktBytes = Buffer.from(wkt + "\0", "utf8");
const vlrLen = wktBytes.length + (wktBytes.length % 2);
const headerSize = 227;
const vlr = Buffer.alloc(54 + vlrLen);
vlr.writeUInt16LE(0, 0);
vlr.write("LASF_Projection", 2, "ascii");
vlr.writeUInt16LE(2112, 18);
vlr.write("Fusion block fixture", 20, "ascii");
vlr.writeUInt16LE(wktBytes.length, 20); // record length u16 @20 (LAS spec)
wktBytes.copy(vlr, 54);

const n = pts.length;
const recordLength = 20;
const buf = Buffer.alloc(headerSize + vlr.length + n * recordLength);
buf.write("LASF", 0, "ascii");
buf.writeUInt8(1, 24);
buf.writeUInt8(2, 25);
buf.writeUInt16LE(headerSize, 94);
buf.writeUInt32LE(headerSize + vlr.length, 96);
buf.writeUInt32LE(1, 104);
buf.writeUInt8(0, 106);
buf.writeUInt16LE(recordLength, 107);
buf.writeUInt32LE(n, 109);
for (let k = 0; k < 3; k++) buf.writeDoubleLE(scale[k], 131 + 8 * k);
for (let k = 0; k < 3; k++) buf.writeDoubleLE(offset[k], 155 + 8 * k);
const es = pts.map((p) => p[0]), ns = pts, zs = pts.map((p) => p[2]);
const nArr = ns.map((p) => p[1]);
buf.writeDoubleLE(Math.min(...es), 179);
buf.writeDoubleLE(Math.min(...nArr), 187);
buf.writeDoubleLE(Math.min(...zs), 195);
buf.writeDoubleLE(Math.max(...es), 203);
buf.writeDoubleLE(Math.max(...nArr), 211);
buf.writeDoubleLE(Math.max(...zs), 219);
vlr.copy(buf, headerSize);
pts.forEach((p, i) => {
  const base = headerSize + vlr.length + i * recordLength;
  buf.writeInt32LE(Math.round((p[0] - offset[0]) / scale[0]), base);
  buf.writeInt32LE(Math.round((p[1] - offset[1]) / scale[1]), base + 4);
  buf.writeInt32LE(Math.round((p[2] - offset[2]) / scale[2]), base + 8);
  buf.writeUInt16LE(200, base + 12);
});
writeFileSync(OUT, buf);
console.log("wrote", OUT, n, "points");
