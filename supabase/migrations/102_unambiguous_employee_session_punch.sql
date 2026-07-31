-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 102: Unambiguous Employee Session Punch
-- EMERG-EMPLOYEE-CLOCK-RPC-1
--
-- DEPENDS ON: 101 (record_session_punch(TEXT, UUID DEFAULT NULL, TEXT DEFAULT NULL))
--
-- Root cause of Clock In failure after migration 101:
--   Migration 099 created record_session_punch(TEXT, UUID DEFAULT NULL).
--   Migration 100 added record_session_punch(TEXT, UUID, UUID) using a different
--   signature — CREATE OR REPLACE on a new signature creates an additional overload,
--   it does NOT replace the original. The 2-arg (TEXT, UUID) version persisted.
--   Migration 101 dropped the 3-arg UUID variant and created the canonical
--   (TEXT, UUID DEFAULT NULL, TEXT DEFAULT NULL) version. The 2-arg (TEXT, UUID)
--   overload from migration 099 was never dropped and remained callable.
--
--   Result after migration 101: two callable overloads on the live database:
--     1. record_session_punch(p_action TEXT, p_assignment_id UUID DEFAULT NULL)
--        — migration 099 — NEVER DROPPED
--     2. record_session_punch(p_action TEXT, p_assignment_id UUID DEFAULT NULL,
--                             p_project_id TEXT DEFAULT NULL)
--        — migration 101 — canonical
--
--   PostgREST named-parameter routing:
--     { p_action, p_project_id }     → only overload 2 has p_project_id
--                                       → correct routing to mig-101 ✓
--     { p_action, p_assignment_id }  → BOTH overloads match
--                                       → PostgREST 300/400 ambiguity error ✗
--     { p_action }                   → BOTH overloads match
--                                       → PostgREST 300/400 ambiguity error ✗
--
--   This breaks:
--     - Assignment-mode clock_in (sends p_action + p_assignment_id)
--     - All lunch and clock-out punches (send only p_action)
--   And risks breaking project-only clock_in if the service ever omits p_project_id.
--
-- Fix:
--   Drop the migration-099 2-arg overload. Only one callable function remains.
--   Re-apply security grants on the canonical function for idempotency.
--
-- Preserved unchanged:
--   All punch timestamps and minute totals in employee_work_sessions
--   The one-active-session-per-employee partial unique index
--   sync_time_entry_from_sessions trigger
--   admin_record_session_punch
--   submit_punch_edit_request
--   All time_punch_events rows
--   RLS policies on employee_work_sessions
--   Migrations 097–101 SQL files
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Drop the migration-099 2-arg overload ─────────────────────────────────
-- Signature matches the REVOKE/GRANT lines in migration 099.
-- The canonical 3-arg (TEXT, UUID DEFAULT NULL, TEXT DEFAULT NULL) from
-- migration 101 is NOT dropped and remains as the sole callable function.

DROP FUNCTION IF EXISTS public.record_session_punch(TEXT, UUID);

-- ── 2. Re-apply security on the canonical 3-arg function ─────────────────────
-- Idempotent. Ensures grants are correct regardless of any prior partial-apply.
-- Migration 101 already applied these; repeating here is a safety net.

REVOKE ALL ON FUNCTION public.record_session_punch(TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_session_punch(TEXT, UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_session_punch(TEXT, UUID, TEXT) TO authenticated;

COMMIT;

-- ── Verification (run manually after apply) ───────────────────────────────────

-- 1. Only one record_session_punch overload exists
-- SELECT proname, pg_get_function_arguments(oid) AS args
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND proname = 'record_session_punch'
-- ORDER BY args;
-- Expected: exactly one row:
--   record_session_punch | p_action text, p_assignment_id uuid DEFAULT NULL,
--                          p_project_id text DEFAULT NULL

-- 2. 2-arg overload is gone
-- SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND proname = 'record_session_punch'
--   AND pg_get_function_arguments(p.oid) NOT LIKE '%p_project_id%';
-- Expected: 0

-- 3. authenticated can still execute
-- SELECT has_function_privilege('authenticated',
--   'public.record_session_punch(text, uuid, text)', 'EXECUTE') AS can_exec;
-- Expected: true

-- 4. anon cannot execute
-- SELECT has_function_privilege('anon',
--   'public.record_session_punch(text, uuid, text)', 'EXECUTE') AS can_exec;
-- Expected: false

-- 5. active-session index unchanged
-- SELECT indexname FROM pg_indexes
-- WHERE tablename = 'employee_work_sessions'
--   AND indexname = 'idx_ews_one_active_session_per_employee';
-- Expected: idx_ews_one_active_session_per_employee

-- 6. aggregation trigger unchanged
-- SELECT tgname FROM pg_trigger
-- WHERE tgrelid = 'public.employee_work_sessions'::regclass
--   AND tgname = 'trg_sync_time_entry_from_sessions';
-- Expected: trg_sync_time_entry_from_sessions
