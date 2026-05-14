/**
 * Lightweight, client-side image quality heuristics used to warn hosts when
 * a photo they're importing is likely blurry, dark, or appears to be a
 * screenshot rather than a real photograph.
 *
 * These checks are intentionally conservative — they produce a *warning*,
 * never a hard rejection. The host can always proceed if they know the
 * image is fine.
 *
 * Heuristics used:
 *  - Sharpness: variance of a 3x3 Laplacian kernel on a downsampled
 *    grayscale copy. Photos shot in focus typically score >150; phone
 *    blur / motion blur usually scores <60.
 *  - Brightness: mean luminance. Very dark (<25) or very bright/blown-out
 *    (>235) frames trigger a warning.
 *  - Screenshot detection: very high proportion of pure-flat color regions
 *    (≥45% of pixels matching a small palette of dominant colors) is a
 *    strong signal the "photo" is actually a UI screenshot.
 */

export interface QualityReport {
  sharpness: number;     // Laplacian variance — higher = sharper
  brightness: number;    // 0..255 mean luminance
  flatRatio: number;     // 0..1 — proportion of pixels in dominant flat colors
  isLikelyBlurry: boolean;
  isLikelyScreenshot: boolean;
  isTooDark: boolean;
  isTooBright: boolean;
  warnings: string[];
}

const SAMPLE_LONG_EDGE = 320; // downsample for fast analysis
export const DEFAULT_BLUR_THRESHOLD = 60;
export const DEFAULT_FLAT_RATIO_THRESHOLD = 0.45;

export interface QualityThresholds {
  /** Minimum Laplacian variance — below this we flag as blurry. */
  minSharpness?: number;
  /** Top-4 quantized-color share above which we flag as a screenshot. */
  flatRatio?: number;
}

function loadBitmap(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
    img.src = url;
  });
}

/**
 * Run quality heuristics on a raster image file. Returns null when the file
 * cannot be decoded by the browser (e.g. HEIC on Chrome) — callers should
 * treat this as "no warnings".
 */
export async function analyzeImageQuality(
  file: File,
  thresholds: QualityThresholds = {},
): Promise<QualityReport | null> {
  const blurT = thresholds.minSharpness ?? DEFAULT_BLUR_THRESHOLD;
  const flatT = thresholds.flatRatio ?? DEFAULT_FLAT_RATIO_THRESHOLD;
  if (!file.type.startsWith('image/')) return null;
  let img: HTMLImageElement;
  try {
    img = await loadBitmap(file);
  } catch {
    return null;
  }

  const srcLong = Math.max(img.naturalWidth, img.naturalHeight);
  if (srcLong === 0) return null;
  const scale = Math.min(1, SAMPLE_LONG_EDGE / srcLong);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  // Convert to grayscale array + compute brightness
  const gray = new Float32Array(w * h);
  let sumLum = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    // Rec. 601 luma
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray[p] = y;
    sumLum += y;
  }
  const brightness = sumLum / (w * h);

  // 3x3 Laplacian variance for sharpness
  let sumLap = 0;
  let sumLapSq = 0;
  let count = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const lap =
        -gray[idx - w - 1] - gray[idx - w] - gray[idx - w + 1]
        - gray[idx - 1] + 8 * gray[idx] - gray[idx + 1]
        - gray[idx + w - 1] - gray[idx + w] - gray[idx + w + 1];
      sumLap += lap;
      sumLapSq += lap * lap;
      count++;
    }
  }
  const meanLap = sumLap / count;
  const sharpness = sumLapSq / count - meanLap * meanLap;

  // Screenshot detection — count pixels matching the top color buckets.
  // Quantize to a 16-step cube (4096 buckets) to find dominant flats.
  const buckets = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] >> 4;
    const g = data[i + 1] >> 4;
    const b = data[i + 2] >> 4;
    const key = (r << 8) | (g << 4) | b;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  const total = w * h;
  const sorted = [...buckets.values()].sort((a, b) => b - a);
  const topShare = sorted.slice(0, 4).reduce((a, b) => a + b, 0) / total;
  const flatRatio = topShare;

  const isLikelyBlurry = sharpness < blurT;
  // Screenshots: very flat AND fairly sharp (UIs have crisp edges but vast flats)
  const isLikelyScreenshot = flatRatio >= flatT && sharpness > 100;
  const isTooDark = brightness < 25;
  const isTooBright = brightness > 235;

  const warnings: string[] = [];
  if (isLikelyBlurry) warnings.push('Looks blurry or out of focus.');
  if (isLikelyScreenshot) warnings.push('Looks like a screenshot, not a real photo.');
  if (isTooDark) warnings.push('Image is very dark — guests may not see the space clearly.');
  if (isTooBright) warnings.push('Image is overexposed — details may be washed out.');

  return {
    sharpness,
    brightness,
    flatRatio,
    isLikelyBlurry,
    isLikelyScreenshot,
    isTooDark,
    isTooBright,
    warnings,
  };
}
