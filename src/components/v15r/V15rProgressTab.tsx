// @ts-nocheck
import React, { useState, useCallback } from 'react'
import { getBackupData, saveBackupData, num, daysSince, getPhaseWeights } from '@/services/backupDataService'
import { pushState } from '@/services/undoRedoService'

interface V15rProgressTabProps {
  projectId: string
  onUpdate?: () => void
  backup?: any
}

const phaseColors = {
  Estimating: '#3b82f6',
  Planning: '#06b6d4',
  'Site Prep': '#f59e0b',
  'Rough-in': '#10b981',
  Finish: '#a855f7',
  Trim: '#ef4444',
}

export default function V15rProgressTab({ projectId, onUpdate, backup: initialBackup }: V15rProgressTabProps) {
  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])

  const backup = initialBackup || getBackupData()
  if (!backup) return <div style={{ color: 'var(--t3)' }}>No data</div>

  const p = backup.projects.find(x => x.id === projectId)
  if (!p) return <div style={{ color: 'var(--t3)' }}>Project not found</div>

  const w = getPhaseWeights(backup)
  const daysSinceMove = daysSince(p.lastMove)

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

  const overallCompletion = Math.round(
    Object.entries(w).reduce((s, [ph, wt]) => {
      const tot = Object.values(w).reduce((sum, v) => sum + v, 0) || 100
      const phases = p.phases || {}
      return s + (num(phases[ph]) * wt / tot)
    }, 0)
  )

  return (
    <div style={{ backgroundColor: '#1a1d27', padding: '0' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {/* OVERALL COMPLETION */}
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

        {/* HEALTH & STAGNANCY */}
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

        {/* PHASES */}
        {Object.entries(w).map(([ph, wt]) => {
          const v = num((p.phases || {})[ph] || 0)
          const tasks = (p.tasks || {})[ph] || []
          const clr = phaseColors[ph] || '#10b981'

          return (
            <div key={ph} style={{ backgroundColor: '#232738', borderRadius: '8px', marginBottom: '16px', overflow: 'hidden' }}>
              <div
                style={{
                  backgroundColor: clr + '15',
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                }}
              >
                <div style={{ width: '3px', height: '16px', borderRadius: '2px', backgroundColor: clr, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ color: 'var(--t1)', fontWeight: '600', marginBottom: '2px' }}>{ph}</div>
                  <div style={{ fontSize: '11px', color: 'var(--t3)' }}>
                    {wt}% weight · {tasks.length} task{tasks.length !== 1 ? 's' : ''}
                  </div>
                </div>
                <div style={{ width: '80px', height: '4px', backgroundColor: '#1e2130', borderRadius: '2px', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: v + '%',
                      height: '100%',
                      backgroundColor: clr,
                      transition: 'width 0.3s',
                    }}
                  />
                </div>
                <div style={{ color: clr, fontWeight: '600', minWidth: '30px', textAlign: 'right', fontFamily: 'monospace' }}>
                  {v}%
                </div>
              </div>

              <div style={{ padding: '12px 16px' }}>
                {tasks.length === 0 ? (
                  <div style={{ fontSize: '12px', color: 'var(--t3)', marginBottom: '12px' }}>
                    No tasks yet — add one below. Phase % can also be set directly.
                  </div>
                ) : (
                  <div style={{ marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {tasks.map(t => (
                      <div key={t.id} style={{ padding: '8px', backgroundColor: '#1e2130', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <input
                          type="text"
                          value={t.desc || ''}
                          onChange={e => editTask(ph, t.id, 'desc', e.target.value)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--t1)',
                            fontSize: '12px',
                            fontFamily: 'inherit',
                            outline: 'none',
                          }}
                        />
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={t.pct || 0}
                            onChange={e => editTask(ph, t.id, 'pct', e.target.value)}
                            style={{ flex: 1, accentColor: clr }}
                          />
                          <span style={{ fontSize: '11px', fontFamily: 'monospace', minWidth: '32px', textAlign: 'right' }}>
                            {t.pct || 0}%
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                          <input
                            type="number"
                            value={t.hrs || 0}
                            onChange={e => editTask(ph, t.id, 'hrs', e.target.value)}
                            step="0.5"
                            min="0"
                            style={{
                              width: '60px',
                              padding: '4px',
                              backgroundColor: '#0f1117',
                              border: '1px solid var(--bdr2)',
                              color: 'var(--t1)',
                              fontFamily: 'monospace',
                              borderRadius: '4px',
                              fontSize: '11px',
                            }}
                          />
                          <span style={{ fontSize: '11px', color: 'var(--t3)' }}>hours</span>
                          <button
                            onClick={() => delTask(ph, t.id)}
                            style={{
                              marginLeft: 'auto',
                              background: 'none',
                              border: 'none',
                              color: '#ef4444',
                              cursor: 'pointer',
                              fontSize: '14px',
                              padding: '0',
                            }}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', paddingTop: '8px', borderTop: '1px solid var(--bdr2)' }}>
                  <button
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
            </div>
          )
        })}
      </div>
    </div>
  )
}
