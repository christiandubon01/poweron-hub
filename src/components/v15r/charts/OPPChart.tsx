// @ts-nocheck
import React from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts'
import { health, type BackupData } from '@/services/backupDataService'

export default function OPPChart({ projects, backup }: { projects: any[]; backup: BackupData }) {
  if (!projects.length) return <div className="flex items-center justify-center h-full text-gray-500 text-sm">No active projects</div>

  const chartData = projects.map(p => ({
    name: (p.name || 'Unknown').substring(0, 20),
    contract: p.contract || 0,
    color: health(p, backup).clr,
  }))

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, bottom: 5, left: 80 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
        <XAxis type="number" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fill: '#9ca3af', fontSize: 10 }} />
        <YAxis type="category" dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} width={80} />
        <Tooltip
          contentStyle={{ backgroundColor: '#0f1117', border: '1px solid #374151', borderRadius: 8 }}
          formatter={(v: number) => [`$${v.toLocaleString()}`, 'Contract']}
        />
        <Bar dataKey="contract" radius={[0, 4, 4, 0]}>
          {chartData.map((d, i) => <Cell key={i} fill={d.color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
