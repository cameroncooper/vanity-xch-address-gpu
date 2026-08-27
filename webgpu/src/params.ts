import { BASE32_CHARSET, MAX_DATA_CHARS } from "./bech32";

export const ALLOWED_HRPS = ["xch", "txch"] as const;
export type Hrp = (typeof ALLOWED_HRPS)[number];

export interface VanityParams {
  prefix: string | null;
  suffix: string | null;
  hrp: Hrp;
}

export function isHrp(value: string): value is Hrp {
  return (ALLOWED_HRPS as readonly string[]).includes(value);
}

export function parseVanityParams(
  prefixRaw: string,
  suffixRaw: string,
  hrpRaw: string,
): VanityParams {
  const prefix = normalizeOptional(prefixRaw);
  const suffix = normalizeOptional(suffixRaw);
  if (!isHrp(hrpRaw)) {
    throw new Error(`unsupported hrp '${hrpRaw}'; allowed: ${ALLOWED_HRPS.join(", ")}`);
  }
  if (prefix === null && suffix === null) {
    throw new Error("specify prefix and/or suffix");
  }
  const prefixLen = prefix?.length ?? 0;
  const suffixLen = suffix?.length ?? 0;
  if (prefixLen + suffixLen > MAX_DATA_CHARS) {
    throw new Error(
      `prefix + suffix length (${prefixLen} + ${suffixLen}) exceeds maximum ${MAX_DATA_CHARS}`,
    );
  }
  if (prefix !== null) {
    validateBase32(prefix, "prefix");
  }
  if (suffix !== null) {
    validateBase32(suffix, "suffix");
  }
  return { prefix, suffix, hrp: hrpRaw };
}

export function constrainedChars(params: VanityParams): number {
  return (params.prefix?.length ?? 0) + (params.suffix?.length ?? 0);
}

export function difficultyBits(params: VanityParams): number {
  return constrainedChars(params) * 5;
}

export function expectedTrials(params: VanityParams): number {
  return 2 ** difficultyBits(params);
}

export function addressMatches(address: string, params: VanityParams): boolean {
  const sep = address.indexOf("1");
  if (sep < 0) {
    return false;
  }
  const data = address.slice(sep + 1);
  if (params.prefix !== null && !data.startsWith(params.prefix)) {
    return false;
  }
  if (params.suffix !== null && !address.endsWith(params.suffix)) {
    return false;
  }
  return true;
}

function normalizeOptional(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized.length === 0 ? null : normalized;
}

function validateBase32(value: string, field: string): void {
  for (const ch of value) {
    if (!BASE32_CHARSET.includes(ch)) {
      throw new Error(`${field} contains invalid base32 character '${ch}'`);
    }
  }
}
