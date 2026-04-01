// @ts-nocheck
import React from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import { type BackupData } from '@/services/backupDataService'

const phaseNames = ['Planning', 'Estimating', 'Site Prep', 'Rough-in', 'Trim', 'Finish']
const phaseColors = ['#6b7280', '#8b5cf6', '#f59e0b', '#3b82f6', '#eab308', '#10b981']
const defaultWeights: any = { Planning: 5, Estimating: 10, 'Site Prep': 15, 'Rough-in': 30, Trim: 25, Finish: 15 }

export default function PCDChart({ projects, backup }: { projects: any[]; backup: BackupData }) {
  if (!projects.length) return <div className="flex items-center justify-center h-full text-gray-500 text-sm">No projects</div>

  const weights = backup.settings?.phaseWeights || defaultWeights

  const chartData = projects.map(p => {
    const phases = p.phases || {}
    const row: any = { name: (p.name || 'Unknown').substring(0, 20) }
    phaseNames.forEach(pn => {
      const completion = phases[pn] || 0
      const weight = (weights as any)[pn] || 0
      row[pn] = weight * (completion / 100)
    })
    return row
  })

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 80 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
        <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 10 }} />
        <YAxis type="category" dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} width={80} />
        <Tooltip contentStyle={{ backgroundColor: '#0f1117', border: '1px solid #374151', borderRadius: 8 }} />
        <Legend wrapperStyle={{ color: '#d1d5db', fontSize: 11 }} />
        {phaseNames.map((pn, i) => (
          <Bar key={pn} dataKey={pn} stackId="phases" fill={phaseColors[i]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
