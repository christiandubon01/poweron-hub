// @ts-nocheck
/**
 * V15rHome — Main dashboard/home view.
 * Faithfully ported from HTML renderHome().
 *
 * Sections:
 * 1. Greeting + date + "New Project" button
 * 2. 4 KPI pills (Pipeline, Cash Received, Open RFIs, Hours Logged)
 * 3. Google Calendar embed with week navigation (calOffset)
 * 4. Job Health cards (per project, score 0-100, reasons, chips)
 * 5. Service Jobs Requiring Attention (money math: totalBillable = quoted + income adj)
 * 6. Agenda Alerts (auto-generated: stalled, check-in, critical RFIs)
 * 7. Agenda Sections with full CRUD (add/edit/delete categories+tasks, cycle status)
 * 8. Recent Logs (last 4-6 entries)
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Plus,
  Trash2,
  ChevronRight,
  Zap,
  ChevronLeft,
  X,
  Sparkles,
  Edit3,
  Edit2,
  Brain,
  Send,
  Mic,
  MicOff,
} from 'lucide-react'
import {
  getBackupData,
  saveBackupData,
  getKPIs,
  health,
  getOverallCompletion,
  daysSince,
  fmtK,
  fmt,
  pct,
  ensureAgendaState,
  getAgendaProjectName,
  resolveProjectBucket,
  num,
  getProjectFinancials,
  type BackupData,
  type BackupProject,
} from '@/services/backupDataService'
import { pushState } from '@/services/undoRedoService'
import { callClaude, extractText } from '@/services/claudeProxy'

// ── Greeting helper ──────────────────────────────────────────────────────────

function getGreeting(): string {
  const hr = new Date().getHours()
  return hr < 12 ? 'morning' : hr < 17 ? 'afternoon' : 'evening'
}

function formatDate(): string {
  const d = new Date()
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

// ── Status chip helper ───────────────────────────────────────────────────────

function agendaStatusChip(status: string) {
  const colors: Record<string, string> = {
    completed: 'bg-emerald-500/20 text-emerald-400',
    canceled: 'bg-red-500/20 text-red-400',
    'in-progress': 'bg-blue-500/20 text-blue-400',
    pending: 'bg-gray-500/20 text-gray-400',
  }
  return (
    <span className={`text-[9px] px-2 py-0.5 rounded font-semibold ${colors[status] || colors.pending}`}>
      {status}
    </span>
  )
}

// Status cycle order
const STATUS_CYCLE = ['pending', 'in-progress', 'completed', 'canceled']

// ── Service money math helper ────────────────────────────────────────────────

function getServiceBalanceDue(log: any): number {
  const baseQuoted = num(log.quoted || 0)
  const incomeAdjs = (log.adjustments || []).filter((a: any) => a.type === 'income').reduce((s: number, a: any) => s + num(a.amount), 0)
  const totalBillable = baseQuoted + incomeAdjs
  const collected = num(log.collected || 0)
  return Math.max(0, totalBillable - collected)
}

// ── Helper to group logs by date ────────────────────────────────────────────
function groupLogsByDate(logs: any[]): Map<string, any[]> {
  const grouped = new Map<string, any[]>()
  logs.forEach(log => {
    const date = log.date || ''
    if (!grouped.has(date)) {
      grouped.set(date, [])
    }
    grouped.get(date)!.push(log)
  })
  return grouped
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function V15rHome() {
  const [, setTick] = useState(0)
  const [calOffset, setCalOffset] = useState(0)
  const [customAlerts, setCustomAlerts] = useState<Array<{id: string, title: string, description: string, action: string, isAI: boolean, manuallyEdited?: boolean, scheduledAt?: string, linkedProjectId?: string}>>([])
  const [editingAlertId, setEditingAlertId] = useState<string | null>(null)
  const [editingAlertData, setEditingAlertData] = useState<{title: string, description: string, action: string, scheduledAt?: string, linkedProjectId?: string}>({title: '', description: '', action: '', scheduledAt: '', linkedProjectId: ''})
  const [addingAlert, setAddingAlert] = useState(false)
  const [editingAIAlertId, setEditingAIAlertId] = useState<string | null>(null)
  const [editAIAlertText, setEditAIAlertText] = useState('')
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])

  // ── AI Daily Assistant state ──
  const [aiPanelOpen, setAiPanelOpen] = useState(false)
  const [aiMessages, setAiMessages] = useState<Array<{role: 'user' | 'assistant', content: string}>>([])
  const [aiInput, setAiInput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiRecording, setAiRecording] = useState(false)
  const aiScrollRef = useRef<HTMLDivElement>(null)
  const aiInitRef = useRef(false)

  const backup = getBackupData()

  if (!backup) {
    return (
      <div className="flex items-center justify-center w-full h-screen bg-[var(--bg-secondary)]">
        <div className="text-center">
          <div className="text-gray-400 mb-4">No backup data loaded</div>
          <div className="text-gray-600 text-xs mb-4">Use the Import button in the top bar to load your backup JSON</div>
          <button className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm">Import Backup</button>
        </div>
      </div>
    )
  }

  // ── Data derivation ──────────────────────────────────────────────────────
  let kpis: any
  let projects: BackupProject[] = []

  try {
    ensureAgendaState(backup)
    kpis = getKPIs(backup)
    projects = backup.projects || []
  } catch (err) {
    console.error('[V15rHome] Data derivation error:', err)
    kpis = { pipeline: 0, paid: 0, billed: 0, exposure: 0, svcUnbilled: 0, openRfis: 0, totalHours: 0, activeProjects: 0 }
  }

  const logs = backup.logs || []
  const serviceLogs = backup.serviceLogs || []

  // ── Agenda alerts (auto-generated) ─────────────────────────────────────
  const agendaAlerts: Array<{ clr: string; txt: string; id: string }> = []
  projects.forEach(p => {
    const d = daysSince(p.lastMove)
    if (d >= 14) {
      agendaAlerts.push({ clr: '#ef4444', txt: '📞 Call on ' + p.name + ' — ' + d + 'd stalled', id: p.id })
    } else if (d >= 7) {
      agendaAlerts.push({ clr: '#f59e0b', txt: '📧 Check-in: ' + p.name + ' — ' + d + 'd', id: p.id })
    }
    ;(p.rfis || []).filter((r: any) => r.status === 'critical').forEach((r: any) => {
      agendaAlerts.push({ clr: '#ef4444', txt: '⚠ Critical RFI on ' + p.name + ': ' + (r.question || '').slice(0, 55) + '...', id: p.id })
    })
  })

  // Load custom alerts from backup
  const loadedCustomAlerts = backup.customAlerts || []

  // Filter out AI alerts that have been manually edited (avoid duplicates)
  const editedProjectIds = new Set(
    loadedCustomAlerts.filter(a => a.isAI && a.manuallyEdited).map(a => a.linkedProjectId)
  )
  const filteredAgendaAlerts = agendaAlerts.filter(a => !editedProjectIds.has(a.id))

  // ── Recent logs (last 4-6) ───────────────────────────────────────────────
  const recentLogs = [...logs].reverse().slice(0, 6)

  // ── Service jobs requiring attention (money math) ────────────────────────
  const serviceJobsNeedingAttention = serviceLogs
    .map((l: any) => ({
      ...l,
      balanceDue: getServiceBalanceDue(l),
    }))
    .filter((l: any) => l.balanceDue > 0)
    .sort((a: any, b: any) => b.balanceDue - a.balanceDue)

  // ── Agenda CRUD handlers ───────────────────────────────────────────────

  function persist() {
    backup._lastSavedAt = new Date().toISOString()
    saveBackupData(backup)
    // Dispatch event to trigger KPI refresh in Layout
    window.dispatchEvent(new Event('storage'))
    forceUpdate()
  }

  function addAgendaCategory() {
    const title = prompt('Category name:')
    if (!title) return
    pushState(backup)
    const projectId = prompt('Link to project ID (leave blank for General):') || ''
    ;(backup.agendaSections || []).push({
      id: 'ag' + Date.now(),
      title,
      projectId,
      tasks: [],
    })
    persist()
  }

  function editAgendaCategory(secId: string) {
    const sec = (backup.agendaSections || []).find(s => s.id === secId)
    if (!sec) return
    const title = prompt('Category name:', sec.title)
    if (title === null) return
    pushState(backup)
    sec.title = title
    const pid = prompt('Project ID:', sec.projectId)
    if (pid !== null) sec.projectId = pid
    persist()
  }

  function removeAgendaCategory(secId: string) {
    if (!confirm('Delete this category and all its tasks?')) return
    pushState(backup)
    backup.agendaSections = (backup.agendaSections || []).filter(s => s.id !== secId)
    persist()
  }

  function addAgendaTask(secId: string) {
    const sec = (backup.agendaSections || []).find(s => s.id === secId)
    if (!sec) return
    const text = prompt('Task:')
    if (!text) return
    pushState(backup)
    ;(sec.tasks || []).push({ id: 'agt' + Date.now(), text, status: 'pending' })
    persist()
  }

  function cycleAgendaTaskStatus(secId: string, taskId: string) {
    const sec = (backup.agendaSections || []).find(s => s.id === secId)
    if (!sec) return
    const task = (sec.tasks || []).find((t: any) => t.id === taskId)
    if (!task) return
    pushState(backup)
    const idx = STATUS_CYCLE.indexOf(task.status)
    task.status = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]
    persist()
  }

  function editAgendaTask(secId: string, taskId: string) {
    const sec = (backup.agendaSections || []).find(s => s.id === secId)
    if (!sec) return
    const task = (sec.tasks || []).find((t: any) => t.id === taskId)
    if (!task) return
    const text = prompt('Edit task:', task.text)
    if (text === null) return
    pushState(backup)
    task.text = text
    persist()
  }

  function moveAgendaTask(secId: string, taskId: string) {
    const sections = backup.agendaSections || []
    const fromSec = sections.find(s => s.id === secId)
    if (!fromSec) return
    const otherSections = sections.filter(s => s.id !== secId)
    if (!otherSections.length) { alert('No other categories to move to.'); return }
    const targetTitle = prompt('Move to category:\n' + otherSections.map((s, i) => (i + 1) + '. ' + s.title).join('\n'))
    if (!targetTitle) return
    const targetIdx = parseInt(targetTitle, 10) - 1
    const target = otherSections[targetIdx] || otherSections.find(s => s.title.toLowerCase() === targetTitle.toLowerCase())
    if (!target) { alert('Category not found.'); return }
    const taskIdx = (fromSec.tasks || []).findIndex((t: any) => t.id === taskId)
    if (taskIdx < 0) return
    pushState(backup)
    const [task] = fromSec.tasks.splice(taskIdx, 1)
    ;(target.tasks || []).push(task)
    persist()
  }

  function removeAgendaTask(secId: string, taskId: string) {
    const sec = (backup.agendaSections || []).find(s => s.id === secId)
    if (!sec) return
    pushState(backup)
    sec.tasks = (sec.tasks || []).filter((t: any) => t.id !== taskId)
    persist()
  }

  function markServiceJobCollected(logId: string) {
    const log = serviceLogs.find((l: any) => l.id === logId)
    if (!log) return
    pushState(backup)
    const balanceDue = getServiceBalanceDue(log)
    log.collected = num(log.collected || 0) + balanceDue
    persist()
  }

  // ── Alert management handlers ─────────────────────────────────────────────

  function saveAlert(alertId: string | null, data: {title: string, description: string, action: string, scheduledAt?: string, linkedProjectId?: string}, isAI: boolean) {
    if (!data.title.trim()) {
      alert('Alert title is required')
      return
    }
    pushState(backup)
    if (!backup.customAlerts) {
      backup.customAlerts = []
    }
    if (alertId) {
      const existingAlert = backup.customAlerts.find(a => a.id === alertId)
      if (existingAlert) {
        existingAlert.title = data.title
        existingAlert.description = data.description
        existingAlert.action = data.action
        existingAlert.scheduledAt = data.scheduledAt || ''
        existingAlert.linkedProjectId = data.linkedProjectId || ''
        // Mark as edited if this was an AI alert
        if (existingAlert.isAI) {
          existingAlert.manuallyEdited = true
        }
      }
    } else {
      backup.customAlerts.push({
        id: 'cal' + Date.now(),
        title: data.title,
        description: data.description,
        action: data.action,
        isAI: isAI,
        scheduledAt: data.scheduledAt || '',
        linkedProjectId: data.linkedProjectId || '',
      })
    }
    // OneSignal push stub — when scheduledAt is set, queue for push notification
    if (data.scheduledAt) {
      console.log('[OneSignal] Push notification scheduled for:', data.scheduledAt)
    }
    persist()
    setEditingAlertId(null)
    setAddingAlert(false)
    setEditingAlertData({title: '', description: '', action: '', scheduledAt: '', linkedProjectId: ''})
  }

  function dismissAlert(alertId: string) {
    pushState(backup)
    if (backup.customAlerts) {
      backup.customAlerts = backup.customAlerts.filter(a => a.id !== alertId)
    }
    persist()
  }

  function startEditAlert(alertItem: any) {
    setEditingAlertId(alertItem.id)
    setEditingAlertData({
      title: alertItem.title,
      description: alertItem.description,
      action: alertItem.action,
      scheduledAt: alertItem.scheduledAt || '',
      linkedProjectId: alertItem.linkedProjectId || '',
    })
  }

  // ── Calendar navigation (week offset) ──────────────────────────────────
  function prevWeek() {
    setCalOffset(calOffset - 1)
  }

  function nextWeek() {
    setCalOffset(calOffset + 1)
  }

  // ── Compute calendar URL with offset ──────────────────────────────────
  const gcalUrl = backup.settings?.gcalUrl ? `${backup.settings.gcalUrl}&mode=WEEK` : null

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[var(--bg-secondary)] p-6 space-y-6">

      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">
            Good {getGreeting()} ⚡
          </h1>
          <p className="text-xs text-gray-500 mt-1">{formatDate()}</p>
        </div>
        <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors">
          <Plus size={14} /> New Project
        </button>
      </div>

      {/* ── 4 KPI PILLS ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { cls: 'border-l-emerald-500', lbl: 'Total Pipeline', val: fmtK(kpis.pipeline), sub: projects.length + ' projects' },
          { cls: 'border-l-blue-500', lbl: 'Cash Received', val: fmtK(kpis.paid), sub: 'Accumulative' },
          { cls: 'border-l-red-500', lbl: 'Open RFIs', val: String(kpis.openRfis), sub: 'Need resolution' },
          { cls: 'border-l-gray-500', lbl: 'Hours Logged', val: kpis.totalHours.toFixed(1) + 'h', sub: logs.length + ' entries' },
        ].map((k, i) => (
          <div key={i} className={`rounded-lg border border-gray-800 border-l-4 ${k.cls} bg-[var(--bg-card)] p-3`}>
            <div className="text-[10px] uppercase text-gray-500 font-bold tracking-wider">{k.lbl}</div>
            <div className="text-lg font-bold font-mono text-gray-100 mt-1">{k.val}</div>
            <div className="text-[9px] text-gray-500 mt-0.5">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* ── GOOGLE CALENDAR EMBED ───────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Calendar</h2>
          <span className="text-[9px] px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 font-semibold">Week View ✓</span>
        </div>
        {gcalUrl ? (
          <div className="rounded-xl border border-gray-800 bg-[var(--bg-card)] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800/50">
              <h3 className="text-sm font-semibold text-gray-200">
                {calOffset === 0 ? 'This Week' : calOffset > 0 ? `+${calOffset} week${calOffset !== 1 ? 's' : ''}` : `${calOffset} weeks`}
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={prevWeek}
                  className="p-1 rounded hover:bg-gray-700/50 transition-colors"
                >
                  <ChevronLeft size={16} className="text-gray-400" />
                </button>
                <button
                  onClick={nextWeek}
                  className="p-1 rounded hover:bg-gray-700/50 transition-colors"
                >
                  <ChevronRight size={16} className="text-gray-400" />
                </button>
              </div>
            </div>
            <iframe
              src={gcalUrl}
              style={{ border: '0', width: '100%', height: '600px' }}
              className="bg-[var(--bg-secondary)]"
            />
          </div>
        ) : (
          <div className="p-6 bg-[var(--bg-card)] border border-gray-800 rounded-lg text-center">
            <div className="text-xs text-gray-500">No calendar configured</div>
            <div className="text-[9px] text-gray-500 mt-1">Add gcalUrl to settings to embed your Google Calendar</div>
          </div>
        )}
      </div>

      {/* ── JOB HEALTH CARDS ─────────────────────────────────────────────────── */}
      {projects.filter(p => resolveProjectBucket(p) === 'active').length > 0 && (
        <div>
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Job Health</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {projects
              .filter(p => resolveProjectBucket(p) === 'active')
              .map(p => {
                const h = health(p, backup)
                const o = getOverallCompletion(p, backup)
                const d = daysSince(p.lastMove)
                const openR = (p.rfis || []).filter((r: any) => r.status !== 'answered').length

                return (
                  <div
                    key={p.id}
                    className="rounded-xl border border-gray-800 bg-[var(--bg-card)] p-4 cursor-pointer hover:border-gray-600 transition-colors"
                  >
                    {/* Top row: name+type | score */}
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="font-bold text-sm text-gray-100">{p.name}</div>
                        <div className="text-[10px] text-gray-500">{p.type}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xl font-bold font-mono" style={{ color: h.clr }}>{h.sc}</div>
                        <div className="text-[9px] text-gray-500">Health</div>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="w-full h-1.5 rounded-full bg-gray-700/50 overflow-hidden mb-2">
                      <div className="h-full transition-all rounded-full" style={{ width: `${Math.min(100, o)}%`, background: h.clr }} />
                    </div>

                    {/* Reasons */}
                    <div className="text-[10px] text-gray-500 mb-2">
                      {h.reasons.length ? h.reasons.join(' · ') : 'On track'}
                    </div>

                    {/* Sparkline: paid vs remaining contract exposure */}
                    {(() => {
                      const fin = getProjectFinancials(p, backup)
                      const paidPct = Math.round((fin.paid / Math.max(fin.contract, 1)) * 100)
                      return (
                        <div className="mb-2 flex items-center gap-2">
                          <div style={{ width: '60px', height: '6px', backgroundColor: '#374151', borderRadius: '2px', overflow: 'hidden', display: 'flex' }}>
                            {fin.paid > 0 && fin.contract > 0 && (
                              <div style={{ width: `${(fin.paid / fin.contract) * 100}%`, backgroundColor: '#10b981', height: '100%' }} />
                            )}
                            {fin.paid < fin.contract && (
                              <div style={{ width: `${((fin.contract - fin.paid) / fin.contract) * 100}%`, backgroundColor: '#9ca3af', height: '100%' }} />
                            )}
                          </div>
                          <span style={{ fontSize: '8px', color: '#9ca3af' }}>{paidPct}% paid</span>
                        </div>
                      )
                    })()}

                    {/* Chips */}
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      <span className={`text-[9px] px-2 py-0.5 rounded font-semibold ${
                        d >= 14 ? 'bg-red-500/20 text-red-400' : d >= 7 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-emerald-500/20 text-emerald-400'
                      }`}>{d}d stale</span>
                      <span className="text-[9px] px-2 py-0.5 rounded font-semibold bg-blue-500/20 text-blue-400">
                        {pct(Math.round(o))}
                      </span>
                      {openR > 0 && (
                        <span className="text-[9px] px-2 py-0.5 rounded font-semibold bg-red-500/20 text-red-400">
                          {openR} RFI
                        </span>
                      )}
                    </div>

                    {/* Edit / Delete */}
                    <div className="flex gap-2 pt-2 border-t border-gray-700/50">
                      <button className="flex-1 text-[10px] px-2 py-1.5 rounded bg-gray-700/50 text-gray-300 hover:bg-gray-600/50 transition-colors font-semibold">
                        <Edit3 size={10} className="inline mr-1" /> Edit
                      </button>
                      <button className="text-[10px] px-2 py-1.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors font-semibold border border-red-500/20">
                        <Trash2 size={10} className="inline mr-1" /> Delete
                      </button>
                    </div>
                  </div>
                )
              })}
          </div>
        </div>
      )}

      {/* ── SERVICE JOBS REQUIRING ATTENTION ─────────────────────────────────── */}
      {serviceJobsNeedingAttention.length > 0 && (
        <div>
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Service Jobs Requiring Attention</h2>
          <div className="space-y-2">
            {serviceJobsNeedingAttention.map((l: any) => (
              <div
                key={l.id}
                className="flex items-center justify-between p-3 bg-[var(--bg-card)] border border-gray-800 rounded-lg"
              >
                <div className="flex-1">
                  <div className="font-semibold text-sm text-gray-100">{l.customer}</div>
                  <div className="text-[9px] text-gray-200 mt-0.5">
                    {l.jtype} • {fmt(l.balanceDue)} due • {daysSince(l.date)}d ago
                  </div>
                </div>
                <button
                  onClick={() => markServiceJobCollected(l.id)}
                  className="ml-3 text-[10px] px-2.5 py-1.5 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors font-semibold whitespace-nowrap"
                >
                  Mark Collected
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── AGENDA ALERTS ────────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Alerts</h2>
        {filteredAgendaAlerts.length > 0 || loadedCustomAlerts.length > 0 ? (
          <div className="space-y-2">
            {/* AI-generated alerts */}
            {filteredAgendaAlerts.map((a, i) => {
              const aiAlertId = 'ai-' + i
              const isEditing = editingAIAlertId === aiAlertId
              return (
                <div
                  key={aiAlertId}
                  className="flex items-start gap-2 p-3 bg-[var(--bg-card)] border border-gray-800 rounded-lg"
                >
                  <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: a.clr }} />
                  {isEditing ? (
                    <input
                      autoFocus
                      type="text"
                      value={editAIAlertText}
                      onChange={(e) => setEditAIAlertText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          // Update existing or create custom alert for this AI alert
                          pushState(backup)
                          if (!backup.customAlerts) backup.customAlerts = []
                          const existing = backup.customAlerts.find(ca => ca.isAI && ca.manuallyEdited && ca.linkedProjectId === (a.id || ''))
                          if (existing) {
                            existing.title = editAIAlertText
                          } else {
                            backup.customAlerts.push({
                              id: 'ai2c_' + Date.now() + '_' + i,
                              title: editAIAlertText,
                              description: '',
                              action: '',
                              isAI: true,
                              manuallyEdited: true,
                              scheduledAt: '',
                              linkedProjectId: a.id || ''
                            })
                          }
                          persist()
                          forceUpdate()
                          setEditingAIAlertId(null)
                          setEditAIAlertText('')
                        }
                      }}
                      onBlur={() => {
                        if (editingAIAlertId !== aiAlertId) return
                        // Update existing or create custom alert for this AI alert
                        if (editAIAlertText.trim()) {
                          pushState(backup)
                          if (!backup.customAlerts) backup.customAlerts = []
                          const existing = backup.customAlerts.find(ca => ca.isAI && ca.manuallyEdited && ca.linkedProjectId === (a.id || ''))
                          if (existing) {
                            existing.title = editAIAlertText
                          } else {
                            backup.customAlerts.push({
                              id: 'ai2c_' + Date.now() + '_' + i,
                              title: editAIAlertText,
                              description: '',
                              action: '',
                              isAI: true,
                              manuallyEdited: true,
                              scheduledAt: '',
                              linkedProjectId: a.id || ''
                            })
                          }
                          persist()
                          forceUpdate()
                        }
                        setEditingAIAlertId(null)
                        setEditAIAlertText('')
                      }}
                      className="flex-1 bg-gray-900 border border-cyan-500/50 rounded px-2 py-1 text-gray-200 text-xs"
                    />
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setEditingAIAlertId(aiAlertId)
                          setEditAIAlertText(a.txt)
                        }}
                        className="text-gray-500 hover:text-gray-300 mt-0.5 flex-shrink-0"
                        title="Edit alert"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <div className="flex-1">
                        <p className="text-gray-200 text-xs">{a.txt}</p>
                        <div className="flex gap-2 mt-1">
                          <span className="text-[8px] px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded">AI</span>
                        </div>
                      </div>
                    </>
                  )}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => alert('AI analysis for this item coming soon.')}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-400 hover:text-gray-300 transition-colors flex items-center gap-0.5"
                    >
                      ✨ Ask AI
                    </button>
                  </div>
                </div>
              )
            })}

            {/* Custom alerts */}
            {loadedCustomAlerts.map((a) => (
              <div key={a.id}>
                {editingAlertId === a.id ? (
                  // Edit mode
                  <div className="p-3 bg-[var(--bg-card)] border border-blue-500/50 rounded-lg space-y-2">
                    <input
                      type="text"
                      placeholder="Alert title"
                      value={editingAlertData.title}
                      onChange={(e) => setEditingAlertData({...editingAlertData, title: e.target.value})}
                      className="w-full px-2 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded text-gray-200 placeholder-gray-600"
                    />
                    <textarea
                      placeholder="Description"
                      value={editingAlertData.description}
                      onChange={(e) => setEditingAlertData({...editingAlertData, description: e.target.value})}
                      rows={2}
                      className="w-full px-2 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded text-gray-200 placeholder-gray-600 resize-none"
                    />
                    <input
                      type="text"
                      placeholder="Action (optional)"
                      value={editingAlertData.action}
                      onChange={(e) => setEditingAlertData({...editingAlertData, action: e.target.value})}
                      className="w-full px-2 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded text-gray-200 placeholder-gray-600"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[9px] text-gray-500 mb-0.5 block">Schedule Push At</label>
                        <input
                          type="datetime-local"
                          value={editingAlertData.scheduledAt || ''}
                          onChange={(e) => setEditingAlertData({...editingAlertData, scheduledAt: e.target.value})}
                          className="w-full px-2 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded text-gray-200"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] text-gray-500 mb-0.5 block">Link to Project</label>
                        <select
                          value={editingAlertData.linkedProjectId || ''}
                          onChange={(e) => setEditingAlertData({...editingAlertData, linkedProjectId: e.target.value})}
                          className="w-full px-2 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded text-gray-200"
                        >
                          <option value="">None</option>
                          {projects.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveAlert(a.id, editingAlertData, a.isAI)}
                        className="flex-1 text-[10px] px-2 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 transition-colors font-semibold"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => {setEditingAlertId(null); setEditingAlertData({title: '', description: '', action: '', scheduledAt: '', linkedProjectId: ''})}}
                        className="flex-1 text-[10px] px-2 py-1.5 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors font-semibold"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  // Display mode
                  <div className="flex items-start justify-between gap-2 p-3 bg-[var(--bg-card)] border border-gray-800 rounded-lg">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="text-xs font-semibold text-gray-200">{a.title}</div>
                        {a.manuallyEdited ? (
                          <span className="text-[8px] px-1.5 py-0.5 rounded flex-shrink-0 bg-yellow-500/30 text-yellow-300">
                            ✏ Manual Edit
                          </span>
                        ) : a.isAI ? (
                          <span className="text-[8px] px-1.5 py-0.5 rounded flex-shrink-0 bg-emerald-500/30 text-emerald-300">
                            AI
                          </span>
                        ) : null}
                      </div>
                      {a.description && <div className="text-[9px] text-gray-400 mt-1">{a.description}</div>}
                      {a.action && <div className="text-[9px] text-gray-500 mt-1">Action: {a.action}</div>}
                      {a.scheduledAt && <div className="text-[9px] text-blue-400 mt-1">Push: {new Date(a.scheduledAt).toLocaleString()}</div>}
                      {a.linkedProjectId && <div className="text-[9px] text-teal-400 mt-1">Project: {projects.find(p => p.id === a.linkedProjectId)?.name || a.linkedProjectId}</div>}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => startEditAlert(a)}
                        className="text-[9px] px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-400 hover:text-gray-300 transition-colors"
                        title="Edit alert"
                      >
                        <Edit3 size={10} className="inline" />
                      </button>
                      <button
                        onClick={() => dismissAlert(a.id)}
                        className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                        title="Dismiss alert"
                      >
                        <X size={10} className="inline" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Add new alert form */}
            {addingAlert ? (
              <div className="p-3 bg-[var(--bg-card)] border border-blue-500/50 rounded-lg space-y-2">
                <input
                  type="text"
                  placeholder="Alert title"
                  value={editingAlertData.title}
                  onChange={(e) => setEditingAlertData({...editingAlertData, title: e.target.value})}
                  className="w-full px-2 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded text-gray-200 placeholder-gray-600"
                />
                <textarea
                  placeholder="Description"
                  value={editingAlertData.description}
                  onChange={(e) => setEditingAlertData({...editingAlertData, description: e.target.value})}
                  rows={2}
                  className="w-full px-2 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded text-gray-200 placeholder-gray-600 resize-none"
                />
                <input
                  type="text"
                  placeholder="Action (optional)"
                  value={editingAlertData.action}
                  onChange={(e) => setEditingAlertData({...editingAlertData, action: e.target.value})}
                  className="w-full px-2 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded text-gray-200 placeholder-gray-600"
                />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[9px] text-gray-500 mb-0.5 block">Schedule Push At</label>
                    <input
                      type="datetime-local"
                      value={editingAlertData.scheduledAt || ''}
                      onChange={(e) => setEditingAlertData({...editingAlertData, scheduledAt: e.target.value})}
                      className="w-full px-2 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded text-gray-200"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] text-gray-500 mb-0.5 block">Link to Project</label>
                    <select
                      value={editingAlertData.linkedProjectId || ''}
                      onChange={(e) => setEditingAlertData({...editingAlertData, linkedProjectId: e.target.value})}
                      className="w-full px-2 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded text-gray-200"
                    >
                      <option value="">None</option>
                      {projects.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => saveAlert(null, editingAlertData, false)}
                    className="flex-1 text-[10px] px-2 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 transition-colors font-semibold"
                  >
                    Add Alert
                  </button>
                  <button
                    onClick={() => {setAddingAlert(false); setEditingAlertData({title: '', description: '', action: '', scheduledAt: '', linkedProjectId: ''})}}
                    className="flex-1 text-[10px] px-2 py-1.5 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors font-semibold"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => {setAddingAlert(true); setEditingAlertData({title: '', description: '', action: ''})}}
                className="w-full text-[10px] px-2 py-2 rounded border border-dashed border-gray-700 text-gray-400 hover:text-gray-300 hover:border-gray-600 transition-colors font-semibold"
              >
                + Add Alert
              </button>
            )}
          </div>
        ) : (
          <div className="p-3 bg-[var(--bg-card)] border border-gray-800 rounded-lg text-xs text-gray-500 text-center">
            ✓ No urgent alerts
          </div>
        )}
      </div>

      {/* ── AGENDA SECTIONS ──────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Agenda</h2>
          <button
            onClick={addAgendaCategory}
            className="text-[10px] px-2 py-1 rounded bg-gray-700/50 text-gray-400 hover:text-gray-300 transition-colors flex items-center gap-1"
          >
            <Plus size={10} /> Sub-Category
          </button>
        </div>

        {(backup.agendaSections || []).length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {(backup.agendaSections || []).map(sec => (
              <div key={sec.id} className="rounded-xl border border-gray-800 bg-[var(--bg-card)] p-4">
                {/* Board header */}
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="font-bold text-sm text-gray-200">{sec.title}</div>
                    <div className="text-[9px] text-gray-500 mt-0.5">
                      {getAgendaProjectName(backup, sec.projectId)} • {(sec.tasks || []).length} task{(sec.tasks || []).length === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => addAgendaTask(sec.id)}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-400 hover:text-gray-300 transition-colors"
                    >+ Task</button>
                    <button
                      onClick={() => editAgendaCategory(sec.id)}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-400 hover:text-gray-300 transition-colors"
                    >Edit</button>
                    <button
                      onClick={() => removeAgendaCategory(sec.id)}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-gray-700/50 text-red-400 hover:text-red-300 transition-colors"
                    >Delete</button>
                  </div>
                </div>

                {/* Tasks */}
                {(sec.tasks || []).length > 0 ? (
                  <div className="space-y-1">
                    {(sec.tasks || []).map((t: any) => (
                      <div key={t.id} className="flex items-center gap-2 py-1.5 group">
                        <div
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{
                            background: t.status === 'completed' ? '#10b981' : t.status === 'canceled' ? '#ef4444' : '#3b82f6',
                          }}
                        />
                        <div className={`text-xs flex-1 ${t.status === 'completed' ? 'line-through text-gray-600' : t.status === 'canceled' ? 'line-through text-gray-600' : 'text-gray-300'}`}>
                          {t.text}
                        </div>
                        <div className="flex items-center gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                          {agendaStatusChip(t.status)}
                          <button
                            onClick={() => cycleAgendaTaskStatus(sec.id, t.id)}
                            className="text-[8px] px-1 py-0.5 rounded bg-gray-700/50 text-gray-400 hover:text-gray-300"
                          >Status</button>
                          <button
                            onClick={() => editAgendaTask(sec.id, t.id)}
                            className="text-[8px] px-1 py-0.5 rounded bg-gray-700/50 text-gray-400 hover:text-gray-300"
                          >Edit</button>
                          <button
                            onClick={() => moveAgendaTask(sec.id, t.id)}
                            className="text-[8px] px-1 py-0.5 rounded bg-gray-700/50 text-gray-400 hover:text-gray-300"
                          >Move</button>
                          <button
                            onClick={() => removeAgendaTask(sec.id, t.id)}
                            className="text-[8px] px-1 py-0.5 rounded bg-gray-700/50 text-red-400 hover:text-red-300"
                          >✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[10px] text-gray-600 text-center py-3">No tasks yet.</div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4 bg-[var(--bg-card)] border border-gray-800 rounded-lg text-xs text-gray-500 text-center">
            Create a sub-category to start organizing today's agenda.
          </div>
        )}
      </div>

      {/* ── RECENT LOGS ──────────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Recent Logs</h2>
        {recentLogs.length > 0 ? (
          <div className="rounded-xl border border-gray-800 bg-[var(--bg-card)] overflow-hidden">
            {(() => {
              const grouped = groupLogsByDate(recentLogs)
              const sortedDates = Array.from(grouped.keys()).sort((a, b) => new Date(b).getTime() - new Date(a).getTime())

              return sortedDates.map((date, dateIdx) => {
                const logsForDate = grouped.get(date) || []
                const mileRate = backup.settings?.mileRate || 0.66

                // Calculate daily totals
                let dailyRevenue = 0
                let dailyExpenses = 0
                logsForDate.forEach((l: any) => {
                  dailyRevenue += num(l.collected || l.quoted || 0)
                  const mat = num(l.mat || 0)
                  const miles = num(l.miles || 0)
                  dailyExpenses += mat + (miles * mileRate)
                })
                const dailyNet = dailyRevenue - dailyExpenses

                return (
                  <div key={date}>
                    {logsForDate.map((l, i) => (
                      <div key={l.id || date + '-' + i} className={`px-4 py-3 flex items-start justify-between ${i < logsForDate.length - 1 ? 'border-b border-gray-800/50' : ''}`}>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-[10px] text-gray-400 font-mono">{l.date}</span>
                            <span className="text-xs font-semibold text-gray-200">{l.projName}</span>
                            <span className="text-[9px] text-gray-400">— {l.emp || 'Me'}</span>
                          </div>
                          <div className="text-[10px] text-blue-300">{l.phase}</div>
                          {l.notes && <div className="text-[10px] text-gray-200 mt-0.5">{l.notes}</div>}
                        </div>
                        <div className="text-right flex-shrink-0 ml-3">
                          <div className="text-xs font-mono text-gray-200">{l.hrs}h</div>
                          {l.mat > 0 && <div className="text-[10px] font-mono text-yellow-400">{fmt(l.mat)}</div>}
                        </div>
                      </div>
                    ))}

                    {/* Daily summary strip */}
                    <div className="px-4 py-1.5 bg-gray-800/50 border border-gray-700/30 rounded mx-2 my-2 text-[10px] font-mono">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span style={{color: '#10b981'}}>Revenue: {fmt(dailyRevenue)}</span>
                        <span style={{color: '#ef4444'}}>Expenses: {fmt(dailyExpenses)}</span>
                        <span style={{color: dailyNet >= 0 ? '#10b981' : '#ef4444'}}>Net: {fmt(dailyNet)}</span>
                      </div>
                    </div>
                  </div>
                )
              })
            })()}
          </div>
        ) : (
          <div className="p-4 bg-[var(--bg-card)] border border-gray-800 rounded-lg text-xs text-gray-500 text-center">
            No logs yet. Tap + Log to start.
          </div>
        )}
      </div>

      {/* ── AI Daily Assistant Floating Button ── */}
      <button
        onClick={() => {
          setAiPanelOpen(true)
          if (!aiInitRef.current && kpis) {
            aiInitRef.current = true
            // Auto-load daily analysis on first open
            const activeProjs = projects.filter(p => resolveProjectBucket(p) === 'active')
            const healthScores = activeProjs.map(p => ({ name: p.name, score: health(p, backup).score, completion: getOverallCompletion(p) }))
            const svcNeedingAttention = serviceLogs.filter(sl => getServiceBalanceDue(sl) > 0)
            const context = `Today's business snapshot for Power On Solutions:
- Total Pipeline: ${fmtK(kpis.pipeline)}
- Cash Received (Paid): ${fmtK(kpis.paid)}
- Open RFIs: ${kpis.openRfis}
- Total Hours Logged: ${kpis.totalHours.toFixed(0)}
- Active Projects: ${kpis.activeProjects}
- Service Jobs Needing Attention: ${svcNeedingAttention.length} (total due: ${fmtK(svcNeedingAttention.reduce((s, l) => s + getServiceBalanceDue(l), 0))})
- Project Health: ${healthScores.map(h => `${h.name}: ${h.score}/100 (${h.completion}% complete)`).join(', ') || 'none'}
- SVC Unbilled: ${fmtK(kpis.svcUnbilled)}
- Exposure: ${fmtK(kpis.exposure)}`
            setAiLoading(true)
            callClaude({
              system: `You are NEXUS, the AI operations manager for Power On Solutions, an electrical contractor in Coachella Valley, CA. Christian is the owner. Greet him warmly. Analyze the daily snapshot and present priority-scored items using these icons: CRITICAL for urgent issues, ATTENTION for items needing review, GOOD for healthy metrics. Be concise, actionable, and speak like a trusted operations partner.`,
              messages: [{ role: 'user', content: `Good ${getGreeting()} analysis:\n${context}` }],
              max_tokens: 1024,
            }).then(res => {
              const text = extractText(res)
              setAiMessages([{ role: 'assistant', content: text }])
            }).catch(() => {
              setAiMessages([{ role: 'assistant', content: `Good ${getGreeting()}, Christian. I couldn't reach the AI service right now. Your dashboard data is above — check the service jobs needing attention first.` }])
            }).finally(() => setAiLoading(false))
          }
        }}
        className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-500 text-white shadow-xl flex items-center justify-center transition-all hover:scale-110"
        title="AI Daily Assistant"
      >
        <Brain size={24} />
      </button>

      {/* ── AI Slide-in Panel ── */}
      {aiPanelOpen && (
        <div className="fixed inset-y-0 right-0 z-50 w-[400px] max-w-full bg-[#1a1d2e] border-l border-gray-700 shadow-2xl flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-[#151827]">
            <div>
              <h3 className="text-sm font-bold text-gray-100">Good {getGreeting()}, Christian</h3>
              <p className="text-[10px] text-gray-500">{formatDate()}</p>
            </div>
            <button onClick={() => { setAiPanelOpen(false); aiInitRef.current = false; setAiMessages([]) }} className="text-gray-400 hover:text-white"><X size={18} /></button>
          </div>
          {/* Messages */}
          <div ref={aiScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {aiLoading && aiMessages.length === 0 && (
              <div className="text-center py-8">
                <div className="animate-pulse text-blue-400 text-sm">Analyzing your day...</div>
              </div>
            )}
            {aiMessages.map((msg, i) => (
              <div key={i} className={`text-xs leading-relaxed whitespace-pre-wrap ${msg.role === 'user' ? 'bg-blue-900/30 border border-blue-800 rounded-lg p-3 text-blue-200 ml-8' : 'bg-[#232738] border border-gray-700 rounded-lg p-3 text-gray-300'}`}>
                {msg.content}
              </div>
            ))}
          </div>
          {/* Input */}
          <div className="border-t border-gray-700 p-3 flex gap-2">
            <input
              type="text"
              value={aiInput}
              onChange={e => setAiInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && aiInput.trim() && !aiLoading) {
                  const userMsg = aiInput.trim()
                  setAiInput('')
                  const updated = [...aiMessages, { role: 'user' as const, content: userMsg }]
                  setAiMessages(updated)
                  setAiLoading(true)
                  callClaude({
                    system: `You are NEXUS, the AI operations manager for Power On Solutions, an electrical contractor in Coachella Valley, CA. Be concise and actionable.`,
                    messages: updated.map(m => ({ role: m.role, content: m.content })),
                    max_tokens: 1024,
                  }).then(res => {
                    setAiMessages(prev => [...prev, { role: 'assistant', content: extractText(res) }])
                  }).catch(() => {
                    setAiMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I couldn\'t process that. Try again.' }])
                  }).finally(() => setAiLoading(false))
                }
              }}
              placeholder="Ask about your day..."
              className="flex-1 bg-[#232738] border border-gray-600 rounded px-3 py-2 text-xs text-gray-200 placeholder-gray-500 focus:border-blue-500 outline-none"
            />
            <button
              onClick={() => {
                if (!aiInput.trim() || aiLoading) return
                const userMsg = aiInput.trim()
                setAiInput('')
                const updated = [...aiMessages, { role: 'user' as const, content: userMsg }]
                setAiMessages(updated)
                setAiLoading(true)
                callClaude({
                  system: `You are NEXUS, the AI operations manager for Power On Solutions, an electrical contractor in Coachella Valley, CA. Be concise and actionable.`,
                  messages: updated.map(m => ({ role: m.role, content: m.content })),
                  max_tokens: 1024,
                }).then(res => {
                  setAiMessages(prev => [...prev, { role: 'assistant', content: extractText(res) }])
                }).catch(() => {
                  setAiMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I couldn\'t process that. Try again.' }])
                }).finally(() => setAiLoading(false))
              }}
              disabled={aiLoading}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded text-white disabled:opacity-50"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
