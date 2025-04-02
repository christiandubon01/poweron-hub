// @ts-nocheck
/**
 * SixMonthForecastChart — 6-Month Cost vs Pipeline Forecast
 * Shows monthly burn rate (from logs) vs pipeline value (active + coming projects).
 * If pipeline is sparse: renders current burn rate as dashed baseline with note.
 */
import React from 'react'
import {
  ResponsiveContainer, ComposedChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine
} from 'recharts'
import { num, getProjectFinancials, type BackupData } from '@/services/backupDataService'

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1)
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

export default function SixMonthForecastChart({ backup }: { backup: BackupData }) {
  const projects = backup.projects || []
  const logs = backup.logs || []
  const opCost = num(backup.settings?.opCost || 42.45)
  const mileRate = num(backup.settings?.mileRate || 0.66)

  const now = new Date()

  // ── Compute last 3-month average burn rate from logs (as baseline) ──
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1)
  const recentLogs = logs.filter((l: any) => {
    const d = l.date || l.logDate || ''
    return d >= threeMonthsAgo.toISOString().substring(0, 10)
  })
  const recentCost = recentLogs.reduce((s: number, l: any) => {
    return s + num(l.hrs) * opCost + num(l.mat) + num(l.miles || 0) * mileRate
  }, 0)
  const avgMonthlyBurn = recentCost / 3

  // ── Compute pipeline value per month (from projects with quoted amounts) ──
  // Active projects: remaining balance = contract - paid
  // Coming projects: full contract value
  const activePipelineTotal = projects
    .filter((p: any) => p.status === 'active')
    .reduce((s: number, p: any) => {
      const fin = getProjectFinancials(p, backup)
      return s + Math.max(0, fin.contract - fin.paid)
    }, 0)

  const comingPipelineTotal = projects
    .filter((p: any) => p.status === 'coming')
    .reduce((s: number, p: any) => s + num(p.contract), 0)

  const totalPipeline = activePipelineTotal + comingPipelineTotal

  // Distribute pipeline evenly across 6 months (simplified; weight toward near-term)
  // Month 1-2: 35%, Month 3-4: 40%, Month 5-6: 25%
  const pipelineWeights = [0.18, 0.17, 0.21, 0.19, 0.14, 0.11]

  // ── Build 6 monthly forecast buckets ──
  const months = Array.from({ length: 6 }, (_, i) => {
    const ms = addMonths(startOfMonth(now), i)
    const isPast = ms < startOfMonth(now)
    return {
      label: monthLabel(ms),
      monthStart: ms,
      isCurrent: i === 0,
      pipeline: totalPipeline * pipelineWeights[i],
      burn: avgMonthlyBurn,
      // Actual collected if historical (current month)
      actual: 0,
    }
  })

  // Fill in actual collected for current and past month from logs
  months.forEach(bucket => {
    const msStr = bucket.monthStart.toISOString().substring(0, 7) // "YYYY-MM"
    const collected = logs.reduce((s: number, l: any) => {
      const d = (l.date || l.logDate || '').substring(0, 7)
      return d === msStr ? s + num(l.collected) : s
    }, 0)
    bucket.actual = collected
  })

  const isSparse = totalPipeline < 1000
  const hasBurn = avgMonthlyBurn > 0

  if (!hasBurn && isSparse) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
        <span className="text-gray-500 text-sm">No pipeline or cost data yet.</span>
        <span className="text-gray-600 text-xs">Add projects with contract values and log field work to activate this chart.</span>
      </div>
    )
  }

  const fmtK = (v: number) => v >= 1000000 ? `$${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${Math.round(v)}`

  return (
    <div className="relative w-full h-full">
      {isSparse && hasBurn && (
        <div className="absolute top-0 right-2 z-10 bg-blue-900/40 border border-blue-700/60 rounded px-2 py-1 text-[10px] text-blue-300">
          Pipeline sparse — showing burn rate baseline. Add active/coming projects to improve forecast.
        </div>
      )}
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={months} margin={{ top: 32, right: 20, bottom: 5, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 10 }} />
          <YAxis tickFormatter={fmtK} tick={{ fill: '#9ca3af', fontSize: 11 }} width={60} />
          <Tooltip
            contentStyle={{ backgroundColor: '#0f1117', border: '1px solid #374151', borderRadius: 8 }}
            formatter={(v: number, name: string) => [`$${v.toLocaleString()}`, name]}
          />
          <Legend wrapperStyle={{ color: '#d1d5db', fontSize: 12 }} />
          {/* Pipeline value bars */}
          {!isSparse && (
            <Bar dataKey="pipeline" name="Pipeline Value" fill="#3b82f6" opacity={0.75} radius={[3, 3, 0, 0]} />
          )}
          {/* Actual collected (current month only) */}
          <Bar dataKey="actual" name="Actual Collected" fill="#10b981" opacity={0.85} radius={[3, 3, 0, 0]} />
          {/* Burn rate line */}
          <Line
            type="monotone"
            dataKey="burn"
            name="Monthly Burn Rate"
            stroke="#ef4444"
            strokeWidth={2}
            strokeDasharray={isSparse ? '6 3' : undefined}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
