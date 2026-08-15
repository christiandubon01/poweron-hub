/**
 * LEAD-SRC-3B/3C1/3C2 — call classify + manual log modal.
 * Updates call_logs only. Never mutates leads/customers/portal requests.
 *
 * Optional Open Dialer (tel:) is never automatic.
 * Unsaved create → save truthful values first, then tel:.
 * Already-saved call → tel: only (no duplicate row).
 */

import React, { useEffect, useState } from 'react'
import { AlertCircle, Phone, X } from 'lucide-react'
import clsx from 'clsx'
import {
  CALL_CLASSIFICATIONS,
  CALL_OUTCOMES,
  createCallLog,
  dialerDigits,
  matchPhoneAgainstOrgEntities,
  openTelDialer,
  updateCallLogClassification,
  type CallClassification,
  type CallDirection,
  type CallLog,
  type CallOutcome,
  type CallEntityMatchResult,
} from '@/services/calls'

export type CallLogModalMode = 'classify' | 'create'

export interface CallLogModalProps {
  isOpen: boolean
  mode: CallLogModalMode
  callLog?: CallLog | null
  defaultDirection?: CallDirection
  defaultPhone?: string
  /** Explicit Hunter lead link (Hunter Call workflow). */
  defaultHunterLeadId?: string | null
  /**
   * When true, footer exposes optional Open Dialer (secondary) alongside
   * Log Call / Save. Used by Hunter outbound and Live Call workspace.
   */
  showOptionalDialer?: boolean
  onClose: () => void
  onSaved?: (log: CallLog) => void
}

const CLASSIFICATION_LABELS: Record<CallClassification, string> = {
  unclassified: 'Unclassified',
  new_lead: 'New Lead',
  existing_customer: 'Existing Customer',
  spam: 'Spam',
  vendor: 'Vendor',
  other: 'Other',
}

const OUTCOME_LABELS: Record<CallOutcome, string> = {
  unknown: 'Unknown',
  answered: 'Answered',
  no_answer: 'No Answer',
  voicemail: 'Voicemail',
  missed: 'Missed',
}

export function CallLogModal({
  isOpen,
  mode,
  callLog,
  defaultDirection = 'inbound',
  defaultPhone = '',
  defaultHunterLeadId = null,
  showOptionalDialer = false,
  onClose,
  onSaved,
}: CallLogModalProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phone, setPhone] = useState(defaultPhone)
  const [direction, setDirection] = useState<CallDirection>(defaultDirection)
  const [classification, setClassification] = useState<CallClassification>(
    callLog?.classification ?? 'unclassified',
  )
  const [outcome, setOutcome] = useState<CallOutcome>(callLog?.outcome ?? 'unknown')
  const [notes, setNotes] = useState(callLog?.notes ?? '')
  const [matchResult, setMatchResult] = useState<CallEntityMatchResult | null>(null)
  const [matchHint, setMatchHint] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setError(null)
    setPhone(callLog?.phoneRaw ?? defaultPhone)
    setDirection(defaultDirection)
    setClassification(callLog?.classification ?? 'unclassified')
    setOutcome(callLog?.outcome ?? 'unknown')
    setNotes(callLog?.notes ?? '')
    setMatchResult(null)
    setMatchHint(null)
  }, [isOpen, callLog, defaultPhone, defaultDirection])

  useEffect(() => {
    if (!isOpen || mode !== 'create') return
    // Explicit Hunter lead link skips phone-match auto-link.
    if (defaultHunterLeadId) {
      setMatchResult(null)
      setMatchHint('Linked to this Hunter lead')
      return
    }
    const trimmed = phone.trim()
    if (trimmed.length < 7) {
      setMatchResult(null)
      setMatchHint(null)
      return
    }
    let cancelled = false
    const t = setTimeout(() => {
      void matchPhoneAgainstOrgEntities(trimmed)
        .then((result) => {
          if (cancelled) return
          setMatchResult(result)
          if (result.status === 'single') {
            setMatchHint(`Matched: ${result.match.label} (${result.match.kind})`)
          } else if (result.status === 'ambiguous') {
            setMatchHint(
              `Ambiguous (${result.matches.length} matches) — left unlinked`,
            )
          } else {
            setMatchHint('No entity match')
          }
        })
        .catch(() => {
          if (!cancelled) {
            setMatchResult(null)
            setMatchHint(null)
          }
        })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [isOpen, mode, phone, defaultHunterLeadId])

  if (!isOpen) return null

  const saveCreateLog = async (): Promise<CallLog> => {
    if (defaultHunterLeadId) {
      return createCallLog({
        phoneRaw: phone,
        direction,
        outcome,
        classification,
        notes: notes || null,
        hunterLeadId: defaultHunterLeadId,
        requireHunterTenant: true,
        autoLinkFromMatch: false,
      })
    }

    const links =
      matchResult?.status === 'single'
        ? {
            hunterLeadId:
              matchResult.match.kind === 'hunter_lead'
                ? matchResult.match.id
                : null,
            portalRequestId:
              matchResult.match.kind === 'portal_request'
                ? matchResult.match.id
                : null,
            clientId:
              matchResult.match.kind === 'client' ? matchResult.match.id : null,
          }
        : {}

    return createCallLog({
      phoneRaw: phone,
      direction,
      outcome,
      classification,
      notes: notes || null,
      ...links,
      requireHunterTenant: Boolean(links.hunterLeadId),
      autoLinkFromMatch: false,
    })
  }

  const handleClassify = async () => {
    if (!callLog?.id) throw new Error('Missing call log to classify')
    const updated = await updateCallLogClassification({
      callLogId: callLog.id,
      classification,
      outcome,
      notes: notes || null,
    })
    onSaved?.(updated)
    onClose()
  }

  /** In-app only — never invokes tel:. */
  const handleLogCall = async () => {
    setError(null)
    setLoading(true)
    try {
      if (mode === 'classify') {
        await handleClassify()
        return
      }
      const created = await saveCreateLog()
      onSaved?.(created)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save call log')
    } finally {
      setLoading(false)
    }
  }

  /** Optional external dialer — never automatic; never claims connect/answered. */
  const handleOpenDialer = async () => {
    setError(null)
    const phoneForDial = (mode === 'classify' ? callLog?.phoneRaw : phone) ?? phone
    if (!dialerDigits(phoneForDial)) {
      setError('Invalid phone number')
      return
    }

    setLoading(true)
    try {
      // Already-saved call (classify): tel: only — never create a duplicate row.
      if (mode === 'classify' || callLog?.id) {
        openTelDialer(phoneForDial)
        return
      }

      // Brand-new unsaved create: save truthful current values first, then tel:.
      let created: CallLog | null = null
      let logError: string | null = null
      try {
        created = await saveCreateLog()
        onSaved?.(created)
      } catch (err) {
        logError = err instanceof Error ? err.message : 'Failed to save call log'
      }

      const dialerOpened = openTelDialer(phoneForDial)
      if (logError) {
        setError(
          dialerOpened
            ? `Dialer opened, but call was not logged: ${logError}`
            : logError,
        )
        return
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open dialer')
    } finally {
      setLoading(false)
    }
  }

  const phoneForDialerCheck =
    mode === 'classify' ? (callLog?.phoneRaw ?? phone) : phone
  const canOpenDialer = Boolean(dialerDigits(phoneForDialerCheck))

  const title =
    mode === 'classify'
      ? 'Classify Call'
      : showOptionalDialer && direction === 'outbound'
        ? 'Outbound Call'
        : 'Log Call'

  const showDialerAction = showOptionalDialer && (mode === 'create' || mode === 'classify')


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div className="flex items-center gap-2 text-white font-semibold">
            <Phone size={16} className="text-blue-400" />
            {title}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-white"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <p className="text-[11px] text-gray-500">
            Browser cannot know connect status, duration, or inbound events.
            Logging a call does not claim it connected — start as unknown /
            unclassified and edit the result afterward.
          </p>

          {mode === 'create' && (
            <>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Phone</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(760) 555-1212"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
                />
                {matchHint && (
                  <p
                    className={clsx(
                      'mt-1 text-[11px]',
                      matchResult?.status === 'ambiguous'
                        ? 'text-amber-400'
                        : 'text-gray-400',
                    )}
                  >
                    {matchHint}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Direction</label>
                <select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as CallDirection)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
                >
                  <option value="inbound">Inbound</option>
                  <option value="outbound">Outbound</option>
                </select>
              </div>
            </>
          )}

          {mode === 'classify' && callLog && (
            <div className="text-sm text-gray-300">
              <span className="text-gray-500">Phone:</span> {callLog.phoneRaw}
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-400 mb-1">Classification</label>
            <select
              value={classification}
              onChange={(e) =>
                setClassification(e.target.value as CallClassification)
              }
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
            >
              {CALL_CLASSIFICATIONS.map((c) => (
                <option key={c} value={c}>
                  {CLASSIFICATION_LABELS[c]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Outcome</label>
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as CallOutcome)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
            >
              {CALL_OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {OUTCOME_LABELS[o]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm resize-none"
              placeholder="What happened on the call?"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-950/40 border border-red-800 rounded p-2">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-800 flex-wrap">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-sm text-gray-300 hover:text-white"
          >
            Cancel
          </button>
          {showOptionalDialer && mode === 'create' ? (
            <button
              type="button"
              disabled={loading || !phone.trim()}
              onClick={() => void handleLogCall()}
              data-testid="call-log-save-only"
              className="px-3 py-2 text-sm rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white"
            >
              {loading ? 'Saving…' : 'Log Call'}
            </button>
          ) : (
            <button
              type="button"
              disabled={loading || (mode === 'create' && !phone.trim())}
              onClick={() => void handleLogCall()}
              data-testid={mode === 'classify' ? 'call-log-save' : undefined}
              className="px-3 py-2 text-sm rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white"
            >
              {loading ? 'Saving…' : 'Save'}
            </button>
          )}
          {showDialerAction && (
            <button
              type="button"
              disabled={loading || !canOpenDialer}
              onClick={() => void handleOpenDialer()}
              data-testid="call-log-open-dialer"
              title={
                canOpenDialer
                  ? 'Optional — opens OS/browser dialer (does not claim connected)'
                  : 'Enter a valid phone number to open dialer'
              }
              className="px-3 py-2 text-sm rounded border border-gray-600 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white"
            >
              Open Dialer
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default CallLogModal
