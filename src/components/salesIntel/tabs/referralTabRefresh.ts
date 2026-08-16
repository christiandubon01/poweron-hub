/**
 * LEAD-SRC-4K2 — Soft-refresh race helper for referral tab.
 *
 * Rule: an older in-flight response must not overwrite a newer APPLIED snapshot.
 * A successful current mutation refresh must be allowed to apply.
 */
export interface ReferralRefreshGate {
  /** Begin a request; returns its monotonic id. */
  begin: () => number
  /**
   * Whether this completed request may write UI state.
   * Only responses older than the latest *applied* id are rejected.
   */
  canApply: (requestId: number) => boolean
  markApplied: (requestId: number) => void
  isLatestStarted: (requestId: number) => boolean
  getStarted: () => number
  getApplied: () => number
}

export function createReferralRefreshGate(): ReferralRefreshGate {
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

/** @deprecated Use createReferralRefreshGate */
export const createReferralRefreshSequencer = createReferralRefreshGate
