import { describe, expect, it } from "vitest";

import { parseSizes } from "./config";

describe("parseSizes", () => {
  it("parses dimensions and prices from config string", () => {
    expect(parseSizes("1024x1024:40,1536x1024:60")).toEqual([
      { label: "1024x1024", cost: 40, width: 1024, height: 1024, displayName: "方形 1:1" },
      { label: "1536x1024", cost: 60, width: 1536, height: 1024, displayName: "横版 4:3" },
    ]);
  });
});
