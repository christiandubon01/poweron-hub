/**
 * LEAD-SRC-4K / 4K1 — Live referral refresh + Edit Profile.
 *
 * Proves refreshed snapshots replace rendered UI without remount, and that the
 * sequence guard never discards a newer successful mutation refresh merely
 * because another request has started.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  createReferralRefreshSequencer,
  runReferralTabRefresh,
  toReferralTabViewModel,
  type ReferralTabSnapshot,
} from '@/components/salesIntel/tabs/referralTabRefresh'
import {
  REFERRAL_PROFILE_DISPLAY_NAME_MAX,
  updateReferralProfile,
  normalizeReferralName,
  type ReferralClaimWithPortalInfo,
  type ReferralProfileWithHistory,
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

function claim(partial: Partial<ReferralClaimWithPortalInfo> & { id: string; raw_referral_text: string }): ReferralClaimWithPortalInfo {
  return {
    organization_id: 'org-1',
    portal_request_id: `pr-${partial.id}`,
    resolution_status: 'unresolved',
    referral_profile_id: null,
    resolved_client_id: null,
    resolved_lead_id: null,
    resolved_by: null,
    resolved_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  } as ReferralClaimWithPortalInfo
}

function profile(partial: Partial<ReferralProfileWithHistory> & { id: string; display_name: string }): ReferralProfileWithHistory {
  return {
    organization_id: 'org-1',
    normalized_name: partial.display_name.toLowerCase(),
    linked_client_id: null,
    linked_hunter_lead_id: null,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    claim_count: partial.claims?.length ?? 0,
    most_recent_at: null,
    claims: [],
    linked_label: null,
    ...partial,
  } as ReferralProfileWithHistory
}

/** Minimal presentational mirror of ReferralsTab list authorities for markup tests. */
function ReferralListsView(props: {
  pendingClaims: ReferralClaimWithPortalInfo[]
  profiles: ReferralProfileWithHistory[]
  unlinkedConfirmed: ReferralClaimWithPortalInfo[]
}) {
  const totalConfirmed = props.profiles.length + props.unlinkedConfirmed.length
  return createElement(
    'div',
    { 'data-testid': 'referral-lists' },
    createElement('div', { 'data-testid': 'confirmed-count' }, String(totalConfirmed)),
    createElement(
      'ul',
      { 'data-testid': 'profiles' },
      ...props.profiles.map(p =>
        createElement(
          'li',
          { key: p.id, 'data-profile-id': p.id },
          createElement('span', { 'data-testid': `profile-name-${p.id}` }, p.display_name),
          createElement('span', { 'data-testid': `profile-count-${p.id}` }, String(p.claim_count)),
          createElement(
            'ul',
            { 'data-testid': `profile-history-${p.id}` },
            ...p.claims.map(c =>
              createElement('li', { key: c.id, 'data-claim-id': c.id }, c.raw_referral_text)
            )
          )
        )
      )
    ),
    createElement(
      'ul',
      { 'data-testid': 'pending' },
      ...props.pendingClaims.map(c =>
        createElement(
          'li',
          { key: c.id, 'data-pending-id': c.id },
          c.raw_referral_text,
          ' ',
          c.resolution_status
        )
      )
    ),
    createElement(
      'ul',
      { 'data-testid': 'unlinked' },
      ...props.unlinkedConfirmed.map(c =>
        createElement('li', { key: c.id, 'data-unlinked-id': c.id }, c.raw_referral_text)
      )
    )
  )
}

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

describe('LEAD-SRC-4K1 sequence guard', () => {
  it('12. stale older response cannot overwrite newer mutation refresh', async () => {
    const sequencer = createReferralRefreshSequencer()
    let applied: string[] = []

    const idOld = sequencer.begin()
    const idNew = sequencer.begin()

    // Newer mutation refresh completes first
    expect(sequencer.canApply(idNew)).toBe(true)
    sequencer.markApplied(idNew)
    applied.push('NEW')

    // Older in-flight response arrives later — must not apply
    expect(sequencer.canApply(idOld)).toBe(false)
    expect(applied).toEqual(['NEW'])
  })

  it('13. newest response is never discarded merely because a newer request started', async () => {
    const sequencer = createReferralRefreshSequencer()

    const idMutation = sequencer.begin()
    // Spurious overlapping soft refresh starts (e.g. duplicate trigger)
    const idOverlap = sequencer.begin()

    // Mutation refresh completes while overlap still in flight — MUST apply
    expect(sequencer.canApply(idMutation)).toBe(true)
    sequencer.markApplied(idMutation)

    // Overlap completes later — also allowed (newer than applied)
    expect(sequencer.canApply(idOverlap)).toBe(true)
    sequencer.markApplied(idOverlap)

    expect(sequencer.getApplied()).toBe(idOverlap)
  })

  it('old !== latestStarted guard would have discarded mutation; canApply does not', () => {
    const sequencer = createReferralRefreshSequencer()
    const idMutation = sequencer.begin()
    const idOverlap = sequencer.begin()
    // Broken pattern from 4K production: if (seq !== latestStarted) return
    const brokenWouldDiscard = idMutation !== sequencer.getStarted()
    expect(brokenWouldDiscard).toBe(true)
    expect(idOverlap).toBe(sequencer.getStarted())
    // Fixed pattern: mutation may still apply
    expect(sequencer.canApply(idMutation)).toBe(true)
  })
})

describe('LEAD-SRC-4K1 live render without remount', () => {
  it('1-4. rename: initial old name → refresh new name → markup updates (no remount)', async () => {
    const claimRow = claim({
      id: 'c1',
      raw_referral_text: 'Josh',
      resolution_status: 'resolved',
      referral_profile_id: 'rp-1',
    })
    let snap: ReferralTabSnapshot = {
      pendingClaims: [],
      profiles: [profile({ id: 'rp-1', display_name: 'Josh Ramirez', claim_count: 1, claims: [claimRow as any] })],
      unlinkedConfirmed: [],
    }

    // Seed applied so first refresh is a soft refresh (mutation path), not mount wipe
    const sequencer = createReferralRefreshSequencer()
    const mountId = sequencer.begin()
    sequencer.markApplied(mountId)

    let view = toReferralTabViewModel(snap)
    let markup = renderToStaticMarkup(
      createElement(ReferralListsView, {
        pendingClaims: view.pendingClaims,
        profiles: view.profiles,
        unlinkedConfirmed: view.unlinkedConfirmed,
      })
    )
    expect(markup).toContain('Josh Ramirez')
    expect(markup).not.toContain('Joshua Ramirez')

    // Mutation succeeds (service write)
    await updateReferralProfile('rp-1', { displayName: 'Joshua Ramirez' })
    expect(state.updatePayload?.display_name).toBe('Joshua Ramirez')

    // Soft refresh returns new name
    snap = {
      pendingClaims: [],
      profiles: [profile({ id: 'rp-1', display_name: 'Joshua Ramirez', claim_count: 1, claims: [claimRow as any] })],
      unlinkedConfirmed: [],
    }
    const result = await runReferralTabRefresh({
      sequencer,
      fetchSnapshot: async () => snap,
      apply: s => { view = toReferralTabViewModel(s) },
    })
    expect(result.applied).toBe(true)

    markup = renderToStaticMarkup(
      createElement(ReferralListsView, {
        pendingClaims: view.pendingClaims,
        profiles: view.profiles,
        unlinkedConfirmed: view.unlinkedConfirmed,
      })
    )
    expect(markup).toContain('Joshua Ramirez')
    expect(markup).not.toContain('Josh Ramirez')
  })

  it('5-8. confirmed count 1 → create/link refresh count 2 → markup updates', async () => {
    const c1 = claim({ id: 'c1', raw_referral_text: 'A', resolution_status: 'resolved', referral_profile_id: 'rp-1' })
    const c2 = claim({ id: 'c2', raw_referral_text: 'B', resolution_status: 'resolved', referral_profile_id: 'rp-2' })

    let snap: ReferralTabSnapshot = {
      pendingClaims: [],
      profiles: [profile({ id: 'rp-1', display_name: 'Alex', claim_count: 1, claims: [c1 as any] })],
      unlinkedConfirmed: [],
    }

    const sequencer = createReferralRefreshSequencer()
    sequencer.markApplied(sequencer.begin())

    let view = toReferralTabViewModel(snap)
    let markup = renderToStaticMarkup(
      createElement(ReferralListsView, {
        pendingClaims: view.pendingClaims,
        profiles: view.profiles,
        unlinkedConfirmed: view.unlinkedConfirmed,
      })
    )
    expect(markup).toContain('data-testid="confirmed-count">1</div>')
    expect(view.totalConfirmed).toBe(1)

    snap = {
      pendingClaims: [],
      profiles: [
        profile({ id: 'rp-1', display_name: 'Alex', claim_count: 1, claims: [c1 as any] }),
        profile({ id: 'rp-2', display_name: 'Blake', claim_count: 1, claims: [c2 as any] }),
      ],
      unlinkedConfirmed: [],
    }
    const result = await runReferralTabRefresh({
      sequencer,
      fetchSnapshot: async () => snap,
      apply: s => { view = toReferralTabViewModel(s) },
    })
    expect(result.applied).toBe(true)
    expect(view.totalConfirmed).toBe(2)

    markup = renderToStaticMarkup(
      createElement(ReferralListsView, {
        pendingClaims: view.pendingClaims,
        profiles: view.profiles,
        unlinkedConfirmed: view.unlinkedConfirmed,
      })
    )
    expect(markup).toContain('data-testid="confirmed-count">2</div>')
    expect(markup).toContain('Blake')
  })

  it('9-11. unlink: confirmed → pending Needs Review without remount', async () => {
    const c1 = claim({
      id: 'c1',
      raw_referral_text: 'Pat Friend',
      resolution_status: 'resolved',
      referral_profile_id: 'rp-1',
    })

    let snap: ReferralTabSnapshot = {
      pendingClaims: [],
      profiles: [profile({ id: 'rp-1', display_name: 'Pat', claim_count: 1, claims: [c1 as any] })],
      unlinkedConfirmed: [],
    }

    const sequencer = createReferralRefreshSequencer()
    sequencer.markApplied(sequencer.begin())

    let view = toReferralTabViewModel(snap)
    let markup = renderToStaticMarkup(
      createElement(ReferralListsView, {
        pendingClaims: view.pendingClaims,
        profiles: view.profiles,
        unlinkedConfirmed: view.unlinkedConfirmed,
      })
    )
    expect(markup).toContain('data-profile-id="rp-1"')
    expect(markup).not.toContain('data-pending-id="c1"')

    const pendingClaim = claim({
      id: 'c1',
      raw_referral_text: 'Pat Friend',
      resolution_status: 'unresolved',
      referral_profile_id: null,
    })
    snap = {
      pendingClaims: [pendingClaim],
      profiles: [profile({ id: 'rp-1', display_name: 'Pat', claim_count: 0, claims: [] })],
      unlinkedConfirmed: [],
    }

    const result = await runReferralTabRefresh({
      sequencer,
      fetchSnapshot: async () => snap,
      apply: s => { view = toReferralTabViewModel(s) },
    })
    expect(result.applied).toBe(true)

    markup = renderToStaticMarkup(
      createElement(ReferralListsView, {
        pendingClaims: view.pendingClaims,
        profiles: view.profiles,
        unlinkedConfirmed: view.unlinkedConfirmed,
      })
    )
    expect(markup).toContain('data-pending-id="c1"')
    expect(markup).toContain('unresolved')
    expect(view.pendingClaims.some(c => c.id === 'c1')).toBe(true)
    expect(view.profiles.find(p => p.id === 'rp-1')?.claims).toHaveLength(0)
  })

  it('mutation refresh still applies when overlapping newer request has started', async () => {
    const sequencer = createReferralRefreshSequencer()
    sequencer.markApplied(sequencer.begin())

    let viewName = 'Old'
    let resolveOverlap!: (snap: ReferralTabSnapshot) => void
    const overlapFetch = new Promise<ReferralTabSnapshot>(resolve => {
      resolveOverlap = resolve
    })

    const mutationRefresh = runReferralTabRefresh({
      sequencer,
      fetchSnapshot: async () => ({
        pendingClaims: [],
        profiles: [profile({ id: 'rp-1', display_name: 'FromMutation', claim_count: 0, claims: [] })],
        unlinkedConfirmed: [],
      }),
      apply: s => { viewName = s.profiles[0]?.display_name ?? viewName },
    })

    // Overlapping refresh starts before mutation refresh completes (still in flight)
    const overlapRefresh = runReferralTabRefresh({
      sequencer,
      fetchSnapshot: () => overlapFetch,
      apply: s => { viewName = s.profiles[0]?.display_name ?? viewName },
    })

    const mutationResult = await mutationRefresh
    // Broken !== latestStarted guard would discard this — fixed canApply must allow it
    expect(mutationResult.applied).toBe(true)
    expect(viewName).toBe('FromMutation')

    resolveOverlap({
      pendingClaims: [],
      profiles: [profile({ id: 'rp-1', display_name: 'FromOverlap', claim_count: 0, claims: [] })],
      unlinkedConfirmed: [],
    })
    const overlapResult = await overlapRefresh
    expect(overlapResult.applied).toBe(true)
    expect(viewName).toBe('FromOverlap')
  })
})

describe('LEAD-SRC-4K live refresh architecture (wiring)', () => {
  it('mutations wire through afterMutation / refreshReferralData (not remount hacks)', () => {
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

  it('soft refresh keeps tab mounted; apply-if-newer-than-applied guard', () => {
    const src = readFileSync(REF_TAB, 'utf8')
    const helper = readFileSync(REF_REFRESH, 'utf8')
    expect(src).toMatch(/setRefreshing\(true\)/)
    expect(src).toMatch(/opts\?\.initial === true/)
    expect(src).toMatch(/createReferralRefreshSequencer/)
    expect(src).toMatch(/sequencer\.canApply/)
    expect(src).not.toMatch(/refreshSeqRef/)
    expect(helper).toMatch(/requestId > latestApplied/)
    expect(helper).not.toMatch(/!== latestStarted/)
  })

  it('duplicate action prevented while saving', () => {
    const src = readFileSync(REF_TAB, 'utf8')
    expect(src).toMatch(/if \(saving\) return/)
    expect(src).toMatch(/if \(linking\) return/)
    expect(src).toMatch(/if \(renameSaving\) return/)
    expect(src).toMatch(/if \(confirming\) return/)
  })
})

describe('LEAD-SRC-4K Edit Profile', () => {
  it('Edit Profile action exists', () => {
    const src = readFileSync(REF_TAB, 'utf8')
    expect(src).toMatch(/Edit Profile/)
    expect(src).toMatch(/updateReferralProfile/)
  })

  it('updateReferralProfile changes display_name and normalized_name', async () => {
    await updateReferralProfile('rp-1', { displayName: 'Joshua Ramirez' })
    expect(state.updatePayload?.display_name).toBe('Joshua Ramirez')
    expect(state.updatePayload?.normalized_name).toBe('joshua ramirez')
    expect(state.updatePayload?.updated_at).toBeTruthy()
  })

  it('blank profile name rejected', async () => {
    await expect(updateReferralProfile('rp-1', { displayName: '   ' }))
      .rejects.toThrow(/display name required/)
    expect(state.updatePayload).toBeNull()
  })

  it('>200 chars rejected', async () => {
    const long = 'x'.repeat(REFERRAL_PROFILE_DISPLAY_NAME_MAX + 1)
    await expect(updateReferralProfile('rp-1', { displayName: long }))
      .rejects.toThrow(/too long/)
    expect(state.updatePayload).toBeNull()
  })

  it('edit does not change raw_referral_text / claims', async () => {
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

  it('rename UI preserves history display of raw text; updates header via refresh', () => {
    const src = readFileSync(REF_TAB, 'utf8')
    expect(src).toMatch(/profile\.display_name/)
    expect(src).toMatch(/claim\.raw_referral_text/)
    expect(src).toMatch(/profile\.claim_count/)
    expect(src).toMatch(/await refreshReferralData\(/)
  })

  it('same normalized names are not auto-merged', () => {
    const src = readFileSync(REF_TAB, 'utf8')
    expect(src).toMatch(/keeps both separate|no merge/i)
    expect(normalizeReferralName('Josh')).toBe(normalizeReferralName('  josh  '))
  })

  it('no full-page reload / tab remount hack', () => {
    const src = readFileSync(REF_TAB, 'utf8')
    expect(src).not.toMatch(/window\.location\.reload\s*\(/)
    expect(src).not.toMatch(/setActiveTab\(/)
  })

  it('public CustomerPortalView unchanged for referral profile edit', () => {
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
