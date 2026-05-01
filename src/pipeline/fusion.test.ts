import { describe, expect, it } from "vitest";
import { fuse } from "./fusion";
import type { DeterministicReport, VlmReport, TaggerReport } from "@/types/schema";

const ground: DeterministicReport = {
  aspectRatio: { label: "1:1", raw: 1.0 },
  dimensions: { width: 512, height: 512 },
  palette: [{ hex: "#fff", rgb: [255, 255, 255], lab: [100, 0, 0], weight: 0.5 }],
  isolatedSubject: { value: true, confidence: 1.0, sources: ["deterministic"] },
  vectorLikeness: 0.85,
  edgeDensity: 0.12,
  aiFingerprint: { detected: false },
  hasAlpha: true,
};

const vlm: VlmReport = {
  subject: { value: "a happy cat", confidence: 0.9 },
  style: { value: "flat vector illustration", confidence: 0.7 },
  linework: { value: "thick black outlines", confidence: 0.6 },
  medium: { value: "vector", confidence: 0.9 },
  lighting: { value: "flat", confidence: 0.5 },
  mood: { value: "cheerful", confidence: 0.7 },
  composition: { value: "centered-isolated", confidence: 0.8 },
  negatives: ["blurry"],
};

const tagger: TaggerReport = {
  style: [{ label: "flat vector illustration", score: 0.6 }],
  linework: [{ label: "monoline uniform strokes", score: 0.55 }],
  mood: [{ label: "cheerful", score: 0.65 }],
};

describe("fuse()", () => {
  it("auto-injects vector negatives when vector-likeness is high", () => {
    const out = fuse({ deterministic: ground });
    expect(out.negatives).toEqual(expect.arrayContaining(["photo", "3d", "shading"]));
  });

  it("uses VLM subject and copies deterministic ground truth", () => {
    const out = fuse({ deterministic: ground, vlm });
    expect(out.subject.value).toBe("a happy cat");
    expect(out.aspectRatio).toBe("1:1");
    expect(out.isolated).toBe(true);
  });

  it("bumps style confidence when VLM and tagger agree", () => {
    const out = fuse({ deterministic: ground, vlm, tagger });
    expect(out.style.confidence).toBeGreaterThan(vlm.style.confidence);
    expect(out.style.sources).toEqual(expect.arrayContaining(["vlm", "tagger"]));
  });

  it("falls back to tagger when VLM is missing", () => {
    const out = fuse({ deterministic: ground, tagger });
    expect(out.style.value).toBe("flat vector illustration");
    expect(out.style.sources).toEqual(["tagger"]);
  });

  it("infers vector medium from deterministic when VLM is missing", () => {
    const out = fuse({ deterministic: ground });
    expect(out.medium.value).toBe("vector");
  });
});
