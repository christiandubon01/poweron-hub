/**
 * GUARDIAN-3B3E: User Access Revocation — Schema Contract Tests.
 *
 * All tests are [STATIC]: they read migration SQL content only.
 * No live DB, no DOM, no RPC calls.
 *
 * Proof points (12 required):
 *  1.  profiles.is_active remains canonical (unchanged boolean column)
 *  2.  profiles gains revoked_by as UUID FK to auth.users
 *  3.  profiles gains revoked_at as TIMESTAMPTZ
 *  4.  profiles gains restored_by as UUID FK to auth.users
 *  5.  profiles gains restored_at as TIMESTAMPTZ
 *  6.  All four audit columns are nullable (legacy rows have NULL metadata)
 *  7.  No access-state duplicate enum/boolean added to profiles
 *  8.  existing ended_reason values (signout, manual_lock, inactivity_timeout) remain allowed
 *  9.  'access_revoked' is newly added to ended_reason CHECK
 * 10.  plain 'revoked' is NOT added (it would create a presence-state collision)
 * 11.  no existing profile is backfilled/mutated (no UPDATE on profiles)
 * 12.  migration does not modify orgs/members/projects/agreements/NDA tables
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root        = process.cwd()
const migDir      = join(root, 'supabase/migrations')
const mig123Path  = join(migDir, '123_guardian_user_access_revocation.sql')
const mig123      = existsSync(mig123Path) ? readFileSync(mig123Path, 'utf8') : ''

// ── 1. profiles.is_active remains canonical ──────────────────────────────────

describe('[STATIC] 1. profiles.is_active remains canonical', () => {
  it('migration 123 exists', () => {
    expect(existsSync(mig123Path)).toBe(true)
  })

  it('migration is wrapped in BEGIN/COMMIT', () => {
    expect(mig123).toContain('BEGIN;')
    expect(mig123).toContain('COMMIT;')
  })

  it('does not DROP or rename is_active', () => {
    expect(mig123).not.toMatch(/DROP\s+COLUMN.*is_active/i)
    expect(mig123).not.toMatch(/RENAME\s+COLUMN.*is_active/i)
  })

  it('does not ALTER COLUMN is_active (no type or default change)', () => {
    expect(mig123).not.toMatch(/ALTER\s+COLUMN\s+is_active/i)
  })

  it('postcondition asserts is_active exists and remains boolean', () => {
    expect(mig123).toContain("profiles.is_active")
    expect(mig123).toContain("'boolean'")
  })
})

// Helper: extract the ALTER TABLE public.profiles block from the migration
const alterProfilesStart = mig123.indexOf('ALTER TABLE public.profiles')
const alterProfilesEnd   = mig123.indexOf('ALTER TABLE public.user_sessions')
const alterProfilesBlock = alterProfilesStart >= 0 && alterProfilesEnd > alterProfilesStart
  ? mig123.slice(alterProfilesStart, alterProfilesEnd)
  : mig123.slice(alterProfilesStart)

// ── 2. revoked_by is UUID FK to auth.users ───────────────────────────────────

describe('[STATIC] 2. profiles gains revoked_by UUID FK', () => {
  it('ADD COLUMN IF NOT EXISTS revoked_by', () => {
    expect(mig123).toMatch(/ADD COLUMN IF NOT EXISTS\s+revoked_by\s+UUID/)
  })

  it('revoked_by references auth.users', () => {
    const idx  = alterProfilesBlock.indexOf('revoked_by')
    const next = alterProfilesBlock.indexOf('revoked_at', idx)
    const segment = alterProfilesBlock.slice(idx, next > 0 ? next : idx + 300)
    expect(segment).toContain('auth.users')
  })

  it('revoked_by FK uses ON DELETE SET NULL (not CASCADE)', () => {
    const idx  = alterProfilesBlock.indexOf('revoked_by')
    const next = alterProfilesBlock.indexOf('revoked_at', idx)
    const segment = alterProfilesBlock.slice(idx, next > 0 ? next : idx + 300)
    expect(segment).toContain('SET NULL')
    expect(segment).not.toContain('CASCADE')
  })
})

// ── 3. revoked_at is TIMESTAMPTZ ─────────────────────────────────────────────

describe('[STATIC] 3. profiles gains revoked_at TIMESTAMPTZ', () => {
  it('ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ', () => {
    expect(mig123).toMatch(/ADD COLUMN IF NOT EXISTS\s+revoked_at\s+TIMESTAMPTZ/)
  })

  it('revoked_at does not use TEXT or DATE', () => {
    expect(mig123).not.toMatch(/revoked_at\s+TEXT/)
    expect(mig123).not.toMatch(/revoked_at\s+DATE[^T]/)
  })
})

// ── 4. restored_by is UUID FK to auth.users ──────────────────────────────────

describe('[STATIC] 4. profiles gains restored_by UUID FK', () => {
  it('ADD COLUMN IF NOT EXISTS restored_by', () => {
    expect(mig123).toMatch(/ADD COLUMN IF NOT EXISTS\s+restored_by\s+UUID/)
  })

  it('restored_by references auth.users', () => {
    const idx  = alterProfilesBlock.indexOf('restored_by')
    const next = alterProfilesBlock.indexOf('restored_at', idx)
    const segment = alterProfilesBlock.slice(idx, next > 0 ? next : idx + 300)
    expect(segment).toContain('auth.users')
  })

  it('restored_by FK uses ON DELETE SET NULL (not CASCADE)', () => {
    const idx  = alterProfilesBlock.indexOf('restored_by')
    const next = alterProfilesBlock.indexOf('restored_at', idx)
    const segment = alterProfilesBlock.slice(idx, next > 0 ? next : idx + 300)
    expect(segment).toContain('SET NULL')
    expect(segment).not.toContain('CASCADE')
  })
})

// ── 5. restored_at is TIMESTAMPTZ ────────────────────────────────────────────

describe('[STATIC] 5. profiles gains restored_at TIMESTAMPTZ', () => {
  it('ADD COLUMN IF NOT EXISTS restored_at TIMESTAMPTZ', () => {
    expect(mig123).toMatch(/ADD COLUMN IF NOT EXISTS\s+restored_at\s+TIMESTAMPTZ/)
  })

  it('restored_at does not use TEXT or DATE', () => {
    expect(mig123).not.toMatch(/restored_at\s+TEXT/)
    expect(mig123).not.toMatch(/restored_at\s+DATE[^T]/)
  })
})

// ── 6. Audit columns are nullable ────────────────────────────────────────────

describe('[STATIC] 6. Audit columns are nullable', () => {
  it('revoked_by has no NOT NULL constraint', () => {
    const segment = mig123.slice(
      mig123.indexOf('revoked_by'),
      mig123.indexOf('revoked_by') + 200,
    )
    expect(segment).not.toMatch(/NOT NULL/)
  })

  it('revoked_at has no NOT NULL constraint', () => {
    const idx = mig123.indexOf('revoked_at')
    const segment = mig123.slice(idx, idx + 100)
    expect(segment).not.toMatch(/NOT NULL/)
  })

  it('restored_by has no NOT NULL constraint', () => {
    const idx = mig123.indexOf('restored_by')
    const segment = mig123.slice(idx, idx + 200)
    expect(segment).not.toMatch(/NOT NULL/)
  })

  it('restored_at has no NOT NULL constraint', () => {
    const idx = mig123.indexOf('restored_at')
    const segment = mig123.slice(idx, idx + 100)
    expect(segment).not.toMatch(/NOT NULL/)
  })

  it('postcondition checks all 4 audit columns are nullable', () => {
    expect(mig123).toContain("is_nullable  = 'YES'")
    expect(mig123).toContain('4 audit columns nullable')
  })
})

// ── 7. No access-state duplicate added ───────────────────────────────────────

describe('[STATIC] 7. No duplicate access-state column added', () => {
  it('does not add is_revoked boolean', () => {
    expect(mig123).not.toMatch(/ADD COLUMN.*is_revoked/i)
  })

  it('does not add access_state enum or text column', () => {
    expect(mig123).not.toMatch(/ADD COLUMN.*access_state/i)
  })

  it('does not add is_suspended or is_disabled boolean', () => {
    expect(mig123).not.toMatch(/ADD COLUMN.*(is_suspended|is_disabled)/i)
  })

  it('postcondition asserts no extra active-state column on profiles', () => {
    expect(mig123).toContain("ILIKE '%active%'")
    expect(mig123).toContain("'is_active'")
  })
})

// ── 8. Existing ended_reason values remain allowed ───────────────────────────

describe('[STATIC] 8. Existing ended_reason values remain allowed', () => {
  it("'signout' is in the new CHECK", () => {
    const checkBlock = mig123.slice(
      mig123.indexOf('ADD CONSTRAINT user_sessions_ended_reason_check'),
    )
    expect(checkBlock).toContain("'signout'")
  })

  it("'manual_lock' is in the new CHECK", () => {
    const checkBlock = mig123.slice(
      mig123.indexOf('ADD CONSTRAINT user_sessions_ended_reason_check'),
    )
    expect(checkBlock).toContain("'manual_lock'")
  })

  it("'inactivity_timeout' is in the new CHECK", () => {
    const checkBlock = mig123.slice(
      mig123.indexOf('ADD CONSTRAINT user_sessions_ended_reason_check'),
    )
    expect(checkBlock).toContain("'inactivity_timeout'")
  })

  it('NULL is still allowed (ended_reason IS NULL)', () => {
    const checkBlock = mig123.slice(
      mig123.indexOf('ADD CONSTRAINT user_sessions_ended_reason_check'),
    )
    expect(checkBlock).toMatch(/ended_reason IS NULL/)
  })
})

// ── 9. 'access_revoked' is newly added ───────────────────────────────────────

describe("[STATIC] 9. 'access_revoked' added to ended_reason CHECK", () => {
  it("CHECK constraint body contains 'access_revoked'", () => {
    const checkBlock = mig123.slice(
      mig123.indexOf('ADD CONSTRAINT user_sessions_ended_reason_check'),
    )
    expect(checkBlock).toContain("'access_revoked'")
  })

  it('postcondition verifies access_revoked appears in the live constraint', () => {
    expect(mig123).toContain('access_revoked')
  })
})

// ── 10. Plain 'revoked' is NOT added ─────────────────────────────────────────

describe("[STATIC] 10. Plain 'revoked' is NOT in ended_reason CHECK", () => {
  it("CHECK does not contain bare 'revoked' value", () => {
    const checkBlock = mig123.slice(
      mig123.indexOf('ADD CONSTRAINT user_sessions_ended_reason_check'),
      mig123.indexOf('ADD CONSTRAINT user_sessions_ended_reason_check') + 400,
    )
    // 'access_revoked' is allowed; plain 'revoked' alone is not
    const withoutAccessRevoked = checkBlock.replace(/'access_revoked'/g, '')
    expect(withoutAccessRevoked).not.toMatch(/'revoked'/)
  })
})

// ── 11. No profiles rows are backfilled or mutated ───────────────────────────

describe('[STATIC] 11. No existing profile rows mutated', () => {
  it('migration has no UPDATE on profiles', () => {
    // Normalized: no UPDATE targeting profiles table
    expect(mig123).not.toMatch(/UPDATE\s+public\.profiles/i)
    expect(mig123).not.toMatch(/UPDATE\s+profiles\s+SET/i)
  })

  it('migration has no INSERT into profiles', () => {
    expect(mig123).not.toMatch(/INSERT\s+INTO\s+public\.profiles/i)
    expect(mig123).not.toMatch(/INSERT\s+INTO\s+profiles/i)
  })

  it('migration has no DELETE from profiles', () => {
    expect(mig123).not.toMatch(/DELETE\s+FROM\s+public\.profiles/i)
    expect(mig123).not.toMatch(/DELETE\s+FROM\s+profiles/i)
  })

  it('no backfill of is_active from any expression', () => {
    expect(mig123).not.toMatch(/SET\s+is_active\s*=/i)
  })
})

// ── 12. Adjacent tables are not modified ─────────────────────────────────────

describe('[STATIC] 12. Migration does not touch other tables', () => {
  const PROTECTED = [
    'organizations',
    'projects',
    'agreements',
    'signed_agreements',
    'nda_access_authority',
    'employees',
    'crew_members',
    'account_security_events',
  ]

  for (const table of PROTECTED) {
    it(`does not ALTER TABLE ${table}`, () => {
      expect(mig123).not.toMatch(
        new RegExp(`ALTER\\s+TABLE\\s+(public\\.)?${table}(?!\\s+DROP\\s+CONSTRAINT\\s+user_sessions)`, 'i'),
      )
    })
  }

  it('no migration 123 file exists with duplicate prefix', () => {
    const files = readdirSync(migDir)
    const matches = files.filter(f => f.startsWith('123_'))
    expect(matches).toHaveLength(1)
    expect(matches[0]).toBe('123_guardian_user_access_revocation.sql')
  })
})
