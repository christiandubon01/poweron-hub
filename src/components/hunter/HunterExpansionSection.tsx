// @ts-nocheck
/**
 * HunterExpansionSection — 40-59 score lead expansion opportunities (HT8)
 *
 * Displays expansion-tier leads with distinct amber styling, playbook status,
 * and one-click playbook generation or viewing.
 *
 * Features:
 * - Visually distinct from main inbox (amber border, dark amber background)
 * - Count badge: "3 Expansion Opportunities"
 * - Each lead row: score badge, job type, estimated value, playbook action button
 * - "Generate Playbook" if no playbook exists for this lead
 * - "View Playbook" if a playbook already exists
 * - Playbook panel slides in inline when viewing
 */

import React, { useState, useCallback, useEffect } from 'react'
import { TrendingUp, ChevronDown, ChevronRight, Loader2, BookOpen, Sparkles } from 'lucide-react'
import clsx from 'clsx'
import {
  generatePlaybook,
  savePlaybook,
  loadPlaybook,
  type SavedPlaybook,
  type PlaybookLeadInput,
} from '@/services/hunter/HunterPlaybookGenerator'
import { HunterPlaybookView } from './HunterPlaybookView'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExpansionLead {
  /** Unique lead identifier */
  id: string
  /** HUNTER score (must be 40–59 for this section) */
  score: number
  /** Human-readable job type label */
  jobType: string
  /** Contact person or company name */
  contactName?: string
  /** Estimated job value in dollars */
  estimatedValue?: number
  /** Optional description */
  description?: string
  /** Source city */
  city?: string
  /** Any additional notes */
  notes?: string
}

export interface HunterExpansionSectionProps {
  /** Leads with score 40–59 */
  leads?: ExpansionLead[]
  /** Called when HUNTER re-score is requested for a lead */
  onRescore?: (leadId: string) => void
  /** Collapse the section by default */
  defaultCollapsed?: boolean
}

// ─── Score Badge ──────────────────────────────────────────────────────────────

function ExpansionScoreBadge({ score }: { score: number }) {
  return (
    <div className="flex-shrink-0 w-11 h-11 rounded-full border-2 border-amber-600 bg-amber-900/40 flex items-center justify-center">
      <div className="text-center">
        <div className="text-sm font-bold text-amber-300 leading-none">{score}</div>
        <div className="text-[9px] text-amber-500 leading-none mt-0.5">EXP</div>
      </div>
    </div>
  )
}

// ─── Lead Row ─────────────────────────────────────────────────────────────────

interface LeadRowProps {
  lead: ExpansionLead
  onViewPlaybook: (lead: ExpansionLead) => void
  onGeneratePlaybook: (lead: ExpansionLead) => void
  hasPlaybook: boolean
  isGenerating: boolean
  isSelected: boolean
}

function LeadRow({
  lead,
  onViewPlaybook,
  onGeneratePlaybook,
  hasPlaybook,
  isGenerating,
  isSelected,
}: LeadRowProps) {
  const formattedValue =
    lead.estimatedValue !== undefined
      ? lead.estimatedValue >= 1000
        ? `$${(lead.estimatedValue / 1000).toFixed(1)}k`
        : `$${lead.estimatedValue}`
      : null

  return (
    <div
      className={clsx(
        'flex items-center gap-3 p-3 rounded border transition-all',
        isSelected
          ? 'border-amber-500 bg-amber-900/30'
          : 'border-amber-800/40 bg-gray-900/40 hover:border-amber-700/60 hover:bg-amber-900/20'
      )}
    >
      {/* Score badge */}
      <ExpansionScoreBadge score={lead.score} />

      {/* Lead info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-gray-200 truncate">
            {lead.contactName ?? 'Unknown contact'}
          </span>
          {formattedValue && (
            <span className="text-xs font-semibold text-emerald-400 bg-emerald-900/30 px-1.5 py-0.5 rounded">
              {formattedValue}
            </span>
          )}
        </div>
        <p className="text-xs text-amber-300/80 truncate mt-0.5">{lead.jobType}</p>
        {lead.city && (
          <p className="text-xs text-gray-500 mt-0.5">{lead.city}</p>
        )}
      </div>

      {/* Action button */}
      <div className="flex-shrink-0">
        {isGenerating ? (
          <button
            disabled
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-900/50 text-amber-400 text-xs rounded border border-amber-700/50 cursor-not-allowed"
          >
            <Loader2 size={12} className="animate-spin" />
            Generating...
          </button>
        ) : hasPlaybook ? (
          <button
            onClick={() => onViewPlaybook(lead)}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border font-medium transition-colors',
              isSelected
                ? 'bg-amber-600 border-amber-500 text-white'
                : 'bg-amber-900/40 border-amber-700/60 text-amber-300 hover:bg-amber-800/50 hover:text-amber-200'
            )}
          >
            <BookOpen size={12} />
            {isSelected ? 'Hide Playbook' : 'View Playbook'}
          </button>
        ) : (
          <button
            onClick={() => onGeneratePlaybook(lead)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-700 hover:bg-amber-600 text-white text-xs rounded border border-amber-600 font-medium transition-colors"
          >
            <Sparkles size={12} />
            Generate Playbook
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function HunterExpansionSection({
  leads = [],
  onRescore,
  defaultCollapsed = false,
}: HunterExpansionSectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [playbookMap, setPlaybookMap] = useState<Record<string, SavedPlaybook | null>>({})
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({})
  const [generatingSet, setGeneratingSet] = useState<Set<string>>(new Set())
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null)

  // Only show 40–59 score leads
  const expansionLeads = leads.filter((l) => l.score >= 40 && l.score <= 59)

  // Load existing playbooks for visible leads when section expands
  useEffect(() => {
    if (collapsed || expansionLeads.length === 0) return

    const idsToLoad = expansionLeads
      .map((l) => l.id)
      .filter((id) => !(id in playbookMap) && !loadingMap[id])

    if (idsToLoad.length === 0) return

    setLoadingMap((prev) => {
      const next = { ...prev }
      idsToLoad.forEach((id) => { next[id] = true })
      return next
    })

    Promise.all(
      idsToLoad.map(async (id) => {
        try {
          const pb = await loadPlaybook(id)
          return { id, pb }
        } catch {
          return { id, pb: null }
        }
      })
    ).then((results) => {
      setPlaybookMap((prev) => {
        const next = { ...prev }
        results.forEach(({ id, pb }) => { next[id] = pb })
        return next
      })
      setLoadingMap((prev) => {
        const next = { ...prev }
        idsToLoad.forEach((id) => { delete next[id] })
        return next
      })
    })
  }, [collapsed, expansionLeads.length])

  const handleGeneratePlaybook = useCallback(async (lead: ExpansionLead) => {
    setGeneratingSet((prev) => new Set(prev).add(lead.id))

    try {
      const leadInput: PlaybookLeadInput = {
        id: lead.id,
        contact_name: lead.contactName,
        lead_type: lead.jobType,
        description: lead.description,
        estimated_value: lead.estimatedValue,
        score: lead.score,
        notes: lead.notes,
        city: lead.city,
      }

      const steps = await generatePlaybook(leadInput)
      const saved = await savePlaybook(lead.id, steps)

      setPlaybookMap((prev) => ({ ...prev, [lead.id]: saved }))
      setActiveLeadId(lead.id)
    } catch (err) {
      console.warn('[HunterExpansionSection] generatePlaybook error:', err)
    } finally {
      setGeneratingSet((prev) => {
        const next = new Set(prev)
        next.delete(lead.id)
        return next
      })
    }
  }, [])

  const handleViewPlaybook = useCallback((lead: ExpansionLead) => {
    setActiveLeadId((prev) => (prev === lead.id ? null : lead.id))
  }, [])

  const activeLead = expansionLeads.find((l) => l.id === activeLeadId)
  const activePlaybook = activeLeadId ? playbookMap[activeLeadId] : null

  if (expansionLeads.length === 0) return null

  return (
    <div className="rounded border-2 border-amber-800/60 bg-amber-950/20">
      {/* Section header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-3 bg-amber-900/30 hover:bg-amber-900/40 rounded-t transition-colors"
      >
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-amber-400" />
          <span className="text-sm font-bold text-amber-200">Expansion Opportunities</span>
          <span className="bg-amber-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
            {expansionLeads.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-amber-400/70">Score 40–59</span>
          {collapsed ? (
            <ChevronRight size={14} className="text-amber-500" />
          ) : (
            <ChevronDown size={14} className="text-amber-500" />
          )}
        </div>
      </button>

      {/* Section body */}
      {!collapsed && (
        <div className="p-3 space-y-3">
          {/* Description */}
          <p className="text-xs text-amber-300/60 pb-1 border-b border-amber-800/30">
            These leads are valuable but outside current capacity. Generate a step-by-step
            expansion playbook to grow into each opportunity.
          </p>

          {/* Lead rows */}
          <div className="space-y-2">
            {expansionLeads.map((lead) => (
              <LeadRow
                key={lead.id}
                lead={lead}
                onViewPlaybook={handleViewPlaybook}
                onGeneratePlaybook={handleGeneratePlaybook}
                hasPlaybook={!!playbookMap[lead.id]}
                isGenerating={generatingSet.has(lead.id) || loadingMap[lead.id] === true}
                isSelected={activeLeadId === lead.id}
              />
            ))}
          </div>

          {/* Inline playbook view */}
          {activeLead && activePlaybook && (
            <div className="border border-amber-700/40 rounded overflow-hidden" style={{ minHeight: 400 }}>
              <HunterPlaybookView
                playbook={activePlaybook}
                leadContactName={activeLead.contactName}
                leadJobType={activeLead.jobType}
                onRescore={onRescore}
                onClose={() => setActiveLeadId(null)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default HunterExpansionSection
