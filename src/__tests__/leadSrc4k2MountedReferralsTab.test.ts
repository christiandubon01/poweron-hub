/**
 * @vitest-environment happy-dom
 *
 * LEAD-SRC-4K2 — Actual mounted ReferralsTab state regression tests.
 *
 * Proves Unlink / Rename update the SAME mounted instance's DOM without
 * remount, tab navigation, or static markup substitution.
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createReferralRefreshGate } from '@/components/salesIntel/tabs/referralTabRefresh'

const CLAIM_KEEP = '1996ae17-1d3d-4425-a8d9-c9dde01fb3f0'
const CLAIM_UNLINK = 'd198209b-19cf-44fe-8cc3-62c646eb4692'
const PROFILE_ID = 'dffcc26f-b738-4c47-9184-cf676c4c41ff'

type Claim = {
  id: string
  organization_id: string
  portal_request_id: string
  raw_referral_text: string
  resolution_status: string
  referral_profile_id: string | null
  resolved_client_id: null
  resolved_lead_id: null
  resolved_by: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
  portal_requests?: { id: string; name: string; status: string | null; created_at: string } | null
}

type Profile = {
  id: string
  organization_id: string
  display_name: string
  normalized_name: string
  linked_client_id: null
  linked_hunter_lead_id: null
  created_by: null
  created_at: string
  updated_at: string
  claim_count: number
  most_recent_at: string | null
  claims: Claim[]
  linked_label: string | null
}

const fetchPending = vi.fn()
const fetchResolved = vi.fn()
const fetchProfiles = vi.fn()
const unresolve = vi.fn()
const updateProfile = vi.fn()

vi.mock('@/services/referral/referralService', async () => {
  const actual = await vi.importActual<typeof import('@/services/referral/referralService')>(
    '@/services/referral/referralService'
  )
  return {
    ...actual,
    fetchPendingReferralClaims: (...args: unknown[]) => fetchPending(...args),
    fetchResolvedReferralClaims: (...args: unknown[]) => fetchResolved(...args),
    fetchReferralProfilesWithHistory: (...args: unknown[]) => fetchProfiles(...args),
    unresolveReferralClaim: (...args: unknown[]) => unresolve(...args),
    updateReferralProfile: (...args: unknown[]) => updateProfile(...args),
  }
})

import { ReferralsTab } from '@/components/salesIntel/tabs/ReferralsTab'

function claim(partial: Partial<Claim> & Pick<Claim, 'id' | 'raw_referral_text' | 'resolution_status'>): Claim {
  return {
    organization_id: 'org-1',
    portal_request_id: `pr-${partial.id}`,
    referral_profile_id: partial.resolution_status === 'resolved' ? PROFILE_ID : null,
    resolved_client_id: null,
    resolved_lead_id: null,
    resolved_by: partial.resolution_status === 'resolved' ? 'owner-1' : null,
    resolved_at: partial.resolution_status === 'resolved' ? '2026-08-01T00:00:00.000Z' : null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    portal_requests: { id: `pr-${partial.id}`, name: 'Lead', status: 'new', created_at: '2026-08-01T00:00:00.000Z' },
    ...partial,
  }
}

function profile(displayName: string, claims: Claim[]): Profile {
  return {
    id: PROFILE_ID,
    organization_id: 'org-1',
    display_name: displayName,
    normalized_name: displayName.toLowerCase(),
    linked_client_id: null,
    linked_hunter_lead_id: null,
    created_by: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    claim_count: claims.length,
    most_recent_at: claims[0]?.created_at ?? null,
    claims,
    linked_label: null,
  }
}

function initialSnapshot() {
  const keep = claim({
    id: CLAIM_KEEP,
    raw_referral_text: 'Josh',
    resolution_status: 'resolved',
    referral_profile_id: PROFILE_ID,
  })
  const unlink = claim({
    id: CLAIM_UNLINK,
    raw_referral_text: 'Joshua',
    resolution_status: 'resolved',
    referral_profile_id: PROFILE_ID,
  })
  return {
    pending: [] as Claim[],
    resolved: [keep, unlink],
    profiles: [profile('Josh Ramirez', [keep, unlink])],
  }
}

function afterUnlinkSnapshot() {
  const keep = claim({
    id: CLAIM_KEEP,
    raw_referral_text: 'Josh',
    resolution_status: 'resolved',
    referral_profile_id: PROFILE_ID,
  })
  const pendingJoshua = claim({
    id: CLAIM_UNLINK,
    raw_referral_text: 'Joshua',
    resolution_status: 'unresolved',
    referral_profile_id: null,
    resolved_by: null,
    resolved_at: null,
    updated_at: '2026-08-16T06:51:45.241+00:00',
  })
  return {
    pending: [pendingJoshua],
    resolved: [keep],
    profiles: [profile('Josh Ramirez', [keep])],
  }
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('LEAD-SRC-4K2 mounted ReferralsTab', () => {
  let container: HTMLDivElement
  let root: Root
  let mountCount = 0

  function MountProbe(props: { children: React.ReactNode }) {
    React.useEffect(() => {
      mountCount += 1
    }, [])
    return React.createElement(React.Fragment, null, props.children)
  }

  beforeEach(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    mountCount = 0
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    fetchPending.mockReset()
    fetchResolved.mockReset()
    fetchProfiles.mockReset()
    unresolve.mockReset()
    updateProfile.mockReset()
    unresolve.mockResolvedValue(undefined)
    updateProfile.mockResolvedValue(undefined)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('unlink moves claim to Needs Review on the same mounted instance', async () => {
    const initial = initialSnapshot()
    const after = afterUnlinkSnapshot()

    let refreshPhase: 'initial' | 'post' = 'initial'
    fetchPending.mockImplementation(async () =>
      refreshPhase === 'initial' ? initial.pending : after.pending
    )
    fetchResolved.mockImplementation(async () =>
      refreshPhase === 'initial' ? initial.resolved : after.resolved
    )
    fetchProfiles.mockImplementation(async () =>
      refreshPhase === 'initial' ? initial.profiles : after.profiles
    )

    await act(async () => {
      root.render(
        React.createElement(MountProbe, null, React.createElement(ReferralsTab))
      )
    })
    await flush()

    expect(container.textContent).toContain('2 referrals')
    expect(container.textContent).toContain('No pending referrals')
    expect(container.textContent).toContain('Josh Ramirez')
    expect(mountCount).toBe(1)

    // Expand profile so Unlink / Reset is available (collapsed by default).
    const profileToggle = Array.from(container.querySelectorAll('button')).find(b =>
      (b.textContent || '').includes('Josh Ramirez')
    )
    expect(profileToggle).toBeTruthy()
    await act(async () => {
      profileToggle!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()

    // Click Unlink on the Joshua claim row (not the Josh keep row).
    const unlinkBtn = Array.from(container.querySelectorAll('button'))
      .filter(b => (b.textContent || '').trim() === 'Unlink / Reset')
      .find(btn => {
        const row = btn.closest('div.py-3')
        return (row?.textContent || '').includes('Joshua')
      })
    expect(unlinkBtn).toBeTruthy()

    // Next fetches are the post-mutation authoritative snapshot.
    refreshPhase = 'post'

    await act(async () => {
      unlinkBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    await flush()
    await flush()

    expect(unresolve).toHaveBeenCalledWith(CLAIM_UNLINK)
    expect(mountCount).toBe(1)
    expect(container.textContent).toContain('1 referral')
    expect(container.textContent).not.toContain('2 referrals')
    expect(container.textContent).toContain('Joshua')
    expect(container.textContent).not.toContain('No pending referrals')
    // Still on referrals content — no coach/navigation chrome introduced.
    expect(container.textContent).toContain('Needs Review')
    expect(container.textContent).toContain('Josh Ramirez')
  })

  it('rename updates profile name on the same mounted instance', async () => {
    const initial = initialSnapshot()
    const renamedProfiles = [profile('Joshua Ramirez', initial.profiles[0].claims)]

    let refreshPhase: 'initial' | 'post' = 'initial'
    fetchPending.mockImplementation(async () => initial.pending)
    fetchResolved.mockImplementation(async () => initial.resolved)
    fetchProfiles.mockImplementation(async () =>
      refreshPhase === 'initial' ? initial.profiles : renamedProfiles
    )

    await act(async () => {
      root.render(
        React.createElement(MountProbe, null, React.createElement(ReferralsTab))
      )
    })
    await flush()
    expect(container.textContent).toContain('Josh Ramirez')
    expect(mountCount).toBe(1)

    const profileToggle = Array.from(container.querySelectorAll('button')).find(b =>
      (b.textContent || '').includes('Josh Ramirez')
    )
    await act(async () => {
      profileToggle!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()

    const editBtn = Array.from(container.querySelectorAll('button')).find(b =>
      (b.textContent || '').trim() === 'Edit Profile'
    )
    expect(editBtn).toBeTruthy()
    await act(async () => {
      editBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()

    const input = container.querySelector('input') as HTMLInputElement | null
    expect(input).toBeTruthy()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input!, 'Joshua Ramirez')
      input!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await flush()

    refreshPhase = 'post'
    const saveBtn = Array.from(container.querySelectorAll('button')).find(b =>
      (b.textContent || '').trim() === 'Save'
    )
    expect(saveBtn).toBeTruthy()
    await act(async () => {
      saveBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    await flush()
    await flush()

    expect(updateProfile).toHaveBeenCalled()
    expect(mountCount).toBe(1)
    expect(container.textContent).toContain('Joshua Ramirez')
    expect(container.textContent).not.toContain('Josh Ramirez')
  })
})

describe('LEAD-SRC-4K2 refresh gate race', () => {
  it('older in-flight response cannot overwrite newer applied mutation refresh', () => {
    const gate = createReferralRefreshGate()
    const older = gate.begin()
    const newer = gate.begin()

    expect(gate.canApply(newer)).toBe(true)
    gate.markApplied(newer)

    expect(gate.canApply(older)).toBe(false)
    expect(gate.getApplied()).toBe(newer)
  })

  it('mutation force-apply semantics: completed current id remains applyable while overlap in flight', () => {
    const gate = createReferralRefreshGate()
    gate.markApplied(gate.begin()) // mount
    const mutationId = gate.begin()
    const overlapId = gate.begin()

    // Broken "!== latestStarted" would discard mutationId here.
    expect(mutationId !== gate.getStarted()).toBe(true)
    expect(gate.canApply(mutationId)).toBe(true)
    gate.markApplied(mutationId)
    expect(gate.canApply(overlapId)).toBe(true)
  })
})
