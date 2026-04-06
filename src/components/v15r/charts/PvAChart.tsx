// @ts-nocheck
import React from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import { num, type BackupData } from '@/services/backupDataService'

const projectColors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']

export default function PvAChart({ projects, backup }: { projects: any[]; backup: BackupData }) {
  if (!projects.length) return <div className="flex items-center justify-center h-full text-gray-500 text-sm">No projects</div>

  const logs = backup.logs || []

  // Build a unified timeline from all project dates
  const allDates = new Set<string>()
  projects.forEach(p => {
    if (p.plannedStart) allDates.add(p.plannedStart)
    if (p.plannedEnd) allDates.add(p.plannedEnd)
    logs.filter((l: any) => l.projectId === p.id && l.date).forEach((l: any) => allDates.add(l.date))
  })
  const sortedDates = [...allDates].sort()

  if (!sortedDates.length) return <div className="flex items-center justify-center h-full text-gray-500 text-sm">No timeline data</div>

  // Build chart data: one row per date, columns per project (planned + actual)
  const chartData = sortedDates.map(date => {
    const row: any = {
      name: new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    }
    projects.forEach((p, i) => {
      const contract = num(p.contract)
      // Planned: constant at contract value between start and end
      if (p.plannedStart && p.plannedEnd && date >= p.plannedStart && date <= p.plannedEnd) {
        row[`p${i}_planned`] = contract
      }
      // Actual: cumulative collected up to this date
      const cumCollected = logs
        .filter((l: any) => l.projectId === p.id && l.date && l.date <= date)
        .reduce((s: number, l: any) => s + num(l.collected), 0)
      if (cumCollected > 0) {
        row[`p${i}_actual`] = cumCollected
      }
    })
    return row
  })

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 10 }} interval="preserveStartEnd" />
        <YAxis tickFormatter={(v) => {
          const abs = Math.abs(v)
          return abs >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`
        }} tick={{ fill: '#9ca3af', fontSize: 11 }} />
        <Tooltip
          contentStyle={{ backgroundColor: '#0f1117', border: '1px solid #374151', borderRadius: 8 }}
          formatter={(v: number, name: string) => [`$${v.toLocaleString()}`, name]}
        />
        <Legend wrapperStyle={{ color: '#d1d5db', fontSize: 11 }} />
        {projects.map((p, i) => (
          <React.Fragment key={p.id}>
            <Line
              type="stepAfter"
              dataKey={`p${i}_planned`}
              name={`${(p.name || 'Project').substring(0, 15)} (Planned)`}
              stroke={projectColors[i % projectColors.length]}
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={false}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey={`p${i}_actual`}
              name={`${(p.name || 'Project').substring(0, 15)} (Actual)`}
              stroke={projectColors[i % projectColors.length]}
              strokeWidth={2}
              dot={{ r: 2 }}
              connectNulls={false}
            />
          </React.Fragment>
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
