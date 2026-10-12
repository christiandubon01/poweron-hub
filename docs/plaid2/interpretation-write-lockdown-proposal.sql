-- GREENLIGHT-1 B-1 REVIEW DRAFT. NOT a registered or approved production migration. Do not run with `supabase db push`.
-- Install only after separate owner approval, as ONE named tracked migration (suggested name: greenlight1_interpretation_write_lockdown), after re-checking
-- the production catalog. Never repair or reapply 157/158. Requires migrations 153 and 156 (installed). Recommended BEFORE plaid3b; independent of the others.
--
-- WHAT IT FIXES (finding B-1, present since migration 153, i.e. in production today with every switch off)
--   Migration 153 granted SELECT, INSERT, UPDATE on financial_provider_interpretations to `authenticated`, and 153/156 keep owner/admin INSERT/UPDATE
--   policies. No browser code uses them: every decision is written by the Netlify functions as service_role. But any active owner or admin can call
--   PostgREST directly (public anon key + their own sign-in) and insert or update decision rows, bypassing every server rule:
--     * audit forgery: `created_by` is accepted as sent; an UPDATE that keeps `status` can rewrite decided_by/decided_at/undone_by/undo_reason/basis;
--     * invented "reviewed" pairs the server would refuse, a leg used in two confirmed pairs, a rewritten evidence fingerprint that hides
--       "evidence changed" from the owner's review.
--   Employees and other organizations are already refused (RLS + composite keys); DELETE was never granted.
--
-- WHAT IT DOES
--   Drops the two owner/admin write policies and revokes INSERT and UPDATE from `authenticated`. Owners and admins keep SELECT (the read policy is untouched).
--   service_role (the server) is unaffected. It creates nothing, alters no column and changes no row.
--
-- Rollback (restores the previous state exactly): re-run the INSERT/UPDATE policy statements of migration 156 (lines 206-212) and
--   GRANT INSERT, UPDATE ON public.financial_provider_interpretations TO authenticated;
BEGIN;

DROP POLICY IF EXISTS financial_provider_interpretations_owner_admin_insert ON public.financial_provider_interpretations;
DROP POLICY IF EXISTS financial_provider_interpretations_owner_admin_update ON public.financial_provider_interpretations;
REVOKE INSERT, UPDATE ON public.financial_provider_interpretations FROM authenticated, anon, PUBLIC;

COMMIT;
