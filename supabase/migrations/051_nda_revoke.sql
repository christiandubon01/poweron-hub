-- Migration 051: NDA revoke + B3 column additions
-- Adds revoked flag to signed_agreements, plus any missing columns
-- required by ndaService.ts (typed_name, signature_image, pdf_url).
-- Apply in Supabase SQL editor.

-- B3: typed name (signer's full name as typed)
ALTER TABLE public.signed_agreements
  ADD COLUMN IF NOT EXISTS typed_name      TEXT,
  ADD COLUMN IF NOT EXISTS signature_image TEXT,
  ADD COLUMN IF NOT EXISTS pdf_url         TEXT;

-- B3: revoke flag — set to true when an admin revokes NDA access
ALTER TABLE public.signed_agreements
  ADD COLUMN IF NOT EXISTS revoked BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for admin queries ordered by signed_at DESC
CREATE INDEX IF NOT EXISTS idx_signed_agreements_signed_at
  ON public.signed_agreements (signed_at DESC);

-- RLS: allow owner to update revoked flag and pdf_url
-- (assumes a user_roles table or similar for owner detection;
--  for now, allow authenticated users to update their own rows,
--  and a separate owner policy can be added when roles are wired)
CREATE POLICY IF NOT EXISTS "Users can update own agreements"
  ON public.signed_agreements FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
