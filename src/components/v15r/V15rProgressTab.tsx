// @ts-nocheck
import React, { useState, useCallback, useRef } from 'react'
import { getBackupData, saveBackupData, num, daysSince, getPhaseWeights } from '@/services/backupDataService'
import { pushState } from '@/services/undoRedoService'

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

const PREFERRED_PHASE_ORDER = ['Demo', 'Underground', 'Rough In', 'Trim', 'Finish']

/** Legacy weight-map order (for grouping keys from getPhaseWeights) */
const LEGACY_STANDARD_PHASE_ORDER = ['Estimating', 'Planning', 'Site Prep', 'Rough-in', 'Trim', 'Finish']
const LEGACY_STANDARD_PHASE_SET = new Set(LEGACY_STANDARD_PHASE_ORDER)

const CUSTOM_PHASE_PALETTE = ['#f97316', '#84cc16', '#22d3ee', '#e879f9', '#fb7185', '#a3e635']

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

function orderPhaseEntries(combined: [string, number][]): [string, number][] {
  const ordered: [string, number][] = []
  const added = new Set<string>()
  for (const ph of PREFERRED_PHASE_ORDER) {
    const row = combined.find(([p]) => p === ph)
    if (row && !added.has(ph)) {
      ordered.push(row)
      added.add(ph)
    }
  }
  for (const row of combined) {
    if (!added.has(row[0])) {
      ordered.push(row)
      added.add(row[0])
    }
  }
  return ordered
}

export default function V15rProgressTab({ projectId, onUpdate, backup: initialBackup }: V15rProgressTabProps) {
  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])

  const [addingPhase, setAddingPhase] = useState(false)
  const [newPhaseName, setNewPhaseName] = useState('')

  /** false = collapsed; missing or true = expanded */
  const [phaseExpanded, setPhaseExpanded] = useState<Record<string, boolean>>({})

  const dragInfo = useRef<{ ph: string; id: string } | null>(null)
  const dragOverId = useRef<string | null>(null)
  const [dragActive, setDragActive] = useState<string | null>(null)

  const backup = initialBackup || getBackupData()
  if (!backup) return <div style={{ color: 'var(--t3)' }}>No data</div>

  const p = backup.projects.find(x => x.id === projectId)
  if (!p) return <div style={{ color: 'var(--t3)' }}>Project not found</div>

  const w = getPhaseWeights(backup)
  const daysSinceMove = daysSince(p.lastMove)

  const sortedLegacyStandardEntries: [string, number][] = LEGACY_STANDARD_PHASE_ORDER
    .filter(ph => w[ph] !== undefined)
    .map(ph => [ph, w[ph]])

  const extraWeightEntries: [string, number][] = Object.entries(w)
    .filter(([ph]) => !LEGACY_STANDARD_PHASE_SET.has(ph))

  const projectCustomPhases: string[] = (p.customPhases || [])
  const customPhaseEntries: [string, number][] = projectCustomPhases
    .filter(ph => w[ph] === undefined)
    .map(ph => [ph, 0])

  const combinedPhaseEntries: [string, number][] = [
    ...sortedLegacyStandardEntries,
    ...extraWeightEntries,
    ...customPhaseEntries,
  ]

  const orderedPhaseEntries = orderPhaseEntries(combinedPhaseEntries)

  const togglePhaseBucket = (ph: string) => {
    setPhaseExpanded(prev => ({
      ...prev,
      [ph]: !(prev[ph] !== false),
    }))
  }

  const setProgressPhaseColor = (ph: string, hex: string) => {
    pushState()
    if (!p.progressPhaseColors) p.progressPhaseColors = {}
    p.progressPhaseColors[ph] = normalizeColorPickerValue(hex)
    saveBackupData(backup)
    forceUpdate()
  }

  const stagnancyColor = () => {
    if (daysSinceMove < 7) return '#10b981'
    if (daysSinceMove < 14) return '#f59e0b'
    return '#ef4444'
  }

  const stagnancyLabel = () => {
    if (daysSinceMove < 7) return '✓ Active'
    if (daysSinceMove < 14) return '⚠ Check-in'
    return '🔴 Call now'
  }

  const editTask = (ph, taskId, field, value) => {
    pushState()
    const tasks = (p.tasks || {})[ph] || []
    const task = tasks.find(t => t.id === taskId)
    if (task) {
      if (field === 'desc') task.desc = String(value)
      else if (field === 'hrs') task.hrs = num(value)
      else if (field === 'pct') task.pct = Math.min(100, Math.max(0, num(value)))
    }
    saveBackupData(backup)
    forceUpdate()
  }

  const addTask = (ph) => {
    pushState()
    if (!p.tasks) p.tasks = {}
    if (!p.tasks[ph]) p.tasks[ph] = []
    p.tasks[ph].push({
      id: 'tsk' + Date.now(),
      desc: 'New task',
      hrs: 0,
      pct: 0,
    })
    saveBackupData(backup)
    forceUpdate()
  }

  const delTask = (ph, taskId) => {
    pushState()
    if (p.tasks && p.tasks[ph]) {
      p.tasks[ph] = p.tasks[ph].filter(t => t.id !== taskId)
    }
    saveBackupData(backup)
    forceUpdate()
  }

  const overridePhase = (ph, value) => {
    pushState()
    p.phases = p.phases || {}
    p.phases[ph] = Math.min(100, Math.max(0, num(value)))
    p.lastMove = new Date().toISOString()
    saveBackupData(backup)
    forceUpdate()
  }

  const confirmAddCustomPhase = () => {
    const trimmed = newPhaseName.trim()
    if (!trimmed) return
    const existingNames = new Set(orderedPhaseEntries.map(([ph]) => ph.toLowerCase()))
    if (existingNames.has(trimmed.toLowerCase())) {
      alert(`Phase "${trimmed}" already exists.`)
      return
    }
    pushState()
    if (!p.customPhases) p.customPhases = []
    if (!p.phases) p.phases = {}
    if (!p.tasks) p.tasks = {}
    p.customPhases.push(trimmed)
    p.phases[trimmed] = 0
    if (!p.tasks[trimmed]) p.tasks[trimmed] = []
    saveBackupData(backup)
    setNewPhaseName('')
    setAddingPhase(false)
    forceUpdate()
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
    if (p.customPhases) p.customPhases = p.customPhases.filter(x => x !== ph)
    if (p.phases) delete p.phases[ph]
    if (p.tasks) delete p.tasks[ph]
    if (p.progressPhaseColors) delete p.progressPhaseColors[ph]
    saveBackupData(backup)
    forceUpdate()
  }

  const onDragStart = (ph: string, taskId: string, e: React.DragEvent) => {
    dragInfo.current = { ph, id: taskId }
    setDragActive(taskId)
    e.dataTransfer.effectAllowed = 'move'
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
    if (fromIdx === -1 || toIdx === -1) return
    pushState()
    const [moved] = tasks.splice(fromIdx, 1)
    tasks.splice(toIdx, 0, moved)
    p.tasks[ph] = tasks
    saveBackupData(backup)
    dragInfo.current = null
    setDragActive(null)
    forceUpdate()
  }

  const onDragEnd = () => {
    dragInfo.current = null
    setDragActive(null)
  }

  const overallCompletion = Math.round(
    Object.entries(w).reduce((s, [ph, wt]) => {
      const tot = Object.values(w).reduce((sum, v) => sum + v, 0) || 100
      const phases = p.phases || {}
      return s + (num(phases[ph]) * wt / tot)
    }, 0)
  )

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

  return (
    <div style={{ backgroundColor: '#1a1d27', padding: '0' }}>
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

        <div style={{ backgroundColor: '#232738', borderRadius: '8px', marginBottom: '16px', padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h4 style={{ color: 'var(--t1)', fontWeight: '600', margin: '0' }}>Overall Completion</h4>
            <span style={{ color: '#10b981', fontWeight: '700', fontSize: '20px' }}>{overallCompletion}%</span>
          </div>
          <div style={{ height: '8px', backgroundColor: '#1e2130', borderRadius: '4px', overflow: 'hidden' }}>
            <div
              style={{
                width: overallCompletion + '%',
                height: '100%',
                backgroundColor: '#10b981',
                transition: 'width 0.3s',
              }}
            />
          </div>
        </div>

        <div style={{ backgroundColor: '#232738', borderRadius: '8px', marginBottom: '16px', padding: '16px' }}>
          <h4 style={{ color: 'var(--t1)', fontWeight: '600', margin: '0 0 12px 0' }}>Project Health</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--t3)', marginBottom: '4px', fontWeight: '600' }}>
                Days Since Last Movement
              </div>
              <div style={{ fontSize: '28px', fontWeight: '700', color: stagnancyColor(), fontFamily: 'monospace', marginBottom: '4px' }}>
                {daysSinceMove}
              </div>
              <span
                style={{
                  display: 'inline-block',
                  padding: '4px 8px',
                  backgroundColor: stagnancyColor() + '20',
                  color: stagnancyColor(),
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: '600',
                }}
              >
                {stagnancyLabel()}
              </span>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--t3)', marginBottom: '4px', fontWeight: '600' }}>
                Open RFIs
              </div>
              <div style={{ fontSize: '28px', fontWeight: '700', color: '#ef4444', fontFamily: 'monospace' }}>
                {(p.rfis || []).filter(r => r.status !== 'answered').length}
              </div>
            </div>
          </div>
        </div>

        {orderedPhaseEntries.map(([ph, wt]) => {
          const v = num((p.phases || {})[ph] || 0)
          const tasks = (p.tasks || {})[ph] || []
          const clr = resolvePhaseHeaderColor(ph, p.progressPhaseColors)
          const isCustom = Array.isArray(p.customPhases) && p.customPhases.includes(ph)
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
                  backgroundColor: clr + '18',
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
                  value={clr}
                  onClick={e => e.stopPropagation()}
                  onMouseDown={e => e.stopPropagation()}
                  onKeyDown={e => e.stopPropagation()}
                  onChange={e => {
                    e.stopPropagation()
                    setProgressPhaseColor(ph, e.target.value)
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
                <div style={{ width: '3px', height: '18px', borderRadius: '2px', backgroundColor: clr, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'var(--t1)', fontWeight: '700', fontSize: '14px', marginBottom: '2px' }}>
                    {ph}
                    {isCustom && (
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
                        custom
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--t3)' }}>
                    {wt > 0 ? `${wt}% weight · ` : ''}{tasks.length} task{tasks.length !== 1 ? 's' : ''}
                  </div>
                </div>
                <div style={{ width: '80px', height: '4px', backgroundColor: '#1e2130', borderRadius: '2px', overflow: 'hidden', flexShrink: 0 }}>
                  <div
                    style={{
                      width: v + '%',
                      height: '100%',
                      backgroundColor: clr,
                      transition: 'width 0.3s',
                    }}
                  />
                </div>
                <div style={{ color: clr, fontWeight: '600', minWidth: '36px', textAlign: 'right', fontFamily: 'monospace', flexShrink: 0 }}>
                  {v}%
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
                    No tasks yet — add one below. Phase % can also be set directly.
                  </div>
                ) : (
                  <div style={{ marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {tasks.map(t => (
                      <div
                        key={t.id}
                        draggable
                        onDragStart={e => onDragStart(ph, t.id, e)}
                        onDragOver={e => onDragOver(e, t.id)}
                        onDrop={e => onDrop(ph, t.id, e)}
                        onDragEnd={onDragEnd}
                        style={{
                          padding: '8px 10px',
                          backgroundColor: dragActive === t.id ? '#2a2d40' : '#1e2130',
                          borderRadius: '6px',
                          display: 'flex',
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: '10px',
                          minHeight: '52px',
                          cursor: 'grab',
                          opacity: dragActive === t.id ? 0.55 : 1,
                          border: dragActive === t.id
                            ? '1px solid rgba(59,130,246,0.4)'
                            : '1px solid transparent',
                          transition: 'opacity 0.15s, border-color 0.15s',
                          userSelect: 'none',
                        }}
                      >
                        <div
                          style={{
                            width: '20px',
                            flexShrink: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            alignSelf: 'stretch',
                            cursor: 'grab',
                          }}
                          title="Drag to reorder"
                        >
                          <span style={{ color: 'var(--t3)', fontSize: '14px', opacity: 0.6, lineHeight: '1' }}>⠿</span>
                        </div>

                        <input
                          type="text"
                          value={t.desc || ''}
                          onChange={e => editTask(ph, t.id, 'desc', e.target.value)}
                          onMouseDown={e => e.stopPropagation()}
                          placeholder="Task description"
                          style={{
                            flex: '1 1 140px',
                            minWidth: '100px',
                            background: 'transparent',
                            border: 'none',
                            borderBottom: '1px solid rgba(255,255,255,0.08)',
                            color: 'var(--t1)',
                            fontSize: '13px',
                            fontFamily: 'inherit',
                            outline: 'none',
                            textAlign: 'left',
                            cursor: 'text',
                          }}
                        />

                        <div style={{
                          flex: '1.25 1 180px',
                          minWidth: '140px',
                          maxWidth: '320px',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'stretch',
                          gap: '4px',
                        }}>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={t.pct || 0}
                            onChange={e => editTask(ph, t.id, 'pct', e.target.value)}
                            onMouseDown={e => e.stopPropagation()}
                            style={{ width: '100%', accentColor: clr }}
                          />
                          <span style={{
                            fontSize: '11px',
                            fontFamily: 'monospace',
                            fontWeight: '600',
                            color: clr,
                            textAlign: 'center',
                          }}>
                            {t.pct || 0}%
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                          <input
                            type="number"
                            value={t.hrs || 0}
                            onChange={e => editTask(ph, t.id, 'hrs', e.target.value)}
                            onMouseDown={e => e.stopPropagation()}
                            step="0.5"
                            min="0"
                            style={{
                              width: '52px',
                              padding: '4px 6px',
                              backgroundColor: '#0f1117',
                              border: '1px solid var(--bdr2)',
                              color: 'var(--t1)',
                              fontFamily: 'monospace',
                              borderRadius: '4px',
                              fontSize: '12px',
                              textAlign: 'center',
                            }}
                          />
                          <span style={{ fontSize: '11px', color: 'var(--t3)', flexShrink: 0 }}>hrs</span>
                        </div>

                        <button
                          type="button"
                          onClick={() => delTask(ph, t.id)}
                          title="Remove task"
                          style={{
                            flexShrink: 0,
                            background: 'none',
                            border: 'none',
                            color: 'rgba(239,68,68,0.85)',
                            cursor: 'pointer',
                            fontSize: '14px',
                            padding: '4px 6px',
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

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', paddingTop: '8px', borderTop: '1px solid var(--bdr2)' }}>
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

                  <span style={{ fontSize: '10px', color: 'var(--t3)' }}>Override:</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={v}
                    onChange={e => overridePhase(ph, e.target.value)}
                    style={{
                      width: '54px',
                      padding: '4px 6px',
                      backgroundColor: '#0f1117',
                      border: '1px solid var(--bdr2)',
                      borderRadius: '4px',
                      color: 'var(--t1)',
                      fontFamily: 'monospace',
                      fontSize: '11px',
                      textAlign: 'center',
                    }}
                  />
                  <span style={{ fontSize: '10px', color: 'var(--t3)' }}>%</span>
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
            + Add Custom Phase
          </button>
        )}

      </div>
    </div>
  )
}
