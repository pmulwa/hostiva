-- =========================================================
-- PHASE 1: Accounting system foundation
-- Drops legacy accounting_entries; creates double-entry schema
-- =========================================================

-- 1. Drop legacy table
DROP TABLE IF EXISTS public.accounting_entries CASCADE;

-- 2. Enums
DO $$ BEGIN
  CREATE TYPE public.acct_account_type AS ENUM ('asset','liability','equity','revenue','expense');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.acct_method AS ENUM ('cash','accrual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.acct_journal_source AS ENUM ('booking','expense','manual','opening','depreciation','payout');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================================================
-- 3. Settings (one row per host)
-- =========================================================
CREATE TABLE public.acct_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL UNIQUE,
  accounting_method public.acct_method NOT NULL DEFAULT 'accrual',
  base_currency text NOT NULL DEFAULT 'USD',
  go_live_date date NOT NULL DEFAULT CURRENT_DATE,
  period_locked_through date,
  seeded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =========================================================
-- 4. Chart of Accounts
-- =========================================================
CREATE TABLE public.acct_chart_of_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  type public.acct_account_type NOT NULL,
  parent_id uuid REFERENCES public.acct_chart_of_accounts(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (host_id, code)
);
CREATE INDEX idx_coa_host ON public.acct_chart_of_accounts(host_id);
CREATE INDEX idx_coa_type ON public.acct_chart_of_accounts(host_id, type);

-- =========================================================
-- 5. Platforms
-- =========================================================
CREATE TABLE public.acct_platforms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL,
  name text NOT NULL,
  commission_percent numeric(5,2) NOT NULL DEFAULT 0,
  payout_lag_days integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (host_id, name)
);
CREATE INDEX idx_platforms_host ON public.acct_platforms(host_id);

-- =========================================================
-- 6. Expense categories
-- =========================================================
CREATE TABLE public.acct_expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL,
  name text NOT NULL,
  default_account_id uuid REFERENCES public.acct_chart_of_accounts(id) ON DELETE SET NULL,
  is_cogs boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (host_id, name)
);
CREATE INDEX idx_exp_cat_host ON public.acct_expense_categories(host_id);

-- =========================================================
-- 7. Fixed assets
-- =========================================================
CREATE TABLE public.acct_fixed_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL,
  property_id uuid,
  description text NOT NULL,
  asset_account_id uuid REFERENCES public.acct_chart_of_accounts(id),
  purchase_date date NOT NULL,
  cost numeric(14,2) NOT NULL,
  useful_life_years integer NOT NULL DEFAULT 5,
  accumulated_depreciation numeric(14,2) NOT NULL DEFAULT 0,
  disposal_date date,
  last_depreciation_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_assets_host ON public.acct_fixed_assets(host_id);

-- =========================================================
-- 8. Journal entries + lines (double-entry core)
-- =========================================================
CREATE TABLE public.acct_journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  reference text,
  description text NOT NULL,
  source_type public.acct_journal_source NOT NULL DEFAULT 'manual',
  source_id text,
  posted boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_je_host_date ON public.acct_journal_entries(host_id, entry_date DESC);
CREATE INDEX idx_je_source ON public.acct_journal_entries(source_type, source_id);

CREATE TABLE public.acct_journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.acct_journal_entries(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.acct_chart_of_accounts(id),
  debit numeric(14,2) NOT NULL DEFAULT 0,
  credit numeric(14,2) NOT NULL DEFAULT 0,
  memo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (debit >= 0 AND credit >= 0),
  CHECK (NOT (debit > 0 AND credit > 0))
);
CREATE INDEX idx_jl_entry ON public.acct_journal_lines(entry_id);
CREATE INDEX idx_jl_account ON public.acct_journal_lines(account_id);

-- Trigger: ensure each journal entry balances (debits = credits) on commit-time check via constraint trigger
CREATE OR REPLACE FUNCTION public.acct_check_entry_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_debit numeric(14,2);
  v_credit numeric(14,2);
  v_entry uuid;
BEGIN
  v_entry := COALESCE(NEW.entry_id, OLD.entry_id);
  SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0)
    INTO v_debit, v_credit
    FROM public.acct_journal_lines
    WHERE entry_id = v_entry;
  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'Journal entry % is unbalanced: debits=% credits=%', v_entry, v_debit, v_credit;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_acct_balance_check
AFTER INSERT OR UPDATE OR DELETE ON public.acct_journal_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.acct_check_entry_balance();

-- =========================================================
-- 9. Opening balances
-- =========================================================
CREATE TABLE public.acct_opening_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL,
  go_live_date date NOT NULL,
  account_id uuid NOT NULL REFERENCES public.acct_chart_of_accounts(id) ON DELETE CASCADE,
  debit numeric(14,2) NOT NULL DEFAULT 0,
  credit numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (host_id, account_id)
);

-- =========================================================
-- 10. External / walk-in / direct bookings
-- =========================================================
CREATE TABLE public.acct_external_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL,
  property_id uuid,
  platform_id uuid REFERENCES public.acct_platforms(id) ON DELETE SET NULL,
  guest_name text,
  check_in_date date NOT NULL,
  check_out_date date NOT NULL,
  num_nights integer NOT NULL DEFAULT 1,
  gross_revenue numeric(14,2) NOT NULL DEFAULT 0,
  cleaning_fee numeric(14,2) NOT NULL DEFAULT 0,
  extra_fees numeric(14,2) NOT NULL DEFAULT 0,
  commission_amount numeric(14,2) NOT NULL DEFAULT 0,
  processing_fees numeric(14,2) NOT NULL DEFAULT 0,
  taxes_collected numeric(14,2) NOT NULL DEFAULT 0,
  net_payout numeric(14,2) NOT NULL DEFAULT 0,
  payment_method text,
  payment_received_date date,
  status text NOT NULL DEFAULT 'completed',
  notes text,
  journal_entry_id uuid REFERENCES public.acct_journal_entries(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ext_book_host ON public.acct_external_bookings(host_id, check_in_date DESC);

-- =========================================================
-- 11. Expenses
-- =========================================================
CREATE TABLE public.acct_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL,
  property_id uuid,
  category_id uuid REFERENCES public.acct_expense_categories(id) ON DELETE SET NULL,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  vendor text,
  description text NOT NULL,
  amount numeric(14,2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  payment_method text,
  receipt_url text,
  is_capitalized boolean NOT NULL DEFAULT false,
  is_recurring boolean NOT NULL DEFAULT false,
  journal_entry_id uuid REFERENCES public.acct_journal_entries(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_expenses_host ON public.acct_expenses(host_id, expense_date DESC);

-- =========================================================
-- 12. updated_at triggers
-- =========================================================
CREATE TRIGGER trg_acct_settings_updated BEFORE UPDATE ON public.acct_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_acct_coa_updated BEFORE UPDATE ON public.acct_chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_acct_je_updated BEFORE UPDATE ON public.acct_journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_acct_assets_updated BEFORE UPDATE ON public.acct_fixed_assets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_acct_ext_book_updated BEFORE UPDATE ON public.acct_external_bookings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_acct_expenses_updated BEFORE UPDATE ON public.acct_expenses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- 13. Auto-seed default Chart of Accounts, platforms, categories
-- =========================================================
CREATE OR REPLACE FUNCTION public.acct_seed_defaults(_host_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Idempotent: only seed if not already done
  IF EXISTS (SELECT 1 FROM public.acct_settings WHERE host_id = _host_id AND seeded = true) THEN
    RETURN;
  END IF;

  -- Ensure settings row exists
  INSERT INTO public.acct_settings (host_id) VALUES (_host_id)
    ON CONFLICT (host_id) DO NOTHING;

  -- Chart of Accounts (standard STR)
  INSERT INTO public.acct_chart_of_accounts (host_id, code, name, type, is_system) VALUES
    -- Assets
    (_host_id,'1010','Cash on hand','asset',true),
    (_host_id,'1020','Bank — operating','asset',true),
    (_host_id,'1030','Bank — savings','asset',true),
    (_host_id,'1040','Mobile money','asset',true),
    (_host_id,'1100','Pending payouts — Hostly','asset',true),
    (_host_id,'1110','Pending payouts — Airbnb','asset',true),
    (_host_id,'1120','Pending payouts — Booking.com','asset',true),
    (_host_id,'1130','Pending payouts — Vrbo','asset',true),
    (_host_id,'1200','Accounts receivable — direct','asset',true),
    (_host_id,'1300','Prepaid insurance','asset',true),
    (_host_id,'1310','Prepaid subscriptions','asset',true),
    (_host_id,'1500','Land','asset',true),
    (_host_id,'1510','Building','asset',true),
    (_host_id,'1520','Furniture & fixtures','asset',true),
    (_host_id,'1530','Appliances','asset',true),
    (_host_id,'1540','Electronics','asset',true),
    (_host_id,'1590','Accumulated depreciation','asset',true),
    -- Liabilities
    (_host_id,'2010','Accounts payable','liability',true),
    (_host_id,'2020','Credit card payable','liability',true),
    (_host_id,'2100','Security deposits liability','liability',true),
    (_host_id,'2200','Unearned revenue','liability',true),
    (_host_id,'2300','VAT payable','liability',true),
    (_host_id,'2310','Tourism levy payable','liability',true),
    (_host_id,'2320','Income tax payable','liability',true),
    (_host_id,'2400','Short-term loans','liability',true),
    (_host_id,'2500','Mortgage payable','liability',true),
    -- Equity
    (_host_id,'3010','Owner''s capital','equity',true),
    (_host_id,'3020','Owner''s drawings','equity',true),
    (_host_id,'3030','Retained earnings','equity',true),
    (_host_id,'3040','Opening balance equity','equity',true),
    (_host_id,'3050','Current year earnings','equity',true),
    -- Revenue
    (_host_id,'4010','Rental revenue — Hostly','revenue',true),
    (_host_id,'4020','Rental revenue — Airbnb','revenue',true),
    (_host_id,'4030','Rental revenue — Booking.com','revenue',true),
    (_host_id,'4040','Rental revenue — Vrbo','revenue',true),
    (_host_id,'4050','Rental revenue — direct','revenue',true),
    (_host_id,'4060','Rental revenue — walk-in','revenue',true),
    (_host_id,'4070','Rental revenue — other platforms','revenue',true),
    (_host_id,'4100','Cleaning fees revenue','revenue',true),
    (_host_id,'4110','Extra guest fees','revenue',true),
    (_host_id,'4120','Pet fees','revenue',true),
    (_host_id,'4130','Cancellation fees','revenue',true),
    (_host_id,'4900','Other income','revenue',true),
    -- Cost of services
    (_host_id,'5010','Hostly service fees','expense',true),
    (_host_id,'5020','Airbnb service fees','expense',true),
    (_host_id,'5030','Booking.com commission','expense',true),
    (_host_id,'5040','Vrbo commission','expense',true),
    (_host_id,'5050','Other platform commissions','expense',true),
    (_host_id,'5100','Payment processing fees','expense',true),
    (_host_id,'5200','Cleaning — labor','expense',true),
    (_host_id,'5210','Cleaning — supplies','expense',true),
    (_host_id,'5220','Linen & laundry','expense',true),
    (_host_id,'5230','Guest amenities','expense',true),
    -- Operating expenses
    (_host_id,'6010','Utilities — electricity','expense',true),
    (_host_id,'6020','Utilities — water','expense',true),
    (_host_id,'6030','Utilities — internet','expense',true),
    (_host_id,'6040','Utilities — gas','expense',true),
    (_host_id,'6100','Repairs & maintenance','expense',true),
    (_host_id,'6110','Property management fees','expense',true),
    (_host_id,'6200','Insurance','expense',true),
    (_host_id,'6210','Property taxes','expense',true),
    (_host_id,'6220','Licenses & permits','expense',true),
    (_host_id,'6230','Tourism levy expense','expense',true),
    (_host_id,'6300','Marketing & advertising','expense',true),
    (_host_id,'6310','Photography','expense',true),
    (_host_id,'6320','Software subscriptions','expense',true),
    (_host_id,'6400','Bank charges','expense',true),
    (_host_id,'6410','Office & admin','expense',true),
    (_host_id,'6420','Professional fees','expense',true),
    (_host_id,'6430','Travel','expense',true),
    (_host_id,'6500','Depreciation expense','expense',true),
    -- Financing
    (_host_id,'7010','Mortgage interest','expense',true),
    (_host_id,'7020','Loan interest','expense',true),
    (_host_id,'7030','Foreign exchange gain/loss','expense',true)
  ON CONFLICT (host_id, code) DO NOTHING;

  -- Platforms
  INSERT INTO public.acct_platforms (host_id, name, commission_percent) VALUES
    (_host_id,'Hostly',10),
    (_host_id,'Airbnb',15),
    (_host_id,'Booking.com',15),
    (_host_id,'Vrbo',8),
    (_host_id,'Direct',0),
    (_host_id,'Walk-in',0)
  ON CONFLICT (host_id, name) DO NOTHING;

  -- Expense categories (linked to default accounts)
  INSERT INTO public.acct_expense_categories (host_id, name, default_account_id, is_cogs)
  SELECT _host_id, x.name,
    (SELECT id FROM public.acct_chart_of_accounts WHERE host_id = _host_id AND code = x.code),
    x.is_cogs
  FROM (VALUES
    ('Cleaning labor','5200',true),
    ('Cleaning supplies','5210',true),
    ('Linen & laundry','5220',true),
    ('Guest amenities','5230',true),
    ('Electricity','6010',false),
    ('Water','6020',false),
    ('Internet','6030',false),
    ('Gas','6040',false),
    ('Repairs','6100',false),
    ('Insurance','6200',false),
    ('Property tax','6210',false),
    ('Marketing','6300',false),
    ('Software','6320',false),
    ('Office & admin','6410',false),
    ('Professional fees','6420',false)
  ) AS x(name, code, is_cogs)
  ON CONFLICT (host_id, name) DO NOTHING;

  UPDATE public.acct_settings SET seeded = true WHERE host_id = _host_id;
END;
$$;

-- =========================================================
-- 14. RLS
-- =========================================================
ALTER TABLE public.acct_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acct_chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acct_platforms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acct_expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acct_fixed_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acct_journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acct_journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acct_opening_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acct_external_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acct_expenses ENABLE ROW LEVEL SECURITY;

-- Helper: line belongs to host? Use entry's host_id via subquery (no recursion)
-- For lines, we check via entry_id => host_id

-- Settings
CREATE POLICY "Hosts manage own settings" ON public.acct_settings FOR ALL
  USING (auth.uid() = host_id) WITH CHECK (auth.uid() = host_id);
CREATE POLICY "Admins view all settings" ON public.acct_settings FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- CoA
CREATE POLICY "Hosts manage own CoA" ON public.acct_chart_of_accounts FOR ALL
  USING (auth.uid() = host_id) WITH CHECK (auth.uid() = host_id);
CREATE POLICY "Admins view all CoA" ON public.acct_chart_of_accounts FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- Platforms
CREATE POLICY "Hosts manage own platforms" ON public.acct_platforms FOR ALL
  USING (auth.uid() = host_id) WITH CHECK (auth.uid() = host_id);
CREATE POLICY "Admins view all platforms" ON public.acct_platforms FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- Expense categories
CREATE POLICY "Hosts manage own categories" ON public.acct_expense_categories FOR ALL
  USING (auth.uid() = host_id) WITH CHECK (auth.uid() = host_id);
CREATE POLICY "Admins view all categories" ON public.acct_expense_categories FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- Fixed assets
CREATE POLICY "Hosts manage own assets" ON public.acct_fixed_assets FOR ALL
  USING (auth.uid() = host_id) WITH CHECK (auth.uid() = host_id);
CREATE POLICY "Admins view all assets" ON public.acct_fixed_assets FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- Journal entries
CREATE POLICY "Hosts manage own journal" ON public.acct_journal_entries FOR ALL
  USING (auth.uid() = host_id) WITH CHECK (auth.uid() = host_id);
CREATE POLICY "Admins view all journal" ON public.acct_journal_entries FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- Journal lines (via entry_id ownership)
CREATE POLICY "Hosts manage own journal lines" ON public.acct_journal_lines FOR ALL
  USING (EXISTS (SELECT 1 FROM public.acct_journal_entries e WHERE e.id = entry_id AND e.host_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.acct_journal_entries e WHERE e.id = entry_id AND e.host_id = auth.uid()));
CREATE POLICY "Admins view all journal lines" ON public.acct_journal_lines FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- Opening balances
CREATE POLICY "Hosts manage own opening balances" ON public.acct_opening_balances FOR ALL
  USING (auth.uid() = host_id) WITH CHECK (auth.uid() = host_id);
CREATE POLICY "Admins view all opening balances" ON public.acct_opening_balances FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- External bookings
CREATE POLICY "Hosts manage own external bookings" ON public.acct_external_bookings FOR ALL
  USING (auth.uid() = host_id) WITH CHECK (auth.uid() = host_id);
CREATE POLICY "Admins view all external bookings" ON public.acct_external_bookings FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- Expenses
CREATE POLICY "Hosts manage own expenses" ON public.acct_expenses FOR ALL
  USING (auth.uid() = host_id) WITH CHECK (auth.uid() = host_id);
CREATE POLICY "Admins view all expenses" ON public.acct_expenses FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- =========================================================
-- 15. Receipts storage bucket
-- =========================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('accounting-receipts','accounting-receipts',false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Hosts upload own receipts" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'accounting-receipts' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Hosts view own receipts" ON storage.objects FOR SELECT
  USING (bucket_id = 'accounting-receipts' AND (auth.uid()::text = (storage.foldername(name))[1] OR public.has_role(auth.uid(),'admin')));
CREATE POLICY "Hosts delete own receipts" ON storage.objects FOR DELETE
  USING (bucket_id = 'accounting-receipts' AND auth.uid()::text = (storage.foldername(name))[1]);
