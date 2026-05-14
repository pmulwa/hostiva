import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Calendar, DollarSign, Sparkles } from 'lucide-react';
import type { CancellationOutcome } from '@/lib/cancellation/engine';
import { fmtMoney } from '@/lib/accounting/money';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  outcome: CancellationOutcome;
  guestName: string;
  hoursUntilCheckIn: number;
  currency?: string;
  onEnableLastMinute?: () => void;
}

export function HostCancellationSummary({
  open, onOpenChange, outcome, guestName, hoursUntilCheckIn, currency = 'USD', onEnableLastMinute,
}: Props) {
  const fmt = (v: number) => fmtMoney(v, currency);
  const cancelledLabel = hoursUntilCheckIn < 0
    ? `${Math.abs(Math.round(hoursUntilCheckIn))} hours after check-in`
    : `${Math.round(hoursUntilCheckIn)} hours before check-in`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <Badge variant="outline" className="self-start font-mono text-xs">{outcome.tierLabel}</Badge>
          <DialogTitle>Booking cancelled — Payout summary</DialogTitle>
          <DialogDescription>
            Guest: <span className="font-medium text-foreground">{guestName}</span> · Cancelled {cancelledLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold flex items-center gap-1.5"><DollarSign className="w-4 h-4" />Your payout</span>
            <span className="text-2xl font-bold tabular-nums">{fmt(outcome.hostPayout)}</span>
          </div>
          <Separator className="mb-3" />
          <div className="space-y-1.5 text-sm">
            {outcome.breakdown.filter(b => b.kind === 'payout').map((line, i) => (
              <div key={i} className="flex justify-between">
                <span className="text-muted-foreground">{line.label}</span>
                <span className="tabular-nums">{fmt(line.amount)}</span>
              </div>
            ))}
          </div>
        </div>

        {outcome.hostPenalty > 0 && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="font-semibold text-destructive mb-1">Penalty</p>
            <p className="text-xs text-muted-foreground">
              A penalty of {fmt(outcome.hostPenalty)} will be deducted from your next payout.
            </p>
            {outcome.reliabilityImpact !== 0 && (
              <p className="text-xs text-muted-foreground mt-1">Reliability score impact: {outcome.reliabilityImpact} points.</p>
            )}
          </div>
        )}

        <div className="rounded-lg border border-border p-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" /> Calendar freed
          </p>
          <p className="text-sm text-muted-foreground">Dates have been released for rebooking.</p>
          {onEnableLastMinute && (
            <button
              onClick={onEnableLastMinute}
              className="mt-2 text-xs text-primary font-medium hover:underline inline-flex items-center gap-1"
            >
              <Sparkles className="w-3 h-3" /> Enable last-minute discount to rebook
            </button>
          )}
        </div>

        {outcome.notes.length > 0 && (
          <p className="text-xs text-muted-foreground">{outcome.notes.join(' ')}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
