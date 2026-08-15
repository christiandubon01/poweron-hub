-- =============================================================================
-- Migration 126: Explicit organization → Hunter tenant authority
-- LEAD-SRC-2F
-- =============================================================================
-- Adds organizations.hunter_tenant_id as the canonical org→Hunter tenant map.
-- Backfills ONLY from bidirectional-safe historical portal conversion evidence.
-- Does NOT rewrite leads, settings, receipts, or user_tenants memberships.
-- Does NOT apply identity heuristics (owner columns, names, addresses, row order).
-- =============================================================================

BEGIN;

-- ── 1. Schema ────────────────────────────────────────────────────────────────

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS hunter_tenant_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'organizations_hunter_tenant_id_fkey'
      AND conrelid = 'public.organizations'::regclass
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_hunter_tenant_id_fkey
      FOREIGN KEY (hunter_tenant_id)
      REFERENCES public.tenants(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS organizations_hunter_tenant_id_uidx
  ON public.organizations (hunter_tenant_id)
  WHERE hunter_tenant_id IS NOT NULL;

COMMENT ON COLUMN public.organizations.hunter_tenant_id IS
  'LEAD-SRC-2F: canonical Hunter tenant for this organization. NULL = unmapped (fail closed).';

-- ── 2. Safe historical backfill (bidirectional 1:1 only) ─────────────────────
-- Evidence path:
--   portal_requests.organization_id
--   → portal_requests.hunter_lead_id
--   → hunter_leads.id
--   → hunter_leads.tenant_id
--
-- Auto-map only when:
--   A. organization has exactly ONE distinct historical tenant_id
--   B. that tenant_id has exactly ONE distinct historical organization_id
-- Otherwise leave NULL.

WITH evidence AS (
  SELECT DISTINCT
    pr.organization_id,
    hl.tenant_id
  FROM public.portal_requests pr
  INNER JOIN public.hunter_leads hl
    ON hl.id = pr.hunter_lead_id
  WHERE pr.hunter_lead_id IS NOT NULL
    AND pr.organization_id IS NOT NULL
    AND hl.tenant_id IS NOT NULL
),
org_tenant_counts AS (
  SELECT
    organization_id,
    COUNT(DISTINCT tenant_id) AS tenant_count
  FROM evidence
  GROUP BY organization_id
),
tenant_org_counts AS (
  SELECT
    tenant_id,
    COUNT(DISTINCT organization_id) AS org_count
  FROM evidence
  GROUP BY tenant_id
),
eligible AS (
  SELECT
    e.organization_id,
    e.tenant_id
  FROM evidence e
  INNER JOIN org_tenant_counts otc
    ON otc.organization_id = e.organization_id
   AND otc.tenant_count = 1
  INNER JOIN tenant_org_counts toc
    ON toc.tenant_id = e.tenant_id
   AND toc.org_count = 1
)
UPDATE public.organizations o
SET hunter_tenant_id = e.tenant_id
FROM eligible e
WHERE o.id = e.organization_id
  AND o.hunter_tenant_id IS NULL;

-- ── 3. Postconditions ────────────────────────────────────────────────────────

DO $$
DECLARE
  v_has_column boolean;
  v_has_fk boolean;
  v_has_uidx boolean;
  v_ambiguous_org_mapped integer;
  v_shared_tenant_mapped integer;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organizations'
      AND column_name = 'hunter_tenant_id'
      AND data_type = 'uuid'
  ) INTO v_has_column;

  IF NOT v_has_column THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: organizations.hunter_tenant_id missing';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'organizations_hunter_tenant_id_fkey'
      AND conrelid = 'public.organizations'::regclass
  ) INTO v_has_fk;

  IF NOT v_has_fk THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: organizations_hunter_tenant_id_fkey missing';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'organizations_hunter_tenant_id_uidx'
      AND c.relkind = 'i'
  ) INTO v_has_uidx;

  IF NOT v_has_uidx THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: organizations_hunter_tenant_id_uidx missing';
  END IF;

  -- No org with >1 historical tenants may be auto-mapped.
  SELECT COUNT(*) INTO v_ambiguous_org_mapped
  FROM public.organizations o
  WHERE o.hunter_tenant_id IS NOT NULL
    AND (
      SELECT COUNT(DISTINCT hl.tenant_id)
      FROM public.portal_requests pr
      INNER JOIN public.hunter_leads hl ON hl.id = pr.hunter_lead_id
      WHERE pr.organization_id = o.id
        AND pr.hunter_lead_id IS NOT NULL
        AND hl.tenant_id IS NOT NULL
    ) > 1;

  IF v_ambiguous_org_mapped > 0 THEN
    RAISE EXCEPTION
      'POSTCONDITION FAILED: % ambiguous org(s) were auto-mapped',
      v_ambiguous_org_mapped;
  END IF;

  -- No tenant historically shared by >1 orgs may be auto-mapped onto any org.
  SELECT COUNT(*) INTO v_shared_tenant_mapped
  FROM public.organizations o
  WHERE o.hunter_tenant_id IS NOT NULL
    AND (
      SELECT COUNT(DISTINCT pr.organization_id)
      FROM public.portal_requests pr
      INNER JOIN public.hunter_leads hl ON hl.id = pr.hunter_lead_id
      WHERE hl.tenant_id = o.hunter_tenant_id
        AND pr.hunter_lead_id IS NOT NULL
        AND pr.organization_id IS NOT NULL
    ) > 1;

  IF v_shared_tenant_mapped > 0 THEN
    RAISE EXCEPTION
      'POSTCONDITION FAILED: % org(s) mapped to historically shared tenant(s)',
      v_shared_tenant_mapped;
  END IF;
END $$;

COMMIT;
