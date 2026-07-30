-- ============================================================================
-- PowerOn Hub - Migration 098: Admin Work Order Assignment Board
--
-- Secure owner/admin calendar projection plus atomic, stale-safe assignment
-- edit/reissue. Issued Work Order versions and their ordered attachments remain
-- immutable; content edits create the next version.
-- ============================================================================

BEGIN;

-- Migration 092 is intentionally not a dependency in the live migration
-- history. Preserve the optional completion-hours fact when it is present and
-- make the owner projection safe on databases where 092 was recorded blank.
ALTER TABLE public.employee_task_assignments
  ADD COLUMN IF NOT EXISTS hours_spent NUMERIC(6, 2),
  ADD COLUMN IF NOT EXISTS last_admin_edit_request_id UUID NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_eta_org_last_admin_edit_request
  ON public.employee_task_assignments (org_id, last_admin_edit_request_id)
  WHERE last_admin_edit_request_id IS NOT NULL;

COMMENT ON COLUMN public.employee_task_assignments.last_admin_edit_request_id IS
  'Idempotency key for the most recently committed owner/admin assignment edit.';

CREATE OR REPLACE FUNCTION public.enforce_assignment_work_order_instructions()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_instructions TEXT;
BEGIN
  IF NEW.payload ? 'workOrderInstructions' THEN
    IF jsonb_typeof(NEW.payload->'workOrderInstructions') <> 'string' THEN
      RAISE EXCEPTION 'Invalid Work Order payload';
    END IF;
    v_instructions := NEW.payload->>'workOrderInstructions';
    IF length(v_instructions) > 4000
      OR btrim(v_instructions) = ''
      OR v_instructions <> btrim(v_instructions)
    THEN
      RAISE EXCEPTION 'Invalid Work Order payload';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assignment_work_order_instructions
  ON public.assignment_work_order_versions;
CREATE TRIGGER trg_assignment_work_order_instructions
  BEFORE INSERT ON public.assignment_work_order_versions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_assignment_work_order_instructions();

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
  'Owner/admin assignment calendar projection with safe names and current immutable Work Order summary.';

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

  v_current_version := coalesce(v_assignment.current_work_order_version, 0);

  -- A retry of the most recently committed request is safe even though its
  -- expected revision is now stale.
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

  IF v_assignment.status = 'completed' THEN
    RAISE EXCEPTION 'Completed assignments cannot be edited';
  END IF;

  v_status := lower(btrim(coalesce(p_status, '')));
  IF v_status NOT IN ('assigned', 'in_progress') THEN
    RAISE EXCEPTION 'Invalid assignment request';
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
  'Atomically updates active assignment metadata and creates the next immutable Work Order/snapshot version only when employee-visible content changes. Rejects stale edits.';

REVOKE ALL ON FUNCTION public.get_admin_task_assignment_board() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION
  public.get_admin_task_assignment_board()
FROM anon;
REVOKE ALL ON FUNCTION public.enforce_assignment_work_order_instructions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_employee_task_assignment_with_work_order_and_snapshots(
  UUID, UUID, TIMESTAMPTZ, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  UUID, UUID[], DATE, TEXT, JSONB, UUID[]
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION
  public.update_employee_task_assignment_with_work_order_and_snapshots(
    uuid,
    uuid,
    timestamp with time zone,
    integer,
    text,
    text,
    text,
    text,
    text,
    text,
    uuid,
    uuid[],
    date,
    text,
    jsonb,
    uuid[]
  )
FROM anon;

GRANT EXECUTE ON FUNCTION public.get_admin_task_assignment_board() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_employee_task_assignment_with_work_order_and_snapshots(
  UUID, UUID, TIMESTAMPTZ, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  UUID, UUID[], DATE, TEXT, JSONB, UUID[]
) TO authenticated;

COMMIT;
