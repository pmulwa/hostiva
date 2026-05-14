import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { AlertTriangle, ShieldAlert, Wrench, Sparkles, Wifi, ThermometerSun, KeyRound, HelpCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const CATEGORIES = [
  { value: 'safety', label: 'Safety / Security', icon: ShieldAlert },
  { value: 'cleanliness', label: 'Cleanliness', icon: Sparkles },
  { value: 'maintenance', label: 'Maintenance / Repair', icon: Wrench },
  { value: 'utilities', label: 'Utilities (water, power, gas)', icon: ThermometerSun },
  { value: 'wifi', label: 'Wi-Fi / Connectivity', icon: Wifi },
  { value: 'access', label: 'Access / Lock-out', icon: KeyRound },
  { value: 'other', label: 'Other', icon: HelpCircle },
] as const;

const SEVERITIES = [
  { value: 'low', label: 'Low — minor inconvenience', tone: 'text-muted-foreground' },
  { value: 'medium', label: 'Medium — affects my stay', tone: 'text-yellow-600' },
  { value: 'high', label: 'High — major problem', tone: 'text-orange-600' },
  { value: 'emergency', label: 'Emergency — unsafe / unusable', tone: 'text-destructive' },
] as const;

interface ReportIssueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingId: string;
  propertyId: string;
  guestId: string;
  hostId: string;
  onReported?: () => void;
}

export function ReportIssueDialog({
  open,
  onOpenChange,
  bookingId,
  propertyId,
  guestId,
  hostId,
  onReported,
}: ReportIssueDialogProps) {
  const { toast } = useToast();
  const [category, setCategory] = useState<string>('maintenance');
  const [severity, setSeverity] = useState<string>('medium');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setCategory('maintenance');
    setSeverity('medium');
    setDescription('');
  };

  const submit = async () => {
    if (description.trim().length < 10) {
      toast({
        title: 'More detail needed',
        description: 'Please describe the issue in at least 10 characters so the host can help.',
        variant: 'destructive',
      });
      return;
    }
    setBusy(true);
    const { error } = await supabase.from('booking_issues').insert({
      booking_id: bookingId,
      property_id: propertyId,
      guest_id: guestId,
      host_id: hostId,
      category,
      severity,
      description: description.trim(),
    });
    if (error) {
      toast({ title: 'Could not submit', description: error.message, variant: 'destructive' });
      setBusy(false);
      return;
    }

    const sevLabel = SEVERITIES.find((s) => s.value === severity)?.label.split('—')[0].trim() || severity;
    const catLabel = CATEGORIES.find((c) => c.value === category)?.label || category;
    await supabase.from('messages').insert({
      booking_id: bookingId,
      sender_id: guestId,
      receiver_id: hostId,
      content: `🚨 Issue reported — ${catLabel} (${sevLabel})\n\n${description.trim()}`,
      message_type: 'system',
    });

    toast({
      title: severity === 'emergency' ? 'Emergency reported' : 'Issue reported',
      description: severity === 'emergency'
        ? 'Your host and Hostiva support have been notified. For immediate danger, call local emergency services first.'
        : 'Your host has been notified and will respond shortly.',
    });
    setBusy(false);
    reset();
    onReported?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-500" /> Report an Issue
          </DialogTitle>
          <DialogDescription>
            Tell your host what's wrong. They'll be notified immediately. For emergencies, contact local services first.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <Label htmlFor="category">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    <span className="inline-flex items-center gap-2">
                      <c.icon className="w-4 h-4" /> {c.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Severity</Label>
            <RadioGroup value={severity} onValueChange={setSeverity} className="space-y-2">
              {SEVERITIES.map((s) => (
                <label
                  key={s.value}
                  htmlFor={`sev-${s.value}`}
                  className="flex items-center gap-3 rounded-md border border-border p-3 cursor-pointer hover:bg-accent"
                >
                  <RadioGroupItem id={`sev-${s.value}`} value={s.value} />
                  <span className={`text-sm font-medium ${s.tone}`}>{s.label}</span>
                </label>
              ))}
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="desc">What's happening?</Label>
            <Textarea
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the issue, when it started, and any steps you've tried."
              rows={5}
            />
            <p className="text-xs text-muted-foreground">{description.length} / 1000</p>
          </div>

          {severity === 'emergency' && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <strong>For life-threatening emergencies, call local emergency services first.</strong> Then submit this report so we can coordinate with your host.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy} className={severity === 'emergency' ? 'bg-destructive hover:bg-destructive/90' : ''}>
            {busy ? 'Submitting…' : 'Submit Report'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}