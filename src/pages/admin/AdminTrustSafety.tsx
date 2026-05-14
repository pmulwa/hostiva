import { useEffect, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Shield, AlertTriangle, ScanFace, Ban, Save, RotateCcw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { logAdminAction } from '@/lib/audit';
import { DEFAULT_TRUST_SAFETY, type TrustSafetySettings } from '@/hooks/useTrustSafetySettings';

const num = (v: string, fallback: number) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

export default function AdminTrustSafety() {
  const { toast } = useToast();
  const [s, setS] = useState<TrustSafetySettings>(DEFAULT_TRUST_SAFETY);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('platform_controls' as any)
        .select('settings').eq('section', 'trust_safety').maybeSingle();
      if (data && (data as any).settings) {
        setS({ ...DEFAULT_TRUST_SAFETY, ...((data as any).settings as Partial<TrustSafetySettings>) });
      }
      setLoading(false);
    })();
  }, []);

  const update = <K extends keyof TrustSafetySettings>(key: K, value: TrustSafetySettings[K]) =>
    setS((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      const { data: existing } = await supabase.from('platform_controls' as any)
        .select('id').eq('section', 'trust_safety').maybeSingle();
      const { data: { user } } = await supabase.auth.getUser();
      if (existing && (existing as any).id) {
        await supabase.from('platform_controls' as any).update({ settings: s, updated_by: user?.id, updated_at: new Date().toISOString() }).eq('id', (existing as any).id);
      } else {
        await supabase.from('platform_controls' as any).insert({ section: 'trust_safety', settings: s, updated_by: user?.id });
      }
      await logAdminAction('UPDATE_TRUST_SAFETY', 'platform_controls', 'trust_safety', { settings: s });
      toast({ title: 'Saved', description: 'Trust & safety settings updated.' });
    } catch (e) {
      toast({ title: 'Save failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const resetDefaults = () => setS(DEFAULT_TRUST_SAFETY);

  if (loading) return <AdminLayout><div className="p-8">Loading…</div></AdminLayout>;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-display font-bold flex items-center gap-2">
              <Shield className="w-7 h-7 text-primary" /> Trust & Safety
            </h1>
            <p className="text-muted-foreground mt-1">Fraud scoring, anti-circumvention, sanctions screening, and force-majeure rules.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={resetDefaults}><RotateCcw className="w-4 h-4 mr-2" /> Reset</Button>
            <Button onClick={save} disabled={saving}><Save className="w-4 h-4 mr-2" /> {saving ? 'Saving…' : 'Save changes'}</Button>
          </div>
        </div>

        <Tabs defaultValue="risk" className="w-full">
          <TabsList className="grid grid-cols-4 w-full max-w-2xl">
            <TabsTrigger value="risk">Risk Scoring</TabsTrigger>
            <TabsTrigger value="strikes">Anti-Circumvention</TabsTrigger>
            <TabsTrigger value="sanctions">Sanctions & KYC</TabsTrigger>
            <TabsTrigger value="edge">Edge Cases</TabsTrigger>
          </TabsList>

          {/* RISK SCORING */}
          <TabsContent value="risk" className="mt-6 space-y-4">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                Score range is 0-100. Each booking is routed to one of four tiers based on the thresholds below.
                Scoring logic is currently <Badge variant="secondary" className="ml-1">stub mode</Badge> — admin can configure tiers; full signal calculation activates when enabled.
              </AlertDescription>
            </Alert>

            <Card>
              <CardHeader>
                <CardTitle>Tier Thresholds</CardTitle>
                <CardDescription>Score ranges that determine the action taken at checkout.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Auto-approve up to <Badge className="ml-1 bg-green-500/10 text-green-700 border-green-500/20" variant="outline">{s.risk_threshold_auto_approve}</Badge></Label>
                  </div>
                  <Slider value={[s.risk_threshold_auto_approve]} min={0} max={100} step={5} onValueChange={([v]) => update('risk_threshold_auto_approve', v)} />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Approve & flag for review up to <Badge className="ml-1 bg-amber-500/10 text-amber-700 border-amber-500/20" variant="outline">{s.risk_threshold_flag_review}</Badge></Label>
                  </div>
                  <Slider value={[s.risk_threshold_flag_review]} min={0} max={100} step={5} onValueChange={([v]) => update('risk_threshold_flag_review', v)} />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Require additional verification up to <Badge className="ml-1 bg-orange-500/10 text-orange-700 border-orange-500/20" variant="outline">{s.risk_threshold_require_verification}</Badge></Label>
                  </div>
                  <Slider value={[s.risk_threshold_require_verification]} min={0} max={100} step={5} onValueChange={([v]) => update('risk_threshold_require_verification', v)} />
                </div>

                <Separator />
                <div className="text-xs text-muted-foreground">
                  Anything above {s.risk_threshold_require_verification} is <Badge variant="destructive" className="mx-1">blocked</Badge>
                  and routed to manual review within 2 hours.
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Signal Inputs</CardTitle>
                <CardDescription>Parameters that feed the score calculation.</CardDescription>
              </CardHeader>
              <CardContent className="grid sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>High-value booking (USD)</Label>
                  <Input type="number" value={s.high_value_booking_usd} onChange={(e) => update('high_value_booking_usd', num(e.target.value, 2000))} />
                </div>
                <div className="space-y-2">
                  <Label>New account threshold (days)</Label>
                  <Input type="number" value={s.new_account_days} onChange={(e) => update('new_account_days', num(e.target.value, 30))} />
                </div>
                <div className="space-y-2">
                  <Label>Rapid booking (seconds)</Label>
                  <Input type="number" value={s.rapid_booking_seconds} onChange={(e) => update('rapid_booking_seconds', num(e.target.value, 60))} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ANTI-CIRCUMVENTION */}
          <TabsContent value="strikes" className="mt-6 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Strike Thresholds</CardTitle>
                <CardDescription>How many violations trigger each action. Messages are scanned for phone, email, URLs, and off-platform phrases.</CardDescription>
              </CardHeader>
              <CardContent className="grid sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Warn after offence #</Label>
                  <Input type="number" min={1} value={s.strike_warn_after} onChange={(e) => update('strike_warn_after', num(e.target.value, 1))} />
                  <p className="text-xs text-muted-foreground">Message delivered but flagged.</p>
                </div>
                <div className="space-y-2">
                  <Label>Block after offence #</Label>
                  <Input type="number" min={1} value={s.strike_block_after} onChange={(e) => update('strike_block_after', num(e.target.value, 2))} />
                  <p className="text-xs text-muted-foreground">Message blocked, host warned.</p>
                </div>
                <div className="space-y-2">
                  <Label>Suspend after offence #</Label>
                  <Input type="number" min={1} value={s.strike_suspend_after} onChange={(e) => update('strike_suspend_after', num(e.target.value, 3))} />
                  <p className="text-xs text-muted-foreground">Account suspended pending review.</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* SANCTIONS & KYC */}
          <TabsContent value="sanctions" className="mt-6 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle><ScanFace className="w-5 h-5 inline mr-2" /> Verification Requirements</CardTitle>
                <CardDescription>Identity, tax, and sanctions screening rules.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div><Label>Guest ID verification required</Label><p className="text-xs text-muted-foreground">Identity check; no criminal background check.</p></div>
                  <Switch checked={s.guest_id_verification_required} onCheckedChange={(v) => update('guest_id_verification_required', v)} />
                </div>
                <div className="flex items-center justify-between">
                  <div><Label>Host ID verification required</Label><p className="text-xs text-muted-foreground">Government-issued ID required to list a property.</p></div>
                  <Switch checked={s.host_id_verification_required} onCheckedChange={(v) => update('host_id_verification_required', v)} />
                </div>
                <div className="flex items-center justify-between">
                  <div><Label>Host tax ID required</Label><p className="text-xs text-muted-foreground">Required for hosts before payouts are released.</p></div>
                  <Switch checked={s.host_tax_id_required} onCheckedChange={(v) => update('host_tax_id_required', v)} />
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div><Label>Sanctions screening enabled</Label><p className="text-xs text-muted-foreground">Daily check against OFAC, UN, EU lists.</p></div>
                  <Switch checked={s.sanctions_screening_enabled} onCheckedChange={(v) => update('sanctions_screening_enabled', v)} />
                </div>
                <div className="flex items-center justify-between">
                  <div><Label className="flex items-center gap-2"><Ban className="w-4 h-4 text-destructive" /> Auto-freeze on match</Label><p className="text-xs text-muted-foreground">Account is frozen pending review when a match is detected.</p></div>
                  <Switch checked={s.sanctions_auto_freeze} onCheckedChange={(v) => update('sanctions_auto_freeze', v)} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* EDGE CASES */}
          <TabsContent value="edge" className="mt-6 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Rebooking Guarantee</CardTitle>
                <CardDescription>Triggered when a guest cannot enter the property after check-in.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label>Rebooking guarantee enabled</Label>
                  <Switch checked={s.rebooking_guarantee_enabled} onCheckedChange={(v) => update('rebooking_guarantee_enabled', v)} />
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Host unresponsive timeout (minutes)</Label>
                    <Input type="number" value={s.rebooking_unresponsive_minutes} onChange={(e) => update('rebooking_unresponsive_minutes', num(e.target.value, 60))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Refund/relocate after (hours)</Label>
                    <Input type="number" value={s.rebooking_unresolved_hours} onChange={(e) => update('rebooking_unresolved_hours', num(e.target.value, 3))} />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Force Majeure & Disasters</CardTitle>
                <CardDescription>Compensation paid to hosts when bookings cancel due to qualifying events.</CardDescription>
              </CardHeader>
              <CardContent className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Force majeure host comp %</Label>
                  <Input type="number" min={0} max={100} value={s.force_majeure_host_compensation_pct} onChange={(e) => update('force_majeure_host_compensation_pct', num(e.target.value, 50))} />
                  <p className="text-xs text-muted-foreground">% of subtotal paid to host from Trust Fund.</p>
                </div>
                <div className="space-y-2">
                  <Label>Property unavailable host comp %</Label>
                  <Input type="number" min={0} max={100} value={s.force_majeure_property_unavailable_pct} onChange={(e) => update('force_majeure_property_unavailable_pct', num(e.target.value, 50))} />
                  <p className="text-xs text-muted-foreground">When local regulation bans short-term rentals.</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Chargebacks</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Platform absorbs lost chargebacks</Label>
                    <p className="text-xs text-muted-foreground">If turned off, the loss is clawed back from the host. (Default: platform absorbs as a trust investment.)</p>
                  </div>
                  <Switch checked={s.chargeback_absorbed_by_platform} onCheckedChange={(v) => update('chargeback_absorbed_by_platform', v)} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}