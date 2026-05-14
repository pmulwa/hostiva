
-- Create user_verifications table to store verification statuses
CREATE TABLE public.user_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  verification_type text NOT NULL, -- 'phone', 'government_id', 'work_email', 'identity', 'background_check', 'property_standards'
  status text NOT NULL DEFAULT 'pending', -- 'pending', 'verified', 'rejected'
  data jsonb DEFAULT '{}'::jsonb, -- stores phone number, work email, file path etc.
  verified_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(user_id, verification_type)
);

-- Enable RLS
ALTER TABLE public.user_verifications ENABLE ROW LEVEL SECURITY;

-- Users can view their own verifications
CREATE POLICY "Users can view own verifications"
  ON public.user_verifications FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own verifications
CREATE POLICY "Users can insert own verifications"
  ON public.user_verifications FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own verifications
CREATE POLICY "Users can update own verifications"
  ON public.user_verifications FOR UPDATE
  USING (auth.uid() = user_id);

-- Admins can manage all verifications
CREATE POLICY "Admins can manage all verifications"
  ON public.user_verifications FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Public can see verified status of any user (for trust display on listings)
CREATE POLICY "Anyone can view verified statuses"
  ON public.user_verifications FOR SELECT
  USING (status = 'verified');

-- Create storage bucket for verification documents
INSERT INTO storage.buckets (id, name, public) VALUES ('verification-documents', 'verification-documents', false);

-- Storage policies - users can upload their own docs
CREATE POLICY "Users can upload verification docs"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'verification-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Users can view their own docs
CREATE POLICY "Users can view own verification docs"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'verification-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Admins can view all docs
CREATE POLICY "Admins can view all verification docs"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'verification-documents' AND has_role(auth.uid(), 'admin'::app_role));

-- Trigger to update updated_at
CREATE TRIGGER update_user_verifications_updated_at
  BEFORE UPDATE ON public.user_verifications
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
