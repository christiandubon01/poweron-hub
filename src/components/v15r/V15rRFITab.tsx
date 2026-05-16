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

const BASE_RFI_LABEL_OPTIONS = ['Default', 'Critical', 'Other trades']
const RFI_LABEL_COLOR_PALETTE = [
  { key: 'blue', bg: 'rgba(59,130,246,0.10)', text: '#93c5fd', border: 'rgba(59,130,246,0.22)' },
  { key: 'purple', bg: 'rgba(139,92,246,0.10)', text: '#c4b5fd', border: 'rgba(139,92,246,0.22)' },
  { key: 'teal', bg: 'rgba(20,184,166,0.10)', text: '#5eead4', border: 'rgba(20,184,166,0.22)' },
  { key: 'amber', bg: 'rgba(245,158,11,0.10)', text: '#fcd34d', border: 'rgba(245,158,11,0.22)' },
  { key: 'rose', bg: 'rgba(244,63,94,0.10)', text: '#fda4af', border: 'rgba(244,63,94,0.22)' },
  { key: 'cyan', bg: 'rgba(6,182,212,0.10)', text: '#67e8f9', border: 'rgba(6,182,212,0.22)' },
  { key: 'green', bg: 'rgba(34,197,94,0.10)', text: '#86efac', border: 'rgba(34,197,94,0.22)' },
]

function cleanRfiLabelName(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

function rfiLabelKey(value: unknown): string {
  return cleanRfiLabelName(value).toLowerCase()
}

function isDefaultRfiLabel(label: unknown): boolean {
  const key = rfiLabelKey(label)
  return !key || key === 'default'
}

function customLabelColorIndex(label: string): number {
  let hash = 0
  const key = rfiLabelKey(label)
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return hash % RFI_LABEL_COLOR_PALETTE.length
}

function nowDateTimeInputValue(): string {
  return dateTimeInputValue(new Date().toISOString())
}

function nextRfiId(existingRfis: any[]): string {
  const maxNum = (existingRfis || []).reduce((max, rfi) => {
    const match = String(rfi?.id || '').match(/^RFI-(\d+)$/i)
    if (!match) return max
    return Math.max(max, Number(match[1]) || 0)
  }, 0)
  return 'RFI-' + String(maxNum + 1).padStart(3, '0')
}

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
  const clean = cleanRfiLabelName(rfi?.label)
  if (clean) return clean
  if (rfi?.critical === true || rfi?.status === 'critical') return 'Critical'
  return 'Default'
}

export default function V15rRFITab({ projectId, onUpdate, backup: initialBackup }: V15rRFITabProps) {
  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addWarning, setAddWarning] = useState('')
  const [showLabelModal, setShowLabelModal] = useState(false)
  const [newLabelName, setNewLabelName] = useState('')
  const [addForm, setAddForm] = useState({
    question: '',
    questionAt: '',
    response: '',
    answerAt: '',
    stageRecorded: '',
    stageApplies: '',
    label: 'Default',
    solvedBy: '',
  })
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
  const customRfiLabels = Array.isArray(backup.settings?.rfiLabels)
    ? backup.settings.rfiLabels
      .map((label: any) => ({
        name: cleanRfiLabelName(typeof label === 'string' ? label : label?.name),
        colorKey: typeof label === 'object' && label ? label.colorKey : undefined,
      }))
      .filter((label: any) => label.name && !BASE_RFI_LABEL_OPTIONS.some(base => rfiLabelKey(base) === rfiLabelKey(label.name)))
    : []
  const discoveredRfiLabels = rfis
    .map((rfi: any) => cleanRfiLabelName(rfi?.label))
    .filter((label: string) => label && !BASE_RFI_LABEL_OPTIONS.some(base => rfiLabelKey(base) === rfiLabelKey(label)))
  const rfiLabelOptions = [
    ...BASE_RFI_LABEL_OPTIONS,
    ...customRfiLabels
      .map((label: any) => label.name)
      .concat(discoveredRfiLabels)
      .filter((name: string, idx: number, arr: string[]) => arr.findIndex(x => rfiLabelKey(x) === rfiLabelKey(name)) === idx),
  ]

  const openAddModal = () => {
    const firstPhase = phases[0] || ''
    setAddWarning('')
    setAddForm({
      question: '',
      questionAt: nowDateTimeInputValue(),
      response: '',
      answerAt: '',
      stageRecorded: firstPhase,
      stageApplies: firstPhase,
      label: 'Default',
      solvedBy: '',
    })
    setShowAddModal(true)
  }

  const closeAddModal = () => {
    setShowAddModal(false)
    setAddWarning('')
  }

  const createRFI = () => {
    if (!addForm.question.trim()) {
      setAddWarning('Question is required to create an RFI.')
      return
    }

    const freshBackup = getBackupData()
    if (!freshBackup) return
    const freshProject = (freshBackup.projects || []).find(x => x.id === projectId)
    if (!freshProject) return
    pushState()

    freshProject.rfis = freshProject.rfis || []
    const hasAnswer = !!addForm.response.trim()
    const isCritical = addForm.label === 'Critical'
    freshProject.rfis.push({
      id: nextRfiId(freshProject.rfis),
      status: hasAnswer ? 'answered' : isCritical ? 'critical' : 'open',
      question: addForm.question,
      directedTo: '',
      submitted: storedTimestampValue(addForm.questionAt, ''),
      response: addForm.response,
      costImpact: '',
      resolved_at: hasAnswer ? storedTimestampValue(addForm.answerAt || nowDateTimeInputValue(), '') : '',
      stageRecorded: normalizePhaseName(addForm.stageRecorded, phases),
      stageApplies: normalizePhaseName(addForm.stageApplies || addForm.stageRecorded, phases),
      label: addForm.label,
      critical: isCritical,
      solvedBy: addForm.solvedBy,
    })
    saveBackupDataAndSync(freshBackup, 'projects')
    closeAddModal()
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

  const closeLabelModal = () => {
    setShowLabelModal(false)
    setNewLabelName('')
  }

  const saveCustomLabel = () => {
    const clean = cleanRfiLabelName(newLabelName)
    if (!clean || isDefaultRfiLabel(clean)) return
    const isReserved = BASE_RFI_LABEL_OPTIONS.some(label => rfiLabelKey(label) === rfiLabelKey(clean))
    const alreadyExists = rfiLabelOptions.some(label => rfiLabelKey(label) === rfiLabelKey(clean))
    if (isReserved || alreadyExists) {
      closeLabelModal()
      return
    }

    const freshBackup = getBackupData()
    if (!freshBackup) return
    pushState()
    freshBackup.settings = freshBackup.settings || {}
    const existing = Array.isArray(freshBackup.settings.rfiLabels) ? freshBackup.settings.rfiLabels : []
    freshBackup.settings.rfiLabels = [
      ...existing,
      {
        name: clean,
        colorKey: RFI_LABEL_COLOR_PALETTE[customLabelColorIndex(clean)].key,
      },
    ]
    saveBackupDataAndSync(freshBackup, 'settings')
    closeLabelModal()
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
    if (status === 'answered') return { bg: 'rgba(16,185,129,0.13)', text: '#86efac', border: 'rgba(16,185,129,0.24)' }
    if (status === 'critical') return { bg: 'rgba(239,68,68,0.13)', text: '#fca5a5', border: 'rgba(239,68,68,0.24)' }
    return { bg: 'rgba(245,158,11,0.13)', text: '#fbbf24', border: 'rgba(245,158,11,0.22)' }
  }

  const labelBadgeColor = (label: string) => {
    if (label === 'Critical') {
      return { bg: 'rgba(239,68,68,0.10)', text: '#fca5a5', border: 'rgba(239,68,68,0.22)' }
    }
    if (label === 'Other trades') {
      return { bg: 'rgba(99,102,241,0.10)', text: '#a5b4fc', border: 'rgba(99,102,241,0.22)' }
    }
    if (isDefaultRfiLabel(label)) {
      return { bg: 'rgba(148,163,184,0.08)', text: '#cbd5e1', border: 'rgba(148,163,184,0.16)' }
    }
    const saved = customRfiLabels.find((custom: any) => rfiLabelKey(custom.name) === rfiLabelKey(label))
    const byKey = saved?.colorKey
      ? RFI_LABEL_COLOR_PALETTE.find(color => color.key === saved.colorKey)
      : null
    return byKey || RFI_LABEL_COLOR_PALETTE[customLabelColorIndex(label)]
  }

  const displayTimestamp = (value: unknown): string => {
    const raw = String(value || '').trim()
    if (!raw) return '—'
    return raw.replace('T', ' ')
  }

  const displayStage = (value: unknown): string => {
    const normalized = normalizePhaseName(value || '', phases)
    return normalized || 'Not set'
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
      <style>{`
        @keyframes rfi-tracker-glass-sweep {
          0% { transform: translateX(-125%) skewX(-18deg); opacity: 0; }
          14% { opacity: 0.58; }
          52% { opacity: 0.42; }
          88% { opacity: 0; }
          100% { transform: translateX(225%) skewX(-18deg); opacity: 0; }
        }
        .rfi-tracker-header-sweep::before {
          content: '';
          position: absolute;
          inset: 0 auto 0 0;
          width: 36%;
          background: linear-gradient(
            115deg,
            rgba(255, 255, 255, 0) 0%,
            rgba(125, 211, 252, 0.10) 35%,
            rgba(207, 250, 254, 0.34) 50%,
            rgba(45, 212, 191, 0.10) 65%,
            rgba(255, 255, 255, 0) 100%
          );
          filter: blur(0.5px);
          animation: rfi-tracker-glass-sweep 4200ms cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite;
          will-change: transform, opacity;
        }
        @media (prefers-reduced-motion: reduce) {
          .rfi-tracker-header-sweep::before { animation: none; opacity: 0; }
        }
      `}</style>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {/* HEADER */}
        <div
          className="relative mb-4 overflow-hidden rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-slate-900 via-slate-950 to-cyan-950/60 p-4 shadow-lg shadow-blue-950/25"
          style={{ backdropFilter: 'blur(14px)' }}
        >
          <span aria-hidden="true" className="rfi-tracker-header-sweep pointer-events-none absolute inset-0 overflow-hidden rounded-2xl" />
          <div className="pointer-events-none absolute -left-16 -top-20 h-44 w-44 rounded-full bg-cyan-400/10 blur-3xl" />
          <div className="pointer-events-none absolute -right-12 -bottom-24 h-48 w-48 rounded-full bg-blue-500/10 blur-3xl" />

          <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/10 shadow-inner shadow-cyan-950/40">
                <span className="h-2.5 w-2.5 rounded-full bg-cyan-300 shadow-[0_0_16px_rgba(103,232,249,0.85)]" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-cyan-300/80">Project RFIs</p>
                <h4 className="mt-1 text-xl font-bold leading-tight text-gray-100">RFI Tracker</h4>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <p className="m-0 text-xs font-medium text-gray-400">
                    {rfis.length} total · {openCount} open
                  </p>
                  <span className="rounded-full border border-blue-400/20 bg-blue-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-200">
                    Total {rfis.length}
                  </span>
                  <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-200">
                    Open {openCount}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={openAddModal}
                className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-300 shadow-sm shadow-emerald-950/20 transition-colors hover:bg-emerald-400/15"
              >
                + Add RFI
              </button>
              <button
                type="button"
                onClick={() => setShowLabelModal(true)}
                className="rounded-lg border border-blue-400/25 bg-blue-400/10 px-3 py-2 text-xs font-bold text-blue-200 shadow-sm shadow-blue-950/20 transition-colors hover:bg-blue-400/15"
              >
                + Label
              </button>
              <button
                type="button"
                onClick={() => alert('AI Analyze RFIs placeholder')}
                className="flex items-center gap-1.5 rounded-lg border border-violet-400/25 bg-violet-400/10 px-3 py-2 text-xs font-bold text-violet-300 shadow-sm shadow-violet-950/20 transition-colors hover:bg-violet-400/15"
              >
                <Sparkles size={14} />
                AI Analyze
              </button>
            </div>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {rfis.map(r => {
              const label = getRfiLabel(r)
              const isCritical = r.status === 'critical' || r.critical === true || label === 'Critical'
              const showLabelPill = !isDefaultRfiLabel(label) || isCritical
              const isResolved = r.status === 'answered' || r.status === 'resolved'
              const displayStatus = isResolved ? 'answered' : 'open'
              const colors = statusBadgeColor(displayStatus)
              const labelColors = labelBadgeColor(label)
              const responseText = r.response || r.answer || ''
              const createdValue = r[questionTimestampField(r)] || r.submitted || ''
              const answeredValue = r[answerTimestampField(r)] || ''
              const createdDate = createdValue ? new Date(createdValue) : null
              const endDate = isResolved && answeredValue ? new Date(answeredValue) : new Date()
              const daysOpen = createdDate
                ? Math.max(0, Math.floor((endDate.getTime() - createdDate.getTime()) / 86400000))
                : null
              const daysColor = daysOpen === null ? 'var(--t3)' : daysOpen > 30 ? '#ef4444' : daysOpen > 14 ? '#f59e0b' : 'var(--t3)'
              const stageRecorded = displayStage(r.stageRecorded)
              const stageApplies = displayStage(r.stageApplies)
              const cardAccent = isCritical ? '#ef4444' : isResolved ? '#10b981' : '#f59e0b'
              return (
                <div
                  key={r.id}
                  style={{
                    background: 'linear-gradient(180deg, rgba(35,39,56,0.94), rgba(29,33,45,0.94))',
                    borderRadius: '10px',
                    padding: '12px 14px',
                    border: '1px solid rgba(148,163,184,0.10)',
                    borderLeft: `3px solid ${cardAccent}`,
                    boxShadow: '0 10px 26px rgba(0,0,0,0.16)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '10px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#e5e7eb', fontWeight: '700', letterSpacing: '0.01em' }}>
                        {r.id || 'RFI'}
                      </span>
                      <span style={{ padding: '2px 7px', backgroundColor: colors.bg, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: '999px', fontSize: '9px', fontWeight: '700', letterSpacing: '0.04em' }}>
                        {displayStatus.toUpperCase()}
                      </span>
                      {showLabelPill && (
                        <span style={{ padding: '2px 7px', backgroundColor: labelColors.bg, color: labelColors.text, border: `1px solid ${labelColors.border}`, borderRadius: '999px', fontSize: '9px', fontWeight: '700', letterSpacing: '0.03em' }}>
                          {(isCritical ? 'Critical' : label).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px', flexWrap: 'wrap' }}>
                      <span style={{ color: 'var(--t3)', fontSize: '10px', fontWeight: '600' }}>
                        Created {displayTimestamp(createdValue)}
                      </span>
                      {answeredValue && (
                        <span style={{ color: '#86efac', fontSize: '10px', fontWeight: '600' }}>
                          Resolved {displayTimestamp(answeredValue)}
                        </span>
                      )}
                      {daysOpen !== null && (
                        <span style={{ color: daysColor, fontSize: '10px', fontWeight: '700' }}>
                          Open {daysOpen} {daysOpen === 1 ? 'day' : 'days'}
                        </span>
                      )}
                      <button
                        onClick={() => openEditModal(r)}
                        style={{
                          padding: '4px 8px',
                          backgroundColor: 'rgba(59,130,246,0.10)',
                          color: '#93c5fd',
                          border: '1px solid rgba(59,130,246,0.18)',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: '700',
                          cursor: 'pointer',
                        }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => delRFI(r.id)}
                        style={{
                          padding: '4px 8px',
                          backgroundColor: 'rgba(239,68,68,0.08)',
                          color: '#fca5a5',
                          border: '1px solid rgba(239,68,68,0.16)',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: '700',
                          cursor: 'pointer',
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '8px', marginBottom: '9px' }}>
                    <div style={{ padding: '7px 9px', backgroundColor: 'rgba(15,23,42,0.24)', borderRadius: '7px' }}>
                      <div style={{ color: 'var(--t3)', fontSize: '9px', fontWeight: '700', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: '2px' }}>
                        Stage Recorded
                      </div>
                      <div style={{ color: stageRecorded === 'Not set' ? 'var(--t3)' : '#dbeafe', fontSize: '12px', fontWeight: '600' }}>
                        {stageRecorded}
                      </div>
                    </div>
                    <div style={{ padding: '7px 9px', backgroundColor: 'rgba(15,23,42,0.24)', borderRadius: '7px' }}>
                      <div style={{ color: 'var(--t3)', fontSize: '9px', fontWeight: '700', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: '2px' }}>
                        Stage Applies
                      </div>
                      <div style={{ color: stageApplies === 'Not set' ? 'var(--t3)' : '#dbeafe', fontSize: '12px', fontWeight: '600' }}>
                        {stageApplies}
                      </div>
                    </div>
                  </div>

                  <div style={{ marginBottom: '8px', padding: '8px 10px', backgroundColor: 'rgba(15,23,42,0.28)', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', marginBottom: '5px', flexWrap: 'wrap' }}>
                      <span style={{ color: '#94a3b8', fontSize: '9px', fontWeight: '800', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Question</span>
                      {createdValue && <span style={{ color: 'var(--t3)', fontSize: '10px', fontWeight: '600' }}>{displayTimestamp(createdValue)}</span>}
                    </div>
                    <div style={{ color: r.question ? 'var(--t1)' : 'var(--t3)', fontSize: '12px', lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
                      {r.question || 'No question entered.'}
                    </div>
                  </div>

                  {r.costImpact && (
                    <div style={{ marginBottom: '8px', padding: '8px 10px', backgroundColor: 'rgba(245,158,11,0.1)', borderRadius: '4px', fontSize: '11px', color: '#f59e0b' }}>
                      ⚠ Cost Impact: {r.costImpact}
                    </div>
                  )}

                  <div
                    style={{
                      marginBottom: '10px',
                      padding: '8px 10px',
                      backgroundColor: responseText ? 'rgba(16,185,129,0.07)' : 'rgba(15,23,42,0.20)',
                      borderRadius: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', marginBottom: '5px', flexWrap: 'wrap' }}>
                      <span style={{ color: responseText ? '#86efac' : 'var(--t3)', fontSize: '9px', fontWeight: '800', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Answer</span>
                      {answeredValue && <span style={{ color: responseText ? '#86efac' : 'var(--t3)', fontSize: '10px', fontWeight: '600' }}>{displayTimestamp(answeredValue)}</span>}
                    </div>
                    <div style={{ color: responseText ? '#d1fae5' : 'var(--t3)', fontSize: '12px', lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
                      {responseText || 'No answer yet.'}
                    </div>
                    {r.solvedBy && (
                      <div style={{ marginTop: '6px', fontSize: '10px', color: 'var(--t3)' }}>
                        Solved by <span style={{ color: responseText ? '#86efac' : 'var(--t2)', fontWeight: '700' }}>{r.solvedBy}</span>
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
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
                          padding: '4px 9px',
                          backgroundColor: 'rgba(34,197,94,0.10)',
                          color: '#86efac',
                          border: '1px solid rgba(34,197,94,0.18)',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: '700',
                          cursor: 'pointer',
                        }}
                      >
                        Mark Answered
                      </button>
                    )}
                    <button
                      onClick={() => toggleCritical(r.id)}
                      style={{
                        padding: '4px 9px',
                        backgroundColor: 'rgba(245,158,11,0.10)',
                        color: '#fbbf24',
                        border: '1px solid rgba(245,158,11,0.18)',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: '700',
                        cursor: 'pointer',
                      }}
                    >
                      {isCritical ? '↓ Lower' : '↑ Critical'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ADD RFI MODAL */}
        {showAddModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ backgroundColor: 'rgba(0,0,0,0.74)', backdropFilter: 'blur(4px)' }}
            onClick={e => { if (e.target === e.currentTarget) closeAddModal() }}
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
                  <h2 className="text-xl font-bold text-white">Add RFI</h2>
                  <p className="text-sm text-gray-400 mt-1">Create a new request for information</p>
                </div>
                <button
                  onClick={closeAddModal}
                  className="text-gray-500 hover:text-white transition-colors leading-none"
                  aria-label="Close add RFI modal"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                <div>
                  <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">RFI Question</label>
                  <textarea
                    value={addForm.question}
                    onChange={e => {
                      setAddWarning('')
                      setAddForm(prev => ({ ...prev, question: e.target.value }))
                    }}
                    rows={4}
                    placeholder="Describe the question or clarification needed..."
                    className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-blue-500 outline-none transition-colors resize-y"
                    style={{ backgroundColor: 'var(--bg-input)' }}
                  />
                  {addWarning && (
                    <div style={{ color: '#fca5a5', fontSize: '11px', marginTop: '6px', fontWeight: '600' }}>
                      {addWarning}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Question Timestamp</label>
                    <input
                      type="datetime-local"
                      value={addForm.questionAt}
                      onChange={e => setAddForm(prev => ({ ...prev, questionAt: e.target.value }))}
                      className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-blue-500 outline-none transition-colors"
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Answer Timestamp</label>
                    <input
                      type="datetime-local"
                      value={addForm.answerAt}
                      onChange={e => setAddForm(prev => ({ ...prev, answerAt: e.target.value }))}
                      className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-blue-500 outline-none transition-colors"
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">RFI Answer</label>
                  <textarea
                    value={addForm.response}
                    onChange={e => setAddForm(prev => ({ ...prev, response: e.target.value }))}
                    rows={4}
                    placeholder="Optional answer, response, or resolution..."
                    className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-blue-500 outline-none transition-colors resize-y"
                    style={{ backgroundColor: 'var(--bg-input)' }}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Stage Recorded</label>
                    <select
                      value={addForm.stageRecorded}
                      onChange={e => {
                        const nextStage = e.target.value
                        setAddForm(prev => ({
                          ...prev,
                          stageRecorded: nextStage,
                          stageApplies: prev.stageApplies || nextStage,
                        }))
                      }}
                      className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-blue-500 outline-none transition-colors"
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    >
                      {renderPhaseOptions(addForm.stageRecorded)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Stage Applies</label>
                    <select
                      value={addForm.stageApplies}
                      onChange={e => setAddForm(prev => ({ ...prev, stageApplies: e.target.value }))}
                      className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-blue-500 outline-none transition-colors"
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    >
                      {renderPhaseOptions(addForm.stageApplies)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Solved by</label>
                  <input
                    type="text"
                    value={addForm.solvedBy}
                    onChange={e => setAddForm(prev => ({ ...prev, solvedBy: e.target.value }))}
                    placeholder="Optional"
                    className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-blue-500 outline-none transition-colors"
                    style={{ backgroundColor: 'var(--bg-input)' }}
                  />
                </div>

                <div>
                  <label className="block text-[10px] text-gray-400 uppercase font-bold mb-2">Label</label>
                  <div className="flex flex-wrap gap-2">
                    {rfiLabelOptions.map(option => {
                      const selected = addForm.label === option
                      const critical = option === 'Critical'
                      const otherTrades = option === 'Other trades'
                      const optionColors = labelBadgeColor(option)
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setAddForm(prev => ({ ...prev, label: option }))}
                          className="px-3 py-2 rounded-lg text-xs font-bold transition-colors"
                          style={{
                            backgroundColor: selected
                              ? critical
                                ? 'rgba(239,68,68,0.18)'
                                : otherTrades
                                  ? 'rgba(99,102,241,0.16)'
                                  : optionColors.bg
                              : 'rgba(15,23,42,0.35)',
                            color: selected
                              ? critical
                                ? '#fca5a5'
                                : otherTrades
                                  ? '#a5b4fc'
                                  : optionColors.text
                              : '#94a3b8',
                            border: selected
                              ? critical
                                ? '1px solid rgba(239,68,68,0.32)'
                                : otherTrades
                                  ? '1px solid rgba(99,102,241,0.32)'
                                  : `1px solid ${optionColors.border}`
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
                  onClick={closeAddModal}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-300 border border-gray-600 hover:text-white hover:border-gray-500 transition-colors"
                  style={{ backgroundColor: 'rgba(15,23,42,0.35)' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={createRFI}
                  className="px-4 py-2 rounded-lg text-sm font-bold text-white transition-colors"
                  style={{
                    background: 'linear-gradient(135deg, rgba(37,99,235,0.95), rgba(16,185,129,0.92))',
                    border: '1px solid rgba(96,165,250,0.35)',
                    boxShadow: '0 10px 26px rgba(37,99,235,0.22)',
                  }}
                >
                  Create RFI
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ADD RFI LABEL MODAL */}
        {showLabelModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ backgroundColor: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(3px)' }}
            onClick={e => { if (e.target === e.currentTarget) closeLabelModal() }}
          >
            <div
              className="w-full max-w-sm mx-4 rounded-xl shadow-2xl"
              style={{
                backgroundColor: 'var(--bg-card)',
                border: '1px solid rgba(148,163,184,0.22)',
                padding: '18px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '12px', marginBottom: '14px' }}>
                <div>
                  <h3 style={{ color: 'var(--t1)', fontSize: '16px', fontWeight: '700', margin: 0 }}>Add RFI Label</h3>
                  <p style={{ color: 'var(--t3)', fontSize: '12px', margin: '4px 0 0 0' }}>
                    Custom labels sync with the project backup.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeLabelModal}
                  style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', padding: '2px' }}
                  aria-label="Close add label modal"
                >
                  <X size={16} />
                </button>
              </div>
              <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Label name</label>
              <input
                type="text"
                value={newLabelName}
                onChange={e => setNewLabelName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') saveCustomLabel()
                  if (e.key === 'Escape') closeLabelModal()
                }}
                autoFocus
                placeholder="e.g. Inspector"
                className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-blue-500 outline-none transition-colors"
                style={{ backgroundColor: 'var(--bg-input)' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                <button
                  type="button"
                  onClick={closeLabelModal}
                  style={{
                    padding: '7px 12px',
                    backgroundColor: 'rgba(15,23,42,0.35)',
                    color: 'var(--t2)',
                    border: '1px solid rgba(148,163,184,0.18)',
                    borderRadius: '7px',
                    fontSize: '12px',
                    fontWeight: '600',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveCustomLabel}
                  style={{
                    padding: '7px 12px',
                    backgroundColor: 'rgba(59,130,246,0.18)',
                    color: '#93c5fd',
                    border: '1px solid rgba(59,130,246,0.28)',
                    borderRadius: '7px',
                    fontSize: '12px',
                    fontWeight: '700',
                    cursor: 'pointer',
                  }}
                >
                  Save Label
                </button>
              </div>
            </div>
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
                    {rfiLabelOptions.map(option => {
                      const selected = editForm.label === option
                      const critical = option === 'Critical'
                      const otherTrades = option === 'Other trades'
                      const optionColors = labelBadgeColor(option)
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setEditForm(prev => ({ ...prev, label: option }))}
                          className="px-3 py-2 rounded-lg text-xs font-bold transition-colors"
                          style={{
                            backgroundColor: selected
                              ? critical
                                ? 'rgba(239,68,68,0.18)'
                                : otherTrades
                                  ? 'rgba(99,102,241,0.16)'
                                  : optionColors.bg
                              : 'rgba(15,23,42,0.35)',
                            color: selected
                              ? critical
                                ? '#fca5a5'
                                : otherTrades
                                  ? '#a5b4fc'
                                  : optionColors.text
                              : '#94a3b8',
                            border: selected
                              ? critical
                                ? '1px solid rgba(239,68,68,0.32)'
                                : otherTrades
                                  ? '1px solid rgba(99,102,241,0.32)'
                                  : `1px solid ${optionColors.border}`
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
