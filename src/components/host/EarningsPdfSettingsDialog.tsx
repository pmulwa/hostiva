import { useState, useMemo, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { FileText, Filter, Sliders } from 'lucide-react';

export type PdfStatusFilter = 'all' | 'completed' | 'cancelled' | 'confirmed';
export type PdfDateRange = 'all' | '30d' | '90d' | 'ytd' | 'custom';

export interface PdfExportOptions {
  fileName: string;
  statusFilter: PdfStatusFilter;
  dateRange: PdfDateRange;
  customStart: string; // yyyy-MM-dd
  customEnd: string;   // yyyy-MM-dd
  includePenalties: boolean;
  includePayoutsSummary: boolean;
  includeBreakdown: boolean;
  includeBookings: boolean;
}

export const DEFAULT_PDF_OPTIONS: PdfExportOptions = {
  fileName: '',
  statusFilter: 'all',
  dateRange: 'all',
  customStart: '',
  customEnd: '',
  includePenalties: true,
  includePayoutsSummary: true,
  includeBreakdown: true,
  includeBookings: true,
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultFileName: string;
  onExport: (opts: PdfExportOptions) => void | Promise<void>;
  computeMatchingCount: (opts: PdfExportOptions) => number;
}

export function EarningsPdfSettingsDialog({
  open, onOpenChange, defaultFileName, onExport, computeMatchingCount,
}: Props) {
  const [opts, setOpts] = useState<PdfExportOptions>({ ...DEFAULT_PDF_OPTIONS, fileName: defaultFileName });

  useEffect(() => {
    if (open) setOpts((o) => ({ ...o, fileName: o.fileName || defaultFileName }));
  }, [open, defaultFileName]);

  const update = <K extends keyof PdfExportOptions>(k: K, v: PdfExportOptions[K]) =>
    setOpts((o) => ({ ...o, [k]: v }));

  const matching = useMemo(() => computeMatchingCount(opts), [opts, computeMatchingCount]);

  const safeFileName = (raw: string) => {
    const cleaned = (raw || defaultFileName).trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\.pdf$/i, '');
    return cleaned || defaultFileName;
  };

  const submit = async () => {
    await onExport({ ...opts, fileName: safeFileName(opts.fileName) });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-primary" /> PDF export settings
          </DialogTitle>
          <DialogDescription>
            Choose the filename, filter which bookings to include and decide which sections to add.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* File name */}
          <div className="space-y-2">
            <Label htmlFor="pdf-filename" className="text-sm font-medium flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-muted-foreground" /> File name
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="pdf-filename"
                value={opts.fileName}
                onChange={(e) => update('fileName', e.target.value)}
                placeholder={defaultFileName}
                className="rounded-lg"
              />
              <span className="text-sm text-muted-foreground shrink-0">.pdf</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Special characters <code className="text-[10px]">/ \ : * ? " &lt; &gt; |</code> will be replaced with “-”.
            </p>
          </div>

          <Separator />

          {/* Filters */}
          <div className="space-y-3">
            <Label className="text-sm font-medium flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-muted-foreground" /> Booking filters
            </Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Status</Label>
                <Select value={opts.statusFilter} onValueChange={(v) => update('statusFilter', v as PdfStatusFilter)}>
                  <SelectTrigger className="rounded-lg"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="completed">Completed only</SelectItem>
                    <SelectItem value="cancelled">Cancelled only</SelectItem>
                    <SelectItem value="confirmed">Confirmed (upcoming)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Date range (check-in)</Label>
                <Select value={opts.dateRange} onValueChange={(v) => update('dateRange', v as PdfDateRange)}>
                  <SelectTrigger className="rounded-lg"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All time</SelectItem>
                    <SelectItem value="30d">Last 30 days</SelectItem>
                    <SelectItem value="90d">Last 90 days</SelectItem>
                    <SelectItem value="ytd">Year to date</SelectItem>
                    <SelectItem value="custom">Custom range…</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {opts.dateRange === 'custom' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">From</Label>
                  <Input type="date" value={opts.customStart} onChange={(e) => update('customStart', e.target.value)} className="rounded-lg" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">To</Label>
                  <Input type="date" value={opts.customEnd} onChange={(e) => update('customEnd', e.target.value)} className="rounded-lg" />
                </div>
              </div>
            )}

            <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{matching}</span> booking{matching === 1 ? '' : 's'} match this filter.
            </div>
          </div>

          <Separator />

          {/* Sections to include */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Sections to include</Label>
            <div className="space-y-2.5">
              <SectionToggle label="Earnings breakdown table" desc="Gross, deductions and take-home summary." checked={opts.includeBreakdown} onChange={(v) => update('includeBreakdown', v)} />
              <SectionToggle label="Payouts summary" desc="Next payout total, scheduled releases and cancelled $0 take-home count." checked={opts.includePayoutsSummary} onChange={(v) => update('includePayoutsSummary', v)} />
              <SectionToggle label="Pending penalty deductions" desc="Penalties auto-applied to your next payout." checked={opts.includePenalties} onChange={(v) => update('includePenalties', v)} />
              <SectionToggle label="Bookings table" desc="Full booking-by-booking line items." checked={opts.includeBookings} onChange={(v) => update('includeBookings', v)} />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} className="gap-2">
            <FileText className="w-4 h-4" /> Download PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SectionToggle({
  label, desc, checked, onChange,
}: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/30 transition-colors">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(Boolean(v))} className="mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{desc}</p>
      </div>
    </label>
  );
}