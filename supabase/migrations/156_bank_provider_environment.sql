-- BANK-6P: durable Sandbox / Production separation for provider Items, and a database-level wall between provider evidence and canonical records.
--
-- Why this is required (each point is proven on a real database in the BANK-6P tests):
--   1. Nothing in the database said which environment an Item belongs to; "sandbox" existed only as a code constant. Every existing Item was created
--      while the server accepted sandbox ONLY, so they are backfilled as 'sandbox'. A Production Item must be recorded as such, explicitly, at connect.
--   2. The ledger accepted browser-supplied rows with source_type 'future_provider', and the browser could insert/update 'ledger_match' interpretations
--      (the link between provider evidence and a ledger row). Neither has any browser use. Provider-sourced canonical records may only ever be created by a
--      future server-side, owner-confirmed function; this migration closes the direct door and adds a second, independent wall below it.
--   3. Provider evidence must not become canonical in this phase. Even for the server role, a ledger row that names a provider transaction as its source,
--      and a 'ledger_match' interpretation, are refused: SANDBOX evidence permanently (SANDBOX_EVIDENCE_NOT_ADOPTABLE), PRODUCTION evidence until BANK-6
--      delivers the explicit, owner-confirmed adoption function with a historical baseline cutoff and duplicate-safe matching
--      (PROVIDER_ADOPTION_NOT_ENABLED). BANK-6 will replace the two guard functions; until then NOTHING provider-sourced can enter the ledger.
--
-- What this does NOT do: it creates no row in any financial table, changes no balance, obligation, project, debt or payroll record, deletes nothing,
-- does not touch existing Sandbox Items / transactions / interpretations / mappings, and adds no provider-adoption function (that is a later,
-- separately approved phase). Existing RLS policies are replaced ONLY on the two INSERT/UPDATE paths described above.
--
-- Security model: the two guard functions are SECURITY DEFINER because they must read financial_provider_items, which has deliberately NO browser
-- policy (server-only). Each has a fixed search_path, is read-only, performs no write, and has EXECUTE revoked from everyone (a trigger function is
-- not callable as a normal function). The connect function keeps migration 154's SECURITY INVOKER / service_role-only convention.
--
-- Rollback (before BANK-6 replaces the guards): restore the previous policies, drop the two triggers and functions, drop the 8-arg connect function,
-- drop the environment column. One transaction: a failed apply leaves the database exactly as it was. Safe to re-run.
--
-- Apply ONLY with the reviewed single-file procedure (BANK-0A). Never via `supabase db push`. Do not modify migrations 153/154/155.
BEGIN;

-- ── 1. Environment on every provider Item (backfill = 'sandbox', which is true of every existing row) ───────────────────────
ALTER TABLE public.financial_provider_items ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'sandbox';
ALTER TABLE public.financial_provider_items DROP CONSTRAINT IF EXISTS financial_provider_items_environment_check;
ALTER TABLE public.financial_provider_items
  ADD CONSTRAINT financial_provider_items_environment_check CHECK (environment IN ('sandbox', 'production'));
-- No default from here on: a new Item must state its environment. A missing value is an error, never a silent 'sandbox' or 'production'.
ALTER TABLE public.financial_provider_items ALTER COLUMN environment DROP DEFAULT;
COMMENT ON COLUMN public.financial_provider_items.environment IS
  'Where the Item lives at the provider. Set once at connect (server configuration), immutable, never inferred. Sandbox evidence can never be adopted into canonical records.';

DROP TRIGGER IF EXISTS trg_fpi_00_immutable ON public.financial_provider_items;
CREATE TRIGGER trg_fpi_00_immutable BEFORE UPDATE ON public.financial_provider_items
  FOR EACH ROW EXECUTE FUNCTION public.financial_provider_enforce_immutable('organization_id', 'provider', 'provider_item_id', 'environment', 'created_at', 'created_by');

-- ── 2. Connect: the environment is an explicit argument ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.financial_provider_connect_item(
  p_organization_id UUID,
  p_provider TEXT,
  p_provider_item_id TEXT,
  p_institution_id TEXT,
  p_institution_name TEXT,
  p_encrypted_access_token TEXT,
  p_actor UUID,
  p_environment TEXT
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
  IF p_environment IS NULL OR p_environment NOT IN ('sandbox', 'production') THEN
    RAISE EXCEPTION 'PROVIDER_ENVIRONMENT_REQUIRED' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO public.financial_provider_items (organization_id, provider, provider_item_id, institution_id, institution_name,
                                               status, connected_at, created_by, environment)
  VALUES (p_organization_id, p_provider, p_provider_item_id, p_institution_id, p_institution_name, 'healthy', now(), p_actor, p_environment)
  ON CONFLICT (provider, provider_item_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  SELECT * INTO v_item FROM public.financial_provider_items
    WHERE provider = p_provider AND provider_item_id = p_provider_item_id FOR UPDATE;

  IF v_item.organization_id <> p_organization_id THEN
    RAISE EXCEPTION 'PROVIDER_ITEM_OWNED_BY_ANOTHER_ORGANIZATION' USING ERRCODE = '42501';
  END IF;
  IF v_item.environment <> p_environment THEN
    -- An Item is never relabelled: a Sandbox Item is never treated as Production, or the reverse.
    RAISE EXCEPTION 'PROVIDER_ITEM_ENVIRONMENT_MISMATCH' USING ERRCODE = 'check_violation';
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

-- The 7-argument form from migration 154 stays callable (so code deployed before this migration keeps working) but can ONLY ever create or touch
-- a SANDBOX Item. It cannot create a Production Item.
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
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT * FROM public.financial_provider_connect_item(
    p_organization_id, p_provider, p_provider_item_id, p_institution_id, p_institution_name, p_encrypted_access_token, p_actor, 'sandbox');
$$;

REVOKE ALL ON FUNCTION public.financial_provider_connect_item(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financial_provider_connect_item(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.financial_provider_connect_item(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.financial_provider_connect_item(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO service_role;

-- ── 3. Wall: no provider-sourced canonical record can be created in this phase (Sandbox never; Production not until BANK-6) ───────
CREATE OR REPLACE FUNCTION public.financial_provider_guard_ledger_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_environment TEXT;
BEGIN
  IF NEW.source_type = 'future_provider' OR NEW.source_kind = 'provider_transaction' THEN
    IF NEW.source_type IS DISTINCT FROM 'future_provider' OR NEW.source_kind IS DISTINCT FROM 'provider_transaction' OR NEW.source_record_id IS NULL THEN
      RAISE EXCEPTION 'PROVIDER_LEDGER_SOURCE_INVALID' USING ERRCODE = 'check_violation';
    END IF;
    SELECT i.environment INTO v_environment
      FROM public.financial_provider_transactions t
      JOIN public.financial_provider_items i ON i.id = t.provider_item_ref AND i.organization_id = t.organization_id
      WHERE t.id::text = NEW.source_record_id AND t.organization_id = NEW.organization_id;
    IF v_environment IS NULL THEN
      RAISE EXCEPTION 'PROVIDER_LEDGER_SOURCE_NOT_FOUND' USING ERRCODE = 'check_violation';
    END IF;
    IF v_environment <> 'production' THEN
      RAISE EXCEPTION 'SANDBOX_EVIDENCE_NOT_ADOPTABLE' USING ERRCODE = 'check_violation';
    END IF;
    -- Production evidence: still refused until BANK-6 (baseline cutoff + duplicate-safe adoption) replaces this function.
    RAISE EXCEPTION 'PROVIDER_ADOPTION_NOT_ENABLED' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.financial_provider_guard_ledger_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_environment TEXT;
BEGIN
  IF NEW.kind = 'ledger_match' THEN
    SELECT i.environment INTO v_environment
      FROM public.financial_provider_transactions t
      JOIN public.financial_provider_items i ON i.id = t.provider_item_ref AND i.organization_id = t.organization_id
      WHERE t.id = NEW.provider_transaction_ref AND t.organization_id = NEW.organization_id;
    IF v_environment IS DISTINCT FROM 'production' THEN
      RAISE EXCEPTION 'SANDBOX_EVIDENCE_NOT_ADOPTABLE' USING ERRCODE = 'check_violation';
    END IF;
    RAISE EXCEPTION 'PROVIDER_ADOPTION_NOT_ENABLED' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.financial_provider_guard_ledger_source() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financial_provider_guard_ledger_match() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_financial_transactions_provider_source_guard ON public.financial_transactions;
CREATE TRIGGER trg_financial_transactions_provider_source_guard BEFORE INSERT ON public.financial_transactions
  FOR EACH ROW EXECUTE FUNCTION public.financial_provider_guard_ledger_source();
DROP TRIGGER IF EXISTS trg_fpx_05_environment_guard ON public.financial_provider_interpretations;
CREATE TRIGGER trg_fpx_05_environment_guard BEFORE INSERT OR UPDATE ON public.financial_provider_interpretations
  FOR EACH ROW EXECUTE FUNCTION public.financial_provider_guard_ledger_match();

-- ── 4. Close the browser's direct door to provider-sourced canonical links ───────────────────────────────────────────────────
-- A browser has no reason to create a provider-sourced ledger row or a ledger_match; only a future server-side, owner-confirmed function may.
DROP POLICY IF EXISTS financial_transactions_owner_admin_insert ON public.financial_transactions;
CREATE POLICY financial_transactions_owner_admin_insert ON public.financial_transactions FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id)
    AND source_type <> 'future_provider' AND source_kind IS DISTINCT FROM 'provider_transaction'
  );

DROP POLICY IF EXISTS financial_provider_interpretations_owner_admin_insert ON public.financial_provider_interpretations;
CREATE POLICY financial_provider_interpretations_owner_admin_insert ON public.financial_provider_interpretations FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id) AND source = 'owner' AND kind <> 'ledger_match');
DROP POLICY IF EXISTS financial_provider_interpretations_owner_admin_update ON public.financial_provider_interpretations;
CREATE POLICY financial_provider_interpretations_owner_admin_update ON public.financial_provider_interpretations FOR UPDATE TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id) AND kind <> 'ledger_match')
  WITH CHECK (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id) AND kind <> 'ledger_match');

COMMENT ON FUNCTION public.financial_provider_guard_ledger_source() IS
  'BANK-6P wall: a ledger row naming a provider transaction as its source is refused (Sandbox permanently; Production until BANK-6 adoption exists). Read-only; creates and changes nothing.';
COMMENT ON FUNCTION public.financial_provider_guard_ledger_match() IS
  'BANK-6P wall: a ledger_match interpretation is refused (Sandbox permanently; Production until BANK-6 adoption exists). Read-only; creates and changes nothing.';

COMMIT;
