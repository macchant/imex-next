/**
 * Stage 2a — Frontier VLM (BYO API key).
 *
 * Sends a downscaled JPEG + the deterministic ground-truth block to the
 * provider of the user's choice and parses a strict JSON response into VlmReport.
 *
 * Three providers are supported. Add more by implementing `Provider`.
 *
 * IMPORTANT: This file ships as a typed shell. The original imex JS already
 * has working calls — port them into the marked TODO blocks. The schema and
 * provider switch are done; only the HTTP body shape per provider is left.
 */

import type { DeterministicReport, VlmReport } from "@/types/schema";
import { buildVlmSystemPrompt } from "./vocab";

export type ProviderId = "openai" | "anthropic" | "google";

export interface ProviderConfig {
  readonly id: ProviderId;
  readonly apiKey: string;
  /** Optional override; otherwise the default is used. */
  readonly model?: string;
}

export class VlmError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "VlmError";
  }
}

/* --------------------------------------------------------------------------
 * Public entry
 * -------------------------------------------------------------------------- */

export async function runVlm(
  file: File,
  ground: DeterministicReport,
  cfg: ProviderConfig,
  signal?: AbortSignal
): Promise<VlmReport> {
  const dataUrl = await downscaleToJpegDataUrl(file, 1024, 0.85);
  const groundTruth = formatGroundTruth(ground);
  const system = buildVlmSystemPrompt(groundTruth);

  const json = await callProvider(cfg, system, dataUrl, signal);
  return parseVlmJson(json);
}

/* --------------------------------------------------------------------------
 * Provider switch — only the request body differs.
 * -------------------------------------------------------------------------- */

async function callProvider(
  cfg: ProviderConfig,
  system: string,
  imageDataUrl: string,
  signal?: AbortSignal
): Promise<string> {
  switch (cfg.id) {
    case "openai":
      return callOpenAI(cfg, system, imageDataUrl, signal);
    case "anthropic":
      return callAnthropic(cfg, system, imageDataUrl, signal);
    case "google":
      return callGemini(cfg, system, imageDataUrl, signal);
  }
}

async function callOpenAI(
  cfg: ProviderConfig,
  system: string,
  imageDataUrl: string,
  signal?: AbortSignal
): Promise<string> {
  // TODO(port): paste your existing fetch from imex/js/vlm.js here.
  // Wire model = cfg.model ?? "gpt-4o-mini", Authorization: Bearer cfg.apiKey,
  // user message contains both `text: "Analyze this image."` and
  // `image_url: { url: imageDataUrl }`.
  const _ = { cfg, system, imageDataUrl, signal };
  void _;
  throw new VlmError("OpenAI provider not yet ported. See TODO in src/pipeline/vlm.ts.");
}

async function callAnthropic(
  cfg: ProviderConfig,
  system: string,
  imageDataUrl: string,
  signal?: AbortSignal
): Promise<string> {
  // TODO(port): https://api.anthropic.com/v1/messages
  // Header: x-api-key, anthropic-version: 2023-06-01.
  // Content blocks: [{type:"image", source:{type:"base64", media_type, data}}, {type:"text", text}]
  const _ = { cfg, system, imageDataUrl, signal };
  void _;
  throw new VlmError("Anthropic provider not yet ported. See TODO in src/pipeline/vlm.ts.");
}

async function callGemini(
  cfg: ProviderConfig,
  system: string,
  imageDataUrl: string,
  signal?: AbortSignal
): Promise<string> {
  // TODO(port): https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=API_KEY
  // parts: [{ inline_data: { mime_type, data } }, { text }]
  const _ = { cfg, system, imageDataUrl, signal };
  void _;
  throw new VlmError("Gemini provider not yet ported. See TODO in src/pipeline/vlm.ts.");
}

/* --------------------------------------------------------------------------
 * Helpers
 * -------------------------------------------------------------------------- */

function formatGroundTruth(g: DeterministicReport): string {
  const palette = g.palette
    .map((p) => `${p.hex} (${(p.weight * 100).toFixed(0)}%)`)
    .join(", ");
  return [
    `- aspect_ratio: ${g.aspectRatio.label} (raw ${g.aspectRatio.raw.toFixed(3)})`,
    `- dimensions: ${g.dimensions.width}x${g.dimensions.height}`,
    `- dominant_palette: ${palette}`,
    `- isolated_subject: ${g.isolatedSubject.value} (confidence ${g.isolatedSubject.confidence.toFixed(2)})`,
    `- vector_likeness: ${g.vectorLikeness.toFixed(2)}`,
    `- edge_density: ${g.edgeDensity.toFixed(3)}`,
    `- has_alpha: ${g.hasAlpha}`,
    g.aiFingerprint.detected
      ? `- ai_generator_metadata: ${g.aiFingerprint.generator}`
      : `- ai_generator_metadata: not detected`,
  ].join("\n");
}

async function downscaleToJpegDataUrl(
  file: File,
  maxEdge: number,
  quality: number
): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new VlmError("2D canvas context unavailable");
    ctx.drawImage(bitmap, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    bitmap.close();
  }
}

/** Strict JSON parser for the VLM response. Tolerates a stray code fence. */
export function parseVlmJson(raw: string): VlmReport {
  let body = raw.trim();
  // Strip ``` fences if the model added them despite instructions.
  body = body.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  try {
    const obj = JSON.parse(body) as VlmReport;
    // Minimal shape sanity. We don't fully validate — fusion is defensive.
    if (!obj.subject?.value || typeof obj.subject.confidence !== "number") {
      throw new VlmError("VLM response missing subject");
    }
    return obj;
  } catch (e) {
    throw new VlmError("Failed to parse VLM JSON response", { cause: e });
  }
}
