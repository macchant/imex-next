<div align="center">

# imex // IMG → PROMPT

### Reverse-engineer any image into a model-specific AI prompt.

**Client-side ensemble pipeline. Deterministic pixel analysis + frontier VLM + zero-shot SigLIP, fused into a strict schema and synthesized for six different image-gen models.**

### [→ Live demo](https://imex-next.vercel.app)

[![Deployed on Vercel](https://img.shields.io/badge/live-imex--next.vercel.app-000?style=for-the-badge&logo=vercel&logoColor=white)](https://imex-next.vercel.app)
[![License: MIT](https://img.shields.io/badge/license-MIT-22c55e?style=for-the-badge)](LICENSE)
[![Built with Vite](https://img.shields.io/badge/vite-6-646cff?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tested with Vitest](https://img.shields.io/badge/vitest-tested-fcc72b?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev)

<img src="docs/hero.png" alt="imex pipeline UI showing palette, schema, and synthesized prompts" width="900"/>

> **This is v2** — a Vite + strict TypeScript rewrite of the original [`imex`](https://github.com/macchant/imex) (HTML + vanilla JS, still live). Same pipeline architecture, same schema, fully typed, with vitest coverage on the math-heavy stages.

</div>

---

## Why imex

Most "image-to-prompt" tools dump CLIP Interrogator output and call it done. The result: hallucinated artist names, generic captions, wrong target syntax.

imex is built around four senior-engineering principles:

1. **Ensemble, not single model.** Deterministic pixel analysis + frontier VLM + zero-shot SigLIP against a curated vocabulary, fused into one schema with **calibrated confidence per field**.
2. **Ground truth wins.** Aspect ratio, palette, isolation, edge density, EXIF — computed in pure JS from pixels and **override anything the LLM hallucinates**. The VLM is *told* the ground truth before it answers.
3. **Structured schema, not prose.** The VLM emits a strict JSON schema (`subject`, `style`, `linework`, `medium`, `lighting`, `mood`, `composition`, `negatives`) so the user can edit individual axes as chips, and downstream synthesizers can target any model precisely.
4. **Model-specific synthesis.** One schema → six different prompt strings (Midjourney v6, Ideogram, Leonardo, Flux, SDXL, DALL·E 3), each with the right syntax (`--ar`, `--no`, `--s` flags; weighted tags; natural-language sentences).

---

## 🧠 Pipeline

```
┌─────────────┐
│  Image In   │
└──────┬──────┘
       │
       ▼
┌──────────────────────────────────────────────────┐
│ Stage 1 — Deterministic (pure JS, ~50ms)         │
│ • Aspect ratio (snapped to common values)        │
│ • Palette (k-means in CIELAB, perceptual)        │
│ • Background-isolation detector                  │
│ • Vector-likeness score                          │
│ • Sobel edge density                             │
│ • EXIF + AI-generator fingerprint scan           │
└──────┬───────────────────────────────────────────┘
       │
       ├──────────────────────────────────┐
       ▼                                  ▼
┌──────────────────────┐    ┌────────────────────────────────┐
│ Stage 2a — Frontier  │    │ Stage 2b — Local SigLIP        │
│ VLM (BYO key)        │    │ zero-shot vs curated vocab     │
│ OpenAI / Anthropic / │    │ (transformers.js, in-browser,  │
│ Gemini, returns      │    │ ~80MB cached, FREE)            │
│ strict JSON schema   │    │                                │
└──────┬───────────────┘    └────────────────┬───────────────┘
       │                                     │
       └──────────────┬──────────────────────┘
                      ▼
          ┌──────────────────────────────────┐
          │ Stage 3 — Confidence-weighted    │
          │ fusion. Stage 1 ground truth     │
          │ wins for AR/palette/isolation.   │
          │ VLM wins for narrative/subject.  │
          │ VLM+SigLIP averaged for style.   │
          └──────────────┬───────────────────┘
                         ▼
          ┌──────────────────────────────────┐
          │ Stage 4 — Model-specific         │
          │ synthesis (Midjourney v6,        │
          │ Ideogram, Leonardo, Flux, SDXL,  │
          │ DALL·E 3)                        │
          └──────────────┬───────────────────┘
                         ▼
                  ┌────────────┐
                  │ Prompt Out │
                  └────────────┘
```

---

## 🛠️ Project structure

```
src/
├── main.ts
├── style.css
├── types/
│   └── schema.ts              # single source of truth for the schema
├── pipeline/
│   ├── color.ts               # sRGB ↔ CIELAB, ΔE76
│   ├── analyze.ts             # Stage 1 (deterministic) — full impl
│   ├── vocab.ts               # curated vocab + VLM system prompt
│   ├── vlm.ts                 # Stage 2a — provider switch
│   ├── tagger.ts              # Stage 2b — SigLIP zero-shot
│   ├── fusion.ts              # Stage 3 — confidence-weighted merge
│   ├── synthesize.ts          # Stage 4 — six model formatters
│   └── *.test.ts              # vitest suites
└── ui/
    ├── app.ts                 # controller + pipeline orchestration
    └── components.ts          # tiny DOM helpers
```

Every stage is a pure function that consumes / produces types from `schema.ts`. Adding a new model formatter is **one entry in `synthesize.ts`'s `FORMATTERS` map** — TypeScript enforces exhaustiveness.

---

## ✨ Senior-engineering moves most tools skip

- **LAB k-means, not RGB.** RGB averages produce muddy "browns" that don't perceptually exist in the image. CIELAB k-means gives the actual perceived dominant colors.
- **Vector-likeness drives `--no` flags.** If the input has few unique colors, sharp edges, alpha presence → it's vector. We auto-inject `--no shading 3d photo gradient noise` before you even click.
- **EXIF AI-fingerprint scan.** PNG `tEXt` / JPEG APP segments often leak the original generator (Midjourney, ComfyUI, Stable Diffusion, Ideogram). Free wins. We surface it.
- **VLM is told the ground truth.** Stage 1's measurements are inlined into the system prompt with a `TRUST THIS` instruction. Massively reduces hallucination.
- **Confidence fusion.** When VLM and SigLIP both agree on a style → confidence is bumped above either source alone (capped at 0.95). When they disagree, the higher score wins but is capped at 0.7 to discourage overclaiming.
- **Defensive fusion.** Either Stage 2 source can fail independently. The pipeline still produces a usable schema with deterministic-only inputs.

---

## 🏃 Run locally

```bash
npm install
npm run dev          # → http://localhost:5174
```

```bash
npm run build        # → dist/
npm run typecheck    # strict TS check, exactOptionalPropertyTypes on
npm test             # vitest run (color, fusion, synthesize)
```

---

## 🔌 Wire up Stage 2 (VLM / Tagger)

The shipped scaffold has **typed shells** for the VLM and SigLIP tagger. Both are intentionally not implemented in this repo's source — port from the original `imex` JS:

### VLM (`src/pipeline/vlm.ts`)
Three providers (`openai`, `anthropic`, `google`) — each has a `TODO(port)` block. Replace it with a `fetch` call against the provider's vision endpoint. The schema parser (`parseVlmJson`) is already implemented and tested.

### SigLIP tagger (`src/pipeline/tagger.ts`)
One `TODO(port)` block. Use `@xenova/transformers`:

```ts
const { pipeline } = await import("@xenova/transformers");
const clf = await pipeline(
  "zero-shot-image-classification",
  "Xenova/siglip-base-patch16-224"
);
const out = await clf(imageUrl, { candidate_labels: candidateLabels });
return out.slice(0, topK).map(({ label, score }) => ({ label, score }));
```

The candidate vocabularies are already exported from `src/pipeline/vocab.ts`.

---

## 🔒 Privacy & security

- **No backend.** Everything runs in your browser.
- **API keys** are stored only in `localStorage` and only sent directly to the provider you choose.
- **Images** never leave your machine in free mode. In frontier mode, they're sent as a downscaled JPEG (max 1024px) to your chosen VLM provider — *only* when you click Extract.
- **No analytics, no tracking.**

---

## 🧪 Tests

Vitest covers the parts where correctness matters:

- `color.test.ts` — sRGB↔LAB round-trips, ΔE basics.
- `fusion.test.ts` — agree/disagree paths, fallback when VLM is missing, auto-negative injection.
- `synthesize.test.ts` — every formatter's required shape (flags, sentences, weighted tags).

```bash
npm test
```

---

## 🗺️ Roadmap

- [ ] **v1.1** — port the OpenAI provider (5-min job, just paste from old JS).
- [ ] **v1.2** — port SigLIP tagger via `@xenova/transformers`.
- [ ] **v2** — WD14 booru-tagger for anime/character recognition. JoyTag for dense general tags.
- [ ] **v3** — Round-trip verification: generate via Flux Schnell, compute DINOv2 cosine similarity vs original, iterate the schema field that drifted.
- [ ] **v4** — Direct "Send to vectorgen" handoff via URL params or `postMessage`.
- [ ] **v5** — Florence-2 region captioning (per-object bounding boxes) for compound scenes.

---

## 📄 License

MIT — see [LICENSE](LICENSE).

---

<sub>Built by [@macchant](https://github.com/macchant). Companion to [vectorgen](https://github.com/macchant/vectorgen) — schemas/vocabularies are intentionally compatible so output here pipes straight back in.</sub>
