// @ts-nocheck
import React, { useState, useCallback } from 'react'
import { Sparkles } from 'lucide-react'
import { getBackupData, saveBackupData } from '@/services/backupDataService'
import { pushState } from '@/services/undoRedoService'

interface V15rRFITabProps {
  projectId: string
  onUpdate?: () => void
  backup?: any
}

export default function V15rRFITab({ projectId, onUpdate, backup: initialBackup }: V15rRFITabProps) {
  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])
  const [editingId, setEditingId] = useState<string | null>(null)

  const backup = initialBackup || getBackupData()
  if (!backup) return <div style={{ color: 'var(--t3)' }}>No data</div>

  const p = backup.projects.find(x => x.id === projectId)
  if (!p) return <div style={{ color: 'var(--t3)' }}>Project not found</div>

  const rfis = (p.rfis || []).sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')))
  const openCount = rfis.filter(r => r.status !== 'answered').length

  const addRFI = () => {
    pushState()
    p.rfis = p.rfis || []
    const rfiNum = 'RFI-' + String(p.rfis.length + 1).padStart(3, '0')
    p.rfis.push({
      id: rfiNum,
      status: 'open',
      question: '',
      directedTo: '',
      submitted: new Date().toISOString().split('T')[0],
      response: '',
      costImpact: '',
      // Stage fields initialised so they always persist on first save
      stageRecorded: '',
      stageApplies: '',
    })
    saveBackupData(backup)
    forceUpdate()
    if (onUpdate) onUpdate()
  }

  const editRFI = (rfiId, field, value) => {
    // Always read fresh from localStorage so we never save a stale backup
    // (guards against the parent re-rendering with a new reference before this fires)
    const freshBackup = getBackupData()
    if (!freshBackup) return
    const freshProject = (freshBackup.projects || []).find(x => x.id === projectId)
    if (!freshProject) return
    pushState()
    const rfi = (freshProject.rfis || []).find(r => r.id === rfiId)
    if (rfi) {
      if (field === 'question') rfi.question = String(value)
      else if (field === 'directedTo') rfi.directedTo = String(value)
      else if (field === 'response') rfi.response = String(value)
      else if (field === 'costImpact') rfi.costImpact = String(value)
      else if (field === 'stageRecorded') rfi.stageRecorded = String(value)
      else if (field === 'stageApplies') rfi.stageApplies = String(value)
    }
    saveBackupData(freshBackup)
    forceUpdate()
    // Notify the parent (V15rProjectInner) to re-read from localStorage so the
    // updated stage values are reflected when the parent next renders.
    if (onUpdate) onUpdate()
  }

  const toggleStatus = (rfiId) => {
    const freshBackup = getBackupData()
    if (!freshBackup) return
    const freshProject = (freshBackup.projects || []).find(x => x.id === projectId)
    if (!freshProject) return
    pushState()
    const rfi = (freshProject.rfis || []).find(r => r.id === rfiId)
    if (rfi) {
      rfi.status = rfi.status === 'critical' ? 'open' : rfi.status === 'open' ? 'answered' : 'open'
    }
    saveBackupData(freshBackup)
    forceUpdate()
    if (onUpdate) onUpdate()
  }

  const delRFI = (rfiId) => {
    if (!confirm('Delete RFI?')) return
    const freshBackup = getBackupData()
    if (!freshBackup) return
    const freshProject = (freshBackup.projects || []).find(x => x.id === projectId)
    if (!freshProject) return
    pushState()
    freshProject.rfis = (freshProject.rfis || []).filter(r => r.id !== rfiId)
    saveBackupData(freshBackup)
    forceUpdate()
    if (onUpdate) onUpdate()
  }

  const statusBadgeColor = (status) => {
    if (status === 'answered') return { bg: '#10b981', text: '#fff' }
    if (status === 'critical') return { bg: '#ef4444', text: '#fff' }
    return { bg: '#f59e0b', text: '#000' }
  }

  return (
    <div style={{ backgroundColor: '#1a1d27', padding: '0' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {/* HEADER */}
        <div style={{ backgroundColor: '#232738', borderRadius: '8px', marginBottom: '16px', padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h4 style={{ color: 'var(--t1)', fontWeight: '600', margin: '0 0 4px 0' }}>RFI Tracker</h4>
            <p style={{ color: 'var(--t3)', fontSize: '12px', margin: '0' }}>
              {rfis.length} total · {openCount} open
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={addRFI}
              style={{
                padding: '8px 12px',
                backgroundColor: 'rgba(34,197,94,0.2)',
                color: '#22c55e',
                border: '1px solid rgba(34,197,94,0.3)',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              + Add RFI
            </button>
            <button
              onClick={() => alert('AI Analyze RFIs placeholder')}
              style={{
                padding: '8px 12px',
                backgroundColor: 'rgba(139,92,246,0.2)',
                color: '#a78bfa',
                border: '1px solid rgba(139,92,246,0.3)',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Sparkles size={14} />
              AI Analyze
            </button>
          </div>
        </div>

        {/* RFI LIST */}
        {rfis.length === 0 ? (
          <div
            style={{
              backgroundColor: '#232738',
              borderRadius: '8px',
              padding: '40px 16px',
              textAlign: 'center',
              color: 'var(--t3)',
              fontSize: '14px',
            }}
          >
            No RFIs yet. Add one to get started.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {rfis.map(r => {
              const colors = statusBadgeColor(r.status)
              return (
                <div
                  key={r.id}
                  style={{
                    backgroundColor: '#232738',
                    borderRadius: '8px',
                    padding: '16px',
                    borderLeft: `4px solid ${colors.bg}`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--t3)' }}>
                        {r.id}
                      </span>
                      <span
                        style={{
                          padding: '2px 8px',
                          backgroundColor: colors.bg,
                          color: colors.text,
                          borderRadius: '3px',
                          fontSize: '11px',
                          fontWeight: '600',
                        }}
                      >
                        {r.status.toUpperCase()}
                      </span>
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--t3)' }}>
                      {r.submitted} · {r.directedTo || '—'}
                    </span>
                  </div>

                  {/* Stage Recorded / Stage Applies dropdowns */}
                  <div style={{ display: 'flex', gap: '12px', marginBottom: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}>
                      <span style={{ fontSize: '11px', color: 'var(--t3)', whiteSpace: 'nowrap' }}>Stage Recorded</span>
                      <select
                        value={r.stageRecorded || ''}
                        onChange={e => editRFI(r.id, 'stageRecorded', e.target.value)}
                        style={{
                          flex: 1,
                          padding: '4px 6px',
                          backgroundColor: '#1e2130',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '4px',
                          color: r.stageRecorded ? 'var(--t1)' : 'var(--t3)',
                          fontSize: '11px',
                          cursor: 'pointer',
                        }}
                      >
                        <option value="">—</option>
                        <option value="Estimating">Estimating</option>
                        <option value="Underground">Underground</option>
                        <option value="Rough-In">Rough-In</option>
                        <option value="Trim">Trim</option>
                        <option value="Finish">Finish</option>
                        <option value="General">General</option>
                      </select>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}>
                      <span style={{ fontSize: '11px', color: 'var(--t3)', whiteSpace: 'nowrap' }}>Stage Applies</span>
                      <select
                        value={r.stageApplies || ''}
                        onChange={e => editRFI(r.id, 'stageApplies', e.target.value)}
                        style={{
                          flex: 1,
                          padding: '4px 6px',
                          backgroundColor: '#1e2130',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '4px',
                          color: r.stageApplies ? 'var(--t1)' : 'var(--t3)',
                          fontSize: '11px',
                          cursor: 'pointer',
                        }}
                      >
                        <option value="">—</option>
                        <option value="Estimating">Estimating</option>
                        <option value="Underground">Underground</option>
                        <option value="Rough-In">Rough-In</option>
                        <option value="Trim">Trim</option>
                        <option value="Finish">Finish</option>
                        <option value="General">General</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ marginBottom: '8px' }}>
                    <textarea
                      value={r.question || ''}
                      onChange={e => editRFI(r.id, 'question', e.target.value)}
                      placeholder="Question"
                      style={{
                        width: '100%',
                        minHeight: '60px',
                        padding: '8px 10px',
                        backgroundColor: '#1e2130',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '4px',
                        color: 'var(--t1)',
                        fontSize: '12px',
                        fontFamily: 'inherit',
                        resize: 'vertical',
                      }}
                    />
                  </div>

                  {r.costImpact && (
                    <div style={{ marginBottom: '8px', padding: '8px 10px', backgroundColor: 'rgba(245,158,11,0.1)', borderRadius: '4px', fontSize: '11px', color: '#f59e0b' }}>
                      ⚠ Cost Impact: {r.costImpact}
                    </div>
                  )}

                  {r.response && (
                    <div style={{ marginBottom: '8px', padding: '8px 10px', backgroundColor: 'rgba(16,185,129,0.1)', borderRadius: '4px', fontSize: '11px', color: '#10b981' }}>
                      ✓ {r.response}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {r.status === 'open' && (
                      <button
                        onClick={() => {
                          const resp = prompt('Response:')
                          if (resp !== null) {
                            editRFI(r.id, 'response', resp)
                            toggleStatus(r.id)
                          }
                        }}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: 'rgba(34,197,94,0.2)',
                          color: '#22c55e',
                          border: 'none',
                          borderRadius: '4px',
                          fontSize: '12px',
                          fontWeight: '600',
                          cursor: 'pointer',
                        }}
                      >
                        Mark Answered
                      </button>
                    )}
                    <button
                      onClick={() => toggleStatus(r.id)}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: 'rgba(245,158,11,0.2)',
                        color: '#f59e0b',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: '600',
                        cursor: 'pointer',
                      }}
                    >
                      {r.status === 'critical' ? '↓ Lower' : '↑ Critical'}
                    </button>
                    <button
                      onClick={() => delRFI(r.id)}
                      style={{
                        marginLeft: 'auto',
                        padding: '6px 12px',
                        backgroundColor: 'rgba(239,68,68,0.2)',
                        color: '#ef4444',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: '600',
                        cursor: 'pointer',
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
