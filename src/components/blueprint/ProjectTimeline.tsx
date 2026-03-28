/**
 * ProjectTimeline — Visual phase timeline for a project.
 *
 * Features:
 * - Horizontal phase bars
 * - Checklist progress indicators
 * - Status color coding
 * - Date ranges
 * - Expandable checklist view
 */

import { useState } from 'react'
import { ChevronDown, CheckCircle2, Circle, Clock } from 'lucide-react'
import { clsx } from 'clsx'

// ── Types ───────────────────────────────────────────────────────────────────

interface ChecklistItem {
  item: string
  completed: boolean
  completedBy?: string | null
  completedAt?: string | null
}

interface Phase {
  name: string
  status: 'pending' | 'in_progress' | 'completed'
  checklist: ChecklistItem[]
  started_at?: string | null
  completed_at?: string | null
}

export interface ProjectTimelineProps {
  phases: Phase[]
  onChecklistItemClick?: (phaseIndex: number, checklistIndex: number) => void
}

// ── Component ───────────────────────────────────────────────────────────────

export function ProjectTimeline({ phases, onChecklistItemClick }: ProjectTimelineProps) {
  const [expandedPhases, setExpandedPhases] = useState<Set<number>>(new Set([0]))

  const togglePhaseExpanded = (index: number) => {
    const next = new Set(expandedPhases)
    if (next.has(index)) {
      next.delete(index)
    } else {
      next.add(index)
    }
    setExpandedPhases(next)
  }

  // ── Calculate phase progress ───────────────────────────────────────────────
  const getPhaseProgress = (phase: Phase): number => {
    if (phase.checklist.length === 0) return 0
    const completed = phase.checklist.filter((item) => item.completed).length
    return Math.round((completed / phase.checklist.length) * 100)
  }

  // ── Get status color ────────────────────────────────────────────────────────
  const getStatusColor = (status: Phase['status']): string => {
    switch (status) {
      case 'completed':
        return 'bg-emerald-500'
      case 'in_progress':
        return 'bg-cyan-400'
      case 'pending':
      default:
        return 'bg-gray-600'
    }
  }

  const getStatusLabel = (status: Phase['status']): string => {
    switch (status) {
      case 'completed':
        return 'Completed'
      case 'in_progress':
        return 'In Progress'
      case 'pending':
      default:
        return 'Pending'
    }
  }

  // ── Format date ───────────────────────────────────────────────────────────
  const formatDate = (dateStr?: string | null): string => {
    if (!dateStr) return ''
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-100">Project Timeline</h3>

      <div className="space-y-3">
        {phases.map((phase, phaseIndex) => {
          const isExpanded = expandedPhases.has(phaseIndex)
          const progress = getPhaseProgress(phase)
          const statusColor = getStatusColor(phase.status)

          return (
            <div
              key={phaseIndex}
              className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden"
            >
              {/* Phase header */}
              <button
                onClick={() => togglePhaseExpanded(phaseIndex)}
                className="w-full p-4 flex items-center justify-between hover:bg-gray-800/70 transition-colors text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <h4 className="font-semibold text-gray-100">{phase.name}</h4>
                    <span
                      className={clsx(
                        'px-2 py-1 text-xs font-medium text-white rounded',
                        statusColor
                      )}
                    >
                      {getStatusLabel(phase.status)}
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="mb-2">
                    <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className={clsx(
                          'h-full transition-all',
                          progress === 100 ? 'bg-emerald-500' : 'bg-cyan-400'
                        )}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-400 mt-1 mt-1">
                      {progress}% complete ({phase.checklist.filter((i) => i.completed).length}/{phase.checklist.length})
                    </p>
                  </div>

                  {/* Date range */}
                  {phase.started_at && (
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <Clock className="w-3 h-3" />
                      <span>
                        {formatDate(phase.started_at)}
                        {phase.completed_at && ` → ${formatDate(phase.completed_at)}`}
                      </span>
                    </div>
                  )}
                </div>

                {/* Chevron */}
                <ChevronDown
                  className={clsx('w-5 h-5 text-gray-500 flex-shrink-0 transition-transform', isExpanded && 'rotate-180')}
                />
              </button>

              {/* Expandable checklist */}
              {isExpanded && (
                <div className="border-t border-gray-700 bg-gray-900/30 p-4 space-y-2">
                  {phase.checklist.length === 0 ? (
                    <p className="text-sm text-gray-500">No checklist items</p>
                  ) : (
                    phase.checklist.map((item, itemIndex) => (
                      <button
                        key={itemIndex}
                        onClick={() => onChecklistItemClick?.(phaseIndex, itemIndex)}
                        className={clsx(
                          'flex items-center gap-3 w-full p-2 rounded text-left transition-colors',
                          item.completed
                            ? 'text-gray-400 hover:bg-gray-700/30'
                            : 'text-gray-300 hover:bg-gray-700/50'
                        )}
                      >
                        {item.completed ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                        ) : (
                          <Circle className="w-5 h-5 text-gray-600 flex-shrink-0" />
                        )}

                        <div className="flex-1 min-w-0">
                          <p className={clsx('text-sm', item.completed && 'line-through')}>
                            {item.item}
                          </p>
                          {item.completed && item.completedAt && (
                            <p className="text-xs text-gray-500 mt-1">
                              Completed {new Date(item.completedAt).toLocaleDateString()}
                              {item.completedBy && ` by ${item.completedBy}`}
                            </p>
                          )}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
