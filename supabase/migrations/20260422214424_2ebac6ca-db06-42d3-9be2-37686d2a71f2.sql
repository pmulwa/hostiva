
-- 1) Backfill missing profiles from auth.users so existing bookings show real names/emails
INSERT INTO public.profiles (user_id, email, full_name, avatar_url)
SELECT
  u.id,
  COALESCE(u.email, ''),
  COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', ''),
  COALESCE(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture', '')
FROM auth.users u
LEFT JOIN public.profiles p ON p.user_id = u.id
WHERE p.user_id IS NULL;

-- 2) Admin-only RPC fallback to read basic user info from auth.users
CREATE OR REPLACE FUNCTION public.admin_get_user_basic(_user_id uuid)
RETURNS TABLE(user_id uuid, email text, full_name text, phone text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    COALESCE(p.email, u.email::text, '')::text AS email,
    COALESCE(
      NULLIF(p.full_name, ''),
      NULLIF(u.raw_user_meta_data->>'full_name', ''),
      NULLIF(u.raw_user_meta_data->>'name', ''),
      ''
    )::text AS full_name,
    COALESCE(p.phone, u.phone::text, '')::text AS phone
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
  WHERE u.id = _user_id;
END;
$$;
