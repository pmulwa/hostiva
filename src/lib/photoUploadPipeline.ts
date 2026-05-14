/**
 * Photo upload pipeline with concurrency control + per-file progress + dedupe.
 *
 * Why limited concurrency? Browsers cap parallel HTTP/2 streams to a host,
 * and the Supabase signed-URL upload path benefits from steady throughput
 * rather than 50 parallel requests. 4 simultaneous uploads is the sweet
 * spot — measured ~3× faster than serial without timing out large files.
 */

import { supabase } from '@/integrations/supabase/client';
import { optimizeImage, type OptimizedImage } from './imageOptimizer';
import { analyzeImageQuality } from './imageQuality';

export const UPLOAD_CONCURRENCY = 4;
export const MAX_INPUT_BYTES = 50 * 1024 * 1024; // 50MB cap on raw input — phones/cameras can be big
export const MIN_LONG_EDGE = 400; // Lowered from 800px — accepts most real photos including compressed imports
export const ACCEPTED_MIME = /^image\/(jpeg|jpg|png|webp|heic|heif)$/i;

export type PhotoStatus =
  | 'queued'
  | 'validating'
  | 'optimizing'
  | 'uploading'
  | 'done'
  | 'rejected'
  | 'error';

export interface PhotoTask {
  id: string;
  file: File;
  status: PhotoStatus;
  progress: number; // 0..100
  url?: string;
  width?: number;
  height?: number;
  outputBytes?: number;
  rejectionReason?: string;
  /** SHA-256 hash of the original file bytes. Used for duplicate detection. */
  hash?: string;
  /** Non-blocking quality warnings (blurry / screenshot / too dark, …). */
  qualityWarnings?: string[];
  /** Object URL of the original file — used for the before/after preview. */
  previewBeforeUrl?: string;
  /** Object URL of the optimized output — used for the before/after preview. */
  previewAfterUrl?: string;
}

export interface UploadOptions {
  bucket: string;
  pathPrefix: string; // e.g. `properties/<userId>`
  concurrency?: number;
  onUpdate?: (task: PhotoTask) => void;
  /** Hashes that already exist on the listing — uploads matching these are rejected. */
  existingHashes?: Set<string>;
  /** Hashes uploaded earlier in the same batch — also rejected as duplicates. */
  sessionHashes?: Set<string>;
  /** Per-property quality rules. When `block_*` flags are true, matching
   *  photos are rejected before upload instead of just warning. */
  qualityRules?: QualityRules;
}

export interface QualityRules {
  min_long_edge?: number;       // px on the long edge
  min_sharpness?: number;       // Laplacian variance — higher is sharper
  flat_ratio?: number;          // override screenshot detector threshold
  block_blurry?: boolean;
  block_screenshots?: boolean;
  block_dark?: boolean;
}

export const DEFAULT_QUALITY_RULES: Required<QualityRules> = {
  min_long_edge: MIN_LONG_EDGE,
  min_sharpness: 60,
  flat_ratio: 0.45,
  block_blurry: false,
  block_screenshots: true,
  block_dark: false,
};

function mergeRules(r?: QualityRules): Required<QualityRules> {
  return { ...DEFAULT_QUALITY_RULES, ...(r || {}) };
}

function makeId(): string {
  return `pt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Compute a hex SHA-256 hash of a file's bytes via Web Crypto. */
export async function hashFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

/**
 * Synchronous validation against MIME / size before we touch canvas.
 * Returns null if OK, otherwise a human-readable rejection reason.
 */
export function preValidate(file: File): string | null {
  if (!ACCEPTED_MIME.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
    return `Unsupported format (${file.type || 'unknown'}). Use JPG, PNG, WEBP or HEIC.`;
  }
  if (file.size > MAX_INPUT_BYTES) {
    return `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — max 50 MB. Resize before uploading.`;
  }
  if (file.size < 5 * 1024) {
    return 'File is too small to be a real photo.';
  }
  return null;
}

/**
 * Run a single optimize + upload step for one task.
 * Updates `task` in place and notifies via callback.
 */
async function processOne(
  task: PhotoTask,
  opts: UploadOptions,
  emit: (t: PhotoTask) => void,
): Promise<void> {
  const reason = preValidate(task.file);
  if (reason) {
    task.status = 'rejected';
    task.rejectionReason = reason;
    task.progress = 100;
    emit(task);
    return;
  }

  // Hash + dedupe BEFORE optimization (cheap and avoids wasted work)
  task.status = 'validating';
  task.progress = 5;
  emit(task);
  try {
    if (!task.hash) task.hash = await hashFile(task.file);
  } catch {
    // Hashing failure shouldn't block — just skip dedupe for this file.
  }
  if (task.hash) {
    if (opts.existingHashes?.has(task.hash)) {
      task.status = 'rejected';
      task.rejectionReason = 'Duplicate — this exact photo is already in the listing.';
      task.progress = 100;
      emit(task);
      return;
    }
    if (opts.sessionHashes?.has(task.hash)) {
      task.status = 'rejected';
      task.rejectionReason = 'Duplicate — same image was added earlier in this batch.';
      task.progress = 100;
      emit(task);
      return;
    }
    opts.sessionHashes?.add(task.hash);
  }

  task.status = 'optimizing';
  task.progress = 15;
  emit(task);

  // Quality analysis runs in parallel with optimization since it only reads
  // the original file bytes and never blocks the upload.
  const rules = mergeRules(opts.qualityRules);
  const qualityPromise = analyzeImageQuality(task.file, {
    minSharpness: rules.min_sharpness,
    flatRatio: rules.flat_ratio,
  }).catch(() => null);

  let optimized: OptimizedImage | null = null;
  try {
    optimized = await optimizeImage(task.file);
  } catch {
    task.status = 'error';
    task.rejectionReason = 'Could not decode image.';
    task.progress = 100;
    emit(task);
    return;
  }
  if (!optimized) {
    task.status = 'rejected';
    task.rejectionReason = `Below ${rules.min_long_edge}px on the long edge — please use a sharper photo (2048px+ recommended).`;
    task.progress = 100;
    emit(task);
    return;
  }

  // Per-property minimum long-edge gate (in addition to the optimizer floor)
  if (optimized.longEdge && optimized.longEdge < rules.min_long_edge) {
    task.status = 'rejected';
    task.rejectionReason = `Below ${rules.min_long_edge}px on the long edge for this listing.`;
    task.progress = 100;
    if (task.hash) opts.sessionHashes?.delete(task.hash);
    emit(task);
    return;
  }

  // Build before/after preview URLs (caller is responsible for revoking them
  // when the task list is cleared).
  try {
    if (!task.previewBeforeUrl) task.previewBeforeUrl = URL.createObjectURL(task.file);
    if (!task.previewAfterUrl) task.previewAfterUrl = URL.createObjectURL(optimized.file);
  } catch { /* ignore — preview is non-essential */ }

  // Attach quality warnings (do not block — host can override visually).
  try {
    const q = await qualityPromise;
    if (q && q.warnings.length) task.qualityWarnings = q.warnings;
    // Per-property hard blocks
    if (q) {
      const blockedReasons: string[] = [];
      if (rules.block_blurry && q.isLikelyBlurry) blockedReasons.push('Photo is too blurry for this listing.');
      if (rules.block_screenshots && q.isLikelyScreenshot) blockedReasons.push('Screenshots are not allowed for this listing.');
      if (rules.block_dark && q.isTooDark) blockedReasons.push('Photo is too dark for this listing.');
      if (blockedReasons.length) {
        task.status = 'rejected';
        task.rejectionReason = blockedReasons.join(' ');
        task.progress = 100;
        if (task.hash) opts.sessionHashes?.delete(task.hash);
        emit(task);
        return;
      }
    }
  } catch { /* ignore */ }

  task.width = optimized.width;
  task.height = optimized.height;
  task.outputBytes = optimized.bytes;
  task.status = 'uploading';
  task.progress = 55;
  emit(task);

  // Preserve the original extension + content type when the optimizer passed
  // the file through unchanged; otherwise the optimizer will have produced a
  // .jpg re-encode.
  const outFile = optimized.file;
  const extMatch = /\.([a-z0-9]+)$/i.exec(outFile.name);
  const ext = (extMatch?.[1] || 'jpg').toLowerCase();
  const contentType = outFile.type || (ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'heic' || ext === 'heif' ? 'image/heic' : 'image/jpeg');
  const filePath = `${opts.pathPrefix}/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`;
  const { error } = await supabase.storage
    .from(opts.bucket)
    .upload(filePath, outFile, {
      contentType,
      cacheControl: '31536000',
      upsert: false,
    });

  if (error) {
    task.status = 'error';
    task.rejectionReason = error.message || 'Upload failed.';
    task.progress = 100;
    // Free the session hash so a retry is allowed
    if (task.hash) opts.sessionHashes?.delete(task.hash);
    emit(task);
    return;
  }

  const { data: urlData } = supabase.storage.from(opts.bucket).getPublicUrl(filePath);
  task.url = urlData.publicUrl;
  task.status = 'done';
  task.progress = 100;
  emit(task);
}

/**
 * Run a single task to completion. Used for one-off retries from the UI.
 */
export async function uploadOnePhoto(
  file: File,
  opts: UploadOptions,
  initial?: Partial<PhotoTask>,
): Promise<PhotoTask> {
  const task: PhotoTask = {
    id: initial?.id ?? makeId(),
    file,
    status: 'queued',
    progress: 0,
    hash: initial?.hash,
  };
  const emit = (t: PhotoTask) => opts.onUpdate?.({ ...t });
  emit(task);
  await processOne(task, opts, emit);
  return task;
}

/**
 * Upload many files with bounded concurrency. Returns when *all* tasks
 * are settled (done, rejected, or error). Tasks are mutated in place;
 * callers should keep their own state in React via onUpdate.
 */
export async function uploadPhotosConcurrent(
  files: File[],
  opts: UploadOptions,
): Promise<PhotoTask[]> {
  const tasks: PhotoTask[] = files.map((file) => ({
    id: makeId(),
    file,
    status: 'queued',
    progress: 0,
  }));

  const concurrency = Math.max(1, Math.min(opts.concurrency ?? UPLOAD_CONCURRENCY, 8));
  const emit = (t: PhotoTask) => opts.onUpdate?.({ ...t });

  // Notify initial queued state so the UI can render rows immediately
  tasks.forEach(emit);

  let cursor = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < concurrency; w++) {
    workers.push(
      (async () => {
        while (cursor < tasks.length) {
          const idx = cursor++;
          await processOne(tasks[idx], opts, emit);
        }
      })(),
    );
  }
  await Promise.all(workers);
  return tasks;
}