// @ts-nocheck
import React from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
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
    return {
      name: label,
      exposure: num(d.totalExposure || (num(d.unbilled || 0) + num(d.pendingInv || 0) + Math.max(0, num(d.svc || 0) - num(d.svcCollected || 0)))),
      unbilled: num(d.unbilled || 0),
      pending: num(d.pendingInv || 0),
      svcPay: num(d.svc || 0),
      projPay: num(d.proj || 0),
      accum: num(d.accum || 0),
    }
  })

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 10 }} interval="preserveStartEnd" />
        <YAxis tickFormatter={fmtDollar} tick={{ fill: '#9ca3af', fontSize: 11 }} />
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
        <Line type="monotone" dataKey="accum" name="Accumulative Income" stroke="#14532d" strokeWidth={3} dot={false} fill="rgba(20,83,45,0.15)" />
      </LineChart>
    </ResponsiveContainer>
  )
}
