DROP POLICY IF EXISTS "Public can view published guest reviews" ON public.mutual_reviews;

CREATE POLICY "Public can view all published mutual reviews"
  ON public.mutual_reviews
  FOR SELECT
  TO anon, authenticated
  USING (is_published = true);