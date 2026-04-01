// @ts-nocheck
/**
 * V15rPhaseTimelineTab — Phase Timeline section inside the project detail panel.
 *
 * Collapsible "Phase Timeline" section showing per-phase:
 *  - Confirmed start date (nullable)
 *  - Estimated duration (days)
 *  - Status badge: CONFIRMED / ESTIMATED / COMPLETE
 *  - Quoted vs actual comparison row (hours + materials)
 *  - Payment trigger percentage
 *
 * Data is stored on project.phase_timeline (JSONB array).
 * Uses backupDataService for local-first persistence.
 */

import React, { useState, useCallback } from 'react'
import { getBackupData, saveBackupData, getPhaseWeights, num } from '@/services/backupDataService'
import { pushState } from '@/services/undoRedoService'
import {
  normalizePhaseTimeline,
  savePhaseTimelineEntry,
  queryQuoteVsActual,
  queryPaymentSchedule,
  type PhaseTimelineEntry,
} from '@/services/revenueTimelineQueries'
import { getPhasePaymentSchedule } from '@/services/revenueTimelineService'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(v: number): string {
  if (v >= 1000000) return '$' + (v / 1000000).toFixed(1) + 'M'
  if (v >= 1000) return '$' + (v / 1000).toFixed(0) + 'k'
  return '$' + Math.round(v)
}

function fmtDate(s: string | null): string {
  if (!s) return ''
  const d = new Date(s + 'T00:00:00')
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

function estimateWeekRange(
  timeline: PhaseTimelineEntry[],
  idx: number,
  historicalAvgs: Record<string, number>
): string {
  // Find the latest confirmed end before this phase
  let baseDate: Date | null = null
  for (let i = 0; i < idx; i++) {
    const e = timeline[i]
    if (e.actual_end_date) {
      baseDate = new Date(e.actual_end_date + 'T00:00:00')
    } else if (e.confirmed_start_date) {
      const start = new Date(e.confirmed_start_date + 'T00:00:00')
      const dur = e.estimated_duration_days || historicalAvgs[e.phase_name] || 14
      baseDate = new Date(start.getTime() + dur * 86400000)
    }
  }
  if (!baseDate) return 'Date TBD'
  const startWk = new Date(baseDate.getTime())
  const dur = timeline[idx].estimated_duration_days || historicalAvgs[timeline[idx].phase_name] || 14
  const endWk = new Date(startWk.getTime() + dur * 86400000)
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return '~' + fmt(startWk) + ' – ' + fmt(endWk)
}

function getStatusBadge(entry: PhaseTimelineEntry): { label: string; color: string; bg: string } {
  if (entry.actual_end_date) return { label: 'COMPLETE', color: '#10b981', bg: 'rgba(16,185,129,0.15)' }
  if (entry.confirmed_start_date) return { label: 'CONFIRMED', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' }
  return { label: 'ESTIMATED', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' }
}

const PHASE_COLORS: Record<string, string> = {
  Planning: '#06b6d4',
  Estimating: '#3b82f6',
  'Site Prep': '#f59e0b',
  'Rough-in': '#10b981',
  Finish: '#a855f7',
  Trim: '#ef4444',
}

function phaseColor(name: string): string {
  return PHASE_COLORS[name] || '#6b7280'
}

// ── Phase row component ───────────────────────────────────────────────────────

function PhaseRow({
  entry,
  idx,
  timeline,
  projectId,
  projectLogs,
  historicalAvgs,
  onSave,
}: {
  entry: PhaseTimelineEntry
  idx: number
  timeline: PhaseTimelineEntry[]
  projectId: string
  projectLogs: any[]
  historicalAvgs: Record<string, number>
  onSave: (updated: PhaseTimelineEntry) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<PhaseTimelineEntry>({ ...entry })

  const badge = getStatusBadge(entry)
  const color = phaseColor(entry.phase_name)

  // Compute actual hours/materials from field logs for this phase
  const phaseLogs = projectLogs.filter(l => {
    const logPhase = (l.phase || l.phaseLabel || '').toLowerCase().trim()
    const entryPhase = entry.phase_name.toLowerCase().trim()
    return logPhase === entryPhase || logPhase.includes(entryPhase) || entryPhase.includes(logPhase)
  })
  const actualHrs = phaseLogs.reduce((s, l) => s + num(l.hrs || 0), 0)
  const actualMat = phaseLogs.reduce((s, l) => s + num(l.mat || l.materials || 0), 0)

  const hasFieldData = entry.actual_start_date || entry.confirmed_start_date
  const estimatedRange = !entry.confirmed_start_date && !entry.actual_start_date
    ? estimateWeekRange(timeline, idx, historicalAvgs)
    : null

  const handleSave = () => {
    onSave(draft)
    setEditing(false)
  }

  const inputStyle = {
    background: '#1a1d27',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '4px',
    padding: '4px 8px',
    color: '#e5e7eb',
    fontSize: '12px',
    outline: 'none',
    width: '100%',
  }

  const labelStyle = {
    color: '#6b7280',
    fontSize: '10px',
    marginBottom: '3px',
    display: 'block',
  }

  return (
    <div
      style={{
        borderLeft: `3px solid ${color}`,
        background: 'rgba(255,255,255,0.025)',
        borderRadius: '6px',
        marginBottom: '8px',
        overflow: 'hidden',
      }}
    >
      {/* Header row */}
      <div
        onClick={() => !editing && setExpanded(e => !e)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '10px 12px',
          cursor: editing ? 'default' : 'pointer',
        }}
      >
        {/* Phase name */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ color, fontWeight: 600, fontSize: '13px' }}>{entry.phase_name}</span>
          {estimatedRange && (
            <span style={{ color: '#6b7280', fontSize: '11px', marginLeft: '8px' }}>
              {estimatedRange}
            </span>
          )}
          {entry.confirmed_start_date && !estimatedRange && (
            <span style={{ color: '#9ca3af', fontSize: '11px', marginLeft: '8px' }}>
              Starts {fmtDate(entry.confirmed_start_date)}
            </span>
          )}
        </div>

        {/* Status badge */}
        <span
          style={{
            background: badge.bg,
            color: badge.color,
            fontSize: '9px',
            fontWeight: 700,
            padding: '2px 7px',
            borderRadius: '10px',
            letterSpacing: '0.05em',
            whiteSpace: 'nowrap',
          }}
        >
          {badge.label}
        </span>

        {/* Payment trigger */}
        {entry.payment_trigger_pct > 0 && (
          <span style={{ color: '#f59e0b', fontSize: '10px', fontWeight: 600, whiteSpace: 'nowrap' }}>
            {entry.payment_trigger_pct}%
          </span>
        )}

        {/* Edit button */}
        <button
          onClick={e => { e.stopPropagation(); setEditing(v => !v); setDraft({ ...entry }) }}
          style={{
            background: 'rgba(59,130,246,0.2)',
            border: '1px solid rgba(59,130,246,0.3)',
            borderRadius: '4px',
            color: '#60a5fa',
            fontSize: '10px',
            padding: '3px 8px',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          {editing ? 'Cancel' : 'Edit'}
        </button>

        <span style={{ color: '#4b5563', fontSize: '12px' }}>{expanded || editing ? '▲' : '▼'}</span>
      </div>

      {/* Expanded/edit content */}
      {(expanded || editing) && (
        <div style={{ padding: '0 12px 12px' }}>
          {editing ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={labelStyle}>Confirmed Start Date</label>
                <input
                  type="date"
                  value={draft.confirmed_start_date || ''}
                  onChange={e => setDraft(d => ({ ...d, confirmed_start_date: e.target.value || null }))}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Est. Duration (days)</label>
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={draft.estimated_duration_days ?? ''}
                  placeholder={String(historicalAvgs[entry.phase_name] || 14)}
                  onChange={e => setDraft(d => ({ ...d, estimated_duration_days: e.target.value ? parseInt(e.target.value) : null }))}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Actual Start Date</label>
                <input
                  type="date"
                  value={draft.actual_start_date || ''}
                  onChange={e => setDraft(d => ({ ...d, actual_start_date: e.target.value || null }))}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Actual End Date</label>
                <input
                  type="date"
                  value={draft.actual_end_date || ''}
                  onChange={e => setDraft(d => ({ ...d, actual_end_date: e.target.value || null }))}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Quoted Labor Hours</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={draft.quoted_labor_hours ?? ''}
                  onChange={e => setDraft(d => ({ ...d, quoted_labor_hours: e.target.value ? parseFloat(e.target.value) : null }))}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Quoted Material Cost ($)</label>
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={draft.quoted_material_cost ?? ''}
                  onChange={e => setDraft(d => ({ ...d, quoted_material_cost: e.target.value ? parseFloat(e.target.value) : null }))}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Payment Trigger (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={draft.payment_trigger_pct}
                  onChange={e => setDraft(d => ({ ...d, payment_trigger_pct: parseFloat(e.target.value) || 0 }))}
                  style={inputStyle}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button
                  onClick={handleSave}
                  style={{
                    background: '#3b82f6',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '6px 16px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    width: '100%',
                    minHeight: '32px',
                  }}
                >
                  Save Phase
                </button>
              </div>
            </div>
          ) : (
            /* Read-only expanded view */
            hasFieldData && (
              <div>
                {/* Quoted vs Actual comparison (only shown after phase starts) */}
                {(num(entry.quoted_labor_hours) > 0 || actualHrs > 0 || num(entry.quoted_material_cost) > 0 || actualMat > 0) && (
                  <div style={{ marginTop: '8px' }}>
                    <div style={{ fontSize: '10px', color: '#6b7280', marginBottom: '6px', letterSpacing: '0.05em' }}>
                      QUOTED vs ACTUAL
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '6px' }}>
                      {[
                        { label: 'Quoted Hrs', val: num(entry.quoted_labor_hours).toFixed(1), color: '#9ca3af' },
                        { label: 'Actual Hrs', val: actualHrs.toFixed(1), color: actualHrs > num(entry.quoted_labor_hours) ? '#ef4444' : '#10b981' },
                        { label: 'Quoted Mat', val: fmt$(num(entry.quoted_material_cost)), color: '#9ca3af' },
                        { label: 'Actual Mat', val: fmt$(actualMat), color: actualMat > num(entry.quoted_material_cost) ? '#ef4444' : '#10b981' },
                      ].map(item => (
                        <div key={item.label} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '4px', padding: '6px 8px' }}>
                          <div style={{ fontSize: '9px', color: '#6b7280' }}>{item.label}</div>
                          <div style={{ fontSize: '13px', fontWeight: 700, color: item.color, fontFamily: 'monospace' }}>{item.val || '—'}</div>
                        </div>
                      ))}
                    </div>
                    {num(entry.quoted_labor_hours) > 0 && actualHrs > 0 && (
                      <div style={{ marginTop: '5px', fontSize: '10px' }}>
                        <span style={{ color: '#6b7280' }}>Labor variance: </span>
                        <span style={{ color: actualHrs - num(entry.quoted_labor_hours) > 0 ? '#ef4444' : '#10b981', fontWeight: 600 }}>
                          {(actualHrs - num(entry.quoted_labor_hours) > 0 ? '+' : '') + (actualHrs - num(entry.quoted_labor_hours)).toFixed(1)} hrs
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface V15rPhaseTimelineTabProps {
  projectId: string
  onUpdate?: () => void
  backup?: any
}

export default function V15rPhaseTimelineTab({
  projectId,
  onUpdate,
  backup: initialBackup,
}: V15rPhaseTimelineTabProps) {
  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])
  const [sectionOpen, setSectionOpen] = useState(true)
  const [depositPct, setDepositPct] = useState<number | null>(null)

  const backup = initialBackup || getBackupData()
  if (!backup) return <div style={{ color: '#6b7280', padding: '16px' }}>No data</div>

  const project = (backup.projects || []).find((p: any) => p.id === projectId)
  if (!project) return <div style={{ color: '#6b7280', padding: '16px' }}>Project not found</div>

  const weights = getPhaseWeights(backup)
  const timeline = normalizePhaseTimeline(project, backup)
  const projectLogs = (backup.logs || []).filter((l: any) =>
    l.projId === projectId || l.projectId === projectId
  )

  // Build historical averages from all projects
  const historicalAvgs: Record<string, number> = {}
  for (const p of backup.projects || []) {
    for (const e of (p.phase_timeline || [])) {
      if (!e.actual_start_date || !e.actual_end_date) continue
      const s = new Date(e.actual_start_date + 'T00:00:00')
      const en = new Date(e.actual_end_date + 'T00:00:00')
      if (isNaN(s.getTime()) || isNaN(en.getTime())) continue
      const days = Math.round((en.getTime() - s.getTime()) / 86400000)
      if (days < 1 || days > 365) continue
      if (!historicalAvgs[e.phase_name]) historicalAvgs[e.phase_name] = days
      else historicalAvgs[e.phase_name] = Math.round((historicalAvgs[e.phase_name] + days) / 2)
    }
  }

  const currentDepositPct = depositPct ?? num(project.deposit_pct ?? 10)

  const handlePhaseEntryUpdate = (updatedEntry: PhaseTimelineEntry) => {
    const b = getBackupData()
    if (!b) return
    const projects = b.projects || []
    const idx = projects.findIndex((p: any) => p.id === projectId)
    if (idx === -1) return

    const proj = projects[idx]
    const existingTimeline: PhaseTimelineEntry[] = proj.phase_timeline
      ? [...proj.phase_timeline]
      : []
    const entryIdx = existingTimeline.findIndex(e => e.phase_name === updatedEntry.phase_name)
    if (entryIdx === -1) existingTimeline.push(updatedEntry)
    else existingTimeline[entryIdx] = updatedEntry

    const updatedProjects = [...projects]
    updatedProjects[idx] = { ...proj, phase_timeline: existingTimeline }
    pushState(b)
    saveBackupData({ ...b, projects: updatedProjects, _lastSavedAt: Date.now() })
    forceUpdate()
    if (onUpdate) onUpdate()
  }

  const handleDepositSave = () => {
    const b = getBackupData()
    if (!b) return
    const projects = b.projects || []
    const idx = projects.findIndex((p: any) => p.id === projectId)
    if (idx === -1) return
    const updatedProjects = [...projects]
    updatedProjects[idx] = { ...projects[idx], deposit_pct: currentDepositPct }
    pushState(b)
    saveBackupData({ ...b, projects: updatedProjects, _lastSavedAt: Date.now() })
    forceUpdate()
    if (onUpdate) onUpdate()
  }

  // Payment schedule summary
  const schedule = (() => {
    try {
      return getPhasePaymentSchedule({ ...project, phase_timeline: timeline }, backup.projects || [])
    } catch { return [] }
  })()

  const totalTriggerPct = timeline.reduce((s, e) => s + num(e.payment_trigger_pct), 0)
  const contractVal = num(project.contract)

  return (
    <div style={{ padding: '4px 0' }}>
      {/* ── Section header ── */}
      <div
        onClick={() => setSectionOpen(o => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          padding: '12px 0 10px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          marginBottom: '14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '16px' }}>📅</span>
          <div>
            <div style={{ color: '#e5e7eb', fontWeight: 700, fontSize: '15px' }}>Phase Timeline</div>
            <div style={{ color: '#6b7280', fontSize: '11px' }}>
              Cash flow projection · Payment schedule · Quote vs actual
            </div>
          </div>
        </div>
        <span style={{ color: '#4b5563', fontSize: '13px' }}>{sectionOpen ? '▲' : '▼'}</span>
      </div>

      {sectionOpen && (
        <>
          {/* ── Deposit config row ── */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              background: 'rgba(245,158,11,0.07)',
              border: '1px solid rgba(245,158,11,0.2)',
              borderRadius: '6px',
              padding: '10px 12px',
              marginBottom: '14px',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ color: '#f59e0b', fontSize: '12px', fontWeight: 600 }}>💰 Deposit</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={currentDepositPct}
                onChange={e => setDepositPct(parseFloat(e.target.value) || 0)}
                style={{
                  width: '64px',
                  background: '#1a1d27',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: '4px',
                  padding: '4px 8px',
                  color: '#e5e7eb',
                  fontSize: '12px',
                  outline: 'none',
                }}
              />
              <span style={{ color: '#9ca3af', fontSize: '12px' }}>% of contract</span>
              {contractVal > 0 && (
                <span style={{ color: '#f59e0b', fontSize: '12px', fontFamily: 'monospace' }}>
                  = ${Math.round(contractVal * currentDepositPct / 100).toLocaleString()}
                </span>
              )}
            </div>
            <button
              onClick={handleDepositSave}
              style={{
                background: 'rgba(245,158,11,0.2)',
                border: '1px solid rgba(245,158,11,0.3)',
                borderRadius: '4px',
                color: '#f59e0b',
                fontSize: '11px',
                fontWeight: 600,
                padding: '4px 12px',
                cursor: 'pointer',
              }}
            >
              Save
            </button>
            <span style={{ color: '#6b7280', fontSize: '11px', marginLeft: 'auto' }}>
              Phase triggers: {totalTriggerPct.toFixed(0)}% · Remaining: {Math.max(0, 100 - currentDepositPct - totalTriggerPct).toFixed(0)}% at completion
            </span>
          </div>

          {/* ── Phase rows ── */}
          {timeline.map((entry, idx) => (
            <PhaseRow
              key={entry.phase_name}
              entry={entry}
              idx={idx}
              timeline={timeline}
              projectId={projectId}
              projectLogs={projectLogs}
              historicalAvgs={historicalAvgs}
              onSave={handlePhaseEntryUpdate}
            />
          ))}

          {/* ── Payment schedule summary ── */}
          {schedule.length > 0 && (
            <div style={{ marginTop: '16px' }}>
              <div style={{ fontSize: '10px', color: '#6b7280', letterSpacing: '0.05em', marginBottom: '8px' }}>
                PROJECTED PAYMENT SCHEDULE
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {schedule.map((evt, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 10px',
                      background: 'rgba(255,255,255,0.025)',
                      borderRadius: '4px',
                      fontSize: '12px',
                    }}
                  >
                    <span style={{ color: '#9ca3af', flex: 1 }}>{evt.phase}</span>
                    <span style={{ color: evt.estimated ? '#f59e0b' : '#d1d5db', marginRight: '12px', fontSize: '11px' }}>
                      {evt.date
                        ? evt.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
                        : 'TBD'}
                      {evt.estimated && ' ~'}
                    </span>
                    <span style={{ color: '#10b981', fontFamily: 'monospace', fontWeight: 600 }}>
                      ${evt.amount.toLocaleString()}
                    </span>
                    <span
                      style={{
                        marginLeft: '8px',
                        fontSize: '9px',
                        color: evt.type === 'deposit' ? '#f59e0b' : evt.type === 'final' ? '#a855f7' : '#6b7280',
                        background: 'rgba(255,255,255,0.05)',
                        padding: '1px 5px',
                        borderRadius: '4px',
                      }}
                    >
                      {evt.type === 'deposit' ? 'DEP' : evt.type === 'final' ? 'FINAL' : 'PHASE'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Empty state ── */}
          {timeline.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 16px', color: '#4b5563' }}>
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>📋</div>
              <div style={{ fontSize: '13px' }}>No phases configured yet.</div>
              <div style={{ fontSize: '11px', marginTop: '4px' }}>
                Add phase weights in Settings to enable the timeline.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
