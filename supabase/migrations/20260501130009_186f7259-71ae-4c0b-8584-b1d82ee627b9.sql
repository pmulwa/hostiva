-- =====================================================================
-- Align bank-charge posting with the SEEDED chart of accounts so every
-- system account is reachable & posts to its correct code.
-- =====================================================================

-- 1) Expand allowed charge_type whitelist.
ALTER TABLE public.acct_bank_charges
  DROP CONSTRAINT IF EXISTS acct_bank_charges_charge_type_check;
ALTER TABLE public.acct_bank_charges
  ADD CONSTRAINT acct_bank_charges_charge_type_check
  CHECK (charge_type IN (
    -- Banking & payments
    'bank_fee','wire_fee','fx_adjustment','fx_gain','chargeback','reversal',
    'payment_processing_fee','currency_conversion',
    -- Platform commissions (per-channel)
    'hostly_commission','airbnb_commission','booking_com_commission','vrbo_commission',
    'direct_commission','other_platform_commission',
    -- Operations
    'cleaning_labor','cleaning_supplies','linen_laundry','guest_amenities',
    -- Maintenance
    'repairs_maintenance','property_management_fee',
    -- Utilities
    'electricity','water','internet','gas',
    -- Insurance, tax & legal
    'insurance','property_tax','occupancy_tax','tourism_levy','income_tax_payment',
    'license_permit','legal_fees','accounting_fees','professional_fees',
    -- Software / tools / office
    'software_subscriptions','office_admin','travel',
    -- Marketing
    'photography','marketing_advertising',
    -- Property finance
    'mortgage_interest','loan_interest','mortgage_principal','loan_principal','hoa_fees','rent_paid',
    -- Depreciation / fixed assets
    'depreciation','asset_purchase_land','asset_purchase_building',
    'asset_purchase_furniture','asset_purchase_appliances','asset_purchase_electronics',
    -- Prepaid
    'prepaid_insurance','prepaid_subscription',
    -- Liabilities
    'pay_accounts_payable','pay_credit_card','pay_vat','pay_tourism_levy_due',
    'pay_income_tax_due','short_term_loan_received','short_term_loan_repayment',
    -- Guest related
    'damage_repair','damage_recovery','security_deposit_hold','security_deposit_release',
    'guest_refund','goodwill_credit','guest_compensation',
    'extra_guest_fee_income','pet_fee_income','cancellation_fee_income',
    -- Owner / equity
    'owner_capital_contribution','owner_draw','opening_balance_equity',
    -- Misc
    'other_income','other_expense','other'
  ));

-- 2) Routing function: charge_type -> (code, name, type, direction)
--    direction is 'expense' (Dr target / Cr cash), 'income' (Dr cash / Cr target),
--    'asset_buy' (Dr asset / Cr cash), 'liability_pay' (Dr liability / Cr cash),
--    'liability_receive' (Dr cash / Cr liability), 'equity_in' (Dr cash / Cr equity),
--    'equity_out' (Dr equity / Cr cash), 'noncash_depreciation' (Dr expense / Cr accumulated depreciation).
DROP FUNCTION IF EXISTS public.acct_default_account_for_charge(text);
CREATE OR REPLACE FUNCTION public.acct_default_account_for_charge(p_charge_type text)
RETURNS TABLE (code text, name text, acc_type text, direction text)
LANGUAGE sql IMMUTABLE
AS $$
  SELECT v.code::text, v.name::text, v.acc_type::text, v.direction::text
  FROM (VALUES
    -- Banking & payments  -> 6400 / 5100 / 7030 / 4910
    ('bank_fee',                 '6400','Bank charges',               'expense','expense'),
    ('wire_fee',                 '6400','Bank charges',               'expense','expense'),
    ('chargeback',               '6400','Bank charges',               'expense','expense'),
    ('reversal',                 '6400','Bank charges',               'expense','expense'),
    ('payment_processing_fee',   '5100','Payment processing fees',    'expense','expense'),
    ('currency_conversion',      '5100','Payment processing fees',    'expense','expense'),
    ('fx_adjustment',            '7030','Foreign exchange gain/loss', 'expense','expense'),
    ('fx_gain',                  '4910','Foreign exchange gain/loss', 'revenue','income'),
    -- Platform commissions
    ('hostly_commission',        '5010','Hostly service fees',          'expense','expense'),
    ('airbnb_commission',        '5020','Airbnb service fees',          'expense','expense'),
    ('booking_com_commission',   '5030','Booking.com commission',       'expense','expense'),
    ('vrbo_commission',          '5040','Vrbo commission',              'expense','expense'),
    ('direct_commission',        '5050','Other platform commissions',   'expense','expense'),
    ('other_platform_commission','5050','Other platform commissions',   'expense','expense'),
    -- Operations
    ('cleaning_labor',           '5200','Cleaning — labor',           'expense','expense'),
    ('cleaning_supplies',        '5210','Cleaning — supplies',        'expense','expense'),
    ('linen_laundry',            '5220','Linen & laundry',            'expense','expense'),
    ('guest_amenities',          '5230','Guest amenities',            'expense','expense'),
    -- Maintenance
    ('repairs_maintenance',      '6100','Repairs & maintenance',      'expense','expense'),
    ('property_management_fee',  '6110','Property management fees',   'expense','expense'),
    -- Utilities
    ('electricity',              '6010','Utilities — electricity',    'expense','expense'),
    ('water',                    '6020','Utilities — water',          'expense','expense'),
    ('internet',                 '6030','Utilities — internet',       'expense','expense'),
    ('gas',                      '6040','Utilities — gas',            'expense','expense'),
    -- Insurance, tax & legal
    ('insurance',                '6200','Insurance',                  'expense','expense'),
    ('property_tax',             '6210','Property taxes',             'expense','expense'),
    ('occupancy_tax',            '6230','Tourism levy expense',       'expense','expense'),
    ('tourism_levy',             '6230','Tourism levy expense',       'expense','expense'),
    ('income_tax_payment',       '2320','Income tax payable',         'liability','liability_pay'),
    ('license_permit',           '6220','Licenses & permits',         'expense','expense'),
    ('legal_fees',               '6420','Professional fees',          'expense','expense'),
    ('accounting_fees',          '6420','Professional fees',          'expense','expense'),
    ('professional_fees',        '6420','Professional fees',          'expense','expense'),
    -- Software / office / travel
    ('software_subscriptions',   '6320','Software subscriptions',     'expense','expense'),
    ('office_admin',             '6410','Office & admin',             'expense','expense'),
    ('travel',                   '6430','Travel',                     'expense','expense'),
    -- Marketing
    ('photography',              '6310','Photography',                'expense','expense'),
    ('marketing_advertising',    '6300','Marketing & advertising',    'expense','expense'),
    -- Property finance
    ('mortgage_interest',        '7010','Mortgage interest',          'expense','expense'),
    ('loan_interest',            '7020','Loan interest',              'expense','expense'),
    ('mortgage_principal',       '2500','Mortgage payable',           'liability','liability_pay'),
    ('loan_principal',           '2400','Short-term loans',           'liability','liability_pay'),
    ('hoa_fees',                 '6410','Office & admin',             'expense','expense'),
    ('rent_paid',                '6410','Office & admin',             'expense','expense'),
    -- Depreciation: Dr depreciation expense (6500) / Cr accumulated depreciation (1590)
    ('depreciation',             '6500','Depreciation expense',       'expense','noncash_depreciation'),
    -- Asset purchases: Dr asset / Cr cash
    ('asset_purchase_land',      '1500','Land',                       'asset','asset_buy'),
    ('asset_purchase_building',  '1510','Building',                   'asset','asset_buy'),
    ('asset_purchase_furniture', '1520','Furniture & fixtures',       'asset','asset_buy'),
    ('asset_purchase_appliances','1530','Appliances',                 'asset','asset_buy'),
    ('asset_purchase_electronics','1540','Electronics',               'asset','asset_buy'),
    -- Prepaid
    ('prepaid_insurance',        '1300','Prepaid insurance',          'asset','asset_buy'),
    ('prepaid_subscription',     '1310','Prepaid subscriptions',      'asset','asset_buy'),
    -- Liabilities settled / received
    ('pay_accounts_payable',     '2010','Accounts payable',           'liability','liability_pay'),
    ('pay_credit_card',          '2020','Credit card payable',        'liability','liability_pay'),
    ('pay_vat',                  '2300','VAT payable',                'liability','liability_pay'),
    ('pay_tourism_levy_due',     '2310','Tourism levy payable',       'liability','liability_pay'),
    ('pay_income_tax_due',       '2320','Income tax payable',         'liability','liability_pay'),
    ('short_term_loan_received', '2400','Short-term loans',           'liability','liability_receive'),
    ('short_term_loan_repayment','2400','Short-term loans',           'liability','liability_pay'),
    -- Guest related
    ('damage_repair',            '6100','Repairs & maintenance',      'expense','expense'),
    ('damage_recovery',          '4900','Other income',               'revenue','income'),
    ('security_deposit_hold',    '2100','Security deposits liability','liability','liability_receive'),
    ('security_deposit_release', '2100','Security deposits liability','liability','liability_pay'),
    ('guest_refund',             '4010','Rental revenue — Hostly',    'revenue','expense'),
    ('goodwill_credit',          '4900','Other income',               'revenue','expense'),
    ('guest_compensation',       '6410','Office & admin',             'expense','expense'),
    ('extra_guest_fee_income',   '4110','Extra guest fees',           'revenue','income'),
    ('pet_fee_income',           '4120','Pet fees',                   'revenue','income'),
    ('cancellation_fee_income',  '4130','Cancellation fees',          'revenue','income'),
    -- Owner / equity
    ('owner_capital_contribution','3010','Owner''s capital',          'equity','equity_in'),
    ('owner_draw',               '3020','Owner''s drawings',          'equity','equity_out'),
    ('opening_balance_equity',   '3040','Opening balance equity',     'equity','equity_in'),
    -- Misc
    ('other_income',             '4900','Other income',               'revenue','income'),
    ('other_expense',            '6410','Office & admin',             'expense','expense'),
    ('other',                    '6410','Office & admin',             'expense','expense')
  ) AS v(ct, code, name, acc_type, direction)
  WHERE v.ct = p_charge_type
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.acct_default_account_for_charge(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acct_default_account_for_charge(text) TO authenticated;

-- 3) Replace post RPC: use returned `direction` to choose double-entry shape,
--    and special-case `noncash_depreciation` (counter-account is 1590, not cash).
CREATE OR REPLACE FUNCTION public.acct_post_bank_charge(p_charge_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_charge public.acct_bank_charges;
  v_entry_id uuid;
  v_acc_target uuid;
  v_acc_counter uuid;
  v_target_code text;
  v_target_name text;
  v_target_type text;
  v_direction text;
  v_counter_code text := '1010';
  v_counter_name text := 'Cash on hand';
  v_counter_type text := 'asset';
  v_dr_target numeric(14,2);
  v_cr_target numeric(14,2);
  v_dr_counter numeric(14,2);
  v_cr_counter numeric(14,2);
BEGIN
  IF NOT (public.has_role(v_caller, 'admin'::app_role)
       OR public.has_role(v_caller, 'finance_officer'::app_role)) THEN
    RAISE EXCEPTION 'acct_post_bank_charge: admin or finance_officer required';
  END IF;

  SELECT * INTO v_charge FROM public.acct_bank_charges WHERE id = p_charge_id FOR UPDATE;
  IF v_charge IS NULL THEN RAISE EXCEPTION 'Bank charge % not found', p_charge_id; END IF;
  IF v_charge.voided_at IS NOT NULL OR v_charge.status = 'voided' THEN
    RAISE EXCEPTION 'Cannot post a voided charge';
  END IF;
  IF v_charge.journal_entry_id IS NOT NULL THEN
    RETURN v_charge.journal_entry_id;
  END IF;

  SELECT code, name, acc_type, direction
    INTO v_target_code, v_target_name, v_target_type, v_direction
  FROM public.acct_default_account_for_charge(v_charge.charge_type);
  IF v_target_code IS NULL THEN
    v_target_code := '6410'; v_target_name := 'Office & admin';
    v_target_type := 'expense'; v_direction := 'expense';
  END IF;

  -- Resolve / create the target account on this host's CoA.
  SELECT id INTO v_acc_target FROM public.acct_chart_of_accounts
   WHERE host_id = v_charge.host_id AND code = v_target_code LIMIT 1;
  IF v_acc_target IS NULL THEN
    INSERT INTO public.acct_chart_of_accounts (host_id, code, name, type, is_system)
    VALUES (v_charge.host_id, v_target_code, v_target_name, v_target_type::acct_account_type, true)
    RETURNING id INTO v_acc_target;
  END IF;

  -- Counter-account selection: depreciation uses Accumulated depreciation (1590),
  -- everything else uses Cash on hand (1010).
  IF v_direction = 'noncash_depreciation' THEN
    v_counter_code := '1590';
    v_counter_name := 'Accumulated depreciation';
    v_counter_type := 'asset';
  END IF;

  SELECT id INTO v_acc_counter FROM public.acct_chart_of_accounts
   WHERE host_id = v_charge.host_id AND code = v_counter_code LIMIT 1;
  IF v_acc_counter IS NULL THEN
    INSERT INTO public.acct_chart_of_accounts (host_id, code, name, type, is_system)
    VALUES (v_charge.host_id, v_counter_code, v_counter_name, v_counter_type::acct_account_type, true)
    RETURNING id INTO v_acc_counter;
  END IF;

  -- Direction-driven debit/credit shape.
  --  expense / asset_buy / liability_pay / equity_out  => Dr target / Cr counter (cash out)
  --  income / liability_receive / equity_in            => Dr counter (cash in) / Cr target
  --  noncash_depreciation                              => Dr target (expense) / Cr counter (accum dep)
  IF v_direction IN ('income','liability_receive','equity_in') THEN
    v_dr_counter := v_charge.amount; v_cr_counter := 0;
    v_dr_target  := 0;               v_cr_target  := v_charge.amount;
  ELSE
    -- expense, asset_buy, liability_pay, equity_out, noncash_depreciation
    v_dr_target  := v_charge.amount; v_cr_target  := 0;
    v_dr_counter := 0;               v_cr_counter := v_charge.amount;
  END IF;

  INSERT INTO public.acct_journal_entries (
    host_id, entry_date, reference, description, source_type, source_id, posted, created_by
  ) VALUES (
    v_charge.host_id, v_charge.charge_date,
    COALESCE(v_charge.reference, 'BANK-' || substr(v_charge.id::text, 1, 8)),
    v_charge.charge_type || ': ' || v_charge.description,
    'manual'::acct_journal_source,
    'BANK_CHARGE:' || v_charge.id::text,
    true, v_caller
  ) RETURNING id INTO v_entry_id;

  INSERT INTO public.acct_journal_lines (entry_id, account_id, debit, credit, memo)
  VALUES
    (v_entry_id, v_acc_target,  v_dr_target,  v_cr_target,
      v_charge.charge_type || ' / ' || COALESCE(v_charge.reference, 'no-ref')),
    (v_entry_id, v_acc_counter, v_dr_counter, v_cr_counter,
      CASE WHEN v_direction = 'noncash_depreciation'
           THEN 'Accumulated depreciation'
           ELSE 'Cash settlement of ' || v_charge.charge_type END);

  UPDATE public.acct_bank_charges
     SET journal_entry_id = v_entry_id,
         status = 'posted'
   WHERE id = p_charge_id;

  RETURN v_entry_id;
END;
$$;

REVOKE ALL ON FUNCTION public.acct_post_bank_charge(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acct_post_bank_charge(uuid) TO authenticated;