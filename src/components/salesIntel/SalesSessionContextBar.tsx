/**
 * COACH-LINK-2 — compact active sales-session context for Practice / Live Call / Coach.
 * Resolves lead details from Hunter store by leadId (IDs only in session).
 */

import React from 'react'
import { Phone, X } from 'lucide-react'
import { useHunterStore } from '@/store/hunterStore'
import type { HunterLead } from '@/services/hunter/HunterTypes'
import {
  useSalesIntelStore,
  type SalesSessionMode,
} from '@/components/salesIntel/SalesIntelStore'

const MODE_LABEL: Record<SalesSessionMode, string> = {
  practice: 'Practice',
  live_call: 'Live Call',
  coach: 'Coach',
}

function leadDisplayName(lead: HunterLead | null | undefined): string {
  if (!lead) return 'Unknown lead'
  return (
    (lead.contact_name || '').trim() ||
    (lead.company_name || '').trim() ||
    (lead.phone || '').trim() ||
    lead.id ||
    'Unknown lead'
  )
}

function leadSourceLine(lead: HunterLead | null | undefined): string {
  if (!lead) return '—'
  const source = (lead.source || '').trim() || '—'
  const detail = (lead.source_tag || '').trim()
  return detail ? `${source} · ${detail}` : source
}

export interface SalesSessionContextBarProps {
  className?: string
  /** When true, hide the whole bar if there is no active session. */
  hideWhenEmpty?: boolean
}

export const SalesSessionContextBar: React.FC<SalesSessionContextBarProps> = ({
  className = '',
  hideWhenEmpty = true,
}) => {
  const salesSession = useSalesIntelStore((s) => s.salesSession)
  const clearSalesSession = useSalesIntelStore((s) => s.clearSalesSession)
  const setActiveTab = useSalesIntelStore((s) => s.setActiveTab)
  const requestLiveCallLaunch = useSalesIntelStore((s) => s.requestLiveCallLaunch)
  const leads = useHunterStore((s) => s.leads)

  if (!salesSession) {
    if (hideWhenEmpty) return null
    return null
  }

  const lead =
    leads.find((l) => String(l.id) === salesSession.leadId) ?? null
  const name = leadDisplayName(lead)
  const phone = lead ? (lead.phone || '').trim() || '—' : '—'
  const source = leadSourceLine(lead)

  return (
    <div
      data-testid="sales-session-context-bar"
      className={`rounded-lg border border-emerald-500/30 bg-emerald-950/20 px-3 py-2 text-sm text-gray-200 ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400/90">
            Active Sales Session
          </div>
          <div className="font-medium text-white truncate">{name}</div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-400">
            <span className="inline-flex items-center gap-1">
              <Phone className="w-3 h-3" />
              {phone}
            </span>
            <span className="truncate">{source}</span>
            <span>
              Mode:{' '}
              <span className="text-emerald-300">{MODE_LABEL[salesSession.mode]}</span>
            </span>
            {salesSession.callLogId ? (
              <span
                data-testid="sales-session-call-log-linked"
                className="text-emerald-400/90"
              >
                Call log linked
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('practice')}
            className="px-2 py-1 rounded text-[11px] bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10"
          >
            Practice
          </button>
          <button
            type="button"
            data-testid="sales-session-live-call"
            onClick={() => {
              // COACH-LINK-3A — preserve session, queue lead-specific CallLogModal, navigate.
              // Does NOT dial, save call_log, or invent connect/answered state.
              requestLiveCallLaunch(salesSession.leadId)
              setActiveTab('live_call')
            }}
            className="px-2 py-1 rounded text-[11px] bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10"
          >
            Live Call
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('coach')}
            className="px-2 py-1 rounded text-[11px] bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10"
          >
            Coach
          </button>
          <button
            type="button"
            data-testid="sales-session-clear"
            onClick={() => clearSalesSession()}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-white/5 hover:bg-red-950/40 text-gray-400 hover:text-red-200 border border-white/10"
            title="Clear Session"
          >
            <X className="w-3 h-3" />
            Clear Session
          </button>
        </div>
      </div>
    </div>
  )
}

export default SalesSessionContextBar
