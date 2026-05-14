import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { KeyRound, ShieldCheck, ShieldAlert, Lock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface PinStatus {
  pin_set: boolean;
  failed_count: number;
  locked_until: string | null;
  is_locked: boolean;
}

const SESSION_KEY = 'acct_pin_unlocked_at';
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min

export function isAcctUnlocked(hostId: string): boolean {
  try {
    const raw = sessionStorage.getItem(`${SESSION_KEY}:${hostId}`);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < SESSION_TTL_MS;
  } catch { return false; }
}

export function clearAcctUnlock(hostId: string) {
  try { sessionStorage.removeItem(`${SESSION_KEY}:${hostId}`); } catch {}
}

export function AccountingPinGate({
  hostId, onUnlocked,
}: { hostId: string; onUnlocked: () => void }) {
  const { toast } = useToast();
  const [status, setStatus] = useState<PinStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Setup form
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [savingPin, setSavingPin] = useState(false);

  // Unlock form
  const [pin, setPin] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<Date | null>(null);
  const [now, setNow] = useState(Date.now());

  const refreshStatus = async () => {
    const { data, error } = await (supabase as any).rpc('acct_pin_status');
    if (error) {
      setLoading(false);
      return;
    }
    const s = data as PinStatus;
    setStatus(s);
    setLockedUntil(s?.locked_until ? new Date(s.locked_until) : null);
    setLoading(false);
  };

  useEffect(() => { refreshStatus(); }, [hostId]);

  // Tick every second so the countdown / "attempts remaining" always reflect live state
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const isLocked = lockedUntil ? lockedUntil.getTime() > now : false;
  const remainingSec = isLocked && lockedUntil ? Math.ceil((lockedUntil.getTime() - now) / 1000) : 0;
  const mm = String(Math.floor(remainingSec / 60)).padStart(2, '0');
  const ss = String(remainingSec % 60).padStart(2, '0');
  const failedCount = status?.failed_count ?? 0;
  const attemptsRemaining = Math.max(0, 5 - failedCount);

  const handleSetup = async () => {
    if (!/^\d{4,12}$/.test(newPin)) {
      toast({ title: 'PIN must be 4–12 digits', variant: 'destructive' }); return;
    }
    if (newPin !== confirmPin) {
      toast({ title: 'PINs do not match', variant: 'destructive' }); return;
    }
    setSavingPin(true);
    const { error } = await (supabase as any).rpc('acct_set_account_pin', {
      p_new_pin: newPin, p_current_pin: null,
    });
    setSavingPin(false);
    if (error) {
      toast({ title: 'Could not set PIN', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'PIN set — keep it safe' });
    try { sessionStorage.setItem(`${SESSION_KEY}:${hostId}`, String(Date.now())); } catch {}
    onUnlocked();
  };

  const handleUnlock = async () => {
    if (!/^\d{4,12}$/.test(pin)) {
      toast({ title: 'Enter your PIN', variant: 'destructive' }); return;
    }
    setVerifying(true);
    const { data, error } = await (supabase as any).rpc('acct_verify_account_pin_v2', { p_pin: pin });
    setVerifying(false);
    if (error) {
      toast({ title: 'Locked out', description: error.message, variant: 'destructive' });
      await refreshStatus();
      return;
    }
    const r = data as any;
    if (r?.ok) {
      try { sessionStorage.setItem(`${SESSION_KEY}:${hostId}`, String(Date.now())); } catch {}
      onUnlocked();
      return;
    }
    if (r?.locked_until) {
      setLockedUntil(new Date(r.locked_until));
      toast({ title: 'Locked', description: 'Too many failed attempts. Try again later.', variant: 'destructive' });
    } else {
      const left = r?.attempts_remaining ?? 0;
      toast({
        title: 'Wrong PIN',
        description: `${left} attempt${left === 1 ? '' : 's'} remaining before lockout.`,
        variant: 'destructive',
      });
    }
    setPin('');
  };

  if (loading) return <Skeleton className="h-72 w-full max-w-md mx-auto" />;

  // First-time setup
  if (!status?.pin_set) {
    return (
      <div className="max-w-md mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-primary" /> Set your accounting PIN
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <ShieldCheck className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Before you can record any accounting data, set a 4–12 digit PIN.
                You'll enter it each time you open Accounting and to perform sensitive
                actions like resetting your books. <strong>Admins cannot recover it</strong> —
                store it somewhere safe.
              </AlertDescription>
            </Alert>
            <div>
              <Label>PIN</Label>
              <Input
                type="password" inputMode="numeric" autoComplete="new-password" maxLength={12}
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                placeholder="4–12 digits"
                autoFocus
              />
            </div>
            <div>
              <Label>Confirm PIN</Label>
              <Input
                type="password" inputMode="numeric" autoComplete="new-password" maxLength={12}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && handleSetup()}
              />
            </div>
            <Button onClick={handleSetup} disabled={savingPin} className="w-full">
              {savingPin ? 'Saving…' : 'Set PIN & continue'}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Unlock screen
  return (
    <div className="max-w-md mx-auto">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Lock className="w-5 h-5 text-primary" /> Unlock Accounting
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Enter your PIN to continue. Session unlocks for 30 minutes.
          </p>

          {/* Always show lockout / attempt status */}
          {isLocked ? (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertDescription className="text-xs space-y-1">
                <div>
                  <strong>Account locked</strong> — too many failed PIN attempts.
                </div>
                <div className="font-mono text-sm">
                  Unlocks in {mm}:{ss}
                  {lockedUntil && (
                    <span className="ml-2 text-[10px] opacity-80">
                      (at {lockedUntil.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })})
                    </span>
                  )}
                </div>
                <div className="text-[10px]">
                  An admin can clear this lockout for you on request.
                </div>
              </AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <ShieldAlert className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <strong>{attemptsRemaining}</strong> of 5 attempt{attemptsRemaining === 1 ? '' : 's'} remaining
                before a 15-minute lockout.
                {failedCount > 0 && (
                  <span className="text-destructive"> {failedCount} failed so far.</span>
                )}
              </AlertDescription>
            </Alert>
          )}

          {!isLocked && (
            <>
              <div>
                <Label>PIN</Label>
                <Input
                  type="password" inputMode="numeric" autoComplete="off" maxLength={12}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
                  autoFocus
                />
              </div>
              <Button onClick={handleUnlock} disabled={verifying} className="w-full">
                {verifying ? 'Verifying…' : 'Unlock'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}