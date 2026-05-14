-- 1) Add admin manage policy for chart of accounts (admins can add/edit/delete on any host)
DROP POLICY IF EXISTS "Admins manage all CoA" ON public.acct_chart_of_accounts;
CREATE POLICY "Admins manage all CoA"
  ON public.acct_chart_of_accounts
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 2) Back-fill new "commonly forgotten" expense accounts for every existing host.
INSERT INTO public.acct_chart_of_accounts (host_id, code, name, type, is_system)
SELECT DISTINCT s.host_id, x.code, x.name, x.type::acct_account_type, true
FROM public.acct_settings s
CROSS JOIN (VALUES
  -- Operating / property
  ('6050','Trash & sewer','expense'),
  ('6060','HOA / strata fees','expense'),
  ('6070','Pest control','expense'),
  ('6080','Landscaping & gardening','expense'),
  ('6090','Security & monitoring','expense'),
  ('6105','Pool & hot-tub maintenance','expense'),
  ('6115','Snow removal','expense'),
  ('6120','Rent expense','expense'),
  ('6125','Common area / building fees','expense'),
  ('6240','Furnishings & decor replacement','expense'),
  ('6250','Smart-lock, sensors & tech replacements','expense'),
  ('6260','Streaming, Wi-Fi & guest subscriptions','expense'),
  -- Staff / payroll
  ('6600','Staff salaries & wages','expense'),
  ('6610','Payroll taxes','expense'),
  ('6620','Employee benefits','expense'),
  ('6630','Contractor payments','expense'),
  -- Loss / write-off
  ('6700','Bad debt expense','expense'),
  ('6710','Refunds & chargebacks','expense'),
  ('6720','Penalties & fines','expense'),
  ('6730','Donations & gifts','expense'),
  ('6740','Guest damage write-off','expense')
) AS x(code, name, type)
ON CONFLICT (host_id, code) DO NOTHING;

-- 3) Update the seed function so new hosts get these accounts too.
CREATE OR REPLACE FUNCTION public.acct_seed_defaults(_host_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.acct_settings WHERE host_id = _host_id AND seeded = true) THEN
    -- still ensure new accounts exist for already-seeded hosts
    INSERT INTO public.acct_chart_of_accounts (host_id, code, name, type, is_system) VALUES
      (_host_id,'6050','Trash & sewer','expense',true),
      (_host_id,'6060','HOA / strata fees','expense',true),
      (_host_id,'6070','Pest control','expense',true),
      (_host_id,'6080','Landscaping & gardening','expense',true),
      (_host_id,'6090','Security & monitoring','expense',true),
      (_host_id,'6105','Pool & hot-tub maintenance','expense',true),
      (_host_id,'6115','Snow removal','expense',true),
      (_host_id,'6120','Rent expense','expense',true),
      (_host_id,'6125','Common area / building fees','expense',true),
      (_host_id,'6240','Furnishings & decor replacement','expense',true),
      (_host_id,'6250','Smart-lock, sensors & tech replacements','expense',true),
      (_host_id,'6260','Streaming, Wi-Fi & guest subscriptions','expense',true),
      (_host_id,'6600','Staff salaries & wages','expense',true),
      (_host_id,'6610','Payroll taxes','expense',true),
      (_host_id,'6620','Employee benefits','expense',true),
      (_host_id,'6630','Contractor payments','expense',true),
      (_host_id,'6700','Bad debt expense','expense',true),
      (_host_id,'6710','Refunds & chargebacks','expense',true),
      (_host_id,'6720','Penalties & fines','expense',true),
      (_host_id,'6730','Donations & gifts','expense',true),
      (_host_id,'6740','Guest damage write-off','expense',true)
    ON CONFLICT (host_id, code) DO NOTHING;
    RETURN;
  END IF;

  INSERT INTO public.acct_settings (host_id) VALUES (_host_id)
    ON CONFLICT (host_id) DO NOTHING;

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
    (_host_id,'6050','Trash & sewer','expense',true),
    (_host_id,'6060','HOA / strata fees','expense',true),
    (_host_id,'6070','Pest control','expense',true),
    (_host_id,'6080','Landscaping & gardening','expense',true),
    (_host_id,'6090','Security & monitoring','expense',true),
    (_host_id,'6100','Repairs & maintenance','expense',true),
    (_host_id,'6105','Pool & hot-tub maintenance','expense',true),
    (_host_id,'6110','Property management fees','expense',true),
    (_host_id,'6115','Snow removal','expense',true),
    (_host_id,'6120','Rent expense','expense',true),
    (_host_id,'6125','Common area / building fees','expense',true),
    (_host_id,'6200','Insurance','expense',true),
    (_host_id,'6210','Property taxes','expense',true),
    (_host_id,'6220','Licenses & permits','expense',true),
    (_host_id,'6230','Tourism levy expense','expense',true),
    (_host_id,'6240','Furnishings & decor replacement','expense',true),
    (_host_id,'6250','Smart-lock, sensors & tech replacements','expense',true),
    (_host_id,'6260','Streaming, Wi-Fi & guest subscriptions','expense',true),
    (_host_id,'6300','Marketing & advertising','expense',true),
    (_host_id,'6310','Photography','expense',true),
    (_host_id,'6320','Software subscriptions','expense',true),
    (_host_id,'6400','Bank charges','expense',true),
    (_host_id,'6410','Office & admin','expense',true),
    (_host_id,'6420','Professional fees','expense',true),
    (_host_id,'6430','Travel','expense',true),
    (_host_id,'6500','Depreciation expense','expense',true),
    -- Staff / payroll
    (_host_id,'6600','Staff salaries & wages','expense',true),
    (_host_id,'6610','Payroll taxes','expense',true),
    (_host_id,'6620','Employee benefits','expense',true),
    (_host_id,'6630','Contractor payments','expense',true),
    -- Loss / write-off
    (_host_id,'6700','Bad debt expense','expense',true),
    (_host_id,'6710','Refunds & chargebacks','expense',true),
    (_host_id,'6720','Penalties & fines','expense',true),
    (_host_id,'6730','Donations & gifts','expense',true),
    (_host_id,'6740','Guest damage write-off','expense',true),
    -- Financing
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
    ('Trash & sewer','6050',false),
    ('HOA / strata fees','6060',false),
    ('Pest control','6070',false),
    ('Landscaping','6080',false),
    ('Security','6090',false),
    ('Repairs','6100',false),
    ('Pool & hot tub','6105',false),
    ('Property management','6110',false),
    ('Rent','6120',false),
    ('Insurance','6200',false),
    ('Property tax','6210',false),
    ('Furnishings replacement','6240',false),
    ('Tech & smart locks','6250',false),
    ('Marketing','6300',false),
    ('Software','6320',false),
    ('Office & admin','6410',false),
    ('Professional fees','6420',false),
    ('Salaries & wages','6600',false),
    ('Payroll taxes','6610',false),
    ('Contractor payments','6630',false),
    ('Refunds & chargebacks','6710',false),
    ('Donations','6730',false)
  ) AS x(name, code, is_cogs)
  ON CONFLICT (host_id, name) DO NOTHING;

  UPDATE public.acct_settings SET seeded = true WHERE host_id = _host_id;
END;
$$;