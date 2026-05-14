-- Block duplicate DRAFT bank charges for the same
-- host + booking + date + amount + type + reference combination.
-- Posted / voided rows are excluded so legitimate repeats (e.g. monthly
-- recurring fees) can still be recorded after the first one is posted.
CREATE UNIQUE INDEX IF NOT EXISTS uq_acct_bank_charges_draft_dedupe
  ON public.acct_bank_charges (
    host_id,
    COALESCE(booking_id, '00000000-0000-0000-0000-000000000000'::uuid),
    charge_date,
    amount,
    charge_type,
    COALESCE(reference, '')
  )
  WHERE status = 'draft';