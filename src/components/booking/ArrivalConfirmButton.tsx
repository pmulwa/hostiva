import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle, KeyRound } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface ArrivalConfirmButtonProps {
  bookingId: string;
  hostId: string;
  guestId: string;
  alreadyArrived: boolean;
  onConfirmed?: () => void;
}

/**
 * Guest-facing "I've arrived" button.
 * Sets bookings.actual_check_in_at and posts a system message in the booking thread.
 * Shown only between (check_in_date - 1d) and (check_out_date + 1d) for confirmed bookings.
 */
export function ArrivalConfirmButton({
  bookingId,
  hostId,
  guestId,
  alreadyArrived,
  onConfirmed,
}: ArrivalConfirmButtonProps) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  if (alreadyArrived) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-600">
        <CheckCircle className="w-4 h-4" /> Arrival confirmed
      </span>
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
      toast({ title: 'Could not confirm arrival', description: error.message, variant: 'destructive' });
      setBusy(false);
      return;
    }

    // Always notify the host that the guest confirmed arrival — this is a
    // direct user action, not a background automation, so it is not behind a
    // toggle.
    await supabase.from('messages').insert({
      booking_id: bookingId,
      sender_id: guestId,
      receiver_id: hostId,
      content: '✅ Guest has confirmed arrival.',
      message_type: 'system',
    });

    toast({ title: 'Welcome!', description: 'Your arrival has been confirmed. Enjoy your stay.' });
    setBusy(false);
    onConfirmed?.();
  };

  return (
    <Button size="sm" onClick={handle} disabled={busy} className="bg-green-600 hover:bg-green-700 text-white">
      <KeyRound className="w-4 h-4 mr-1" /> {busy ? 'Confirming…' : "I've arrived"}
    </Button>
  );
}