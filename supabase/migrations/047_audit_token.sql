-- Migration 047: Audit Token — adds audit access fields to profiles
-- Enables read-only remote access via shareable audit URL.
-- audit_token: UUID used in ?audit=TOKEN URL param for read-only app access
-- audit_access_enabled: owner toggle to enable/disable audit access

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS audit_token          TEXT,
  ADD COLUMN IF NOT EXISTS audit_access_enabled BOOLEAN NOT NULL DEFAULT false;

-- Ensure each audit_token is unique across all profiles
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_audit_token
  ON profiles (audit_token)
  WHERE audit_token IS NOT NULL;

COMMENT ON COLUMN profiles.audit_token          IS 'UUID token for read-only audit URL access (?audit=TOKEN)';
COMMENT ON COLUMN profiles.audit_access_enabled IS 'Owner toggle: true = audit URL bypasses passcode in read-only mode';
