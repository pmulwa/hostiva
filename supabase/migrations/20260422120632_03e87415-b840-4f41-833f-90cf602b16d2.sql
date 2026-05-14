-- Enable realtime broadcasts so notifications and availability updates push live to clients
ALTER TABLE public.notification_log REPLICA IDENTITY FULL;
ALTER TABLE public.property_availability REPLICA IDENTITY FULL;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notification_log;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.property_availability;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;