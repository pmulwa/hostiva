
INSERT INTO public.platform_controls (section, settings) VALUES
  ('superhost_criteria', '{"min_rating": 4.8, "min_reviews": 10}'::jsonb)
ON CONFLICT (section) DO NOTHING;
