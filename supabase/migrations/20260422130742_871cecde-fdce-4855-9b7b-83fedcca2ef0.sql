
-- Create a public bucket for message attachments (images / pdfs etc.)
-- Files are namespaced by sender user-id so per-user RLS works.
INSERT INTO storage.buckets (id, name, public)
VALUES ('message-attachments', 'message-attachments', true)
ON CONFLICT (id) DO NOTHING;

-- Public read so previews render (URLs are unguessable UUID paths)
CREATE POLICY "Message attachments are publicly viewable"
ON storage.objects
FOR SELECT
USING (bucket_id = 'message-attachments');

-- Authenticated users can upload only inside their own folder: <auth.uid()>/...
CREATE POLICY "Users can upload own message attachments"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'message-attachments'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can update own message attachments"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'message-attachments'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete own message attachments"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'message-attachments'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
