-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 087: EMS Phase 6 — Performance Data Pipeline
--
-- Workstream 1: 3 tables (snapshots, quality_ratings, compensation_events)
--               + indexes + RLS policies
-- Workstream 2: generate_employee_performance_snapshot() RPC
--
-- DEPENDS ON: 081 (time_entries), 083 (employee_task_assignments),
--             086 (employee_schedules)
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. employee_performance_snapshots ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.employee_performance_snapshots (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID        NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_profile_id     UUID        NOT NULL
    REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  period_start            DATE        NOT NULL,
  period_end              DATE        NOT NULL,
  paid_minutes            INT         NOT NULL DEFAULT 0,
  tasks_assigned          INT         NOT NULL DEFAULT 0,
  tasks_completed         INT         NOT NULL DEFAULT 0,
  tasks_completed_on_time INT         NOT NULL DEFAULT 0,
  tasks_late              INT         NOT NULL DEFAULT 0,
  scheduled_days          INT         NOT NULL DEFAULT 0,
  days_worked             INT         NOT NULL DEFAULT 0,
  avg_daily_hours         NUMERIC(4,2),
  on_time_rate            NUMERIC(5,2),
  completion_rate         NUMERIC(5,2),
  metrics                 JSONB       NOT NULL DEFAULT '{}',
  generated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  generated_by            UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (org_id, employee_profile_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_eps_org_emp_period
  ON public.employee_performance_snapshots
  (org_id, employee_profile_id, period_start DESC);

ALTER TABLE public.employee_performance_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS eps_owner ON public.employee_performance_snapshots;
CREATE POLICY eps_owner ON public.employee_performance_snapshots
  FOR ALL USING (public.is_org_admin_for(org_id));

-- ── 2. employee_quality_ratings ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.employee_quality_ratings (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID        NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_profile_id UUID        NOT NULL
    REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  assignment_id       UUID
    REFERENCES public.employee_task_assignments(id) ON DELETE SET NULL,
  rated_by            UUID        NOT NULL
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  score               NUMERIC(3,1) NOT NULL
    CHECK (score >= 1 AND score <= 5),
  notes               TEXT,
  rated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eqr_org_emp_rated
  ON public.employee_quality_ratings
  (org_id, employee_profile_id, rated_at DESC);

CREATE INDEX IF NOT EXISTS idx_eqr_assignment
  ON public.employee_quality_ratings (assignment_id);

ALTER TABLE public.employee_quality_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS eqr_owner ON public.employee_quality_ratings;
CREATE POLICY eqr_owner ON public.employee_quality_ratings
  FOR ALL USING (public.is_org_admin_for(org_id));

-- ── 3. employee_compensation_events ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.employee_compensation_events (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID        NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_profile_id  UUID        NOT NULL
    REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  event_type           TEXT        NOT NULL
    CHECK (event_type IN ('raise', 'bonus', 'adjustment', 'note')),
  amount               NUMERIC(10,2),
  effective_date       DATE        NOT NULL,
  reason               TEXT,
  based_on_snapshot_id UUID
    REFERENCES public.employee_performance_snapshots(id) ON DELETE SET NULL,
  created_by           UUID        NOT NULL
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ece_org_emp_date
  ON public.employee_compensation_events
  (org_id, employee_profile_id, effective_date DESC);

ALTER TABLE public.employee_compensation_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ece_owner ON public.employee_compensation_events;
CREATE POLICY ece_owner ON public.employee_compensation_events
  FOR ALL USING (public.is_org_admin_for(org_id));

-- ── 4. generate_employee_performance_snapshot() ───────────────────────────────

CREATE OR REPLACE FUNCTION public.generate_employee_performance_snapshot(
  p_employee_profile_id UUID,
  p_period_start        DATE,
  p_period_end          DATE
)
RETURNS public.employee_performance_snapshots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id                    UUID;
  v_paid_minutes              INT;
  v_tasks_assigned            INT;
  v_tasks_completed           INT;
  v_tasks_completed_on_time   INT;
  v_tasks_late                INT;
  v_days_worked               INT;
  v_scheduled_days            INT;
  v_snapshot                  public.employee_performance_snapshots%ROWTYPE;
BEGIN
  -- Resolve org
  SELECT org_id INTO v_org_id
  FROM public.employee_profiles
  WHERE id = p_employee_profile_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  -- Caller must be org admin
  IF NOT public.is_org_admin_for(v_org_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Hours worked from approved/closed time entries
  SELECT
    COALESCE(SUM(paid_minutes), 0),
    COUNT(DISTINCT work_date)
  INTO v_paid_minutes, v_days_worked
  FROM public.time_entries
  WHERE employee_profile_id = p_employee_profile_id
    AND work_date BETWEEN p_period_start AND p_period_end
    AND status IN ('complete', 'corrected', 'auto_closed');

  -- Task metrics from employee_task_assignments
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'completed'),
    COUNT(*) FILTER (
      WHERE status = 'completed'
        AND due_date IS NOT NULL
        AND completed_at::date <= due_date
    ),
    COUNT(*) FILTER (
      WHERE status = 'completed'
        AND due_date IS NOT NULL
        AND completed_at::date > due_date
    )
  INTO
    v_tasks_assigned,
    v_tasks_completed,
    v_tasks_completed_on_time,
    v_tasks_late
  FROM public.employee_task_assignments
  WHERE p_employee_profile_id = ANY(assigned_employee_ids)
    AND org_id = v_org_id
    AND assigned_at::date BETWEEN p_period_start AND p_period_end;

  -- Scheduled days (non-cancelled)
  SELECT COUNT(DISTINCT work_date)
  INTO v_scheduled_days
  FROM public.employee_schedules
  WHERE employee_profile_id = p_employee_profile_id
    AND work_date BETWEEN p_period_start AND p_period_end
    AND status != 'cancelled';

  -- Upsert snapshot
  INSERT INTO public.employee_performance_snapshots (
    org_id, employee_profile_id,
    period_start, period_end,
    paid_minutes, tasks_assigned, tasks_completed,
    tasks_completed_on_time, tasks_late,
    days_worked, scheduled_days,
    avg_daily_hours,
    on_time_rate, completion_rate,
    generated_by
  ) VALUES (
    v_org_id, p_employee_profile_id,
    p_period_start, p_period_end,
    v_paid_minutes, v_tasks_assigned, v_tasks_completed,
    v_tasks_completed_on_time, v_tasks_late,
    v_days_worked, v_scheduled_days,
    CASE WHEN v_days_worked > 0
      THEN round((v_paid_minutes::numeric / 60) / v_days_worked, 2)
      ELSE NULL
    END,
    CASE WHEN v_tasks_assigned > 0
      THEN round(v_tasks_completed_on_time::numeric / v_tasks_assigned * 100, 2)
      ELSE NULL
    END,
    CASE WHEN v_tasks_assigned > 0
      THEN round(v_tasks_completed::numeric / v_tasks_assigned * 100, 2)
      ELSE NULL
    END,
    auth.uid()
  )
  ON CONFLICT (org_id, employee_profile_id, period_start, period_end)
  DO UPDATE SET
    paid_minutes            = EXCLUDED.paid_minutes,
    tasks_assigned          = EXCLUDED.tasks_assigned,
    tasks_completed         = EXCLUDED.tasks_completed,
    tasks_completed_on_time = EXCLUDED.tasks_completed_on_time,
    tasks_late              = EXCLUDED.tasks_late,
    days_worked             = EXCLUDED.days_worked,
    scheduled_days          = EXCLUDED.scheduled_days,
    avg_daily_hours         = EXCLUDED.avg_daily_hours,
    on_time_rate            = EXCLUDED.on_time_rate,
    completion_rate         = EXCLUDED.completion_rate,
    generated_at            = now(),
    generated_by            = auth.uid()
  RETURNING * INTO v_snapshot;

  RETURN v_snapshot;
END;
$$;

REVOKE ALL ON FUNCTION
  public.generate_employee_performance_snapshot(uuid, date, date)
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  public.generate_employee_performance_snapshot(uuid, date, date)
  TO authenticated;

COMMIT;
