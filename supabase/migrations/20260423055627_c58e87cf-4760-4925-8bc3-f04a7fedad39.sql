-- Lock platform_expenses inside approved P&L periods
CREATE OR REPLACE FUNCTION public.enforce_platform_expense_period_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_check_date date;
  v_locked boolean;
BEGIN
  -- For UPDATE/DELETE, lock if the original date falls inside an approved period.
  -- For UPDATE, also lock if the new date would fall inside an approved period.
  -- For INSERT, lock if the new date falls inside an approved period.
  IF TG_OP = 'DELETE' THEN
    v_check_date := OLD.expense_date;
    SELECT EXISTS (
      SELECT 1 FROM public.finance_statement_approvals a
      WHERE v_check_date BETWEEN a.period_from AND a.period_to
    ) INTO v_locked;
    IF v_locked THEN
      RAISE EXCEPTION 'This expense is locked: it falls inside an approved P&L period (%) and cannot be deleted', v_check_date
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.finance_statement_approvals a
      WHERE OLD.expense_date BETWEEN a.period_from AND a.period_to
    ) INTO v_locked;
    IF v_locked THEN
      RAISE EXCEPTION 'This expense is locked: it falls inside an approved P&L period (%) and cannot be edited', OLD.expense_date
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- INSERT or UPDATE: also block writing into an approved period
  SELECT EXISTS (
    SELECT 1 FROM public.finance_statement_approvals a
    WHERE NEW.expense_date BETWEEN a.period_from AND a.period_to
  ) INTO v_locked;
  IF v_locked THEN
    RAISE EXCEPTION 'Cannot record an expense dated % — that period is already approved and locked', NEW.expense_date
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_platform_expenses_period_lock ON public.platform_expenses;
CREATE TRIGGER trg_platform_expenses_period_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.platform_expenses
  FOR EACH ROW EXECUTE FUNCTION public.enforce_platform_expense_period_lock();