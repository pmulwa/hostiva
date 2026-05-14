import { useEffect, useState, useMemo } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Search, Mail, Wallet, Copy, AlertTriangle, Download, Phone } from 'lucide-react';
import { format } from 'date-fns';

type HostPaymentRow = {
  user_id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  phone: string | null;
  paypal_email: string | null;
  is_verified: boolean | null;
  created_at: string;
  property_count: number;
  total_payouts: number;
};

export default function AdminHostPayments() {
  const { toast } = useToast();
  const [rows, setRows] = useState<HostPaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'configured' | 'missing'>('all');

  useEffect(() => {
    (async () => {
      setLoading(true);
      // Fetch all users with the 'host' role
      const { data: hostRoles } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'host');
      const hostIds = Array.from(new Set((hostRoles || []).map((r) => r.user_id)));
      if (hostIds.length === 0) {
        setRows([]);
        setLoading(false);
        return;
      }

      const [{ data: profiles }, { data: properties }, { data: payouts }] = await Promise.all([
        supabase
          .from('profiles')
          .select('user_id, full_name, email, avatar_url, phone, paypal_email, is_verified, created_at')
          .in('user_id', hostIds),
        supabase.from('properties').select('host_id').in('host_id', hostIds),
        supabase.from('payouts').select('host_id, amount, status').in('host_id', hostIds),
      ]);

      const propCountMap = new Map<string, number>();
      (properties || []).forEach((p: any) => {
        propCountMap.set(p.host_id, (propCountMap.get(p.host_id) || 0) + 1);
      });
      const payoutMap = new Map<string, number>();
      (payouts || []).forEach((p: any) => {
        if (p.status === 'paid') {
          payoutMap.set(p.host_id, (payoutMap.get(p.host_id) || 0) + Number(p.amount || 0));
        }
      });

      const enriched: HostPaymentRow[] = (profiles || []).map((p: any) => ({
        ...p,
        property_count: propCountMap.get(p.user_id) || 0,
        total_payouts: payoutMap.get(p.user_id) || 0,
      }));
      enriched.sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email));
      setRows(enriched);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    let list = rows;
    if (filter === 'configured') list = list.filter((r) => !!r.paypal_email);
    if (filter === 'missing') list = list.filter((r) => !r.paypal_email);
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      list = list.filter(
        (r) =>
          r.email.toLowerCase().includes(s) ||
          (r.full_name || '').toLowerCase().includes(s) ||
          (r.paypal_email || '').toLowerCase().includes(s)
      );
    }
    return list;
  }, [rows, filter, search]);

  const stats = useMemo(
    () => ({
      total: rows.length,
      configured: rows.filter((r) => !!r.paypal_email).length,
      missing: rows.filter((r) => !r.paypal_email).length,
      paidOut: rows.reduce((s, r) => s + r.total_payouts, 0),
    }),
    [rows]
  );

  const copyToClipboard = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    toast({ title: 'Copied', description: `${label} copied to clipboard` });
  };

  const exportCsv = () => {
    const headers = ['Full Name', 'Email', 'Phone', 'PayPal Email', 'Properties', 'Total Paid Out (USD)', 'Joined'];
    const lines = [
      headers.join(','),
      ...filtered.map((r) =>
        [
          `"${(r.full_name || '').replace(/"/g, '""')}"`,
          r.email,
          r.phone || '',
          r.paypal_email || '',
          r.property_count,
          r.total_payouts.toFixed(2),
          format(new Date(r.created_at), 'yyyy-MM-dd'),
        ].join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `host-payments-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AdminLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold">Host Payment Details</h1>
            <p className="text-sm text-muted-foreground mt-1">
              View payout configuration and earnings for every host on the platform.
            </p>
          </div>
          <Button onClick={exportCsv} variant="outline" className="gap-2">
            <Download className="w-4 h-4" />
            Export CSV
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Hosts" value={stats.total} />
          <StatCard label="Payout Configured" value={stats.configured} accent="success" />
          <StatCard label="Missing Payout Info" value={stats.missing} accent="warning" />
          <StatCard label="Total Paid Out" value={`$${stats.paidOut.toFixed(2)}`} />
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, or PayPal address…"
              className="pl-9"
            />
          </div>
          <div className="flex gap-2">
            {(['all', 'configured', 'missing'] as const).map((f) => (
              <Button
                key={f}
                variant={filter === f ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilter(f)}
                className="capitalize"
              >
                {f === 'missing' ? 'Missing payout' : f}
              </Button>
            ))}
          </div>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-12 text-center text-sm text-muted-foreground">Loading hosts…</div>
            ) : filtered.length === 0 ? (
              <div className="p-12 text-center text-sm text-muted-foreground">No hosts match these filters.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Host</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>PayPal Email</TableHead>
                    <TableHead className="text-right">Properties</TableHead>
                    <TableHead className="text-right">Paid Out</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.user_id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="w-9 h-9">
                            <AvatarImage src={r.avatar_url || ''} />
                            <AvatarFallback className="bg-primary/10 text-primary font-bold text-xs">
                              {(r.full_name || r.email)?.[0]?.toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">{r.full_name || '—'}</p>
                            {r.is_verified && (
                              <Badge variant="secondary" className="text-[9px] h-4 px-1.5 mt-0.5">Verified</Badge>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          <a
                            href={`mailto:${r.email}`}
                            className="flex items-center gap-1.5 text-xs text-foreground hover:text-primary truncate"
                          >
                            <Mail className="w-3 h-3 shrink-0" />
                            {r.email}
                          </a>
                          {r.phone ? (
                            <a
                              href={`tel:${r.phone}`}
                              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"
                            >
                              <Phone className="w-3 h-3 shrink-0" />
                              {r.phone}
                            </a>
                          ) : (
                            <span className="text-[10px] text-muted-foreground italic">No phone</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {r.paypal_email ? (
                          <button
                            onClick={() => copyToClipboard(r.paypal_email!, 'PayPal email')}
                            className="flex items-center gap-1.5 text-xs font-mono px-2 py-1 rounded-md bg-muted/60 hover:bg-muted transition-colors max-w-[240px] group"
                          >
                            <Wallet className="w-3 h-3 text-primary shrink-0" />
                            <span className="truncate">{r.paypal_email}</span>
                            <Copy className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
                          </button>
                        ) : (
                          <Badge variant="outline" className="gap-1 text-[10px] text-destructive border-destructive/40">
                            <AlertTriangle className="w-3 h-3" />
                            Not configured
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        {r.property_count}
                      </TableCell>
                      <TableCell className="text-right text-sm font-mono font-medium">
                        ${r.total_payouts.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(r.created_at), 'MMM d, yyyy')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: 'success' | 'warning';
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
          {label}
        </p>
        <p
          className={`font-display text-2xl font-bold mt-1 ${
            accent === 'success'
              ? 'text-green-600'
              : accent === 'warning'
              ? 'text-destructive'
              : 'text-foreground'
          }`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
