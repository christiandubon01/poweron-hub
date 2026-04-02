// @ts-nocheck
/**
 * LaborTrendChart — Labor Cost vs Revenue 12-Week Trend
 * Shows weekly labor cost (hrs × opCost) vs weekly revenue collected over rolling 12 weeks.
 * If opCost is 0, shows hours on secondary axis with inline note.
 */
import React from 'react'
import {
  ResponsiveContainer, ComposedChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend
} from 'recharts'
import { num, type BackupData } from '@/services/backupDataService'

function startOfWeek(d: Date): Date {
  const out = new Date(d)
  const day = out.getDay()
  const diff = day === 0 ? -6 : 1 - day // Monday
  out.setDate(out.getDate() + diff)
  out.setHours(0, 0, 0, 0)
  return out
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000)
}

function weekLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function LaborTrendChart({ backup }: { backup: BackupData }) {
  const logs = backup.logs || []
  const opCost = num(backup.settings?.opCost || 0)
  const billRate = num(backup.settings?.billRate || 0)
  // Use opCost (internal operating cost rate) or fall back to billRate / 1.5
  const laborRate = opCost > 0 ? opCost : billRate > 0 ? billRate / 1.5 : 0

  // Build 12-week buckets starting 11 weeks ago
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const weekStart = startOfWeek(now)

  const buckets = Array.from({ length: 12 }, (_, w) => {
    const ws = addDays(weekStart, (w - 11) * 7)
    const we = addDays(ws, 6)
    return { weekStart: ws, weekEnd: we, label: weekLabel(ws), hrs: 0, laborCost: 0, revenue: 0 }
  })

  for (const log of logs) {
    const raw = log.date || log.logDate || ''
    if (!raw) continue
    const logDate = new Date(raw + 'T00:00:00')
    if (isNaN(logDate.getTime())) continue
    const hrs = num(log.hrs)
    const collected = num(log.collected)
    for (const bucket of buckets) {
      if (logDate >= bucket.weekStart && logDate <= bucket.weekEnd) {
        bucket.hrs += hrs
        bucket.laborCost += hrs * laborRate
        bucket.revenue += collected
        break
      }
    }
  }

  // Check if we have any real data
  const totalHrs = buckets.reduce((s, b) => s + b.hrs, 0)
  const totalRevenue = buckets.reduce((s, b) => s + b.revenue, 0)

  if (totalHrs === 0 && totalRevenue === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
        <span className="text-gray-500 text-sm">No field hours logged yet.</span>
        <span className="text-gray-600 text-xs">Log labor hours in Field Log to activate this chart.</span>
      </div>
    )
  }

  const showHoursAxis = laborRate === 0 && totalHrs > 0
  const chartData = buckets.map(b => ({
    name: b.label,
    ...(showHoursAxis ? { hours: b.hrs } : { laborCost: b.laborCost }),
    revenue: b.revenue,
  }))

  const fmtK = (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${Math.round(v)}`

  return (
    <div className="relative w-full h-full">
      {showHoursAxis && (
        <div className="absolute top-0 right-2 z-10 bg-amber-900/40 border border-amber-700/60 rounded px-2 py-1 text-[10px] text-amber-300">
          Cost rate not set — showing hours. Set Labor Rate in Settings to activate cost view.
        </div>
      )}
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 30, right: 20, bottom: 5, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 9 }} angle={-25} textAnchor="end" height={40} />
          {showHoursAxis ? (
            <YAxis yAxisId="hours" tickFormatter={(v) => `${v}h`} tick={{ fill: '#f59e0b', fontSize: 11 }} width={44} />
          ) : (
            <YAxis yAxisId="cost" tickFormatter={fmtK} tick={{ fill: '#ef4444', fontSize: 11 }} width={56} />
          )}
          <YAxis yAxisId="rev" orientation="right" tickFormatter={fmtK} tick={{ fill: '#10b981', fontSize: 11 }} width={56} />
          <Tooltip
            contentStyle={{ backgroundColor: '#0f1117', border: '1px solid #374151', borderRadius: 8 }}
            formatter={(v: number, name: string) => {
              if (name === 'hours') return [`${v.toFixed(1)}h`, 'Labor Hours']
              return [`$${v.toLocaleString()}`, name === 'laborCost' ? 'Labor Cost' : 'Revenue Collected']
            }}
          />
          <Legend wrapperStyle={{ color: '#d1d5db', fontSize: 12 }} />
          {showHoursAxis ? (
            <Bar yAxisId="hours" dataKey="hours" name="Labor Hours" fill="#f59e0b" opacity={0.8} radius={[3, 3, 0, 0]} />
          ) : (
            <Bar yAxisId="cost" dataKey="laborCost" name="Labor Cost" fill="#ef4444" opacity={0.75} radius={[3, 3, 0, 0]} />
          )}
          <Line yAxisId="rev" type="monotone" dataKey="revenue" name="Revenue Collected" stroke="#10b981" strokeWidth={3} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
