-- ============================================================================
-- PowerOn Hub - Migration 095: Employee-Safe Work Order Read RPC
--
-- Read-only employee access to immutable assignment Work Orders.
-- ============================================================================

BEGIN;

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
  'Returns an authenticated employee''s read-only immutable Work Order and safe ordered snapshot metadata.';

REVOKE ALL ON FUNCTION public.get_my_employee_work_order(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_employee_work_order(UUID) TO authenticated;

COMMIT;
