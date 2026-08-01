-- ============================================================================
-- PowerOn Hub - Migration 110: Project-only Work Orders
--
-- Allows owner/admin Work Orders at three source levels:
--   1) Project only (null blueprint_set_id, null work_package_id)
--   2) Project + Blueprint (blueprint set present, null work_package_id)
--   3) Project + Blueprint + Work Package (existing full chain)
--
-- work_package_name remains NOT NULL and stores the Work Order title
-- (derived from the Work Package name, or owner-entered for project/blueprint).
-- Do not manufacture placeholder Blueprint or Work Package IDs.
--
-- Preserves migration 109 archive / restore / delete / punch enforcement.
-- Does not execute against production from this phase. Local apply is owner-gated.
-- ============================================================================

BEGIN;

-- ── 1. Nullable Work Package identity ─────────────────────────────────────────

ALTER TABLE public.employee_task_assignments
  ALTER COLUMN work_package_id DROP NOT NULL;

COMMENT ON COLUMN public.employee_task_assignments.work_package_id IS
  'Optional Work Package identity (BackupData JSON id). NULL for Project-only or Blueprint-only Work Orders.';

COMMENT ON COLUMN public.employee_task_assignments.work_package_name IS
  'Work Order display title. For Work Package sources this is typically the package name; for Project-only / Blueprint-only it is the owner-entered title.';

-- ── 2. Create assignment + Work Order (project-only compatible) ────────────────

CREATE OR REPLACE FUNCTION public.create_employee_task_assignment_with_work_order(
  p_client_request_id UUID,
  p_assignment_id UUID,
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
  p_work_order_payload JSONB
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
  v_work_order public.assignment_work_order_versions%ROWTYPE;
  v_assigned UUID[];
  v_now TIMESTAMPTZ;
  v_final_payload JSONB;
  v_final_identity JSONB;
  v_payload_bytes INTEGER;
  v_status TEXT;
  v_invalid_count INTEGER;
  v_work_package_id TEXT;
  v_work_package_name TEXT;
  v_project_id TEXT;
  v_project_name TEXT;
  v_blueprint_set_id TEXT;
  v_blueprint_title TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_org_id := public.user_org_id();
  IF v_org_id IS NULL OR NOT public.is_org_admin_for(v_org_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_client_request_id IS NULL OR p_assignment_id IS NULL THEN
    RAISE EXCEPTION 'Invalid assignment request';
  END IF;

  SELECT *
  INTO v_assignment
  FROM public.employee_task_assignments
  WHERE org_id = v_org_id
    AND client_request_id = p_client_request_id
  LIMIT 1;

  IF v_assignment.id IS NOT NULL THEN
    SELECT *
    INTO v_work_order
    FROM public.assignment_work_order_versions
    WHERE org_id = v_org_id
      AND assignment_id = v_assignment.id
      AND version = 1;

    RETURN jsonb_build_object(
      'assignment', to_jsonb(v_assignment),
      'workOrderVersion', 1,
      'idempotentReplay', true
    );
  END IF;

  v_assigned := ARRAY(
    SELECT DISTINCT assigned.employee_id
    FROM unnest(coalesce(p_assigned_employee_ids, ARRAY[]::UUID[])) AS assigned(employee_id)
    WHERE assigned.employee_id IS NOT NULL
    ORDER BY assigned.employee_id
  );

  IF cardinality(v_assigned) < 1 THEN
    RAISE EXCEPTION 'Select at least one employee';
  END IF;

  IF p_lead_employee_id IS NULL OR NOT p_lead_employee_id = ANY (v_assigned) THEN
    RAISE EXCEPTION 'Primary assignee must be one of the selected employees';
  END IF;

  SELECT COUNT(*)
  INTO v_invalid_count
  FROM unnest(v_assigned) AS assigned(employee_id)
  LEFT JOIN public.employee_profiles ep
    ON ep.id = assigned.employee_id
   AND ep.org_id = v_org_id
   AND ep.active = true
  WHERE ep.id IS NULL;

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Invalid assigned employee';
  END IF;

  v_work_package_id := nullif(btrim(coalesce(p_work_package_id, '')), '');
  v_work_package_name := btrim(coalesce(p_work_package_name, ''));
  v_project_id := nullif(btrim(coalesce(p_project_id, '')), '');
  v_project_name := btrim(coalesce(p_project_name, ''));
  v_blueprint_set_id := nullif(btrim(coalesce(p_blueprint_set_id, '')), '');
  v_blueprint_title := nullif(btrim(coalesce(p_blueprint_title, '')), '');

  IF v_project_id IS NULL
    OR v_project_name = ''
    OR v_work_package_name = ''
    OR length(v_project_id) > 200
    OR length(v_project_name) > 200
    OR length(v_work_package_name) > 200
    OR length(coalesce(v_work_package_id, '')) > 200
    OR length(coalesce(v_blueprint_set_id, '')) > 200
    OR length(coalesce(v_blueprint_title, '')) > 200
  THEN
    RAISE EXCEPTION 'Invalid assignment request';
  END IF;

  -- Work Package identity requires a Blueprint; never invent placeholder IDs.
  IF v_work_package_id IS NOT NULL AND v_blueprint_set_id IS NULL THEN
    RAISE EXCEPTION 'Invalid assignment request';
  END IF;

  v_status := coalesce(nullif(lower(btrim(p_status)), ''), 'assigned');
  IF v_status NOT IN ('assigned', 'in_progress', 'completed') THEN
    RAISE EXCEPTION 'Invalid assignment request';
  END IF;

  PERFORM public.validate_assignment_work_order_payload_v1(p_work_order_payload);

  IF p_work_order_payload ? 'schemaVersion'
    OR p_work_order_payload ? 'workOrderVersion'
    OR coalesce(p_work_order_payload->'identity', '{}'::jsonb) ?| ARRAY[
      'assignmentId',
      'orgId',
      'createdAt',
      'createdBy'
    ]
  THEN
    RAISE EXCEPTION 'Invalid Work Order payload';
  END IF;

  IF (p_work_order_payload #>> '{identity,projectId}') IS DISTINCT FROM v_project_id
    OR (p_work_order_payload #>> '{identity,projectName}') IS DISTINCT FROM v_project_name
    OR (p_work_order_payload #>> '{identity,blueprintSetId}') IS DISTINCT FROM v_blueprint_set_id
    OR (p_work_order_payload #>> '{identity,workPackageId}') IS DISTINCT FROM v_work_package_id
    OR (p_work_order_payload #>> '{scope,title}') IS DISTINCT FROM v_work_package_name
  THEN
    RAISE EXCEPTION 'Invalid Work Order payload identity';
  END IF;

  v_now := now();
  v_final_identity := coalesce(p_work_order_payload->'identity', '{}'::jsonb)
    || jsonb_build_object(
      'assignmentId', p_assignment_id::text,
      'orgId', v_org_id::text,
      'projectId', v_project_id,
      'projectName', v_project_name,
      'createdAt', to_jsonb(v_now)::text::jsonb,
      'createdBy', v_uid::text
    );

  IF v_work_package_id IS NULL THEN
    v_final_identity := v_final_identity - 'workPackageId';
  ELSE
    v_final_identity := v_final_identity || jsonb_build_object('workPackageId', v_work_package_id);
  END IF;

  IF v_blueprint_set_id IS NULL THEN
    v_final_identity := v_final_identity - 'blueprintSetId';
  ELSE
    v_final_identity := v_final_identity || jsonb_build_object('blueprintSetId', v_blueprint_set_id);
  END IF;

  IF v_blueprint_title IS NULL THEN
    v_final_identity := v_final_identity - 'blueprintTitle';
  ELSE
    v_final_identity := v_final_identity || jsonb_build_object('blueprintTitle', v_blueprint_title);
  END IF;

  IF p_due_date IS NULL THEN
    v_final_identity := v_final_identity - 'dueDate';
  ELSE
    v_final_identity := v_final_identity || jsonb_build_object('dueDate', p_due_date);
  END IF;

  v_final_payload := p_work_order_payload
    || jsonb_build_object('schemaVersion', 1, 'workOrderVersion', 1)
    || jsonb_build_object('identity', v_final_identity);

  v_payload_bytes := octet_length(v_final_payload::text);
  IF v_payload_bytes <= 0 OR v_payload_bytes > 512000 THEN
    RAISE EXCEPTION 'Invalid Work Order payload';
  END IF;

  BEGIN
    INSERT INTO public.employee_task_assignments (
      id,
      org_id,
      client_request_id,
      work_package_id,
      work_package_name,
      project_id,
      project_name,
      blueprint_set_id,
      lead_employee_id,
      assigned_employee_ids,
      assigned_by,
      due_date,
      status,
      completion_notes,
      current_work_order_version
    )
    VALUES (
      p_assignment_id,
      v_org_id,
      p_client_request_id,
      v_work_package_id,
      v_work_package_name,
      v_project_id,
      v_project_name,
      v_blueprint_set_id,
      p_lead_employee_id,
      v_assigned,
      v_uid,
      p_due_date,
      v_status,
      NULL,
      NULL
    )
    RETURNING * INTO v_assignment;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT *
      INTO v_assignment
      FROM public.employee_task_assignments
      WHERE org_id = v_org_id
        AND client_request_id = p_client_request_id
      LIMIT 1;

      IF v_assignment.id IS NULL THEN
        RAISE;
      END IF;

      SELECT *
      INTO v_work_order
      FROM public.assignment_work_order_versions
      WHERE org_id = v_org_id
        AND assignment_id = v_assignment.id
        AND version = 1;

      RETURN jsonb_build_object(
        'assignment', to_jsonb(v_assignment),
        'workOrderVersion', 1,
        'idempotentReplay', true
      );
  END;

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
    1,
    1,
    v_final_payload,
    v_final_payload #>> '{source,sourceFingerprint}',
    v_payload_bytes,
    v_uid
  )
  RETURNING * INTO v_work_order;

  UPDATE public.employee_task_assignments
  SET current_work_order_version = 1
  WHERE org_id = v_org_id
    AND id = v_assignment.id
  RETURNING * INTO v_assignment;

  RETURN jsonb_build_object(
    'assignment', to_jsonb(v_assignment),
    'workOrderVersion', 1,
    'idempotentReplay', false
  );
END;
$$;

COMMENT ON FUNCTION public.create_employee_task_assignment_with_work_order(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID[], DATE, TEXT, JSONB
) IS
  'Atomically creates an employee task assignment and immutable Work Order payload version 1. Supports Project-only, Blueprint, and Work Package sources. Idempotent by org_id + client_request_id.';

-- ── 3. Create with snapshots (reject snapshots without Blueprint) ─────────────

CREATE OR REPLACE FUNCTION public.create_employee_task_assignment_with_work_order_and_snapshots(
  p_client_request_id UUID,
  p_assignment_id UUID,
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
  v_created JSONB;
  v_snapshot_ids UUID[];
  v_existing_snapshot_ids UUID[];
  v_attachment_count INTEGER;
  v_duplicate_count INTEGER;
  v_invalid_count INTEGER;
  v_snapshot RECORD;
  v_index INTEGER;
  v_work_package_id TEXT;
  v_project_id TEXT;
  v_blueprint_set_id TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_org_id := public.user_org_id();
  IF v_org_id IS NULL OR NOT public.is_org_admin_for(v_org_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_snapshot_ids IS NULL THEN
    v_snapshot_ids := ARRAY[]::UUID[];
  ELSE
    v_snapshot_ids := p_snapshot_ids;
  END IF;

  IF cardinality(v_snapshot_ids) > 15 THEN
    RAISE EXCEPTION 'Maximum of 15 snapshots';
  END IF;

  SELECT COUNT(*) - COUNT(DISTINCT snapshot_id)
  INTO v_duplicate_count
  FROM unnest(v_snapshot_ids) AS submitted(snapshot_id);

  IF coalesce(v_duplicate_count, 0) > 0 THEN
    RAISE EXCEPTION 'Duplicate snapshot attachments are not allowed';
  END IF;

  SELECT *
  INTO v_assignment
  FROM public.employee_task_assignments
  WHERE org_id = v_org_id
    AND client_request_id = p_client_request_id
  LIMIT 1;

  IF v_assignment.id IS NOT NULL THEN
    SELECT coalesce(array_agg(ats.snapshot_id ORDER BY ats.display_order ASC), ARRAY[]::UUID[])
    INTO v_existing_snapshot_ids
    FROM public.assignment_snapshots ats
    WHERE ats.org_id = v_org_id
      AND ats.assignment_id = v_assignment.id
      AND ats.work_order_version = 1;

    IF coalesce(v_existing_snapshot_ids, ARRAY[]::UUID[]) <> v_snapshot_ids THEN
      RAISE EXCEPTION 'Idempotent replay snapshot list does not match';
    END IF;

    RETURN jsonb_build_object(
      'assignment', to_jsonb(v_assignment),
      'workOrderVersion', 1,
      'attachmentCount', cardinality(v_existing_snapshot_ids),
      'orderedSnapshotIds', to_jsonb(v_existing_snapshot_ids),
      'idempotentReplay', true
    );
  END IF;

  v_work_package_id := nullif(btrim(coalesce(p_work_package_id, '')), '');
  v_project_id := nullif(btrim(coalesce(p_project_id, '')), '');
  v_blueprint_set_id := nullif(btrim(coalesce(p_blueprint_set_id, '')), '');

  IF cardinality(v_snapshot_ids) > 0 AND (v_project_id IS NULL OR v_blueprint_set_id IS NULL OR v_work_package_id IS NULL) THEN
    RAISE EXCEPTION 'A selected snapshot is no longer available';
  END IF;

  SELECT COUNT(*)
  INTO v_invalid_count
  FROM unnest(v_snapshot_ids) AS submitted(snapshot_id)
  LEFT JOIN public.blueprint_snapshots bs
    ON bs.id = submitted.snapshot_id
   AND bs.org_id = v_org_id
   AND bs.deleted_at IS NULL
   AND btrim(coalesce(bs.storage_path, '')) <> ''
   AND v_project_id IS NOT NULL
   AND v_blueprint_set_id IS NOT NULL
   AND bs.project_id = v_project_id
   AND bs.blueprint_set_id = v_blueprint_set_id
   AND (bs.work_package_id IS NULL OR bs.work_package_id = v_work_package_id)
  WHERE bs.id IS NULL;

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'A selected snapshot is no longer available';
  END IF;

  v_created := public.create_employee_task_assignment_with_work_order(
    p_client_request_id,
    p_assignment_id,
    p_work_package_id,
    p_work_package_name,
    p_project_id,
    p_project_name,
    p_blueprint_set_id,
    p_blueprint_title,
    p_lead_employee_id,
    p_assigned_employee_ids,
    p_due_date,
    p_status,
    p_work_order_payload
  );

  SELECT *
  INTO v_assignment
  FROM public.employee_task_assignments
  WHERE org_id = v_org_id
    AND client_request_id = p_client_request_id
  LIMIT 1;

  IF v_assignment.id IS NULL THEN
    RAISE EXCEPTION 'Invalid assignment request';
  END IF;

  IF coalesce((v_created->>'idempotentReplay')::boolean, false) THEN
    SELECT coalesce(array_agg(ats.snapshot_id ORDER BY ats.display_order ASC), ARRAY[]::UUID[])
    INTO v_existing_snapshot_ids
    FROM public.assignment_snapshots ats
    WHERE ats.org_id = v_org_id
      AND ats.assignment_id = v_assignment.id
      AND ats.work_order_version = 1;

    IF coalesce(v_existing_snapshot_ids, ARRAY[]::UUID[]) <> v_snapshot_ids THEN
      RAISE EXCEPTION 'Idempotent replay snapshot list does not match';
    END IF;

    RETURN jsonb_build_object(
      'assignment', to_jsonb(v_assignment),
      'workOrderVersion', 1,
      'attachmentCount', cardinality(coalesce(v_existing_snapshot_ids, ARRAY[]::UUID[])),
      'orderedSnapshotIds', to_jsonb(coalesce(v_existing_snapshot_ids, ARRAY[]::UUID[])),
      'idempotentReplay', true
    );
  END IF;

  v_index := 0;
  FOR v_snapshot IN
    SELECT bs.*
    FROM unnest(v_snapshot_ids) WITH ORDINALITY AS submitted(snapshot_id, ord)
    JOIN public.blueprint_snapshots bs
      ON bs.org_id = v_org_id
     AND bs.id = submitted.snapshot_id
    ORDER BY submitted.ord
  LOOP
    INSERT INTO public.assignment_snapshots (
      org_id,
      assignment_id,
      snapshot_id,
      attached_by,
      display_order,
      work_order_version,
      caption_override
    )
    VALUES (
      v_org_id,
      v_assignment.id,
      v_snapshot.id,
      v_uid,
      v_index,
      1,
      v_snapshot.caption
    );
    v_index := v_index + 1;
  END LOOP;

  v_attachment_count := cardinality(v_snapshot_ids);

  RETURN jsonb_build_object(
    'assignment', to_jsonb(v_assignment),
    'workOrderVersion', 1,
    'attachmentCount', v_attachment_count,
    'orderedSnapshotIds', to_jsonb(v_snapshot_ids),
    'idempotentReplay', coalesce((v_created->>'idempotentReplay')::boolean, false)
  );
END;
$$;

COMMENT ON FUNCTION public.create_employee_task_assignment_with_work_order_and_snapshots(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID[], DATE, TEXT, JSONB, UUID[]
) IS
  'Atomically creates an assignment, immutable Work Order version 1, and up to 15 ordered private snapshot attachments. Project-only Work Orders omit Blueprint/Work Package and reject snapshot attachments.';

-- ── 4. Update assignment (project-only compatible; keep archive gate) ─────────

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
  v_work_package_id TEXT;
  v_work_package_name TEXT;
  v_project_id TEXT;
  v_project_name TEXT;
  v_blueprint_set_id TEXT;
  v_blueprint_title TEXT;
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

  v_work_package_id := nullif(btrim(coalesce(p_work_package_id, '')), '');
  v_work_package_name := btrim(coalesce(p_work_package_name, ''));
  v_project_id := nullif(btrim(coalesce(p_project_id, '')), '');
  v_project_name := btrim(coalesce(p_project_name, ''));
  v_blueprint_set_id := nullif(btrim(coalesce(p_blueprint_set_id, '')), '');
  v_blueprint_title := nullif(btrim(coalesce(p_blueprint_title, '')), '');

  IF v_project_id IS NULL
    OR v_project_name = ''
    OR v_work_package_name = ''
    OR length(v_project_id) > 200
    OR length(v_project_name) > 200
    OR length(v_work_package_name) > 200
    OR length(coalesce(v_work_package_id, '')) > 200
    OR length(coalesce(v_blueprint_set_id, '')) > 200
    OR length(coalesce(v_blueprint_title, '')) > 200
  THEN
    RAISE EXCEPTION 'Invalid assignment request';
  END IF;

  IF v_work_package_id IS NOT NULL AND v_blueprint_set_id IS NULL THEN
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

  IF cardinality(v_snapshot_ids) > 0 AND (v_project_id IS NULL OR v_blueprint_set_id IS NULL OR v_work_package_id IS NULL) THEN
    RAISE EXCEPTION 'A selected snapshot is no longer available';
  END IF;

  SELECT count(*)
  INTO v_invalid_count
  FROM unnest(v_snapshot_ids) submitted(snapshot_id)
  LEFT JOIN public.blueprint_snapshots bs
    ON bs.id = submitted.snapshot_id
   AND bs.org_id = v_org_id
   AND bs.deleted_at IS NULL
   AND btrim(coalesce(bs.storage_path, '')) <> ''
   AND v_project_id IS NOT NULL
   AND v_blueprint_set_id IS NOT NULL
   AND bs.project_id = v_project_id
   AND bs.blueprint_set_id = v_blueprint_set_id
   AND (bs.work_package_id IS NULL OR bs.work_package_id = v_work_package_id)
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

  IF (p_work_order_payload #>> '{identity,projectId}') IS DISTINCT FROM v_project_id
    OR (p_work_order_payload #>> '{identity,projectName}') IS DISTINCT FROM v_project_name
    OR (p_work_order_payload #>> '{identity,blueprintSetId}') IS DISTINCT FROM v_blueprint_set_id
    OR (p_work_order_payload #>> '{identity,workPackageId}') IS DISTINCT FROM v_work_package_id
    OR (p_work_order_payload #>> '{scope,title}') IS DISTINCT FROM v_work_package_name
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
    OR v_assignment.work_package_id IS DISTINCT FROM v_work_package_id
    OR v_assignment.work_package_name IS DISTINCT FROM v_work_package_name
    OR v_assignment.project_id IS DISTINCT FROM v_project_id
    OR v_assignment.project_name IS DISTINCT FROM v_project_name
    OR v_assignment.blueprint_set_id IS DISTINCT FROM v_blueprint_set_id
    OR v_assignment.due_date IS DISTINCT FROM p_due_date
    OR v_current_snapshot_ids IS DISTINCT FROM v_snapshot_ids;

  IF v_reissue THEN
    v_next_version := v_current_version + 1;
    v_final_identity := coalesce(p_work_order_payload->'identity', '{}'::jsonb)
      || jsonb_build_object(
        'assignmentId', v_assignment.id::TEXT,
        'orgId', v_org_id::TEXT,
        'projectId', v_project_id,
        'projectName', v_project_name,
        'createdAt', now(),
        'createdBy', v_uid::TEXT
      );

    IF v_work_package_id IS NULL THEN
      v_final_identity := v_final_identity - 'workPackageId';
    ELSE
      v_final_identity := v_final_identity || jsonb_build_object('workPackageId', v_work_package_id);
    END IF;

    IF v_blueprint_set_id IS NULL THEN
      v_final_identity := v_final_identity - 'blueprintSetId';
    ELSE
      v_final_identity := v_final_identity || jsonb_build_object('blueprintSetId', v_blueprint_set_id);
    END IF;

    IF v_blueprint_title IS NULL THEN
      v_final_identity := v_final_identity - 'blueprintTitle';
    ELSE
      v_final_identity := v_final_identity || jsonb_build_object('blueprintTitle', v_blueprint_title);
    END IF;

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
    work_package_id = v_work_package_id,
    work_package_name = v_work_package_name,
    project_id = v_project_id,
    project_name = v_project_name,
    blueprint_set_id = v_blueprint_set_id,
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
  'Atomically updates assignment metadata and creates the next immutable Work Order/snapshot version when content changes. Supports Project-only sources. Completed Work Orders may be corrected without clearing completion facts. Rejects archived and stale edits.';

-- ── 5. Backend readiness probe (client-safe; no writes) ───────────────────────

CREATE OR REPLACE FUNCTION public.project_only_work_orders_backend_ready()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nullable TEXT;
  v_create_def TEXT;
BEGIN
  -- Access limited by GRANT to authenticated / REVOKE from anon (see below).
  SELECT is_nullable
  INTO v_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'employee_task_assignments'
    AND column_name = 'work_package_id';

  IF v_nullable IS DISTINCT FROM 'YES' THEN
    RETURN false;
  END IF;

  IF to_regprocedure(
    'public.create_employee_task_assignment_with_work_order(uuid,uuid,text,text,text,text,text,text,uuid,uuid[],date,text,jsonb)'
  ) IS NULL THEN
    RETURN false;
  END IF;

  v_create_def := pg_get_functiondef(
    'public.create_employee_task_assignment_with_work_order(uuid,uuid,text,text,text,text,text,text,uuid,uuid[],date,text,jsonb)'::regprocedure
  );

  RETURN position('nullif(btrim(coalesce(p_work_package_id' in v_create_def) > 0
    AND position('nullif(btrim(coalesce(p_blueprint_set_id' in v_create_def) > 0;
END;
$$;

COMMENT ON FUNCTION public.project_only_work_orders_backend_ready() IS
  'Returns true only when employee_task_assignments.work_package_id is nullable and create RPC accepts null Work Package / Blueprint IDs (migration 110).';

REVOKE ALL ON FUNCTION public.project_only_work_orders_backend_ready() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.project_only_work_orders_backend_ready() FROM anon;
GRANT EXECUTE ON FUNCTION public.project_only_work_orders_backend_ready() TO authenticated;

-- ── 6. Transactional assertions ───────────────────────────────────────────────

DO $$
DECLARE
  v_nullable TEXT;
  v_create_def TEXT;
  v_update_def TEXT;
BEGIN
  SELECT is_nullable
  INTO v_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'employee_task_assignments'
    AND column_name = 'work_package_id';

  IF v_nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION '110 assertion failed: work_package_id must be nullable';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'employee_task_assignments'
      AND column_name = 'work_package_name'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION '110 assertion failed: work_package_name must remain NOT NULL (Work Order title)';
  END IF;

  IF to_regprocedure(
    'public.create_employee_task_assignment_with_work_order(uuid,uuid,text,text,text,text,text,text,uuid,uuid[],date,text,jsonb)'
  ) IS NULL THEN
    RAISE EXCEPTION '110 assertion failed: create Work Order RPC missing';
  END IF;

  IF to_regprocedure(
    'public.create_employee_task_assignment_with_work_order_and_snapshots(uuid,uuid,text,text,text,text,text,text,uuid,uuid[],date,text,jsonb,uuid[])'
  ) IS NULL THEN
    RAISE EXCEPTION '110 assertion failed: create with snapshots RPC missing';
  END IF;

  IF to_regprocedure(
    'public.update_employee_task_assignment_with_work_order_and_snapshots(uuid,uuid,timestamptz,integer,text,text,text,text,text,text,uuid,uuid[],date,text,jsonb,uuid[])'
  ) IS NULL THEN
    RAISE EXCEPTION '110 assertion failed: update Work Order RPC missing';
  END IF;

  -- Archive enforcement from migration 109 must remain.
  IF to_regprocedure('public.archive_employee_task_assignment(uuid,timestamptz)') IS NULL THEN
    RAISE EXCEPTION '110 assertion failed: archive RPC missing';
  END IF;
  IF to_regprocedure('public.restore_employee_task_assignment(uuid,timestamptz)') IS NULL THEN
    RAISE EXCEPTION '110 assertion failed: restore RPC missing';
  END IF;

  v_create_def := pg_get_functiondef(
    'public.create_employee_task_assignment_with_work_order(uuid,uuid,text,text,text,text,text,text,uuid,uuid[],date,text,jsonb)'::regprocedure
  );
  v_update_def := pg_get_functiondef(
    'public.update_employee_task_assignment_with_work_order_and_snapshots(uuid,uuid,timestamptz,integer,text,text,text,text,text,text,uuid,uuid[],date,text,jsonb,uuid[])'::regprocedure
  );

  IF position('is_org_admin_for' in v_create_def) = 0 THEN
    RAISE EXCEPTION '110 assertion failed: create RPC missing owner/admin authorization';
  END IF;
  IF position('is_org_admin_for' in v_update_def) = 0 THEN
    RAISE EXCEPTION '110 assertion failed: update RPC missing owner/admin authorization';
  END IF;
  IF position('Archived assignments cannot be edited' in v_update_def) = 0 THEN
    RAISE EXCEPTION '110 assertion failed: update RPC missing archived reject';
  END IF;
  IF position('nullif(btrim(coalesce(p_work_package_id' in v_create_def) = 0 THEN
    RAISE EXCEPTION '110 assertion failed: create RPC missing nullable Work Package normalization';
  END IF;
  IF position('nullif(btrim(coalesce(p_blueprint_set_id' in v_create_def) = 0 THEN
    RAISE EXCEPTION '110 assertion failed: create RPC missing nullable Blueprint normalization';
  END IF;

  IF to_regprocedure('public.project_only_work_orders_backend_ready()') IS NULL THEN
    RAISE EXCEPTION '110 assertion failed: project_only_work_orders_backend_ready missing';
  END IF;

  IF public.project_only_work_orders_backend_ready() IS NOT TRUE THEN
    RAISE EXCEPTION '110 assertion failed: project_only_work_orders_backend_ready must return true after apply';
  END IF;
END;
$$;

COMMIT;
