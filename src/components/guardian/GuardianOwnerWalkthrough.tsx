// @ts-nocheck
/**
 * GuardianOwnerWalkthrough — Owner Walkthrough Documentation at Job Completion
 *
 * Captures what was found, done, tested, recommended, warranty confirmation,
 * and customer acknowledgment at the end of every job.
 *
 * Features:
 *   - Pulls pre-existing conditions from pre-job checklist records
 *   - Links completed work to estimate line items
 *   - Checklist for what was tested (continuity, circuits, devices)
 *   - Warranty language with exclusions + customer acknowledgment
 *   - Signature field (typed name + date) or email confirmation
 *   - Saves to guardian_checklists in localStorage with type 'owner_walkthrough'
 *   - Auto-attach to final invoice on completion
 *   - PDF export for customer and project records
 */

import React, { useState, useEffect, useRef } from 'react'
import {
  ClipboardCheck,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Circle,
  FileText,
  Download,
  Mail,
  Shield,
  AlertCircle,
  Save,
  Wrench,
  Zap,
  Eye,
  Star,
} from 'lucide-react'
import { getBackupData } from '@/services/backupDataService'

// ── Types ────────────────────────────────────────────────────────────────────

interface PreCondition {
  id: string
  description: string
  location?: string
  notedAt?: string
}

interface WorkCompleted {
  id: string
  lineItem: string
  phase?: string
  completed: boolean
}

interface TestItem {
  id: string
  label: string
  checked: boolean
  notes?: string
}

interface WalkthroughRecord {
  id: string
  projectId: string
  projectName: string
  completedAt: string
  type: 'owner_walkthrough'

  // Section 1: What was found
  preConditions: PreCondition[]
  additionalFindings: string

  // Section 2: What was done
  workCompleted: WorkCompleted[]
  workSummary: string

  // Section 3: What was tested
  testItems: TestItem[]
  testNotes: string

  // Section 4: Recommendations
  recommendations: string

  // Section 5: Warranty
  warrantyAcknowledged: boolean
  warrantyExclusions: string[]

  // Section 6: Acknowledgment
  customerName: string
  customerSignatureDate: string
  emailConfirmation: string
  useEmailConfirmation: boolean

  // Metadata
  savedAt: string
  attachedToInvoice?: string
}

// ── Storage ──────────────────────────────────────────────────────────────────

const CHECKLIST_KEY = 'guardian_checklists'

function loadChecklists(): WalkthroughRecord[] {
  try {
    const raw = localStorage.getItem(CHECKLIST_KEY)
    if (!raw) return []
    const all = JSON.parse(raw)
    return all.filter((c: any) => c.type === 'owner_walkthrough')
  } catch {
    return []
  }
}

function saveChecklist(record: WalkthroughRecord): void {
  try {
    const raw = localStorage.getItem(CHECKLIST_KEY)
    const all: any[] = raw ? JSON.parse(raw) : []
    const idx = all.findIndex((c) => c.id === record.id)
    if (idx >= 0) {
      all[idx] = record
    } else {
      all.push(record)
    }
    localStorage.setItem(CHECKLIST_KEY, JSON.stringify(all))
  } catch {
    // localStorage full — silently fail
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function uid(): string {
  return `wt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

const DEFAULT_TEST_ITEMS: Omit<TestItem, 'checked'>[] = [
  { id: 'continuity',    label: 'Continuity verification — all circuits tested end-to-end' },
  { id: 'breaker',       label: 'Circuit breaker operation — breakers trip and reset correctly' },
  { id: 'gfci',         label: 'GFCI outlet operation — test/reset function confirmed' },
  { id: 'afci',         label: 'AFCI protection — arc-fault circuits tested' },
  { id: 'devices',      label: 'All devices (switches, outlets, fixtures) operational' },
  { id: 'panel',        label: 'Panel schedule updated and legible' },
  { id: 'grounding',    label: 'Grounding and bonding verified' },
  { id: 'load',         label: 'Load calculation within capacity' },
  { id: 'permit_final', label: 'Permit final inspection passed / scheduled' },
]

const WARRANTY_TEXT = `Power On Solutions, LLC provides a one (1) year labor warranty on all work performed under this contract. This warranty covers defects in workmanship and installation for a period of twelve (12) months from the date of project completion.`

const DEFAULT_WARRANTY_EXCLUSIONS = [
  'Pre-existing conditions documented at project start',
  'Customer-supplied equipment or materials',
  'Damage caused by misuse, abuse, or unauthorized modifications',
  'Acts of God, flooding, or other external events',
  'Corrosion or deterioration of existing wiring not in scope',
]

function buildInitialRecord(projectId: string, projectName: string): WalkthroughRecord {
  // Pull pre-conditions from backup data
  const data = getBackupData()
  const project = (data?.projects || []).find((p) => p.id === projectId)

  // Extract pre-conditions from earliest log notes (proxy for pre-job checklist)
  const preConditions: PreCondition[] = []
  if (project) {
    const firstLogs = (project.logs || []).slice(0, 3)
    for (const log of firstLogs) {
      if (log.note && log.note.toLowerCase().includes('pre-existing')) {
        preConditions.push({
          id: uid(),
          description: log.note.slice(0, 200),
          notedAt: log.date,
        })
      }
    }
  }

  // Extract work completed from estimate line items
  const workCompleted: WorkCompleted[] = []
  if (project) {
    for (const row of project.laborRows || []) {
      workCompleted.push({
        id: uid(),
        lineItem: row.desc || 'Labor item',
        phase: undefined,
        completed: true,
      })
    }
    for (const row of project.matRows || []) {
      workCompleted.push({
        id: uid(),
        lineItem: row.name || 'Material item',
        phase: undefined,
        completed: true,
      })
    }
  }

  // Default work summary from project type
  const workSummary = project
    ? `Completed ${project.type || 'electrical'} work for ${project.name}.`
    : ''

  return {
    id: uid(),
    projectId,
    projectName,
    completedAt: today(),
    type: 'owner_walkthrough',

    preConditions,
    additionalFindings: '',

    workCompleted,
    workSummary,

    testItems: DEFAULT_TEST_ITEMS.map((t) => ({ ...t, checked: false, notes: '' })),
    testNotes: '',

    recommendations: '',

    warrantyAcknowledged: false,
    warrantyExclusions: [...DEFAULT_WARRANTY_EXCLUSIONS],

    customerName: '',
    customerSignatureDate: today(),
    emailConfirmation: '',
    useEmailConfirmation: false,

    savedAt: new Date().toISOString(),
  }
}

// ── Section Wrapper ───────────────────────────────────────────────────────────

interface SectionProps {
  title: string
  icon: React.ReactNode
  badge?: string
  children: React.ReactNode
  defaultOpen?: boolean
}

function Section({ title, icon, badge, children, defaultOpen = true }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-800/30 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-3">
          <span className="text-blue-400">{icon}</span>
          <span className="text-sm font-semibold text-gray-200">{title}</span>
          {badge && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-900/30 border border-blue-700/30 text-blue-400">
              {badge}
            </span>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
      </button>
      {open && <div className="px-5 pb-5 border-t border-gray-800/60">{children}</div>}
    </div>
  )
}

// ── Props ────────────────────────────────────────────────────────────────────

interface GuardianOwnerWalkthroughProps {
  projectId?: string
  projectName?: string
  onSaved?: (record: WalkthroughRecord) => void
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function GuardianOwnerWalkthrough({
  projectId = '',
  projectName = 'Current Project',
  onSaved,
}: GuardianOwnerWalkthroughProps) {
  const [record, setRecord] = useState<WalkthroughRecord>(() =>
    buildInitialRecord(projectId, projectName)
  )
  const [saved, setSaved] = useState(false)
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const printRef = useRef<HTMLDivElement>(null)

  // Load existing walkthrough if one exists for this project
  useEffect(() => {
    const existing = loadChecklists().find((c) => c.projectId === projectId)
    if (existing) setRecord(existing)
  }, [projectId])

  function update(partial: Partial<WalkthroughRecord>) {
    setSaved(false)
    setRecord((prev) => ({ ...prev, ...partial, savedAt: new Date().toISOString() }))
  }

  function toggleTestItem(id: string) {
    setRecord((prev) => ({
      ...prev,
      testItems: prev.testItems.map((t) => t.id === id ? { ...t, checked: !t.checked } : t),
      savedAt: new Date().toISOString(),
    }))
    setSaved(false)
  }

  function updateTestNote(id: string, notes: string) {
    setRecord((prev) => ({
      ...prev,
      testItems: prev.testItems.map((t) => t.id === id ? { ...t, notes } : t),
    }))
  }

  function toggleWorkItem(id: string) {
    setRecord((prev) => ({
      ...prev,
      workCompleted: prev.workCompleted.map((w) => w.id === id ? { ...w, completed: !w.completed } : w),
    }))
    setSaved(false)
  }

  function addPreCondition() {
    setRecord((prev) => ({
      ...prev,
      preConditions: [
        ...prev.preConditions,
        { id: uid(), description: '', notedAt: today() },
      ],
    }))
  }

  function updatePreCondition(id: string, description: string) {
    setRecord((prev) => ({
      ...prev,
      preConditions: prev.preConditions.map((pc) =>
        pc.id === id ? { ...pc, description } : pc
      ),
    }))
    setSaved(false)
  }

  function removePreCondition(id: string) {
    setRecord((prev) => ({
      ...prev,
      preConditions: prev.preConditions.filter((pc) => pc.id !== id),
    }))
  }

  function handleSave() {
    const r = { ...record, savedAt: new Date().toISOString() }
    saveChecklist(r)
    setRecord(r)
    setSaved(true)
    onSaved?.(r)

    // Also attach to LEDGER by updating invoice reference in backup data
    // This is a fire-and-forget notification; actual wiring via GuardianAgentConnections
    setTimeout(() => setSaved(false), 3000)
  }

  function handlePrint() {
    if (!printRef.current) return
    const content = printRef.current.innerHTML
    const win = window.open('', '_blank', 'width=800,height=900')
    if (!win) return
    win.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Owner Walkthrough — ${record.projectName}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; color: #111; }
          h1 { font-size: 18px; font-weight: bold; margin-bottom: 4px; }
          h2 { font-size: 14px; font-weight: bold; margin: 20px 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
          p, li { font-size: 12px; line-height: 1.6; }
          .check { color: #16a34a; font-weight: bold; }
          .uncheck { color: #9ca3af; }
          .label { color: #6b7280; font-size: 11px; }
          .sig-line { border-bottom: 1px solid #111; width: 300px; display: inline-block; margin: 0 8px; }
        </style>
      </head>
      <body>${content}</body>
      </html>
    `)
    win.document.close()
    win.print()
  }

  const checkedTests = record.testItems.filter((t) => t.checked).length
  const totalTests = record.testItems.length
  const isComplete =
    record.warrantyAcknowledged &&
    (record.customerName.trim() !== '' || record.emailConfirmation.trim() !== '')

  return (
    <div className="flex flex-col gap-4 max-w-3xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-900/20 border border-blue-700/20">
            <ClipboardCheck className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white">Owner Walkthrough</h1>
            <p className="text-xs text-gray-500">{record.projectName} · Completed {record.completedAt}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700/40 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            PDF Export
          </button>
          <button
            onClick={handleSave}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              saved
                ? 'bg-emerald-900/30 text-emerald-400 border-emerald-700/30'
                : isComplete
                ? 'bg-blue-900/30 hover:bg-blue-900/50 text-blue-400 border-blue-700/30'
                : 'bg-gray-800 hover:bg-gray-700 text-gray-400 border-gray-700/40'
            }`}
          >
            {saved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            {saved ? 'Saved' : 'Save Walkthrough'}
          </button>
        </div>
      </div>

      {/* Completion indicator */}
      {isComplete && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-900/20 border border-emerald-700/20">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <p className="text-xs text-emerald-400 font-medium">
            Walkthrough complete — ready to attach to final invoice
          </p>
        </div>
      )}

      {/* Printable content */}
      <div ref={printRef} className="hidden">
        <h1>Owner Walkthrough Documentation — {record.projectName}</h1>
        <p className="label">Completed: {record.completedAt} · License: C-10 Electrical</p>

        <h2>Pre-Existing Conditions</h2>
        {record.preConditions.length === 0
          ? <p>None documented at project start.</p>
          : record.preConditions.map((pc) => <p key={pc.id}>• {pc.description} ({pc.notedAt})</p>)
        }
        {record.additionalFindings && <p>Additional: {record.additionalFindings}</p>}

        <h2>Work Completed</h2>
        {record.workCompleted.filter((w) => w.completed).map((w) => <p key={w.id}>• {w.lineItem}</p>)}
        {record.workSummary && <p>{record.workSummary}</p>}

        <h2>What Was Tested</h2>
        {record.testItems.map((t) => (
          <p key={t.id}>
            <span className={t.checked ? 'check' : 'uncheck'}>{t.checked ? '✓' : '○'}</span> {t.label}
            {t.notes ? ` — ${t.notes}` : ''}
          </p>
        ))}
        {record.testNotes && <p>Notes: {record.testNotes}</p>}

        <h2>Recommendations</h2>
        <p>{record.recommendations || 'None at this time.'}</p>

        <h2>Warranty</h2>
        <p>{WARRANTY_TEXT}</p>
        <p><strong>Exclusions:</strong></p>
        {record.warrantyExclusions.map((e, i) => <p key={i}>• {e}</p>)}

        <h2>Customer Acknowledgment</h2>
        {record.useEmailConfirmation
          ? <p>Confirmed via email: {record.emailConfirmation} on {record.customerSignatureDate}</p>
          : (
            <>
              <p>Customer Name (printed): <span className="sig-line">{record.customerName}</span></p>
              <p>Date: <span className="sig-line">{record.customerSignatureDate}</span></p>
              <p>Signature: <span className="sig-line" style={{ width: '250px' }}>&nbsp;</span></p>
              <p>Technician: Christian D. · Power On Solutions, LLC · CSLB License C-10</p>
            </>
          )
        }
      </div>

      {/* Section 1: What Was Found */}
      <Section
        title="What Was Found"
        icon={<Eye className="w-4 h-4" />}
        badge={`${record.preConditions.length} pre-existing conditions`}
      >
        <div className="mt-4 space-y-3">
          {record.preConditions.length === 0 ? (
            <p className="text-xs text-gray-500 italic">No pre-existing conditions from pre-job checklist.</p>
          ) : (
            record.preConditions.map((pc) => (
              <div key={pc.id} className="flex items-start gap-2">
                <AlertCircle className="w-3.5 h-3.5 text-amber-400 mt-2 flex-shrink-0" />
                <div className="flex-1">
                  <input
                    type="text"
                    value={pc.description}
                    onChange={(e) => updatePreCondition(pc.id, e.target.value)}
                    placeholder="Pre-existing condition description…"
                    className="w-full bg-gray-800/60 border border-gray-700/40 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600/50"
                  />
                  {pc.notedAt && (
                    <p className="text-xs text-gray-600 mt-0.5">Noted: {pc.notedAt}</p>
                  )}
                </div>
                <button
                  onClick={() => removePreCondition(pc.id)}
                  className="text-xs text-red-600 hover:text-red-400 mt-2"
                >
                  ×
                </button>
              </div>
            ))
          )}
          <button
            onClick={addPreCondition}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            + Add pre-existing condition
          </button>
          <div className="pt-2">
            <label className="text-xs text-gray-500 font-medium block mb-1">Additional findings</label>
            <textarea
              rows={3}
              value={record.additionalFindings}
              onChange={(e) => update({ additionalFindings: e.target.value })}
              placeholder="Describe any additional findings not captured above…"
              className="w-full bg-gray-800/60 border border-gray-700/40 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600/50 resize-none"
            />
          </div>
        </div>
      </Section>

      {/* Section 2: What Was Done */}
      <Section
        title="What Was Done"
        icon={<Wrench className="w-4 h-4" />}
        badge={`${record.workCompleted.filter(w => w.completed).length} items`}
      >
        <div className="mt-4 space-y-2">
          {record.workCompleted.length === 0 ? (
            <p className="text-xs text-gray-500 italic">No estimate line items found. Add work summary below.</p>
          ) : (
            record.workCompleted.map((w) => (
              <div key={w.id} className="flex items-center gap-3">
                <button onClick={() => toggleWorkItem(w.id)} className="flex-shrink-0">
                  {w.completed
                    ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    : <Circle className="w-4 h-4 text-gray-600" />
                  }
                </button>
                <span className={`text-sm ${w.completed ? 'text-gray-200' : 'text-gray-500 line-through'}`}>
                  {w.lineItem}
                </span>
                {w.phase && <span className="text-xs text-gray-600">{w.phase}</span>}
              </div>
            ))
          )}
          <div className="pt-2">
            <label className="text-xs text-gray-500 font-medium block mb-1">Work summary</label>
            <textarea
              rows={3}
              value={record.workSummary}
              onChange={(e) => update({ workSummary: e.target.value })}
              placeholder="Summarize the specific work completed referencing estimate items…"
              className="w-full bg-gray-800/60 border border-gray-700/40 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600/50 resize-none"
            />
          </div>
        </div>
      </Section>

      {/* Section 3: What Was Tested */}
      <Section
        title="What Was Tested"
        icon={<Zap className="w-4 h-4" />}
        badge={`${checkedTests}/${totalTests} verified`}
      >
        <div className="mt-4 space-y-2">
          {record.testItems.map((item) => (
            <div key={item.id} className="flex items-start gap-3">
              <button onClick={() => toggleTestItem(item.id)} className="flex-shrink-0 mt-0.5">
                {item.checked
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  : <Circle className="w-4 h-4 text-gray-600" />
                }
              </button>
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${item.checked ? 'text-gray-200' : 'text-gray-500'}`}>
                  {item.label}
                </p>
                {item.checked && (
                  <input
                    type="text"
                    value={item.notes || ''}
                    onChange={(e) => updateTestNote(item.id, e.target.value)}
                    placeholder="Optional test notes…"
                    className="mt-1 w-full bg-gray-800/40 border border-gray-700/30 rounded px-2 py-1 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-600/40"
                  />
                )}
              </div>
            </div>
          ))}
          <div className="pt-2">
            <label className="text-xs text-gray-500 font-medium block mb-1">Test notes</label>
            <textarea
              rows={2}
              value={record.testNotes}
              onChange={(e) => update({ testNotes: e.target.value })}
              placeholder="Any additional testing notes or observations…"
              className="w-full bg-gray-800/60 border border-gray-700/40 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600/50 resize-none"
            />
          </div>
        </div>
      </Section>

      {/* Section 4: Recommendations */}
      <Section
        title="What Was Recommended"
        icon={<Star className="w-4 h-4" />}
        defaultOpen={false}
      >
        <div className="mt-4">
          <p className="text-xs text-gray-500 mb-2">
            Items outside current scope that should be addressed in the future.
          </p>
          <textarea
            rows={4}
            value={record.recommendations}
            onChange={(e) => update({ recommendations: e.target.value })}
            placeholder="e.g. Panel is approaching capacity — consider upgrade in 2–3 years. AFCI breakers recommended for bedroom circuits per current NEC code…"
            className="w-full bg-gray-800/60 border border-gray-700/40 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600/50 resize-none"
          />
        </div>
      </Section>

      {/* Section 5: Warranty */}
      <Section
        title="Warranty Confirmation"
        icon={<Shield className="w-4 h-4" />}
        badge={record.warrantyAcknowledged ? 'Acknowledged' : 'Pending'}
      >
        <div className="mt-4 space-y-4">
          {/* Warranty text */}
          <div className="rounded-lg bg-gray-800/40 border border-gray-700/30 p-4">
            <p className="text-sm text-gray-300 leading-relaxed">{WARRANTY_TEXT}</p>
          </div>

          {/* Exclusions */}
          <div>
            <p className="text-xs text-gray-500 font-medium mb-2">This warranty does not cover:</p>
            <ul className="space-y-1">
              {record.warrantyExclusions.map((exc, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-gray-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-600 flex-shrink-0 mt-1.5" />
                  {exc}
                </li>
              ))}
            </ul>
          </div>

          {/* Acknowledgment checkbox */}
          <button
            onClick={() => update({ warrantyAcknowledged: !record.warrantyAcknowledged })}
            className="flex items-center gap-3 w-full text-left"
          >
            {record.warrantyAcknowledged
              ? <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              : <Circle className="w-5 h-5 text-gray-600 flex-shrink-0" />
            }
            <span className={`text-sm ${record.warrantyAcknowledged ? 'text-emerald-300' : 'text-gray-400'}`}>
              Customer has been informed of the one-year labor warranty and all listed exclusions.
            </span>
          </button>
        </div>
      </Section>

      {/* Section 6: Customer Acknowledgment */}
      <Section
        title="Customer Acknowledgment"
        icon={<FileText className="w-4 h-4" />}
        badge={isComplete ? 'Complete' : 'Required'}
      >
        <div className="mt-4 space-y-4">
          {/* Toggle between signature and email */}
          <div className="flex gap-2">
            <button
              onClick={() => update({ useEmailConfirmation: false })}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                !record.useEmailConfirmation
                  ? 'bg-blue-900/30 text-blue-400 border-blue-700/30'
                  : 'bg-gray-800 text-gray-500 border-gray-700/30'
              }`}
            >
              Typed Name + Date
            </button>
            <button
              onClick={() => update({ useEmailConfirmation: true })}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                record.useEmailConfirmation
                  ? 'bg-blue-900/30 text-blue-400 border-blue-700/30'
                  : 'bg-gray-800 text-gray-500 border-gray-700/30'
              }`}
            >
              <Mail className="w-3 h-3" />
              Email Confirmation
            </button>
          </div>

          {!record.useEmailConfirmation ? (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 font-medium block mb-1">Customer name (printed)</label>
                <input
                  type="text"
                  value={record.customerName}
                  onChange={(e) => update({ customerName: e.target.value })}
                  placeholder="Full name"
                  className="w-full bg-gray-800/60 border border-gray-700/40 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600/50"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-medium block mb-1">Date</label>
                <input
                  type="date"
                  value={record.customerSignatureDate}
                  onChange={(e) => update({ customerSignatureDate: e.target.value })}
                  className="bg-gray-800/60 border border-gray-700/40 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-600/50"
                />
              </div>
              {/* Signature placeholder */}
              <div>
                <label className="text-xs text-gray-500 font-medium block mb-1">Signature</label>
                <div className="w-full border-b-2 border-gray-700 h-12 flex items-end pb-1">
                  <span className="text-xs text-gray-700 italic">
                    {record.customerName ? `${record.customerName} — ${record.customerSignatureDate}` : 'Customer signs here'}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1">Customer email address</label>
              <input
                type="email"
                value={record.emailConfirmation}
                onChange={(e) => update({ emailConfirmation: e.target.value })}
                placeholder="customer@example.com"
                className="w-full bg-gray-800/60 border border-gray-700/40 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600/50"
              />
              <p className="text-xs text-gray-600 mt-1">
                Email confirmation serves as digital acknowledgment of work completed and warranty terms.
              </p>
            </div>
          )}

          {isComplete && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-emerald-900/20 border border-emerald-700/20">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <p className="text-xs text-emerald-400">
                Walkthrough complete. This record will auto-attach to the final invoice in LEDGER.
              </p>
            </div>
          )}
        </div>
      </Section>

    </div>
  )
}
