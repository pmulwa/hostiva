-- Hostly's own operating expenses (hosting, salaries, marketing, etc.)
-- Distinct from acct_expenses which are per-host property expenses.
CREATE TABLE IF NOT EXISTS public.platform_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  description text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'USD',
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  vendor text,
  receipt_url text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_expenses_date ON public.platform_expenses(expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_platform_expenses_category ON public.platform_expenses(category);

ALTER TABLE public.platform_expenses ENABLE ROW LEVEL SECURITY;

-- Only admins/finance officers can manage Hostly's own books
CREATE POLICY "Staff view all platform expenses"
  ON public.platform_expenses FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'finance_officer'::app_role)
  );

CREATE POLICY "Admins insert platform expenses"
  ON public.platform_expenses FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'finance_officer'::app_role)
  );

CREATE POLICY "Admins update platform expenses"
  ON public.platform_expenses FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'finance_officer'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'finance_officer'::app_role)
  );

CREATE POLICY "Admins delete platform expenses"
  ON public.platform_expenses FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_platform_expenses_updated
  BEFORE UPDATE ON public.platform_expenses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();