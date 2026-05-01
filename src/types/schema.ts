/**
 * imex — single source of truth for the prompt schema.
 *
 * Every stage (deterministic analysis, VLM, SigLIP tagger, fusion, synthesis)
 * reads or writes pieces of this schema. Changes here ripple everywhere — by
 * design, so that the type checker enforces consistency end-to-end.
 */

export type TargetModel =
  | "midjourney"
  | "ideogram"
  | "leonardo"
  | "flux"
  | "sdxl"
  | "dalle3";

export type Medium =
  | "vector"
  | "photo"
  | "3d-render"
  | "painting"
  | "pixel-art"
  | "line-art"
  | "anime"
  | "unknown";

export type Lighting =
  | "flat"
  | "soft"
  | "studio"
  | "dramatic"
  | "natural"
  | "rim"
  | "neon"
  | "unknown";

export type Mood =
  | "cheerful"
  | "serious"
  | "playful"
  | "mysterious"
  | "minimal"
  | "energetic"
  | "calm"
  | "unknown";

export type Composition =
  | "centered-isolated"
  | "rule-of-thirds"
  | "knolling-grid"
  | "wide-scene"
  | "portrait-bust"
  | "full-body"
  | "unknown";

/** A value plus a confidence in [0, 1]. */
export interface Confident<T> {
  readonly value: T;
  readonly confidence: number;
  /** Which stages contributed (for debugging / UI). */
  readonly sources?: ReadonlyArray<"deterministic" | "vlm" | "tagger">;
}

/** Color in three useful spaces — kept together so the UI never re-converts. */
export interface PaletteColor {
  readonly hex: string;
  readonly rgb: readonly [number, number, number];
  readonly lab: readonly [number, number, number];
  /** Fraction of pixels in [0, 1]. */
  readonly weight: number;
}

/** Output of Stage 1 — pure-JS pixel measurements. */
export interface DeterministicReport {
  readonly aspectRatio: {
    /** Snapped label, e.g. "16:9". */
    readonly label: string;
    /** Raw width / height. */
    readonly raw: number;
  };
  readonly dimensions: { readonly width: number; readonly height: number };
  readonly palette: ReadonlyArray<PaletteColor>;
  /** True when ≥ ~70% of edge pixels are near-white. */
  readonly isolatedSubject: Confident<boolean>;
  /** Heuristic 0–1: high = vector-like (few colors, sharp edges, alpha). */
  readonly vectorLikeness: number;
  /** Fraction of pixels classified as edges by Sobel. */
  readonly edgeDensity: number;
  /** Detected via PNG tEXt / EXIF when present. */
  readonly aiFingerprint:
    | { readonly detected: true; readonly generator: string; readonly raw: string }
    | { readonly detected: false };
  /** True if the source PNG/JPG appears to have alpha. */
  readonly hasAlpha: boolean;
}

/** Output of Stage 2a — frontier VLM with strict JSON shape. */
export interface VlmReport {
  readonly subject: Confident<string>;
  readonly style: Confident<string>;
  readonly linework: Confident<string>;
  readonly medium: Confident<Medium>;
  readonly lighting: Confident<Lighting>;
  readonly mood: Confident<Mood>;
  readonly composition: Confident<Composition>;
  readonly negatives: ReadonlyArray<string>;
}

/** Output of Stage 2b — zero-shot SigLIP against a curated vocabulary. */
export interface TaggerReport {
  readonly style: ReadonlyArray<{ readonly label: string; readonly score: number }>;
  readonly linework: ReadonlyArray<{ readonly label: string; readonly score: number }>;
  readonly mood: ReadonlyArray<{ readonly label: string; readonly score: number }>;
}

/** Stage 3 output — the canonical schema everything downstream consumes. */
export interface FusedSchema {
  readonly subject: Confident<string>;
  readonly style: Confident<string>;
  readonly linework: Confident<string>;
  readonly medium: Confident<Medium>;
  readonly lighting: Confident<Lighting>;
  readonly mood: Confident<Mood>;
  readonly composition: Confident<Composition>;
  readonly aspectRatio: string;
  readonly palette: ReadonlyArray<PaletteColor>;
  readonly isolated: boolean;
  readonly vectorLikeness: number;
  readonly negatives: ReadonlyArray<string>;
  readonly aiFingerprint: DeterministicReport["aiFingerprint"];
}

/** A single rendered prompt ready to paste. */
export interface SynthesizedPrompt {
  readonly model: TargetModel;
  readonly text: string;
  readonly tokenEstimate: number;
}
