// @ts-nocheck
/**
 * EmployeeJobPicker — Job/Project selector for the Clock tab.
 *
 * Supports two selection modes:
 *   ASSIGNMENT:    employee picks a specific Work Package/Work Order
 *   PROJECT_ONLY:  employee picks the Project header — no Work Package needed
 *
 * Projects without any active assignment still appear and are selectable.
 * Projects that have assignments show both the header (project-only) and
 * each individual assignment (specific Work Package).
 *
 * Props:
 *   assignments    — eligible assignments from getMyEligibleAssignments()
 *   activeProjects — employee-safe active projects from getEmployeeActiveProjects()
 *   selection      — current JobSelection (or null)
 *   onSelect       — called when the employee picks a selection (or null to clear)
 *
 * Security: never displays unrelated org records; relies on server RPCs for
 * org-scoped RLS filtering.
 */

import React, { useMemo } from 'react'
import { Briefcase, Building2, ChevronRight } from 'lucide-react'
import type { EligibleAssignment, EmployeeActiveProject } from '@/services/employeeTimeService'

// ── Selection type (shared with EmployeeTimeClock) ────────────────────────────

export type JobSelection =
  | { type: 'assignment'; assignmentId: string; projectId: string; projectName: string; workPackageName: string }
  | { type: 'project_only'; projectId: string; projectName: string }
  | null

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
  activeProjects: EmployeeActiveProject[]
  selection: JobSelection
  onSelect: (selection: JobSelection) => void
}

export function EmployeeJobPicker({
  assignments,
  activeProjects,
  selection,
  onSelect,
}: EmployeeJobPickerProps) {
  // Merge projects from assignments + standalone active projects, deduplicated by id
  const projectGroups = useMemo(() => {
    // Build map of projectId → { project, assignments[] }
    type Group = {
      projectId: string
      projectName: string
      items: EligibleAssignment[]
    }

    const map = new Map<string, Group>()

    // Seed from assignments (always include their projects)
    for (const a of assignments) {
      if (!map.has(a.project_id)) {
        map.set(a.project_id, {
          projectId: a.project_id,
          projectName: a.project_name,
          items: [],
        })
      }
      map.get(a.project_id)!.items.push(a)
    }

    // Add projects that have no assignments yet
    for (const p of activeProjects) {
      if (!map.has(p.id)) {
        map.set(p.id, { projectId: p.id, projectName: p.name, items: [] })
      }
    }

    return Array.from(map.values()).sort((a, b) => a.projectName.localeCompare(b.projectName))
  }, [assignments, activeProjects])

  if (projectGroups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 px-4 py-5 text-center space-y-1.5">
        <Briefcase className="w-5 h-5 text-gray-300 mx-auto" />
        <p className="text-sm font-semibold text-gray-500">No active work available</p>
        <p className="text-xs text-gray-400">
          Ask your manager to assign a Work Order or start a new project.
        </p>
      </div>
    )
  }

  const selectionKey =
    !selection ? null
    : selection.type === 'assignment' ? `a:${selection.assignmentId}`
    : `p:${selection.projectId}`

  return (
    <div className="space-y-4">
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">
        Select Work
      </p>

      {projectGroups.map(group => {
        const projectOnlyKey = `p:${group.projectId}`
        const isProjectSelected = selectionKey === projectOnlyKey

        return (
          <div key={group.projectId} className="space-y-1.5">
            {/* Project header — click to select Project Only */}
            <button
              type="button"
              onClick={() => {
                if (isProjectSelected) {
                  onSelect(null)
                } else {
                  onSelect({
                    type: 'project_only',
                    projectId: group.projectId,
                    projectName: group.projectName,
                  })
                }
              }}
              aria-pressed={isProjectSelected}
              className={`w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                isProjectSelected
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-gray-50 border-gray-200 text-gray-700 hover:border-blue-300 hover:bg-blue-50'
              }`}
            >
              <Building2
                className={`w-4 h-4 flex-shrink-0 ${isProjectSelected ? 'text-white' : 'text-blue-400'}`}
              />
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-bold truncate ${isProjectSelected ? 'text-white' : 'text-gray-900'}`}>
                  {group.projectName}
                </p>
                <p className={`text-[11px] mt-0.5 ${isProjectSelected ? 'text-blue-100' : 'text-gray-400'}`}>
                  {isProjectSelected ? 'Project selected — Work Package optional' : 'Tap to clock in to this project'}
                </p>
              </div>
              <ChevronRight
                className={`w-4 h-4 flex-shrink-0 ${isProjectSelected ? 'text-white' : 'text-gray-300'}`}
              />
            </button>

            {/* Work Package options under the project */}
            {group.items.map(a => {
              const assignKey = `a:${a.id}`
              const isSelected = selectionKey === assignKey
              const due = formatDueDate(a.due_date)

              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    if (isSelected) {
                      onSelect(null)
                    } else {
                      onSelect({
                        type: 'assignment',
                        assignmentId: a.id,
                        projectId: a.project_id,
                        projectName: a.project_name,
                        workPackageName: a.work_package_name,
                      })
                    }
                  }}
                  aria-pressed={isSelected}
                  className={`w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ml-4 ${
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
        )
      })}
    </div>
  )
}

export default EmployeeJobPicker
