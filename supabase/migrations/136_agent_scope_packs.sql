-- 136_agent_scope_packs.sql
-- ATB-5: durable Scope Packs for the existing agent control plane.
--
-- Scope:
--   1. agent_scope_packs — structured, bounded handoff contracts (NO raw file text).
--   2. Extend agent_control_requests.request_type CHECK with import_scope_pack.
--
-- Privacy:
--   Persist only source filename, SHA-256, structured contract, reconciliation
--   metadata, and owner-approved edits. NEVER raw handoff contents, local
--   filesystem paths, secrets, or environment data.
--
-- Security (same pattern as 135):
--   - anon: no privileges
--   - authenticated: SELECT only, granted after REVOKE so the owner/admin
--     RLS policy is usable. No INSERT, UPDATE, or DELETE.
--   - owner/admin of the owning org: SELECT same-org packs (RLS)
--   - normal employees: no Scope Pack access
--   - writes: Host via service role default privileges (not revoked here)
--   - org isolation + repo_key scoping are mandatory
--   - import_scope_pack request payloads are allowlisted before insert
--
-- This migration is created locally and is NOT applied remotely in ATB-5.

BEGIN;

-- ── 1. Extend typed control requests ──────────────────────────────────────────
-- Inline CHECK from 135 is named agent_control_requests_request_type_check.

ALTER TABLE public.agent_control_requests
  DROP CONSTRAINT IF EXISTS agent_control_requests_request_type_check;

ALTER TABLE public.agent_control_requests
  ADD CONSTRAINT agent_control_requests_request_type_check
  CHECK (request_type IN ('create_plan', 'approve_plan', 'cancel_run', 'import_scope_pack'));

COMMENT ON TABLE public.agent_control_requests IS
  'CT-CORE-1 control plane: typed browser→Host requests (create_plan / approve_plan / cancel_run / import_scope_pack). No shell/command/argv request type can exist — request_type is CHECK-constrained.';
COMMENT ON COLUMN public.agent_control_requests.payload IS
  'Typed safe payload only. create_plan={scope,constraints?,requestedRouting?,scopePackId?,scopePackVersion?,scopePackPhaseId?}. approve_plan={planId,planHash}. cancel_run keeps its existing payload. import_scope_pack is an allowlisted Scope Pack draft of at most 196608 bytes. NEVER raw file contents, filesystem paths, commands, or secrets.';

-- ── 2. agent_scope_packs ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.agent_scope_packs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations (id) ON DELETE RESTRICT,
  repo_key              text NOT NULL CHECK (repo_key ~ '^[0-9a-f]{16}$'),
  title                 text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  source_filename       text NOT NULL CHECK (
                          char_length(source_filename) BETWEEN 1 AND 260
                          AND source_filename ~* '\.(md|txt)$'
                          AND source_filename !~ '[\\/]'
                        ),
  source_hash           text NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  -- Structured contract only. Bounded by Host validators. Never raw source.
  pack                  jsonb NOT NULL,
  reconciliation_state  text NOT NULL DEFAULT 'unverified'
                          CHECK (reconciliation_state IN ('unverified', 'current', 'stale', 'conflict')),
  current_phase_id      text,
  version               integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  -- Idempotency: one import request creates at most one pack row.
  source_request_id     text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  last_reconciled_at    timestamptz,
  UNIQUE (organization_id, source_request_id)
);

COMMENT ON TABLE public.agent_scope_packs IS
  'ATB-5 Scope Packs: durable structured handoff contracts per org+repo. Raw uploaded documents, local paths, secrets, and env data are never stored.';
COMMENT ON COLUMN public.agent_scope_packs.source_filename IS
  'Original basename only (.md/.txt). Never a local filesystem path.';
COMMENT ON COLUMN public.agent_scope_packs.source_hash IS
  'SHA-256 hex of the selected file bytes. Used to warn on duplicate imports.';
COMMENT ON COLUMN public.agent_scope_packs.pack IS
  'Bounded structured contract (intent, claims, locked rules, phases, acceptance). Never raw handoff text.';
COMMENT ON COLUMN public.agent_scope_packs.source_request_id IS
  'client_request_id of the import_scope_pack request that created this row. UNIQUE per org for idempotency.';
COMMENT ON COLUMN public.agent_scope_packs.version IS
  'Owner-controlled contract version. Reconciliation refreshes last_reconciled_at without incrementing this.';

CREATE INDEX IF NOT EXISTS idx_agent_scope_packs_org_repo
  ON public.agent_scope_packs (organization_id, repo_key, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_scope_packs_org_hash
  ON public.agent_scope_packs (organization_id, repo_key, source_hash);

DROP TRIGGER IF EXISTS trg_agent_scope_packs_set_updated_at ON public.agent_scope_packs;
CREATE TRIGGER trg_agent_scope_packs_set_updated_at
  BEFORE UPDATE ON public.agent_scope_packs
  FOR EACH ROW EXECUTE FUNCTION public.set_agent_control_plane_updated_at();

-- ── 3. RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.agent_scope_packs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.agent_scope_packs FROM PUBLIC;
REVOKE ALL ON TABLE public.agent_scope_packs FROM anon;
REVOKE ALL ON TABLE public.agent_scope_packs FROM authenticated;

-- Owner/admin of the owning org may read same-org packs. Cross-org denied.
-- Employees have no policy → denied. Browser never writes pack rows.
CREATE POLICY agent_scope_packs_owner_admin_select
  ON public.agent_scope_packs FOR SELECT
  TO authenticated
  USING (
    organization_id = public.user_org_id()
    AND public.is_org_admin_for(organization_id)
  );

-- RLS does not grant privileges. SELECT is restored only for authenticated,
-- after the revoke above. The policy still limits rows to the caller's org
-- and to owner/admin. anon stays revoked. No write privilege is granted.
GRANT SELECT ON TABLE public.agent_scope_packs TO authenticated;

-- ── 4. import_scope_pack payload firewall ────────────────────────────────────
-- Direct table insert is the request seam (no separate RPC). Reject unknown
-- or oversized import payloads before the row is stored. Other request types
-- are unchanged.

CREATE OR REPLACE FUNCTION public.enforce_import_scope_pack_payload()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  allowed text[] := ARRAY[
    'title', 'sourceFilename', 'sourceHash', 'historicalCheckpoint', 'intent',
    'foundationClaims', 'lockedRules', 'doNotTouch', 'roadmapPhases', 'currentPhaseId',
    'acceptanceCriteria', 'runtimeAcceptanceRequired', 'ownerDecisions',
    'supersededDecisions', 'knownRisks', 'relatedAppAreas', 'forceNewVersion'
  ];
  phase_allowed text[] := ARRAY['id', 'title', 'goal', 'executionIntent'];
  key text;
  phase jsonb;
  item jsonb;
  list_key text;
  max_items int;
  max_chars int;
  phase_ids text[] := ARRAY[]::text[];
  phase_id text;
  current_phase text;
BEGIN
  IF NEW.request_type IS DISTINCT FROM 'import_scope_pack' THEN
    RETURN NEW;
  END IF;

  IF NEW.payload IS NULL OR jsonb_typeof(NEW.payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'IMPORT_PAYLOAD_REJECTED' USING ERRCODE = '23514';
  END IF;

  -- 196608 = 192 KiB. Character-maximum contract is 182241 compact bytes.
  -- A 256 KiB raw handoff (262144) cannot be stored.
  IF octet_length(NEW.payload::text) > 196608 THEN
    RAISE EXCEPTION 'IMPORT_PAYLOAD_REJECTED' USING ERRCODE = '23514';
  END IF;

  FOR key IN SELECT jsonb_object_keys(NEW.payload)
  LOOP
    IF NOT (key = ANY (allowed)) THEN
      RAISE EXCEPTION 'IMPORT_PAYLOAD_REJECTED' USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF jsonb_typeof(NEW.payload->'title') IS DISTINCT FROM 'string'
     OR char_length(btrim(NEW.payload->>'title')) < 1
     OR char_length(btrim(NEW.payload->>'title')) > 160
     OR jsonb_typeof(NEW.payload->'sourceFilename') IS DISTINCT FROM 'string'
     OR char_length(btrim(NEW.payload->>'sourceFilename')) < 1
     OR char_length(btrim(NEW.payload->>'sourceFilename')) > 260
     OR btrim(NEW.payload->>'sourceFilename') !~* '\.(md|txt)$'
     OR btrim(NEW.payload->>'sourceFilename') ~ '[\\/]'
     OR btrim(NEW.payload->>'sourceFilename') ~ '^[A-Za-z]:'
     OR btrim(NEW.payload->>'sourceHash') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'IMPORT_PAYLOAD_REJECTED' USING ERRCODE = '23514';
  END IF;

  IF NEW.payload ? 'intent'
     AND jsonb_typeof(NEW.payload->'intent') IS DISTINCT FROM 'null'
     AND (
       jsonb_typeof(NEW.payload->'intent') IS DISTINCT FROM 'string'
       OR char_length(btrim(NEW.payload->>'intent')) > 4000
     ) THEN
    RAISE EXCEPTION 'IMPORT_PAYLOAD_REJECTED' USING ERRCODE = '23514';
  END IF;

  IF NEW.payload ? 'historicalCheckpoint'
     AND jsonb_typeof(NEW.payload->'historicalCheckpoint') IS DISTINCT FROM 'null'
     AND (
       jsonb_typeof(NEW.payload->'historicalCheckpoint') IS DISTINCT FROM 'string'
       OR char_length(btrim(NEW.payload->>'historicalCheckpoint')) > 200
     ) THEN
    RAISE EXCEPTION 'IMPORT_PAYLOAD_REJECTED' USING ERRCODE = '23514';
  END IF;

  FOR list_key, max_items, max_chars IN
    SELECT * FROM (VALUES
      ('foundationClaims'::text, 32, 800),
      ('lockedRules', 32, 800),
      ('doNotTouch', 32, 800),
      ('acceptanceCriteria', 24, 800),
      ('ownerDecisions', 24, 800),
      ('supersededDecisions', 24, 800),
      ('knownRisks', 16, 800),
      ('relatedAppAreas', 16, 200)
    ) AS lists(list_key, max_items, max_chars)
  LOOP
    IF NEW.payload ? list_key AND jsonb_typeof(NEW.payload->list_key) IS DISTINCT FROM 'null' THEN
      IF jsonb_typeof(NEW.payload->list_key) IS DISTINCT FROM 'array'
         OR jsonb_array_length(NEW.payload->list_key) > max_items THEN
        RAISE EXCEPTION 'IMPORT_PAYLOAD_REJECTED' USING ERRCODE = '23514';
      END IF;
      FOR item IN SELECT value FROM jsonb_array_elements(NEW.payload->list_key)
      LOOP
        IF jsonb_typeof(item) IS DISTINCT FROM 'string'
           OR char_length(btrim(item #>> '{}')) < 1
           OR char_length(btrim(item #>> '{}')) > max_chars THEN
          RAISE EXCEPTION 'IMPORT_PAYLOAD_REJECTED' USING ERRCODE = '23514';
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  IF jsonb_typeof(NEW.payload->'roadmapPhases') IS DISTINCT FROM 'array'
     OR jsonb_array_length(NEW.payload->'roadmapPhases') > 24 THEN
    RAISE EXCEPTION 'IMPORT_PAYLOAD_REJECTED' USING ERRCODE = '23514';
  END IF;

  FOR phase IN SELECT value FROM jsonb_array_elements(NEW.payload->'roadmapPhases')
  LOOP
    IF jsonb_typeof(phase) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'IMPORT_PAYLOAD_REJECTED' USING ERRCODE = '23514';
    END IF;
    FOR key IN SELECT jsonb_object_keys(phase)
    LOOP
      IF NOT (key = ANY (phase_allowed)) THEN
        RAISE EXCEPTION 'IMPORT_PAYLOAD_REJECTED' USING ERRCODE = '23514';
      END IF;
    END LOOP;
    phase_id := btrim(phase->>'id');
    IF phase_id IS NULL
       OR char_length(phase_id) < 1
       OR char_length(phase_id) > 64
       OR phase_id = ANY (phase_ids)
       OR char_length(btrim(phase->>'title')) < 1
       OR char_length(btrim(phase->>'title')) > 160
       OR char_length(btrim(phase->>'goal')) < 1
       OR char_length(btrim(phase->>'goal')) > 800 THEN
      RAISE EXCEPTION 'IMPORT_PAYLOAD_REJECTED' USING ERRCODE = '23514';
    END IF;
    IF phase ? 'executionIntent'
       AND jsonb_typeof(phase->'executionIntent') IS DISTINCT FROM 'null'
       AND (
         jsonb_typeof(phase->'executionIntent') IS DISTINCT FROM 'string'
         OR (phase->>'executionIntent') NOT IN ('audit', 'implementation', 'verification', 'research')
       ) THEN
      RAISE EXCEPTION 'IMPORT_PAYLOAD_REJECTED' USING ERRCODE = '23514';
    END IF;
    phase_ids := phase_ids || phase_id;
  END LOOP;

  IF NEW.payload ? 'currentPhaseId'
     AND jsonb_typeof(NEW.payload->'currentPhaseId') IS DISTINCT FROM 'null'
     AND btrim(NEW.payload->>'currentPhaseId') <> '' THEN
    current_phase := btrim(NEW.payload->>'currentPhaseId');
    IF current_phase IS NULL
       OR char_length(current_phase) > 64
       OR (cardinality(phase_ids) > 0 AND NOT (current_phase = ANY (phase_ids))) THEN
      RAISE EXCEPTION 'IMPORT_PAYLOAD_REJECTED' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.payload ? 'runtimeAcceptanceRequired'
     AND jsonb_typeof(NEW.payload->'runtimeAcceptanceRequired') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'IMPORT_PAYLOAD_REJECTED' USING ERRCODE = '23514';
  END IF;

  IF NEW.payload ? 'forceNewVersion'
     AND jsonb_typeof(NEW.payload->'forceNewVersion') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'IMPORT_PAYLOAD_REJECTED' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.enforce_import_scope_pack_payload() IS
  'Rejects import_scope_pack rows whose payload is not the allowlisted Scope Pack draft or exceeds 196608 bytes. create_plan, approve_plan, and cancel_run are ignored.';

DROP TRIGGER IF EXISTS trg_agent_control_requests_import_payload ON public.agent_control_requests;
CREATE TRIGGER trg_agent_control_requests_import_payload
  BEFORE INSERT OR UPDATE OF payload, request_type
  ON public.agent_control_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_import_scope_pack_payload();

COMMIT;
