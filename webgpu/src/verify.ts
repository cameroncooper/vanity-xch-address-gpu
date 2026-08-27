import { bls12_381 } from "@noble/curves/bls12-381.js";
import { sha256 } from "@noble/hashes/sha2.js";

import { encodeBech32m } from "./bech32";
import {
  bigIntToBytes,
  bytesToBigInt,
  bytesToHex,
  concatBytes,
  hexToBytes,
} from "./bytes";
import type { Hrp } from "./params";

export const GPU_NATIVE_DOMAIN = new TextEncoder().encode("vanity-chia-gpu-v1");

export const GROUP_ORDER = hexToBytes(
  "73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001",
);

export const NEG_TWO_256_MOD_GROUP_ORDER = hexToBytes(
  "5bc8f5f97cd877d899ad88181ce5880ffb38ec08fffb13fcfffffffd00000003",
);

export const DEFAULT_HIDDEN_PUZZLE_HASH = hexToBytes(
  "711d6c4e32c92e53179b199484cf8c897542bc57f2b22582799f9d657eec4699",
);

export const Q_KW_TREEHASH = hexToBytes(
  "9dcf97a184f32623d11a73124ceb99a5709b083721e878a16d78f596718ba7b2",
);
export const A_KW_TREEHASH = hexToBytes(
  "a12871fee210fb8619291eaea194581cbd2531e4b23759d225f6806923f63222",
);
export const C_KW_TREEHASH = hexToBytes(
  "a8d5dd63fba471ebcb1f3e8f7c1e1879b7152a6e7298a91ce119a63400ade7c5",
);
export const ONE_TREEHASH = hexToBytes(
  "9dcf97a184f32623d11a73124ceb99a5709b083721e878a16d78f596718ba7b2",
);
export const NIL_TREEHASH = hexToBytes(
  "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a",
);
export const QUOTED_MOD_HASH = hexToBytes(
  "9890a9bd1330fc3c4f4af0de8642dc31b1d525e2b18e0fde4eae079afb1b60a4",
);

export const EXPECTED_GENERATOR_COMPRESSED = hexToBytes(
  "97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb",
);

const GROUP_ORDER_N = bytesToBigInt(GROUP_ORDER);

export interface VerifiedHit {
  index: number;
  address: string;
  puzzleHash: Uint8Array;
  secretKey: Uint8Array;
  derivation: "gpu-native-nonportable";
}

export function deriveGpuNativeChildSk(
  intermediateSk: Uint8Array,
  index: number,
): Uint8Array {
  const indexBytes = new Uint8Array(4);
  new DataView(indexBytes.buffer).setUint32(0, index, false);
  const walletSk = sha256(concatBytes(GPU_NATIVE_DOMAIN, intermediateSk, indexBytes));
  reduceScalarModOrder(walletSk);
  if (walletSk.every((b) => b === 0)) {
    walletSk[31] = 1;
  }
  return walletSk;
}

export function g1CompressedFromScalar(scalar: Uint8Array): Uint8Array {
  const n = bytesToBigInt(scalar);
  if (n === 0n) {
    throw new Error("scalar must be non-zero");
  }
  const point = bls12_381.G1.Point.BASE.multiply(n);
  return point.toBytes(true);
}

export function syntheticPkFromWallet(walletPk: Uint8Array, walletSk: Uint8Array): Uint8Array {
  const offset = sha256(concatBytes(walletPk, DEFAULT_HIDDEN_PUZZLE_HASH));
  reduceSignedScalarModOrder(offset);
  const syntheticSk = addScalarsModOrder(walletSk, offset);
  return g1CompressedFromScalar(syntheticSk);
}

export function puzzleHashFromSyntheticPk(syntheticPk: Uint8Array): Uint8Array {
  const pkAtom = sha256(concatBytes(Uint8Array.of(0x01), syntheticPk));
  const quotedArg = shatreePair(Q_KW_TREEHASH, pkAtom);
  const oneNil = shatreePair(ONE_TREEHASH, NIL_TREEHASH);
  const quotedArgAndRest = shatreePair(quotedArg, oneNil);
  const curriedValues = shatreePair(C_KW_TREEHASH, quotedArgAndRest);
  const curriedNil = shatreePair(curriedValues, NIL_TREEHASH);
  const modAndArgs = shatreePair(QUOTED_MOD_HASH, curriedNil);
  return shatreePair(A_KW_TREEHASH, modAndArgs);
}

export function addressFromWalletSk(walletSk: Uint8Array, hrp: Hrp): string {
  const walletPk = g1CompressedFromScalar(walletSk);
  const syntheticPk = syntheticPkFromWallet(walletPk, walletSk);
  const puzzleHash = puzzleHashFromSyntheticPk(syntheticPk);
  return encodeBech32m(hrp, puzzleHash);
}

export function verifyGpuHit(
  intermediateSk: Uint8Array,
  index: number,
  hrp: Hrp,
  gpuPuzzleHash?: Uint8Array,
): VerifiedHit {
  const secretKey = deriveGpuNativeChildSk(intermediateSk, index);
  const walletPk = g1CompressedFromScalar(secretKey);
  const syntheticPk = syntheticPkFromWallet(walletPk, secretKey);
  const puzzleHash = puzzleHashFromSyntheticPk(syntheticPk);
  if (gpuPuzzleHash && !bytesEqualHex(puzzleHash, gpuPuzzleHash)) {
    throw new Error(
      `GPU puzzle hash mismatch at index ${index}: gpu=${bytesToHex(gpuPuzzleHash)} cpu=${bytesToHex(puzzleHash)}`,
    );
  }
  return {
    index,
    address: encodeBech32m(hrp, puzzleHash),
    puzzleHash,
    secretKey,
    derivation: "gpu-native-nonportable",
  };
}

export function generatorCompressed(): Uint8Array {
  return bls12_381.G1.Point.BASE.toBytes(true);
}

function shatreePair(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(concatBytes(Uint8Array.of(0x02), left, right));
}

function reduceScalarModOrder(scalar: Uint8Array): void {
  let value = bytesToBigInt(scalar) % GROUP_ORDER_N;
  scalar.set(bigIntToBytes(value, 32));
}

function reduceSignedScalarModOrder(scalar: Uint8Array): void {
  const negative = (scalar[0]! & 0x80) !== 0;
  reduceScalarModOrder(scalar);
  if (negative) {
    const corrected = addScalarsModOrder(scalar, NEG_TWO_256_MOD_GROUP_ORDER);
    scalar.set(corrected);
  }
}

function addScalarsModOrder(a: Uint8Array, b: Uint8Array): Uint8Array {
  const sum = (bytesToBigInt(a) + bytesToBigInt(b)) % GROUP_ORDER_N;
  return bigIntToBytes(sum, 32);
}

function bytesEqualHex(a: Uint8Array, b: Uint8Array): boolean {
  return bytesToHex(a) === bytesToHex(b);
}
