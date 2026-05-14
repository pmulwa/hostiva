import { useEffect, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { CloudLightning, Plus, MapPin, Calendar as CalIcon, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { logAdminAction } from '@/lib/audit';
import { format } from 'date-fns';

type EventType = 'natural_disaster' | 'pandemic' | 'armed_conflict' | 'travel_ban' | 'government_order' | 'other';

interface FMEvent {
  id: string;
  title: string;
  description: string | null;
  event_type: EventType;
  affected_country: string;
  affected_region: string | null;
  affected_cities: string[];
  starts_at: string;
  ends_at: string;
  host_compensation_pct: number;
  is_active: boolean;
  source_reference: string | null;
  created_at: string;
}

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  natural_disaster: 'Natural Disaster',
  pandemic: 'Pandemic',
  armed_conflict: 'Armed Conflict',
  travel_ban: 'Travel Ban',
  government_order: 'Government Order',
  other: 'Other',
};

export default function AdminForceMajeure() {
  const { toast } = useToast();
  const [events, setEvents] = useState<FMEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const today = format(new Date(), 'yyyy-MM-dd');
  const [form, setForm] = useState({
    title: '', description: '', event_type: 'natural_disaster' as EventType,
    affected_country: '', affected_region: '', affected_cities: '',
    starts_at: today, ends_at: today,
    host_compensation_pct: 50, source_reference: '',
  });

  const fetchEvents = async () => {
    setLoading(true);
    const { data } = await supabase.from('force_majeure_events' as any).select('*').order('created_at', { ascending: false });
    setEvents((data ?? []) as unknown as FMEvent[]);
    setLoading(false);
  };
  useEffect(() => { fetchEvents(); }, []);

  const create = async () => {
    if (!form.title || !form.affected_country || !form.starts_at || !form.ends_at) {
      toast({ title: 'Missing fields', description: 'Title, country, and dates are required.', variant: 'destructive' });
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    const cities = form.affected_cities.split(',').map((c) => c.trim()).filter(Boolean);
    const { error } = await supabase.from('force_majeure_events' as any).insert({
      title: form.title,
      description: form.description || null,
      event_type: form.event_type,
      affected_country: form.affected_country,
      affected_region: form.affected_region || null,
      affected_cities: cities,
      starts_at: form.starts_at,
      ends_at: form.ends_at,
      host_compensation_pct: form.host_compensation_pct,
      source_reference: form.source_reference || null,
      declared_by: user?.id,
    });
    if (error) { toast({ title: 'Failed', description: error.message, variant: 'destructive' }); return; }
    await logAdminAction('CREATE_FORCE_MAJEURE', 'force_majeure_events', undefined, form);
    toast({ title: 'Declared', description: 'Force majeure event is now active.' });
    setOpen(false);
    setForm({ title: '', description: '', event_type: 'natural_disaster', affected_country: '', affected_region: '', affected_cities: '', starts_at: today, ends_at: today, host_compensation_pct: 50, source_reference: '' });
    fetchEvents();
  };

  const toggleActive = async (id: string, is_active: boolean) => {
    await supabase.from('force_majeure_events' as any).update({ is_active }).eq('id', id);
    await logAdminAction('TOGGLE_FORCE_MAJEURE', 'force_majeure_events', id, { is_active });
    fetchEvents();
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this event?')) return;
    await supabase.from('force_majeure_events' as any).delete().eq('id', id);
    await logAdminAction('DELETE_FORCE_MAJEURE', 'force_majeure_events', id);
    fetchEvents();
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-display font-bold flex items-center gap-2">
              <CloudLightning className="w-7 h-7 text-primary" /> Force Majeure & Disaster Events
            </h1>
            <p className="text-muted-foreground mt-1">Declare regional disruptions that auto-waive cancellation penalties and compensate hosts.</p>
          </div>
          <Button onClick={() => setOpen(true)} className="gap-2"><Plus className="w-4 h-4" /> Declare event</Button>
        </div>

        {loading && <div className="text-center text-muted-foreground py-12">Loading…</div>}
        {!loading && events.length === 0 && (
          <Card><CardContent className="py-12 text-center text-muted-foreground">No declared events.</CardContent></Card>
        )}

        <div className="grid gap-3">
          {events.map((ev) => (
            <Card key={ev.id} className={ev.is_active ? 'border-primary/30' : 'opacity-60'}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {ev.title}
                      {ev.is_active && <Badge className="bg-red-500/10 text-red-700 border-red-500/20" variant="outline">ACTIVE</Badge>}
                    </CardTitle>
                    <CardDescription className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {ev.affected_country}{ev.affected_region ? ` · ${ev.affected_region}` : ''}</span>
                      <span className="flex items-center gap-1"><CalIcon className="w-3 h-3" /> {format(new Date(ev.starts_at), 'd MMM')} – {format(new Date(ev.ends_at), 'd MMM yyyy')}</span>
                      <Badge variant="secondary">{EVENT_TYPE_LABELS[ev.event_type]}</Badge>
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={ev.is_active} onCheckedChange={(v) => toggleActive(ev.id, v)} />
                    <Button size="icon" variant="ghost" onClick={() => remove(ev.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                  </div>
                </div>
              </CardHeader>
              {(ev.description || ev.affected_cities.length > 0 || ev.source_reference) && (
                <CardContent className="text-sm space-y-2">
                  {ev.description && <p className="text-muted-foreground">{ev.description}</p>}
                  {ev.affected_cities.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {ev.affected_cities.map((c) => <Badge key={c} variant="outline" className="text-xs">{c}</Badge>)}
                    </div>
                  )}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>Host comp: <strong className="text-foreground">{ev.host_compensation_pct}%</strong> of subtotal</span>
                    {ev.source_reference && <span>· Source: {ev.source_reference}</span>}
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Declare force majeure event</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2"><Label>Title *</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Hurricane Maria" /></div>
              <div className="space-y-2"><Label>Type</Label>
                <Select value={form.event_type} onValueChange={(v) => setForm({ ...form, event_type: v as EventType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-2"><Label>Country *</Label><Input value={form.affected_country} onChange={(e) => setForm({ ...form, affected_country: e.target.value })} placeholder="Puerto Rico" /></div>
                <div className="space-y-2"><Label>Region</Label><Input value={form.affected_region} onChange={(e) => setForm({ ...form, affected_region: e.target.value })} placeholder="San Juan area" /></div>
              </div>
              <div className="space-y-2"><Label>Cities (comma-separated)</Label><Input value={form.affected_cities} onChange={(e) => setForm({ ...form, affected_cities: e.target.value })} placeholder="San Juan, Bayamón, Carolina" /></div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-2"><Label>Starts *</Label><Input type="date" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} /></div>
                <div className="space-y-2"><Label>Ends *</Label><Input type="date" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} /></div>
              </div>
              <div className="space-y-2"><Label>Host compensation (%)</Label><Input type="number" min={0} max={100} value={form.host_compensation_pct} onChange={(e) => setForm({ ...form, host_compensation_pct: parseInt(e.target.value, 10) || 0 })} /></div>
              <div className="space-y-2"><Label>Source / reference</Label><Input value={form.source_reference} onChange={(e) => setForm({ ...form, source_reference: e.target.value })} placeholder="Government declaration URL" /></div>
              <div className="space-y-2"><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={create}>Declare event</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}