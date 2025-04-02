// @ts-nocheck
import React, { useState, useCallback } from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Brush } from 'recharts'
import { getProjectFinancials, num, type BackupData } from '@/services/backupDataService'

const fmtK = (v: number) => v >= 1000000 ? `$${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${Math.round(v)}`

export default function EVRChart({ projects, backup, dateStart, dateEnd }: { projects: any[]; backup: BackupData; dateStart?: string; dateEnd?: string }) {
  if (!projects.length) return <div className="flex items-center justify-center h-full text-gray-500 text-sm">No projects</div>

  const inRange = (d: string) => {
    if (!d) return true
    if (dateStart && d < dateStart) return false
    if (dateEnd && d > dateEnd) return false
    return true
  }

  let cumIncome = 0, cumAR = 0, cumPipeline = 0
  const chartData = projects.map(p => {
    const fin = getProjectFinancials(p, backup)
    // FIX: logs use projId (not projectId) — support both field names for safety
    const logs = (backup.logs || []).filter((l: any) => (l.projId || l.projectId || '') === p.id && inRange(l.date))
    // When date range active, sum from filtered logs; otherwise use fin.paid + fallback to p.paid
    // fin.paid is loggedPaid + manualPaidAdjustment — falls back to p.paid when no matching logs exist
    const income = dateStart || dateEnd
      ? logs.reduce((s: number, l: any) => s + num(l.collected), 0)
      : Math.max(fin.paid, num(p.paid))
    const ar = Math.max(0, fin.billed - fin.paid)
    cumIncome += income
    cumAR += ar
    cumPipeline += num(p.contract)
    return {
      name: (p.name || 'Unknown').substring(0, 15),
      income: cumIncome,
      ar: cumAR,
      pipeline: cumPipeline,
    }
  })

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
        <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 30, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 10 }} angle={-25} textAnchor="end" height={40} />
          <YAxis tickFormatter={fmtK} tick={{ fill: '#9ca3af', fontSize: 11 }} width={56} />
          <Tooltip
            contentStyle={{ backgroundColor: '#0f1117', border: '1px solid #374151', borderRadius: 8 }}
            formatter={(v: number, name: string) => [`$${v.toLocaleString()}`, name]}
          />
          <Legend wrapperStyle={{ color: '#d1d5db', fontSize: 12 }} />
          <Line type="monotone" dataKey="income" name="Accumulated Income" stroke="#10b981" strokeWidth={3} dot={{ r: 4, fill: '#10b981' }} />
          <Line type="monotone" dataKey="ar" name="Outstanding AR" stroke="#ef4444" strokeWidth={2} dot={{ r: 3, fill: '#ef4444' }} />
          <Line type="monotone" dataKey="pipeline" name="Total Pipeline" stroke="#3b82f6" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3, fill: '#3b82f6' }} />
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
      <div className="absolute bottom-0 right-0 text-[10px] text-gray-600 pr-2 pb-0.5">Scroll to zoom · Double-click to reset</div>
    </div>
  )
}
