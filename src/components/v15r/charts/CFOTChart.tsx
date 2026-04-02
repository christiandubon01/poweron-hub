// @ts-nocheck
import React, { useState, useCallback, useRef } from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Brush } from 'recharts'
import { num, type BackupData } from '@/services/backupDataService'

const fmtDollar = (v: number) => v >= 1000000 ? `$${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${Math.round(v)}`

export default function CFOTChart({ data, backup }: { data: any[]; backup: BackupData }) {
  if (!data.length) return <div className="flex items-center justify-center h-full text-gray-500 text-sm">No weekly data</div>

  // Build running cumulative sum so accum is always populated
  let runningAccum = 0
  const chartData = data.map(d => {
    const svcPay = num(d.svc || 0)
    const projPay = num(d.proj || 0)
    const storedAccum = num(d.accum || 0)
    // If weeklyData has a stored accum, use it; otherwise build running sum from svc+proj
    if (storedAccum > runningAccum) runningAccum = storedAccum
    else runningAccum += svcPay + projPay

    const label = (() => {
      if (!d.start) return `Wk ${d.wk ?? '?'}`
      const dt = new Date(d.start + 'T00:00:00')
      return isNaN(dt.getTime()) ? `Wk ${d.wk ?? '?'}` : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    })()
    return {
      name: label,
      exposure: num(d.totalExposure || (num(d.unbilled || 0) + num(d.pendingInv || 0) + Math.max(0, svcPay - num(d.svcCollected || 0)))),
      unbilled: num(d.unbilled || 0),
      pending: num(d.pendingInv || 0),
      svcPay,
      projPay,
      accum: storedAccum > 0 ? storedAccum : runningAccum,
    }
  })

  // Zoom state: startIndex/endIndex for Brush
  const [brushRange, setBrushRange] = useState({ startIndex: Math.max(0, chartData.length - 26), endIndex: chartData.length - 1 })
  const containerRef = useRef<HTMLDivElement>(null)

  // Scroll-to-zoom: wheel adjusts brush window
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const { startIndex, endIndex } = brushRange
    const windowSize = endIndex - startIndex
    const delta = e.deltaY > 0 ? 1 : -1
    const newWindowSize = Math.max(4, Math.min(chartData.length, windowSize + delta * 2))
    const midpoint = Math.round((startIndex + endIndex) / 2)
    const newStart = Math.max(0, midpoint - Math.floor(newWindowSize / 2))
    const newEnd = Math.min(chartData.length - 1, newStart + newWindowSize)
    setBrushRange({ startIndex: newEnd - newWindowSize < 0 ? 0 : newStart, endIndex: newEnd })
  }, [brushRange, chartData.length])

  // Double-click resets zoom
  const handleDoubleClick = useCallback(() => {
    setBrushRange({ startIndex: Math.max(0, chartData.length - 26), endIndex: chartData.length - 1 })
  }, [chartData.length])

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full"
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
      style={{ touchAction: 'none' }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 40, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis
            dataKey="name"
            tick={{ fill: '#9ca3af', fontSize: 9 }}
            interval="preserveStartEnd"
            angle={-35}
            textAnchor="end"
            height={50}
          />
          <YAxis tickFormatter={fmtDollar} tick={{ fill: '#9ca3af', fontSize: 11 }} width={62} />
          <Tooltip
            contentStyle={{ backgroundColor: '#0f1117', border: '1px solid #374151', borderRadius: 8 }}
            labelStyle={{ color: '#fff', fontWeight: 'bold' }}
            itemStyle={{ color: '#d1d5db' }}
            formatter={(v: number, name: string) => [`$${v.toLocaleString()}`, name]}
          />
          <Legend wrapperStyle={{ color: '#d1d5db', fontSize: 12 }} />
          <Line type="monotone" dataKey="exposure" name="Total Exposure" stroke="#ef4444" strokeWidth={3} dot={false} />
          <Line type="monotone" dataKey="unbilled" name="Unbilled" stroke="#f87171" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="pending" name="Pending Invoice" stroke="#f59e0b" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="svcPay" name="Service Payment" stroke="#86efac" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="projPay" name="Project Payment" stroke="#16a34a" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="accum" name="Accumulated Income" stroke="#15803d" strokeWidth={3} dot={false} />
          <Brush
            dataKey="name"
            height={20}
            stroke="#374151"
            fill="#1f2937"
            travellerWidth={6}
            startIndex={brushRange.startIndex}
            endIndex={brushRange.endIndex}
            onChange={(range) => {
              if (range && range.startIndex !== undefined && range.endIndex !== undefined) {
                setBrushRange({ startIndex: range.startIndex, endIndex: range.endIndex })
              }
            }}
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="absolute bottom-0 right-0 text-[10px] text-gray-600 pr-2 pb-0.5">Scroll to zoom · Double-click to reset</div>
    </div>
  )
}
