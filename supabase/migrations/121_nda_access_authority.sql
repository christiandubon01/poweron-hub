-- Migration 121: canonical NDA access authority
-- Adds the explicit durable server authority that signed_agreements cannot
-- represent without fabricating legal signature evidence:
--   - grandfathered legacy access (access allowed, no signed document on file)
--   - explicit revocation state
--
-- Historical signed_agreements rows remain unchanged.
-- The only one-time compatibility seed is the bounded pre-canonical owner
-- cohort that still has owner access but no valid signed_agreements evidence.
-- No runtime age/login heuristic is introduced; future rows remain explicit.

CREATE TABLE IF NOT EXISTS public.nda_access_authority (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  access_state text NOT NULL CHECK (access_state IN ('GRANDFATHERED_LEGACY_ACCESS', 'REVOKED')),
  source_classification text NOT NULL,
  reason text,
  effective_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_nda_access_authority_state
  ON public.nda_access_authority (access_state);

ALTER TABLE public.nda_access_authority ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.nda_access_authority FROM PUBLIC;
REVOKE ALL ON public.nda_access_authority FROM anon;
REVOKE ALL ON public.nda_access_authority FROM authenticated;
GRANT SELECT ON public.nda_access_authority TO authenticated;

WITH legacy_owner_access_cohort AS (
  SELECT DISTINCT o.owner_id AS user_id
  FROM public.organizations o
  JOIN public.profiles p
    ON p.id = o.owner_id
  WHERE o.owner_id IS NOT NULL
    AND COALESCE(p.is_active, true) = true
    AND NOT EXISTS (
      SELECT 1
      FROM public.signed_agreements sa
      WHERE sa.user_id = o.owner_id
        AND lower(coalesce(sa.agreement_type, '')) LIKE '%nda%'
        AND (sa.signed_at IS NOT NULL OR sa.created_at IS NOT NULL)
    )
)
INSERT INTO public.nda_access_authority (
  user_id,
  access_state,
  source_classification,
  reason
)
SELECT
  cohort.user_id,
  'GRANDFATHERED_LEGACY_ACCESS',
  'legacy_owner_access_compatibility',
  'Pre-canonical NDA compatibility access during migration 121.'
FROM legacy_owner_access_cohort cohort
LEFT JOIN public.nda_access_authority existing
  ON existing.user_id = cohort.user_id
WHERE existing.user_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'nda_access_authority'
      AND policyname = 'nda_access_authority_self_read'
  ) THEN
    CREATE POLICY "nda_access_authority_self_read"
      ON public.nda_access_authority
      FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END $$;
