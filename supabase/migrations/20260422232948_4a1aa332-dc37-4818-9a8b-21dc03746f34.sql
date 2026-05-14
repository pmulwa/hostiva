
CREATE TABLE IF NOT EXISTS public.finance_statement_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approver_id uuid NOT NULL,
  period_from date NOT NULL,
  period_to date NOT NULL,
  view_type text NOT NULL DEFAULT 'consolidated',
  display_currency text NOT NULL DEFAULT 'USD',
  totals_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.finance_statement_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and finance can record approvals"
  ON public.finance_statement_approvals
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'finance_officer'::app_role))
    AND auth.uid() = approver_id
  );

CREATE POLICY "Admins and finance view approvals"
  ON public.finance_statement_approvals
  FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'finance_officer'::app_role)
  );

CREATE INDEX IF NOT EXISTS idx_finance_approvals_period
  ON public.finance_statement_approvals (period_from, period_to);
