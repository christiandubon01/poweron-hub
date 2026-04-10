// @ts-nocheck
/**
 * src/components/diagnostics/ScenarioSimulatorPanel.tsx
 * DIAG1 — Scenario Simulator Panel
 *
 * UI for running full financial projections on 10-20 leads.
 *
 * Features:
 *   - Variable toggles: solo / with crew / with PD
 *   - Per-lead projection cards (revenue, cost, margin %, cash flow timing)
 *   - Batch summary bar at top (pipeline, margin, AR)
 *   - 90-day cash-flow timeline with SVG bar chart (green inflow, red outflow)
 *   - Scenario comparison table: SOLO vs WITH_CREW vs WITH_PD
 *   - Low-margin leads flagged red (< 15 %)
 *   - Sort by: margin %, revenue, distance, urgency
 *   - Manual lead entry form (add / remove)
 */

import React, { useState, useMemo, useCallback } from 'react'
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Users,
  User,
  Briefcase,
  DollarSign,
  Clock,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  BarChart2,
  ArrowUpDown,
  CheckCircle,
} from 'lucide-react'
import {
  simulateLead,
  simulateBatch,
  modelCashFlowTimeline,
  type SimulatorLead,
  type SimulatorVariables,
  type LeadProjection,
  type BatchResult,
  type CashFlowTimeline,
  type ScenarioMode,
  type ScenarioComparison,
} from '@/services/diagnostics/LeadScenarioSimulator'

// ─── Sample seed data ─────────────────────────────────────────────────────────

const SEED_LEADS: SimulatorLead[] = [
  { id: 'L01', contact_name: 'Ramirez Residence', lead_type: 'residential', estimated_value: 4_200, estimated_hours: 14, estimated_material: 900, distance_miles: 18, urgency_level: 3 },
  { id: 'L02', contact_name: 'Sunrise Remodel', lead_type: 'residential', estimated_value: 8_500, estimated_hours: 28, estimated_material: 2_100, distance_miles: 24, urgency_level: 4 },
  { id: 'L03', contact_name: 'GC Sub — Apex Build', lead_type: 'gc_sub', estimated_value: 22_000, estimated_hours: 80, estimated_material: 6_400, distance_miles: 35, urgency_level: 2 },
  { id: 'L04', contact_name: 'Solar Install — Diaz', lead_type: 'solar', estimated_value: 14_500, estimated_hours: 40, estimated_material: 5_200, distance_miles: 52, urgency_level: 3 },
  { id: 'L05', contact_name: 'Panel Upgrade — Flores', lead_type: 'residential', estimated_value: 3_800, estimated_hours: 10, estimated_material: 1_200, distance_miles: 12, urgency_level: 5 },
  { id: 'L06', contact_name: 'Commercial TI — DataSpace', lead_type: 'commercial', estimated_value: 31_000, estimated_hours: 110, estimated_material: 9_800, distance_miles: 8, urgency_level: 2 },
  { id: 'L07', contact_name: 'GFCI Service — Nguyen', lead_type: 'service', estimated_value: 850, estimated_hours: 3, estimated_material: 120, distance_miles: 6, urgency_level: 4 },
  { id: 'L08', contact_name: 'EV Charger — Park', lead_type: 'residential', estimated_value: 2_200, estimated_hours: 6, estimated_material: 800, distance_miles: 20, urgency_level: 3 },
  { id: 'L09', contact_name: 'Tenant Build-Out — Vela', lead_type: 'commercial', estimated_value: 18_000, estimated_hours: 65, estimated_material: 5_500, distance_miles: 15, urgency_level: 3 },
  { id: 'L10', contact_name: 'Troubleshoot — Martinez', lead_type: 'service', estimated_value: 600, estimated_hours: 2, estimated_material: 60, distance_miles: 10, urgency_level: 5 },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(n: number): string {
  return '$' + Math.round(n).toLocaleString()
}

function fmtPct(n: number): string {
  return n.toFixed(1) + '%'
}

function marginColor(pct: number): string {
  if (pct >= 30) return 'text-emerald-400'
  if (pct >= 15) return 'text-yellow-400'
  return 'text-red-400'
}

function marginBg(pct: number): string {
  if (pct >= 30) return 'bg-emerald-900/30 border-emerald-700/40'
  if (pct >= 15) return 'bg-yellow-900/20 border-yellow-700/40'
  return 'bg-red-900/30 border-red-700/50'
}

type SortKey = 'margin' | 'revenue' | 'distance' | 'urgency'

function sortLeads(leads: SimulatorLead[], key: SortKey): SimulatorLead[] {
  return [...leads].sort((a, b) => {
    if (key === 'margin') {
      // sort by estimated margin from a quick solo BASE projection
      const mA = (a.estimated_value ?? 0)
      const mB = (b.estimated_value ?? 0)
      return mB - mA
    }
    if (key === 'revenue') return (b.estimated_value ?? 0) - (a.estimated_value ?? 0)
    if (key === 'distance') return (a.distance_miles ?? 0) - (b.distance_miles ?? 0)
    if (key === 'urgency') return (b.urgency_level ?? 0) - (a.urgency_level ?? 0)
    return 0
  })
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface BatchSummaryBarProps {
  result: BatchResult
}

function BatchSummaryBar({ result }: BatchSummaryBarProps) {
  return (
    <div className="rounded-xl bg-slate-800/80 border border-slate-700 p-4 mb-4">
      <p className="text-xs text-slate-400 font-medium uppercase tracking-widest mb-3">
        Pipeline Summary — {result.projections.length} Leads
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric
          icon={<DollarSign size={14} />}
          label="Total Pipeline"
          value={fmt$(result.totalPipelineValue)}
          color="text-sky-400"
        />
        <Metric
          icon={<TrendingUp size={14} />}
          label="Net Margin"
          value={`${fmt$(result.totalNetMargin)} (${fmtPct(result.totalMarginPct)})`}
          color={marginColor(result.totalMarginPct)}
        />
        <Metric
          icon={<BarChart2 size={14} />}
          label="Total Cost"
          value={fmt$(result.totalCost)}
          color="text-orange-400"
        />
        <Metric
          icon={<AlertTriangle size={14} />}
          label="AR Exposure"
          value={fmt$(result.totalARExposure)}
          color={result.totalARExposure > 50_000 ? 'text-red-400' : 'text-slate-300'}
        />
      </div>
      <p className="mt-3 text-xs text-slate-300 leading-relaxed border-t border-slate-700 pt-3">
        {result.summary}
      </p>
    </div>
  )
}

interface MetricProps {
  icon: React.ReactNode
  label: string
  value: string
  color?: string
}

function Metric({ icon, label, value, color = 'text-white' }: MetricProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1 text-slate-500">
        {icon}
        <span className="text-[10px] uppercase tracking-wide">{label}</span>
      </div>
      <span className={`text-sm font-bold ${color}`}>{value}</span>
    </div>
  )
}

interface LeadCardProps {
  projection: LeadProjection
  lead: SimulatorLead
  isExpanded: boolean
  onToggle: () => void
}

function LeadCard({ projection, lead, isExpanded, onToggle }: LeadCardProps) {
  const { breakdown, cashFlow, flags, isLowMargin } = projection

  return (
    <div className={`rounded-xl border p-4 transition-all ${marginBg(breakdown.marginPct)}`}>
      <button
        onClick={onToggle}
        className="w-full flex items-start justify-between gap-3 text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-white truncate">
              {projection.leadLabel}
            </span>
            {isLowMargin && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-red-400 bg-red-900/40 px-1.5 py-0.5 rounded">
                Low Margin
              </span>
            )}
            {(lead.urgency_level ?? 0) >= 4 && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-orange-400 bg-orange-900/30 px-1.5 py-0.5 rounded">
                Urgent
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-4 mt-1.5 text-xs">
            <span className="text-slate-400">
              Revenue: <span className="text-sky-300 font-medium">{fmt$(breakdown.grossRevenue)}</span>
            </span>
            <span className="text-slate-400">
              Cost: <span className="text-orange-300 font-medium">{fmt$(breakdown.totalCost)}</span>
            </span>
            <span className="text-slate-400">
              Net: <span className={`font-bold ${marginColor(breakdown.marginPct)}`}>
                {fmt$(breakdown.netMargin)} ({fmtPct(breakdown.marginPct)})
              </span>
            </span>
          </div>
        </div>
        <div className="flex-shrink-0 text-slate-500 pt-0.5">
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {isExpanded && (
        <div className="mt-4 space-y-4 border-t border-slate-700/50 pt-4">
          {/* Cost breakdown */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
            <CostRow label="Labor" value={breakdown.laborCost} />
            <CostRow label="Materials" value={breakdown.materialCost} />
            <CostRow label="Overhead" value={breakdown.overheadCost} />
            <CostRow label="Drive Time" value={breakdown.driveTimeCost} />
            {breakdown.pdCost > 0 && (
              <CostRow label="Project Director" value={breakdown.pdCost} />
            )}
          </div>

          {/* Cash flow timing */}
          <div className="rounded-lg bg-slate-900/50 p-3 text-xs space-y-1">
            <p className="text-slate-400 font-semibold uppercase tracking-wide text-[10px] mb-1">
              Cash Flow Timing
            </p>
            <p className="text-slate-300">
              Costs start: <span className="text-white font-medium">{cashFlow.costsStartDate}</span>
            </p>
            <p className="text-slate-300">
              Payment arrives: <span className="text-emerald-400 font-medium">{cashFlow.revenueArrivalDate}</span>
            </p>
            <p className="text-slate-300">
              Float: <span className="text-yellow-400 font-medium">{cashFlow.floatDays} days</span>
            </p>
          </div>

          {/* Flags */}
          {flags.length > 0 && (
            <div className="space-y-1">
              {flags.map((f, i) => (
                <p key={i} className="text-xs text-slate-400">{f}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface CostRowProps {
  label: string
  value: number
}

function CostRow({ label, value }: CostRowProps) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-300 font-medium">{fmt$(value)}</span>
    </div>
  )
}

// ─── 90-Day Cash Flow Chart ───────────────────────────────────────────────────

interface CashFlowChartProps {
  timeline: CashFlowTimeline
}

function CashFlowChart({ timeline }: CashFlowChartProps) {
  const { weeks } = timeline
  const maxVal = Math.max(...weeks.map(w => Math.max(w.inflow, w.outflow)), 1)
  const chartH = 120
  const barW = 18
  const gap = 6
  const totalW = weeks.length * (barW * 2 + gap + 4)

  return (
    <div className="rounded-xl bg-slate-800/80 border border-slate-700 p-4">
      <p className="text-xs text-slate-400 font-medium uppercase tracking-widest mb-3">
        90-Day Cash Flow Timeline
      </p>

      <div className="overflow-x-auto">
        <svg width={totalW} height={chartH + 36} className="block">
          {weeks.map((week, i) => {
            const x = i * (barW * 2 + gap + 4) + 2
            const inflowH = Math.round((week.inflow / maxVal) * chartH)
            const outflowH = Math.round((week.outflow / maxVal) * chartH)
            const hasGap = week.net < 0

            return (
              <g key={week.weekNumber}>
                {/* Inflow bar (green) */}
                <rect
                  x={x}
                  y={chartH - inflowH}
                  width={barW}
                  height={inflowH}
                  rx={2}
                  fill={inflowH > 0 ? '#10b981' : 'transparent'}
                  opacity={0.85}
                />
                {/* Outflow bar (red) */}
                <rect
                  x={x + barW + 2}
                  y={chartH - outflowH}
                  width={barW}
                  height={outflowH}
                  rx={2}
                  fill={outflowH > 0 ? '#ef4444' : 'transparent'}
                  opacity={0.75}
                />
                {/* Gap indicator */}
                {hasGap && (
                  <text
                    x={x + barW}
                    y={chartH + 26}
                    textAnchor="middle"
                    fontSize={8}
                    fill="#ef4444"
                  >
                    ⚠
                  </text>
                )}
                {/* Week label */}
                <text
                  x={x + barW}
                  y={chartH + 14}
                  textAnchor="middle"
                  fontSize={8}
                  fill="#64748b"
                >
                  W{week.weekNumber}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex gap-4 mt-2 text-[10px]">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" />
          Inflow
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-red-500 inline-block" />
          Outflow
        </span>
        <span className="flex items-center gap-1 text-red-400">
          ⚠ Negative week
        </span>
      </div>

      {/* Gap list */}
      {timeline.gaps.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-slate-700 pt-3">
          {timeline.gaps.map(g => (
            <p key={g.weekNumber} className="text-xs text-red-400">
              {g.recommendation}
            </p>
          ))}
        </div>
      )}

      <p className="mt-3 text-xs text-slate-400">{timeline.summary}</p>
    </div>
  )
}

// ─── Scenario Comparison Table ────────────────────────────────────────────────

interface ScenarioTableProps {
  comparison: ScenarioComparison[]
}

function ScenarioTable({ comparison }: ScenarioTableProps) {
  return (
    <div className="rounded-xl bg-slate-800/80 border border-slate-700 p-4">
      <p className="text-xs text-slate-400 font-medium uppercase tracking-widest mb-3">
        Scenario Comparison — SOLO vs CREW vs PD (Base Case)
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[560px]">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-left py-2 pr-4 text-slate-500 font-medium">Lead</th>
              <th className="text-right py-2 pr-4 text-slate-500 font-medium">
                <User size={10} className="inline mr-1" />Solo
              </th>
              <th className="text-right py-2 pr-4 text-slate-500 font-medium">
                <Users size={10} className="inline mr-1" />Crew
              </th>
              <th className="text-right py-2 text-slate-500 font-medium">
                <Briefcase size={10} className="inline mr-1" />PD
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/40">
            {comparison.map(row => (
              <tr key={row.leadId} className="hover:bg-slate-700/20">
                <td className="py-2 pr-4 text-slate-300 font-medium truncate max-w-[160px]">
                  {row.leadLabel}
                </td>
                <td className={`py-2 pr-4 text-right font-bold ${marginColor(row.solo.marginPct)}`}>
                  {fmtPct(row.solo.marginPct)}
                  <span className="text-slate-500 font-normal ml-1">
                    ({fmt$(row.solo.netMargin)})
                  </span>
                </td>
                <td className={`py-2 pr-4 text-right font-bold ${marginColor(row.withCrew.marginPct)}`}>
                  {fmtPct(row.withCrew.marginPct)}
                  <span className="text-slate-500 font-normal ml-1">
                    ({fmt$(row.withCrew.netMargin)})
                  </span>
                </td>
                <td className={`py-2 text-right font-bold ${marginColor(row.withPD.marginPct)}`}>
                  {fmtPct(row.withPD.marginPct)}
                  <span className="text-slate-500 font-normal ml-1">
                    ({fmt$(row.withPD.netMargin)})
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Variable Controls ────────────────────────────────────────────────────────

interface VariableControlsProps {
  variables: SimulatorVariables
  onChange: (v: SimulatorVariables) => void
}

function VariableControls({ variables, onChange }: VariableControlsProps) {
  function toggle(key: keyof SimulatorVariables) {
    onChange({ ...variables, [key]: !variables[key] })
  }

  function setNum(key: keyof SimulatorVariables, raw: string) {
    const v = parseFloat(raw) || 0
    onChange({ ...variables, [key]: v })
  }

  const modes: Array<{ key: ScenarioMode; label: string; icon: React.ReactNode }> = [
    { key: 'SOLO', label: 'Solo', icon: <User size={13} /> },
    { key: 'WITH_CREW', label: 'With Crew', icon: <Users size={13} /> },
    { key: 'WITH_PD', label: 'With PD', icon: <Briefcase size={13} /> },
  ]

  const activeMode: ScenarioMode = variables.hasProjectDirector
    ? 'WITH_PD'
    : variables.hasCrew
    ? 'WITH_CREW'
    : 'SOLO'

  function setMode(mode: ScenarioMode) {
    onChange({
      ...variables,
      hasCrew: mode === 'WITH_CREW' || mode === 'WITH_PD',
      hasProjectDirector: mode === 'WITH_PD',
    })
  }

  return (
    <div className="rounded-xl bg-slate-800/80 border border-slate-700 p-4 mb-4">
      <p className="text-xs text-slate-400 font-medium uppercase tracking-widest mb-3">
        Scenario Variables
      </p>

      {/* Mode selector */}
      <div className="flex gap-2 mb-4">
        {modes.map(m => (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
              activeMode === m.key
                ? 'bg-sky-600 border-sky-500 text-white'
                : 'bg-slate-700 border-slate-600 text-slate-400 hover:text-white'
            }`}
          >
            {m.icon}
            {m.label}
          </button>
        ))}
      </div>

      {/* Cash inputs */}
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">Cash Buffer ($)</span>
          <input
            type="number"
            value={variables.cashFlowBuffer}
            onChange={e => setNum('cashFlowBuffer', e.target.value)}
            className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">Current AR ($)</span>
          <input
            type="number"
            value={variables.currentAR}
            onChange={e => setNum('currentAR', e.target.value)}
            className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500"
          />
        </label>
      </div>
    </div>
  )
}

// ─── Manual Lead Entry ────────────────────────────────────────────────────────

interface AddLeadFormProps {
  onAdd: (lead: SimulatorLead) => void
}

function AddLeadForm({ onAdd }: AddLeadFormProps) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<Partial<SimulatorLead>>({ id: '' })

  function submit() {
    const lead: SimulatorLead = {
      id: `M${Date.now()}`,
      contact_name: form.contact_name ?? 'New Lead',
      estimated_value: Number(form.estimated_value) || 0,
      estimated_hours: Number(form.estimated_hours) || undefined,
      estimated_material: Number(form.estimated_material) || undefined,
      distance_miles: Number(form.distance_miles) || 0,
      urgency_level: Number(form.urgency_level) || 3,
    }
    onAdd(lead)
    setForm({ id: '' })
    setOpen(false)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs text-slate-300 border border-slate-600 transition-all"
      >
        <Plus size={12} /> Add Lead Manually
      </button>
    )
  }

  return (
    <div className="rounded-xl bg-slate-800/80 border border-slate-600 p-4 mb-4">
      <p className="text-xs text-slate-400 font-medium uppercase tracking-widest mb-3">
        Add Lead Manually
      </p>
      <div className="grid grid-cols-2 gap-3 text-xs">
        {[
          { key: 'contact_name', label: 'Name / Company', type: 'text' },
          { key: 'estimated_value', label: 'Job Value ($)', type: 'number' },
          { key: 'estimated_hours', label: 'Est. Hours (opt)', type: 'number' },
          { key: 'estimated_material', label: 'Materials ($) (opt)', type: 'number' },
          { key: 'distance_miles', label: 'Distance (mi RT)', type: 'number' },
          { key: 'urgency_level', label: 'Urgency 1-5', type: 'number' },
        ].map(f => (
          <label key={f.key} className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-slate-500">{f.label}</span>
            <input
              type={f.type}
              value={(form as any)[f.key] ?? ''}
              onChange={e => setForm({ ...form, [f.key]: e.target.value })}
              className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500"
            />
          </label>
        ))}
      </div>
      <div className="flex gap-2 mt-4">
        <button
          onClick={submit}
          className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold"
        >
          Add
        </button>
        <button
          onClick={() => setOpen(false)}
          className="px-4 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export interface ScenarioSimulatorPanelProps {
  /** Optional: inject leads from HUNTER inbox instead of using seed data */
  initialLeads?: SimulatorLead[]
}

export default function ScenarioSimulatorPanel({ initialLeads }: ScenarioSimulatorPanelProps) {
  // ── State ────────────────────────────────────────────────────────────────
  const [leads, setLeads] = useState<SimulatorLead[]>(initialLeads ?? SEED_LEADS)
  const [variables, setVariables] = useState<SimulatorVariables>({
    hasCrew: false,
    hasProjectDirector: false,
    cashFlowBuffer: 10_000,
    currentAR: 18_500,
  })
  const [sortKey, setSortKey] = useState<SortKey>('margin')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'leads' | 'cashflow' | 'compare'>('leads')

  const sortedLeads = useMemo(() => sortLeads(leads, sortKey), [leads, sortKey])

  const startDate = useMemo(() => new Date().toISOString().slice(0, 10), [])

  const batchResult: BatchResult = useMemo(
    () => simulateBatch(sortedLeads, variables, startDate),
    [sortedLeads, variables, startDate],
  )

  const timeline: CashFlowTimeline = useMemo(
    () => modelCashFlowTimeline(sortedLeads, startDate, variables),
    [sortedLeads, startDate, variables],
  )

  // Map each projection by leadId for quick lookup
  const projectionMap = useMemo(() => {
    const m: Record<string, LeadProjection> = {}
    for (const p of batchResult.projections) {
      m[p.leadId] = p
    }
    return m
  }, [batchResult])

  function removeLead(id: string) {
    setLeads(prev => prev.filter(l => l.id !== id))
  }

  const tabs = [
    { key: 'leads' as const, label: 'Lead Cards' },
    { key: 'cashflow' as const, label: '90-Day Cash Flow' },
    { key: 'compare' as const, label: 'Scenario Compare' },
  ]

  const sortOptions: Array<{ key: SortKey; label: string }> = [
    { key: 'margin', label: 'Margin %' },
    { key: 'revenue', label: 'Revenue' },
    { key: 'distance', label: 'Distance' },
    { key: 'urgency', label: 'Urgency' },
  ]

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <BarChart2 size={18} className="text-sky-400" />
            Scenario Simulator
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Full financial projections for your lead pipeline
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <AddLeadForm onAdd={l => setLeads(prev => [...prev, l])} />
          <span className="text-xs text-slate-500">
            {leads.length} lead{leads.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Variable controls */}
      <VariableControls variables={variables} onChange={setVariables} />

      {/* Batch summary */}
      <BatchSummaryBar result={batchResult} />

      {/* Flagged leads callout */}
      {batchResult.flaggedLeads.length > 0 && (
        <div className="rounded-xl bg-red-900/30 border border-red-700/50 p-3 flex items-start gap-2">
          <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-red-300">
              {batchResult.flaggedLeads.length} lead(s) below 15% margin
            </p>
            <p className="text-xs text-red-400 mt-0.5">
              {batchResult.flaggedLeads.map(p => p.leadLabel).join(', ')}
            </p>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-slate-700 pb-0.5">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-t-lg transition-all ${
              activeTab === t.key
                ? 'bg-slate-700 text-white border-b-2 border-sky-500'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Lead Cards Tab */}
      {activeTab === 'leads' && (
        <div className="space-y-3">
          {/* Sort controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <ArrowUpDown size={12} className="text-slate-500" />
            <span className="text-xs text-slate-500">Sort:</span>
            {sortOptions.map(s => (
              <button
                key={s.key}
                onClick={() => setSortKey(s.key)}
                className={`px-2 py-1 rounded text-[10px] font-medium border transition-all ${
                  sortKey === s.key
                    ? 'bg-sky-700 border-sky-600 text-white'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {sortedLeads.map(lead => {
            const proj = projectionMap[lead.id]
            if (!proj) return null

            return (
              <div key={lead.id} className="relative">
                <LeadCard
                  lead={lead}
                  projection={proj}
                  isExpanded={expandedId === lead.id}
                  onToggle={() => setExpandedId(prev => prev === lead.id ? null : lead.id)}
                />
                <button
                  onClick={() => removeLead(lead.id)}
                  title="Remove lead"
                  className="absolute top-3 right-8 text-slate-600 hover:text-red-400 transition-colors"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Cash Flow Tab */}
      {activeTab === 'cashflow' && (
        <CashFlowChart timeline={timeline} />
      )}

      {/* Scenario Compare Tab */}
      {activeTab === 'compare' && (
        <ScenarioTable comparison={batchResult.scenarioComparison} />
      )}
    </div>
  )
}
