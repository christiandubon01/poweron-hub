// @ts-nocheck
import React from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceArea } from 'recharts'
import { getProjectFinancials, num, projectLogsFor, type BackupData } from '@/services/backupDataService'
import { internalLaborRate } from '../employeeCostUtils'

export default function RCAChart({ projects, backup, dateStart, dateEnd }: { projects: any[]; backup: BackupData; dateStart?: string; dateEnd?: string }) {
  if (!projects.length) return <div className="flex items-center justify-center h-full text-gray-500 text-sm">No projects</div>

  const mileRate = num(backup.settings?.mileRate || 0.66)
  // COST-TRUTH-3: internal labor cost authority is settings.opCost. billRate is a
  // separate customer-billing authority and is never substituted, and there is no
  // invented fallback rate — when opCost is unset the labor / break-even series
  // carries no labor and the chart says so (LaborTrendChart / COST-1.5A policy).
  const opCost = internalLaborRate(backup.settings)
  const opCostMissing = opCost <= 0

  const inRange = (d: string) => {
    if (!d) return true
    if (dateStart && d < dateStart) return false
    if (dateEnd && d > dateEnd) return false
    return true
  }

  // Single project mode: daily data; multi project mode: per-project aggregates
  const isSingle = projects.length === 1

  const chartData = isSingle
    ? (() => {
        const p = projects[0]
        const pLogs = projectLogsFor(backup, p.id).filter((l: any) => inRange(l.date)).sort((a: any, b: any) => (a.date || '').localeCompare(b.date || ''))
        let cumCollected = 0, cumLabor = 0, cumMat = 0, cumMile = 0
        return pLogs.map((l: any) => {
          cumCollected += num(l.paymentsCollected || l.collected || 0)
          cumLabor += num(l.hrs) * opCost
          cumMat += num(l.mat)
          cumMile += num(l.miles || 0) * mileRate
          return {
            name: l.date ? new Date(l.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '?',
            collected: cumCollected,
            labor: cumLabor,
            material: cumMat,
            mileage: cumMile,
            breakeven: cumLabor + cumMat + cumMile,
          }
        })
      })()
    : projects.map(p => {
        const fin = getProjectFinancials(p, backup)
        const pLogs = projectLogsFor(backup, p.id).filter((l: any) => inRange(l.date))
        const totalHrs = pLogs.reduce((s: number, l: any) => s + num(l.hrs), 0)
        const totalMat = pLogs.reduce((s: number, l: any) => s + num(l.mat), 0)
        const totalMiles = pLogs.reduce((s: number, l: any) => s + num(l.miles || 0), 0)
        return {
          name: (p.name || 'Unknown').substring(0, 15),
          collected: fin.paid,
          labor: totalHrs * opCost,
          material: totalMat,
          mileage: totalMiles * mileRate,
          breakeven: totalHrs * opCost + totalMat + totalMiles * mileRate,
        }
      })

  const maxBE = Math.max(...chartData.map(d => d.breakeven), 1)

  return (
    <>
      {opCostMissing && (
        <div className="px-2 pb-1 text-[10px] text-amber-400">
          ⚠ Internal cost rate (Settings → operating cost) not set — labor and break-even exclude labor cost.
        </div>
      )}
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <ReferenceArea y1={0} y2={maxBE * 0.7} fill="rgba(239,68,68,0.04)" />
        <ReferenceArea y1={maxBE * 0.7} y2={maxBE} fill="rgba(245,158,11,0.04)" />
        <ReferenceArea y1={maxBE} y2={maxBE * 2} fill="rgba(16,185,129,0.04)" />
        <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 10 }} />
        <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fill: '#9ca3af', fontSize: 11 }} />
        <Tooltip
          contentStyle={{ backgroundColor: '#0f1117', border: '1px solid #374151', borderRadius: 8 }}
          formatter={(v: number, name: string) => [`$${v.toLocaleString()}`, name]}
        />
        <Legend wrapperStyle={{ color: '#d1d5db', fontSize: 12 }} />
        <Line type="monotone" dataKey="collected" name="Collected Revenue" stroke="#10b981" strokeWidth={3} dot={{ r: 3 }} />
        <Line type="monotone" dataKey="labor" name="Labor Cost" stroke="#ef4444" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="material" name="Material Cost" stroke="#f59e0b" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="mileage" name="Mileage Cost" stroke="#8b5cf6" strokeWidth={2} strokeDasharray="4 4" dot={false} />
        <Line type="monotone" dataKey="breakeven" name="Break-even" stroke="#6b7280" strokeWidth={2} strokeDasharray="8 4" dot={false} />
      </LineChart>
    </ResponsiveContainer>
    </>
  )
}
