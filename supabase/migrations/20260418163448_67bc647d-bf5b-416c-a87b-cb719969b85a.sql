ALTER TABLE public.acct_expenses
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'paid',
  ADD COLUMN IF NOT EXISTS clearing_entry_id uuid REFERENCES public.acct_journal_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS paid_date date;

ALTER TABLE public.acct_external_bookings
  ADD COLUMN IF NOT EXISTS payment_reference text;

ALTER TABLE public.acct_expenses
  ADD COLUMN IF NOT EXISTS payment_reference text;