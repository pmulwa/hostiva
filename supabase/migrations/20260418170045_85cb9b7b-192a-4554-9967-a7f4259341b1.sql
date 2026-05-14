
ALTER TABLE public.acct_expenses
  ADD COLUMN IF NOT EXISTS is_shared boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allocations jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.acct_expenses.allocations IS
  'Array of {property_id: uuid, ratio: number} entries. Ratios should sum to 1.0 when is_shared = true. Ignored when is_shared = false.';
