/**
 * COMM-PROD-1.1 — company identity onboarding must use the real organizations table.
 *
 * AppShell read from, and BetaOnboarding wrote to, a table named `orgs`. That
 * table does not exist — `organizations` is the multi-tenant root (migration 002).
 * The read always errored into a warn branch and the write was silently dropped,
 * so a brand-new contractor never reached company identity onboarding.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const store = vi.hoisted(() => ({
  rows: new Map<string, any>(),
  calls: [] as Array<{ table: string; op: 'select' | 'update'; id: string; payload?: any }>,
}))

vi.mock('@/lib/supabase', () => {
  const makeBuilder = (table: string): any => {
    let id = ''
    let pendingUpdate: any = null
    const builder: any = {
      select: vi.fn(() => builder),
      update: vi.fn((payload: any) => { pendingUpdate = payload; return builder }),
      eq: vi.fn((_column: string, value: unknown) => { id = String(value); return builder }),
      maybeSingle: vi.fn(async () => {
        if (table !== 'organizations') return { data: null, error: { message: `relation "${table}" does not exist` } }
        if (pendingUpdate) {
          store.calls.push({ table, op: 'update', id, payload: pendingUpdate })
          const next = { ...(store.rows.get(id) ?? { id }), ...pendingUpdate }
          store.rows.set(id, next)
          return { data: next, error: null }
        }
        store.calls.push({ table, op: 'select', id })
        return { data: store.rows.get(id) ?? null, error: null }
      }),
    }
    return builder
  }
  return { supabase: { from: vi.fn((table: string) => makeBuilder(table)) } }
})

import {
  buildOrganizationOnboardingPatch,
  hasConfiguredOrganizationIdentity,
  loadOrganizationOnboardingState,
  normalizeOrganizationIdentity,
  normalizeOrganizationOnboarding,
  saveOrganizationOnboarding,
} from '../organizationIdentityService'

const CONTRACTOR_ORG = '11111111-1111-1111-1111-111111111111'
const CUSTOMER_ZERO_ORG = '22222222-2222-2222-2222-222222222222'
const OTHER_ORG = '33333333-3333-3333-3333-333333333333'

beforeEach(() => {
  store.rows.clear()
  store.calls.length = 0
  // Fresh contractor: created by the signup trigger, no identity configured yet.
  store.rows.set(CONTRACTOR_ORG, {
    id: CONTRACTOR_ORG, name: "Dana's Organization", settings: {},
  })
  // Customer Zero: established identity on file.
  store.rows.set(CUSTOMER_ZERO_ORG, {
    id: CUSTOMER_ZERO_ORG,
    name: 'Power On Solutions, LLC',
    settings: {
      identity: {
        supportEmail: 'owner@poweronsolutionsllc.com',
        supportPhone: '760-339-9888',
        address: '',
        licenseNumber: 'C-10 #1151468',
        timezone: 'America/Los_Angeles',
        logoLight: '',
        logoDark: '',
      },
    },
  })
  store.rows.set(OTHER_ORG, {
    id: OTHER_ORG, name: 'Another Contractor LLC', settings: { onboarding: { complete: true } },
  })
})

describe('COMM-PROD-1.1 — organizations is the onboarding authority', () => {
  it('reads onboarding state from organizations, never from a nonexistent orgs table', async () => {
    const state = await loadOrganizationOnboardingState(CONTRACTOR_ORG)

    expect(state).not.toBeNull()
    expect(store.calls.every(call => call.table === 'organizations')).toBe(true)
    expect(state!.onboarding.complete).toBe(false)
    expect(state!.identityConfigured).toBe(false)
  })

  it('scopes every read and write to the authenticated org id', async () => {
    await loadOrganizationOnboardingState(CONTRACTOR_ORG)
    await saveOrganizationOnboarding(CONTRACTOR_ORG, { complete: true, businessName: 'Dana Electric LLC' })

    expect(store.calls.length).toBeGreaterThan(0)
    for (const call of store.calls) {
      expect(call.id).toBe(CONTRACTOR_ORG)
    }
    // No other organization was touched.
    expect(store.rows.get(CUSTOMER_ZERO_ORG).name).toBe('Power On Solutions, LLC')
    expect(store.rows.get(OTHER_ORG).name).toBe('Another Contractor LLC')
  })

  it('refuses to resolve an org when no id is supplied', async () => {
    expect(await loadOrganizationOnboardingState('')).toBeNull()
    expect(await saveOrganizationOnboarding('', { complete: true })).toBeNull()
    expect(store.calls).toHaveLength(0)
  })

  it('returns null rather than another org when the id does not exist', async () => {
    expect(await loadOrganizationOnboardingState('44444444-4444-4444-4444-444444444444')).toBeNull()
  })
})

describe('COMM-PROD-1.1 — fresh contractor reaches onboarding, then never again', () => {
  it('reports a brand-new organization as needing company identity onboarding', async () => {
    const state = await loadOrganizationOnboardingState(CONTRACTOR_ORG)

    expect(state!.onboarding.complete || state!.identityConfigured).toBe(false)
  })

  it('persists the answers so the gate does not reopen on the next load', async () => {
    await saveOrganizationOnboarding(CONTRACTOR_ORG, {
      complete: true,
      industry: 'electrical',
      businessName: 'Dana Electric LLC',
      ownerName: 'Dana Reyes',
      licenseNumber: 'C-10 #987654',
      cityState: 'Fresno, CA',
      aiName: 'NEXUS',
      nexusVoiceId: 'gOkFV1JMCt0G0n9xmBwV',
    })

    const state = await loadOrganizationOnboardingState(CONTRACTOR_ORG)
    expect(state!.onboarding).toMatchObject({
      complete: true,
      industry: 'electrical',
      businessName: 'Dana Electric LLC',
      ownerName: 'Dana Reyes',
      licenseNumber: 'C-10 #987654',
      cityState: 'Fresno, CA',
      aiName: 'NEXUS',
      nexusVoiceId: 'gOkFV1JMCt0G0n9xmBwV',
    })
  })

  it('resolves the contractor’s own company identity after onboarding — no Power On fallback', async () => {
    await saveOrganizationOnboarding(CONTRACTOR_ORG, {
      complete: true, businessName: 'Dana Electric LLC', licenseNumber: 'C-10 #987654',
    })

    const row = store.rows.get(CONTRACTOR_ORG)
    const identity = normalizeOrganizationIdentity(row)
    expect(row.name).toBe('Dana Electric LLC')
    expect(identity.companyName).toBe('Dana Electric LLC')
    expect(identity.licenseNumber).toBe('C-10 #987654')
    expect(JSON.stringify(row)).not.toContain('Power On Solutions')
  })
})

describe('COMM-PROD-1.1 — Customer Zero is unaffected', () => {
  it('treats an organization with configured identity as already onboarded', async () => {
    const state = await loadOrganizationOnboardingState(CUSTOMER_ZERO_ORG)

    expect(state!.identityConfigured).toBe(true)
    expect(state!.identity.companyName).toBe('Power On Solutions, LLC')
    // The AppShell gate opens only when neither flag is set.
    expect(state!.onboarding.complete || state!.identityConfigured).toBe(true)
  })

  it('preserves existing settings.identity when onboarding state is written', () => {
    const current = store.rows.get(CUSTOMER_ZERO_ORG)
    const patch = buildOrganizationOnboardingPatch(current, { complete: true })

    expect((patch.settings.identity as any).supportEmail).toBe('owner@poweronsolutionsllc.com')
    expect((patch.settings.identity as any).licenseNumber).toBe('C-10 #1151468')
    expect((patch.settings.onboarding as any).complete).toBe(true)
    // No businessName in the patch → the organization name is left alone.
    expect(patch.name).toBeUndefined()
  })

  it('does not treat the signup-trigger placeholder name as a configured identity', () => {
    const identity = normalizeOrganizationIdentity(store.rows.get(CONTRACTOR_ORG))
    expect(identity.companyName).toBe("Dana's Organization")
    expect(hasConfiguredOrganizationIdentity(identity)).toBe(false)
  })

  it('normalizes a missing onboarding block to an incomplete, empty state', () => {
    expect(normalizeOrganizationOnboarding(null)).toMatchObject({ complete: false, businessName: '' })
    expect(normalizeOrganizationOnboarding({ settings: { onboarding: 'nope' } as any })).toMatchObject({ complete: false })
  })
})

describe('COMM-PROD-1.1 — source boundaries', () => {
  const root = process.cwd()
  const read = (p: string) => readFileSync(join(root, p), 'utf8')
  const appShellSrc = read('src/components/layout/AppShell.tsx')
  const betaOnboardingSrc = read('src/components/onboarding/BetaOnboarding.tsx')

  it('AppShell no longer addresses the nonexistent orgs table', () => {
    expect(appShellSrc).not.toContain("from('orgs'")
    expect(appShellSrc).not.toContain("select('onboarding_complete')")
    expect(appShellSrc).toContain('loadOrganizationOnboardingState')
    expect(appShellSrc).toContain('loadOrganizationOnboardingState(profile.org_id)')
  })

  it('AppShell only opens onboarding for an org with no identity yet', () => {
    expect(appShellSrc).toContain('if (state.onboarding.complete || state.identityConfigured) return')
    expect(appShellSrc).toContain('if (workspaceCompany) return')
    expect(appShellSrc).toContain('setShowBetaOnboarding(true)')
  })

  it('BetaOnboarding persists through the organizations authority', () => {
    expect(betaOnboardingSrc).not.toContain("from('orgs'")
    expect(betaOnboardingSrc).not.toContain('onboarding_complete: true')
    expect(betaOnboardingSrc).toContain('saveOrganizationOnboarding(orgId, {')
    expect(betaOnboardingSrc).toContain('complete: true')
  })

  it('BetaOnboarding still collects every original field and keeps the 6-step flow', () => {
    for (const field of ['industry', 'businessName', 'ownerName', 'licenseNumber', 'cityState', 'aiName', 'nexusVoiceId']) {
      expect(betaOnboardingSrc).toContain(`${field}:`)
    }
    expect(betaOnboardingSrc).toContain('const TOTAL_STEPS')
  })
})
