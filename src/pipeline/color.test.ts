import { describe, expect, it } from "vitest";
import { rgbToLab, labToRgb, deltaE, rgbToHex } from "./color";

describe("rgb ↔ lab", () => {
  it("white round-trips", () => {
    const lab = rgbToLab([255, 255, 255]);
    expect(lab[0]).toBeCloseTo(100, 0);
    const back = labToRgb(lab);
    expect(back[0]).toBeCloseTo(255, 0);
    expect(back[1]).toBeCloseTo(255, 0);
    expect(back[2]).toBeCloseTo(255, 0);
  });

  it("black has L≈0", () => {
    const [L] = rgbToLab([0, 0, 0]);
    expect(L).toBeCloseTo(0, 1);
  });

  it("perceptual distance is non-negative and zero for identical colors", () => {
    const a = rgbToLab([200, 100, 50]);
    expect(deltaE(a, a)).toBe(0);
    expect(deltaE(rgbToLab([0, 0, 0]), rgbToLab([255, 255, 255]))).toBeGreaterThan(50);
  });
});

describe("rgbToHex", () => {
  it("formats correctly with leading zeros", () => {
    expect(rgbToHex([0, 0, 0])).toBe("#000000");
    expect(rgbToHex([255, 0, 17])).toBe("#ff0011");
  });
});
