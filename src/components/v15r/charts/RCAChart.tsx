// @ts-nocheck
import React, { useState, useCallback } from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceArea, Brush } from 'recharts'
import { getProjectFinancials, num, type BackupData } from '@/services/backupDataService'

const fmtK = (v: number) => v >= 1000000 ? `$${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${Math.round(v)}`

export default function RCAChart({ projects, backup, dateStart, dateEnd }: { projects: any[]; backup: BackupData; dateStart?: string; dateEnd?: string }) {
  if (!projects.length) return <div className="flex items-center justify-center h-full text-gray-500 text-sm">No projects</div>

  const mileRate = num(backup.settings?.mileRate || 0.66)
  const opCost = num(backup.settings?.opCost || 42.45)
  const logs = backup.logs || []

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
        // FIX: field is projId, not projectId — support both
        const pLogs = logs.filter((l: any) => (l.projId || l.projectId || '') === p.id && inRange(l.date))
          .sort((a: any, b: any) => (a.date || '').localeCompare(b.date || ''))
        let cumCollected = 0, cumLabor = 0, cumMat = 0, cumMile = 0
        return pLogs.map((l: any) => {
          cumCollected += num(l.collected)
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
        // FIX: field is projId, not projectId — support both
        const pLogs = logs.filter((l: any) => (l.projId || l.projectId || '') === p.id && inRange(l.date))
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

  // Scroll-to-zoom state
  const [brushRange, setBrushRange] = useState({ startIndex: 0, endIndex: chartData.length - 1 })

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const { startIndex, endIndex } = brushRange
    const windowSize = endIndex - startIndex
    const delta = e.deltaY > 0 ? 1 : -1
    const newWindowSize = Math.max(2, Math.min(chartData.length, windowSize + delta))
    const mid = Math.round((startIndex + endIndex) / 2)
    const newStart = Math.max(0, mid - Math.floor(newWindowSize / 2))
    const newEnd = Math.min(chartData.length - 1, newStart + newWindowSize)
    setBrushRange({ startIndex: newStart, endIndex: newEnd })
  }, [brushRange, chartData.length])

  const handleDoubleClick = useCallback(() => {
    setBrushRange({ startIndex: 0, endIndex: chartData.length - 1 })
  }, [chartData.length])

  return (
    <div className="relative w-full h-full" onWheel={handleWheel} onDoubleClick={handleDoubleClick} style={{ touchAction: 'none' }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: chartData.length > 4 ? 40 : 5, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <ReferenceArea y1={0} y2={maxBE * 0.7} fill="rgba(239,68,68,0.04)" />
          <ReferenceArea y1={maxBE * 0.7} y2={maxBE} fill="rgba(245,158,11,0.04)" />
          <ReferenceArea y1={maxBE} y2={maxBE * 2} fill="rgba(16,185,129,0.04)" />
          <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 10 }} interval="preserveStartEnd" angle={-25} textAnchor="end" height={40} />
          <YAxis tickFormatter={fmtK} tick={{ fill: '#9ca3af', fontSize: 11 }} width={60} />
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
          {chartData.length > 4 && (
            <Brush
              dataKey="name"
              height={16}
              stroke="#374151"
              fill="#1f2937"
              travellerWidth={5}
              startIndex={brushRange.startIndex}
              endIndex={brushRange.endIndex}
              onChange={(r) => r && r.startIndex !== undefined && setBrushRange({ startIndex: r.startIndex, endIndex: r.endIndex })}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
      {chartData.length > 4 && (
        <div className="absolute bottom-0 right-0 text-[10px] text-gray-600 pr-2 pb-0.5">Scroll to zoom · Double-click to reset</div>
      )}
    </div>
  )
}
