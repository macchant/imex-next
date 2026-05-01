/**
 * Stage 2b — Local zero-shot tagger via SigLIP / transformers.js.
 *
 * Free fallback that runs entirely in-browser. ~80MB model, cached after first
 * load. Scores the image against the curated vocabularies in `vocab.ts`.
 *
 * Ships as a typed shell — the original imex JS uses
 *   pipeline("zero-shot-image-classification", "Xenova/siglip-base-patch16-224")
 * Port that into runZeroShot() below; types here are already correct.
 */

import type { TaggerReport } from "@/types/schema";
import { LINEWORK_VOCAB, MOOD_VOCAB, STYLE_VOCAB } from "./vocab";

export class TaggerError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TaggerError";
  }
}

export interface TaggerOptions {
  /** Optional override of the model id passed to transformers.js. */
  readonly model?: string;
  /** Top-K labels to keep per category. */
  readonly topK?: number;
}

export async function runTagger(
  file: File,
  opts: TaggerOptions = {}
): Promise<TaggerReport> {
  const k = opts.topK ?? 5;
  const url = await fileToObjectUrl(file);
  try {
    const [style, linework, mood] = await Promise.all([
      runZeroShot(url, STYLE_VOCAB, k),
      runZeroShot(url, LINEWORK_VOCAB, k),
      runZeroShot(url, MOOD_VOCAB, Math.min(k, 4)),
    ]);
    return { style, linework, mood };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* --------------------------------------------------------------------------
 * Internals
 * -------------------------------------------------------------------------- */

async function runZeroShot(
  imageUrl: string,
  candidateLabels: ReadonlyArray<string>,
  topK: number
): Promise<ReadonlyArray<{ label: string; score: number }>> {
  // TODO(port): paste the working transformers.js call from imex/js/tagger.js.
  //
  // Roughly:
  //   const { pipeline } = await import("@xenova/transformers");
  //   const clf = await pipeline("zero-shot-image-classification", MODEL);
  //   const out = await clf(imageUrl, { candidate_labels: candidateLabels });
  //   return out.slice(0, topK).map(({label, score}) => ({label, score}));
  const _ = { imageUrl, candidateLabels, topK };
  void _;
  throw new TaggerError(
    "SigLIP tagger not yet ported. See TODO in src/pipeline/tagger.ts."
  );
}

function fileToObjectUrl(file: File): Promise<string> {
  return Promise.resolve(URL.createObjectURL(file));
}
