import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { D, fmtMoney } from '@/lib/accounting/money';
import { getIncomeStatement, getAccountBalances, type AccountBalance } from '@/lib/accounting/statements';
import { startOfMonth, endOfMonth, format, startOfYear } from 'date-fns';
import { TrendingUp, TrendingDown, DollarSign, Receipt, Wallet, Sparkles } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, Legend } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { useBaseCurrency } from '@/hooks/useBaseCurrency';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

const COLORS = ['hsl(var(--primary))', '#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#ef4444', '#06b6d4'];

export function AccountingDashboard({ hostId }: { hostId: string }) {
  const baseCurrency = useBaseCurrency(hostId);
  const [loading, setLoading] = useState(true);
  const [mtdRev, setMtdRev] = useState(D(0));
  const [mtdExp, setMtdExp] = useState(D(0));
  const [ytdRev, setYtdRev] = useState(D(0));
  const [ytdExp, setYtdExp] = useState(D(0));
  const [revenueByPlatform, setRevenueByPlatform] = useState<{ name: string; value: number }[]>([]);
  const [topExpenses, setTopExpenses] = useState<{ name: string; value: number }[]>([]);
  const [cashAccounts, setCashAccounts] = useState<AccountBalance[]>([]);
  const [hasAnyActivity, setHasAnyActivity] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const today = new Date();
        const monthStart = format(startOfMonth(today), 'yyyy-MM-dd');
        const monthEnd = format(endOfMonth(today), 'yyyy-MM-dd');
        const yearStart = format(startOfYear(today), 'yyyy-MM-dd');
        const yearEnd = format(today, 'yyyy-MM-dd');

        const [mtd, ytd, allBalances] = await Promise.all([
          getIncomeStatement(hostId, monthStart, monthEnd),
          getIncomeStatement(hostId, yearStart, yearEnd),
          getAccountBalances(hostId, yearEnd),
        ]);
        setMtdRev(mtd.totalRevenue);
        setMtdExp(mtd.totalExpenses);
        setYtdRev(ytd.totalRevenue);
        setYtdExp(ytd.totalExpenses);

        // Cash & bank balances (codes 10xx and 11xx)
        const cash = allBalances.filter(
          (b) => b.type === 'asset' && (b.code.startsWith('10') || b.code.startsWith('11')) && !b.balance.eq(0)
        );
        setCashAccounts(cash);

        setHasAnyActivity(allBalances.some((b) => !b.balance.eq(0)));

        const platformRevs = ytd.revenueRows
          .filter((r) => r.code.startsWith('40') && r.code !== '4100' && r.code !== '4110' && r.code !== '4120')
          .map((r) => ({ name: r.name.replace('Rental revenue — ', ''), value: r.balance.toNumber() }));
        setRevenueByPlatform(platformRevs);

        const exps = ytd.expenseRows
          .sort((a, b) => b.balance.toNumber() - a.balance.toNumber())
          .slice(0, 5)
          .map((r) => ({ name: r.name, value: r.balance.toNumber() }));
        setTopExpenses(exps);
      } finally {
        setLoading(false);
      }
    })();
  }, [hostId]);

  if (loading) return <Skeleton className="h-96 w-full" />;

  const mtdProfit = mtdRev.minus(mtdExp);
  const ytdProfit = ytdRev.minus(ytdExp);
  const totalCash = cashAccounts.reduce((s, a) => s.plus(a.balance), D(0));

  return (
    <div className="space-y-4">
      {!hasAnyActivity && (
        <Alert>
          <Sparkles className="h-4 w-4" />
          <AlertDescription className="text-sm">
            <strong>Welcome!</strong> Your books are empty. Get started in 3 steps:
            <ol className="list-decimal ml-5 mt-1 space-y-0.5 text-xs">
              <li>Open <strong>Settings</strong> → set your base currency and run the Opening Balances wizard.</li>
              <li>Use <strong>Bookings</strong> to record off-platform reservations or <strong>Expenses</strong> for purchases.</li>
              <li>View live financials in <strong>Reports</strong>.</li>
            </ol>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={<DollarSign />} label="Revenue (MTD)" value={fmtMoney(mtdRev, baseCurrency)} />
        <KpiCard icon={<Receipt />} label="Expenses (MTD)" value={fmtMoney(mtdExp, baseCurrency)} />
        <KpiCard
          icon={mtdProfit.gte(0) ? <TrendingUp /> : <TrendingDown />}
          label="Net profit (MTD)"
          value={fmtMoney(mtdProfit, baseCurrency)}
          tone={mtdProfit.gte(0) ? 'positive' : 'negative'}
        />
        <KpiCard
          icon={<TrendingUp />}
          label="Net profit (YTD)"
          value={fmtMoney(ytdProfit, baseCurrency)}
          tone={ytdProfit.gte(0) ? 'positive' : 'negative'}
        />
      </div>

      {/* Live balances panel */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Wallet className="w-4 h-4" /> Cash & bank balances
          </CardTitle>
          <Badge variant="outline">Total: {fmtMoney(totalCash, baseCurrency)}</Badge>
        </CardHeader>
        <CardContent>
          {cashAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No balances yet. Set opening balances in <strong>Settings</strong> or record your first transaction.
            </p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {cashAccounts.map((a) => (
                <div key={a.account_id} className="rounded-md border p-3">
                  <div className="text-[11px] text-muted-foreground font-mono">{a.code}</div>
                  <div className="text-xs truncate">{a.name}</div>
                  <div className="text-base font-semibold mt-1">{fmtMoney(a.balance, baseCurrency)}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Revenue by platform (YTD)</CardTitle></CardHeader>
          <CardContent>
            {revenueByPlatform.length === 0 ? (
              <p className="text-sm text-muted-foreground">No revenue recorded yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={revenueByPlatform} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                    {revenueByPlatform.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => fmtMoney(v, baseCurrency)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Top expenses (YTD)</CardTitle></CardHeader>
          <CardContent>
            {topExpenses.length === 0 ? (
              <p className="text-sm text-muted-foreground">No expenses recorded yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={topExpenses} layout="vertical">
                  <XAxis type="number" tickFormatter={(v) => fmtMoney(v, baseCurrency).replace(/\.\d+/, '')} />
                  <YAxis type="category" dataKey="name" width={140} fontSize={11} />
                  <Tooltip formatter={(v: any) => fmtMoney(v, baseCurrency)} />
                  <Bar dataKey="value" fill="hsl(var(--primary))" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({
  icon, label, value, tone,
}: { icon: React.ReactNode; label: string; value: string; tone?: 'positive' | 'negative' }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">{label}</span>
          <span className="text-muted-foreground [&_svg]:w-4 [&_svg]:h-4">{icon}</span>
        </div>
        <div className={`text-xl font-bold ${tone === 'positive' ? 'text-emerald-600' : tone === 'negative' ? 'text-destructive' : ''}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
