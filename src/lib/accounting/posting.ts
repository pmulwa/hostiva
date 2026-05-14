import { supabase } from '@/integrations/supabase/client';
import { D } from './money';
import { postJournalEntry } from './journal';
import { getAccountByCode } from './init';

interface ExternalBookingInput {
  host_id: string;
  property_id?: string | null;
  platform_id?: string | null;
  platform_name: string;
  guest_name?: string;
  check_in_date: string;
  check_out_date: string;
  num_nights: number;
  gross_revenue: number;
  cleaning_fee?: number;
  extra_fees?: number;
  commission_amount?: number;
  processing_fees?: number;
  taxes_collected?: number;
  net_payout: number;
  payment_method?: string;
  payment_received_date?: string;
  notes?: string;
  txn_currency?: string;
  fx_rate?: number;
  /** Cash-basis flag: true = money received → debit cash/bank; false = debit Accounts receivable. */
  payment_received?: boolean;
  // Explicit account IDs picked from Chart of Accounts (preferred).
  // If omitted, the system falls back to platform-based defaults.
  deposit_account_id?: string | null;        // where the net payout lands (asset/liability)
  revenue_account_id?: string | null;        // gross rental revenue
  commission_account_id?: string | null;     // platform commission expense
  cleaning_revenue_account_id?: string | null;
  extra_fees_account_id?: string | null;
  tax_account_id?: string | null;            // tax collected (liability)
  processing_fees_account_id?: string | null;
}

const PLATFORM_REVENUE_CODE: Record<string, string> = {
  'Hostiva': '4010', 'Airbnb': '4020', 'Booking.com': '4030',
  'Vrbo': '4040', 'Direct': '4050', 'Walk-in': '4060',
};
const PLATFORM_COMMISSION_CODE: Record<string, string> = {
  'Hostiva': '5010', 'Airbnb': '5020', 'Booking.com': '5030', 'Vrbo': '5040',
};

export async function createExternalBookingWithJournal(input: ExternalBookingInput): Promise<string> {
  const fx = D(input.fx_rate ?? 1);
  if (fx.lte(0)) throw new Error('FX rate must be > 0');
  const txnCcy = (input.txn_currency || 'USD').toUpperCase();

  const grossTxn = D(input.gross_revenue);
  const cleanTxn = D(input.cleaning_fee ?? 0);
  const extraTxn = D(input.extra_fees ?? 0);
  const commTxn = D(input.commission_amount ?? 0);
  const procTxn = D(input.processing_fees ?? 0);
  const taxTxn = D(input.taxes_collected ?? 0);
  const netTxn = D(input.net_payout);

  const grossRev = grossTxn.times(fx);
  const cleaning = cleanTxn.times(fx);
  const extra = extraTxn.times(fx);
  const commission = commTxn.times(fx);
  const processing = procTxn.times(fx);
  const taxes = taxTxn.times(fx);
  const netPayout = netTxn.times(fx);

  const { data: booking, error: bookErr } = await supabase
    .from('acct_external_bookings')
    .insert({
      host_id: input.host_id,
      property_id: input.property_id ?? null,
      platform_id: input.platform_id ?? null,
      guest_name: input.guest_name ?? null,
      check_in_date: input.check_in_date,
      check_out_date: input.check_out_date,
      num_nights: input.num_nights,
      gross_revenue: grossTxn.toNumber(),
      cleaning_fee: cleanTxn.toNumber(),
      extra_fees: extraTxn.toNumber(),
      commission_amount: commTxn.toNumber(),
      processing_fees: procTxn.toNumber(),
      taxes_collected: taxTxn.toNumber(),
      net_payout: netTxn.toNumber(),
      payment_method: input.payment_method ?? null,
      payment_received_date: input.payment_received_date ?? null,
      notes: input.notes ?? null,
      txn_currency: txnCcy,
      fx_rate: fx.toNumber(),
      base_amount: netPayout.toNumber(),
    } as any)
    .select('id')
    .single();
  if (bookErr || !booking) throw bookErr ?? new Error('Booking insert failed');

  // Resolve accounts: prefer explicit IDs, fall back to platform defaults.
  const revCode = PLATFORM_REVENUE_CODE[input.platform_name] ?? '4070';
  const commCode = PLATFORM_COMMISSION_CODE[input.platform_name] ?? '5050';

  // Cash-basis routing: if payment NOT yet received, debit Accounts Receivable (1200) instead of cash/bank.
  const received = input.payment_received !== false; // default true for backward compat
  const debitAccId = received
    ? (input.deposit_account_id ?? (await getAccountByCode(input.host_id, '1020')))
    : (await getAccountByCode(input.host_id, '1200'));
  const revAccId = input.revenue_account_id
    ?? (await getAccountByCode(input.host_id, revCode));
  const commAccId = input.commission_account_id
    ?? (await getAccountByCode(input.host_id, commCode));
  const cleaningAccId = input.cleaning_revenue_account_id
    ?? (await getAccountByCode(input.host_id, '4100'));
  const extraAccId = input.extra_fees_account_id
    ?? (await getAccountByCode(input.host_id, '4110'));
  const taxAccId = input.tax_account_id
    ?? (await getAccountByCode(input.host_id, '2300'));
  const procAccId = input.processing_fees_account_id
    ?? (await getAccountByCode(input.host_id, '5100'));

  if (!debitAccId) throw new Error(received ? 'Pick a deposit account (where the money lands).' : 'Accounts receivable account (1200) missing in your CoA.');
  if (!revAccId) throw new Error('Pick a revenue account.');

  const fxMemo = fx.eq(1) ? '' : ` (${txnCcy} @ ${fx.toFixed(4)})`;
  const statusMemo = received ? '' : ' [unreceived → A/R]';
  const lines: any[] = [];
  lines.push({ account_id: debitAccId, debit: netPayout.toNumber(), memo: `${received ? 'Net payout' : 'Receivable'}${fxMemo}${statusMemo}` });
  if (commission.gt(0)) lines.push({ account_id: commAccId!, debit: commission.toNumber(), memo: `Platform commission${fxMemo}` });
  if (processing.gt(0)) lines.push({ account_id: procAccId!, debit: processing.toNumber(), memo: `Processing fees${fxMemo}` });

  if (grossRev.gt(0)) lines.push({ account_id: revAccId, credit: grossRev.toNumber(), memo: `Gross rental revenue${fxMemo}` });
  if (cleaning.gt(0)) lines.push({ account_id: cleaningAccId!, credit: cleaning.toNumber(), memo: `Cleaning fee${fxMemo}` });
  if (extra.gt(0)) lines.push({ account_id: extraAccId!, credit: extra.toNumber(), memo: `Extra guest fees${fxMemo}` });
  if (taxes.gt(0)) lines.push({ account_id: taxAccId!, credit: taxes.toNumber(), memo: `Tax collected${fxMemo}` });

  const entryId = await postJournalEntry({
    host_id: input.host_id,
    entry_date: input.check_out_date,
    description: `Booking — ${input.platform_name}${input.guest_name ? ` (${input.guest_name})` : ''}${fxMemo}`,
    reference: `EXT-${booking.id.slice(0, 8).toUpperCase()}`,
    source_type: 'booking',
    source_id: booking.id,
    lines,
  });

  await supabase.from('acct_external_bookings').update({ journal_entry_id: entryId }).eq('id', booking.id);
  return booking.id;
}

export interface ExpenseAllocation { property_id: string; ratio: number }
interface ExpenseInput {
  host_id: string;
  property_id?: string | null;
  category_id?: string | null;
  expense_date: string;
  vendor?: string;
  description: string;
  amount: number;
  payment_method?: string;
  receipt_url?: string;
  is_capitalized?: boolean;
  is_recurring?: boolean;
  expense_account_id: string;     // debit (expense or asset if capitalized)
  cash_account_id: string;        // credit (where money came from) — used when paid=true
  /** Cash-basis flag: true = paid → credit cash/bank; false = credit Accounts payable. */
  paid?: boolean;
  txn_currency?: string;
  fx_rate?: number;
  /** Shared across multiple properties — if true, allocations[] drives per-property reporting. */
  is_shared?: boolean;
  allocations?: ExpenseAllocation[];
}

export async function createExpenseWithJournal(input: ExpenseInput): Promise<string> {
  const txnAmount = D(input.amount);
  if (txnAmount.lte(0)) throw new Error('Amount must be > 0');
  const fx = D(input.fx_rate ?? 1);
  if (fx.lte(0)) throw new Error('FX rate must be > 0');
  const txnCcy = (input.txn_currency || 'USD').toUpperCase();
  const baseAmount = txnAmount.times(fx);

  const { data: exp, error } = await supabase
    .from('acct_expenses')
    .insert({
      host_id: input.host_id,
      property_id: input.property_id ?? null,
      category_id: input.category_id ?? null,
      expense_date: input.expense_date,
      vendor: input.vendor ?? null,
      description: input.description,
      amount: txnAmount.toNumber(),
      payment_method: input.payment_method ?? null,
      receipt_url: input.receipt_url ?? null,
      is_capitalized: input.is_capitalized ?? false,
      is_recurring: input.is_recurring ?? false,
      txn_currency: txnCcy,
      fx_rate: fx.toNumber(),
      base_amount: baseAmount.toNumber(),
      is_shared: input.is_shared ?? false,
      allocations: (input.is_shared ? (input.allocations ?? []) : []) as any,
    } as any)
    .select('id')
    .single();
  if (error || !exp) throw error ?? new Error('Expense insert failed');

  const fxMemo = fx.eq(1) ? '' : ` (${txnCcy} @ ${fx.toFixed(4)})`;
  const paid = input.paid !== false; // default true for backward compat
  const creditAccId = paid
    ? input.cash_account_id
    : (await getAccountByCode(input.host_id, '2010'));
  if (!creditAccId) throw new Error(paid ? 'Pick the account you paid from.' : 'Accounts payable account (2010) missing in your CoA.');
  const statusMemo = paid ? '' : ' [unpaid → A/P]';

  const entryId = await postJournalEntry({
    host_id: input.host_id,
    entry_date: input.expense_date,
    description: `${input.is_capitalized ? 'Capitalized: ' : ''}${input.description}${fxMemo}${statusMemo}`,
    reference: `EXP-${exp.id.slice(0, 8).toUpperCase()}`,
    source_type: 'expense',
    source_id: exp.id,
    lines: [
      { account_id: input.expense_account_id, debit: baseAmount.toNumber(), memo: input.vendor ?? '' },
      { account_id: creditAccId, credit: baseAmount.toNumber(), memo: paid ? (input.payment_method ?? '') : 'Unpaid — A/P' },
    ],
  });

  await supabase.from('acct_expenses').update({
    journal_entry_id: entryId,
    payment_status: paid ? 'paid' : 'unpaid',
    paid_date: paid ? input.expense_date : null,
  } as any).eq('id', exp.id);
  return exp.id;
}
