-- REVIEW DRAFT ONLY. No installation without separate owner authorization.
-- Existing organization-scoped name columns already support built-in display overrides.
-- These indexes prevent ambiguous names, including concurrent saves. No keys or data change.
-- Supersedes the uninstalled organization-wide leaf-name draft: leaves are parent-scoped.
-- Archived definitions retain their names to avoid ambiguous historical labels.
-- Before installation, check duplicates using these exact normalized expressions.
-- A duplicate aborts this transaction; never auto-rename existing definitions.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.bank_spending_category_display_name_unique') IS NOT NULL THEN
    RAISE EXCEPTION 'Earlier global leaf-name index exists: review replacement separately before proceeding';
  END IF;
END $$;
CREATE UNIQUE INDEX bank_spending_parent_display_name_unique
  ON public.bank_spending_parent_definitions
  (organization_id, lower(regexp_replace(trim(name), '\s+', ' ', 'g')));
CREATE UNIQUE INDEX bank_spending_category_parent_name_unique
  ON public.bank_spending_category_definitions
  (organization_id, coalesce(parent_key, ''), lower(regexp_replace(trim(name), '\s+', ' ', 'g')));
COMMIT;
-- Rollback (separate authorization): DROP only these two indexes. Keep definitions/history.
-- Existing RLS, management RPC, audit triggers, custom-write gate and immutable keys remain intact.
