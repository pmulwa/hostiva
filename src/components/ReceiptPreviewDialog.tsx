import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertTriangle, Download, Eye, Loader2, Lock } from 'lucide-react';
import { generateReceiptPdf, generateRichBookingQr, type ReceiptData } from '@/lib/generateReceiptPdf';
import { persistReceiptDownload } from '@/lib/receiptLock';
import { toast } from 'sonner';

interface ReceiptPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingId: string;
  receiptData: ReceiptData | null;
  onDownloaded?: () => void;
}

export function ReceiptPreviewDialog({
  open,
  onOpenChange,
  bookingId,
  receiptData,
  onDownloaded,
}: ReceiptPreviewDialogProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!open || !receiptData) {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
      }
      setAcknowledged(false);
      return;
    }
    let cancelled = false;
    setGenerating(true);
    (async () => {
      try {
        const bookingUrl = window.location.origin + '/booking-confirmation/' + bookingId;
        let qrDataUrl: string | null = null;
        try {
          qrDataUrl = await generateRichBookingQr(receiptData, bookingUrl);
        } catch {
          qrDataUrl = null;
        }
        if (cancelled) return;
        const doc = await generateReceiptPdf({ ...receiptData, qrDataUrl, bookingUrl }, { preview: true });
        const blob = doc.output('blob');
        const url = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setPreviewUrl(url);
      } catch (err) {
        console.error('Receipt preview failed:', err);
        toast.error('Could not generate receipt preview');
      } finally {
        if (!cancelled) setGenerating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, receiptData, bookingId]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Block print/save keyboard shortcuts
  useEffect(() => {
    if (!open) return;
    const block = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (k === 's' || k === 'p')) {
        e.preventDefault();
        e.stopPropagation();
        toast.warning('Printing and saving are disabled. Use "Confirm & Download" to get your receipt.');
      }
    };
    const blockPrint = () => {
      toast.warning('Printing is disabled for this receipt.');
    };
    window.addEventListener('keydown', block, true);
    window.addEventListener('beforeprint', blockPrint);
    return () => {
      window.removeEventListener('keydown', block, true);
      window.removeEventListener('beforeprint', blockPrint);
    };
  }, [open]);

  const fileName = useMemo(
    () => (receiptData ? 'Hostiva-Receipt-' + receiptData.bookingCode + '.pdf' : 'Hostiva-Receipt.pdf'),
    [receiptData]
  );

  const handleConfirmDownload = async () => {
    if (!receiptData) return;
    try {
      const bookingUrl = window.location.origin + '/booking-confirmation/' + bookingId;
      let qrDataUrl: string | null = null;
      try {
        qrDataUrl = await generateRichBookingQr(receiptData, bookingUrl);
      } catch {
        qrDataUrl = null;
      }
      const doc = await generateReceiptPdf({ ...receiptData, qrDataUrl, bookingUrl }, { preview: false });
      doc.save(fileName);
      await persistReceiptDownload(bookingId);
      toast.success('Receipt downloaded — booking is now non-cancellable');
      onDownloaded?.();
      onOpenChange(false);
    } catch (err) {
      console.error('Receipt generation failed:', err);
      toast.error('Could not generate receipt');
    }
  };

  const iframeSrc = previewUrl
    ? previewUrl + '#toolbar=0&navpanes=0&scrollbar=0&statusbar=0&messages=0&view=FitH'
    : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[92vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Eye className="w-5 h-5 text-primary" />
            Receipt Preview
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase">
              <Lock className="w-3 h-3" /> Preview Only — Download Disabled
            </span>
          </DialogTitle>
          <DialogDescription>
            This is a watermarked preview. Use the
            <strong> Confirm &amp; Download </strong> button below to obtain the official receipt.
          </DialogDescription>
        </DialogHeader>

        {/* Warning */}
        <div className="px-6 pt-4">
          <Alert className="border-destructive/50 bg-destructive/5">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <AlertTitle className="text-destructive font-semibold">
              Important — downloading is final
            </AlertTitle>
            <AlertDescription className="text-destructive/90 space-y-1.5 mt-1">
              <p>
                Once you download this receipt, your booking is treated as <strong>finalised</strong>.
              </p>
              <ul className="list-disc list-inside text-sm space-y-0.5">
                <li>You will <strong>no longer be able to cancel</strong> this booking.</li>
                <li>If you still cancel through the host, you will receive a <strong>0% refund</strong>.</li>
                <li>The receipt becomes a binding record of payment for tax and accounting.</li>
              </ul>
              <p className="text-sm pt-1">
                If you might still need to cancel, please <strong>do not download</strong> the receipt yet.
              </p>
            </AlertDescription>
          </Alert>
        </div>

        {/* Preview — right-click and drag disabled */}
        <div
          className="flex-1 overflow-hidden px-6 py-4 min-h-[40vh]"
          onContextMenu={(e) => {
            e.preventDefault();
            toast.warning('Right-click is disabled in preview.');
          }}
          onDragStart={(e) => e.preventDefault()}
          style={{ userSelect: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}
        >
          <div className="w-full h-full rounded-lg border bg-muted/30 overflow-hidden relative">
            {generating || !previewUrl ? (
              <div className="w-full h-full flex items-center justify-center">
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <p className="text-sm">Preparing receipt preview…</p>
                </div>
              </div>
            ) : (
              <>
                <iframe
                  src={iframeSrc}
                  title="Receipt preview"
                  className="w-full h-full min-h-[50vh]"
                />
                <div className="pointer-events-none absolute top-2 right-2 rounded-md bg-destructive text-destructive-foreground px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase shadow-md">
                  Preview
                </div>
                {/* Transparent overlay blocks right-click inside the PDF iframe */}
                <div
                  className="absolute inset-0 z-10"
                  onContextMenu={(e) => {
                    e.preventDefault();
                    toast.warning('Right-click is disabled in preview.');
                  }}
                  style={{ background: 'transparent' }}
                />
              </>
            )}
          </div>
        </div>

        {/* Acknowledgement + actions */}
        <DialogFooter className="px-6 pb-6 pt-3 border-t flex-col sm:flex-col gap-3 sm:gap-3">
          <label className="flex items-start gap-2.5 text-sm cursor-pointer select-none">
            <Checkbox
              id="receipt-ack"
              checked={acknowledged}
              onCheckedChange={(v) => setAcknowledged(Boolean(v))}
              className="mt-0.5"
            />
            <span className="text-foreground/90 leading-snug">
              I understand that downloading this receipt <strong>cancels my right to a refund</strong>{' '}
              and that this booking will be locked from cancellation.
            </span>
          </label>
          <div className="flex flex-col sm:flex-row gap-2 w-full">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
            >
              Close Preview
            </Button>
            <Button
              className="flex-1 gap-2"
              disabled={!acknowledged || generating || !previewUrl}
              onClick={handleConfirmDownload}
            >
              <Download className="w-4 h-4" />
              Confirm &amp; Download
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}