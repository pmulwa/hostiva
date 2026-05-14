import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle2, UserCheck, Undo2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface HostCheckInButtonProps {
  bookingId: string;
  hostId: string;
  guestId: string;
  alreadyCheckedIn: boolean;
  checkedInAt?: string | null;
  guestName?: string | null;
  onConfirmed?: () => void;
  onUndone?: () => void;
}

/**
 * Host-facing "Confirm guest checked in" tick button.
 * Lives in the host's chat header for the booking thread.
 * Writes bookings.actual_check_in_at and posts a system message visible to both parties.
 * Allows undoing the confirmation within 30 minutes of marking, in case it was a mistake.
 */
export function HostCheckInButton({
  bookingId,
  hostId,
  guestId,
  alreadyCheckedIn,
  checkedInAt,
  guestName,
  onConfirmed,
  onUndone,
}: HostCheckInButtonProps) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  if (alreadyCheckedIn) {
    // Undo allowed within 30 minutes of the original confirmation timestamp.
    const stampMs = checkedInAt ? new Date(checkedInAt).getTime() : 0;
    const canUndo = stampMs > 0 && Date.now() - stampMs < 30 * 60 * 1000;

    const handleUndo = async () => {
      setBusy(true);
      const { error } = await supabase
        .from('bookings')
        .update({ actual_check_in_at: null })
        .eq('id', bookingId);
      if (error) {
        toast({ title: 'Could not undo check-in', description: error.message, variant: 'destructive' });
        setBusy(false);
        return;
      }
      toast({ title: 'Check-in undone', description: 'The booking is back to awaiting arrival.' });
      setBusy(false);
      onUndone?.();
    };

    const timeLabel = stampMs > 0
      ? new Date(stampMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : null;

    return (
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-green-600/30 bg-green-600/10 px-3 py-1.5 text-xs font-semibold text-green-700"
          title={timeLabel ? `Confirmed at ${timeLabel} · only you can see this` : 'Guest check-in confirmed'}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          Checked in{timeLabel ? ` · ${timeLabel}` : ''}
        </span>
        {timeLabel && (
          <span className="hidden md:inline text-[11px] text-muted-foreground italic" title="Visible only to you">
            (private to host)
          </span>
        )}
        {canUndo && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleUndo}
            disabled={busy}
            className="h-8 px-2.5 text-xs"
            title="Undo check-in (available for 30 minutes)"
          >
            <Undo2 className="w-3.5 h-3.5 mr-1" />
            {busy ? '…' : 'Undo'}
          </Button>
        )}
      </div>
    );
  }

  const handle = async () => {
    setBusy(true);
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('bookings')
      .update({ actual_check_in_at: now })
      .eq('id', bookingId);

    if (error) {
      toast({ title: 'Could not confirm check-in', description: error.message, variant: 'destructive' });
      setBusy(false);
      return;
    }

    toast({ title: 'Check-in confirmed', description: 'Marked as checked in.' });
    setBusy(false);
    onConfirmed?.();
  };

  return (
    <Button
      size="sm"
      onClick={handle}
      disabled={busy}
      className="bg-green-600 hover:bg-green-700 text-white h-8 px-3 text-xs"
      title="Tick to confirm guest has arrived"
    >
      <UserCheck className="w-3.5 h-3.5 mr-1" />
      {busy ? 'Saving…' : 'Confirm check-in'}
    </Button>
  );
}