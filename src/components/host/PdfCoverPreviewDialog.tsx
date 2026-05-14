import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FileText, Eye } from 'lucide-react';
import { format } from 'date-fns';

export interface PdfCoverPreviewStat {
  label: string;
  value: string;
}

export interface PdfCoverPreviewProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Brand accent: 'brand' (pink) for payouts, 'danger' (red) for penalties. */
  variant: 'brand' | 'danger';
  /** Hero card label, e.g. "Total scheduled" or "Total to deduct". */
  totalLabel: string;
  /** Hero card value, already formatted (e.g. "$1,234.56" or "-$45.00"). */
  totalValue: string;
  /** Section subtitle shown above the title. */
  subtitle: string;
  /** Big report title. */
  title: string;
  /** Optional small footnote inside the hero card. */
  footnote?: string;
  /** 2x2 stats grid. */
  stats: PdfCoverPreviewStat[];
  /** Payout-method panel. */
  methodLabel?: string;
  methodTime?: string;
  methodAccount?: string;
  /** Generated-for / metadata. */
  generatedForName?: string;
  generatedForEmail?: string;
  /** Confirm action triggers the actual download. */
  onConfirm: () => void | Promise<void>;
  /** Optional disabled state (e.g. nothing to export). */
  disabled?: boolean;
  /** Confirm button label override. */
  confirmLabel?: string;
}

/**
 * Live HTML preview of the PDF cover summary page. Mirrors `drawCoverPage()`
 * in src/pages/host/Earnings.tsx so hosts can sanity-check before downloading.
 */
export function PdfCoverPreviewDialog({
  open, onOpenChange, variant, totalLabel, totalValue, subtitle, title,
  footnote, stats, methodLabel, methodTime, methodAccount,
  generatedForName, generatedForEmail, onConfirm, disabled, confirmLabel,
}: PdfCoverPreviewProps) {
  const accent = variant === 'danger' ? '#C1121F' : '#FF385C';
  const accentTint = variant === 'danger' ? '#FFF0F3' : '#FFF5F7';

  const generatedAt = format(new Date(), "MMMM d, yyyy 'at' h:mm a");
  const tz = (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="w-5 h-5 text-primary" /> PDF cover preview
          </DialogTitle>
          <DialogDescription>
            Live preview of the cover summary page. Confirm to download the full PDF.
          </DialogDescription>
        </DialogHeader>

        {/* Cover preview — A4-ish 1:1.414 ratio, scaled down */}
        <div className="mx-auto w-full max-w-[560px]">
          <div
            className="relative bg-white rounded-lg border shadow-sm overflow-hidden text-[#111]"
            style={{ aspectRatio: '1 / 1.414' }}
          >
            {/* Top stripe */}
            <div className="absolute top-0 left-0 right-0 h-[6px]" style={{ background: accent }} />
            {/* Bottom stripe */}
            <div className="absolute bottom-0 left-0 right-0 h-[6px]" style={{ background: accent }} />

            <div className="absolute inset-0 px-6 pt-6 pb-6 flex flex-col">
              {/* Brand row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                    style={{ background: accent }}
                  >
                    H
                  </div>
                  <span className="text-xs font-bold">Hostiva</span>
                </div>
                <span className="text-[9px] uppercase tracking-wider text-neutral-500">Official Report</span>
              </div>

              {/* Title block */}
              <div className="mt-12">
                <p className="text-[10px] uppercase tracking-wider text-neutral-500">{subtitle}</p>
                <h2 className="text-xl font-bold mt-2 leading-tight">{title}</h2>
                <div className="mt-2 h-[2px] w-12" style={{ background: accent }} />
              </div>

              {/* Hero total card */}
              <div
                className="mt-5 rounded-xl p-4 text-white relative overflow-hidden"
                style={{ background: accent }}
              >
                <p className="text-[9px] uppercase tracking-wider opacity-90">{totalLabel}</p>
                <p className="text-2xl font-bold mt-1 tabular-nums">{totalValue}</p>
                {footnote && (
                  <p className="absolute right-3 bottom-2 text-[9px] opacity-90">{footnote}</p>
                )}
              </div>

              {/* Stats grid */}
              <div className="mt-4 grid grid-cols-2 gap-2">
                {stats.map((s, i) => (
                  <div
                    key={i}
                    className="rounded-md border border-neutral-200 bg-neutral-50 p-2"
                  >
                    <p className="text-[8px] uppercase tracking-wider text-neutral-500">{s.label}</p>
                    <p className="text-sm font-bold mt-0.5 tabular-nums">{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Payout method panel */}
              {methodLabel && (
                <div
                  className="mt-3 rounded-md border bg-white p-2.5"
                  style={{ borderColor: accent }}
                >
                  <p className="text-[8px] uppercase tracking-wider text-neutral-500">Payout method</p>
                  <p className="text-xs font-bold mt-0.5">{methodLabel}</p>
                  {(methodTime || methodAccount) && (
                    <p className="text-[10px] text-neutral-500 mt-0.5">
                      {[methodTime, methodAccount].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
              )}

              {/* Spacer */}
              <div className="flex-1" />

              {/* Footer metadata */}
              <div className="border-t border-neutral-200 pt-3 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[8px] uppercase tracking-wider text-neutral-500 font-bold">Generated for</p>
                  <p className="text-[11px] mt-1">{generatedForName || 'Host'}</p>
                  {generatedForEmail && (
                    <p className="text-[10px] text-neutral-500 mt-0.5 break-all">{generatedForEmail}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-[8px] uppercase tracking-wider text-neutral-500 font-bold">Document info</p>
                  <p className="text-[11px] mt-1">{generatedAt}</p>
                  <p className="text-[10px] text-neutral-500 mt-0.5">Timezone: {tz}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Page indicator */}
          <p className="text-center text-[11px] text-muted-foreground mt-2">
            Page 1 of the PDF · Itemised details follow on the next pages
          </p>
        </div>

        <div
          className="mt-2 rounded-lg px-3 py-2 text-xs"
          style={{ background: accentTint, color: accent }}
        >
          This live preview reflects the exact cover page that will be rendered in your downloaded PDF.
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onConfirm} disabled={disabled} className="gap-2">
            <FileText className="w-4 h-4" /> {confirmLabel || 'Download PDF'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}