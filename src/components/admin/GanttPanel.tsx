// @ts-nocheck
/**
 * GanttPanel — Four-view schedule visualization for EMS Phase 5.
 *
 * Toggle 1 (time range): Week | Month
 * Toggle 2 (row org):    By Employee | By Project
 *
 * Week views: one query per week change (getScheduleForWeek)
 * Month views: one query per month change (getScheduleForMonth)
 * No N+1 queries — employee roster and projects passed as props.
 *
 * Mobile (<768px): month views collapse to list fallback.
 * Tablet (768–1023px): month views also use list fallback.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronLeft, ChevronRight, Loader2, CalendarDays, Users, FolderOpen } from 'lucide-react'
import {
  getScheduleForWeek,
  getScheduleForMonth,
  weekStart,
  type ScheduleItem,
  type ScheduleStatus,
} from '@/services/employeeScheduleService'
import type { CrewRosterMember } from '@/services/crewPortalService'
import type { ActiveProject } from '@/services/crewPortalService'

// ── Types ─────────────────────────────────────────────────────────────────────

type ViewRange = 'week' | 'month'
type ViewOrg   = 'employee' | 'project'

export interface GanttOpenAddPrefill {
  employeeProfileId?: string
  workDate: string
  projectName?: string
}

interface GanttPanelProps {
  employees: CrewRosterMember[]
  projects: ActiveProject[]
  refreshKey: number
  onOpenAdd: (prefill: GanttOpenAddPrefill) => void
  onOpenEdit: (item: ScheduleItem) => void
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Ten distinct hues cycling for employee avatars in project view
const EMP_PALETTE = [
  { bg: '#1e3a5f', text: '#60a5fa' },
  { bg: '#3b1f5e', text: '#c084fc' },
  { bg: '#1c3d2e', text: '#4ade80' },
  { bg: '#4c1d1d', text: '#f87171' },
  { bg: '#2d3a1c', text: '#a3e635' },
  { bg: '#1e3b4a', text: '#22d3ee' },
  { bg: '#4a2e1c', text: '#fb923c' },
  { bg: '#3d1f35', text: '#f472b6' },
  { bg: '#1f2d3d', text: '#94a3b8' },
  { bg: '#2e2d1c', text: '#fbbf24' },
]

const STATUS_BAR: Record<ScheduleStatus, { bar: string; dot: string }> = {
  scheduled:   { bar: 'bg-blue-900/50 border-blue-700/50 text-blue-200',   dot: '#3b82f6' },
  in_progress: { bar: 'bg-amber-900/40 border-amber-700/50 text-amber-200', dot: '#f59e0b' },
  done:        { bar: 'bg-green-900/40 border-green-700/50 text-green-200', dot: '#22c55e' },
  cancelled:   { bar: 'bg-gray-800/30 border-gray-700/30 text-gray-600',    dot: '#6b7280' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function addDays(isoDate: string, n: number): string {
  const d = new Date(isoDate)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function isoToDate(iso: string): Date {
  const [y, m, day] = iso.split('-').map(Number)
  return new Date(y, m - 1, day)
}

function formatShort(isoDate: string): string {
  const d = isoToDate(isoDate)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatTime(t: string | null): string {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'pm' : 'am'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')}${ampm}`
}

function initials(name: string): string {
  const parts = (name || '').trim().split(/\s+/)
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (name.slice(0, 2)).toUpperCase()
}

function empColor(idx: number) {
  return EMP_PALETTE[idx % EMP_PALETTE.length]
}

/** YYYY-MM-DD for first day of month containing `iso`. */
function monthFirst(iso: string): string {
  return iso.slice(0, 7) + '-01'
}

/** All YYYY-MM-DD dates in the month containing `monthStart`. */
function monthDays(monthStart: string): string[] {
  const [y, m] = monthStart.split('-').map(Number)
  const count = new Date(y, m, 0).getDate()
  return Array.from({ length: count }, (_, i) => {
    const day = String(i + 1).padStart(2, '0')
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${day}`
  })
}

/** Mon–Sun ISO dates for the week starting at `weekMonday`. */
function weekDays(weekMonday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekMonday, i))
}

/** YYYY-MM-DD for first day of previous / next month. */
function shiftMonth(monthStart: string, delta: number): string {
  const [y, m] = monthStart.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function useIsNarrow(breakpoint = 1024): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false,
  )
  useEffect(() => {
    const fn = () => setNarrow(window.innerWidth < breakpoint)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [breakpoint])
  return narrow
}

// ── Shared cell/bar primitives ────────────────────────────────────────────────

function WeekBar({ item, onClick }: { item: ScheduleItem; onClick: () => void }) {
  const cls = STATUS_BAR[item.status]?.bar ?? STATUS_BAR.scheduled.bar
  const isCancelled = item.status === 'cancelled'
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      title={`${item.work_package_name || 'Task'}${item.start_time ? ' · ' + formatTime(item.start_time) : ''}${item.end_time ? '–' + formatTime(item.end_time) : ''}`}
      className={`w-full text-left text-[10px] px-1.5 py-1 rounded border leading-tight transition-opacity hover:opacity-75 ${cls} ${isCancelled ? 'opacity-40' : ''}`}
    >
      <span className="block font-medium truncate">{item.work_package_name || 'Task'}</span>
      {item.start_time && (
        <span className="opacity-60 block">
          {formatTime(item.start_time)}{item.end_time ? `–${formatTime(item.end_time)}` : ''}
        </span>
      )}
    </button>
  )
}

function MonthDot({ item, onClick }: { item: ScheduleItem; onClick: () => void }) {
  const color = STATUS_BAR[item.status]?.dot ?? '#3b82f6'
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      title={`${item.work_package_name || 'Task'}${item.start_time ? ' · ' + formatTime(item.start_time) : ''}`}
      className="w-2 h-2 rounded-full flex-shrink-0 hover:scale-125 transition-transform"
      style={{ backgroundColor: color }}
    />
  )
}

function EmpChip({
  name,
  colorIdx,
  title: tooltipText,
  onClick,
}: {
  name: string
  colorIdx: number
  title: string
  onClick: () => void
}) {
  const { bg, text } = empColor(colorIdx)
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      title={tooltipText}
      className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0 hover:opacity-80 transition-opacity"
      style={{ backgroundColor: bg, color: text }}
    >
      {initials(name)}
    </button>
  )
}

// ── Week × Employee grid ──────────────────────────────────────────────────────

function WeekEmployeeGrid({
  days,
  employees,
  items,
  today,
  onOpenAdd,
  onOpenEdit,
}: {
  days: string[]
  employees: CrewRosterMember[]
  items: ScheduleItem[]
  today: string
  onOpenAdd: (p: GanttOpenAddPrefill) => void
  onOpenEdit: (i: ScheduleItem) => void
}) {
  if (employees.length === 0) return (
    <p className="text-xs text-gray-600 py-4">No active employees.</p>
  )
  return (
    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: '#1e2128' }}>
      <table className="w-full text-xs" style={{ minWidth: `${120 + days.length * 110}px` }}>
        <thead>
          <tr style={{ backgroundColor: '#0d0e14', borderBottom: '1px solid #1e2128' }}>
            <th className="text-left font-semibold text-gray-500 uppercase tracking-wider px-3 py-2 w-28 sticky left-0 z-10" style={{ backgroundColor: '#0d0e14' }}>
              Employee
            </th>
            {days.map((date, i) => {
              const isToday = date === today
              return (
                <th key={date} className={`text-center font-semibold uppercase tracking-wider px-2 py-2 min-w-[110px] ${isToday ? 'text-green-400' : 'text-gray-500'}`}>
                  {DAY_LABELS[i] ?? date.slice(8)}
                  <span className={`block text-[10px] font-normal ${isToday ? 'text-green-500' : 'text-gray-600'}`}>{formatShort(date)}</span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {employees.map((emp, empIdx) => (
            <tr key={emp.id} style={{ backgroundColor: empIdx % 2 === 0 ? '#0a0b0f' : '#0c0d12', borderBottom: '1px solid #1a1c23' }}>
              <td className="px-3 py-2 sticky left-0 z-10 align-top" style={{ backgroundColor: empIdx % 2 === 0 ? '#0a0b0f' : '#0c0d12' }}>
                <div className="flex items-center gap-1.5">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0" style={{ backgroundColor: empColor(empIdx).bg, color: empColor(empIdx).text }}>
                    {initials(emp.name)}
                  </div>
                  <span className="text-gray-300 font-medium truncate max-w-[80px]">{emp.name}</span>
                </div>
              </td>
              {days.map((date) => {
                const cellItems = items.filter((it) => it.employee_profile_id === emp.id && it.work_date === date)
                const isToday = date === today
                return (
                  <td key={date} className="px-1.5 py-1.5 align-top cursor-pointer hover:bg-white/[0.02] transition-colors" style={isToday ? { backgroundColor: 'rgba(74,222,128,0.03)' } : {}}
                    onClick={() => onOpenAdd({ employeeProfileId: emp.id, workDate: date })}>
                    <div className="space-y-1 min-h-[32px]">
                      {cellItems.map((item) => (
                        <WeekBar key={item.id} item={item} onClick={() => onOpenEdit(item)} />
                      ))}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Week × Project grid ───────────────────────────────────────────────────────

function WeekProjectGrid({
  days,
  projects,
  employees,
  items,
  today,
  onOpenAdd,
  onOpenEdit,
}: {
  days: string[]
  projects: ActiveProject[]
  employees: CrewRosterMember[]
  items: ScheduleItem[]
  today: string
  onOpenAdd: (p: GanttOpenAddPrefill) => void
  onOpenEdit: (i: ScheduleItem) => void
}) {
  // Build stable employee-index map for colors
  const empIndexMap = new Map(employees.map((e, i) => [e.id, i]))

  if (projects.length === 0) return (
    <p className="text-xs text-gray-600 py-4">No active projects.</p>
  )
  return (
    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: '#1e2128' }}>
      <table className="w-full text-xs" style={{ minWidth: `${120 + days.length * 110}px` }}>
        <thead>
          <tr style={{ backgroundColor: '#0d0e14', borderBottom: '1px solid #1e2128' }}>
            <th className="text-left font-semibold text-gray-500 uppercase tracking-wider px-3 py-2 w-32 sticky left-0 z-10" style={{ backgroundColor: '#0d0e14' }}>
              Project
            </th>
            {days.map((date, i) => {
              const isToday = date === today
              return (
                <th key={date} className={`text-center font-semibold uppercase tracking-wider px-2 py-2 min-w-[110px] ${isToday ? 'text-green-400' : 'text-gray-500'}`}>
                  {DAY_LABELS[i] ?? date.slice(8)}
                  <span className={`block text-[10px] font-normal ${isToday ? 'text-green-500' : 'text-gray-600'}`}>{formatShort(date)}</span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {projects.map((proj, projIdx) => (
            <tr key={proj.id} style={{ backgroundColor: projIdx % 2 === 0 ? '#0a0b0f' : '#0c0d12', borderBottom: '1px solid #1a1c23' }}>
              <td className="px-3 py-2 sticky left-0 z-10 align-top" style={{ backgroundColor: projIdx % 2 === 0 ? '#0a0b0f' : '#0c0d12' }}>
                <span className="text-gray-300 font-medium text-[11px] truncate block max-w-[110px]">{proj.name}</span>
              </td>
              {days.map((date) => {
                const cellItems = items.filter((it) => it.project_name === proj.name && it.work_date === date)
                const isToday = date === today
                return (
                  <td key={date} className="px-1.5 py-1.5 align-top cursor-pointer hover:bg-white/[0.02] transition-colors" style={isToday ? { backgroundColor: 'rgba(74,222,128,0.03)' } : {}}
                    onClick={() => onOpenAdd({ workDate: date, projectName: proj.name })}>
                    <div className="flex flex-wrap gap-1 min-h-[28px]">
                      {cellItems.map((item) => {
                        const emp = employees.find((e) => e.id === item.employee_profile_id)
                        const colorIdx = emp ? (empIndexMap.get(emp.id) ?? 0) : 0
                        const name = emp?.name ?? item.employee_name ?? '?'
                        const tooltip = `${name} · ${item.work_package_name || 'Task'}${item.start_time ? ' · ' + formatTime(item.start_time) : ''}${item.end_time ? '–' + formatTime(item.end_time) : ''}`
                        return (
                          <EmpChip key={item.id} name={name} colorIdx={colorIdx} title={tooltip} onClick={() => onOpenEdit(item)} />
                        )
                      })}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Month × Employee grid ─────────────────────────────────────────────────────

function MonthEmployeeGrid({
  days,
  employees,
  items,
  today,
  onOpenAdd,
  onOpenEdit,
}: {
  days: string[]
  employees: CrewRosterMember[]
  items: ScheduleItem[]
  today: string
  onOpenAdd: (p: GanttOpenAddPrefill) => void
  onOpenEdit: (i: ScheduleItem) => void
}) {
  if (employees.length === 0) return (
    <p className="text-xs text-gray-600 py-4">No active employees.</p>
  )
  return (
    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: '#1e2128' }}>
      <table className="w-full text-xs" style={{ minWidth: `${120 + days.length * 32}px` }}>
        <thead>
          <tr style={{ backgroundColor: '#0d0e14', borderBottom: '1px solid #1e2128' }}>
            <th className="text-left font-semibold text-gray-500 uppercase tracking-wider px-3 py-2 w-28 sticky left-0 z-10" style={{ backgroundColor: '#0d0e14' }}>
              Employee
            </th>
            {days.map((date) => {
              const isToday = date === today
              const dayNum = date.slice(8)
              return (
                <th key={date} className={`text-center font-semibold px-0 py-1.5 w-8 min-w-[28px] ${isToday ? 'text-green-400' : 'text-gray-600'}`}>
                  {dayNum}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {employees.map((emp, empIdx) => (
            <tr key={emp.id} style={{ backgroundColor: empIdx % 2 === 0 ? '#0a0b0f' : '#0c0d12', borderBottom: '1px solid #1a1c23' }}>
              <td className="px-3 py-1.5 sticky left-0 z-10 align-middle" style={{ backgroundColor: empIdx % 2 === 0 ? '#0a0b0f' : '#0c0d12' }}>
                <div className="flex items-center gap-1.5">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0" style={{ backgroundColor: empColor(empIdx).bg, color: empColor(empIdx).text }}>
                    {initials(emp.name)}
                  </div>
                  <span className="text-gray-300 font-medium truncate max-w-[80px]">{emp.name}</span>
                </div>
              </td>
              {days.map((date) => {
                const cellItems = items.filter((it) => it.employee_profile_id === emp.id && it.work_date === date)
                const isToday = date === today
                return (
                  <td key={date} className="align-middle text-center cursor-pointer hover:bg-white/[0.02] py-1.5" style={isToday ? { backgroundColor: 'rgba(74,222,128,0.04)' } : {}}
                    onClick={() => onOpenAdd({ employeeProfileId: emp.id, workDate: date })}>
                    <div className="flex flex-wrap gap-0.5 justify-center">
                      {cellItems.map((item) => (
                        <MonthDot key={item.id} item={item} onClick={() => onOpenEdit(item)} />
                      ))}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Month × Project grid ──────────────────────────────────────────────────────

function MonthProjectGrid({
  days,
  projects,
  employees,
  items,
  today,
  onOpenAdd,
  onOpenEdit,
}: {
  days: string[]
  projects: ActiveProject[]
  employees: CrewRosterMember[]
  items: ScheduleItem[]
  today: string
  onOpenAdd: (p: GanttOpenAddPrefill) => void
  onOpenEdit: (i: ScheduleItem) => void
}) {
  const empIndexMap = new Map(employees.map((e, i) => [e.id, i]))
  if (projects.length === 0) return (
    <p className="text-xs text-gray-600 py-4">No active projects.</p>
  )
  return (
    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: '#1e2128' }}>
      <table className="w-full text-xs" style={{ minWidth: `${130 + days.length * 32}px` }}>
        <thead>
          <tr style={{ backgroundColor: '#0d0e14', borderBottom: '1px solid #1e2128' }}>
            <th className="text-left font-semibold text-gray-500 uppercase tracking-wider px-3 py-2 w-32 sticky left-0 z-10" style={{ backgroundColor: '#0d0e14' }}>
              Project
            </th>
            {days.map((date) => {
              const isToday = date === today
              return (
                <th key={date} className={`text-center font-semibold px-0 py-1.5 w-8 min-w-[28px] ${isToday ? 'text-green-400' : 'text-gray-600'}`}>
                  {date.slice(8)}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {projects.map((proj, projIdx) => (
            <tr key={proj.id} style={{ backgroundColor: projIdx % 2 === 0 ? '#0a0b0f' : '#0c0d12', borderBottom: '1px solid #1a1c23' }}>
              <td className="px-3 py-1.5 sticky left-0 z-10 align-middle" style={{ backgroundColor: projIdx % 2 === 0 ? '#0a0b0f' : '#0c0d12' }}>
                <span className="text-gray-300 font-medium text-[11px] truncate block max-w-[110px]">{proj.name}</span>
              </td>
              {days.map((date) => {
                const cellItems = items.filter((it) => it.project_name === proj.name && it.work_date === date)
                const VISIBLE = 3
                const shown = cellItems.slice(0, VISIBLE)
                const extra = cellItems.length - VISIBLE
                const isToday = date === today
                const tooltipAll = cellItems.map((it) => {
                  const emp = employees.find((e) => e.id === it.employee_profile_id)
                  return emp?.name ?? it.employee_name ?? '?'
                }).join(', ')
                return (
                  <td key={date} className="align-middle cursor-pointer hover:bg-white/[0.02] py-1.5" style={isToday ? { backgroundColor: 'rgba(74,222,128,0.04)' } : {}}
                    onClick={() => onOpenAdd({ workDate: date, projectName: proj.name })}>
                    <div className="flex flex-wrap gap-0.5 justify-center" title={tooltipAll || undefined}>
                      {shown.map((item) => {
                        const emp = employees.find((e) => e.id === item.employee_profile_id)
                        const colorIdx = empIndexMap.get(item.employee_profile_id) ?? 0
                        const name = emp?.name ?? item.employee_name ?? '?'
                        return (
                          <EmpChip key={item.id} name={name} colorIdx={colorIdx} title={`${name} · ${item.work_package_name || 'Task'}`} onClick={() => onOpenEdit(item)} />
                        )
                      })}
                      {extra > 0 && (
                        <span className="text-[8px] text-gray-500 font-medium leading-5">+{extra}</span>
                      )}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── List fallback (mobile / tablet month view) ────────────────────────────────

function ListFallback({
  viewOrg,
  employees,
  projects,
  items,
  onOpenEdit,
  onOpenAdd,
}: {
  viewOrg: ViewOrg
  employees: CrewRosterMember[]
  projects: ActiveProject[]
  items: ScheduleItem[]
  onOpenEdit: (i: ScheduleItem) => void
  onOpenAdd: (p: GanttOpenAddPrefill) => void
}) {
  const STATUS_LABEL: Record<ScheduleStatus, string> = {
    scheduled: 'Scheduled', in_progress: 'In Progress', done: 'Done', cancelled: 'Cancelled',
  }
  const STATUS_CLS: Record<ScheduleStatus, string> = {
    scheduled:   'text-blue-300 bg-blue-900/30 border-blue-700/40',
    in_progress: 'text-amber-300 bg-amber-900/20 border-amber-700/40',
    done:        'text-green-300 bg-green-900/20 border-green-700/40',
    cancelled:   'text-gray-500 bg-gray-800/20 border-gray-700/30',
  }

  if (viewOrg === 'employee') {
    const sorted = [...employees].filter((e) => e.active)
    return (
      <div className="space-y-4">
        {sorted.map((emp, idx) => {
          const empItems = items.filter((it) => it.employee_profile_id === emp.id)
          if (empItems.length === 0) return null
          return (
            <div key={emp.id}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold" style={{ backgroundColor: empColor(idx).bg, color: empColor(idx).text }}>
                  {initials(emp.name)}
                </div>
                <span className="text-xs font-semibold text-gray-300">{emp.name}</span>
              </div>
              <div className="space-y-1 pl-7">
                {empItems.map((it) => (
                  <button key={it.id} type="button" onClick={() => onOpenEdit(it)}
                    className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg border hover:bg-white/[0.02] transition-colors"
                    style={{ backgroundColor: '#0a0b0f', borderColor: '#1a1c23' }}>
                    <span className="text-[10px] text-gray-500 w-20 flex-shrink-0 font-mono">{formatShort(it.work_date)}</span>
                    <span className="text-xs text-gray-300 flex-1 truncate">{it.work_package_name || 'Task'}{it.project_name ? ` · ${it.project_name}` : ''}</span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border flex-shrink-0 ${STATUS_CLS[it.status]}`}>{STATUS_LABEL[it.status]}</span>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
        {items.length === 0 && <p className="text-xs text-gray-600">No items in this period.</p>}
      </div>
    )
  }

  // By project
  return (
    <div className="space-y-4">
      {projects.map((proj) => {
        const projItems = items.filter((it) => it.project_name === proj.name)
        if (projItems.length === 0) return null
        return (
          <div key={proj.id}>
            <p className="text-xs font-semibold text-gray-300 mb-2">{proj.name}</p>
            <div className="space-y-1 pl-4">
              {projItems.map((it) => {
                const emp = employees.find((e) => e.id === it.employee_profile_id)
                return (
                  <button key={it.id} type="button" onClick={() => onOpenEdit(it)}
                    className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg border hover:bg-white/[0.02] transition-colors"
                    style={{ backgroundColor: '#0a0b0f', borderColor: '#1a1c23' }}>
                    <span className="text-[10px] text-gray-500 w-20 flex-shrink-0 font-mono">{formatShort(it.work_date)}</span>
                    <span className="text-xs text-gray-300 flex-1 truncate">{emp?.name ?? it.employee_name ?? '?'} — {it.work_package_name || 'Task'}</span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border flex-shrink-0 ${STATUS_CLS[it.status]}`}>{STATUS_LABEL[it.status]}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
      {items.length === 0 && <p className="text-xs text-gray-600">No items in this period.</p>}
    </div>
  )
}

// ── Skeleton rows ─────────────────────────────────────────────────────────────

function SkeletonRows({ cols }: { cols: number }) {
  return (
    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: '#1e2128' }}>
      <table className="w-full text-xs" style={{ minWidth: `${120 + cols * 60}px` }}>
        <tbody>
          {[1, 2, 3].map((r) => (
            <tr key={r} style={{ borderBottom: '1px solid #1a1c23' }}>
              <td className="px-3 py-3 w-28">
                <div className="h-2 bg-gray-800 rounded animate-pulse w-20" />
              </td>
              {Array.from({ length: cols }, (_, c) => (
                <td key={c} className="px-1.5 py-3">
                  <div className="h-2 bg-gray-800/50 rounded animate-pulse" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Main GanttPanel ───────────────────────────────────────────────────────────

export default function GanttPanel({
  employees,
  projects,
  refreshKey,
  onOpenAdd,
  onOpenEdit,
}: GanttPanelProps) {
  const [viewRange, setViewRange] = useState<ViewRange>('week')
  const [viewOrg,   setViewOrg]   = useState<ViewOrg>('employee')

  // Week anchor = ISO Monday; Month anchor = ISO first-of-month
  const [weekAnchor,  setWeekAnchor]  = useState<string>(() => weekStart(new Date()))
  const [monthAnchor, setMonthAnchor] = useState<string>(() => monthFirst(new Date().toISOString().slice(0, 10)))

  const [items,   setItems]   = useState<ScheduleItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const isNarrow = useIsNarrow(1024) // month views → list below 1024px

  const today = new Date().toISOString().slice(0, 10)

  const activeEmployees = employees.filter((e) => e.active)

  // ── Data loading ────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    let result
    if (viewRange === 'week') {
      result = await getScheduleForWeek(weekAnchor)
    } else {
      const days = monthDays(monthAnchor)
      result = await getScheduleForMonth(monthAnchor, days[days.length - 1])
    }
    if (result.success) setItems(result.data)
    else setError(result.error)
    setLoading(false)
  }, [viewRange, weekAnchor, monthAnchor])

  useEffect(() => { void load() }, [load, refreshKey])

  // ── Navigation ──────────────────────────────────────────────────────────────

  function prevPeriod() {
    if (viewRange === 'week') setWeekAnchor((d) => addDays(d, -7))
    else setMonthAnchor((d) => shiftMonth(d, -1))
  }
  function nextPeriod() {
    if (viewRange === 'week') setWeekAnchor((d) => addDays(d, 7))
    else setMonthAnchor((d) => shiftMonth(d, 1))
  }

  // ── Period label ────────────────────────────────────────────────────────────

  function periodLabel(): string {
    if (viewRange === 'week') {
      return `${formatShort(weekAnchor)} – ${formatShort(addDays(weekAnchor, 6))}`
    }
    const [y, m] = monthAnchor.split('-').map(Number)
    return `${MONTH_NAMES[m - 1]} ${y}`
  }

  // ── Column dates ────────────────────────────────────────────────────────────

  const colDates = viewRange === 'week' ? weekDays(weekAnchor) : monthDays(monthAnchor)

  // ── Toggle button styles ────────────────────────────────────────────────────

  function toggleCls(active: boolean) {
    return active
      ? 'px-3 py-1 rounded-md text-xs font-semibold text-green-300 bg-green-900/30 border border-green-700/50'
      : 'px-3 py-1 rounded-md text-xs font-medium text-gray-500 hover:text-gray-300 border border-transparent hover:border-gray-700/40'
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const showListFallback = viewRange === 'month' && isNarrow

  return (
    <div className="space-y-3">
      {/* Header: toggles + navigation */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Time range toggle */}
        <div className="flex items-center gap-0.5 rounded-lg border p-0.5" style={{ borderColor: '#1e2128', backgroundColor: '#0a0b0f' }}>
          <button type="button" className={toggleCls(viewRange === 'week')}  onClick={() => setViewRange('week')}>Week</button>
          <button type="button" className={toggleCls(viewRange === 'month')} onClick={() => setViewRange('month')}>Month</button>
        </div>

        {/* Row organization toggle */}
        <div className="flex items-center gap-0.5 rounded-lg border p-0.5" style={{ borderColor: '#1e2128', backgroundColor: '#0a0b0f' }}>
          <button type="button" className={`${toggleCls(viewOrg === 'employee')} flex items-center gap-1`} onClick={() => setViewOrg('employee')}>
            <Users size={10} /> Employee
          </button>
          <button type="button" className={`${toggleCls(viewOrg === 'project')} flex items-center gap-1`} onClick={() => setViewOrg('project')}>
            <FolderOpen size={10} /> Project
          </button>
        </div>

        <div className="flex-1" />

        {/* Period navigation */}
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={prevPeriod} className="p-1.5 rounded border text-gray-400 hover:text-gray-200 hover:bg-gray-800/40 transition-colors" style={{ borderColor: '#2d3140' }}>
            <ChevronLeft size={13} />
          </button>
          <span className="text-xs font-medium text-gray-300 min-w-[160px] text-center flex items-center justify-center gap-1.5">
            <CalendarDays size={12} className="text-gray-500" />
            {periodLabel()}
          </span>
          <button type="button" onClick={nextPeriod} className="p-1.5 rounded border text-gray-400 hover:text-gray-200 hover:bg-gray-800/40 transition-colors" style={{ borderColor: '#2d3140' }}>
            <ChevronRight size={13} />
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-red-400 rounded border border-red-800/40 px-3 py-2 bg-red-900/20">{error}</p>
      )}

      {/* Loading skeleton */}
      {loading && <SkeletonRows cols={viewRange === 'week' ? 7 : Math.min(colDates.length, 14)} />}

      {/* Grid views */}
      {!loading && !error && !showListFallback && viewRange === 'week' && viewOrg === 'employee' && (
        <WeekEmployeeGrid days={colDates} employees={activeEmployees} items={items} today={today} onOpenAdd={onOpenAdd} onOpenEdit={onOpenEdit} />
      )}
      {!loading && !error && !showListFallback && viewRange === 'week' && viewOrg === 'project' && (
        <WeekProjectGrid days={colDates} projects={projects} employees={activeEmployees} items={items} today={today} onOpenAdd={onOpenAdd} onOpenEdit={onOpenEdit} />
      )}
      {!loading && !error && !showListFallback && viewRange === 'month' && viewOrg === 'employee' && (
        <MonthEmployeeGrid days={colDates} employees={activeEmployees} items={items} today={today} onOpenAdd={onOpenAdd} onOpenEdit={onOpenEdit} />
      )}
      {!loading && !error && !showListFallback && viewRange === 'month' && viewOrg === 'project' && (
        <MonthProjectGrid days={colDates} projects={projects} employees={activeEmployees} items={items} today={today} onOpenAdd={onOpenAdd} onOpenEdit={onOpenEdit} />
      )}

      {/* Mobile/tablet list fallback for month view */}
      {!loading && !error && showListFallback && (
        <ListFallback viewOrg={viewOrg} employees={activeEmployees} projects={projects} items={items} onOpenEdit={onOpenEdit} onOpenAdd={onOpenAdd} />
      )}

      {/* Empty state */}
      {!loading && !error && items.length === 0 && (
        <p className="text-[11px] text-gray-600 pt-1">
          No work scheduled this {viewRange}. Click any cell to add an item.
        </p>
      )}

      <p className="text-[10px] text-gray-700">Click any cell to schedule · click a bar or chip to edit</p>
    </div>
  )
}
