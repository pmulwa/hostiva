import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ShieldCheck, AlertTriangle, Clock, Heart, ArrowRight, X, Loader2 } from 'lucide-react';
import { calculateCancellationOutcome, type CancellationInput, type CancellationOutcome, type BreakdownLine, type CancellationPolicyConfig } from '@/lib/cancellation/engine';
import { fmtMoney } from '@/lib/accounting/money';
import { useEffect, useMemo, useState } from 'react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  input: CancellationInput;
  currency?: string;
  onConfirm: (outcome: CancellationOutcome) => void | Promise<void>;
  onRequestGoodwill?: () => void;
  isSubmitting?: boolean;
  /** Optional admin-configurable policy override. Defaults are applied when omitted. */
  policy?: CancellationPolicyConfig;
  /**
   * Authoritative amount the guest originally paid (from the booking record).
   * When provided, takes precedence over the engine-derived sum so the dialog
   * always reflects the true ledger value.
   */
  originalTotalPaid?: number;
}

const KIND_STYLES: Record<BreakdownLine['kind'], string> = {
  refund: 'text-green-600',
  retain: 'text-muted-foreground',
  payout: 'text-foreground',
  penalty: 'text-destructive',
  credit: 'text-blue-600',
  absorb: 'text-purple-600',
};

export function CancellationPreviewDialog({
  open, onOpenChange, input, currency = 'USD',
  onConfirm, onRequestGoodwill, isSubmitting, policy, originalTotalPaid,
}: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Reset transient state whenever the dialog opens/closes or the booking changes
  useEffect(() => {
    if (!open) {
      setSubmitting(false);
      setErrorMsg(null);
    }
  }, [open]);

  const busy = submitting || Boolean(isSubmitting);

  const handleConfirm = async () => {
    if (busy) return;
    setErrorMsg(null);
    setSubmitting(true);
    try {
      await onConfirm(outcome);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'We could not process this cancellation. Please try again.';
      setErrorMsg(message);
    } finally {
      setSubmitting(false);
    }
  };

  const outcome = useMemo(() => {
    return calculateCancellationOutcome({ ...input, chosenOption: 'cash' }, policy);
  }, [input, policy]);

  const computedTotal = (Number(input.nightlyRate) * input.totalNights)
    + Number(input.cleaningFee ?? 0)
    + Number(input.serviceFee ?? 0)
    + Number(input.taxes ?? 0);
  const totalPaid = typeof originalTotalPaid === 'number' && originalTotalPaid > 0
    ? originalTotalPaid
    : computedTotal;

  const fmt = (v: number) => fmtMoney(v, currency);

  const trueRefundTotal = outcome.guestRefund + outcome.guestCredit;
  const nonRefundable = Math.max(0, totalPaid - trueRefundTotal);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="font-mono text-xs">{outcome.tierLabel}</Badge>
          </div>
          <DialogTitle className="text-2xl">Cancellation preview</DialogTitle>
          <DialogDescription>
            Review the math below carefully. Nothing is processed until you confirm.
          </DialogDescription>
        </DialogHeader>

        {/* Original total */}
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Original total paid</p>
          <p className="text-2xl font-bold tabular-nums">{fmt(totalPaid)}</p>
          <div className="text-xs text-muted-foreground mt-2 space-y-0.5">
            <div className="flex justify-between"><span>{input.totalNights} nights × {fmt(Number(input.nightlyRate))}</span><span className="tabular-nums">{fmt(Number(input.nightlyRate) * input.totalNights)}</span></div>
            {Number(input.cleaningFee ?? 0) > 0 && <div className="flex justify-between"><span>Cleaning fee</span><span className="tabular-nums">{fmt(Number(input.cleaningFee))}</span></div>}
            {Number(input.serviceFee ?? 0) > 0 && <div className="flex justify-between"><span>Service fee</span><span className="tabular-nums">{fmt(Number(input.serviceFee))}</span></div>}
            {Number(input.taxes ?? 0) > 0 && <div className="flex justify-between"><span>Taxes</span><span className="tabular-nums">{fmt(Number(input.taxes))}</span></div>}
          </div>
        </div>

        {/* Breakdown */}
        <div className="rounded-lg border border-border p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Itemized breakdown</p>
          <div className="space-y-1.5 text-sm">
            {outcome.breakdown.map((line, i) => (
              <div key={i} className="flex items-start justify-between gap-3">
                <span className="text-muted-foreground flex-1">{line.label}</span>
                <span className={`tabular-nums font-medium ${KIND_STYLES[line.kind]}`}>
                  {line.kind === 'refund' || line.kind === 'credit' ? '+' : ''}{fmt(line.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Summary */}
        <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-4 space-y-2">
          {outcome.guestRefund > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Cash refund to your card</span>
              <span className="text-2xl font-bold text-green-600 tabular-nums">{fmt(outcome.guestRefund)}</span>
            </div>
          )}
          {outcome.guestCredit > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Rebooking credit</span>
              <span className="text-2xl font-bold text-blue-600 tabular-nums">{fmt(outcome.guestCredit)}</span>
            </div>
          )}
          {outcome.guestRefund === 0 && outcome.guestCredit === 0 && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">You receive</span>
              <span className="text-2xl font-bold text-destructive tabular-nums">{fmt(0)}</span>
            </div>
          )}
          <Separator />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Non-refundable portion</span>
            <span className="tabular-nums">{fmt(nonRefundable)}</span>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Total value returned to you</span>
            <span className="tabular-nums font-semibold text-foreground">{fmt(trueRefundTotal)}</span>
          </div>
        </div>

        {outcome.notes.length > 0 && (
          <Alert>
            <Clock className="h-4 w-4" />
            <AlertDescription className="text-xs">
              {outcome.notes.join(' ')}
            </AlertDescription>
          </Alert>
        )}

        {errorMsg && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">{errorMsg}</AlertDescription>
          </Alert>
        )}

        {/* Goodwill option */}
        {onRequestGoodwill && outcome.tier !== 'tier1_grace' && outcome.tier !== 'tier2_early' && (
          <div className="rounded-lg border border-dashed border-border p-3 bg-muted/20">
            <div className="flex items-start gap-2">
              <Heart className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold">Need a 100% refund?</p>
                <p className="text-xs text-muted-foreground mb-2">
                  You can ask the host to approve a goodwill cancellation. If accepted, accommodation, cleaning, and taxes
                  are fully refunded — but the service fee is never refunded.
                </p>
                <Button variant="outline" size="sm" onClick={onRequestGoodwill} disabled={busy} className="h-7 text-xs">
                  Request host-approved refund <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 flex-col sm:flex-row">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Keep my booking
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={busy}
            aria-busy={busy}
            className="gap-1.5"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
            {busy ? 'Processing…' : 'Confirm Cancel'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
