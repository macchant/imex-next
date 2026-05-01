/**
 * Stage 4 — Model-specific prompt synthesis.
 *
 * One canonical FusedSchema → six different prompt strings. Each formatter is
 * a pure function (state → string), trivially unit-testable.
 *
 * Models:
 *   - Midjourney v6 — flag-based syntax (--ar / --s / --no)
 *   - Ideogram — typography-aware natural language
 *   - Leonardo — natural language, no flags
 *   - Flux / Whisk — high-fidelity dense descriptors
 *   - SDXL — comma-separated tags + weights
 *   - DALL·E 3 — single descriptive sentence
 */

import type { FusedSchema, SynthesizedPrompt, TargetModel } from "@/types/schema";

/* --------------------------------------------------------------------------
 * Public API
 * -------------------------------------------------------------------------- */

export function synthesize(schema: FusedSchema, model: TargetModel): SynthesizedPrompt {
  const text = FORMATTERS[model](schema).replace(/\s+/g, " ").trim();
  return {
    model,
    text,
    tokenEstimate: estimateTokens(text),
  };
}

export function synthesizeAll(schema: FusedSchema): ReadonlyArray<SynthesizedPrompt> {
  const models: ReadonlyArray<TargetModel> = [
    "midjourney",
    "ideogram",
    "leonardo",
    "flux",
    "sdxl",
    "dalle3",
  ];
  return models.map((m) => synthesize(schema, m));
}

/* --------------------------------------------------------------------------
 * Per-model formatters
 * -------------------------------------------------------------------------- */

const FORMATTERS: Record<TargetModel, (s: FusedSchema) => string> = {
  midjourney: formatMidjourney,
  ideogram: formatIdeogram,
  leonardo: formatLeonardo,
  flux: formatFlux,
  sdxl: formatSdxl,
  dalle3: formatDalle3,
};

function formatMidjourney(s: FusedSchema): string {
  const parts = [
    s.subject.value,
    descriptor(s.style),
    descriptor(s.linework),
    s.lighting.value !== "unknown" ? `${s.lighting.value} lighting` : null,
    s.mood.value !== "unknown" ? `${s.mood.value} mood` : null,
    paletteDescriptor(s),
    s.isolated ? "isolated subject, white background" : null,
  ];
  const body = compact(parts).join(", ");

  const flags = [`--ar ${s.aspectRatio}`, "--s 250"];
  if (s.negatives.length) flags.push(`--no ${s.negatives.join(", ")}`);

  return `${body} ${flags.join(" ")}`;
}

function formatIdeogram(s: FusedSchema): string {
  const hasText = /["“”].+?["“”]/.test(s.subject.value);
  const prefix = hasText ? "Typography illustration. " : "";
  return compact([
    prefix + s.subject.value,
    descriptor(s.style),
    descriptor(s.linework),
    paletteDescriptor(s),
    s.isolated ? "centered, isolated subject" : null,
    s.negatives.length ? `avoid ${s.negatives.join(", ")}` : null,
  ]).join(", ");
}

function formatLeonardo(s: FusedSchema): string {
  const sentences = [
    `${capitalize(s.subject.value)}.`,
    s.style.value !== "unknown" ? `Style: ${s.style.value}.` : null,
    s.linework.value !== "unknown" ? `Linework: ${s.linework.value}.` : null,
    s.lighting.value !== "unknown" ? `Lighting: ${s.lighting.value}.` : null,
    s.mood.value !== "unknown" ? `Mood: ${s.mood.value}.` : null,
    paletteDescriptor(s) ? `Palette: ${paletteDescriptor(s)}.` : null,
    s.isolated ? "Composition: isolated, centered, white background." : null,
    s.negatives.length ? `Avoid: ${s.negatives.join(", ")}.` : null,
  ];
  return compact(sentences).join(" ");
}

function formatFlux(s: FusedSchema): string {
  // Dense descriptive prose.
  const open = `A high-fidelity ${descriptor(s.style) || "vector"} illustration of ${s.subject.value}`;
  const detail = compact([
    descriptor(s.linework),
    paletteDescriptor(s),
    s.lighting.value !== "unknown" ? `${s.lighting.value} lighting` : null,
    s.mood.value !== "unknown" ? `${s.mood.value} mood` : null,
    s.isolated ? "centered against a clean white background" : null,
  ]).join(", ");
  return [
    open + (detail ? `, ${detail}` : ""),
    `Aspect ratio ${s.aspectRatio}.`,
    s.negatives.length ? `Negative: ${s.negatives.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function formatSdxl(s: FusedSchema): string {
  // Comma-separated tags with light weighting on the strongest signals.
  const tags: string[] = [];
  pushWeighted(tags, s.subject.value, 1.2);
  pushWeighted(tags, descriptor(s.style), 1.1);
  pushWeighted(tags, descriptor(s.linework), 1.0);
  pushWeighted(tags, paletteDescriptor(s), 1.0);
  if (s.lighting.value !== "unknown") pushWeighted(tags, `${s.lighting.value} lighting`, 1.0);
  if (s.mood.value !== "unknown") pushWeighted(tags, `${s.mood.value} mood`, 0.9);
  if (s.isolated) pushWeighted(tags, "isolated, white background", 1.0);

  const positive = compact(tags).join(", ");
  const negative = s.negatives.length ? `\nNegative prompt: ${s.negatives.join(", ")}` : "";
  return `${positive}${negative}`;
}

function formatDalle3(s: FusedSchema): string {
  // A single, well-formed sentence — DALL·E 3 prefers this.
  const subject = s.subject.value;
  const stylePart = descriptor(s.style) ? ` in a ${descriptor(s.style)}` : "";
  const linePart = descriptor(s.linework) ? ` with ${descriptor(s.linework)}` : "";
  const palette = paletteDescriptor(s);
  const palettePart = palette ? `, using a ${palette}` : "";
  const composition = s.isolated
    ? ", isolated and centered against a white background"
    : "";
  const aspect = `, aspect ratio ${s.aspectRatio}`;
  return `Create an image of ${subject}${stylePart}${linePart}${palettePart}${composition}${aspect}.`;
}

/* --------------------------------------------------------------------------
 * Shared helpers
 * -------------------------------------------------------------------------- */

function descriptor(c: { value: string }): string {
  return c.value === "unknown" ? "" : c.value;
}

function paletteDescriptor(s: FusedSchema): string {
  if (s.palette.length === 0) return "";
  const top = s.palette.slice(0, 3).map((p) => p.hex).join(", ");
  return `palette of ${top}`;
}

function pushWeighted(out: string[], term: string, weight: number): void {
  if (!term) return;
  out.push(weight === 1 ? term : `(${term}:${weight.toFixed(1)})`);
}

function compact<T>(arr: ReadonlyArray<T | null | undefined | "">): T[] {
  return arr.filter((x): x is T => x !== null && x !== undefined && x !== "");
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/** Cheap heuristic — ~4 chars per token. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
