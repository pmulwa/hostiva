import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import {
  Shield, Bell, Globe, Lock, DollarSign, Users, Home,
  Calculator, Check, Receipt, Loader2, Star, Save, Award, Ban, Heart, Zap
} from 'lucide-react';
import { AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { usePlatformSettings, calculateFees } from '@/hooks/usePlatformSettings';
import { useAuth } from '@/contexts/AuthContext';
import { DEFAULT_CANCELLATION_POLICY, type CancellationPolicyConfig } from '@/hooks/useCancellationPolicy';
import { usePayoutTiers, DEFAULT_PAYOUT_TIERS, type PayoutTiersConfig } from '@/hooks/usePayoutTiers';
import { TIER_COLORS } from '@/lib/payouts/tiers';
import { Link as LinkIcon } from 'lucide-react';
import { feeErrorPatch, type FeeFieldId } from '@/lib/admin/feeValidationErrors';
import { validateCancellationPolicy } from '@/lib/cancellation/ledgerValidation';

const LIVE_KEYS = new Set<string>([
  'guest_rights:messaging_before_booking',
  'guest_rights:require_phone_verification',
  'host_rights:multiple_listings',
  'host_rights:respond_to_reviews',
  'host_rights:instant_booking',
  'property_approvals:auto_approve_verified',
  'platform_settings:maintenance_mode',
  'platform_settings:allow_registrations',
  'security:force_email_verification',
]);

const LiveBadge = ({ section, k }: { section: string; k: string }) =>
  LIVE_KEYS.has(`${section}:${k}`) ? (
    <Badge variant="outline" className="ml-2 h-5 gap-1 border-primary/40 bg-primary/5 text-[10px] text-primary">
      <Zap className="h-2.5 w-2.5" /> Live
    </Badge>
  ) : (
    <Badge variant="outline" className="ml-2 h-5 text-[10px] text-muted-foreground">Soon</Badge>
  );

// Hook to manage a single control section
function useControlSection(section: string) {
  const [settings, setSettings] = useState<Record<string, boolean>>({});
  const [original, setOriginal] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();

  const fetch = useCallback(async () => {
    const { data } = await supabase
      .from('platform_controls' as any)
      .select('settings')
      .eq('section', section)
      .single();
    if (data) {
      const s = (data as any).settings as Record<string, boolean>;
      setSettings(s);
      setOriginal(s);
    }
    setLoading(false);
  }, [section]);

  useEffect(() => { fetch(); }, [fetch]);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from('platform_controls' as any)
      .update({
        settings: settings as any,
        updated_at: new Date().toISOString(),
        updated_by: user?.id,
      } as any)
      .eq('section', section);
    if (error) {
      toast({ title: 'Failed to save', description: error.message, variant: 'destructive' });
    } else {
      setOriginal(settings);
      toast({ title: 'Settings saved', description: `${section.replace('_', ' ')} settings have been updated and applied.` });
    }
    setSaving(false);
  };

  const hasChanges = JSON.stringify(settings) !== JSON.stringify(original);
  const toggle = (key: string) => setSettings(prev => ({ ...prev, [key]: !prev[key] }));

  return { settings, loading, saving, save, hasChanges, toggle };
}

export default function AdminControls() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const { settings, loading: settingsLoading, refetch } = usePlatformSettings();
  const { config: payoutTiers, refetch: refetchTiers } = usePayoutTiers();

  // ===== Per-package commission overrides =====
  const [tiersDraft, setTiersDraft] = useState<PayoutTiersConfig>(DEFAULT_PAYOUT_TIERS);
  const [savingTiers, setSavingTiers] = useState(false);
  // Field-specific errors returned by the server-side validation triggers.
  // Merged with client-side `tierErrors` so red inline messages cover both.
  const [tierServerErrors, setTierServerErrors] = useState<Partial<Record<FeeFieldId, string>>>({});
  const [feeServerErrors, setFeeServerErrors] = useState<Partial<Record<FeeFieldId, string>>>({});
  useEffect(() => { setTiersDraft(payoutTiers); }, [payoutTiers]);
  const tiersChanged = JSON.stringify(tiersDraft) !== JSON.stringify(payoutTiers);

  // ===== Validation: package rates + band thresholds =====
  const PCT_MIN = 0;
  const PCT_MAX = 30;
  const BOOKINGS_MIN = 0;
  const BOOKINGS_MAX = 500;
  const tierErrors = useMemo(() => {
    const e: {
      starter_free_pct?: string;
      starter_low_pct?: string;
      standard_pct?: string;
      starter_free_bookings?: string;
      starter_low_bookings?: string;
    } = {};
    const inRange = (n: number, lo: number, hi: number) => Number.isFinite(n) && n >= lo && n <= hi;

    // Range checks for commission percentages
    if (!inRange(tiersDraft.starter_free_pct, PCT_MIN, PCT_MAX)) e.starter_free_pct = `Must be between ${PCT_MIN}% and ${PCT_MAX}%`;
    if (!inRange(tiersDraft.starter_low_pct, PCT_MIN, PCT_MAX)) e.starter_low_pct = `Must be between ${PCT_MIN}% and ${PCT_MAX}%`;
    if (!inRange(tiersDraft.standard_pct, PCT_MIN, PCT_MAX)) e.standard_pct = `Must be between ${PCT_MIN}% and ${PCT_MAX}%`;

    // Range checks for thresholds
    if (!inRange(tiersDraft.starter_free_bookings, BOOKINGS_MIN, BOOKINGS_MAX)) e.starter_free_bookings = `Must be between ${BOOKINGS_MIN} and ${BOOKINGS_MAX}`;
    if (!inRange(tiersDraft.starter_low_bookings, BOOKINGS_MIN, BOOKINGS_MAX)) e.starter_low_bookings = `Must be between ${BOOKINGS_MIN} and ${BOOKINGS_MAX}`;

    // Band overlap check — Reduced must end strictly after Welcome
    if (!e.starter_free_bookings && !e.starter_low_bookings && tiersDraft.starter_low_bookings <= tiersDraft.starter_free_bookings) {
      e.starter_low_bookings = `Must be greater than Welcome band end (${tiersDraft.starter_free_bookings})`;
    }
    // Merge server-side validation errors so red inline messages reflect what
    // the database actually rejected when the UI was bypassed.
    return { ...tierServerErrors, ...e } as typeof e;
  }, [tiersDraft, tierServerErrors]);
  const hasTierErrors = Object.keys(tierErrors).length > 0;

  const saveTierCommissions = async () => {
    if (hasTierErrors) {
      toast({
        title: 'Cannot save: invalid configuration',
        description: Object.values(tierErrors)[0],
        variant: 'destructive',
      });
      return;
    }
    setSavingTiers(true);
    setTierServerErrors({});
    // Persist tier-specific rates + thresholds in platform_controls.payout_tiers
    const { error: ctrlErr } = await supabase
      .from('platform_controls' as any)
      .upsert({
        section: 'payout_tiers',
        settings: tiersDraft as any,
        updated_at: new Date().toISOString(),
        updated_by: user?.id,
      } as any, { onConflict: 'section' });
    // Keep platform_settings.host_commission_percent in sync with the Standard band
    let psErr: any = null;
    if (settings?.id && tiersDraft.standard_pct !== settings.host_commission_percent) {
      const { error } = await supabase
        .from('platform_settings' as any)
        .update({
          host_commission_percent: tiersDraft.standard_pct,
          updated_by: user?.id,
          updated_at: new Date().toISOString(),
        } as any)
        .eq('id', settings.id);
      psErr = error;
    }
    if (ctrlErr || psErr) {
      const patch = { ...feeErrorPatch(ctrlErr), ...feeErrorPatch(psErr) };
      setTierServerErrors(patch);
      const fields = Object.keys(patch);
      toast({
        title: fields.length > 0 ? `Server rejected ${fields.length} field${fields.length === 1 ? '' : 's'}` : 'Failed to save',
        description: Object.values(patch)[0] || (ctrlErr || psErr)?.message,
        variant: 'destructive',
      });
    } else {
      await Promise.all([refetchTiers(), refetch()]);
      setHostCommissionPercent(tiersDraft.standard_pct);
      toast({
        title: 'Package commissions saved',
        description: `Welcome ${tiersDraft.starter_free_pct}% · Reduced ${tiersDraft.starter_low_pct}% · Standard ${tiersDraft.standard_pct}%`,
      });
    }
    setSavingTiers(false);
  };

  // Fee settings
  const [serviceFeePercent, setServiceFeePercent] = useState(10);
  const [hostCommissionPercent, setHostCommissionPercent] = useState(3);
  const [serviceTaxPercent, setServiceTaxPercent] = useState(18);
  const [hostTaxPercent, setHostTaxPercent] = useState(15);
  const [reviewWindowDays, setReviewWindowDays] = useState(10);
  const [savingFees, setSavingFees] = useState(false);
  const [savingReview, setSavingReview] = useState(false);

  // Superhost criteria
  const [superhostMinRating, setSuperhostMinRating] = useState(4.8);
  const [superhostMinReviews, setSuperhostMinReviews] = useState(10);
  const [originalSuperhost, setOriginalSuperhost] = useState({ min_rating: 4.8, min_reviews: 10 });
  const [savingSuperhost, setSavingSuperhost] = useState(false);
  const [superhostLoaded, setSuperhostLoaded] = useState(false);

  useEffect(() => {
    const fetchSuperhost = async () => {
      const { data } = await supabase
        .from('platform_controls' as any)
        .select('settings')
        .eq('section', 'superhost_criteria')
        .single();
      if (data) {
        const s = (data as any).settings as any;
        setSuperhostMinRating(s.min_rating ?? 4.8);
        setSuperhostMinReviews(s.min_reviews ?? 10);
        setOriginalSuperhost({ min_rating: s.min_rating ?? 4.8, min_reviews: s.min_reviews ?? 10 });
      }
      setSuperhostLoaded(true);
    };
    fetchSuperhost();
  }, []);

  const superhostChanged = superhostMinRating !== originalSuperhost.min_rating || superhostMinReviews !== originalSuperhost.min_reviews;

  const saveSuperhost = async () => {
    setSavingSuperhost(true);
    const { error } = await supabase
      .from('platform_controls' as any)
      .update({
        settings: { min_rating: superhostMinRating, min_reviews: superhostMinReviews } as any,
        updated_at: new Date().toISOString(),
        updated_by: user?.id,
      } as any)
      .eq('section', 'superhost_criteria');
    if (error) {
      toast({ title: 'Failed to save', description: error.message, variant: 'destructive' });
    } else {
      setOriginalSuperhost({ min_rating: superhostMinRating, min_reviews: superhostMinReviews });
      toast({ title: 'Superhost criteria saved', description: `Min rating: ${superhostMinRating}, Min reviews: ${superhostMinReviews}` });
    }
    setSavingSuperhost(false);
  };

  // ===== Cancellation Policy =====
  const [cancellationPolicy, setCancellationPolicy] = useState<CancellationPolicyConfig>(DEFAULT_CANCELLATION_POLICY);
  const [originalCancellationPolicy, setOriginalCancellationPolicy] = useState<CancellationPolicyConfig>(DEFAULT_CANCELLATION_POLICY);
  const [savingCancellation, setSavingCancellation] = useState(false);
  const [cancellationLoaded, setCancellationLoaded] = useState(false);

  useEffect(() => {
    const fetchCancellation = async () => {
      const { data } = await supabase
        .from('platform_controls' as any)
        .select('settings')
        .eq('section', 'cancellation_policy')
        .maybeSingle();
      if (data && (data as any).settings) {
        const merged = { ...DEFAULT_CANCELLATION_POLICY, ...((data as any).settings as Partial<CancellationPolicyConfig>) };
        setCancellationPolicy(merged);
        setOriginalCancellationPolicy(merged);
      }
      setCancellationLoaded(true);
    };
    fetchCancellation();
  }, []);

  const cancellationChanged = JSON.stringify(cancellationPolicy) !== JSON.stringify(originalCancellationPolicy);

  const updateCancellation = <K extends keyof CancellationPolicyConfig>(key: K, value: CancellationPolicyConfig[K]) => {
    setCancellationPolicy((prev) => ({ ...prev, [key]: value }));
  };

  // Live validation — surfaces inline errors next to invalid fields
  const cancellationValidation = useMemo(
    () => validateCancellationPolicy(cancellationPolicy as unknown as Record<string, unknown>),
    [cancellationPolicy]
  );
  const cancellationFieldErrors = useMemo(() => {
    const map: Record<string, string> = {};
    for (const i of cancellationValidation.issues) map[i.field] = i.message;
    return map;
  }, [cancellationValidation]);

  const saveCancellationPolicy = async () => {
    if (!cancellationValidation.valid) {
      toast({
        title: 'Cannot save policy',
        description: cancellationValidation.issues[0]?.message ?? 'Policy contains invalid values.',
        variant: 'destructive',
      });
      return;
    }
    setSavingCancellation(true);
    const { error } = await supabase
      .from('platform_controls' as any)
      .upsert({
        section: 'cancellation_policy',
        settings: cancellationPolicy as any,
        updated_at: new Date().toISOString(),
        updated_by: user?.id,
      } as any, { onConflict: 'section' });
    if (error) {
      toast({ title: 'Failed to save', description: error.message, variant: 'destructive' });
    } else {
      setOriginalCancellationPolicy(cancellationPolicy);
      toast({ title: 'Cancellation policy saved', description: 'New refund tiers and host fines apply to all future cancellations immediately.' });
    }
    setSavingCancellation(false);
  };

  // Control sections
  const guestRights = useControlSection('guest_rights');
  const hostRights = useControlSection('host_rights');
  const propertyApprovals = useControlSection('property_approvals');
  const notifications = useControlSection('notifications');
  const platformSettings = useControlSection('platform_settings');
  const security = useControlSection('security');

  // Track original values for change detection
  const [originalFees, setOriginalFees] = useState({ serviceFeePercent: 10, hostCommissionPercent: 3, serviceTaxPercent: 18, hostTaxPercent: 15 });
  const [originalReviewWindow, setOriginalReviewWindow] = useState(10);

  useEffect(() => {
    if (settings) {
      setServiceFeePercent(settings.service_fee_percent);
      setHostCommissionPercent(settings.host_commission_percent);
      setServiceTaxPercent(settings.service_tax_percent);
      setHostTaxPercent(settings.host_tax_percent);
      setReviewWindowDays(settings.review_window_days);
      setOriginalFees({
        serviceFeePercent: settings.service_fee_percent,
        hostCommissionPercent: settings.host_commission_percent,
        serviceTaxPercent: settings.service_tax_percent,
        hostTaxPercent: settings.host_tax_percent,
      });
      setOriginalReviewWindow(settings.review_window_days);
    }
  }, [settings]);

  const feesChanged = serviceFeePercent !== originalFees.serviceFeePercent || hostCommissionPercent !== originalFees.hostCommissionPercent || serviceTaxPercent !== originalFees.serviceTaxPercent || hostTaxPercent !== originalFees.hostTaxPercent;
  const reviewChanged = reviewWindowDays !== originalReviewWindow;

  const [sampleBookingAmount, setSampleBookingAmount] = useState(100);
  // Fee-split preview: who pays the service fee in the live preview card.
  // Mirrors the host's per-property `service_fee_charged_to` setting so admins
  // can sanity-check all three modes from this screen.
  const [previewSplit, setPreviewSplit] = useState<'guest' | 'host' | 'split'>('guest');

  const feeBreakdown = useMemo(() => {
    return calculateFees(sampleBookingAmount, {
      id: '', service_fee_percent: serviceFeePercent, host_commission_percent: hostCommissionPercent,
      service_tax_percent: serviceTaxPercent, host_tax_percent: hostTaxPercent,
      review_window_days: 10, booking_id_prefix: 'BK', booking_id_length: 8,
      guest_id_prefix: 'GST', guest_id_length: 8,
      host_id_prefix: 'HST', host_id_length: 8,
      staff_id_prefix: 'STF', staff_id_length: 8,
    }, previewSplit);
  }, [sampleBookingAmount, serviceFeePercent, hostCommissionPercent, serviceTaxPercent, hostTaxPercent, previewSplit]);

  const saveFees = async () => {
    if (!settings?.id || !user) return;
    setSavingFees(true);
    setFeeServerErrors({});
    const { error } = await supabase
      .from('platform_settings' as any)
      .update({
        service_fee_percent: serviceFeePercent, host_commission_percent: hostCommissionPercent,
        service_tax_percent: serviceTaxPercent, host_tax_percent: hostTaxPercent,
        updated_by: user.id, updated_at: new Date().toISOString(),
      } as any)
      .eq('id', settings.id);
    if (error) {
      const patch = feeErrorPatch(error);
      setFeeServerErrors(patch);
      const fields = Object.keys(patch);
      toast({
        title: fields.length > 0 ? `Server rejected ${fields[0].replace(/_/g, ' ')}` : 'Failed to save',
        description: Object.values(patch)[0] || error.message,
        variant: 'destructive',
      });
    } else {
      await refetch();
      toast({ title: 'Fee thresholds saved', description: `Service fee: ${serviceFeePercent}%, Host commission: ${hostCommissionPercent}%` });
    }
    setSavingFees(false);
  };

  const saveReviewWindow = async () => {
    if (!settings?.id || !user) return;
    setSavingReview(true);
    const { error } = await supabase
      .from('platform_settings' as any)
      .update({
        review_window_days: reviewWindowDays,
        updated_by: user.id, updated_at: new Date().toISOString(),
      } as any)
      .eq('id', settings.id);
    if (error) {
      toast({ title: 'Failed to save', description: error.message, variant: 'destructive' });
    } else {
      await refetch();
      toast({ title: 'Review window saved', description: `${reviewWindowDays} days after checkout` });
    }
    setSavingReview(false);
  };

  const fmt = (n: number) => `$${n.toFixed(2)}`;

  const SaveButton = ({ onClick, saving, disabled, hasChanges }: { onClick: () => void; saving: boolean; disabled?: boolean; hasChanges: boolean }) => (
    <Button
      onClick={onClick}
      disabled={saving || disabled || !hasChanges}
      size="sm"
      className={`gap-1.5 ${hasChanges ? 'btn-primary' : ''}`}
      variant={hasChanges ? 'default' : 'outline'}
    >
      {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
      {saving ? 'Saving...' : hasChanges ? 'Save Changes' : 'Saved'}
    </Button>
  );

  return (
    <AdminLayout>
      <h1 className="font-display text-3xl font-bold mb-2">{t('admin.sidebar.controls')}</h1>
      <p className="text-muted-foreground text-sm mb-6">Platform-wide controls, fee structure, and automation settings</p>

      {/* ===== FEE CONFIGURATION ===== */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center">
            <DollarSign className="w-4 h-4 text-green-500" />
          </div>
          <h2 className="font-display text-xl font-bold">Fee & Commission Structure</h2>
          <div className="ml-auto">
            <SaveButton onClick={saveFees} saving={savingFees} disabled={settingsLoading} hasChanges={feesChanged} />
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Service Fee */}
          <Card className="card-luxury">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Receipt className="w-5 h-5 text-primary" />
                <h3 className="font-display text-base font-bold">Service Fee</h3>
                <Badge className="bg-primary/10 text-primary border-primary/30 ml-auto">{serviceFeePercent}%</Badge>
              </div>
              <div className="space-y-5">
                <div>
                  <Label className="text-sm font-medium mb-2 block">Service Fee Rate</Label>
                  <Slider value={[serviceFeePercent]} onValueChange={(v) => { setServiceFeePercent(v[0]); setFeeServerErrors(p => ({ ...p, service_fee_percent: undefined })); }} min={0} max={30} step={0.5} className="my-3" />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>0%</span><span className="font-bold text-foreground">{serviceFeePercent}%</span><span>30%</span>
                  </div>
                  {feeServerErrors.service_fee_percent && (
                    <p className="text-[11px] text-destructive mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{feeServerErrors.service_fee_percent}</p>
                  )}
                </div>
                <Separator />
                <div>
                  <Label className="text-sm font-medium mb-2 block">Tax on Service Fee (VAT/GST)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={serviceTaxPercent}
                      onChange={(e) => { setServiceTaxPercent(Math.max(0, Math.min(100, Number(e.target.value)))); setFeeServerErrors(p => ({ ...p, service_tax_percent: undefined })); }}
                      className={`w-20 text-center ${feeServerErrors.service_tax_percent ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                      min={0}
                      max={100}
                      aria-invalid={!!feeServerErrors.service_tax_percent}
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                  {feeServerErrors.service_tax_percent && (
                    <p className="text-[11px] text-destructive mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{feeServerErrors.service_tax_percent}</p>
                  )}
                </div>
                <Separator />
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground"><strong>Note:</strong> The host decides whether the guest or host pays the service fee.</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Host Commission */}
          <Card className="card-luxury">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Home className="w-5 h-5 text-amber-500" />
                <h3 className="font-display text-base font-bold">Host Commission</h3>
                <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/30 ml-auto">{hostCommissionPercent}%</Badge>
              </div>
              <div className="space-y-5">
                <div>
                  <Label className="text-sm font-medium mb-2 block">Commission Rate</Label>
                  <p className="text-xs text-muted-foreground mb-2">Platform commission deducted from host earnings</p>
                  <Slider value={[hostCommissionPercent]} onValueChange={(v) => { setHostCommissionPercent(v[0]); setFeeServerErrors(p => ({ ...p, host_commission_percent: undefined })); }} min={0} max={30} step={0.5} className="my-3" />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>0%</span><span className="font-bold text-foreground">{hostCommissionPercent}%</span><span>30%</span>
                  </div>
                  {feeServerErrors.host_commission_percent && (
                    <p className="text-[11px] text-destructive mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{feeServerErrors.host_commission_percent}</p>
                  )}
                </div>
                <Separator />
                <div>
                  <Label className="text-sm font-medium mb-2 block">Tax on Host Commission</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={hostTaxPercent}
                      onChange={(e) => { setHostTaxPercent(Math.max(0, Math.min(100, Number(e.target.value)))); setFeeServerErrors(p => ({ ...p, host_tax_percent: undefined })); }}
                      className={`w-20 text-center ${feeServerErrors.host_tax_percent ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                      min={0}
                      max={100}
                      aria-invalid={!!feeServerErrors.host_tax_percent}
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                  {feeServerErrors.host_tax_percent && (
                    <p className="text-[11px] text-destructive mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{feeServerErrors.host_tax_percent}</p>
                  )}
                </div>
                <Separator />
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">
                    <strong>How it works:</strong> When a host earns ${sampleBookingAmount}, the platform deducts {hostCommissionPercent}% ({fmt(feeBreakdown.hostCommission)}) + {hostTaxPercent}% tax ({fmt(feeBreakdown.hostCommissionTax)}) = <strong>{fmt(feeBreakdown.hostCommissionWithTax)}</strong> total.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Live Preview */}
          <Card className="card-luxury border-primary/20">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Calculator className="w-5 h-5 text-primary" />
                <h3 className="font-display text-base font-bold">Live Preview</h3>
              </div>
              <div className="mb-4">
                <Label className="text-sm font-medium mb-2 block">Sample Booking Amount</Label>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold">$</span>
                  <Input type="number" value={sampleBookingAmount} onChange={(e) => setSampleBookingAmount(Math.max(1, Number(e.target.value)))} className="text-lg font-bold" min={1} />
                </div>
              </div>
              <div className="mb-4">
                <Label className="text-sm font-medium mb-2 block">Service fee paid by</Label>
                <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-muted/50 p-1">
                  {([
                    { id: 'guest', label: 'Guest' },
                    { id: 'split', label: '50 / 50' },
                    { id: 'host', label: 'Host' },
                  ] as const).map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setPreviewSplit(opt.id)}
                      className={`text-xs font-medium rounded-md px-2 py-1.5 transition-colors ${previewSplit === opt.id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Mirrors the host's per-property setting. Hosts always pay their {hostCommissionPercent}% commission (+{hostTaxPercent}% tax) on top.
                </p>
              </div>
              <Separator className="my-4" />
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="w-4 h-4 text-primary" />
                  <span className="text-sm font-bold">Guest Pays</span>
                  <Badge variant="outline" className="text-[10px] ml-auto">Example</Badge>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 space-y-1.5">
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Booking subtotal</span><span>{fmt(feeBreakdown.subtotal)}</span></div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Service fee share (incl. tax)</span>
                    <span>{fmt(feeBreakdown.guestServiceFee)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between text-sm font-bold"><span>Total charged to guest</span><span className="text-primary">{fmt(feeBreakdown.guestTotal)}</span></div>
                </div>
              </div>
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Home className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-bold">Host Receives</span>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 space-y-1.5">
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Booking subtotal</span><span>{fmt(feeBreakdown.subtotal)}</span></div>
                  {feeBreakdown.hostServiceFee > 0 && (
                    <div className="flex justify-between text-sm text-destructive">
                      <span>− Service fee share (incl. tax)</span>
                      <span>−{fmt(feeBreakdown.hostServiceFee)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm text-destructive"><span>− Commission ({hostCommissionPercent}%)</span><span>−{fmt(feeBreakdown.hostCommission)}</span></div>
                  <div className="flex justify-between text-sm text-destructive"><span className="pl-3">− Commission tax ({hostTaxPercent}%)</span><span>−{fmt(feeBreakdown.hostCommissionTax)}</span></div>
                  <Separator />
                  <div className="flex justify-between text-sm font-bold"><span>Net payout to host</span><span className="text-green-600">{fmt(feeBreakdown.hostPayout)}</span></div>
                </div>
                {feeBreakdown.hostServiceFee > 0 && (
                  <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5">
                    <p className="text-[11px] text-amber-700 dark:text-amber-400">
                      <strong>Total deducted from host:</strong> {fmt(feeBreakdown.hostServiceFee + feeBreakdown.hostCommissionWithTax)}
                      {' '}({fmt(feeBreakdown.hostServiceFee)} fee share + {fmt(feeBreakdown.hostCommissionWithTax)} commission with tax)
                    </p>
                  </div>
                )}
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="w-4 h-4 text-green-500" />
                  <span className="text-sm font-bold">Platform Revenue</span>
                </div>
                <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-3 space-y-1.5">
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Service fee (incl. tax)</span><span>{fmt(feeBreakdown.serviceFeeWithTax)}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Host commission (incl. tax)</span><span>{fmt(feeBreakdown.hostCommissionWithTax)}</span></div>
                  <Separator />
                  <div className="flex justify-between text-sm font-bold"><span>Total platform earnings</span><span className="text-green-600">{fmt(feeBreakdown.platformRevenue)}</span></div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ===== Per-package commission overrides ===== */}
        <Card className="card-luxury mt-6 border-amber-500/30">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-1">
              <Award className="w-5 h-5 text-amber-500" />
              <h3 className="font-display text-base font-bold">Commission by Package</h3>
              <Badge variant="outline" className="ml-2 h-5 gap-1 border-primary/40 bg-primary/5 text-[10px] text-primary">
                <Zap className="h-2.5 w-2.5" /> Live
              </Badge>
              <Link
                to="/admin/payout-tiers"
                className="ml-auto text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"
              >
                <LinkIcon className="w-3 h-3" /> Open full tier console
              </Link>
            </div>
            <p className="text-xs text-muted-foreground mb-5">
              Set the host commission rate independently for each onboarding package. Hosts are auto-assigned based on
              lifetime confirmed bookings. The <strong>Standard</strong> rate is the platform-wide default and stays in
              sync with the Host Commission slider above.
            </p>

            {hasTierErrors && (
              <div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/5 p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-destructive">
                      Fix {Object.keys(tierErrors).length} {Object.keys(tierErrors).length === 1 ? 'issue' : 'issues'} before saving
                    </p>
                    <ul className="mt-1 space-y-0.5 text-[11px] text-destructive/90 list-disc list-inside">
                      {Object.entries(tierErrors).map(([k, msg]) => (
                        <li key={k}><span className="font-medium capitalize">{k.replace(/_/g, ' ')}:</span> {msg}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            <div className="grid md:grid-cols-3 gap-4">
              {/* Welcome (starter_free) */}
              <div className={`rounded-lg border p-4 transition-colors ${(tierErrors.starter_free_pct || tierErrors.starter_free_bookings) ? 'border-destructive/60 bg-destructive/5' : 'bg-card'}`}>
                <Badge variant="outline" className={`${TIER_COLORS.starter_free} text-[10px] uppercase tracking-wider`}>
                  Starter — Welcome
                </Badge>
                <p className="text-[11px] text-muted-foreground mt-2">
                  First {tiersDraft.starter_free_bookings} confirmed bookings
                </p>
                <div className="mt-3">
                  <Label className="text-xs font-medium mb-1.5 block">Commission rate</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      step="0.5"
                      min={0}
                      max={30}
                      value={tiersDraft.starter_free_pct}
                      onChange={(e) => { setTiersDraft({ ...tiersDraft, starter_free_pct: Number(e.target.value) }); setTierServerErrors(p => ({ ...p, starter_free_pct: undefined })); }}
                      className={`w-24 text-center ${tierErrors.starter_free_pct ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                      aria-invalid={!!tierErrors.starter_free_pct}
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                  {tierErrors.starter_free_pct && (
                    <p className="text-[11px] text-destructive mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{tierErrors.starter_free_pct}</p>
                  )}
                </div>
                <div className="mt-3">
                  <Label className="text-xs font-medium mb-1.5 block">Bookings in band</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      max={500}
                      value={tiersDraft.starter_free_bookings}
                      onChange={(e) => { setTiersDraft({ ...tiersDraft, starter_free_bookings: Number(e.target.value) }); setTierServerErrors(p => ({ ...p, starter_free_bookings: undefined })); }}
                      className={`w-24 text-center ${tierErrors.starter_free_bookings ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                      aria-invalid={!!tierErrors.starter_free_bookings}
                    />
                    <span className="text-sm text-muted-foreground">bookings</span>
                  </div>
                  {tierErrors.starter_free_bookings && (
                    <p className="text-[11px] text-destructive mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{tierErrors.starter_free_bookings}</p>
                  )}
                </div>
              </div>

              {/* Reduced (starter_low) */}
              <div className={`rounded-lg border p-4 transition-colors ${(tierErrors.starter_low_pct || tierErrors.starter_low_bookings) ? 'border-destructive/60 bg-destructive/5' : 'bg-card'}`}>
                <Badge variant="outline" className={`${TIER_COLORS.starter_low} text-[10px] uppercase tracking-wider`}>
                  Starter — Reduced
                </Badge>
                <p className="text-[11px] text-muted-foreground mt-2">
                  Bookings {tiersDraft.starter_free_bookings + 1}–{tiersDraft.starter_low_bookings}
                </p>
                <div className="mt-3">
                  <Label className="text-xs font-medium mb-1.5 block">Commission rate</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      step="0.5"
                      min={0}
                      max={30}
                      value={tiersDraft.starter_low_pct}
                      onChange={(e) => { setTiersDraft({ ...tiersDraft, starter_low_pct: Number(e.target.value) }); setTierServerErrors(p => ({ ...p, starter_low_pct: undefined })); }}
                      className={`w-24 text-center ${tierErrors.starter_low_pct ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                      aria-invalid={!!tierErrors.starter_low_pct}
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                  {tierErrors.starter_low_pct && (
                    <p className="text-[11px] text-destructive mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{tierErrors.starter_low_pct}</p>
                  )}
                </div>
                <div className="mt-3">
                  <Label className="text-xs font-medium mb-1.5 block">Band ends after</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      max={500}
                      value={tiersDraft.starter_low_bookings}
                      onChange={(e) => { setTiersDraft({ ...tiersDraft, starter_low_bookings: Number(e.target.value) }); setTierServerErrors(p => ({ ...p, starter_low_bookings: undefined })); }}
                      className={`w-24 text-center ${tierErrors.starter_low_bookings ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                      aria-invalid={!!tierErrors.starter_low_bookings}
                    />
                    <span className="text-sm text-muted-foreground">bookings</span>
                  </div>
                  {tierErrors.starter_low_bookings && (
                    <p className="text-[11px] text-destructive mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{tierErrors.starter_low_bookings}</p>
                  )}
                </div>
              </div>

              {/* Standard */}
              <div className={`rounded-lg border-2 p-4 transition-colors ${tierErrors.standard_pct ? 'border-destructive/60 bg-destructive/5' : 'border-primary/40 bg-primary/5'}`}>
                <Badge variant="outline" className={`${TIER_COLORS.standard} text-[10px] uppercase tracking-wider`}>
                  Standard
                </Badge>
                <p className="text-[11px] text-muted-foreground mt-2">
                  From booking {tiersDraft.starter_low_bookings + 1} onward
                </p>
                <div className="mt-3">
                  <Label className="text-xs font-medium mb-1.5 block">Commission rate</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      step="0.5"
                      min={0}
                      max={30}
                      value={tiersDraft.standard_pct}
                      onChange={(e) => { setTiersDraft({ ...tiersDraft, standard_pct: Number(e.target.value) }); setTierServerErrors(p => ({ ...p, standard_pct: undefined })); }}
                      className={`w-24 text-center ${tierErrors.standard_pct ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                      aria-invalid={!!tierErrors.standard_pct}
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                  {tierErrors.standard_pct && (
                    <p className="text-[11px] text-destructive mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{tierErrors.standard_pct}</p>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-3 pt-3 border-t">
                  Editing this also updates the platform-wide Host Commission above.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between mt-5 pt-4 border-t">
              <p className="text-xs text-muted-foreground">
                Changes apply immediately to new bookings. Existing bookings keep the rate they were created with.
              </p>
              <SaveButton
                onClick={saveTierCommissions}
                saving={savingTiers}
                hasChanges={tiersChanged && !hasTierErrors}
                disabled={hasTierErrors}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ===== REVIEW WINDOW ===== */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-rating/10 flex items-center justify-center">
            <Star className="w-4 h-4 fill-rating text-rating" />
          </div>
          <h2 className="font-display text-xl font-bold">Mutual Review System</h2>
          <div className="ml-auto">
            <SaveButton onClick={saveReviewWindow} saving={savingReview} disabled={settingsLoading} hasChanges={reviewChanged} />
          </div>
        </div>
        <Card className="card-luxury">
          <CardContent className="p-6">
            <div className="space-y-5">
              <div>
                <Label className="text-sm font-medium mb-2 block">Review Window (days after checkout)</Label>
                <p className="text-xs text-muted-foreground mb-3">Both guest and host can rate each other within this period.</p>
                <div className="flex items-center gap-3">
                  <Slider value={[reviewWindowDays]} onValueChange={(v) => setReviewWindowDays(v[0])} min={3} max={30} step={1} className="flex-1" />
                  <div className="w-16 text-center">
                    <span className="text-lg font-bold">{reviewWindowDays}</span>
                    <span className="text-xs text-muted-foreground ml-1">days</span>
                  </div>
                </div>
              </div>
              <Separator />
              <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                <p className="text-xs text-muted-foreground">
                  <strong>How it works:</strong> After checkout, both parties have {reviewWindowDays} days to submit blind reviews. Neither can see the other&apos;s review until both have submitted — or the window expires.
                </p>
                <p className="text-xs text-muted-foreground">
                  <strong>Guest rates property:</strong> Cleanliness, Host Communication, Security, Beddings Cleanliness, Location, Would You Recommend?
                </p>
                <p className="text-xs text-muted-foreground">
                  <strong>Host rates guest:</strong> How Guest Left Facility, Cleanliness & Tidiness, Communication, Respect for Property, Would You Recommend?
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ===== SUPERHOST CRITERIA ===== */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <Award className="w-4 h-4 text-amber-500" />
          </div>
          <h2 className="font-display text-xl font-bold">Superhost Criteria</h2>
          <div className="ml-auto">
            <SaveButton onClick={saveSuperhost} saving={savingSuperhost} disabled={!superhostLoaded} hasChanges={superhostChanged} />
          </div>
        </div>
        <Card className="card-luxury">
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label className="text-sm font-medium mb-2 block">Minimum Average Rating</Label>
                <p className="text-xs text-muted-foreground mb-3">Hosts must maintain at least this rating to earn Superhost status</p>
                <div className="flex items-center gap-3">
                  <Slider value={[superhostMinRating * 10]} onValueChange={(v) => setSuperhostMinRating(v[0] / 10)} min={30} max={50} step={1} className="flex-1" />
                  <div className="w-16 text-center">
                    <span className="text-lg font-bold">{superhostMinRating.toFixed(1)}</span>
                    <span className="text-xs text-muted-foreground ml-1">★</span>
                  </div>
                </div>
              </div>
              <div>
                <Label className="text-sm font-medium mb-2 block">Minimum Number of Reviews</Label>
                <p className="text-xs text-muted-foreground mb-3">Hosts need at least this many reviews to qualify</p>
                <div className="flex items-center gap-3">
                  <Slider value={[superhostMinReviews]} onValueChange={(v) => setSuperhostMinReviews(v[0])} min={1} max={50} step={1} className="flex-1" />
                  <div className="w-16 text-center">
                    <span className="text-lg font-bold">{superhostMinReviews}</span>
                    <span className="text-xs text-muted-foreground ml-1">reviews</span>
                  </div>
                </div>
              </div>
            </div>
            <Separator className="my-4" />
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-xs text-muted-foreground">
                <strong>Current criteria:</strong> A host earns Superhost badge when they have ≥ <strong>{superhostMinReviews}</strong> reviews with an average rating of ≥ <strong>{superhostMinRating.toFixed(1)}★</strong>. This is applied automatically across user management and public profiles.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ===== CANCELLATION POLICY ===== */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center">
            <Ban className="w-4 h-4 text-destructive" />
          </div>
          <h2 className="font-display text-xl font-bold">Cancellation Policy</h2>
          <Badge variant="outline" className="text-[10px]">Live engine</Badge>
          <div className="ml-auto">
            <SaveButton onClick={saveCancellationPolicy} saving={savingCancellation} disabled={!cancellationLoaded || !cancellationValidation.valid} hasChanges={cancellationChanged} />
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Tier 3 — Standard (3–7 days out) */}
          <Card className="card-luxury">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Badge variant="outline" className="font-mono text-xs">T3</Badge>
                <h3 className="font-display text-base font-bold">Standard Cancellation (3–7 days out)</h3>
              </div>
              <div className="space-y-5">
                <div>
                  <Label className="text-sm font-medium mb-2 block">Cash refund — accommodation %</Label>
                  <Slider value={[cancellationPolicy.tier3_cash_refund_pct]} onValueChange={(v) => updateCancellation('tier3_cash_refund_pct', v[0])} min={0} max={100} step={5} className="my-3" />
                  <div className="flex justify-between text-xs text-muted-foreground"><span>0%</span><span className="font-bold text-foreground">{cancellationPolicy.tier3_cash_refund_pct}%</span><span>100%</span></div>
                  {cancellationFieldErrors.tier3_cash_refund_pct && (
                    <p className="mt-1 text-xs text-destructive flex items-center gap-1" data-field-error="tier3_cash_refund_pct">
                      <AlertCircle className="w-3 h-3" /> {cancellationFieldErrors.tier3_cash_refund_pct}
                    </p>
                  )}
                </div>
                <div>
                  <Label className="text-sm font-medium mb-2 block">Host compensation %</Label>
                  <Slider value={[cancellationPolicy.tier3_host_comp_pct]} onValueChange={(v) => updateCancellation('tier3_host_comp_pct', v[0])} min={0} max={100} step={5} className="my-3" />
                  <div className="flex justify-between text-xs text-muted-foreground"><span>0%</span><span className="font-bold text-foreground">{cancellationPolicy.tier3_host_comp_pct}%</span><span>100%</span></div>
                  {cancellationFieldErrors.tier3_host_comp_pct && (
                    <p className="mt-1 text-xs text-destructive flex items-center gap-1" data-field-error="tier3_host_comp_pct">
                      <AlertCircle className="w-3 h-3" /> {cancellationFieldErrors.tier3_host_comp_pct}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Tier 4 — Late (24–72h out) */}
          <Card className="card-luxury">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Badge variant="outline" className="font-mono text-xs">T4</Badge>
                <h3 className="font-display text-base font-bold">Late Cancellation (24–72h out)</h3>
              </div>
              <div className="space-y-5">
                <div>
                  <Label className="text-sm font-medium mb-2 block">Cash refund — accommodation %</Label>
                  <Slider value={[cancellationPolicy.tier4_cash_refund_pct]} onValueChange={(v) => updateCancellation('tier4_cash_refund_pct', v[0])} min={0} max={100} step={5} className="my-3" />
                  <div className="flex justify-between text-xs text-muted-foreground"><span>0%</span><span className="font-bold text-foreground">{cancellationPolicy.tier4_cash_refund_pct}%</span><span>100%</span></div>
                  {cancellationFieldErrors.tier4_cash_refund_pct && (
                    <p className="mt-1 text-xs text-destructive flex items-center gap-1" data-field-error="tier4_cash_refund_pct">
                      <AlertCircle className="w-3 h-3" /> {cancellationFieldErrors.tier4_cash_refund_pct}
                    </p>
                  )}
                </div>
                <div>
                  <Label className="text-sm font-medium mb-2 block">Host compensation %</Label>
                  <Slider value={[cancellationPolicy.tier4_host_comp_pct]} onValueChange={(v) => updateCancellation('tier4_host_comp_pct', v[0])} min={0} max={100} step={5} className="my-3" />
                  <div className="flex justify-between text-xs text-muted-foreground"><span>0%</span><span className="font-bold text-foreground">{cancellationPolicy.tier4_host_comp_pct}%</span><span>100%</span></div>
                  {cancellationFieldErrors.tier4_host_comp_pct && (
                    <p className="mt-1 text-xs text-destructive flex items-center gap-1" data-field-error="tier4_host_comp_pct">
                      <AlertCircle className="w-3 h-3" /> {cancellationFieldErrors.tier4_host_comp_pct}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Tier 7 — Mid-stay cancellation deductions */}
          <Card className="card-luxury">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Badge variant="outline" className="font-mono text-xs">T7</Badge>
                <h3 className="font-display text-base font-bold">Mid-Stay Cancellation</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                Adjust how many <strong>buffer nights</strong> the host is paid beyond nights actually stayed,
                and how many extra unused nights are <strong>deducted from the guest refund</strong> (the “minus 1” rule).
                Saved values recalculate every future Tier 7 cancellation immediately.
              </p>
              <div className="space-y-5">
                <div>
                  <Label className="text-sm font-medium mb-2 block">Host buffer nights (charged on top of nights stayed)</Label>
                  <Slider
                    value={[cancellationPolicy.tier7_buffer_nights ?? 1]}
                    onValueChange={(v) => updateCancellation('tier7_buffer_nights', v[0])}
                    min={0} max={5} step={1} className="my-3"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>0</span>
                    <span className="font-bold text-foreground">{cancellationPolicy.tier7_buffer_nights ?? 1} night{(cancellationPolicy.tier7_buffer_nights ?? 1) === 1 ? '' : 's'}</span>
                    <span>5</span>
                  </div>
                  {cancellationFieldErrors.tier7_buffer_nights && (
                    <p className="mt-1 text-xs text-destructive flex items-center gap-1" data-field-error="tier7_buffer_nights">
                      <AlertCircle className="w-3 h-3" /> {cancellationFieldErrors.tier7_buffer_nights}
                    </p>
                  )}
                </div>
                <div>
                  <Label className="text-sm font-medium mb-2 block">Guest refund deduction (extra unused nights forfeited)</Label>
                  <Slider
                    value={[cancellationPolicy.tier7_refund_deduction_nights ?? 1]}
                    onValueChange={(v) => updateCancellation('tier7_refund_deduction_nights', v[0])}
                    min={0} max={5} step={1} className="my-3"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>0</span>
                    <span className="font-bold text-foreground">−{cancellationPolicy.tier7_refund_deduction_nights ?? 1} night{(cancellationPolicy.tier7_refund_deduction_nights ?? 1) === 1 ? '' : 's'}</span>
                    <span>5</span>
                  </div>
                  {cancellationFieldErrors.tier7_refund_deduction_nights && (
                    <p className="mt-1 text-xs text-destructive flex items-center gap-1" data-field-error="tier7_refund_deduction_nights">
                      <AlertCircle className="w-3 h-3" /> {cancellationFieldErrors.tier7_refund_deduction_nights}
                    </p>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Service fee remains <strong>non-refundable</strong> in Tier 7 (and every tier except T1/T2).
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Tier 8 — Property issue (host fault, mid-stay) */}
          <Card className="card-luxury">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Badge variant="outline" className="font-mono text-xs">T8</Badge>
                <h3 className="font-display text-base font-bold">Property Issue — Host Fault</h3>
              </div>
              <div className="space-y-5">
                <div>
                  <Label className="text-sm font-medium mb-2 block">Refund — unused nights %</Label>
                  <Slider value={[cancellationPolicy.tier8_unused_refund_pct]} onValueChange={(v) => updateCancellation('tier8_unused_refund_pct', v[0])} min={0} max={100} step={5} className="my-3" />
                  <div className="flex justify-between text-xs text-muted-foreground"><span>0%</span><span className="font-bold text-foreground">{cancellationPolicy.tier8_unused_refund_pct}%</span><span>100%</span></div>
                </div>
                <div>
                  <Label className="text-sm font-medium mb-2 block">Refund — already-stayed nights %</Label>
                  <Slider value={[cancellationPolicy.tier8_stayed_refund_pct]} onValueChange={(v) => updateCancellation('tier8_stayed_refund_pct', v[0])} min={0} max={100} step={5} className="my-3" />
                  <div className="flex justify-between text-xs text-muted-foreground"><span>0%</span><span className="font-bold text-foreground">{cancellationPolicy.tier8_stayed_refund_pct}%</span><span>100%</span></div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Tier 9 — Emergency mid-stay */}
          <Card className="card-luxury">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Badge variant="outline" className="font-mono text-xs">T9</Badge>
                <h3 className="font-display text-base font-bold">Emergency Mid-Stay</h3>
              </div>
              <div className="space-y-5">
                <div>
                  <Label className="text-sm font-medium mb-2 block">Refund — unused nights %</Label>
                  <Slider value={[cancellationPolicy.tier9_unused_refund_pct]} onValueChange={(v) => updateCancellation('tier9_unused_refund_pct', v[0])} min={0} max={100} step={5} className="my-3" />
                  <div className="flex justify-between text-xs text-muted-foreground"><span>0%</span><span className="font-bold text-foreground">{cancellationPolicy.tier9_unused_refund_pct}%</span><span>100%</span></div>
                </div>
                <div>
                  <Label className="text-sm font-medium mb-2 block">Refund — already-stayed nights %</Label>
                  <Slider value={[cancellationPolicy.tier9_stayed_refund_pct]} onValueChange={(v) => updateCancellation('tier9_stayed_refund_pct', v[0])} min={0} max={100} step={5} className="my-3" />
                  <div className="flex justify-between text-xs text-muted-foreground"><span>0%</span><span className="font-bold text-foreground">{cancellationPolicy.tier9_stayed_refund_pct}%</span><span>100%</span></div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Host cancellation fines */}
          <Card className="card-luxury">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Badge variant="outline" className="font-mono text-xs">T12–T15</Badge>
                <h3 className="font-display text-base font-bold">Host Cancellation Fines (USD)</h3>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { key: 'host_cancel_fine_30plus' as const, label: '30+ days out' },
                  { key: 'host_cancel_fine_7_30' as const, label: '7–30 days out' },
                  { key: 'host_cancel_fine_under_7' as const, label: 'Under 7 days' },
                  { key: 'host_cancel_fine_under_24h' as const, label: 'Under 24 hours' },
                ].map((row) => (
                  <div key={row.key}>
                    <Label className="text-xs font-medium mb-1.5 block">{row.label}</Label>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm text-muted-foreground">$</span>
                      <Input
                        type="number"
                        min={0}
                        max={5000}
                        value={cancellationPolicy[row.key]}
                        onChange={(e) => updateCancellation(row.key, Math.max(0, Math.min(5000, Number(e.target.value))))}
                        className="text-center h-9"
                      />
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground mt-4">Fines are deducted from the host&apos;s next payout when they cancel a confirmed booking.</p>
            </CardContent>
          </Card>

          {/* Host cancellation guest credits */}
          <Card className="card-luxury">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Badge variant="outline" className="font-mono text-xs">T12–T15</Badge>
                <h3 className="font-display text-base font-bold">Guest Credit on Host Cancel (USD)</h3>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { key: 'host_cancel_credit_30plus' as const, label: '30+ days out' },
                  { key: 'host_cancel_credit_7_30' as const, label: '7–30 days out' },
                  { key: 'host_cancel_credit_under_7' as const, label: 'Under 7 days' },
                  { key: 'host_cancel_credit_under_24h' as const, label: 'Under 24 hours' },
                ].map((row) => (
                  <div key={row.key}>
                    <Label className="text-xs font-medium mb-1.5 block">{row.label}</Label>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm text-muted-foreground">$</span>
                      <Input
                        type="number"
                        min={0}
                        max={5000}
                        value={cancellationPolicy[row.key]}
                        onChange={(e) => updateCancellation(row.key, Math.max(0, Math.min(5000, Number(e.target.value))))}
                        className="text-center h-9"
                      />
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground mt-4">Rebooking credits issued to the guest in addition to a 100% cash refund.</p>
            </CardContent>
          </Card>

          {/* Goodwill toggle */}
          <Card className="card-luxury xl:col-span-2">
            <CardContent className="p-6">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Heart className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Allow goodwill (host-approved 100% refund)</p>
                    <p className="text-xs text-muted-foreground mt-1">When enabled, guests can request a 100% refund of accommodation, cleaning, and taxes from the host. The service fee is never refunded.</p>
                  </div>
                </div>
                <Switch
                  checked={cancellationPolicy.goodwill_full_refund_enabled}
                  onCheckedChange={(v) => updateCancellation('goodwill_full_refund_enabled', v)}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 mt-4">
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">How it works:</strong> Changes take effect on the next cancellation calculation immediately —
            both the in-booking <em>Cancellation preview</em> dialog and the public <Link to="/cancellation-policy" className="underline text-primary">/cancellation-policy</Link> page read these values live.
          </p>
        </div>
      </div>

      {/* ===== TOGGLE CONTROLS ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Guest Rights */}
        <Card className="card-luxury">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <Users className="w-5 h-5 text-primary" />
              <h2 className="font-display text-lg font-bold">Guest Rights & Permissions</h2>
              <div className="ml-auto">
                <SaveButton onClick={guestRights.save} saving={guestRights.saving} hasChanges={guestRights.hasChanges} />
              </div>
            </div>
            <div className="space-y-4">
              {[
                { key: 'allow_reviews', label: 'Allow guest reviews', desc: 'Guests can leave reviews after checkout' },
                { key: 'cancellation_window', label: 'Guest cancellation window', desc: 'Allow free cancellation within 48 hours' },
                { key: 'messaging_before_booking', label: 'Guest messaging before booking', desc: 'Guests can message hosts before confirming' },
                { key: 'require_phone_verification', label: 'Require phone verification to book', desc: 'Guests must verify phone number before booking' },
              ].map((item, i) => (
                <div key={item.key}>
                  {i > 0 && <Separator className="mb-4" />}
                  <div className="flex items-center justify-between">
                    <div><p className="text-sm font-medium">{item.label}</p><p className="text-xs text-muted-foreground">{item.desc}</p></div>
                    <Switch checked={!!guestRights.settings[item.key]} onCheckedChange={() => guestRights.toggle(item.key)} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Host Rights */}
        <Card className="card-luxury">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <Home className="w-5 h-5 text-amber-500" />
              <h2 className="font-display text-lg font-bold">Host Rights & Permissions</h2>
              <div className="ml-auto">
                <SaveButton onClick={hostRights.save} saving={hostRights.saving} hasChanges={hostRights.hasChanges} />
              </div>
            </div>
            <div className="space-y-4">
              {[
                { key: 'instant_booking', label: 'Instant booking', desc: 'Hosts can enable instant booking on listings' },
                { key: 'cancellation_penalty', label: 'Host cancellation penalty', desc: 'Penalize hosts who cancel confirmed bookings' },
                { key: 'multiple_listings', label: 'Multiple property listings', desc: 'Hosts can list unlimited properties' },
                { key: 'respond_to_reviews', label: 'Respond to reviews', desc: 'Hosts can respond publicly to guest reviews' },
              ].map((item, i) => (
                <div key={item.key}>
                  {i > 0 && <Separator className="mb-4" />}
                  <div className="flex items-center justify-between">
                    <div><p className="text-sm font-medium">{item.label}</p><p className="text-xs text-muted-foreground">{item.desc}</p></div>
                    <Switch checked={!!hostRights.settings[item.key]} onCheckedChange={() => hostRights.toggle(item.key)} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Property Approvals */}
        <Card className="card-luxury">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <Shield className="w-5 h-5 text-primary" />
              <h2 className="font-display text-lg font-bold">Property Approvals</h2>
              <div className="ml-auto">
                <SaveButton onClick={propertyApprovals.save} saving={propertyApprovals.saving} hasChanges={propertyApprovals.hasChanges} />
              </div>
            </div>
            <div className="space-y-4">
              {[
                { key: 'auto_approve_verified', label: 'Auto-approve verified hosts', desc: 'Automatically approve listings from verified hosts' },
                { key: 'require_id_verification', label: 'Require ID verification for hosts', desc: 'Hosts must verify identity before listing' },
              ].map((item, i) => (
                <div key={item.key}>
                  {i > 0 && <Separator className="mb-4" />}
                  <div className="flex items-center justify-between">
                    <div><p className="text-sm font-medium">{item.label}</p><p className="text-xs text-muted-foreground">{item.desc}</p></div>
                    <Switch checked={!!propertyApprovals.settings[item.key]} onCheckedChange={() => propertyApprovals.toggle(item.key)} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Notifications */}
        <Card className="card-luxury">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <Bell className="w-5 h-5 text-primary" />
              <h2 className="font-display text-lg font-bold">Notifications</h2>
              <div className="ml-auto">
                <SaveButton onClick={notifications.save} saving={notifications.saving} hasChanges={notifications.hasChanges} />
              </div>
            </div>
            <div className="space-y-4">
              {[
                { key: 'email_new_bookings', label: 'Email on new bookings', desc: 'Send admin email for every new booking' },
                { key: 'alert_cancellations', label: 'Alert on cancellations', desc: 'Notify admin of all cancellations' },
              ].map((item, i) => (
                <div key={item.key}>
                  {i > 0 && <Separator className="mb-4" />}
                  <div className="flex items-center justify-between">
                    <div><p className="text-sm font-medium">{item.label}</p><p className="text-xs text-muted-foreground">{item.desc}</p></div>
                    <Switch checked={!!notifications.settings[item.key]} onCheckedChange={() => notifications.toggle(item.key)} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Platform Settings */}
        <Card className="card-luxury">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <Globe className="w-5 h-5 text-primary" />
              <h2 className="font-display text-lg font-bold">Platform Settings</h2>
              <div className="ml-auto">
                <SaveButton onClick={platformSettings.save} saving={platformSettings.saving} hasChanges={platformSettings.hasChanges} />
              </div>
            </div>
            <div className="space-y-4">
              {[
                { key: 'maintenance_mode', label: 'Maintenance mode', desc: 'Temporarily disable public access' },
                { key: 'allow_registrations', label: 'Allow new registrations', desc: 'Enable new user signups' },
              ].map((item, i) => (
                <div key={item.key}>
                  {i > 0 && <Separator className="mb-4" />}
                  <div className="flex items-center justify-between">
                    <div><p className="text-sm font-medium">{item.label}</p><p className="text-xs text-muted-foreground">{item.desc}</p></div>
                    <Switch checked={!!platformSettings.settings[item.key]} onCheckedChange={() => platformSettings.toggle(item.key)} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Security */}
        <Card className="card-luxury">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <Lock className="w-5 h-5 text-primary" />
              <h2 className="font-display text-lg font-bold">Security</h2>
              <div className="ml-auto">
                <SaveButton onClick={security.save} saving={security.saving} hasChanges={security.hasChanges} />
              </div>
            </div>
            <div className="space-y-4">
              {[
                { key: 'force_email_verification', label: 'Force email verification', desc: 'Users must verify email to book' },
                { key: 'two_factor_auth', label: 'Two-factor authentication', desc: 'Require 2FA for admin accounts' },
              ].map((item, i) => (
                <div key={item.key}>
                  {i > 0 && <Separator className="mb-4" />}
                  <div className="flex items-center justify-between">
                    <div><p className="text-sm font-medium">{item.label}</p><p className="text-xs text-muted-foreground">{item.desc}</p></div>
                    <Switch checked={!!security.settings[item.key]} onCheckedChange={() => security.toggle(item.key)} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
