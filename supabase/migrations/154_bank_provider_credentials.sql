-- BANK-2: server-only encrypted credential store + atomic connect / disconnect functions for provider items.
--
-- Builds on migration 153 (financial_provider_items). Adds exactly:
--   * financial_provider_credentials : the ONLY place a provider access token may live, and only as an AES-256-GCM
--     envelope produced server-side. A CHECK rejects anything that is not an envelope, so a plaintext token cannot be stored.
--   * financial_provider_connect_item / _disconnect_item / _mark_item_healthy : service-role-only functions so each
--     lifecycle change (item + credential) is ONE database transaction. No half-connected state is possible.
--
-- Boundaries (deliberate):
--   * Browser access: NONE. RLS is enabled, there is no policy, and every privilege is revoked from PUBLIC, anon and
--     authenticated. Only the service role (server functions) can touch the table or execute the functions.
--   * No Plaid secret, no client id, no raw provider response is stored anywhere.
--   * No transactions, accounts or ledger rows are created or modified. Connecting a bank has ZERO financial effect.
--   * Disconnecting never deletes anything: it revokes the credential and marks the item disconnected; evidence,
--     interpretations and canonical records stay.
--
-- Safe to re-run: IF NOT EXISTS / drop-guarded triggers / CREATE OR REPLACE. Apply ONLY with the reviewed single-file
-- procedure (BANK-0A). Never via `supabase db push`.
BEGIN;

CREATE TABLE IF NOT EXISTS public.financial_provider_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  provider_item_ref UUID NOT NULL,
  provider TEXT NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_]{1,31}$'),
  -- Versioned envelope `v1:<iv>:<tag>:<ciphertext>` (all base64). Plaintext tokens (e.g. "access-sandbox-...") cannot match.
  encrypted_access_token TEXT NOT NULL CHECK (
    length(encrypted_access_token) BETWEEN 40 AND 4096
    AND encrypted_access_token ~ '^v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$'
  ),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT financial_provider_credentials_id_org_unique UNIQUE (id, organization_id),
  CONSTRAINT financial_provider_credentials_item_org_fk
    FOREIGN KEY (provider_item_ref, organization_id)
    REFERENCES public.financial_provider_items(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT financial_provider_credentials_revoked_consistent CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);

-- At most ONE active credential per provider item (rotation revokes the previous one first).
CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_provider_credentials_active_item
  ON public.financial_provider_credentials (provider_item_ref) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_financial_provider_credentials_org
  ON public.financial_provider_credentials (organization_id);

CREATE OR REPLACE FUNCTION public.financial_provider_credential_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'revoked' AND NEW.status <> 'revoked' THEN
    RAISE EXCEPTION 'A revoked credential cannot be reactivated; store a new one' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'active' AND NEW.status = 'revoked' THEN
    NEW.revoked_at := coalesce(NEW.revoked_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fpc_00_immutable ON public.financial_provider_credentials;
CREATE TRIGGER trg_fpc_00_immutable BEFORE UPDATE ON public.financial_provider_credentials
  FOR EACH ROW EXECUTE FUNCTION public.financial_provider_enforce_immutable(
    'organization_id', 'provider_item_ref', 'provider', 'encrypted_access_token', 'created_at');
DROP TRIGGER IF EXISTS trg_fpc_10_guard ON public.financial_provider_credentials;
CREATE TRIGGER trg_fpc_10_guard BEFORE UPDATE ON public.financial_provider_credentials
  FOR EACH ROW EXECUTE FUNCTION public.financial_provider_credential_guard();
DROP TRIGGER IF EXISTS trg_fpc_90_updated_at ON public.financial_provider_credentials;
CREATE TRIGGER trg_fpc_90_updated_at BEFORE UPDATE ON public.financial_provider_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_cash_ledger_updated_at();

-- Server-only: RLS on, NO policy, nothing for PUBLIC/anon/authenticated.
ALTER TABLE public.financial_provider_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_provider_credentials FROM PUBLIC, anon, authenticated;

-- ── Atomic connect: item + credential in ONE transaction. Fails closed on cross-organization ownership. ──────
CREATE OR REPLACE FUNCTION public.financial_provider_connect_item(
  p_organization_id UUID,
  p_provider TEXT,
  p_provider_item_id TEXT,
  p_institution_id TEXT,
  p_institution_name TEXT,
  p_encrypted_access_token TEXT,
  p_actor UUID
)
RETURNS TABLE(item_id UUID, outcome TEXT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_item public.financial_provider_items%ROWTYPE;
  v_inserted INTEGER;
  v_outcome TEXT;
BEGIN
  IF p_organization_id IS NULL OR coalesce(p_provider, '') = '' OR coalesce(p_provider_item_id, '') = '' THEN
    RAISE EXCEPTION 'organization, provider and provider item are required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Claim the identity atomically. A concurrent first connect of the same item simply does not insert.
  INSERT INTO public.financial_provider_items (organization_id, provider, provider_item_id, institution_id, institution_name,
                                               status, connected_at, created_by)
  VALUES (p_organization_id, p_provider, p_provider_item_id, p_institution_id, p_institution_name, 'healthy', now(), p_actor)
  ON CONFLICT (provider, provider_item_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  SELECT * INTO v_item FROM public.financial_provider_items
    WHERE provider = p_provider AND provider_item_id = p_provider_item_id FOR UPDATE;

  IF v_item.organization_id <> p_organization_id THEN
    -- Never transfer ownership automatically.
    RAISE EXCEPTION 'PROVIDER_ITEM_OWNED_BY_ANOTHER_ORGANIZATION' USING ERRCODE = '42501';
  END IF;

  IF v_inserted = 1 THEN
    v_outcome := 'created';
  ELSE
    v_outcome := CASE WHEN v_item.status = 'disconnected' THEN 'reconnected' ELSE 'credential_rotated' END;
    UPDATE public.financial_provider_credentials SET status = 'revoked'
      WHERE provider_item_ref = v_item.id AND organization_id = p_organization_id AND status = 'active';
    UPDATE public.financial_provider_items
      SET status = 'healthy', status_changed_at = now(), connected_at = coalesce(connected_at, now()), disconnected_at = NULL,
          last_error_code = NULL, last_error_message = NULL, last_error_at = NULL,
          institution_id = coalesce(p_institution_id, institution_id),
          institution_name = coalesce(p_institution_name, institution_name)
      WHERE id = v_item.id;
  END IF;

  INSERT INTO public.financial_provider_credentials (organization_id, provider_item_ref, provider, encrypted_access_token)
  VALUES (p_organization_id, v_item.id, p_provider, p_encrypted_access_token);

  RETURN QUERY SELECT v_item.id, v_outcome;
END;
$$;

-- ── Atomic disconnect: revoke the credential and mark the item disconnected. Deletes nothing. ─────────────────
CREATE OR REPLACE FUNCTION public.financial_provider_disconnect_item(p_organization_id UUID, p_item_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_item public.financial_provider_items%ROWTYPE;
BEGIN
  SELECT * INTO v_item FROM public.financial_provider_items
    WHERE id = p_item_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROVIDER_ITEM_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  UPDATE public.financial_provider_credentials SET status = 'revoked'
    WHERE provider_item_ref = v_item.id AND organization_id = p_organization_id AND status = 'active';
  IF v_item.status = 'disconnected' THEN
    RETURN 'already_disconnected';
  END IF;
  UPDATE public.financial_provider_items
    SET status = 'disconnected', status_changed_at = now(), disconnected_at = now(), sync_status = 'idle'
    WHERE id = v_item.id;
  RETURN 'disconnected';
END;
$$;

-- ── Re-authentication completed: clear a login-required/error state (never touches a disconnected item). ──────
CREATE OR REPLACE FUNCTION public.financial_provider_mark_item_healthy(p_organization_id UUID, p_item_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE public.financial_provider_items
    SET status = 'healthy', status_changed_at = now(), last_error_code = NULL, last_error_message = NULL, last_error_at = NULL
    WHERE id = p_item_id AND organization_id = p_organization_id AND status IN ('login_required', 'error', 'connecting');
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.financial_provider_credential_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financial_provider_connect_item(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financial_provider_disconnect_item(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financial_provider_mark_item_healthy(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.financial_provider_connect_item(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.financial_provider_disconnect_item(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.financial_provider_mark_item_healthy(UUID, UUID) TO service_role;

COMMENT ON TABLE public.financial_provider_credentials IS
  'SERVER-ONLY encrypted provider credentials. Stores only an AES-256-GCM envelope (CHECK-enforced); never plaintext, never a provider secret. No browser access of any kind.';

COMMIT;
