// @ts-nocheck
/**
 * EmployeeMyTimePanel — full-width weekly time board (EMPLOYEE-MY-TIME-WEEK-1).
 *
 * Replaces the narrow vertical list with a seven-column week view.
 * Navigation (Prev / Today / Next), week totals, and data loading stay here.
 * Presentation delegates to EmployeeTimeWeekBoard.
 * Punch edit requests delegate to EmployeePunchEditRequestDialog.
 *
 * refreshKey prop: incremented by EmployeePortal after a successful Clock punch.
 * Adding it to the load effect means My Time re-fetches without a page reload.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Clock, Loader2, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  getMyTimeSummary,
  getMyPunchEditRequests,
  getCurrentWeekRangeFromTenantDate,
  shiftWeekRange,
  type EmployeeMyTimeSummary,
  type EmployeeMyTimeDay,
  type WeekRange,
  type PunchEditRequest,
} from '@/services/employeePortalService'
import { getTenantWorkDate } from '@/services/employeeTimeService'
import { formatWeekTimeBoardLabel } from './employeeWeeklyTime'
import { EmployeeTimeWeekBoard } from './EmployeeTimeWeekBoard'
import { EmployeePunchEditRequestDialog } from './EmployeePunchEditRequestDialog'

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatMinutes(mins: number | null | undefined): string {
  if (mins == null || isNaN(mins)) return '—'
  const total = Math.max(0, Math.round(mins))
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${h}h ${String(m).padStart(2, '0')}m`
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface EmployeeMyTimePanelProps {
  /**
   * Increment this number from EmployeePortal after a successful Clock punch.
   * Including it in the load effect forces a re-fetch without a page reload.
   */
  refreshKey?: number
}

export function EmployeeMyTimePanel({ refreshKey = 0 }: EmployeeMyTimePanelProps) {
  const tenantWorkDate = getTenantWorkDate()

  const [range, setRange] = useState<WeekRange>(() => getCurrentWeekRangeFromTenantDate())
  const [data, setData] = useState<EmployeeMyTimeSummary | null>(null)
  const [requests, setRequests] = useState<PunchEditRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Punch edit dialog state
  const [dialogEntryId, setDialogEntryId]     = useState<string | null>(null)
  const [dialogDay, setDialogDay]             = useState<EmployeeMyTimeDay | null>(null)
  const [dialogSessionId, setDialogSessionId] = useState<string | null>(null)

  const thisWeekRange = useMemo(() => getCurrentWeekRangeFromTenantDate(), [])
  const isThisWeek = range.startDate === thisWeekRange.startDate

  const load = useCallback(async (r: WeekRange) => {
    setLoading(true)
    setError('')

    const res = await getMyTimeSummary(r.startDate, r.endDate)
    if (!res.success) {
      setData(null)
      setRequests([])
      setError(res.error || 'Could not load your time.')
      setLoading(false)
      return
    }
    setData(res.data)

    // Load punch edit requests for the visible entries
    const entryIds = (res.data?.days ?? [])
      .map(d => d.entry?.id)
      .filter((id): id is string => !!id)

    if (entryIds.length > 0) {
      const reqRes = await getMyPunchEditRequests(entryIds)
      setRequests(reqRes.success ? (reqRes.data ?? []) : [])
    } else {
      setRequests([])
    }

    setLoading(false)
  }, [])

  // Re-load when week changes OR when refreshKey changes (triggered by Clock punch)
  useEffect(() => {
    load(range)
  }, [range, load, refreshKey])

  function handlePreviousWeek() {
    setRange(r => shiftWeekRange(r, -1))
  }
  function handleNextWeek() {
    setRange(r => shiftWeekRange(r, 1))
  }
  function handleToday() {
    setRange(getCurrentWeekRangeFromTenantDate())
  }

  function handleRequestPunchEdit(
    entryId: string,
    day: EmployeeMyTimeDay,
    sessionId?: string | null,
  ) {
    setDialogEntryId(entryId)
    setDialogDay(day)
    setDialogSessionId(sessionId ?? null)
  }

  function handleDialogClose() {
    setDialogEntryId(null)
    setDialogDay(null)
    setDialogSessionId(null)
  }

  function handleRequestSubmitted(newRequest: PunchEditRequest) {
    setRequests(prev => [newRequest, ...prev])
    setDialogEntryId(null)
    setDialogDay(null)
    setDialogSessionId(null)
  }

  const days = data?.days ?? []

  // Pending request types for the selected entry/session (for dialog dup guard).
  // When a session is targeted, only count requests scoped to that session_id.
  const pendingPunchTypesForDialog = useMemo(() => {
    if (!dialogEntryId) return new Set<string>()
    const entryRequests = requests.filter(r => {
      if (r.time_entry_id !== dialogEntryId || r.status !== 'pending') return false
      if (dialogSessionId) return r.session_id === dialogSessionId
      return !r.session_id
    })
    return new Set(entryRequests.map(r => r.punch_type))
  }, [dialogEntryId, dialogSessionId, requests])

  return (
    <div className="space-y-4">

      {/* Navigation header */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex items-center gap-3">
          {/* Prev */}
          <button
            type="button"
            onClick={handlePreviousWeek}
            aria-label="Previous week"
            className="flex-shrink-0 flex items-center justify-center rounded-xl border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 transition"
            style={{ minHeight: 44, minWidth: 44 }}
          >
            <ChevronLeft size={18} />
          </button>

          {/* Week range + status */}
          <div className="min-w-0 flex-1 text-center">
            <h3 className="text-xl font-bold text-gray-900 truncate">
              {formatWeekTimeBoardLabel(range)}
            </h3>
            <p className="text-sm font-medium text-gray-500">
              {isThisWeek ? 'This week' : 'Selected week'}
            </p>
          </div>

          {/* Today */}
          <button
            type="button"
            onClick={handleToday}
            disabled={isThisWeek}
            className="flex-shrink-0 rounded-xl border border-green-200 bg-green-50 px-4 text-sm font-bold text-green-700 hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed transition"
            style={{ minHeight: 44 }}
          >
            Today
          </button>

          {/* Next */}
          <button
            type="button"
            onClick={handleNextWeek}
            aria-label="Next week"
            className="flex-shrink-0 flex items-center justify-center rounded-xl border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 transition"
            style={{ minHeight: 44, minWidth: 44 }}
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {/* Week totals */}
        {data && (
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="bg-green-50 border border-green-100 rounded-xl px-3 py-2.5">
              <p className="text-[11px] text-green-700/70 uppercase tracking-wide font-medium">
                Paid This Week
              </p>
              <p className="text-xl font-bold text-green-700 tabular-nums">
                {formatMinutes(data.totalPaidMinutes)}
              </p>
            </div>
            <div className="bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5">
              <p className="text-[11px] text-gray-400 uppercase tracking-wide font-medium">
                Lunch This Week
              </p>
              <p className="text-xl font-bold text-gray-700 tabular-nums">
                {formatMinutes(data.totalLunchMinutes)}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm flex items-center justify-center gap-2 text-sm text-gray-500">
          <Loader2 size={16} className="animate-spin text-green-600" />
          Loading your time…
        </div>
      )}

      {/* Weekly board — keyed by range.startDate so the phone strip resets on nav */}
      {!loading && (
        <EmployeeTimeWeekBoard
          key={range.startDate}
          range={range}
          days={days}
          pendingRequests={requests}
          tenantWorkDate={tenantWorkDate}
          onRequestPunchEdit={handleRequestPunchEdit}
        />
      )}

      {/* Punch edit request dialog */}
      {dialogEntryId && dialogDay && (
        <EmployeePunchEditRequestDialog
          timeEntryId={dialogEntryId}
          workDate={dialogDay.workDate}
          day={dialogDay}
          sessionId={dialogSessionId}
          pendingPunchTypes={pendingPunchTypesForDialog as Set<any>}
          onClose={handleDialogClose}
          onSubmitted={handleRequestSubmitted}
        />
      )}
    </div>
  )
}

export default EmployeeMyTimePanel
