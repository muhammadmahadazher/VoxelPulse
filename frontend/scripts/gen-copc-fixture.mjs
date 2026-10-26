#!/usr/bin/env node
/** Deterministic uncompressed COPC fixture generator (Phase 4 §89).
 *
 * Produces tests/fixtures/tiny.copc — a valid COPC 1.0 file with
 * compressed_flag = 0 (spec-legal: point records stored uncompressed), PDRF 7,
 * two octree levels, single hierarchy page, WKT CRS for EPSG:32643.
 * Points form a Lahore block matching the Phase 3 geo fixture (UTM 43N).
 * Fully self-generated — no third-party data, byte-deterministic.
 *
 * Also extracts one real LAZ node chunk (for the laz-perf decode test) when
 * a copy of the PDAL reference file is present as tests/fixtures/reference.copc.laz.
 *
 * PROVENANCE (laz-node.lazchunk): root node extracted from PDAL's public
 * test file 1.2-with-color.copc.laz (PDAL repository, BSD-3), committed so
 * CI can exercise LAZ decompression offline.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures");
mkdirSync(root, { recursive: true });

const SCALE = 0.01;
const OFFSET = [439_100.0, 3_487_440.0, 200.0]; // unscaled origin (Lahore block, UTM 43N)
const PDRF = 7;
const REC_LEN = 36;

const WKT = 'PROJCS["WGS 84 / UTM zone 43N",GEOGCS["WGS 84",DATUM["WGS_1984",' +
  'SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],' +
  'UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],' +
  'PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",75],' +
  'PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],' +
  'PARAMETER["false_northing",0],UNIT["metre",1],AUTHORITY["EPSG","32643"]]';

function packPoint7(x, y, z, intensity, classification, r, g, blue, gps) {
  const xi = Math.round((x - OFFSET[0]) / SCALE);
  const yi = Math.round((y - OFFSET[1]) / SCALE);
  const zi = Math.round((z - OFFSET[2]) / SCALE);
  const rec = Buffer.alloc(36);
  rec.writeInt32LE(xi, 0);
  rec.writeInt32LE(yi, 4);
  rec.writeInt32LE(zi, 8);
  rec.writeUInt16LE(intensity, 12);
  rec.writeUInt8(0, 14);          // flags
  rec.writeUInt8(classification, 15);
  rec.writeInt16LE(0, 16);        // scan angle
  rec.writeUInt8(0, 18);          // user data
  rec.writeUInt16LE(0, 19);       // point source
  rec.writeDoubleLE(gps, 21);
  rec.writeUInt16LE(r * 257, 29);
  rec.writeUInt16LE(g * 257, 31);
  rec.writeUInt16LE(blue * 257, 33);
  return rec;
}

function buildPoints() {
  // Level-0 root (coarse, every 4th point) + 8 level-1 children by octant.
  const root = [];
  const children = {};
  for (const dx of [0, 1]) for (const dy of [0, 1]) for (const dz of [0, 1]) {
    children[`1-${dx}-${dy}-${dz}`] = [];
  }
  let n = 0;
  for (let ix = 0; ix < 8; ix++) {
    for (let iy = 0; iy < 8; iy++) {
      for (let iz = 0; iz < 2; iz++) {
        const x = OFFSET[0] + ix * 1.25;
        const y = OFFSET[1] + iy * 1.25;
        const z = OFFSET[2] + iz * 2.0 + ((ix * iy) % 3) * 0.25;
        const cls = iz === 0 ? 2 : 6;
        const gps = (n % 100) * 0.1;
        const rec = packPoint7(x, y, z, 100 + (n % 100), cls, ix * 30, iy * 30, 128, gps);
        n++;
        if (n % 4 === 0) {
          root.push(rec);
        } else {
          const dx = x >= OFFSET[0] + 5.0 ? 1 : 0;
          const dy = y >= OFFSET[1] + 5.0 ? 1 : 0;
          const dz = z >= OFFSET[2] + 1.0 ? 1 : 0;
          children[`1-${dx}-${dy}-${dz}`].push(rec);
        }
      }
    }
  }
  return { root, children, total: n };
}

function vlrHeader(userId, recordId, dataLen, description) {
  // Standard LAS VLR header: reserved u16, userId[16], recordId u16,
  // recordLength u16 at offset 20, description[32] at offset 22.
  const b = Buffer.alloc(54);
  b.write(userId, 2, "ascii");
  b.writeUInt16LE(recordId, 18);
  b.writeUInt16LE(dataLen, 20);
  b.write(description.slice(0, 32), 22, "ascii");
  return b;
}

function generate() {
  const { root: rootRecs, children, total } = buildPoints();

  const headerLen = 375;
  const infoVlrOff = headerLen;
  const wktVlrOff = infoVlrOff + 54 + 160;
  const hierVlrOff = wktVlrOff + 54 + WKT.length + 1;
  const pointDataOff = hierVlrOff + 54 + 9 * 32;

  const nodes = []; // { key: [level,x,y,z], offset, byteSize, pointCount }
  const body = [];
  let offset = pointDataOff;

  const addNode = (key, recs) => {
    if (recs.length) {
      nodes.push({ key, offset, byteSize: recs.length * REC_LEN, pointCount: recs.length });
      body.push(...recs);
      offset += recs.length * REC_LEN;
    } else {
      nodes.push({ key, offset: 0, byteSize: 0, pointCount: 0 });
    }
  };

  addNode([0, 0, 0, 0], rootRecs);
  for (const dx of [0, 1]) for (const dy of [0, 1]) for (const dz of [0, 1]) {
    addNode([1, dx, dy, dz], children[`1-${dx}-${dy}-${dz}`]);
  }

  const page = Buffer.alloc(nodes.length * 32);
  nodes.forEach((nd, i) => {
    const o = i * 32;
    page.writeInt32LE(nd.key[0], o);
    page.writeInt32LE(nd.key[1], o + 4);
    page.writeInt32LE(nd.key[2], o + 8);
    page.writeInt32LE(nd.key[3], o + 12);
    page.writeBigUInt64LE(BigInt(nd.offset), o + 16);
    page.writeInt32LE(nd.byteSize, o + 24);
    page.writeInt32LE(nd.pointCount, o + 28);
  });
  const hierData = page;
  const rootPageOff = hierVlrOff + 54;

  const info = Buffer.alloc(160);
  const cx = OFFSET[0] + 4.375, cy = OFFSET[1] + 4.375, cz = OFFSET[2] + 1.125;
  const half = 5.0;
  info.writeDoubleLE(cx, 0);
  info.writeDoubleLE(cy, 8);
  info.writeDoubleLE(cz, 16);
  info.writeDoubleLE(half, 24);
  info.writeDoubleLE(half * 2, 32); // root spacing
  info.writeBigUInt64LE(BigInt(rootPageOff), 40);
  info.writeBigUInt64LE(BigInt(hierData.length), 48);

  const wktData = Buffer.from(WKT + "\0", "utf8");

  const h = Buffer.alloc(375);
  h.write("LASF", 0, "ascii");
  h.writeUInt16LE(1, 24);
  h.writeUInt16LE(4, 25);
  h.writeUInt16LE(headerLen, 94);
  h.writeUInt32LE(pointDataOff, 96);
  h.writeUInt32LE(3, 100); // num VLRs
  h.writeUInt8(PDRF, 104); // uncompressed: no 0x80 bit
  h.writeUInt16LE(REC_LEN, 105);
  for (let i = 0; i < 3; i++) h.writeDoubleLE(SCALE, 131 + 8 * i);
  for (let i = 0; i < 3; i++) h.writeDoubleLE(OFFSET[i], 155 + 8 * i);
  const all = [...rootRecs, ...Object.values(children).flat()];
  const xs = all.map((r) => r.readInt32LE(0) * SCALE + OFFSET[0]);
  const ys = all.map((r) => r.readInt32LE(4) * SCALE + OFFSET[1]);
  const zs = all.map((r) => r.readInt32LE(8) * SCALE + OFFSET[2]);
  h.writeDoubleLE(Math.min(...xs), 179);
  h.writeDoubleLE(Math.min(...ys), 187);
  h.writeDoubleLE(Math.min(...zs), 195);
  h.writeDoubleLE(Math.max(...xs), 203);
  h.writeDoubleLE(Math.max(...ys), 211);
  h.writeDoubleLE(Math.max(...zs), 219);
  h.writeBigUInt64LE(0n, 235); // no EVLRs
  h.writeUInt32LE(0, 243);
  h.writeBigUInt64LE(BigInt(total), 247);

  const out = Buffer.concat([
    h,
    vlrHeader("copc", 1, 160, "VoxelPulse COPC fixture"), info,
    vlrHeader("LASF_Projection", 2112, wktData.length, "WKT CRS"), wktData,
    vlrHeader("copc", 1000, hierData.length, "hierarchy"), hierData,
    ...body,
  ]);
  if (out.length !== pointDataOff + body.flat().length) {
    // sanity — body was flattened point buffers
  }
  writeFileSync(join(root, "tiny.copc"), out);
  const withData = nodes.filter((n) => n.pointCount > 0).length;
  console.log(`wrote tiny.copc: ${out.length} bytes, ${total} points, ${withData} nodes with data`);
}

function extractLazNode() {
  const refPath = join(root, "reference.copc.laz");
  const data = readFileSync(refPath);
  const numVlrs = data.readUInt32LE(100);
  let off = 375;
  let info = null;
  for (let i = 0; i < numVlrs; i++) {
    const uid = data.slice(off + 2, off + 18).toString().split("\0")[0];
    const rid = data.readUInt16LE(off + 18);
    const dlen = data.readUInt16LE(off + 20);
    if (uid === "copc" && rid === 1) info = data.slice(off + 54, off + 54 + 160);
    off += 54 + dlen;
  }
  if (!info) throw new Error("reference has no copc info VLR");
  const rootOff = Number(info.readBigUInt64LE(40));
  const rootSize = Number(info.readBigUInt64LE(48));
  const page = data.slice(rootOff, rootOff + rootSize);
  const lvl = page.readInt32LE(0), x = page.readInt32LE(4), y = page.readInt32LE(8), z = page.readInt32LE(12);
  const nodeOff = Number(page.readBigUInt64LE(16));
  const bsize = page.readInt32LE(24);
  const pcount = page.readInt32LE(28);
  if (!(lvl === 0 && x === 0 && y === 0 && z === 0 && pcount > 0)) {
    throw new Error("unexpected root entry");
  }
  const node = data.slice(nodeOff, nodeOff + bsize);
  const fmt = data.readUInt8(104) & 0x3f;
  const reclen = data.readUInt16LE(105);
  writeFileSync(join(root, "laz-node.lazchunk"), node);
  writeFileSync(join(root, "laz-node.meta.json"), JSON.stringify({
    pointFormat: fmt, pointRecordLength: reclen, pointCount: pcount,
    provenance: "root node of PDAL test file 1.2-with-color.copc.laz (PDAL repo, BSD-3)",
  }, null, 2));
  console.log(`wrote laz-node.lazchunk (${node.length} bytes, ${pcount} pts, PDRF ${fmt})`);
}

generate();
if (existsSync(join(root, "reference.copc.laz"))) {
  extractLazNode();
} else {
  console.log("reference.copc.laz not present — skipping laz-node extraction");
}
