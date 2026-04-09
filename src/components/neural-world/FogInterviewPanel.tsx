/**
 * FogInterviewPanel.tsx — NW32: Guided fog data interview system.
 *
 * A full-screen modal overlay that walks the user through targeted questions
 * to populate fog density data where Supabase data is incomplete.
 *
 * TRIGGER:
 *   "CALIBRATE FOG" button (compass icon) in CommandHUD.
 *
 * FLOW:
 *   1. Checks DataBridge for data completeness per fog domain.
 *   2. For any domain < 60% coverage, generates targeted questions.
 *   3. One question at a time, progress bar, skip button.
 *   4. Saves answers to Supabase neural_world_settings.fog_interview_data (JSONB).
 *   5. On completion: dispatches 'nw:fog-interview-complete' so fog layers recalculate.
 *
 * RECALIBRATE:
 *   Dropdown at bottom-right lets user pick a section to redo.
 *
 * COMPLETION BADGE:
 *   After first full interview 'nw:fog-calibrated' is dispatched so CommandHUD
 *   can show the "FOG CALIBRATED" chip.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { getWorldData, type NWWorldData } from './DataBridge'

// ── Types ──────────────────────────────────────────────────────────────────────

export type FogDomain = 'revenue' | 'security' | 'bandwidth' | 'improvement'

interface QuestionBase {
  id: string
  domain: FogDomain
  text: string
}

interface QuestionMultiSelect extends QuestionBase {
  type: 'multi-select'
  options: string[]
}

interface QuestionDollar extends QuestionBase {
  type: 'dollar'
  placeholder?: string
}

interface QuestionNumber extends QuestionBase {
  type: 'number'
  placeholder?: string
  unit?: string
}

interface QuestionYesNo extends QuestionBase {
  type: 'yes-no'
  options?: string[]  // override default ['Yes', 'No']
}

interface QuestionYesNoPartial extends QuestionBase {
  type: 'yes-no-partial'
}

interface QuestionSlider extends QuestionBase {
  type: 'slider'
  min: number
  max: number
  leftLabel: string
  rightLabel: string
}

interface QuestionText extends QuestionBase {
  type: 'text'
  placeholder?: string
}

interface QuestionGrid extends QuestionBase {
  type: 'grid'
  rows: string[]
  min: number
  max: number
}

interface QuestionAgentSelect extends QuestionBase {
  type: 'agent-select'
}

type Question =
  | QuestionMultiSelect
  | QuestionDollar
  | QuestionNumber
  | QuestionYesNo
  | QuestionYesNoPartial
  | QuestionSlider
  | QuestionText
  | QuestionGrid
  | QuestionAgentSelect

export interface FogInterviewData {
  version: number
  completedAt: string | null
  sectionsCompleted: FogDomain[]
  answers: Record<string, unknown>
}

// ── Domain metadata ───────────────────────────────────────────────────────────

interface DomainMeta {
  id: FogDomain
  label: string
  icon: string
  color: string
}

const DOMAINS: DomainMeta[] = [
  { id: 'revenue',     label: 'Revenue',     icon: '💰', color: '#ff9900' },
  { id: 'security',    label: 'Security',    icon: '🔒', color: '#ffb347' },
  { id: 'bandwidth',   label: 'Bandwidth',   icon: '🧠', color: '#aa66ee' },
  { id: 'improvement', label: 'Improvement', icon: '🌱', color: '#00ccbb' },
]

// ── Agents list ───────────────────────────────────────────────────────────────

const AGENTS = ['NEXUS', 'VAULT', 'OHM', 'LEDGER', 'BLUEPRINT', 'CHRONO', 'SPARK', 'ATLAS', 'GUARDIAN']

// ── Coverage calculation ──────────────────────────────────────────────────────

function computeCoverage(domain: FogDomain, data: NWWorldData): number {
  const { projects, invoices, fieldLogs, crewMembers } = data

  switch (domain) {
    case 'revenue': {
      // Coverage: how much revenue data exists
      const hasProjects  = projects.length > 0 ? 0.2 : 0
      const hasInvoices  = invoices.length > 0 ? 0.3 : 0
      const hasPaid      = invoices.some(i => i.status === 'paid') ? 0.25 : 0
      const hasDates     = invoices.filter(i => i.due_date).length / Math.max(1, invoices.length)
      const dateScore    = hasDates * 0.25
      return Math.min(1, hasProjects + hasInvoices + hasPaid + dateScore)
    }
    case 'security': {
      // Coverage: security-related data is mostly manually entered
      // Low unless we have some indicators; treat as low coverage by default
      return projects.length > 3 ? 0.25 : 0.1
    }
    case 'bandwidth': {
      // Coverage: field log data
      const hasLogs      = fieldLogs.length > 0 ? 0.4 : 0
      const hasCrew      = crewMembers.length > 0 ? 0.2 : 0
      const recentLogs   = fieldLogs.filter(fl => {
        if (!fl.log_date) return false
        return (Date.now() - new Date(fl.log_date).getTime()) < 30 * 24 * 60 * 60 * 1000
      }).length
      const recentScore  = Math.min(0.4, recentLogs / 10 * 0.4)
      return Math.min(1, hasLogs + hasCrew + recentScore)
    }
    case 'improvement': {
      // Coverage: improvement insights come from combination
      const hasHealth    = projects.filter(p => p.health_score < 100).length > 0 ? 0.3 : 0
      const hasPhase     = projects.filter(p => p.phase_completion > 0).length > 0 ? 0.3 : 0
      const totalScore   = projects.length > 5 ? 0.4 : (projects.length / 5 * 0.4)
      return Math.min(1, hasHealth + hasPhase + totalScore)
    }
  }
}

// ── Question builders ─────────────────────────────────────────────────────────

function buildRevenueQuestions(data: NWWorldData): Question[] {
  const projectNames = data.projects
    .filter(p => p.status !== 'completed' && p.status !== 'cancelled')
    .slice(0, 10)
    .map(p => p.name)

  const invoiceIds = data.invoices
    .filter(i => i.status !== 'paid' && i.status !== 'cancelled')
    .slice(0, 8)
    .map(i => i.id.slice(0, 8) + '…')

  const qs: Question[] = [
    {
      id:      'rev_unbilled_projects',
      domain:  'revenue',
      type:    'multi-select',
      text:    'Which projects have unbilled work right now?',
      options: projectNames.length > 0
        ? projectNames
        : ['No active projects identified — enter manually'],
    },
    {
      id:          'rev_unbilled_amount',
      domain:      'revenue',
      type:        'dollar',
      text:        'Approximately how much total unbilled work do you currently have outstanding?',
      placeholder: 'e.g. 12500',
    },
    {
      id:      'rev_outstanding_invoices',
      domain:  'revenue',
      type:    'multi-select',
      text:    'Which invoices are you still waiting on payment for?',
      options: invoiceIds.length > 0
        ? invoiceIds
        : ['No open invoices found — all paid'],
    },
    {
      id:          'rev_invoice_days',
      domain:      'revenue',
      type:        'number',
      text:        'On average, how many days are your invoices outstanding before payment?',
      placeholder: 'e.g. 30',
      unit:        'days',
    },
    {
      id:         'rev_service_vs_project',
      domain:     'revenue',
      type:       'slider',
      text:       'What percentage of your monthly revenue comes from service calls vs. projects?',
      min:        0,
      max:        100,
      leftLabel:  '100% Service',
      rightLabel: '100% Projects',
    },
  ]

  return qs
}

function buildSecurityQuestions(): Question[] {
  return [
    {
      id:      'sec_nda_all_clients',
      domain:  'security',
      type:    'yes-no-partial',
      text:    'Have all your current clients signed NDAs?',
    },
    {
      id:     'sec_nda_attorney_reviewed',
      domain: 'security',
      type:   'yes-no',
      text:   'Is your NDA template attorney-reviewed?',
    },
    {
      id:     'sec_2fa_enabled',
      domain: 'security',
      type:   'yes-no',
      text:   'Do you have 2FA enabled on your key business accounts (email, Supabase, Netlify)?',
    },
    {
      id:      'sec_rls_policies',
      domain:  'security',
      type:    'yes-no',
      text:    'Are your Supabase Row-Level Security (RLS) policies covering all tables?',
      options: ['Yes', 'No', 'Unsure'],
    },
  ]
}

function buildBandwidthQuestions(data: NWWorldData): Question[] {
  const projectNames = data.projects
    .filter(p => p.status === 'in_progress' || p.status === 'approved')
    .slice(0, 10)
    .map(p => p.name)

  return [
    {
      id:          'bw_field_hours',
      domain:      'bandwidth',
      type:        'number',
      text:        'How many hours per week do you spend on field work?',
      placeholder: 'e.g. 30',
      unit:        'hrs/week',
    },
    {
      id:          'bw_admin_hours',
      domain:      'bandwidth',
      type:        'number',
      text:        'How many hours per week on software, estimating, and admin?',
      placeholder: 'e.g. 10',
      unit:        'hrs/week',
    },
    {
      id:      'bw_top_projects',
      domain:  'bandwidth',
      type:    'multi-select',
      text:    'Which 3 projects consume the most of your attention right now?',
      options: projectNames.length > 0
        ? projectNames
        : ['No active projects found'],
    },
    {
      id:          'bw_repetitive_task',
      domain:      'bandwidth',
      type:        'text',
      text:        'What task do you spend the most time on that feels repetitive?',
      placeholder: 'e.g. sending invoice reminders, scheduling crew...',
    },
    {
      id:         'bw_time_balance',
      domain:     'bandwidth',
      type:       'slider',
      text:       'Rate your current time balance:',
      min:        1,
      max:        10,
      leftLabel:  '1 = All Field',
      rightLabel: '10 = All Admin',
    },
  ]
}

function buildImprovementQuestions(): Question[] {
  return [
    {
      id:          'imp_bottleneck',
      domain:      'improvement',
      type:        'text',
      text:        "What's the biggest bottleneck in your operations right now?",
      placeholder: 'e.g. chasing payments, scheduling conflicts...',
    },
    {
      id:     'imp_agent_wishlist',
      domain: 'improvement',
      type:   'agent-select',
      text:   'Which agent do you wish did more for you?',
    },
    {
      id:          'imp_automation_one_thing',
      domain:      'improvement',
      type:        'text',
      text:        'If you could automate one thing tomorrow, what would it be?',
      placeholder: 'e.g. invoice follow-up, material ordering...',
    },
    {
      id:     'imp_area_ratings',
      domain: 'improvement',
      type:   'grid',
      text:   'Rate each area 1–5 for improvement need:',
      rows:   ['Pricing', 'Scheduling', 'Compliance', 'Collections', 'Lead Gen'],
      min:    1,
      max:    5,
    },
  ]
}

function buildQuestionsForDomain(domain: FogDomain, data: NWWorldData): Question[] {
  switch (domain) {
    case 'revenue':     return buildRevenueQuestions(data)
    case 'security':    return buildSecurityQuestions()
    case 'bandwidth':   return buildBandwidthQuestions(data)
    case 'improvement': return buildImprovementQuestions()
  }
}

// ── Exported hook for fog density recalculation ───────────────────────────────

/**
 * Returns saved interview data from Supabase for use by FogDomainLayer
 * to merge with Supabase data in density calculations.
 */
export function useFogInterviewData() {
  const [data, setData] = useState<FogInterviewData | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const { data: { user } } = await (supabase as any).auth.getUser()
        if (!user) return
        const { data: profile } = await (supabase as any)
          .from('profiles')
          .select('org_id')
          .eq('id', user.id)
          .maybeSingle()
        const orgId: string | null = profile?.org_id ?? null
        if (!orgId) return
        const { data: settings } = await (supabase as any)
          .from('neural_world_settings')
          .select('fog_interview_data')
          .eq('org_id', orgId)
          .maybeSingle()
        if (settings?.fog_interview_data) {
          setData(settings.fog_interview_data as FogInterviewData)
        }
      } catch {
        // Non-blocking
      }
    }
    load()

    function onComplete() { load() }
    window.addEventListener('nw:fog-interview-complete', onComplete)
    return () => window.removeEventListener('nw:fog-interview-complete', onComplete)
  }, [])

  return data
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ProgressBar({ current, total, color }: { current: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0
  return (
    <div style={{ width: '100%', marginBottom: 28 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.4)', letterSpacing: 1 }}>
          QUESTION {current + 1} / {total}
        </span>
        <span style={{ fontSize: 10, fontFamily: 'monospace', color, letterSpacing: 1 }}>
          {pct}% COMPLETE
        </span>
      </div>
      <div style={{
        width: '100%',
        height: 3,
        background: 'rgba(255,255,255,0.1)',
        borderRadius: 2,
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct}%`,
          height: '100%',
          background: color,
          borderRadius: 2,
          transition: 'width 0.4s ease',
          boxShadow: `0 0 8px ${color}88`,
        }} />
      </div>
    </div>
  )
}

function QuestionText_Input({
  q,
  value,
  onChange,
}: {
  q: QuestionText
  value: string
  onChange: (v: string) => void
}) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={q.placeholder ?? ''}
      rows={3}
      style={{
        width: '100%',
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.2)',
        borderRadius: 8,
        color: '#fff',
        fontSize: 14,
        fontFamily: 'monospace',
        padding: '12px 14px',
        resize: 'none',
        outline: 'none',
        boxSizing: 'border-box',
      }}
    />
  )
}

function QuestionDollar_Input({
  q,
  value,
  onChange,
}: {
  q: QuestionDollar
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ color: '#00ff88', fontSize: 20, fontFamily: 'monospace' }}>$</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={q.placeholder ?? '0'}
        style={{
          flex: 1,
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(0,255,136,0.3)',
          borderRadius: 8,
          color: '#00ff88',
          fontSize: 22,
          fontFamily: 'monospace',
          padding: '12px 14px',
          outline: 'none',
        }}
      />
    </div>
  )
}

function QuestionNumber_Input({
  q,
  value,
  onChange,
}: {
  q: QuestionNumber
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <input
        type="number"
        min={0}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={q.placeholder ?? ''}
        style={{
          flex: 1,
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: 8,
          color: '#fff',
          fontSize: 22,
          fontFamily: 'monospace',
          padding: '12px 14px',
          outline: 'none',
        }}
      />
      {q.unit && (
        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, fontFamily: 'monospace' }}>
          {q.unit}
        </span>
      )}
    </div>
  )
}

function QuestionMultiSelect_Input({
  q,
  selected,
  onChange,
}: {
  q: QuestionMultiSelect
  selected: string[]
  onChange: (v: string[]) => void
}) {
  const toggle = (opt: string) => {
    if (selected.includes(opt)) {
      onChange(selected.filter(s => s !== opt))
    } else {
      onChange([...selected, opt])
    }
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {q.options.map(opt => {
        const active = selected.includes(opt)
        return (
          <button
            key={opt}
            onClick={() => toggle(opt)}
            style={{
              padding: '8px 14px',
              borderRadius: 20,
              border: active
                ? '1px solid rgba(0,229,204,0.9)'
                : '1px solid rgba(255,255,255,0.18)',
              background: active
                ? 'rgba(0,229,204,0.18)'
                : 'rgba(255,255,255,0.05)',
              color: active ? '#00e5cc' : 'rgba(255,255,255,0.65)',
              fontSize: 12,
              fontFamily: 'monospace',
              cursor: 'pointer',
              transition: 'all 0.15s',
              letterSpacing: 0.5,
            }}
          >
            {active ? '✓ ' : ''}{opt}
          </button>
        )
      })}
    </div>
  )
}

function QuestionYesNo_Input({
  q,
  value,
  onChange,
}: {
  q: QuestionYesNo | QuestionYesNoPartial
  value: string
  onChange: (v: string) => void
}) {
  const opts = q.type === 'yes-no-partial'
    ? ['Yes', 'No', 'Partial']
    : ((q as QuestionYesNo).options ?? ['Yes', 'No'])

  const colors: Record<string, string> = {
    Yes:     '#00ff88',
    No:      '#ff4455',
    Partial: '#ffaa33',
    Unsure:  '#aaaaff',
  }

  return (
    <div style={{ display: 'flex', gap: 12 }}>
      {opts.map(opt => {
        const active = value === opt
        const col = colors[opt] ?? '#00e5cc'
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            style={{
              flex: 1,
              padding: '14px 0',
              borderRadius: 10,
              border: active
                ? `1px solid ${col}`
                : '1px solid rgba(255,255,255,0.18)',
              background: active
                ? `${col}22`
                : 'rgba(255,255,255,0.05)',
              color: active ? col : 'rgba(255,255,255,0.55)',
              fontSize: 14,
              fontFamily: 'monospace',
              fontWeight: active ? 700 : 400,
              cursor: 'pointer',
              transition: 'all 0.15s',
              letterSpacing: 1,
            }}
          >
            {opt}
          </button>
        )
      })}
    </div>
  )
}

function QuestionSlider_Input({
  q,
  value,
  onChange,
}: {
  q: QuestionSlider
  value: number
  onChange: (v: number) => void
}) {
  const pct = ((value - q.min) / (q.max - q.min)) * 100

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
        <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.4)' }}>
          {q.leftLabel}
        </span>
        <span style={{
          fontSize: 20,
          fontFamily: 'monospace',
          fontWeight: 700,
          color: '#00e5cc',
        }}>
          {value}{q.max === 100 ? '%' : ''}
        </span>
        <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.4)' }}>
          {q.rightLabel}
        </span>
      </div>
      <div style={{ position: 'relative', height: 6, marginBottom: 8 }}>
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(255,255,255,0.1)',
          borderRadius: 3,
        }} />
        <div style={{
          position: 'absolute',
          left: 0,
          top: 0,
          height: '100%',
          width: `${pct}%`,
          background: '#00e5cc',
          borderRadius: 3,
          transition: 'width 0.1s',
          boxShadow: '0 0 8px #00e5cc88',
        }} />
      </div>
      <input
        type="range"
        min={q.min}
        max={q.max}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{
          width: '100%',
          appearance: 'none',
          background: 'transparent',
          cursor: 'pointer',
          marginTop: -18,
          position: 'relative',
          zIndex: 1,
        }}
      />
    </div>
  )
}

function QuestionGrid_Input({
  q,
  values,
  onChange,
}: {
  q: QuestionGrid
  values: Record<string, number>
  onChange: (v: Record<string, number>) => void
}) {
  const ratings = [1, 2, 3, 4, 5]
  return (
    <div>
      {q.rows.map(row => (
        <div key={row} style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
          gap: 12,
        }}>
          <span style={{
            fontSize: 12,
            fontFamily: 'monospace',
            color: 'rgba(255,255,255,0.7)',
            width: 100,
            flexShrink: 0,
          }}>
            {row}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            {ratings.map(r => {
              const active = (values[row] ?? 0) === r
              return (
                <button
                  key={r}
                  onClick={() => onChange({ ...values, [row]: r })}
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 6,
                    border: active
                      ? '1px solid #00e5cc'
                      : '1px solid rgba(255,255,255,0.15)',
                    background: active
                      ? 'rgba(0,229,204,0.22)'
                      : 'rgba(255,255,255,0.04)',
                    color: active ? '#00e5cc' : 'rgba(255,255,255,0.5)',
                    fontSize: 13,
                    fontFamily: 'monospace',
                    cursor: 'pointer',
                    transition: 'all 0.12s',
                    fontWeight: active ? 700 : 400,
                  }}
                >
                  {r}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function QuestionAgentSelect_Input({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {AGENTS.map(agent => {
        const active = value === agent
        return (
          <button
            key={agent}
            onClick={() => onChange(active ? '' : agent)}
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              border: active
                ? '1px solid rgba(160,80,255,0.9)'
                : '1px solid rgba(255,255,255,0.18)',
              background: active
                ? 'rgba(160,80,255,0.2)'
                : 'rgba(255,255,255,0.05)',
              color: active ? '#c080ff' : 'rgba(255,255,255,0.6)',
              fontSize: 13,
              fontFamily: 'monospace',
              cursor: 'pointer',
              transition: 'all 0.15s',
              letterSpacing: 1.5,
            }}
          >
            {agent}
          </button>
        )
      })}
    </div>
  )
}

// ── Section picker (for RECALIBRATE) ─────────────────────────────────────────

function SectionPicker({
  completedSections,
  onPick,
}: {
  completedSections: FogDomain[]
  onPick: (domain: FogDomain) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(prev => !prev)}
        style={{
          padding: '6px 14px',
          borderRadius: 6,
          border: '1px solid rgba(0,229,204,0.4)',
          background: 'rgba(0,0,0,0.5)',
          color: '#00e5cc',
          fontSize: 10,
          fontFamily: 'monospace',
          letterSpacing: 1.5,
          cursor: 'pointer',
          backdropFilter: 'blur(6px)',
        }}
      >
        🔄 RECALIBRATE
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          bottom: '110%',
          left: 0,
          background: 'rgba(12,18,28,0.97)',
          border: '1px solid rgba(0,229,204,0.3)',
          borderRadius: 8,
          padding: 8,
          zIndex: 200,
          minWidth: 160,
          backdropFilter: 'blur(16px)',
        }}>
          {DOMAINS.map(d => (
            <button
              key={d.id}
              onClick={() => { onPick(d.id); setOpen(false) }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 12px',
                background: 'transparent',
                border: 'none',
                color: completedSections.includes(d.id)
                  ? d.color
                  : 'rgba(255,255,255,0.4)',
                fontSize: 11,
                fontFamily: 'monospace',
                letterSpacing: 1,
                cursor: 'pointer',
                borderRadius: 4,
              }}
            >
              {d.icon} {d.label.toUpperCase()}
              {completedSections.includes(d.id) && ' ✓'}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main panel component ──────────────────────────────────────────────────────

interface FogInterviewPanelProps {
  open: boolean
  onClose: () => void
}

export function FogInterviewPanel({ open, onClose }: FogInterviewPanelProps) {
  const worldData = getWorldData()

  // Build domain list that need interviews (< 60% coverage)
  const domainsToInterview: FogDomain[] = DOMAINS
    .map(d => d.id)
    .filter(d => computeCoverage(d, worldData) < 0.6)

  // If all domains have good coverage, show all anyway for manual calibration
  const activeDomains: FogDomain[] = domainsToInterview.length > 0
    ? domainsToInterview
    : (['revenue', 'security', 'bandwidth', 'improvement'] as FogDomain[])

  // State
  const [domainIndex, setDomainIndex]     = useState(0)
  const [questionIndex, setQuestionIndex] = useState(0)
  const [answers, setAnswers]             = useState<Record<string, unknown>>({})
  const [completedSections, setCompletedSections] = useState<FogDomain[]>([])
  const [interviewDone, setInterviewDone] = useState(false)
  const [saving, setSaving]               = useState(false)
  const [coverageDisplay, setCoverageDisplay] = useState<Record<FogDomain, number>>({
    revenue: 0, security: 0, bandwidth: 0, improvement: 0,
  })

  // Compute coverage on open
  useEffect(() => {
    if (!open) return
    setCoverageDisplay({
      revenue:     computeCoverage('revenue',     worldData),
      security:    computeCoverage('security',    worldData),
      bandwidth:   computeCoverage('bandwidth',   worldData),
      improvement: computeCoverage('improvement', worldData),
    })
    // Load existing interview data
    loadExistingData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const loadExistingData = useCallback(async () => {
    try {
      const { data: { user } } = await (supabase as any).auth.getUser()
      if (!user) return
      const { data: profile } = await (supabase as any)
        .from('profiles')
        .select('org_id')
        .eq('id', user.id)
        .maybeSingle()
      const orgId: string | null = profile?.org_id ?? null
      if (!orgId) return
      const { data: settings } = await (supabase as any)
        .from('neural_world_settings')
        .select('fog_interview_data')
        .eq('org_id', orgId)
        .maybeSingle()
      if (settings?.fog_interview_data) {
        const existing = settings.fog_interview_data as FogInterviewData
        if (existing.answers) setAnswers(prev => ({ ...existing.answers, ...prev }))
        if (existing.sectionsCompleted) setCompletedSections(existing.sectionsCompleted)
      }
    } catch {
      // Non-blocking — start fresh
    }
  }, [])

  // Current domain + questions
  const currentDomain: FogDomain = activeDomains[domainIndex] ?? 'revenue'
  const currentDomainMeta        = DOMAINS.find(d => d.id === currentDomain)!
  const questions                = buildQuestionsForDomain(currentDomain, worldData)
  const currentQuestion          = questions[questionIndex]
  const totalQuestions           = questions.length
  const globalTotal              = activeDomains.reduce((s, d) =>
    s + buildQuestionsForDomain(d, worldData).length, 0)
  const globalCurrent            = activeDomains.slice(0, domainIndex).reduce((s, d) =>
    s + buildQuestionsForDomain(d, worldData).length, 0) + questionIndex

  // Local answer for current question
  const currentAnswer = answers[currentQuestion?.id ?? ''] ?? getDefaultAnswer(currentQuestion)

  function getDefaultAnswer(q: Question | undefined): unknown {
    if (!q) return null
    switch (q.type) {
      case 'multi-select':    return []
      case 'dollar':          return ''
      case 'number':          return ''
      case 'yes-no':
      case 'yes-no-partial':  return ''
      case 'slider':          return Math.round((q.min + q.max) / 2)
      case 'text':            return ''
      case 'grid':            return {}
      case 'agent-select':    return ''
    }
  }

  function setCurrentAnswer(value: unknown) {
    if (!currentQuestion) return
    setAnswers(prev => ({ ...prev, [currentQuestion.id]: value }))
  }

  // ── Navigation ──────────────────────────────────────────────────────────────

  async function saveToSupabase(finalAnswers: Record<string, unknown>, sections: FogDomain[], done: boolean) {
    setSaving(true)
    try {
      const { data: { user } } = await (supabase as any).auth.getUser()
      if (!user) return
      const { data: profile } = await (supabase as any)
        .from('profiles')
        .select('org_id')
        .eq('id', user.id)
        .maybeSingle()
      const orgId: string | null = profile?.org_id ?? null
      if (!orgId) return

      const interviewData: FogInterviewData = {
        version:           1,
        completedAt:       done ? new Date().toISOString() : null,
        sectionsCompleted: sections,
        answers:           finalAnswers,
      }

      await (supabase as any)
        .from('neural_world_settings')
        .upsert(
          { org_id: orgId, fog_interview_data: interviewData },
          { onConflict: 'org_id' }
        )

      // Dispatch recalculation events
      window.dispatchEvent(new CustomEvent('nw:fog-interview-complete', { detail: interviewData }))
      if (done) {
        window.dispatchEvent(new CustomEvent('nw:fog-calibrated'))
      }
    } catch {
      // Non-blocking
    } finally {
      setSaving(false)
    }
  }

  function advance(skip = false) {
    if (!skip) {
      // answer already set via setCurrentAnswer
    }

    const nextQ = questionIndex + 1
    if (nextQ < totalQuestions) {
      setQuestionIndex(nextQ)
    } else {
      // Done with this domain
      const newCompleted = completedSections.includes(currentDomain)
        ? completedSections
        : [...completedSections, currentDomain]
      setCompletedSections(newCompleted)

      const nextDomain = domainIndex + 1
      if (nextDomain < activeDomains.length) {
        setDomainIndex(nextDomain)
        setQuestionIndex(0)
        void saveToSupabase(answers, newCompleted, false)
      } else {
        // All done
        setInterviewDone(true)
        void saveToSupabase(answers, newCompleted, true)
      }
    }
  }

  function handleRecalibrate(domain: FogDomain) {
    const idx = activeDomains.indexOf(domain)
    if (idx === -1) {
      // Add domain back for re-interview
      // Simplest: restart from that section
    }
    setDomainIndex(Math.max(0, idx === -1 ? 0 : idx))
    setQuestionIndex(0)
    setInterviewDone(false)
  }

  // ── Keyboard navigation ─────────────────────────────────────────────────────
  const skipRef = useRef(advance)
  skipRef.current = advance

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab') { e.preventDefault(); skipRef.current(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  // ── Completion screen ───────────────────────────────────────────────────────

  if (interviewDone) {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        zIndex: 150,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(18px)',
      }}>
        <div style={{
          width: '100%',
          maxWidth: 600,
          margin: '0 20px',
          background: 'rgba(8,14,24,0.97)',
          border: '1px solid rgba(0,229,204,0.35)',
          borderRadius: 16,
          padding: '48px 40px',
          textAlign: 'center',
          boxShadow: '0 0 60px rgba(0,229,204,0.12)',
        }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
          <div style={{
            fontSize: 24,
            fontFamily: 'monospace',
            fontWeight: 700,
            color: '#00e5cc',
            letterSpacing: 3,
            marginBottom: 10,
          }}>
            FOG CALIBRATED
          </div>
          <div style={{
            fontSize: 13,
            fontFamily: 'monospace',
            color: 'rgba(255,255,255,0.5)',
            marginBottom: 32,
            lineHeight: 1.6,
          }}>
            Your fog density layers have been recalculated with the data you provided.
            The Neural World now has higher fidelity visibility into your business.
          </div>

          {/* Coverage summary */}
          <div style={{ marginBottom: 32 }}>
            {DOMAINS.map(d => {
              const pct = Math.round(
                Math.min(1, coverageDisplay[d.id] + 0.35) * 100
              )
              return (
                <div key={d.id} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginBottom: 10,
                }}>
                  <span style={{ fontSize: 16, width: 24 }}>{d.icon}</span>
                  <span style={{
                    fontSize: 11,
                    fontFamily: 'monospace',
                    color: 'rgba(255,255,255,0.5)',
                    width: 100,
                    textAlign: 'left',
                    letterSpacing: 1,
                  }}>
                    {d.label.toUpperCase()}
                  </span>
                  <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2 }}>
                    <div style={{
                      width: `${pct}%`,
                      height: '100%',
                      background: d.color,
                      borderRadius: 2,
                      boxShadow: `0 0 6px ${d.color}88`,
                    }} />
                  </div>
                  <span style={{
                    fontSize: 11,
                    fontFamily: 'monospace',
                    color: d.color,
                    width: 36,
                    textAlign: 'right',
                  }}>
                    {pct}%
                  </span>
                </div>
              )
            })}
          </div>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <SectionPicker
              completedSections={completedSections}
              onPick={handleRecalibrate}
            />
            <button
              onClick={onClose}
              style={{
                padding: '10px 28px',
                borderRadius: 8,
                border: '1px solid rgba(0,229,204,0.5)',
                background: 'rgba(0,229,204,0.12)',
                color: '#00e5cc',
                fontSize: 12,
                fontFamily: 'monospace',
                letterSpacing: 1.5,
                cursor: 'pointer',
              }}
            >
              RETURN TO WORLD
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Interview screen ────────────────────────────────────────────────────────

  if (!currentQuestion) return null

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 150,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0,0,0,0.85)',
      backdropFilter: 'blur(18px)',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 600,
        margin: '0 20px',
        background: 'rgba(8,14,24,0.97)',
        border: `1px solid ${currentDomainMeta.color}44`,
        borderRadius: 16,
        padding: '36px 36px 28px',
        boxShadow: `0 0 60px ${currentDomainMeta.color}18`,
        maxHeight: '90vh',
        overflowY: 'auto',
        position: 'relative',
      }}>
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            width: 28,
            height: 28,
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(255,255,255,0.05)',
            color: 'rgba(255,255,255,0.45)',
            fontSize: 14,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ✕
        </button>

        {/* Header: domain badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <span style={{ fontSize: 20 }}>{currentDomainMeta.icon}</span>
          <div>
            <div style={{
              fontSize: 10,
              fontFamily: 'monospace',
              color: currentDomainMeta.color,
              letterSpacing: 2,
              textTransform: 'uppercase',
            }}>
              {currentDomainMeta.label} Fog — Calibration
            </div>
            <div style={{
              fontSize: 9,
              fontFamily: 'monospace',
              color: 'rgba(255,255,255,0.3)',
              letterSpacing: 1,
            }}>
              Data coverage: {Math.round(coverageDisplay[currentDomain] * 100)}% → target 60%
            </div>
          </div>

          {/* Domain pills */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {activeDomains.map((d, i) => {
              const dm = DOMAINS.find(x => x.id === d)!
              const done = completedSections.includes(d)
              const active = i === domainIndex
              return (
                <div
                  key={d}
                  title={dm.label}
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: done ? dm.color : active ? dm.color : 'rgba(255,255,255,0.15)',
                    opacity: done ? 1 : active ? 1 : 0.4,
                    boxShadow: active ? `0 0 6px ${dm.color}` : 'none',
                    transition: 'all 0.2s',
                  }}
                />
              )
            })}
          </div>
        </div>

        {/* Progress bar */}
        <ProgressBar
          current={globalCurrent}
          total={globalTotal}
          color={currentDomainMeta.color}
        />

        {/* Question text */}
        <div style={{
          fontSize: 20,
          fontFamily: 'monospace',
          color: '#fff',
          fontWeight: 600,
          lineHeight: 1.5,
          marginBottom: 24,
          letterSpacing: 0.3,
        }}>
          {currentQuestion.text}
        </div>

        {/* Answer input */}
        <div style={{ marginBottom: 32 }}>
          {currentQuestion.type === 'text' && (
            <QuestionText_Input
              q={currentQuestion}
              value={(currentAnswer as string) || ''}
              onChange={setCurrentAnswer}
            />
          )}
          {currentQuestion.type === 'dollar' && (
            <QuestionDollar_Input
              q={currentQuestion}
              value={(currentAnswer as string) || ''}
              onChange={setCurrentAnswer}
            />
          )}
          {currentQuestion.type === 'number' && (
            <QuestionNumber_Input
              q={currentQuestion}
              value={(currentAnswer as string) || ''}
              onChange={setCurrentAnswer}
            />
          )}
          {currentQuestion.type === 'multi-select' && (
            <QuestionMultiSelect_Input
              q={currentQuestion}
              selected={(currentAnswer as string[]) || []}
              onChange={setCurrentAnswer}
            />
          )}
          {(currentQuestion.type === 'yes-no' || currentQuestion.type === 'yes-no-partial') && (
            <QuestionYesNo_Input
              q={currentQuestion}
              value={(currentAnswer as string) || ''}
              onChange={setCurrentAnswer}
            />
          )}
          {currentQuestion.type === 'slider' && (
            <QuestionSlider_Input
              q={currentQuestion}
              value={(currentAnswer as number) ?? Math.round((currentQuestion.min + currentQuestion.max) / 2)}
              onChange={setCurrentAnswer}
            />
          )}
          {currentQuestion.type === 'grid' && (
            <QuestionGrid_Input
              q={currentQuestion}
              values={(currentAnswer as Record<string, number>) || {}}
              onChange={setCurrentAnswer}
            />
          )}
          {currentQuestion.type === 'agent-select' && (
            <QuestionAgentSelect_Input
              value={(currentAnswer as string) || ''}
              onChange={setCurrentAnswer}
            />
          )}
        </div>

        {/* Footer: Skip + Next */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => advance(true)}
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                border: '1px solid rgba(255,255,255,0.15)',
                background: 'transparent',
                color: 'rgba(255,255,255,0.35)',
                fontSize: 10,
                fontFamily: 'monospace',
                letterSpacing: 1.5,
                cursor: 'pointer',
              }}
            >
              SKIP
            </button>
            <span style={{
              fontSize: 9,
              fontFamily: 'monospace',
              color: 'rgba(255,255,255,0.2)',
              alignSelf: 'center',
              letterSpacing: 0.5,
            }}>
              TAB to skip
            </span>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {saving && (
              <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#00e5cc', letterSpacing: 1 }}>
                SAVING…
              </span>
            )}
            <SectionPicker
              completedSections={completedSections}
              onPick={handleRecalibrate}
            />
            <button
              onClick={() => advance(false)}
              style={{
                padding: '10px 28px',
                borderRadius: 8,
                border: `1px solid ${currentDomainMeta.color}88`,
                background: `${currentDomainMeta.color}18`,
                color: currentDomainMeta.color,
                fontSize: 12,
                fontFamily: 'monospace',
                letterSpacing: 2,
                cursor: 'pointer',
                fontWeight: 700,
                transition: 'all 0.15s',
              }}
            >
              {questionIndex < totalQuestions - 1 ? 'NEXT →' : domainIndex < activeDomains.length - 1 ? 'NEXT SECTION →' : 'FINISH ✓'}
            </button>
          </div>
        </div>

        {/* Time estimate hint */}
        <div style={{
          marginTop: 20,
          textAlign: 'center',
          fontSize: 9,
          fontFamily: 'monospace',
          color: 'rgba(255,255,255,0.2)',
          letterSpacing: 1,
        }}>
          Full interview: 20–30 min · Can be done in sections · ESC to close &amp; resume later
        </div>
      </div>
    </div>
  )
}

// ── Exported button component (for CommandHUD) ────────────────────────────────

interface FogCalibrateButtonProps {
  open: boolean
  onClick: () => void
  calibrated: boolean
}

export function FogCalibrateButton({ open, onClick, calibrated }: FogCalibrateButtonProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
      <button
        onClick={onClick}
        title="Calibrate Fog — guided data interview"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 12px',
          borderRadius: 6,
          border: open
            ? '1px solid rgba(0,229,204,0.9)'
            : '1px solid rgba(0,229,204,0.4)',
          background: open
            ? 'rgba(0,229,204,0.18)'
            : 'rgba(0,0,0,0.55)',
          color: open ? '#00e5cc' : 'rgba(0,229,204,0.75)',
          fontSize: 10,
          fontFamily: 'monospace',
          letterSpacing: 1.5,
          cursor: 'pointer',
          backdropFilter: 'blur(6px)',
          transition: 'all 0.18s',
          boxShadow: open ? '0 0 14px rgba(0,229,204,0.25)' : 'none',
        }}
      >
        <span style={{ fontSize: 13 }}>🧭</span>
        CALIBRATE FOG
      </button>
      {calibrated && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 8px',
          borderRadius: 10,
          background: 'rgba(0,229,204,0.12)',
          border: '1px solid rgba(0,229,204,0.4)',
          width: 'fit-content',
        }}>
          <div style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: '#00e5cc',
            boxShadow: '0 0 6px #00e5cc',
          }} />
          <span style={{
            fontSize: 8,
            fontFamily: 'monospace',
            color: '#00e5cc',
            letterSpacing: 1.5,
          }}>
            FOG CALIBRATED
          </span>
        </div>
      )}
    </div>
  )
}
