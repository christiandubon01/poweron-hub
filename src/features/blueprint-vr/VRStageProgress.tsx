/**
 * src/features/blueprint-vr/VRStageProgress.tsx
 *
 * VRStageProgress — Visual UI component for displaying construction stage progress.
 *
 * Features:
 *   1. Shows four stages in order: Underground → Rough In → Trim → Finished
 *   2. Each stage displays current state: pending, active, complete, or failed
 *   3. Stages include descriptions oriented to electrical work
 *   4. Reusable via props from parent component
 *   5. Responsive grid layout with clear visual hierarchy
 */

import React, { useMemo } from 'react'
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  Zap,
  AlertTriangle,
} from 'lucide-react'
import { clsx } from 'clsx'
import type { VRStage } from './types'
import {
  STAGE_ORDER,
  STAGE_LABELS,
  STAGE_DESCRIPTIONS,
} from './stages'

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * Represents the current status of a construction stage.
 */
export type StageStatus = 'pending' | 'active' | 'complete' | 'failed'

/**
 * Props for the VRStageProgress component.
 */
export interface VRStageProgressProps {
  /** The status of each stage. Maps stage names to their current status. */
  stageStatuses: Partial<Record<VRStage, StageStatus>>
  /** Optional callback when a stage is clicked (for future interactivity). */
  onStageClick?: (stage: VRStage) => void
  /** Optional CSS class for the container */
  className?: string
}

// ── Helper: Get icon and colors for stage status ─────────────────────────────

interface StageStatusDisplay {
  icon: React.ReactNode
  bgColor: string
  borderColor: string
  textColor: string
  dotColor: string
}

function getStageStatusDisplay(status: StageStatus): StageStatusDisplay {
  switch (status) {
    case 'complete':
      return {
        icon: <CheckCircle2 className="w-5 h-5" />,
        bgColor: 'bg-green-50',
        borderColor: 'border-green-300',
        textColor: 'text-green-900',
        dotColor: 'bg-green-500',
      }
    case 'active':
      return {
        icon: <Zap className="w-5 h-5 animate-pulse" />,
        bgColor: 'bg-blue-50',
        borderColor: 'border-blue-300',
        textColor: 'text-blue-900',
        dotColor: 'bg-blue-500',
      }
    case 'failed':
      return {
        icon: <AlertTriangle className="w-5 h-5" />,
        bgColor: 'bg-red-50',
        borderColor: 'border-red-300',
        textColor: 'text-red-900',
        dotColor: 'bg-red-500',
      }
    case 'pending':
    default:
      return {
        icon: <Clock className="w-5 h-5 text-gray-500" />,
        bgColor: 'bg-gray-50',
        borderColor: 'border-gray-200',
        textColor: 'text-gray-700',
        dotColor: 'bg-gray-400',
      }
  }
}

// ── Helper: Progress connector line ──────────────────────────────────────────

/**
 * Renders a connecting line between stages to show progression.
 * Color changes based on whether the line connects a complete stage to the next.
 */
function StageConnector({
  fromStatus,
  toStatus,
}: {
  fromStatus: StageStatus
  toStatus: StageStatus
}): JSX.Element {
  const isFromComplete = fromStatus === 'complete'
  const lineColor = isFromComplete ? 'bg-green-300' : 'bg-gray-200'

  return (
    <div
      className={clsx(
        'hidden lg:flex absolute top-12 w-full h-1',
        lineColor,
        'transition-colors duration-300'
      )}
      style={{
        left: '50%',
        right: '-50%',
      }}
    />
  )
}

// ── Component: Individual Stage Card ────────────────────────────────────────

interface StageCardProps {
  stage: VRStage
  status: StageStatus
  index: number
  totalStages: number
  onClick?: () => void
}

function StageCard({
  stage,
  status,
  index,
  totalStages,
  onClick,
}: StageCardProps): JSX.Element {
  const label = STAGE_LABELS[stage]
  const description = STAGE_DESCRIPTIONS[stage]
  const display = getStageStatusDisplay(status)

  const isLast = index === totalStages - 1

  return (
    <div className="relative flex flex-col items-center">
      {/* Connector line to next stage (desktop only) */}
      {!isLast && (
        <div className="hidden lg:block absolute top-12 left-1/2 w-full">
          <StageConnector fromStatus={status} toStatus="pending" />
        </div>
      )}

      {/* Stage card */}
      <div
        onClick={onClick}
        className={clsx(
          'relative w-full max-w-xs p-4 rounded-lg border-2 transition-all duration-200',
          display.bgColor,
          display.borderColor,
          onClick && 'cursor-pointer hover:shadow-md',
          status === 'active' && 'ring-2 ring-offset-2 ring-blue-400',
          status === 'failed' && 'ring-2 ring-offset-2 ring-red-400'
        )}
      >
        {/* Status indicator dot */}
        <div
          className={clsx(
            'absolute -top-3 -left-3 w-6 h-6 rounded-full border-2 border-white',
            display.dotColor,
            'flex items-center justify-center'
          )}
        >
          <div className="w-2 h-2 bg-white rounded-full" />
        </div>

        {/* Header: Status icon + stage label */}
        <div className="flex items-center gap-3 mb-2">
          <div className={clsx('flex-shrink-0', display.textColor)}>
            {display.icon}
          </div>
          <div>
            <h3 className={clsx('font-semibold', display.textColor)}>
              {label}
            </h3>
            <p className="text-xs text-gray-500 capitalize">
              {status}
            </p>
          </div>
        </div>

        {/* Description */}
        <p className="text-sm text-gray-700 mt-3 leading-relaxed">
          {description}
        </p>

        {/* Status badge at bottom */}
        <div className="mt-4 flex items-center justify-between">
          <span className={clsx(
            'text-xs font-medium px-2 py-1 rounded',
            status === 'complete' && 'bg-green-200 text-green-800',
            status === 'active' && 'bg-blue-200 text-blue-800',
            status === 'pending' && 'bg-gray-200 text-gray-800',
            status === 'failed' && 'bg-red-200 text-red-800'
          )}>
            {status === 'complete' && 'Completed'}
            {status === 'active' && 'In Progress'}
            {status === 'pending' && 'Pending'}
            {status === 'failed' && 'Failed'}
          </span>
        </div>
      </div>

      {/* Mobile connector (vertical) */}
      {!isLast && (
        <div className="lg:hidden w-1 h-8 bg-gray-200 my-2" />
      )}
    </div>
  )
}

// ── Main Component ──────────────────────────────────────────────────────────

/**
 * VRStageProgress — Display construction stage progress with visual states.
 *
 * @param stageStatuses - Object mapping stage names to their current status
 * @param onStageClick - Optional callback when a stage card is clicked
 * @param className - Optional container CSS class
 *
 * @example
 * ```tsx
 * const [stages, setStages] = useState({
 *   underground: 'complete' as StageStatus,
 *   roughIn: 'active' as StageStatus,
 *   trim: 'pending' as StageStatus,
 *   finished: 'pending' as StageStatus,
 * })
 *
 * return (
 *   <VRStageProgress
 *     stageStatuses={stages}
 *     onStageClick={(stage) => console.log(`Clicked: ${stage}`)}
 *   />
 * )
 * ```
 */
export function VRStageProgress({
  stageStatuses,
  onStageClick,
  className,
}: VRStageProgressProps): JSX.Element {
  // Memoize status defaults to avoid unnecessary re-renders
  const statusesWithDefaults = useMemo(() => {
    return STAGE_ORDER.reduce(
      (acc, stage) => {
        acc[stage] = stageStatuses[stage] ?? 'pending'
        return acc
      },
      {} as Record<VRStage, StageStatus>
    )
  }, [stageStatuses])

  // Calculate overall progress percentage
  const completedCount = STAGE_ORDER.filter(
    (stage) => statusesWithDefaults[stage] === 'complete'
  ).length
  const progressPercent = Math.round(
    (completedCount / STAGE_ORDER.length) * 100
  )

  return (
    <div className={clsx('w-full', className)}>
      {/* Header with progress summary */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Project Construction Stages
        </h2>
        <p className="text-gray-600 mb-4">
          Track electrical work through each phase of construction
        </p>

        {/* Progress bar */}
        <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-green-500 transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <p className="text-sm text-gray-600 mt-2">
          {completedCount} of {STAGE_ORDER.length} stages completed ({progressPercent}%)
        </p>
      </div>

      {/* Stage grid - responsive layout */}
      <div className={clsx(
        'grid gap-6',
        'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
      )}>
        {STAGE_ORDER.map((stage, index) => (
          <StageCard
            key={stage}
            stage={stage}
            status={statusesWithDefaults[stage]}
            index={index}
            totalStages={STAGE_ORDER.length}
            onClick={() => onStageClick?.(stage)}
          />
        ))}
      </div>

      {/* Footer info */}
      <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="flex gap-3">
          <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-900">
            <p className="font-semibold mb-1">Electrical Work Progression</p>
            <p>
              Each stage builds on the previous. Complete all work in one stage
              before moving to the next to ensure safety and code compliance.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}


