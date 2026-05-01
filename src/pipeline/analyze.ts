/**
 * Stage 1 — Deterministic image analysis (pure JS, ~50ms on a 1024px image).
 *
 * Everything here runs on raw pixels in an OffscreenCanvas / HTMLCanvasElement.
 * Output is treated as ground truth in Stage 3 fusion: the VLM is *told* these
 * values and instructed not to contradict them.
 *
 * Implements:
 *   1. Aspect ratio + dimensions, snapped to common values.
 *   2. Palette extraction via k-means in CIELAB (perceptually correct).
 *   3. Background-isolation detector (border-pixel whiteness fraction).
 *   4. Sobel edge density.
 *   5. Vector-likeness heuristic (few colors + sharp edges + alpha).
 *   6. AI-generator fingerprint scan (PNG tEXt + EXIF UserComment).
 */

import type { DeterministicReport, PaletteColor } from "@/types/schema";
import { type Lab, type Rgb, deltaE, rgbToHex, rgbToLab } from "./color";

const ANALYSIS_SIZE = 256; // resample to this max edge for speed
const PALETTE_K = 6;
const PALETTE_ITERATIONS = 12;

/* --------------------------------------------------------------------------
 * Public entry point
 * -------------------------------------------------------------------------- */

export async function analyze(file: File): Promise<DeterministicReport> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = bitmap;

    const { canvas, ctx } = makeCanvas(bitmap, ANALYSIS_SIZE);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = imageData.data;

    const palette = extractPalette(px);
    const edgeDensity = sobelEdgeDensity(px, canvas.width, canvas.height);
    const isolation = detectIsolation(px, canvas.width, canvas.height);
    const hasAlpha = scanAlpha(px);
    const vectorLikeness = scoreVectorLikeness({
      paletteSize: palette.length,
      edgeDensity,
      hasAlpha,
    });
    const aiFingerprint = await scanAiFingerprint(file);

    return {
      aspectRatio: snapAspectRatio(width, height),
      dimensions: { width, height },
      palette,
      isolatedSubject: {
        value: isolation.fraction >= 0.7,
        confidence: Math.min(1, isolation.fraction / 0.7),
        sources: ["deterministic"],
      },
      vectorLikeness,
      edgeDensity,
      aiFingerprint,
      hasAlpha,
    };
  } finally {
    bitmap.close();
  }
}

/* --------------------------------------------------------------------------
 * 1. Aspect ratio
 * -------------------------------------------------------------------------- */

const COMMON_RATIOS: ReadonlyArray<readonly [string, number]> = [
  ["1:1", 1],
  ["4:5", 4 / 5],
  ["3:4", 3 / 4],
  ["2:3", 2 / 3],
  ["9:16", 9 / 16],
  ["16:9", 16 / 9],
  ["3:2", 3 / 2],
  ["4:3", 4 / 3],
  ["21:9", 21 / 9],
];

function snapAspectRatio(width: number, height: number) {
  const raw = width / height;
  let best: { label: string; dist: number } = { label: "1:1", dist: Infinity };
  for (const [label, target] of COMMON_RATIOS) {
    const dist = Math.abs(Math.log(raw) - Math.log(target));
    if (dist < best.dist) best = { label, dist };
  }
  return { label: best.label, raw };
}

/* --------------------------------------------------------------------------
 * 2. Palette via k-means in CIELAB
 * -------------------------------------------------------------------------- */

function extractPalette(px: Uint8ClampedArray): ReadonlyArray<PaletteColor> {
  const samples: Lab[] = [];
  const rgbs: Rgb[] = [];
  // Stride to ~4096 samples max — plenty for k-means convergence.
  const totalPixels = px.length / 4;
  const stride = Math.max(1, Math.floor(totalPixels / 4096));

  for (let i = 0; i < totalPixels; i += stride) {
    const o = i * 4;
    const a = px[o + 3]!;
    if (a < 128) continue; // skip transparent
    const rgb: Rgb = [px[o]!, px[o + 1]!, px[o + 2]!];
    rgbs.push(rgb);
    samples.push(rgbToLab(rgb));
  }
  if (samples.length === 0) return [];

  // Initialize with k-means++ for stable results.
  const centroids = kmeansPlusPlusInit(samples, PALETTE_K);

  const assignments = new Uint8Array(samples.length);
  for (let iter = 0; iter < PALETTE_ITERATIONS; iter++) {
    // Assign
    for (let i = 0; i < samples.length; i++) {
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = deltaE(samples[i]!, centroids[c]!);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      assignments[i] = best;
    }
    // Update
    const sums: number[][] = Array.from({ length: centroids.length }, () => [0, 0, 0]);
    const counts = new Uint32Array(centroids.length);
    for (let i = 0; i < samples.length; i++) {
      const c = assignments[i]!;
      const s = samples[i]!;
      sums[c]![0] += s[0];
      sums[c]![1] += s[1];
      sums[c]![2] += s[2];
      counts[c]!++;
    }
    for (let c = 0; c < centroids.length; c++) {
      if (counts[c]! > 0) {
        centroids[c] = [
          sums[c]![0] / counts[c]!,
          sums[c]![1] / counts[c]!,
          sums[c]![2] / counts[c]!,
        ];
      }
    }
  }

  // Build the palette from the *closest sample's RGB* per cluster, weighted by share.
  const out: PaletteColor[] = [];
  for (let c = 0; c < centroids.length; c++) {
    const cnt = countAssigned(assignments, c);
    if (cnt === 0) continue;
    const repIdx = nearestSampleIndex(samples, assignments, c, centroids[c]!);
    const rgb = rgbs[repIdx]!;
    out.push({
      hex: rgbToHex(rgb),
      rgb,
      lab: centroids[c]!,
      weight: cnt / samples.length,
    });
  }
  // Sort by weight descending, drop dust < 1%.
  return out
    .filter((p) => p.weight >= 0.01)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, PALETTE_K);
}

function kmeansPlusPlusInit(samples: ReadonlyArray<Lab>, k: number): Lab[] {
  const centroids: Lab[] = [];
  const first = samples[Math.floor(Math.random() * samples.length)]!;
  centroids.push(first);
  while (centroids.length < k) {
    const dists = samples.map((s) => {
      let min = Infinity;
      for (const c of centroids) min = Math.min(min, deltaE(s, c) ** 2);
      return min;
    });
    const total = dists.reduce((a, b) => a + b, 0);
    if (total === 0) break;
    let pick = Math.random() * total;
    let chosen = samples.length - 1;
    for (let i = 0; i < dists.length; i++) {
      pick -= dists[i]!;
      if (pick <= 0) {
        chosen = i;
        break;
      }
    }
    centroids.push(samples[chosen]!);
  }
  return centroids;
}

function countAssigned(arr: Uint8Array, c: number): number {
  let n = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] === c) n++;
  return n;
}

function nearestSampleIndex(
  samples: ReadonlyArray<Lab>,
  assignments: Uint8Array,
  cluster: number,
  centroid: Lab
): number {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < samples.length; i++) {
    if (assignments[i] !== cluster) continue;
    const d = deltaE(samples[i]!, centroid);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best === -1 ? 0 : best;
}

/* --------------------------------------------------------------------------
 * 3. Isolation detection
 *
 * Sample border pixels; if most are near-white (or near-black for dark themes),
 * the subject is isolated. We test both and take the higher score.
 * -------------------------------------------------------------------------- */

function detectIsolation(
  px: Uint8ClampedArray,
  w: number,
  h: number
): { fraction: number } {
  let total = 0;
  let near = 0;
  const test = (x: number, y: number) => {
    const o = (y * w + x) * 4;
    const r = px[o]!;
    const g = px[o + 1]!;
    const b = px[o + 2]!;
    total++;
    // distance from white in RGB; fast and good enough for a border probe
    const distWhite = Math.abs(r - 255) + Math.abs(g - 255) + Math.abs(b - 255);
    if (distWhite < 60) near++;
  };

  for (let x = 0; x < w; x++) {
    test(x, 0);
    test(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    test(0, y);
    test(w - 1, y);
  }
  return { fraction: total === 0 ? 0 : near / total };
}

/* --------------------------------------------------------------------------
 * 4. Sobel edge density
 * -------------------------------------------------------------------------- */

function sobelEdgeDensity(
  px: Uint8ClampedArray,
  w: number,
  h: number
): number {
  // Convert to grayscale
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (0.299 * px[p]! + 0.587 * px[p + 1]! + 0.114 * px[p + 2]!) | 0;
  }

  let edgeCount = 0;
  const threshold = 80;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -gray[i - w - 1]! -
        2 * gray[i - 1]! -
        gray[i + w - 1]! +
        gray[i - w + 1]! +
        2 * gray[i + 1]! +
        gray[i + w + 1]!;
      const gy =
        -gray[i - w - 1]! -
        2 * gray[i - w]! -
        gray[i - w + 1]! +
        gray[i + w - 1]! +
        2 * gray[i + w]! +
        gray[i + w + 1]!;
      if (Math.abs(gx) + Math.abs(gy) > threshold) edgeCount++;
    }
  }
  return edgeCount / (w * h);
}

/* --------------------------------------------------------------------------
 * 5. Alpha + vector-likeness
 * -------------------------------------------------------------------------- */

function scanAlpha(px: Uint8ClampedArray): boolean {
  for (let i = 3; i < px.length; i += 4) {
    if (px[i]! < 250) return true;
  }
  return false;
}

function scoreVectorLikeness({
  paletteSize,
  edgeDensity,
  hasAlpha,
}: {
  paletteSize: number;
  edgeDensity: number;
  hasAlpha: boolean;
}): number {
  // few-colors signal: ramp from 6 colors (0) → 2 colors (1)
  const colorScore = clamp((6 - paletteSize) / 4, 0, 1);
  // edge sharpness: ramp from 0.05 (low, photo-ish) → 0.18 (very sharp)
  const edgeScore = clamp((edgeDensity - 0.05) / 0.13, 0, 1);
  const alphaBoost = hasAlpha ? 0.25 : 0;
  return clamp(0.45 * colorScore + 0.45 * edgeScore + alphaBoost, 0, 1);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/* --------------------------------------------------------------------------
 * 6. AI-generator fingerprint
 *
 * Looks for:
 *   - PNG tEXt / iTXt chunks (Stable Diffusion / Automatic1111 / ComfyUI all
 *     embed "parameters" or "Comment" chunks here).
 *   - JPEG EXIF UserComment / ImageDescription.
 *
 * We don't depend on a third-party EXIF library — a tiny inline reader is
 * enough for the few keys we care about.
 * -------------------------------------------------------------------------- */

async function scanAiFingerprint(
  file: File
): Promise<DeterministicReport["aiFingerprint"]> {
  const buf = new Uint8Array(await file.arrayBuffer());

  // PNG?
  if (
    buf.length > 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    const text = readPngTextChunks(buf);
    if (text) return matchKnownGenerator(text) ?? { detected: false };
  }
  // JPEG?
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    const text = readJpegExifText(buf);
    if (text) return matchKnownGenerator(text) ?? { detected: false };
  }
  return { detected: false };
}

function readPngTextChunks(buf: Uint8Array): string | null {
  let p = 8;
  const decoder = new TextDecoder("utf-8");
  let collected = "";
  while (p + 8 < buf.length) {
    const len =
      (buf[p]! << 24) | (buf[p + 1]! << 16) | (buf[p + 2]! << 8) | buf[p + 3]!;
    const type = String.fromCharCode(buf[p + 4]!, buf[p + 5]!, buf[p + 6]!, buf[p + 7]!);
    const dataStart = p + 8;
    const dataEnd = dataStart + len;
    if (dataEnd > buf.length) break;
    if (type === "tEXt" || type === "iTXt") {
      collected += " " + decoder.decode(buf.subarray(dataStart, dataEnd));
    }
    if (type === "IEND") break;
    p = dataEnd + 4; // skip CRC
  }
  return collected || null;
}

function readJpegExifText(buf: Uint8Array): string | null {
  // Walk APPn segments, look for EXIF / UserComment as ASCII fallback.
  const decoder = new TextDecoder("utf-8");
  let p = 2;
  let collected = "";
  while (p + 4 < buf.length) {
    if (buf[p] !== 0xff) break;
    const marker = buf[p + 1]!;
    if (marker === 0xda /* SOS */) break;
    const len = (buf[p + 2]! << 8) | buf[p + 3]!;
    if (marker >= 0xe0 && marker <= 0xef) {
      // APPn — just decode the payload as best-effort UTF-8
      collected += " " + decoder.decode(buf.subarray(p + 4, p + 2 + len));
    }
    p += 2 + len;
  }
  return collected || null;
}

function matchKnownGenerator(
  text: string
): { detected: true; generator: string; raw: string } | null {
  const lc = text.toLowerCase();
  if (lc.includes("midjourney") || lc.includes("--ar ")) {
    return { detected: true, generator: "Midjourney", raw: text.slice(0, 500) };
  }
  if (lc.includes("stable-diffusion") || lc.includes("stable diffusion") || lc.includes("sampler:")) {
    return { detected: true, generator: "Stable Diffusion", raw: text.slice(0, 500) };
  }
  if (lc.includes("comfyui")) {
    return { detected: true, generator: "ComfyUI", raw: text.slice(0, 500) };
  }
  if (lc.includes("dall·e") || lc.includes("dall-e") || lc.includes("openai")) {
    return { detected: true, generator: "DALL·E", raw: text.slice(0, 500) };
  }
  if (lc.includes("ideogram")) {
    return { detected: true, generator: "Ideogram", raw: text.slice(0, 500) };
  }
  return null;
}

/* --------------------------------------------------------------------------
 * Canvas helper
 * -------------------------------------------------------------------------- */

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type Any2DContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function makeCanvas(
  bitmap: ImageBitmap,
  maxEdge: number
): { canvas: AnyCanvas; ctx: Any2DContext } {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2D canvas context unavailable");
    ctx.drawImage(bitmap, 0, 0, w, h);
    return { canvas, ctx };
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas context unavailable");
  ctx.drawImage(bitmap, 0, 0, w, h);
  return { canvas, ctx };
}
