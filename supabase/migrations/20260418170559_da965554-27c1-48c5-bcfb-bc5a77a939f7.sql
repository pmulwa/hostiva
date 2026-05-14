
CREATE TABLE IF NOT EXISTS public.acct_sharing_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL,
  name text NOT NULL,
  allocations jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (host_id, name)
);

ALTER TABLE public.acct_sharing_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hosts manage own sharing presets"
  ON public.acct_sharing_presets FOR ALL
  USING (auth.uid() = host_id) WITH CHECK (auth.uid() = host_id);

CREATE POLICY "Admins view all sharing presets"
  ON public.acct_sharing_presets FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_acct_sharing_presets_updated
  BEFORE UPDATE ON public.acct_sharing_presets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
