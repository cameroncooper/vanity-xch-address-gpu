#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { bls12_381 } from "@noble/curves/bls12-381.js";

const WINDOW_BITS = 6;
const WINDOWS = Math.ceil(256 / WINDOW_BITS);
const ENTRIES = (1 << WINDOW_BITS) - 1;
const LIMBS = 12;

// Must match webgpu/src/shaders/fp.wgsl P_LIMBS (little-endian u32).
const P_LIMBS = [
  0xffffaaab, 0xb9feffff, 0xb153ffff, 0x1eabfffe, 0xf6b0f624, 0x6730d2a0, 0xf38512bf, 0x64774b84,
  0x434bacd7, 0x4b1ba7b6, 0x397fe69a, 0x1a0111ea,
];

const root = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(root, "..", "public", "g1_table.bin");

function limbsToBig(limbs) {
  let n = 0n;
  for (let i = limbs.length - 1; i >= 0; i--) {
    n = (n << 32n) + BigInt(limbs[i] >>> 0);
  }
  return n;
}

const P = limbsToBig(P_LIMBS);
const R = 1n << 384n;

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

function be48ToBig(bytes) {
  let n = 0n;
  for (const byte of bytes) {
    n = (n << 8n) + BigInt(byte);
  }
  return n;
}

function bigToLimbs(value) {
  const limbs = new Uint32Array(LIMBS);
  let n = value;
  for (let i = 0; i < LIMBS; i++) {
    limbs[i] = Number(n & 0xffffffffn);
    n >>= 32n;
  }
  return limbs;
}

function toMontLimbs(be48) {
  return bigToLimbs((be48ToBig(be48) * R) % P);
}

function writeLimbs(view, offset, limbs) {
  for (let i = 0; i < LIMBS; i++) {
    view.setUint32(offset + i * 4, limbs[i], true);
  }
}

const table = new ArrayBuffer(WINDOWS * ENTRIES * 96);
const view = new DataView(table);
let offset = 0;
const G = bls12_381.G1.Point.BASE;
G.precompute(8, false);
const ZERO = bls12_381.G1.Point.ZERO;
const ORDER = bls12_381.G1.Point.Fn.ORDER;

for (let window = 0; window < WINDOWS; window++) {
  for (let digit = 1; digit <= ENTRIES; digit++) {
    const scalar = scalarFromWindowDigit(window, digit) % ORDER;
    const point = scalar === 0n ? ZERO : G.multiply(scalar);
    const raw = uncompressed96(point);
    writeLimbs(view, offset, toMontLimbs(raw.subarray(0, 48)));
    writeLimbs(view, offset + 48, toMontLimbs(raw.subarray(48, 96)));
    offset += 96;
  }
}

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, Buffer.from(table));
console.log(
  `wrote ${table.byteLength} bytes (${WINDOWS} windows x ${ENTRIES} entries, Montgomery limbs) to ${outPath}`,
);
