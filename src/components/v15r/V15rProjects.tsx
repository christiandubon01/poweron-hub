// @ts-nocheck
/**
 * V15rProjects — Project cards matching v15r layout
 *
 * Features:
 * - POS-001 bucket IDs
 * - Contract / Billed / Collected / Profit
 * - Phase progress bars (Planning, Estimating, Site Prep, Rough-in, Trim, Finish)
 * - Type colors: New Construction=blue, Commercial TI/Commercial=yellow, Service=green, Solar=orange
 * - Expandable cards with field logs, phase checklist
 * - Status badges: Upcoming, Active, Completed, Inactive
 * - Filter by type / status
 */

import { useState, useMemo } from 'react'
import { ChevronDown, ChevronUp, Filter, Zap } from 'lucide-react'
import { getBackupData, type BackupData, type BackupProject, type BackupLog } from '@/services/backupDataService'
import ImportBackupButton from '@/components/ImportBackupButton'

const TYPE_COLORS: Record<string, string> = {
  'New Construction': 'border-l-blue-500',
  'Commercial TI': 'border-l-yellow-500',
  'Commercial': 'border-l-yellow-500',
  'Service': 'border-l-emerald-500',
  'Solar': 'border-l-orange-500',
}
const TYPE_BG: Record<string, string> = {
  'New Construction': 'bg-blue-500/10',
  'Commercial TI': 'bg-yellow-500/10',
  'Commercial': 'bg-yellow-500/10',
  'Service': 'bg-emerald-500/10',
  'Solar': 'bg-orange-500/10',
}
const TYPE_BADGE: Record<string, string> = {
  'New Construction': 'bg-blue-500/20 text-blue-400',
  'Commercial TI': 'bg-yellow-500/20 text-yellow-400',
  'Commercial': 'bg-yellow-500/20 text-yellow-400',
  'Service': 'bg-emerald-500/20 text-emerald-400',
  'Solar': 'bg-orange-500/20 text-orange-400',
}
const STATUS_LABEL: Record<string, string> = {
  coming: 'Upcoming',
  active: 'Active',
  completed: 'Completed',
  inactive: 'Inactive',
}
const STATUS_COLOR: Record<string, string> = {
  coming: 'bg-cyan-500/20 text-cyan-400',
  active: 'bg-emerald-500/20 text-emerald-400',
  completed: 'bg-gray-500/20 text-gray-400',
  inactive: 'bg-red-500/20 text-red-400',
}

const PHASE_ORDER = ['Planning', 'Estimating', 'Site Prep', 'Rough-in', 'Trim', 'Finish']

export default function V15rProjects() {
  const backup = getBackupData()
  if (!backup) return <NoData />

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [filterType, setFilterType] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')

  const types = useMemo(() => {
    const t = new Set((backup.projects || []).map(p => p.type).filter(Boolean))
    return ['all', ...Array.from(t)]
  }, [backup])

  const statuses = useMemo(() => {
    const s = new Set((backup.projects || []).map(p => p.status).filter(Boolean))
    return ['all', ...Array.from(s)]
  }, [backup])

  const filtered = useMemo(() => {
    return (backup.projects || []).filter(p => {
      if (filterType !== 'all' && p.type !== filterType) return false
      if (filterStatus !== 'all' && p.status !== filterStatus) return false
      return true
    })
  }, [backup, filterType, filterStatus])

  const toggle = (id: string) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }))

  // Get logs for a project
  const getProjectLogs = (projId: string): BackupLog[] => {
    return (backup.logs || []).filter(l => l.projId === projId)
  }

  return (
    <div className="space-y-6 p-5 min-h-screen">
      <ImportBackupButton />

      {/* Header + Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-gray-200 uppercase tracking-wider">
          Projects ({filtered.length})
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
              <option key={s} value={s}>{s === 'all' ? 'All Statuses' : STATUS_LABEL[s] || s}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Project Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {(filtered || []).map(p => {
          const isExpanded = expanded[p.id] || false
          const logs = getProjectLogs(p.id)
          const phases = (p.phases || {})
          const totalPct = PHASE_ORDER.length > 0
            ? PHASE_ORDER.reduce((s, ph) => s + ((phases || {})[ph] || 0), 0) / PHASE_ORDER.length
            : 0
          const profit = (logs || []).length > 0 ? (logs || [])[(logs || []).length - 1].profit : 0
          const totalHrs = (logs || []).reduce((s, l) => s + (l.hrs || 0), 0)
          const totalMat = (logs || []).reduce((s, l) => s + (l.mat || 0), 0)

          return (
            <div
              key={p.id}
              className={`rounded-xl border border-gray-700 border-l-4 ${TYPE_COLORS[p.type] || 'border-l-gray-600'} ${TYPE_BG[p.type] || 'bg-gray-800/30'} overflow-hidden`}
            >
              {/* Card Header */}
              <div className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono font-bold text-gray-500 tracking-wider">
                      {p.projectCode || p.id.toUpperCase()}
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${TYPE_BADGE[p.type] || 'bg-gray-600/20 text-gray-400'}`}>
                      {p.type}
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${STATUS_COLOR[p.status] || 'bg-gray-600/20 text-gray-400'}`}>
                      {STATUS_LABEL[p.status] || p.status}
                    </span>
                  </div>
                  <button
                    onClick={() => toggle(p.id)}
                    className="text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                </div>

                <h3 className="text-sm font-bold text-gray-100 mb-3">{p.name}</h3>

                {/* Financial Row */}
                <div className="grid grid-cols-4 gap-2 text-center text-[10px] mb-3">
                  <div>
                    <div className="text-gray-500">Contract</div>
                    <div className="font-bold text-gray-200 font-mono">{fmt(p.contract)}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Billed</div>
                    <div className="font-bold text-cyan-400 font-mono">{fmt(p.billed)}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Collected</div>
                    <div className="font-bold text-emerald-400 font-mono">{fmt(p.paid)}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Profit</div>
                    <div className={`font-bold font-mono ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(profit)}</div>
                  </div>
                </div>

                {/* Overall Progress */}
                <div className="w-full bg-gray-700 rounded-full h-1.5 mb-1">
                  <div
                    className="h-1.5 rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${Math.min(totalPct, 100)}%` }}
                  />
                </div>
                <div className="text-[10px] text-gray-500 text-right">{totalPct.toFixed(0)}% complete</div>
              </div>

              {/* Expanded Detail */}
              {isExpanded && (
                <div className="border-t border-gray-700 bg-gray-900/40 p-4 space-y-4">
                  {/* Phase Checklist */}
                  <div>
                    <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Phase Progress</h4>
                    <div className="space-y-2">
                      {(PHASE_ORDER || []).map(phase => {
                        const pct = (phases || {})[phase] || 0
                        return (
                          <div key={phase} className="flex items-center gap-3">
                            <span className="text-[10px] text-gray-400 w-20 flex-shrink-0">{phase}</span>
                            <div className="flex-1 bg-gray-700 rounded-full h-1.5">
                              <div
                                className={`h-1.5 rounded-full transition-all ${pct >= 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-cyan-500' : 'bg-gray-600'}`}
                                style={{ width: `${Math.min(pct, 100)}%` }}
                              />
                            </div>
                            <span className="text-[10px] font-mono text-gray-500 w-10 text-right">{pct}%</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="rounded-lg bg-gray-800/60 p-2">
                      <div className="text-[10px] text-gray-500">Hours</div>
                      <div className="text-sm font-bold text-gray-200 font-mono">{totalHrs.toFixed(1)}</div>
                    </div>
                    <div className="rounded-lg bg-gray-800/60 p-2">
                      <div className="text-[10px] text-gray-500">Materials</div>
                      <div className="text-sm font-bold text-orange-400 font-mono">{fmt(totalMat)}</div>
                    </div>
                    <div className="rounded-lg bg-gray-800/60 p-2">
                      <div className="text-[10px] text-gray-500">Field Logs</div>
                      <div className="text-sm font-bold text-gray-200 font-mono">{logs.length}</div>
                    </div>
                  </div>

                  {/* Recent Logs */}
                  {(logs || []).length > 0 && (
                    <div>
                      <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                        Recent Field Logs ({(logs || []).length})
                      </h4>
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {((logs || []).slice(-5) || []).reverse().map(l => (
                          <div key={l.id} className="flex items-center gap-3 text-[10px] py-1 border-b border-gray-800">
                            <span className="text-gray-500 w-20">{l.date}</span>
                            <span className="text-gray-300 w-16">{l.emp}</span>
                            <span className="text-gray-400 w-12">{l.hrs}h</span>
                            <span className="text-gray-400 w-12">{l.miles}mi</span>
                            <span className="text-orange-400 font-mono w-14">{fmt(l.mat)}</span>
                            <span className="text-gray-500 truncate flex-1">{l.phase}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Mile RT */}
                  {p.mileRT > 0 && (
                    <div className="text-[10px] text-gray-500">
                      Round-trip mileage: <span className="text-gray-300 font-mono">{p.mileRT} mi</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="text-[10px] text-gray-600 flex items-center gap-1">
        <Zap size={10} /> NEXUS AI can analyze project trends — ask in the chat panel
      </div>
    </div>
  )
}

function NoData() {
  return (
    <div className="p-6 space-y-4">
      <ImportBackupButton />
      <div className="text-center text-gray-500 py-20">
        <p className="text-lg font-semibold mb-2">No project data</p>
        <p className="text-sm">Import your v15r backup file to see your projects</p>
      </div>
    </div>
  )
}

function fmt(n: number): string {
  if (!n && n !== 0) return '$0'
  if (Math.abs(n) >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return '$' + n.toFixed(0)
}
