// @ts-nocheck
/**
 * V15rHome – Main dashboard/home view.
 * Faithfully ported from HTML renderHome().
 *
 * Sections:
 * 1. Greeting + date + "New Project" button
 * 2. 4 KPI cards (Pipeline, Cash Received, Open RFIs, Hours Logged)
 * 3. Google Calendar embed
 * 4. Job Health cards (per project, score 0-100, reasons, chips)
 * 5. Service Jobs Requiring Attention (unpaid only)
 * 6. Agenda Alerts (auto-generated: stalled, check-in, critical RFIs)
 * 7. Agenda Sections with full CRUD (add/edit/delete categories+tasks, cycle status)
 * 8. Recent Logs — tabbed: Projects | Service
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Plus,
  ChevronRight,
  X,
  Edit3,
  Edit2,
  RefreshCw,
  Lock,
  LockOpen,
  CalendarDays,
  Receipt,
  Timer,
  Users,
  Target,
  Building2,
  Briefcase,
  Package,
  Truck,
  Boxes,
  Route,
  CircleDollarSign,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  getBackupData,
  saveBackupData,
  saveBackupDataAndSync,
  getKPIs,
  health,
  daysSince,
  fmtK,
  fmt,
  ensureAgendaState,
  getAgendaProjectName,
  resolveProjectBucket,
  isArchivedRecord,
  num,
  buildProjectLogRollup,
  type BackupData,
  type BackupProject,
} from '@/services/backupDataService'
import { ProjectCard } from './ProjectCard'
import { useDemoMode } from '@/store/demoStore'
import { getDemoBackupData } from '@/services/demoDataService'
import { pushState } from '@/services/undoRedoService'
import { callClaude, extractText } from '@/services/claudeProxy'
import CollectionPriorityCard from '@/components/CollectionPriorityCard'

// ── Greeting helper ──────────────────────────────────────────────────────────

function getGreeting(): string {
  const hr = new Date().getHours()
  if (hr >= 5 && hr < 12) return 'morning'
  if (hr >= 12 && hr < 17) return 'afternoon'
  if (hr >= 17 && hr < 21) return 'evening'
  return 'night'
}

function formatDate(): string {
  const d = new Date()
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

// ── Status chip helper ───────────────────────────────────────────────────────

function agendaStatusChip(status: string) {
  const colors: Record<string, string> = {
    pending: 'bg-yellow-900/30 text-yellow-400',
    active: 'bg-blue-900/30 text-blue-400',
    done: 'bg-green-900/30 text-green-400',
    postponed: 'bg-gray-700/30 text-gray-400',
    declined: 'bg-red-900/30 text-red-400',
  }
  return (
    <span className={`text-[9px] px-2 py-0.5 rounded font-semibold ${colors[status] || colors.pending}`}>
      {status}
    </span>
  )
}

const STATUS_CYCLE = ['pending', 'active', 'done', 'postponed', 'declined']

function getAgendaSectionIcon(title: string, projectId?: string | null) {
  const normalizedTitle = (title || '').toLowerCase()
  if (normalizedTitle.includes('today')) return CalendarDays
  if (normalizedTitle.includes('payment') || normalizedTitle.includes('collect')) return Receipt
  if (normalizedTitle.includes('lead')) return Users
  if (normalizedTitle.includes('business')) return Briefcase
  if (normalizedTitle.includes('tool') || normalizedTitle.includes('material')) return Truck
  if (normalizedTitle.includes('stock') || normalizedTitle.includes('watchlist')) return Package
  if (projectId) return Building2
  return Target
}

// ── Balance color helper ─────────────────────────────────────────────────────

function getBalanceColor(balance: number, contract: number): string {
  if (balance < 0) return '#ef4444'
  if (contract <= 0) return '#10b981'
  const pctLeft = balance / contract
  if (pctLeft > 0.20) return '#10b981'
  if (pctLeft > 0.10) return '#f59e0b'
  return '#f97316'
}

// ── Service money math helper ────────────────────────────────────────────────

function getServiceBalanceDue(log: any): number {
  const baseQuoted = num(log.quoted || 0)
  const incomeAdjs = (log.adjustments || []).filter((a: any) => a.type === 'income').reduce((s: number, a: any) => s + num(a.amount), 0)
  const totalBillable = baseQuoted + incomeAdjs
  const collected = num(log.collected || 0)
  return Math.max(0, totalBillable - collected)
}

function getServiceRollup(log: any): any {
  const adjustments = Array.isArray(log.adjustments) ? log.adjustments : []
  const addIncome = adjustments.filter((a: any) => a?.type === 'income').reduce((s: number, a: any) => s + num(a.amount), 0)
  const addExpense = adjustments
    .filter((a: any) => a?.type === 'expense' && (a.category || 'expense') !== 'mileage')
    .reduce((s: number, a: any) => s + num(a.amount), 0)
  const addMileage = adjustments
    .filter((a: any) => a && ((a.type === 'mileage') || (a.type === 'expense' && (a.category || '') === 'mileage')))
    .reduce((s: number, a: any) => s + num(a.amount), 0)
  const totalAddedCost = addExpense + addMileage
  const baseQuoted = num(log?.quoted)
  const totalBillable = baseQuoted + addIncome

  let settings: any = {}
  try {
    const bd = JSON.parse(localStorage.getItem('poweron_backup_data') || '{}')
    settings = bd.settings || {}
  } catch {}
  const opCost = num(settings.opCost) || 43
  const mileRate = num(settings.mileRate) || 0.66

  const hrs = num(log?.hrs)
  const miles = num(log?.miles)
  const matCost = num(log?.mat)
  const laborCost = hrs * opCost
  const mileCost = miles * mileRate
  const totalActual = matCost + mileCost + laborCost + totalAddedCost
  const collected = num(log?.collected)
  const remaining = Math.max(0, totalBillable - collected)

  return {
    baseQuoted,
    totalBillable,
    totalActual,
    collected,
    remaining,
    projectedProfit: totalBillable - totalActual,
    hrs,
    miles,
    matCost,
    laborCost,
    mileCost,
    opCost,
    mileRate,
  }
}

// ── Helper to group logs by date ─────────────────────────────────────────────
function groupLogsByDate(logs: any[]): Map<string, any[]> {
  const grouped = new Map<string, any[]>()
  logs.forEach(log => {
    const date = log.date || ''
    if (!grouped.has(date)) grouped.set(date, [])
    grouped.get(date)!.push(log)
  })
  return grouped
}

// ── Home Calendar persistence ─────────────────────────────────────────────────
// Google Calendar iframe embed. Internal hour-of-day scroll is cross-origin
// and cannot be controlled; the container height determines how much of the
// 24-hour grid is visible, so a taller container reveals more of the workday.
//
// Drag handle is clamped to ±30% of the default height:
//   min  ≈ DEFAULT × 0.70  →  600 px
//   max  ≈ DEFAULT × 1.30  → 1120 px
//
// Persisted in localStorage under HOME_CALENDAR_VIEW_KEY:
//   collapsed — whether the calendar section is visible (boolean)
//   height    — container height in pixels (number, clamped to min/max)
const HOME_CALENDAR_VIEW_KEY = 'poweron:v15r:homeCalendarView'
const HOME_CALENDAR_MIN_HEIGHT = 600
const HOME_CALENDAR_DEFAULT_HEIGHT = 860
const HOME_CALENDAR_MAX_HEIGHT = 1120
// Google Calendar iframe header row (days/date strip) is ~44 px; the 24-hour
// time grid fills the remaining height. Used to calculate the locked offset.
const GCAL_HEADER_H = 44
const LOCK_DEFAULT_START_HOUR = 6
const LOCK_START_HOURS = [3, 4, 5, 6, 7, 8, 9, 10]

function getHomeCalendarMaxHeight(): number {
  return HOME_CALENDAR_MAX_HEIGHT
}

function clampHomeCalendarHeight(height: unknown): number {
  const next = Number(height)
  if (!Number.isFinite(next)) return HOME_CALENDAR_DEFAULT_HEIGHT
  return Math.min(getHomeCalendarMaxHeight(), Math.max(HOME_CALENDAR_MIN_HEIGHT, Math.round(next)))
}

function hourLabel(h: number): string {
  if (h === 0) return '12AM'
  if (h < 12) return `${h}AM`
  if (h === 12) return '12PM'
  return `${h - 12}PM`
}

// Returns the iframe height and negative top offset needed to clip the Google
// Calendar iframe so only the locked 12-hour window is visible.
// pxPerHour = containerHeight / 12 (12 hours fill the visible container).
// iframeHeight = 24 * pxPerHour + GCAL_HEADER_H (full 24-h grid + header).
// topOffset = GCAL_HEADER_H + startHour * pxPerHour (scroll to start hour).
function calcLockOffset(containerHeight: number, startHour: number) {
  const pxPerHour = containerHeight / 12
  const iframeHeight = Math.round(24 * pxPerHour + GCAL_HEADER_H)
  const topOffset = Math.round(GCAL_HEADER_H + startHour * pxPerHour)
  return { iframeHeight, topOffset }
}

function loadHomeCalendarView() {
  if (typeof window === 'undefined') {
    return { collapsed: false, height: HOME_CALENDAR_DEFAULT_HEIGHT, locked: false, lockedStartHour: LOCK_DEFAULT_START_HOUR }
  }
  try {
    const stored = JSON.parse(localStorage.getItem(HOME_CALENDAR_VIEW_KEY) || '{}')
    return {
      collapsed: stored?.collapsed === true,
      height: clampHomeCalendarHeight(stored?.height ?? HOME_CALENDAR_DEFAULT_HEIGHT),
      locked: stored?.locked === true,
      lockedStartHour: typeof stored?.lockedStartHour === 'number' ? stored.lockedStartHour : LOCK_DEFAULT_START_HOUR,
    }
  } catch {
    return { collapsed: false, height: HOME_CALENDAR_DEFAULT_HEIGHT, locked: false, lockedStartHour: LOCK_DEFAULT_START_HOUR }
  }
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function V15rHome() {
  const { isDemoMode, hasHydrated } = useDemoMode()
  const [, setTick] = useState(0)
  const [homeCalendarView, setHomeCalendarView] = useState(loadHomeCalendarView)
  const [isCalendarResizing, setIsCalendarResizing] = useState(false)
  const [showLockPopover, setShowLockPopover] = useState(false)
  const calendarResizeRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const lockPopoverRef = useRef<HTMLDivElement>(null)
  const [customAlerts, setCustomAlerts] = useState<Array<{id: string, title: string, description: string, action: string, isAI: boolean, manuallyEdited?: boolean, scheduledAt?: string, linkedProjectId?: string}>>([])
  const [editingAlertId, setEditingAlertId] = useState<string | null>(null)
  const [editingAlertData, setEditingAlertData] = useState<{title: string, description: string, action: string, scheduledAt?: string, linkedProjectId?: string}>({title: '', description: '', action: '', scheduledAt: '', linkedProjectId: ''})
  const [addingAlert, setAddingAlert] = useState(false)
  const [editingAIAlertId, setEditingAIAlertId] = useState<string | null>(null)
  const [editAIAlertText, setEditAIAlertText] = useState('')
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])

  const persistHomeCalendarView = useCallback((view: { collapsed: boolean; height: number; locked: boolean; lockedStartHour: number }) => {
    if (typeof window === 'undefined') return
    localStorage.setItem(HOME_CALENDAR_VIEW_KEY, JSON.stringify({
      collapsed: view.collapsed,
      height: clampHomeCalendarHeight(view.height),
      locked: view.locked,
      lockedStartHour: view.lockedStartHour,
    }))
  }, [])

  const updateHomeCalendarView = useCallback((updater: (view: { collapsed: boolean; height: number; locked: boolean; lockedStartHour: number }) => { collapsed: boolean; height: number; locked: boolean; lockedStartHour: number }) => {
    setHomeCalendarView(prev => {
      const next = updater(prev)
      const normalized = {
        collapsed: next.collapsed === true,
        height: clampHomeCalendarHeight(next.height),
        locked: next.locked === true,
        lockedStartHour: typeof next.lockedStartHour === 'number' ? next.lockedStartHour : LOCK_DEFAULT_START_HOUR,
      }
      persistHomeCalendarView(normalized)
      return normalized
    })
  }, [persistHomeCalendarView])

  // ── Recent Logs pagination ──
  const [logsVisible, setLogsVisible] = useState(10)
  const [logsTab, setLogsTab] = useState<'projects' | 'service'>('projects')
  const [svcLogsVisible, setSvcLogsVisible] = useState(10)
  const SVC_LOGS_PAGE = 10
  const LOGS_PAGE = 10

  // ── Quote refresh offset ──
  const [quoteOffset, setQuoteOffset] = useState(0)

  // ── AI Daily Assistant state ──
  const [aiPanelOpen, setAiPanelOpen] = useState(false)
  const [aiMessages, setAiMessages] = useState<Array<{role: 'user' | 'assistant', content: string}>>([])
  const [aiInput, setAiInput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiRecording, setAiRecording] = useState(false)
  const aiScrollRef = useRef<HTMLDivElement>(null)
  const aiInitRef = useRef(false)

  // ── User first name from Supabase profile ──
  const [firstName, setFirstName] = useState<string>('')

  useEffect(() => {
    async function fetchUserName() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', user.id)
          .single()
        if (profile?.full_name) {
          const first = profile.full_name.trim().split(/\s+/)[0]
          if (first) setFirstName(first)
        }
      } catch {
        // silently ignore
      }
    }
    fetchUserName()
  }, [])

  useEffect(() => {
    if (!isCalendarResizing) return

    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'

    const stopResize = () => {
      calendarResizeRef.current = null
      setIsCalendarResizing(false)
    }

    const handlePointerMove = (event: PointerEvent) => {
      const resize = calendarResizeRef.current
      if (!resize) return
      event.preventDefault()
      const height = resize.startHeight + event.clientY - resize.startY
      updateHomeCalendarView(view => ({ ...view, collapsed: false, height }))
    }

    const handleMouseMove = (event: MouseEvent) => {
      const resize = calendarResizeRef.current
      if (!resize) return
      event.preventDefault()
      const height = resize.startHeight + event.clientY - resize.startY
      updateHomeCalendarView(view => ({ ...view, collapsed: false, height }))
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', stopResize)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', stopResize)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
    }
  }, [isCalendarResizing, updateHomeCalendarView])

  useEffect(() => {
    if (!showLockPopover) return
    const handler = (e: MouseEvent) => {
      if (lockPopoverRef.current && !lockPopoverRef.current.contains(e.target as Node)) {
        setShowLockPopover(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showLockPopover])

  const _rawBackup = getBackupData()
  const backup = (hasHydrated && isDemoMode) ? getDemoBackupData() : _rawBackup

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

  let kpis: any
  let projects: BackupProject[] = []

  try {
    ensureAgendaState(backup)
    kpis = getKPIs(backup)
    projects = Array.isArray(backup.projects) ? backup.projects : []
  } catch (err) {
    console.error('[V15rHome] Data derivation error:', err)
    kpis = { pipeline: 0, paid: 0, billed: 0, exposure: 0, svcUnbilled: 0, openRfis: 0, totalHours: 0, activeProjects: 0 }
    projects = []
  }

  if (!kpis) {
    kpis = { pipeline: 0, paid: 0, billed: 0, exposure: 0, svcUnbilled: 0, openRfis: 0, totalHours: 0, activeProjects: 0 }
  }

  const logs: any[] = Array.isArray(backup.logs) ? backup.logs : []
  const serviceLogs: any[] = Array.isArray(backup.serviceLogs) ? backup.serviceLogs : []

  // ── Agenda alerts (auto-generated) ──────────────────────────────────────────
  const agendaAlerts: Array<{ clr: string; txt: string; id: string }> = []
  projects.forEach(p => {
    if (!p.name || p.name === 'undefined') return
    const d = daysSince(p.lastMove)
    if (d > 365) return
    if (d >= 14) {
      agendaAlerts.push({ clr: '#ef4444', txt: '📞 Call on ' + p.name + ' – ' + d + 'd stalled', id: p.id })
    } else if (d >= 7) {
      agendaAlerts.push({ clr: '#f59e0b', txt: '🔧 Check-in: ' + p.name + ' – ' + d + 'd', id: p.id })
    }
    ;(Array.isArray(p.rfis) ? p.rfis : []).filter((r: any) => r.status === 'critical').forEach((r: any) => {
      agendaAlerts.push({ clr: '#ef4444', txt: '⚠ Critical RFI on ' + p.name + ': ' + (r.question || '').slice(0, 55) + '...', id: p.id })
    })
  })

  const loadedCustomAlerts = Array.isArray(backup.customAlerts) ? backup.customAlerts : []

  const editedProjectIds = new Set(
    loadedCustomAlerts.filter(a => a.isAI && a.manuallyEdited).map(a => a.linkedProjectId)
  )
  const filteredAgendaAlerts = agendaAlerts.filter(a => !editedProjectIds.has(a.id))

  const mergedAlerts: Array<{ type: 'ai'; data: typeof agendaAlerts[0]; idx: number } | { type: 'custom'; data: typeof loadedCustomAlerts[0]; idx: number }> = []
  filteredAgendaAlerts.forEach((a, i) => mergedAlerts.push({ type: 'ai', data: a, idx: i }))
  loadedCustomAlerts.forEach((a) => {
    const linkedIdx = a.linkedProjectId ? filteredAgendaAlerts.findIndex(fa => fa.id === a.linkedProjectId) : -1
    mergedAlerts.push({ type: 'custom', data: a, idx: linkedIdx >= 0 ? linkedIdx : mergedAlerts.length })
  })
  mergedAlerts.sort((a, b) => a.idx - b.idx)

  // ── Recent logs – paginated ──────────────────────────────────────────────────
  const allLogsReversed = (logs ?? []).slice().sort((a: any, b: any) => String(b.date || '').localeCompare(String(a.date || '')))
  const recentLogs = allLogsReversed.slice(0, logsVisible)
  const hasMoreLogs = allLogsReversed.length > logsVisible

  // ── Service jobs requiring attention (unpaid only, threshold 0.5 to avoid float dust) ──
  const serviceJobsNeedingAttention = (serviceLogs ?? [])
    .map((l: any) => ({
      ...l,
      balanceDue: getServiceBalanceDue(l),
    }))
    .filter((l: any) => l.balanceDue > 0.5)
    .sort((a: any, b: any) => b.balanceDue - a.balanceDue)

  const activeJobHealthProjects = projects.filter(p => !isArchivedRecord(p) && resolveProjectBucket(p) === 'active')

  // ── Agenda CRUD handlers ─────────────────────────────────────────────────────

  function persist() {
    backup._lastSavedAt = new Date().toISOString()
    // Use auto-sync variant — writes localStorage + fire-and-forget Supabase sync.
    // The 30s periodic sync handles debouncing so rapid writes don't flood the network.
    saveBackupDataAndSync(backup)
    window.dispatchEvent(new Event('storage'))
    window.dispatchEvent(new Event('poweron-data-saved'))
    forceUpdate()
  }

  function addAgendaCategory() {
    const title = prompt('Category name:')
    if (!title) return
    pushState(backup)
    const projectId = prompt('Link to project ID (leave blank for General):') || ''
    ;(backup.agendaSections || []).push({ id: 'ag' + Date.now(), title, projectId, tasks: [] })
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
    // BUG FIX: ensure sec.tasks is initialized as a real array attached to sec,
    // not a throw-away (sec.tasks || []). Previously the push went into a temp
    // array that was never assigned back, so the second task in rapid succession
    // would be lost.
    if (!Array.isArray(sec.tasks)) sec.tasks = []
    sec.tasks.push({ id: 'agt' + Date.now(), text, status: 'pending' })
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
    if (!Array.isArray((log as any).statusEvents)) (log as any).statusEvents = []
    const prior = (log as any).statusEvents
    const wasInvoiced = !!(prior.length && prior[prior.length - 1].invoiced)
    prior.push({
      date: new Date().toISOString().slice(0, 10),
      status: 'Y',
      collected: Math.max(0, num(log.collected) || 0),
      invoiced: wasInvoiced,
    })
    persist()
  }

  // ── Alert management handlers ────────────────────────────────────────────────

  function saveAlert(alertId: string | null, data: {title: string, description: string, action: string, scheduledAt?: string, linkedProjectId?: string}, isAI: boolean) {
    if (!data.title.trim()) { alert('Alert title is required'); return }
    pushState(backup)
    if (!backup.customAlerts) backup.customAlerts = []
    if (alertId) {
      const existingAlert = backup.customAlerts.find(a => a.id === alertId)
      if (existingAlert) {
        existingAlert.title = data.title
        existingAlert.description = data.description
        existingAlert.action = data.action
        existingAlert.scheduledAt = data.scheduledAt || ''
        existingAlert.linkedProjectId = data.linkedProjectId || ''
        if (existingAlert.isAI) existingAlert.manuallyEdited = true
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
    if (data.scheduledAt) console.log('[OneSignal] Push notification scheduled for:', data.scheduledAt)
    persist()
    setEditingAlertId(null)
    setAddingAlert(false)
    setEditingAlertData({title: '', description: '', action: '', scheduledAt: '', linkedProjectId: ''})
  }

  function dismissAlert(alertId: string) {
    pushState(backup)
    if (backup.customAlerts) backup.customAlerts = backup.customAlerts.filter(a => a.id !== alertId)
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

  const gcalUrl = backup.settings?.gcalUrl ? `${backup.settings.gcalUrl}&mode=WEEK` : null

  function toggleHomeCalendarCollapsed() {
    updateHomeCalendarView(view => ({ ...view, collapsed: !view.collapsed }))
  }

  function startHomeCalendarResize(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    calendarResizeRef.current = {
      startY: event.clientY,
      startHeight: homeCalendarView.height,
    }
    setIsCalendarResizing(true)
  }

  function startHomeCalendarMouseResize(event: React.MouseEvent<HTMLButtonElement>) {
    if (typeof window !== 'undefined' && 'PointerEvent' in window) return
    event.preventDefault()
    event.stopPropagation()
    calendarResizeRef.current = {
      startY: event.clientY,
      startHeight: homeCalendarView.height,
    }
    setIsCalendarResizing(true)
  }

  // ── Daily Motivation ─────────────────────────────────────────────────────────
  const MOTIVATION_PHRASES = [
    { quote: '"El que tenga miedo a morir, que no nazca."', attr: '— Ya sabes quien.' },
    { quote: '"No hay atajo que no tenga su precio."', attr: '— El camino lo defines tú.' },
    { quote: '"Más vale solo que mal acompañado – pero mejor rodeado de los correctos."', attr: '— Piénsalo.' },
    { quote: '"El éxito no llega a los que esperan. Llega a los que construyen."', attr: '— Tú sabes por qué estás aquí.' },
    { quote: '"Camarón que se duerme, se lo lleva la corriente."', attr: '— No te duermas.' },
    { quote: '"La diferencia entre el sueño y la realidad se llama trabajo."', attr: '— A trabajar.' },
    { quote: '"El hierro se forja en caliente."', attr: '— Este es tu momento.' },
    { quote: '"No cuentes los días, haz que los días cuenten."', attr: '— Cada hora importa.' },
    { quote: '"El que no arriesga, no cruza el mar."', attr: '— Tú ya cruzaste.' },
    { quote: '"Primero Dios, después tú mismo."', attr: '— Nadie más lo hará por ti.' },
    { quote: '"El trabajo duro supera al talento cuando el talento no trabaja duro."', attr: '— Recuérdalo.' },
    { quote: '"No esperes el momento perfecto. Toma el momento y hazlo perfecto."', attr: '— Ahora.' },
    { quote: '"Lo que no te mata, te hace más fuerte – y más listo."', attr: '— Sigue adelante.' },
    { quote: '"Vale más una hora de acción que mil horas de intención."', attr: '— Muévete.' },
    { quote: '"El que madruga, Dios lo ayuda – el que no, también trabaja más."', attr: '— Tú decides.' },
    { quote: '"La disciplina es elegir entre lo que quieres ahora y lo que quieres más."', attr: '— ¿Qué eliges?' },
    { quote: '"No hay sueño pequeño – solo pasos pequeños."', attr: '— Da el siguiente.' },
    { quote: '"El dolor de hoy es la fuerza de mañana."', attr: '— Aguanta.' },
    { quote: '"Más sudor en el entrenamiento, menos sangre en la batalla."', attr: '— Prepárate.' },
    { quote: '"El que persevera, alcanza – y el que no, busca excusas."', attr: '— Sin excusas.' },
    { quote: '"La vida no te da lo que mereces. Te da lo que negocias."', attr: '— Negocia fuerte.' },
    { quote: '"Cae siete veces, levántate ocho."', attr: '— Siempre uno más.' },
    { quote: '"El mundo es de los que se levantan antes."', attr: '— Ya estás despierto.' },
    { quote: '"No le digas a Dios cuán grande es tu problema. Dile a tu problema cuán grande es tu Dios."', attr: '— Fe primero.' },
    { quote: '"El éxito es la suma de pequeños esfuerzos repetidos día tras día."', attr: '— Hoy cuenta.' },
    { quote: '"Si puedes soñarlo, puedes construirlo."', attr: '— Tú ya lo estás construyendo.' },
    { quote: '"El que no vive para servir, no sirve para vivir."', attr: '— Hazlo con propósito.' },
    { quote: '"Haz hoy lo que otros no quieren, para tener mañana lo que otros no pueden."', attr: '— Sin atajos.' },
    { quote: '"La grandeza no se hereda – se construye."', attr: '— Bloque a bloque.' },
    { quote: '"El camino de mil millas comienza con un solo paso."', attr: '— Ya diste el primero.' },
    { quote: '"No busques la aprobación de nadie. Busca los resultados."', attr: '— Los números no mienten.' },
  ]
  const _motivNow = new Date()
  const _motivStart = new Date(_motivNow.getFullYear(), 0, 0)
  const _motivDayOfYear = Math.floor((_motivNow.getTime() - _motivStart.getTime()) / (1000 * 60 * 60 * 24))
  const _motivPhrase = MOTIVATION_PHRASES[(_motivDayOfYear + quoteOffset) % MOTIVATION_PHRASES.length]
  const _motivHr = _motivNow.getHours()
  const _motivPeriod = _motivHr >= 5 && _motivHr < 12 ? 'morning' : _motivHr >= 12 && _motivHr < 17 ? 'afternoon' : _motivHr >= 17 && _motivHr < 21 ? 'evening' : 'night'
  const _motivGreeting = firstName ? `Good ${_motivPeriod}, ${firstName}` : `Good ${_motivPeriod}`
  const _motivFireLine = _motivHr >= 5 && _motivHr < 12 ? "Let's go build something today." : _motivHr >= 12 && _motivHr < 18 ? "The day isn't over – keep pushing." : 'Rest well. Tomorrow we go again.'
  const _motivFullQuote = `${_motivPhrase.quote} ${_motivPhrase.attr}`

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[var(--bg-secondary)] p-6 space-y-6 safe-area-all"
      style={{
        paddingTop: `max(1.5rem, env(safe-area-inset-top))`,
        paddingBottom: `max(1.5rem, env(safe-area-inset-bottom))`,
        paddingLeft: `max(1.5rem, env(safe-area-inset-left))`,
        paddingRight: `max(1.5rem, env(safe-area-inset-right))`,
      }}>

      {/* ── HEADER ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">
            Good {getGreeting()}{firstName ? `, ${firstName}` : ''} ⚡
          </h1>
          <p className="text-xs text-gray-500 mt-1">{formatDate()}</p>
        </div>
        <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors">
          <Plus size={14} /> New Project
        </button>
      </div>

      {/* ── KPI CARDS – PREMIUM ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { accent: '#10b981', glow: 'rgba(16,185,129,0.12)', lbl: 'Total Pipeline', lblShort: 'Pipeline', val: fmtK(kpis.pipeline), sub: projects.length + (projects.length === 1 ? ' project' : ' projects'), icon: '◈' },
          { accent: '#3b82f6', glow: 'rgba(59,130,246,0.12)', lbl: 'Cash Received', lblShort: 'Cash Rcvd', val: fmtK(kpis.paid), sub: 'Accumulated', icon: '⬡' },
          { accent: '#ef4444', glow: 'rgba(239,68,68,0.12)', lbl: 'Open RFIs', lblShort: 'RFIs', val: String(kpis.openRfis), sub: kpis.openRfis === 0 ? 'All resolved' : 'Need resolution', icon: '◇' },
          { accent: '#a78bfa', glow: 'rgba(167,139,250,0.12)', lbl: 'Hours Logged', lblShort: 'Hrs Log', val: kpis.totalHours.toFixed(1) + 'h', sub: logs.length + (logs.length === 1 ? ' entry' : ' entries'), icon: '○' },
        ].map((k, i) => (
          <div key={i} style={{ background: 'linear-gradient(135deg, #16181f 0%, #1a1d28 100%)', border: '1px solid rgba(255,255,255,0.06)', borderTop: `2px solid ${k.accent}`, borderRadius: '10px', padding: '14px 16px 12px', boxShadow: `0 0 0 1px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04), 0 4px 24px ${k.glow}`, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: -20, right: -20, width: 80, height: 80, borderRadius: '50%', background: k.glow, filter: 'blur(20px)', pointerEvents: 'none' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)' }}>
                <span className="sm:hidden">{k.lblShort}</span>
                <span className="hidden sm:inline">{k.lbl}</span>
              </span>
              <span style={{ fontSize: 13, opacity: 0.25, color: k.accent }}>{k.icon}</span>
            </div>
            <div style={{ fontFamily: '"JetBrains Mono", "Fira Code", monospace', fontSize: 22, fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.02em', lineHeight: 1, marginBottom: 6 }}>{k.val}</div>
            <div style={{ fontSize: 10, color: k.accent, opacity: 0.7, fontWeight: 500 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* ── GOOGLE CALENDAR EMBED ── */}
      <div className="calendar-container-wrapper">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Calendar</h2>
          {gcalUrl && (
            <div className="flex items-center gap-1.5">
              {/* Lock button */}
              <div className="relative" ref={lockPopoverRef}>
                {homeCalendarView.locked ? (
                  <button
                    type="button"
                    onClick={() => setShowLockPopover(v => !v)}
                    className="flex items-center gap-1.5 rounded-md border border-cyan-700 bg-cyan-900/30 px-2.5 py-1 text-[10px] font-semibold text-cyan-300 transition-colors hover:bg-cyan-900/50"
                  >
                    <Lock size={10} />
                    Locked {hourLabel(homeCalendarView.lockedStartHour)}–{hourLabel(homeCalendarView.lockedStartHour + 12)}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowLockPopover(v => !v)}
                    className="flex items-center gap-1.5 rounded-md border border-gray-800 bg-gray-900/40 px-2.5 py-1 text-[10px] font-semibold text-gray-400 transition-colors hover:border-gray-700 hover:text-gray-200"
                  >
                    <LockOpen size={10} />
                    Lock
                  </button>
                )}

                {showLockPopover && (
                  <div
                    className="absolute right-0 top-full mt-1.5 z-30 w-52 rounded-xl overflow-hidden"
                    style={{
                      background: 'linear-gradient(135deg, #16181f 0%, #1a1d28 100%)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      boxShadow: '0 0 0 1px rgba(0,0,0,0.5), 0 24px 48px rgba(0,0,0,0.65)',
                    }}
                  >
                    {/* Popover header */}
                    <div className="px-3.5 pt-3 pb-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <Lock size={10} className="text-cyan-400 opacity-80" />
                        <span className="text-[11px] font-semibold text-gray-200">Lock calendar view</span>
                      </div>
                      <p className="text-[9px] text-gray-500 leading-relaxed">Choose the 12-hour window to restore on reload.</p>
                    </div>

                    {/* Option rows */}
                    <div className="p-1.5 space-y-0.5">
                      {LOCK_START_HOURS.map(h => {
                        const isActive = homeCalendarView.locked && homeCalendarView.lockedStartHour === h
                        return (
                          <button
                            key={h}
                            type="button"
                            onClick={() => {
                              updateHomeCalendarView(v => ({ ...v, locked: true, lockedStartHour: h }))
                              setShowLockPopover(false)
                            }}
                            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 transition-all ${isActive ? '' : 'hover:bg-white/[0.04]'}`}
                            style={isActive ? {
                              background: 'rgba(6,182,212,0.08)',
                              border: '1px solid rgba(6,182,212,0.28)',
                            } : {
                              border: '1px solid transparent',
                            }}
                          >
                            <div className="text-left">
                              <div
                                className="text-[12px] font-semibold leading-tight"
                                style={{ color: isActive ? '#67e8f9' : '#d1d5db' }}
                              >
                                {hourLabel(h)} – {hourLabel(h + 12)}
                              </div>
                              <div className="text-[9px] text-gray-600 mt-0.5">12-hour workday view</div>
                            </div>
                            {isActive && (
                              <span
                                className="text-[8px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                                style={{ background: 'rgba(6,182,212,0.18)', color: '#67e8f9' }}
                              >
                                Active
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>

                    {/* Footer – unlock action when locked */}
                    {homeCalendarView.locked && (
                      <div className="px-1.5 pb-1.5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        <button
                          type="button"
                          onClick={() => {
                            updateHomeCalendarView(v => ({ ...v, locked: false }))
                            setShowLockPopover(false)
                          }}
                          className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-semibold text-gray-400 transition-colors hover:bg-white/[0.04] hover:text-gray-200"
                        >
                          <LockOpen size={10} />
                          Unlock view
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {/* Hide/Show button */}
              <button
                type="button"
                onClick={toggleHomeCalendarCollapsed}
                className="flex items-center gap-1.5 rounded-md border border-gray-800 bg-gray-900/40 px-2.5 py-1 text-[10px] font-semibold text-gray-400 transition-colors hover:border-gray-700 hover:text-gray-200"
                aria-expanded={!homeCalendarView.collapsed}
                aria-controls="home-google-calendar"
              >
                <ChevronRight size={12} className={`transition-transform ${homeCalendarView.collapsed ? '' : 'rotate-90'}`} />
                {homeCalendarView.collapsed ? 'Show' : 'Hide'}
              </button>
            </div>
          )}
        </div>
        {gcalUrl ? (
          <div className="rounded-xl border border-gray-800 bg-[var(--bg-card)] overflow-hidden">
            {!homeCalendarView.collapsed && (
              <>
                <div
                  id="home-google-calendar"
                  className={`relative w-full ${homeCalendarView.locked ? 'overflow-hidden' : 'overflow-visible'}`}
                  style={{ height: `${homeCalendarView.height}px`, minHeight: `${HOME_CALENDAR_MIN_HEIGHT}px` }}
                >
                  {homeCalendarView.locked ? (() => {
                    const { iframeHeight, topOffset } = calcLockOffset(homeCalendarView.height, homeCalendarView.lockedStartHour)
                    return (
                      <iframe
                        src={gcalUrl}
                        style={{
                          border: '0',
                          width: '100%',
                          height: `${iframeHeight}px`,
                          display: 'block',
                          pointerEvents: isCalendarResizing ? 'none' : 'auto',
                          marginTop: `-${topOffset}px`,
                        }}
                        className="bg-[var(--bg-secondary)] w-full"
                        title="Google Calendar"
                      />
                    )
                  })() : (
                    <iframe
                      src={gcalUrl}
                      style={{ border: '0', width: '100%', height: `${homeCalendarView.height}px`, minHeight: `${HOME_CALENDAR_MIN_HEIGHT}px`, display: 'block', pointerEvents: isCalendarResizing ? 'none' : 'auto' }}
                      className="bg-[var(--bg-secondary)] w-full"
                      title="Google Calendar"
                    />
                  )}
                  {isCalendarResizing && (
                    <div className="absolute inset-0 z-10 cursor-ns-resize bg-transparent" aria-hidden="true" />
                  )}
                </div>
                <button
                  type="button"
                  onPointerDown={startHomeCalendarResize}
                  onMouseDown={startHomeCalendarMouseResize}
                  className="group flex h-5 w-full cursor-ns-resize items-center justify-center border-t border-gray-800/70 bg-gray-900/30 transition-colors hover:bg-gray-800/50"
                  aria-label="Resize calendar"
                >
                  <span className="h-1 w-10 rounded-full bg-gray-700 transition-colors group-hover:bg-gray-500" />
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="p-6 bg-[var(--bg-card)] border border-gray-800 rounded-lg text-center">
            <div className="text-xs text-gray-500">No calendar configured</div>
            <div className="text-[9px] text-gray-500 mt-1">Add gcalUrl to settings to embed your Google Calendar</div>
          </div>
        )}
      </div>

      {/* ── JOB HEALTH CARDS ── */}
      {activeJobHealthProjects.length > 0 && (
        <div>
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Job Health</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {activeJobHealthProjects.map(p => (
              <ProjectCard
                key={p.id}
                p={p}
                backup={backup}
                bucket="active"
              />
            ))}
          </div>
        </div>
      )}

      {/* ── SERVICE JOBS REQUIRING ATTENTION ── */}
      {serviceJobsNeedingAttention.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Service Jobs Requiring Attention</h2>
            <div className="flex items-center gap-3 text-[9px] text-gray-500">
              <span><span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 mr-1 align-middle" />$1k+</span>
              <span><span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 mr-1 align-middle" />$500–1k</span>
              <span><span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-500 mr-1 align-middle" />&lt;$500</span>
            </div>
          </div>
          <div className="space-y-2">
            {serviceJobsNeedingAttention.map((l: any) => (
              <CollectionPriorityCard key={l.id} log={l} onMarkCollected={markServiceJobCollected} />
            ))}
          </div>
        </div>
      )}

      {/* ── AGENDA ALERTS ── */}
      <div>
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Alerts</h2>
        {mergedAlerts.length > 0 ? (
          <div className="space-y-2">
            {mergedAlerts.filter(m => m.type === 'ai').map((m) => {
              const a = m.data as typeof agendaAlerts[0]
              const i = m.idx
              const aiAlertId = 'ai-' + i
              const isEditing = editingAIAlertId === aiAlertId
              return (
                <div key={aiAlertId} className="flex items-start gap-2 p-3 bg-[var(--bg-card)] border border-gray-800 rounded-lg">
                  <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: a.clr }} />
                  {isEditing ? (
                    <input
                      autoFocus
                      type="text"
                      value={editAIAlertText}
                      onChange={(e) => setEditAIAlertText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          pushState(backup)
                          if (!backup.customAlerts) backup.customAlerts = []
                          const existing = backup.customAlerts.find(ca => ca.isAI && ca.manuallyEdited && ca.linkedProjectId === (a.id || ''))
                          if (existing) { existing.title = editAIAlertText } else {
                            backup.customAlerts.push({ id: 'ai2c_' + Date.now() + '_' + i, title: editAIAlertText, description: '', action: '', isAI: true, manuallyEdited: true, scheduledAt: '', linkedProjectId: a.id || '' })
                          }
                          persist(); forceUpdate(); setEditingAIAlertId(null); setEditAIAlertText('')
                        }
                      }}
                      onBlur={() => {
                        if (editingAIAlertId !== aiAlertId) return
                        if (editAIAlertText.trim()) {
                          pushState(backup)
                          if (!backup.customAlerts) backup.customAlerts = []
                          const existing = backup.customAlerts.find(ca => ca.isAI && ca.manuallyEdited && ca.linkedProjectId === (a.id || ''))
                          if (existing) { existing.title = editAIAlertText } else {
                            backup.customAlerts.push({ id: 'ai2c_' + Date.now() + '_' + i, title: editAIAlertText, description: '', action: '', isAI: true, manuallyEdited: true, scheduledAt: '', linkedProjectId: a.id || '' })
                          }
                          persist(); forceUpdate()
                        }
                        setEditingAIAlertId(null); setEditAIAlertText('')
                      }}
                      className="flex-1 bg-gray-900 border border-cyan-500/50 rounded px-2 py-1 text-gray-200 text-xs"
                    />
                  ) : (
                    <>
                      <button onClick={() => { setEditingAIAlertId(aiAlertId); setEditAIAlertText(a.txt) }} className="text-gray-500 hover:text-gray-300 mt-0.5 flex-shrink-0" title="Edit alert">
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
                    <button onClick={() => alert('AI analysis for this item coming soon.')} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-400 hover:text-gray-300 transition-colors flex items-center gap-0.5">
                      ✨ Ask AI
                    </button>
                  </div>
                </div>
              )
            })}

            {mergedAlerts.filter(m => m.type === 'custom').map((m) => m.data as typeof loadedCustomAlerts[0]).map((a) => (
              <div key={a.id}>
                {editingAlertId === a.id ? (
                  <div className="p-3 bg-[var(--bg-card)] border border-blue-500/50 rounded-lg space-y-2">
                    <input type="text" placeholder="Alert title" value={editingAlertData.title} onChange={(e) => setEditingAlertData({...editingAlertData, title: e.target.value})} className="w-full px-2 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded text-gray-200 placeholder-gray-600" />
                    <textarea placeholder="Description" value={editingAlertData.description} onChange={(e) => setEditingAlertData({...editingAlertData, description: e.target.value})} rows={2} className="w-full px-2 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded text-gray-200 placeholder-gray-600 resize-none" />
                    <input type="text" placeholder="Action (optional)" value={editingAlertData.action} onChange={(e) => setEditingAlertData({...editingAlertData, action: e.target.value})} className="w-full px-2 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded text-gray-200 placeholder-gray-600" />
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[9px] text-gray-500 mb-0.5 block">Schedule Push At</label>
                        <input type="datetime-local" value={editingAlertData.scheduledAt || ''} onChange={(e) => setEditingAlertData({...editingAlertData, scheduledAt: e.target.value})} className="w-full px-2 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded text-gray-200" />
                      </div>
                      <div>
                        <label className="text-[9px] text-gray-500 mb-0.5 block">Link to Project</label>
                        <select value={editingAlertData.linkedProjectId || ''} onChange={(e) => setEditingAlertData({...editingAlertData, linkedProjectId: e.target.value})} className="w-full px-2 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded text-gray-200">
                          <option value="">None</option>
                          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => saveAlert(a.id, editingAlertData, a.isAI)} className="flex-1 text-[10px] px-2 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 transition-colors font-semibold">Save</button>
                      <button onClick={() => {setEditingAlertId(null); setEditingAlertData({title: '', description: '', action: '', scheduledAt: '', linkedProjectId: ''})}} className="flex-1 text-[10px] px-2 py-1.5 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors font-semibold">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2 p-3 bg-[var(--bg-card)] border border-gray-800 rounded-lg">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="text-xs font-semibold text-gray-200">{a.title}</div>
                        {a.manuallyEdited ? (
                          <span className="text-[8px] px-1.5 py-0.5 rounded flex-shrink-0 bg-yellow-500/30 text-yellow-300">✎ Manual Edit</span>
                        ) : a.isAI ? (
                          <span className="text-[8px] px-1.5 py-0.5 rounded flex-shrink-0 bg-emerald-500/30 text-emerald-300">AI</span>
                        ) : null}
                      </div>
                      {a.description && <div className="text-[9px] text-gray-400 mt-1">{a.description}</div>}
                      {a.action && <div className="text-[9px] text-gray-500 mt-1">Action: {a.action}</div>}
                      {a.scheduledAt && <div className="text-[9px] text-blue-400 mt-1">Push: {new Date(a.scheduledAt).toLocaleString()}</div>}
                      {a.linkedProjectId && <div className="text-[9px] text-teal-400 mt-1">Project: {projects.find(p => p.id === a.linkedProjectId)?.name || a.linkedProjectId}</div>}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => startEditAlert(a)} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-400 hover:text-gray-300 transition-colors" title="Edit alert"><Edit3 size={10} className="inline" /></button>
                      <button onClick={() => dismissAlert(a.id)} className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors" title="Dismiss alert"><X size={10} className="inline" /></button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {addingAlert ? (
              <div className="p-3 bg-[var(--bg-card)] border border-blue-500/50 rounded-lg space-y-2">
                <input type="text" placeholder="Alert title" value={editingAlertData.title} onChange={(e) => setEditingAlertData({...editingAlertData, title: e.target.value})} className="w-full px-2 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded text-gray-200 placeholder-gray-600" />
                <textarea placeholder="Description" value={editingAlertData.description} onChange={(e) => setEditingAlertData({...editingAlertData, description: e.target.value})} rows={2} className="w-full px-2 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded text-gray-200 placeholder-gray-600 resize-none" />
                <input type="text" placeholder="Action (optional)" value={editingAlertData.action} onChange={(e) => setEditingAlertData({...editingAlertData, action: e.target.value})} className="w-full px-2 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded text-gray-200 placeholder-gray-600" />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[9px] text-gray-500 mb-0.5 block">Schedule Push At</label>
                    <input type="datetime-local" value={editingAlertData.scheduledAt || ''} onChange={(e) => setEditingAlertData({...editingAlertData, scheduledAt: e.target.value})} className="w-full px-2 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded text-gray-200" />
                  </div>
                  <div>
                    <label className="text-[9px] text-gray-500 mb-0.5 block">Link to Project</label>
                    <select value={editingAlertData.linkedProjectId || ''} onChange={(e) => setEditingAlertData({...editingAlertData, linkedProjectId: e.target.value})} className="w-full px-2 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded text-gray-200">
                      <option value="">None</option>
                      {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => saveAlert(null, editingAlertData, false)} className="flex-1 text-[10px] px-2 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 transition-colors font-semibold">Add Alert</button>
                  <button onClick={() => {setAddingAlert(false); setEditingAlertData({title: '', description: '', action: '', scheduledAt: '', linkedProjectId: ''})}} className="flex-1 text-[10px] px-2 py-1.5 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors font-semibold">Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => {setAddingAlert(true); setEditingAlertData({title: '', description: '', action: ''})}} className="w-full text-[10px] px-2 py-2 rounded border border-dashed border-gray-700 text-gray-400 hover:text-gray-300 hover:border-gray-600 transition-colors font-semibold">
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

      {/* ── AGENDA SECTIONS ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Agenda</h2>
          <button onClick={addAgendaCategory} className="text-[10px] px-2 py-1 rounded bg-gray-700/50 text-gray-400 hover:text-gray-300 transition-colors flex items-center gap-1">
            <Plus size={10} /> Sub-Category
          </button>
        </div>
        {(backup.agendaSections || []).length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {(backup.agendaSections || []).map(sec => {
              const AgendaIcon = getAgendaSectionIcon(sec.title, sec.projectId)
              return (
                <div key={sec.id} className="relative overflow-hidden rounded-xl border border-cyan-400/[0.18] bg-gradient-to-br from-slate-950 via-gray-950 to-black p-4 shadow-[0_14px_34px_rgba(8,145,178,0.08),inset_0_1px_0_rgba(255,255,255,0.05)]">
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_0%,rgba(34,211,238,0.08),transparent_30%),radial-gradient(circle_at_100%_100%,rgba(20,184,166,0.045),transparent_34%)]" />
                  <div className="pointer-events-none absolute inset-px rounded-[11px] border border-white/[0.035]" />
                  <div className="relative flex items-start justify-between gap-3 mb-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-cyan-300/[0.24] bg-cyan-400/[0.075] text-cyan-200 shadow-[0_0_16px_rgba(34,211,238,0.12),inset_0_1px_0_rgba(255,255,255,0.10)]">
                        <AgendaIcon size={17} strokeWidth={2.2} />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-slate-100">{sec.title}</div>
                        <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-100/[0.48]">
                          {getAgendaProjectName(backup, sec.projectId)} • {(sec.tasks || []).length} task{(sec.tasks || []).length === 1 ? '' : 's'}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 flex-wrap justify-end gap-1.5">
                      <button onClick={() => addAgendaTask(sec.id)} className="rounded-md border border-cyan-300/30 bg-cyan-500/[0.14] px-2 py-1 text-[9px] font-bold text-cyan-100 shadow-[0_0_10px_rgba(34,211,238,0.08)] transition-colors hover:bg-cyan-400/20">+ Task</button>
                      <button onClick={() => editAgendaCategory(sec.id)} className="rounded-md border border-white/[0.08] bg-white/[0.055] px-2 py-1 text-[9px] font-bold text-slate-300 transition-colors hover:bg-white/[0.10] hover:text-white">Edit</button>
                      <button onClick={() => removeAgendaCategory(sec.id)} className="rounded-md border border-red-400/[0.24] bg-red-500/[0.09] px-2 py-1 text-[9px] font-bold text-red-300 transition-colors hover:bg-red-500/[0.16] hover:text-red-200">Delete</button>
                    </div>
                  </div>
                  {(sec.tasks || []).length > 0 ? (
                    <div className="relative space-y-1.5">
                      {(sec.tasks || []).map((t: any) => (
                        <div key={t.id} className="group flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.035] px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
                          <div className="h-2 w-2 flex-shrink-0 rounded-full shadow-[0_0_7px_currentColor]" style={{ color: t.status === 'done' ? '#34d399' : t.status === 'declined' ? '#f87171' : t.status === 'postponed' ? '#94a3b8' : t.status === 'active' ? '#60a5fa' : '#facc15', background: 'currentColor' }} />
                          <div className={`min-w-0 flex-1 text-xs leading-snug ${t.status === 'done' ? 'line-through text-slate-500' : t.status === 'declined' ? 'line-through text-slate-500' : 'text-slate-200'}`}>{t.text}</div>
                          <div className="flex flex-shrink-0 items-center gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                            <button onClick={() => cycleAgendaTaskStatus(sec.id, t.id)} className="cursor-pointer">{agendaStatusChip(t.status)}</button>
                            <button onClick={() => editAgendaTask(sec.id, t.id)} className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[8px] font-semibold text-slate-400 hover:text-slate-200">Edit</button>
                            <button onClick={() => moveAgendaTask(sec.id, t.id)} className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[8px] font-semibold text-slate-400 hover:text-slate-200">Move</button>
                            <button onClick={() => removeAgendaTask(sec.id, t.id)} className="rounded bg-red-500/[0.08] px-1.5 py-0.5 text-[8px] font-semibold text-red-300 hover:text-red-200">✕</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="relative rounded-lg border border-dashed border-cyan-300/[0.18] bg-cyan-400/[0.035] px-3 py-5 text-center text-[10px] font-semibold text-cyan-100/[0.48] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">No tasks yet.</div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="p-4 bg-[var(--bg-card)] border border-gray-800 rounded-lg text-xs text-gray-500 text-center">
            Create a sub-category to start organizing today's agenda.
          </div>
        )}
      </div>

      {/* ── RECENT LOGS — tabbed ── */}
      <div>
        <div className="flex items-center gap-1 mb-3 p-1 rounded-lg bg-gray-900/60 border border-gray-800/60 w-fit">
          {(['projects', 'service'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setLogsTab(tab)}
              style={{
                fontSize: 11, fontWeight: 700, padding: '5px 14px', borderRadius: 6,
                border: 'none', cursor: 'pointer', letterSpacing: '0.04em', transition: 'all 0.15s',
                background: logsTab === tab ? (tab === 'projects' ? '#10b981' : '#f97316') : 'transparent',
                color: logsTab === tab ? '#fff' : '#6b7280',
              }}
            >
              {tab === 'projects' ? `Projects (${logs.length})` : `Service (${serviceLogs.length})`}
            </button>
          ))}
        </div>

        {logsTab === 'projects' && (
          recentLogs.length > 0 ? (
            <>
              <div className="rounded-xl border border-gray-800 bg-[var(--bg-card)] overflow-hidden">
                {(() => {
                  const rollCache: Record<string, any> = {}
                  const getRoll = (projId: string) => {
                    if (!rollCache[projId]) rollCache[projId] = buildProjectLogRollup(backup, projId)
                    return rollCache[projId]
                  }
                  return recentLogs.map((l: any, i: number) => {
                    const projId = l.projId || l.projectId || ''
                    const projRoll = getRoll(projId)
                    const rr = projRoll.byId[l.id] || {
                      entryLaborCost: num(l.hrs) * (num(backup.settings?.billRate) || 95),
                      entryMaterialCost: num(l.mat),
                      entryMileageCost: num(l.miles) * (num(backup.settings?.mileRate) || 0.67),
                      entryTotalCost: 0,
                      remainingAfter: projRoll.quote,
                    }
                    const entryRevenue = rr.entryLaborCost
                    const entryExpenses = rr.entryMaterialCost + rr.entryMileageCost
                    const runningBalance = num(rr.remainingAfter)
                    const balanceColor = getBalanceColor(runningBalance, projRoll.quote)
                    const entryMiCost = rr.entryMileageCost
                    const entryTotal = rr.entryTotalCost
                    const hasPay = num(l.collected) > 0
                    const entryTotalStats = [
                      { label: 'Labor', amount: fmt(num(entryRevenue)), Icon: Timer, color: '#e5e7eb', bg: 'rgba(229,231,235,0.06)', border: 'rgba(229,231,235,0.16)' },
                      { label: 'Material', amount: fmt(num(l.mat)), Icon: Boxes, color: '#fcd34d', bg: 'rgba(252,211,77,0.08)', border: 'rgba(252,211,77,0.22)' },
                      { label: 'Mileage', amount: fmt(num(entryMiCost)), Icon: Route, color: '#67e8f9', bg: 'rgba(103,232,249,0.08)', border: 'rgba(103,232,249,0.24)' },
                      { label: 'Total', amount: fmt(num(entryTotal)), Icon: CircleDollarSign, color: '#f87171', bg: 'rgba(248,113,113,0.11)', border: 'rgba(248,113,113,0.34)', featured: true },
                    ]
                    return (
                      <div key={l.id || i} className={`px-4 py-2.5 ${i < recentLogs.length - 1 ? 'border-b border-gray-800/50' : ''}`}>
                        <div
                          className="rounded-lg border border-gray-800 bg-[var(--bg-card)] p-3"
                          style={hasPay ? { background: 'linear-gradient(180deg, rgba(48,209,88,.10), rgba(48,209,88,.04))', borderLeft: '3px solid #10b981' } : { borderLeft: '3px solid #10b981' }}
                        >
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0 w-full space-y-2.5 lg:flex-[1_1_calc(100%-410px)]">
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                                <span className="rounded-md border border-cyan-300/10 bg-cyan-400/[0.04] px-2 py-1 font-mono text-[10px] font-semibold text-cyan-100/70">
                                  {l.date}
                                </span>
                                <span className="min-w-0 text-[15px] font-extrabold leading-tight text-white">
                                  {l.projName}
                                </span>
                                <span className="h-1 w-1 rounded-full bg-cyan-300/35" />
                                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-300/80">{l.phase}</span>
                                <span className="text-[11px] font-semibold text-slate-400">{l.emp || 'Me'}</span>
                                {hasPay && <span className="rounded-full border border-emerald-400/20 bg-emerald-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-emerald-300">Collected</span>}
                              </div>
                              {l.notes && <div className="w-full text-[12px] font-medium leading-relaxed text-white">{l.notes}</div>}
                              <div className="flex max-w-full flex-wrap gap-2">
                                <div className="w-[96px] rounded-md border border-white/[0.06] bg-white/[0.025] px-2.5 py-2">
                                  <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-500">Hrs</div>
                                  <div className="mt-0.5 font-mono text-[12px] font-bold leading-none text-slate-100">{num(l.hrs).toFixed(1)}</div>
                                </div>
                                <div className="w-[122px] rounded-md border border-amber-300/[0.12] bg-amber-400/[0.025] px-2.5 py-2">
                                  <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-500">Mat</div>
                                  <div className="mt-0.5 font-mono text-[12px] font-bold leading-none" style={{ color: '#fcd34d' }}>{fmt(num(l.mat))}</div>
                                </div>
                                <div className="w-[98px] rounded-md border border-cyan-300/[0.10] bg-cyan-400/[0.025] px-2.5 py-2">
                                  <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-500">Miles</div>
                                  <div className="mt-0.5 font-mono text-[12px] font-bold leading-none" style={{ color: '#60a5fa' }}>{num(l.miles)}</div>
                                </div>
                                <div className="w-[132px] rounded-md border border-emerald-300/[0.12] bg-emerald-400/[0.025] px-2.5 py-2">
                                  <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-500">Coll</div>
                                  <div className="mt-0.5 font-mono text-[12px] font-bold leading-none" style={{ color: '#6ee7b7' }}>{fmt(num(l.collected))}</div>
                                </div>
                                <div className="w-[154px] rounded-md border border-cyan-200/[0.14] bg-slate-950/20 px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                                  <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-400">Remaining</div>
                                  <div className="mt-0.5 font-mono text-[13px] font-extrabold leading-none" style={{ color: balanceColor }}>{fmt(runningBalance)}</div>
                                </div>
                              </div>
                            </div>
                            <div className="ml-auto flex w-full flex-wrap justify-end gap-2 lg:w-auto lg:min-w-[390px] lg:flex-none">
                              {entryTotalStats.map(({ label, amount, Icon, color, bg, border, featured }) => (
                                <div
                                  key={label}
                                  className={`rounded-lg border text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${featured ? 'min-w-[118px] bg-red-950/10 px-3 py-2.5' : 'min-w-[78px] bg-slate-950/20 px-2.5 py-2'}`}
                                  style={{ borderColor: border, boxShadow: featured ? `inset 0 1px 0 rgba(255,255,255,0.05), 0 0 18px ${bg}` : undefined }}
                                >
                                  <div
                                    className={`mx-auto mb-1 flex items-center justify-center rounded-md border ${featured ? 'h-7 w-7' : 'h-6 w-6'}`}
                                    style={{ color, background: bg, borderColor: border }}
                                  >
                                    <Icon size={featured ? 15 : 13} strokeWidth={2} />
                                  </div>
                                  <div className={`${featured ? 'text-[9px]' : 'text-[8px]'} font-bold uppercase tracking-[0.12em] text-gray-400`}>{label}</div>
                                  <div className={`mt-0.5 font-mono font-extrabold leading-tight ${featured ? 'text-[15px]' : 'text-[12px]'}`} style={{ color }}>
                                    {amount}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-md border border-white/[0.06] bg-slate-950/20 px-3 py-1.5 text-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                            <span className="inline-flex items-baseline gap-1.5">
                              <span className="font-medium text-slate-500">Cum Hours</span>
                              <span className="font-mono font-medium text-slate-300">{num(rr.cumHours).toFixed(1)}h</span>
                            </span>
                            <span className="inline-flex items-baseline gap-1.5">
                              <span className="font-medium text-slate-500">Cum Mat</span>
                              <span className="font-mono font-medium" style={{ color: '#fcd34d' }}>{fmt(num(rr.cumMaterialCost))}</span>
                            </span>
                            <span className="inline-flex items-baseline gap-1.5">
                              <span className="font-medium text-slate-500">Cum Collected</span>
                              <span className="font-mono font-medium text-emerald-400">{fmt(num(rr.cumCollected))}</span>
                            </span>
                            <span className="inline-flex items-baseline gap-1.5">
                              <span className="font-medium text-slate-500">Cum Cost</span>
                              <span className="font-mono font-medium text-red-400">{fmt(num(rr.cumTotalCost))}</span>
                            </span>
                          </div>
                          <span className="inline-flex items-baseline gap-1.5">
                            <span className="font-medium text-slate-400">Net</span>
                            <span className="font-mono font-semibold" style={{ color: balanceColor }}>{fmt(runningBalance)}</span>
                          </span>
                        </div>
                      </div>
                    )
                  })
                })()}
              </div>
              {hasMoreLogs ? (
                <button onClick={() => setLogsVisible(v => v + LOGS_PAGE)} className="w-full mt-2 py-2 text-xs font-semibold text-emerald-400 bg-emerald-900/10 border border-emerald-900/30 rounded-lg hover:bg-emerald-900/20 transition-colors">
                  View More — {Math.min(LOGS_PAGE, allLogsReversed.length - logsVisible)} of {allLogsReversed.length - logsVisible} remaining
                </button>
              ) : (
                <div className="mt-2 text-center text-[10px] text-gray-600">All {allLogsReversed.length} {allLogsReversed.length === 1 ? 'entry' : 'entries'} shown</div>
              )}
            </>
          ) : (
            <div className="p-4 bg-[var(--bg-card)] border border-gray-800 rounded-lg text-xs text-gray-500 text-center">No project logs yet.</div>
          )
        )}

        {logsTab === 'service' && (() => {
          const allSvcReversed = [...serviceLogs].reverse()
          const recentSvcLogs = allSvcReversed.slice(0, svcLogsVisible)
          const hasMoreSvcLogs = allSvcReversed.length > svcLogsVisible
          if (recentSvcLogs.length === 0) {
            return <div className="p-4 bg-[var(--bg-card)] border border-gray-800 rounded-lg text-xs text-gray-500 text-center">No service logs yet.</div>
          }
          return (
            <>
            <div className="rounded-xl border border-gray-800 bg-[var(--bg-card)] overflow-hidden">
                            {recentSvcLogs.map((l: any, i: number) => {
                const roll = getServiceRollup(l)
                const balance = getServiceBalanceDue(l)
                const fullyPaid = balance <= 0.009 && roll.totalBillable > 0
                const partial = !fullyPaid && roll.collected > 0.009
                const status = fullyPaid ? 'Y' : (partial ? 'P' : 'N')
                return (
                  <div key={l.id || i} className={`px-4 py-2.5 ${i < recentSvcLogs.length - 1 ? 'border-b border-gray-800/50' : ''}`}>
                    <div className="rounded-lg border border-gray-800 bg-[var(--bg-card)] p-3 space-y-2" style={{ borderLeft: '3px solid #f97316' }}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-semibold text-gray-200">{l.customer}</span>
                            <span className="text-[10px] text-gray-500">{l.jtype}</span>
                            <span className="text-[10px] text-gray-500">{l.date}</span>
                            <span
                              className={`text-[9px] px-2 py-0.5 rounded font-bold ${
                                status === 'Y' ? 'bg-emerald-500/20 text-emerald-400' :
                                status === 'P' ? 'bg-orange-500/20 text-orange-400' :
                                'bg-red-500/20 text-red-400'
                              }`}
                            >
                              {status === 'Y' ? 'Paid' : status === 'P' ? 'Partial' : 'Unpaid'}
                            </span>
                          </div>
                          {l.address && <div className="text-[10px] text-gray-500 mt-1">{l.address}</div>}
                          {l.notes && <div className="text-[10px] text-gray-500 mt-1">{l.notes}</div>}
                        </div>
                        <div className="text-right text-[10px]" style={{ minWidth: '160px' }}>
                          <div className="font-mono font-bold" style={{ color: '#f7f8ef', fontSize: '12px', marginBottom: '4px' }}>
                            {fmt(roll.totalBillable)} quote
                          </div>
                          <div className="font-mono" style={{ color: '#e5e7eb' }}>
                            {num(roll.hrs).toFixed(1)}h x ${num(roll.opCost).toFixed(2)} = <span style={{ fontWeight: 700, color: '#f87171' }}>{fmt(roll.laborCost)} lab</span>
                          </div>
                          <div className="font-mono" style={{ color: '#fcd34d' }}>
                            <span style={{ fontWeight: 700 }}>{fmt(roll.matCost)}</span> mat
                          </div>
                          <div className="font-mono" style={{ color: '#e5e7eb' }}>
                            {num(roll.miles)}mi x ${num(roll.mileRate).toFixed(2)} = <span style={{ fontWeight: 700, color: '#60a5fa' }}>{fmt(roll.mileCost)} mi</span>
                          </div>
                        </div>
                      </div>
                      <div className="bg-[var(--bg-input)] rounded px-2 py-2 text-[10px] space-y-1.5" style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Base Quote:</span>
                          <span className="font-mono text-gray-300 font-semibold">{fmt(roll.baseQuoted)}</span>
                        </div>
                        <div className="flex justify-between font-bold border-t border-gray-700 pt-1.5" style={{ color: '#f7f8ef', fontSize: '11px' }}>
                          <span>Total Billable:</span>
                          <span className="font-mono">{fmt(roll.totalBillable)}</span>
                        </div>
                        <div className="flex justify-between font-bold border-t border-gray-700 pt-1.5" style={{ fontSize: '11px' }}>
                          <span className="text-gray-400">Total Cost:</span>
                          <span className="font-mono" style={{ color: '#f87171' }}>{fmt(roll.totalActual)}</span>
                        </div>
                        <div className="flex justify-between border-t border-gray-700 pt-1.5" style={{ fontSize: '11px' }}>
                          <span className="text-gray-400">Cash Real Margin:</span>
                          <span className="font-mono font-bold" style={{ color: roll.projectedProfit >= 0 ? '#1D9E75' : '#E24B4A' }}>{fmt(roll.projectedProfit)}</span>
                        </div>
                        <div className="flex justify-between" style={{ fontSize: '11px' }}>
                          <span className="text-gray-400">Collected:</span>
                          <span className="font-mono font-bold text-emerald-400">{fmt(roll.collected)}</span>
                        </div>
                        <div className="flex justify-between" style={{ fontSize: '11px' }}>
                          <span className="text-gray-400">Balance Due:</span>
                          <span className="font-mono font-bold" style={{ color: balance > 0.009 ? '#ef4444' : '#10b981' }}>{fmt(balance)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            {hasMoreSvcLogs ? (
              <button onClick={() => setSvcLogsVisible(v => v + SVC_LOGS_PAGE)} className="w-full mt-2 py-2 text-xs font-semibold text-orange-400 bg-orange-900/10 border border-orange-900/30 rounded-lg hover:bg-orange-900/20 transition-colors">
                View More — {Math.min(SVC_LOGS_PAGE, allSvcReversed.length - svcLogsVisible)} of {allSvcReversed.length - svcLogsVisible} remaining
              </button>
            ) : (
              <div className="mt-2 text-center text-[10px] text-gray-600">All {allSvcReversed.length} {allSvcReversed.length === 1 ? 'entry' : 'entries'} shown</div>
            )}
          </>
          )
        })()}
      </div>

      {/* ── Daily Motivation Card ── */}
      {!isDemoMode && (
        <div style={{ borderLeft: '3px solid #1D9E75', backgroundColor: '#1e2235', borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>{_motivGreeting}</div>
          <div style={{ fontSize: 16, color: '#f9fafb', fontStyle: 'italic', fontWeight: 400, marginBottom: 6 }}>{_motivPhrase.quote}</div>
          <div style={{ fontSize: 12, color: '#1D9E75', marginBottom: 10 }}>{_motivPhrase.attr}</div>
          <div style={{ fontSize: 13, color: '#EF9F27', fontWeight: 500 }}>{_motivFireLine}</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
            <div style={{ fontSize: 11, color: '#6b7280', cursor: 'pointer' }} onClick={() => { setAiInput(`Who said this? ${_motivFullQuote}`); setAiPanelOpen(true) }}>
              Ask NEXUS who said this →
            </div>
            <button
              onClick={() => setQuoteOffset(o => (o + 1) % MOTIVATION_PHRASES.length)}
              title="Next quote"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4b5563', opacity: 0.6, padding: '2px 4px', display: 'flex', alignItems: 'center', transition: 'opacity 0.15s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0.6' }}
            >
              <RefreshCw size={13} />
            </button>
          </div>
        </div>
      )}

      </div>
  )
}



