#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { bls12_381 } from "@noble/curves/bls12-381.js";

const WINDOW_BITS = 6;
const WINDOWS = Math.ceil(256 / WINDOW_BITS);
const ENTRIES = (1 << WINDOW_BITS) - 1;

const root = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(root, "..", "public", "g1_table.bin");

function scalarFromWindowDigit(window, digit) {
  let value = 0n;
  for (let bit = 0; bit < WINDOW_BITS; bit++) {
    if ((digit & (1 << bit)) !== 0) {
      const scalarBit = window * WINDOW_BITS + bit;
      if (scalarBit < 256) {
        value |= 1n << BigInt(scalarBit);
      }
    }
  }
  return value;
}

function uncompressed96(point) {
  const raw = point.toBytes(false);
  if (raw.length === 96) {
    return raw;
  }
  if (raw.length === 97 && raw[0] === 0x04) {
    return raw.slice(1);
  }
  throw new Error(`unexpected uncompressed G1 encoding length ${raw.length}`);
}

const table = new Uint8Array(WINDOWS * ENTRIES * 96);
let offset = 0;
const G = bls12_381.G1.Point.BASE;
G.precompute(8, false);
const ZERO = bls12_381.G1.Point.ZERO;
const ORDER = bls12_381.G1.Point.Fn.ORDER;

for (let window = 0; window < WINDOWS; window++) {
  for (let digit = 1; digit <= ENTRIES; digit++) {
    const scalar = scalarFromWindowDigit(window, digit) % ORDER;
    const point = scalar === 0n ? ZERO : G.multiply(scalar);
    table.set(uncompressed96(point), offset);
    offset += 96;
  }
}

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, table);
console.log(
  `wrote ${table.length} bytes (${WINDOWS} windows x ${ENTRIES} entries) to ${outPath}`,
);
