ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS availability_settings jsonb NOT NULL DEFAULT jsonb_build_object(
    'advance_notice', 'same_day',
    'preparation_time', 'none',
    'availability_window', '12'
  );

COMMENT ON COLUMN public.properties.availability_settings IS
  'Host-controlled booking gates. Keys: advance_notice (same_day | 1_day | 2_days | 3_days | 7_days), preparation_time (none | 1_night | 2_nights), availability_window (months as string: 3 | 6 | 9 | 12 | 24).';