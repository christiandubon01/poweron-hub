/**
 * LEAD-SRC-4K1 — Referral tab soft-refresh coordinator.
 *
 * Sequence rule: discard only responses that are older than a response already
 * applied to the UI. A completed mutation refresh must be able to commit even if
 * a newer request has started but not yet succeeded.
 */
import {
  fetchPendingReferralClaims,
  fetchReferralProfilesWithHistory,
  fetchResolvedReferralClaims,
  ReferralClaimWithPortalInfo,
  ReferralProfileWithHistory,
} from '@/services/referral/referralService'

export interface ReferralTabSnapshot {
  pendingClaims: ReferralClaimWithPortalInfo[]
  profiles: ReferralProfileWithHistory[]
  unlinkedConfirmed: ReferralClaimWithPortalInfo[]
}

export async function fetchReferralTabSnapshot(): Promise<ReferralTabSnapshot> {
  const [pending, resolved, profileRows] = await Promise.all([
    fetchPendingReferralClaims(),
    fetchResolvedReferralClaims(),
    fetchReferralProfilesWithHistory(),
  ])
  return {
    pendingClaims: pending,
    profiles: profileRows,
    unlinkedConfirmed: resolved.filter(c => c.resolution_status === 'confirmed_unlinked'),
  }
}

export interface ReferralRefreshSequencer {
  /** Start a new refresh; returns the request id. */
  begin: () => number
  /**
   * Returns true when this request may commit state.
   * Older-than-applied requests are rejected; the latest successful
   * mutation refresh is never blocked by a newer in-flight request.
   */
  canApply: (requestId: number) => boolean
  /** Record that requestId successfully replaced UI state. */
  markApplied: (requestId: number) => void
  /** True when this request is still the newest started (for loading flags). */
  isLatestStarted: (requestId: number) => boolean
  /** Test/debug accessors */
  getStarted: () => number
  getApplied: () => number
}

export function createReferralRefreshSequencer(): ReferralRefreshSequencer {
  let latestStarted = 0
  let latestApplied = 0

  return {
    begin: () => {
      latestStarted += 1
      return latestStarted
    },
    canApply: (requestId: number) => requestId > latestApplied,
    markApplied: (requestId: number) => {
      if (requestId > latestApplied) latestApplied = requestId
    },
    isLatestStarted: (requestId: number) => requestId === latestStarted,
    getStarted: () => latestStarted,
    getApplied: () => latestApplied,
  }
}

/** Pure view model used by live-render tests (and mirrors tab list authorities). */
export interface ReferralTabViewModel {
  pendingClaims: ReferralClaimWithPortalInfo[]
  profiles: ReferralProfileWithHistory[]
  unlinkedConfirmed: ReferralClaimWithPortalInfo[]
  totalConfirmed: number
}

export function toReferralTabViewModel(snap: ReferralTabSnapshot): ReferralTabViewModel {
  return {
    pendingClaims: snap.pendingClaims,
    profiles: snap.profiles,
    unlinkedConfirmed: snap.unlinkedConfirmed,
    totalConfirmed: snap.profiles.length + snap.unlinkedConfirmed.length,
  }
}

/**
 * Runs a soft refresh against a sequencer and applies the snapshot when allowed.
 * Shared by ReferralsTab and live-render tests.
 */
export async function runReferralTabRefresh(opts: {
  sequencer: ReferralRefreshSequencer
  fetchSnapshot?: () => Promise<ReferralTabSnapshot>
  apply: (snap: ReferralTabSnapshot) => void
  onStale?: (requestId: number) => void
}): Promise<{ requestId: number; applied: boolean; snapshot?: ReferralTabSnapshot }> {
  const fetchSnapshot = opts.fetchSnapshot ?? fetchReferralTabSnapshot
  const requestId = opts.sequencer.begin()
  const snapshot = await fetchSnapshot()
  if (!opts.sequencer.canApply(requestId)) {
    opts.onStale?.(requestId)
    return { requestId, applied: false, snapshot }
  }
  opts.sequencer.markApplied(requestId)
  opts.apply(snapshot)
  return { requestId, applied: true, snapshot }
}
