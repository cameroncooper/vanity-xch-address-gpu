import { describe, expect, it } from "vitest";

import { bytesToHex } from "./bytes";
import { addressMatches } from "./params";
import {
  EXPECTED_GENERATOR_COMPRESSED,
  deriveGpuNativeChildSk,
  generatorCompressed,
  verifyGpuHit,
} from "./verify";

describe("cpu pipeline", () => {
  it("compresses the G1 generator like blst/CUDA", () => {
    expect(bytesToHex(generatorCompressed())).toBe(bytesToHex(EXPECTED_GENERATOR_COMPRESSED));
  });

  it("derives a stable GPU-native address", () => {
    const intermediate = new Uint8Array(32).fill(0x11);
    const sk = deriveGpuNativeChildSk(intermediate, 0);
    expect(sk.length).toBe(32);
    const hit = verifyGpuHit(intermediate, 0, "xch");
    expect(hit.address.startsWith("xch1")).toBe(true);
    expect(hit.derivation).toBe("gpu-native-nonportable");
    expect(addressMatches(hit.address, { prefix: hit.address.slice(4, 6), suffix: null, hrp: "xch" })).toBe(
      true,
    );
  });
});
