/**
 * LIVE CALL tab — Sales Intelligence call workspace (LEAD-SRC-3C / 3C2).
 *
 * Durable call history / manual logging lives here.
 * Contextual Hunter lead Call (optional dialer) remains on Leads cards.
 *
 * Open Dialer is always optional and never automatic.
 * Note: this tab was previously a stub ("Real-time call guidance and
 * transcription"). Full SPARK script coaching still lives in the separate
 * SparkLiveCall preview route — preserved/reported, not deleted.
 *
 * COACH-LINK-3A — Active Sales Session → Live Call queues a one-shot
 * liveCallLaunchRequest; this tab consumes it and opens CallLogModal for
 * that Hunter lead. Opening the modal alone never creates a call_log.
 *
 * COACH-LINK-4A — When an active Sales Session lead is present, Call Assist
 * offers explicit Prepare Call + manual Coach Me (no mic / no auto-dial).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Mic, Phone, Plus } from 'lucide-react'
import CallLogModal from '@/components/hunter/CallLogModal'
import RecentCallsPanel from '@/components/hunter/RecentCallsPanel'
import { LiveCallAssistPanel } from '@/components/salesIntel/liveCall/LiveCallAssistPanel'
import { SalesSessionContextBar } from '@/components/salesIntel/SalesSessionContextBar'
import { useSalesIntelStore } from '@/components/salesIntel/SalesIntelStore'
import {
  createCallLog,
  fetchRecentCallLogs,
  openTelDialer,
  type CallLog,
} from '@/services/calls'
import { useHunterStore } from '@/store/hunterStore'

export const LiveCallTab: React.FC = () => {
  const [calls, setCalls] = useState<CallLog[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'classify' | 'create'>('create')
  const [modalDirection, setModalDirection] = useState<'inbound' | 'outbound'>(
    'inbound',
  )
  const [activeCall, setActiveCall] = useState<CallLog | null>(null)
  const [callAgainBusy, setCallAgainBusy] = useState(false)
  /** Hunter lead prefill for session-launched / lead Call modal (create mode). */
  const [modalHunterLeadId, setModalHunterLeadId] = useState<string | null>(
    null,
  )
  const [modalDefaultPhone, setModalDefaultPhone] = useState('')

  const hunterLeads = useHunterStore((s) => s.leads)
  const fetchLeads = useHunterStore((s) => s.fetchLeads)
  const salesSession = useSalesIntelStore((s) => s.salesSession)
  const liveCallLaunchRequest = useSalesIntelStore(
    (s) => s.liveCallLaunchRequest,
  )

  const activeLead = useMemo(() => {
    if (!salesSession?.leadId) return null
    const found = hunterLeads.find((l) => String(l.id) === salesSession.leadId)
    return found
      ? (found as unknown as Record<string, unknown>)
      : null
  }, [hunterLeads, salesSession?.leadId])

  const refreshCalls = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const rows = await fetchRecentCallLogs(40)
      setCalls(rows)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load calls')
      setCalls([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshCalls()
    void fetchLeads().catch(() => {})
  }, [refreshCalls, fetchLeads])

  /**
   * COACH-LINK-3A — consume one-shot launch intent and open CallLogModal for
   * the active Hunter lead. Consume immediately so remount / tab bounce
   * cannot reopen without a new explicit Live Call action.
   */
  useEffect(() => {
    if (!liveCallLaunchRequest?.hunterLeadId) return
    const consumed =
      useSalesIntelStore.getState().consumeLiveCallLaunchRequest()
    if (!consumed?.hunterLeadId) return

    const leadId = consumed.hunterLeadId
    const leadsNow = useHunterStore.getState().leads
    const lead = leadsNow.find((l) => String(l.id) === leadId) as
      | { phone?: string }
      | undefined
    const phone = lead ? String(lead.phone || '').trim() : ''

    setActionError(null)
    setActiveCall(null)
    setModalMode('create')
    setModalDirection('outbound')
    setModalHunterLeadId(leadId)
    setModalDefaultPhone(phone)
    setModalOpen(true)
  }, [liveCallLaunchRequest])

  /** Fill phone once Hunter leads resolve after launch (same hunterLeadId). */
  useEffect(() => {
    if (!modalOpen || !modalHunterLeadId || modalDefaultPhone) return
    const lead = hunterLeads.find((l) => String(l.id) === modalHunterLeadId) as
      | { phone?: string }
      | undefined
    const phone = lead ? String(lead.phone || '').trim() : ''
    if (phone) setModalDefaultPhone(phone)
  }, [hunterLeads, modalOpen, modalHunterLeadId, modalDefaultPhone])

  const leadNameById = Object.fromEntries(
    hunterLeads.map((l: any) => [
      l.id,
      l.contact_name ||
        l.contactName ||
        l.company_name ||
        l.companyName ||
        l.phone ||
        l.id,
    ]),
  )

  const closeModal = () => {
    setModalOpen(false)
    setModalHunterLeadId(null)
    setModalDefaultPhone('')
    setActiveCall(null)
  }

  const openLogCall = () => {
    setActionError(null)
    setActiveCall(null)
    setModalMode('create')
    setModalDirection('inbound')
    setModalHunterLeadId(null)
    setModalDefaultPhone('')
    setModalOpen(true)
  }

  const openClassify = (call: CallLog) => {
    setActionError(null)
    setActiveCall(call)
    setModalMode('classify')
    setModalDirection(call.direction)
    setModalHunterLeadId(null)
    setModalDefaultPhone('')
    setModalOpen(true)
  }

  /** History row: tel: only — never creates a duplicate call row. */
  const handleHistoryOpenDialer = (call: CallLog) => {
    setActionError(null)
    openTelDialer(call.phoneRaw)
  }

  /**
   * Call Again: NEW outbound unknown/unclassified row linked to the same
   * entity where safe. Opens modal; does NOT invoke tel: automatically.
   * Never mutates the historical row into the new attempt.
   */
  const handleCallAgain = async (call: CallLog) => {
    if (callAgainBusy) return
    setActionError(null)
    setCallAgainBusy(true)
    try {
      const created = await createCallLog({
        phoneRaw: call.phoneRaw,
        direction: 'outbound',
        outcome: 'unknown',
        classification: 'unclassified',
        notes: null,
        hunterLeadId: call.hunterLeadId,
        portalRequestId: call.portalRequestId,
        clientId: call.clientId,
        requireHunterTenant: Boolean(call.hunterLeadId),
        autoLinkFromMatch: false,
      })
      setActiveCall(created)
      setModalMode('classify')
      setModalDirection('outbound')
      setModalHunterLeadId(null)
      setModalDefaultPhone('')
      setModalOpen(true)
      void refreshCalls()
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to start Call Again',
      )
    } finally {
      setCallAgainBusy(false)
    }
  }

  const hasCalls = calls.length > 0
  const showCallAssist = Boolean(salesSession?.sessionId && salesSession.leadId)

  return (
    <div className="space-y-4 text-gray-300">
      <SalesSessionContextBar />
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Mic className="w-5 h-5 text-green-400" />
            Live Call
          </h3>
          <p className="text-xs text-gray-400 mt-1">
            Log inbound/outbound calls, classify spam vs customers, and review
            recent call history. The browser cannot detect connect status or
            duration automatically. Open Dialer is optional.
          </p>
        </div>
        <button
          type="button"
          onClick={openLogCall}
          className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition-colors shrink-0"
        >
          <Plus size={14} />
          Log Call
        </button>
      </div>

      {showCallAssist && salesSession ? (
        <LiveCallAssistPanel
          sessionId={salesSession.sessionId}
          hunterLeadId={salesSession.leadId}
          lead={activeLead}
        />
      ) : (
        <div
          data-testid="live-call-guidance-placeholder"
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2"
        >
          <p className="text-xs text-gray-400">
            Real-time call guidance and transcription — coaching scripts remain
            available in SPARK Live Call preview. Start an active sales session
            from a Hunter lead to unlock Call Assist (Prepare Call + Coach Me).
            This tab remains the durable call history workspace.
          </p>
        </div>
      )}

      {loadError && (
        <div className="rounded border border-amber-700 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
          {loadError}
        </div>
      )}

      {actionError && (
        <div className="rounded border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-100">
          {actionError}
        </div>
      )}

      {!loading && !hasCalls && !loadError && (
        <div
          data-testid="live-call-empty-state"
          className="rounded-lg border border-dashed border-white/15 bg-slate-900/50 px-4 py-8 text-center"
        >
          <Phone className="w-8 h-8 text-gray-600 mx-auto mb-3" />
          <p className="text-sm text-gray-200 font-medium">No calls logged yet.</p>
          <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
            Log an inbound call or call a lead to begin building call history.
          </p>
          <button
            type="button"
            onClick={openLogCall}
            className="mt-4 inline-flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition-colors"
          >
            <Plus size={14} />
            Log Call
          </button>
        </div>
      )}

      {(hasCalls || loading) && (
        <div
          data-testid="live-call-history"
          className="rounded-lg border border-white/10 bg-slate-950/40 p-3"
        >
          <div className="flex items-center gap-2 mb-3" data-testid="live-call-history-header">
            <Phone size={14} className="text-blue-400" />
            <h4 className="text-xs font-semibold text-gray-200 uppercase tracking-wide">
              Call History
            </h4>
            {loading && (
              <span className="text-[10px] text-gray-500">Loading…</span>
            )}
          </div>
          {!loading && hasCalls && (
            <RecentCallsPanel
              calls={calls}
              embedded
              leadNameById={leadNameById}
              onSelectCall={openClassify}
              onOpenDialer={handleHistoryOpenDialer}
              onCallAgain={(c) => void handleCallAgain(c)}
            />
          )}
        </div>
      )}

      <CallLogModal
        isOpen={modalOpen}
        mode={modalMode}
        callLog={activeCall}
        defaultDirection={modalDirection}
        defaultPhone={modalDefaultPhone}
        defaultHunterLeadId={modalHunterLeadId}
        showOptionalDialer
        onClose={closeModal}
        onSaved={(log) => {
          void refreshCalls()
          // Narrow linkage: only attach when the durable row matches the active lead.
          const session = useSalesIntelStore.getState().salesSession
          if (
            session &&
            log?.id &&
            log.hunterLeadId &&
            log.hunterLeadId === session.leadId
          ) {
            useSalesIntelStore.getState().attachCallLog(log.id)
          }
        }}
      />
    </div>
  )
}

export default LiveCallTab
