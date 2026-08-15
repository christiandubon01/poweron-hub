/**
 * GUARDIAN-3B3E2 — Inactive-user RLS Authorization Boundary
 *
 * Proof scope: migration 124 replaces three SECURITY DEFINER helper functions
 * to gate org authority on is_active = true.
 *
 * These are static SQL contract tests: they read the migration file and assert
 * behavioral properties of the SQL without executing against a live DB.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, it, expect } from 'vitest'

const MIG_PATH = resolve(
  __dirname,
  '../../supabase/migrations/124_inactive_user_rls_boundary.sql'
)
const mig = readFileSync(MIG_PATH, 'utf-8')

// ── helper: extract the CREATE OR REPLACE FUNCTION body for a named function ──
function extractFunctionBlock(sql: string, funcName: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${funcName}(`)
  if (start === -1) throw new Error(`Function block for ${funcName} not found`)
  // Find the closing $$ after the opening $$
  const bodyStart = sql.indexOf('$$', start)
  if (bodyStart === -1) throw new Error(`Dollar-quote open not found for ${funcName}`)
  const bodyEnd = sql.indexOf('$$', bodyStart + 2)
  if (bodyEnd === -1) throw new Error(`Dollar-quote close not found for ${funcName}`)
  // Include from CREATE to end of the closing $$;
  const blockEnd = sql.indexOf(';', bodyEnd)
  return sql.slice(start, blockEnd + 1)
}

const userOrgIdBlock    = extractFunctionBlock(mig, 'user_org_id')
const userRoleBlock     = extractFunctionBlock(mig, 'user_role')
const isOrgAdminForBlock = extractFunctionBlock(mig, 'is_org_admin_for')

// ── Group 1: user_org_id() ───────────────────────────────────────────────────

describe('user_org_id() function definition', () => {
  it('uses CREATE OR REPLACE FUNCTION', () => {
    expect(userOrgIdBlock).toMatch(/CREATE OR REPLACE FUNCTION public\.user_org_id\(\)/)
  })

  it('returns uuid', () => {
    expect(userOrgIdBlock.toLowerCase()).toMatch(/returns\s+uuid/)
  })

  it('is STABLE', () => {
    expect(userOrgIdBlock).toMatch(/STABLE/)
  })

  it('is SECURITY DEFINER', () => {
    expect(userOrgIdBlock).toMatch(/SECURITY DEFINER/)
  })

  it('sets search_path to public', () => {
    expect(userOrgIdBlock).toMatch(/SET search_path TO 'public'/)
  })

  it('queries profiles for the authenticated user', () => {
    expect(userOrgIdBlock).toMatch(/FROM profiles WHERE id = auth\.uid\(\)/)
  })

  it('gates on is_active = true', () => {
    expect(userOrgIdBlock).toMatch(/AND is_active = true/)
  })

  it('selects org_id — not a surrogate column', () => {
    expect(userOrgIdBlock).toMatch(/SELECT org_id FROM profiles/)
  })
})

// ── Group 2: user_role() ────────────────────────────────────────────────────

describe('user_role() function definition', () => {
  it('uses CREATE OR REPLACE FUNCTION', () => {
    expect(userRoleBlock).toMatch(/CREATE OR REPLACE FUNCTION public\.user_role\(\)/)
  })

  it('returns text', () => {
    expect(userRoleBlock.toLowerCase()).toMatch(/returns\s+text/)
  })

  it('is STABLE', () => {
    expect(userRoleBlock).toMatch(/STABLE/)
  })

  it('is SECURITY DEFINER', () => {
    expect(userRoleBlock).toMatch(/SECURITY DEFINER/)
  })

  it('sets search_path to public', () => {
    expect(userRoleBlock).toMatch(/SET search_path TO 'public'/)
  })

  it('queries profiles for the authenticated user', () => {
    expect(userRoleBlock).toMatch(/FROM profiles WHERE id = auth\.uid\(\)/)
  })

  it('gates on is_active = true', () => {
    expect(userRoleBlock).toMatch(/AND is_active = true/)
  })

  it('selects role — not a surrogate column', () => {
    expect(userRoleBlock).toMatch(/SELECT role FROM profiles/)
  })
})

// ── Group 3: is_org_admin_for() ─────────────────────────────────────────────

describe('is_org_admin_for() function definition', () => {
  it('uses CREATE OR REPLACE FUNCTION with p_org_id uuid param', () => {
    expect(isOrgAdminForBlock).toMatch(
      /CREATE OR REPLACE FUNCTION public\.is_org_admin_for\(p_org_id uuid\)/
    )
  })

  it('returns boolean', () => {
    expect(isOrgAdminForBlock.toLowerCase()).toMatch(/returns\s+boolean/)
  })

  it('is STABLE', () => {
    expect(isOrgAdminForBlock).toMatch(/STABLE/)
  })

  it('is SECURITY DEFINER', () => {
    expect(isOrgAdminForBlock).toMatch(/SECURITY DEFINER/)
  })

  it('sets search_path to public', () => {
    expect(isOrgAdminForBlock).toMatch(/SET search_path TO 'public'/)
  })

  it('queries profiles for the authenticated user', () => {
    expect(isOrgAdminForBlock).toMatch(/FROM profiles\s+WHERE id = auth\.uid\(\)/)
  })

  it('gates on is_active = true', () => {
    expect(isOrgAdminForBlock).toMatch(/AND is_active = true/)
  })

  it('checks org_id matches the parameter', () => {
    expect(isOrgAdminForBlock).toMatch(/AND org_id = p_org_id/)
  })

  it('restricts to owner/admin roles — no new role values', () => {
    expect(isOrgAdminForBlock).toMatch(/role IN \('owner', 'admin'\)/)
  })

  it('uses EXISTS for boolean semantics', () => {
    expect(isOrgAdminForBlock).toMatch(/SELECT EXISTS/)
  })
})

// ── Group 4: Active-user logical invariant (SQL proof) ──────────────────────

describe('active-user logical invariant', () => {
  it('user_org_id WHERE clause requires both uid match AND is_active=true', () => {
    // For an active user: id = auth.uid() AND is_active = true
    // Since is_active = true is always satisfied for active users, the result
    // is identical to the old WHERE id = auth.uid() — no behavior change.
    expect(userOrgIdBlock).toMatch(/id = auth\.uid\(\) AND is_active = true/)
  })

  it('user_role WHERE clause requires both uid match AND is_active=true', () => {
    expect(userRoleBlock).toMatch(/id = auth\.uid\(\) AND is_active = true/)
  })

  it('is_org_admin_for WHERE clause requires uid match, org match, role match, AND is_active=true', () => {
    // Four-predicate AND means a row only passes if all four are true.
    // Active owner calling with their org_id → all four conditions satisfied.
    expect(isOrgAdminForBlock).toMatch(/id = auth\.uid\(\)/)
    expect(isOrgAdminForBlock).toMatch(/AND org_id = p_org_id/)
    expect(isOrgAdminForBlock).toMatch(/AND role IN \('owner', 'admin'\)/)
    expect(isOrgAdminForBlock).toMatch(/AND is_active = true/)
  })
})

// ── Group 5: Inactive-user revocation logical proof ─────────────────────────

describe('inactive-user revocation logical proof', () => {
  it('user_org_id returns NULL for inactive user (no matching row → NULL aggregate)', () => {
    // SELECT org_id FROM profiles WHERE id = X AND is_active = true
    // If is_active = false → zero rows → scalar SQL SELECT returns NULL
    expect(userOrgIdBlock).toMatch(/AND is_active = true/)
    // The return type is uuid, and scalar SELECT over 0 rows = NULL uuid
    expect(userOrgIdBlock.toLowerCase()).toMatch(/returns\s+uuid/)
  })

  it('user_role returns NULL for inactive user (no matching row → NULL text)', () => {
    expect(userRoleBlock).toMatch(/AND is_active = true/)
    expect(userRoleBlock.toLowerCase()).toMatch(/returns\s+text/)
  })

  it('is_org_admin_for returns false for inactive user (EXISTS over empty set → false)', () => {
    // SELECT EXISTS(SELECT 1 FROM profiles WHERE ... AND is_active = true)
    // If is_active = false → inner SELECT is empty → EXISTS = false
    expect(isOrgAdminForBlock).toMatch(/SELECT EXISTS/)
    expect(isOrgAdminForBlock).toMatch(/AND is_active = true/)
    expect(isOrgAdminForBlock.toLowerCase()).toMatch(/returns\s+boolean/)
  })
})

// ── Group 6: No forbidden role values introduced ─────────────────────────────

// Scope these checks to the function-definition section only (before the DO $$
// postcondition block). The postcondition legitimately contains these strings
// when asserting they are absent as enum labels.
const doBlockStart = mig.indexOf('DO $$')
const funcDefsOnly = doBlockStart !== -1 ? mig.slice(0, doBlockStart) : mig

describe('no new role or access-state values', () => {
  it('does not introduce revoked role value in function definitions', () => {
    // Strip comments, then check no 'revoked' string literal in the function bodies
    const noComments = funcDefsOnly.replace(/--[^\n]*/g, '')
    expect(noComments).not.toMatch(/'revoked'/)
  })

  it('does not introduce blocked role value in function definitions', () => {
    const noComments = funcDefsOnly.replace(/--[^\n]*/g, '')
    expect(noComments).not.toMatch(/'blocked'/)
  })

  it('does not introduce inactive role value in function definitions', () => {
    // Only a SQL string literal counts — the word "inactive" in a comment is fine.
    const noComments = funcDefsOnly.replace(/--[^\n]*/g, '')
    expect(noComments).not.toMatch(/'inactive'/)
  })

  it('does not add a new access-state column to profiles', () => {
    expect(mig).not.toMatch(/ALTER TABLE.*profiles.*ADD COLUMN/i)
  })
})

// ── Group 7: No policy or data mutations ────────────────────────────────────

describe('migration makes no policy or data mutations', () => {
  // Strip SQL line comments before checking to avoid false positives from
  // comment text that mentions these keywords.
  const sqlNoComments = mig
    .split('\n')
    .filter(line => !line.trimStart().startsWith('--'))
    .join('\n')

  it('does not CREATE any new RLS policy', () => {
    expect(sqlNoComments).not.toMatch(/CREATE POLICY/i)
  })

  it('does not DROP any existing RLS policy', () => {
    expect(sqlNoComments).not.toMatch(/DROP POLICY/i)
  })

  it('does not ALTER any existing RLS policy', () => {
    expect(sqlNoComments).not.toMatch(/ALTER POLICY/i)
  })

  it('does not UPDATE any row (no data mutation)', () => {
    expect(sqlNoComments).not.toMatch(/\bUPDATE\b/i)
  })

  it('does not INSERT any row (no data mutation)', () => {
    // Allow INSERT in postcondition proc context — but there are none here.
    expect(sqlNoComments).not.toMatch(/\bINSERT\b/i)
  })

  it('does not DELETE any row (no data mutation)', () => {
    expect(sqlNoComments).not.toMatch(/\bDELETE\b/i)
  })

  it('does not ALTER TABLE profiles', () => {
    expect(sqlNoComments).not.toMatch(/ALTER TABLE.*public\.profiles/i)
    expect(sqlNoComments).not.toMatch(/ALTER TABLE.*profiles/i)
  })

  it('does not ALTER TABLE organizations', () => {
    expect(sqlNoComments).not.toMatch(/ALTER TABLE.*organizations/i)
  })

  it('does not ALTER TABLE user_sessions', () => {
    expect(sqlNoComments).not.toMatch(/ALTER TABLE.*user_sessions/i)
  })

  it('wraps in a transaction', () => {
    expect(mig).toMatch(/^BEGIN;/m)
    expect(mig).toMatch(/^COMMIT;/m)
  })
})

// ── Group 8: Postcondition block present ────────────────────────────────────

describe('postcondition assertions in migration', () => {
  it('asserts user_org_id exists', () => {
    expect(mig).toMatch(/user_org_id not found/)
  })

  it('asserts user_org_id checks is_active', () => {
    expect(mig).toMatch(/user_org_id does not check is_active/)
  })

  it('asserts user_role exists', () => {
    expect(mig).toMatch(/user_role not found/)
  })

  it('asserts user_role checks is_active', () => {
    expect(mig).toMatch(/user_role does not check is_active/)
  })

  it('asserts is_org_admin_for exists', () => {
    expect(mig).toMatch(/is_org_admin_for not found/)
  })

  it('asserts is_org_admin_for checks is_active', () => {
    expect(mig).toMatch(/is_org_admin_for does not check is_active/)
  })

  it('asserts all three remain SECURITY DEFINER', () => {
    expect(mig).toMatch(/lost SECURITY DEFINER/)
  })

  it('asserts profiles.is_active is still boolean NOT NULL', () => {
    expect(mig).toMatch(/profiles\.is_active missing or nullable/)
  })

  it('asserts no forbidden role enum values', () => {
    expect(mig).toMatch(/forbidden role enum values/)
  })
})
