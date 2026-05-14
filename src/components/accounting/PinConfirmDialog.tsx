import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ShieldAlert } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirmed: () => void | Promise<void>;
}

/**
 * Reusable PIN gate for sensitive accounting actions (e.g. deletions).
 * Verifies via the same brute-force-protected RPC used by the main unlock screen.
 */
export function PinConfirmDialog({
  open, onOpenChange, title = 'Confirm with your PIN',
  description = 'For your safety, enter your accounting PIN to continue.',
  confirmLabel = 'Confirm', destructive = true, onConfirmed,
}: Props) {
  const { toast } = useToast();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => { setPin(''); setBusy(false); };

  const handleConfirm = async () => {
    if (!/^\d{4,12}$/.test(pin)) {
      toast({ title: 'Enter your PIN', variant: 'destructive' });
      return;
    }
    setBusy(true);
    const { data, error } = await (supabase as any).rpc('acct_verify_account_pin_v2', { p_pin: pin });
    if (error) {
      setBusy(false);
      toast({ title: 'Locked out', description: error.message, variant: 'destructive' });
      return;
    }
    const r = data as any;
    if (!r?.ok) {
      setBusy(false);
      const left = r?.attempts_remaining ?? 0;
      toast({
        title: 'Wrong PIN',
        description: r?.locked_until
          ? 'Too many failed attempts — locked.'
          : `${left} attempt${left === 1 ? '' : 's'} remaining.`,
        variant: 'destructive',
      });
      setPin('');
      return;
    }
    try {
      await onConfirmed();
      reset();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: 'Action failed', description: e?.message ?? String(e), variant: 'destructive' });
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-destructive" /> {title}
          </AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <Alert variant={destructive ? 'destructive' : 'default'}>
          <AlertDescription className="text-xs">
            This action cannot be undone. Wrong PINs count toward the 5-attempt lockout.
          </AlertDescription>
        </Alert>
        <div className="space-y-2">
          <Label>Accounting PIN</Label>
          <Input
            type="password" inputMode="numeric" autoComplete="off" maxLength={12}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && !busy && handleConfirm()}
            autoFocus
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); handleConfirm(); }}
            disabled={busy}
            className={destructive ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined}
          >
            {busy ? 'Verifying…' : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}