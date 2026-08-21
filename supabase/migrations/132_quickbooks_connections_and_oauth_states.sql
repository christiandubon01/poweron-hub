-- =============================================================================
-- Migration 132: QBO-3A — Persistent QuickBooks connection + single-use OAuth state
-- =============================================================================
-- Adds two SERVER-ONLY tables for the live QuickBooks Online connection:
--
--   public.quickbooks_connections
--     One row per PowerOn organization (UNIQUE(organization_id)) holding the
--     encrypted OAuth credential set, connection status, and display metadata.
--     Holds accounting credentials — browser/anon/authenticated have NO direct
--     CRUD. All access is through authenticated Netlify functions using the
--     service role key (which bypasses RLS). The browser receives only the
--     sanitized status shape from qbo-connection-status.
--
--   public.quickbooks_oauth_states
--     Single-use OAuth nonce store that closes the QBO-1A replay gap. Only the
--     cryptographic hash of the signed-state nonce is persisted (never the raw
--     nonce). The callback atomically consumes a row (consumed_at IS NULL AND
--     expires_at > now) so a replay fails even while the signed state is still
--     inside its HMAC TTL. Server-only; no authenticated policies.
--
-- Token at rest:
--   encrypted_* columns hold versioned AES-256-GCM envelopes
--   (v1:<iv>:<authTag>:<ciphertext>) produced by src/services/quickbooks/
--   quickbooksTokenCrypto.ts using the server-only POWERON_QBO_TOKEN_ENCRYPTION_KEY.
--   No plaintext access token, refresh token, or realmId is ever stored.
--
-- Tenancy / authority (reuses proven repo helpers, no parallel model):
--   - organization_id -> public.organizations(id) ON DELETE RESTRICT
--   - SERVER-ONLY: no SELECT/INSERT/UPDATE/DELETE policy for authenticated.
--     RLS + REVOKE ALL from PUBLIC/anon/authenticated leaves the table readable
--     only via the service role key (Netlify functions). This is deliberate:
--     the row carries accounting credentials and must never be browser-readable.
--
-- Financial authority firewall (QBO-1A2 / QBO-3A):
--   - This migration writes no payment ledger, collected-cash, KPI, invoice_draft,
--     service ledger, or historical-payment data. Connection state is auth/
--     integration plumbing only. realmId is the QuickBooks company id, NOT a
--     PowerOn org id; PowerOn org identity comes exclusively from the validated
--     signed OAuth state.
--
-- Untouched: invoice_drafts, QBO PDF importer, Historical Payments, Anthropic/AI,
-- referral/Employee/Admin/Guardian, package.json, payment/KPI truth.
-- =============================================================================

BEGIN;

-- ── 1. quickbooks_connections ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.quickbooks_connections (
  id                          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             UUID         NOT NULL
                              REFERENCES public.organizations(id) ON DELETE RESTRICT,
  -- ONE connection row per organization. Reconnect upserts this same row.
  CONSTRAINT quickbooks_connections_organization_unique UNIQUE (organization_id),

  created_by                  UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- CONNECTION STATE
  status                      TEXT         NOT NULL DEFAULT 'connected'
                              CHECK (status IN ('connected', 'disconnected')),
  connected_at                TIMESTAMPTZ  NULL,
  disconnected_at             TIMESTAMPTZ  NULL,
  connected_by                UUID         REFERENCES auth.users(id) ON DELETE SET NULL,

  -- ENVIRONMENT METADATA (server-side; prevents sandbox/prod credential confusion)
  environment                 TEXT         NOT NULL DEFAULT 'production'
                              CHECK (environment IN ('sandbox', 'production')),

  -- DISPLAY METADATA (sanitized; safe to surface to the browser)
  company_name                TEXT         NULL,

  -- SECRET / PROVIDER AUTHORITY — versioned AES-256-GCM envelopes; never plaintext.
  encrypted_access_token      TEXT         NULL,
  encrypted_refresh_token     TEXT         NULL,
  encrypted_realm_id          TEXT         NULL,

  -- TOKEN METADATA
  access_token_expires_at     TIMESTAMPTZ  NULL,
  refresh_token_expires_at    TIMESTAMPTZ  NULL,
  last_refreshed_at           TIMESTAMPTZ  NULL,
  -- Optimistic compare-and-set guard for concurrent token refresh (rotation).
  token_version               INTEGER      NOT NULL DEFAULT 0,

  -- A connected row carries no disconnect time; a disconnected row records one.
  CONSTRAINT quickbooks_connections_status_disconnected_at_consistency CHECK (
    (status = 'connected'   AND disconnected_at IS NULL)
    OR (status = 'disconnected' AND disconnected_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.quickbooks_connections IS
  'QBO-3A: Organization-scoped persistent QuickBooks Online connection. ONE row per org. '
  'Holds encrypted OAuth credentials (AES-256-GCM envelopes) — SERVER-ONLY, no authenticated '
  'RLS policies; accessed only via Netlify functions with the service role key. '
  'realmId is the QuickBooks company id, NOT a PowerOn org id.';
COMMENT ON COLUMN public.quickbooks_connections.status IS
  'connected: live OAuth credential set is stored. disconnected: credentials cleared, '
  'reconnect upserts this same row.';
COMMENT ON COLUMN public.quickbooks_connections.environment IS
  'sandbox | production. Stored at connect time from INTUIT_API_ENV so a sandbox credential '
  'is never accidentally treated as production (and vice versa).';
COMMENT ON COLUMN public.quickbooks_connections.encrypted_access_token IS
  'AES-256-GCM envelope v1:<iv>:<authTag>:<ciphertext>. Never plaintext; never browser-readable.';
COMMENT ON COLUMN public.quickbooks_connections.encrypted_refresh_token IS
  'AES-256-GCM envelope v1:<iv>:<authTag>:<ciphertext>. Rotated authoritatively on refresh.';
COMMENT ON COLUMN public.quickbooks_connections.encrypted_realm_id IS
  'AES-256-GCM envelope of the QuickBooks company id. Display metadata only; never selects a PowerOn org.';
COMMENT ON COLUMN public.quickbooks_connections.token_version IS
  'Optimistic compare-and-set guard for concurrent refresh. UPDATE ... WHERE token_version = N '
  'then set N+1; a zero-row update means another refresh won and the loser must reload.';

-- ── 2. quickbooks_oauth_states ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.quickbooks_oauth_states (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Only the hash of the signed-state nonce is stored. The raw nonce travels in
  -- the signed HMAC state and is recovered server-side on callback to look this up.
  nonce_hash        TEXT         NOT NULL,
  CONSTRAINT quickbooks_oauth_states_nonce_hash_unique UNIQUE (nonce_hash),

  organization_id   UUID         NOT NULL
                    REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id           UUID         NOT NULL
                    REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Constrained safe PowerOn relative/internal return destination (validated
  -- server-side at authorize time; never an open redirect). NULL => app default.
  return_path       TEXT         NULL,
  expires_at        TIMESTAMPTZ  NOT NULL,
  consumed_at       TIMESTAMPTZ  NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.quickbooks_oauth_states IS
  'QBO-3A: Single-use OAuth nonce store closing the QBO-1A replay gap. Stores only '
  'sha256(nonce) — never the raw nonce. Callback atomically consumes a live row; a '
  'replay fails even inside the signed-state HMAC TTL. SERVER-ONLY, no authenticated policies.';
COMMENT ON COLUMN public.quickbooks_oauth_states.nonce_hash IS
  'sha256(raw nonce) hex. The raw nonce is bound into the signed HMAC state, not stored here.';
COMMENT ON COLUMN public.quickbooks_oauth_states.return_path IS
  'Safe relative PowerOn path to redirect to after callback (validated allowlist). Never external.';

-- ── 3. Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_quickbooks_connections_organization_id
  ON public.quickbooks_connections (organization_id);

CREATE INDEX IF NOT EXISTS idx_quickbooks_oauth_states_expires_at
  ON public.quickbooks_oauth_states (expires_at);

-- ── 4. updated_at trigger (connections) ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_quickbooks_connections_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quickbooks_connections_set_updated_at ON public.quickbooks_connections;
CREATE TRIGGER trg_quickbooks_connections_set_updated_at
  BEFORE UPDATE ON public.quickbooks_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.set_quickbooks_connections_updated_at();

-- ── 5. RLS — SERVER-ONLY (no authenticated policies) ─────────────────────────

ALTER TABLE public.quickbooks_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quickbooks_oauth_states  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.quickbooks_connections FROM PUBLIC;
REVOKE ALL ON TABLE public.quickbooks_connections FROM anon;
REVOKE ALL ON TABLE public.quickbooks_connections FROM authenticated;

REVOKE ALL ON TABLE public.quickbooks_oauth_states FROM PUBLIC;
REVOKE ALL ON TABLE public.quickbooks_oauth_states FROM anon;
REVOKE ALL ON TABLE public.quickbooks_oauth_states FROM authenticated;

-- Deliberately NO CREATE POLICY ... TO authenticated ... on either table.
-- The browser (anon or authenticated JWT) has no direct CRUD path to these
-- token-bearing rows. Authenticated Netlify functions use the service role key
-- (SUPABASE_SERVICE_ROLE_KEY), which bypasses RLS, as the sole data authority.
GRANT USAGE ON SCHEMA public TO authenticated;

-- ── 6. Postconditions ────────────────────────────────────────────────────────

DO $$
DECLARE
  v_exists           boolean;
  v_rls              boolean;
  v_anon_grant       boolean;
  v_auth_policy      int;
  v_unique_ok        boolean;
  v_col_exists       boolean;
  v_default          text;
BEGIN
  -- quickbooks_connections exists.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'quickbooks_connections'
  ) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: quickbooks_connections missing';
  END IF;

  -- quickbooks_oauth_states exists.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'quickbooks_oauth_states'
  ) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: quickbooks_oauth_states missing';
  END IF;

  -- RLS enabled on both.
  SELECT relrowsecurity INTO v_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'quickbooks_connections';
  IF NOT v_rls THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: RLS not enabled on quickbooks_connections';
  END IF;

  SELECT relrowsecurity INTO v_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'quickbooks_oauth_states';
  IF NOT v_rls THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: RLS not enabled on quickbooks_oauth_states';
  END IF;

  -- anon must have NO direct table access on either.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'quickbooks_connections'
      AND grantee = 'anon' AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
  ) INTO v_anon_grant;
  IF v_anon_grant THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: anon must not access quickbooks_connections';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'quickbooks_oauth_states'
      AND grantee = 'anon' AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
  ) INTO v_anon_grant;
  IF v_anon_grant THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: anon must not access quickbooks_oauth_states';
  END IF;

  -- SERVER-ONLY: NO authenticated RLS policies on either table.
  SELECT count(*) INTO v_auth_policy
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'quickbooks_connections';
  IF v_auth_policy > 0 THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: quickbooks_connections must have no RLS policies (server-only)';
  END IF;

  SELECT count(*) INTO v_auth_policy
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'quickbooks_oauth_states';
  IF v_auth_policy > 0 THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: quickbooks_oauth_states must have no RLS policies (server-only)';
  END IF;

  -- One connection row per organization (UNIQUE).
  SELECT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'quickbooks_connections_organization_unique'
      AND i.indisunique
  ) INTO v_unique_ok;
  IF NOT v_unique_ok THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: quickbooks_connections.organization_id must be UNIQUE';
  END IF;

  -- nonce_hash UNIQUE.
  SELECT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'quickbooks_oauth_states_nonce_hash_unique'
      AND i.indisunique
  ) INTO v_unique_ok;
  IF NOT v_unique_ok THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: quickbooks_oauth_states.nonce_hash must be UNIQUE';
  END IF;

  -- status CHECK + environment CHECK columns exist.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'quickbooks_connections'
      AND column_name = 'status'
  ) INTO v_col_exists;
  IF NOT v_col_exists THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: status column missing';
  END IF;

  -- token_version default 0.
  SELECT column_default INTO v_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'quickbooks_connections'
    AND column_name = 'token_version';
  IF v_default IS NULL OR v_default NOT LIKE '%0%' THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: token_version default must be 0';
  END IF;
END $$;

COMMIT;