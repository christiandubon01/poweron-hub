-- BANK-6D: organization-wide DISPLAY colors for expense categories and financial accounts.
--
-- A row says "show this category / this account with this color". It is a visual preference and nothing more:
--   * It never changes, and is never read to compute, any transaction, classification, interpretation, approval, project allocation, ledger row,
--     balance, bill, payroll, debt or Outlook figure. No other table is altered and no data is written outside this table.
--   * Targets are STABLE identifiers only: an expense category KEY (e.g. 'fuel_vehicle'), or a financial_accounts.id. Never a label or a name.
--     The account reference is a composite foreign key on (id, organization_id), so a color can only point at an account of the same organization.
--     ON DELETE CASCADE means a color can never block deleting an account.
--   * Colors are '#rrggbb' (the app only offers its curated palette and ignores anything else).
--   * Row-level security: members of the organization can READ its colors; only owners/admins of that organization can change them. anon has nothing.
--   * Writes go through cash_os_set_display_color (SECURITY INVOKER, so the caller's row-level security applies; the organization always comes from
--     the caller's own profile, never from an argument). A NULL color removes the row ("No color").
--
-- Rollback: DROP FUNCTION public.cash_os_set_display_color(TEXT, TEXT, TEXT); DROP TABLE public.cash_os_display_colors;
-- (nothing references them; the app falls back to device-local colors when they are absent). Runs in one transaction.
-- Apply ONLY with the reviewed single-file procedure (BANK-0A). Never via `supabase db push`. Do not modify migrations 153-157.
BEGIN;

CREATE TABLE IF NOT EXISTS public.cash_os_display_colors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('category', 'account')),
  category_key TEXT CHECK (category_key IS NULL OR category_key ~ '^[a-z][a-z_]{1,39}$'),
  financial_account_id UUID,
  color TEXT NOT NULL CHECK (color ~ '^#[0-9a-f]{6}$'),
  updated_by UUID DEFAULT auth.uid(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cash_os_display_colors_target_consistent CHECK (
    (target_kind = 'category' AND category_key IS NOT NULL AND financial_account_id IS NULL) OR
    (target_kind = 'account' AND financial_account_id IS NOT NULL AND category_key IS NULL)
  ),
  CONSTRAINT cash_os_display_colors_account_fk FOREIGN KEY (financial_account_id, organization_id)
    REFERENCES public.financial_accounts(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT cash_os_display_colors_category_unique UNIQUE (organization_id, category_key),
  CONSTRAINT cash_os_display_colors_account_unique UNIQUE (organization_id, financial_account_id)
);

ALTER TABLE public.cash_os_display_colors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cash_os_display_colors FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_os_display_colors TO authenticated;

DROP POLICY IF EXISTS cash_os_display_colors_select ON public.cash_os_display_colors;
CREATE POLICY cash_os_display_colors_select ON public.cash_os_display_colors FOR SELECT TO authenticated
  USING (organization_id = public.user_org_id());
DROP POLICY IF EXISTS cash_os_display_colors_insert ON public.cash_os_display_colors;
CREATE POLICY cash_os_display_colors_insert ON public.cash_os_display_colors FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));
DROP POLICY IF EXISTS cash_os_display_colors_update ON public.cash_os_display_colors;
CREATE POLICY cash_os_display_colors_update ON public.cash_os_display_colors FOR UPDATE TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id))
  WITH CHECK (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));
DROP POLICY IF EXISTS cash_os_display_colors_delete ON public.cash_os_display_colors;
CREATE POLICY cash_os_display_colors_delete ON public.cash_os_display_colors FOR DELETE TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));

CREATE OR REPLACE FUNCTION public.cash_os_set_display_color(p_kind TEXT, p_key TEXT, p_color TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org UUID := public.user_org_id();
BEGIN
  IF v_org IS NULL OR NOT public.is_org_admin_for(v_org) THEN
    RAISE EXCEPTION 'DISPLAY_COLOR_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('category', 'account') OR p_key IS NULL THEN
    RAISE EXCEPTION 'DISPLAY_COLOR_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_color IS NOT NULL AND p_color !~ '^#[0-9a-f]{6}$' THEN
    RAISE EXCEPTION 'DISPLAY_COLOR_INVALID' USING ERRCODE = '22023';
  END IF;

  IF p_kind = 'category' THEN
    IF p_key !~ '^[a-z][a-z_]{1,39}$' THEN RAISE EXCEPTION 'DISPLAY_COLOR_INVALID' USING ERRCODE = '22023'; END IF;
    IF p_color IS NULL THEN
      DELETE FROM public.cash_os_display_colors WHERE organization_id = v_org AND category_key = p_key;
      RETURN 'cleared';
    END IF;
    INSERT INTO public.cash_os_display_colors (organization_id, target_kind, category_key, color, updated_by)
    VALUES (v_org, 'category', p_key, p_color, auth.uid())
    ON CONFLICT (organization_id, category_key) DO UPDATE SET color = EXCLUDED.color, updated_by = EXCLUDED.updated_by, updated_at = now();
    RETURN 'saved';
  END IF;

  IF p_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'DISPLAY_COLOR_INVALID' USING ERRCODE = '22023'; END IF;
  IF p_color IS NULL THEN
    DELETE FROM public.cash_os_display_colors WHERE organization_id = v_org AND financial_account_id = p_key::UUID;
    RETURN 'cleared';
  END IF;
  -- The composite foreign key rejects an account of another organization (or one that does not exist) with 23503.
  INSERT INTO public.cash_os_display_colors (organization_id, target_kind, financial_account_id, color, updated_by)
  VALUES (v_org, 'account', p_key::UUID, p_color, auth.uid())
  ON CONFLICT (organization_id, financial_account_id) DO UPDATE SET color = EXCLUDED.color, updated_by = EXCLUDED.updated_by, updated_at = now();
  RETURN 'saved';
END;
$$;

REVOKE ALL ON FUNCTION public.cash_os_set_display_color(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cash_os_set_display_color(TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON TABLE public.cash_os_display_colors IS
  'BANK-6D organization-wide display colors for expense categories (by key) and financial accounts (by id). Visual only; never read by any financial calculation.';

COMMIT;
