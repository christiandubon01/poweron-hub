-- =============================================================================
-- Migration 130: LEAD-SRC-4I — Canonical referral profiles
-- =============================================================================
-- Adds public.referral_profiles as the private canonical referrer identity.
-- Links referral_claims.referral_profile_id → referral_profiles.
--
-- Status semantics (unchanged vocabulary):
--   unresolved / ambiguous / confirmed_unlinked → no profile, no client/lead IDs
--   resolved → exactly one referral_profile_id
--
-- Compatibility:
--   resolved_client_id / resolved_lead_id remain as optional mirrors of an
--   explicitly owner-linked customer/lead identity. They are no longer the
--   sole definition of "resolved".
--
-- Deterministic backfill:
--   Existing owner-resolved claims (client XOR lead already set) get a profile
--   created from that explicit identity. No fuzzy inference.
--
-- Untouched:
--   submit_portal_request, migrations 128/129 SQL bodies, portal attribution,
--   invoices/payments/QuickBooks.
-- =============================================================================

BEGIN;

-- ── 1. referral_profiles ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.referral_profiles (
  id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID         NOT NULL
                          REFERENCES public.organizations(id) ON DELETE RESTRICT,
  display_name            TEXT         NOT NULL,
  normalized_name         TEXT         NOT NULL,
  linked_client_id        UUID         REFERENCES public.clients(id)      ON DELETE RESTRICT,
  linked_hunter_lead_id   UUID         REFERENCES public.hunter_leads(id) ON DELETE RESTRICT,
  created_by              UUID         REFERENCES auth.users(id)          ON DELETE SET NULL,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT referral_profiles_display_nonempty CHECK (trim(display_name) != ''),
  CONSTRAINT referral_profiles_display_maxlen   CHECK (char_length(display_name) <= 200),
  CONSTRAINT referral_profiles_normalized_nonempty CHECK (trim(normalized_name) != ''),
  CONSTRAINT referral_profiles_link_mutex CHECK (
    NOT (linked_client_id IS NOT NULL AND linked_hunter_lead_id IS NOT NULL)
  )
);

COMMENT ON TABLE public.referral_profiles IS
  'LEAD-SRC-4I: Private canonical referrer identity. May exist without a Client or '
  'Hunter Lead. Owner-created; never public.';

COMMENT ON COLUMN public.referral_profiles.display_name IS
  'Owner-facing referrer name (may differ from raw customer referral text).';
COMMENT ON COLUMN public.referral_profiles.normalized_name IS
  'lower(trim(collapsed-whitespace)) of display_name for private exact matching.';
COMMENT ON COLUMN public.referral_profiles.linked_client_id IS
  'Optional explicit link to clients.id when owner connected this profile to a customer.';
COMMENT ON COLUMN public.referral_profiles.linked_hunter_lead_id IS
  'Optional explicit link to hunter_leads.id when owner connected this profile to a lead.';

CREATE UNIQUE INDEX IF NOT EXISTS referral_profiles_org_linked_client_uniq
  ON public.referral_profiles (organization_id, linked_client_id)
  WHERE linked_client_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS referral_profiles_org_linked_lead_uniq
  ON public.referral_profiles (organization_id, linked_hunter_lead_id)
  WHERE linked_hunter_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_referral_profiles_organization_id
  ON public.referral_profiles (organization_id);

CREATE INDEX IF NOT EXISTS idx_referral_profiles_normalized_name
  ON public.referral_profiles (organization_id, normalized_name);

-- ── 2. RLS for referral_profiles ──────────────────────────────────────────────

ALTER TABLE public.referral_profiles ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.referral_profiles FROM PUBLIC;
REVOKE ALL ON TABLE public.referral_profiles FROM anon;
REVOKE ALL ON TABLE public.referral_profiles FROM authenticated;

CREATE POLICY referral_profiles_owner_admin_select
  ON public.referral_profiles FOR SELECT
  TO authenticated
  USING (
    organization_id = public.user_org_id()
    AND public.is_org_admin_for(organization_id)
  );

CREATE POLICY referral_profiles_owner_admin_insert
  ON public.referral_profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = public.user_org_id()
    AND public.is_org_admin_for(organization_id)
  );

CREATE POLICY referral_profiles_owner_admin_update
  ON public.referral_profiles FOR UPDATE
  TO authenticated
  USING (
    organization_id = public.user_org_id()
    AND public.is_org_admin_for(organization_id)
  )
  WITH CHECK (
    organization_id = public.user_org_id()
    AND public.is_org_admin_for(organization_id)
  );

GRANT SELECT, INSERT, UPDATE ON TABLE public.referral_profiles TO authenticated;

-- ── 3. referral_claims.referral_profile_id ────────────────────────────────────

ALTER TABLE public.referral_claims
  ADD COLUMN IF NOT EXISTS referral_profile_id UUID
    REFERENCES public.referral_profiles(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.referral_claims.referral_profile_id IS
  'LEAD-SRC-4I: Canonical referrer profile for a resolved claim. Raw text stays immutable.';

CREATE INDEX IF NOT EXISTS idx_referral_claims_referral_profile_id
  ON public.referral_claims (referral_profile_id)
  WHERE referral_profile_id IS NOT NULL;

-- ── 4. Deterministic backfill from already-owner-resolved claims ──────────────
-- Only claims with an explicit resolved_client_id XOR resolved_lead_id.

-- 4a. Profiles from explicitly resolved clients
INSERT INTO public.referral_profiles (
  organization_id, display_name, normalized_name,
  linked_client_id, created_by, created_at, updated_at
)
SELECT
  s.organization_id,
  s.display_name,
  s.normalized_name,
  s.linked_client_id,
  s.created_by,
  s.created_at,
  s.updated_at
FROM (
  SELECT DISTINCT ON (rc.organization_id, rc.resolved_client_id)
    rc.organization_id,
    c.name AS display_name,
    lower(trim(regexp_replace(c.name, '\s+', ' ', 'g'))) AS normalized_name,
    c.id AS linked_client_id,
    rc.resolved_by AS created_by,
    coalesce(rc.resolved_at, now()) AS created_at,
    now() AS updated_at
  FROM public.referral_claims rc
  JOIN public.clients c ON c.id = rc.resolved_client_id
  WHERE rc.resolution_status = 'resolved'
    AND rc.resolved_client_id IS NOT NULL
    AND rc.resolved_lead_id IS NULL
    AND rc.referral_profile_id IS NULL
  ORDER BY rc.organization_id, rc.resolved_client_id, rc.resolved_at NULLS LAST
) s
WHERE NOT EXISTS (
  SELECT 1 FROM public.referral_profiles rp
  WHERE rp.organization_id = s.organization_id
    AND rp.linked_client_id = s.linked_client_id
);

-- 4b. Profiles from explicitly resolved hunter leads
INSERT INTO public.referral_profiles (
  organization_id, display_name, normalized_name,
  linked_hunter_lead_id, created_by, created_at, updated_at
)
SELECT
  s.organization_id,
  s.display_name,
  s.normalized_name,
  s.linked_hunter_lead_id,
  s.created_by,
  s.created_at,
  s.updated_at
FROM (
  SELECT DISTINCT ON (rc.organization_id, rc.resolved_lead_id)
    rc.organization_id,
    coalesce(nullif(trim(hl.contact_name), ''), 'Unknown referrer') AS display_name,
    lower(trim(regexp_replace(
      coalesce(nullif(trim(hl.contact_name), ''), 'Unknown referrer'),
      '\s+', ' ', 'g'
    ))) AS normalized_name,
    hl.id AS linked_hunter_lead_id,
    rc.resolved_by AS created_by,
    coalesce(rc.resolved_at, now()) AS created_at,
    now() AS updated_at
  FROM public.referral_claims rc
  JOIN public.hunter_leads hl ON hl.id = rc.resolved_lead_id
  WHERE rc.resolution_status = 'resolved'
    AND rc.resolved_lead_id IS NOT NULL
    AND rc.resolved_client_id IS NULL
    AND rc.referral_profile_id IS NULL
  ORDER BY rc.organization_id, rc.resolved_lead_id, rc.resolved_at NULLS LAST
) s
WHERE NOT EXISTS (
  SELECT 1 FROM public.referral_profiles rp
  WHERE rp.organization_id = s.organization_id
    AND rp.linked_hunter_lead_id = s.linked_hunter_lead_id
);

-- 4c. Attach claims to backfilled profiles (client path)
UPDATE public.referral_claims rc
SET
  referral_profile_id = rp.id,
  updated_at = now()
FROM public.referral_profiles rp
WHERE rc.resolution_status = 'resolved'
  AND rc.resolved_client_id IS NOT NULL
  AND rc.referral_profile_id IS NULL
  AND rp.organization_id = rc.organization_id
  AND rp.linked_client_id = rc.resolved_client_id;

-- 4d. Attach claims to backfilled profiles (lead path)
UPDATE public.referral_claims rc
SET
  referral_profile_id = rp.id,
  updated_at = now()
FROM public.referral_profiles rp
WHERE rc.resolution_status = 'resolved'
  AND rc.resolved_lead_id IS NOT NULL
  AND rc.referral_profile_id IS NULL
  AND rp.organization_id = rc.organization_id
  AND rp.linked_hunter_lead_id = rc.resolved_lead_id;

-- ── 5. Evolve resolution consistency constraint ───────────────────────────────

ALTER TABLE public.referral_claims
  DROP CONSTRAINT IF EXISTS referral_claims_resolution_consistency;

ALTER TABLE public.referral_claims
  ADD CONSTRAINT referral_claims_resolution_consistency CHECK (
    CASE resolution_status
      WHEN 'resolved' THEN
        referral_profile_id IS NOT NULL
        AND NOT (
          resolved_client_id IS NOT NULL
          AND resolved_lead_id IS NOT NULL
        )
      ELSE
        referral_profile_id IS NULL
        AND resolved_client_id IS NULL
        AND resolved_lead_id IS NULL
    END
  );

COMMENT ON COLUMN public.referral_claims.resolution_status IS
  'unresolved: no owner action. ambiguous: owner flagged unclear. '
  'confirmed_unlinked: valid referral, no profile yet. '
  'resolved: assigned to exactly one referral_profile.';

COMMENT ON COLUMN public.referral_claims.resolved_client_id IS
  'Optional compatibility mirror when the linked profile is tied to a client. '
  'Canonical authority is referral_profile_id.';
COMMENT ON COLUMN public.referral_claims.resolved_lead_id IS
  'Optional compatibility mirror when the linked profile is tied to a hunter lead. '
  'Canonical authority is referral_profile_id.';

-- ── 6. Postconditions ─────────────────────────────────────────────────────────

DO $$
DECLARE
  v_profiles_exist          boolean;
  v_profiles_rls            boolean;
  v_col_exists              boolean;
  v_consistency_def         text;
  v_orphan_resolved         integer;
  v_client_fk               char;
  v_lead_fk                 char;
  v_profile_fk              char;
  v_anon_select             boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'referral_profiles'
  ) INTO v_profiles_exist;
  IF NOT v_profiles_exist THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: referral_profiles missing';
  END IF;

  SELECT relrowsecurity INTO v_profiles_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'referral_profiles';
  IF NOT v_profiles_rls THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: RLS not enabled on referral_profiles';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'referral_claims'
      AND column_name = 'referral_profile_id'
  ) INTO v_col_exists;
  IF NOT v_col_exists THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: referral_claims.referral_profile_id missing';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_consistency_def
  FROM pg_constraint
  WHERE conname = 'referral_claims_resolution_consistency'
    AND conrelid = 'public.referral_claims'::regclass;
  IF v_consistency_def IS NULL OR v_consistency_def NOT LIKE '%referral_profile_id%' THEN
    RAISE EXCEPTION
      'POSTCONDITION FAILED: resolution_consistency must reference referral_profile_id: %',
      v_consistency_def;
  END IF;

  SELECT count(*) INTO v_orphan_resolved
  FROM public.referral_claims
  WHERE resolution_status = 'resolved'
    AND referral_profile_id IS NULL;
  IF v_orphan_resolved > 0 THEN
    RAISE EXCEPTION
      'POSTCONDITION FAILED: % resolved claims lack referral_profile_id',
      v_orphan_resolved;
  END IF;

  SELECT confdeltype INTO v_client_fk
  FROM pg_constraint
  WHERE conname = 'referral_claims_resolved_client_id_fkey'
    AND conrelid = 'public.referral_claims'::regclass;
  IF v_client_fk IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: resolved_client_id FK must remain RESTRICT';
  END IF;

  SELECT confdeltype INTO v_lead_fk
  FROM pg_constraint
  WHERE conname = 'referral_claims_resolved_lead_id_fkey'
    AND conrelid = 'public.referral_claims'::regclass;
  IF v_lead_fk IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: resolved_lead_id FK must remain RESTRICT';
  END IF;

  SELECT confdeltype INTO v_profile_fk
  FROM pg_constraint
  WHERE conname = 'referral_claims_referral_profile_id_fkey'
    AND conrelid = 'public.referral_claims'::regclass;
  IF v_profile_fk IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: referral_profile_id FK must be RESTRICT';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'referral_profiles'
      AND grantee = 'anon'
      AND privilege_type = 'SELECT'
  ) INTO v_anon_select;
  IF v_anon_select THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: anon must not SELECT referral_profiles';
  END IF;
END $$;

COMMIT;
