-- Add user ID format configuration to platform_settings.
-- Allows admins to configure how guest, host, and staff IDs are generated/displayed.

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS guest_id_prefix TEXT NOT NULL DEFAULT 'GST',
  ADD COLUMN IF NOT EXISTS guest_id_length INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS host_id_prefix TEXT NOT NULL DEFAULT 'HST',
  ADD COLUMN IF NOT EXISTS host_id_length INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS staff_id_prefix TEXT NOT NULL DEFAULT 'STF',
  ADD COLUMN IF NOT EXISTS staff_id_length INTEGER NOT NULL DEFAULT 6;