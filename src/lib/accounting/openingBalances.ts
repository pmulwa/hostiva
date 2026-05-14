import { supabase } from '@/integrations/supabase/client';
import { D, toDbAmount } from './money';
import { postJournalEntry } from './journal';
import { getAccountByCode } from './init';

export interface OpeningBalanceLine {
  account_id: string;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  debit: number;
  credit: number;
  locked?: boolean;
}

/**
 * Posts an opening-balance journal entry as of the host's go-live date.
 *
 * Per-account locking: rows already marked `locked = true` in
 * acct_opening_balances are preserved as-is. Only unlocked rows are
 * updated by re-running the wizard.
 *
 * Any imbalance is plugged to "3040 — Opening balance equity".
 */
export async function postOpeningBalances(
  hostId: string,
  goLiveDate: string,
  lines: OpeningBalanceLine[],
): Promise<{ entryId: string; plug: number }> {
  // Load existing rows so we can honor per-account locks
  const { data: existing } = await supabase
    .from('acct_opening_balances')
    .select('account_id, debit, credit, locked')
    .eq('host_id', hostId);

  // Merge: locked rows always win; unlocked rows take incoming values
  const merged = new Map<string, { debit: number; credit: number; locked: boolean }>();
  for (const r of existing ?? []) {
    if ((r as any).locked) {
      merged.set(r.account_id, { debit: Number(r.debit), credit: Number(r.credit), locked: true });
    }
  }
  for (const l of lines) {
    if (merged.get(l.account_id)?.locked) continue; // skip locked accounts
    if (Number(l.debit) > 0 || Number(l.credit) > 0) {
      merged.set(l.account_id, { debit: Number(l.debit), credit: Number(l.credit), locked: !!l.locked });
    }
  }

  // Wipe prior opening-balance journal entries (we re-post the whole thing)
  const { data: prior } = await supabase
    .from('acct_journal_entries')
    .select('id')
    .eq('host_id', hostId)
    .eq('source_type', 'opening');
  if (prior && prior.length > 0) {
    await supabase
      .from('acct_journal_entries')
      .delete()
      .in('id', prior.map((p) => p.id));
  }

  const entryLines = Array.from(merged.entries()).map(([account_id, v]) => ({
    account_id,
    debit: toDbAmount(v.debit ?? 0),
    credit: toDbAmount(v.credit ?? 0),
    memo: 'Opening balance',
  }));

  if (entryLines.length === 0) {
    await supabase.from('acct_opening_balances').delete().eq('host_id', hostId);
    return { entryId: '', plug: 0 };
  }

  // Imbalance plug to 3040
  const totalDebit = entryLines.reduce((s, l) => s.plus(D(l.debit)), D(0));
  const totalCredit = entryLines.reduce((s, l) => s.plus(D(l.credit)), D(0));
  const diff = totalDebit.minus(totalCredit);
  const plug = diff.abs().toNumber();

  if (!diff.eq(0)) {
    const equityAccId = await getAccountByCode(hostId, '3040');
    if (!equityAccId) throw new Error('Missing account 3040 — Opening balance equity. Re-seed Chart of Accounts.');
    if (diff.gt(0)) {
      entryLines.push({ account_id: equityAccId, debit: 0, credit: toDbAmount(diff), memo: 'Opening balance equity (plug)' });
    } else {
      entryLines.push({ account_id: equityAccId, debit: toDbAmount(diff.abs()), credit: 0, memo: 'Opening balance equity (plug)' });
    }
  }

  const entryId = await postJournalEntry({
    host_id: hostId,
    entry_date: goLiveDate,
    description: 'Opening balances',
    reference: 'OPEN',
    source_type: 'opening',
    lines: entryLines,
  });

  // Mirror to acct_opening_balances (preserve locked flags)
  await supabase.from('acct_opening_balances').delete().eq('host_id', hostId);
  const obRows = Array.from(merged.entries()).map(([account_id, v]) => ({
    host_id: hostId,
    account_id,
    debit: toDbAmount(v.debit ?? 0),
    credit: toDbAmount(v.credit ?? 0),
    go_live_date: goLiveDate,
    locked: v.locked,
  }));
  if (obRows.length) await supabase.from('acct_opening_balances').insert(obRows as any);

  return { entryId, plug };
}

/** Toggle a single account's lock without re-posting the whole entry. */
export async function setOpeningBalanceLock(hostId: string, accountId: string, locked: boolean) {
  const { error } = await supabase
    .from('acct_opening_balances')
    .update({ locked } as any)
    .eq('host_id', hostId)
    .eq('account_id', accountId);
  if (error) throw error;
}

export async function loadExistingOpeningBalances(hostId: string) {
  const { data } = await supabase
    .from('acct_opening_balances')
    .select('account_id, debit, credit, locked')
    .eq('host_id', hostId);
  return data ?? [];
}
