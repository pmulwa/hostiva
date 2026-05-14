-- Seed default cancellation_policy row in platform_controls so admins can adjust refund tiers
INSERT INTO public.platform_controls (section, settings)
VALUES (
  'cancellation_policy',
  jsonb_build_object(
    'tier3_cash_refund_pct', 70,
    'tier3_credit_pct', 90,
    'tier3_host_comp_pct', 30,
    'tier4_cash_refund_pct', 40,
    'tier4_credit_pct', 70,
    'tier4_host_comp_pct', 60,
    'tier8_unused_refund_pct', 100,
    'tier8_stayed_refund_pct', 50,
    'tier9_unused_refund_pct', 100,
    'tier9_stayed_refund_pct', 25,
    'host_cancel_fine_30plus', 0,
    'host_cancel_fine_7_30', 100,
    'host_cancel_fine_under_7', 200,
    'host_cancel_fine_under_24h', 300,
    'host_cancel_credit_30plus', 50,
    'host_cancel_credit_7_30', 100,
    'host_cancel_credit_under_7', 200,
    'host_cancel_credit_under_24h', 300,
    'goodwill_full_refund_enabled', true
  )
)
ON CONFLICT DO NOTHING;