-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 091: Admin Corrections Performance Metric
-- ADMIN-TIMESHEET-2 — Workstream 2
--
-- DEPENDS ON: 087 (employee_performance_snapshots, generate_employee_performance_snapshot)
--             090 (time_punch_events.source='admin_edit')
--
-- 1. Adds admin_corrections column to employee_performance_snapshots.
-- 2. Replaces generate_employee_performance_snapshot to compute and persist it.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Schema change ──────────────────────────────────────────────────────────

ALTER TABLE public.employee_performance_snapshots
  ADD COLUMN IF NOT EXISTS admin_corrections INT NOT NULL DEFAULT 0;

-- ── 2. Replace RPC ────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.generate_employee_performance_snapshot(uuid, date, date);

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
  v_admin_corrections         INT;
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

  -- Admin corrections: non-voided admin_edit punches in the period
  SELECT COUNT(*)
  INTO v_admin_corrections
  FROM public.time_punch_events
  WHERE employee_profile_id = p_employee_profile_id
    AND work_date BETWEEN p_period_start AND p_period_end
    AND source = 'admin_edit'
    AND is_void = false;

  -- Upsert snapshot
  INSERT INTO public.employee_performance_snapshots (
    org_id, employee_profile_id,
    period_start, period_end,
    paid_minutes, tasks_assigned, tasks_completed,
    tasks_completed_on_time, tasks_late,
    days_worked, scheduled_days,
    avg_daily_hours,
    on_time_rate, completion_rate,
    admin_corrections,
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
    v_admin_corrections,
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
    admin_corrections       = EXCLUDED.admin_corrections,
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
