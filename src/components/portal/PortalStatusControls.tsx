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

export function PortalStatusControls({ lead, hunterLeadId }: PortalStatusControlsProps) {
  const [tracker, setTracker] = useState<PortalTrackerState | null>(null)
  const [loading, setLoading] = useState(false)
  const [writing, setWriting] = useState<PortalTimelineEventType | null>(null)
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
        setReviewEmail(
          state?.request?.email ?? lead?.email ?? ''
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [isPortalLead, resolvedLeadId, lead?.email])

  if (!isPortalLead || loading || !tracker?.request?.id) return null

  const doneTypes = new Set(
    (tracker.timeline || []).map((event) => event.event_type)
  )
  const reviewAlreadySent = !!tracker.request.review_requested_at

  const writeStatus = async (eventType: PortalTimelineEventType) => {
    if (!tracker?.request?.id || writing) return
    setWriting(eventType)
    setReviewError(null)
    setReviewSentMessage(null)
    try {
      const next = await writePortalLifecycleEvent(tracker.request.id, eventType)
      if (next) {
        setTracker(next)
        setReviewEmail(next.request.email ?? lead?.email ?? '')
        if (eventType === 'work_completed') setReviewModalOpen(true)
      } else {
        alert('Portal status update failed. Check console for details.')
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
      setReviewError(result.error || 'Review request failed')
      if (result.request)
        setTracker((prev) =>
          prev ? { ...prev, request: result.request as any } : prev
        )
      return
    }

    setReviewSentMessage(`Review request sent to ${result.sentTo || reviewEmail}.`)
    if (result.request)
      setTracker((prev) =>
        prev ? { ...prev, request: result.request as any } : prev
      )
  }

  return (
    <div className="space-y-3 p-3 bg-gray-800 rounded border border-yellow-700/30">
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
          const isDone = doneTypes.has(eventType)
          return (
            <button
              key={eventType}
              onClick={() => writeStatus(eventType)}
              disabled={!!writing || isDone}
              className={clsx(
                'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-semibold border transition-colors',
                isDone
                  ? 'bg-emerald-900/50 text-emerald-300 border-emerald-700 cursor-default'
                  : 'bg-gray-900 text-gray-200 border-gray-700 hover:border-yellow-500 hover:text-yellow-200',
                writing === eventType && 'opacity-70 cursor-wait'
              )}
            >
              {writing === eventType ? (
                <Loader2 size={12} className="animate-spin" />
              ) : isDone ? (
                <CheckCircle size={12} />
              ) : (
                <Clock size={12} />
              )}
              {meta?.title || eventType}
            </button>
          )
        })}
      </div>

      {reviewAlreadySent && (
        <div className="text-xs text-emerald-300">
          Review request already sent to{' '}
          {tracker.request.review_request_sent_to ||
            tracker.request.email ||
            'customer'}
          .
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
