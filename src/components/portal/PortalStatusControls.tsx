// @ts-nocheck
/**
 * PortalStatusControls — Shared Customer Tracker component.
 *
 * Renders the operational portal-tracking buttons (On My Way / Arrived /
 * Work Started / Work Completed) and the post-completion review-request modal.
 *
 * Can be driven by either:
 *   - `lead`          — a HunterLead object (Pipeline card usage)
 *   - `hunterLeadId`  — a raw string id (Open Estimates usage, where the
 *                        full lead object is not available)
 *
 * One of the two props MUST be provided.
 *
 * Extracted from HunterLeadCard.tsx (Step 11B) in Step 11D so the component
 * can be shared across Pipeline and Service Log without duplicating logic.
 */

import React, { useState, useEffect } from 'react'
import { CheckCircle, Clock, ExternalLink, Loader2, Mail } from 'lucide-react'
import clsx from 'clsx'
import {
  PORTAL_LIFECYCLE_EVENT_TYPES,
  fetchPortalTrackerStateForLead,
  getPortalTimelineMeta,
  sendPortalReviewRequest,
  writePortalLifecycleEvent,
  type PortalTimelineEventType,
  type PortalTrackerState,
} from '@/services/portal/portalService'

interface PortalStatusControlsProps {
  /** Full lead object — set when rendering from the Pipeline card. */
  lead?: { id?: string; source?: string; sourceTag?: string; email?: string }
  /** Raw hunter_lead id — set when rendering from a service estimate card. */
  hunterLeadId?: string | null
}

// Maps env-var missing errors to a friendly message. Passes all other errors through
// so real Supabase/Resend errors (404, 409, delivery failures) remain visible.
function friendlyReviewError(raw: string): string {
  const lower = raw.toLowerCase()
  if (lower.includes('not configured') || lower.includes('resend_api_key')) {
    return 'Review email is not configured yet. Add the required Netlify environment variables before sending review requests.'
  }
  return raw
}

export function PortalStatusControls({ lead, hunterLeadId }: PortalStatusControlsProps) {
  const [tracker, setTracker] = useState<PortalTrackerState | null>(null)
  const [loading, setLoading] = useState(false)
  const [writing, setWriting] = useState<PortalTimelineEventType | null>(null)
  // Optimistic set — events added instantly on click, removed once server confirms.
  const [optimisticDone, setOptimisticDone] = useState<Set<PortalTimelineEventType>>(new Set())
  const [writeError, setWriteError] = useState<string | null>(null)
  const [reviewModalOpen, setReviewModalOpen] = useState(false)
  const [reviewEmail, setReviewEmail] = useState('')
  const [sendingReview, setSendingReview] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [reviewSentMessage, setReviewSentMessage] = useState<string | null>(null)

  // Resolve the lead id from whichever prop was supplied
  const resolvedLeadId: string | null | undefined =
    lead?.id ?? hunterLeadId ?? null

  // Guard: only portal leads need the tracker. When a lead object is provided
  // we can check its source; when only an id is provided we always attempt the
  // lookup (the tracker will be null if no portal_request is linked).
  const isPortalLead = !lead
    ? true // driven by hunterLeadId alone — assume it could be a portal lead
    : lead.source === 'customer_portal' || lead.sourceTag === 'customer_portal'

  useEffect(() => {
    let cancelled = false
    if (!isPortalLead || !resolvedLeadId) {
      setTracker(null)
      return
    }

    setLoading(true)
    fetchPortalTrackerStateForLead(resolvedLeadId)
      .then((state) => {
        if (cancelled) return
        setTracker(state)
        setReviewEmail(state?.request?.email ?? lead?.email ?? '')
        // Server state is authoritative on load — clear any stale optimistic marks.
        setOptimisticDone(new Set())
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [isPortalLead, resolvedLeadId, lead?.email])

  if (!isPortalLead || loading || !tracker?.request?.id) return null

  // Events confirmed by the server (from job_timeline rows)
  const doneTypes = new Set(
    (tracker.timeline || []).map((event) => event.event_type)
  )

  // Merge server-confirmed + optimistic for instant visual feedback
  const effectiveDone = new Set<string>([...doneTypes, ...optimisticDone])

  const reviewAlreadySent = !!tracker.request.review_requested_at
  const workCompleted = effectiveDone.has('work_completed')

  const handleRequestReview = () => {
    if (reviewEmail.trim()) {
      sendReview()
    } else {
      setReviewModalOpen(true)
    }
  }

  const writeStatus = async (eventType: PortalTimelineEventType) => {
    // Hard guard: skip if already confirmed OR optimistically marked (idempotent)
    if (!tracker?.request?.id || writing || effectiveDone.has(eventType)) return

    setWriting(eventType)
    setWriteError(null)
    setReviewError(null)
    setReviewSentMessage(null)

    // Optimistically mark done immediately — instant green/check before server reply
    setOptimisticDone((prev) => new Set([...prev, eventType]))

    try {
      const next = await writePortalLifecycleEvent(tracker.request.id, eventType)
      if (next) {
        // Server confirmed — let real doneTypes own it; clear from optimistic
        setTracker(next)
        setReviewEmail(next.request.email ?? lead?.email ?? '')
        setOptimisticDone((prev) => {
          const s = new Set(prev)
          s.delete(eventType)
          return s
        })
      } else {
        // Rollback optimistic and surface an inline error (no browser alert)
        setOptimisticDone((prev) => {
          const s = new Set(prev)
          s.delete(eventType)
          return s
        })
        const meta = getPortalTimelineMeta(eventType)
        setWriteError(
          `Could not save "${meta?.title || eventType}". Check your connection and try again.`
        )
      }
    } finally {
      setWriting(null)
    }
  }

  const sendReview = async () => {
    if (!tracker?.request?.id || sendingReview || reviewAlreadySent) return
    setSendingReview(true)
    setReviewError(null)
    setReviewSentMessage(null)
    const result = await sendPortalReviewRequest({
      portalRequestId: tracker.request.id,
      email: reviewEmail,
    })
    setSendingReview(false)

    if (!result.success) {
      setReviewError(friendlyReviewError(result.error || 'Review request failed'))
      if (result.request)
        setTracker((prev) =>
          prev ? { ...prev, request: result.request as any } : prev
        )
      return
    }

    setReviewSentMessage(`Review request sent to ${result.sentTo || reviewEmail}.`)
    setReviewModalOpen(false)
    if (result.request)
      setTracker((prev) =>
        prev ? { ...prev, request: result.request as any } : prev
      )
  }

  return (
    <div className="space-y-3 p-4 bg-gray-900/90 rounded-lg border border-yellow-700/25 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-yellow-200">Customer Tracker</h4>
          <div className="text-xs text-gray-500">Updates the public portal tracking page.</div>
        </div>
        <a
          href={`/portal/track/${tracker.request.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-yellow-300 hover:text-yellow-200"
        >
          <ExternalLink size={11} />
          Track
        </a>
      </div>

      <div className="flex flex-wrap gap-2">
        {PORTAL_LIFECYCLE_EVENT_TYPES.map((eventType) => {
          const meta = getPortalTimelineMeta(eventType)
          const isDone = effectiveDone.has(eventType)
          const isSaving = writing === eventType
          return (
            <button
              key={eventType}
              onClick={() => writeStatus(eventType)}
              disabled={!!writing || isDone}
              className={clsx(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border transition-all duration-150',
                isDone
                  ? 'bg-emerald-950/70 text-emerald-300 border-emerald-700/70 cursor-default shadow-sm'
                  : 'bg-slate-800/90 text-slate-300 border-slate-600/60 hover:border-slate-400 hover:bg-slate-700/80 hover:text-white cursor-pointer',
                isSaving && 'opacity-60 cursor-wait'
              )}
            >
              {isSaving ? (
                <Loader2 size={12} className="animate-spin flex-shrink-0" />
              ) : isDone ? (
                <CheckCircle size={12} className="flex-shrink-0" />
              ) : (
                <Clock size={12} className="flex-shrink-0 opacity-60" />
              )}
              {meta?.title || eventType}
            </button>
          )
        })}
      </div>

      {writeError && (
        <div className="text-xs text-red-300">{writeError}</div>
      )}

      {workCompleted && (
        <div className="pt-2 border-t border-gray-700">
          {reviewAlreadySent ? (
            <div className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-emerald-950/60 border border-emerald-800/50 text-xs font-semibold text-emerald-300">
              <CheckCircle size={13} className="flex-shrink-0 text-emerald-400" />
              <span>
                Review request sent to{' '}
                <span className="text-emerald-200">
                  {tracker.request.review_request_sent_to ||
                    tracker.request.email ||
                    'customer'}
                </span>
              </span>
            </div>
          ) : (
            <div className="space-y-1.5">
              <button
                onClick={handleRequestReview}
                disabled={sendingReview}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border transition-all duration-150 bg-amber-950/40 text-amber-300 border-amber-700/60 hover:bg-amber-900/50 hover:border-amber-500 hover:text-amber-200 disabled:opacity-50 disabled:cursor-wait"
              >
                {sendingReview ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Mail size={12} />
                )}
                {sendingReview ? 'Sending…' : 'Request Review'}
              </button>
              {reviewError && (
                <div className="text-xs text-red-300">{reviewError}</div>
              )}
              {reviewSentMessage && (
                <div className="inline-flex items-center gap-1.5 text-xs text-emerald-300 font-medium">
                  <CheckCircle size={11} className="flex-shrink-0" />
                  {reviewSentMessage}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {reviewModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,.75)', backdropFilter: 'blur(8px)' }}
          onClick={() => setReviewModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-yellow-700/40 bg-gray-950 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h3 className="text-base font-bold text-white">Send Review Request</h3>
                <p className="text-xs text-gray-400 mt-1">
                  Ask for honest feedback now that work is completed.
                </p>
              </div>
              <button
                onClick={() => setReviewModalOpen(false)}
                className="text-gray-500 hover:text-white text-lg leading-none"
              >
                ✕
              </button>
            </div>

            {reviewAlreadySent ? (
              <div className="rounded-lg border border-emerald-700/40 bg-emerald-950/30 p-3 text-sm text-emerald-200">
                Review request already sent to{' '}
                {tracker.request.review_request_sent_to ||
                  tracker.request.email ||
                  'customer'}
                .
              </div>
            ) : (
              <div className="space-y-3">
                <label className="block">
                  <span className="text-[10px] text-gray-500 uppercase font-bold block mb-1">
                    Customer Email
                  </span>
                  <input
                    type="email"
                    value={reviewEmail}
                    onChange={(e) => setReviewEmail(e.target.value)}
                    placeholder="customer@example.com"
                    className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 outline-none focus:border-yellow-500"
                  />
                </label>
                <div className="rounded-lg bg-gray-900 border border-gray-800 p-3 text-xs text-gray-300 leading-relaxed">
                  The email thanks the customer and asks for honest feedback
                  using the approved Google review link.
                </div>
                {reviewError && (
                  <div className="text-xs text-red-300">{reviewError}</div>
                )}
                {reviewSentMessage && (
                  <div className="text-xs text-emerald-300">{reviewSentMessage}</div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setReviewModalOpen(false)}
                className="px-3 py-2 rounded bg-gray-800 text-gray-300 text-xs font-semibold hover:bg-gray-700"
              >
                Close
              </button>
              {!reviewAlreadySent && (
                <button
                  onClick={sendReview}
                  disabled={sendingReview || !reviewEmail.trim()}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sendingReview ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Mail size={13} />
                  )}
                  Send Review Request
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default PortalStatusControls
