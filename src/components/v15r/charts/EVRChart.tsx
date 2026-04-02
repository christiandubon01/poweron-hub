// @ts-nocheck
import React from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import { getProjectFinancials, num, type BackupData } from '@/services/backupDataService'

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
    const logs = (backup.logs || []).filter((l: any) => l.projectId === p.id && inRange(l.date))
    const income = dateStart || dateEnd ? logs.reduce((s: number, l: any) => s + num(l.collected), 0) : fin.paid
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

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 10 }} />
        <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fill: '#9ca3af', fontSize: 11 }} />
        <Tooltip
          contentStyle={{ backgroundColor: '#0f1117', border: '1px solid #374151', borderRadius: 8 }}
          formatter={(v: number, name: string) => [`$${v.toLocaleString()}`, name]}
        />
        <Legend wrapperStyle={{ color: '#d1d5db', fontSize: 12 }} />
        <Line type="monotone" dataKey="income" name="Accumulated Income" stroke="#10b981" strokeWidth={2} dot={{ r: 3, fill: '#10b981' }} />
        <Line type="monotone" dataKey="ar" name="Outstanding AR" stroke="#ef4444" strokeWidth={2} dot={{ r: 3, fill: '#ef4444' }} />
        <Line type="monotone" dataKey="pipeline" name="Total Pipeline" stroke="#3b82f6" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3, fill: '#3b82f6' }} />
      </LineChart>
    </ResponsiveContainer>
  )
}
