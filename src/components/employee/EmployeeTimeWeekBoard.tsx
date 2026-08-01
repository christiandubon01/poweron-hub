// @ts-nocheck
/**
 * EmployeeTimeWeekBoard — full-width seven-day time board (EMPLOYEE-MY-TIME-WEEK-1 + SESSIONS-1).
 *
 * Presentation only. All data is supplied by EmployeeMyTimePanel.
 *
 * Layout:
 *   < lg — seven-day selector strip + selected-day cards
 *   ≥ lg — seven equal day columns, Monday through Sunday on one row
 *
 * Per day, when sessions exist (migration 099): renders one SessionCard per session with:
 *   - Job identity (project / work order name)
 *   - Fixed PUNCH_DISPLAY_ORDER punch rows (clock_in → lunch_out → lunch_in → clock_out)
 *   - "Missing" placeholder in position for missing punches (never collapsed)
 *   - Paid / lunch totals
 *   - Per-session "Request Punch Edit" button
 *
 * Legacy (no sessions): renders the original EntryCard (punch grid from time_entries).
 */

import React, { useState } from 'react'
import { Clock, Edit3, Briefcase } from 'lucide-react'
import type {
  EmployeeMyTimeDay,
  EmployeeWorkSession,
  PunchEditRequest,
  WeekRange,
} from '@/services/employeePortalService'
import { PUNCH_DISPLAY_ORDER, type PunchType } from '@/services/employeeTimeService'
import {
  resolveTimeSessionIdentity,
  timeSessionIdentityDisplayValue,
} from '@/services/timeSessionIdentity'
import {
  buildWeekTimeDates,
  formatWeekTimeDayLabel,
  isTenantToday,
  resolveDefaultSelectedDate,
} from './employeeWeeklyTime'

// ── Display status pill ───────────────────────────────────────────────────────

type DayStatus = 'not_started' | 'clocked_in' | 'on_lunch' | 'complete' | 'incomplete' | 'open'

const STATUS_PILL: Record<DayStatus, { label: string; cls: string }> = {
  not_started: { label: 'No time',    cls: 'bg-gray-100 text-gray-500 border-gray-200' },
  clocked_in:  { label: 'Clocked in', cls: 'bg-green-100 text-green-700 border-green-200' },
  on_lunch:    { label: 'On lunch',   cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  complete:    { label: 'Complete',   cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  incomplete:  { label: 'Incomplete', cls: 'bg-red-100 text-red-700 border-red-200' },
  open:        { label: 'Open',       cls: 'bg-green-100 text-green-700 border-green-200' },
}

function deriveDayStatus(day: EmployeeMyTimeDay): DayStatus {
  // Prefer session-based status when sessions exist
  if (day.sessions.length > 0) {
    const all = day.sessions
    const hasActive = all.some(s => s.clock_in_at && !s.clock_out_at)
    if (hasActive) {
      const activeSession = all.find(s => s.clock_in_at && !s.clock_out_at)!
      if (activeSession.lunch_out_at && !activeSession.lunch_in_at) return 'on_lunch'
      return 'clocked_in'
    }
    const allDone = all.every(s => s.clock_out_at)
    return allDone ? 'complete' : 'not_started'
  }
  // Legacy punch-based status
  const has = (t: string) => day.punches.some(p => p.punch_type === t && !p.is_void)
  if (!has('clock_in')) return 'not_started'
  if (has('clock_out')) {
    if (has('lunch_out') && !has('lunch_in')) return 'incomplete'
    return day.entry?.status === 'incomplete' ? 'incomplete' : 'complete'
  }
  if (has('lunch_out') && !has('lunch_in')) return 'on_lunch'
  return 'clocked_in'
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

function formatTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function formatMinutes(mins: number | null | undefined): string {
  if (mins == null || isNaN(mins)) return '—'
  const total = Math.max(0, Math.round(mins))
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${h}h ${String(m).padStart(2, '0')}m`
}

// ── PunchRow — fixed-order vertical punch display ─────────────────────────────

function PunchRow({ label, value, compact }: { label: string; value: string; compact?: boolean }) {
  const empty = !value
  return (
    <div className="flex items-center justify-between gap-2 min-w-0">
      <p className={`text-gray-500 flex-shrink-0 ${compact ? 'text-[10px]' : 'text-xs'}`}>{label}</p>
      <p className={`tabular-nums truncate ${compact ? 'text-sm' : 'text-sm'} ${
        empty ? 'font-medium text-gray-300 italic' : 'font-bold text-gray-800'
      }`}>
        {empty ? 'Missing' : value}
      </p>
    </div>
  )
}

// ── PunchField — legacy 2-col grid cell ───────────────────────────────────────

function PunchField({ label, value, compact }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className="min-w-0">
      <p className={`text-gray-400 uppercase tracking-wide ${compact ? 'text-[9px]' : 'text-[10px]'}`}>
        {label}
      </p>
      {value ? (
        <p className={`font-bold text-gray-800 tabular-nums leading-tight ${compact ? 'text-sm' : 'text-base'}`}>
          {value}
        </p>
      ) : (
        <p className={`font-semibold text-gray-400 leading-tight italic ${compact ? 'text-sm' : 'text-base'}`}>
          Missing
        </p>
      )}
    </div>
  )
}

// ── SessionCard — per-session card (SESSIONS-1) ───────────────────────────────

const SESSION_KEY_MAP: Record<PunchType, keyof EmployeeWorkSession> = {
  clock_in:  'clock_in_at',
  lunch_out: 'lunch_out_at',
  lunch_in:  'lunch_in_at',
  clock_out: 'clock_out_at',
}

interface SessionCardProps {
  session: EmployeeWorkSession
  pendingRequests: PunchEditRequest[]
  onRequestPunchEdit: () => void
  compact?: boolean
}

function SessionCard({ session, pendingRequests, onRequestPunchEdit, compact = false }: SessionCardProps) {
  const hasPending = pendingRequests.some(
    r => r.session_id === session.id && r.status === 'pending'
  )
  const isActive = !!session.clock_in_at && !session.clock_out_at
  const isDone   = !!session.clock_out_at

  const identity = resolveTimeSessionIdentity({
    assignmentId: session.assignment_id,
    workPackageName: session.work_package_name,
    projectName: session.project_name,
  })

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Time Session identity — assignment-linked sessions are Work Orders */}
      <div className="px-3 pt-2.5 pb-1.5 bg-gray-50 border-b border-gray-100 flex items-start gap-2">
        <Briefcase className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          {identity.projectName && (
            <p className={`font-bold text-gray-900 truncate leading-tight ${compact ? 'text-xs' : 'text-sm'}`}>
              {identity.projectName}
            </p>
          )}
          <p className="text-[10px] text-gray-400 uppercase tracking-wide truncate leading-none mt-0.5">
            {identity.kind === 'project-only' ? 'Work Package' : identity.label}
          </p>
          <p className={`truncate leading-tight ${compact ? 'text-xs' : 'text-sm'} ${
            identity.kind === 'project-only' ? 'font-medium text-blue-600' : 'font-semibold text-gray-800'
          }`}>
            {timeSessionIdentityDisplayValue(identity)}
          </p>
        </div>
      </div>

      {/* Status badges */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 pt-1.5 pb-0.5">
        {identity.isProjectOnly && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border bg-blue-50 text-blue-700 border-blue-200">
            Project Only
          </span>
        )}
        {isActive && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border bg-green-50 text-green-700 border-green-200">
            Active
          </span>
        )}
        {isDone && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border bg-blue-50 text-blue-700 border-blue-200">
            Complete
          </span>
        )}
        {hasPending && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border bg-purple-50 text-purple-700 border-purple-200">
            Pending Edit
          </span>
        )}
      </div>

      {/* Fixed punch order — 4 rows, always present */}
      <div className="px-3 pb-2.5 mt-1 space-y-1.5">
        {PUNCH_DISPLAY_ORDER.map(({ type, label }) => (
          <PunchRow
            key={type}
            label={label}
            value={formatTime(session[SESSION_KEY_MAP[type]] as string | null)}
            compact={compact}
          />
        ))}

        {/* Totals */}
        {session.paid_minutes != null && (
          <div className="flex items-center gap-3 mt-2 pt-2 border-t border-gray-100">
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">Paid</p>
              <p className={`font-bold text-green-700 tabular-nums leading-tight ${compact ? 'text-sm' : 'text-base'}`}>
                {formatMinutes(session.paid_minutes)}
              </p>
            </div>
            {session.lunch_minutes != null && session.lunch_minutes > 0 && (
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wide">Lunch</p>
                <p className={`font-bold text-gray-700 tabular-nums leading-tight ${compact ? 'text-sm' : 'text-base'}`}>
                  {formatMinutes(session.lunch_minutes)}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Per-session Request Punch Edit */}
      <div className="px-3 pb-3 border-t border-gray-100 pt-2">
        <button
          type="button"
          onClick={onRequestPunchEdit}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:border-green-400 hover:text-green-700 hover:bg-green-50 transition"
        >
          <Edit3 className="w-3.5 h-3.5" />
          Request Punch Edit
        </button>
      </div>
    </div>
  )
}

// ── EntryCard — legacy single-session card (no sessions) ─────────────────────

interface EntryCardProps {
  day: EmployeeMyTimeDay
  pendingRequests: PunchEditRequest[]
  onRequestPunchEdit: () => void
  compact?: boolean
}

function EntryCard({ day, pendingRequests, onRequestPunchEdit, compact = false }: EntryCardProps) {
  const e = day.entry
  const hasAdminEdit = day.punches.some(p => p.source === 'admin_edit')
  const hasPending   = pendingRequests.some(r => r.status === 'pending')
  const status = deriveDayStatus(day)
  const pill   = STATUS_PILL[status]
  const hasAnyTime = e || day.punches.length > 0

  if (!hasAnyTime) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 px-3 py-4 text-center">
        <p className="text-sm text-gray-400">No time</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Status badges */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5 pb-1">
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${pill.cls}`}>
          {pill.label}
        </span>
        {hasAdminEdit && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">
            Admin Edited
          </span>
        )}
        {hasPending && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full border bg-purple-50 text-purple-700 border-purple-200">
            Pending Edit
          </span>
        )}
      </div>

      {/* Fixed punch order — vertical rows */}
      <div className="px-3 pb-2.5 mt-1 space-y-1.5">
        {PUNCH_DISPLAY_ORDER.map(({ type, label }) => {
          const key = (type + '_at') as keyof typeof e
          const value = formatTime(e?.[key] as string | null)
          return <PunchRow key={type} label={label} value={value} compact={compact} />
        })}

        {/* Totals */}
        {e && (
          <div className="flex items-center gap-3 mt-2 pt-2 border-t border-gray-100">
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">Paid</p>
              <p className={`font-bold text-green-700 tabular-nums leading-tight ${compact ? 'text-sm' : 'text-base'}`}>
                {formatMinutes(e.paid_minutes)}
              </p>
            </div>
            {e.lunch_minutes != null && e.lunch_minutes > 0 && (
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wide">Lunch</p>
                <p className={`font-bold text-gray-700 tabular-nums leading-tight ${compact ? 'text-sm' : 'text-base'}`}>
                  {formatMinutes(e.lunch_minutes)}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Request Punch Edit */}
      {e && (
        <div className="px-3 pb-3 border-t border-gray-100 pt-2">
          <button
            type="button"
            onClick={onRequestPunchEdit}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:border-green-400 hover:text-green-700 hover:bg-green-50 transition"
          >
            <Edit3 className="w-3.5 h-3.5" />
            Request Punch Edit
          </button>
        </div>
      )}
    </div>
  )
}

// ── DayContent — session cards or legacy entry card ───────────────────────────

interface DayContentProps {
  day: EmployeeMyTimeDay
  pendingRequests: PunchEditRequest[]
  onRequestPunchEdit: (entryId: string, day: EmployeeMyTimeDay, sessionId?: string | null) => void
  compact?: boolean
}

function DayContent({ day, pendingRequests, onRequestPunchEdit, compact }: DayContentProps) {
  if (day.sessions.length > 0) {
    // Index pending requests by session_id for quick lookup
    const bySessionId = new Map<string, PunchEditRequest[]>()
    for (const r of pendingRequests) {
      if (r.session_id) {
        const list = bySessionId.get(r.session_id) ?? []
        list.push(r)
        bySessionId.set(r.session_id, list)
      }
    }

    return (
      <div className="space-y-2">
        {day.sessions.map(session => (
          <SessionCard
            key={session.id}
            session={session}
            pendingRequests={bySessionId.get(session.id) ?? []}
            compact={compact}
            onRequestPunchEdit={() => {
              if (day.entry) {
                onRequestPunchEdit(day.entry.id, day, session.id)
              }
            }}
          />
        ))}
      </div>
    )
  }

  return (
    <EntryCard
      day={day}
      pendingRequests={pendingRequests}
      compact={compact}
      onRequestPunchEdit={() => {
        if (day.entry) {
          onRequestPunchEdit(day.entry.id, day)
        }
      }}
    />
  )
}

// ── Main board ────────────────────────────────────────────────────────────────

export interface EmployeeTimeWeekBoardProps {
  range: WeekRange
  days: EmployeeMyTimeDay[]
  pendingRequests: PunchEditRequest[]
  tenantWorkDate: string
  onRequestPunchEdit: (entryId: string, day: EmployeeMyTimeDay, sessionId?: string | null) => void
}

export function EmployeeTimeWeekBoard({
  range,
  days,
  pendingRequests,
  tenantWorkDate,
  onRequestPunchEdit,
}: EmployeeTimeWeekBoardProps) {
  const dates = buildWeekTimeDates(range)

  // Phone/tablet: selected day state, reset when range changes (parent uses key prop)
  const [selectedDate, setSelectedDate] = useState<string>(
    () => resolveDefaultSelectedDate(range, tenantWorkDate)
  )

  // Index days by workDate for O(1) lookup
  const dayByDate = new Map<string, EmployeeMyTimeDay>()
  for (const d of days) dayByDate.set(d.workDate, d)

  // Index requests by time_entry_id for legacy cards
  const requestsByEntryId = new Map<string, PunchEditRequest[]>()
  for (const r of pendingRequests) {
    const list = requestsByEntryId.get(r.time_entry_id) ?? []
    list.push(r)
    requestsByEntryId.set(r.time_entry_id, list)
  }

  function getDayData(date: string): EmployeeMyTimeDay {
    return dayByDate.get(date) ?? {
      workDate: date,
      entry: null,
      sessions: [],
      punches: [],
      paidMinutes: null,
      lunchMinutes: null,
      status: 'none',
    }
  }

  function getDayRequests(day: EmployeeMyTimeDay): PunchEditRequest[] {
    if (!day.entry) return []
    return requestsByEntryId.get(day.entry.id) ?? []
  }

  const selectedDayData = getDayData(selectedDate)

  return (
    <div className="space-y-3">

      {/* ── Phone + tablet: 7-day selector strip ── */}
      <div className="grid grid-cols-7 gap-1 lg:hidden">
        {dates.map(date => {
          const label = formatWeekTimeDayLabel(date)
          const isToday = isTenantToday(date, tenantWorkDate)
          const active  = date === selectedDate
          const day     = getDayData(date)
          const hasPunch = day.sessions.length > 0 || day.entry || day.punches.length > 0
          return (
            <button
              key={date}
              type="button"
              onClick={() => setSelectedDate(date)}
              aria-pressed={active}
              aria-label={label.full}
              className={`min-w-0 flex flex-col items-center justify-center gap-0.5 rounded-xl border px-0.5 py-2.5 transition ${
                active
                  ? 'bg-green-600 border-green-600 text-white'
                  : isToday
                    ? 'bg-white border-green-300 text-green-800'
                    : 'bg-white border-gray-200 text-gray-600'
              }`}
              style={{ minHeight: 60 }}
            >
              <span className="text-[11px] font-bold uppercase leading-none">
                {label.weekdayInitial}
              </span>
              <span className={`text-base font-bold leading-none ${active ? 'text-white' : isToday ? 'text-green-800' : 'text-gray-900'}`}>
                {label.dayNumber}
              </span>
              <span className={`w-1.5 h-1.5 rounded-full ${
                hasPunch ? (active ? 'bg-white' : 'bg-green-500') : 'bg-transparent'
              }`} />
            </button>
          )
        })}
      </div>

      {/* ── Phone + tablet: selected day cards ── */}
      <div className="lg:hidden">
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-lg font-bold text-gray-900">
              {formatWeekTimeDayLabel(selectedDate).full}
            </p>
            {isTenantToday(selectedDate, tenantWorkDate) && (
              <span className="text-xs font-bold text-green-700 bg-green-100 border border-green-200 px-2 py-0.5 rounded-full">
                Today
              </span>
            )}
          </div>
          <DayContent
            day={selectedDayData}
            pendingRequests={getDayRequests(selectedDayData)}
            onRequestPunchEdit={onRequestPunchEdit}
          />
        </div>
      </div>

      {/* ── Desktop: 7-column grid ── */}
      <div className="hidden lg:grid lg:grid-cols-7 gap-2 xl:gap-3 items-start">
        {dates.map(date => {
          const label   = formatWeekTimeDayLabel(date)
          const isToday = isTenantToday(date, tenantWorkDate)
          const day     = getDayData(date)
          const entryRequests = getDayRequests(day)

          return (
            <section
              key={date}
              className={`min-w-0 rounded-2xl border bg-white p-3 shadow-sm space-y-2 ${
                isToday ? 'border-green-300 ring-1 ring-green-200' : 'border-gray-200'
              }`}
            >
              {/* Day header */}
              <div className="border-b border-gray-100 pb-2">
                <p className={`text-lg font-bold leading-tight truncate ${isToday ? 'text-green-800' : 'text-gray-900'}`}>
                  {label.weekday}
                </p>
                <p className={`text-sm font-semibold truncate ${isToday ? 'text-green-700' : 'text-gray-500'}`}>
                  {label.monthDay}
                </p>
                {isToday && (
                  <span className="inline-block mt-0.5 text-[10px] font-bold text-green-700 bg-green-50 border border-green-200 px-1.5 py-0 rounded-full">
                    Today
                  </span>
                )}
              </div>

              {/* Session cards or legacy entry card */}
              <DayContent
                day={day}
                pendingRequests={entryRequests}
                onRequestPunchEdit={onRequestPunchEdit}
                compact
              />
            </section>
          )
        })}
      </div>
    </div>
  )
}

export default EmployeeTimeWeekBoard
