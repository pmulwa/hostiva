CREATE OR REPLACE FUNCTION public.get_property_blocked_dates(_property_id uuid)
 RETURNS TABLE(check_in_date date, check_out_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT b.check_in_date, b.check_out_date
  FROM public.bookings b
  WHERE b.property_id = _property_id
    AND b.status IN ('confirmed', 'in_progress', 'pending_host_approval')
$function$;