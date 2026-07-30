/**
 * EmployeeArchivedTaskList — read-only Archived bucket inside the existing
 * My Tasks workflow (EMPLOYEE-WEEKLY-TASK-VIEW-1).
 *
 * Source: the same get_my_employee_tasks rows the weekly board uses — that RPC
 * has no status filter, so completed assignments stay queryable indefinitely.
 * Nothing here writes: no updateMyEmployeeTask, no status control, no hours or
 * notes input, no re-complete, no delete. Full details expand inline (no
 * modal-on-modal) and the immutable Work Order + private snapshot gallery open
 * through the unchanged EmployeeWorkOrderViewer.
 */

import React from 'react'
import { Archive, CheckCircle2, ChevronDown, ChevronUp, FileText } from 'lucide-react'
import type { EmployeeMyTask } from '@/services/employeeTaskAssignmentService'
import { formatDayLabel } from './employeeWeeklyTasks'

function formatCompletedAt(iso: string | null | undefined): string {
  if (!iso) return 'Completion date not recorded'
  const date = new Date(iso)
  if (isNaN(date.getTime())) return 'Completion date not recorded'
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatHours(hours: number | null | undefined): string {
  if (hours == null) return 'No hours recorded'
  const value = Number(hours)
  if (!Number.isFinite(value)) return 'No hours recorded'
  return `${value}h recorded`
}

export interface EmployeeArchivedTaskListProps {
  tasks: EmployeeMyTask[]
  expandedId: string | null
  /** Shared Work Order action name, owned by EmployeeMyTasksPanel. */
  viewWorkOrderLabel: string
  onToggleExpanded: (assignmentId: string) => void
  onViewWorkOrder: (task: EmployeeMyTask) => void
}

export function EmployeeArchivedTaskList({
  tasks,
  expandedId,
  viewWorkOrderLabel,
  onToggleExpanded,
  onViewWorkOrder,
}: EmployeeArchivedTaskListProps) {
  if (tasks.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm text-center">
        <p className="text-base font-bold text-gray-900">No completed tasks yet</p>
        <p className="text-sm text-gray-500 mt-2">
          Tasks you mark complete move here and stay available.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Archive className="w-4 h-4 text-gray-500" />
          <p className="text-sm font-bold text-gray-900">Archived</p>
        </div>
        <span className="text-xs font-bold text-gray-500">
          {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {tasks.map((task) => {
          const expanded = expandedId === task.id
          const completedLabel = formatCompletedAt(task.completed_at)
          const dueLabel = task.due_date ? formatDayLabel(task.due_date).full : 'No due date'

          return (
            <div
              key={task.id}
              className="min-w-0 bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-2.5"
            >
              {/* Compact summary */}
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-bold text-gray-900 break-words">{task.work_package_name}</p>
                <p className="text-xs text-gray-500 break-words">{task.project_name || 'Project'}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-green-100 text-green-700 border-green-200">
                    <CheckCircle2 size={12} />
                    Completed
                  </span>
                  <span className="text-[11px] text-gray-500">{completedLabel}</span>
                  <span className="text-[11px] text-gray-400">{formatHours(task.hours_spent)}</span>
                </div>
              </div>

              {task.completion_notes ? (
                <p className="text-xs text-gray-600 whitespace-pre-wrap break-words line-clamp-2">
                  {task.completion_notes}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onToggleExpanded(task.id)}
                  aria-expanded={expanded}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3 text-xs font-bold text-gray-700 hover:bg-gray-50"
                >
                  {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {expanded ? 'Hide details' : 'View details'}
                </button>
                <button
                  type="button"
                  onClick={() => onViewWorkOrder(task)}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-3 text-xs font-bold text-green-700 hover:bg-green-100"
                >
                  <FileText size={14} />
                  {viewWorkOrderLabel}
                </button>
              </div>

              {/* Full read-only details */}
              {expanded && (
                <dl className="border-t border-gray-100 pt-2.5 space-y-2">
                  <div>
                    <dt className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Project</dt>
                    <dd className="text-xs text-gray-800 break-words">{task.project_name || 'Project'}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Due date</dt>
                    <dd className="text-xs text-gray-800">{dueLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Completed</dt>
                    <dd className="text-xs text-gray-800">{completedLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Hours worked</dt>
                    <dd className="text-xs text-gray-800">{formatHours(task.hours_spent)}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Notes / reason</dt>
                    <dd className="text-xs text-gray-800 whitespace-pre-wrap break-words">
                      {task.completion_notes || 'No notes recorded'}
                    </dd>
                  </div>
                  <p className="text-[11px] text-gray-400">
                    Archived tasks are read-only. Ask your team lead if something needs to change.
                  </p>
                </dl>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default EmployeeArchivedTaskList
