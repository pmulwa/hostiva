DROP VIEW IF EXISTS public.user_preferences_public;

CREATE OR REPLACE FUNCTION public.get_public_preferences(_user_id uuid)
RETURNS TABLE (
  travel_style text,
  interests text[],
  dietary_preferences text[],
  accessibility_needs text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    travel_style,
    interests,
    dietary_preferences,
    accessibility_needs
  FROM public.user_preferences
  WHERE user_id = _user_id
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_preferences(uuid) TO anon, authenticated;
