-- 1. Extend app_role enum with cohost & superadmin (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'cohost' AND enumtypid = 'public.app_role'::regtype) THEN
    ALTER TYPE public.app_role ADD VALUE 'cohost';
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'superadmin' AND enumtypid = 'public.app_role'::regtype) THEN
    ALTER TYPE public.app_role ADD VALUE 'superadmin';
  END IF;
END$$;

-- 2. Seed / refresh built-in custom_roles to match the canonical capability matrix.
-- Permissions reference the keys defined in src/pages/admin/AdminRoles.tsx PERMISSIONS array.

-- Clear out any old casing duplicates we created earlier
DELETE FROM public.custom_roles WHERE is_builtin = true;

INSERT INTO public.custom_roles (name, description, permissions, is_builtin) VALUES
  ('guest',         'Browse and book stays',
    ARRAY['view_listings'], true),
  ('host',          'List and manage properties',
    ARRAY['view_listings','create_listings','moderate_listings'], true),
  ('cohost',        'Delegated listing manager',
    ARRAY['moderate_listings'], true),
  ('admin',         'Platform-wide authority',
    ARRAY['view_listings','create_listings','moderate_listings','view_users','manage_users','ban_users','delete_users','issue_refunds_small','issue_refunds_large','manage_payouts','create_staff','access_hr_records','review_flagged_content','impersonate_users','investigate_fraud','modify_role_permissions'], true),
  ('superadmin',    'Root-level access',
    ARRAY['view_listings','create_listings','moderate_listings','view_users','manage_users','ban_users','delete_users','issue_refunds_small','issue_refunds_large','manage_payouts','create_staff','access_hr_records','review_flagged_content','impersonate_users','investigate_fraud','modify_role_permissions'], true),
  ('customer_care', 'Handles tickets & disputes',
    ARRAY['view_users','issue_refunds_small','impersonate_users'], true),
  ('hr',            'Staff & employee records',
    ARRAY['create_staff','access_hr_records'], true),
  ('finance_officer','Payouts & reconciliation',
    ARRAY['issue_refunds_small','issue_refunds_large','manage_payouts'], true),
  ('trust',         'Fraud & policy enforcement',
    ARRAY['view_users','manage_users','ban_users','review_flagged_content','impersonate_users','investigate_fraud'], true),
  ('moderator',     'Reviews listings & content',
    ARRAY['review_flagged_content'], true),
  ('operations',    'Day-to-day platform ops',
    ARRAY['view_users','view_listings'], true),
  ('marketing',     'Campaigns & promotions',
    ARRAY['view_listings'], true);