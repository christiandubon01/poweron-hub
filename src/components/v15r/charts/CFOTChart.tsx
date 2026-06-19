// @ts-nocheck
import React from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ReferenceArea } from 'recharts'
import { num, type BackupData } from '@/services/backupDataService'

const fmtDollar = (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`

export default function CFOTChart({ data, backup }: { data: any[]; backup: BackupData }) {
  if (!data.length) return <div className="flex items-center justify-center h-full text-gray-500 text-sm">No weekly data</div>

  const chartData = data.map(d => {
    const label = (() => {
      if (!d.start) return `Wk ${d.wk ?? '?'}`
      const dt = new Date(d.start + 'T00:00:00')
      return isNaN(dt.getTime()) ? `Wk ${d.wk ?? '?'}` : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    })()
    const isProjection = !!d.isProjection
    const nv = (v: any) => (v === null || v === undefined ? null : num(v))
    return {
      name: label,
      isProjection,
      exposure: isProjection ? null : nv(d.totalExposure),
      activeExposure: isProjection ? null : nv(d.activeExposure),
      // Projected Total Exposure spans the Now boundary into the gray future area.
      projectedTotalExposure: nv(d.projectedTotalExposure),
      serviceExposure: isProjection ? null : nv(d.serviceExposure),
      pending: nv(d.pendingInv),
      svcPay: nv(d.svc),
      projPay: nv(d.proj),
      accum: nv(d.accum),
    }
  })

  const firstProjectionIdx = chartData.findIndex(d => d.isProjection)
  const currentWeekLabel = firstProjectionIdx > 0 ? chartData[firstProjectionIdx - 1].name : null
  const projectionStartLabel = firstProjectionIdx >= 0 ? chartData[firstProjectionIdx].name : null
  const projectionEndLabel = chartData[chartData.length - 1]?.name

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 10 }} interval={4} />
        <YAxis tickFormatter={fmtDollar} tick={{ fill: '#9ca3af', fontSize: 11 }} />
        <Tooltip
          contentStyle={{ backgroundColor: '#0f1117', border: '1px solid #374151', borderRadius: 8 }}
          labelStyle={{ color: '#fff', fontWeight: 'bold' }}
          itemStyle={{ color: '#d1d5db' }}
          formatter={(v: number, name: string) => [v === null || v === undefined ? '—' : `$${v.toLocaleString()}`, name]}
        />
        <Legend wrapperStyle={{ color: '#d1d5db', fontSize: 12 }} />

        {projectionStartLabel && projectionEndLabel && (
          <ReferenceArea x1={projectionStartLabel} x2={projectionEndLabel} fill="rgba(255,255,255,0.025)" stroke="none" />
        )}

        {currentWeekLabel && (
          <ReferenceLine
            x={currentWeekLabel}
            stroke="#9ca3af"
            strokeDasharray="5 4"
            label={{ value: 'Now', position: 'insideTopRight', fill: '#9ca3af', fontSize: 10 }}
          />
        )}

        <Line type="monotone" dataKey="exposure" name="Projects Total Exposure" stroke="#dc2626" strokeWidth={3} dot={false} connectNulls={false} />
        <Line type="monotone" dataKey="activeExposure" name="Active Exposure" stroke="#fb923c" strokeWidth={2.5} dot={false} connectNulls={false} />
        <Line type="monotone" dataKey="projectedTotalExposure" name="Projected Total Exposure" stroke="#fdba74" strokeWidth={2} strokeDasharray="6 4" strokeOpacity={0.85} dot={false} connectNulls={false} />
        <Line type="monotone" dataKey="serviceExposure" name="Service Calls Exposure" stroke="#fca5a5" strokeWidth={2} dot={false} connectNulls={false} />
        <Line type="monotone" dataKey="pending" name="Pending Invoice" stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls={false} />
        <Line type="monotone" dataKey="svcPay" name="Service Payment" stroke="#86efac" strokeWidth={2} dot={false} connectNulls={false} />
        <Line type="monotone" dataKey="projPay" name="Project Payment" stroke="#16a34a" strokeWidth={2} dot={false} connectNulls={false} />
        <Line type="monotone" dataKey="accum" name="Accumulative Income" stroke="#14532d" strokeWidth={3} dot={false} connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
