
-- Add refund tracking to bookings
ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS refund_amount numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS refund_status text DEFAULT 'none' CHECK (refund_status IN ('none', 'partial', 'full')),
ADD COLUMN IF NOT EXISTS refund_date timestamp with time zone,
ADD COLUMN IF NOT EXISTS refund_reason text;

-- Add review window setting to platform_settings
ALTER TABLE public.platform_settings
ADD COLUMN IF NOT EXISTS review_window_days integer DEFAULT 10;

-- Create mutual reviews table
CREATE TABLE public.mutual_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  guest_id uuid NOT NULL,
  host_id uuid NOT NULL,
  reviewer_type text NOT NULL CHECK (reviewer_type IN ('guest', 'host')),
  location_rating integer CHECK (location_rating BETWEEN 1 AND 5),
  security_rating integer CHECK (security_rating BETWEEN 1 AND 5),
  cleanliness_rating integer CHECK (cleanliness_rating BETWEEN 1 AND 5),
  beddings_rating integer CHECK (beddings_rating BETWEEN 1 AND 5),
  communication_rating integer CHECK (communication_rating BETWEEN 1 AND 5),
  overall_rating numeric GENERATED ALWAYS AS (
    (COALESCE(location_rating,0) + COALESCE(security_rating,0) + COALESCE(cleanliness_rating,0) + COALESCE(beddings_rating,0) + COALESCE(communication_rating,0))::numeric / 
    GREATEST(
      (CASE WHEN location_rating IS NOT NULL THEN 1 ELSE 0 END +
       CASE WHEN security_rating IS NOT NULL THEN 1 ELSE 0 END +
       CASE WHEN cleanliness_rating IS NOT NULL THEN 1 ELSE 0 END +
       CASE WHEN beddings_rating IS NOT NULL THEN 1 ELSE 0 END +
       CASE WHEN communication_rating IS NOT NULL THEN 1 ELSE 0 END), 1)
  ) STORED,
  comment text,
  review_window_closes_at timestamp with time zone NOT NULL,
  is_published boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(booking_id, reviewer_type)
);

-- Enable RLS
ALTER TABLE public.mutual_reviews ENABLE ROW LEVEL SECURITY;

-- Admins can do everything
CREATE POLICY "Admins can manage all mutual reviews"
ON public.mutual_reviews FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Users can insert their own review (guest or host)
CREATE POLICY "Users can create their own mutual review"
ON public.mutual_reviews FOR INSERT
TO authenticated
WITH CHECK (
  (reviewer_type = 'guest' AND auth.uid() = guest_id) OR
  (reviewer_type = 'host' AND auth.uid() = host_id)
);

-- Users can view reviews: only if both sides reviewed OR window closed
CREATE POLICY "Users can view published mutual reviews"
ON public.mutual_reviews FOR SELECT
TO authenticated
USING (
  -- Admin sees all
  public.has_role(auth.uid(), 'admin') OR
  -- Reviewer can always see their own
  (reviewer_type = 'guest' AND auth.uid() = guest_id) OR
  (reviewer_type = 'host' AND auth.uid() = host_id) OR
  -- Other party sees it only if published
  (is_published = true AND (auth.uid() = guest_id OR auth.uid() = host_id))
);

-- Anyone can see published reviews (for SEO / public property pages)
CREATE POLICY "Public can view published guest reviews"
ON public.mutual_reviews FOR SELECT
TO anon
USING (is_published = true AND reviewer_type = 'guest');

-- Function to publish reviews when both exist or window closes
CREATE OR REPLACE FUNCTION public.publish_mutual_reviews()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Check if the counterpart review exists
  IF EXISTS (
    SELECT 1 FROM public.mutual_reviews
    WHERE booking_id = NEW.booking_id
    AND reviewer_type != NEW.reviewer_type
  ) THEN
    -- Both reviews exist, publish both
    UPDATE public.mutual_reviews
    SET is_published = true
    WHERE booking_id = NEW.booking_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_publish_mutual_reviews
AFTER INSERT ON public.mutual_reviews
FOR EACH ROW
EXECUTE FUNCTION public.publish_mutual_reviews();

-- Trigger to update updated_at
CREATE TRIGGER update_mutual_reviews_updated_at
BEFORE UPDATE ON public.mutual_reviews
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
