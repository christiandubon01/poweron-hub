-- =============================================================================
-- Migration 070: TLMA Scraper Schema
-- =============================================================================
-- Purpose: Add columns to hunter_leads to support permit-based leads from
-- Riverside County TLMA, plus a new hunter_lead_revisions table to track
-- changes over time (status transitions, sqft updates, contact updates, etc.)
--
-- Applied: 2026-04-25
-- Author: Christian Dubon / HUNTER Phase 1 sprint
-- =============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Extend hunter_leads with TLMA-specific columns
-- ----------------------------------------------------------------------------
-- All new columns are nullable so existing rows (manual leads, referrals, etc.)
-- continue to work without modification. Only TLMA-sourced leads will populate
-- these fields.

ALTER TABLE public.hunter_leads
  ADD COLUMN IF NOT EXISTS permit_number      text,
  ADD COLUMN IF NOT EXISTS permit_url         text,
  ADD COLUMN IF NOT EXISTS permit_type_code   text,
  ADD COLUMN IF NOT EXISTS permit_type_label  text,
  ADD COLUMN IF NOT EXISTS work_class_code    text,
  ADD COLUMN IF NOT EXISTS permit_status      text,
  ADD COLUMN IF NOT EXISTS total_sqft         integer,
  ADD COLUMN IF NOT EXISTS sqft_breakdown     jsonb,
  ADD COLUMN IF NOT EXISTS applied_date       date,
  ADD COLUMN IF NOT EXISTS issued_date        date,
  ADD COLUMN IF NOT EXISTS finalized_date     date,
  ADD COLUMN IF NOT EXISTS expired_date       date,
  ADD COLUMN IF NOT EXISTS contact_company    text,
  ADD COLUMN IF NOT EXISTS contact_type_label text,
  ADD COLUMN IF NOT EXISTS last_seen_at       timestamptz,
  ADD COLUMN IF NOT EXISTS revision_count     integer NOT NULL DEFAULT 0;

-- Unique index for dedup: (tenant_id, permit_number) where permit_number is set.
-- Partial index — only enforces uniqueness when permit_number is non-null,
-- so manually-entered leads (with NULL permit_number) don't conflict.
CREATE UNIQUE INDEX IF NOT EXISTS hunter_leads_tenant_permit_uniq
  ON public.hunter_leads (tenant_id, permit_number)
  WHERE permit_number IS NOT NULL;

-- Performance index for filter queries on permit type.
CREATE INDEX IF NOT EXISTS hunter_leads_permit_type_idx
  ON public.hunter_leads (tenant_id, permit_type_code)
  WHERE permit_type_code IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. New table: hunter_lead_revisions
-- ----------------------------------------------------------------------------
-- Append-only audit log of every field change detected by the scraper.
-- Each row = one field that changed on one lead at one point in time.
-- Old/new values stored as text for simplicity (cast on display).

CREATE TABLE IF NOT EXISTS public.hunter_lead_revisions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lead_id      uuid NOT NULL REFERENCES public.hunter_leads(id) ON DELETE CASCADE,
  detected_at  timestamptz NOT NULL DEFAULT NOW(),
  field_name   text NOT NULL,
  old_value    text,
  new_value    text,
  source       text NOT NULL DEFAULT 'tlma_scraper',

  CONSTRAINT hunter_lead_revisions_field_check CHECK (field_name IN (
    'permit_status',
    'total_sqft',
    'issued_date',
    'finalized_date',
    'expired_date',
    'description',
    'contact_name',
    'contact_company',
    'contact_phone',
    'contact_email',
    'work_class_code',
    'sqft_breakdown',
    'estimated_value'
  ))
);

COMMENT ON TABLE public.hunter_lead_revisions IS
  'Append-only audit log of changes detected by external scrapers (e.g., TLMA). One row per field-change event. Surfaced in the HUNTER UI as a collapsible Permit History section.';

-- Index for fast history retrieval by lead, newest-first.
CREATE INDEX IF NOT EXISTS hunter_lead_revisions_lead_idx
  ON public.hunter_lead_revisions (lead_id, detected_at DESC);

-- Index for tenant-scoped queries (admin/audit use cases).
CREATE INDEX IF NOT EXISTS hunter_lead_revisions_tenant_idx
  ON public.hunter_lead_revisions (tenant_id, detected_at DESC);

-- ----------------------------------------------------------------------------
-- 3. RLS on hunter_lead_revisions
-- ----------------------------------------------------------------------------
-- Mirror the hunter_leads policy pattern: tenant-scoped via user_tenants.

ALTER TABLE public.hunter_lead_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY hunter_lead_revisions_tenant_isolation
  ON public.hunter_lead_revisions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_tenants
      WHERE user_tenants.user_id = auth.uid()
        AND user_tenants.tenant_id = hunter_lead_revisions.tenant_id
    )
  );

COMMIT;

-- =============================================================================
-- VERIFICATION QUERIES — run these after applying to confirm success
-- =============================================================================
-- After running the migration above, run these to verify:
--
-- 1) Confirm new columns on hunter_leads:
--    SELECT column_name, data_type, is_nullable
--    FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'hunter_leads'
--      AND column_name IN ('permit_number','permit_url','permit_type_code',
--          'permit_type_label','work_class_code','permit_status','total_sqft',
--          'sqft_breakdown','applied_date','issued_date','finalized_date',
--          'expired_date','contact_company','contact_type_label',
--          'last_seen_at','revision_count')
--    ORDER BY column_name;
--    Expected: 16 rows
--
-- 2) Confirm new table exists:
--    SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public' AND table_name = 'hunter_lead_revisions';
--    Expected: 1 row
--
-- 3) Confirm RLS is on the new table:
--    SELECT schemaname, tablename, rowsecurity
--    FROM pg_tables WHERE tablename = 'hunter_lead_revisions';
--    Expected: rowsecurity = true
--
-- 4) Confirm indexes:
--    SELECT indexname FROM pg_indexes
--    WHERE tablename IN ('hunter_leads','hunter_lead_revisions')
--      AND indexname LIKE '%permit%' OR indexname LIKE '%revisions%';
--    Expected: hunter_leads_tenant_permit_uniq, hunter_leads_permit_type_idx,
--              hunter_lead_revisions_lead_idx, hunter_lead_revisions_tenant_idx
