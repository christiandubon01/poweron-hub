// @ts-nocheck
/**
 * HunterPlaybookView — Interactive expansion playbook checklist (HT8)
 *
 * Features:
 * - Progress bar at top showing completion percentage
 * - Steps grouped by category (collapsible)
 * - Each step: checkbox + text + editable notes + category badge
 * - Categories color-coded: crew (blue), financial (green), licensing (amber), timeline (purple)
 * - "Re-score this lead" button when progress > 70%
 * - Persists across sessions via HunterPlaybookGenerator service
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react'
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  RefreshCw,
  Users,
  DollarSign,
  FileText,
  Clock,
  Package,
  UserCheck,
  Handshake,
  MapPin,
  BarChart2,
  Loader2,
} from 'lucide-react'
import clsx from 'clsx'
import type {
  ExpansionPlaybookStep,
  SavedPlaybook,
  PlaybookCategory,
} from '@/services/hunter/HunterPlaybookGenerator'
import {
  updateStepStatus,
  checkPlaybookProgress,
} from '@/services/hunter/HunterPlaybookGenerator'

// ─── Category Config ──────────────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<
  PlaybookCategory,
  { label: string; color: string; bg: string; border: string; icon: React.ElementType }
> = {
  gap_analysis: {
    label: 'Gap Analysis',
    color: 'text-rose-400',
    bg: 'bg-rose-900/30',
    border: 'border-rose-700/50',
    icon: BarChart2,
  },
  crew: {
    label: 'Crew',
    color: 'text-blue-400',
    bg: 'bg-blue-900/30',
    border: 'border-blue-700/50',
    icon: Users,
  },
  financial: {
    label: 'Financial',
    color: 'text-green-400',
    bg: 'bg-green-900/30',
    border: 'border-green-700/50',
    icon: DollarSign,
  },
  licensing: {
    label: 'Licensing',
    color: 'text-amber-400',
    bg: 'bg-amber-900/30',
    border: 'border-amber-700/50',
    icon: FileText,
  },
  timeline: {
    label: 'Timeline',
    color: 'text-purple-400',
    bg: 'bg-purple-900/30',
    border: 'border-purple-700/50',
    icon: Clock,
  },
  materials: {
    label: 'Materials',
    color: 'text-cyan-400',
    bg: 'bg-cyan-900/30',
    border: 'border-cyan-700/50',
    icon: Package,
  },
  client: {
    label: 'Client',
    color: 'text-pink-400',
    bg: 'bg-pink-900/30',
    border: 'border-pink-700/50',
    icon: UserCheck,
  },
  subcontractor: {
    label: 'Subcontractor',
    color: 'text-indigo-400',
    bg: 'bg-indigo-900/30',
    border: 'border-indigo-700/50',
    icon: Handshake,
  },
  permitting: {
    label: 'Permitting',
    color: 'text-orange-400',
    bg: 'bg-orange-900/30',
    border: 'border-orange-700/50',
    icon: MapPin,
  },
}

// Category display order
const CATEGORY_ORDER: PlaybookCategory[] = [
  'gap_analysis',
  'crew',
  'financial',
  'licensing',
  'permitting',
  'materials',
  'timeline',
  'subcontractor',
  'client',
]

// ─── Sub-components ───────────────────────────────────────────────────────────

interface StepRowProps {
  step: ExpansionPlaybookStep
  playbookId: string
  onToggle: (stepId: string, checked: boolean) => void
  onNotesChange: (stepId: string, notes: string) => void
}

function StepRow({ step, playbookId, onToggle, onNotesChange }: StepRowProps) {
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesValue, setNotesValue] = useState(step.notes ?? '')
  const [saving, setSaving] = useState(false)

  const cfg = CATEGORY_CONFIG[step.category] ?? CATEGORY_CONFIG.gap_analysis
  const Icon = cfg.icon

  const handleToggle = useCallback(async () => {
    setSaving(true)
    onToggle(step.id, !step.checked)
    try {
      await updateStepStatus(playbookId, step.id, !step.checked, notesValue)
    } finally {
      setSaving(false)
    }
  }, [playbookId, step.id, step.checked, notesValue, onToggle])

  const handleNotesSave = useCallback(async () => {
    setSaving(true)
    onNotesChange(step.id, notesValue)
    try {
      await updateStepStatus(playbookId, step.id, step.checked, notesValue)
    } finally {
      setSaving(false)
      setEditingNotes(false)
    }
  }, [playbookId, step.id, step.checked, notesValue, onNotesChange])

  return (
    <div
      className={clsx(
        'rounded border p-3 transition-all',
        step.checked
          ? 'border-gray-700 bg-gray-900/40 opacity-70'
          : `${cfg.border} ${cfg.bg}`
      )}
    >
      {/* Step header row */}
      <div className="flex items-start gap-3">
        {/* Checkbox / loader */}
        <button
          onClick={handleToggle}
          disabled={saving}
          className="mt-0.5 flex-shrink-0 text-gray-300 hover:text-white transition-colors"
          title={step.checked ? 'Mark incomplete' : 'Mark complete'}
        >
          {saving ? (
            <Loader2 size={18} className="animate-spin text-gray-500" />
          ) : step.checked ? (
            <CheckCircle2 size={18} className="text-emerald-400" />
          ) : (
            <Circle size={18} className="text-gray-500" />
          )}
        </button>

        {/* Step content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Step number */}
            <span className="text-xs font-mono text-gray-500">#{step.step_number}</span>
            {/* Category badge */}
            <span
              className={clsx(
                'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium',
                cfg.color,
                'bg-black/20'
              )}
            >
              <Icon size={10} />
              {cfg.label}
            </span>
            {/* Days estimate */}
            <span className="text-xs text-gray-500">{step.estimated_days}d</span>
          </div>

          <p
            className={clsx(
              'text-sm mt-1 leading-snug',
              step.checked ? 'line-through text-gray-500' : 'text-gray-200'
            )}
          >
            {step.text}
          </p>

          {/* Dependencies */}
          {step.dependencies.length > 0 && (
            <p className="text-xs text-gray-600 mt-1">
              Requires: {step.dependencies.join(', ')}
            </p>
          )}

          {/* Notes section */}
          {editingNotes ? (
            <div className="mt-2 space-y-1">
              <textarea
                value={notesValue}
                onChange={(e) => setNotesValue(e.target.value)}
                placeholder="Add notes for this step..."
                rows={2}
                className="w-full bg-gray-950 border border-gray-700 text-gray-200 text-xs rounded px-2 py-1.5 resize-none focus:outline-none focus:border-blue-500"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleNotesSave}
                  disabled={saving}
                  className="text-xs px-2 py-1 bg-blue-700 hover:bg-blue-600 text-white rounded transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={() => { setEditingNotes(false); setNotesValue(step.notes ?? '') }}
                  className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-1.5 flex items-center gap-2">
              {step.notes && (
                <p className="text-xs text-gray-400 italic flex-1">{step.notes}</p>
              )}
              <button
                onClick={() => setEditingNotes(true)}
                className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
              >
                {step.notes ? 'Edit note' : '+ Add note'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Category Group ───────────────────────────────────────────────────────────

interface CategoryGroupProps {
  category: PlaybookCategory
  steps: ExpansionPlaybookStep[]
  playbookId: string
  onToggle: (stepId: string, checked: boolean) => void
  onNotesChange: (stepId: string, notes: string) => void
  defaultOpen?: boolean
}

function CategoryGroup({
  category,
  steps,
  playbookId,
  onToggle,
  onNotesChange,
  defaultOpen = true,
}: CategoryGroupProps) {
  const [open, setOpen] = useState(defaultOpen)
  const cfg = CATEGORY_CONFIG[category] ?? CATEGORY_CONFIG.gap_analysis
  const Icon = cfg.icon
  const completed = steps.filter((s) => s.checked).length

  return (
    <div className={clsx('rounded border', cfg.border)}>
      {/* Group header */}
      <button
        onClick={() => setOpen(!open)}
        className={clsx(
          'w-full flex items-center justify-between px-3 py-2 rounded-t transition-colors',
          cfg.bg,
          'hover:brightness-110'
        )}
      >
        <div className="flex items-center gap-2">
          <Icon size={14} className={cfg.color} />
          <span className={clsx('text-sm font-semibold', cfg.color)}>{cfg.label}</span>
          <span className="text-xs text-gray-400">
            {completed}/{steps.length}
          </span>
        </div>
        {open ? (
          <ChevronDown size={14} className="text-gray-500" />
        ) : (
          <ChevronRight size={14} className="text-gray-500" />
        )}
      </button>

      {/* Steps */}
      {open && (
        <div className="p-2 space-y-2">
          {steps.map((step) => (
            <StepRow
              key={step.id}
              step={step}
              playbookId={playbookId}
              onToggle={onToggle}
              onNotesChange={onNotesChange}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export interface HunterPlaybookViewProps {
  playbook: SavedPlaybook
  leadContactName?: string
  leadJobType?: string
  onRescore?: (leadId: string) => void
  onClose?: () => void
}

export function HunterPlaybookView({
  playbook: initialPlaybook,
  leadContactName,
  leadJobType,
  onRescore,
  onClose,
}: HunterPlaybookViewProps) {
  const [playbook, setPlaybook] = useState<SavedPlaybook>(initialPlaybook)
  const [rescoreTriggered, setRescoreTriggered] = useState(false)
  const [checkingProgress, setCheckingProgress] = useState(false)

  // Sync prop changes
  useEffect(() => {
    setPlaybook(initialPlaybook)
  }, [initialPlaybook.id])

  // Completion metrics
  const totalSteps = playbook.steps.length
  const completedSteps = playbook.steps.filter((s) => s.checked).length
  const completionPct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0
  const showRescore = completionPct > 70

  // Group steps by category
  const stepsByCategory = useMemo(() => {
    const grouped: Partial<Record<PlaybookCategory, ExpansionPlaybookStep[]>> = {}
    for (const step of playbook.steps) {
      if (!grouped[step.category]) grouped[step.category] = []
      grouped[step.category]!.push(step)
    }
    return grouped
  }, [playbook.steps])

  // Toggle handler — updates local state optimistically
  const handleToggle = useCallback((stepId: string, checked: boolean) => {
    setPlaybook((prev) => ({
      ...prev,
      steps: prev.steps.map((s) =>
        s.id === stepId ? { ...s, checked } : s
      ),
    }))
  }, [])

  // Notes handler — updates local state optimistically
  const handleNotesChange = useCallback((stepId: string, notes: string) => {
    setPlaybook((prev) => ({
      ...prev,
      steps: prev.steps.map((s) =>
        s.id === stepId ? { ...s, notes } : s
      ),
    }))
  }, [])

  // Check progress and potentially trigger re-score
  const handleCheckProgress = useCallback(async () => {
    setCheckingProgress(true)
    try {
      const progress = await checkPlaybookProgress(playbook.id)
      if (progress.rescore_triggered) {
        setRescoreTriggered(true)
      }
    } finally {
      setCheckingProgress(false)
    }
  }, [playbook.id])

  const handleRescore = useCallback(() => {
    onRescore?.(playbook.lead_id)
    setRescoreTriggered(false)
  }, [playbook.lead_id, onRescore])

  // Progress bar color
  const progressColor =
    completionPct >= 70
      ? 'bg-emerald-500'
      : completionPct >= 40
        ? 'bg-amber-500'
        : 'bg-blue-500'

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white">
      {/* Header */}
      <div className="bg-gray-900 border-b border-amber-800/50 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-amber-200">
              📈 Expansion Playbook
            </h2>
            {(leadContactName || leadJobType) && (
              <p className="text-xs text-gray-400 mt-0.5">
                {leadContactName && <span>{leadContactName}</span>}
                {leadContactName && leadJobType && <span className="mx-1">·</span>}
                {leadJobType && <span>{leadJobType}</span>}
              </p>
            )}
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-300 text-sm px-2 py-1 rounded hover:bg-gray-800 transition-colors"
            >
              ✕ Close
            </button>
          )}
        </div>

        {/* Progress bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">
              {completedSteps} of {totalSteps} steps complete
            </span>
            <span
              className={clsx(
                'font-bold',
                completionPct >= 70 ? 'text-emerald-400' : 'text-gray-300'
              )}
            >
              {completionPct}%
            </span>
          </div>
          <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={clsx('h-full rounded-full transition-all duration-500', progressColor)}
              style={{ width: `${completionPct}%` }}
            />
          </div>
        </div>

        {/* Re-score CTA */}
        {showRescore && (
          <div className="flex items-center gap-3 bg-emerald-900/40 border border-emerald-700/60 rounded px-3 py-2">
            <div className="flex-1">
              <p className="text-xs text-emerald-200 font-medium">
                🎯 You're {completionPct}% ready — time to re-evaluate this lead!
              </p>
              <p className="text-xs text-emerald-400/70 mt-0.5">
                HUNTER can re-score now with your updated capacity.
              </p>
            </div>
            <button
              onClick={handleRescore}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs rounded font-medium transition-colors whitespace-nowrap"
            >
              <RefreshCw size={12} />
              Re-score Lead
            </button>
          </div>
        )}

        {/* Check progress button (not visible when re-score CTA is shown) */}
        {!showRescore && completedSteps > 0 && (
          <button
            onClick={handleCheckProgress}
            disabled={checkingProgress}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
          >
            {checkingProgress ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            Check readiness progress
          </button>
        )}

        {/* Rescore triggered confirmation */}
        {rescoreTriggered && !showRescore && (
          <div className="text-xs text-emerald-400 bg-emerald-900/30 border border-emerald-700/40 rounded px-3 py-1.5">
            ✓ Re-score queued — HUNTER will update this lead's score
          </div>
        )}
      </div>

      {/* Steps by category */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {CATEGORY_ORDER.map((category) => {
          const steps = stepsByCategory[category]
          if (!steps || steps.length === 0) return null
          return (
            <CategoryGroup
              key={category}
              category={category}
              steps={steps}
              playbookId={playbook.id}
              onToggle={handleToggle}
              onNotesChange={handleNotesChange}
              defaultOpen={category === 'gap_analysis' || steps.some((s) => !s.checked)}
            />
          )
        })}

        {totalSteps === 0 && (
          <div className="text-center text-gray-500 py-12">
            <p className="text-sm">No steps found in this playbook.</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default HunterPlaybookView
