-- CASH-OS-1C: Buckets + Envelopes Foundation.
-- Buckets are user-defined labeled pools for grouping envelopes; they hold no
-- cash and create no financial transactions. Envelopes are virtual allocations
-- of real cash: balance = sum(allocate entries) − sum(release entries). Neither
-- increases Total Cash, account balances, Truly Free Cash, or projection events.
BEGIN;

CREATE TABLE IF NOT EXISTS public.cash_os_buckets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT,
  color TEXT,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cash_os_buckets_id_org_unique UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS public.cash_os_envelopes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  bucket_id UUID,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT,
  target_amount_minor BIGINT CHECK (target_amount_minor IS NULL OR target_amount_minor >= 0),
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cash_os_envelopes_id_org_unique UNIQUE (id, organization_id),
  CONSTRAINT cash_os_envelopes_bucket_org_fk
    FOREIGN KEY (bucket_id, organization_id)
    REFERENCES public.cash_os_buckets(id, organization_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.cash_os_envelope_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  envelope_id UUID NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  direction TEXT NOT NULL CHECK (direction IN ('allocate', 'release')),
  note TEXT,
  created_by UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cash_os_envelope_entries_id_org_unique UNIQUE (id, organization_id),
  CONSTRAINT cash_os_envelope_entries_envelope_org_fk
    FOREIGN KEY (envelope_id, organization_id)
    REFERENCES public.cash_os_envelopes(id, organization_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_cash_os_buckets_org
  ON public.cash_os_buckets (organization_id) WHERE NOT archived;
CREATE INDEX IF NOT EXISTS idx_cash_os_envelopes_org
  ON public.cash_os_envelopes (organization_id) WHERE NOT archived;
CREATE INDEX IF NOT EXISTS idx_cash_os_envelopes_bucket
  ON public.cash_os_envelopes (organization_id, bucket_id) WHERE bucket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cash_os_envelope_entries_envelope
  ON public.cash_os_envelope_entries (organization_id, envelope_id);

CREATE TRIGGER trg_cash_os_buckets_updated_at
  BEFORE UPDATE ON public.cash_os_buckets
  FOR EACH ROW EXECUTE FUNCTION public.set_cash_ledger_updated_at();
CREATE TRIGGER trg_cash_os_envelopes_updated_at
  BEFORE UPDATE ON public.cash_os_envelopes
  FOR EACH ROW EXECUTE FUNCTION public.set_cash_ledger_updated_at();

CREATE OR REPLACE FUNCTION public.transfer_between_envelopes(
  p_organization_id UUID,
  p_from_envelope_id UUID,
  p_to_envelope_id UUID,
  p_amount_minor BIGINT,
  p_note TEXT DEFAULT NULL
)
RETURNS TABLE(from_entry_id UUID, to_entry_id UUID)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_from_id UUID;
  v_to_id UUID;
BEGIN
  IF p_from_envelope_id = p_to_envelope_id THEN
    RAISE EXCEPTION 'Source and target envelopes must differ';
  END IF;
  IF p_amount_minor <= 0 THEN
    RAISE EXCEPTION 'Transfer amount must be positive';
  END IF;

  PERFORM 1 FROM public.cash_os_envelopes
   WHERE id = p_from_envelope_id AND organization_id = p_organization_id AND NOT archived
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source envelope not found or archived';
  END IF;

  PERFORM 1 FROM public.cash_os_envelopes
   WHERE id = p_to_envelope_id AND organization_id = p_organization_id AND NOT archived
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target envelope not found or archived';
  END IF;

  INSERT INTO public.cash_os_envelope_entries
    (organization_id, envelope_id, amount_minor, direction, note, created_by)
  VALUES
    (p_organization_id, p_from_envelope_id, p_amount_minor, 'release', p_note, auth.uid())
  RETURNING id INTO v_from_id;

  INSERT INTO public.cash_os_envelope_entries
    (organization_id, envelope_id, amount_minor, direction, note, created_by)
  VALUES
    (p_organization_id, p_to_envelope_id, p_amount_minor, 'allocate', p_note, auth.uid())
  RETURNING id INTO v_to_id;

  RETURN QUERY SELECT v_from_id, v_to_id;
END;
$$;

ALTER TABLE public.cash_os_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_os_envelopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_os_envelope_entries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.cash_os_buckets,
  public.cash_os_envelopes,
  public.cash_os_envelope_entries
FROM PUBLIC, anon, authenticated;

CREATE POLICY cash_os_buckets_owner_admin_all
  ON public.cash_os_buckets
  FOR ALL TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id))
  WITH CHECK (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));

CREATE POLICY cash_os_envelopes_owner_admin_all
  ON public.cash_os_envelopes
  FOR ALL TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id))
  WITH CHECK (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));

CREATE POLICY cash_os_envelope_entries_owner_admin_all
  ON public.cash_os_envelope_entries
  FOR ALL TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id))
  WITH CHECK (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_os_buckets,
  public.cash_os_envelopes
TO authenticated;
GRANT SELECT, INSERT ON public.cash_os_envelope_entries TO authenticated;

REVOKE ALL ON FUNCTION public.transfer_between_envelopes(UUID, UUID, UUID, BIGINT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_between_envelopes(UUID, UUID, UUID, BIGINT, TEXT)
  TO authenticated;

COMMENT ON TABLE public.cash_os_buckets IS
  'CASH-OS-1C: User-defined labeled pools for grouping envelopes. Not cash; no financial transactions created.';
COMMENT ON TABLE public.cash_os_envelopes IS
  'CASH-OS-1C: Virtual allocations of real cash. Balance = sum(allocate) - sum(release) from entries.';
COMMENT ON TABLE public.cash_os_envelope_entries IS
  'CASH-OS-1C: Immutable allocation ledger. Entries are never updated, only inserted.';

COMMIT;
