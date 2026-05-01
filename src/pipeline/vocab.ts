/**
 * Curated vocabularies used by:
 *   - the SigLIP tagger (zero-shot scoring against label sets)
 *   - the VLM system prompt (constraining its output to known buckets)
 *   - the UI (chip selectors, validation)
 *
 * Keep these short and high-precision. Recall is handled by the VLM.
 */

export const STYLE_VOCAB: ReadonlyArray<string> = [
  "flat vector illustration",
  "corporate memphis style",
  "bauhaus geometric design",
  "art deco illustration",
  "pop art with halftone",
  "kawaii cute illustration",
  "risograph print",
  "mid-century modern illustration",
  "tattoo flash style",
  "y2k chrome aesthetic",
  "studio ghibli style",
  "anime illustration",
  "watercolor painting",
  "oil painting",
  "pencil sketch",
  "low-poly 3D render",
  "isometric illustration",
  "pixel art",
  "photorealistic",
  "cinematic still",
];

export const LINEWORK_VOCAB: ReadonlyArray<string> = [
  "monoline uniform strokes",
  "thick black outlines",
  "no outline shape-only",
  "stippling dot shading",
  "halftone dot shading",
  "crosshatch shading",
  "flat color blocks",
  "rough hand-drawn lines",
];

export const MOOD_VOCAB: ReadonlyArray<string> = [
  "cheerful",
  "serious",
  "playful",
  "mysterious",
  "minimal",
  "energetic",
  "calm",
  "nostalgic",
];

/**
 * The strict JSON shape the VLM is told to emit. Any drift here means a parse
 * failure — which is fine, we fall back to deterministic + tagger results.
 */
export const VLM_JSON_SCHEMA = {
  type: "object",
  required: [
    "subject",
    "style",
    "linework",
    "medium",
    "lighting",
    "mood",
    "composition",
    "negatives",
  ],
  properties: {
    subject: { type: "object", required: ["value", "confidence"] },
    style: { type: "object", required: ["value", "confidence"] },
    linework: { type: "object", required: ["value", "confidence"] },
    medium: {
      type: "object",
      required: ["value", "confidence"],
      properties: {
        value: {
          enum: [
            "vector",
            "photo",
            "3d-render",
            "painting",
            "pixel-art",
            "line-art",
            "anime",
            "unknown",
          ],
        },
      },
    },
    lighting: { type: "object", required: ["value", "confidence"] },
    mood: { type: "object", required: ["value", "confidence"] },
    composition: { type: "object", required: ["value", "confidence"] },
    negatives: { type: "array", items: { type: "string" } },
  },
} as const;

/**
 * Build the system prompt sent to the VLM. The deterministic ground-truth
 * block is interpolated *first* so the model sees it before generating.
 */
export function buildVlmSystemPrompt(groundTruth: string): string {
  return `You are imex, a meticulous image-to-prompt analyzer.

GROUND TRUTH (TRUST THIS, DO NOT CONTRADICT IT):
${groundTruth}

Return STRICT JSON matching this schema. Confidence is a float in [0, 1].

Vocabularies — prefer these labels when applicable, but free text is allowed:
- style:    ${STYLE_VOCAB.join(", ")}
- linework: ${LINEWORK_VOCAB.join(", ")}
- mood:     ${MOOD_VOCAB.join(", ")}

Rules:
1. Never invent specific artist names. Style families only.
2. If unsure, lower confidence. Do not pretend to know.
3. Keep "subject" to one concise noun phrase, no commas.
4. "negatives" should be 3–6 short strings to exclude (e.g. "blurry", "watermark").
5. Output ONLY the JSON object. No prose. No markdown fences.`;
}
