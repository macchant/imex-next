/**
 * Color-space conversions used by the deterministic palette extractor.
 *
 * We work in CIELAB because perceptual averages there match what humans see;
 * naïve RGB k-means produces muddy "browns" that don't actually exist in the
 * source image.
 *
 * sRGB → linear sRGB → XYZ (D65) → CIELAB.
 */

export type Rgb = readonly [number, number, number];
export type Lab = readonly [number, number, number];

/** sRGB component (0–255) → linear sRGB (0–1). */
function srgbToLinear(c: number): number {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

/** Linear sRGB (0–1) → sRGB (0–255). */
function linearToSrgb(c: number): number {
  const x = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(x * 255)));
}

/** D65 reference white. */
const Xn = 0.95047;
const Yn = 1.0;
const Zn = 1.08883;

function f(t: number): number {
  const e = 216 / 24389;
  const k = 24389 / 27;
  return t > e ? Math.cbrt(t) : (k * t + 16) / 116;
}

function fInv(t: number): number {
  const e = 6 / 29;
  return t > e ? t ** 3 : 3 * e * e * (t - 4 / 29);
}

export function rgbToLab([r, g, b]: Rgb): Lab {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  // sRGB → XYZ (D65)
  const X = lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375;
  const Y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175;
  const Z = lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041;

  const fx = f(X / Xn);
  const fy = f(Y / Yn);
  const fz = f(Z / Zn);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToRgb([L, a, b]: Lab): Rgb {
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;

  const X = Xn * fInv(fx);
  const Y = Yn * fInv(fy);
  const Z = Zn * fInv(fz);

  const lr = X * 3.2404542 - Y * 1.5371385 - Z * 0.4985314;
  const lg = -X * 0.969266 + Y * 1.8760108 + Z * 0.041556;
  const lb = X * 0.0556434 - Y * 0.2040259 + Z * 1.0572252;

  return [linearToSrgb(lr), linearToSrgb(lg), linearToSrgb(lb)];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const h = (n: number): string => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** ΔE76 — fast, good enough for palette comparison. */
export function deltaE([L1, a1, b1]: Lab, [L2, a2, b2]: Lab): number {
  const dL = L1 - L2;
  const da = a1 - a2;
  const db = b1 - b2;
  return Math.sqrt(dL * dL + da * da + db * db);
}
