-- Index to make overlap lookup fast and to support concurrent inserts
CREATE INDEX IF NOT EXISTS idx_bookings_property_dates_confirmed
  ON public.bookings (property_id, check_in_date, check_out_date)
  WHERE status = 'confirmed';

-- Trigger function: reject any booking whose nights overlap an existing
-- confirmed booking on the same property. Turnover days (one guest's
-- check-out == next guest's check-in) are explicitly allowed because each
-- booking blocks [check_in_date, check_out_date) — the check-out date stays
-- available as the next guest's check-in.
CREATE OR REPLACE FUNCTION public.prevent_booking_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conflict_id uuid;
BEGIN
  -- Only enforce when the candidate row is/will be confirmed. Pending or
  -- cancelled rows do not block availability.
  IF NEW.status <> 'confirmed' THEN
    RETURN NEW;
  END IF;

  -- Basic sanity: check-out must be strictly after check-in.
  IF NEW.check_out_date <= NEW.check_in_date THEN
    RAISE EXCEPTION 'Check-out date must be after check-in date'
      USING ERRCODE = '22023';
  END IF;

  -- Half-open interval overlap: [a_in, a_out) overlaps [b_in, b_out)
  -- iff a_in < b_out AND b_in < a_out.
  SELECT b.id INTO v_conflict_id
  FROM public.bookings b
  WHERE b.property_id = NEW.property_id
    AND b.status = 'confirmed'
    AND b.id <> NEW.id
    AND b.check_in_date < NEW.check_out_date
    AND NEW.check_in_date < b.check_out_date
  LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RAISE EXCEPTION 'Those dates overlap an existing confirmed booking (id=%) for this property', v_conflict_id
      USING ERRCODE = '23P01'; -- exclusion_violation
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_booking_overlap ON public.bookings;

CREATE TRIGGER trg_prevent_booking_overlap
  BEFORE INSERT OR UPDATE OF status, check_in_date, check_out_date, property_id
  ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_booking_overlap();