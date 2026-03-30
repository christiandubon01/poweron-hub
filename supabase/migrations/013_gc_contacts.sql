-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 013: GC Relationship & Lead Database
-- Migrates the gcContacts[] array from the Operations Hub into a proper
-- relational table for tracking General Contractor relationships, bidding
-- history, payment behavior, and pipeline status.
--
-- DEPENDS ON: 002 (organizations, profiles)
-- ══════════════════════════════════════════════════════════════════════════════


CREATE TABLE gc_contacts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Company info
  company         TEXT NOT NULL,
  contact_name    TEXT,                          -- primary contact person
  role            TEXT,                          -- Owner, GC, PM, Superintendent, Solar Sales, etc.
  phone           TEXT,
  email           TEXT,
  website         TEXT,
  address         JSONB,                         -- {street, city, state, zip}

  -- Relationship origin
  intro_source    TEXT CHECK (intro_source IN (
    'referral','on_site','cold_call','website','trade_show',
    'plan_room','subcontractor_list','repeat','other'
  )),
  intro_details   TEXT,                          -- "Met at Riverside job site", etc.

  -- Pipeline status
  pipeline_phase  TEXT NOT NULL DEFAULT 'prospecting'
    CHECK (pipeline_phase IN (
      'prospecting','qualified','active_bidding','awarded',
      'completed','on_hold','lost','disqualified'
    )),

  -- Bidding & award history
  bids_sent       INT NOT NULL DEFAULT 0,
  bids_awarded    INT NOT NULL DEFAULT 0,
  win_rate        NUMERIC(5,2) GENERATED ALWAYS AS (
    CASE WHEN bids_sent > 0
      THEN ROUND((bids_awarded::NUMERIC / bids_sent) * 100, 2)
      ELSE 0
    END
  ) STORED,
  avg_job_value   NUMERIC(12,2) DEFAULT 0,
  total_revenue   NUMERIC(14,2) DEFAULT 0,       -- lifetime revenue from this GC

  -- Payment behavior
  payment_terms   TEXT DEFAULT 'unknown'
    CHECK (payment_terms IN (
      'net_15','net_30','net_45','net_60','net_90',
      'upon_completion','progress','unknown'
    )),
  payment_rating  TEXT DEFAULT 'unknown'
    CHECK (payment_rating IN ('fast','normal','slow','problem','unknown')),

  -- Fit score (1.0–5.0 — how good a fit for your business)
  fit_score       NUMERIC(3,1) DEFAULT 3.0
    CHECK (fit_score >= 1.0 AND fit_score <= 5.0),

  -- Follow-up
  next_action     TEXT,                          -- "Send Riverside bid", "Follow up on payment"
  next_action_due DATE,
  last_contact_at TIMESTAMPTZ,

  -- Notes
  notes           TEXT,
  tags            TEXT[],                        -- ['residential','commercial','solar','reliable']

  -- Weekly review tracking
  last_reviewed_at TIMESTAMPTZ,
  review_notes    TEXT,

  -- Metadata
  metadata        JSONB DEFAULT '{}',
  created_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_gcc_org          ON gc_contacts(org_id);
CREATE INDEX idx_gcc_pipeline     ON gc_contacts(org_id, pipeline_phase);
CREATE INDEX idx_gcc_company      ON gc_contacts(org_id, company);
CREATE INDEX idx_gcc_fit          ON gc_contacts(org_id, fit_score DESC);
CREATE INDEX idx_gcc_action_due   ON gc_contacts(next_action_due)
  WHERE next_action_due IS NOT NULL AND pipeline_phase NOT IN ('lost','disqualified');
CREATE INDEX idx_gcc_payment      ON gc_contacts(org_id, payment_rating);
CREATE INDEX idx_gcc_tags         ON gc_contacts USING GIN(tags);

CREATE TRIGGER mdt_gc_contacts
  BEFORE UPDATE ON gc_contacts
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TRIGGER audit_gc_contacts
  AFTER INSERT OR UPDATE OR DELETE ON gc_contacts
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();


-- ══════════════════════════════════
-- GC ACTIVITY LOG
-- Tracks individual interactions with GC contacts over time
-- (bids sent, meetings, payments received, issues, etc.)
-- ══════════════════════════════════
CREATE TABLE gc_activity_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gc_contact_id   UUID NOT NULL REFERENCES gc_contacts(id) ON DELETE CASCADE,
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      UUID REFERENCES projects(id) ON DELETE SET NULL,

  activity_type   TEXT NOT NULL CHECK (activity_type IN (
    'bid_sent','bid_awarded','bid_lost','meeting','phone_call',
    'email','payment_received','payment_issue','site_visit',
    'contract_signed','punch_list','closeout','note'
  )),

  description     TEXT,
  amount          NUMERIC(12,2),                 -- for bid/payment activities
  logged_by       UUID REFERENCES profiles(id) ON DELETE SET NULL,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_gcal_contact  ON gc_activity_log(gc_contact_id);
CREATE INDEX idx_gcal_org      ON gc_activity_log(org_id);
CREATE INDEX idx_gcal_project  ON gc_activity_log(project_id);
CREATE INDEX idx_gcal_type     ON gc_activity_log(activity_type);
CREATE INDEX idx_gcal_created  ON gc_activity_log(gc_contact_id, created_at DESC);

CREATE TRIGGER audit_gc_activity_log
  AFTER INSERT OR UPDATE OR DELETE ON gc_activity_log
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();
