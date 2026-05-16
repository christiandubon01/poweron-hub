// @ts-nocheck
import React, { useState, useCallback } from 'react'
import { Sparkles, X } from 'lucide-react'
import { getBackupData, saveBackupDataAndSync } from '@/services/backupDataService'
import { pushState } from '@/services/undoRedoService'
import { getProjectPhaseNames, normalizePhaseName, isKnownProjectPhase } from '@/utils/v15rProjectPhases'

interface V15rRFITabProps {
  projectId: string
  onUpdate?: () => void
  backup?: any
}

const RFI_LABEL_OPTIONS = ['Default', 'Critical', 'Other trades']

function dateTimeInputValue(value: unknown): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00`
  const localMatch = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/)
  if (localMatch) return `${localMatch[1]}T${localMatch[2]}`
  const parsed = new Date(raw)
  if (isNaN(parsed.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
}

function storedTimestampValue(inputValue: string, previousValue: unknown): string {
  if (!inputValue) return ''
  const previous = String(previousValue || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(previous) && inputValue.endsWith('T00:00')) {
    return inputValue.slice(0, 10)
  }
  return inputValue
}

function questionTimestampField(rfi: any): string {
  if (Object.prototype.hasOwnProperty.call(rfi || {}, 'submitted')) return 'submitted'
  if (Object.prototype.hasOwnProperty.call(rfi || {}, 'created_at')) return 'created_at'
  if (Object.prototype.hasOwnProperty.call(rfi || {}, 'createdAt')) return 'createdAt'
  if (Object.prototype.hasOwnProperty.call(rfi || {}, 'questionAt')) return 'questionAt'
  return 'submitted'
}

function answerTimestampField(rfi: any): string {
  if (Object.prototype.hasOwnProperty.call(rfi || {}, 'resolved_at')) return 'resolved_at'
  if (Object.prototype.hasOwnProperty.call(rfi || {}, 'answered_at')) return 'answered_at'
  if (Object.prototype.hasOwnProperty.call(rfi || {}, 'answeredAt')) return 'answeredAt'
  if (Object.prototype.hasOwnProperty.call(rfi || {}, 'answerAt')) return 'answerAt'
  return 'resolved_at'
}

function responseField(rfi: any): string {
  if (Object.prototype.hasOwnProperty.call(rfi || {}, 'response')) return 'response'
  if (Object.prototype.hasOwnProperty.call(rfi || {}, 'answer')) return 'answer'
  return 'response'
}

function getRfiLabel(rfi: any): string {
  if (RFI_LABEL_OPTIONS.includes(rfi?.label)) return rfi.label
  if (rfi?.critical === true || rfi?.status === 'critical') return 'Critical'
  return 'Default'
}

export default function V15rRFITab({ projectId, onUpdate, backup: initialBackup }: V15rRFITabProps) {
  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({
    question: '',
    questionAt: '',
    response: '',
    answerAt: '',
    stageRecorded: '',
    stageApplies: '',
    label: 'Default',
    solvedBy: '',
  })

  const backup = initialBackup || getBackupData()
  if (!backup) return <div style={{ color: 'var(--t3)' }}>No data</div>

  const p = backup.projects.find(x => x.id === projectId)
  if (!p) return <div style={{ color: 'var(--t3)' }}>Project not found</div>

  const rfis = (p.rfis || []).sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')))
  const openCount = rfis.filter(r => r.status !== 'answered').length
  const phases = getProjectPhaseNames(backup)

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
    saveBackupDataAndSync(backup, 'projects')
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
      else if (field === 'stageRecorded') rfi.stageRecorded = normalizePhaseName(value, phases)
      else if (field === 'stageApplies') rfi.stageApplies = normalizePhaseName(value, phases)
    }
    saveBackupDataAndSync(freshBackup, 'projects')
    forceUpdate()
    // Notify the parent (V15rProjectInner) to re-read from localStorage so the
    // updated stage values are reflected when the parent next renders.
    if (onUpdate) onUpdate()
  }

  const openEditModal = (rfi: any) => {
    setEditingId(rfi.id)
    const qField = questionTimestampField(rfi)
    const aField = answerTimestampField(rfi)
    const respField = responseField(rfi)
    setEditForm({
      question: rfi.question || '',
      questionAt: dateTimeInputValue(rfi[qField]),
      response: rfi[respField] || '',
      answerAt: dateTimeInputValue(rfi[aField]),
      stageRecorded: normalizePhaseName(rfi.stageRecorded || '', phases),
      stageApplies: normalizePhaseName(rfi.stageApplies || '', phases),
      label: getRfiLabel(rfi),
      solvedBy: rfi.solvedBy || rfi.resolvedBy || '',
    })
  }

  const closeEditModal = () => {
    setEditingId(null)
  }

  const saveEditModal = () => {
    if (!editingId) return
    const freshBackup = getBackupData()
    if (!freshBackup) return
    const freshProject = (freshBackup.projects || []).find(x => x.id === projectId)
    if (!freshProject) return
    pushState()
    const rfi = (freshProject.rfis || []).find(r => r.id === editingId)
    if (rfi) {
      const qField = questionTimestampField(rfi)
      const aField = answerTimestampField(rfi)
      const respField = responseField(rfi)
      rfi.question = editForm.question
      rfi[respField] = editForm.response
      rfi[qField] = storedTimestampValue(editForm.questionAt, rfi[qField])
      rfi[aField] = storedTimestampValue(editForm.answerAt, rfi[aField])
      rfi.stageRecorded = normalizePhaseName(editForm.stageRecorded, phases)
      rfi.stageApplies = normalizePhaseName(editForm.stageApplies, phases)
      rfi.label = editForm.label
      rfi.solvedBy = editForm.solvedBy
      rfi.critical = editForm.label === 'Critical'
      if (editForm.label === 'Critical') {
        rfi.status = 'critical'
      } else if (rfi.status === 'critical') {
        rfi.status = 'open'
      }
    }
    saveBackupDataAndSync(freshBackup, 'projects')
    closeEditModal()
    forceUpdate()
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
      const nextStatus = rfi.status === 'critical' ? 'open' : rfi.status === 'open' ? 'answered' : 'open'
      rfi.status = nextStatus
      if (nextStatus === 'answered' || nextStatus === 'resolved') {
        if (!rfi.resolved_at) rfi.resolved_at = new Date().toISOString().split('T')[0]
      } else {
        rfi.resolved_at = ''
      }
    }
    saveBackupDataAndSync(freshBackup, 'projects')
    forceUpdate()
    if (onUpdate) onUpdate()
  }

  const toggleCritical = (rfiId) => {
    const freshBackup = getBackupData()
    if (!freshBackup) return
    const freshProject = (freshBackup.projects || []).find(x => x.id === projectId)
    if (!freshProject) return
    pushState()
    const rfi = (freshProject.rfis || []).find(r => r.id === rfiId)
    if (rfi) {
      const isCritical = rfi.status === 'critical' || rfi.critical === true || getRfiLabel(rfi) === 'Critical'
      if (isCritical) {
        rfi.critical = false
        if (rfi.label === 'Critical') rfi.label = 'Default'
        if (rfi.status === 'critical') rfi.status = 'open'
      } else {
        rfi.critical = true
        rfi.label = 'Critical'
        rfi.status = 'critical'
      }
    }
    saveBackupDataAndSync(freshBackup, 'projects')
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
    saveBackupDataAndSync(freshBackup, 'projects')
    forceUpdate()
    if (onUpdate) onUpdate()
  }

  const statusBadgeColor = (status) => {
    if (status === 'answered') return { bg: '#10b981', text: '#fff' }
    if (status === 'critical') return { bg: '#ef4444', text: '#fff' }
    return { bg: '#f59e0b', text: '#000' }
  }

  const renderPhaseOptions = (currentValue: string) => {
    const normalizedCurrent = normalizePhaseName(currentValue, phases)
    const showLegacy = normalizedCurrent && !isKnownProjectPhase(normalizedCurrent, phases)
    return (
      <>
        <option value="">—</option>
        {phases.map(phase => (
          <option key={phase} value={phase}>{phase}</option>
        ))}
        {showLegacy && <option value={normalizedCurrent}>Legacy: {normalizedCurrent}</option>}
      </>
    )
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
              const label = getRfiLabel(r)
              const displayStatus = r.status === 'critical' || r.critical === true || label === 'Critical' ? 'critical' : r.status
              const colors = statusBadgeColor(displayStatus)
              const responseText = r.response || r.answer || ''
              const isResolved = r.status === 'answered' || r.status === 'resolved'
              const createdDate = r.submitted ? new Date(r.submitted) : null
              const endDate = isResolved && r.resolved_at ? new Date(r.resolved_at) : new Date()
              const daysOpen = createdDate
                ? Math.max(0, Math.floor((endDate.getTime() - createdDate.getTime()) / 86400000))
                : null
              const daysColor = daysOpen === null ? 'var(--t3)' : daysOpen > 30 ? '#ef4444' : daysOpen > 14 ? '#f59e0b' : 'var(--t3)'
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
                        {String(displayStatus || 'open').toUpperCase()}
                      </span>
                      {label === 'Other trades' && (
                        <span style={{ padding: '2px 8px', backgroundColor: 'rgba(14,165,233,0.16)', color: '#7dd3fc', border: '1px solid rgba(14,165,233,0.28)', borderRadius: '3px', fontSize: '11px', fontWeight: '600' }}>
                          OTHER TRADES
                        </span>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '11px', color: 'var(--t3)' }}>
                        Created: {r.submitted || '—'} · {r.directedTo || '—'}
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--t3)', marginTop: '2px' }}>
                        Resolved: {isResolved && r.resolved_at ? r.resolved_at : '—'}
                        {daysOpen !== null && (
                          <span style={{ marginLeft: '8px', color: daysColor, fontWeight: daysOpen > 14 ? '600' : '400' }}>
                            Open {daysOpen} {daysOpen === 1 ? 'day' : 'days'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Stage Recorded / Stage Applies dropdowns */}
                  <div style={{ display: 'flex', gap: '12px', marginBottom: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}>
                      <span style={{ fontSize: '11px', color: 'var(--t3)', whiteSpace: 'nowrap' }}>Stage Recorded</span>
                      <select
                        value={normalizePhaseName(r.stageRecorded || '', phases)}
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
                        {renderPhaseOptions(r.stageRecorded || '')}
                      </select>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}>
                      <span style={{ fontSize: '11px', color: 'var(--t3)', whiteSpace: 'nowrap' }}>Stage Applies</span>
                      <select
                        value={normalizePhaseName(r.stageApplies || '', phases)}
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
                        {renderPhaseOptions(r.stageApplies || '')}
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

                  {responseText && (
                    <div style={{ marginBottom: '8px', padding: '8px 10px', backgroundColor: 'rgba(16,185,129,0.1)', borderRadius: '4px', fontSize: '11px', color: '#10b981' }}>
                      ✓ {responseText}
                    </div>
                  )}

                  {r.solvedBy && (
                    <div style={{ marginBottom: '8px', fontSize: '11px', color: 'var(--t3)' }}>
                      Solved by: <span style={{ color: 'var(--t2)', fontWeight: '600' }}>{r.solvedBy}</span>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <button
                      onClick={() => openEditModal(r)}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: 'rgba(59,130,246,0.18)',
                        color: '#60a5fa',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: '600',
                        cursor: 'pointer',
                      }}
                    >
                      Edit
                    </button>
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
                      onClick={() => toggleCritical(r.id)}
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
                      {displayStatus === 'critical' ? '↓ Lower' : '↑ Critical'}
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

        {/* EDIT RFI MODAL */}
        {editingId && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ backgroundColor: 'rgba(0,0,0,0.74)', backdropFilter: 'blur(4px)' }}
            onClick={e => { if (e.target === e.currentTarget) closeEditModal() }}
          >
            <div
              className="relative w-full max-w-3xl mx-4 rounded-2xl shadow-2xl flex flex-col"
              style={{
                backgroundColor: 'var(--bg-card)',
                border: '1px solid rgba(59,130,246,0.28)',
                maxHeight: '90vh',
                overflow: 'hidden',
                boxShadow: '0 24px 70px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.03) inset',
              }}
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/60 flex-shrink-0">
                <div>
                  <h2 className="text-xl font-bold text-white">Edit RFI</h2>
                  <p className="text-sm text-gray-400 mt-1">Update question, answer, phases, label, and ownership.</p>
                </div>
                <button
                  onClick={closeEditModal}
                  className="text-gray-500 hover:text-white transition-colors leading-none"
                  aria-label="Close edit RFI modal"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                <div>
                  <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">RFI Question</label>
                  <textarea
                    value={editForm.question}
                    onChange={e => setEditForm(prev => ({ ...prev, question: e.target.value }))}
                    rows={4}
                    placeholder="Describe the question or clarification needed..."
                    className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-blue-500 outline-none transition-colors resize-y"
                    style={{ backgroundColor: 'var(--bg-input)' }}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Question Timestamp</label>
                    <input
                      type="datetime-local"
                      value={editForm.questionAt}
                      onChange={e => setEditForm(prev => ({ ...prev, questionAt: e.target.value }))}
                      className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-blue-500 outline-none transition-colors"
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Answer Timestamp</label>
                    <input
                      type="datetime-local"
                      value={editForm.answerAt}
                      onChange={e => setEditForm(prev => ({ ...prev, answerAt: e.target.value }))}
                      className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-blue-500 outline-none transition-colors"
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">RFI Answer</label>
                  <textarea
                    value={editForm.response}
                    onChange={e => setEditForm(prev => ({ ...prev, response: e.target.value }))}
                    rows={4}
                    placeholder="Answer, response, or resolution..."
                    className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-blue-500 outline-none transition-colors resize-y"
                    style={{ backgroundColor: 'var(--bg-input)' }}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Stage Recorded</label>
                    <select
                      value={editForm.stageRecorded}
                      onChange={e => setEditForm(prev => ({ ...prev, stageRecorded: e.target.value }))}
                      className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-blue-500 outline-none transition-colors"
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    >
                      {renderPhaseOptions(editForm.stageRecorded)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Stage Applies</label>
                    <select
                      value={editForm.stageApplies}
                      onChange={e => setEditForm(prev => ({ ...prev, stageApplies: e.target.value }))}
                      className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-blue-500 outline-none transition-colors"
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    >
                      {renderPhaseOptions(editForm.stageApplies)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Solved by</label>
                  <input
                    type="text"
                    value={editForm.solvedBy}
                    onChange={e => setEditForm(prev => ({ ...prev, solvedBy: e.target.value }))}
                    placeholder="Name of the person who solved or handled this"
                    className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-blue-500 outline-none transition-colors"
                    style={{ backgroundColor: 'var(--bg-input)' }}
                  />
                </div>

                <div>
                  <label className="block text-[10px] text-gray-400 uppercase font-bold mb-2">Label</label>
                  <div className="flex flex-wrap gap-2">
                    {RFI_LABEL_OPTIONS.map(option => {
                      const selected = editForm.label === option
                      const critical = option === 'Critical'
                      const otherTrades = option === 'Other trades'
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setEditForm(prev => ({ ...prev, label: option }))}
                          className="px-3 py-2 rounded-lg text-xs font-bold transition-colors"
                          style={{
                            backgroundColor: selected
                              ? critical
                                ? 'rgba(239,68,68,0.22)'
                                : otherTrades
                                  ? 'rgba(14,165,233,0.22)'
                                  : 'rgba(148,163,184,0.18)'
                              : 'rgba(15,23,42,0.35)',
                            color: selected
                              ? critical
                                ? '#fca5a5'
                                : otherTrades
                                  ? '#7dd3fc'
                                  : '#e5e7eb'
                              : '#94a3b8',
                            border: selected
                              ? critical
                                ? '1px solid rgba(239,68,68,0.45)'
                                : otherTrades
                                  ? '1px solid rgba(14,165,233,0.45)'
                                  : '1px solid rgba(148,163,184,0.35)'
                              : '1px solid rgba(148,163,184,0.15)',
                          }}
                        >
                          {option}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-700/60 flex-shrink-0">
                <button
                  type="button"
                  onClick={closeEditModal}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-300 border border-gray-600 hover:text-white hover:border-gray-500 transition-colors"
                  style={{ backgroundColor: 'rgba(15,23,42,0.35)' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveEditModal}
                  className="px-4 py-2 rounded-lg text-sm font-bold text-white transition-colors"
                  style={{
                    background: 'linear-gradient(135deg, rgba(37,99,235,0.95), rgba(16,185,129,0.92))',
                    border: '1px solid rgba(96,165,250,0.35)',
                    boxShadow: '0 10px 26px rgba(37,99,235,0.22)',
                  }}
                >
                  Save Updates
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
