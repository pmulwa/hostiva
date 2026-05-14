import { useEffect, useRef, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Bell, Loader2, MessageSquare, Clock, Pencil, RotateCcw, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ALL_AUTO_META,
  REMINDER_META,
  DEFAULT_TEMPLATES,
  DEFAULT_TIMINGS,
  REMINDER_KEYS,
  renderTemplate,
  type AnyAutoKey,
  type AutoMessageMeta,
  type ReminderKey,
  type TimingWindow,
} from '@/lib/autoMessageTemplates';

/**
 * Admin "Messages settings" panel — used inside the Settings dialog on the
 * Admin Messages page. Shows every automated message the platform sends as
 * a card with its template body and an enable/disable toggle on the left.
 * Writes to `platform_settings.disabled_auto_messages` which the
 * process-stay-lifecycle cron honours.
 */

interface SettingItem {
  key: AnyAutoKey;
  label: string;
  description: string;
  defaultTemplate: string;
  channel: 'thread' | 'notification';
}

function metaToItem(m: AutoMessageMeta): SettingItem {
  return {
    key: m.key,
    label: m.label,
    description: `${m.timing} · ${m.flow}`,
    defaultTemplate: m.template,
    channel: m.channel,
  };
}

const LIFECYCLE_KEYS = new Set(REMINDER_META.map((m) => m.key as string));
const TIMING_ANCHOR: Record<ReminderKey, 'check-in' | 'check-out'> = {
  pre_24h: 'check-in',
  pre_12h: 'check-in',
  host_no_confirm: 'check-in',
  no_show: 'check-in',
  post_review_guest: 'check-out',
  post_review_host: 'check-out',
};

function isReminderKey(k: AnyAutoKey): k is ReminderKey {
  return (REMINDER_KEYS as string[]).includes(k);
}

/** Sample booking data powering the live preview in the Edit dialog. */
const PREVIEW_VARS = {
  code: 'HTL-B5A11B48',
  title: 'Cozy Stay · 1BR Apartment',
  check_in: '2026-05-10',
  check_out: '2026-05-15',
  guests: '2 guests',
  initiator: 'host',
  maps: 'https://www.google.com/maps?q=-1.2921,36.8219',
};

/** Admin-defined custom automated message stored in
 *  platform_settings.custom_auto_messages (jsonb array). */
export interface CustomAutoMessage {
  id: string;
  label: string;
  anchor: 'check_in' | 'check_out';
  direction: 'host_to_guest' | 'guest_to_host';
  startHrs: number;
  endHrs?: number | null;
  template: string;
  enabled: boolean;
}

function newCustomMessage(): CustomAutoMessage {
  return {
    id: (crypto.randomUUID?.() ?? `cm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    label: '',
    anchor: 'check_in',
    direction: 'host_to_guest',
    startHrs: -6,
    endHrs: null,
    template: '',
    enabled: true,
  };
}

export function AutoMessagesPanel() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [timings, setTimings] = useState<
    Record<string, { startHrs?: number; endHrs?: number }>
  >({});
  const [customMessages, setCustomMessages] = useState<CustomAutoMessage[]>([]);
  const [editingCustom, setEditingCustom] = useState<CustomAutoMessage | null>(null);
  const [savingCustom, setSavingCustom] = useState(false);
  const [editing, setEditing] = useState<SettingItem | null>(null);
  const [draft, setDraft] = useState('');
  const [draftStartHrs, setDraftStartHrs] = useState<string>('');
  const [draftEndHrs, setDraftEndHrs] = useState<string>('');
  const allTemplatesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: ps } = await supabase
        .from('platform_settings')
        .select('id, disabled_auto_messages, auto_message_templates, auto_message_timings, custom_auto_messages' as any)
        .maybeSingle<any>();
      if (cancelled) return;
      setSettingsId(ps?.id ?? null);
      setDisabled(new Set((ps?.disabled_auto_messages as string[] | null) ?? []));
      setOverrides(((ps?.auto_message_templates as Record<string, string> | null) ?? {}));
      setTimings(
        ((ps?.auto_message_timings) as Record<
          string,
          { startHrs?: number; endHrs?: number }
        > | null) ?? {},
      );
      setCustomMessages(
        Array.isArray(ps?.custom_auto_messages)
          ? (ps!.custom_auto_messages as CustomAutoMessage[])
          : [],
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (key: string, enabled: boolean) => {
    if (!settingsId) {
      toast({ title: 'Platform settings not initialised', variant: 'destructive' });
      return;
    }
    setSaving(key);
    const next = new Set(disabled);
    if (enabled) next.delete(key);
    else next.add(key);
    const { error } = await supabase
      .from('platform_settings')
      .update({ disabled_auto_messages: Array.from(next) })
      .eq('id', settingsId);
    setSaving(null);
    if (error) {
      toast({ title: 'Could not save', description: error.message, variant: 'destructive' });
      return;
    }
    setDisabled(next);
    toast({
      title: enabled ? 'Auto-message enabled' : 'Auto-message disabled',
      description: enabled
        ? 'The platform will resume sending this message.'
        : 'New occurrences will be skipped until re-enabled.',
    });
  };

  const openEditor = (item: SettingItem) => {
    setEditing(item);
    setDraft(overrides[item.key] ?? item.defaultTemplate);
    if (isReminderKey(item.key)) {
      const def: TimingWindow = DEFAULT_TIMINGS[item.key];
      const cur = timings[item.key];
      setDraftStartHrs(
        String(typeof cur?.startHrs === 'number' ? cur.startHrs : def.startHrs),
      );
      setDraftEndHrs(
        cur && typeof cur.endHrs === 'number'
          ? String(cur.endHrs)
          : typeof def.endHrs === 'number'
            ? String(def.endHrs)
            : '',
      );
    } else {
      setDraftStartHrs('');
      setDraftEndHrs('');
    }
  };

  const saveTemplate = async (resetToDefault = false) => {
    if (!settingsId || !editing) return;
    setSaving(editing.key);
    const next = { ...overrides };
    const nextT = { ...timings };
    if (resetToDefault) {
      delete next[editing.key];
      delete nextT[editing.key];
    } else {
      const trimmed = draft.trim();
      if (!trimmed) {
        toast({ title: 'Template cannot be empty', variant: 'destructive' });
        setSaving(null);
        return;
      }
      next[editing.key] = trimmed;
      if (isReminderKey(editing.key)) {
        const startNum = Number(draftStartHrs);
        const endStr = draftEndHrs.trim();
        if (!Number.isFinite(startNum)) {
          toast({ title: 'Start hours must be a number', variant: 'destructive' });
          setSaving(null);
          return;
        }
        const def = DEFAULT_TIMINGS[editing.key];
        const isDefault =
          startNum === def.startHrs &&
          (endStr === ''
            ? typeof def.endHrs !== 'number'
            : Number(endStr) === def.endHrs);
        if (isDefault) {
          delete nextT[editing.key];
        } else {
          const win: { startHrs: number; endHrs?: number } = { startHrs: startNum };
          if (endStr !== '') {
            const endNum = Number(endStr);
            if (!Number.isFinite(endNum)) {
              toast({ title: 'End hours must be a number or blank', variant: 'destructive' });
              setSaving(null);
              return;
            }
            if (endNum <= startNum) {
              toast({
                title: 'End must be greater than start',
                description: 'Use blank end for an open-ended window.',
                variant: 'destructive',
              });
              setSaving(null);
              return;
            }
            win.endHrs = endNum;
          }
          nextT[editing.key] = win;
        }
      }
    }
    const { error } = await supabase
      .from('platform_settings')
      .update({ auto_message_templates: next, auto_message_timings: nextT } as any)
      .eq('id', settingsId);
    setSaving(null);
    if (error) {
      toast({ title: 'Could not save', description: error.message, variant: 'destructive' });
      return;
    }
    setOverrides(next);
    setTimings(nextT);
    setEditing(null);
    toast({
      title: resetToDefault ? 'Reverted to default' : 'Message updated',
      description: resetToDefault
        ? 'New sends will use the platform default wording.'
        : 'New sends will use the updated wording and schedule.',
    });
  };

  const items: SettingItem[] = ALL_AUTO_META.map(metaToItem);
  const lifecycleItems = items.filter((i) => LIFECYCLE_KEYS.has(i.key));
  const otherItems = items.filter((i) => !LIFECYCLE_KEYS.has(i.key));

  /** Persist the customMessages array (after add/edit/delete). */
  const persistCustom = async (next: CustomAutoMessage[]) => {
    if (!settingsId) {
      toast({ title: 'Platform settings not initialised', variant: 'destructive' });
      return false;
    }
    setSavingCustom(true);
    const { error } = await supabase
      .from('platform_settings')
      .update({ custom_auto_messages: next } as any)
      .eq('id', settingsId);
    setSavingCustom(false);
    if (error) {
      toast({ title: 'Could not save', description: error.message, variant: 'destructive' });
      return false;
    }
    setCustomMessages(next);
    return true;
  };

  const saveCustom = async () => {
    if (!editingCustom) return;
    const label = editingCustom.label.trim();
    const template = editingCustom.template.trim();
    if (!label) {
      toast({ title: 'Label is required', variant: 'destructive' });
      return;
    }
    if (!template) {
      toast({ title: 'Message template cannot be empty', variant: 'destructive' });
      return;
    }
    if (!Number.isFinite(editingCustom.startHrs)) {
      toast({ title: 'Start hours must be a number', variant: 'destructive' });
      return;
    }
    if (
      typeof editingCustom.endHrs === 'number' &&
      Number.isFinite(editingCustom.endHrs) &&
      editingCustom.endHrs <= editingCustom.startHrs
    ) {
      toast({ title: 'End must be greater than start', variant: 'destructive' });
      return;
    }
    const cleaned: CustomAutoMessage = {
      ...editingCustom,
      label,
      template,
      endHrs:
        typeof editingCustom.endHrs === 'number' && Number.isFinite(editingCustom.endHrs)
          ? editingCustom.endHrs
          : null,
    };
    const exists = customMessages.some((c) => c.id === cleaned.id);
    const next = exists
      ? customMessages.map((c) => (c.id === cleaned.id ? cleaned : c))
      : [...customMessages, cleaned];
    const ok = await persistCustom(next);
    if (ok) {
      setEditingCustom(null);
      toast({
        title: exists ? 'Custom message updated' : 'Custom message added',
        description: 'It will fire once per booking inside the chosen window.',
      });
    }
  };

  const deleteCustom = async (id: string) => {
    const next = customMessages.filter((c) => c.id !== id);
    const ok = await persistCustom(next);
    if (ok) {
      setEditingCustom(null);
      toast({ title: 'Custom message removed' });
    }
  };

  const toggleCustom = async (id: string, enabled: boolean) => {
    const next = customMessages.map((c) => (c.id === id ? { ...c, enabled } : c));
    await persistCustom(next);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    );
  }

  const renderCard = (item: SettingItem) => {
    const isOff = disabled.has(item.key);
    const hasOverride = typeof overrides[item.key] === 'string';
    const effective = hasOverride ? overrides[item.key] : item.defaultTemplate;
    return (
      <li key={item.key} className="flex items-start gap-4 p-4 rounded-lg border bg-card">
        {/* Toggle on the LEFT */}
        <div className="pt-1">
          <Switch
            checked={!isOff}
            disabled={saving === item.key}
            onCheckedChange={(v) => toggle(item.key, v)}
            aria-label={`Toggle ${item.label}`}
          />
        </div>

        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-semibold">{item.label}</h4>
              <Badge
                variant={item.channel === 'notification' ? 'secondary' : 'outline'}
                className="text-[10px]"
              >
                {item.channel === 'notification' ? (
                  <Bell className="w-3 h-3 mr-1" />
                ) : (
                  <MessageSquare className="w-3 h-3 mr-1" />
                )}
                {item.channel}
              </Badge>
              {hasOverride && (
                <Badge variant="secondary" className="text-[10px]">
                  Custom
                </Badge>
              )}
              {isOff && (
                <Badge variant="destructive" className="text-[10px]">
                  Disabled
                </Badge>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => openEditor(item)}
            >
              <Pencil className="w-3 h-3 mr-1.5" /> Edit
            </Button>
          </div>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Clock className="w-3 h-3" /> {item.description}
          </p>
          <div className="rounded-md bg-muted/50 border border-border/60 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
              Message template
            </p>
            <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
              {effective}
            </p>
          </div>
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2 font-semibold">
          Stay lifecycle reminders (cron, every 15 min)
        </p>
        <ul className="space-y-3">{lifecycleItems.map(renderCard)}</ul>
      </div>

      <div ref={allTemplatesRef}>
        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2 font-semibold">
          Other automated messages
        </p>
        <ul className="space-y-3">{otherItems.map(renderCard)}</ul>
      </div>

      {/* ─── Custom auto-messages (admin-defined) ─────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
            Custom automated messages ({customMessages.length})
          </p>
          <Button
            size="sm"
            variant="default"
            className="h-8 text-xs"
            onClick={() => setEditingCustom(newCustomMessage())}
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" /> Add new template
          </Button>
        </div>
        {customMessages.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-6 text-center">
            <p className="text-xs text-muted-foreground">
              No custom messages yet. Click <span className="font-semibold">Add new template</span>{' '}
              to schedule your own automated message that fires once per booking
              inside a time window you define.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {customMessages.map((cm) => {
              const anchorLabel = cm.anchor === 'check_out' ? 'check-out' : 'check-in';
              const dirLabel = cm.direction === 'guest_to_host' ? 'Guest → Host' : 'Host → Guest';
              const window =
                typeof cm.endHrs === 'number'
                  ? `${cm.startHrs}h → ${cm.endHrs}h`
                  : `${cm.startHrs}h onwards`;
              return (
                <li
                  key={cm.id}
                  className="flex items-start gap-4 p-4 rounded-lg border bg-card"
                >
                  <div className="pt-1">
                    <Switch
                      checked={cm.enabled}
                      disabled={savingCustom}
                      onCheckedChange={(v) => toggleCustom(cm.id, v)}
                      aria-label={`Toggle ${cm.label}`}
                    />
                  </div>
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-semibold">{cm.label || 'Untitled'}</h4>
                        <Badge variant="outline" className="text-[10px]">
                          <MessageSquare className="w-3 h-3 mr-1" /> thread
                        </Badge>
                        <Badge variant="secondary" className="text-[10px]">Custom</Badge>
                        {!cm.enabled && (
                          <Badge variant="destructive" className="text-[10px]">Disabled</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => setEditingCustom({ ...cm })}
                        >
                          <Pencil className="w-3 h-3 mr-1.5" /> Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs text-destructive hover:text-destructive"
                          onClick={() => deleteCustom(cm.id)}
                          disabled={savingCustom}
                          aria-label="Delete custom message"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Clock className="w-3 h-3" /> {window} from {anchorLabel} · {dirLabel}
                    </p>
                    <div className="rounded-md bg-muted/50 border border-border/60 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                        Message template
                      </p>
                      <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
                        {cm.template}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex justify-center pt-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const target = allTemplatesRef.current;
            if (!target) return;
            // Find the nearest scrollable ancestor (the dialog's overflow-y
            // container) and scroll the section to the top of its viewport.
            // scrollIntoView alone fails when the target is already painted
            // inside the visible area but the scroll viewport hasn't moved.
            let el: HTMLElement | null = target.parentElement;
            while (el) {
              const style = getComputedStyle(el);
              const oy = style.overflowY;
              if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) {
                const top = target.getBoundingClientRect().top
                  - el.getBoundingClientRect().top
                  + el.scrollTop
                  - 8;
                el.scrollTo({ top, behavior: 'smooth' });
                return;
              }
              el = el.parentElement;
            }
            // Fallback: native scrollIntoView on window scroll.
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
          className="text-xs"
        >
          <ChevronDown className="w-3 h-3 mr-1.5" />
          View all message templates
        </Button>
      </div>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit message — {editing?.label}</DialogTitle>
            <DialogDescription>
              Use placeholders <code>{'{code}'}</code>, <code>{'{title}'}</code>,{' '}
              <code>{'{maps}'}</code>, <code>{'{check_in}'}</code>,{' '}
              <code>{'{check_out}'}</code>, <code>{'{guests}'}</code>,{' '}
              <code>{'{initiator}'}</code>. Unknown tokens are left in place.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={6}
              className="text-sm"
            />
            {editing && isReminderKey(editing.key) && (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-3 space-y-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                  Schedule · hours from {TIMING_ANCHOR[editing.key as ReminderKey]}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Negative = before, positive = after. Leave “End” blank for an
                  open-ended window. Sent once per booking inside this window.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="start-hrs" className="text-[11px]">
                      Start (hours)
                    </Label>
                    <Input
                      id="start-hrs"
                      type="number"
                      step="1"
                      value={draftStartHrs}
                      onChange={(e) => setDraftStartHrs(e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="end-hrs" className="text-[11px]">
                      End (hours, optional)
                    </Label>
                    <Input
                      id="end-hrs"
                      type="number"
                      step="1"
                      value={draftEndHrs}
                      onChange={(e) => setDraftEndHrs(e.target.value)}
                      placeholder="open-ended"
                      className="h-8 text-sm"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Default:{' '}
                  {DEFAULT_TIMINGS[editing.key as ReminderKey].startHrs}h
                  {typeof DEFAULT_TIMINGS[editing.key as ReminderKey].endHrs ===
                  'number'
                    ? ` → ${DEFAULT_TIMINGS[editing.key as ReminderKey].endHrs}h`
                    : ' onwards'}
                </p>
              </div>
            )}
            {editing && (
              <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5 space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide text-primary font-semibold">
                  Live preview · sample booking
                </p>
                <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                  {renderTemplate(draft || DEFAULT_TEMPLATES[editing.key], PREVIEW_VARS)}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Sample: <code>{PREVIEW_VARS.code}</code> ·{' '}
                  <code>{PREVIEW_VARS.title}</code> · {PREVIEW_VARS.check_in} →{' '}
                  {PREVIEW_VARS.check_out} · {PREVIEW_VARS.guests}
                </p>
              </div>
            )}
            {editing && (
              <p className="text-[11px] text-muted-foreground">
                <span className="font-semibold">Default:</span>{' '}
                {DEFAULT_TEMPLATES[editing.key]}
              </p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => saveTemplate(true)}
              disabled={!editing || saving === editing?.key}
            >
              <RotateCcw className="w-3 h-3 mr-1.5" /> Reset to default
            </Button>
            <div className="flex-1" />
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={() => saveTemplate(false)} disabled={saving === editing?.key}>
              {saving === editing?.key ? (
                <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
              ) : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add / Edit custom auto-message dialog */}
      <Dialog
        open={!!editingCustom}
        onOpenChange={(open) => !open && setEditingCustom(null)}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editingCustom && customMessages.some((c) => c.id === editingCustom.id)
                ? 'Edit custom message'
                : 'Add custom message'}
            </DialogTitle>
            <DialogDescription>
              Schedule your own automated message. It fires once per booking
              when the current time falls inside the chosen window. Use
              placeholders <code>{'{code}'}</code>, <code>{'{title}'}</code>,{' '}
              <code>{'{maps}'}</code>, <code>{'{check_in}'}</code>,{' '}
              <code>{'{check_out}'}</code>, <code>{'{guests}'}</code>.
            </DialogDescription>
          </DialogHeader>
          {editingCustom && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="cm-label" className="text-xs">Label</Label>
                <Input
                  id="cm-label"
                  value={editingCustom.label}
                  onChange={(e) =>
                    setEditingCustom({ ...editingCustom, label: e.target.value })
                  }
                  placeholder="e.g. Mid-stay check-in"
                  className="h-9 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Anchor</Label>
                  <Select
                    value={editingCustom.anchor}
                    onValueChange={(v) =>
                      setEditingCustom({
                        ...editingCustom,
                        anchor: v as 'check_in' | 'check_out',
                      })
                    }
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="check_in">Check-in time</SelectItem>
                      <SelectItem value="check_out">Check-out time</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Direction</Label>
                  <Select
                    value={editingCustom.direction}
                    onValueChange={(v) =>
                      setEditingCustom({
                        ...editingCustom,
                        direction: v as 'host_to_guest' | 'guest_to_host',
                      })
                    }
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="host_to_guest">Host → Guest</SelectItem>
                      <SelectItem value="guest_to_host">Guest → Host</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="rounded-md border border-border bg-muted/40 px-3 py-3 space-y-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                  Schedule · hours from {editingCustom.anchor === 'check_out' ? 'check-out' : 'check-in'}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Negative = before, positive = after. Leave “End” blank for an
                  open-ended window. Sent once per booking inside this window.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-[11px]">Start (hours)</Label>
                    <Input
                      type="number"
                      step="1"
                      value={String(editingCustom.startHrs)}
                      onChange={(e) =>
                        setEditingCustom({
                          ...editingCustom,
                          startHrs: Number(e.target.value),
                        })
                      }
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">End (hours, optional)</Label>
                    <Input
                      type="number"
                      step="1"
                      value={
                        typeof editingCustom.endHrs === 'number'
                          ? String(editingCustom.endHrs)
                          : ''
                      }
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        setEditingCustom({
                          ...editingCustom,
                          endHrs: v === '' ? null : Number(v),
                        });
                      }}
                      placeholder="open-ended"
                      className="h-8 text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="cm-template" className="text-xs">Message template</Label>
                <Textarea
                  id="cm-template"
                  value={editingCustom.template}
                  onChange={(e) =>
                    setEditingCustom({ ...editingCustom, template: e.target.value })
                  }
                  rows={6}
                  placeholder={'Booking {code}. We hope you are enjoying your stay at {title}…'}
                  className="text-sm"
                />
              </div>

              {editingCustom.template.trim() && (
                <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5 space-y-1.5">
                  <p className="text-[11px] uppercase tracking-wide text-primary font-semibold">
                    Live preview · sample booking
                  </p>
                  <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                    {renderTemplate(editingCustom.template, PREVIEW_VARS)}
                  </p>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            {editingCustom && customMessages.some((c) => c.id === editingCustom.id) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => deleteCustom(editingCustom.id)}
                disabled={savingCustom}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="w-3 h-3 mr-1.5" /> Delete
              </Button>
            )}
            <div className="flex-1" />
            <Button variant="outline" onClick={() => setEditingCustom(null)}>
              Cancel
            </Button>
            <Button onClick={saveCustom} disabled={savingCustom}>
              {savingCustom ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}