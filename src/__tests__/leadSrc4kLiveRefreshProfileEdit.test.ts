/**
 * LEAD-SRC-4K — Live referral refresh + Edit Profile.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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

import {
  REFERRAL_PROFILE_DISPLAY_NAME_MAX,
  updateReferralProfile,
  normalizeReferralName,
} from '@/services/referral/referralService'

const REF_TAB = resolve(process.cwd(), 'src/components/salesIntel/tabs/ReferralsTab.tsx')
const REF_SVC = resolve(process.cwd(), 'src/services/referral/referralService.ts')
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

describe('LEAD-SRC-4K live refresh architecture', () => {
  it('1-6. mutations wire through afterMutation / refreshReferralData (not remount hacks)', () => {
    const src = readFileSync(REF_TAB, 'utf8')
    expect(src).toMatch(/refreshReferralData/)
    expect(src).toMatch(/afterMutation/)
    expect(src).toMatch(/await onCreated\(/)
    expect(src).toMatch(/await onLinked\(/)
    expect(src).toMatch(/await onResolved\(/)
    expect(src).toMatch(/onResolved=\{afterMutation\}/)
    expect(src).toMatch(/onCreated=\{afterMutation\}/)
    expect(src).toMatch(/onLinked=\{afterMutation\}/)
    expect(src).toMatch(/await afterMutation\(/)
    expect(src).not.toMatch(/window\.location\.reload\s*\(/)
    expect(src).not.toMatch(/navigate\(\s*['"].*referrals/)
  })

  it('7. soft refresh keeps tab mounted (no full loading wipe after first paint)', () => {
    const src = readFileSync(REF_TAB, 'utf8')
    expect(src).toMatch(/setRefreshing\(true\)/)
    expect(src).toMatch(/opts\?\.initial === true/)
    expect(src).toMatch(/refreshSeqRef/)
  })

  it('8. duplicate action prevented while saving', () => {
    const src = readFileSync(REF_TAB, 'utf8')
    expect(src).toMatch(/if \(saving\) return/)
    expect(src).toMatch(/if \(linking\) return/)
    expect(src).toMatch(/if \(renameSaving\) return/)
    expect(src).toMatch(/if \(confirming\) return/)
  })
})

describe('LEAD-SRC-4K Edit Profile', () => {
  it('9. Edit Profile action exists', () => {
    const src = readFileSync(REF_TAB, 'utf8')
    expect(src).toMatch(/Edit Profile/)
    expect(src).toMatch(/updateReferralProfile/)
  })

  it('10-11. updateReferralProfile changes display_name and normalized_name', async () => {
    await updateReferralProfile('rp-1', { displayName: 'Joshua Ramirez' })
    expect(state.updatePayload?.display_name).toBe('Joshua Ramirez')
    expect(state.updatePayload?.normalized_name).toBe('joshua ramirez')
    expect(state.updatePayload?.updated_at).toBeTruthy()
  })

  it('12. blank profile name rejected', async () => {
    await expect(updateReferralProfile('rp-1', { displayName: '   ' }))
      .rejects.toThrow(/display name required/)
    expect(state.updatePayload).toBeNull()
  })

  it('13. >200 chars rejected', async () => {
    const long = 'x'.repeat(REFERRAL_PROFILE_DISPLAY_NAME_MAX + 1)
    await expect(updateReferralProfile('rp-1', { displayName: long }))
      .rejects.toThrow(/too long/)
    expect(state.updatePayload).toBeNull()
  })

  it('14. edit does not change raw_referral_text / claims', async () => {
    await updateReferralProfile('rp-1', { displayName: 'Joshua Ramirez' })
    expect(state.updatePayload).not.toHaveProperty('raw_referral_text')
    const src = readFileSync(REF_SVC, 'utf8')
    const start = src.indexOf('export async function updateReferralProfile')
    const end = src.indexOf('\nexport async function ', start + 1)
    const fn = src.slice(start, end > start ? end : undefined)
    expect(fn).not.toMatch(/referral_claims/)
    expect(fn).not.toMatch(/raw_referral_text/)
    expect(fn).toMatch(/referral_profiles/)
  })

  it('15-17. rename UI preserves history display of raw text; updates header via refresh', () => {
    const src = readFileSync(REF_TAB, 'utf8')
    expect(src).toMatch(/profile\.display_name/)
    expect(src).toMatch(/claim\.raw_referral_text/)
    expect(src).toMatch(/profile\.claim_count/)
    expect(src).toMatch(/await refreshReferralData\(/)
  })

  it('18. same normalized names are not auto-merged', () => {
    const src = readFileSync(REF_TAB, 'utf8')
    expect(src).toMatch(/keeps both separate|no merge/i)
    expect(normalizeReferralName('Josh')).toBe(normalizeReferralName('  josh  '))
  })

  it('19. no full-page reload / tab remount hack', () => {
    const src = readFileSync(REF_TAB, 'utf8')
    expect(src).not.toMatch(/window\.location\.reload\s*\(/)
    expect(src).not.toMatch(/setActiveTab\(/)
  })

  it('20. public CustomerPortalView unchanged for referral profile edit', () => {
    const portal = readFileSync(PORTAL, 'utf8')
    expect(portal).not.toMatch(/updateReferralProfile/)
    expect(portal).not.toMatch(/Edit Profile/)
    expect(portal).not.toMatch(/refreshReferralData/)
  })
})

describe('LEAD-SRC-4K no migration', () => {
  it('no migration 131 required for profile UPDATE', () => {
    const migrations = resolve(process.cwd(), 'supabase/migrations')
    const { readdirSync } = require('node:fs') as typeof import('node:fs')
    const files: string[] = readdirSync(migrations)
    expect(files.some((f: string) => /^131_/.test(f))).toBe(false)
  })
})
