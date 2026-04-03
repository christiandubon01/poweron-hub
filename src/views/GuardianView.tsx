// @ts-nocheck
/**
 * src/views/GuardianView.tsx — GUARDIAN Rules Engine View
 *
 * E5 | GUARDIAN Rules Engine
 *
 * Layout:
 *   Panel 1 — Active Rules (header contains "Run Audit" button)
 *   Panel 2 — Violations (appends on each audit run)
 *   Panel 3 — Audit Trail (timestamps + violation counts)
 *
 * Approval gate:
 *   HIGH violations → confirmation modal before results are displayed.
 *   LOW / MEDIUM violations → display immediately with no gate.
 */

import React, { useState, useCallback } from 'react'
import {
  ShieldAlert,
  ShieldCheck,
  Play,
  AlertTriangle,
  CheckCircle,
  Clock,
  FileText,
  RefreshCw,
  X,
  ChevronRight,
} from 'lucide-react'
import {
  evaluateRules,
  generateAuditEntry,
  DEFAULT_RULES,
  type GuardianRule,
  type GuardianViolation,
  type GuardianAuditEntry,
  type GuardianData,
} from '@/agents/guardian'

// ── Mock Business Data ─────────────────────────────────────────────────────────
// Representative fixtures that exercise all 5 rule types.
// Relative dates keep violations fresh on any run date.

const _now = Date.now()
const _day = 86400000

function isoDate(offsetDays: number): string {
  return new Date(_now + offsetDays * _day).toISOString().slice(0, 10)
}

const MOCK_DATA: GuardianData = {
  invoices: [
    {
      id: 'inv_1',
      client: 'Alpha Electric Supply',
      amount: 14500,
      dueDate: isoDate(-45),   // 45 days overdue → HIGH
      status: 'overdue',
    },
    {
      id: 'inv_2',
      client: 'Westside GC',
      amount: 8200,
      dueDate: isoDate(-35),   // 35 days overdue → HIGH
      status: 'pending',
    },
    {
      id: 'inv_3',
      client: 'Harbor View Dev',
      amount: 6750,
      dueDate: isoDate(-10),   // 10 days overdue — under threshold, no flag
      status: 'pending',
    },
    {
      id: 'inv_4',
      client: 'Ridgeline Construction',
      amount: 11000,
      dueDate: isoDate(14),    // not yet due
      status: 'pending',
    },
  ],
  leads: [
    {
      id: 'lead_1',
      company: 'Pacific Builders Group',
      lastFollowUpDate: isoDate(-14),  // 14 days ago → MEDIUM
    },
    {
      id: 'lead_2',
      company: 'Summit Properties',
      lastFollowUpDate: isoDate(-3),   // 3 days ago — under threshold
    },
    {
      id: 'lead_3',
      company: 'Northgate Commercial',
      lastFollowUpDate: null,          // never followed up → MEDIUM
    },
    {
      id: 'lead_4',
      company: 'Bayside Renovations',
      lastFollowUpDate: isoDate(-9),   // 9 days ago → MEDIUM
    },
  ],
  fieldLogs: [
    {
      id: 'fl_1',
      projectId: 'proj_1',
      projectName: 'Downtown Office Reno',
      lastLogDate: isoDate(-6),        // 6 days ago, active → MEDIUM
      projectStatus: 'active',
    },
    {
      id: 'fl_2',
      projectId: 'proj_2',
      projectName: 'Warehouse Phase 2',
      lastLogDate: isoDate(-1),        // yesterday — under threshold
      projectStatus: 'active',
    },
    {
      id: 'fl_3',
      projectId: 'proj_3',
      projectName: 'Completed Fit-Out',
      lastLogDate: isoDate(-8),        // completed — excluded by rule
      projectStatus: 'completed',
    },
  ],
  crewMembers: [
    {
      id: 'crew_1',
      name: 'Mike Torres',
      hoursThisWeek: 0,   // no hours → LOW
    },
    {
      id: 'crew_2',
      name: 'Jamie Walsh',
      hoursThisWeek: 32,
    },
    {
      id: 'crew_3',
      name: 'Sam Rivera',
      hoursThisWeek: 0,   // no hours → LOW
    },
    {
      id: 'crew_4',
      name: 'Casey Novak',
      hoursThisWeek: 24,
    },
  ],
  projects: [
    {
      id: 'proj_wh2',
      name: 'Warehouse Phase 2',
      health: 28,          // below 40% → HIGH
      status: 'active',
    },
    {
      id: 'proj_offr',
      name: 'Downtown Office Reno',
      health: 72,
      status: 'active',
    },
    {
      id: 'proj_res',
      name: 'Residential Remodel A',
      health: 55,
      status: 'active',
    },
  ],
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function severityColors(severity: string): { bg: string; border: string; text: string; dot: string } {
  switch (severity) {
    case 'HIGH':
      return {
        bg: 'bg-red-900/15',
        border: 'border-red-700/40',
        text: 'text-red-400',
        dot: 'bg-red-500',
      }
    case 'MEDIUM':
      return {
        bg: 'bg-amber-900/15',
        border: 'border-amber-700/40',
        text: 'text-amber-400',
        dot: 'bg-amber-500',
      }
    default:
      return {
        bg: 'bg-yellow-900/10',
        border: 'border-yellow-700/30',
        text: 'text-yellow-400',
        dot: 'bg-yellow-500',
      }
  }
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function triggerLabel(type: string): string {
  switch (type) {
    case 'INVOICE_OVERDUE':    return 'Invoice Overdue'
    case 'LEAD_NO_FOLLOWUP':   return 'Lead No Follow-Up'
    case 'FIELD_LOG_MISSING':  return 'Field Log Missing'
    case 'CREW_NO_HOURS':      return 'Crew No Hours'
    case 'PROJECT_HEALTH_LOW': return 'Project Health Low'
    default: return type
  }
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: string }) {
  const c = severityColors(severity)
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${c.bg} ${c.border} ${c.text}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {severity}
    </span>
  )
}

function ViolationCard({ violation }: { violation: GuardianViolation }) {
  const c = severityColors(violation.severity)
  return (
    <div className={`rounded-xl border p-3 space-y-1.5 ${c.bg} ${c.border}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <SeverityBadge severity={violation.severity} />
          <span className="text-[10px] text-gray-500 bg-gray-800/60 border border-gray-700/30 rounded-full px-2 py-0.5">
            {triggerLabel(violation.triggerType)}
          </span>
        </div>
        <span className="text-[10px] text-gray-600 whitespace-nowrap flex-shrink-0">
          {formatTimestamp(violation.detectedAt)}
        </span>
      </div>
      <p className="text-white text-xs font-medium">{violation.subject}</p>
      <p className="text-gray-400 text-xs leading-relaxed">{violation.detail}</p>
    </div>
  )
}

function RuleRow({ rule }: { rule: GuardianRule }) {
  const c = severityColors(rule.severity)
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-gray-800/60 bg-gray-800/20">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c.dot}`} />
      <div className="flex-1 min-w-0">
        <p className="text-gray-200 text-xs font-medium truncate">{rule.name}</p>
        <p className="text-gray-600 text-[10px] leading-tight mt-0.5 truncate">{rule.description}</p>
      </div>
      <SeverityBadge severity={rule.severity} />
    </div>
  )
}

function AuditRow({ entry }: { entry: GuardianAuditEntry }) {
  const hasViolations = entry.violationCount > 0
  return (
    <div className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border ${hasViolations ? 'border-amber-800/30 bg-amber-900/8' : 'border-emerald-800/30 bg-emerald-900/8'}`}>
      <div className={`mt-0.5 flex-shrink-0 ${hasViolations ? 'text-amber-500' : 'text-emerald-500'}`}>
        {hasViolations ? <AlertTriangle size={13} /> : <CheckCircle size={13} />}
      </div>
      <div className="flex-1 min-w-0 space-y-0.5">
        <p className="text-gray-300 text-xs">{entry.result}</p>
        <p className="text-gray-600 text-[10px]">{entry.action} · {formatTimestamp(entry.timestamp)}</p>
      </div>
      {hasViolations && (
        <div className="flex items-center gap-1 flex-shrink-0">
          {entry.highCount > 0   && <span className="text-[10px] text-red-400 bg-red-900/20 border border-red-700/30 px-1.5 py-0.5 rounded">{entry.highCount}H</span>}
          {entry.mediumCount > 0 && <span className="text-[10px] text-amber-400 bg-amber-900/20 border border-amber-700/30 px-1.5 py-0.5 rounded">{entry.mediumCount}M</span>}
          {entry.lowCount > 0    && <span className="text-[10px] text-yellow-400 bg-yellow-900/20 border border-yellow-700/30 px-1.5 py-0.5 rounded">{entry.lowCount}L</span>}
        </div>
      )}
    </div>
  )
}

// ── Confirmation Modal ─────────────────────────────────────────────────────────

interface HighViolationModalProps {
  count: number
  onReview: () => void
  onCancel: () => void
}

function HighViolationModal({ count, onReview, onCancel }: HighViolationModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Modal card */}
      <div className="relative z-10 w-full max-w-sm mx-4 rounded-2xl bg-gray-900 border border-red-700/50 shadow-2xl overflow-hidden">
        {/* Top accent strip */}
        <div className="h-1 w-full bg-gradient-to-r from-red-600 to-red-400" />

        <div className="p-6 space-y-4">
          {/* Icon + heading */}
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-500/15 border border-red-700/40 flex items-center justify-center flex-shrink-0">
              <ShieldAlert size={20} className="text-red-400" />
            </div>
            <div>
              <h3 className="text-white font-bold text-base leading-tight">
                Critical Violations Found
              </h3>
              <p className="text-gray-400 text-xs mt-0.5">Approval required before proceeding</p>
            </div>
          </div>

          {/* Body */}
          <p className="text-gray-300 text-sm leading-relaxed">
            GUARDIAN found{' '}
            <span className="text-red-400 font-semibold">{count} critical violation{count !== 1 ? 's' : ''}</span>.
            Review before proceeding.
          </p>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              onClick={onReview}
              className="flex-1 flex items-center justify-center gap-2 text-sm font-semibold bg-red-700/30 hover:bg-red-700/50 text-red-300 border border-red-700/50 px-4 py-2.5 rounded-xl transition-colors"
            >
              <ChevronRight size={15} />
              Review
            </button>
            <button
              onClick={onCancel}
              className="flex-1 flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-gray-200 border border-gray-700/40 px-4 py-2.5 rounded-xl transition-colors bg-gray-800/40 hover:bg-gray-800/80"
            >
              <X size={14} />
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Panel header ───────────────────────────────────────────────────────────────

function PanelHeader({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: React.ReactNode
  title: string
  subtitle?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-800">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="text-emerald-400 flex-shrink-0">{icon}</div>
        <div className="min-w-0">
          <h3 className="text-white text-sm font-semibold truncate">{title}</h3>
          {subtitle && (
            <p className="text-gray-600 text-[10px] truncate">{subtitle}</p>
          )}
        </div>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}

// ── Main View ──────────────────────────────────────────────────────────────────

export function GuardianView() {
  const [violations, setViolations]     = useState<GuardianViolation[]>([])
  const [auditLog, setAuditLog]         = useState<GuardianAuditEntry[]>([])
  const [running, setRunning]           = useState(false)

  // Pending state: violations returned but awaiting modal confirmation (HIGH gate)
  const [pendingViolations, setPendingViolations] = useState<GuardianViolation[] | null>(null)
  const [pendingAuditEntry, setPendingAuditEntry] = useState<GuardianAuditEntry | null>(null)

  const activeRules = DEFAULT_RULES.filter(r => r.active)
  const highCount   = violations.filter(v => v.severity === 'HIGH').length
  const medCount    = violations.filter(v => v.severity === 'MEDIUM').length
  const lowCount    = violations.filter(v => v.severity === 'LOW').length

  // ── Run Audit ────────────────────────────────────────────────────────────────

  const handleRunAudit = useCallback(() => {
    if (running) return
    setRunning(true)

    // Small async tick to allow spinner to render before CPU-bound work
    setTimeout(() => {
      const result    = evaluateRules(DEFAULT_RULES, MOCK_DATA)
      const entry     = generateAuditEntry('Manual Run Audit', result)
      const hasHigh   = result.some(v => v.severity === 'HIGH')

      if (hasHigh) {
        // Store pending and show approval modal
        setPendingViolations(result)
        setPendingAuditEntry(entry)
      } else {
        // LOW / MEDIUM — display immediately
        setViolations(prev => [...result, ...prev])
        setAuditLog(prev => [entry, ...prev])
      }

      setRunning(false)
    }, 0)
  }, [running])

  // ── Modal: Review ─────────────────────────────────────────────────────────────

  const handleModalReview = useCallback(() => {
    if (!pendingViolations || !pendingAuditEntry) return
    setViolations(prev => [...pendingViolations, ...prev])
    setAuditLog(prev => [pendingAuditEntry, ...prev])
    setPendingViolations(null)
    setPendingAuditEntry(null)
  }, [pendingViolations, pendingAuditEntry])

  // ── Modal: Cancel ─────────────────────────────────────────────────────────────

  const handleModalCancel = useCallback(() => {
    // Log the cancelled run to audit trail but don't show violations
    if (pendingAuditEntry) {
      const cancelledEntry: GuardianAuditEntry = {
        ...pendingAuditEntry,
        action: 'Run Audit (cancelled by user)',
        result: `Audit cancelled — ${pendingAuditEntry.highCount} HIGH violation${pendingAuditEntry.highCount !== 1 ? 's' : ''} not reviewed.`,
      }
      setAuditLog(prev => [cancelledEntry, ...prev])
    }
    setPendingViolations(null)
    setPendingAuditEntry(null)
  }, [pendingAuditEntry])

  // ── Pending HIGH count for modal ──────────────────────────────────────────────

  const pendingHighCount = pendingViolations
    ? pendingViolations.filter(v => v.severity === 'HIGH').length
    : 0

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white overflow-hidden">

      {/* ── Page header ── */}
      <div className="px-5 pt-5 pb-4 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-700/30 flex items-center justify-center">
            <ShieldAlert size={20} className="text-emerald-400" />
          </div>
          <div>
            <h2 className="text-white font-bold text-lg leading-tight">GUARDIAN</h2>
            <p className="text-gray-500 text-xs">Rules Engine · Business compliance · Violation tracking</p>
          </div>
        </div>

        {/* Summary badges */}
        {violations.length > 0 && (
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <span className="text-[11px] text-gray-500">{violations.length} total violation{violations.length !== 1 ? 's' : ''}:</span>
            {highCount > 0 && (
              <span className="text-[10px] font-semibold text-red-400 bg-red-900/20 border border-red-700/30 px-2 py-0.5 rounded-full">
                {highCount} HIGH
              </span>
            )}
            {medCount > 0 && (
              <span className="text-[10px] font-semibold text-amber-400 bg-amber-900/20 border border-amber-700/30 px-2 py-0.5 rounded-full">
                {medCount} MEDIUM
              </span>
            )}
            {lowCount > 0 && (
              <span className="text-[10px] font-semibold text-yellow-400 bg-yellow-900/20 border border-yellow-700/30 px-2 py-0.5 rounded-full">
                {lowCount} LOW
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        {/* ── Panel 1: Active Rules ── */}
        <div className="rounded-2xl border border-gray-800 bg-gray-800/20 overflow-hidden">
          <PanelHeader
            icon={<ShieldCheck size={16} />}
            title="Active Rules"
            subtitle={`${activeRules.length} rule${activeRules.length !== 1 ? 's' : ''} configured`}
            action={
              <button
                onClick={handleRunAudit}
                disabled={running}
                className="flex items-center gap-2 text-xs font-semibold bg-emerald-700/25 hover:bg-emerald-700/45 text-emerald-400 border border-emerald-700/40 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {running ? (
                  <><RefreshCw size={12} className="animate-spin" /> Running…</>
                ) : (
                  <><Play size={12} /> Run Audit</>
                )}
              </button>
            }
          />

          <div className="p-3 space-y-1.5">
            {DEFAULT_RULES.map(rule => (
              <RuleRow key={rule.id} rule={rule} />
            ))}
          </div>
        </div>

        {/* ── Panel 2: Violations ── */}
        <div className="rounded-2xl border border-gray-800 bg-gray-800/20 overflow-hidden">
          <PanelHeader
            icon={<AlertTriangle size={16} />}
            title="Violations"
            subtitle={
              violations.length === 0
                ? 'No violations detected yet — run an audit'
                : `${violations.length} violation${violations.length !== 1 ? 's' : ''} detected`
            }
          />

          <div className="p-3">
            {violations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
                <ShieldCheck size={32} className="text-emerald-600/40" />
                <p className="text-gray-600 text-sm">No violations yet.</p>
                <p className="text-gray-700 text-xs">Click "Run Audit" in the panel above to evaluate all rules.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {violations.map(v => (
                  <ViolationCard key={v.id} violation={v} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Panel 3: Audit Trail ── */}
        <div className="rounded-2xl border border-gray-800 bg-gray-800/20 overflow-hidden">
          <PanelHeader
            icon={<FileText size={16} />}
            title="Audit Trail"
            subtitle={
              auditLog.length === 0
                ? 'No runs logged yet'
                : `${auditLog.length} run${auditLog.length !== 1 ? 's' : ''} recorded`
            }
          />

          <div className="p-3">
            {auditLog.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
                <Clock size={32} className="text-gray-700/60" />
                <p className="text-gray-600 text-sm">No audit runs yet.</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {auditLog.map(entry => (
                  <AuditRow key={entry.id} entry={entry} />
                ))}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* ── HIGH Violation Approval Modal ── */}
      {pendingViolations !== null && (
        <HighViolationModal
          count={pendingHighCount}
          onReview={handleModalReview}
          onCancel={handleModalCancel}
        />
      )}

    </div>
  )
}

export default GuardianView
