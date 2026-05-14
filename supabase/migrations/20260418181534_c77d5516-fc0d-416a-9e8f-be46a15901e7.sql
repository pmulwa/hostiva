CREATE OR REPLACE FUNCTION public.acct_resync_booking_entry_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_basis text;
  v_new_date date;
BEGIN
  -- Only react if any relevant date moved
  IF NEW.check_in_date = OLD.check_in_date
     AND NEW.check_out_date = OLD.check_out_date
     AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(entry_date_basis, 'check_in') INTO v_basis
  FROM public.acct_settings WHERE host_id = NEW.host_id;
  IF v_basis IS NULL THEN RETURN NEW; END IF;

  v_new_date := CASE v_basis
    WHEN 'check_out' THEN NEW.check_out_date
    WHEN 'booking_created' THEN NEW.created_at::date
    ELSE NEW.check_in_date
  END;

  -- Update any matching Hostly journal entry (matched via source_id = booking id)
  UPDATE public.acct_journal_entries
  SET entry_date = v_new_date,
      updated_at = now()
  WHERE host_id = NEW.host_id
    AND source_type = 'booking'
    AND source_id IS NOT NULL
    AND source_id::uuid = NEW.id
    AND entry_date <> v_new_date;

  -- Mirror onto the external booking record (payout received date)
  UPDATE public.acct_external_bookings
  SET payment_received_date = v_new_date,
      check_in_date = NEW.check_in_date,
      check_out_date = NEW.check_out_date,
      updated_at = now()
  WHERE host_id = NEW.host_id
    AND notes LIKE 'AUTO:HOSTLY:' || NEW.id::text || '%';

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_acct_resync_booking_entry_date ON public.bookings;
CREATE TRIGGER trg_acct_resync_booking_entry_date
AFTER UPDATE ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.acct_resync_booking_entry_date();