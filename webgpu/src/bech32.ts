/** Chia / BIP-350 bech32m charset (lowercase). */
export const BASE32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
export const MAX_DATA_CHARS = 58;

const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const BECH32M_CONST = 0x2bc830a3;

export function charsetIndex(ch: string): number {
  return BASE32_CHARSET.indexOf(ch);
}

export function charsetValues(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const index = charsetIndex(ch);
    if (index < 0) {
      throw new Error(`invalid base32 character '${ch}'`);
    }
    out.push(index);
  }
  return out;
}

export function convertBits(
  data: Uint8Array,
  fromBits: number,
  toBits: number,
  pad: boolean,
): number[] {
  const maxValue = (1 << toBits) - 1;
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const value of data) {
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      out.push((acc >> bits) & maxValue);
    }
  }
  if (pad && bits > 0) {
    out.push((acc << (toBits - bits)) & maxValue);
  }
  return out;
}

export function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (const ch of hrp) {
    out.push(ch.charCodeAt(0) >> 5);
  }
  out.push(0);
  for (const ch of hrp) {
    out.push(ch.charCodeAt(0) & 31);
  }
  return out;
}

export function polymod(values: number[]): number {
  let chk = 1;
  for (const value of values) {
    const b = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) {
      if ((b >>> i) & 1) {
        chk ^= GENERATORS[i]!;
      }
    }
  }
  return chk >>> 0;
}

export function encodeBech32m(hrp: string, puzzleHash: Uint8Array): string {
  if (puzzleHash.length !== 32) {
    throw new Error("puzzle hash must be 32 bytes");
  }
  const data5 = convertBits(puzzleHash, 8, 5, true);
  const values = [...hrpExpand(hrp), ...data5, 0, 0, 0, 0, 0, 0];
  const mod = polymod(values) ^ BECH32M_CONST;
  const checksum: number[] = [];
  for (let i = 0; i < 6; i++) {
    checksum.push((mod >>> (5 * (5 - i))) & 31);
  }
  const chars = [...data5, ...checksum].map((v) => BASE32_CHARSET[v]).join("");
  return `${hrp}1${chars}`;
}

export function bech32DataValues(hrp: string, puzzleHash: Uint8Array): number[] {
  const data5 = convertBits(puzzleHash, 8, 5, true);
  const values = [...hrpExpand(hrp), ...data5, 0, 0, 0, 0, 0, 0];
  const checksumStart = values.length - 6;
  const mod = polymod(values) ^ BECH32M_CONST;
  for (let i = 0; i < 6; i++) {
    values[checksumStart + i] = (mod >>> (5 * (5 - i))) & 31;
  }
  return values.slice(hrp.length * 2 + 1);
}
