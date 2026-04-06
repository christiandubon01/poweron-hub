-- Migration 050: signed_agreements table
-- Required by ndaService.ts for NDA beta gate persistence.
-- Apply in Supabase SQL editor before deploying the NDA gate.

CREATE TABLE IF NOT EXISTS public.signed_agreements (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL,
  agreement_type  TEXT NOT NULL,
  signed_at       TIMESTAMPTZ DEFAULT now(),
  signature_data  TEXT,
  ip_address      TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Index for fast user lookups (hasUserSignedNDA queries by user_id + agreement_type)
CREATE INDEX IF NOT EXISTS idx_signed_agreements_user_type
  ON public.signed_agreements (user_id, agreement_type);

-- RLS: users can only read/insert their own rows
ALTER TABLE public.signed_agreements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own agreements"
  ON public.signed_agreements FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own agreements"
  ON public.signed_agreements FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- B2: Identity verification columns (email PIN confirmation)
-- Added by migration 050 amendment — safe to run on existing table.
ALTER TABLE public.signed_agreements
  ADD COLUMN IF NOT EXISTS email                  TEXT,
  ADD COLUMN IF NOT EXISTS pin_verified           BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS verification_timestamp TIMESTAMPTZ;
