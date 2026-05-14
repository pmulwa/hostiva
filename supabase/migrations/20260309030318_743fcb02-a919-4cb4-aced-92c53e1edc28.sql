
-- Platform settings table for admin fee thresholds (singleton pattern)
CREATE TABLE public.platform_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_fee_percent numeric NOT NULL DEFAULT 10,
  host_commission_percent numeric NOT NULL DEFAULT 3,
  service_tax_percent numeric NOT NULL DEFAULT 18,
  host_tax_percent numeric NOT NULL DEFAULT 15,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read platform settings
CREATE POLICY "Anyone can view platform settings"
  ON public.platform_settings FOR SELECT
  TO authenticated
  USING (true);

-- Only admins can update
CREATE POLICY "Admins can manage platform settings"
  ON public.platform_settings FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Insert default row
INSERT INTO public.platform_settings (service_fee_percent, host_commission_percent, service_tax_percent, host_tax_percent)
VALUES (10, 3, 18, 15);

-- Add service_fee_charged_to column to properties (host decides per property)
ALTER TABLE public.properties
  ADD COLUMN service_fee_charged_to text NOT NULL DEFAULT 'guest';
