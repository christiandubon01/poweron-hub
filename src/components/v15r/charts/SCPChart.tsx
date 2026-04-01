// @ts-nocheck
import React from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import { num, type BackupData } from '@/services/backupDataService'

export default function SCPChart({ serviceLogs, backup }: { serviceLogs: any[]; backup: BackupData }) {
  if (!serviceLogs.length) return <div className="flex items-center justify-center h-full text-gray-500 text-sm">No service data</div>

  const mileRate = num(backup.settings?.mileRate || 0.66)

  const chartData = serviceLogs.slice(-8).map((l: any) => {
    const quoted = num(l.quoted)
    const mat = num(l.materialCost || l.material)
    const miles = num(l.mileage || 0) * mileRate
    return {
      name: (l.customer || 'Unknown').substring(0, 12),
      quoted,
      material: mat,
      profit: Math.max(0, quoted - mat - miles),
    }
  })

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 10 }} />
        <YAxis tickFormatter={(v) => `$${v.toLocaleString()}`} tick={{ fill: '#9ca3af', fontSize: 11 }} />
        <Tooltip
          contentStyle={{ backgroundColor: '#0f1117', border: '1px solid #374151', borderRadius: 8 }}
          formatter={(v: number, name: string) => [`$${v.toLocaleString()}`, name]}
        />
        <Legend wrapperStyle={{ color: '#d1d5db', fontSize: 12 }} />
        <Bar dataKey="quoted" name="Quoted" fill="#3b82f6" radius={[3, 3, 0, 0]} />
        <Bar dataKey="material" name="Material" fill="#f59e0b" radius={[3, 3, 0, 0]} />
        <Bar dataKey="profit" name="Net Profit" fill="#10b981" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
