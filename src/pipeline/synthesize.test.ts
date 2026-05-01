import { describe, expect, it } from "vitest";
import { synthesize, synthesizeAll } from "./synthesize";
import type { FusedSchema } from "@/types/schema";

const sample: FusedSchema = {
  subject: { value: "smiling avocado wearing sunglasses", confidence: 0.9 },
  style: { value: "flat vector illustration", confidence: 0.85 },
  linework: { value: "thick black outlines", confidence: 0.8 },
  medium: { value: "vector", confidence: 0.95 },
  lighting: { value: "flat", confidence: 0.7 },
  mood: { value: "playful", confidence: 0.8 },
  composition: { value: "centered-isolated", confidence: 0.9 },
  aspectRatio: "1:1",
  palette: [
    { hex: "#22c55e", rgb: [34, 197, 94], lab: [70, -40, 40], weight: 0.45 },
    { hex: "#f59e0b", rgb: [245, 158, 11], lab: [70, 20, 70], weight: 0.25 },
    { hex: "#ffffff", rgb: [255, 255, 255], lab: [100, 0, 0], weight: 0.3 },
  ],
  isolated: true,
  vectorLikeness: 0.9,
  negatives: ["photo", "3d", "shading"],
  aiFingerprint: { detected: false },
};

describe("synthesize()", () => {
  it("formats Midjourney with --ar / --s / --no flags", () => {
    const p = synthesize(sample, "midjourney");
    expect(p.text).toMatch(/--ar 1:1/);
    expect(p.text).toMatch(/--s 250/);
    expect(p.text).toMatch(/--no/);
    expect(p.text).toContain("smiling avocado");
  });

  it("formats Ideogram without flags", () => {
    const p = synthesize(sample, "ideogram");
    expect(p.text).not.toMatch(/--ar/);
    expect(p.text).toContain("flat vector illustration");
  });

  it("formats Leonardo as a sentence with periods", () => {
    const p = synthesize(sample, "leonardo");
    expect(p.text.endsWith(".")).toBe(true);
    expect(p.text).toContain("Style:");
    expect(p.text).toContain("Mood:");
  });

  it("formats SDXL with weighted tags", () => {
    const p = synthesize(sample, "sdxl");
    expect(p.text).toMatch(/\([^)]+:1\.\d\)/); // weighted token
    expect(p.text).toMatch(/Negative prompt:/);
  });

  it("formats DALL·E 3 as a single sentence", () => {
    const p = synthesize(sample, "dalle3");
    expect(p.text.startsWith("Create an image of")).toBe(true);
    expect(p.text.endsWith(".")).toBe(true);
  });

  it("estimates tokens proportional to length", () => {
    const p = synthesize(sample, "midjourney");
    expect(p.tokenEstimate).toBeGreaterThan(10);
    expect(p.tokenEstimate).toBeLessThan(p.text.length);
  });
});

describe("synthesizeAll()", () => {
  it("emits one prompt per supported model", () => {
    const all = synthesizeAll(sample);
    const models = all.map((p) => p.model).sort();
    expect(models).toEqual(["dalle3", "flux", "ideogram", "leonardo", "midjourney", "sdxl"]);
  });
});
