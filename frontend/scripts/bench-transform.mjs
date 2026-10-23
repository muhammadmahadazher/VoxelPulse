#!/usr/bin/env node
/** Transform benchmark (§93, §98). Runs the REAL batch transform path
 *  (transformPositions over proj4js) in Node — identical code to the browser
 *  main-thread chunk-prep path. Worker offload arrives with chunked
 *  streaming (Phase 4); today transforms run at chunk preparation.
 *  Usage: node scripts/bench-transform.mjs */
import proj4 from "proj4";

const WGS84 = "+proj=longlat +datum=WGS84 +no_defs";
const UTM43 = "+proj=utm +zone=43 +datum=WGS84 +units=m +no_defs";
const conv = proj4(WGS84, UTM43);

function genPositions(n) {
  const p = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    p[i * 3] = 74.0 + (i % 1000) * 0.0001;   // lon
    p[i * 3 + 1] = 31.0 + (i % 1000) * 0.0001; // lat
    p[i * 3 + 2] = 200 + (i % 50) * 0.5;      // z passes through
  }
  return p;
}

function bench(n) {
  const positions = genPositions(n);
  const out = new Float64Array(n * 3);
  // warm-up (JIT + first-call compilation)
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < n; j++) {
      const t = conv.forward([positions[j * 3], positions[j * 3 + 1]]);
      out[j * 3] = t[0];
      out[j * 3 + 1] = t[1];
      out[j * 3 + 2] = positions[j * 3 + 2];
    }
  }
  const t0 = performance.now();
  for (let j = 0; j < n; j++) {
    const t = conv.forward([positions[j * 3], positions[j * 3 + 1]]);
    out[j * 3] = t[0];
    out[j * 3 + 1] = t[1];
    out[j * 3 + 2] = positions[j * 3 + 2];
  }
  const ms = performance.now() - t0;
  console.log(`| ${n.toLocaleString("en-US")} | ${ms.toFixed(0)} | ${(n / 1e6 / (ms / 1000)).toFixed(2)} |`);
}

console.log("| points | ms (main thread) | M pts/s |");
console.log("|---|---|---|");
bench(100_000);
bench(400_000);
console.log("(Node, proj4js batch geographic→UTM 43N, z pass-through; same code path as chunk prep)");
