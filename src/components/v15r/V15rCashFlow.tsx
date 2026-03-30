// @ts-nocheck
/**
 * V15rCashFlow — 52-week cash flow tracker matching v15r layout
 *
 * Features:
 * - Week # / Start / Service / Project / Accumulated / Unbilled / Pending / Exposure
 * - Color-coded rows by exposure level
 * - Running totals
 * - 52-week heatmap grid at top
 * - Summary KPIs
 */

import { useMemo } from 'react'
import { Zap } from 'lucide-react'
import { getBackupData, type BackupWeeklyData } from '@/services/backupDataService'
import ImportBackupButton from '@/components/ImportBackupButton'

function weekRowColor(w: BackupWeeklyData): string {
  const exp = w.totalExposure || 0
  if (exp > 10000) return 'bg-red-900/30'
  if (exp > 5000) return 'bg-red-900/15'
  if (exp > 1000) return 'bg-yellow-900/15'
  return ''
}

function weekCellColor(w: BackupWeeklyData): string {
  const exp = w.totalExposure || 0
  const svc = w.svc || 0
  if (exp > 10000) return 'bg-red-900/60 border-red-700'
  if (exp > 5000) return 'bg-red-800/40 border-red-700/50'
  if (exp > 1000) return 'bg-yellow-900/40 border-yellow-700/50'
  if (svc > 500) return 'bg-emerald-900/50 border-emerald-600'
  if (svc > 200) return 'bg-emerald-800/30 border-emerald-700/50'
  if (svc > 0) return 'bg-emerald-900/20 border-emerald-800/30'
  return 'bg-gray-800/30 border-gray-700/30'
}

export default function V15rCashFlow() {
  const backup = getBackupData()
  if (!backup) return <NoData />

  const weeks = (backup.weeklyData || [])
  const nonEmpty = (weeks || []).filter(w => !w._empty)

  // Summary KPIs
  const totalSvc = (nonEmpty || []).reduce((s, w) => s + (w.svc || 0), 0)
  const totalProj = (nonEmpty || []).reduce((s, w) => s + (w.proj || 0), 0)
  const totalAccum = (nonEmpty || []).length > 0 ? ((nonEmpty || [])[(nonEmpty || []).length - 1].accum || 0) : 0
  const totalExposure = (nonEmpty || []).reduce((s, w) => s + (w.totalExposure || 0), 0)
  const totalUnbilled = (nonEmpty || []).reduce((s, w) => s + (w.unbilled || 0), 0)

  return (
    <div className="space-y-6 p-5 min-h-screen">
      <ImportBackupButton />

      <h2 className="text-lg font-bold text-gray-200 uppercase tracking-wider">
        52-Week Cash Flow Tracker
      </h2>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KPI label="Service Revenue" value={fmt(totalSvc)} color="text-emerald-400" />
        <KPI label="Project Revenue" value={fmt(totalProj)} color="text-cyan-400" />
        <KPI label="Accumulated" value={fmt(totalAccum)} color="text-gray-200" />
        <KPI label="Unbilled" value={fmt(totalUnbilled)} color="text-yellow-400" />
        <KPI label="Total Exposure" value={fmt(totalExposure)} color="text-red-400" />
      </div>

      {/* 52-Week Heatmap Grid */}
      <div className="rounded-xl border border-gray-700 bg-gray-800/40 p-4">
        <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3">Weekly Heatmap</h3>
        <div className="grid grid-cols-13 gap-1">
          {(weeks || []).map((w, i) => (
            <div
              key={i}
              className={`rounded p-1.5 border text-center text-[9px] ${weekCellColor(w)} ${w._empty ? 'opacity-30' : ''}`}
              title={`Wk${w.wk}: Svc $${w.svc} | Proj $${w.proj} | Exposure $${(w.totalExposure || 0).toFixed(0)}`}
            >
              <div className="font-bold text-gray-400">W{w.wk}</div>
              {!w._empty && <div className="text-gray-300 font-mono">${w.svc > 0 ? w.svc.toFixed(0) : '—'}</div>}
            </div>
          ))}
        </div>
        <div className="flex gap-4 mt-3 text-[10px] text-gray-500">
          <span><span className="inline-block w-3 h-3 rounded bg-red-900/60 mr-1" />High Exposure (&gt;$10k)</span>
          <span><span className="inline-block w-3 h-3 rounded bg-yellow-900/40 mr-1" />Moderate (&gt;$1k)</span>
          <span><span className="inline-block w-3 h-3 rounded bg-emerald-900/50 mr-1" />Collected</span>
          <span><span className="inline-block w-3 h-3 rounded bg-gray-800/30 mr-1" />Empty</span>
        </div>
      </div>

      {/* Detailed Table */}
      <div className="rounded-xl border border-gray-700 bg-gray-800/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-700 text-gray-500">
                <th className="text-left py-2.5 px-3">Wk</th>
                <th className="text-left py-2.5 px-3">Start</th>
                <th className="text-right py-2.5 px-3">Service $</th>
                <th className="text-right py-2.5 px-3">Project $</th>
                <th className="text-right py-2.5 px-3">Accumulated</th>
                <th className="text-right py-2.5 px-3">Unbilled</th>
                <th className="text-right py-2.5 px-3">Pending Inv</th>
                <th className="text-right py-2.5 px-3">Exposure</th>
              </tr>
            </thead>
            <tbody>
              {(nonEmpty || []).map(w => (
                <tr key={w.wk} className={`border-b border-gray-800 hover:bg-gray-700/20 transition-colors ${weekRowColor(w)}`}>
                  <td className="py-2 px-3 font-mono font-bold text-gray-400">W{w.wk}</td>
                  <td className="py-2 px-3 text-gray-400">{w.start}</td>
                  <td className="py-2 px-3 text-right font-mono text-emerald-400">{fmt(w.svc)}</td>
                  <td className="py-2 px-3 text-right font-mono text-cyan-400">{fmt(w.proj)}</td>
                  <td className="py-2 px-3 text-right font-mono text-gray-300">{fmt(w.accum)}</td>
                  <td className="py-2 px-3 text-right font-mono text-yellow-400">{fmt(w.unbilled)}</td>
                  <td className="py-2 px-3 text-right font-mono text-gray-400">{fmt(w.pendingInv)}</td>
                  <td className={`py-2 px-3 text-right font-mono font-bold ${(w.totalExposure || 0) > 5000 ? 'text-red-400' : (w.totalExposure || 0) > 1000 ? 'text-yellow-400' : 'text-gray-400'}`}>
                    {fmt(w.totalExposure || 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(nonEmpty || []).length === 0 && (
          <div className="text-center text-gray-500 py-10 text-sm">No weekly data recorded yet.</div>
        )}
      </div>

      <div className="text-[10px] text-gray-600 flex items-center gap-1">
        <Zap size={10} /> NEXUS AI can forecast cash flow trends — ask in the chat panel
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
        <p className="text-lg font-semibold mb-2">No cash flow data</p>
        <p className="text-sm">Import your v15r backup file to see your 52-week tracker</p>
      </div>
    </div>
  )
}

function fmt(n: number): string {
  if (!n && n !== 0) return '$0'
  if (Math.abs(n) >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return '$' + n.toFixed(0)
}
