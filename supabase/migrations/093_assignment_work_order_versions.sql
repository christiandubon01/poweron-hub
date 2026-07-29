-- ============================================================================
-- PowerOn Hub - Migration 093: Immutable Assignment Work Order Versions
--
-- Atomic employee task assignment creation with immutable Work Order payload v1.
-- ============================================================================

BEGIN;

ALTER TABLE public.employee_task_assignments
  ADD COLUMN IF NOT EXISTS client_request_id UUID NULL,
  ADD COLUMN IF NOT EXISTS current_work_order_version INTEGER NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'employee_task_assignments_current_work_order_version_check'
      AND conrelid = 'public.employee_task_assignments'::regclass
  ) THEN
    ALTER TABLE public.employee_task_assignments
      ADD CONSTRAINT employee_task_assignments_current_work_order_version_check
      CHECK (current_work_order_version IS NULL OR current_work_order_version >= 1);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'employee_task_assignments_org_id_id_key'
      AND conrelid = 'public.employee_task_assignments'::regclass
  ) THEN
    ALTER TABLE public.employee_task_assignments
      ADD CONSTRAINT employee_task_assignments_org_id_id_key UNIQUE (org_id, id);
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_eta_org_client_request_id
  ON public.employee_task_assignments (org_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.assignment_work_order_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  assignment_id UUID NOT NULL,
  version INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  payload JSONB NOT NULL,
  source_fingerprint TEXT NULL,
  payload_bytes INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT assignment_work_order_versions_assignment_version_key UNIQUE (assignment_id, version),
  CONSTRAINT assignment_work_order_versions_assignment_org_fk
    FOREIGN KEY (org_id, assignment_id)
    REFERENCES public.employee_task_assignments(org_id, id)
    ON DELETE CASCADE,
  CONSTRAINT assignment_work_order_versions_version_check CHECK (version >= 1),
  CONSTRAINT assignment_work_order_versions_schema_version_check CHECK (schema_version >= 1),
  CONSTRAINT assignment_work_order_versions_payload_object_check CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT assignment_work_order_versions_payload_bytes_check CHECK (payload_bytes > 0 AND payload_bytes <= 512000)
);

COMMENT ON TABLE public.assignment_work_order_versions IS
  'Immutable versioned employee-facing Work Order payloads frozen at assignment creation.';

CREATE INDEX IF NOT EXISTS idx_awov_assignment_version_desc
  ON public.assignment_work_order_versions (assignment_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_awov_org_created_at_desc
  ON public.assignment_work_order_versions (org_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.reject_assignment_work_order_version_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Assignment Work Order versions are immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_assignment_work_order_versions_no_update
  ON public.assignment_work_order_versions;
CREATE TRIGGER trg_assignment_work_order_versions_no_update
  BEFORE UPDATE ON public.assignment_work_order_versions
  FOR EACH ROW EXECUTE FUNCTION public.reject_assignment_work_order_version_update();

CREATE OR REPLACE FUNCTION public.assignment_work_order_payload_has_forbidden_key(p_payload JSONB)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_path_query(p_payload, '$.**') AS node(value)
    WHERE jsonb_typeof(node.value) = 'object'
      AND (
        node.value ?| ARRAY[
          'lead_employee_id',
          'leadEmployeeId',
          'assigned_employee_ids',
          'assignedEmployeeIds',
          'employeeId',
          'employeeIds',
          'proposalSummary',
          'customerProposalSummary',
          'pricing',
          'estimates',
          'materialPrices',
          'laborRates',
          'markup',
          'margin',
          'cost',
          'backupData',
          'rawBackupData',
          'annotations',
          'rawAnnotations',
          'animationScene',
          'scene',
          'sceneGraph',
          'animationGraph',
          'diagnostics',
          'duplicateMembershipDiagnostics',
          'staleReferenceDiagnostics',
          'packagePickState',
          'selectionState',
          'draft',
          'drafts',
          'signedUrl',
          'signed_url',
          'publicUrl',
          'public_url',
          'storagePath',
          'storage_path',
          'blob',
          'blobs'
        ]
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.assignment_work_order_payload_has_forbidden_text(p_payload JSONB)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_payload::text ~* '(signed[_-]?url|public[_-]?url|storage[_-]?path|https?://|blob:)';
$$;

CREATE OR REPLACE FUNCTION public.validate_assignment_work_order_payload_v1(p_payload JSONB)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_size INTEGER;
  v_labor JSONB;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid Work Order payload';
  END IF;

  v_size := octet_length(p_payload::text);
  IF v_size <= 0 OR v_size > 512000 THEN
    RAISE EXCEPTION 'Invalid Work Order payload';
  END IF;

  IF public.assignment_work_order_payload_has_forbidden_key(p_payload) THEN
    RAISE EXCEPTION 'Invalid Work Order payload';
  END IF;

  IF public.assignment_work_order_payload_has_forbidden_text(p_payload) THEN
    RAISE EXCEPTION 'Invalid Work Order payload';
  END IF;

  IF jsonb_typeof(p_payload->'identity') <> 'object'
    OR jsonb_typeof(p_payload->'source') <> 'object'
    OR jsonb_typeof(p_payload->'scope') <> 'object'
    OR jsonb_typeof(p_payload->'labor') <> 'object'
    OR jsonb_typeof(p_payload->'items') <> 'array'
    OR jsonb_typeof(p_payload->'electricalSymbols') <> 'array'
    OR jsonb_typeof(p_payload->'wireQuantities') <> 'array'
    OR NOT (
      p_payload ? 'animationRoute'
      AND (
        p_payload->'animationRoute' = 'null'::jsonb
        OR jsonb_typeof(p_payload->'animationRoute') = 'object'
      )
    )
  THEN
    RAISE EXCEPTION 'Invalid Work Order payload';
  END IF;

  IF length(coalesce(p_payload #>> '{scope,title}', '')) > 200
    OR length(coalesce(p_payload #>> '{scope,description}', '')) > 4000
    OR length(coalesce(p_payload #>> '{scope,crewNotes}', '')) > 4000
    OR length(coalesce(p_payload #>> '{source,sourceFingerprint}', '')) = 0
  THEN
    RAISE EXCEPTION 'Invalid Work Order payload';
  END IF;

  v_labor := p_payload->'labor';
  IF jsonb_typeof(v_labor->'roughInHours') <> 'number'
    OR jsonb_typeof(v_labor->'trimHours') <> 'number'
    OR jsonb_typeof(v_labor->'testingHours') <> 'number'
    OR jsonb_typeof(v_labor->'cleanupHours') <> 'number'
    OR jsonb_typeof(v_labor->'totalHours') <> 'number'
    OR (v_labor->>'roughInHours')::numeric < 0
    OR (v_labor->>'trimHours')::numeric < 0
    OR (v_labor->>'testingHours')::numeric < 0
    OR (v_labor->>'cleanupHours')::numeric < 0
    OR (v_labor->>'totalHours')::numeric < 0
  THEN
    RAISE EXCEPTION 'Invalid Work Order payload';
  END IF;
EXCEPTION
  WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid Work Order payload';
END;
$$;

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
  v_payload_bytes INTEGER;
  v_status TEXT;
  v_invalid_count INTEGER;
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

  IF btrim(coalesce(p_work_package_id, '')) = ''
    OR btrim(coalesce(p_work_package_name, '')) = ''
    OR btrim(coalesce(p_project_id, '')) = ''
    OR btrim(coalesce(p_project_name, '')) = ''
    OR btrim(coalesce(p_blueprint_set_id, '')) = ''
    OR length(btrim(coalesce(p_work_package_id, ''))) > 200
    OR length(btrim(coalesce(p_work_package_name, ''))) > 200
    OR length(btrim(coalesce(p_project_id, ''))) > 200
    OR length(btrim(coalesce(p_project_name, ''))) > 200
    OR length(btrim(coalesce(p_blueprint_set_id, ''))) > 200
  THEN
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

  v_now := now();
  v_final_payload := p_work_order_payload
    || jsonb_build_object('schemaVersion', 1, 'workOrderVersion', 1)
    || jsonb_build_object(
      'identity',
      coalesce(p_work_order_payload->'identity', '{}'::jsonb)
      || jsonb_build_object(
        'assignmentId', p_assignment_id::text,
        'orgId', v_org_id::text,
        'projectId', btrim(p_project_id),
        'projectName', btrim(p_project_name),
        'workPackageId', btrim(p_work_package_id),
        'blueprintSetId', btrim(p_blueprint_set_id),
        'createdAt', to_jsonb(v_now)::text::jsonb,
        'createdBy', v_uid::text
      )
    );

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
      btrim(p_work_package_id),
      btrim(p_work_package_name),
      btrim(p_project_id),
      btrim(p_project_name),
      btrim(p_blueprint_set_id),
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
  'Atomically creates an employee task assignment and immutable Work Order payload version 1. Idempotent by org_id + client_request_id.';

CREATE OR REPLACE FUNCTION public.revoke_employee_task_assignment(
  p_assignment_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_org_id UUID;
  v_assignment_id UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_org_id := public.user_org_id();
  IF v_org_id IS NULL OR NOT public.is_org_admin_for(v_org_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT id
  INTO v_assignment_id
  FROM public.employee_task_assignments
  WHERE id = p_assignment_id
    AND org_id = v_org_id
  LIMIT 1;

  IF v_assignment_id IS NULL THEN
    RETURN jsonb_build_object(
      'revoked', false,
      'reason', 'not_found'
    );
  END IF;

  -- Delete the assignment parent only. Existing ON DELETE CASCADE constraints remove
  -- assignment_work_order_versions, assignment_snapshots, and other assignment-owned children
  -- without granting clients direct DELETE on Work Order version rows.
  DELETE FROM public.employee_task_assignments
  WHERE id = v_assignment_id
    AND org_id = v_org_id;

  RETURN jsonb_build_object(
    'revoked', true
  );
END;
$$;

COMMENT ON FUNCTION public.revoke_employee_task_assignment(UUID) IS
  'Authorized owner/admin assignment revoke. Deletes the parent assignment in the caller organization and relies on FK cascades for assignment-owned children.';

ALTER TABLE public.assignment_work_order_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS awov_owner_admin_select ON public.assignment_work_order_versions;
CREATE POLICY awov_owner_admin_select ON public.assignment_work_order_versions
  FOR SELECT
  USING (public.is_org_admin_for(org_id));

REVOKE ALL ON public.assignment_work_order_versions FROM anon;
REVOKE ALL ON public.assignment_work_order_versions FROM authenticated;
REVOKE ALL ON FUNCTION public.reject_assignment_work_order_version_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assignment_work_order_payload_has_forbidden_key(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assignment_work_order_payload_has_forbidden_text(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_assignment_work_order_payload_v1(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_employee_task_assignment_with_work_order(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID[], DATE, TEXT, JSONB
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_employee_task_assignment(UUID) FROM PUBLIC;

GRANT SELECT ON public.assignment_work_order_versions TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_employee_task_assignment_with_work_order(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID[], DATE, TEXT, JSONB
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_employee_task_assignment(UUID) TO authenticated;

COMMIT;
