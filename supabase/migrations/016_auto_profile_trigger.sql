-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 016: Auto-Create Organization + Profile on Signup
--
-- Problem: New users who sign up via magic link land on the passcode setup
--          screen, but no `organizations` or `profiles` row exists yet.
--          setupPasscode() fails silently because there's no profile.org_id.
--
-- Solution: A Postgres trigger on auth.users that fires AFTER INSERT and
--           creates a default organization + profile so the auth flow can
--           proceed immediately.
--
-- Flow after this migration:
--   1. User clicks magic link → Supabase creates auth.users row
--   2. This trigger fires → creates organizations + profiles rows
--   3. Frontend receives SIGNED_IN event → initialize() finds the profile
--   4. profile.passcode_hash IS NULL → status = 'needs_passcode_setup'
--   5. User sets PIN → setupPasscode() writes hash → authenticated
--
-- DEPENDS ON: 002 (core tables: organizations, profiles)
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Helper: generate a URL-safe slug from an email ──────────────────────────
CREATE OR REPLACE FUNCTION generate_org_slug(p_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_base TEXT;
  v_slug TEXT;
  v_suffix INT := 0;
BEGIN
  -- Take the part before @ and sanitize
  v_base := lower(regexp_replace(split_part(p_email, '@', 1), '[^a-z0-9]', '-', 'g'));
  v_base := trim(both '-' from v_base);
  IF v_base = '' THEN v_base := 'org'; END IF;

  -- Append '-org' for clarity
  v_slug := v_base || '-org';

  -- Deduplicate with numeric suffix
  WHILE EXISTS (SELECT 1 FROM organizations WHERE slug = v_slug) LOOP
    v_suffix := v_suffix + 1;
    v_slug := v_base || '-org-' || v_suffix;
  END LOOP;

  RETURN v_slug;
END;
$$;


-- ── Trigger function ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id    UUID;
  v_email     TEXT;
  v_full_name TEXT;
BEGIN
  v_email := COALESCE(NEW.email, '');

  -- Extract name from user metadata (Supabase may populate this)
  v_full_name := COALESCE(
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'name',
    split_part(v_email, '@', 1)
  );

  -- 1. Create the organization
  INSERT INTO organizations (name, slug, owner_id)
  VALUES (
    v_full_name || '''s Organization',
    generate_org_slug(v_email),
    NEW.id
  )
  RETURNING id INTO v_org_id;

  -- 2. Create the profile (passcode_hash is NULL → triggers setup screen)
  INSERT INTO profiles (id, org_id, full_name, role)
  VALUES (
    NEW.id,
    v_org_id,
    v_full_name,
    'owner'
  );

  -- 3. Seed project templates for the new org (non-blocking — errors logged, not thrown)
  BEGIN
    PERFORM seed_project_templates_for_org(v_org_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[handle_new_user] seed_project_templates failed for org %: %', v_org_id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION handle_new_user IS
  'Auto-creates organization + profile when a new user signs up via Supabase Auth. '
  'This ensures the onboarding flow (passcode setup) has the required rows in place.';


-- ── Attach trigger to auth.users ────────────────────────────────────────────
-- Drop first in case migration is re-run
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();
