ALTER TABLE public.acct_opening_balances
  ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;