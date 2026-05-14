import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Upload, X, CheckCircle2, AlertCircle, Loader2, ImageIcon, Trash2, RotateCw,
  Eye, AlertTriangle,
} from 'lucide-react';
import {
  uploadPhotosConcurrent, uploadOnePhoto, preValidate, hashFile, MIN_LONG_EDGE,
  type PhotoTask, type QualityRules,
} from '@/lib/photoUploadPipeline';
import { Dialog as PreviewDialog, DialogContent as PreviewContent, DialogHeader as PreviewHeader, DialogTitle as PreviewTitle } from '@/components/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bucket: string;
  pathPrefix: string;
  onComplete: (uploadedUrls: string[]) => void;
  /** SHA-256 hex hashes of photos already on the listing (for duplicate detection). */
  existingHashes?: Set<string>;
  title?: string;
  description?: string;
  /** Per-listing quality rules (min size, block blurry/screenshots/dark). */
  qualityRules?: QualityRules;
}

const STATUS_LABEL: Record<PhotoTask['status'], string> = {
  queued: 'Queued',
  validating: 'Validating',
  optimizing: 'Optimizing',
  uploading: 'Uploading',
  done: 'Uploaded',
  rejected: 'Rejected',
  error: 'Error',
};

function formatSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export function BulkPhotoImporter({
  open, onOpenChange, bucket, pathPrefix, onComplete, existingHashes, qualityRules,
  title = 'Bulk photo import',
  description = 'Upload multiple property photos at once. Files are validated, deduplicated, compressed, and uploaded with up to 4 in parallel.',
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tasks, setTasks] = useState<PhotoTask[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [completed, setCompleted] = useState(false);

  // Hashes uploaded successfully in *this* dialog session — kept in a ref so
  // both batch + retry paths share state without re-render churn.
  const sessionHashesRef = useRef<Set<string>>(new Set());

  // Before/after preview modal state
  const [previewTask, setPreviewTask] = useState<PhotoTask | null>(null);

  // Reset session hashes whenever the dialog reopens fresh
  useEffect(() => {
    if (open && tasks.length === 0) {
      sessionHashesRef.current = new Set();
    }
  }, [open, tasks.length]);

  const counts = useMemo(() => {
    const c = { total: tasks.length, done: 0, rejected: 0, error: 0, active: 0 };
    for (const t of tasks) {
      if (t.status === 'done') c.done++;
      else if (t.status === 'rejected') c.rejected++;
      else if (t.status === 'error') c.error++;
      else c.active++;
    }
    return c;
  }, [tasks]);

  const overallProgress = useMemo(() => {
    if (tasks.length === 0) return 0;
    const sum = tasks.reduce((s, t) => s + t.progress, 0);
    return Math.round(sum / tasks.length);
  }, [tasks]);

  const handlePick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const queued: PhotoTask[] = files.map((file) => {
      const reason = preValidate(file);
      return {
        id: `pre-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        status: reason ? 'rejected' : 'queued',
        progress: reason ? 100 : 0,
        rejectionReason: reason ?? undefined,
      };
    });
    setTasks((prev) => [...prev, ...queued]);
    if (e.target) e.target.value = '';
  }, []);

  const removeTask = (id: string) => {
    setTasks((prev) => {
      const t = prev.find((x) => x.id === id);
      if (t?.hash) sessionHashesRef.current.delete(t.hash);
      return prev.filter((x) => x.id !== id);
    });
  };

  const startUpload = async () => {
    const uploadable = tasks.filter((t) => t.status !== 'rejected' && t.status !== 'done');
    if (!uploadable.length) return;
    setIsUploading(true);
    setCompleted(false);

    await uploadPhotosConcurrent(
      uploadable.map((t) => t.file),
      {
        bucket,
        pathPrefix,
        existingHashes,
        sessionHashes: sessionHashesRef.current,
        qualityRules,
        onUpdate: (updated) => {
          setTasks((prev) =>
            prev.map((t) => (t.file === updated.file ? { ...t, ...updated, id: t.id } : t)),
          );
        },
      },
    );

    setIsUploading(false);
    setCompleted(true);
  };

  /** Re-attempt a single failed/errored upload without restarting the batch. */
  const retryOne = async (id: string) => {
    const target = tasks.find((t) => t.id === id);
    if (!target || (target.status !== 'error' && target.status !== 'rejected')) return;

    // Only retry hard errors. "Rejected" duplicates / size issues require user action.
    if (target.status === 'rejected') return;

    // Free this file's hash from the session so it can re-enter
    if (target.hash) sessionHashesRef.current.delete(target.hash);

    setTasks((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, status: 'queued', progress: 0, rejectionReason: undefined } : t,
      ),
    );

    await uploadOnePhoto(
      target.file,
      {
        bucket,
        pathPrefix,
        existingHashes,
        sessionHashes: sessionHashesRef.current,
        qualityRules,
        onUpdate: (updated) => {
          setTasks((prev) =>
            prev.map((t) => (t.id === id ? { ...t, ...updated, id } : t)),
          );
        },
      },
      { id, hash: target.hash },
    );
    setCompleted(true);
  };

  /** Retry every failed (error) task in parallel-ish sequence. */
  const retryAllFailed = async () => {
    const failed = tasks.filter((t) => t.status === 'error');
    if (!failed.length) return;
    setIsUploading(true);
    for (const t of failed) {
      // Sequential keeps the per-row UI tidy; the per-file pipeline is fast
      // enough that one-by-one is fine for retry batches.
      // eslint-disable-next-line no-await-in-loop
      await retryOne(t.id);
    }
    setIsUploading(false);
  };

  const finish = () => {
    const urls = tasks.filter((t) => t.status === 'done' && t.url).map((t) => t.url!);
    onComplete(urls);
    // Release any object URLs we created for the before/after preview
    tasks.forEach((t) => {
      if (t.previewBeforeUrl) URL.revokeObjectURL(t.previewBeforeUrl);
      if (t.previewAfterUrl) URL.revokeObjectURL(t.previewAfterUrl);
    });
    setTasks([]);
    setCompleted(false);
    sessionHashesRef.current = new Set();
    onOpenChange(false);
  };

  const cancel = () => {
    if (isUploading) return;
    tasks.forEach((t) => {
      if (t.previewBeforeUrl) URL.revokeObjectURL(t.previewBeforeUrl);
      if (t.previewAfterUrl) URL.revokeObjectURL(t.previewAfterUrl);
    });
    setTasks([]);
    setCompleted(false);
    sessionHashesRef.current = new Set();
    onOpenChange(false);
  };

  const rejectedTasks = tasks.filter((t) => t.status === 'rejected' || t.status === 'error');
  const failedCount = tasks.filter((t) => t.status === 'error').length;

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => { if (!o && !isUploading) cancel(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {tasks.length === 0 ? (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-border rounded-xl p-10 text-center hover:border-primary/50 transition-colors bg-secondary/20 cursor-pointer"
          >
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
              <Upload className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="font-bold text-foreground mb-1">Click to choose photos</p>
            <p className="text-sm text-muted-foreground">
              JPG, PNG, WEBP or HEIC · max 25 MB each · min {MIN_LONG_EDGE}px on the long edge
            </p>
            <p className="text-xs text-muted-foreground mt-1">Duplicates are detected automatically.</p>
          </button>
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">
                  {counts.done}/{counts.total} uploaded
                  {counts.rejected > 0 && <span className="text-destructive ml-2">· {counts.rejected} rejected</span>}
                  {counts.error > 0 && <span className="text-destructive ml-2">· {counts.error} failed</span>}
                </span>
                <span className="text-muted-foreground">{overallProgress}%</span>
              </div>
              <Progress value={overallProgress} className="h-2" />
            </div>

            <ScrollArea className="flex-1 -mx-2 px-2 max-h-[40vh]">
              <ul className="space-y-2 py-2">
                {tasks.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center gap-3 rounded-lg border bg-card p-3"
                  >
                    <div className="w-10 h-10 rounded bg-muted flex items-center justify-center shrink-0">
                      {t.status === 'done' ? (
                        <CheckCircle2 className="w-5 h-5 text-primary" />
                      ) : t.status === 'rejected' || t.status === 'error' ? (
                        <AlertCircle className="w-5 h-5 text-destructive" />
                      ) : t.status === 'optimizing' || t.status === 'uploading' || t.status === 'validating' ? (
                        <Loader2 className="w-5 h-5 text-primary animate-spin" />
                      ) : (
                        <ImageIcon className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{t.file.name}</span>
                        <Badge variant={t.status === 'done' ? 'default' : t.status === 'rejected' || t.status === 'error' ? 'destructive' : 'secondary'} className="text-[10px] py-0 h-4">
                          {STATUS_LABEL[t.status]}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">
                        {formatSize(t.file.size)}
                        {t.width && t.height && <> · {t.width}×{t.height}</>}
                        {t.outputBytes && <> · → {formatSize(t.outputBytes)}</>}
                        {t.rejectionReason && (
                          <span className="text-destructive ml-1">· {t.rejectionReason}</span>
                        )}
                      </div>
                      {t.status !== 'done' && t.status !== 'rejected' && t.status !== 'error' && (
                        <Progress value={t.progress} className="h-1 mt-1.5" />
                      )}
                      {t.qualityWarnings && t.qualityWarnings.length > 0 && (
                        <div className="flex items-start gap-1.5 mt-1.5 text-[11px] text-amber-700 dark:text-amber-500">
                          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                          <span>{t.qualityWarnings.join(' ')}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {(t.previewBeforeUrl || t.previewAfterUrl) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setPreviewTask(t)}
                          aria-label="Preview before / after"
                          title="Compare original vs imported"
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                      )}
                      {t.status === 'error' && !isUploading && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => retryOne(t.id)}
                          aria-label="Retry upload"
                          title="Retry this upload"
                        >
                          <RotateCw className="w-4 h-4" />
                        </Button>
                      )}
                      {!isUploading && t.status !== 'done' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => removeTask(t.id)}
                          aria-label="Remove file"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </ScrollArea>

            {rejectedTasks.length > 0 && completed && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {rejectedTasks.length} file{rejectedTasks.length === 1 ? ' was' : 's were'} not uploaded.
                  {failedCount > 0
                    ? ' Click the ↻ button to retry failed uploads, or fix rejected ones and re-add.'
                    : ' Check the reasons above and re-upload after fixing them.'}
                </AlertDescription>
              </Alert>
            )}
          </>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          multiple
          className="hidden"
          onChange={handlePick}
        />

        <DialogFooter className="gap-2 sm:gap-0">
          {tasks.length > 0 && !isUploading && !completed && (
            <Button variant="outline" onClick={() => setTasks([])}>
              <Trash2 className="w-4 h-4 mr-1" />Clear
            </Button>
          )}
          {tasks.length > 0 && !isUploading && (
            <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
              Add more
            </Button>
          )}
          {completed && failedCount > 0 && !isUploading && (
            <Button variant="outline" onClick={retryAllFailed}>
              <RotateCw className="w-4 h-4 mr-1" />
              Retry {failedCount} failed
            </Button>
          )}
          {!completed ? (
            <Button
              onClick={startUpload}
              disabled={isUploading || tasks.filter((t) => t.status !== 'rejected').length === 0}
            >
              {isUploading ? (
                <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Uploading…</>
              ) : (
                <><Upload className="w-4 h-4 mr-1" />Upload {tasks.filter((t) => t.status !== 'rejected').length} photo{tasks.filter((t) => t.status !== 'rejected').length === 1 ? '' : 's'}</>
              )}
            </Button>
          ) : (
            <Button onClick={finish} disabled={isUploading}>
              Done · add {counts.done} photo{counts.done === 1 ? '' : 's'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {previewTask && (
      <PreviewDialog open={!!previewTask} onOpenChange={(o) => !o && setPreviewTask(null)}>
        <PreviewContent className="max-w-4xl">
          <PreviewHeader>
            <PreviewTitle>Before / After — {previewTask.file.name}</PreviewTitle>
          </PreviewHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Original</div>
              {previewTask.previewBeforeUrl ? (
                <img
                  src={previewTask.previewBeforeUrl}
                  alt="Original"
                  className="w-full h-auto rounded-lg border bg-muted object-contain max-h-[60vh]"
                />
              ) : (
                <div className="aspect-[3/2] rounded-lg border bg-muted flex items-center justify-center text-xs text-muted-foreground">
                  Preview unavailable
                </div>
              )}
              <div className="text-xs text-muted-foreground">{formatSize(previewTask.file.size)}</div>
            </div>
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Imported</div>
              {previewTask.previewAfterUrl ? (
                <img
                  src={previewTask.previewAfterUrl}
                  alt="Imported"
                  className="w-full h-auto rounded-lg border bg-muted object-contain max-h-[60vh]"
                />
              ) : (
                <div className="aspect-[3/2] rounded-lg border bg-muted flex items-center justify-center text-xs text-muted-foreground">
                  Not yet processed
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                {previewTask.outputBytes ? formatSize(previewTask.outputBytes) : '—'}
                {previewTask.width && previewTask.height && <> · {previewTask.width}×{previewTask.height}</>}
              </div>
            </div>
          </div>
          {previewTask.qualityWarnings && previewTask.qualityWarnings.length > 0 && (
            <Alert variant="default" className="border-amber-500/50">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription>
                <strong>Quality check:</strong> {previewTask.qualityWarnings.join(' ')}
              </AlertDescription>
            </Alert>
          )}
        </PreviewContent>
      </PreviewDialog>
    )}
    </>
  );
}

/** Helper exposed for callers that want to seed `existingHashes` from URLs they already have. */
export { hashFile };
