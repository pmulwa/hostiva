-- =====================================================================
-- Bank charge DRAFT workflow + comprehensive STR cost catalog
-- =====================================================================

-- 1) Status column.
ALTER TABLE public.acct_bank_charges
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft';

UPDATE public.acct_bank_charges
   SET status = CASE
     WHEN voided_at IS NOT NULL THEN 'voided'
     WHEN journal_entry_id IS NOT NULL THEN 'posted'
     ELSE 'draft'
   END;

ALTER TABLE public.acct_bank_charges
  DROP CONSTRAINT IF EXISTS acct_bank_charges_status_check;
ALTER TABLE public.acct_bank_charges
  ADD CONSTRAINT acct_bank_charges_status_check
  CHECK (status IN ('draft','posted','voided'));

CREATE INDEX IF NOT EXISTS idx_acct_bank_charges_status
  ON public.acct_bank_charges(status);

-- 2) Expanded charge_type whitelist.
ALTER TABLE public.acct_bank_charges
  DROP CONSTRAINT IF EXISTS acct_bank_charges_charge_type_check;
ALTER TABLE public.acct_bank_charges
  ADD CONSTRAINT acct_bank_charges_charge_type_check
  CHECK (charge_type IN (
    'bank_fee','wire_fee','fx_adjustment','chargeback','reversal','payment_processing_fee','currency_conversion',
    'ota_commission','channel_manager_fee','listing_promotion',
    'cleaning','laundry','linen_replacement','restocking_supplies','consumables','toiletries','welcome_basket',
    'maintenance','repairs','pest_control','landscaping','pool_service','hvac_service','appliance_repair',
    'electricity','water','gas','internet','cable_tv','trash_collection',
    'insurance','property_tax','occupancy_tax','income_tax','license_permit','legal_fees','accounting_fees',
    'pms_software','smart_lock_subscription','noise_monitoring','dynamic_pricing_tool','accounting_software',
    'photography','copywriting','marketing_ads','seo_tools',
    'mortgage_interest','hoa_fees','rent_paid','depreciation','property_management_fee',
    'damage_repair','damage_charge','security_deposit_hold','security_deposit_release','guest_refund','goodwill_credit','compensation',
    'owner_draw','capital_contribution','other'
  ));

-- 3) Lookup function: charge_type -> (code, name, account_type as text).
DROP FUNCTION IF EXISTS public.acct_default_account_for_charge(text);
CREATE OR REPLACE FUNCTION public.acct_default_account_for_charge(p_charge_type text)
RETURNS TABLE (code text, name text, acc_type text)
LANGUAGE sql IMMUTABLE
AS $$
  SELECT v.code::text, v.name::text, v.acc_type::text
  FROM (VALUES
    ('bank_fee','5020','Bank & Payment Fees','expense'),
    ('wire_fee','5021','Wire & Transfer Fees','expense'),
    ('fx_adjustment','5022','FX Gain / Loss','expense'),
    ('chargeback','5023','Chargebacks','expense'),
    ('reversal','5024','Payment Reversals','expense'),
    ('payment_processing_fee','5025','Payment Processing Fees','expense'),
    ('currency_conversion','5026','Currency Conversion Fees','expense'),
    ('ota_commission','5030','OTA / Platform Commission','expense'),
    ('channel_manager_fee','5031','Channel Manager Fee','expense'),
    ('listing_promotion','5032','Listing Promotion','expense'),
    ('cleaning','5100','Cleaning','expense'),
    ('laundry','5101','Laundry','expense'),
    ('linen_replacement','5102','Linen Replacement','expense'),
    ('restocking_supplies','5103','Restocking Supplies','expense'),
    ('consumables','5104','Consumables','expense'),
    ('toiletries','5105','Toiletries','expense'),
    ('welcome_basket','5106','Welcome Basket','expense'),
    ('maintenance','5200','Maintenance','expense'),
    ('repairs','5201','Repairs','expense'),
    ('pest_control','5202','Pest Control','expense'),
    ('landscaping','5203','Landscaping','expense'),
    ('pool_service','5204','Pool Service','expense'),
    ('hvac_service','5205','HVAC Service','expense'),
    ('appliance_repair','5206','Appliance Repair','expense'),
    ('electricity','5300','Electricity','expense'),
    ('water','5301','Water','expense'),
    ('gas','5302','Gas','expense'),
    ('internet','5303','Internet','expense'),
    ('cable_tv','5304','Cable / Streaming','expense'),
    ('trash_collection','5305','Trash Collection','expense'),
    ('insurance','5400','Insurance','expense'),
    ('property_tax','5401','Property Tax','expense'),
    ('occupancy_tax','5402','Occupancy / Lodging Tax','expense'),
    ('income_tax','5403','Income Tax','expense'),
    ('license_permit','5404','License & Permits','expense'),
    ('legal_fees','5405','Legal Fees','expense'),
    ('accounting_fees','5406','Accounting Fees','expense'),
    ('pms_software','5500','PMS Software','expense'),
    ('smart_lock_subscription','5501','Smart Lock Subscription','expense'),
    ('noise_monitoring','5502','Noise Monitoring','expense'),
    ('dynamic_pricing_tool','5503','Dynamic Pricing Tool','expense'),
    ('accounting_software','5504','Accounting Software','expense'),
    ('photography','5600','Photography','expense'),
    ('copywriting','5601','Copywriting','expense'),
    ('marketing_ads','5602','Marketing & Ads','expense'),
    ('seo_tools','5603','SEO Tools','expense'),
    ('mortgage_interest','5700','Mortgage Interest','expense'),
    ('hoa_fees','5701','HOA Fees','expense'),
    ('rent_paid','5702','Rent Paid (Master Lease)','expense'),
    ('depreciation','5703','Depreciation Expense','expense'),
    ('property_management_fee','5704','Property Management Fee','expense'),
    ('damage_repair','5800','Damage Repair','expense'),
    ('damage_charge','4200','Damage Recovery (Income)','revenue'),
    ('security_deposit_hold','2200','Security Deposit Liability','liability'),
    ('security_deposit_release','2200','Security Deposit Liability','liability'),
    ('guest_refund','4900','Refunds & Allowances','revenue'),
    ('goodwill_credit','5810','Goodwill Credits','expense'),
    ('compensation','5811','Guest Compensation','expense'),
    ('owner_draw','3100','Owner Draw','equity'),
    ('capital_contribution','3000','Owner Capital','equity'),
    ('other','5900','Other Operating Expense','expense')
  ) AS v(ct, code, name, acc_type)
  WHERE v.ct = p_charge_type
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.acct_default_account_for_charge(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acct_default_account_for_charge(text) TO authenticated;

-- 4) Replace post RPC: route to category account, normal-balance aware,
--    flip status to 'posted'. Refuses voided/already-posted rows.
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
  v_acc_cash uuid;
  v_target_code text;
  v_target_name text;
  v_target_type text;
  v_dr_target numeric(14,2);
  v_cr_target numeric(14,2);
  v_dr_cash   numeric(14,2);
  v_cr_cash   numeric(14,2);
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

  SELECT code, name, acc_type
    INTO v_target_code, v_target_name, v_target_type
  FROM public.acct_default_account_for_charge(v_charge.charge_type);
  IF v_target_code IS NULL THEN
    v_target_code := '5900'; v_target_name := 'Other Operating Expense'; v_target_type := 'expense';
  END IF;

  SELECT id INTO v_acc_target FROM public.acct_chart_of_accounts
   WHERE host_id = v_charge.host_id AND code = v_target_code LIMIT 1;
  IF v_acc_target IS NULL THEN
    INSERT INTO public.acct_chart_of_accounts (host_id, code, name, type, is_system)
    VALUES (v_charge.host_id, v_target_code, v_target_name, v_target_type::acct_account_type, true)
    RETURNING id INTO v_acc_target;
  END IF;

  SELECT id INTO v_acc_cash FROM public.acct_chart_of_accounts
   WHERE host_id = v_charge.host_id AND code = '1010' LIMIT 1;
  IF v_acc_cash IS NULL THEN
    INSERT INTO public.acct_chart_of_accounts (host_id, code, name, type, is_system)
    VALUES (v_charge.host_id, '1010', 'Cash Clearing', 'asset'::acct_account_type, true)
    RETURNING id INTO v_acc_cash;
  END IF;

  -- Cash-direction routing:
  --   Cash IN  (Dr cash / Cr target):  damage_charge, security_deposit_hold, capital_contribution
  --   Cash OUT (Dr target / Cr cash):  everything else (incl. guest_refund, deposit_release, owner_draw)
  IF v_charge.charge_type IN ('damage_charge','security_deposit_hold','capital_contribution') THEN
    v_dr_cash := v_charge.amount; v_cr_cash := 0;
    v_dr_target := 0;              v_cr_target := v_charge.amount;
  ELSE
    v_dr_target := v_charge.amount; v_cr_target := 0;
    v_dr_cash := 0;                 v_cr_cash := v_charge.amount;
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
    (v_entry_id, v_acc_target, v_dr_target, v_cr_target,
      v_charge.charge_type || ' / ' || COALESCE(v_charge.reference, 'no-ref')),
    (v_entry_id, v_acc_cash,   v_dr_cash,   v_cr_cash,
      'Cash settlement of ' || v_charge.charge_type);

  UPDATE public.acct_bank_charges
     SET journal_entry_id = v_entry_id,
         status = 'posted'
   WHERE id = p_charge_id;

  RETURN v_entry_id;
END;
$$;

REVOKE ALL ON FUNCTION public.acct_post_bank_charge(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acct_post_bank_charge(uuid) TO authenticated;

-- 5) Update void RPC: mirror-reverse every original line + flip status.
CREATE OR REPLACE FUNCTION public.acct_void_bank_charge(p_charge_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_charge public.acct_bank_charges;
  v_entry_id uuid;
  v_lines record;
BEGIN
  IF NOT (public.has_role(v_caller, 'admin'::app_role)
       OR public.has_role(v_caller, 'finance_officer'::app_role)) THEN
    RAISE EXCEPTION 'acct_void_bank_charge: admin or finance_officer required';
  END IF;

  SELECT * INTO v_charge FROM public.acct_bank_charges WHERE id = p_charge_id FOR UPDATE;
  IF v_charge IS NULL THEN RAISE EXCEPTION 'Bank charge % not found', p_charge_id; END IF;
  IF v_charge.voided_at IS NOT NULL THEN RETURN; END IF;

  IF v_charge.journal_entry_id IS NOT NULL THEN
    INSERT INTO public.acct_journal_entries (
      host_id, entry_date, reference, description, source_type, source_id, posted, created_by
    ) VALUES (
      v_charge.host_id, CURRENT_DATE,
      'VOID-' || COALESCE(v_charge.reference, substr(v_charge.id::text, 1, 8)),
      'VOID: ' || v_charge.charge_type || ' — ' || COALESCE(p_reason, 'no reason'),
      'manual'::acct_journal_source,
      'BANK_CHARGE_VOID:' || v_charge.id::text,
      true, v_caller
    ) RETURNING id INTO v_entry_id;

    FOR v_lines IN
      SELECT account_id, debit, credit, memo
        FROM public.acct_journal_lines
       WHERE entry_id = v_charge.journal_entry_id
    LOOP
      INSERT INTO public.acct_journal_lines (entry_id, account_id, debit, credit, memo)
      VALUES (v_entry_id, v_lines.account_id, v_lines.credit, v_lines.debit,
              'Reversal: ' || COALESCE(v_lines.memo, ''));
    END LOOP;
  END IF;

  UPDATE public.acct_bank_charges
     SET voided_at = now(), voided_by = v_caller, void_reason = p_reason,
         status = 'voided'
   WHERE id = p_charge_id;
END;
$$;

REVOKE ALL ON FUNCTION public.acct_void_bank_charge(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acct_void_bank_charge(uuid, text) TO authenticated;

-- 6) Delete-draft RPC.
CREATE OR REPLACE FUNCTION public.acct_delete_draft_bank_charge(p_charge_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_charge public.acct_bank_charges;
BEGIN
  IF NOT (public.has_role(v_caller, 'admin'::app_role)
       OR public.has_role(v_caller, 'finance_officer'::app_role)) THEN
    RAISE EXCEPTION 'admin or finance_officer required';
  END IF;
  SELECT * INTO v_charge FROM public.acct_bank_charges WHERE id = p_charge_id;
  IF v_charge IS NULL THEN RETURN; END IF;
  IF v_charge.status <> 'draft' OR v_charge.journal_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only draft (un-posted) charges can be deleted';
  END IF;
  DELETE FROM public.acct_bank_charges WHERE id = p_charge_id;
END;
$$;

REVOKE ALL ON FUNCTION public.acct_delete_draft_bank_charge(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acct_delete_draft_bank_charge(uuid) TO authenticated;