
-- Create user_preferences table for notification & privacy settings
CREATE TABLE public.user_preferences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  -- Notification preferences
  notif_booking_updates BOOLEAN NOT NULL DEFAULT true,
  notif_messages BOOLEAN NOT NULL DEFAULT true,
  notif_promotions BOOLEAN NOT NULL DEFAULT false,
  notif_price_alerts BOOLEAN NOT NULL DEFAULT true,
  notif_reviews BOOLEAN NOT NULL DEFAULT true,
  notif_security BOOLEAN NOT NULL DEFAULT true,
  notif_newsletter BOOLEAN NOT NULL DEFAULT false,
  notif_sms BOOLEAN NOT NULL DEFAULT false,
  notif_push BOOLEAN NOT NULL DEFAULT true,
  -- Privacy preferences
  profile_visibility TEXT NOT NULL DEFAULT 'public',
  show_trips BOOLEAN NOT NULL DEFAULT true,
  show_reviews BOOLEAN NOT NULL DEFAULT true,
  show_wishlist BOOLEAN NOT NULL DEFAULT false,
  show_online_status BOOLEAN NOT NULL DEFAULT true,
  allow_search_engines BOOLEAN NOT NULL DEFAULT true,
  share_data_partners BOOLEAN NOT NULL DEFAULT false,
  -- Accessibility
  font_size TEXT NOT NULL DEFAULT 'medium',
  high_contrast BOOLEAN NOT NULL DEFAULT false,
  reduce_motion BOOLEAN NOT NULL DEFAULT false,
  screen_reader BOOLEAN NOT NULL DEFAULT false,
  theme TEXT NOT NULL DEFAULT 'system',
  -- Payment
  preferred_currency TEXT NOT NULL DEFAULT 'USD',
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- Users can view own preferences
CREATE POLICY "Users can view own preferences"
  ON public.user_preferences FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert own preferences
CREATE POLICY "Users can insert own preferences"
  ON public.user_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update own preferences
CREATE POLICY "Users can update own preferences"
  ON public.user_preferences FOR UPDATE
  USING (auth.uid() = user_id);

-- Create avatars storage bucket (public)
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true);

-- Allow authenticated users to upload their own avatar
CREATE POLICY "Users can upload own avatar"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Allow authenticated users to update their own avatar
CREATE POLICY "Users can update own avatar"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Allow anyone to view avatars (public bucket)
CREATE POLICY "Anyone can view avatars"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

-- Allow authenticated users to delete their own avatar
CREATE POLICY "Users can delete own avatar"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
