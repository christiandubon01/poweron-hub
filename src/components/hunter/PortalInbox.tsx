/**
 * PortalInbox.tsx
 * Renders above the HUNTER lead list when there are unreviewed portal submissions.
 *
 * Features:
 *   - Collapsible amber banner showing count of new portal requests
 *   - Each request shows name, service category, city, preferred date, description
 *   - "Convert to Lead" button → calls convertToLead() → lead appears in HUNTER
 *   - "Dismiss" button → marks request closed, removes from inbox
 *   - Auto-refreshes every 60 seconds
 */

import React, { useEffect, useState, useCallback } from 'react'
import { ChevronDown, ChevronUp, Loader2, Globe, X, ArrowRight } from 'lucide-react'
import clsx from 'clsx'
import {
  fetchNewPortalRequests,
  convertToLead,
  dismissPortalRequest,
  type PortalRequest,
} from '@/services/portal/portalService'

interface PortalInboxProps {
  onLeadConverted?: () => void  // called after successful conversion so HunterPanel can refetch
}

const CATEGORY_LABELS: Record<string, string> = {
  residential:   'Residential',
  commercial:    'Commercial',
  solar:         'Solar / PV',
  maintenance:   'Maintenance',
  panel_upgrade: 'Panel Upgrade',
  ev_charger:    'EV Charger',
  other:         'Other',
}

const TYPE_LABELS: Record<string, string> = {
  homeowner: 'Homeowner',
  gc:        'GC / Sub',
}

export function PortalInbox({ onLeadConverted }: PortalInboxProps) {
  const [requests, setRequests] = useState<PortalRequest[]>([])
  const [expanded, setExpanded] = useState(true)
  const [converting, setConverting] = useState<string | null>(null)  // id of row being converted
  const [dismissing, setDismissing] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const rows = await fetchNewPortalRequests()
    setRequests(rows)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 60_000)
    return () => clearInterval(interval)
  }, [load])

  const handleConvert = async (req: PortalRequest) => {
    setConverting(req.id)
    try {
      const leadId = await convertToLead(req)
      if (leadId) {
        setRequests((prev) => prev.filter((r) => r.id !== req.id))
        onLeadConverted?.()
      } else {
        alert('Conversion failed — check console for details.')
      }
    } finally {
      setConverting(null)
    }
  }

  const handleDismiss = async (req: PortalRequest) => {
    setDismissing(req.id)
    try {
      await dismissPortalRequest(req.id)
      setRequests((prev) => prev.filter((r) => r.id !== req.id))
    } finally {
      setDismissing(null)
    }
  }

  // Nothing to show
  if (!loading && requests.length === 0) return null

  return (
    <div className="border border-amber-700/50 rounded-lg overflow-hidden bg-amber-950/30 mb-4">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-amber-900/40 hover:bg-amber-900/60 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <Globe size={13} className="text-amber-400" />
          <span className="text-xs font-bold text-amber-200 uppercase tracking-wide">
            Portal Inbox
          </span>
          {loading ? (
            <Loader2 size={11} className="animate-spin text-amber-400" />
          ) : (
            <span className="px-1.5 py-0.5 rounded-full bg-amber-500 text-black text-[10px] font-bold">
              {requests.length}
            </span>
          )}
        </div>
        {expanded
          ? <ChevronUp size={13} className="text-amber-400" />
          : <ChevronDown size={13} className="text-amber-400" />
        }
      </button>

      {/* Request rows */}
      {expanded && !loading && (
        <div className="divide-y divide-amber-900/40">
          {requests.map((req) => {
            const isConverting = converting === req.id
            const isDismissing = dismissing === req.id

            return (
              <div key={req.id} className="px-4 py-3 space-y-2">
                {/* Row header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-white truncate">
                        {req.name}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-amber-800/60 text-amber-300 text-[10px] font-bold uppercase tracking-wide">
                        {TYPE_LABELS[req.request_type] ?? req.request_type}
                      </span>
                      {req.service_category && (
                        <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 text-[10px]">
                          {CATEGORY_LABELS[req.service_category] ?? req.service_category}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {req.phone && (
                        <span className="text-xs text-gray-400">{req.phone}</span>
                      )}
                      {req.email && (
                        <span className="text-xs text-gray-400">{req.email}</span>
                      )}
                      {req.city && (
                        <span className="text-xs text-gray-500">{req.city}</span>
                      )}
                      {req.preferred_date && (
                        <span className="text-xs text-gray-500">
                          📅 {req.preferred_date}
                          {req.preferred_time ? ` · ${req.preferred_time}` : ''}
                        </span>
                      )}
                    </div>
                    {req.description && (
                      <p className="text-xs text-gray-400 mt-1 line-clamp-2 leading-relaxed">
                        {req.description}
                      </p>
                    )}
                  </div>

                  {/* Timestamp */}
                  <span className="text-[10px] text-gray-600 whitespace-nowrap flex-shrink-0">
                    {new Date(req.created_at).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric',
                    })}
                  </span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleConvert(req)}
                    disabled={isConverting || isDismissing}
                    className={clsx(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-colors',
                      isConverting
                        ? 'bg-emerald-900 text-emerald-400 cursor-not-allowed'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    )}
                  >
                    {isConverting ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <ArrowRight size={11} />
                    )}
                    {isConverting ? 'Converting…' : 'Convert to Lead'}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDismiss(req)}
                    disabled={isConverting || isDismissing}
                    className="flex items-center gap-1 px-2 py-1.5 rounded text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
                  >
                    {isDismissing ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <X size={11} />
                    )}
                    Dismiss
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default PortalInbox
