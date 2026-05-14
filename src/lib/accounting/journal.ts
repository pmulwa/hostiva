import { supabase } from '@/integrations/supabase/client';
import { D, toDbAmount } from './money';
import type { Database } from '@/integrations/supabase/types';

type SourceType = Database['public']['Enums']['acct_journal_source'];

export interface JournalLineInput {
  account_id: string;
  debit?: number | string;
  credit?: number | string;
  memo?: string;
}

export interface PostJournalInput {
  host_id: string;
  entry_date: string; // YYYY-MM-DD
  description: string;
  reference?: string;
  source_type?: SourceType;
  source_id?: string;
  lines: JournalLineInput[];
}

/**
 * Posts a balanced journal entry. Throws if debits != credits.
 * Returns the new entry id.
 */
export async function postJournalEntry(input: PostJournalInput): Promise<string> {
  // Validate accounts present
  for (const l of input.lines) {
    if (!l.account_id) {
      throw new Error('A journal line is missing its account. Open Accounting → Settings and re-seed your Chart of Accounts.');
    }
  }
  // Validate balance client-side first
  let totalDebit = D(0);
  let totalCredit = D(0);
  for (const line of input.lines) {
    totalDebit = totalDebit.plus(D(line.debit ?? 0));
    totalCredit = totalCredit.plus(D(line.credit ?? 0));
  }
  if (!totalDebit.eq(totalCredit)) {
    throw new Error(
      `Unbalanced entry: debits=${totalDebit.toFixed(2)} credits=${totalCredit.toFixed(2)}`
    );
  }
  if (totalDebit.eq(0)) {
    throw new Error('Journal entry has zero amounts');
  }

  // Insert entry
  const { data: entry, error: entryErr } = await supabase
    .from('acct_journal_entries')
    .insert({
      host_id: input.host_id,
      entry_date: input.entry_date,
      description: input.description,
      reference: input.reference ?? null,
      source_type: input.source_type ?? 'manual',
      source_id: input.source_id ?? null,
    })
    .select('id')
    .single();

  if (entryErr || !entry) throw entryErr ?? new Error('Failed to create entry');

  // Insert lines — drop zero/zero lines, enforce non-negative, never both > 0
  const lineRows = input.lines
    .map((l) => {
      let debit = D(l.debit ?? 0);
      let credit = D(l.credit ?? 0);
      if (debit.lt(0)) { credit = credit.plus(debit.abs()); debit = D(0); }
      if (credit.lt(0)) { debit = debit.plus(credit.abs()); credit = D(0); }
      if (debit.gt(0) && credit.gt(0)) {
        const net = debit.minus(credit);
        if (net.gte(0)) { debit = net; credit = D(0); }
        else { credit = net.abs(); debit = D(0); }
      }
      return {
        entry_id: entry.id,
        account_id: l.account_id,
        debit: toDbAmount(debit),
        credit: toDbAmount(credit),
        memo: l.memo ?? null,
      };
    })
    .filter((r) => r.debit > 0 || r.credit > 0);

  if (lineRows.length === 0) {
    await supabase.from('acct_journal_entries').delete().eq('id', entry.id);
    throw new Error('No non-zero lines to post');
  }

  const { error: linesErr } = await supabase.from('acct_journal_lines').insert(lineRows);
  if (linesErr) {
    await supabase.from('acct_journal_entries').delete().eq('id', entry.id);
    throw linesErr;
  }

  return entry.id;
}

export async function deleteJournalEntry(entryId: string): Promise<void> {
  const { error } = await supabase.from('acct_journal_entries').delete().eq('id', entryId);
  if (error) throw error;
}
