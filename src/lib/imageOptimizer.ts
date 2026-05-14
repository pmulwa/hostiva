/**
 * Client-side image optimizer for property listings.
 *
 * Goals:
 *  - Preserve the original image as faithfully as possible (no aggressive
 *    downscaling, no heavy recompression).
 *  - Only resize when the source is larger than TARGET_LONG_EDGE (very large).
 *  - Only re-encode when needed (output size > MAX_OUTPUT_BYTES, or input is
 *    a non-JPEG raster the storage layer can serve more efficiently as JPEG).
 *  - Never up-scale; keep aspect ratio; never crop.
 *  - Reject only truly unusable originals (too small to be a real photo).
 */

// Allow very large hero-quality images — only resize when bigger than this.
const TARGET_LONG_EDGE = 4096;
// Lowered floor so most phone/camera exports pass through.
const MIN_LONG_EDGE = 400; // Lowered from 800px — accepts most real photos including compressed imports
// High quality re-encode (visually lossless for photos).
const QUALITY = 0.95;
// Only step quality down if file balloons past this.
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024; // 8MB

export type OptimizedImage = {
  file: File;
  width: number;
  height: number;
  longEdge: number;
  bytes: number;
};

function loadBitmap(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image file.')); };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Encoding failed'))),
      'image/jpeg',
      quality,
    );
  });
}

/**
 * Optimize a single user-uploaded image. Returns null when the source is too
 * small to meet the quality bar (caller should surface a friendly error).
 */
export async function optimizeImage(file: File): Promise<OptimizedImage | null> {
  // Skip optimization for non-raster types (e.g. SVG/HEIC unsupported by canvas)
  if (!file.type.startsWith('image/')) return null;

  let img: HTMLImageElement;
  try {
    img = await loadBitmap(file);
  } catch {
    // Browser couldn't decode (typical for HEIC/HEIF on Chrome/Firefox).
    // Pass the original file through untouched so the upload still succeeds —
    // Safari/iOS can render it natively, and storage will serve it as-is.
    if (/heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)) {
      return {
        file,
        width: 0,
        height: 0,
        longEdge: MIN_LONG_EDGE, // unknown; assume acceptable
        bytes: file.size,
      };
    }
    return null;
  }

  const srcLong = Math.max(img.naturalWidth, img.naturalHeight);
  if (srcLong < MIN_LONG_EDGE) {
    // Reject: too low-res to be useful for a listing card
    return null;
  }

  // FAST PATH: keep the original bytes when it already meets quality bars.
  // This guarantees the uploaded file is bit-for-bit identical to what the
  // host selected (no recompression artifacts, no color-profile loss).
  const isJpegOrWebp = /jpe?g|webp/i.test(file.type) || /\.(jpe?g|webp)$/i.test(file.name);
  if (srcLong <= TARGET_LONG_EDGE && file.size <= MAX_OUTPUT_BYTES && isJpegOrWebp) {
    return {
      file,
      width: img.naturalWidth,
      height: img.naturalHeight,
      longEdge: srcLong,
      bytes: file.size,
    };
  }

  // Otherwise: resize (only if too large) and/or re-encode.
  const scale = srcLong > TARGET_LONG_EDGE ? TARGET_LONG_EDGE / srcLong : 1;
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return null;
  // White background → guarantees opaque JPG, prevents black PNG-alpha edges
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);

  // First pass at high quality (visually lossless for photos)
  let blob = await canvasToBlob(canvas, QUALITY);

  // Only step quality down if the file is still huge
  let q = QUALITY;
  while (blob.size > MAX_OUTPUT_BYTES && q > 0.75) {
    q -= 0.05;
    blob = await canvasToBlob(canvas, q);
  }

  const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
  const optimized = new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });

  return {
    file: optimized,
    width: w,
    height: h,
    longEdge: Math.max(w, h),
    bytes: optimized.size,
  };
}

export const IMAGE_QUALITY_GUIDE = {
  targetLongEdge: TARGET_LONG_EDGE,
  minLongEdge: MIN_LONG_EDGE,
  quality: QUALITY,
  format: 'Original preserved when possible; else JPG (sRGB) at 95%',
} as const;