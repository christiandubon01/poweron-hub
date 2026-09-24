-- 135_agent_control_plane.sql
-- CT-CORE-1: Supabase control plane for the local Agent Host.
--
-- Scope: this is a SMALL control plane only:
--   1. agent_host_presence    — is a local Agent Host alive for this org+repo?
--   2. agent_control_requests — typed browser→Host requests (create_plan, approve_plan)
--   3. agent_run_snapshots    — safe, redacted run snapshots published by the Host
--
-- The LOCAL Agent Host remains the orchestration authority (its SQLite store holds
-- Runs/Tasks/Attempts/Attempts/events). Supabase NEVER stores prompts, source content,
-- stdout/stderr, provider transcripts, secrets, tokens, or env data.
--
-- Security model:
--   - anon: DENIED everywhere (no policies granted to anon; REVOKE where table is new).
--   - authenticated owner/admin of the owning org: create + read their org's requests,
--     read presence + snapshots for their org. Cross-org: denied by policy.
--   - The local Host worker connects with the server-side service role key and is
--     expected to filter rows by its own org_id + repo_key before acting. It never
--     exposes that key to provider child processes.
--   - NO browser→shell request type exists. request_type is CHECK-constrained to
--     create_plan | approve_plan | cancel_run. There is no command/argv/script type.

BEGIN;

-- ── 1. agent_host_presence ────────────────────────────────────────────────────
-- One row per (org, repo_key, host_instance): the Host worker upserts a heartbeat
-- every HEARTBEAT_INTERVAL_MS. The app derives truth: fresh row → Connected,
-- stale row → Stale, no row → Unavailable. Opening the app does NOT imply a Host.

CREATE TABLE IF NOT EXISTS public.agent_host_presence (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations (id) ON DELETE RESTRICT,
  -- repo_key = sha256(normalized canonical repo path), first 16 hex chars,
  -- as produced by the local Agent Host (agent-host/lib/statePaths.ts createRepoKey).
  repo_key            text NOT NULL CHECK (repo_key ~ '^[0-9a-f]{16}$'),
  host_instance_id    text NOT NULL,
  status              text NOT NULL CHECK (status IN ('connected','stale')),
  host_version        text,
  -- Providers the Host reports as discovered (names only — never paths/args/secrets).
  providers           jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, repo_key, host_instance_id)
);

COMMENT ON TABLE public.agent_host_presence IS
  'CT-CORE-1 control plane: live heartbeat of a local Agent Host for one org+repo. The local Host remains orchestration authority; this row is presence truth only.';
COMMENT ON COLUMN public.agent_host_presence.repo_key IS
  'sha256(normalized canonical repo path) first 16 hex — created HOST-side. The browser copies this value from presence and echoes it in control requests; it never sends filesystem paths.';
COMMENT ON COLUMN public.agent_host_presence.providers IS
  'JSON array of discovered provider ids (names only). No paths, args, env, or credentials.';
COMMENT ON COLUMN public.agent_host_presence.last_seen_at IS
  'Freshness authority: row is fresh when now() - last_seen_at < 30s (HEARTBEAT_STALE_MS).';

CREATE INDEX IF NOT EXISTS idx_agent_host_presence_org_repo
  ON public.agent_host_presence (organization_id, repo_key, last_seen_at DESC);

-- ── 2. agent_control_requests ──────────────────────────────────────────────────
-- Typed, idempotent, single-claim control requests from the browser to the Host.
-- Lifecycle: pending → claimed → completed | failed. Claim is atomic (see §4),
-- so a request can never execute twice.

CREATE TABLE IF NOT EXISTS public.agent_control_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations (id) ON DELETE RESTRICT,
  repo_key            text NOT NULL CHECK (repo_key ~ '^[0-9a-f]{16}$'),
  request_type        text NOT NULL CHECK (request_type IN ('create_plan','approve_plan','cancel_run')),
  -- Browser-supplied idempotency key; Host treats (clientRequestId) as the
  -- duplicate-submission guard so a retried Create Plan never plans twice.
  client_request_id   text NOT NULL,
  -- Typed safe payload. create_plan: {scope, constraints?, requestedRouting?}.
  -- approve_plan: {planId, planHash}. NEVER filesystem paths, commands, or secrets.
  payload             jsonb NOT NULL,
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','claimed','completed','failed','cancelled')),
  claimed_at          timestamptz,
  claimed_by_host     text,
  completed_at        timestamptz,
  -- Safe result only. For create_plan: the validated structured plan + planHash
  -- (so approve_plan can reference the EXACT plan). For approve_plan: the runId.
  -- No prompts, no model transcripts, no diffs, no stdout/stderr.
  result              jsonb,
  error               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, client_request_id)
);

COMMENT ON TABLE public.agent_control_requests IS
  'CT-CORE-1 control plane: typed browser→Host requests (create_plan / approve_plan / cancel_run). No shell/command/argv request type can exist — request_type is CHECK-constrained.';
COMMENT ON COLUMN public.agent_control_requests.client_request_id IS
  'Browser idempotency key; UNIQUE per org so duplicate submissions of the same Create Plan land on the same row instead of planning twice.';
COMMENT ON COLUMN public.agent_control_requests.payload IS
  'Typed safe payload only: create_plan={scope,constraints?,requestedRouting?}, approve_plan={planId,planHash}. The Host maps repo_key→canonical path locally; browser paths are rejected.';
COMMENT ON COLUMN public.agent_control_requests.result IS
  'Safe result only. create_plan → validated structured plan + planHash; approve_plan → runId. Never source content, prompts, model output beyond the structured plan, or credentials.';

CREATE INDEX IF NOT EXISTS idx_agent_control_requests_org_status
  ON public.agent_control_requests (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_control_requests_org_repo_status
  ON public.agent_control_requests (organization_id, repo_key, status, created_at DESC);

-- ── 3. agent_run_snapshots ────────────────────────────────────────────────────
-- One row per (org, repo_key, runId): the Host upserts a SAFE snapshot after each
-- supervisor tick. Safe fields only (ids/titles/status/timestamps/model names/
-- changeset-ready flag + safe path metadata). The local Host store remains the
-- detailed authority; this is what the browser renders.

CREATE TABLE IF NOT EXISTS public.agent_run_snapshots (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations (id) ON DELETE RESTRICT,
  repo_key            text NOT NULL CHECK (repo_key ~ '^[0-9a-f]{16}$'),
  run_id              text NOT NULL,
  -- Owner-entered objective (already displayed in app UI) — safe to republish.
  objective           text,
  status              text NOT NULL
                        CHECK (status IN ('pending','running','paused','completed','failed','cancelled')),
  -- Safe snapshot JSONB (§29 whitelist). Never: prompts, source content, env,
  -- tokens, raw stdout/stderr, provider transcripts.
  snapshot            jsonb NOT NULL,
  published_at        timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, repo_key, run_id)
);

COMMENT ON TABLE public.agent_run_snapshots IS
  'CT-CORE-1 control plane: safe run snapshots published by the local Host after each supervisor tick. Local Host store remains orchestration authority.';
COMMENT ON COLUMN public.agent_run_snapshots.snapshot IS
  'Safe snapshot whitelist: run id/objective/status/timestamps; task ids/titles/roles/statuses/positions/deps/plannedAreas/profile label; attempt ids/ordinal/status/requested+reported model/retry cause; gate safe reason; changeset ready flag + safe path metadata.';

CREATE INDEX IF NOT EXISTS idx_agent_run_snapshots_org_repo
  ON public.agent_run_snapshots (organization_id, repo_key, updated_at DESC);

-- ── 4. RPC: atomic claim ──────────────────────────────────────────────────────
-- Single UPDATE ... WHERE status='pending' RETURNING: Postgres row lock makes the
-- claim atomic, so two Host workers (or a racing double-poll) can never both claim
-- the same request. The claim also filters by repo_keys so a Host only ever claims
-- work for repos it actually owns (fail-closed for anything else).

CREATE OR REPLACE FUNCTION public.claim_agent_control_requests(
  p_organization_id uuid,
  p_repo_keys       text[],
  p_host_instance_id text,
  p_limit           int DEFAULT 10
)
RETURNS SETOF public.agent_control_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'p_limit out of range';
  END IF;

  RETURN QUERY
  UPDATE public.agent_control_requests r
     SET status          = 'claimed',
         claimed_at     = now(),
         claimed_by_host = p_host_instance_id,
         updated_at     = now()
   WHERE r.id IN (
     SELECT c.id
       FROM public.agent_control_requests c
      WHERE c.status = 'pending'
        AND c.organization_id = p_organization_id
        AND c.repo_key = ANY (p_repo_keys)
      ORDER BY c.created_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING r.*;
END;
$$;

COMMENT ON FUNCTION public.claim_agent_control_requests IS
  'CT-CORE-1: atomically claims pending control requests for one org and a specific repo_key set. UPDATE ... WHERE status=pending with FOR UPDATE SKIP LOCKED guarantees exactly-once execution.';

REVOKE ALL ON FUNCTION public.claim_agent_control_requests(uuid, text[], text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_agent_control_requests(uuid, text[], text, int) FROM anon;
REVOKE ALL ON FUNCTION public.claim_agent_control_requests(uuid, text[], text, int) FROM authenticated;

-- ── 5. updated_at triggers ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_agent_control_plane_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_host_presence_set_updated_at ON public.agent_host_presence;
CREATE TRIGGER trg_agent_host_presence_set_updated_at
  BEFORE UPDATE ON public.agent_host_presence
  FOR EACH ROW EXECUTE FUNCTION public.set_agent_control_plane_updated_at();

DROP TRIGGER IF EXISTS trg_agent_control_requests_set_updated_at ON public.agent_control_requests;
CREATE TRIGGER trg_agent_control_requests_set_updated_at
  BEFORE UPDATE ON public.agent_control_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_agent_control_plane_updated_at();

DROP TRIGGER IF EXISTS trg_agent_run_snapshots_set_updated_at ON public.agent_run_snapshots;
CREATE TRIGGER trg_agent_run_snapshots_set_updated_at
  BEFORE UPDATE ON public.agent_run_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.set_agent_control_plane_updated_at();

-- ── 6. RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.agent_host_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_control_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_run_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.agent_host_presence FROM PUBLIC;
REVOKE ALL ON TABLE public.agent_control_requests FROM PUBLIC;
REVOKE ALL ON TABLE public.agent_run_snapshots FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_agent_control_plane_updated_at() FROM PUBLIC;

-- anon: no policies at all → anon is fully DENIED on all three tables and the
-- claim function. (Tables stay REVOKE'd from anon above as belt-and-braces.)

-- Owner/admin of the owning org may read presence for their org; cross-org denied.
CREATE POLICY agent_host_presence_owner_admin_select
  ON public.agent_host_presence FOR SELECT
  TO authenticated
  USING (
    organization_id = public.user_org_id()
    AND public.is_org_admin_for(organization_id)
  );

-- Owner/admin may create and read control requests for their own org only.
CREATE POLICY agent_control_requests_owner_admin_select
  ON public.agent_control_requests FOR SELECT
  TO authenticated
  USING (
    organization_id = public.user_org_id()
    AND public.is_org_admin_for(organization_id)
  );

CREATE POLICY agent_control_requests_owner_admin_insert
  ON public.agent_control_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = public.user_org_id()
    AND public.is_org_admin_for(organization_id)
  );

-- Owner/admin may read run snapshots for their org; cross-org denied.
-- (Only the Host writes snapshots — with the server-side key, not a JWT policy.)
CREATE POLICY agent_run_snapshots_owner_admin_select
  ON public.agent_run_snapshots FOR SELECT
  TO authenticated
  USING (
    organization_id = public.user_org_id()
    AND public.is_org_admin_for(organization_id)
  );

-- NOTE: no UPDATE/DELETE policies for authenticated on any of these tables.
-- All mutations (presence upsert, claim, request completion, snapshot upsert)
-- are performed by the local Host worker using the server-side service role,
-- which bypasses RLS. The browser can only INSERT requests and SELECT everything.

COMMIT;