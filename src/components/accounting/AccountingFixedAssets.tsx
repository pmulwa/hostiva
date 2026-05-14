import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Trash2, Boxes } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { fmtMoney, D } from '@/lib/accounting/money';
import { format } from 'date-fns';
import { useBaseCurrency } from '@/hooks/useBaseCurrency';
import { AccountPicker, type PickerAccount } from './AccountPicker';
import { PinConfirmDialog } from './PinConfirmDialog';

interface Asset {
  id: string; description: string; purchase_date: string; cost: number;
  useful_life_years: number; accumulated_depreciation: number; last_depreciation_date: string | null;
  asset_account_id: string | null;
}

export function AccountingFixedAssets({ hostId }: { hostId: string }) {
  const { toast } = useToast();
  const baseCurrency = useBaseCurrency(hostId);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [accounts, setAccounts] = useState<PickerAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const [description, setDescription] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [cost, setCost] = useState('');
  const [life, setLife] = useState('5');
  const [assetAccountId, setAssetAccountId] = useState('');

  const load = async () => {
    setLoading(true);
    const [a, accs] = await Promise.all([
      supabase.from('acct_fixed_assets').select('*').eq('host_id', hostId).order('purchase_date', { ascending: false }),
      supabase.from('acct_chart_of_accounts').select('id, code, name, type').eq('host_id', hostId).eq('is_active', true).order('code'),
    ]);
    setAssets((a.data ?? []) as any);
    setAccounts((accs.data ?? []) as any);
    setLoading(false);
  };
  useEffect(() => { load(); }, [hostId]);

  // Default to Furniture & fixtures
  useEffect(() => {
    if (assetAccountId || accounts.length === 0) return;
    setAssetAccountId(accounts.find((a) => a.code === '1520')?.id ?? '');
  }, [accounts]);

  const submit = async () => {
    if (!description || !cost) { toast({ title: 'Fill required fields', variant: 'destructive' }); return; }
    if (!assetAccountId) { toast({ title: 'Pick an asset account', variant: 'destructive' }); return; }
    const { error } = await supabase.from('acct_fixed_assets').insert({
      host_id: hostId, description, purchase_date: purchaseDate,
      cost: Number(cost), useful_life_years: Number(life),
      asset_account_id: assetAccountId,
    });
    if (error) { toast({ title: 'Failed', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Asset added' });
    setOpen(false); setDescription(''); setCost(''); setLife('5'); load();
  };

  const del = async (id: string) => {
    setPendingDeleteId(id);
  };

  const performDelete = async () => {
    if (!pendingDeleteId) return;
    await supabase.from('acct_fixed_assets').delete().eq('id', pendingDeleteId);
    setPendingDeleteId(null);
    toast({ title: 'Asset deleted' });
    load();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Fixed assets</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">Capitalized purchases (furniture, appliances, electronics).</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="w-4 h-4 mr-1" />Add asset</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add fixed asset</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Description *</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Purchase date</Label><Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} /></div>
                <div><Label>Cost *</Label><Input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
              </div>
              <div>
                <Label>Asset account *</Label>
                <AccountPicker
                  accounts={accounts}
                  value={assetAccountId}
                  onChange={setAssetAccountId}
                  types={['asset']}
                  codePrefixes={['15']}
                />
              </div>
              <div><Label>Useful life (years)</Label><Input type="number" value={life} onChange={(e) => setLife(e.target.value)} /></div>
              <Button onClick={submit} className="w-full">Save</Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : assets.length === 0 ? (
          <div className="text-center py-10 text-sm text-muted-foreground">
            <Boxes className="w-8 h-8 mx-auto mb-2 opacity-50" />
            No fixed assets. Add one here, or capitalize a large purchase from the Expenses tab.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead><TableHead>Purchased</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Accum. dep.</TableHead>
                <TableHead className="text-right">Net book value</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assets.map((a) => {
                const nbv = D(a.cost).minus(D(a.accumulated_depreciation));
                return (
                  <TableRow key={a.id}>
                    <TableCell>{a.description}</TableCell>
                    <TableCell className="text-xs">{a.purchase_date} ({a.useful_life_years}y)</TableCell>
                    <TableCell className="text-right">{fmtMoney(a.cost, baseCurrency)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(a.accumulated_depreciation, baseCurrency)}</TableCell>
                    <TableCell className="text-right font-medium">{fmtMoney(nbv, baseCurrency)}</TableCell>
                    <TableCell><Button size="icon" variant="ghost" onClick={() => del(a.id)}><Trash2 className="w-4 h-4" /></Button></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <PinConfirmDialog
        open={!!pendingDeleteId}
        onOpenChange={(v) => { if (!v) setPendingDeleteId(null); }}
        title="Delete this fixed asset?"
        description="Removes the asset record. Enter your accounting PIN to confirm."
        confirmLabel="Delete asset"
        onConfirmed={performDelete}
      />
    </Card>
  );
}
