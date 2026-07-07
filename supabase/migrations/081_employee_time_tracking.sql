-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 081: Employee Time Tracking
-- TIME-1 — Database schema, punch RPC, summary trigger, and RLS
--
-- DEPENDS ON: 001 (moddatetime), 002 (organizations), 016 (handle_new_user)
--
-- NOTE: public.user_org_id() and public.user_role() are defined below for SQL
-- Editor compatibility when auth-schema helpers from migration 006 are absent.
--
-- Scope:
--   • employee_profiles  — auth-linked portal identity for an employer org
--   • time_punch_events  — append-only punch source of truth
--   • time_entries       — denormalized daily summary for admin dashboards
--
-- IMPORTANT:
--   employee_profiles is NOT the existing `employees` cost-model table (048).
--   Invited employees may have profiles.org_id pointing at their personal signup
--   org (see handle_new_user). Employer tenant is employee_profiles.org_id.
--   Employee write access uses employee_user_id = auth.uid(), NOT public.user_org_id().
--
--   Invite-token anon lookup is intentionally deferred to TIME-2.
--   Admin corrections and approval workflow are deferred to TIME-7.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Timezone helpers ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.tenant_timezone(p_org_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Phase 1: fixed tenant timezone. Later: organizations.settings->>'timezone'.
  RETURN 'America/Los_Angeles';
END;
$$;

COMMENT ON FUNCTION public.tenant_timezone(UUID) IS
  'Returns IANA timezone for an org. Phase 1 hardcodes America/Los_Angeles.';

CREATE OR REPLACE FUNCTION public.tenant_work_date(p_ts TIMESTAMPTZ, p_org_id UUID)
RETURNS DATE
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (p_ts AT TIME ZONE public.tenant_timezone(p_org_id))::DATE;
$$;

COMMENT ON FUNCTION public.tenant_work_date(TIMESTAMPTZ, UUID) IS
  'Returns the local work DATE for a timestamp in the tenant timezone.';

-- ── 1b. Org/role helpers (public schema — SQL Editor safe) ───────────────────
-- Mirrors migration 006 auth.user_org_id / auth.user_role when those are absent.

CREATE OR REPLACE FUNCTION public.user_org_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM profiles WHERE id = auth.uid();
$$;

COMMENT ON FUNCTION public.user_org_id() IS
  'Returns org_id for the authenticated user. Used in RLS policies for time tracking.';

CREATE OR REPLACE FUNCTION public.user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$;

COMMENT ON FUNCTION public.user_role() IS
  'Returns role for the authenticated user. Used in RLS policies for time tracking.';

-- ── 2. employee_profiles ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.employee_profiles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name        TEXT NOT NULL,
  email               TEXT,
  role                TEXT NOT NULL DEFAULT 'employee'
                        CHECK (role IN ('employee', 'foreman')),
  employment_type     TEXT NOT NULL DEFAULT 'full_time'
                        CHECK (employment_type IN ('full_time', 'part_time', 'subcontractor', 'helper')),
  portal_access       JSONB NOT NULL DEFAULT '{"time_tracking": true}'::jsonb,
  active              BOOLEAN NOT NULL DEFAULT true,
  invited_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  invite_token        TEXT UNIQUE,
  invited_at          TIMESTAMPTZ,
  accepted_at         TIMESTAMPTZ,
  backup_employee_id  TEXT,
  crew_member_id      UUID,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.employee_profiles IS
  'Auth-linked employee portal identity scoped to an employer org. '
  'Not the cost-model `employees` table from migration 048.';

COMMENT ON COLUMN public.employee_profiles.org_id IS
  'Employer organization. Do not assume this equals profiles.org_id for the employee user.';

COMMENT ON COLUMN public.employee_profiles.portal_access IS
  'Feature flags for employee portal modules. Phase 1 uses time_tracking.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_profiles_org_user_unique
  ON public.employee_profiles (org_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_employee_profiles_org_active
  ON public.employee_profiles (org_id, active)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_employee_profiles_user_id
  ON public.employee_profiles (user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_employee_profiles_invite_token
  ON public.employee_profiles (invite_token)
  WHERE invite_token IS NOT NULL;

CREATE TRIGGER mdt_employee_profiles
  BEFORE UPDATE ON public.employee_profiles
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- ── 3. Auth helper functions (after employee_profiles exists) ─────────────────

CREATE OR REPLACE FUNCTION public.is_org_admin_for(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles
    WHERE id = auth.uid()
      AND org_id = p_org_id
      AND role IN ('owner', 'admin')
  );
$$;

COMMENT ON FUNCTION public.is_org_admin_for(UUID) IS
  'True when the caller is owner/admin of the given org via profiles.';

CREATE OR REPLACE FUNCTION public.is_active_employee_of(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM employee_profiles ep
    WHERE ep.user_id = auth.uid()
      AND ep.org_id = p_org_id
      AND ep.active = true
      AND (
        ep.portal_access @> '{"time_tracking": true}'::jsonb
        OR ep.portal_access->>'time_tracking' = 'true'
      )
  );
$$;

COMMENT ON FUNCTION public.is_active_employee_of(UUID) IS
  'True when auth.uid() is an active employee with time_tracking portal access.';

-- ── 4. time_punch_events ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.time_punch_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_profile_id     UUID NOT NULL REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  work_date             DATE NOT NULL,
  punch_type            TEXT NOT NULL
                          CHECK (punch_type IN ('clock_in', 'lunch_out', 'lunch_in', 'clock_out')),
  punched_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  source                TEXT NOT NULL DEFAULT 'employee_portal'
                          CHECK (source IN ('employee_portal', 'admin_edit', 'system_auto')),
  supersedes_id         UUID REFERENCES public.time_punch_events(id) ON DELETE SET NULL,
  is_void               BOOLEAN NOT NULL DEFAULT false,
  notes                 TEXT,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT time_punch_supersedes_admin_only CHECK (
    supersedes_id IS NULL OR source = 'admin_edit'
  )
);

COMMENT ON TABLE public.time_punch_events IS
  'Append-only source of truth for employee time punches. Employee inserts via record_time_punch() only.';

CREATE INDEX IF NOT EXISTS idx_time_punch_org_date
  ON public.time_punch_events (org_id, work_date);

CREATE INDEX IF NOT EXISTS idx_time_punch_employee_ts
  ON public.time_punch_events (employee_user_id, punched_at DESC);

CREATE INDEX IF NOT EXISTS idx_time_punch_employee_date_type
  ON public.time_punch_events (employee_user_id, work_date, punch_type)
  WHERE is_void = false;

CREATE INDEX IF NOT EXISTS idx_time_punch_profile_date
  ON public.time_punch_events (employee_profile_id, work_date);

-- ── 5. time_entries ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.time_entries (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_profile_id     UUID NOT NULL REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  work_date             DATE NOT NULL,
  clock_in_at           TIMESTAMPTZ,
  lunch_out_at          TIMESTAMPTZ,
  lunch_in_at           TIMESTAMPTZ,
  clock_out_at          TIMESTAMPTZ,
  total_minutes         INT,
  lunch_minutes         INT NOT NULL DEFAULT 0,
  paid_minutes          INT,
  status                TEXT NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open', 'complete', 'incomplete', 'corrected', 'auto_closed')),
  notes                 TEXT,
  correction_reason     TEXT,
  corrected_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approval_status       TEXT NOT NULL DEFAULT 'none'
                          CHECK (approval_status IN ('none', 'pending', 'approved', 'rejected')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT time_entries_org_employee_date_unique UNIQUE (org_id, employee_user_id, work_date)
);

COMMENT ON TABLE public.time_entries IS
  'Denormalized daily summary maintained by sync_time_entry_from_punches trigger. '
  'Do not insert/update from client for employee users.';

CREATE INDEX IF NOT EXISTS idx_time_entries_org_date
  ON public.time_entries (org_id, work_date);

CREATE INDEX IF NOT EXISTS idx_time_entries_org_status
  ON public.time_entries (org_id, status)
  WHERE status <> 'complete';

CREATE INDEX IF NOT EXISTS idx_time_entries_employee_date
  ON public.time_entries (employee_user_id, work_date DESC);

CREATE TRIGGER mdt_time_entries
  BEFORE UPDATE ON public.time_entries
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- ── 6. Summary sync trigger ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_time_entry_from_punches()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id        UUID;
  v_work_date         DATE;
  v_org_id            UUID;
  v_employee_user_id  UUID;
  v_clock_in          TIMESTAMPTZ;
  v_lunch_out         TIMESTAMPTZ;
  v_lunch_in          TIMESTAMPTZ;
  v_clock_out         TIMESTAMPTZ;
  v_total_minutes     INT;
  v_lunch_minutes     INT;
  v_paid_minutes      INT;
  v_status            TEXT;
BEGIN
  v_profile_id := COALESCE(NEW.employee_profile_id, OLD.employee_profile_id);
  v_work_date  := COALESCE(NEW.work_date, OLD.work_date);

  SELECT ep.org_id, ep.user_id
  INTO v_org_id, v_employee_user_id
  FROM employee_profiles ep
  WHERE ep.id = v_profile_id;

  IF v_org_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT
    MIN(CASE WHEN tpe.punch_type = 'clock_in'   THEN tpe.punched_at END),
    MIN(CASE WHEN tpe.punch_type = 'lunch_out'  THEN tpe.punched_at END),
    MIN(CASE WHEN tpe.punch_type = 'lunch_in'   THEN tpe.punched_at END),
    MIN(CASE WHEN tpe.punch_type = 'clock_out'  THEN tpe.punched_at END)
  INTO v_clock_in, v_lunch_out, v_lunch_in, v_clock_out
  FROM time_punch_events tpe
  WHERE tpe.employee_profile_id = v_profile_id
    AND tpe.work_date = v_work_date
    AND tpe.is_void = false;

  IF v_clock_in IS NULL THEN
    DELETE FROM time_entries
    WHERE org_id = v_org_id
      AND employee_user_id = v_employee_user_id
      AND work_date = v_work_date;
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_clock_out IS NOT NULL THEN
    v_total_minutes := GREATEST(
      0,
      FLOOR(EXTRACT(EPOCH FROM (v_clock_out - v_clock_in)) / 60)::INT
    );
  ELSE
    v_total_minutes := NULL;
  END IF;

  IF v_lunch_out IS NOT NULL AND v_lunch_in IS NOT NULL THEN
    v_lunch_minutes := GREATEST(
      0,
      FLOOR(EXTRACT(EPOCH FROM (v_lunch_in - v_lunch_out)) / 60)::INT
    );
  ELSE
    v_lunch_minutes := 0;
  END IF;

  IF v_total_minutes IS NOT NULL THEN
    v_paid_minutes := GREATEST(v_total_minutes - v_lunch_minutes, 0);
  ELSE
    v_paid_minutes := NULL;
  END IF;

  IF v_clock_out IS NULL THEN
    v_status := 'open';
  ELSE
    v_status := 'complete';
  END IF;

  INSERT INTO time_entries (
    org_id,
    employee_user_id,
    employee_profile_id,
    work_date,
    clock_in_at,
    lunch_out_at,
    lunch_in_at,
    clock_out_at,
    total_minutes,
    lunch_minutes,
    paid_minutes,
    status
  )
  VALUES (
    v_org_id,
    v_employee_user_id,
    v_profile_id,
    v_work_date,
    v_clock_in,
    v_lunch_out,
    v_lunch_in,
    v_clock_out,
    v_total_minutes,
    v_lunch_minutes,
    v_paid_minutes,
    v_status
  )
  ON CONFLICT ON CONSTRAINT time_entries_org_employee_date_unique
  DO UPDATE SET
    employee_profile_id = EXCLUDED.employee_profile_id,
    clock_in_at         = EXCLUDED.clock_in_at,
    lunch_out_at        = EXCLUDED.lunch_out_at,
    lunch_in_at         = EXCLUDED.lunch_in_at,
    clock_out_at        = EXCLUDED.clock_out_at,
    total_minutes       = EXCLUDED.total_minutes,
    lunch_minutes       = EXCLUDED.lunch_minutes,
    paid_minutes        = EXCLUDED.paid_minutes,
    status              = EXCLUDED.status,
    updated_at          = now();

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.sync_time_entry_from_punches() IS
  'Upserts time_entries from non-void punches for an employee profile + work_date.';

CREATE TRIGGER trg_sync_time_entry_from_punches
  AFTER INSERT OR UPDATE OF is_void
  ON public.time_punch_events
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_time_entry_from_punches();

-- ── 7. Punch RPC ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_time_punch(p_punch_type TEXT)
RETURNS public.time_punch_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid               UUID;
  v_profile           employee_profiles%ROWTYPE;
  v_profile_count     INT;
  v_org_id            UUID;
  v_work_date         DATE;
  v_now               TIMESTAMPTZ;
  v_has_clock_in      BOOLEAN;
  v_has_lunch_out     BOOLEAN;
  v_has_lunch_in      BOOLEAN;
  v_has_clock_out     BOOLEAN;
  v_punch_count_today INT;
  v_inserted          time_punch_events%ROWTYPE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_punch_type NOT IN ('clock_in', 'lunch_out', 'lunch_in', 'clock_out') THEN
    RAISE EXCEPTION 'Invalid punch type: %', p_punch_type;
  END IF;

  SELECT COUNT(*)
  INTO v_profile_count
  FROM employee_profiles ep
  WHERE ep.user_id = v_uid
    AND ep.active = true
    AND (
      ep.portal_access @> '{"time_tracking": true}'::jsonb
      OR ep.portal_access->>'time_tracking' = 'true'
    );

  IF v_profile_count = 0 THEN
    RAISE EXCEPTION 'No active employee profile with time tracking access';
  END IF;

  IF v_profile_count > 1 THEN
    RAISE EXCEPTION 'Multiple active employee profiles found; Phase 1 requires exactly one';
  END IF;

  SELECT ep.*
  INTO v_profile
  FROM employee_profiles ep
  WHERE ep.user_id = v_uid
    AND ep.active = true
    AND (
      ep.portal_access @> '{"time_tracking": true}'::jsonb
      OR ep.portal_access->>'time_tracking' = 'true'
    )
  LIMIT 1;

  v_org_id    := v_profile.org_id;
  v_now       := now();
  v_work_date := public.tenant_work_date(v_now, v_org_id);

  SELECT EXISTS (
    SELECT 1 FROM time_punch_events tpe
    WHERE tpe.employee_profile_id = v_profile.id
      AND tpe.work_date = v_work_date
      AND tpe.punch_type = 'clock_in'
      AND tpe.is_void = false
  ) INTO v_has_clock_in;

  SELECT EXISTS (
    SELECT 1 FROM time_punch_events tpe
    WHERE tpe.employee_profile_id = v_profile.id
      AND tpe.work_date = v_work_date
      AND tpe.punch_type = 'lunch_out'
      AND tpe.is_void = false
  ) INTO v_has_lunch_out;

  SELECT EXISTS (
    SELECT 1 FROM time_punch_events tpe
    WHERE tpe.employee_profile_id = v_profile.id
      AND tpe.work_date = v_work_date
      AND tpe.punch_type = 'lunch_in'
      AND tpe.is_void = false
  ) INTO v_has_lunch_in;

  SELECT EXISTS (
    SELECT 1 FROM time_punch_events tpe
    WHERE tpe.employee_profile_id = v_profile.id
      AND tpe.work_date = v_work_date
      AND tpe.punch_type = 'clock_out'
      AND tpe.is_void = false
  ) INTO v_has_clock_out;

  SELECT COUNT(*)
  INTO v_punch_count_today
  FROM time_punch_events tpe
  WHERE tpe.employee_profile_id = v_profile.id
    AND tpe.work_date = v_work_date
    AND tpe.is_void = false;

  IF EXISTS (
    SELECT 1
    FROM time_punch_events tpe
    WHERE tpe.employee_profile_id = v_profile.id
      AND tpe.work_date = v_work_date
      AND tpe.punch_type = p_punch_type
      AND tpe.is_void = false
      AND tpe.punched_at > v_now - INTERVAL '60 seconds'
  ) THEN
    RAISE EXCEPTION 'Duplicate punch: wait 60 seconds before repeating the same punch type';
  END IF;

  IF p_punch_type = 'clock_in' THEN
    IF v_punch_count_today > 0 THEN
      RAISE EXCEPTION 'clock_in not allowed: punches already exist for today';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM time_entries te
      WHERE te.employee_user_id = v_uid
        AND te.status = 'open'
        AND te.work_date < v_work_date
    ) THEN
      RAISE EXCEPTION 'clock_in not allowed: previous workday still open';
    END IF;

  ELSIF p_punch_type = 'lunch_out' THEN
    IF NOT v_has_clock_in THEN
      RAISE EXCEPTION 'lunch_out requires clock_in first';
    END IF;
    IF v_has_lunch_out THEN
      RAISE EXCEPTION 'lunch_out already recorded for today';
    END IF;
    IF v_has_clock_out THEN
      RAISE EXCEPTION 'lunch_out not allowed after clock_out';
    END IF;

  ELSIF p_punch_type = 'lunch_in' THEN
    IF NOT v_has_lunch_out THEN
      RAISE EXCEPTION 'lunch_in requires lunch_out first';
    END IF;
    IF v_has_lunch_in THEN
      RAISE EXCEPTION 'lunch_in already recorded for today';
    END IF;
    IF v_has_clock_out THEN
      RAISE EXCEPTION 'lunch_in not allowed after clock_out';
    END IF;

  ELSIF p_punch_type = 'clock_out' THEN
    IF NOT v_has_clock_in THEN
      RAISE EXCEPTION 'clock_out requires clock_in first';
    END IF;
    IF v_has_clock_out THEN
      RAISE EXCEPTION 'clock_out already recorded for today';
    END IF;
    IF v_has_lunch_out AND NOT v_has_lunch_in THEN
      RAISE EXCEPTION 'clock_out not allowed: lunch_out exists without lunch_in';
    END IF;
  END IF;

  INSERT INTO time_punch_events (
    org_id,
    employee_user_id,
    employee_profile_id,
    work_date,
    punch_type,
    punched_at,
    source
  )
  VALUES (
    v_org_id,
    v_uid,
    v_profile.id,
    v_work_date,
    p_punch_type,
    v_now,
    'employee_portal'
  )
  RETURNING * INTO v_inserted;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.record_time_punch(TEXT) IS
  'Records an employee time punch after validating sequence and duplicates. '
  'Returns the inserted time_punch_events row. Client must not INSERT directly.';

-- ── 7b. Function execute privileges (security hardening) ──────────────────────

REVOKE ALL ON FUNCTION public.user_org_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_org_id() TO authenticated;

REVOKE ALL ON FUNCTION public.user_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_role() TO authenticated;

REVOKE ALL ON FUNCTION public.tenant_timezone(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tenant_timezone(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.tenant_work_date(TIMESTAMPTZ, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tenant_work_date(TIMESTAMPTZ, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.is_org_admin_for(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_org_admin_for(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.is_active_employee_of(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_employee_of(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.sync_time_entry_from_punches() FROM PUBLIC;
-- Trigger-only: do not grant EXECUTE to authenticated.

REVOKE ALL ON FUNCTION public.record_time_punch(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_time_punch(TEXT) TO authenticated;

-- ── 8. Row Level Security ─────────────────────────────────────────────────────

ALTER TABLE public.employee_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_punch_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_entries        ENABLE ROW LEVEL SECURITY;

-- employee_profiles
CREATE POLICY ep_employee_select_own ON public.employee_profiles
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY ep_owner_admin_select_org ON public.employee_profiles
  FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'admin')
  );

CREATE POLICY ep_owner_admin_insert ON public.employee_profiles
  FOR INSERT
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'admin')
  );

CREATE POLICY ep_owner_admin_update ON public.employee_profiles
  FOR UPDATE
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'admin')
  )
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'admin')
  );

CREATE POLICY ep_service_role_all ON public.employee_profiles
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- time_punch_events (no direct employee INSERT — use record_time_punch)
CREATE POLICY tpe_employee_select_own ON public.time_punch_events
  FOR SELECT
  USING (employee_user_id = auth.uid());

CREATE POLICY tpe_owner_admin_select_org ON public.time_punch_events
  FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'admin')
  );

CREATE POLICY tpe_service_role_all ON public.time_punch_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- time_entries (maintained by trigger; no client employee writes)
CREATE POLICY te_employee_select_own ON public.time_entries
  FOR SELECT
  USING (employee_user_id = auth.uid());

CREATE POLICY te_owner_admin_select_org ON public.time_entries
  FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'admin')
  );

CREATE POLICY te_service_role_all ON public.time_entries
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMIT;

-- ── Verification (run manually after apply) ───────────────────────────────────
-- SELECT tablename, policyname FROM pg_policies
--   WHERE tablename IN ('employee_profiles','time_punch_events','time_entries')
--   ORDER BY tablename, policyname;
--
-- SELECT n.nspname, p.proname FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE (n.nspname, p.proname) IN (
--     ('public','record_time_punch'),
--     ('public','sync_time_entry_from_punches'),
--     ('public','tenant_work_date'),
--     ('public','tenant_timezone'),
--     ('public','user_org_id'),
--     ('public','user_role'),
--     ('public','is_org_admin_for'),
--     ('public','is_active_employee_of')
--   );
