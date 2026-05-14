import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { KeyRound, Loader2, Pencil, HandHelping } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { format } from 'date-fns';

/**
 * Booking-thread panel for sharing physical check-in details.
 *
 * Host-only UI. The guest never sees this panel — they receive the
 * check-in details (or assisted-check-in notice) as a system message in
 * the booking thread once the host shares them.
 *
 * Mutual exclusivity: a stay is either a self-service check-in (door code
 * / key / wifi / parking / instructions) OR an assisted check-in (host
 * meets the guest in person). Toggling "Assisted check-in" ON disables
 * the self-service form and the "Share with guest" button, and
 * immediately notifies the guest that the host will meet them in person.
 */
export function CheckInDetailsPanel({
  bookingId,
  hostId,
  guestId,
  currentUserId,
}: {
  bookingId: string;
  hostId: string;
  guestId: string;
  currentUserId: string;
}) {
  const { toast } = useToast();
  const isHost = currentUserId === hostId;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [assistedNotifying, setAssistedNotifying] = useState(false);
  const [row, setRow] = useState<{
    id?: string;
    access_code: string;
    key_location: string;
    wifi_name: string;
    wifi_password: string;
    parking_info: string;
    special_instructions: string;
    is_assisted: boolean;
    assisted_notes: string;
    shared_at: string | null;
    guest_confirmed_at: string | null;
  }>({
    access_code: '',
    key_location: '',
    wifi_name: '',
    wifi_password: '',
    parking_info: '',
    special_instructions: '',
    is_assisted: false,
    assisted_notes: '',
    shared_at: null,
    guest_confirmed_at: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('booking_check_in_details')
        .select('*')
        .eq('booking_id', bookingId)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setRow({
          id: data.id,
          access_code: data.access_code ?? '',
          key_location: data.key_location ?? '',
          wifi_name: data.wifi_name ?? '',
          wifi_password: data.wifi_password ?? '',
          parking_info: data.parking_info ?? '',
          special_instructions: data.special_instructions ?? '',
          is_assisted: (data as any).is_assisted ?? false,
          assisted_notes: (data as any).assisted_notes ?? '',
          shared_at: data.shared_at,
          guest_confirmed_at: data.guest_confirmed_at,
        });
      } else if (isHost) {
        // Host opens the panel for the first time — start in edit mode.
        setEditing(true);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [bookingId, isHost]);

  // Guest never sees this panel. Details (or the assisted-check-in
  // notice) are delivered as a system message in the booking thread.
  if (!isHost) return null;

  const save = async () => {
    if (row.is_assisted) return; // guarded by UI; assisted flow uses notifyAssisted()
    setSaving(true);
    const payload = {
      booking_id: bookingId,
      host_id: hostId,
      guest_id: guestId,
      access_code: row.access_code || null,
      key_location: row.key_location || null,
      wifi_name: row.wifi_name || null,
      wifi_password: row.wifi_password || null,
      parking_info: row.parking_info || null,
      special_instructions: row.special_instructions || null,
      is_assisted: false,
      assisted_notes: null,
      shared_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from('booking_check_in_details')
      .upsert(payload as any, { onConflict: 'booking_id' });
    setSaving(false);
    if (error) {
      toast({ title: 'Could not save', description: error.message, variant: 'destructive' });
      return;
    }
    setRow((r) => ({ ...r, shared_at: payload.shared_at }));
    setEditing(false);
    toast({ title: 'Check-in details shared with guest' });

    // System message in the booking thread — this is the ONLY place the
    // guest sees the details. Wifi name/password are labelled explicitly.
    const summaryLines: string[] = [];
    if (row.access_code) summaryLines.push(`• Access / door code: ${row.access_code}`);
    if (row.key_location) summaryLines.push(`• Where to find the key: ${row.key_location}`);
    if (row.wifi_name) summaryLines.push(`• Wifi name: ${row.wifi_name}`);
    if (row.wifi_password) summaryLines.push(`• Wifi password: ${row.wifi_password}`);
    if (row.parking_info) summaryLines.push(`• Parking: ${row.parking_info}`);
    if (row.special_instructions) summaryLines.push(`• Special instructions: ${row.special_instructions}`);
    const header = '🔑 The host has shared check-in details for your stay.';
    const body = summaryLines.length ? `${header}\n\n${summaryLines.join('\n')}` : header;
    await supabase.from('messages').insert({
      booking_id: bookingId,
      sender_id: hostId,
      receiver_id: guestId,
      content: body,
      message_type: 'system',
    });
  };

  /**
   * Persist `is_assisted=true` and notify the guest immediately. Self-
   * service fields are cleared on the row to keep state coherent.
   */
  const notifyAssisted = async (notes: string) => {
    setAssistedNotifying(true);
    const ts = new Date().toISOString();
    const payload = {
      booking_id: bookingId,
      host_id: hostId,
      guest_id: guestId,
      access_code: null,
      key_location: null,
      wifi_name: null,
      wifi_password: null,
      parking_info: null,
      special_instructions: null,
      is_assisted: true,
      assisted_notes: notes || null,
      shared_at: ts,
    };
    const { error } = await supabase
      .from('booking_check_in_details')
      .upsert(payload as any, { onConflict: 'booking_id' });
    if (error) {
      setAssistedNotifying(false);
      toast({ title: 'Could not notify guest', description: error.message, variant: 'destructive' });
      return;
    }
    setRow((r) => ({ ...r, shared_at: ts, is_assisted: true, assisted_notes: notes }));
    const body =
      `🤝 Assisted check-in — the host will meet you in person at arrival.` +
      (notes ? `\n\nDetails from your host:\n${notes}` : '');
    await supabase.from('messages').insert({
      booking_id: bookingId,
      sender_id: hostId,
      receiver_id: guestId,
      content: body,
      message_type: 'system',
    });
    setAssistedNotifying(false);
    toast({ title: 'Guest notified', description: 'Assisted check-in message sent.' });
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading check-in details…
        </CardContent>
      </Card>
    );
  }

  // Host edit mode (or first-time setup).
  if (isHost && editing) {
    const assisted = row.is_assisted;
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-primary" /> Check-in details for the guest
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start justify-between gap-3 rounded-md border p-3 bg-muted/30">
            <div className="space-y-0.5">
              <div className="text-sm font-medium flex items-center gap-1.5">
                <HandHelping className="w-4 h-4 text-primary" /> Assisted check-in
              </div>
              <p className="text-xs text-muted-foreground">
                Turn on if you (or your team) will personally meet the guest at arrival.
                Self-service check-in fields below are disabled while this is on.
              </p>
            </div>
            <Switch
              checked={row.is_assisted}
              disabled={assistedNotifying}
              onCheckedChange={(v) => {
                setRow({ ...row, is_assisted: v });
                if (v) {
                  // Auto-notify the guest the moment assisted is turned on.
                  notifyAssisted(row.assisted_notes);
                }
              }}
            />
          </div>
          {assisted && (
            <div>
              <label className="text-xs font-medium">Assisted check-in details</label>
              <Textarea
                rows={2}
                value={row.assisted_notes}
                onChange={(e) => setRow({ ...row, assisted_notes: e.target.value })}
                onBlur={() => {
                  // Re-send / update the guest message if host edits the notes
                  // after enabling assisted mode.
                  if (assisted) notifyAssisted(row.assisted_notes);
                }}
                placeholder="e.g. I'll meet you at the front door at 3pm. Call me at +1 555 123 when you're 10 min away."
              />
              <p className="text-xs text-muted-foreground mt-1">
                The guest is notified automatically — no separate "share" step.
              </p>
            </div>
          )}
          <div className={assisted ? 'opacity-50 pointer-events-none' : ''} aria-disabled={assisted}>
            <div>
            <label className="text-xs font-medium">Access / door code</label>
            <Input value={row.access_code} disabled={assisted} onChange={(e) => setRow({ ...row, access_code: e.target.value })} placeholder="e.g. 4827#" />
            </div>
          <div className="mt-3">
            <label className="text-xs font-medium">Where to collect / find the key</label>
            <Input value={row.key_location} disabled={assisted} onChange={(e) => setRow({ ...row, key_location: e.target.value })} placeholder="e.g. Lockbox at the gate" />
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <div>
              <label className="text-xs font-medium">Wifi network</label>
              <Input value={row.wifi_name} disabled={assisted} onChange={(e) => setRow({ ...row, wifi_name: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-medium">Wifi password</label>
              <Input value={row.wifi_password} disabled={assisted} onChange={(e) => setRow({ ...row, wifi_password: e.target.value })} />
            </div>
          </div>
          <div className="mt-3">
            <label className="text-xs font-medium">Parking</label>
            <Input value={row.parking_info} disabled={assisted} onChange={(e) => setRow({ ...row, parking_info: e.target.value })} placeholder="e.g. Free street parking on the right" />
          </div>
          <div className="mt-3">
            <label className="text-xs font-medium">Special instructions</label>
            <Textarea rows={3} value={row.special_instructions} disabled={assisted} onChange={(e) => setRow({ ...row, special_instructions: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            {row.id && <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
            <Button onClick={save} disabled={saving || assisted} title={assisted ? 'Disabled — assisted check-in is on' : undefined}>
              {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <KeyRound className="w-4 h-4 mr-1" />}
              {row.id ? 'Update & re-share' : 'Share with guest'}
            </Button>
          </div>
          {assisted && (
            <p className="text-xs text-muted-foreground text-right">
              Sharing is disabled because assisted check-in is enabled — the guest has already been notified.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  // Host read-only view (post-share). Guest never reaches this branch.
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-primary" /> Check-in details
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {row.is_assisted ? (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-2.5 flex items-start gap-2">
            <HandHelping className="w-4 h-4 text-primary mt-0.5" />
            <div className="space-y-0.5">
              <div className="font-medium text-foreground">Assisted check-in enabled</div>
              <div className="text-xs text-muted-foreground">
                {row.assisted_notes || 'You will meet the guest in person at arrival.'}
              </div>
              <div className="text-xs text-muted-foreground italic">
                The guest has been notified in the booking thread.
              </div>
            </div>
          </div>
        ) : (
          <>
            {row.access_code && (
              <div>
                <div className="text-xs font-medium text-muted-foreground">Access / door code</div>
                <div className="font-mono">{row.access_code}</div>
              </div>
            )}
            {row.key_location && (
              <div>
                <div className="text-xs font-medium text-muted-foreground">Where to collect / find the key</div>
                <div>{row.key_location}</div>
              </div>
            )}
            {(row.wifi_name || row.wifi_password) && (
              <div>
                <div className="text-xs font-medium text-muted-foreground">Wifi</div>
                <div>
                  {row.wifi_name && <span>Name: <span className="font-mono">{row.wifi_name}</span></span>}
                  {row.wifi_name && row.wifi_password && <span> · </span>}
                  {row.wifi_password && <span>Password: <span className="font-mono">{row.wifi_password}</span></span>}
                </div>
              </div>
            )}
            {row.parking_info && (
              <div>
                <div className="text-xs font-medium text-muted-foreground">Parking</div>
                <div>{row.parking_info}</div>
              </div>
            )}
            {row.special_instructions && (
              <div>
                <div className="text-xs font-medium text-muted-foreground">Special instructions</div>
                <div className="whitespace-pre-wrap">{row.special_instructions}</div>
              </div>
            )}
          </>
        )}
        {row.shared_at && (
          <div className="text-xs text-muted-foreground pt-1">
            Shared with guest {format(new Date(row.shared_at), 'MMM d, HH:mm')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}