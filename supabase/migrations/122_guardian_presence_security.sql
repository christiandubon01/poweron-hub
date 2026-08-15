-- 122_guardian_presence_security.sql
-- GUARDIAN-3B1: Presence + Security Database Foundation
--
-- Extends public.user_sessions with live multi-device presence columns.
-- Creates public.account_security_events for founder-only IP security evidence.
-- Additive only — no existing rows, columns, RLS policies, or tables are modified.
--
-- PRIVACY CONTRACT:
--   user_sessions.ip_address remains unused by the new system (legacy column).
--   Raw public IP lives ONLY in account_security_events.
--   account_security_events has RLS enabled with NO authenticated-user policies.
--   Service-role is the sole write path. Founder reads go through Netlify function
--   authority in GUARDIAN-3B3 — not via direct client SELECT.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART A: Extend public.user_sessions
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.user_sessions
  ADD COLUMN IF NOT EXISTS session_id          TEXT,
  ADD COLUMN IF NOT EXISTS device_id           TEXT,
  ADD COLUMN IF NOT EXISTS module              TEXT,
  ADD COLUMN IF NOT EXISTS last_interaction_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS visibility_state    TEXT
    CONSTRAINT user_sessions_visibility_state_check
    CHECK (visibility_state IN ('visible', 'hidden')),
  ADD COLUMN IF NOT EXISTS ended_reason        TEXT
    CONSTRAINT user_sessions_ended_reason_check
    CHECK (ended_reason IS NULL OR ended_reason IN (
      'signout',
      'manual_lock',
      'inactivity_timeout'
    ));

-- session_id uniqueness: one app-session UUID per live session.
-- Partial index (WHERE NOT NULL) allows existing NULL rows and future
-- rows before session_id is assigned, while enforcing uniqueness on
-- non-null values.
CREATE UNIQUE INDEX IF NOT EXISTS uix_user_sessions_session_id
  ON public.user_sessions (session_id)
  WHERE session_id IS NOT NULL;

-- Composite index for device-scoped presence queries (user + device).
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_device
  ON public.user_sessions (user_id, device_id)
  WHERE device_id IS NOT NULL;

-- Active-session scans by org + recency (Guardian presence dashboard).
CREATE INDEX IF NOT EXISTS idx_user_sessions_org_active
  ON public.user_sessions (org_id, last_active_at DESC)
  WHERE ended_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART B: Create public.account_security_events
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Append-only founder security evidence stream.
-- NOT a heartbeat log. NOT a telemetry sink. NOT a module-transition log.
--
-- CONTRACT:
--   SESSION START  → event_type = 'session_started', public_ip = observed IP,
--                    previous_public_ip = NULL
--   IP CHANGE      → event_type = 'ip_changed', public_ip = new IP,
--                    previous_public_ip = prior IP
--
-- Deriving the current IP for a session: query the latest event for that session_id.
-- The current IP is never stored on user_sessions to keep RLS scope clean.

CREATE TABLE IF NOT EXISTS public.account_security_events (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         TEXT        NOT NULL,
  user_id            UUID        NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id             UUID        NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  device_id          TEXT,
  event_type         TEXT        NOT NULL
    CHECK (event_type IN ('session_started', 'ip_changed')),
  public_ip          INET        NOT NULL,
  previous_public_ip INET,
  is_new_device      BOOLEAN,
  occurred_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ase_session_id
  ON public.account_security_events (session_id);

CREATE INDEX IF NOT EXISTS idx_ase_user_occurred
  ON public.account_security_events (user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_ase_org_occurred
  ON public.account_security_events (org_id, occurred_at DESC);

ALTER TABLE public.account_security_events ENABLE ROW LEVEL SECURITY;

-- Belt-and-suspenders revocation: no client path to security events or raw IPs.
REVOKE ALL ON public.account_security_events FROM PUBLIC;
REVOKE ALL ON public.account_security_events FROM anon;
REVOKE ALL ON public.account_security_events FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Postcondition assertions
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_count INTEGER;
  v_rls   BOOLEAN;
BEGIN
  -- 1. All six new presence columns exist on user_sessions.
  SELECT COUNT(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'user_sessions'
    AND column_name  IN (
      'session_id', 'device_id', 'module',
      'last_interaction_at', 'visibility_state', 'ended_reason'
    );
  IF v_count <> 6 THEN
    RAISE EXCEPTION
      'GUARDIAN-3B1: expected 6 new columns on user_sessions, found %', v_count;
  END IF;

  -- 2. Legacy ip_address column must still exist (intentionally unused by new system).
  SELECT COUNT(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'user_sessions'
    AND column_name  = 'ip_address';
  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'GUARDIAN-3B1: user_sessions.ip_address was removed — must remain intact';
  END IF;

  -- 3. account_security_events table exists.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'account_security_events'
  ) THEN
    RAISE EXCEPTION 'GUARDIAN-3B1: account_security_events table missing';
  END IF;

  -- 4. RLS is enabled on account_security_events.
  SELECT c.relrowsecurity INTO v_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'account_security_events';
  IF NOT COALESCE(v_rls, false) THEN
    RAISE EXCEPTION 'GUARDIAN-3B1: RLS not enabled on account_security_events';
  END IF;

  -- 5. Zero RLS policies on account_security_events (no authenticated access path).
  SELECT COUNT(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename  = 'account_security_events';
  IF v_count <> 0 THEN
    RAISE EXCEPTION
      'GUARDIAN-3B1: unexpected RLS policies on account_security_events (count=%)',
      v_count;
  END IF;

  -- 6. IP columns use INET type.
  SELECT COUNT(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'account_security_events'
    AND column_name  IN ('public_ip', 'previous_public_ip')
    AND data_type    = 'inet';
  IF v_count <> 2 THEN
    RAISE EXCEPTION
      'GUARDIAN-3B1: INET type check failed for IP columns on account_security_events (found %)',
      v_count;
  END IF;

  -- 7. occurred_at is TIMESTAMPTZ.
  SELECT COUNT(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'account_security_events'
    AND column_name  = 'occurred_at'
    AND data_type    = 'timestamp with time zone';
  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'GUARDIAN-3B1: occurred_at on account_security_events is not TIMESTAMPTZ';
  END IF;
END $$;

COMMIT;
