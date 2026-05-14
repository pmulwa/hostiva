
-- Admin internal notes pinned to a user. Only admins can read/create.
-- Only the original author can edit/delete their note.
CREATE TABLE public.admin_user_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id UUID NOT NULL,
  author_id UUID NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_user_notes_target ON public.admin_user_notes(target_user_id, created_at DESC);

ALTER TABLE public.admin_user_notes ENABLE ROW LEVEL SECURITY;

-- All admins / superadmins can read internal notes
CREATE POLICY "Admins can view internal notes"
  ON public.admin_user_notes FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role));

-- Admins can create notes (author must be themselves)
CREATE POLICY "Admins can create their own notes"
  ON public.admin_user_notes FOR INSERT
  TO authenticated
  WITH CHECK (
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role))
    AND auth.uid() = author_id
  );

-- Only the author of a note can edit it
CREATE POLICY "Authors can edit their own notes"
  ON public.admin_user_notes FOR UPDATE
  TO authenticated
  USING (auth.uid() = author_id)
  WITH CHECK (auth.uid() = author_id);

-- Only the author can delete their note
CREATE POLICY "Authors can delete their own notes"
  ON public.admin_user_notes FOR DELETE
  TO authenticated
  USING (auth.uid() = author_id);

-- Auto-update updated_at
CREATE TRIGGER update_admin_user_notes_updated_at
  BEFORE UPDATE ON public.admin_user_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
