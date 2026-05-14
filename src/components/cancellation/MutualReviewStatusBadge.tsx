import { Badge } from '@/components/ui/badge';
import { CheckCircle, Hourglass } from 'lucide-react';
import { differenceInDays } from 'date-fns';

interface Props {
  state?: { mineDone: boolean; counterpartDone: boolean; windowClosesAt: string | null };
  /** Label shown when both reviews are visible (the user has rated). */
  myLabel: string;
}

/**
 * Visual status for a double-blind mutual review:
 * - both submitted  → green "Rated" badge
 * - only mine       → muted "Waiting on the other party — closes in N days" badge
 */
export function MutualReviewStatusBadge({ state, myLabel }: Props) {
  if (!state?.mineDone) return null;

  if (state.counterpartDone) {
    return (
      <Badge variant="outline" className="gap-1 text-green-600 border-green-500/30">
        <CheckCircle className="w-3.5 h-3.5" /> {myLabel}
      </Badge>
    );
  }

  const days = state.windowClosesAt
    ? Math.max(0, differenceInDays(new Date(state.windowClosesAt), new Date()))
    : null;

  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground border-muted-foreground/30" title="Reviews stay private until both parties submit or the review window closes.">
      <Hourglass className="w-3.5 h-3.5" />
      Waiting on the other party{days !== null ? ` — closes in ${days}d` : ''}
    </Badge>
  );
}