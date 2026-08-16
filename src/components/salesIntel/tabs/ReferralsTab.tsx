import React, { useCallback, useEffect, useState } from 'react'
import { AlertCircle, ChevronDown, ChevronRight, Search, UserCheck, Users, X } from 'lucide-react'
import {
  findReferralCandidates,
  markReferralClaimAmbiguous,
  ReferralCandidate,
  ReferralClaimWithPortalInfo,
  ResolvedReferralClaim,
  fetchPendingReferralClaims,
  fetchResolvedReferralClaims,
  resolveReferralClaim,
  unresolveReferralClaim,
} from '@/services/referral/referralService'

// ── Confirmed referrer group ──────────────────────────────────────────────────

interface ReferrerGroup {
  referrerId: string
  referrerType: 'client' | 'lead'
  referrerName: string
  claims: ResolvedReferralClaim[]
}

function buildReferrerGroups(claims: ResolvedReferralClaim[]): ReferrerGroup[] {
  const groups: ReferrerGroup[] = []
  for (const claim of claims) {
    if (claim.resolved_client_id && claim.clients) {
      const existing = groups.find(g => g.referrerId === claim.resolved_client_id)
      if (existing) {
        existing.claims.push(claim)
      } else {
        groups.push({
          referrerId: claim.resolved_client_id,
          referrerType: 'client',
          referrerName: claim.clients.name,
          claims: [claim],
        })
      }
    } else if (claim.resolved_lead_id && claim.hunter_leads) {
      const existing = groups.find(g => g.referrerId === claim.resolved_lead_id)
      if (existing) {
        existing.claims.push(claim)
      } else {
        groups.push({
          referrerId: claim.resolved_lead_id,
          referrerType: 'lead',
          referrerName: claim.hunter_leads.contact_name,
          claims: [claim],
        })
      }
    }
  }
  // Sort by referral count descending, then by most recent
  groups.sort((a, b) => b.claims.length - a.claims.length || 0)
  return groups
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return iso
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface ReviewPanelProps {
  claim: ReferralClaimWithPortalInfo
  onClose: () => void
  onResolved: () => void
}

const ReviewPanel: React.FC<ReviewPanelProps> = ({ claim, onClose, onResolved }) => {
  const [candidates, setCandidates] = useState<ReferralCandidate[]>([])
  const [searching, setSearching] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)

  useEffect(() => {
    setSearching(true)
    findReferralCandidates(claim.raw_referral_text)
      .then(r => setCandidates(r.candidates))
      .catch(() => setCandidates([]))
      .finally(() => setSearching(false))
  }, [claim.raw_referral_text])

  const handleConfirm = async (candidate: ReferralCandidate) => {
    setConfirming(candidate.id)
    try {
      await resolveReferralClaim(claim.id, candidate.type === 'client'
        ? { client_id: candidate.id }
        : { lead_id: candidate.id }
      )
      onResolved()
    } finally {
      setConfirming(null)
    }
  }

  const handleMarkAmbiguous = async () => {
    await markReferralClaimAmbiguous(claim.id)
    onResolved()
  }

  return (
    <div className="mt-3 bg-slate-900 border border-white/10 rounded-lg p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Reviewing</div>
          <div className="text-sm text-white font-medium">&ldquo;{claim.raw_referral_text}&rdquo;</div>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 ml-4 flex-shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>

      {searching ? (
        <div className="text-xs text-gray-400 flex items-center gap-2">
          <Search className="w-3 h-3 animate-pulse" /> Searching…
        </div>
      ) : candidates.length === 0 ? (
        <div className="text-xs text-gray-400">No matching client or lead found.</div>
      ) : (
        <div className="space-y-2">
          <div className="text-xs text-gray-400 mb-2">
            {candidates.length === 1 ? '1 candidate' : `${candidates.length} candidates`} — confirm the correct match:
          </div>
          {candidates.map(c => (
            <div key={c.id} className="flex items-center justify-between bg-slate-800 rounded px-3 py-2">
              <div>
                <div className="text-sm text-white">{c.display_name}</div>
                <div className="text-xs text-gray-400">
                  {c.type === 'client' ? 'Client' : 'Hunter Lead'} · matched by {c.match_reason}
                  {c.email ? ` · ${c.email}` : ''}
                </div>
              </div>
              <button
                onClick={() => handleConfirm(c)}
                disabled={!!confirming}
                className="ml-4 px-3 py-1 text-xs font-medium rounded bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white"
              >
                {confirming === c.id ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-white/10">
        <button
          onClick={handleMarkAmbiguous}
          className="text-xs text-amber-400 hover:text-amber-300"
        >
          Mark as ambiguous
        </button>
      </div>
    </div>
  )
}

// ── ReferralsTab ──────────────────────────────────────────────────────────────

export const ReferralsTab: React.FC = () => {
  const [pendingClaims, setPendingClaims] = useState<ReferralClaimWithPortalInfo[]>([])
  const [resolvedClaims, setResolvedClaims] = useState<ResolvedReferralClaim[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [expandedReferrer, setExpandedReferrer] = useState<string | null>(null)
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setLoadError(null)
      const [pending, resolved] = await Promise.all([
        fetchPendingReferralClaims(),
        fetchResolvedReferralClaims(),
      ])
      setPendingClaims(pending)
      setResolvedClaims(resolved)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load referrals')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleResolved = useCallback(() => {
    setReviewingId(null)
    load()
  }, [load])

  const handleUnlink = async (claimId: string) => {
    setUnlinkingId(claimId)
    try {
      await unresolveReferralClaim(claimId)
      await load()
    } finally {
      setUnlinkingId(null)
    }
  }

  const referrerGroups = buildReferrerGroups(resolvedClaims)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
        Loading referrals…
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="p-4 flex items-center gap-3 text-red-400 text-sm">
        <AlertCircle className="w-4 h-4 flex-shrink-0" />
        {loadError}
      </div>
    )
  }

  return (
    <div className="p-2 space-y-8">

      {/* ── A. NEEDS REVIEW ─────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <AlertCircle className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
            Needs Review
          </h3>
          {pendingClaims.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-medium">
              {pendingClaims.length}
            </span>
          )}
        </div>

        {pendingClaims.length === 0 ? (
          <p className="text-sm text-gray-500">No pending referrals.</p>
        ) : (
          <div className="space-y-3">
            {pendingClaims.map(claim => (
              <div key={claim.id} className="bg-slate-800/60 border border-white/10 rounded-lg p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white font-medium truncate">
                      &ldquo;{claim.raw_referral_text}&rdquo;
                    </div>
                    <div className="mt-1 text-xs text-gray-400 space-x-3">
                      {claim.portal_requests?.name && (
                        <span>Referred: <span className="text-gray-300">{claim.portal_requests.name}</span></span>
                      )}
                      <span>{formatDate(claim.created_at)}</span>
                      <span className={
                        claim.resolution_status === 'ambiguous'
                          ? 'text-amber-400'
                          : 'text-gray-500'
                      }>
                        {claim.resolution_status === 'ambiguous' ? 'ambiguous' : 'unresolved'}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setReviewingId(reviewingId === claim.id ? null : claim.id)}
                    className="flex-shrink-0 px-3 py-1 text-xs font-medium rounded border border-blue-500/50 text-blue-400 hover:bg-blue-500/10"
                  >
                    {reviewingId === claim.id ? 'Close' : 'Review'}
                  </button>
                </div>

                {reviewingId === claim.id && (
                  <ReviewPanel
                    claim={claim}
                    onClose={() => setReviewingId(null)}
                    onResolved={handleResolved}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── B. CONFIRMED REFERRERS ──────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <UserCheck className="w-4 h-4 text-green-400" />
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
            Confirmed Referrers
          </h3>
          {referrerGroups.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 font-medium">
              {referrerGroups.length}
            </span>
          )}
        </div>

        {referrerGroups.length === 0 ? (
          <p className="text-sm text-gray-500">No confirmed referrers yet.</p>
        ) : (
          <div className="space-y-2">
            {referrerGroups.map(group => {
              const isExpanded = expandedReferrer === group.referrerId
              const mostRecent = group.claims[0]?.created_at
              return (
                <div key={group.referrerId} className="bg-slate-800/60 border border-white/10 rounded-lg">
                  {/* Referrer row */}
                  <button
                    onClick={() => setExpandedReferrer(isExpanded ? null : group.referrerId)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Users className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm text-white font-medium truncate">{group.referrerName}</div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          <span className={group.referrerType === 'client' ? 'text-blue-400' : 'text-purple-400'}>
                            {group.referrerType === 'client' ? 'Client' : 'Hunter Lead'}
                          </span>
                          {mostRecent && <span className="ml-2">· last {formatDate(mostRecent)}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 font-medium">
                        {group.claims.length} {group.claims.length === 1 ? 'referral' : 'referrals'}
                      </span>
                      {isExpanded
                        ? <ChevronDown className="w-4 h-4 text-gray-400" />
                        : <ChevronRight className="w-4 h-4 text-gray-400" />
                      }
                    </div>
                  </button>

                  {/* History */}
                  {isExpanded && (
                    <div className="border-t border-white/10 divide-y divide-white/5">
                      {group.claims.map(claim => (
                        <div key={claim.id} className="px-4 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-gray-200 font-medium">
                                &ldquo;{claim.raw_referral_text}&rdquo;
                              </div>
                              <div className="mt-1 text-xs text-gray-400 space-x-3">
                                {claim.portal_requests?.name && (
                                  <span>Referred: <span className="text-gray-300">{claim.portal_requests.name}</span></span>
                                )}
                                {claim.portal_requests?.status && (
                                  <span>Status: <span className="text-gray-300">{claim.portal_requests.status}</span></span>
                                )}
                                <span>{formatDate(claim.created_at)}</span>
                                <span className="text-green-400">resolved</span>
                              </div>
                            </div>
                            <button
                              onClick={() => handleUnlink(claim.id)}
                              disabled={unlinkingId === claim.id}
                              className="text-xs text-gray-500 hover:text-gray-300 disabled:opacity-40 flex-shrink-0"
                            >
                              {unlinkingId === claim.id ? 'Unlinking…' : 'Unlink'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

    </div>
  )
}
