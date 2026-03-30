-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 005: Audit Trail System
-- Phase 01 Foundation
--
-- Implements Layer 3 of the three-layer memory architecture:
--   Layer 3 (Audit) — append-only, immutable, every action recorded
--
-- Contents:
--   1. audit_log table            — append-only; no UPDATE/DELETE policies
--   2. log_audit_change()         — trigger function (captures who, what, diff)
--   3. Per-table audit triggers   — applied to all business-critical tables
--   4. check_anomalies()          — detects bulk exports, rapid deletes, off-hours access
--   5. pg_cron schedule           — runs check_anomalies() every 5 minutes
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════
-- 1. AUDIT LOG TABLE
-- BIGSERIAL primary key preserves strict insertion order.
-- RLS enforces: INSERT for all org members, SELECT for owner/admin only.
-- No UPDATE or DELETE policies are created — the table is truly append-only.
-- ══════════════════════════════════
CREATE TABLE audit_log (
  id            BIGSERIAL PRIMARY KEY,    -- ordered sequence for guaranteed timeline
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- WHO performed the action
  actor_type    TEXT NOT NULL CHECK (actor_type IN ('user','agent','system')),
  actor_id      TEXT NOT NULL,            -- auth.uid()::TEXT or agent id (e.g., 'vault')
  actor_name    TEXT,                     -- display name captured at time of action

  -- WHAT was done
  action        TEXT NOT NULL CHECK (action IN (
    'insert','update','delete','view','export','login','logout',
    'send','approve','reject','escalate','lock','unlock'
  )),
  entity_type   TEXT NOT NULL,            -- table name: 'projects', 'invoices', etc.
  entity_id     UUID,                     -- PK of the affected row

  -- DETAILS
  description   TEXT,                     -- human-readable: "LEDGER sent reminder for Invoice #1042"
  changes       JSONB,                    -- {field: {old: x, new: y}} for updates
  metadata      JSONB NOT NULL DEFAULT '{}',

  -- CONTEXT
  ip_address    INET,
  device_type   TEXT,
  session_id    UUID,

  -- TIMESTAMP — always server-generated; never trust client time
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes optimised for the most common audit queries
CREATE INDEX idx_audit_org_time  ON audit_log(org_id, created_at DESC);
CREATE INDEX idx_audit_actor     ON audit_log(org_id, actor_type, actor_id);
CREATE INDEX idx_audit_entity    ON audit_log(org_id, entity_type, entity_id);
CREATE INDEX idx_audit_action    ON audit_log(org_id, action);


-- ══════════════════════════════════
-- 2. AUDIT TRIGGER FUNCTION
-- Fires AFTER INSERT, UPDATE, or DELETE on tracked tables.
-- Detects whether the change was made by a user, an agent, or the system.
-- Captures a field-level diff for UPDATE operations (excluding updated_at noise).
-- ══════════════════════════════════
CREATE OR REPLACE FUNCTION log_audit_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_action        TEXT;
  v_actor_id      TEXT;
  v_actor_type    TEXT;
  v_actor_name    TEXT;
  v_changes       JSONB;
  v_org_id        UUID;
  v_entity_id     UUID;
BEGIN
  -- Map trigger operation to our action vocabulary
  v_action := LOWER(TG_OP);   -- 'insert', 'update', 'delete'

  -- Determine actor: agent setting takes priority over auth user
  v_actor_id := COALESCE(
    NULLIF(current_setting('app.current_agent', true), ''),
    auth.uid()::TEXT,
    'system'
  );

  v_actor_type := CASE
    WHEN NULLIF(current_setting('app.current_agent', true), '') IS NOT NULL THEN 'agent'
    WHEN auth.uid() IS NOT NULL THEN 'user'
    ELSE 'system'
  END;

  -- Capture actor name at point-in-time (denormalized intentionally)
  IF v_actor_type = 'user' THEN
    SELECT full_name INTO v_actor_name
    FROM profiles WHERE id = auth.uid();
  ELSIF v_actor_type = 'agent' THEN
    SELECT display_name INTO v_actor_name
    FROM agents WHERE id = v_actor_id;
  ELSE
    v_actor_name := 'system';
  END IF;

  -- Resolve org_id and entity_id from OLD/NEW record
  v_org_id    := COALESCE(
    (row_to_json(NEW)::jsonb ->> 'org_id')::UUID,
    (row_to_json(OLD)::jsonb ->> 'org_id')::UUID
  );
  v_entity_id := COALESCE(
    (row_to_json(NEW)::jsonb ->> 'id')::UUID,
    (row_to_json(OLD)::jsonb ->> 'id')::UUID
  );

  -- For UPDATE: compute field-level diff (skip noisy updated_at column)
  IF TG_OP = 'UPDATE' THEN
    SELECT jsonb_object_agg(
      key,
      jsonb_build_object(
        'old', row_to_json(OLD)::jsonb -> key,
        'new', row_to_json(NEW)::jsonb -> key
      )
    )
    INTO v_changes
    FROM jsonb_object_keys(row_to_json(NEW)::jsonb) AS key
    WHERE
      row_to_json(OLD)::jsonb -> key IS DISTINCT FROM row_to_json(NEW)::jsonb -> key
      AND key NOT IN ('updated_at', 'last_active_at');
  END IF;

  -- Skip the insert if v_org_id couldn't be resolved (e.g., org table itself)
  IF v_org_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Write the immutable audit record
  INSERT INTO audit_log (
    org_id,
    actor_type,
    actor_id,
    actor_name,
    action,
    entity_type,
    entity_id,
    changes
  ) VALUES (
    v_org_id,
    v_actor_type,
    v_actor_id,
    v_actor_name,
    v_action,
    TG_TABLE_NAME,
    v_entity_id,
    v_changes
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION log_audit_change IS
  'Universal audit trigger. Attach to any table with: '
  'CREATE TRIGGER audit_<table> AFTER INSERT OR UPDATE OR DELETE ON <table> '
  'FOR EACH ROW EXECUTE FUNCTION log_audit_change();';


-- ══════════════════════════════════
-- 3. AUDIT TRIGGERS — all business-critical tables
-- Applied AFTER the operation so the insert never blocks the main transaction.
-- ══════════════════════════════════

-- Core business tables
CREATE TRIGGER audit_projects
  AFTER INSERT OR UPDATE OR DELETE ON projects
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();

CREATE TRIGGER audit_project_phases
  AFTER INSERT OR UPDATE OR DELETE ON project_phases
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();

CREATE TRIGGER audit_estimates
  AFTER INSERT OR UPDATE OR DELETE ON estimates
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();

CREATE TRIGGER audit_invoices
  AFTER INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();

CREATE TRIGGER audit_payments
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();

CREATE TRIGGER audit_rfis
  AFTER INSERT OR UPDATE OR DELETE ON rfis
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();

CREATE TRIGGER audit_change_orders
  AFTER INSERT OR UPDATE OR DELETE ON change_orders
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();

-- Scheduling & client data
CREATE TRIGGER audit_calendar_events
  AFTER INSERT OR UPDATE OR DELETE ON calendar_events
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();

CREATE TRIGGER audit_leads
  AFTER INSERT OR UPDATE OR DELETE ON leads
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();

CREATE TRIGGER audit_clients
  AFTER INSERT OR UPDATE OR DELETE ON clients
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();

-- Agent activity
CREATE TRIGGER audit_agent_proposals
  AFTER INSERT OR UPDATE OR DELETE ON agent_proposals
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();

CREATE TRIGGER audit_compliance_checks
  AFTER INSERT OR UPDATE OR DELETE ON compliance_checks
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();

-- User management
CREATE TRIGGER audit_profiles
  AFTER INSERT OR UPDATE OR DELETE ON profiles
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();


-- ══════════════════════════════════
-- 4. ANOMALY DETECTION FUNCTION
-- Scans recent audit activity for suspicious patterns and creates
-- notifications for the org owner via the notifications table.
--
-- Patterns detected:
--   A. Bulk export: >10 export actions in 1 minute by same actor
--   B. Rapid deletes: >3 deletes in 5 minutes by same actor
--   C. Off-hours access: login outside 05:00–22:00 (America/Los_Angeles)
-- ══════════════════════════════════
CREATE OR REPLACE FUNCTION check_anomalies()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rec RECORD;
BEGIN

  -- ── A. BULK EXPORT DETECTION ──────────────────────────────────────────────
  -- Flag any actor who performed >10 exports within the last minute
  FOR v_rec IN
    SELECT actor_id, org_id, COUNT(*) AS action_count
    FROM audit_log
    WHERE action = 'export'
      AND created_at > NOW() - INTERVAL '1 minute'
    GROUP BY actor_id, org_id
    HAVING COUNT(*) > 10
  LOOP
    INSERT INTO notifications (org_id, user_id, agent_id, type, title, body, data)
    SELECT
      v_rec.org_id,
      p.id,
      'scout',
      'anomaly',
      'Bulk Export Detected',
      'Actor ' || v_rec.actor_id || ' performed ' || v_rec.action_count
        || ' exports in under 1 minute.',
      jsonb_build_object(
        'actor_id',    v_rec.actor_id,
        'action_count', v_rec.action_count,
        'detected_at', NOW()
      )
    FROM profiles p
    WHERE p.org_id = v_rec.org_id
      AND p.role = 'owner';
  END LOOP;


  -- ── B. RAPID DELETE DETECTION ─────────────────────────────────────────────
  -- Flag any actor who deleted >3 records within the last 5 minutes
  FOR v_rec IN
    SELECT actor_id, org_id, COUNT(*) AS action_count
    FROM audit_log
    WHERE action = 'delete'
      AND created_at > NOW() - INTERVAL '5 minutes'
    GROUP BY actor_id, org_id
    HAVING COUNT(*) > 3
  LOOP
    -- Avoid duplicate anomaly notifications within the same 10-minute window
    IF NOT EXISTS (
      SELECT 1 FROM notifications
      WHERE org_id = v_rec.org_id
        AND type = 'anomaly'
        AND title = 'Rapid Deletion Detected'
        AND (data ->> 'actor_id') = v_rec.actor_id
        AND created_at > NOW() - INTERVAL '10 minutes'
    ) THEN
      INSERT INTO notifications (org_id, user_id, agent_id, type, title, body, data)
      SELECT
        v_rec.org_id,
        p.id,
        'scout',
        'anomaly',
        'Rapid Deletion Detected',
        'Actor ' || v_rec.actor_id || ' deleted ' || v_rec.action_count
          || ' records in under 5 minutes.',
        jsonb_build_object(
          'actor_id',    v_rec.actor_id,
          'action_count', v_rec.action_count,
          'detected_at', NOW()
        )
      FROM profiles p
      WHERE p.org_id = v_rec.org_id
        AND p.role = 'owner';
    END IF;
  END LOOP;


  -- ── C. OFF-HOURS LOGIN DETECTION ─────────────────────────────────────────
  -- Flag logins that occurred outside 05:00–22:00 Pacific time
  FOR v_rec IN
    SELECT actor_id, org_id, MAX(created_at) AS login_time
    FROM audit_log
    WHERE action = 'login'
      AND created_at > NOW() - INTERVAL '5 minutes'
      AND EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Los_Angeles')
          NOT BETWEEN 5 AND 21   -- 05:00–21:59 = allowed window
    GROUP BY actor_id, org_id
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM notifications
      WHERE org_id = v_rec.org_id
        AND type = 'anomaly'
        AND title = 'Off-Hours Login'
        AND (data ->> 'actor_id') = v_rec.actor_id
        AND created_at > NOW() - INTERVAL '15 minutes'
    ) THEN
      INSERT INTO notifications (org_id, user_id, agent_id, type, title, body, data)
      SELECT
        v_rec.org_id,
        p.id,
        'scout',
        'anomaly',
        'Off-Hours Login',
        'Login detected outside normal hours (before 5am or after 10pm PT) by '
          || v_rec.actor_id || '.',
        jsonb_build_object(
          'actor_id',   v_rec.actor_id,
          'login_time', v_rec.login_time,
          'detected_at', NOW()
        )
      FROM profiles p
      WHERE p.org_id = v_rec.org_id
        AND p.role = 'owner';
    END IF;
  END LOOP;

END;
$$;

COMMENT ON FUNCTION check_anomalies IS
  'Scans recent audit_log entries for suspicious activity patterns (bulk exports, '
  'rapid deletes, off-hours logins) and inserts anomaly notifications for org owners. '
  'Scheduled to run every 5 minutes via pg_cron.';


-- ══════════════════════════════════
-- 5. SCHEDULE ANOMALY CHECK (pg_cron)
-- Runs every 5 minutes.
-- Safe to call multiple times — unschedule first to avoid duplicates on re-migration.
-- ══════════════════════════════════
SELECT cron.unschedule('poweron-anomaly-check')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'poweron-anomaly-check'
  );

SELECT cron.schedule(
  'poweron-anomaly-check',
  '*/5 * * * *',
  'SELECT check_anomalies()'
);
