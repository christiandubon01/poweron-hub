/**
 * EmployeeMonthCalendar — full-width monthly performance calendar for the
 * Employee Portal Schedule tab (EMPLOYEE-SCHEDULE-MONTH-VIEW-1).
 *
 * Presentation only. It owns no data source and no service call: the Schedule
 * panel coordinates the three existing range reads and passes down one
 * MonthDayMetrics record per visible date.
 *
 * Every day cell shows the same four metric rows in the same order, so the grid
 * never changes shape between days:
 *   Scheduled (blue) · Worked (teal) · Assigned (amber) · Completed (purple)
 *
 * Layout:
 *   < lg — compact month grid (date + four colored values) plus the selected
 *          day's four fully labelled metrics below
 *   >= lg — seven equal columns at full portal width, four labelled rows per cell
 */

import React from 'react'
import { AlertCircle, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import {
  buildWeekdayLabels,
  findDayMetrics,
  formatDayNumber,
  formatFullDayLabel,
  formatMetricCount,
  formatMetricHours,
  formatMonthTitle,
  formatShortDayLabel,
  WEEK_DAY_COUNT,
  type MonthDayMetrics,
  type MonthGrid,
} from './employeeMonthMetrics'

/**
 * The four metrics, in fixed render order. Each entry owns its marker color and
 * value color, and every metric also carries a text label, so the calendar never
 * depends on color alone.
 */
export const MONTH_METRICS = [
  {
    key: 'scheduledHours' as const,
    label: 'Hours Scheduled',
    shortLabel: 'Scheduled',
    marker: 'bg-blue-500',
    value: 'text-blue-700',
    zero: 'text-blue-400',
  },
  {
    key: 'workedHours' as const,
    label: 'Hours Worked',
    shortLabel: 'Worked',
    marker: 'bg-teal-500',
    value: 'text-teal-700',
    zero: 'text-teal-400',
  },
  {
    key: 'assignedTaskCount' as const,
    label: 'Tasks Assigned',
    shortLabel: 'Assigned',
    marker: 'bg-amber-500',
    value: 'text-amber-700',
    zero: 'text-amber-500',
  },
  {
    key: 'completedTaskCount' as const,
    label: 'Tasks Completed',
    shortLabel: 'Completed',
    marker: 'bg-purple-500',
    value: 'text-purple-700',
    zero: 'text-purple-400',
  },
] as const

type MetricKey = (typeof MONTH_METRICS)[number]['key']

/** Hours metrics format as "7.5h"; task metrics as integers. */
function formatMetric(key: MetricKey, day: MonthDayMetrics): string {
  if (key === 'scheduledHours' || key === 'workedHours') {
    return formatMetricHours(day[key])
  }
  return formatMetricCount(day[key])
}

function isZero(key: MetricKey, day: MonthDayMetrics): boolean {
  const raw = Number(day[key])
  return !Number.isFinite(raw) || raw <= 0
}

// -- Legend -------------------------------------------------------------------

/** Compact 2x2 matrix on desktop; wraps to a readable block on small screens. */
export function EmployeeMonthLegend() {
  return (
    <div
      className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:gap-x-5"
      aria-label="Calendar metric legend"
    >
      {MONTH_METRICS.map((metric) => (
        <div key={metric.key} className="flex items-center gap-2 min-w-0">
          <span
            className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${metric.marker}`}
            aria-hidden="true"
          />
          <span className="text-xs font-semibold text-gray-700 whitespace-nowrap">
            {metric.label}
          </span>
        </div>
      ))}
    </div>
  )
}

// -- One day's four metric rows -----------------------------------------------

function MetricRows({ day, compact }: { day: MonthDayMetrics; compact: boolean }) {
  return (
    <dl className="space-y-0.5">
      {MONTH_METRICS.map((metric) => {
        const zero = isZero(metric.key, day)
        return (
          <div key={metric.key} className="flex items-center gap-1.5 min-w-0">
            <span
              className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${metric.marker} ${zero ? 'opacity-40' : ''}`}
              aria-hidden="true"
            />
            <dt
              className={`min-w-0 truncate text-[11px] ${zero ? 'text-gray-400' : 'text-gray-600'} ${
                compact ? 'sr-only' : ''
              }`}
            >
              {metric.shortLabel}
            </dt>
            <dd
              className={`ml-auto text-[11px] font-bold tabular-nums ${
                zero ? metric.zero : metric.value
              }`}
            >
              {formatMetric(metric.key, day)}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

// -- Board --------------------------------------------------------------------

export interface EmployeeMonthCalendarProps {
  grid: MonthGrid
  /** One record per visible date, in grid order. */
  days: MonthDayMetrics[]
  /** Anchor day inside the titled month. */
  monthAnchor: string
  todayKey: string
  selectedDate: string
  isCurrentMonth: boolean
  loading: boolean
  /** Safe, already-sanitized message. Empty when there is no error. */
  errorMessage: string
  onPreviousMonth: () => void
  onNextMonth: () => void
  onToday: () => void
  onSelectDate: (dateKey: string) => void
  /** Existing per-day schedule detail, rendered below the grid. */
  children?: React.ReactNode
}

export function EmployeeMonthCalendar({
  grid,
  days,
  monthAnchor,
  todayKey,
  selectedDate,
  isCurrentMonth,
  loading,
  errorMessage,
  onPreviousMonth,
  onNextMonth,
  onToday,
  onSelectDate,
  children,
}: EmployeeMonthCalendarProps) {
  const weekdayLabels = buildWeekdayLabels()
  const selectedMetrics = findDayMetrics(days, selectedDate)

  const renderDayButton = (day: MonthDayMetrics, compact: boolean) => {
    const selected = day.dateKey === selectedDate
    return (
      <button
        key={day.dateKey}
        type="button"
        onClick={() => onSelectDate(day.dateKey)}
        aria-pressed={selected}
        aria-current={day.isToday ? 'date' : undefined}
        aria-label={`${formatFullDayLabel(day.dateKey)}: ${MONTH_METRICS.map(
          (metric) => `${metric.label} ${formatMetric(metric.key, day)}`,
        ).join(', ')}`}
        className={`min-w-0 text-left rounded-xl border p-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-1 ${
          selected
            ? 'border-green-500 bg-green-50 ring-2 ring-green-500/30'
            : day.isToday
              ? 'border-green-400 bg-white ring-1 ring-green-200'
              : day.isCurrentMonth
                ? 'border-gray-200 bg-white hover:border-green-300'
                : 'border-gray-100 bg-gray-50/70 hover:border-gray-300'
        }`}
      >
        <div className="flex items-baseline justify-between gap-1 mb-1.5">
          <span
            className={`text-sm font-bold tabular-nums ${
              day.isCurrentMonth ? 'text-gray-900' : 'text-gray-400'
            }`}
          >
            {formatDayNumber(day.dateKey)}
          </span>
          {day.isToday ? (
            <span className="text-[10px] font-bold uppercase tracking-wide text-green-700">
              Today
            </span>
          ) : null}
        </div>
        <div className={day.isCurrentMonth ? '' : 'opacity-60'}>
          <MetricRows day={day} compact={compact} />
        </div>
      </button>
    )
  }

  return (
    <div className="space-y-4">
      {/* Calendar header: navigation, month title, legend matrix */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
          <div className="flex items-center gap-2 lg:flex-1">
            <button
              type="button"
              onClick={onPreviousMonth}
              aria-label="Previous month"
              className="flex-shrink-0 flex items-center justify-center rounded-xl border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
              style={{ minHeight: 44, minWidth: 44 }}
            >
              <ChevronLeft size={18} />
            </button>

            <div className="min-w-0 flex-1 text-center">
              <h3 className="text-lg sm:text-xl font-bold text-gray-900 truncate">
                {formatMonthTitle(monthAnchor)}
              </h3>
              <p className="text-sm font-medium text-gray-500">
                {isCurrentMonth ? 'This month' : 'Selected month'}
              </p>
            </div>

            <button
              type="button"
              onClick={onToday}
              disabled={isCurrentMonth}
              className="flex-shrink-0 rounded-xl border border-green-200 bg-green-50 px-4 text-sm font-bold text-green-700 hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
              style={{ minHeight: 44 }}
            >
              Today
            </button>

            <button
              type="button"
              onClick={onNextMonth}
              aria-label="Next month"
              className="flex-shrink-0 flex items-center justify-center rounded-xl border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
              style={{ minHeight: 44, minWidth: 44 }}
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Upper-right legend matrix on desktop; below the heading otherwise */}
          <div className="lg:flex-shrink-0 border-t border-gray-100 pt-3 lg:border-t-0 lg:pt-0">
            <EmployeeMonthLegend />
          </div>
        </div>
      </div>

      {errorMessage ? (
        <div
          className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5"
          role="alert"
        >
          <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-700 break-words">{errorMessage}</p>
        </div>
      ) : null}

      {/* The calendar frame stays mounted while a month loads */}
      <div className="relative">
        {loading ? (
          <div
            className="absolute inset-0 z-10 flex items-start justify-center bg-white/60 rounded-2xl pt-6"
            role="status"
          >
            <span className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-600 shadow-sm">
              <Loader2 size={16} className="animate-spin text-green-600" />
              Loading month...
            </span>
          </div>
        ) : null}

        {/* Weekday header row - Monday first, matching the portal week */}
        <div className="grid grid-cols-7 gap-1 lg:gap-2 mb-1 lg:mb-2" aria-hidden="true">
          {weekdayLabels.map((label) => (
            <div key={label} className="min-w-0 text-center">
              <span className="text-sm lg:text-base font-bold text-gray-700">
                <span className="lg:hidden">{label.slice(0, 1)}</span>
                <span className="hidden lg:inline">{label}</span>
              </span>
            </div>
          ))}
        </div>

        {/* Desktop: seven equal columns, four labelled metric rows per day */}
        <div className="hidden lg:grid lg:grid-cols-7 gap-2 items-stretch">
          {days.map((day) => renderDayButton(day, false))}
        </div>

        {/* Phone + tablet: compact grid - same seven columns, values only */}
        <div className="grid grid-cols-7 gap-1 lg:hidden items-stretch">
          {days.map((day) => renderDayButton(day, true))}
        </div>
      </div>

      {/* Phone + tablet: the selected day's four fully labelled metrics */}
      <div className="lg:hidden bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-3">
        <p className="text-base font-bold text-gray-900">{formatFullDayLabel(selectedDate)}</p>
        {selectedMetrics ? (
          <dl className="grid grid-cols-2 gap-3">
            {MONTH_METRICS.map((metric) => {
              const zero = isZero(metric.key, selectedMetrics)
              return (
                <div key={metric.key} className="min-w-0 rounded-xl border border-gray-200 p-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full flex-shrink-0 ${metric.marker}`}
                      aria-hidden="true"
                    />
                    <dt className="text-xs font-semibold text-gray-600 truncate">{metric.label}</dt>
                  </div>
                  <dd
                    className={`mt-1 text-lg font-bold tabular-nums ${
                      zero ? metric.zero : metric.value
                    }`}
                  >
                    {formatMetric(metric.key, selectedMetrics)}
                  </dd>
                </div>
              )
            })}
          </dl>
        ) : (
          <p className="text-sm text-gray-600">No calendar data for this day.</p>
        )}
      </div>

      {/* Existing per-day schedule detail (unchanged Start/Done behavior) */}
      {children}

      <p className="text-xs text-gray-500">
        Showing {grid.weekCount * WEEK_DAY_COUNT} days from {formatShortDayLabel(grid.visibleStart)}{' '}
        to {formatShortDayLabel(grid.visibleEnd)}. Worked hours match My Time.
      </p>
    </div>
  )
}

export default EmployeeMonthCalendar
