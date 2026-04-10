-- ============================================================
-- Migration 055: GUARDIAN Tables
-- GUARDIAN is the compliance and protection agent for
-- Power On Solutions LLC (C-10 #1151468).
-- Creates 6 tables + RLS policies for the full intelligence loop.
-- ============================================================

-- ─── 1. guardian_alerts ─────────────────────────────────────
-- Stores every flagged event and its 5-step intelligence output.
CREATE TABLE IF NOT EXISTS guardian_alerts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id            UUID,
  worker_id             UUID,

  -- Classification
  alert_type            TEXT NOT NULL CHECK (alert_type IN (
                          'scope_change',
                          'rfi_undocumented',
                          'solo_work',
                          'precondition_missing',
                          'boundary_violation',
                          'cslb_exposure'
                        )),
  severity              TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),

  -- 5-Step Intelligence Loop output
  flag                  TEXT,           -- Step 1: what happened, timestamped
  impact_analysis       TEXT,           -- Step 2: legal/financial/operational exposure
  corrective_action     TEXT,           -- Step 3: exact opposite action needed
  employee_documentation TEXT,          -- Step 4: record entry + required conversation
  prevention_rule       TEXT,           -- Step 5: permanent system rule to prevent recurrence

  -- Lifecycle
  status                TEXT NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open', 'acknowledged', 'resolved')),
  acknowledged_by       UUID,
  resolved_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE guardian_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "guardian_alerts_owner"
  ON guardian_alerts
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── 2. guardian_checklists ──────────────────────────────────
-- Pre-job, daily field log, owner walkthrough, and solo-safety checklists.
CREATE TABLE IF NOT EXISTS guardian_checklists (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id      UUID,

  checklist_type  TEXT NOT NULL CHECK (checklist_type IN (
                    'pre_job',
                    'daily_field_log',
                    'owner_walkthrough',
                    'solo_safety'
                  )),

  -- Array of { label, completed, photo_url, notes, completed_at }
  items           JSONB NOT NULL DEFAULT '[]'::jsonb,

  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'complete', 'incomplete')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

ALTER TABLE guardian_checklists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "guardian_checklists_owner"
  ON guardian_checklists
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── 3. guardian_rfis ────────────────────────────────────────
-- Tracks undocumented RFIs, NEC references, and auto-follow-up state.
CREATE TABLE IF NOT EXISTS guardian_rfis (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id                UUID,

  permit_number             TEXT,
  nec_reference             TEXT,
  conflict_description      TEXT NOT NULL,
  corrective_action_required TEXT,
  responsible_party         TEXT,

  -- Response tracking
  response_deadline         TIMESTAMPTZ,
  response_received         TEXT,
  response_date             TIMESTAMPTZ,

  status                    TEXT NOT NULL DEFAULT 'sent'
                              CHECK (status IN ('sent', 'awaiting', 'responded', 'overdue')),
  sent_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  auto_followup_sent        BOOLEAN NOT NULL DEFAULT false
);

ALTER TABLE guardian_rfis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "guardian_rfis_owner"
  ON guardian_rfis
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── 4. guardian_change_orders ───────────────────────────────
-- Documents every scope change with cost + timeline impact and approval state.
CREATE TABLE IF NOT EXISTS guardian_change_orders (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id           UUID,

  original_scope       TEXT NOT NULL,
  change_description   TEXT NOT NULL,
  change_reason        TEXT,
  cost_impact          NUMERIC(12, 2),
  timeline_impact      TEXT,
  requested_by         TEXT,

  -- Approval
  approved             BOOLEAN NOT NULL DEFAULT false,
  approved_at          TIMESTAMPTZ,
  signed_document_url  TEXT,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE guardian_change_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "guardian_change_orders_owner"
  ON guardian_change_orders
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── 5. guardian_violations ──────────────────────────────────
-- Worker permission-tier violations with corrective conversation log.
CREATE TABLE IF NOT EXISTS guardian_violations (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  worker_id                UUID,
  project_id               UUID,

  violation_type           TEXT NOT NULL CHECK (violation_type IN (
                             'scope_authority',
                             'material_sub',
                             'schedule_change',
                             'safety'
                           )),
  tier_crossed             TEXT CHECK (tier_crossed IN (
                             'tier1_to_tier2',
                             'tier1_to_tier3',
                             'tier2_to_tier3'
                           )),

  description              TEXT NOT NULL,
  impact                   TEXT,
  corrective_conversation  TEXT,
  rule_established         TEXT,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE guardian_violations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "guardian_violations_owner"
  ON guardian_violations
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── 6. guardian_rules ───────────────────────────────────────
-- Permanent prevention rules generated by the 5-step loop (Step 5 output).
CREATE TABLE IF NOT EXISTS guardian_rules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  rule_text        TEXT NOT NULL,
  source_alert_id  UUID REFERENCES guardian_alerts(id) ON DELETE SET NULL,
  category         TEXT,

  status           TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'archived')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE guardian_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "guardian_rules_owner"
  ON guardian_rules
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── Indexes for common query patterns ───────────────────────
CREATE INDEX IF NOT EXISTS idx_guardian_alerts_user_status
  ON guardian_alerts (user_id, status, severity);

CREATE INDEX IF NOT EXISTS idx_guardian_alerts_project
  ON guardian_alerts (project_id);

CREATE INDEX IF NOT EXISTS idx_guardian_checklists_user_project
  ON guardian_checklists (user_id, project_id);

CREATE INDEX IF NOT EXISTS idx_guardian_rfis_user_status
  ON guardian_rfis (user_id, status);

CREATE INDEX IF NOT EXISTS idx_guardian_change_orders_project
  ON guardian_change_orders (project_id);

CREATE INDEX IF NOT EXISTS idx_guardian_violations_worker
  ON guardian_violations (worker_id);

CREATE INDEX IF NOT EXISTS idx_guardian_rules_user_status
  ON guardian_rules (user_id, status);
