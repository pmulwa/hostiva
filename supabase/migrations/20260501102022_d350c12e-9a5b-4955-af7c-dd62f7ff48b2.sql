ALTER TABLE public.booking_check_in_details
  ADD COLUMN IF NOT EXISTS is_assisted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS assisted_notes text;