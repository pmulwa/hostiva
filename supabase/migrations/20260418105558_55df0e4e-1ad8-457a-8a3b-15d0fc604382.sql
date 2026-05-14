-- Drop the over-broad policy from the previous step.
DROP POLICY IF EXISTS "Anyone can view public preference fields" ON public.user_preferences;

-- Recreate the view as security-definer so it can return the public columns
-- for any user without exposing the rest of the row.
CREATE OR REPLACE VIEW public.user_preferences_public
WITH (security_invoker = off) AS
SELECT
  user_id,
  travel_style,
  interests,
  dietary_preferences,
  accessibility_needs
FROM public.user_preferences;

GRANT SELECT ON public.user_preferences_public TO anon, authenticated;
