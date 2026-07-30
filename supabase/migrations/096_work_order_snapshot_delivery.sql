-- ============================================================================
-- PowerOn Hub - Migration 096: Work Order Snapshot Delivery
--
-- Raises issued employee Work Order assignment attachment capacity from 8 to 15.
-- Library storage and Blueprint Work Package organization remain uncapped by UI
-- count; this limit applies only to immutable assignment attachment versions.
-- ============================================================================

BEGIN;

ALTER TABLE public.assignment_snapshots
  DROP CONSTRAINT IF EXISTS assignment_snapshots_display_order_max_check;

ALTER TABLE public.assignment_snapshots
  ADD CONSTRAINT assignment_snapshots_display_order_max_check
  CHECK (display_order >= 0 AND display_order <= 14);

CREATE OR REPLACE FUNCTION public.enforce_assignment_snapshot_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  PERFORM 1
  FROM public.employee_task_assignments eta
  WHERE eta.org_id = NEW.org_id
    AND eta.id = NEW.assignment_id
  FOR UPDATE;

  SELECT COUNT(*)
  INTO v_count
  FROM public.assignment_snapshots ats
  WHERE ats.org_id = NEW.org_id
    AND ats.assignment_id = NEW.assignment_id
    AND ats.work_order_version = NEW.work_order_version
    AND (TG_OP = 'INSERT' OR ats.id <> NEW.id);

  IF v_count >= 15 THEN
    RAISE EXCEPTION 'A work order assignment version cannot have more than 15 snapshots';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_assignment_snapshot_limit() IS
  'Concurrency-safe guard that rejects a sixteenth snapshot attachment for a single assignment Work Order version.';

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

  SELECT COUNT(*)
  INTO v_invalid_count
  FROM unnest(v_snapshot_ids) AS submitted(snapshot_id)
  LEFT JOIN public.blueprint_snapshots bs
    ON bs.id = submitted.snapshot_id
   AND bs.org_id = v_org_id
   AND bs.deleted_at IS NULL
   AND btrim(coalesce(bs.storage_path, '')) <> ''
   AND bs.project_id = btrim(coalesce(p_project_id, ''))
   AND bs.blueprint_set_id = btrim(coalesce(p_blueprint_set_id, ''))
   AND (bs.work_package_id IS NULL OR bs.work_package_id = btrim(coalesce(p_work_package_id, '')))
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
  'Atomically creates an assignment, immutable Work Order version 1, and up to 15 ordered private snapshot attachments. Idempotent by org_id + client_request_id and rejects changed replay attachment lists.';

REVOKE ALL ON FUNCTION public.enforce_assignment_snapshot_limit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_employee_task_assignment_with_work_order_and_snapshots(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID[], DATE, TEXT, JSONB, UUID[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_employee_task_assignment_with_work_order_and_snapshots(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID[], DATE, TEXT, JSONB, UUID[]
) TO authenticated;

COMMIT;
