-- ============================================================================
-- PowerOn Hub - Migration 109: Work Order Assigned Hours, Archive, Delete safety
--
-- 1) Soft-archive metadata on employee_task_assignments (archived_at / archived_by)
-- 2) Owner/admin archive + restore RPCs (canonical row, no copy table)
-- 3) Allow completed assignment content edits while preserving completion facts
-- 4) Exclude archived Work Orders from employee active queues
-- 5) Project archive metadata on the admin board
-- 6) Permanent delete remains revoke_employee_task_assignment (sessions SET NULL)
-- 7) Archive write-boundary: update_my_employee_task, record_session_punch,
--    and admin_attach_session_assignment reject archived_at IS NOT NULL
--
-- Does not execute against production from this phase. Local apply is owner-gated.
-- ============================================================================

BEGIN;

-- ── 1. Soft-archive columns ───────────────────────────────────────────────────

ALTER TABLE public.employee_task_assignments
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS archived_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_eta_org_archived_at
  ON public.employee_task_assignments (org_id, archived_at DESC NULLS LAST)
  WHERE archived_at IS NOT NULL;

COMMENT ON COLUMN public.employee_task_assignments.archived_at IS
  'Soft-archive timestamp. NULL means active/default Work Order lists.';
COMMENT ON COLUMN public.employee_task_assignments.archived_by IS
  'auth.users id of the owner/admin who archived the Work Order.';

-- ── 2. Admin board projection includes archive metadata ───────────────────────

CREATE OR REPLACE FUNCTION public.get_admin_task_assignment_board()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_org_id UUID;
  v_result JSONB;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_org_id := public.user_org_id();
  IF v_org_id IS NULL OR NOT public.is_org_admin_for(v_org_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      to_jsonb(t)
      || jsonb_build_object(
        'scheduled_by_name', scheduler.full_name,
        'completed_by_name', completer.display_name,
        'archived_by_name', archiver.full_name,
        'blueprint_title', current_work_order.payload #>> '{identity,blueprintTitle}',
        'assigned_hours', CASE
          WHEN jsonb_typeof(current_work_order.payload #> '{labor,totalHours}') = 'number'
            THEN (current_work_order.payload #>> '{labor,totalHours}')::numeric
          ELSE NULL
        END,
        'work_order_instructions', nullif(btrim(current_work_order.payload->>'workOrderInstructions'), ''),
        'current_snapshot_ids', to_jsonb(coalesce(current_snapshots.snapshot_ids, ARRAY[]::TEXT[])),
        'current_work_order_payload', current_work_order.payload,
        'work_order_issued_at', current_work_order.created_at
      )
      ORDER BY t.assigned_at DESC, t.id
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM public.employee_task_assignments t
  LEFT JOIN public.profiles scheduler
    ON scheduler.id = t.assigned_by
   AND scheduler.org_id = t.org_id
  LEFT JOIN public.employee_profiles completer
    ON completer.id = t.completed_by
   AND completer.org_id = t.org_id
  LEFT JOIN public.profiles archiver
    ON archiver.id = t.archived_by
   AND archiver.org_id = t.org_id
  LEFT JOIN LATERAL (
    SELECT awov.payload, awov.created_at
    FROM public.assignment_work_order_versions awov
    WHERE awov.org_id = t.org_id
      AND awov.assignment_id = t.id
      AND awov.version = t.current_work_order_version
    LIMIT 1
  ) current_work_order ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(ats.snapshot_id::TEXT ORDER BY ats.display_order, ats.snapshot_id) AS snapshot_ids
    FROM public.assignment_snapshots ats
    WHERE ats.org_id = t.org_id
      AND ats.assignment_id = t.id
      AND ats.work_order_version = t.current_work_order_version
  ) current_snapshots ON true
  WHERE t.org_id = v_org_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_admin_task_assignment_board() IS
  'Owner/admin assignment calendar projection with assigned hours, archive metadata, and current immutable Work Order summary.';

-- ── 3. Completed assignments may be edited; completion facts stay intact ──────

CREATE OR REPLACE FUNCTION public.update_employee_task_assignment_with_work_order_and_snapshots(
  p_assignment_id UUID,
  p_client_request_id UUID,
  p_expected_updated_at TIMESTAMPTZ,
  p_expected_work_order_version INTEGER,
  p_work_package_id TEXT,
  p_work_package_name TEXT,
  p_project_id TEXT,
  p_project_name TEXT,
  p_blueprint_set_id TEXT,
  p_blueprint_title TEXT,
  p_lead_employee_id UUID,
  p_assigned_employee_ids UUID[],
  p_due_date DATE,
  p_status TEXT,
  p_work_order_payload JSONB,
  p_snapshot_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_org_id UUID;
  v_assignment public.employee_task_assignments%ROWTYPE;
  v_assigned UUID[];
  v_snapshot_ids UUID[];
  v_current_snapshot_ids UUID[];
  v_current_payload JSONB;
  v_current_draft JSONB;
  v_incoming_draft JSONB;
  v_final_payload JSONB;
  v_final_identity JSONB;
  v_payload_bytes INTEGER;
  v_current_version INTEGER;
  v_next_version INTEGER;
  v_status TEXT;
  v_invalid_count INTEGER;
  v_duplicate_count INTEGER;
  v_reissue BOOLEAN;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_org_id := public.user_org_id();
  IF v_org_id IS NULL OR NOT public.is_org_admin_for(v_org_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_assignment_id IS NULL
    OR p_client_request_id IS NULL
    OR p_expected_updated_at IS NULL
    OR p_expected_work_order_version IS NULL
  THEN
    RAISE EXCEPTION 'Invalid assignment request';
  END IF;

  SELECT *
  INTO v_assignment
  FROM public.employee_task_assignments
  WHERE id = p_assignment_id
    AND org_id = v_org_id
  FOR UPDATE;

  IF v_assignment.id IS NULL THEN
    RAISE EXCEPTION 'Assignment not found';
  END IF;

  IF v_assignment.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Archived assignments cannot be edited; restore first';
  END IF;

  v_current_version := coalesce(v_assignment.current_work_order_version, 0);

  IF v_assignment.last_admin_edit_request_id = p_client_request_id THEN
    SELECT coalesce(array_agg(ats.snapshot_id ORDER BY ats.display_order, ats.snapshot_id), ARRAY[]::UUID[])
    INTO v_current_snapshot_ids
    FROM public.assignment_snapshots ats
    WHERE ats.org_id = v_org_id
      AND ats.assignment_id = v_assignment.id
      AND ats.work_order_version = v_current_version;

    RETURN jsonb_build_object(
      'assignment', to_jsonb(v_assignment),
      'workOrderVersion', v_current_version,
      'attachmentCount', cardinality(v_current_snapshot_ids),
      'orderedSnapshotIds', to_jsonb(v_current_snapshot_ids),
      'reissued', false,
      'idempotentReplay', true
    );
  END IF;

  IF v_assignment.updated_at IS DISTINCT FROM p_expected_updated_at
    OR v_current_version <> p_expected_work_order_version
  THEN
    RAISE EXCEPTION 'Assignment changed; stale assignment edit';
  END IF;

  -- Completed Work Orders may receive owner corrections (assigned hours, etc.)
  -- but must remain completed with completion facts untouched.
  IF v_assignment.status = 'completed' THEN
    v_status := 'completed';
  ELSE
    v_status := lower(btrim(coalesce(p_status, '')));
    IF v_status NOT IN ('assigned', 'in_progress') THEN
      RAISE EXCEPTION 'Invalid assignment request';
    END IF;
  END IF;

  IF btrim(coalesce(p_work_package_id, '')) = ''
    OR btrim(coalesce(p_work_package_name, '')) = ''
    OR btrim(coalesce(p_project_id, '')) = ''
    OR btrim(coalesce(p_project_name, '')) = ''
    OR btrim(coalesce(p_blueprint_set_id, '')) = ''
    OR length(btrim(p_work_package_id)) > 200
    OR length(btrim(p_work_package_name)) > 200
    OR length(btrim(p_project_id)) > 200
    OR length(btrim(p_project_name)) > 200
    OR length(btrim(p_blueprint_set_id)) > 200
    OR length(btrim(coalesce(p_blueprint_title, ''))) > 200
  THEN
    RAISE EXCEPTION 'Invalid assignment request';
  END IF;

  v_assigned := ARRAY(
    SELECT DISTINCT submitted.employee_id
    FROM unnest(coalesce(p_assigned_employee_ids, ARRAY[]::UUID[])) submitted(employee_id)
    WHERE submitted.employee_id IS NOT NULL
    ORDER BY submitted.employee_id
  );

  IF cardinality(v_assigned) < 1 THEN
    RAISE EXCEPTION 'Select at least one employee';
  END IF;
  IF p_lead_employee_id IS NULL OR NOT p_lead_employee_id = ANY(v_assigned) THEN
    RAISE EXCEPTION 'Primary assignee must be one of the selected employees';
  END IF;

  SELECT count(*)
  INTO v_invalid_count
  FROM unnest(v_assigned) submitted(employee_id)
  LEFT JOIN public.employee_profiles ep
    ON ep.id = submitted.employee_id
   AND ep.org_id = v_org_id
   AND ep.active = true
  WHERE ep.id IS NULL;
  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Invalid assigned employee';
  END IF;

  v_snapshot_ids := coalesce(p_snapshot_ids, ARRAY[]::UUID[]);
  IF cardinality(v_snapshot_ids) > 15 THEN
    RAISE EXCEPTION 'Maximum of 15 snapshots';
  END IF;

  SELECT count(*) - count(DISTINCT submitted.snapshot_id)
  INTO v_duplicate_count
  FROM unnest(v_snapshot_ids) submitted(snapshot_id);
  IF coalesce(v_duplicate_count, 0) > 0 THEN
    RAISE EXCEPTION 'Duplicate snapshot attachments are not allowed';
  END IF;

  SELECT count(*)
  INTO v_invalid_count
  FROM unnest(v_snapshot_ids) submitted(snapshot_id)
  LEFT JOIN public.blueprint_snapshots bs
    ON bs.id = submitted.snapshot_id
   AND bs.org_id = v_org_id
   AND bs.deleted_at IS NULL
   AND btrim(coalesce(bs.storage_path, '')) <> ''
   AND bs.project_id = btrim(p_project_id)
   AND bs.blueprint_set_id = btrim(p_blueprint_set_id)
   AND (bs.work_package_id IS NULL OR bs.work_package_id = btrim(p_work_package_id))
  WHERE bs.id IS NULL;
  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'A selected snapshot is no longer available';
  END IF;

  PERFORM public.validate_assignment_work_order_payload_v1(p_work_order_payload);
  IF p_work_order_payload ? 'schemaVersion'
    OR p_work_order_payload ? 'workOrderVersion'
    OR coalesce(p_work_order_payload->'identity', '{}'::jsonb) ?| ARRAY[
      'assignmentId', 'orgId', 'createdAt', 'createdBy'
    ]
    OR (
      p_work_order_payload ? 'workOrderInstructions'
      AND (
        jsonb_typeof(p_work_order_payload->'workOrderInstructions') <> 'string'
        OR length(p_work_order_payload->>'workOrderInstructions') > 4000
      )
    )
  THEN
    RAISE EXCEPTION 'Invalid Work Order payload';
  END IF;

  IF p_work_order_payload #>> '{identity,projectId}' IS DISTINCT FROM btrim(p_project_id)
    OR p_work_order_payload #>> '{identity,projectName}' IS DISTINCT FROM btrim(p_project_name)
    OR p_work_order_payload #>> '{identity,blueprintSetId}' IS DISTINCT FROM btrim(p_blueprint_set_id)
    OR p_work_order_payload #>> '{identity,workPackageId}' IS DISTINCT FROM btrim(p_work_package_id)
    OR p_work_order_payload #>> '{scope,title}' IS DISTINCT FROM btrim(p_work_package_name)
  THEN
    RAISE EXCEPTION 'Invalid Work Order payload identity';
  END IF;

  SELECT awov.payload
  INTO v_current_payload
  FROM public.assignment_work_order_versions awov
  WHERE awov.org_id = v_org_id
    AND awov.assignment_id = v_assignment.id
    AND awov.version = v_current_version
  LIMIT 1;

  SELECT coalesce(array_agg(ats.snapshot_id ORDER BY ats.display_order, ats.snapshot_id), ARRAY[]::UUID[])
  INTO v_current_snapshot_ids
  FROM public.assignment_snapshots ats
  WHERE ats.org_id = v_org_id
    AND ats.assignment_id = v_assignment.id
    AND ats.work_order_version = v_current_version;

  v_incoming_draft := p_work_order_payload;
  v_incoming_draft := jsonb_set(
    v_incoming_draft,
    '{identity}',
    coalesce(v_incoming_draft->'identity', '{}'::jsonb) - 'dueDate',
    true
  );

  IF v_current_payload IS NULL THEN
    v_current_draft := NULL;
  ELSE
    v_current_draft := v_current_payload - 'schemaVersion' - 'workOrderVersion';
    v_current_draft := jsonb_set(
      v_current_draft,
      '{identity}',
      coalesce(v_current_draft->'identity', '{}'::jsonb)
        - 'assignmentId' - 'orgId' - 'createdAt' - 'createdBy' - 'dueDate',
      true
    );
  END IF;

  v_reissue :=
    v_current_draft IS DISTINCT FROM v_incoming_draft
    OR v_assignment.work_package_id IS DISTINCT FROM btrim(p_work_package_id)
    OR v_assignment.work_package_name IS DISTINCT FROM btrim(p_work_package_name)
    OR v_assignment.project_id IS DISTINCT FROM btrim(p_project_id)
    OR v_assignment.project_name IS DISTINCT FROM btrim(p_project_name)
    OR v_assignment.blueprint_set_id IS DISTINCT FROM btrim(p_blueprint_set_id)
    OR v_assignment.due_date IS DISTINCT FROM p_due_date
    OR v_current_snapshot_ids IS DISTINCT FROM v_snapshot_ids;

  IF v_reissue THEN
    v_next_version := v_current_version + 1;
    v_final_identity := coalesce(p_work_order_payload->'identity', '{}'::jsonb)
      || jsonb_build_object(
        'assignmentId', v_assignment.id::TEXT,
        'orgId', v_org_id::TEXT,
        'projectId', btrim(p_project_id),
        'projectName', btrim(p_project_name),
        'workPackageId', btrim(p_work_package_id),
        'blueprintSetId', btrim(p_blueprint_set_id),
        'createdAt', now(),
        'createdBy', v_uid::TEXT
      );
    IF p_due_date IS NULL THEN
      v_final_identity := v_final_identity - 'dueDate';
    ELSE
      v_final_identity := v_final_identity || jsonb_build_object('dueDate', p_due_date);
    END IF;

    v_final_payload := p_work_order_payload
      || jsonb_build_object('schemaVersion', 1, 'workOrderVersion', v_next_version)
      || jsonb_build_object('identity', v_final_identity);
    v_payload_bytes := octet_length(v_final_payload::TEXT);
    IF v_payload_bytes <= 0 OR v_payload_bytes > 512000 THEN
      RAISE EXCEPTION 'Invalid Work Order payload';
    END IF;

    INSERT INTO public.assignment_work_order_versions (
      org_id,
      assignment_id,
      version,
      schema_version,
      payload,
      source_fingerprint,
      payload_bytes,
      created_by
    )
    VALUES (
      v_org_id,
      v_assignment.id,
      v_next_version,
      1,
      v_final_payload,
      v_final_payload #>> '{source,sourceFingerprint}',
      v_payload_bytes,
      v_uid
    );

    INSERT INTO public.assignment_snapshots (
      org_id,
      assignment_id,
      snapshot_id,
      attached_by,
      display_order,
      work_order_version,
      caption_override
    )
    SELECT
      v_org_id,
      v_assignment.id,
      bs.id,
      v_uid,
      submitted.ord - 1,
      v_next_version,
      bs.caption
    FROM unnest(v_snapshot_ids) WITH ORDINALITY submitted(snapshot_id, ord)
    INNER JOIN public.blueprint_snapshots bs
      ON bs.org_id = v_org_id
     AND bs.id = submitted.snapshot_id
    ORDER BY submitted.ord;
  ELSE
    v_next_version := v_current_version;
  END IF;

  -- Never clear completion / actual-hours fields when editing a completed Work Order.
  UPDATE public.employee_task_assignments
  SET
    work_package_id = btrim(p_work_package_id),
    work_package_name = btrim(p_work_package_name),
    project_id = btrim(p_project_id),
    project_name = btrim(p_project_name),
    blueprint_set_id = btrim(p_blueprint_set_id),
    lead_employee_id = p_lead_employee_id,
    assigned_employee_ids = v_assigned,
    due_date = p_due_date,
    status = v_status,
    current_work_order_version = v_next_version,
    last_admin_edit_request_id = p_client_request_id
  WHERE id = v_assignment.id
    AND org_id = v_org_id
  RETURNING * INTO v_assignment;

  RETURN jsonb_build_object(
    'assignment', to_jsonb(v_assignment),
    'workOrderVersion', v_next_version,
    'attachmentCount', cardinality(v_snapshot_ids),
    'orderedSnapshotIds', to_jsonb(v_snapshot_ids),
    'reissued', v_reissue,
    'idempotentReplay', false
  );
END;
$$;

COMMENT ON FUNCTION public.update_employee_task_assignment_with_work_order_and_snapshots(
  UUID, UUID, TIMESTAMPTZ, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  UUID, UUID[], DATE, TEXT, JSONB, UUID[]
) IS
  'Atomically updates assignment metadata and creates the next immutable Work Order/snapshot version when content changes. Completed Work Orders may be corrected without clearing completion facts. Rejects archived and stale edits.';

-- ── 4. Archive / restore RPCs ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.archive_employee_task_assignment(
  p_assignment_id UUID,
  p_expected_updated_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_org_id UUID;
  v_assignment public.employee_task_assignments%ROWTYPE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_org_id := public.user_org_id();
  IF v_org_id IS NULL OR NOT public.is_org_admin_for(v_org_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_assignment_id IS NULL OR p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'Invalid archive request';
  END IF;

  SELECT *
  INTO v_assignment
  FROM public.employee_task_assignments
  WHERE id = p_assignment_id
    AND org_id = v_org_id
  FOR UPDATE;

  IF v_assignment.id IS NULL THEN
    RAISE EXCEPTION 'Assignment not found';
  END IF;

  IF v_assignment.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'assignment', to_jsonb(v_assignment),
      'archived', true,
      'idempotentReplay', true
    );
  END IF;

  IF v_assignment.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Assignment changed; stale archive request';
  END IF;

  UPDATE public.employee_task_assignments
  SET
    archived_at = now(),
    archived_by = v_uid
  WHERE id = v_assignment.id
    AND org_id = v_org_id
  RETURNING * INTO v_assignment;

  RETURN jsonb_build_object(
    'assignment', to_jsonb(v_assignment),
    'archived', true,
    'idempotentReplay', false
  );
END;
$$;

COMMENT ON FUNCTION public.archive_employee_task_assignment(UUID, TIMESTAMPTZ) IS
  'Owner/admin soft-archive for a Work Order assignment. Preserves the canonical row and all details.';

CREATE OR REPLACE FUNCTION public.restore_employee_task_assignment(
  p_assignment_id UUID,
  p_expected_updated_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_org_id UUID;
  v_assignment public.employee_task_assignments%ROWTYPE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_org_id := public.user_org_id();
  IF v_org_id IS NULL OR NOT public.is_org_admin_for(v_org_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_assignment_id IS NULL OR p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'Invalid restore request';
  END IF;

  SELECT *
  INTO v_assignment
  FROM public.employee_task_assignments
  WHERE id = p_assignment_id
    AND org_id = v_org_id
  FOR UPDATE;

  IF v_assignment.id IS NULL THEN
    RAISE EXCEPTION 'Assignment not found';
  END IF;

  IF v_assignment.archived_at IS NULL THEN
    RETURN jsonb_build_object(
      'assignment', to_jsonb(v_assignment),
      'restored', true,
      'idempotentReplay', true
    );
  END IF;

  IF v_assignment.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Assignment changed; stale restore request';
  END IF;

  UPDATE public.employee_task_assignments
  SET
    archived_at = NULL,
    archived_by = NULL
  WHERE id = v_assignment.id
    AND org_id = v_org_id
  RETURNING * INTO v_assignment;

  RETURN jsonb_build_object(
    'assignment', to_jsonb(v_assignment),
    'restored', true,
    'idempotentReplay', false
  );
END;
$$;

COMMENT ON FUNCTION public.restore_employee_task_assignment(UUID, TIMESTAMPTZ) IS
  'Owner/admin restore of a soft-archived Work Order. Clears archive metadata and preserves status/completion.';

-- ── 5. Employee queues exclude archived Work Orders ───────────────────────────

DROP FUNCTION IF EXISTS public.get_my_employee_tasks();

CREATE OR REPLACE FUNCTION public.get_my_employee_tasks()
RETURNS TABLE (
  id                 UUID,
  org_id             UUID,
  work_package_id    TEXT,
  work_package_name  TEXT,
  project_id         TEXT,
  project_name       TEXT,
  due_date           DATE,
  status             TEXT,
  completion_notes   TEXT,
  hours_spent        NUMERIC,
  assigned_at        TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  can_complete       BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id,
    t.org_id,
    t.work_package_id,
    t.work_package_name,
    t.project_id,
    t.project_name,
    t.due_date,
    t.status,
    t.completion_notes,
    t.hours_spent,
    t.assigned_at,
    t.updated_at,
    t.completed_at,
    (t.lead_employee_id = ep.id) AS can_complete
  FROM public.employee_task_assignments t
  INNER JOIN public.employee_profiles ep
    ON ep.user_id = auth.uid()
   AND ep.active = true
   AND ep.org_id = t.org_id
  WHERE ep.id = ANY (t.assigned_employee_ids)
    AND t.archived_at IS NULL
  ORDER BY t.due_date NULLS LAST, t.assigned_at DESC;
$$;

COMMENT ON FUNCTION public.get_my_employee_tasks() IS
  'Employee-facing task list. Omits lead_employee_id and archived Work Orders; exposes completed_at and hours_spent.';

CREATE OR REPLACE FUNCTION public.get_my_eligible_assignments()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID;
  v_profile employee_profiles%ROWTYPE;
  v_result  JSONB;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT *
  INTO v_profile
  FROM employee_profiles ep
  WHERE ep.user_id = v_uid
    AND ep.active = true
    AND (
      ep.portal_access @> '{"time_tracking": true}'::jsonb
      OR ep.portal_access->>'time_tracking' = 'true'
    )
  LIMIT 1;

  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'No active employee profile with time tracking access';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',               t.id,
        'project_id',       t.project_id,
        'project_name',     t.project_name,
        'work_package_id',  t.work_package_id,
        'work_package_name',t.work_package_name,
        'due_date',         t.due_date,
        'status',           t.status,
        'work_order_version', t.current_work_order_version
      )
      ORDER BY t.project_name, t.work_package_name
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM public.employee_task_assignments t
  WHERE t.org_id = v_profile.org_id
    AND t.status IN ('assigned', 'in_progress')
    AND t.archived_at IS NULL
    AND v_profile.id = ANY(t.assigned_employee_ids);

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_my_eligible_assignments() IS
  'Returns assigned + in_progress non-archived task assignments for the signed-in employee clock job picker.';

CREATE OR REPLACE FUNCTION public.get_my_employee_work_order(
  p_assignment_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_assignment RECORD;
  v_work_order RECORD;
  v_assignment_json JSONB;
  v_snapshots JSONB;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT
    t.id,
    t.org_id,
    t.work_package_id,
    t.work_package_name,
    t.project_id,
    t.project_name,
    t.blueprint_set_id,
    t.due_date,
    t.status,
    t.current_work_order_version,
    ep.id AS employee_profile_id
  INTO v_assignment
  FROM public.employee_task_assignments t
  INNER JOIN public.employee_profiles ep
    ON ep.user_id = v_uid
   AND ep.active = true
   AND ep.org_id = t.org_id
  WHERE t.id = p_assignment_id
    AND t.archived_at IS NULL
    AND ep.id = ANY (t.assigned_employee_ids)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'available', false,
      'assignment', NULL,
      'workOrder', NULL,
      'snapshots', '[]'::jsonb
    );
  END IF;

  v_assignment_json := jsonb_build_object(
    'id', v_assignment.id,
    'workPackageId', v_assignment.work_package_id,
    'workPackageName', v_assignment.work_package_name,
    'projectId', v_assignment.project_id,
    'projectName', v_assignment.project_name,
    'blueprintSetId', v_assignment.blueprint_set_id,
    'dueDate', v_assignment.due_date,
    'status', v_assignment.status
  );

  IF v_assignment.current_work_order_version IS NULL THEN
    RETURN jsonb_build_object(
      'available', false,
      'assignment', v_assignment_json,
      'workOrder', NULL,
      'snapshots', '[]'::jsonb
    );
  END IF;

  SELECT
    awov.version,
    awov.schema_version,
    awov.created_at,
    awov.payload
  INTO v_work_order
  FROM public.assignment_work_order_versions awov
  WHERE awov.org_id = v_assignment.org_id
    AND awov.assignment_id = v_assignment.id
    AND awov.version = v_assignment.current_work_order_version
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'available', false,
      'assignment', v_assignment_json,
      'workOrder', NULL,
      'snapshots', '[]'::jsonb
    );
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'snapshotId', bs.id,
        'displayOrder', ats.display_order,
        'caption', coalesce(nullif(btrim(coalesce(ats.caption_override, '')), ''), bs.caption),
        'pageNumber', bs.page_number,
        'captureMode', CASE
          WHEN bs.capture_metadata->>'captureMode' IN ('area', 'full-page')
            THEN bs.capture_metadata->>'captureMode'
          ELSE NULL
        END
      )
      ORDER BY ats.display_order ASC
    ),
    '[]'::jsonb
  )
  INTO v_snapshots
  FROM public.assignment_snapshots ats
  INNER JOIN public.blueprint_snapshots bs
    ON bs.org_id = ats.org_id
   AND bs.id = ats.snapshot_id
  WHERE ats.org_id = v_assignment.org_id
    AND ats.assignment_id = v_assignment.id
    AND ats.work_order_version = v_work_order.version;

  RETURN jsonb_build_object(
    'available', true,
    'assignment', v_assignment_json,
    'workOrder', jsonb_build_object(
      'version', v_work_order.version,
      'schemaVersion', v_work_order.schema_version,
      'issuedAt', v_work_order.created_at,
      'payload', v_work_order.payload
    ),
    'snapshots', v_snapshots
  );
END;
$$;

COMMENT ON FUNCTION public.get_my_employee_work_order(UUID) IS
  'Returns an authenticated employee''s read-only immutable Work Order and safe ordered snapshot metadata. Archived Work Orders are unavailable.';

-- ── 6. Archive write-boundary on employee/admin operational RPCs ───────────────
-- Archived assignments (archived_at IS NOT NULL) must not accept employee
-- completion/updates, new assignment-linked clock-ins, or admin attach targets.
-- Historical sessions already linked to a later-archived Work Order are left intact.

DROP FUNCTION IF EXISTS public.update_my_employee_task(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.update_my_employee_task(UUID, TEXT, TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION public.update_my_employee_task(
  p_assignment_id    UUID,
  p_status           TEXT    DEFAULT NULL,
  p_completion_notes TEXT    DEFAULT NULL,
  p_hours_spent      NUMERIC DEFAULT NULL
)
RETURNS public.employee_task_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid              UUID;
  v_profile          employee_profiles%ROWTYPE;
  v_row              employee_task_assignments%ROWTYPE;
  v_status           TEXT;
  v_new_completed_at TIMESTAMPTZ;
  v_new_completed_by UUID;
  v_log_completion   BOOLEAN := false;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT ep.*
  INTO v_profile
  FROM employee_profiles ep
  WHERE ep.user_id = v_uid
    AND ep.active = true
  ORDER BY ep.accepted_at NULLS LAST
  LIMIT 1;

  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'No active employee profile';
  END IF;

  -- Lock first so archive vs completion races serialize on the assignment row.
  SELECT t.*
  INTO v_row
  FROM employee_task_assignments t
  WHERE t.id = p_assignment_id
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Assignment not found';
  END IF;

  -- Same controlled message for wrong-org and archived (no cross-org leakage).
  IF v_row.org_id <> v_profile.org_id OR v_row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Assignment not found';
  END IF;

  IF v_row.lead_employee_id <> v_profile.id THEN
    RAISE EXCEPTION 'Only the primary assignee can update this task';
  END IF;

  IF NOT (v_profile.id = ANY (v_row.assigned_employee_ids)) THEN
    RAISE EXCEPTION 'Not assigned to this task';
  END IF;

  IF p_status IS NOT NULL THEN
    v_status := lower(btrim(p_status));
    IF v_status NOT IN ('assigned', 'in_progress', 'completed') THEN
      RAISE EXCEPTION 'Invalid status: %', p_status;
    END IF;
    v_row.status := v_status;

    IF v_row.status = 'completed' THEN
      v_new_completed_at := now();
      v_new_completed_by := v_profile.id;
      v_log_completion   := true;
    ELSE
      v_new_completed_at := NULL;
      v_new_completed_by := NULL;
    END IF;
  ELSE
    v_new_completed_at := v_row.completed_at;
    v_new_completed_by := v_row.completed_by;
  END IF;

  IF p_completion_notes IS NOT NULL THEN
    v_row.completion_notes := NULLIF(btrim(p_completion_notes), '');
  END IF;

  IF p_hours_spent IS NOT NULL THEN
    IF p_hours_spent <= 0 THEN
      RAISE EXCEPTION 'hours_spent must be greater than zero';
    END IF;
    v_row.hours_spent := p_hours_spent;
  END IF;

  UPDATE employee_task_assignments
  SET
    status           = v_row.status,
    completion_notes = v_row.completion_notes,
    hours_spent      = v_row.hours_spent,
    completed_at     = v_new_completed_at,
    completed_by     = v_new_completed_by,
    updated_at       = now()
  WHERE id = v_row.id
    AND org_id = v_profile.org_id
    AND archived_at IS NULL
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Assignment not found';
  END IF;

  IF v_log_completion THEN
    INSERT INTO employee_task_completions
      (org_id, assignment_id, employee_profile_id, notes)
    VALUES
      (v_row.org_id, p_assignment_id, v_profile.id, v_row.completion_notes)
    ON CONFLICT (assignment_id, employee_profile_id)
    DO UPDATE SET
      completed_at = now(),
      notes        = EXCLUDED.notes;
  END IF;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.update_my_employee_task(UUID, TEXT, TEXT, NUMERIC) IS
  'Lead-only update. Rejects archived Work Orders (archived_at IS NOT NULL) with '
  'the same Assignment not found result used for cross-org denial. When '
  'p_status=completed: stamps completed_at/by, stores hours_spent, and logs to '
  'employee_task_completions. Returns updated assignment row.';

CREATE OR REPLACE FUNCTION public.record_session_punch(
  p_action              TEXT,
  p_assignment_id       UUID DEFAULT NULL,
  p_project_id          TEXT DEFAULT NULL,
  p_end_of_day_summary  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid             UUID;
  v_profile         employee_profiles%ROWTYPE;
  v_org_id          UUID;
  v_owner_id        UUID;
  v_now             TIMESTAMPTZ;
  v_work_date       DATE;
  v_session         employee_work_sessions%ROWTYPE;
  v_assignment      employee_task_assignments%ROWTYPE;
  v_project_ref_id  TEXT;
  v_project_name    TEXT;
  v_work_pkg_name   TEXT;
  v_assignment_id   UUID;
  v_wo_version      INTEGER;
  v_total_mins      INT;
  v_lunch_mins      INT;
  v_paid_mins       INT;
  v_project_json    JSONB;
  v_summary         TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_action NOT IN ('clock_in', 'lunch_out', 'lunch_in', 'clock_out') THEN
    RAISE EXCEPTION 'Invalid action: %', p_action;
  END IF;

  v_summary := NULL;
  IF p_action = 'clock_out' AND p_end_of_day_summary IS NOT NULL THEN
    v_summary := NULLIF(btrim(p_end_of_day_summary), '');
    IF v_summary IS NOT NULL AND char_length(v_summary) > 4000 THEN
      RAISE EXCEPTION 'End-of-day summary is too long';
    END IF;
  END IF;

  SELECT *
  INTO v_profile
  FROM employee_profiles ep
  WHERE ep.user_id = v_uid
    AND ep.active = true
    AND (
      ep.portal_access @> '{"time_tracking": true}'::jsonb
      OR ep.portal_access->>'time_tracking' = 'true'
    )
  LIMIT 1;

  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'No active employee profile with time tracking access';
  END IF;

  v_org_id    := v_profile.org_id;
  v_now       := now();
  v_work_date := public.tenant_work_date(v_now, v_org_id);

  IF p_action = 'clock_in' THEN

    IF p_assignment_id IS NULL AND p_project_id IS NULL THEN
      RAISE EXCEPTION 'Either p_assignment_id or p_project_id required for clock_in';
    END IF;

    IF EXISTS (
      SELECT 1 FROM time_punch_events tpe
      WHERE tpe.employee_profile_id = v_profile.id
        AND tpe.work_date = v_work_date
        AND tpe.punch_type = 'clock_in'
        AND tpe.is_void = false
        AND tpe.punched_at > v_now - INTERVAL '60 seconds'
    ) THEN
      RAISE EXCEPTION 'Duplicate clock_in: wait 60 seconds before trying again';
    END IF;

    IF EXISTS (
      SELECT 1 FROM employee_work_sessions ews
      WHERE ews.employee_profile_id = v_profile.id
        AND ews.clock_out_at IS NULL
        AND ews.clock_in_at IS NOT NULL
        AND ews.work_date < v_work_date
    ) THEN
      RAISE EXCEPTION 'clock_in not allowed: previous workday session still open';
    END IF;

    IF p_assignment_id IS NOT NULL THEN
      -- Direct assignment clock-in: lock + require non-archived.
      SELECT *
      INTO v_assignment
      FROM public.employee_task_assignments t
      WHERE t.id = p_assignment_id
        AND t.org_id = v_org_id
        AND t.status IN ('assigned', 'in_progress')
        AND t.archived_at IS NULL
        AND v_profile.id = ANY(t.assigned_employee_ids)
      LIMIT 1
      FOR UPDATE;

      IF v_assignment.id IS NULL THEN
        RAISE EXCEPTION 'Assignment not found or not eligible';
      END IF;

      v_project_ref_id := v_assignment.project_id;
      v_project_name   := v_assignment.project_name;
      v_work_pkg_name  := v_assignment.work_package_name;
      v_assignment_id  := v_assignment.id;
      v_wo_version     := v_assignment.current_work_order_version;

    ELSE
      -- Project-only: Path A app_state; Path B non-archived assignment proves project.
      -- Path B never binds assignment_id (stays NULL). Archived WOs cannot unlock Path B.
      v_project_json := NULL;

      SELECT o.owner_id INTO v_owner_id
      FROM public.organizations o
      WHERE o.id = v_org_id;

      IF v_owner_id IS NOT NULL THEN
        SELECT sub.proj INTO v_project_json
        FROM public.app_state ast
        JOIN LATERAL (
          SELECT value AS proj
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(ast.data->'projects') = 'array'
                 THEN ast.data->'projects'
                 ELSE '[]'::jsonb
            END
          )
        ) sub ON true
        WHERE ast.user_id::text = v_owner_id::text
          AND ast.state_key = 'poweron_v2'
          AND sub.proj->>'id' = p_project_id
          AND (sub.proj->>'deletedAt')   IS NULL
          AND (sub.proj->>'archived')    IS DISTINCT FROM 'true'
          AND (sub.proj->>'isArchived')  IS DISTINCT FROM 'true'
          AND (sub.proj->>'archivedAt')  IS NULL
          AND COALESCE(sub.proj->>'status',  '')
                NOT IN ('deleted','lost','rejected','cancelled','canceled','archived')
          AND COALESCE(sub.proj->>'outcome', '')
                NOT IN ('lost','cancelled','canceled')
        LIMIT 1;
      END IF;

      IF v_project_json IS NOT NULL THEN
        v_project_ref_id := p_project_id;
        v_project_name   := v_project_json->>'name';
        v_work_pkg_name  := NULL;
        v_assignment_id  := NULL;
        v_wo_version     := NULL;
      ELSE
        SELECT *
        INTO v_assignment
        FROM public.employee_task_assignments t
        WHERE t.org_id = v_org_id
          AND t.project_id = p_project_id
          AND t.status IN ('assigned', 'in_progress')
          AND t.archived_at IS NULL
          AND v_profile.id = ANY(t.assigned_employee_ids)
        LIMIT 1
        FOR UPDATE;

        IF v_assignment.id IS NULL THEN
          RAISE EXCEPTION 'Project not found, not active, or not available to this employee';
        END IF;

        v_project_ref_id := p_project_id;
        v_project_name   := v_assignment.project_name;
        v_work_pkg_name  := NULL;
        v_assignment_id  := NULL;
        v_wo_version     := NULL;
      END IF;

    END IF;

    BEGIN
      INSERT INTO employee_work_sessions (
        org_id, employee_profile_id, assignment_id, project_id, work_order_version,
        project_name, work_package_name, work_date, clock_in_at, status
      ) VALUES (
        v_org_id,
        v_profile.id,
        v_assignment_id,
        v_project_ref_id,
        v_wo_version,
        v_project_name,
        v_work_pkg_name,
        v_work_date,
        v_now,
        'open'
      )
      RETURNING * INTO v_session;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'An active session already exists; clock out before starting a new one';
    END;

    INSERT INTO time_punch_events (
      org_id, employee_user_id, employee_profile_id,
      work_date, punch_type, punched_at, source, session_id
    ) VALUES (
      v_org_id, v_uid, v_profile.id,
      v_work_date, 'clock_in', v_now, 'employee_portal', v_session.id
    );

  ELSE

    SELECT *
    INTO v_session
    FROM employee_work_sessions ews
    WHERE ews.employee_profile_id = v_profile.id
      AND ews.work_date = v_work_date
      AND ews.clock_in_at IS NOT NULL
      AND ews.clock_out_at IS NULL
    ORDER BY ews.clock_in_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_session.id IS NULL THEN
      RAISE EXCEPTION 'No active session found for today; clock in first';
    END IF;

    IF p_action = 'lunch_out' THEN

      IF v_session.lunch_out_at IS NOT NULL THEN
        RAISE EXCEPTION 'Lunch already started for this session';
      END IF;
      IF v_session.clock_out_at IS NOT NULL THEN
        RAISE EXCEPTION 'Session already closed';
      END IF;

      UPDATE employee_work_sessions
      SET lunch_out_at = v_now, updated_at = v_now
      WHERE id = v_session.id
      RETURNING * INTO v_session;

    ELSIF p_action = 'lunch_in' THEN

      IF v_session.lunch_out_at IS NULL THEN
        RAISE EXCEPTION 'Must start lunch before ending it';
      END IF;
      IF v_session.lunch_in_at IS NOT NULL THEN
        RAISE EXCEPTION 'Lunch already ended for this session';
      END IF;
      IF v_session.clock_out_at IS NOT NULL THEN
        RAISE EXCEPTION 'Session already closed';
      END IF;

      UPDATE employee_work_sessions
      SET lunch_in_at = v_now, updated_at = v_now
      WHERE id = v_session.id
      RETURNING * INTO v_session;

    ELSIF p_action = 'clock_out' THEN

      IF v_session.clock_out_at IS NOT NULL THEN
        RAISE EXCEPTION 'Session already closed';
      END IF;
      IF v_session.lunch_out_at IS NOT NULL AND v_session.lunch_in_at IS NULL THEN
        RAISE EXCEPTION 'clock_out not allowed: lunch started but not ended';
      END IF;

      v_total_mins := GREATEST(0,
        FLOOR(EXTRACT(EPOCH FROM (v_now - v_session.clock_in_at)) / 60)::INT);

      IF v_session.lunch_out_at IS NOT NULL AND v_session.lunch_in_at IS NOT NULL THEN
        v_lunch_mins := GREATEST(0,
          FLOOR(EXTRACT(EPOCH FROM (v_session.lunch_in_at - v_session.lunch_out_at)) / 60)::INT);
      ELSE
        v_lunch_mins := 0;
      END IF;

      v_paid_mins := GREATEST(0, v_total_mins - v_lunch_mins);

      UPDATE employee_work_sessions
      SET
        clock_out_at  = v_now,
        total_minutes = v_total_mins,
        lunch_minutes = v_lunch_mins,
        paid_minutes  = v_paid_mins,
        status        = 'complete',
        updated_at    = v_now
      WHERE id = v_session.id
      RETURNING * INTO v_session;

    END IF;

    INSERT INTO time_punch_events (
      org_id, employee_user_id, employee_profile_id,
      work_date, punch_type, punched_at, source, session_id,
      end_of_day_summary
    ) VALUES (
      v_org_id, v_uid, v_profile.id,
      v_work_date, p_action, v_now, 'employee_portal', v_session.id,
      v_summary
    );

  END IF;

  RETURN jsonb_build_object(
    'sessionId',       v_session.id,
    'status',          v_session.status,
    'workDate',        v_session.work_date,
    'projectId',       v_session.project_id,
    'assignmentId',    v_session.assignment_id,
    'projectName',     v_session.project_name,
    'workPackageName', v_session.work_package_name,
    'clockInAt',       v_session.clock_in_at,
    'lunchOutAt',      v_session.lunch_out_at,
    'lunchInAt',       v_session.lunch_in_at,
    'clockOutAt',      v_session.clock_out_at,
    'paidMinutes',     v_session.paid_minutes,
    'lunchMinutes',    v_session.lunch_minutes,
    'totalMinutes',    v_session.total_minutes
  );
END;
$$;

COMMENT ON FUNCTION public.record_session_punch(TEXT, UUID, TEXT, TEXT) IS
  'Multi-session punch. Assignment-linked clock_in and project-fallback '
  'assignment lookup require archived_at IS NULL. Project-only Path A '
  '(app_state) remains available when no active Work Order exists. Existing '
  'sessions linked to a later-archived Work Order are not rewritten.';

CREATE OR REPLACE FUNCTION public.admin_attach_session_assignment(
  p_session_id    UUID,
  p_assignment_id UUID
)
RETURNS public.employee_work_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session    employee_work_sessions%ROWTYPE;
  v_assignment employee_task_assignments%ROWTYPE;
BEGIN
  SELECT * INTO v_session
  FROM employee_work_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'Session not found';
  END IF;

  IF NOT public.is_org_admin_for(v_session.org_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Lock assignment so archive cannot commit between eligibility and attach.
  SELECT * INTO v_assignment
  FROM public.employee_task_assignments t
  WHERE t.id = p_assignment_id
    AND t.org_id = v_session.org_id
    AND t.status IN ('assigned', 'in_progress')
    AND t.archived_at IS NULL
  FOR UPDATE;

  IF v_assignment.id IS NULL THEN
    RAISE EXCEPTION 'Assignment not found, belongs to a different organization, or is not in an eligible status';
  END IF;

  IF v_session.project_id IS NOT NULL
     AND v_assignment.project_id IS NOT NULL
     AND v_session.project_id <> v_assignment.project_id THEN
    RAISE EXCEPTION 'Assignment belongs to a different project than the session';
  END IF;

  UPDATE public.employee_work_sessions
  SET
    assignment_id      = v_assignment.id,
    project_id         = COALESCE(v_session.project_id, v_assignment.project_id),
    work_package_name  = v_assignment.work_package_name,
    work_order_version = v_assignment.current_work_order_version,
    updated_at         = now()
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  RETURN v_session;
END;
$$;

COMMENT ON FUNCTION public.admin_attach_session_assignment(UUID, UUID) IS
  'Attach a Work Package/assignment to a project-only session. Rejects archived '
  'targets (archived_at IS NOT NULL). Session/project TEXT identities compared '
  'directly. Punch timestamps and minute totals preserved exactly.';

-- ── 7. Grants ─────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.archive_employee_task_assignment(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.archive_employee_task_assignment(UUID, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.restore_employee_task_assignment(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.restore_employee_task_assignment(UUID, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.get_my_employee_tasks() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_eligible_assignments() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_eligible_assignments() FROM anon;
REVOKE ALL ON FUNCTION public.get_my_employee_work_order(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_my_employee_task(UUID, TEXT, TEXT, NUMERIC) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_my_employee_task(UUID, TEXT, TEXT, NUMERIC) FROM anon;
REVOKE ALL ON FUNCTION public.record_session_punch(TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_session_punch(TEXT, UUID, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.admin_attach_session_assignment(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_attach_session_assignment(UUID, UUID) FROM anon;

GRANT EXECUTE ON FUNCTION public.get_admin_task_assignment_board() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_employee_task_assignment_with_work_order_and_snapshots(
  UUID, UUID, TIMESTAMPTZ, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  UUID, UUID[], DATE, TEXT, JSONB, UUID[]
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_employee_task_assignment(UUID, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_employee_task_assignment(UUID, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_employee_tasks() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_eligible_assignments() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_employee_work_order(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_employee_task(UUID, TEXT, TEXT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_session_punch(TEXT, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_attach_session_assignment(UUID, UUID) TO authenticated;

-- ── 8. Transactional assertions ───────────────────────────────────────────────

DO $$
DECLARE
  v_update_def TEXT;
  v_punch_def  TEXT;
  v_attach_def TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'employee_task_assignments'
      AND column_name = 'archived_at'
  ) THEN
    RAISE EXCEPTION '109 assertion failed: archived_at missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'employee_task_assignments'
      AND column_name = 'archived_by'
  ) THEN
    RAISE EXCEPTION '109 assertion failed: archived_by missing';
  END IF;

  IF to_regprocedure('public.archive_employee_task_assignment(uuid,timestamptz)') IS NULL THEN
    RAISE EXCEPTION '109 assertion failed: archive RPC missing';
  END IF;

  IF to_regprocedure('public.restore_employee_task_assignment(uuid,timestamptz)') IS NULL THEN
    RAISE EXCEPTION '109 assertion failed: restore RPC missing';
  END IF;

  IF to_regprocedure('public.revoke_employee_task_assignment(uuid)') IS NULL THEN
    RAISE EXCEPTION '109 assertion failed: revoke/delete RPC missing';
  END IF;

  IF to_regprocedure('public.update_my_employee_task(uuid,text,text,numeric)') IS NULL THEN
    RAISE EXCEPTION '109 assertion failed: update_my_employee_task missing';
  END IF;

  IF to_regprocedure('public.record_session_punch(text,uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION '109 assertion failed: record_session_punch missing';
  END IF;

  IF to_regprocedure('public.admin_attach_session_assignment(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION '109 assertion failed: admin_attach_session_assignment missing';
  END IF;

  -- Legacy 3-arg update_my_employee_task must not remain callable.
  IF to_regprocedure('public.update_my_employee_task(uuid,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION '109 assertion failed: legacy 3-arg update_my_employee_task still present';
  END IF;

  v_update_def := pg_get_functiondef('public.update_my_employee_task(uuid,text,text,numeric)'::regprocedure);
  v_punch_def  := pg_get_functiondef('public.record_session_punch(text,uuid,text,text)'::regprocedure);
  v_attach_def := pg_get_functiondef('public.admin_attach_session_assignment(uuid,uuid)'::regprocedure);

  IF position('archived_at IS NOT NULL' in v_update_def) = 0
     OR position('archived_at IS NULL' in v_update_def) = 0 THEN
    RAISE EXCEPTION '109 assertion failed: update_my_employee_task missing archive eligibility';
  END IF;

  IF (SELECT count(*) FROM regexp_matches(v_punch_def, 'archived_at IS NULL', 'g')) < 2 THEN
    RAISE EXCEPTION '109 assertion failed: record_session_punch missing archive filters on both assignment paths';
  END IF;

  IF position('archived_at IS NULL' in v_attach_def) = 0 THEN
    RAISE EXCEPTION '109 assertion failed: admin_attach_session_assignment missing archive eligibility';
  END IF;

  IF position('is_org_admin_for' in pg_get_functiondef('public.archive_employee_task_assignment(uuid,timestamptz)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '109 assertion failed: archive RPC missing owner/admin authorization';
  END IF;

  IF position('is_org_admin_for' in pg_get_functiondef('public.restore_employee_task_assignment(uuid,timestamptz)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '109 assertion failed: restore RPC missing owner/admin authorization';
  END IF;

  IF position('archived_at IS NULL' in pg_get_functiondef('public.get_my_employee_tasks()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '109 assertion failed: get_my_employee_tasks missing archive filter';
  END IF;

  IF position('Archived assignments cannot be edited' in
       pg_get_functiondef('public.update_employee_task_assignment_with_work_order_and_snapshots(uuid,uuid,timestamptz,integer,text,text,text,text,text,text,uuid,uuid[],date,text,jsonb,uuid[])'::regprocedure)
     ) = 0 THEN
    RAISE EXCEPTION '109 assertion failed: completed-edit RPC missing archived reject';
  END IF;
END;
$$;

COMMIT;
