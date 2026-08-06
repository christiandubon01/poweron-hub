-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 116: Sales Intelligence Conversion Receipts — SALES-CONVERSION-1
-- ════════════════════════════════════════════════════════════════════════════════
--
-- Purpose: durable, append-only tickets proving that a Sales Intelligence
-- Pipeline lead produced a real destination record (a Project or a Service
-- Call). A lead may only leave the active Pipeline after its receipt is
-- persisted.
--
-- Why a new table (audit of existing candidates):
--   hunter_debriefs        — won/lost narrative + lessons. No destination id.
--   hunter_lead_revisions  — scraper field-change diffs. No destination id.
--   hunter_leads.disposition / disposition_detail / disposition_at (mig 076)
--                          — a single overwritable free-text field on the lead
--                            itself. Destroyed when the lead is edited or
--                            deleted, holds no destination record id, and
--                            cannot carry an idempotency constraint.
--   projects.convertedFromLeadId / serviceEstimates.hunterLeadId
--                          — real lineage, but they live inside the BackupData
--                            JSONB document, not in Postgres, so they cannot be
--                            queried, filtered, or RLS-protected as a ledger.
--   None of these can satisfy the receipt contract, so a focused table is added.
--
-- Tenant model: hunter_leads and hunter_lead_revisions scope by tenant_id via
-- public.user_tenants. Receipts follow that exact pattern so they land in the
-- same tenant the leads came from.
--
-- Destination ids are TEXT, not UUID FKs: Projects ('proj…') and Service
-- Estimates ('est…') are BackupData JSONB records with app-generated string
-- ids. See migration 101 for the same identity-compat situation.
--
-- Migration number safety:
--   112 reserved (Solar, uncommitted). 113/114 applied. 115 is a parallel
--   agent's service-call assignment migration. 116 is the next unused number.
--
-- Does NOT modify: hunter_leads, hunter_debriefs, hunter_lead_revisions,
-- portal_requests, profiles, employee_profiles, or any existing RLS policy.
-- ════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Human-readable receipt numbers ────────────────────────────────────────────
-- App convention elsewhere is PREFIX-#### (see invoice_number 'INV-0001').
-- A sequence keeps numbering monotonic and gap-tolerant under concurrency.

CREATE SEQUENCE IF NOT EXISTS public.hunter_conversion_receipt_number_seq;

-- ── hunter_conversion_receipts ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.hunter_conversion_receipts (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- Nullable ON DELETE SET NULL: deleting the originating lead must never
  -- destroy the receipt. The snapshot columns below keep it meaningful.
  lead_id                  UUID REFERENCES public.hunter_leads(id) ON DELETE SET NULL,

  receipt_seq              BIGINT NOT NULL
                             DEFAULT nextval('public.hunter_conversion_receipt_number_seq'),
  receipt_number           TEXT GENERATED ALWAYS AS
                             ('CR-' || lpad(receipt_seq::text, 6, '0')) STORED,

  -- ── Historical snapshot (frozen at conversion time) ────────────────────────
  -- Deliberately minimal: identity and attribution only. Phone, email, and
  -- street address are NOT duplicated here — they stay on hunter_leads.
  lead_name                TEXT NOT NULL,
  lead_company             TEXT,
  lead_contact_name        TEXT,
  lead_estimated_value     NUMERIC(12, 2),
  lead_score_at_conversion INTEGER,
  lead_status_before       TEXT,

  -- ── Source model: channel and location stay separate ───────────────────────
  source_family            TEXT NOT NULL,   -- 'TLMA', 'Customer Portal', 'Manual', …
  source_detail            TEXT,            -- 'Indio', 'Palm Desert', feed/form name
  source_raw               TEXT,            -- untouched source/source_tag/source_city

  -- ── Destination (must already exist when the row is written) ───────────────
  destination_type         TEXT NOT NULL
                             CHECK (destination_type IN ('project', 'service_call')),
  destination_id           TEXT NOT NULL CHECK (btrim(destination_id) <> ''),
  destination_label        TEXT,
  -- Only set when the destination exposes a canonical amount (project
  -- contract). A service estimate's quote is a quote, so it stays NULL rather
  -- than being fabricated into a converted value.
  converted_value          NUMERIC(12, 2),

  converted_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  converted_by             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  converted_by_name        TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT hunter_conversion_receipts_lead_name_len
    CHECK (char_length(lead_name) BETWEEN 1 AND 300),
  CONSTRAINT hunter_conversion_receipts_source_family_len
    CHECK (char_length(source_family) BETWEEN 1 AND 120),
  CONSTRAINT hunter_conversion_receipts_score_range
    CHECK (lead_score_at_conversion IS NULL
           OR lead_score_at_conversion BETWEEN 0 AND 100)
);

COMMENT ON TABLE public.hunter_conversion_receipts IS
  'SALES-CONVERSION-1: append-only conversion tickets. One row per '
  '(tenant, lead, destination_type, destination_id). Written only after the '
  'destination record exists; the lead leaves the active Pipeline afterwards.';

-- ── Idempotency ───────────────────────────────────────────────────────────────
-- The durable uniqueness rule. Double-clicks, React rerenders, network
-- retries, and repeated status updates all collapse onto one row. A lead that
-- genuinely produces two different destination records gets two receipts.
--
-- A partial index is used because lead_id becomes NULL after the lead is
-- deleted, and NULLs would otherwise silently defeat the constraint. Dedup
-- only ever matters while the lead still exists, which is insert time.

CREATE UNIQUE INDEX IF NOT EXISTS hunter_conversion_receipts_idempotency_idx
  ON public.hunter_conversion_receipts (tenant_id, lead_id, destination_type, destination_id)
  WHERE lead_id IS NOT NULL;

-- ── Query indexes ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS hunter_conversion_receipts_tenant_date_idx
  ON public.hunter_conversion_receipts (tenant_id, converted_at DESC);

CREATE INDEX IF NOT EXISTS hunter_conversion_receipts_source_idx
  ON public.hunter_conversion_receipts (tenant_id, source_family, source_detail);

CREATE INDEX IF NOT EXISTS hunter_conversion_receipts_type_idx
  ON public.hunter_conversion_receipts (tenant_id, destination_type);

CREATE INDEX IF NOT EXISTS hunter_conversion_receipts_destination_idx
  ON public.hunter_conversion_receipts (destination_type, destination_id);

CREATE INDEX IF NOT EXISTS hunter_conversion_receipts_lead_idx
  ON public.hunter_conversion_receipts (lead_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Two conditions must BOTH hold:
--   1. tenant membership via user_tenants  → denies every other organization
--   2. profiles.role IN ('owner','admin')  → keeps employee and crew accounts
--                                            out of internal Sales Intelligence
--                                            data by default
-- This mirrors the hunter_lead_revisions tenant pattern (migration 070) and
-- the owner/admin pattern used by migrations 017 / 081. No existing Hunter or
-- Sales Intelligence policy is altered.

ALTER TABLE public.hunter_conversion_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hunter_conversion_receipts_owner_read
  ON public.hunter_conversion_receipts;
CREATE POLICY hunter_conversion_receipts_owner_read
  ON public.hunter_conversion_receipts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_tenants ut
      WHERE ut.user_id = auth.uid()
        AND ut.tenant_id = hunter_conversion_receipts.tenant_id
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('owner', 'admin')
    )
  );

-- The authorized conversion path may create receipts, and only for its own
-- tenant. There is intentionally no UPDATE and no DELETE policy: receipts are
-- append-only, and the repo has no owner-only correction pattern for them.

DROP POLICY IF EXISTS hunter_conversion_receipts_owner_insert
  ON public.hunter_conversion_receipts;
CREATE POLICY hunter_conversion_receipts_owner_insert
  ON public.hunter_conversion_receipts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_tenants ut
      WHERE ut.user_id = auth.uid()
        AND ut.tenant_id = hunter_conversion_receipts.tenant_id
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('owner', 'admin')
    )
  );

REVOKE ALL ON public.hunter_conversion_receipts FROM PUBLIC;
REVOKE ALL ON public.hunter_conversion_receipts FROM anon;
GRANT SELECT, INSERT ON public.hunter_conversion_receipts TO authenticated;
GRANT USAGE ON SEQUENCE public.hunter_conversion_receipt_number_seq TO authenticated;

COMMIT;
