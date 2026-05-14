import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Settings, Globe, DollarSign, Users, User, Home, ShieldCheck, Loader2, Pencil, Check, Building2, MessageSquare, RotateCcw, Hash } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { logAdminAction } from '@/lib/audit';
import { getPropertyIdFormat, setPropertyIdFormat, formatPropertyShortId, type PropertyIdFormat } from '@/lib/propertyIdentifier';
import { Textarea } from '@/components/ui/textarea';
import { AUTOMATED_MESSAGE_CATALOG, type AutomatedMessageType } from '@/lib/automatedMessages';
import {
  defaultTemplatesFromCatalog,
  fetchMessageTemplates,
  saveMessageTemplates,
  type MessageTemplatesMap,
} from '@/lib/adminMessageTemplates';
import { fetchPlatformBranding, setPlatformBrandingCache, DEFAULT_BRANDING } from '@/hooks/usePlatformBranding';

type IdFormatRow = {
  key: 'guest' | 'host' | 'staff';
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  prefixField: 'guest_id_prefix' | 'host_id_prefix' | 'staff_id_prefix';
  lengthField: 'guest_id_length' | 'host_id_length' | 'staff_id_length';
};

const ID_ROWS: IdFormatRow[] = [
  {
    key: 'guest',
    label: 'Guest ID',
    description: 'Identifier shown for booking guests across the platform.',
    icon: User,
    accent: 'text-cyan-400 bg-cyan-500/10',
    prefixField: 'guest_id_prefix',
    lengthField: 'guest_id_length',
  },
  {
    key: 'host',
    label: 'Host ID',
    description: 'Identifier shown for property owners and operators.',
    icon: Home,
    accent: 'text-emerald-400 bg-emerald-500/10',
    prefixField: 'host_id_prefix',
    lengthField: 'host_id_length',
  },
  {
    key: 'staff',
    label: 'Staff ID',
    description: 'Internal employee identifier (admin, support, finance, etc.).',
    icon: ShieldCheck,
    accent: 'text-amber-400 bg-amber-500/10',
    prefixField: 'staff_id_prefix',
    lengthField: 'staff_id_length',
  },
];

type IdSettings = {
  guest_id_prefix: string;
  guest_id_length: number;
  host_id_prefix: string;
  host_id_length: number;
  staff_id_prefix: string;
  staff_id_length: number;
};

const sanitizePrefix = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const clampLength = (raw: number) => Math.max(4, Math.min(12, isNaN(raw) ? 8 : raw));

const sampleId = (prefix: string, length: number) => {
  const safePrefix = sanitizePrefix(prefix) || 'ID';
  const safeLength = clampLength(length);
  // Sequential / increasing criteria — first ID starts at 1, zero-padded to length
  const sample = '1'.padStart(safeLength, '0');
  return `${safePrefix}-${sample}`;
};

export default function AdminSettings() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [idSettings, setIdSettings] = useState<IdSettings | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const [savingRow, setSavingRow] = useState<IdFormatRow['key'] | null>(null);
  const [lockedRows, setLockedRows] = useState<Record<IdFormatRow['key'], boolean>>({
    guest: true,
    host: true,
    staff: true,
  });
  const [loadingId, setLoadingId] = useState(true);
  const [settingsId, setSettingsId] = useState<string | null>(null);

  // Property Management — sequential property identifier format (per host)
  const [propertyFormat, setPropertyFormatState] = useState<PropertyIdFormat>(() => getPropertyIdFormat());
  const [propertyLocked, setPropertyLocked] = useState(true);
  const [savingProperty, setSavingProperty] = useState(false);

  // Booking ID — global format used across all booking references
  const [bookingIdPrefix, setBookingIdPrefix] = useState('BK');
  const [bookingIdLength, setBookingIdLength] = useState(8);
  const [originalBookingId, setOriginalBookingId] = useState({ prefix: 'BK', length: 8 });
  const [bookingIdLocked, setBookingIdLocked] = useState(true);
  const [savingBookingId, setSavingBookingId] = useState(false);

  // Messages — admin-editable templates for automated messages
  const [messageTemplates, setMessageTemplates] = useState<Record<AutomatedMessageType, string>>(
    defaultTemplatesFromCatalog(),
  );
  const [originalTemplates, setOriginalTemplates] = useState<Record<AutomatedMessageType, string>>(
    defaultTemplatesFromCatalog(),
  );
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [savingMessages, setSavingMessages] = useState(false);

  // General Settings — platform branding & contact
  const [branding, setBranding] = useState({ ...DEFAULT_BRANDING });
  const [originalBranding, setOriginalBranding] = useState({ ...DEFAULT_BRANDING });
  const [loadingBranding, setLoadingBranding] = useState(true);
  const [savingBranding, setSavingBranding] = useState(false);

  useEffect(() => {
    (async () => {
      const b = await fetchPlatformBranding();
      setBranding(b);
      setOriginalBranding(b);
      setLoadingBranding(false);
    })();
  }, []);

  const brandingDirty =
    branding.platform_name !== originalBranding.platform_name ||
    branding.support_email !== originalBranding.support_email ||
    branding.support_phone !== originalBranding.support_phone;

  const saveBranding = async () => {
    const name = branding.platform_name.trim();
    const email = branding.support_email.trim();
    const phone = branding.support_phone.trim();
    if (!name) {
      toast({ title: 'Platform name required', variant: 'destructive' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: 'Invalid support email', variant: 'destructive' });
      return;
    }
    setSavingBranding(true);
    const payload = { platform_name: name, support_email: email, support_phone: phone };
    let error: { message: string } | null = null;
    let resolvedId = settingsId;
    if (settingsId) {
      const upd = await supabase.from('platform_settings').update(payload as any).eq('id', settingsId);
      error = upd.error;
    } else {
      const ins = await supabase
        .from('platform_settings')
        .insert(payload as any)
        .select('id')
        .single();
      error = ins.error;
      if (ins.data) {
        resolvedId = ins.data.id;
        setSettingsId(ins.data.id);
      }
    }
    setSavingBranding(false);
    if (error) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
      return;
    }
    setOriginalBranding(payload);
    setPlatformBrandingCache(payload);
    await logAdminAction('update_platform_branding', 'platform_settings', resolvedId ?? '', payload);
    toast({ title: 'General settings saved', description: 'Brand and contact details updated platform-wide.' });
  };

  useEffect(() => {
    (async () => {
      const overrides = await fetchMessageTemplates();
      const merged = { ...defaultTemplatesFromCatalog() };
      (Object.keys(overrides) as AutomatedMessageType[]).forEach((k) => {
        if (typeof overrides[k] === 'string' && overrides[k]!.trim()) merged[k] = overrides[k]!;
      });
      setMessageTemplates(merged);
      setOriginalTemplates(merged);
      setLoadingMessages(false);
    })();
  }, []);

  const messagesDirty = (Object.keys(messageTemplates) as AutomatedMessageType[]).some(
    (k) => messageTemplates[k] !== originalTemplates[k],
  );

  const saveMessages = async () => {
    setSavingMessages(true);
    // Only persist values that differ from the catalog defaults to keep storage lean
    const defaults = defaultTemplatesFromCatalog();
    const overrides: MessageTemplatesMap = {};
    (Object.keys(messageTemplates) as AutomatedMessageType[]).forEach((k) => {
      const val = (messageTemplates[k] ?? '').trim();
      if (val && val !== defaults[k]) overrides[k] = val;
    });
    const { error } = await saveMessageTemplates(overrides);
    setSavingMessages(false);
    if (error) {
      toast({ title: 'Save failed', description: error, variant: 'destructive' });
      return;
    }
    setOriginalTemplates({ ...messageTemplates });
    await logAdminAction('update_message_templates', 'platform_controls', 'message_templates', {
      count: Object.keys(overrides).length,
    });
    toast({ title: 'Message templates saved', description: 'Your changes are now live.' });
  };

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('platform_settings')
        .select('id, guest_id_prefix, guest_id_length, host_id_prefix, host_id_length, staff_id_prefix, staff_id_length, booking_id_prefix, booking_id_length')
        .limit(1)
        .maybeSingle();
      if (error) {
        toast({ title: 'Failed to load settings', description: error.message, variant: 'destructive' });
      } else if (data) {
        setSettingsId(data.id);
        setIdSettings({
          guest_id_prefix: data.guest_id_prefix ?? 'GST',
          guest_id_length: data.guest_id_length ?? 8,
          host_id_prefix: data.host_id_prefix ?? 'HST',
          host_id_length: data.host_id_length ?? 8,
          staff_id_prefix: data.staff_id_prefix ?? 'STF',
          staff_id_length: data.staff_id_length ?? 6,
        });
        const bp = (data.booking_id_prefix ?? 'BK').toUpperCase();
        const bl = data.booking_id_length ?? 8;
        setBookingIdPrefix(bp);
        setBookingIdLength(bl);
        setOriginalBookingId({ prefix: bp, length: bl });
      } else {
        // No row yet — seed defaults
        setIdSettings({
          guest_id_prefix: 'GST', guest_id_length: 8,
          host_id_prefix: 'HST', host_id_length: 8,
          staff_id_prefix: 'STF', staff_id_length: 6,
        });
      }
      setLoadingId(false);
    })();
  }, [toast]);

  const updateField = (field: keyof IdSettings, value: string | number) => {
    setIdSettings((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const saveRow = async (row: IdFormatRow) => {
    if (!idSettings) return;
    setSavingRow(row.key);
    const cleanPrefix = sanitizePrefix(String(idSettings[row.prefixField])) || row.key.slice(0, 3).toUpperCase();
    const cleanLength = clampLength(Number(idSettings[row.lengthField]));
    const payload: Partial<IdSettings> = {
      [row.prefixField]: cleanPrefix,
      [row.lengthField]: cleanLength,
    };

    let error: { message: string } | null = null;
    let resolvedId = settingsId;

    if (settingsId) {
      const upd = await supabase
        .from('platform_settings')
        .update(payload)
        .eq('id', settingsId);
      error = upd.error;
    } else {
      const ins = await supabase
        .from('platform_settings')
        .insert(payload as any)
        .select('id')
        .single();
      error = ins.error;
      if (ins.data) {
        resolvedId = ins.data.id;
        setSettingsId(ins.data.id);
      }
    }

    setSavingRow(null);
    if (error) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
      return;
    }
    setIdSettings((prev) => (prev ? { ...prev, ...payload } : prev));
    setLockedRows((prev) => ({ ...prev, [row.key]: true }));
    await logAdminAction('update_user_id_format', 'platform_settings', resolvedId ?? '', {
      role: row.key,
      prefix: cleanPrefix,
      length: cleanLength,
    });
    toast({
      title: `${row.label} saved`,
      description: `Next ID: ${sampleId(cleanPrefix, cleanLength)}`,
    });
  };

  const saveAll = async () => {
    if (!idSettings) return;
    setSavingAll(true);
    const payload: IdSettings = {
      guest_id_prefix: sanitizePrefix(idSettings.guest_id_prefix) || 'GST',
      guest_id_length: clampLength(Number(idSettings.guest_id_length)),
      host_id_prefix: sanitizePrefix(idSettings.host_id_prefix) || 'HST',
      host_id_length: clampLength(Number(idSettings.host_id_length)),
      staff_id_prefix: sanitizePrefix(idSettings.staff_id_prefix) || 'STF',
      staff_id_length: clampLength(Number(idSettings.staff_id_length)),
    };

    let error: { message: string } | null = null;
    let resolvedId = settingsId;

    if (settingsId) {
      const upd = await supabase
        .from('platform_settings')
        .update(payload)
        .eq('id', settingsId)
        .select('id')
        .maybeSingle();
      error = upd.error;
    } else {
      const ins = await supabase
        .from('platform_settings')
        .insert(payload as any)
        .select('id')
        .single();
      error = ins.error;
      if (ins.data) {
        resolvedId = ins.data.id;
        setSettingsId(ins.data.id);
      }
    }

    setSavingAll(false);
    if (error) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
      return;
    }
    setIdSettings(payload);
    await logAdminAction('update_user_id_formats', 'platform_settings', resolvedId ?? '', payload);
    toast({
      title: 'User ID formats saved',
      description: `Guest ${sampleId(payload.guest_id_prefix, payload.guest_id_length)} · Host ${sampleId(payload.host_id_prefix, payload.host_id_length)} · Staff ${sampleId(payload.staff_id_prefix, payload.staff_id_length)}`,
    });
  };

  const bookingIdChanged =
    bookingIdPrefix !== originalBookingId.prefix || bookingIdLength !== originalBookingId.length;

  const saveBookingIdFormat = async () => {
    setSavingBookingId(true);
    // Floor of 8 hex chars guarantees Booking-ID uniqueness across the platform
    // (~1 in 4 billion collision probability over the full UUID space).
    const cleanPrefix = (bookingIdPrefix.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'BK').slice(0, 5);
    const cleanLength = Math.max(8, Math.min(12, Number(bookingIdLength) || 8));
    const payload = { booking_id_prefix: cleanPrefix, booking_id_length: cleanLength };

    let error: { message: string } | null = null;
    let resolvedId = settingsId;
    if (settingsId) {
      const upd = await supabase.from('platform_settings').update(payload).eq('id', settingsId);
      error = upd.error;
    } else {
      const ins = await supabase
        .from('platform_settings')
        .insert(payload as any)
        .select('id')
        .single();
      error = ins.error;
      if (ins.data) {
        resolvedId = ins.data.id;
        setSettingsId(ins.data.id);
      }
    }

    setSavingBookingId(false);
    if (error) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
      return;
    }
    setBookingIdPrefix(cleanPrefix);
    setBookingIdLength(cleanLength);
    setOriginalBookingId({ prefix: cleanPrefix, length: cleanLength });
    setBookingIdLocked(true);
    await logAdminAction('update_booking_id_format', 'platform_settings', resolvedId ?? '', payload);
    toast({
      title: 'Booking ID format saved',
      description: `Next: #${cleanPrefix}-${'A1B2C3D4E5F6'.slice(0, cleanLength)}`,
    });
  };

  return (
    <AdminLayout>
      <h1 className="font-display text-3xl font-bold mb-2">{t('admin.sidebar.settings')}</h1>
      <p className="text-muted-foreground text-sm mb-6">Platform configuration and branding</p>

      <div className="space-y-6">
        {/* User Management Settings */}
        <Card className="card-luxury">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-5 h-5 text-primary" />
              <h2 className="font-display text-lg font-bold">User Management</h2>
            </div>
            <p className="text-xs text-muted-foreground mb-5">
              Sequential ID format per user category. New IDs increment automatically — e.g.{' '}
              <code className="font-mono bg-muted/40 px-1.5 py-0.5 rounded">PREFIX-00000001</code>,{' '}
              <code className="font-mono bg-muted/40 px-1.5 py-0.5 rounded">PREFIX-00000002</code>…
            </p>

            {loadingId || !idSettings ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {ID_ROWS.map((row) => {
                  const Icon = row.icon;
                  const prefixVal = String(idSettings[row.prefixField] ?? '');
                  const lengthVal = Number(idSettings[row.lengthField] ?? 8);
                  const preview = sampleId(prefixVal, lengthVal);
                  const isLocked = lockedRows[row.key];
                  const isSaving = savingRow === row.key;
                  return (
                    <div
                      key={row.key}
                      className="rounded-lg border border-border bg-background/40 p-3 hover:border-primary/30 transition-colors flex flex-col"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${row.accent}`}>
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <h3 className="font-semibold text-sm flex-1 truncate">{row.label}</h3>
                        {isLocked && (
                          <span className="text-[9px] uppercase tracking-wider text-emerald-500 font-mono flex items-center gap-1">
                            <Check className="w-3 h-3" /> Saved
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-[1fr_72px] gap-2">
                        <div>
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Prefix</Label>
                          <Input
                            value={prefixVal}
                            maxLength={6}
                            disabled={isLocked}
                            onChange={(e) => updateField(row.prefixField, e.target.value.toUpperCase())}
                            placeholder="GST"
                            className="mt-0.5 h-8 font-mono uppercase text-sm"
                          />
                        </div>
                        <div>
                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Digits</Label>
                          <Input
                            type="number"
                            min={4}
                            max={12}
                            disabled={isLocked}
                            value={lengthVal}
                            onChange={(e) => updateField(row.lengthField, Number(e.target.value))}
                            className="mt-0.5 h-8 font-mono text-sm"
                          />
                        </div>
                      </div>

                      <div className="mt-2 flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-muted/40">
                        <code className="font-mono text-xs font-semibold text-primary truncate">{preview}</code>
                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground shrink-0">Next</span>
                      </div>

                      {isLocked ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setLockedRows((prev) => ({ ...prev, [row.key]: false }))}
                          className="mt-2 w-full h-8"
                        >
                          <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => saveRow(row)}
                          disabled={isSaving}
                          className="mt-2 w-full h-8"
                        >
                          {isSaving ? (
                            <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Saving</>
                          ) : (
                            'Save'
                          )}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {!loadingId && idSettings && (
              <div className="mt-4 flex justify-end">
                <Button onClick={saveAll} disabled={savingAll} className="btn-primary">
                  {savingAll ? (
                    <><Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Saving…</>
                  ) : (
                    'Save all'
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Property Management + Booking ID — side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <Card className="card-luxury h-full">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-1">
              <Building2 className="w-5 h-5 text-primary" />
              <h2 className="font-display text-lg font-bold">Property Management</h2>
            </div>
            <p className="text-xs text-muted-foreground mb-5">
              Sequential ID format per user category. New IDs increment automatically — e.g.{' '}
              <code className="font-mono bg-muted/40 px-1.5 py-0.5 rounded">
                {formatPropertyShortId(0, propertyFormat)}
              </code>
              ,{' '}
              <code className="font-mono bg-muted/40 px-1.5 py-0.5 rounded">
                {formatPropertyShortId(1, propertyFormat)}
              </code>
              … assigned per host in listing order.
            </p>

            <div className="grid grid-cols-1 gap-3">
              <div className="rounded-lg border border-border bg-background/40 p-3 hover:border-primary/30 transition-colors flex flex-col">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 text-primary bg-primary/10">
                    <Building2 className="w-3.5 h-3.5" />
                  </div>
                  <h3 className="font-semibold text-sm flex-1">Property listing ID</h3>
                  {propertyLocked && (
                    <span className="text-[9px] uppercase tracking-wider text-emerald-500 font-mono flex items-center gap-1">
                      <Check className="w-3 h-3" /> Saved
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-[1fr_88px_1fr] gap-2 items-end">
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Prefix</Label>
                    <Input
                      value={propertyFormat.prefix}
                      maxLength={4}
                      disabled={propertyLocked}
                      onChange={(e) =>
                        setPropertyFormatState((prev) => ({
                          ...prev,
                          prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'L',
                        }))
                      }
                      placeholder="L"
                      className="mt-0.5 h-8 font-mono uppercase text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Digits</Label>
                    <Input
                      type="number"
                      min={2}
                      max={8}
                      disabled={propertyLocked}
                      value={propertyFormat.length}
                      onChange={(e) =>
                        setPropertyFormatState((prev) => ({
                          ...prev,
                          length: Math.max(2, Math.min(8, Number(e.target.value) || 3)),
                        }))
                      }
                      className="mt-0.5 h-8 font-mono text-sm"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-muted/40 h-8">
                    <code className="font-mono text-xs font-semibold text-primary truncate">
                      {formatPropertyShortId(0, propertyFormat)}
                    </code>
                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground shrink-0">Next</span>
                  </div>
                </div>

                <div className="mt-3 flex justify-end gap-2">
                  {propertyLocked ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setPropertyLocked(false)}
                      className="h-8"
                    >
                      <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setPropertyFormatState(getPropertyIdFormat());
                          setPropertyLocked(true);
                        }}
                        className="h-8"
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        disabled={savingProperty}
                        onClick={async () => {
                          setSavingProperty(true);
                          const clean: PropertyIdFormat = {
                            prefix: (propertyFormat.prefix || 'L').toUpperCase().slice(0, 4),
                            length: Math.max(2, Math.min(8, Number(propertyFormat.length) || 3)),
                          };
                          setPropertyIdFormat(clean);
                          setPropertyFormatState(clean);
                          await logAdminAction('update_property_id_format', 'platform_settings', 'property', clean);
                          setSavingProperty(false);
                          setPropertyLocked(true);
                          toast({
                            title: 'Property ID format saved',
                            description: `Next ID: ${formatPropertyShortId(0, clean)}`,
                          });
                        }}
                        className="h-8"
                      >
                        {savingProperty ? (
                          <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Saving</>
                        ) : (
                          'Save'
                        )}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Booking ID Format */}
        <Card className="card-luxury h-full">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-1">
              <Hash className="w-5 h-5 text-primary" />
              <h2 className="font-display text-lg font-bold">Booking ID Format</h2>
            </div>
            <p className="text-xs text-muted-foreground mb-5">
              Global format used across all booking references, confirmations and receipts — e.g.{' '}
              <code className="font-mono bg-muted/40 px-1.5 py-0.5 rounded">
                #{bookingIdPrefix.toUpperCase()}-{'A1B2C3D4E5F6'.slice(0, bookingIdLength)}
              </code>
              .
            </p>

            <div className="grid grid-cols-1 gap-3">
              <div className="rounded-lg border border-border bg-background/40 p-3 hover:border-primary/30 transition-colors flex flex-col">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 text-primary bg-primary/10">
                    <Hash className="w-3.5 h-3.5" />
                  </div>
                  <h3 className="font-semibold text-sm flex-1">Booking reference ID</h3>
                  {bookingIdLocked && !bookingIdChanged && (
                    <span className="text-[9px] uppercase tracking-wider text-emerald-500 font-mono flex items-center gap-1">
                      <Check className="w-3 h-3" /> Saved
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-[1fr_88px_1fr] gap-2 items-end">
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Prefix</Label>
                    <Input
                      value={bookingIdPrefix}
                      maxLength={5}
                      disabled={bookingIdLocked}
                      onChange={(e) =>
                        setBookingIdPrefix(
                          e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) || 'BK',
                        )
                      }
                      placeholder="BK"
                      className="mt-0.5 h-8 font-mono uppercase text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Digits</Label>
                    <Input
                      type="number"
                      min={8}
                      max={12}
                      disabled={bookingIdLocked}
                      value={bookingIdLength}
                      onChange={(e) =>
                        setBookingIdLength(Math.max(8, Math.min(12, Number(e.target.value) || 8)))
                      }
                      className="mt-0.5 h-8 font-mono text-sm"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-muted/40 h-8">
                    <code className="font-mono text-xs font-semibold text-primary truncate">
                      #{bookingIdPrefix.toUpperCase()}-{'A1B2C3D4E5F6'.slice(0, bookingIdLength)}
                    </code>
                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground shrink-0">Next</span>
                  </div>
                </div>

                <div className="mt-3 flex justify-end gap-2">
                  {bookingIdLocked ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setBookingIdLocked(false)}
                      className="h-8"
                    >
                      <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setBookingIdPrefix(originalBookingId.prefix);
                          setBookingIdLength(originalBookingId.length);
                          setBookingIdLocked(true);
                        }}
                        className="h-8"
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        disabled={savingBookingId || !bookingIdChanged}
                        onClick={saveBookingIdFormat}
                        className="h-8"
                      >
                        {savingBookingId ? (
                          <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Saving</>
                        ) : (
                          'Save'
                        )}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        </div>

        <Card className="card-luxury">
          <CardContent className="p-6">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-primary" />
                <h2 className="font-display text-lg font-bold">General Settings</h2>
              </div>
              {brandingDirty && !loadingBranding && (
                <span className="text-[10px] uppercase tracking-wider text-amber-500 font-mono">Unsaved changes</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mb-5">
              These values appear across the platform — site footer, contact page, transactional emails, and SEO metadata.
            </p>
            {loadingBranding ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label>Platform Name</Label>
                    <Input
                      value={branding.platform_name}
                      onChange={(e) => setBranding((p) => ({ ...p, platform_name: e.target.value }))}
                      className="mt-1"
                      maxLength={60}
                      placeholder="Hostiva"
                    />
                  </div>
                  <div>
                    <Label>Support Email</Label>
                    <Input
                      type="email"
                      value={branding.support_email}
                      onChange={(e) => setBranding((p) => ({ ...p, support_email: e.target.value }))}
                      className="mt-1"
                      maxLength={120}
                      placeholder="support@hostly.co.ke"
                    />
                  </div>
                  <div>
                    <Label>Support Phone</Label>
                    <Input
                      type="tel"
                      value={branding.support_phone}
                      onChange={(e) => setBranding((p) => ({ ...p, support_phone: e.target.value }))}
                      className="mt-1"
                      maxLength={32}
                      placeholder="+1 872 221 7881"
                    />
                  </div>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  {brandingDirty && (
                    <Button
                      variant="ghost"
                      onClick={() => setBranding(originalBranding)}
                      disabled={savingBranding}
                    >
                      Cancel
                    </Button>
                  )}
                  <Button onClick={saveBranding} disabled={savingBranding || !brandingDirty} className="btn-primary">
                    {savingBranding ? (
                      <><Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Saving…</>
                    ) : (
                      'Save changes'
                    )}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Messages — admin-editable automated message templates */}
        <Card className="card-luxury">
          <CardContent className="p-6">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-primary" />
                <h2 className="font-display text-lg font-bold">Messages</h2>
              </div>
              {messagesDirty && !loadingMessages && (
                <span className="text-[10px] uppercase tracking-wider text-amber-500 font-mono">Unsaved changes</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mb-5">
              Edit the wording of every automated/system message the platform sends on a user&apos;s behalf.
              Tokens like <code className="font-mono bg-muted/40 px-1 rounded">$X</code>,{' '}
              <code className="font-mono bg-muted/40 px-1 rounded">BK-XXXX</code> and{' '}
              <code className="font-mono bg-muted/40 px-1 rounded">…</code> are replaced at send time —
              keep them intact.
            </p>

            {loadingMessages ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading templates…
              </div>
            ) : (
              <div className="space-y-6">
                {(['lifecycle'] as const).map((group) => {
                  const items = AUTOMATED_MESSAGE_CATALOG.filter((m) => m.group === group);
                  if (!items.length) return null;
                  const groupLabel = 'Booking lifecycle';
                  return (
                    <div key={group}>
                      <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                        {groupLabel}
                      </h3>
                      <div className="space-y-3">
                        {items.map((def) => {
                          const value = messageTemplates[def.type] ?? def.example;
                          const defaults = defaultTemplatesFromCatalog();
                          const isCustom = value !== defaults[def.type];
                          return (
                            <div
                              key={def.type}
                              className="rounded-lg border border-border bg-background/40 p-3 hover:border-primary/30 transition-colors"
                            >
                              <div className="flex items-start justify-between gap-3 mb-1.5">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <h4 className="font-semibold text-sm truncate">{def.label}</h4>
                                    {isCustom && (
                                      <span className="text-[9px] uppercase tracking-wider text-primary font-mono px-1.5 py-0.5 rounded bg-primary/10">
                                        Custom
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-0.5">{def.description}</p>
                                </div>
                                {isCustom && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 shrink-0"
                                    onClick={() =>
                                      setMessageTemplates((prev) => ({ ...prev, [def.type]: def.example }))
                                    }
                                  >
                                    <RotateCcw className="w-3 h-3 mr-1" /> Reset
                                  </Button>
                                )}
                              </div>
                              <Textarea
                                value={value}
                                onChange={(e) =>
                                  setMessageTemplates((prev) => ({ ...prev, [def.type]: e.target.value }))
                                }
                                rows={3}
                                className="font-mono text-xs"
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    disabled={!messagesDirty || savingMessages}
                    onClick={() => setMessageTemplates({ ...originalTemplates })}
                  >
                    Discard
                  </Button>
                  <Button
                    onClick={saveMessages}
                    disabled={!messagesDirty || savingMessages}
                    className="btn-primary"
                  >
                    {savingMessages ? (
                      <><Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Saving…</>
                    ) : (
                      'Save messages'
                    )}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="card-luxury">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <DollarSign className="w-5 h-5 text-primary" />
              <h2 className="font-display text-lg font-bold">Fee Configuration</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Service Fee (%)</Label>
                <Input type="number" defaultValue="10" className="mt-1" />
              </div>
              <div>
                <Label>Default Currency</Label>
                <Input defaultValue="USD" className="mt-1" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="card-luxury">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <Globe className="w-5 h-5 text-primary" />
              <h2 className="font-display text-lg font-bold">SEO & Branding</h2>
            </div>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <Label>Meta Title</Label>
                <Input defaultValue="Hostiva - Find Your Perfect Stay" className="mt-1" />
              </div>
              <div>
                <Label>Meta Description</Label>
                <Input defaultValue="Book unique homes and experiences around the world with Hostiva." className="mt-1" />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button className="btn-primary">Save Settings</Button>
        </div>
      </div>
    </AdminLayout>
  );
}
