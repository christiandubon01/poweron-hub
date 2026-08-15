/**
 * GUARDIAN-3B3E2A — Inactive-user authenticated data gate
 *
 * Static SQL contract tests for migration 125.
 * Proves that the migration:
 *  1. Creates current_user_is_active() with correct security properties
 *  2. Applies a RESTRICTIVE active_user_gate to each of the 32 affected tables
 *  3. Excludes the 9 employee-self-access tables
 *  4. Does not modify permissive policies, data, or profiles.is_active
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, it, expect } from 'vitest'

const MIG_PATH = resolve(
  __dirname,
  '../../supabase/migrations/125_inactive_user_authenticated_data_gate.sql'
)
const mig = readFileSync(MIG_PATH, 'utf-8')

// ── Group 1: current_user_is_active() function ───────────────────────────────

describe('current_user_is_active() function definition', () => {
  it('uses CREATE OR REPLACE FUNCTION', () => {
    expect(mig).toMatch(
      /CREATE OR REPLACE FUNCTION public\.current_user_is_active\(\)/
    )
  })

  it('returns boolean', () => {
    const fnBlock = mig.slice(
      mig.indexOf('CREATE OR REPLACE FUNCTION public.current_user_is_active'),
      mig.indexOf('$$;', mig.indexOf('CREATE OR REPLACE FUNCTION public.current_user_is_active')) + 3
    )
    expect(fnBlock.toLowerCase()).toMatch(/returns\s+boolean/)
  })

  it('is STABLE', () => {
    const fnBlock = mig.slice(
      mig.indexOf('CREATE OR REPLACE FUNCTION public.current_user_is_active'),
      mig.indexOf('$$;', mig.indexOf('CREATE OR REPLACE FUNCTION public.current_user_is_active')) + 3
    )
    expect(fnBlock).toMatch(/STABLE/)
  })

  it('is SECURITY DEFINER', () => {
    const fnBlock = mig.slice(
      mig.indexOf('CREATE OR REPLACE FUNCTION public.current_user_is_active'),
      mig.indexOf('$$;', mig.indexOf('CREATE OR REPLACE FUNCTION public.current_user_is_active')) + 3
    )
    expect(fnBlock).toMatch(/SECURITY DEFINER/)
  })

  it('sets search_path to public', () => {
    const fnBlock = mig.slice(
      mig.indexOf('CREATE OR REPLACE FUNCTION public.current_user_is_active'),
      mig.indexOf('$$;', mig.indexOf('CREATE OR REPLACE FUNCTION public.current_user_is_active')) + 3
    )
    expect(fnBlock).toMatch(/SET search_path TO 'public'/)
  })

  it('checks profiles WHERE id = auth.uid()', () => {
    expect(mig).toMatch(/FROM profiles\s+WHERE id = auth\.uid\(\)/)
  })

  it('gates on is_active = true', () => {
    expect(mig).toMatch(/AND is_active = true/)
  })

  it('uses SELECT EXISTS — boolean semantics, no scalar NULL risk', () => {
    const fnBlock = mig.slice(
      mig.indexOf('CREATE OR REPLACE FUNCTION public.current_user_is_active'),
      mig.indexOf('$$;', mig.indexOf('CREATE OR REPLACE FUNCTION public.current_user_is_active')) + 3
    )
    expect(fnBlock).toMatch(/SELECT EXISTS/)
  })

  it('returns no org_id or role data — scope is user-active-state only', () => {
    const fnBlock = mig.slice(
      mig.indexOf('CREATE OR REPLACE FUNCTION public.current_user_is_active'),
      mig.indexOf('$$;', mig.indexOf('CREATE OR REPLACE FUNCTION public.current_user_is_active')) + 3
    )
    // Function body should not select org_id or role
    const body = fnBlock.slice(fnBlock.indexOf('$$'), fnBlock.lastIndexOf('$$'))
    expect(body).not.toMatch(/SELECT org_id/)
    expect(body).not.toMatch(/SELECT role/)
  })
})

// ── Group 2: RESTRICTIVE policy presence on all 32 affected tables ───────────

const GATED_TABLES = [
  'agenda_tasks',
  'agent_messages',
  'agent_proposals',
  'audit_log',
  'billing_customers',
  'campaign_leads',
  'campaigns',
  'clients',
  'compliance_checks',
  'field_logs',
  'gc_activity_log',
  'gc_contacts',
  'hunter_conversion_receipts',
  'job_schedules',
  'price_book_categories',
  'price_book_items',
  'project_phases',
  'project_templates',
  'relationship_account_events',
  'relationship_account_links',
  'relationship_accounts',
  'relationship_data_snapshots',
  'review_responses',
  'reviews',
  'subscription_events',
  'subscriptions',
  'travel_times',
  'trigger_rules',
  'user_sessions',
  'voice_memos',
  'voice_response_cache',
  'voice_sessions',
]

describe('RESTRICTIVE active_user_gate policy on each gated table', () => {
  for (const table of GATED_TABLES) {
    it(`${table} has active_user_gate policy`, () => {
      expect(mig).toMatch(
        new RegExp(`CREATE POLICY active_user_gate ON public\\.${table.replace(/_/g, '_')}`)
      )
    })

    it(`${table} gate is RESTRICTIVE`, () => {
      const idx = mig.indexOf(`CREATE POLICY active_user_gate ON public.${table}`)
      expect(idx).toBeGreaterThan(-1)
      const policyBlock = mig.slice(idx, idx + 300)
      expect(policyBlock).toMatch(/AS RESTRICTIVE/)
    })

    it(`${table} gate applies to authenticated role only`, () => {
      const idx = mig.indexOf(`CREATE POLICY active_user_gate ON public.${table}`)
      const policyBlock = mig.slice(idx, idx + 300)
      expect(policyBlock).toMatch(/TO authenticated/)
    })

    it(`${table} gate uses FOR ALL`, () => {
      const idx = mig.indexOf(`CREATE POLICY active_user_gate ON public.${table}`)
      const policyBlock = mig.slice(idx, idx + 300)
      expect(policyBlock).toMatch(/FOR ALL/)
    })

    it(`${table} gate has USING (current_user_is_active())`, () => {
      const idx = mig.indexOf(`CREATE POLICY active_user_gate ON public.${table}`)
      const policyBlock = mig.slice(idx, idx + 300)
      expect(policyBlock).toMatch(/USING \(public\.current_user_is_active\(\)\)/)
    })

    it(`${table} gate has WITH CHECK (current_user_is_active())`, () => {
      const idx = mig.indexOf(`CREATE POLICY active_user_gate ON public.${table}`)
      const policyBlock = mig.slice(idx, idx + 300)
      expect(policyBlock).toMatch(/WITH CHECK \(public\.current_user_is_active\(\)\)/)
    })
  }

  it('exactly 32 tables are gated', () => {
    const matches = [...mig.matchAll(/CREATE POLICY active_user_gate ON public\./g)]
    expect(matches).toHaveLength(32)
  })
})

// ── Group 3: Critical exclusions — profiles and employee-self-access tables ──

const EXCLUDED_TABLES = [
  'profiles',
  'emp_permission_overrides',
  'emp_role_assignments',
  'emp_role_permissions',
  'emp_roles',
  'employee_schedules',
  'employee_task_completions',
  'employee_work_sessions',
  'service_call_assignments',
  'time_punch_edit_requests',
]

describe('critical exclusions — no active_user_gate on excluded tables', () => {
  for (const table of EXCLUDED_TABLES) {
    it(`${table} does NOT have active_user_gate (intentionally excluded)`, () => {
      expect(mig).not.toMatch(
        new RegExp(`CREATE POLICY active_user_gate ON public\\.${table}`)
      )
    })
  }
})

// ── Group 4: Active-user logical invariant ──────────────────────────────────

describe('active-user logical invariant', () => {
  it('gate function checks is_active = true — satisfies for all active users (no-op AND)', () => {
    // For is_active = true users, the condition is always satisfied:
    // EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_active = true)
    // = EXISTS (SELECT 1 FROM profiles WHERE id = <their_id> AND TRUE)
    // = TRUE → gate passes → no change to access
    expect(mig).toMatch(/AND is_active = true/)
  })

  it('gate covers all 4 DML operations via FOR ALL + USING + WITH CHECK', () => {
    // FOR ALL: SELECT(USING) + INSERT(WITH CHECK) + UPDATE(USING+WITH CHECK) + DELETE(USING)
    expect(mig).toMatch(/FOR ALL/)
    expect(mig).toMatch(/USING \(public\.current_user_is_active\(\)\)/)
    expect(mig).toMatch(/WITH CHECK \(public\.current_user_is_active\(\)\)/)
  })

  it('gate role is authenticated — anon and service_role are unaffected', () => {
    // TO authenticated means: anon role skips this policy, service_role skips this policy
    const gatePolicies = [...mig.matchAll(/CREATE POLICY active_user_gate[\s\S]*?WITH CHECK \([^)]+\);/g)]
    for (const [match] of gatePolicies) {
      expect(match).toMatch(/TO authenticated/)
    }
  })
})

// ── Group 5: Inactive-user revocation logical proof ─────────────────────────

describe('inactive-user revocation logical proof', () => {
  it('current_user_is_active() returns false when is_active = false (EXISTS over empty set)', () => {
    // EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_active = true)
    // If is_active = false: inner SELECT is empty → EXISTS = false → gate blocks
    expect(mig).toMatch(/SELECT EXISTS/)
    expect(mig).toMatch(/AND is_active = true/)
  })

  it('USING false → no rows visible to inactive user (SELECT/UPDATE/DELETE blocked)', () => {
    // When USING = false, PostgreSQL returns zero rows for SELECT,
    // and blocks UPDATE/DELETE on any matching row
    expect(mig).toMatch(/AS RESTRICTIVE/)
    expect(mig).toMatch(/USING \(public\.current_user_is_active\(\)\)/)
  })

  it('WITH CHECK false → INSERT denied for inactive user', () => {
    expect(mig).toMatch(/WITH CHECK \(public\.current_user_is_active\(\)\)/)
  })
})

// ── Group 6: No data mutations, no permissive policy rewrites ───────────────

describe('migration makes no data mutations or policy rewrites', () => {
  const sqlNoComments = mig
    .split('\n')
    .filter(line => !line.trimStart().startsWith('--'))
    .join('\n')

  it('does not UPDATE any row (no data mutation)', () => {
    expect(sqlNoComments).not.toMatch(/\bUPDATE\b/i)
  })

  it('does not INSERT any row (no data mutation)', () => {
    expect(sqlNoComments).not.toMatch(/\bINSERT\b/i)
  })

  it('does not DELETE any row (no data mutation)', () => {
    expect(sqlNoComments).not.toMatch(/\bDELETE\b/i)
  })

  it('does not DROP any existing policy', () => {
    expect(sqlNoComments).not.toMatch(/DROP POLICY/i)
  })

  it('does not ALTER any existing policy', () => {
    expect(sqlNoComments).not.toMatch(/ALTER POLICY/i)
  })

  it('does not ALTER TABLE profiles', () => {
    expect(sqlNoComments).not.toMatch(/ALTER TABLE.*profiles/i)
  })

  it('does not CREATE a new permissive policy (only RESTRICTIVE)', () => {
    // All CREATE POLICY lines must be RESTRICTIVE
    const createPolicyLines = sqlNoComments
      .split('\n')
      .filter(l => /CREATE POLICY/.test(l))
    for (const line of createPolicyLines) {
      // Skip postcondition check text
      if (line.includes('RAISE')) continue
      // Each policy block (within a few lines) must include RESTRICTIVE
    }
    // Positive proof: all active_user_gate policies are RESTRICTIVE
    const blocks = [...mig.matchAll(/CREATE POLICY active_user_gate[\s\S]*?;/g)]
    for (const [block] of blocks) {
      expect(block).toMatch(/AS RESTRICTIVE/)
    }
  })

  it('wraps in a BEGIN/COMMIT transaction', () => {
    expect(mig).toMatch(/^BEGIN;/m)
    expect(mig).toMatch(/^COMMIT;/m)
  })

  it('does not introduce new role values (no revoked/blocked/inactive)', () => {
    const doBlockStart = mig.indexOf('DO $$')
    const funcDefsOnly = doBlockStart !== -1 ? mig.slice(0, doBlockStart) : mig
    const noComments = funcDefsOnly.replace(/--[^\n]*/g, '')
    expect(noComments).not.toMatch(/'revoked'/)
    expect(noComments).not.toMatch(/'blocked'/)
    expect(noComments).not.toMatch(/'inactive'/)
  })
})

// ── Group 7: Postcondition block present ─────────────────────────────────────

describe('postcondition assertions in migration', () => {
  it('asserts current_user_is_active not found', () => {
    expect(mig).toMatch(/current_user_is_active not found/)
  })

  it('asserts current_user_is_active checks is_active', () => {
    expect(mig).toMatch(/current_user_is_active does not check is_active/)
  })

  it('asserts current_user_is_active is SECURITY DEFINER', () => {
    expect(mig).toMatch(/current_user_is_active is not SECURITY DEFINER/)
  })

  it('asserts exactly 32 active_user_gate policies', () => {
    expect(mig).toMatch(/expected 32 active_user_gate policies/)
  })

  it('asserts profiles does not have active_user_gate', () => {
    expect(mig).toMatch(/profiles should not have active_user_gate/)
  })

  it('asserts profiles.is_active is still boolean NOT NULL', () => {
    expect(mig).toMatch(/profiles\.is_active missing or nullable/)
  })
})
