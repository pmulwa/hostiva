-- Add FX (foreign-exchange) columns to track multi-currency bookings & expenses
ALTER TABLE public.acct_external_bookings
  ADD COLUMN IF NOT EXISTS txn_currency text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS fx_rate numeric(18,8) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS base_amount numeric(14,2);

ALTER TABLE public.acct_expenses
  ADD COLUMN IF NOT EXISTS txn_currency text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS fx_rate numeric(18,8) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS base_amount numeric(14,2);

-- Seed FX gain/loss account for any host that doesn't have it (idempotent)
INSERT INTO public.acct_chart_of_accounts (host_id, code, name, type, is_system)
SELECT s.host_id, '4910', 'Foreign exchange gain/loss', 'revenue', true
FROM public.acct_settings s
WHERE NOT EXISTS (
  SELECT 1 FROM public.acct_chart_of_accounts c
  WHERE c.host_id = s.host_id AND c.code = '4910'
);

-- Update seed function so future hosts also get the FX account
CREATE OR REPLACE FUNCTION public.acct_seed_defaults(_host_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.acct_settings WHERE host_id = _host_id AND seeded = true) THEN
    RETURN;
  END IF;

  INSERT INTO public.acct_settings (host_id) VALUES (_host_id)
    ON CONFLICT (host_id) DO NOTHING;

  INSERT INTO public.acct_chart_of_accounts (host_id, code, name, type, is_system) VALUES
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
    (_host_id,'2010','Accounts payable','liability',true),
    (_host_id,'2020','Credit card payable','liability',true),
    (_host_id,'2100','Security deposits liability','liability',true),
    (_host_id,'2200','Unearned revenue','liability',true),
    (_host_id,'2300','VAT payable','liability',true),
    (_host_id,'2310','Tourism levy payable','liability',true),
    (_host_id,'2320','Income tax payable','liability',true),
    (_host_id,'2400','Short-term loans','liability',true),
    (_host_id,'2500','Mortgage payable','liability',true),
    (_host_id,'3010','Owner''s capital','equity',true),
    (_host_id,'3020','Owner''s drawings','equity',true),
    (_host_id,'3030','Retained earnings','equity',true),
    (_host_id,'3040','Opening balance equity','equity',true),
    (_host_id,'3050','Current year earnings','equity',true),
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
    (_host_id,'4910','Foreign exchange gain/loss','revenue',true),
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
    (_host_id,'7010','Mortgage interest','expense',true),
    (_host_id,'7020','Loan interest','expense',true),
    (_host_id,'7030','Foreign exchange gain/loss','expense',true)
  ON CONFLICT (host_id, code) DO NOTHING;

  INSERT INTO public.acct_platforms (host_id, name, commission_percent) VALUES
    (_host_id,'Hostly',10),
    (_host_id,'Airbnb',15),
    (_host_id,'Booking.com',15),
    (_host_id,'Vrbo',8),
    (_host_id,'Direct',0),
    (_host_id,'Walk-in',0)
  ON CONFLICT (host_id, name) DO NOTHING;

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
$function$;