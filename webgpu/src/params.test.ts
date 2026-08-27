import { describe, expect, it } from "vitest";

import { encodeBech32m, charsetValues, MAX_DATA_CHARS } from "./bech32";
import { hexToBytes } from "./bytes";
import { expectedTrials, parseVanityParams } from "./params";

describe("params", () => {
  it("rejects an empty pattern", () => {
    expect(() => parseVanityParams("", "", "xch")).toThrow(/prefix and\/or suffix/);
  });

  it("rejects invalid charset", () => {
    expect(() => parseVanityParams("café", "", "xch")).toThrow(/invalid base32/);
  });

  it("rejects a combined pattern that is too long", () => {
    expect(() => parseVanityParams("a".repeat(30), "b".repeat(29), "xch")).toThrow(/exceeds maximum/);
    expect(MAX_DATA_CHARS).toBe(58);
  });

  it("scales difficulty with constrained length", () => {
    const params = parseVanityParams("cafe", "", "xch");
    expect(expectedTrials(params)).toBe(2 ** 20);
  });
});

describe("bech32m", () => {
  it("encodes a 32-byte puzzle hash", () => {
    const hash = hexToBytes("0b".repeat(32));
    const address = encodeBech32m("xch", hash);
    expect(address.startsWith("xch1")).toBe(true);
    expect(address.length).toBe(4 + 58);
    expect(charsetValues("qpzry9")).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
