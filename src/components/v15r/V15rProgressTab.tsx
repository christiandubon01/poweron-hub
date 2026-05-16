// @ts-nocheck
import React, { useState, useCallback, useRef, useEffect } from 'react'
import { getBackupData, saveBackupDataAndSync, num, daysSince, getPhaseWeights } from '@/services/backupDataService'
import { pushState } from '@/services/undoRedoService'
import {
  loadInnerProjectViewPrefs,
  mergeInnerProjectViewPrefs,
  removeProgressPhaseViewKeys,
  phaseExpandedFromCollapsedPhases,
} from '@/utils/v15rViewPrefs'
import {
  getProjectPhaseNames,
  getLegacyPhaseNames,
  normalizePhaseName,
  isKnownProjectPhase,
} from '@/utils/v15rProjectPhases'

function parseDateLocal(dateStr?: string): Date | null {
  if (!dateStr) return null
  const d = new Date(dateStr + 'T00:00:00')
  return isNaN(d.getTime()) ? null : d
}

function fmtDateShort(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

interface V15rProgressTabProps {
  projectId: string
  onUpdate?: () => void
  backup?: any
}

/** Fallback header colors when user has not picked a color for this phase */
const DEFAULT_HEADER_COLORS: Record<string, string> = {
  Demo: '#6366f1',
  Underground: '#78716c',
  'Rough In': '#10b981',
  Trim: '#f97316',
  Finish: '#a855f7',
  Estimating: '#3b82f6',
  Planning: '#06b6d4',
  'Site Prep': '#f59e0b',
  'Rough-in': '#10b981',
}

const CUSTOM_PHASE_PALETTE = ['#f97316', '#84cc16', '#22d3ee', '#e879f9', '#fb7185', '#a3e635']
const MOVEMENT_TIMESTAMP_FIELDS = ['createdAt', 'updatedAt', 'date', 'logDate', 'timestamp']
const MOVEMENT_TIMESTAMP_ALIASES = ['created_at', 'updated_at', 'log_date']

function customPhaseColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return CUSTOM_PHASE_PALETTE[h % CUSTOM_PHASE_PALETTE.length]
}

/** #rrggbb for <input type="color"> */
function normalizeColorPickerValue(hex: string | undefined): string {
  if (!hex || typeof hex !== 'string') return '#64748b'
  let s = hex.trim()
  if (!s.startsWith('#')) s = '#' + s
  if (s.length === 4 && /^#[0-9a-fA-F]{3}$/.test(s)) {
    const r = s[1], g = s[2], b = s[3]
    s = `#${r}${r}${g}${g}${b}${b}`
  }
  if (s.length === 7 && /^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase()
  return '#64748b'
}

function resolvePhaseHeaderColor(
  ph: string,
  saved: Record<string, string> | undefined
): string {
  const raw = saved?.[ph]
  if (raw && typeof raw === 'string' && /^#?[0-9a-fA-F]{3,6}$/.test(raw.trim())) {
    return normalizeColorPickerValue(raw)
  }
  return normalizeColorPickerValue(DEFAULT_HEADER_COLORS[ph] || customPhaseColor(ph))
}

/** Simple average of task pct values; 0 when there are no tasks */
function tasksForPhase(project: any, ph: string, phases: string[]): any[] {
  const buckets = project?.tasks || {}
  return Object.entries(buckets).flatMap(([key, rows]: [string, any]) => {
    if (normalizePhaseName(key, phases) !== ph) return []
    return (Array.isArray(rows) ? rows : []).map((task: any) => ({
      ...task,
      __phaseKey: key,
    }))
  })
}

function computedPhaseProgressFromTasks(project: any, ph: string, phases: string[]): number {
  const tasks = tasksForPhase(project, ph, phases)
  if (!tasks.length) return 0
  const sum = tasks.reduce((s: number, t: any) => s + num(t?.pct ?? 0), 0)
  return Math.min(100, Math.max(0, Math.round(sum / tasks.length)))
}

function isProgressPhaseManualOverride(
  project: any,
  ph: string,
  lsOverride?: Record<string, boolean>,
): boolean {
  if (lsOverride != null && Object.prototype.hasOwnProperty.call(lsOverride, ph)) {
    return lsOverride[ph] === true
  }
  return project.progressPhaseOverrideEnabled?.[ph] === true
}

/** Header / rollup: manual stored value only when override toggle is explicitly on; otherwise task average */
function effectivePhaseProgressPct(
  project: any,
  ph: string,
  phases: string[],
  lsOverride?: Record<string, boolean>,
): number {
  if (isProgressPhaseManualOverride(project, ph, lsOverride)) {
    const raw = (project.phases || {})[ph]
    return Math.min(100, Math.max(0, num(raw ?? 0)))
  }
  return computedPhaseProgressFromTasks(project, ph, phases)
}

function phaseWeightFor(ph: string, weights: Record<string, number>, fallbackWeight: number): number {
  if (Object.prototype.hasOwnProperty.call(weights || {}, ph)) {
    return Math.max(0, num(weights[ph]))
  }
  return Math.max(0, fallbackWeight)
}

function formatPhaseWeight(wt: number): string {
  return Number.isInteger(wt) ? String(wt) : wt.toFixed(1).replace(/\.0$/, '')
}

function weightedOverallCompletion(
  project: any,
  weights: Record<string, number>,
  phases: string[],
  lsOverride?: Record<string, boolean>,
): number {
  if (phases.length === 0) return 0
  const fallbackWeight = 100 / phases.length
  const weighted = phases.reduce((sum, ph) => {
    const phaseProgress = effectivePhaseProgressPct(project, ph, phases, lsOverride)
    const phaseWeight = phaseWeightFor(ph, weights, fallbackWeight)
    return sum + (phaseProgress * phaseWeight)
  }, 0)
  const totalWeight = phases.reduce(
    (sum, ph) => sum + phaseWeightFor(ph, weights, fallbackWeight),
    0,
  )
  if (totalWeight <= 0) return 0
  return Math.round(Math.min(100, Math.max(0, weighted / totalWeight)))
}

function normalizeMatchValue(value: any): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function projectLogMatchesProject(log: any, project: any): boolean {
  if (!log || !project) return false
  const projectId = normalizeMatchValue(project.id)
  const directIds = [
    log.projId,
    log.projectId,
    log.project_id,
    log.activeProject,
  ].map(normalizeMatchValue).filter(Boolean)
  if (projectId && directIds.includes(projectId)) return true

  const projectName = normalizeMatchValue(project.name || project.jobName)
  if (!projectName) return false
  const nameFields = [
    log.projName,
    log.projectName,
    log.project_name,
    log.jobName,
    log.job_name,
    log.activeProject,
  ].map(normalizeMatchValue).filter(Boolean)
  return nameFields.includes(projectName)
}

function isArchivedOrDeletedLog(log: any): boolean {
  if (!log) return true
  if (log.archived === true || log.isArchived === true || log.deleted === true || log.isDeleted === true) return true
  if (log.archivedAt || log.deletedAt) return true
  const status = normalizeMatchValue(log.status || log.logStatus)
  return ['archived', 'deleted', 'void'].includes(status)
}

function movementLogDate(log: any): Date | null {
  const fields = [...MOVEMENT_TIMESTAMP_FIELDS, ...MOVEMENT_TIMESTAMP_ALIASES]
  for (const field of fields) {
    const raw = log?.[field]
    if (!raw) continue
    const d = field === 'date' || field === 'logDate' || field === 'log_date'
      ? parseDateLocal(String(raw).slice(0, 10))
      : new Date(raw)
    if (d && !isNaN(d.getTime())) return d
  }
  return null
}

function movementLogsForProject(backup: any, project: any): any[] {
  const sources = [
    ...(Array.isArray(backup?.logs) ? backup.logs : []),
    ...(Array.isArray(backup?.fieldLogs) ? backup.fieldLogs : []),
    ...(Array.isArray(backup?.field_logs) ? backup.field_logs : []),
    ...(Array.isArray(backup?.fieldObservationCards) ? backup.fieldObservationCards : []),
  ]
  return sources.filter(log => !isArchivedOrDeletedLog(log) && projectLogMatchesProject(log, project))
}

const PHASE_COLOR_DEBOUNCE_MS = 220

const taskRowGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(260px, 38%) 90px 24px',
  alignItems: 'center',
  gap: '12px',
}

const taskRowCell: React.CSSProperties = {
  minWidth: 0,
}

export default function V15rProgressTab({ projectId, onUpdate, backup: initialBackup }: V15rProgressTabProps) {
  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])

  const [addingPhase, setAddingPhase] = useState(false)
  const [newPhaseName, setNewPhaseName] = useState('')

  /** false = collapsed; missing or true = expanded */
  const [phaseExpanded, setPhaseExpanded] = useState<Record<string, boolean>>(() =>
    phaseExpandedFromCollapsedPhases(loadInnerProjectViewPrefs(projectId).progress?.collapsedPhases),
  )

  useEffect(() => {
    setPhaseExpanded(
      phaseExpandedFromCollapsedPhases(loadInnerProjectViewPrefs(projectId).progress?.collapsedPhases),
    )
  }, [projectId])

  const dragInfo = useRef<{ ph: string; id: string } | null>(null)
  const dragOverId = useRef<string | null>(null)
  const [dragActive, setDragActive] = useState<string | null>(null)

  /** In-memory color during native picker interaction; persists after debounce / blur / pointer-up */
  const [phaseColorDraft, setPhaseColorDraft] = useState<Record<string, string>>({})
  const phaseColorDraftRef = useRef<Record<string, string>>({})
  const phaseColorCommitTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => {
    const timers = phaseColorCommitTimersRef.current
    return () => {
      Object.values(timers).forEach(t => clearTimeout(t))
    }
  }, [])

  const backup = initialBackup || getBackupData()
  if (!backup) return <div style={{ color: 'var(--t3)' }}>No data</div>

  const p = backup.projects.find(x => x.id === projectId)
  if (!p) return <div style={{ color: 'var(--t3)' }}>Project not found</div>

  const innerViewPrefs = loadInnerProjectViewPrefs(projectId)

  const w = getPhaseWeights(backup)
  const settingsPhases = getProjectPhaseNames(backup)
  const movementLogs = movementLogsForProject(backup, p)
  const movementDates = movementLogs
    .map(movementLogDate)
    .filter(Boolean)
    .sort((a: Date, b: Date) => b.getTime() - a.getTime())
  const lastMovementDate = movementDates[0] || null
  const daysSinceMove = lastMovementDate ? daysSince(lastMovementDate.toISOString()) : null

  const persistProjectChange = (
    mutate: (project: any, currentBackup: any) => false | void,
  ): boolean => {
    const currentBackup = initialBackup ?? getBackupData()
    const project = currentBackup?.projects?.find((x: any) => x.id === projectId)
    if (!currentBackup || !project) return false
    const result = mutate(project, currentBackup)
    if (result === false) return false
    saveBackupDataAndSync(currentBackup, 'projects')
    onUpdate?.()
    forceUpdate()
    return true
  }

  const missingPhaseFallbackWeight = settingsPhases.length > 0 ? 100 / settingsPhases.length : 0
  const settingsPhaseEntries: [string, number][] = settingsPhases.map(ph => [
    ph,
    phaseWeightFor(ph, w, missingPhaseFallbackWeight),
  ])

  const legacyProgressPhases = getLegacyPhaseNames([
    ...Object.keys(p.tasks || {}),
    ...Object.keys(p.phases || {}),
    ...(p.customPhases || []),
  ], settingsPhases)
  const orderedPhaseEntries = [
    ...settingsPhaseEntries.map(([ph, wt]) => [ph, wt, false] as [string, number, boolean]),
    ...legacyProgressPhases.map(ph => [ph, 0, true] as [string, number, boolean]),
  ]

  const togglePhaseBucket = (ph: string) => {
    setPhaseExpanded(prev => {
      const wasOpen = prev[ph] !== false
      const nowOpen = !wasOpen
      mergeInnerProjectViewPrefs(projectId, {
        progress: { collapsedPhases: { [ph]: !nowOpen } },
      })
      return { ...prev, [ph]: nowOpen }
    })
  }

  const persistProgressPhaseColor = (ph: string, rawHex: string) => {
    const hex = normalizeColorPickerValue(rawHex)
    pushState()
    persistProjectChange(proj => {
      const prev = proj.progressPhaseColors?.[ph]
      const prevNorm = prev ? normalizeColorPickerValue(prev) : null
      if (prevNorm === hex) return false
      if (!proj.progressPhaseColors) proj.progressPhaseColors = {}
      proj.progressPhaseColors[ph] = hex
    })
  }

  const clearPhaseColorDebounceTimer = (ph: string) => {
    const t = phaseColorCommitTimersRef.current[ph]
    if (t) clearTimeout(t)
    delete phaseColorCommitTimersRef.current[ph]
  }

  /** Schedule disk persist; avoids saveBackupData on every pointer move inside the picker */
  const scheduleProgressPhaseColorCommit = (ph: string, rawHex: string) => {
    const hex = normalizeColorPickerValue(rawHex)
    phaseColorDraftRef.current[ph] = hex
    setPhaseColorDraft(d => (d[ph] === hex ? d : { ...d, [ph]: hex }))
    clearPhaseColorDebounceTimer(ph)
    phaseColorCommitTimersRef.current[ph] = setTimeout(() => {
      persistProgressPhaseColor(ph, phaseColorDraftRef.current[ph] ?? hex)
      delete phaseColorDraftRef.current[ph]
      delete phaseColorCommitTimersRef.current[ph]
      setPhaseColorDraft(d => {
        if (d[ph] === undefined) return d
        const next = { ...d }
        delete next[ph]
        return next
      })
    }, PHASE_COLOR_DEBOUNCE_MS)
  }

  const flushProgressPhaseColor = (ph: string) => {
    clearPhaseColorDebounceTimer(ph)
    const hex = phaseColorDraftRef.current[ph]
    if (hex !== undefined) persistProgressPhaseColor(ph, hex)
    delete phaseColorDraftRef.current[ph]
    setPhaseColorDraft(d => {
      if (d[ph] === undefined) return d
      const next = { ...d }
      delete next[ph]
      return next
    })
  }

  const stagnancyColor = () => {
    if (daysSinceMove == null) return '#94a3b8'
    if (daysSinceMove < 7) return '#10b981'
    if (daysSinceMove < 14) return '#f59e0b'
    return '#ef4444'
  }

  const stagnancyLabel = () => {
    if (daysSinceMove == null) return 'No movement logged'
    if (daysSinceMove < 7) return 'Active'
    if (daysSinceMove < 14) return 'Check-in'
    return 'Call now'
  }

  const editTask = (ph, taskId, field, value) => {
    pushState()
    persistProjectChange(proj => {
      const tasks = (proj.tasks || {})[ph] || []
      const task = tasks.find(t => t.id === taskId)
      if (!task) return false
      if (field === 'desc') task.desc = String(value)
      else if (field === 'hrs') task.hrs = num(value)
      else if (field === 'pct') task.pct = Math.min(100, Math.max(0, num(value)))
    })
  }

  const addTask = (ph) => {
    pushState()
    persistProjectChange(proj => {
      if (!proj.tasks) proj.tasks = {}
      if (!proj.tasks[ph]) proj.tasks[ph] = []
      proj.tasks[ph].push({
        id: 'tsk' + Date.now(),
        desc: 'New task',
        hrs: 0,
        pct: 0,
      })
    })
  }

  const delTask = (ph, taskId) => {
    pushState()
    persistProjectChange(proj => {
      if (!proj.tasks?.[ph]) return false
      proj.tasks[ph] = proj.tasks[ph].filter(t => t.id !== taskId)
    })
  }

  const overridePhase = (ph, value) => {
    pushState()
    persistProjectChange(proj => {
      proj.phases = proj.phases || {}
      proj.phases[ph] = Math.min(100, Math.max(0, num(value)))
      proj.lastMove = new Date().toISOString()
    })
  }

  const setPhaseProgressOverrideEnabled = (ph: string, enabled: boolean) => {
    pushState()
    persistProjectChange(proj => {
      if (!proj.progressPhaseOverrideEnabled) proj.progressPhaseOverrideEnabled = {}
      proj.progressPhaseOverrideEnabled[ph] = !!enabled
    })
    mergeInnerProjectViewPrefs(projectId, {
      progress: { overrideEnabled: { [ph]: !!enabled } },
    })
  }

  const confirmAddCustomPhase = () => {
    const trimmed = newPhaseName.trim()
    if (!trimmed) return
    if (isKnownProjectPhase(trimmed, settingsPhases)) {
      alert(`Phase "${trimmed}" already exists.`)
      return
    }
    pushState()
    persistProjectChange((proj, currentBackup) => {
      if (!currentBackup.settings) currentBackup.settings = {}
      if (!currentBackup.settings.phaseWeights) currentBackup.settings.phaseWeights = {}
      if (!currentBackup.settings.mtoPhases) currentBackup.settings.mtoPhases = []
      currentBackup.settings.mtoPhases = [...settingsPhases, trimmed]
      currentBackup.settings.phaseWeights[trimmed] = 0
      if (!proj.phases) proj.phases = {}
      if (!proj.tasks) proj.tasks = {}
      if (!proj.progressPhaseOverrideEnabled) proj.progressPhaseOverrideEnabled = {}
      proj.progressPhaseOverrideEnabled[trimmed] = false
      proj.phases[trimmed] = 0
      if (!proj.tasks[trimmed]) proj.tasks[trimmed] = []
    })
    setNewPhaseName('')
    setAddingPhase(false)
  }

  const deleteCustomPhase = (ph: string) => {
    const tasks = (p.tasks || {})[ph] || []
    if (tasks.length > 0) {
      const ok = window.confirm(
        `Phase "${ph}" has ${tasks.length} task${tasks.length !== 1 ? 's' : ''}. Delete the phase and all its tasks?`
      )
      if (!ok) return
    }
    pushState()
    persistProjectChange(proj => {
      if (proj.customPhases) proj.customPhases = proj.customPhases.filter(x => x !== ph)
      if (proj.phases) delete proj.phases[ph]
      if (proj.tasks) delete proj.tasks[ph]
      if (proj.progressPhaseColors) delete proj.progressPhaseColors[ph]
      if (proj.progressPhaseOverrideEnabled) delete proj.progressPhaseOverrideEnabled[ph]
    })
    removeProgressPhaseViewKeys(projectId, ph)
  }

  const onDragStart = (ph: string, taskId: string, e: React.DragEvent) => {
    dragInfo.current = { ph, id: taskId }
    setDragActive(taskId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', taskId)
  }

  const onDragOver = (e: React.DragEvent, taskId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    dragOverId.current = taskId
  }

  const onDrop = (ph: string, dropTaskId: string, e: React.DragEvent) => {
    e.preventDefault()
    const info = dragInfo.current
    if (!info || info.ph !== ph || info.id === dropTaskId) {
      dragInfo.current = null
      setDragActive(null)
      return
    }
    const tasks = [...((p.tasks || {})[ph] || [])]
    const fromIdx = tasks.findIndex(t => t.id === info.id)
    const toIdx = tasks.findIndex(t => t.id === dropTaskId)
    if (fromIdx === -1 || toIdx === -1) {
      dragInfo.current = null
      setDragActive(null)
      return
    }
    pushState()
    const [moved] = tasks.splice(fromIdx, 1)
    tasks.splice(toIdx, 0, moved)
    persistProjectChange(proj => {
      if (!proj.tasks) proj.tasks = {}
      proj.tasks[ph] = tasks
    })
    dragInfo.current = null
    setDragActive(null)
  }

  const onDragEnd = () => {
    dragInfo.current = null
    setDragActive(null)
  }

  const overallCompletion = weightedOverallCompletion(p, w, settingsPhases, innerViewPrefs.progress?.overrideEnabled)
  const openRfiCount = (p.rfis || []).filter(r => r.status !== 'answered').length

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const plannedStart = parseDateLocal(p.plannedStart)
  const plannedEnd = parseDateLocal(p.plannedEnd)

  const allLogs = (backup.logs || []).filter((l: any) => l.projId === p.id)
  const logDates = allLogs
    .map((l: any) => parseDateLocal(l.date))
    .filter(Boolean)
    .sort((a: Date, b: Date) => a.getTime() - b.getTime())
  const actualStart = logDates.length > 0 ? logDates[0] : null
  const actualEnd = logDates.length > 0 ? logDates[logDates.length - 1] : null

  const scheduleDays = plannedEnd ? diffDays(plannedEnd, today) : null

  function renderTimelineBar(start: Date | null, end: Date | null, color: string, label: string) {
    if (!start || !end) return null
    const totalSpan = diffDays(start, end) || 1
    const elapsed = Math.max(0, Math.min(totalSpan, diffDays(start, today)))
    const pctElapsed = Math.round((elapsed / totalSpan) * 100)
    return (
      <div style={{ marginBottom: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span style={{ fontSize: '11px', color: 'var(--t3)', fontWeight: '600' }}>{label}</span>
          <span style={{ fontSize: '11px', color: 'var(--t3)' }}>{fmtDateShort(start)} – {fmtDateShort(end)}</span>
        </div>
        <div style={{ height: '8px', backgroundColor: '#1e2130', borderRadius: '4px', overflow: 'hidden', position: 'relative' }}>
          <div style={{ width: pctElapsed + '%', height: '100%', backgroundColor: color, borderRadius: '4px', transition: 'width 0.3s' }} />
        </div>
      </div>
    )
  }

  function renderHealthCard(opts: {
    label: string
    value: React.ReactNode
    accent: string
    micro: string
    badge?: string
    progressPct?: number
  }) {
    const progressPct = opts.progressPct == null ? null : Math.max(0, Math.min(100, opts.progressPct))
    return (
      <div
        className="v15r-progress-health-card"
        style={{
          '--health-accent': opts.accent,
          background: `linear-gradient(135deg, ${opts.accent}22, rgba(34,211,238,0.07) 52%, rgba(15,23,42,0.52))`,
          border: `1px solid ${opts.accent}3f`,
        } as React.CSSProperties}
      >
        <div className="v15r-progress-health-orb" />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: opts.accent, fontSize: '10px', fontWeight: 800, letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: '8px' }}>
              {opts.label}
            </div>
            <div style={{ color: 'var(--t1)', fontFamily: 'monospace', fontSize: '32px', lineHeight: 1, fontWeight: 850, letterSpacing: '-0.05em' }}>
              {opts.value}
            </div>
          </div>
          {opts.badge && (
            <div style={{ color: opts.accent, fontSize: '10px', fontWeight: 800, padding: '4px 7px', borderRadius: '999px', backgroundColor: `${opts.accent}18`, border: `1px solid ${opts.accent}33`, whiteSpace: 'nowrap' }}>
              {opts.badge}
            </div>
          )}
        </div>
        {progressPct !== null && (
          <div style={{ position: 'relative', marginTop: '14px', height: '7px', borderRadius: '999px', overflow: 'hidden', backgroundColor: 'rgba(15,23,42,0.8)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ width: `${progressPct}%`, height: '100%', borderRadius: '999px', background: `linear-gradient(90deg, ${opts.accent}, rgba(255,255,255,0.72))`, transition: 'width 0.25s ease' }} />
          </div>
        )}
        <div style={{ position: 'relative', color: 'rgba(229,231,235,0.72)', fontSize: '11px', marginTop: '10px', lineHeight: 1.35 }}>
          {opts.micro}
        </div>
      </div>
    )
  }

  return (
    <div style={{ backgroundColor: '#1a1d27', padding: '0' }}>
      <style>{`
        .v15r-progress-health-card {
          position: relative;
          overflow: hidden;
          border-radius: 12px;
          padding: 16px;
          min-height: 132px;
          box-shadow: 0 16px 38px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.08);
          isolation: isolate;
        }
        .v15r-progress-health-card::after {
          content: "";
          position: absolute;
          inset: -40% auto auto -45%;
          width: 72%;
          height: 190%;
          background: linear-gradient(100deg, transparent, rgba(255,255,255,0.075), transparent);
          transform: translateX(-12%) rotate(12deg);
          animation: v15rProgressHealthSheen 9s ease-in-out infinite;
          pointer-events: none;
          z-index: 0;
        }
        .v15r-progress-health-orb {
          position: absolute;
          inset: -42px -28px auto auto;
          width: 150px;
          height: 150px;
          border-radius: 999px;
          background: var(--health-accent);
          opacity: 0.14;
          filter: blur(22px);
          animation: v15rProgressHealthGlow 7s ease-in-out infinite;
          pointer-events: none;
          z-index: 0;
        }
        @keyframes v15rProgressHealthSheen {
          0%, 62%, 100% { transform: translateX(-18%) rotate(12deg); opacity: 0; }
          72% { opacity: 1; }
          88% { transform: translateX(190%) rotate(12deg); opacity: 0; }
        }
        @keyframes v15rProgressHealthGlow {
          0%, 100% { transform: scale(0.96); opacity: 0.12; }
          50% { transform: scale(1.08); opacity: 0.2; }
        }
        @media (prefers-reduced-motion: reduce) {
          .v15r-progress-health-card::after,
          .v15r-progress-health-orb {
            animation: none;
          }
        }
      `}</style>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>

        <div style={{ backgroundColor: '#232738', borderRadius: '8px', marginBottom: '16px', padding: '16px' }}>
          <h4 style={{ color: 'var(--t1)', fontWeight: '600', margin: '0 0 12px 0' }}>Schedule Timeline</h4>
          {(!plannedStart || !plannedEnd) ? (
            <div style={{
              padding: '12px',
              backgroundColor: 'rgba(59,130,246,0.08)',
              border: '1px dashed rgba(59,130,246,0.3)',
              borderRadius: '6px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '12px', color: '#60a5fa', marginBottom: '4px' }}>📅 No planned dates set</div>
              <div style={{ fontSize: '11px', color: 'var(--t3)' }}>
                Add planned dates to this project to track schedule variance.
              </div>
            </div>
          ) : (
            <>
              {renderTimelineBar(plannedStart, plannedEnd, '#3b82f6', 'Planned')}
              {actualStart && renderTimelineBar(actualStart, actualEnd || today, '#10b981', 'Actual (logged)')}
              {scheduleDays !== null && (
                <div style={{
                  display: 'inline-block',
                  marginTop: '8px',
                  padding: '4px 10px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: '600',
                  backgroundColor: scheduleDays <= 0
                    ? 'rgba(16,185,129,0.15)'
                    : scheduleDays <= 7
                    ? 'rgba(245,158,11,0.15)'
                    : 'rgba(239,68,68,0.15)',
                  color: scheduleDays <= 0
                    ? '#10b981'
                    : scheduleDays <= 7
                    ? '#f59e0b'
                    : '#ef4444',
                }}>
                  {scheduleDays < 0
                    ? `${Math.abs(scheduleDays)} days ahead of schedule`
                    : scheduleDays === 0
                    ? 'On schedule (planned end is today)'
                    : `${scheduleDays} days behind schedule`}
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ backgroundColor: '#232738', borderRadius: '10px', marginBottom: '16px', padding: '16px', border: '1px solid rgba(255,255,255,0.05)', boxShadow: '0 16px 42px rgba(0,0,0,0.18)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '12px', marginBottom: '14px' }}>
            <div>
              <h4 style={{ color: 'var(--t1)', fontWeight: '700', margin: '0 0 4px 0' }}>Project Health</h4>
              <div style={{ color: 'var(--t3)', fontSize: '11px' }}>
                Weighted progress, field movement, and RFI pressure for this project.
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
            {renderHealthCard({
              label: 'Overall Completion',
              value: `${overallCompletion}%`,
              accent: '#10b981',
              micro: `Weighted by phase setup across ${settingsPhases.length} phase${settingsPhases.length === 1 ? '' : 's'}.`,
              badge: 'Live',
              progressPct: overallCompletion,
            })}
            {renderHealthCard({
              label: 'Days Since Last Movement',
              value: daysSinceMove == null ? 'None' : daysSinceMove,
              accent: stagnancyColor(),
              micro: lastMovementDate
                ? `Last project log: ${fmtDateShort(lastMovementDate)}.`
                : 'No movement logged for this project yet.',
              badge: stagnancyLabel(),
            })}
            {renderHealthCard({
              label: 'Open RFIs',
              value: openRfiCount,
              accent: openRfiCount > 0 ? '#ef4444' : '#38bdf8',
              micro: openRfiCount > 0
                ? 'Unanswered RFIs are still open.'
                : 'No unanswered RFIs on this project.',
              badge: openRfiCount > 0 ? 'Needs reply' : 'Clear',
            })}
          </div>
        </div>

        {orderedPhaseEntries.map(([ph, wt, isLegacyPhase]) => {
          const tasks = tasksForPhase(p, ph, settingsPhases)
          const clrSaved = resolvePhaseHeaderColor(ph, p.progressPhaseColors)
          const clrDisplay = normalizeColorPickerValue(phaseColorDraft[ph] ?? clrSaved)
          const phaseEffectivePct = effectivePhaseProgressPct(
            p,
            ph,
            settingsPhases,
            innerViewPrefs.progress?.overrideEnabled,
          )
          const overrideOn = isProgressPhaseManualOverride(
            p,
            ph,
            innerViewPrefs.progress?.overrideEnabled,
          )
          const storedManualPct = Math.min(100, Math.max(0, num((p.phases || {})[ph] ?? 0)))
          const isCustom = false
          const isOpen = phaseExpanded[ph] !== false

          return (
            <div key={ph} style={{ backgroundColor: '#232738', borderRadius: '8px', marginBottom: '16px', overflow: 'hidden' }}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => togglePhaseBucket(ph)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    togglePhaseBucket(ph)
                  }
                }}
                style={{
                  backgroundColor: clrDisplay + '18',
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <span style={{ color: 'var(--t3)', fontSize: '12px', width: '14px', flexShrink: 0, textAlign: 'center' }}>
                  {isOpen ? '▼' : '▶'}
                </span>
                <input
                  type="color"
                  aria-label={`Color for phase ${ph}`}
                  value={clrDisplay}
                  onClick={e => e.stopPropagation()}
                  onMouseDown={e => e.stopPropagation()}
                  onKeyDown={e => e.stopPropagation()}
                  onChange={e => {
                    e.stopPropagation()
                    scheduleProgressPhaseColorCommit(ph, e.target.value)
                  }}
                  onBlur={() => flushProgressPhaseColor(ph)}
                  onMouseUp={e => {
                    e.stopPropagation()
                    flushProgressPhaseColor(ph)
                  }}
                  style={{
                    width: '28px',
                    height: '26px',
                    padding: 0,
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: '4px',
                    background: 'transparent',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                />
                <div style={{ width: '3px', height: '18px', borderRadius: '2px', backgroundColor: clrDisplay, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'var(--t1)', fontWeight: '700', fontSize: '14px', marginBottom: '2px' }}>
                    {ph}
                    {isLegacyPhase && (
                      <span style={{
                        marginLeft: '6px',
                        fontSize: '9px',
                        padding: '1px 5px',
                        borderRadius: '3px',
                        backgroundColor: 'rgba(255,255,255,0.08)',
                        color: 'var(--t3)',
                        fontWeight: '500',
                        verticalAlign: 'middle',
                      }}>
                        legacy
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--t3)' }}>
                    {overrideOn ? 'Manual override · ' : 'From tasks · '}
                    {isLegacyPhase ? 'Unmapped / legacy phase · ' : (wt > 0 ? `${formatPhaseWeight(wt)}% weight · ` : '')}{tasks.length} task{tasks.length !== 1 ? 's' : ''}
                  </div>
                </div>
                <div style={{ width: '80px', height: '4px', backgroundColor: '#1e2130', borderRadius: '2px', overflow: 'hidden', flexShrink: 0 }}>
                  <div
                    style={{
                      width: phaseEffectivePct + '%',
                      height: '100%',
                      backgroundColor: clrDisplay,
                      transition: 'width 0.3s',
                    }}
                  />
                </div>
                <div style={{ color: clrDisplay, fontWeight: '600', minWidth: '36px', textAlign: 'right', fontFamily: 'monospace', flexShrink: 0 }}>
                  {phaseEffectivePct}%
                </div>
                {isCustom && (
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); deleteCustomPhase(ph) }}
                    title="Delete this custom phase"
                    style={{
                      background: 'none',
                      border: '1px solid rgba(239,68,68,0.3)',
                      color: '#ef4444',
                      cursor: 'pointer',
                      fontSize: '13px',
                      borderRadius: '4px',
                      padding: '2px 6px',
                      lineHeight: '1',
                      flexShrink: 0,
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>

              {isOpen && (
              <div style={{ padding: '12px 16px' }}>
                {tasks.length === 0 ? (
                  <div style={{ fontSize: '12px', color: 'var(--t3)', marginBottom: '12px' }}>
                    No tasks yet — add one below. Turn <strong style={{ color: 'var(--t2)' }}>Override</strong> on to set this phase manually.
                  </div>
                ) : (
                  <div style={{ marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {tasks.map(t => (
                      <div
                        key={t.id}
                        onDragOver={e => onDragOver(e, t.id)}
                        onDrop={e => onDrop(t.__phaseKey || ph, t.id, e)}
                        style={{
                          padding: '8px 10px',
                          backgroundColor: dragActive === t.id ? '#2a2d40' : '#1e2130',
                          borderRadius: '6px',
                          ...taskRowGrid,
                          minHeight: '48px',
                          cursor: 'default',
                          opacity: dragActive === t.id ? 0.55 : 1,
                          border: dragActive === t.id
                            ? '1px solid rgba(59,130,246,0.4)'
                            : '1px solid transparent',
                          transition: 'opacity 0.15s, border-color 0.15s',
                          boxSizing: 'border-box',
                        }}
                      >
                        <div
                          style={{
                            ...taskRowCell,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                          }}
                        >
                          <div
                            draggable
                            onDragStart={e => {
                              e.stopPropagation()
                              onDragStart(t.__phaseKey || ph, t.id, e)
                            }}
                            onDragEnd={onDragEnd}
                            style={{
                              width: '20px',
                              flexShrink: 0,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'grab',
                              color: 'var(--t3)',
                              userSelect: 'none',
                              touchAction: 'none',
                            }}
                            title="Drag to reorder"
                          >
                            <span style={{ fontSize: '14px', opacity: 0.6, lineHeight: '1' }}>⠿</span>
                          </div>

                          <input
                            type="text"
                            value={t.desc || ''}
                            onChange={e => editTask(t.__phaseKey || ph, t.id, 'desc', e.target.value)}
                            onMouseDown={e => e.stopPropagation()}
                            onPointerDown={e => e.stopPropagation()}
                            onTouchStart={e => e.stopPropagation()}
                            onDragStart={e => e.preventDefault()}
                            placeholder="Task description"
                            style={{
                              flex: 1,
                              minWidth: 0,
                              width: '100%',
                              boxSizing: 'border-box',
                              background: 'transparent',
                              border: 'none',
                              borderBottom: '1px solid rgba(255,255,255,0.08)',
                              color: 'var(--t1)',
                              fontSize: '13px',
                              fontFamily: 'inherit',
                              outline: 'none',
                              textAlign: 'left',
                              cursor: 'text',
                              height: '28px',
                            }}
                          />
                        </div>

                        <div
                          onMouseDown={e => e.stopPropagation()}
                          onPointerDown={e => e.stopPropagation()}
                          onTouchStart={e => e.stopPropagation()}
                          style={{
                            ...taskRowCell,
                            display: 'flex',
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: '10px',
                            minWidth: 0,
                          }}
                        >
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={t.pct ?? 0}
                            onChange={e => editTask(t.__phaseKey || ph, t.id, 'pct', e.target.value)}
                            onMouseDown={e => e.stopPropagation()}
                            onPointerDown={e => e.stopPropagation()}
                            onTouchStart={e => e.stopPropagation()}
                            onDragStart={e => e.preventDefault()}
                            style={{ flex: '1 1 auto', minWidth: 0, width: '100%', accentColor: clrSaved }}
                          />
                          <span style={{
                            width: '40px',
                            flexShrink: 0,
                            fontSize: '11px',
                            fontFamily: 'monospace',
                            fontWeight: '600',
                            color: clrSaved,
                            textAlign: 'right',
                          }}>
                            {(t.pct ?? 0)}%
                          </span>
                        </div>

                        <div style={{
                          ...taskRowCell,
                          width: '100%',
                          justifySelf: 'stretch',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'flex-end',
                          gap: '4px',
                        }}>
                          <input
                            type="number"
                            value={t.hrs ?? 0}
                            onChange={e => editTask(t.__phaseKey || ph, t.id, 'hrs', e.target.value)}
                            onMouseDown={e => e.stopPropagation()}
                            onPointerDown={e => e.stopPropagation()}
                            onTouchStart={e => e.stopPropagation()}
                            onDragStart={e => e.preventDefault()}
                            step="0.5"
                            min="0"
                            style={{
                              width: '52px',
                              padding: '4px 4px',
                              backgroundColor: '#0f1117',
                              border: '1px solid var(--bdr2)',
                              color: 'var(--t1)',
                              fontFamily: 'monospace',
                              borderRadius: '4px',
                              fontSize: '12px',
                              textAlign: 'center',
                              boxSizing: 'border-box',
                              height: '30px',
                            }}
                          />
                          <span style={{ fontSize: '11px', color: 'var(--t3)', flexShrink: 0, width: '22px', textAlign: 'left' }}>
                            hrs
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => delTask(t.__phaseKey || ph, t.id)}
                          title="Remove task"
                          style={{
                            width: '24px',
                            height: '28px',
                            padding: '0',
                            justifySelf: 'center',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'none',
                            border: 'none',
                            color: 'rgba(239,68,68,0.85)',
                            cursor: 'pointer',
                            fontSize: '16px',
                            lineHeight: 1,
                            opacity: 0.85,
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{
                  display: 'flex',
                  gap: '10px',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  rowGap: '8px',
                  paddingTop: '8px',
                  borderTop: '1px solid var(--bdr2)',
                }}>
                  <button
                    type="button"
                    onClick={() => addTask(ph)}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: 'rgba(59,130,246,0.2)',
                      color: '#3b82f6',
                      border: '1px solid rgba(59,130,246,0.3)',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: '600',
                      cursor: 'pointer',
                    }}
                  >
                    + Add Task
                  </button>

                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '11px',
                    color: overrideOn ? '#a855f7' : 'var(--t3)',
                    fontWeight: overrideOn ? '700' : '500',
                    cursor: 'pointer',
                    userSelect: 'none',
                    padding: overrideOn ? '4px 10px' : '2px 0',
                    borderRadius: '6px',
                    backgroundColor: overrideOn ? 'rgba(168,85,247,0.14)' : 'transparent',
                    border: overrideOn ? '1px solid rgba(168,85,247,0.45)' : '1px solid transparent',
                    boxShadow: overrideOn ? '0 0 0 1px rgba(168,85,247,0.12)' : 'none',
                  }}>
                    <input
                      type="checkbox"
                      checked={overrideOn}
                      onChange={e => setPhaseProgressOverrideEnabled(ph, e.target.checked)}
                      style={{ accentColor: overrideOn ? '#a855f7' : '#3b82f6', cursor: 'pointer' }}
                    />
                    Override phase %
                  </label>

                  {overrideOn && (
                    <>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={storedManualPct}
                        onChange={e => overridePhase(ph, e.target.value)}
                        style={{ flex: '1 1 120px', minWidth: '100px', maxWidth: '200px', accentColor: clrSaved }}
                      />
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={storedManualPct}
                        onChange={e => overridePhase(ph, e.target.value)}
                        style={{
                          width: '52px',
                          padding: '4px 6px',
                          backgroundColor: '#0f1117',
                          border: '1px solid var(--bdr2)',
                          borderRadius: '4px',
                          color: 'var(--t1)',
                          fontFamily: 'monospace',
                          fontSize: '11px',
                          textAlign: 'center',
                          boxSizing: 'border-box',
                        }}
                      />
                      <span style={{ fontSize: '10px', color: 'var(--t3)' }}>% manual</span>
                    </>
                  )}
                </div>
              </div>
              )}
            </div>
          )
        })}

        {addingPhase ? (
          <div style={{
            backgroundColor: '#232738',
            borderRadius: '8px',
            marginBottom: '16px',
            padding: '16px',
            border: '1px dashed rgba(59,130,246,0.35)',
          }}>
            <div style={{ fontSize: '12px', color: 'var(--t3)', marginBottom: '8px', fontWeight: '600' }}>
              New Phase Name
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                autoFocus
                type="text"
                value={newPhaseName}
                onChange={e => setNewPhaseName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') confirmAddCustomPhase()
                  if (e.key === 'Escape') { setAddingPhase(false); setNewPhaseName('') }
                }}
                placeholder="e.g. Inspection, Punch List…"
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  backgroundColor: '#0f1117',
                  border: '1px solid rgba(59,130,246,0.4)',
                  borderRadius: '4px',
                  color: 'var(--t1)',
                  fontSize: '13px',
                  fontFamily: 'inherit',
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={confirmAddCustomPhase}
                style={{
                  padding: '6px 14px',
                  backgroundColor: 'rgba(59,130,246,0.25)',
                  color: '#3b82f6',
                  border: '1px solid rgba(59,130,246,0.4)',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => { setAddingPhase(false); setNewPhaseName('') }}
                style={{
                  padding: '6px 10px',
                  backgroundColor: 'transparent',
                  color: 'var(--t3)',
                  border: '1px solid var(--bdr2)',
                  borderRadius: '4px',
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddingPhase(true)}
            style={{
              width: '100%',
              padding: '12px',
              backgroundColor: 'rgba(59,130,246,0.07)',
              color: '#3b82f6',
              border: '1px dashed rgba(59,130,246,0.3)',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: '600',
              cursor: 'pointer',
              marginBottom: '16px',
              letterSpacing: '0.02em',
            }}
          >
            + Add Phase to Settings
          </button>
        )}

      </div>
    </div>
  )
}
