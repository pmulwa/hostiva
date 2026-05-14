import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { PinConfirmDialog } from './PinConfirmDialog';

interface Account { id: string; code: string; name: string; type: string; is_system: boolean; }

const TYPE_OPTIONS: { value: Account['type']; label: string; defaultPrefix: string }[] = [
  { value: 'asset',     label: 'Asset',     defaultPrefix: '1' },
  { value: 'liability', label: 'Liability', defaultPrefix: '2' },
  { value: 'equity',    label: 'Equity',    defaultPrefix: '3' },
  { value: 'revenue',   label: 'Revenue',   defaultPrefix: '4' },
  { value: 'expense',   label: 'Expense',   defaultPrefix: '6' },
];

export function AccountingChartOfAccounts({ hostId }: { hostId: string }) {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<Account['type']>('expense');
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Account | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('acct_chart_of_accounts')
      .select('id, code, name, type, is_system')
      .eq('host_id', hostId)
      .order('code');
    setAccounts((data ?? []) as any);
    setLoading(false);
  };
  useEffect(() => { load(); }, [hostId]);

  const submit = async () => {
    const c = code.trim();
    const n = name.trim();
    if (!/^\d{3,6}$/.test(c)) { toast({ title: 'Code must be 3–6 digits', variant: 'destructive' }); return; }
    if (!n) { toast({ title: 'Name required', variant: 'destructive' }); return; }
    if (accounts.some((a) => a.code === c)) { toast({ title: `Code ${c} already exists`, variant: 'destructive' }); return; }
    setSaving(true);
    const { error } = await supabase.from('acct_chart_of_accounts').insert({
      host_id: hostId, code: c, name: n, type: type as any, is_system: false, is_active: true,
    });
    setSaving(false);
    if (error) { toast({ title: 'Could not add account', description: error.message, variant: 'destructive' }); return; }
    toast({ title: `Added ${c} — ${n}` });
    setCode(''); setName(''); setType('expense');
    setOpen(false);
    load();
  };

  const performDelete = async () => {
    if (!pendingDelete) return;
    if (pendingDelete.is_system) {
      toast({ title: 'System accounts cannot be deleted', variant: 'destructive' });
      setPendingDelete(null);
      return;
    }
    const { error } = await supabase.from('acct_chart_of_accounts').delete().eq('id', pendingDelete.id);
    if (error) {
      toast({ title: 'Could not delete', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Account deleted' });
    }
    setPendingDelete(null);
    load();
  };

  if (loading) return <Skeleton className="h-96 w-full" />;

  const groups = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;
  const labels = { asset: 'Assets', liability: 'Liabilities', equity: 'Equity', revenue: 'Revenue', expense: 'Expenses' };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Chart of accounts ({accounts.length})</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Add custom accounts for anything missing — Rent, payroll, HOA fees, etc. System accounts can't be deleted.
            </p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Add account</Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>Add a new account</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Type</Label>
                  <Select value={type} onValueChange={(v) => setType(v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TYPE_OPTIONS.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label} (codes start with {t.defaultPrefix})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label>Code</Label>
                    <Input
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="e.g. 6121"
                      inputMode="numeric"
                    />
                  </div>
                  <div className="col-span-2">
                    <Label>Name</Label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rent — guest-house" />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Tip: use the next free 4-digit code in the type's range (assets 1xxx, liabilities 2xxx, equity 3xxx, revenue 4xxx, expenses 5xxx–7xxx).
                </p>
                <Button onClick={submit} disabled={saving} className="w-full">
                  {saving ? 'Saving…' : 'Add account'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
      </Card>

      {groups.map((g) => {
        const rows = accounts.filter((a) => a.type === g);
        return (
          <Card key={g}>
            <CardHeader><CardTitle className="text-base">{labels[g]} ({rows.length})</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-24"></TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-mono text-xs">{a.code}</TableCell>
                      <TableCell>{a.name}</TableCell>
                      <TableCell>{a.is_system && <Badge variant="outline" className="text-[10px]">System</Badge>}</TableCell>
                      <TableCell>
                        {!a.is_system && (
                          <Button
                            size="icon" variant="ghost" className="h-7 w-7"
                            onClick={() => setPendingDelete(a)}
                            aria-label={`Delete ${a.code} ${a.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}
      <PinConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(v) => { if (!v) setPendingDelete(null); }}
        title="Delete this account?"
        description={pendingDelete ? `Remove "${pendingDelete.code} — ${pendingDelete.name}" from the chart of accounts. Existing journal entries are kept but will lose this label.` : ''}
        confirmLabel="Delete account"
        onConfirmed={performDelete}
      />
    </div>
  );
}
