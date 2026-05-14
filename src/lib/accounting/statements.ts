import { supabase } from '@/integrations/supabase/client';
import { D } from './money';
import Decimal from 'decimal.js';

export interface AccountBalance {
  account_id: string;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  debit: Decimal;
  credit: Decimal;
  balance: Decimal; // signed: assets/expenses positive when debit; liab/equity/revenue positive when credit
}

/**
 * Returns balances for every account up to (and including) endDate.
 * If startDate provided, only sums activity in [startDate, endDate].
 */
export async function getAccountBalances(
  hostId: string,
  endDate: string,
  startDate?: string
): Promise<AccountBalance[]> {
  // Pull accounts
  const { data: accounts, error: accErr } = await supabase
    .from('acct_chart_of_accounts')
    .select('id, code, name, type')
    .eq('host_id', hostId)
    .order('code');
  if (accErr) throw accErr;

  // Pull entries in window
  let q = supabase
    .from('acct_journal_entries')
    .select('id, entry_date, acct_journal_lines(account_id, debit, credit)')
    .eq('host_id', hostId)
    .lte('entry_date', endDate)
    .eq('posted', true);
  if (startDate) q = q.gte('entry_date', startDate);

  const { data: entries, error: entErr } = await q;
  if (entErr) throw entErr;

  const totals: Record<string, { debit: Decimal; credit: Decimal }> = {};
  for (const e of entries ?? []) {
    for (const line of (e as any).acct_journal_lines ?? []) {
      const acc = line.account_id;
      if (!totals[acc]) totals[acc] = { debit: D(0), credit: D(0) };
      totals[acc].debit = totals[acc].debit.plus(D(line.debit));
      totals[acc].credit = totals[acc].credit.plus(D(line.credit));
    }
  }

  return (accounts ?? []).map((a) => {
    const t = totals[a.id] ?? { debit: D(0), credit: D(0) };
    let balance: Decimal;
    if (a.type === 'asset' || a.type === 'expense') {
      balance = t.debit.minus(t.credit);
    } else {
      balance = t.credit.minus(t.debit);
    }
    return {
      account_id: a.id,
      code: a.code,
      name: a.name,
      type: a.type as any,
      debit: t.debit,
      credit: t.credit,
      balance,
    };
  });
}

export interface IncomeStatement {
  revenueRows: AccountBalance[];
  expenseRows: AccountBalance[];
  totalRevenue: Decimal;
  totalExpenses: Decimal;
  netIncome: Decimal;
}

export async function getIncomeStatement(
  hostId: string,
  startDate: string,
  endDate: string
): Promise<IncomeStatement> {
  const balances = await getAccountBalances(hostId, endDate, startDate);
  const revenueRows = balances.filter((b) => b.type === 'revenue' && !b.balance.eq(0));
  const expenseRows = balances.filter((b) => b.type === 'expense' && !b.balance.eq(0));
  const totalRevenue = revenueRows.reduce((s, r) => s.plus(r.balance), D(0));
  const totalExpenses = expenseRows.reduce((s, r) => s.plus(r.balance), D(0));
  return {
    revenueRows,
    expenseRows,
    totalRevenue,
    totalExpenses,
    netIncome: totalRevenue.minus(totalExpenses),
  };
}

export interface BalanceSheet {
  assetRows: AccountBalance[];
  liabilityRows: AccountBalance[];
  equityRows: AccountBalance[];
  totalAssets: Decimal;
  totalLiabilities: Decimal;
  totalEquity: Decimal;
  currentEarnings: Decimal;
  isBalanced: boolean;
}

export async function getBalanceSheet(hostId: string, asOf: string): Promise<BalanceSheet> {
  const balances = await getAccountBalances(hostId, asOf);
  const assetRows = balances.filter((b) => b.type === 'asset' && !b.balance.eq(0));
  const liabilityRows = balances.filter((b) => b.type === 'liability' && !b.balance.eq(0));
  const equityRows = balances.filter((b) => b.type === 'equity' && !b.balance.eq(0));
  const revenueRows = balances.filter((b) => b.type === 'revenue');
  const expenseRows = balances.filter((b) => b.type === 'expense');
  const currentEarnings = revenueRows
    .reduce((s, r) => s.plus(r.balance), D(0))
    .minus(expenseRows.reduce((s, r) => s.plus(r.balance), D(0)));

  const totalAssets = assetRows.reduce((s, r) => s.plus(r.balance), D(0));
  const totalLiabilities = liabilityRows.reduce((s, r) => s.plus(r.balance), D(0));
  const totalEquity = equityRows.reduce((s, r) => s.plus(r.balance), D(0)).plus(currentEarnings);
  const isBalanced = totalAssets.minus(totalLiabilities.plus(totalEquity)).abs().lessThan(0.01);

  return {
    assetRows,
    liabilityRows,
    equityRows,
    totalAssets,
    totalLiabilities,
    totalEquity,
    currentEarnings,
    isBalanced,
  };
}

export interface CashFlowStatement {
  netIncome: Decimal;
  depreciation: Decimal;
  operatingCash: Decimal;
  investingCash: Decimal;
  financingCash: Decimal;
  netChange: Decimal;
}

export async function getCashFlow(
  hostId: string,
  startDate: string,
  endDate: string
): Promise<CashFlowStatement> {
  const inc = await getIncomeStatement(hostId, startDate, endDate);
  // Depreciation expense (account code 6500)
  const depRow = inc.expenseRows.find((r) => r.code === '6500');
  const depreciation = depRow?.balance ?? D(0);
  // Simplified cash flow indirect method
  const operatingCash = inc.netIncome.plus(depreciation);
  return {
    netIncome: inc.netIncome,
    depreciation,
    operatingCash,
    investingCash: D(0),
    financingCash: D(0),
    netChange: operatingCash,
  };
}
