/**
 * Stage 3 — Confidence-weighted fusion.
 *
 * Rules (in priority order):
 *   1. Deterministic ground truth wins for: aspect_ratio, palette, isolation,
 *      vector_likeness, ai_fingerprint. The VLM is *told* these values; if it
 *      contradicts them we still keep ours.
 *   2. VLM wins for narrative fields: subject, lighting, composition, negatives.
 *   3. Style + linework + mood are merged: when VLM and the local SigLIP tagger
 *      agree on a label, confidence is bumped. When they disagree, the higher
 *      confidence wins, but capped to discourage overclaiming.
 *
 * Either Stage 2 source can be missing — fusion is defensive. If only the
 * deterministic stage ran, we still produce a usable schema with sensible
 * defaults and reduced confidence.
 */

import type {
  Confident,
  DeterministicReport,
  FusedSchema,
  Lighting,
  Medium,
  Mood,
  Composition,
  TaggerReport,
  VlmReport,
} from "@/types/schema";

export interface FuseInput {
  readonly deterministic: DeterministicReport;
  readonly vlm?: VlmReport;
  readonly tagger?: TaggerReport;
}

export function fuse({ deterministic, vlm, tagger }: FuseInput): FusedSchema {
  // Defaults when VLM is absent.
  const subject: Confident<string> = vlm?.subject ?? {
    value: "unknown subject",
    confidence: 0,
    sources: [],
  };

  const composition: Confident<Composition> =
    vlm?.composition ?? defaultComposition(deterministic);

  const lighting: Confident<Lighting> = vlm?.lighting ?? {
    value: "unknown",
    confidence: 0,
    sources: [],
  };

  const medium: Confident<Medium> =
    vlm?.medium ?? inferMediumFromDeterministic(deterministic);

  // Bumpable fields — fold tagger evidence in.
  const style = mergeStringField(
    vlm?.style,
    pickTopTagger(tagger?.style),
    "style"
  );
  const linework = mergeStringField(
    vlm?.linework,
    pickTopTagger(tagger?.linework),
    "linework"
  );
  const mood: Confident<Mood> = mergeMoodField(vlm?.mood, pickTopTagger(tagger?.mood));

  const negatives = computeNegatives(deterministic, vlm);

  return {
    subject,
    style,
    linework,
    medium,
    lighting,
    mood,
    composition,
    aspectRatio: deterministic.aspectRatio.label,
    palette: deterministic.palette,
    isolated: deterministic.isolatedSubject.value,
    vectorLikeness: deterministic.vectorLikeness,
    negatives,
    aiFingerprint: deterministic.aiFingerprint,
  };
}

/* --------------------------------------------------------------------------
 * Field-level helpers
 * -------------------------------------------------------------------------- */

function mergeStringField(
  fromVlm: Confident<string> | undefined,
  fromTagger: { label: string; score: number } | null,
  _name: string
): Confident<string> {
  if (fromVlm && fromTagger) {
    const agree = labelsRoughlyAgree(fromVlm.value, fromTagger.label);
    if (agree) {
      // Bump above either source alone, capped at 0.95.
      return {
        value: fromVlm.value,
        confidence: Math.min(0.95, Math.max(fromVlm.confidence, fromTagger.score) + 0.1),
        sources: ["vlm", "tagger"],
      };
    }
    // Disagree — pick the higher-confidence one, capped to 0.7.
    if (fromTagger.score > fromVlm.confidence) {
      return {
        value: fromTagger.label,
        confidence: Math.min(0.7, fromTagger.score),
        sources: ["tagger"],
      };
    }
    return {
      value: fromVlm.value,
      confidence: Math.min(0.7, fromVlm.confidence),
      sources: ["vlm"],
    };
  }
  if (fromVlm) return { ...fromVlm, sources: ["vlm"] };
  if (fromTagger) {
    return { value: fromTagger.label, confidence: fromTagger.score, sources: ["tagger"] };
  }
  return { value: "unknown", confidence: 0, sources: [] };
}

function mergeMoodField(
  fromVlm: Confident<Mood> | undefined,
  fromTagger: { label: string; score: number } | null
): Confident<Mood> {
  const merged = mergeStringField(
    fromVlm
      ? { value: fromVlm.value, confidence: fromVlm.confidence }
      : undefined,
    fromTagger,
    "mood"
  );
  // Coerce string back to Mood enum, default "unknown".
  const moods: ReadonlyArray<Mood> = [
    "cheerful",
    "serious",
    "playful",
    "mysterious",
    "minimal",
    "energetic",
    "calm",
    "unknown",
  ];
  const value = (moods as ReadonlyArray<string>).includes(merged.value)
    ? (merged.value as Mood)
    : "unknown";
  return { value, confidence: merged.confidence, sources: merged.sources ?? [] };
}

function pickTopTagger(
  rows: ReadonlyArray<{ label: string; score: number }> | undefined
): { label: string; score: number } | null {
  if (!rows || rows.length === 0) return null;
  return rows.reduce((a, b) => (a.score >= b.score ? a : b));
}

/** Loose label agreement — strip stop-words and compare. */
function labelsRoughlyAgree(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  const sa = new Set(norm(a));
  const sb = new Set(norm(b));
  let overlap = 0;
  for (const w of sa) if (sb.has(w)) overlap++;
  const minSize = Math.min(sa.size, sb.size) || 1;
  return overlap / minSize >= 0.4;
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "with",
  "for",
  "from",
  "into",
  "style",
  "illustration",
  "art",
  "design",
  "image",
  "color",
  "colors",
]);

/* --------------------------------------------------------------------------
 * Cross-field inference
 * -------------------------------------------------------------------------- */

function defaultComposition(d: DeterministicReport): Confident<Composition> {
  if (d.isolatedSubject.value) {
    return {
      value: "centered-isolated",
      confidence: 0.6,
      sources: ["deterministic"],
    };
  }
  return { value: "unknown", confidence: 0, sources: [] };
}

function inferMediumFromDeterministic(
  d: DeterministicReport
): Confident<Medium> {
  if (d.vectorLikeness >= 0.7) {
    return { value: "vector", confidence: d.vectorLikeness, sources: ["deterministic"] };
  }
  if (d.vectorLikeness <= 0.2 && d.edgeDensity < 0.06) {
    return { value: "photo", confidence: 0.55, sources: ["deterministic"] };
  }
  return { value: "unknown", confidence: 0, sources: [] };
}

function computeNegatives(
  d: DeterministicReport,
  vlm: VlmReport | undefined
): ReadonlyArray<string> {
  const set = new Set<string>(vlm?.negatives ?? []);
  // Auto-inject vector-friendly negatives when the source is clearly vector.
  if (d.vectorLikeness >= 0.6) {
    for (const n of ["photo", "3d", "shading", "gradient", "noise"]) set.add(n);
  }
  // Avoid contradicting the deterministic AR.
  set.delete(d.aspectRatio.label);
  return [...set];
}
