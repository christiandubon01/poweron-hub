// @ts-nocheck
/**
 * EmployeeJobPicker — Job selector for the Clock tab (EMPLOYEE-JOB-CLOCK-SESSIONS-1).
 *
 * Displays assigned + in_progress Work Orders grouped by project. The employee
 * selects one; the parent Clock card shows a confirmation summary before
 * enabling the Clock In button.
 *
 * Props:
 *   assignments   — eligible assignments from getMyEligibleAssignments()
 *   selectedId    — currently selected assignment id (or null)
 *   onSelect      — called when the employee taps an option (or null to clear)
 *
 * Security: never displays unrelated org records; relies on the server RPC's
 * org-scoped RLS for eligibility filtering. No client-side trust of server labels.
 */

import React, { useMemo } from 'react'
import { Briefcase, ChevronRight } from 'lucide-react'
import type { EligibleAssignment } from '@/services/employeeTimeService'

// ── Formatting helpers ─────────────────────────────────────────────────────────

function formatDueDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return ''
  return new Date(y, m - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// ── Component ──────────────────────────────────────────────────────────────────

export interface EmployeeJobPickerProps {
  assignments: EligibleAssignment[]
  selectedId: string | null
  onSelect: (assignmentId: string | null) => void
}

export function EmployeeJobPicker({
  assignments,
  selectedId,
  onSelect,
}: EmployeeJobPickerProps) {
  // Group assignments by project_id for hierarchical display
  const groups = useMemo<Array<{ projectId: string; projectName: string; items: EligibleAssignment[] }>>(() => {
    const map = new Map<string, { projectId: string; projectName: string; items: EligibleAssignment[] }>()
    for (const a of assignments) {
      if (!map.has(a.project_id)) {
        map.set(a.project_id, { projectId: a.project_id, projectName: a.project_name, items: [] })
      }
      map.get(a.project_id)!.items.push(a)
    }
    return Array.from(map.values()).sort((a, b) => a.projectName.localeCompare(b.projectName))
  }, [assignments])

  if (assignments.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 px-4 py-5 text-center space-y-1.5">
        <Briefcase className="w-5 h-5 text-gray-300 mx-auto" />
        <p className="text-sm font-semibold text-gray-500">No active Work Orders</p>
        <p className="text-xs text-gray-400">
          Ask your manager to assign a Work Order before clocking in.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">
        Work Job
      </p>
      {groups.map(group => (
        <div key={group.projectId} className="space-y-1">
          {/* Project heading */}
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide px-1">
            {group.projectName}
          </p>
          {/* Work Order options */}
          {group.items.map(a => {
            const isSelected = a.id === selectedId
            const due = formatDueDate(a.due_date)
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onSelect(isSelected ? null : a.id)}
                aria-pressed={isSelected}
                className={`w-full flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${
                  isSelected
                    ? 'bg-green-600 border-green-600 text-white'
                    : 'bg-white border-gray-200 text-gray-700 hover:border-green-300 hover:bg-green-50'
                }`}
              >
                <Briefcase
                  className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-white' : 'text-gray-400'}`}
                />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold truncate ${isSelected ? 'text-white' : 'text-gray-900'}`}>
                    {a.work_package_name}
                  </p>
                  {due && (
                    <p className={`text-[11px] mt-0.5 ${isSelected ? 'text-green-100' : 'text-gray-400'}`}>
                      Due {due}
                    </p>
                  )}
                </div>
                <ChevronRight
                  className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-white' : 'text-gray-300'}`}
                />
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

export default EmployeeJobPicker
