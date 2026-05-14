
CREATE OR REPLACE FUNCTION public.auto_promote_to_host()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only act when status changes to 'active'
  IF NEW.status = 'active' AND (OLD.status IS NULL OR OLD.status != 'active') THEN
    -- Update profile to mark as host
    UPDATE public.profiles SET is_host = true WHERE user_id = NEW.host_id;
    
    -- Add host role if not already present
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.host_id, 'host')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_property_approved
AFTER INSERT OR UPDATE OF status ON public.properties
FOR EACH ROW
EXECUTE FUNCTION public.auto_promote_to_host();
