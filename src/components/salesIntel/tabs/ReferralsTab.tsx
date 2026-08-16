import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Link2,
  Plus,
  Search,
  UserCheck,
  UserMinus,
  Users,
  X,
} from 'lucide-react'
import {
  confirmReferralClaimUnlinked,
  createReferrerProfileForClaim,
  findReferralCandidates,
  fetchPendingReferralClaims,
  fetchReferralProfilesWithHistory,
  fetchResolvedReferralClaims,
  linkReferralClaimToSearchCandidate,
  markReferralClaimAmbiguous,
  normalizeReferralName,
  ownerSearchSourceLabel,
  OwnerSearchCandidate,
  previewDuplicateReferralProfiles,
  ReferralCandidate,
  ReferralClaimWithPortalInfo,
  ReferralProfile,
  ReferralProfileWithHistory,
  REFERRAL_PROFILE_DISPLAY_NAME_MAX,
  resolveReferralClaim,
  searchOwnerCandidates,
  unresolveReferralClaim,
  updateReferralProfile,
} from '@/services/referral/referralService'
import { createReferralRefreshSequencer } from './referralTabRefresh'

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day:   'numeric',
      year:  'numeric',
    })
  } catch {
    return iso
  }
}

function sourceBadgeClass(source: OwnerSearchCandidate['source']): string {
  switch (source) {
    case 'referral_profile': return 'text-teal-400'
    case 'client':           return 'text-blue-400'
    case 'service_customer': return 'text-amber-400'
    case 'hunter_lead':      return 'text-purple-400'
  }
}

// ── CreateReferrerProfilePanel ────────────────────────────────────────────────

interface CreateReferrerProfilePanelProps {
  claimId: string
  rawReferralText: string
  onClose: () => void
  onCreated: () => void | Promise<void>
}

const CreateReferrerProfilePanel: React.FC<CreateReferrerProfilePanelProps> = ({
  claimId,
  rawReferralText,
  onClose,
  onCreated,
}) => {
  const [displayName, setDisplayName] = useState(rawReferralText)
  const [duplicates, setDuplicates] = useState<ReferralProfile[]>([])
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshDuplicates = async (name: string) => {
    setChecking(true)
    setError(null)
    try {
      const found = await previewDuplicateReferralProfiles(claimId, name)
      setDuplicates(found)
    } catch {
      setDuplicates([])
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    void refreshDuplicates(displayName)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimId])

  const handleCreate = async (opts?: { forceSeparate?: boolean; useExistingProfileId?: string }) => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await createReferrerProfileForClaim(claimId, displayName, opts)
      await onCreated()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create profile'
      if (msg.includes('DUPLICATE_REFERRAL_PROFILES')) {
        await refreshDuplicates(displayName)
        setError('Matching referrer profile(s) already exist. Use an existing profile or create a separate one.')
      } else {
        setError(msg)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-3 bg-slate-900 border border-white/10 rounded-lg p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">
            Create Referrer Profile
          </div>
          <div className="text-xs text-gray-500">
            Customer wrote: &ldquo;{rawReferralText}&rdquo;
          </div>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 ml-4 flex-shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>

      <label className="block text-xs text-gray-400 mb-1">Display name</label>
      <input
        type="text"
        value={displayName}
        onChange={e => setDisplayName(e.target.value)}
        onBlur={() => void refreshDuplicates(displayName)}
        className="w-full px-3 py-2 text-xs bg-slate-800 border border-white/10 rounded text-gray-200 focus:outline-none focus:border-teal-500/50 mb-3"
      />

      {checking && <div className="text-xs text-gray-500 mb-2">Checking existing profiles…</div>}

      {duplicates.length > 0 && (
        <div className="mb-3 space-y-2">
          <div className="text-xs text-amber-300">
            Existing profile{duplicates.length === 1 ? '' : 's'} with this name:
          </div>
          {duplicates.map(p => (
            <div key={p.id} className="flex items-center justify-between bg-slate-800 rounded px-3 py-2">
              <div className="text-sm text-white">{p.display_name}</div>
              <button
                onClick={() => void handleCreate({ useExistingProfileId: p.id })}
                disabled={saving}
                className="ml-3 px-3 py-1 text-xs font-medium rounded bg-teal-700 hover:bg-teal-600 disabled:opacity-50 text-white"
              >
                Use Existing Profile
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <div className="text-xs text-red-400 mb-2">{error}</div>}

      <div className="flex flex-wrap gap-2">
        {duplicates.length === 0 ? (
          <button
            onClick={() => void handleCreate()}
            disabled={saving || !displayName.trim()}
            className="px-3 py-1.5 text-xs font-medium rounded bg-teal-700 hover:bg-teal-600 disabled:opacity-50 text-white"
          >
            {saving ? 'Creating…' : 'Create Referrer Profile'}
          </button>
        ) : (
          <button
            onClick={() => void handleCreate({ forceSeparate: true })}
            disabled={saving || !displayName.trim()}
            className="px-3 py-1.5 text-xs font-medium rounded border border-teal-500/50 text-teal-300 hover:bg-teal-500/10 disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create Separate Profile'}
          </button>
        )}
      </div>
      <p className="text-xs text-gray-500 mt-2">
        Creates a private referrer profile only — no Client or Hunter Lead is created.
      </p>
    </div>
  )
}

// ── LinkPersonPanel ───────────────────────────────────────────────────────────

interface LinkPersonPanelProps {
  claimId: string
  rawReferralText: string
  onClose: () => void
  onLinked: () => void | Promise<void>
}

const LinkPersonPanel: React.FC<LinkPersonPanelProps> = ({
  claimId,
  rawReferralText,
  onClose,
  onLinked,
}) => {
  const [query, setQuery]         = useState('')
  const [results, setResults]     = useState<OwnerSearchCandidate[]>([])
  const [searching, setSearching] = useState(false)
  const [linking, setLinking]     = useState<string | null>(null)
  const debounceRef               = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleQueryChange = (value: string) => {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!value.trim()) { setResults([]); return }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const found = await searchOwnerCandidates(value)
        setResults(found)
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
  }

  const handleLink = async (candidate: OwnerSearchCandidate) => {
    if (linking) return
    setLinking(candidate.id)
    try {
      await linkReferralClaimToSearchCandidate(claimId, candidate)
      await onLinked()
    } finally {
      setLinking(null)
    }
  }

  return (
    <div className="mt-3 bg-slate-900 border border-white/10 rounded-lg p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Link Person</div>
          <div className="text-sm text-white font-medium">&ldquo;{rawReferralText}&rdquo;</div>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 ml-4 flex-shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
        <input
          type="text"
          placeholder="Search profiles, customers, service customers, hunter leads…"
          value={query}
          onChange={e => handleQueryChange(e.target.value)}
          className="w-full pl-9 pr-3 py-2 text-xs bg-slate-800 border border-white/10 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500/50"
        />
      </div>

      {searching && (
        <div className="text-xs text-gray-400 flex items-center gap-2 mb-2">
          <Search className="w-3 h-3 animate-pulse" /> Searching…
        </div>
      )}

      {!searching && query.trim() && results.length === 0 && (
        <div className="text-xs text-gray-500 mb-2">No matches found.</div>
      )}

      {results.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {results.map(r => (
            <div
              key={`${r.source}-${r.id}`}
              className="flex items-center justify-between bg-slate-800 rounded px-3 py-2"
            >
              <div>
                <div className="text-sm text-white">{r.display_name}</div>
                <div className="text-xs text-gray-400">
                  <span className={sourceBadgeClass(r.source)}>
                    {ownerSearchSourceLabel(r.source)}
                  </span>
                  {r.email && <span className="ml-2">{r.email}</span>}
                </div>
              </div>
              <button
                onClick={() => void handleLink(r)}
                disabled={!!linking}
                className="ml-4 px-3 py-1 text-xs font-medium rounded bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white flex-shrink-0"
              >
                {linking === r.id ? 'Linking…' : 'Link'}
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-500">
        Search is private. Selecting a result creates or reuses a referrer profile — no automatic match.
      </p>
    </div>
  )
}

// ── ReviewPanel ───────────────────────────────────────────────────────────────

interface ReviewPanelProps {
  claim: ReferralClaimWithPortalInfo
  onClose: () => void
  onResolved: () => void | Promise<void>
}

const ReviewPanel: React.FC<ReviewPanelProps> = ({ claim, onClose, onResolved }) => {
  const [candidates, setCandidates]   = useState<ReferralCandidate[]>([])
  const [searching, setSearching]     = useState(false)
  const [confirming, setConfirming]   = useState<string | null>(null)
  const [confirmedUnlinked, setConfirmedUnlinked] = useState(false)

  useEffect(() => {
    setSearching(true)
    findReferralCandidates(claim.raw_referral_text)
      .then(r => setCandidates(r.candidates))
      .catch(() => setCandidates([]))
      .finally(() => setSearching(false))
  }, [claim.raw_referral_text])

  const handleConfirm = async (candidate: ReferralCandidate) => {
    if (confirming) return
    setConfirming(candidate.id)
    try {
      if (candidate.type === 'profile') {
        await resolveReferralClaim(claim.id, { profile_id: candidate.id })
      } else if (candidate.type === 'client') {
        await resolveReferralClaim(claim.id, { client_id: candidate.id })
      } else {
        await resolveReferralClaim(claim.id, { lead_id: candidate.id })
      }
      await onResolved()
    } finally {
      setConfirming(null)
    }
  }

  const handleMarkAmbiguous = async () => {
    if (confirming || confirmedUnlinked) return
    setConfirming('ambiguous')
    try {
      await markReferralClaimAmbiguous(claim.id)
      await onResolved()
    } finally {
      setConfirming(null)
    }
  }

  const handleConfirmUnlinked = async () => {
    if (confirmedUnlinked || confirming) return
    setConfirmedUnlinked(true)
    try {
      await confirmReferralClaimUnlinked(claim.id)
      await onResolved()
    } finally {
      setConfirmedUnlinked(false)
    }
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
        <div>
          <div className="text-xs text-gray-400 mb-3">No matching profile, customer, or lead found.</div>
          <button
            onClick={() => void handleConfirmUnlinked()}
            disabled={confirmedUnlinked}
            className="px-3 py-1.5 text-xs font-medium rounded bg-teal-700 hover:bg-teal-600 disabled:opacity-50 text-white"
          >
            {confirmedUnlinked ? 'Confirming…' : 'Confirm as Referrer'}
          </button>
          <div className="text-xs text-gray-500 mt-1">
            Confirm as a valid referral without assigning a referrer profile yet.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-xs text-gray-400 mb-2">
            {candidates.length === 1 ? '1 candidate' : `${candidates.length} candidates`} — confirm the correct match:
          </div>
          {candidates.map(c => (
            <div key={`${c.type}-${c.id}`} className="flex items-center justify-between bg-slate-800 rounded px-3 py-2">
              <div>
                <div className="text-sm text-white">{c.display_name}</div>
                <div className="text-xs text-gray-400">
                  {c.type === 'profile' ? 'Referrer Profile' : c.type === 'client' ? 'Customer' : 'Hunter Lead'}
                  {' · matched by '}{c.match_reason}
                  {c.email ? ` · ${c.email}` : ''}
                </div>
              </div>
              <button
                onClick={() => void handleConfirm(c)}
                disabled={!!confirming}
                className="ml-4 px-3 py-1 text-xs font-medium rounded bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white"
              >
                {confirming === c.id ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          ))}
          <div className="pt-2 border-t border-white/10 mt-2">
            <button
              onClick={() => void handleConfirmUnlinked()}
              disabled={confirmedUnlinked}
              className="text-xs text-teal-400 hover:text-teal-300 disabled:opacity-50 text-left"
            >
              {confirmedUnlinked ? 'Confirming…' : 'Confirm as Referrer (without linking)'}
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-white/10">
        <button
          onClick={() => void handleMarkAmbiguous()}
          disabled={!!confirming || confirmedUnlinked}
          className="text-xs text-amber-400 hover:text-amber-300 disabled:opacity-50"
        >
          {confirming === 'ambiguous' ? 'Saving…' : 'Mark as ambiguous'}
        </button>
      </div>
    </div>
  )
}

// ── ReferralsTab ──────────────────────────────────────────────────────────────

export const ReferralsTab: React.FC = () => {
  const [pendingClaims, setPendingClaims]   = useState<ReferralClaimWithPortalInfo[]>([])
  const [profiles, setProfiles]             = useState<ReferralProfileWithHistory[]>([])
  const [unlinkedConfirmed, setUnlinkedConfirmed] = useState<ReferralClaimWithPortalInfo[]>([])
  const [loading, setLoading]               = useState(true)
  const [refreshing, setRefreshing]         = useState(false)
  const [loadError, setLoadError]           = useState<string | null>(null)
  const [reviewingId, setReviewingId]       = useState<string | null>(null)
  const [expandedId, setExpandedId]         = useState<string | null>(null)
  const [unlinkingId, setUnlinkingId]       = useState<string | null>(null)
  const [linkingClaimId, setLinkingClaimId] = useState<string | null>(null)
  const [creatingClaimId, setCreatingClaimId] = useState<string | null>(null)
  const [renamingProfileId, setRenamingProfileId] = useState<string | null>(null)
  const [renameValue, setRenameValue]       = useState('')
  const [renameError, setRenameError]       = useState<string | null>(null)
  const [renameSaving, setRenameSaving]     = useState(false)
  const [renameDupes, setRenameDupes]       = useState<ReferralProfile[]>([])
  /** Stable sequencer: only older-than-applied responses are discarded. */
  const refreshSequencerRef = useRef(createReferralRefreshSequencer())

  /**
   * Central tab refresh. Soft refresh (default after mutations) keeps the tab
   * mounted. A completed mutation refresh can always commit even if a newer
   * request has started but not yet applied. Initial load shows spinner.
   * Does not use a full page reload or route remount.
   */
  const refreshReferralData = useCallback(async (opts?: { initial?: boolean }) => {
    const sequencer = refreshSequencerRef.current
    const requestId = sequencer.begin()
    const initial = opts?.initial === true
    try {
      if (initial) setLoading(true)
      else setRefreshing(true)
      setLoadError(null)
      const [pending, resolved, profileRows] = await Promise.all([
        fetchPendingReferralClaims(),
        fetchResolvedReferralClaims(),
        fetchReferralProfilesWithHistory(),
      ])
      // Discard only if a newer response was already applied to the UI.
      // Do NOT discard merely because a newer request has started.
      if (!sequencer.canApply(requestId)) return
      sequencer.markApplied(requestId)
      setPendingClaims(pending)
      setProfiles(profileRows)
      setUnlinkedConfirmed(resolved.filter(c => c.resolution_status === 'confirmed_unlinked'))
    } catch (err) {
      if (!sequencer.isLatestStarted(requestId)) return
      setLoadError(err instanceof Error ? err.message : 'Failed to load referrals')
    } finally {
      if (sequencer.isLatestStarted(requestId)) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => { void refreshReferralData({ initial: true }) }, [refreshReferralData])

  const afterMutation = useCallback(async () => {
    setReviewingId(null)
    setLinkingClaimId(null)
    setCreatingClaimId(null)
    setRenamingProfileId(null)
    setRenameError(null)
    setRenameDupes([])
    await refreshReferralData()
  }, [refreshReferralData])

  const handleUnlink = async (claimId: string) => {
    if (unlinkingId) return
    setUnlinkingId(claimId)
    try {
      await unresolveReferralClaim(claimId)
      await afterMutation()
    } finally {
      setUnlinkingId(null)
    }
  }

  const handleRename = async (profileId: string) => {
    if (renameSaving) return
    const next = renameValue.trim()
    if (!next) {
      setRenameError('Display name is required.')
      return
    }
    if (next.length > REFERRAL_PROFILE_DISPLAY_NAME_MAX) {
      setRenameError(`Display name must be ${REFERRAL_PROFILE_DISPLAY_NAME_MAX} characters or fewer.`)
      return
    }
    setRenameSaving(true)
    setRenameError(null)
    try {
      const others = profiles.filter(
        p => p.id !== profileId && p.normalized_name === normalizeReferralName(next)
      )
      setRenameDupes(others)
      await updateReferralProfile(profileId, { displayName: next })
      setRenamingProfileId(null)
      setRenameDupes([])
      await refreshReferralData()
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : 'Failed to save profile name')
    } finally {
      setRenameSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
        Loading referrals…
      </div>
    )
  }

  if (loadError && pendingClaims.length === 0 && profiles.length === 0 && unlinkedConfirmed.length === 0) {
    return (
      <div className="p-4 flex items-center gap-3 text-red-400 text-sm">
        <AlertCircle className="w-4 h-4 flex-shrink-0" />
        {loadError}
      </div>
    )
  }

  const totalConfirmed = profiles.length + unlinkedConfirmed.length

  return (
    <div className="p-2 space-y-8" data-referral-refreshing={refreshing ? 'true' : 'false'}>
      {loadError && (
        <div className="px-2 text-xs text-red-400">{loadError}</div>
      )}
      {refreshing && (
        <div className="px-2 text-xs text-gray-500">Updating…</div>
      )}

      {/* ── A. NEEDS REVIEW ─────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <AlertCircle className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Needs Review</h3>
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
                      <span className={claim.resolution_status === 'ambiguous' ? 'text-amber-400' : 'text-gray-500'}>
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
                  <ReviewPanel claim={claim} onClose={() => setReviewingId(null)} onResolved={afterMutation} />
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── B. CONFIRMED REFERRERS (profiles + unlinked) ─────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <UserCheck className="w-4 h-4 text-green-400" />
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Confirmed Referrers</h3>
          {totalConfirmed > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 font-medium">
              {totalConfirmed}
            </span>
          )}
        </div>

        {totalConfirmed === 0 ? (
          <p className="text-sm text-gray-500">No confirmed referrers yet.</p>
        ) : (
          <div className="space-y-2">
            {/* B1. Referral profiles */}
            {profiles.map(profile => {
              const isExpanded = expandedId === profile.id
              return (
                <div key={profile.id} className="bg-slate-800/60 border border-white/10 rounded-lg">
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : profile.id)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Users className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm text-white font-medium truncate">{profile.display_name}</div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {profile.linked_label ? (
                            <span className="text-blue-400">{profile.linked_label}</span>
                          ) : (
                            <span className="text-teal-400">Referrer Profile</span>
                          )}
                          {profile.most_recent_at && (
                            <span className="ml-2">· last {formatDate(profile.most_recent_at)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 font-medium">
                        {profile.claim_count}{' '}
                        {profile.claim_count === 1 ? 'referral' : 'referrals'}
                      </span>
                      {isExpanded
                        ? <ChevronDown className="w-4 h-4 text-gray-400" />
                        : <ChevronRight className="w-4 h-4 text-gray-400" />}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-white/10 px-4 py-3 space-y-3">
                      <div className="flex flex-wrap gap-3">
                        <button
                          onClick={() => {
                            setRenamingProfileId(profile.id)
                            setRenameValue(profile.display_name)
                            setRenameError(null)
                            setRenameDupes([])
                          }}
                          className="text-xs text-teal-400 hover:text-teal-300"
                        >
                          Edit Profile
                        </button>
                      </div>

                      {renamingProfileId === profile.id && (
                        <div className="space-y-2 bg-slate-900 border border-white/10 rounded p-3">
                          <div className="text-xs text-gray-400 uppercase tracking-wide">Edit Profile Name</div>
                          <input
                            value={renameValue}
                            maxLength={REFERRAL_PROFILE_DISPLAY_NAME_MAX}
                            onChange={e => {
                              const v = e.target.value
                              setRenameValue(v)
                              setRenameError(null)
                              const n = normalizeReferralName(v)
                              setRenameDupes(
                                n
                                  ? profiles.filter(p => p.id !== profile.id && p.normalized_name === n)
                                  : []
                              )
                            }}
                            className="w-full px-2 py-1.5 text-xs bg-slate-800 border border-white/10 rounded text-gray-200"
                          />
                          {renameDupes.length > 0 && (
                            <div className="text-xs text-amber-300">
                              Another profile already uses this name. Saving keeps both separate — no merge.
                            </div>
                          )}
                          {renameError && <div className="text-xs text-red-400">{renameError}</div>}
                          <div className="flex gap-2 items-center">
                            <button
                              onClick={() => void handleRename(profile.id)}
                              disabled={renameSaving || !renameValue.trim()}
                              className="px-2 py-1 text-xs rounded bg-teal-700 text-white disabled:opacity-50"
                            >
                              {renameSaving ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              onClick={() => {
                                setRenamingProfileId(null)
                                setRenameError(null)
                                setRenameDupes([])
                              }}
                              disabled={renameSaving}
                              className="text-xs text-gray-500"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="divide-y divide-white/5">
                        {profile.claims.map(claim => (
                          <div key={claim.id} className="py-3">
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
                                onClick={() => void handleUnlink(claim.id)}
                                disabled={unlinkingId === claim.id}
                                className="text-xs text-gray-500 hover:text-gray-300 disabled:opacity-40 flex-shrink-0"
                              >
                                {unlinkingId === claim.id ? 'Unlinking…' : 'Unlink / Reset'}
                              </button>
                            </div>
                          </div>
                        ))}
                        {profile.claims.length === 0 && (
                          <div className="text-xs text-gray-500 py-2">No linked claims yet.</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {/* B2. Confirmed but unlinked (no profile yet) */}
            {unlinkedConfirmed.map(claim => {
              const rowKey = `unlinked-${claim.id}`
              const isExpanded = expandedId === rowKey
              const isLinking = linkingClaimId === claim.id
              const isCreating = creatingClaimId === claim.id
              return (
                <div key={rowKey} className="bg-slate-800/60 border border-white/10 rounded-lg">
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : rowKey)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <UserMinus className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm text-white font-medium truncate">
                          &ldquo;{claim.raw_referral_text}&rdquo;
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-900/50 text-orange-300 uppercase tracking-wide">
                            Unlinked Referrer
                          </span>
                          <span>{formatDate(claim.created_at)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300 font-medium">
                        1 referral
                      </span>
                      {isExpanded
                        ? <ChevronDown className="w-4 h-4 text-gray-400" />
                        : <ChevronRight className="w-4 h-4 text-gray-400" />}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-white/10 px-4 py-3">
                      <div className="text-xs text-gray-400 space-x-3 mb-3">
                        {claim.portal_requests?.name && (
                          <span>Referred: <span className="text-gray-300">{claim.portal_requests.name}</span></span>
                        )}
                        <span className="text-orange-400">confirmed · unlinked</span>
                      </div>

                      {!isLinking && !isCreating ? (
                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            onClick={() => setLinkingClaimId(claim.id)}
                            className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded border border-blue-500/50 text-blue-400 hover:bg-blue-500/10"
                          >
                            <Link2 className="w-3 h-3" />
                            Link Person
                          </button>
                          <button
                            onClick={() => setCreatingClaimId(claim.id)}
                            className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded border border-teal-500/50 text-teal-400 hover:bg-teal-500/10"
                          >
                            <Plus className="w-3 h-3" />
                            Create Referrer Profile
                          </button>
                          <button
                            onClick={() => void handleUnlink(claim.id)}
                            disabled={unlinkingId === claim.id}
                            className="text-xs text-gray-500 hover:text-gray-300 disabled:opacity-40"
                          >
                            {unlinkingId === claim.id ? 'Resetting…' : 'Unlink / Reset'}
                          </button>
                        </div>
                      ) : isCreating ? (
                        <CreateReferrerProfilePanel
                          claimId={claim.id}
                          rawReferralText={claim.raw_referral_text}
                          onClose={() => setCreatingClaimId(null)}
                          onCreated={afterMutation}
                        />
                      ) : (
                        <LinkPersonPanel
                          claimId={claim.id}
                          rawReferralText={claim.raw_referral_text}
                          onClose={() => setLinkingClaimId(null)}
                          onLinked={afterMutation}
                        />
                      )}
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
