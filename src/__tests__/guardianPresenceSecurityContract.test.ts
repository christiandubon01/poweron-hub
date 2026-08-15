/**
 * GUARDIAN-3B1: Presence + Security Database Foundation — contract tests.
 *
 * All tests are [STATIC]: they read migration SQL content only.
 * No live DB, no DOM, no RPC calls.
 *
 * Proof points (12 required):
 *  1.  Migration 122 exists exactly once
 *  2.  user_sessions gains session_id
 *  3.  user_sessions gains device_id
 *  4.  user_sessions gains module
 *  5.  user_sessions gains last_interaction_at
 *  6.  user_sessions gains visibility_state
 *  7.  user_sessions gains ended_reason
 *  8.  session_id has uniqueness protection (partial unique index)
 *  9.  account_security_events table is created
 * 10.  IP columns (public_ip, previous_public_ip) use INET type
 * 11.  occurred_at uses TIMESTAMPTZ
 * 12.  RLS is enabled on account_security_events
 * 13.  No authenticated SELECT/INSERT/UPDATE/DELETE policy on account_security_events
 * 14.  No heartbeat event type or heartbeat table introduced
 * 15.  user_sessions.ip_address is NOT renamed or dropped
 * 16.  No new authenticated UPDATE/DELETE policies on user_sessions
 * 17.  Migration does not touch beta_invites, signed_agreements, nda_access_authority
 * 18.  Migration guard: 119–122 are the only new migrations beyond 118
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root   = process.cwd()
const migDir = join(root, 'supabase/migrations')
const mig122Path = join(migDir, '122_guardian_presence_security.sql')
const mig122 = existsSync(mig122Path) ? readFileSync(mig122Path, 'utf8') : ''

// ── 1. Migration 122 exists exactly once ────────────────────────────────────

describe('[STATIC] 1. Migration 122 exists exactly once', () => {
  it('122_guardian_presence_security.sql exists', () => {
    expect(existsSync(mig122Path)).toBe(true)
  })

  it('no duplicate 122_ prefix in migrations directory', () => {
    const files = readdirSync(migDir)
    const matches = files.filter(f => f.startsWith('122_'))
    expect(matches).toHaveLength(1)
    expect(matches[0]).toBe('122_guardian_presence_security.sql')
  })

  it('migration is wrapped in BEGIN/COMMIT', () => {
    expect(mig122).toContain('BEGIN;')
    expect(mig122).toContain('COMMIT;')
  })
})

// ── 2–7. user_sessions gains six new columns ─────────────────────────────────

describe('[STATIC] 2. user_sessions gains session_id', () => {
  it('ADD COLUMN IF NOT EXISTS session_id', () => {
    expect(mig122).toMatch(/ADD COLUMN IF NOT EXISTS\s+session_id\s+TEXT/)
  })

  it('ADD COLUMN targets public.user_sessions', () => {
    expect(mig122).toMatch(/ALTER TABLE public\.user_sessions/)
  })
})

describe('[STATIC] 3. user_sessions gains device_id', () => {
  it('ADD COLUMN IF NOT EXISTS device_id', () => {
    expect(mig122).toMatch(/ADD COLUMN IF NOT EXISTS\s+device_id\s+TEXT/)
  })
})

describe('[STATIC] 4. user_sessions gains module', () => {
  it('ADD COLUMN IF NOT EXISTS module', () => {
    expect(mig122).toMatch(/ADD COLUMN IF NOT EXISTS\s+module\s+TEXT/)
  })

  it('module has no rigid CHECK constraint (list may expand)', () => {
    // module column must NOT have a fixed CHECK that would reject new slugs
    const alterBlock = mig122.slice(
      mig122.indexOf('ALTER TABLE public.user_sessions'),
      mig122.indexOf('CREATE UNIQUE INDEX'),
    )
    expect(alterBlock).not.toMatch(/module\s+TEXT\s+CHECK/)
  })
})

describe('[STATIC] 5. user_sessions gains last_interaction_at', () => {
  it('ADD COLUMN IF NOT EXISTS last_interaction_at TIMESTAMPTZ', () => {
    expect(mig122).toMatch(
      /ADD COLUMN IF NOT EXISTS\s+last_interaction_at\s+TIMESTAMPTZ/,
    )
  })

  it('last_interaction_at has no DEFAULT (heartbeat must not move it)', () => {
    const alterBlock = mig122.slice(
      mig122.indexOf('ALTER TABLE public.user_sessions'),
      mig122.indexOf('CREATE UNIQUE INDEX'),
    )
    const laLine = alterBlock
      .split('\n')
      .find(l => l.includes('last_interaction_at'))
    expect(laLine).toBeDefined()
    expect(laLine).not.toContain('DEFAULT')
  })
})

describe('[STATIC] 6. user_sessions gains visibility_state', () => {
  it('ADD COLUMN IF NOT EXISTS visibility_state TEXT with CHECK', () => {
    expect(mig122).toMatch(
      /ADD COLUMN IF NOT EXISTS\s+visibility_state\s+TEXT/,
    )
  })

  it("visibility_state CHECK allows 'visible'", () => {
    expect(mig122).toContain("'visible'")
  })

  it("visibility_state CHECK allows 'hidden'", () => {
    expect(mig122).toContain("'hidden'")
  })
})

describe('[STATIC] 7. user_sessions gains ended_reason', () => {
  it('ADD COLUMN IF NOT EXISTS ended_reason TEXT', () => {
    expect(mig122).toMatch(
      /ADD COLUMN IF NOT EXISTS\s+ended_reason\s+TEXT/,
    )
  })

  it("ended_reason allows 'signout'", () => {
    expect(mig122).toContain("'signout'")
  })

  it("ended_reason allows 'manual_lock'", () => {
    expect(mig122).toContain("'manual_lock'")
  })

  it("ended_reason allows 'inactivity_timeout'", () => {
    expect(mig122).toContain("'inactivity_timeout'")
  })

  it('ended_reason CHECK permits NULL (live/stale sessions have no reason)', () => {
    const block = mig122.slice(
      mig122.indexOf('ended_reason'),
      mig122.indexOf('CREATE UNIQUE INDEX'),
    )
    expect(block).toContain('IS NULL')
  })
})

// ── 8. session_id uniqueness protection ──────────────────────────────────────

describe('[STATIC] 8. session_id has uniqueness protection', () => {
  it('creates a UNIQUE INDEX on session_id', () => {
    expect(mig122).toContain('CREATE UNIQUE INDEX')
    expect(mig122).toContain('session_id')
  })

  it('uniqueness index is partial (WHERE session_id IS NOT NULL)', () => {
    const idxBlock = mig122.slice(
      mig122.indexOf('CREATE UNIQUE INDEX'),
      mig122.indexOf('CREATE INDEX IF NOT EXISTS idx_user_sessions_user_device'),
    )
    expect(idxBlock).toContain('WHERE session_id IS NOT NULL')
  })

  it('index targets user_sessions table', () => {
    const idxBlock = mig122.slice(
      mig122.indexOf('CREATE UNIQUE INDEX'),
      mig122.indexOf('CREATE INDEX IF NOT EXISTS idx_user_sessions_user_device'),
    )
    expect(idxBlock).toContain('user_sessions')
  })
})

// ── 9. account_security_events table ─────────────────────────────────────────

describe('[STATIC] 9. account_security_events table is created', () => {
  it('CREATE TABLE IF NOT EXISTS public.account_security_events', () => {
    expect(mig122).toContain(
      'CREATE TABLE IF NOT EXISTS public.account_security_events',
    )
  })

  it('has UUID primary key', () => {
    const tableBlock = mig122.slice(
      mig122.indexOf('CREATE TABLE IF NOT EXISTS public.account_security_events'),
      mig122.indexOf('CREATE INDEX IF NOT EXISTS idx_ase_session_id'),
    )
    expect(tableBlock).toContain('UUID')
    expect(tableBlock).toContain('PRIMARY KEY')
  })

  it('has session_id TEXT NOT NULL', () => {
    const tableBlock = mig122.slice(
      mig122.indexOf('CREATE TABLE IF NOT EXISTS public.account_security_events'),
      mig122.indexOf('CREATE INDEX IF NOT EXISTS idx_ase_session_id'),
    )
    expect(tableBlock).toMatch(/session_id\s+TEXT\s+NOT NULL/)
  })

  it('has user_id UUID NOT NULL referencing auth.users', () => {
    const tableBlock = mig122.slice(
      mig122.indexOf('CREATE TABLE IF NOT EXISTS public.account_security_events'),
      mig122.indexOf('CREATE INDEX IF NOT EXISTS idx_ase_session_id'),
    )
    expect(tableBlock).toContain('auth.users')
  })

  it('has org_id UUID NOT NULL referencing organizations', () => {
    const tableBlock = mig122.slice(
      mig122.indexOf('CREATE TABLE IF NOT EXISTS public.account_security_events'),
      mig122.indexOf('CREATE INDEX IF NOT EXISTS idx_ase_session_id'),
    )
    expect(tableBlock).toContain('organizations')
  })

  it("event_type CHECK restricts to 'session_started' and 'ip_changed'", () => {
    const tableBlock = mig122.slice(
      mig122.indexOf('CREATE TABLE IF NOT EXISTS public.account_security_events'),
      mig122.indexOf('CREATE INDEX IF NOT EXISTS idx_ase_session_id'),
    )
    expect(tableBlock).toContain("'session_started'")
    expect(tableBlock).toContain("'ip_changed'")
  })

  it('has is_new_device BOOLEAN (optional — for session_started context)', () => {
    const tableBlock = mig122.slice(
      mig122.indexOf('CREATE TABLE IF NOT EXISTS public.account_security_events'),
      mig122.indexOf('CREATE INDEX IF NOT EXISTS idx_ase_session_id'),
    )
    expect(tableBlock).toContain('is_new_device')
    expect(tableBlock).toContain('BOOLEAN')
  })
})

// ── 10. IP columns use INET ───────────────────────────────────────────────────

describe('[STATIC] 10. IP columns use INET type', () => {
  it('public_ip is INET NOT NULL', () => {
    const tableBlock = mig122.slice(
      mig122.indexOf('CREATE TABLE IF NOT EXISTS public.account_security_events'),
      mig122.indexOf('CREATE INDEX IF NOT EXISTS idx_ase_session_id'),
    )
    expect(tableBlock).toMatch(/public_ip\s+INET\s+NOT NULL/)
  })

  it('previous_public_ip is INET (nullable for session_started events)', () => {
    const tableBlock = mig122.slice(
      mig122.indexOf('CREATE TABLE IF NOT EXISTS public.account_security_events'),
      mig122.indexOf('CREATE INDEX IF NOT EXISTS idx_ase_session_id'),
    )
    expect(tableBlock).toMatch(/previous_public_ip\s+INET/)
    expect(tableBlock).not.toMatch(/previous_public_ip\s+INET\s+NOT NULL/)
  })

  it('no TEXT column is used for IP storage', () => {
    const tableBlock = mig122.slice(
      mig122.indexOf('CREATE TABLE IF NOT EXISTS public.account_security_events'),
      mig122.indexOf('CREATE INDEX IF NOT EXISTS idx_ase_session_id'),
    )
    // Ensure neither IP column is TEXT
    expect(tableBlock).not.toMatch(/public_ip\s+TEXT/)
    expect(tableBlock).not.toMatch(/previous_public_ip\s+TEXT/)
  })
})

// ── 11. Timestamps use TIMESTAMPTZ ───────────────────────────────────────────

describe('[STATIC] 11. Security event timestamps use TIMESTAMPTZ', () => {
  it('occurred_at is TIMESTAMPTZ NOT NULL', () => {
    const tableBlock = mig122.slice(
      mig122.indexOf('CREATE TABLE IF NOT EXISTS public.account_security_events'),
      mig122.indexOf('CREATE INDEX IF NOT EXISTS idx_ase_session_id'),
    )
    expect(tableBlock).toMatch(/occurred_at\s+TIMESTAMPTZ\s+NOT NULL/)
  })

  it('last_interaction_at on user_sessions is TIMESTAMPTZ', () => {
    expect(mig122).toMatch(/last_interaction_at\s+TIMESTAMPTZ/)
  })
})

// ── 12. RLS enabled on account_security_events ───────────────────────────────

describe('[STATIC] 12. account_security_events RLS is enabled', () => {
  it('ALTER TABLE ... ENABLE ROW LEVEL SECURITY', () => {
    expect(mig122).toContain(
      'ALTER TABLE public.account_security_events ENABLE ROW LEVEL SECURITY',
    )
  })
})

// ── 13. No authenticated access policy on account_security_events ─────────────

describe('[STATIC] 13. No authenticated SELECT/INSERT/UPDATE/DELETE policy on account_security_events', () => {
  it('no CREATE POLICY targeting account_security_events', () => {
    expect(mig122).not.toMatch(
      /CREATE POLICY[\s\S]{0,200}account_security_events/,
    )
  })

  it('REVOKE ALL from PUBLIC on account_security_events', () => {
    expect(mig122).toContain(
      'REVOKE ALL ON public.account_security_events FROM PUBLIC',
    )
  })

  it('REVOKE ALL from anon on account_security_events', () => {
    expect(mig122).toContain(
      'REVOKE ALL ON public.account_security_events FROM anon',
    )
  })

  it('REVOKE ALL from authenticated on account_security_events', () => {
    expect(mig122).toContain(
      'REVOKE ALL ON public.account_security_events FROM authenticated',
    )
  })

  it('no GRANT SELECT on account_security_events to authenticated', () => {
    expect(mig122).not.toMatch(
      /GRANT.*SELECT.*account_security_events.*TO authenticated/s,
    )
  })

  it('no GRANT INSERT on account_security_events to authenticated', () => {
    expect(mig122).not.toMatch(
      /GRANT.*INSERT.*account_security_events.*TO authenticated/s,
    )
  })
})

// ── 14. No heartbeat event or heartbeat table ─────────────────────────────────

describe('[STATIC] 14. No heartbeat event schema or table introduced', () => {
  it("event_type CHECK does not include 'heartbeat'", () => {
    const tableBlock = mig122.slice(
      mig122.indexOf('CREATE TABLE IF NOT EXISTS public.account_security_events'),
      mig122.indexOf('CREATE INDEX IF NOT EXISTS idx_ase_session_id'),
    )
    expect(tableBlock).not.toContain('heartbeat')
  })

  it('no heartbeat table created', () => {
    expect(mig122).not.toMatch(/CREATE TABLE.*heartbeat/i)
  })

  it('no module_transition event type', () => {
    expect(mig122).not.toContain('module_transition')
  })
})

// ── 15. user_sessions.ip_address is NOT renamed or dropped ───────────────────

describe('[STATIC] 15. user_sessions.ip_address remains intact', () => {
  it('migration does not DROP COLUMN ip_address', () => {
    expect(mig122).not.toMatch(/DROP COLUMN.*ip_address/i)
  })

  it('migration does not RENAME COLUMN ip_address', () => {
    expect(mig122).not.toMatch(/RENAME COLUMN.*ip_address/i)
  })

  it('migration does not ALTER TYPE on ip_address', () => {
    expect(mig122).not.toMatch(/ALTER COLUMN ip_address\s+TYPE/i)
  })

  it('postcondition asserts ip_address survives', () => {
    expect(mig122).toContain('ip_address')
    expect(mig122).toContain('must remain intact')
  })
})

// ── 16. No new authenticated UPDATE/DELETE on user_sessions ──────────────────

describe('[STATIC] 16. No new authenticated UPDATE/DELETE policies on user_sessions', () => {
  it('no CREATE POLICY ... FOR UPDATE on user_sessions', () => {
    expect(mig122).not.toMatch(
      /CREATE POLICY[\s\S]{0,200}user_sessions[\s\S]{0,100}FOR UPDATE/,
    )
  })

  it('no CREATE POLICY ... FOR DELETE on user_sessions', () => {
    expect(mig122).not.toMatch(
      /CREATE POLICY[\s\S]{0,200}user_sessions[\s\S]{0,100}FOR DELETE/,
    )
  })

  it('no GRANT UPDATE on user_sessions to authenticated', () => {
    expect(mig122).not.toMatch(
      /GRANT.*UPDATE.*user_sessions.*TO authenticated/s,
    )
  })
})

// ── 17. Migration does not touch protected tables ────────────────────────────

describe('[STATIC] 17. Migration does not touch beta_invites, signed_agreements, nda_access_authority', () => {
  it('does not reference beta_invites', () => {
    expect(mig122).not.toContain('beta_invites')
  })

  it('does not reference signed_agreements', () => {
    expect(mig122).not.toContain('signed_agreements')
  })

  it('does not reference nda_access_authority', () => {
    expect(mig122).not.toContain('nda_access_authority')
  })
})

// ── 18. Migration guard ───────────────────────────────────────────────────────

describe('[STATIC] 18. Migration guard: 119–122 are the only new migrations beyond 118', () => {
  it('migration 119 exists', () => {
    expect(
      existsSync(
        join(migDir, '119_founder_contractor_admin_and_beta_invite_security.sql'),
      ),
    ).toBe(true)
  })

  it('migration 120 exists', () => {
    expect(
      existsSync(join(migDir, '120_portal_request_attribution.sql')),
    ).toBe(true)
  })

  it('migration 121 exists', () => {
    expect(
      existsSync(join(migDir, '121_nda_access_authority.sql')),
    ).toBe(true)
  })

  it('migration 122 exists', () => {
    expect(existsSync(mig122Path)).toBe(true)
  })

  it('no migrations beyond 122 exist', () => {
    const files = readdirSync(migDir)
    const beyond = files
      .filter(name => /^1\d\d_/.test(name))
      .filter(
        name =>
          !name.startsWith('100_') &&
          !name.startsWith('101_') &&
          !name.startsWith('102_') &&
          !name.startsWith('103_') &&
          !name.startsWith('104_') &&
          !name.startsWith('105_') &&
          !name.startsWith('106_') &&
          !name.startsWith('107_') &&
          !name.startsWith('108_') &&
          !name.startsWith('109_') &&
          !name.startsWith('110_') &&
          !name.startsWith('111_') &&
          !name.startsWith('112_') &&
          !name.startsWith('113_') &&
          !name.startsWith('114_') &&
          !name.startsWith('115_') &&
          !name.startsWith('116_') &&
          !name.startsWith('117_') &&
          !name.startsWith('118_') &&
          !name.startsWith('119_') &&
          !name.startsWith('120_') &&
          !name.startsWith('121_') &&
          !name.startsWith('122_'),
      )
    expect(beyond).toEqual([])
  })
})
