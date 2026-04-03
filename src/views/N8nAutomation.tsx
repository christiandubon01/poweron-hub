/**
 * src/views/N8nAutomation.tsx
 * E13 | n8n Automation Layer
 *
 * UI for managing background automations: lead intake, invoice follow-ups,
 * daily briefing, receipt processing, and Google Business review monitoring.
 * Triggers via Supabase webhooks in production.
 *
 * Sections:
 *   1. Active Automations — list of rules with toggle, run count, last/next run
 *   2. Automation Log     — chronological execution log with status badges
 *   3. Rule Builder       — stub form to define and save new rules
 *
 * No real n8n connection — all data is local state seeded from mock fixtures.
 */

import { useState, useCallback } from 'react'
import type { AutomationRule, AutomationLog, AutomationTrigger } from '../types'
import { mockAutomationRules, mockAutomationLog } from '../mock'

// ── Helpers ───────────────────────────────────────────────────────────────────

const TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  lead_intake: 'Lead Intake',
  invoice_followup: 'Invoice Follow-Up',
  daily_briefing: 'Daily Briefing',
  receipt_processing: 'Receipt Processing',
  review_monitor: 'Review Monitor',
}

const TRIGGER_COLORS: Record<AutomationTrigger, string> = {
  lead_intake: 'bg-blue-100 text-blue-800',
  invoice_followup: 'bg-yellow-100 text-yellow-800',
  daily_briefing: 'bg-purple-100 text-purple-800',
  receipt_processing: 'bg-orange-100 text-orange-800',
  review_monitor: 'bg-teal-100 text-teal-800',
}

function formatDateTime(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ── Toast ─────────────────────────────────────────────────────────────────────

interface ToastState {
  message: string
  visible: boolean
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface RuleCardProps {
  rule: AutomationRule
  onToggle: (id: string) => void
  onRunNow: (id: string, name: string) => void
}

function RuleCard({ rule, onToggle, onRunNow }: RuleCardProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col gap-3 shadow-sm">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <span className="font-semibold text-gray-900 text-sm">{rule.name}</span>
          <span
            className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full w-fit ${TRIGGER_COLORS[rule.trigger]}`}
          >
            {TRIGGER_LABELS[rule.trigger]}
          </span>
        </div>
        {/* Active toggle */}
        <button
          onClick={() => onToggle(rule.id)}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
            rule.active ? 'bg-green-500' : 'bg-gray-300'
          }`}
          aria-label={rule.active ? 'Deactivate rule' : 'Activate rule'}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition duration-200 ${
              rule.active ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 text-xs text-gray-500">
        <div>
          <span className="block font-medium text-gray-700">Last Run</span>
          {formatDateTime(rule.lastRun)}
        </div>
        <div>
          <span className="block font-medium text-gray-700">Next Run</span>
          {rule.active ? formatDateTime(rule.nextRun) : 'Paused'}
        </div>
        <div>
          <span className="block font-medium text-gray-700">Total Runs</span>
          {rule.runCount}
        </div>
      </div>

      {/* Run Now button */}
      <button
        onClick={() => onRunNow(rule.id, rule.name)}
        className="self-start text-xs font-medium text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 px-3 py-1 rounded transition-colors"
      >
        ▶ Run Now
      </button>
    </div>
  )
}

interface LogRowProps {
  entry: AutomationLog
}

function LogRow({ entry }: LogRowProps) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-gray-100 last:border-0">
      <span
        className={`mt-0.5 shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full ${
          entry.status === 'success'
            ? 'bg-green-100 text-green-700'
            : 'bg-red-100 text-red-700'
        }`}
      >
        {entry.status === 'success' ? '✓ OK' : '✕ ERR'}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{entry.ruleName}</p>
        <p className="text-xs text-gray-500">{entry.message}</p>
      </div>
      <span className="shrink-0 text-xs text-gray-400">{formatDateTime(entry.triggeredAt)}</span>
    </div>
  )
}

// ── Rule Builder form state ───────────────────────────────────────────────────

interface RuleFormState {
  name: string
  trigger: AutomationTrigger
  schedule: 'daily' | 'weekly' | 'on-event'
}

const EMPTY_FORM: RuleFormState = {
  name: '',
  trigger: 'lead_intake',
  schedule: 'daily',
}

// ── Main View ─────────────────────────────────────────────────────────────────

export default function N8nAutomation() {
  const [rules, setRules] = useState<AutomationRule[]>(mockAutomationRules)
  const [log, setLog] = useState<AutomationLog[]>(mockAutomationLog)
  const [toast, setToast] = useState<ToastState>({ message: '', visible: false })
  const [form, setForm] = useState<RuleFormState>(EMPTY_FORM)

  // ── Handlers ────────────────────────────────────────────────────────────────

  const showToast = useCallback((message: string) => {
    setToast({ message, visible: true })
    setTimeout(() => setToast({ message: '', visible: false }), 2000)
  }, [])

  const handleToggle = useCallback((id: string) => {
    setRules(prev =>
      prev.map(r => (r.id === id ? { ...r, active: !r.active } : r))
    )
  }, [])

  const handleRunNow = useCallback(
    (id: string, name: string) => {
      showToast(`Triggered: ${name}`)
      // Append a stub log entry
      const newEntry: AutomationLog = {
        id: `log_stub_${Date.now()}`,
        ruleId: id,
        ruleName: name,
        triggeredAt: new Date().toISOString(),
        status: 'success',
        message: 'Manually triggered — stub run.',
      }
      setLog(prev => [newEntry, ...prev])
      setRules(prev =>
        prev.map(r =>
          r.id === id
            ? { ...r, runCount: r.runCount + 1, lastRun: new Date().toISOString() }
            : r
        )
      )
    },
    [showToast]
  )

  const handleClearLog = useCallback(() => {
    setLog([])
  }, [])

  const handleSaveRule = useCallback(() => {
    if (!form.name.trim()) return
    const newRule: AutomationRule = {
      id: `rule_new_${Date.now()}`,
      name: form.name.trim(),
      trigger: form.trigger,
      active: false,
      runCount: 0,
    }
    setRules(prev => [...prev, newRule])
    setForm(EMPTY_FORM)
    showToast(`Rule "${newRule.name}" saved.`)
  }, [form, showToast])

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="relative min-h-screen bg-gray-50 p-4 md:p-6 space-y-8">

      {/* ── Page Header ──────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">n8n Automation Layer</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage background automations. Rules connect to n8n webhooks in production.
        </p>
      </div>

      {/* ── Section 1: Active Automations ────────────────────────────────────── */}
      <section>
        <h2 className="text-base font-semibold text-gray-800 mb-3">Active Automations</h2>
        {rules.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No automation rules defined yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {rules.map(rule => (
              <RuleCard
                key={rule.id}
                rule={rule}
                onToggle={handleToggle}
                onRunNow={handleRunNow}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Section 2: Automation Log ─────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-800">Automation Log</h2>
          <button
            onClick={handleClearLog}
            className="text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 px-3 py-1 rounded transition-colors"
          >
            Clear Log
          </button>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm px-4 py-2">
          {log.length === 0 ? (
            <p className="text-sm text-gray-400 italic py-4 text-center">Log is empty.</p>
          ) : (
            log.map(entry => <LogRow key={entry.id} entry={entry} />)
          )}
        </div>
      </section>

      {/* ── Section 3: Rule Builder ───────────────────────────────────────────── */}
      <section>
        <h2 className="text-base font-semibold text-gray-800 mb-1">Rule Builder</h2>
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-4">
          Rules connect to n8n webhooks during integration.
        </p>
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 max-w-lg space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Rule Name
            </label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
              placeholder="e.g. Weekend Lead Intake"
              className="w-full text-sm border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>

          {/* Trigger */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Trigger
            </label>
            <select
              value={form.trigger}
              onChange={e =>
                setForm(prev => ({ ...prev, trigger: e.target.value as AutomationTrigger }))
              }
              className="w-full text-sm border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              {(Object.keys(TRIGGER_LABELS) as AutomationTrigger[]).map(t => (
                <option key={t} value={t}>
                  {TRIGGER_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          {/* Schedule */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Schedule
            </label>
            <select
              value={form.schedule}
              onChange={e =>
                setForm(prev => ({
                  ...prev,
                  schedule: e.target.value as RuleFormState['schedule'],
                }))
              }
              className="w-full text-sm border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="on-event">On Event</option>
            </select>
          </div>

          {/* Save */}
          <button
            onClick={handleSaveRule}
            disabled={!form.name.trim()}
            className="w-full text-sm font-semibold bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white py-2 rounded transition-colors"
          >
            Save Rule
          </button>
        </div>
      </section>

      {/* ── Toast Notification ────────────────────────────────────────────────── */}
      {toast.visible && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm font-medium px-5 py-3 rounded-lg shadow-lg z-50 transition-all">
          {toast.message}
        </div>
      )}
    </div>
  )
}
