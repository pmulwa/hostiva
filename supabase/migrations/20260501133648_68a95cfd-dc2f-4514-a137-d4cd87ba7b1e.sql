ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS photo_rules jsonb NOT NULL DEFAULT jsonb_build_object(
    'min_long_edge', 1024,
    'min_sharpness', 60,
    'block_blurry', false,
    'block_screenshots', true,
    'block_dark', false
  );

COMMENT ON COLUMN public.properties.photo_rules IS
  'Per-listing photo quality gate. Keys: min_long_edge (px), min_sharpness (Laplacian variance), block_blurry, block_screenshots, block_dark.';