-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 003: Agent System Tables
-- Phase 01 Foundation
--
-- Tables:
--   1. agents              — registry of all 11 agents (seeded in 007)
--   2. agent_proposals     — SCOUT + OHM proposals, MiroFish verification chain
--   3. agent_messages      — inter-agent communication bus (NEXUS delegates via this)
--   4. notifications       — agent → user push/in-app alerts
--
-- Post-creation:
--   - Adds FK agents → compliance_checks.agent_id (was deferred in 002)
--   - Adds moddatetime triggers for updated_at columns
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════
-- 1. AGENTS REGISTRY
-- Seeded with all 11 agents in 007_seed_agents.sql
-- SIGNAL and FRAME are kept as legacy entries to preserve audit trail integrity
-- ══════════════════════════════════
CREATE TABLE agents (
  id              TEXT PRIMARY KEY,       -- 'nexus', 'vault', 'pulse', etc.
  name            TEXT NOT NULL,
  display_name    TEXT NOT NULL,          -- 'NEXUS — Manager Agent'
  domain          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','paused','error','maintenance')),
  config          JSONB NOT NULL DEFAULT '{}',   -- agent-specific runtime configuration
  memory_scope    TEXT[] NOT NULL DEFAULT '{}',  -- table names this agent can read; '*' = all
  last_active_at  TIMESTAMPTZ,
  error_count     INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Note: signal and frame are legacy (merged into blueprint) but kept for audit trail continuity


-- ══════════════════════════════════
-- NOW SAFE: Add agent_id FK to compliance_checks
-- (deferred from 002 because agents table didn't exist yet)
-- ══════════════════════════════════
ALTER TABLE compliance_checks
  ADD CONSTRAINT fk_compliance_agent
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET DEFAULT;


-- ══════════════════════════════════
-- 2. AGENT PROPOSALS (SCOUT + OHM domain)
-- MiroFish 5-step verification chain tracked in mirofish_log
-- ══════════════════════════════════
CREATE TABLE agent_proposals (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  proposing_agent   TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,

  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  category          TEXT CHECK (category IN (
    'nec_compliance','operations','safety','feature','optimization','cost_savings'
  )),
  source_data       JSONB,           -- what pattern/data triggered this proposal

  -- Impact & risk scoring (0.00–1.00)
  impact_score      NUMERIC(3,2),
  risk_score        NUMERIC(3,2),

  status            TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN (
    'proposed','reviewing','confirmed','integrating','completed','skipped','rejected'
  )),

  -- MiroFish 5-step verification chain
  -- Step 0: Proposed  | Step 1: Analyzed | Step 2: Cross-checked
  -- Step 3: Validated | Step 4: Approved  | Step 5: Integrated
  mirofish_step     INT NOT NULL DEFAULT 0 CHECK (mirofish_step BETWEEN 0 AND 5),
  mirofish_log      JSONB NOT NULL DEFAULT '[]',
  -- [{step, agent, action, result, timestamp}]

  confirmed_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  confirmed_at      TIMESTAMPTZ,
  integrated_at     TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_proposals_org    ON agent_proposals(org_id);
CREATE INDEX idx_proposals_agent  ON agent_proposals(proposing_agent);
CREATE INDEX idx_proposals_status ON agent_proposals(org_id, status);
CREATE INDEX idx_proposals_impact ON agent_proposals(org_id, impact_score DESC NULLS LAST);


-- ══════════════════════════════════
-- 3. AGENT MESSAGES (inter-agent communication bus)
-- NEXUS uses this to delegate tasks to sub-agents
-- Agents report results back through this table
-- ══════════════════════════════════
CREATE TABLE agent_messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  from_agent      TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  to_agent        TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,

  type            TEXT NOT NULL CHECK (type IN (
    'delegation','report','alert','query','response','escalation'
  )),
  priority        TEXT NOT NULL DEFAULT 'normal'
                    CHECK (priority IN ('low','normal','high','urgent')),

  subject         TEXT,
  payload         JSONB NOT NULL,    -- structured message content

  status          TEXT NOT NULL DEFAULT 'sent'
                    CHECK (status IN ('sent','received','processed','failed')),
  processed_at    TIMESTAMPTZ,
  error_detail    TEXT,              -- populated if status = 'failed'

  -- Context linking
  project_id      UUID REFERENCES projects(id) ON DELETE SET NULL,
  related_entity  TEXT,              -- 'invoice:{uuid}', 'rfi:{uuid}', etc.

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_msg_org      ON agent_messages(org_id);
CREATE INDEX idx_agent_msg_from     ON agent_messages(from_agent);
CREATE INDEX idx_agent_msg_to       ON agent_messages(to_agent, status);
CREATE INDEX idx_agent_msg_project  ON agent_messages(project_id);
CREATE INDEX idx_agent_msg_created  ON agent_messages(org_id, created_at DESC);


-- ══════════════════════════════════
-- 4. NOTIFICATIONS (agent → user delivery)
-- Realtime enabled on this table (set in Supabase dashboard)
-- ══════════════════════════════════
CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  agent_id    TEXT REFERENCES agents(id) ON DELETE SET NULL,

  type        TEXT NOT NULL CHECK (type IN (
    'alert','reminder','proposal','report','anomaly','approval_required'
  )),
  title       TEXT NOT NULL,
  body        TEXT,
  data        JSONB,        -- deep link info, action payload, related entity IDs

  channel     TEXT NOT NULL DEFAULT 'in_app'
                CHECK (channel IN ('push','email','sms','in_app')),
  is_read     BOOLEAN NOT NULL DEFAULT false,
  read_at     TIMESTAMPTZ,

  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notif_user    ON notifications(user_id, is_read);
CREATE INDEX idx_notif_org     ON notifications(org_id);
CREATE INDEX idx_notif_agent   ON notifications(agent_id);
CREATE INDEX idx_notif_created ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notif_unread  ON notifications(user_id) WHERE is_read = false;


-- ══════════════════════════════════
-- MODDATETIME TRIGGERS (agent tables)
-- ══════════════════════════════════
CREATE TRIGGER mdt_agent_proposals
  BEFORE UPDATE ON agent_proposals
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);
