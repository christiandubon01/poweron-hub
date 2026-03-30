// @ts-nocheck
/**
 * V15rServiceCalls — Service call log matching v15r layout
 *
 * Features:
 * - 11 service log entries from backup
 * - Collections / Actions movement
 * - Status tracking (payStatus)
 * - Client info, job type
 * - Profit, quoted, collected, balance due
 * - Trigger flags at save
 * - Estimate comparison
 */

import { useState, useMemo } from 'react'
import { Filter, AlertTriangle, CheckCircle, Clock, Zap, FileText } from 'lucide-react'
import { getBackupData, type BackupServiceLog } from '@/services/backupDataService'
import ImportBackupButton from '@/components/ImportBackupButton'

// G8: key used to pass pre-fill data to the Estimate tab
const SVC_ESTIMATE_PREFILL_KEY = 'svc_estimate_prefill'

const PAY_STATUS_COLORS: Record<string, string> = {
  paid: 'bg-emerald-500/20 text-emerald-400',
  partial: 'bg-yellow-500/20 text-yellow-400',
  unpaid: 'bg-red-500/20 text-red-400',
  pending: 'bg-cyan-500/20 text-cyan-400',
}

const PAY_STATUS_ICON: Record<string, any> = {
  paid: CheckCircle,
  partial: Clock,
  unpaid: AlertTriangle,
  pending: Clock,
}

export default function V15rServiceCalls() {
  const backup = getBackupData()
  if (!backup) return <NoData />

  const serviceLogs: BackupServiceLog[] = (backup.serviceLogs || [])
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterType, setFilterType] = useState<string>('all')

  const types = useMemo(() => {
    const t = new Set((serviceLogs || []).map(l => l.jtype).filter(Boolean))
    return ['all', ...Array.from(t)]
  }, [serviceLogs])

  const statuses = useMemo(() => {
    const s = new Set((serviceLogs || []).map(l => l.payStatus).filter(Boolean))
    return ['all', ...Array.from(s)]
  }, [serviceLogs])

  const filtered = useMemo(() => {
    return (serviceLogs || []).filter(l => {
      if (filterStatus !== 'all' && l.payStatus !== filterStatus) return false
      if (filterType !== 'all' && l.jtype !== filterType) return false
      return true
    })
  }, [serviceLogs, filterStatus, filterType])

  // Totals
  const totalQuoted = (filtered || []).reduce((s, l) => s + (l.quoted || 0), 0)
  const totalCollected = (filtered || []).reduce((s, l) => s + (l.collected || 0), 0)
  const totalProfit = (filtered || []).reduce((s, l) => s + (l.profit || 0), 0)
  const totalBalance = (filtered || []).reduce((s, l) => s + (l.balanceDue || 0), 0)

  return (
    <div className="space-y-6 p-5 min-h-screen">
      <ImportBackupButton />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-gray-200 uppercase tracking-wider">
          Service Calls ({filtered.length})
        </h2>
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-gray-500" />
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            {types.map(t => (
              <option key={t} value={t}>{t === 'all' ? 'All Types' : t}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            {statuses.map(s => (
              <option key={s} value={s}>{s === 'all' ? 'All Statuses' : s}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI label="Quoted" value={fmt(totalQuoted)} color="text-cyan-400" />
        <KPI label="Collected" value={fmt(totalCollected)} color="text-emerald-400" />
        <KPI label="Profit" value={fmt(totalProfit)} color={totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'} />
        <KPI label="Balance Due" value={fmt(totalBalance)} color={totalBalance > 0 ? 'text-yellow-400' : 'text-gray-400'} />
      </div>

      {/* Service Call Cards */}
      <div className="space-y-3">
        {(filtered || []).map((l, idx) => {
          const StatusIcon = PAY_STATUS_ICON[l.payStatus] || Clock
          const statusColor = PAY_STATUS_COLORS[l.payStatus] || 'bg-gray-500/20 text-gray-400'
          const triggers = (l.triggersAtSave || [])

          return (
            <div key={l.id || idx} className="rounded-xl border border-gray-700 bg-gray-800/40 p-4">
              {/* Top row */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono font-bold text-gray-500">SVC-{String(idx + 1).padStart(3, '0')}</span>
                  <span className="text-[10px] font-semibold text-gray-400">{l.jtype || 'Service'}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold flex items-center gap-1 ${statusColor}`}>
                    <StatusIcon size={10} />
                    {l.payStatus || 'unknown'}
                  </span>
                </div>
                <span className="text-[10px] text-gray-500 font-mono">{l.date}</span>
              </div>

              {/* Customer */}
              {l.customer && (
                <div className="text-xs text-gray-300 mb-2">{l.customer}</div>
              )}

              {/* Financial grid */}
              <div className="grid grid-cols-5 gap-2 text-center text-[10px] mb-2">
                <div>
                  <div className="text-gray-500">Hours</div>
                  <div className="font-bold text-gray-200 font-mono">{l.hrs || 0}</div>
                </div>
                <div>
                  <div className="text-gray-500">Quoted</div>
                  <div className="font-bold text-cyan-400 font-mono">{fmt(l.quoted || 0)}</div>
                </div>
                <div>
                  <div className="text-gray-500">Collected</div>
                  <div className="font-bold text-emerald-400 font-mono">{fmt(l.collected || 0)}</div>
                </div>
                <div>
                  <div className="text-gray-500">Profit</div>
                  <div className={`font-bold font-mono ${(l.profit || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(l.profit || 0)}</div>
                </div>
                <div>
                  <div className="text-gray-500">Balance</div>
                  <div className={`font-bold font-mono ${(l.balanceDue || 0) > 0 ? 'text-yellow-400' : 'text-gray-400'}`}>{fmt(l.balanceDue || 0)}</div>
                </div>
              </div>

              {/* Op Cost + Materials + Miles */}
              <div className="flex items-center gap-4 text-[10px] text-gray-500 mb-2">
                {l.opCost > 0 && <span>Op Cost: <span className="text-orange-400 font-mono">{fmt(l.opCost)}</span></span>}
                {l.mat > 0 && <span>Materials: <span className="text-orange-400 font-mono">{fmt(l.mat)}</span></span>}
                {l.miles > 0 && <span>Miles: <span className="text-gray-300 font-mono">{l.miles}</span></span>}
                {l.store && <span>Store: <span className="text-gray-300">{l.store}</span></span>}
              </div>

              {/* Notes */}
              {l.notes && (
                <div className="text-[10px] text-gray-500 mb-2 italic">{l.notes}</div>
              )}

              {/* Estimate Comparison */}
              {l.estimateComparison && (
                <div className="text-[10px] text-gray-500 mb-2">
                  Est. comparison: <span className="text-gray-300">{l.estimateComparison}</span>
                </div>
              )}

              {/* G8: Convert to Estimate button */}
              <div className="mt-2 pt-2 border-t border-gray-700/50 flex items-center gap-2">
                <button
                  onClick={() => {
                    // Store pre-fill data in localStorage for Estimate tab to pick up
                    const prefill = {
                      customer: l.customer || '',
                      address: l.address || l.addr || '',
                      jtype: l.jtype || 'General Service',
                      notes: l.notes || l.description || '',
                      hrs: l.hrs || '',
                      mat: l.mat || l.materialCost || '',
                      miles: l.miles || l.mileRT || '',
                      date: new Date().toISOString().split('T')[0],
                    }
                    localStorage.setItem(SVC_ESTIMATE_PREFILL_KEY, JSON.stringify(prefill))
                    // Dispatch custom event to trigger navigation to estimate subtab
                    window.dispatchEvent(new CustomEvent('poweron:navigate', { detail: { view: 'estimate', subtab: 'service', prefill: true } }))
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-600/20 text-blue-400 border border-blue-500/30 text-[10px] font-semibold hover:bg-blue-600/30 transition-colors min-h-[36px]"
                >
                  <FileText size={10} /> Convert to Estimate
                </button>
              </div>

              {/* Trigger flags */}
              {(triggers || []).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {(triggers || []).map((t: string, i: number) => (
                    <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {(filtered || []).length === 0 && (
        <div className="text-center text-gray-500 py-10 text-sm">No service calls found.</div>
      )}

      <div className="text-[10px] text-gray-600 flex items-center gap-1">
        <Zap size={10} /> NEXUS AI can identify collection patterns — ask in the chat panel
      </div>
    </div>
  )
}

function KPI({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/40 p-3 text-center">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>
      <div className={`text-lg font-bold font-mono ${color}`}>{value}</div>
    </div>
  )
}

function NoData() {
  return (
    <div className="p-6 space-y-4">
      <ImportBackupButton />
      <div className="text-center text-gray-500 py-20">
        <p className="text-lg font-semibold mb-2">No service call data</p>
        <p className="text-sm">Import your v15r backup file to see your service calls</p>
      </div>
    </div>
  )
}

function fmt(n: number): string {
  if (!n && n !== 0) return '$0'
  if (Math.abs(n) >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return '$' + n.toFixed(0)
}
