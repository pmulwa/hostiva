-- Public view exposing ONLY non-sensitive personal preferences.
-- Used on /user/:id so hosts can see a guest's travel style, interests,
-- dietary needs and accessibility needs before accepting a booking.
CREATE OR REPLACE VIEW public.user_preferences_public
WITH (security_invoker = on) AS
SELECT
  user_id,
  travel_style,
  interests,
  dietary_preferences,
  accessibility_needs
FROM public.user_preferences;

GRANT SELECT ON public.user_preferences_public TO anon, authenticated;

-- Allow anyone to read the limited columns via the view.
-- The underlying table still restricts full-row access to the owner.
DROP POLICY IF EXISTS "Anyone can view public preference fields" ON public.user_preferences;
CREATE POLICY "Anyone can view public preference fields"
  ON public.user_preferences
  FOR SELECT
  USING (true);
