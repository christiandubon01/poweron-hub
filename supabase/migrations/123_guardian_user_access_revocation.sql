-- 123_guardian_user_access_revocation.sql
-- GUARDIAN-3B3E: User Access Revocation — Schema Scaffolding
--
-- Additive only. No existing rows, columns, RLS policies, or tables are modified.
--
-- PART A: Extend public.profiles with revocation audit metadata.
--   The canonical access-state authority remains profiles.is_active (unchanged).
--   These four columns record WHO revoked/restored access and WHEN.
--   All are nullable — legacy is_active=false rows may have NULL audit metadata.
--
-- PART B: Extend user_sessions.ended_reason CHECK to permit 'access_revoked'.
--   'access_revoked' is an internal SESSION END REASON only.
--   A session ended for this reason is later classified as Offline in presence state.
--   It does NOT introduce a fifth presence status.
--
-- WRITE SEMANTICS (enforced at implementation time, not here):
--   REVOKE:  is_active=false, revoked_by=founder id, revoked_at=now()
--   RESTORE: is_active=true,  restored_by=founder id, restored_at=now()
--   Historical revoked_*/restored_* fields are NOT cleared on subsequent operations.
--   These record the most recent revocation/restoration evidence only.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART A: Revocation audit columns on public.profiles
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS revoked_by  UUID
    REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revoked_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS restored_by UUID
    REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS restored_at TIMESTAMPTZ;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART B: Extend ended_reason CHECK on public.user_sessions
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- PostgreSQL requires DROP + ADD to modify a CHECK constraint.
-- The DROP preserves all existing rows; the new CHECK is a strict superset.

ALTER TABLE public.user_sessions
  DROP CONSTRAINT IF EXISTS user_sessions_ended_reason_check;

ALTER TABLE public.user_sessions
  ADD CONSTRAINT user_sessions_ended_reason_check
  CHECK (ended_reason IS NULL OR ended_reason IN (
    'signout',
    'manual_lock',
    'inactivity_timeout',
    'access_revoked'
  ));

-- ═══════════════════════════════════════════════════════════════════════════════
-- Postcondition assertions
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_count  INTEGER;
  v_typstr TEXT;
BEGIN
  -- 1. profiles.is_active still exists and is boolean (unchanged).
  SELECT data_type INTO v_typstr
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'profiles'
    AND column_name  = 'is_active';
  IF v_typstr IS NULL THEN
    RAISE EXCEPTION 'GUARDIAN-3B3E: profiles.is_active is missing';
  END IF;
  IF v_typstr <> 'boolean' THEN
    RAISE EXCEPTION 'GUARDIAN-3B3E: profiles.is_active changed type to %, expected boolean', v_typstr;
  END IF;

  -- 2. revoked_by exists as UUID on profiles.
  SELECT COUNT(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'profiles'
    AND column_name  = 'revoked_by'
    AND data_type    = 'uuid';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'GUARDIAN-3B3E: profiles.revoked_by UUID column missing or wrong type';
  END IF;

  -- 3. revoked_at exists as TIMESTAMPTZ on profiles.
  SELECT COUNT(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'profiles'
    AND column_name  = 'revoked_at'
    AND data_type    = 'timestamp with time zone';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'GUARDIAN-3B3E: profiles.revoked_at TIMESTAMPTZ column missing or wrong type';
  END IF;

  -- 4. restored_by exists as UUID on profiles.
  SELECT COUNT(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'profiles'
    AND column_name  = 'restored_by'
    AND data_type    = 'uuid';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'GUARDIAN-3B3E: profiles.restored_by UUID column missing or wrong type';
  END IF;

  -- 5. restored_at exists as TIMESTAMPTZ on profiles.
  SELECT COUNT(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'profiles'
    AND column_name  = 'restored_at'
    AND data_type    = 'timestamp with time zone';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'GUARDIAN-3B3E: profiles.restored_at TIMESTAMPTZ column missing or wrong type';
  END IF;

  -- 6. All four audit columns are nullable (no NOT NULL constraint).
  SELECT COUNT(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'profiles'
    AND column_name  IN ('revoked_by', 'revoked_at', 'restored_by', 'restored_at')
    AND is_nullable  = 'YES';
  IF v_count <> 4 THEN
    RAISE EXCEPTION
      'GUARDIAN-3B3E: expected all 4 audit columns nullable, found % nullable', v_count;
  END IF;

  -- 7. ended_reason CHECK now includes 'access_revoked'.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'user_sessions'
      AND con.conname = 'user_sessions_ended_reason_check'
      AND pg_get_constraintdef(con.oid) LIKE '%access_revoked%'
  ) THEN
    RAISE EXCEPTION
      'GUARDIAN-3B3E: user_sessions ended_reason CHECK does not include access_revoked';
  END IF;

  -- 8. Original ended_reason values are still permitted.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'user_sessions'
      AND con.conname = 'user_sessions_ended_reason_check'
      AND pg_get_constraintdef(con.oid) LIKE '%signout%'
      AND pg_get_constraintdef(con.oid) LIKE '%manual_lock%'
      AND pg_get_constraintdef(con.oid) LIKE '%inactivity_timeout%'
  ) THEN
    RAISE EXCEPTION
      'GUARDIAN-3B3E: ended_reason CHECK is missing original values (signout/manual_lock/inactivity_timeout)';
  END IF;

  -- 9. No extra access-state boolean or enum added to profiles beyond is_active.
  SELECT COUNT(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'profiles'
    AND column_name  ILIKE '%active%'
    AND column_name  <> 'is_active';
  IF v_count > 0 THEN
    RAISE EXCEPTION
      'GUARDIAN-3B3E: unexpected extra active-state column found on profiles (count=%)', v_count;
  END IF;
END $$;

COMMIT;
