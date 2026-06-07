import { describe, expect, it } from "vitest";

import { buildRedeemCode } from "./redeem-codes";

describe("buildRedeemCode", () => {
  it("returns FC-prefixed uppercase codes", () => {
    const code = buildRedeemCode();
    expect(code).toMatch(/^FC-[A-F0-9]{8}-[A-F0-9]{6}$/);
  });

  it("produces sufficiently random results", () => {
    const set = new Set(Array.from({ length: 32 }, () => buildRedeemCode()));
    expect(set.size).toBe(32);
  });
});
