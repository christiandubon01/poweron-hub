// @ts-nocheck
import React, { useState, useEffect } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  ResponsiveContainer,
  PieChart,
  Pie,
} from 'recharts'
import { Loader2 } from 'lucide-react'
import {
  getLatestSnapshot,
  getQualityRatings,
  type PerformanceSnapshot,
  type QualityRating,
} from '@/services/employeePerformanceService'
import {
  listOrgTaskAssignments,
  type EmployeeTaskAssignment,
} from '@/services/employeeTaskAssignmentService'
import { getActiveEmployeeProfiles, type AdminEmployeeProfile } from '@/services/adminTimecardService'

// ── Shared constants & helpers ─────────────────────────────────────────────────

const DARK_BG = '#090a0e'
const BORDER = '#1e2128'

const DARK_TOOLTIP = {
  contentStyle: { backgroundColor: '#0d1117', borderColor: '#1e2128', fontSize: 11, borderRadius: 6 },
  labelStyle: { color: '#d1d5db' },
  itemStyle: { color: '#9ca3af' },
  cursor: { fill: 'rgba(255,255,255,0.04)' },
}

function rateColor(rate: number | null): string {
  if (rate === null) return '#6b7280'
  if (rate >= 80) return '#4ade80'
  if (rate >= 60) return '#fbbf24'
  return '#f87171'
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ChartSection({
  title,
  dotColor,
  children,
}: {
  title: string
  dotColor: string
  children: React.ReactNode
}) {
  return (
    <div
      className="rounded-xl border p-4 space-y-3"
      style={{ backgroundColor: DARK_BG, borderColor: BORDER }}
    >
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: dotColor }} />
        <p className="text-sm font-semibold text-gray-300">{title}</p>
      </div>
      {children}
    </div>
  )
}

function EmptyChart({ message = 'No data available' }: { message?: string }) {
  return (
    <div className="flex items-center justify-center" style={{ height: 80 }}>
      <p className="text-xs text-gray-600">{message}</p>
    </div>
  )
}

// ── Donut Chart ────────────────────────────────────────────────────────────────

function DonutChart({
  completed,
  total,
  centerLabel,
}: {
  completed: number
  total: number
  centerLabel?: string
}) {
  const rate = total > 0 ? Math.round((completed / total) * 100) : null
  const color = rateColor(rate)

  const pieData =
    total > 0
      ? [
          { name: 'Completed', value: completed },
          { name: 'Remaining', value: Math.max(0, total - completed) },
        ]
      : [{ name: 'No data', value: 1 }]

  const cellColors = total > 0 ? [color, '#1f2937'] : ['#374151']

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: 160, height: 160 }}>
        <PieChart width={160} height={160}>
          <Pie
            data={pieData}
            cx={80}
            cy={80}
            innerRadius={48}
            outerRadius={68}
            dataKey="value"
            paddingAngle={total > 0 && completed > 0 && completed < total ? 2 : 0}
            startAngle={90}
            endAngle={-270}
          >
            {pieData.map((_, i) => (
              <Cell key={i} fill={cellColors[i]} stroke="none" />
            ))}
          </Pie>
        </PieChart>
        <div
          className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
        >
          <p className="text-xl font-bold" style={{ color }}>
            {rate !== null ? `${rate}%` : '—'}
          </p>
          {centerLabel && (
            <p className="text-[10px] text-gray-500 text-center leading-tight px-2">{centerLabel}</p>
          )}
        </div>
      </div>
      {total > 0 ? (
        <p className="text-xs text-gray-500">
          {completed} / {total} tasks
        </p>
      ) : (
        <p className="text-xs text-gray-600">No tasks assigned</p>
      )}
    </div>
  )
}

// ── Global Hours-Based Gantt (all employees, completed tasks only) ─────────────

export function GlobalHoursGantt() {
  const [loading, setLoading] = useState(true)
  const [assignments, setAssignments] = useState<EmployeeTaskAssignment[]>([])
  const [empMap, setEmpMap] = useState<Record<string, string>>({})

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      const [asgRes, empRes] = await Promise.all([
        listOrgTaskAssignments(),
        getActiveEmployeeProfiles(),
      ])
      if (asgRes.success) setAssignments(asgRes.data)
      if (empRes.success) {
        setEmpMap(Object.fromEntries(empRes.data.map((e) => [e.id, e.display_name])))
      }
      setLoading(false)
    })()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500" style={{ height: 60 }}>
        <Loader2 size={11} className="animate-spin" /> Loading task hours…
      </div>
    )
  }

  const withHours = assignments.filter(
    (a) => a.status === 'completed' && a.hours_spent != null && a.hours_spent > 0,
  )
  const missingCount = assignments.filter(
    (a) => a.status === 'completed' && (a.hours_spent == null || a.hours_spent === 0),
  ).length

  if (withHours.length === 0) {
    return (
      <div className="space-y-1">
        <EmptyChart message="No completed tasks with hours logged yet." />
        {missingCount > 0 && (
          <p className="text-[10px] text-gray-600 text-center">
            {missingCount} completed task{missingCount > 1 ? 's' : ''} — hours not logged yet
          </p>
        )}
      </div>
    )
  }

  const rows = [...withHours]
    .sort((a, b) => (b.hours_spent ?? 0) - (a.hours_spent ?? 0))
    .slice(0, 30)
    .map((a) => {
      const empName = empMap[a.lead_employee_id] ?? 'Employee'
      const rawLabel = `${empName} — ${a.work_package_name ?? ''}`
      const label = rawLabel.length > 24 ? rawLabel.slice(0, 23) + '…' : rawLabel
      return { id: a.id, label, hours: a.hours_spent ?? 0 }
    })

  const maxH = Math.max(...rows.map((r) => r.hours), 1)
  const BAR_H = 20
  const GAP = 6
  const LABEL_W = 165
  const CHART_W = 230
  const HOURS_PAD = 36
  const totalH = rows.length * (BAR_H + GAP)

  const axisPcts = [0, 0.25, 0.5, 0.75, 1]

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <svg
          width={LABEL_W + CHART_W + HOURS_PAD}
          height={totalH + 24}
          style={{ minWidth: LABEL_W + CHART_W + HOURS_PAD }}
        >
          {/* Grid lines + axis labels */}
          {axisPcts.map((pct) => {
            const x = LABEL_W + pct * CHART_W
            const hLabel = (pct * maxH).toFixed(1) + 'h'
            return (
              <g key={pct}>
                <line x1={x} y1={0} x2={x} y2={totalH} stroke="#1e2128" strokeWidth={1} />
                <text
                  x={x}
                  y={totalH + 16}
                  textAnchor="middle"
                  fontSize={9}
                  fill="#4b5563"
                  fontFamily="sans-serif"
                >
                  {hLabel}
                </text>
              </g>
            )
          })}

          {/* Task bars */}
          {rows.map((row, i) => {
            const w = Math.max(4, (row.hours / maxH) * CHART_W)
            const y = i * (BAR_H + GAP)
            return (
              <g key={row.id}>
                <text
                  x={LABEL_W - 5}
                  y={y + BAR_H / 2 + 4}
                  textAnchor="end"
                  fontSize={9}
                  fill="#6b7280"
                  fontFamily="sans-serif"
                >
                  {row.label}
                </text>
                <rect x={LABEL_W} y={y} width={w} height={BAR_H} rx={3} fill="#2dd4bf" opacity={0.7} />
                <text
                  x={LABEL_W + w + 4}
                  y={y + BAR_H / 2 + 4}
                  fontSize={9}
                  fill="#6b7280"
                  fontFamily="sans-serif"
                >
                  {row.hours}h
                </text>
              </g>
            )
          })}
        </svg>
      </div>
      {missingCount > 0 && (
        <p className="text-[10px] text-gray-600">
          {missingCount} completed task{missingCount > 1 ? 's' : ''} excluded — hours not logged yet
        </p>
      )}
    </div>
  )
}

// ── All-Employees Overview Charts ──────────────────────────────────────────────

export function AllEmployeesCharts({ employees }: { employees: AdminEmployeeProfile[] }) {
  const [loading, setLoading] = useState(true)
  const [snapshots, setSnapshots] = useState<Record<string, PerformanceSnapshot | null>>({})
  const [ratings, setRatings] = useState<Record<string, QualityRating[]>>({})

  useEffect(() => {
    if (employees.length === 0) {
      setLoading(false)
      return
    }
    ;(async () => {
      setLoading(true)
      const [snapResults, ratingResults] = await Promise.all([
        Promise.all(
          employees.map((e) =>
            getLatestSnapshot(e.id).then((r) => ({ id: e.id, snap: r.success ? r.data : null })),
          ),
        ),
        Promise.all(
          employees.map((e) =>
            getQualityRatings(e.id).then((r) => ({ id: e.id, list: r.success ? r.data : [] })),
          ),
        ),
      ])
      setSnapshots(Object.fromEntries(snapResults.map(({ id, snap }) => [id, snap])))
      setRatings(Object.fromEntries(ratingResults.map(({ id, list }) => [id, list])))
      setLoading(false)
    })()
  }, [employees])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-xs text-gray-500">
        <Loader2 size={13} className="animate-spin" /> Loading team overview…
      </div>
    )
  }

  if (employees.length === 0) {
    return <p className="text-xs text-gray-600">No active employees found.</p>
  }

  // Hours per employee
  const hoursData = employees.map((e) => ({
    name: e.display_name.split(' ')[0],
    hours: snapshots[e.id] ? +(snapshots[e.id]!.paid_minutes / 60).toFixed(1) : 0,
    hasSnap: !!snapshots[e.id],
  }))

  // Team-wide task totals
  const teamTotals = employees.reduce(
    (acc, e) => {
      const s = snapshots[e.id]
      return {
        assigned: acc.assigned + (s?.tasks_assigned ?? 0),
        completed: acc.completed + (s?.tasks_completed ?? 0),
      }
    },
    { assigned: 0, completed: 0 },
  )

  // Quality averages
  const qualityData = employees.map((e) => {
    const rs = ratings[e.id] ?? []
    const avg = rs.length > 0 ? rs.reduce((sum, r) => sum + r.score, 0) / rs.length : null
    return {
      name: e.display_name.split(' ')[0],
      avg: avg !== null ? +avg.toFixed(2) : 0,
      hasRatings: rs.length > 0,
    }
  })

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Team overview — based on most recent report per employee
      </p>

      {/* Hours Worked per Employee */}
      <ChartSection title="Hours Worked per Employee" dotColor="#60a5fa">
        {hoursData.every((d) => !d.hasSnap) ? (
          <EmptyChart message="No reports generated yet. Generate a report for at least one employee." />
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={hoursData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10, fill: '#6b7280' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#6b7280' }}
                axisLine={false}
                tickLine={false}
                unit="h"
              />
              <Tooltip {...DARK_TOOLTIP} formatter={(v) => [`${v}h`, 'Hours']} />
              <Bar dataKey="hours" radius={[3, 3, 0, 0]} maxBarSize={40}>
                {hoursData.map((d, i) => (
                  <Cell key={i} fill={d.hasSnap ? '#60a5fa' : '#374151'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartSection>

      {/* Team Task Completion Donut */}
      <ChartSection title="Team Task Completion Rate" dotColor="#4ade80">
        {teamTotals.assigned === 0 ? (
          <EmptyChart message="No tasks assigned across the team yet." />
        ) : (
          <div className="flex justify-center py-2">
            <DonutChart
              completed={teamTotals.completed}
              total={teamTotals.assigned}
              centerLabel="Team Rate"
            />
          </div>
        )}
      </ChartSection>

      {/* Quality Rating Average per Employee */}
      <ChartSection title="Quality Rating Average per Employee" dotColor="#fbbf24">
        {qualityData.every((d) => !d.hasRatings) ? (
          <EmptyChart message="No quality ratings recorded yet." />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={qualityData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 10, fill: '#6b7280' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#6b7280' }}
                  axisLine={false}
                  tickLine={false}
                  domain={[0, 5]}
                  ticks={[1, 2, 3, 4, 5]}
                />
                <Tooltip
                  {...DARK_TOOLTIP}
                  formatter={(v, _name, item) =>
                    item.payload.hasRatings ? [`${v} / 5`, 'Avg Rating'] : ['No ratings', '']
                  }
                />
                <Bar dataKey="avg" radius={[3, 3, 0, 0]} maxBarSize={40}>
                  {qualityData.map((d, i) => (
                    <Cell key={i} fill={d.hasRatings ? '#fbbf24' : '#374151'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="text-[10px] text-gray-600">Gray bars = no ratings recorded</p>
          </>
        )}
      </ChartSection>
    </div>
  )
}

// ── Per-Employee Detail Charts ─────────────────────────────────────────────────

export function EmployeeDetailCharts({
  profileId,
  latestSnapshot,
}: {
  profileId: string
  latestSnapshot: PerformanceSnapshot | null
}) {
  const [loading, setLoading] = useState(true)
  const [assignments, setAssignments] = useState<EmployeeTaskAssignment[]>([])

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      const res = await listOrgTaskAssignments()
      if (res.success) setAssignments(res.data)
      setLoading(false)
    })()
  }, [])

  const empTasks = assignments.filter((a) => a.assigned_employee_ids?.includes(profileId))

  // Group tasks by project name
  const byProject: Record<string, number> = {}
  for (const t of empTasks) {
    const proj = t.project_name || 'No Project'
    byProject[proj] = (byProject[proj] ?? 0) + 1
  }
  const projectData = Object.entries(byProject)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name: name.length > 16 ? name.slice(0, 15) + '…' : name, count }))

  const snap = latestSnapshot

  return (
    <div className="space-y-4">
      {/* Completion donut + Tasks by Project */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ChartSection title="Task Completion Rate" dotColor="#4ade80">
          {!snap ? (
            <EmptyChart message="Generate a report above to see completion rate." />
          ) : (
            <div className="flex justify-center py-1">
              <DonutChart
                completed={snap.tasks_completed}
                total={snap.tasks_assigned}
                centerLabel="Completion"
              />
            </div>
          )}
        </ChartSection>

        <ChartSection title="Tasks by Project" dotColor="#a78bfa">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-gray-500" style={{ height: 80 }}>
              <Loader2 size={11} className="animate-spin" /> Loading…
            </div>
          ) : projectData.length === 0 ? (
            <EmptyChart message="No task assignments found." />
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={projectData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 9, fill: '#6b7280' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#6b7280' }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip {...DARK_TOOLTIP} formatter={(v) => [v, 'Tasks']} />
                <Bar dataKey="count" fill="#a78bfa" radius={[3, 3, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartSection>
      </div>

    </div>
  )
}
