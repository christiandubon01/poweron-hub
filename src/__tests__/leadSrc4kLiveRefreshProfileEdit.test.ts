/**
 * LEAD-SRC-4K / 4K2 — Live referral refresh wiring + Edit Profile service tests.
 * Mounted DOM behavior lives in leadSrc4k2MountedReferralsTab.test.ts.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createReferralRefreshGate } from '@/components/salesIntel/tabs/referralTabRefresh'
import {
  REFERRAL_PROFILE_DISPLAY_NAME_MAX,
  updateReferralProfile,
  normalizeReferralName,
} from '@/services/referral/referralService'

const state = {
  updatePayload: null as Record<string, any> | null,
  updateError: null as { message: string } | null,
  profiles: [] as Record<string, any>[],
  authUser: { id: 'owner-1' } as { id: string } | null,
}

vi.mock('@/lib/supabase', () => {
  const makeQuery = (table: string) => {
    const q: any = {
      select: () => q,
      eq: () => q,
      update: (payload: any) => {
        state.updatePayload = payload
        return {
          eq: () => {
            if (state.updateError) return { error: state.updateError }
            if (table === 'referral_profiles' && state.profiles[0]) {
              Object.assign(state.profiles[0], payload)
            }
            return { error: null }
          },
        }
      },
      maybeSingle: async () => ({ data: state.profiles[0] ?? null, error: null }),
      order: () => q,
      in: async () => ({ data: [], error: null }),
      not: () => q,
      insert: () => q,
      single: async () => ({ data: null, error: null }),
      or: () => q,
      limit: async () => ({ data: [], error: null }),
      ilike: () => q,
      range: async () => ({ data: [], error: null }),
    }
    return q
  }
  return {
    supabase: {
      from: (t: string) => makeQuery(t),
      auth: { getUser: async () => ({ data: { user: state.authUser } }) },
    },
  }
})

const REF_TAB = resolve(process.cwd(), 'src/components/salesIntel/tabs/ReferralsTab.tsx')
const REF_SVC = resolve(process.cwd(), 'src/services/referral/referralService.ts')
const REF_REFRESH = resolve(process.cwd(), 'src/components/salesIntel/tabs/referralTabRefresh.ts')
const PORTAL = resolve(process.cwd(), 'src/views/CustomerPortalView.tsx')

beforeEach(() => {
  state.updatePayload = null
  state.updateError = null
  state.profiles = [{
    id: 'rp-1',
    organization_id: 'org-1',
    display_name: 'Josh Ramirez',
    normalized_name: 'josh ramirez',
    linked_client_id: null,
    linked_hunter_lead_id: null,
  }]
})

describe('LEAD-SRC-4K2 mounted apply architecture', () => {
  it('mutation soft refresh forces apply on the same state JSX reads', () => {
    const src = readFileSync(REF_TAB, 'utf8')
    expect(src).toMatch(/refreshReferralData\(\{ force: true \}\)/)
    expect(src).toMatch(/setPendingClaims\(pending\.slice\(\)\)/)
    expect(src).toMatch(/setProfiles\(/)
    expect(src).toMatch(/setUnlinkedConfirmed\(/)
    expect(src).toMatch(/if \(!force && !gate\.canApply\(requestId\)\) return/)
  })

  it('unlink optimistically patches pendingClaims + profiles before soft refresh', () => {
    const src = readFileSync(REF_TAB, 'utf8')
    expect(src).toMatch(/await unresolveReferralClaim\(claimId\)/)
    expect(src).toMatch(/setPendingClaims\(prev => \[pendingRow/)
    expect(src).toMatch(/claim_count:\s*claims\.length/)
    expect(src).toMatch(/await afterMutation\(/)
  })

  it('rename optimistically patches profiles.display_name before soft refresh', () => {
    const src = readFileSync(REF_TAB, 'utf8')
    expect(src).toMatch(/display_name: next/)
    expect(src).toMatch(/await refreshReferralData\(\{ force: true \}\)/)
  })

  it('gate rejects only older-than-applied; mutation id applyable while overlap started', () => {
    const gate = createReferralRefreshGate()
    const older = gate.begin()
    const newer = gate.begin()
    expect(gate.canApply(newer)).toBe(true)
    gate.markApplied(newer)
    expect(gate.canApply(older)).toBe(false)

    const gate2 = createReferralRefreshGate()
    gate2.markApplied(gate2.begin())
    const mutationId = gate2.begin()
    const overlapId = gate2.begin()
    expect(mutationId !== gate2.getStarted()).toBe(true)
    expect(gate2.canApply(mutationId)).toBe(true)
    void overlapId
  })

  it('mutations wire through afterMutation / refreshReferralData (not remount hacks)', () => {
    const src = readFileSync(REF_TAB, 'utf8')
    expect(src).toMatch(/await onCreated\(/)
    expect(src).toMatch(/await onLinked\(/)
    expect(src).toMatch(/await onResolved\(/)
    expect(src).not.toMatch(/window\.location\.reload\s*\(/)
    expect(src).not.toMatch(/setActiveTab\(/)
  })

  it('soft refresh keeps tab mounted; gate lives in useRef', () => {
    const src = readFileSync(REF_TAB, 'utf8')
    const helper = readFileSync(REF_REFRESH, 'utf8')
    expect(src).toMatch(/setRefreshing\(true\)/)
    expect(src).toMatch(/refreshGateRef/)
    expect(src).toMatch(/createReferralRefreshGate/)
    expect(helper).toMatch(/requestId > latestApplied/)
  })

  it('Edit Profile is behind expanded profile row (intentional)', () => {
    const src = readFileSync(REF_TAB, 'utf8')
    expect(src).toMatch(/isExpanded && \(/)
    expect(src).toMatch(/Edit Profile/)
  })
})

describe('LEAD-SRC-4K Edit Profile service', () => {
  it('updateReferralProfile changes display_name and normalized_name', async () => {
    await updateReferralProfile('rp-1', { displayName: 'Joshua Ramirez' })
    expect(state.updatePayload?.display_name).toBe('Joshua Ramirez')
    expect(state.updatePayload?.normalized_name).toBe('joshua ramirez')
  })

  it('blank / too-long names rejected', async () => {
    await expect(updateReferralProfile('rp-1', { displayName: '   ' }))
      .rejects.toThrow(/display name required/)
    await expect(
      updateReferralProfile('rp-1', { displayName: 'x'.repeat(REFERRAL_PROFILE_DISPLAY_NAME_MAX + 1) })
    ).rejects.toThrow(/too long/)
  })

  it('edit does not touch referral_claims / raw_referral_text', async () => {
    await updateReferralProfile('rp-1', { displayName: 'Joshua Ramirez' })
    expect(state.updatePayload).not.toHaveProperty('raw_referral_text')
    const src = readFileSync(REF_SVC, 'utf8')
    const start = src.indexOf('export async function updateReferralProfile')
    const end = src.indexOf('\nexport async function ', start + 1)
    const fn = src.slice(start, end > start ? end : undefined)
    expect(fn).not.toMatch(/referral_claims/)
    expect(fn).toMatch(/referral_profiles/)
  })

  it('normalize + no auto-merge copy', () => {
    const src = readFileSync(REF_TAB, 'utf8')
    expect(src).toMatch(/keeps both separate|no merge/i)
    expect(normalizeReferralName('Josh')).toBe(normalizeReferralName('  josh  '))
  })

  it('public CustomerPortalView unchanged', () => {
    const portal = readFileSync(PORTAL, 'utf8')
    expect(portal).not.toMatch(/updateReferralProfile/)
    expect(portal).not.toMatch(/Edit Profile/)
  })
})

describe('LEAD-SRC-4K no migration', () => {
  it('no migration 131 required', () => {
    const migrations = resolve(process.cwd(), 'supabase/migrations')
    const { readdirSync } = require('node:fs') as typeof import('node:fs')
    const files: string[] = readdirSync(migrations)
    expect(files.some((f: string) => /^131_/.test(f))).toBe(false)
  })
})
