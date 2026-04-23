// @ts-nocheck
/**
 * V15rProjectsPanel — Projects panel grouped by Active / Coming / Completed.
 * Faithfully ported from HTML renderProjects().
 *
 * Each card shows: health score (0-100), progress bar, quoted/paid/exposure,
 * chips (stale days, completion %, open RFIs), edit/delete/move-status buttons.
 */

import React, { useState, useCallback, useEffect } from 'react'
import { Plus, Edit3, Trash2, ArrowRight, RotateCcw, Eye, FileText, X } from 'lucide-react'
import {
  getBackupData,
  saveBackupData,
  saveBackupDataAndSync,
  health,
  getOverallCompletion,
  getProjectFinancials,
  resolveProjectBucket,
  daysSince,
  fmtK,
  fmt,
  pct,
  num,
  syncAllProjectFinanceBuckets,
  type BackupProject,
} from '@/services/backupDataService'
import { pushState } from '@/services/undoRedoService'
import QuickBooksImportModal from './QuickBooksImportModal'
import { useDemoMode } from '@/store/demoStore'
import { getDemoBackupData } from '@/services/demoDataService'

interface Props {
  onSelectProject?: (projectId: string) => void
  prefillFromLead?: { name?: string; customer?: string; contract?: number; type?: string; notes?: string; leadId?: string; leadType?: string } | null
  onPrefillUsed?: () => void
}

const JOB_TYPES = ['Residential', 'Commercial', 'Service', 'Solar', 'New Construction', 'Commercial TI']
const STATUS_OPTIONS = ['active', 'coming']
const DEFAULT_PHASES = { Planning: 0, Estimating: 0, 'Site Prep': 0, 'Rough-in': 0, Trim: 0, Finish: 0 }

function fmtDate(dateStr?: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function V15rProjectsPanel({ onSelectProject, prefillFromLead, onPrefillUsed }: Props) {
  const { isDemoMode, hasHydrated } = useDemoMode()
  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])
  useEffect(() => {
    const handler = () => forceUpdate()
    window.addEventListener('poweron-data-saved', handler)
    return () => window.removeEventListener('poweron-data-saved', handler)
  }, [forceUpdate])
  const [showQBImport, setShowQBImport] = useState(false)
  const [showNewProject, setShowNewProject] = useState(false)

  // New Project form state
  const [npName, setNpName] = useState('')
  const [npClient, setNpClient] = useState('')
  const [npContract, setNpContract] = useState('')
  const [npType, setNpType] = useState('Residential')
  const [npStartDate, setNpStartDate] = useState(new Date().toISOString().slice(0, 10))
  const [npStatus, setNpStatus] = useState('active')
  const [npNotes, setNpNotes] = useState('')
  // DASHBOARD-START-DATE-GATE-AND-PERSIST-APR22-2026-1 — "Start Date" input is the single
  // source of truth for project start and now writes to p.plannedStart. The old
  // npPlannedStart state is retired; Planned Start is no longer a separate user field.
  const [npPlannedEnd, setNpPlannedEnd] = useState('')

  // Collect modal state
  const [collectProject, setCollectProject] = useState<BackupProject | null>(null)
  const [collectPartialInput, setCollectPartialInput] = useState('')
  const [collectLoggingPartial, setCollectLoggingPartial] = useState(false)

  // Edit Project modal state
  const [showEditProject, setShowEditProject] = useState(false)
  const [editProjectId, setEditProjectId] = useState<string | null>(null)
  const [epName, setEpName] = useState('')
  const [epClient, setEpClient] = useState('')
  const [epContract, setEpContract] = useState('')
  const [epType, setEpType] = useState('Residential')
  const [epStartDate, setEpStartDate] = useState('')
  const [epStatus, setEpStatus] = useState('active')
  const [epNotes, setEpNotes] = useState('')
  // DASHBOARD-START-DATE-GATE-AND-PERSIST-APR22-2026-1 — epPlannedStart retired; "Start Date" now writes to plannedStart.
  const [epPlannedEnd, setEpPlannedEnd] = useState('')

  const backup = (hasHydrated && isDemoMode) ? getDemoBackupData() : getBackupData()

  // Handle prefill from lead conversion
  if (prefillFromLead && !showNewProject) {
    setNpName(prefillFromLead.name || prefillFromLead.customer || '')
    setNpClient(prefillFromLead.customer || '')
    setNpContract(prefillFromLead.contract ? String(prefillFromLead.contract) : '')
    setNpType(prefillFromLead.type || 'Residential')
    setNpNotes(prefillFromLead.notes || '')
    setShowNewProject(true)
    onPrefillUsed?.()
  }

  function openNewProjectModal() {
    setNpName(''); setNpClient(''); setNpContract(''); setNpType('Residential')
    setNpStartDate(new Date().toISOString().slice(0, 10)); setNpStatus('active'); setNpNotes('')
    setNpPlannedEnd('')
    setShowNewProject(true)
  }

  function openEditProjectModal(p: BackupProject) {
    setEditProjectId(p.id)
    setEpName(p.name || '')
    setEpClient((p as any).client || '')
    setEpContract(String(p.contract || 0))
    setEpType(p.type || 'Residential')
    // DASHBOARD-START-DATE-GATE-AND-PERSIST-APR22-2026-1 — "Start Date" reads from plannedStart,
    // not lastMove. lastMove is the auto-updated movement timestamp; plannedStart is the
    // user-entered project start date that feeds the CFOT chart gate.
    setEpStartDate(p.plannedStart ? p.plannedStart.slice(0, 10) : '')
    setEpStatus(p.status || 'active')
    setEpNotes((p as any).notes || '')
    setEpPlannedEnd(p.plannedEnd || '')
    setShowEditProject(true)
  }

  function saveNewProject() {
    if (!npName.trim()) { alert('Project name is required.'); return }
    if (!backup) return
    pushState(backup)
    const id = 'proj' + Date.now() + Math.random().toString(36).slice(2, 6)
    const newProj: any = {
      id,
      name: npName.trim(),
      client: npClient.trim(),
      type: npType,
      status: npStatus,
      contract: num(npContract),
      billed: 0,
      paid: 0,
      mileRT: 0,
      miDays: 0,
      phases: { ...DEFAULT_PHASES },
      tasks: { Planning: [], Estimating: [], 'Site Prep': [], 'Rough-in': [], Trim: [], Finish: [] },
      laborRows: [],
      ohRows: [],
      matRows: [],
      mtoRows: [],
      rfis: [],
      coord: {},
      logs: [],
      finance: {},
      lastMove: npStartDate,
      notes: npNotes.trim(),
      created: new Date().toISOString(),
      // DASHBOARD-START-DATE-GATE-AND-PERSIST-APR22-2026-1 — "Start Date" input writes here.
      plannedStart: npStartDate || undefined,
      plannedEnd: npPlannedEnd || undefined,
    }
    // If converted from a lead, add conversion tracking fields
    if (prefillFromLead?.leadId) {
      newProj.convertedFromLeadId = prefillFromLead.leadId
      newProj.convertedFromLeadType = prefillFromLead.leadType || 'unknown'
    }
    backup.projects = [...(backup.projects || []), newProj]
    saveBackupDataAndSync(backup)
    setShowNewProject(false)
    forceUpdate()
  }

  function saveEditProject() {
    if (!epName.trim()) { alert('Project name is required.'); return }
    if (!backup || !editProjectId) return
    pushState(backup)
    const p = (backup.projects || []).find((x: any) => x.id === editProjectId)
    if (!p) return
    p.name = epName.trim()
    ;(p as any).client = epClient.trim()
    p.contract = num(epContract)
    p.type = epType
    p.status = epStatus
    p.lastMove = epStartDate
    ;(p as any).notes = epNotes.trim()
    // DASHBOARD-START-DATE-GATE-AND-PERSIST-APR22-2026-1 — "Start Date" input writes to plannedStart.
    p.plannedStart = epStartDate || undefined
    p.plannedEnd = epPlannedEnd || undefined
    saveBackupDataAndSync(backup)
    setShowEditProject(false)
    setEditProjectId(null)
    forceUpdate()
  }

  if (!backup) {
    return (
      <div className="flex items-center justify-center w-full h-64 bg-[var(--bg-secondary)]">
        <div className="text-gray-500 text-sm">No backup data. Import to view projects.</div>
      </div>
    )
  }

  const projects = backup.projects || []
  syncAllProjectFinanceBuckets(backup)

  function persist() {
    backup._lastSavedAt = new Date().toISOString()
    saveBackupData(backup)
    forceUpdate()
  }

  function deleteProject(id: string) {
    if (!confirm('Delete this project? This cannot be undone.')) return
    backup.projects = projects.filter(p => p.id !== id)
    // Also remove related logs
    backup.logs = (backup.logs || []).filter(l => l.projId !== id)
    persist()
  }

  function moveStatus(id: string, newStatus: string) {
    const p = projects.find(x => x.id === id)
    if (!p) return
    p.status = newStatus
    if (newStatus === 'completed') p.completedAt = new Date().toISOString()
    persist()
  }

  // ── Collection payment handlers ───────────────────────────────────────────

  function handleMarkFullPayment(p: BackupProject) {
    const fin = getProjectFinancials(p, backup)
    pushState()
    p.paid = num(fin.contract)
    p.lastCollectedAt = new Date().toISOString()
    p.lastCollectedAmount = num(fin.contract)

    // Sync to any service log entries linked to this project via project_id field.
    // BackupServiceLog has no project_id by default — this handles future-linked entries.
    // No direct link exists in current schema; project_id must be set when creating service logs.
    const svcLogs = backup.serviceLogs || []
    svcLogs.forEach((sl: any) => {
      if (sl.project_id === p.id) {
        sl.collected = num(fin.contract)
        sl.payStatus = 'Y'
        sl.balanceDue = 0
        if (!sl.project_name) sl.project_name = p.name
      }
    })

    saveBackupData(backup)
    setCollectProject(null)
    forceUpdate()
  }

  function handleLogPartialPayment(p: BackupProject) {
    const amount = num(collectPartialInput)
    if (!amount || amount <= 0) return
    pushState()
    p.paid = num(p.paid || 0) + amount
    p.lastCollectedAt = new Date().toISOString()
    p.lastCollectedAmount = amount

    // Sync partial payment to linked service log entries (linked via project_id field).
    const svcLogs = backup.serviceLogs || []
    svcLogs.forEach((sl: any) => {
      if (sl.project_id === p.id) {
        const prevCollected = num(sl.collected || 0)
        const newCollected = prevCollected + amount
        sl.collected = newCollected
        sl.balanceDue = Math.max(0, num(sl.quoted || 0) - newCollected)
        sl.payStatus = sl.balanceDue <= 0 ? 'Y' : (newCollected > 0 ? 'P' : 'N')
        if (!sl.project_name) sl.project_name = p.name
      }
    })

    saveBackupData(backup)
    setCollectPartialInput('')
    setCollectLoggingPartial(false)
    setCollectProject(null)
    forceUpdate()
  }

  // ── Group projects by bucket
  const active = projects.filter(p => resolveProjectBucket(p) === 'active')
  const coming = projects.filter(p => resolveProjectBucket(p) === 'coming')
  const completed = projects.filter(p => resolveProjectBucket(p) === 'completed')

  function renderProjectCard(p: BackupProject, bucket: string) {
    const h = health(p, backup)
    const o = getOverallCompletion(p, backup)
    const d = daysSince(p.lastMove)
    const openR = (p.rfis || []).filter((r: any) => r.status !== 'answered').length
    const fin = getProjectFinancials(p, backup)

    // Planned timeline display
    const plannedLine = (p.plannedStart && p.plannedEnd)
      ? `Planned: ${fmtDate(p.plannedStart)} – ${fmtDate(p.plannedEnd)}`
      : null

    return (
      <div
        key={p.id}
        className="rounded-xl border border-gray-800 bg-[var(--bg-card)] p-4 hover:border-gray-600 transition-colors"
      >
        {/* Header: name/type + health score */}
        <div className="flex items-start justify-between mb-2">
          <div
            className="cursor-pointer"
            onClick={() => onSelectProject?.(p.id)}
          >
            <div className="font-bold text-sm text-gray-100">{p.name}</div>
            <div className="text-[10px] text-gray-500">{p.type}</div>
            {plannedLine && (
              <div className="text-[9px] text-gray-500 mt-0.5">{plannedLine}</div>
            )}
          </div>
          <div className="text-right">
            <div className="text-xl font-bold font-mono" style={{ color: h.clr }}>{h.sc}</div>
            <div className="text-[9px] text-gray-500">Health</div>
          </div>
        </div>

        {/* Financial metrics */}
        <div className="grid grid-cols-3 gap-2 mb-2 text-[10px]">
          <div className="bg-[var(--bg-input)] rounded p-1.5 text-center">
            <div className="text-gray-500 uppercase font-bold">Quoted</div>
            <div className="font-mono text-gray-200">{fmtK(fin.contract)}</div>
          </div>
          <div className="bg-[var(--bg-input)] rounded p-1.5 text-center">
            <div className="text-gray-500 uppercase font-bold">Paid</div>
            <div className="font-mono text-emerald-400">{fmtK(fin.paid)}</div>
          </div>
          <div className="bg-[var(--bg-input)] rounded p-1.5 text-center">
            <div className="text-gray-500 uppercase font-bold">Exposure</div>
            <div className="font-mono text-red-400">{fmtK(fin.risk)}</div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1.5 rounded-full bg-gray-700/50 overflow-hidden mb-2">
          <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, o)}%`, background: h.clr }} />
        </div>

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
          {bucket === 'completed' && (
            fin.AR > 0 ? (
              <span className="text-[9px] px-2 py-0.5 rounded font-semibold bg-orange-500/20 text-orange-400 border border-orange-500/30"
                    title={`Outstanding balance: ${fmtK(fin.AR)}`}>
                🚨 UNPAID {fmtK(fin.AR)}
              </span>
            ) : (
              <span className="text-[9px] px-2 py-0.5 rounded font-semibold bg-emerald-500/20 text-emerald-400">
                ✓ Fully Paid
              </span>
            )
          )}
          {bucket === 'completed' && fin.contract - fin.paid > 0 && (
            <button
              onClick={e => { e.stopPropagation(); setCollectProject(p); setCollectPartialInput(''); setCollectLoggingPartial(false) }}
              className="text-[9px] px-2 py-0.5 rounded font-bold bg-yellow-400/20 text-yellow-300 border border-yellow-400/40 hover:bg-yellow-400/30 transition-colors"
            >
              💰 Collect
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2 border-t border-gray-700/50">
          {bucket !== 'completed' ? (
            <>
              <button
                onClick={() => openEditProjectModal(p)}
                className="flex-1 text-[10px] px-2 py-1.5 rounded bg-gray-700/50 text-gray-300 hover:bg-gray-600/50 font-semibold"
              >
                <Edit3 size={10} className="inline mr-1" /> Edit
              </button>
              <button
                onClick={() => onSelectProject?.(p.id)}
                className="text-[10px] px-2 py-1.5 rounded bg-gray-700/30 text-gray-400 hover:bg-gray-600/30 font-semibold border border-gray-700/50"
                title="Open project tabs"
              >
                <Eye size={10} />
              </button>
              <button
                onClick={() => moveStatus(p.id, bucket === 'active' ? 'coming' : 'active')}
                className="text-[10px] px-2 py-1.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-semibold"
              >
                <ArrowRight size={10} className="inline mr-1" /> {bucket === 'active' ? 'Coming Up' : 'Active'}
              </button>
              <button
                onClick={() => deleteProject(p.id)}
                className="text-[10px] px-2 py-1.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 font-semibold"
              >
                <Trash2 size={10} />
              </button>
            </>
          ) : (
            <>
              <button onClick={() => onSelectProject?.(p.id)} className="flex-1 text-[10px] px-2 py-1.5 rounded bg-gray-700/50 text-gray-300 hover:bg-gray-600/50 font-semibold">
                <Eye size={10} className="inline mr-1" /> View Project
              </button>
              <button
                onClick={() => moveStatus(p.id, 'active')}
                className="text-[10px] px-2 py-1.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-semibold"
              >
                <RotateCcw size={10} className="inline mr-1" /> Reactivate
              </button>
              <button
                onClick={() => deleteProject(p.id)}
                className="text-[10px] px-2 py-1.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 font-semibold"
              >
                <Trash2 size={10} />
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  function renderSection(label: string, items: BackupProject[], bucket: string) {
    if (items.length === 0) return null
    return (
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
            {label} <span className="text-gray-600 ml-1">({items.length})</span>
          </h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map(p => renderProjectCard(p, bucket))}
        </div>
      </div>
    )
  }

  const inputCls = "w-full px-3 py-2 bg-[var(--bg-input)] border border-gray-600 rounded text-sm text-[var(--text-primary)] focus:outline-none focus:border-emerald-500"

  return (
    <div className="min-h-screen bg-[var(--bg-secondary)] p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-sm font-bold text-gray-300 uppercase tracking-wider">Projects</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowQBImport(true)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ backgroundColor: 'rgba(99,102,241,0.2)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)' }}
          >
            <FileText size={12} /> New from QB Estimate
          </button>
          <button onClick={openNewProjectModal} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold">
            <Plus size={12} /> New Project
          </button>
        </div>
      </div>

      {renderSection('Active', active, 'active')}
      {renderSection('Coming Up', coming, 'coming')}
      {renderSection('Completed', completed, 'completed')}

      {projects.length === 0 && (
        <div className="p-8 text-center">
          <div className="text-2xl mb-2">📋</div>
          <div className="text-xs text-gray-500">No projects yet. Add one to get started.</div>
        </div>
      )}

      {/* QuickBooks PDF Import Modal */}
      {showQBImport && (
        <QuickBooksImportModal
          mode="project"
          onClose={() => setShowQBImport(false)}
          onImported={() => { forceUpdate() }}
        />
      )}

      {/* New Project Modal */}
      {showNewProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[var(--bg-card)] border border-gray-700 rounded-xl w-full max-w-lg mx-4 p-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-gray-200 uppercase tracking-wider">New Project</h3>
              <button onClick={() => setShowNewProject(false)} className="text-gray-500 hover:text-gray-300"><X size={16} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Project Name *</label>
                <input value={npName} onChange={e => setNpName(e.target.value)} className={inputCls} placeholder="e.g. Smith Residence Panel Upgrade" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Client / Customer</label>
                  <input value={npClient} onChange={e => setNpClient(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Contract Amount ($)</label>
                  <input type="number" value={npContract} onChange={e => setNpContract(e.target.value)} className={inputCls} placeholder="0" />
                </div>
              </div>
              {/* DASHBOARD-START-DATE-GATE-AND-PERSIST-APR22-2026-1 — L1 layout: dates top row, categoricals bottom row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Start Date</label>
                  <input type="date" value={npStartDate} onChange={e => setNpStartDate(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Planned End</label>
                  <input type="date" value={npPlannedEnd} onChange={e => setNpPlannedEnd(e.target.value)} className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Job Type</label>
                  <select value={npType} onChange={e => setNpType(e.target.value)} className={inputCls}>
                    {JOB_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Status</label>
                  <select value={npStatus} onChange={e => setNpStatus(e.target.value)} className={inputCls}>
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Notes</label>
                <textarea value={npNotes} onChange={e => setNpNotes(e.target.value)} rows={2} className={inputCls + ' resize-none'} placeholder="Optional project notes..." />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowNewProject(false)} className="flex-1 px-4 py-2 rounded bg-gray-700 text-gray-300 text-sm font-semibold hover:bg-gray-600">Cancel</button>
              <button onClick={saveNewProject} className="flex-1 px-4 py-2 rounded bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500">Create Project</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Project Modal */}
      {showEditProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[var(--bg-card)] border border-gray-700 rounded-xl w-full max-w-lg mx-4 p-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-gray-200 uppercase tracking-wider">Edit Project</h3>
              <button onClick={() => setShowEditProject(false)} className="text-gray-500 hover:text-gray-300"><X size={16} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Project Name *</label>
                <input value={epName} onChange={e => setEpName(e.target.value)} className={inputCls} placeholder="e.g. Smith Residence Panel Upgrade" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Client / Customer</label>
                  <input value={epClient} onChange={e => setEpClient(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Contract Amount ($)</label>
                  <input type="number" value={epContract} onChange={e => setEpContract(e.target.value)} className={inputCls} placeholder="0" />
                </div>
              </div>
              {/* DASHBOARD-START-DATE-GATE-AND-PERSIST-APR22-2026-1 — L1 layout: dates top row, categoricals bottom row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Start Date</label>
                  <input type="date" value={epStartDate} onChange={e => setEpStartDate(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Planned End</label>
                  <input type="date" value={epPlannedEnd} onChange={e => setEpPlannedEnd(e.target.value)} className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Job Type</label>
                  <select value={epType} onChange={e => setEpType(e.target.value)} className={inputCls}>
                    {JOB_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Status</label>
                  <select value={epStatus} onChange={e => setEpStatus(e.target.value)} className={inputCls}>
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Notes</label>
                <textarea value={epNotes} onChange={e => setEpNotes(e.target.value)} rows={2} className={inputCls + ' resize-none'} placeholder="Optional project notes..." />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowEditProject(false)} className="flex-1 px-4 py-2 rounded bg-gray-700 text-gray-300 text-sm font-semibold hover:bg-gray-600">Cancel</button>
              <button onClick={saveEditProject} className="flex-1 px-4 py-2 rounded bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500">Save Changes</button>
            </div>
          </div>
        </div>
      )}
      {/* ── Collect Payment Modal ────────────────────────────────────────────── */}
      {collectProject && (() => {
        const cp = collectProject
        const cfin = getProjectFinancials(cp, backup)
        const outstanding = Math.max(0, num(cfin.contract) - num(cfin.paid))
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setCollectProject(null)}>
            <div
              className="bg-[var(--bg-card)] border border-yellow-500/30 rounded-xl w-full max-w-sm mx-4 p-5 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold text-yellow-300">💰 Collect Payment</h3>
                  <p className="text-[10px] text-gray-400 mt-0.5">{cp.name}</p>
                </div>
                <button onClick={() => setCollectProject(null)} className="text-gray-500 hover:text-gray-300"><X size={16} /></button>
              </div>

              {/* Financial summary */}
              <div className="space-y-2 mb-4">
                <div className="flex justify-between items-center py-1.5 border-b border-gray-700/50">
                  <span className="text-[11px] text-gray-400">Total Contract Value</span>
                  <span className="text-[11px] font-mono text-gray-200">{fmt(cfin.contract)}</span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-gray-700/50">
                  <span className="text-[11px] text-gray-400">Amount Collected</span>
                  <span className="text-[11px] font-mono text-emerald-400">{fmt(cfin.paid)}</span>
                </div>
                <div className="flex justify-between items-center py-1.5 rounded-lg px-2" style={{ backgroundColor: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.25)' }}>
                  <span className="text-[11px] font-semibold text-yellow-300">Outstanding Balance</span>
                  <span className="text-[13px] font-bold font-mono text-yellow-300">{fmt(outstanding)}</span>
                </div>
              </div>

              {/* Partial payment input */}
              {collectLoggingPartial && (
                <div className="mb-4 p-3 rounded-lg bg-[var(--bg-input)] border border-gray-600">
                  <label className="text-[10px] text-gray-400 uppercase font-bold block mb-1.5">Amount Received ($)</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={collectPartialInput}
                      onChange={e => setCollectPartialInput(e.target.value)}
                      placeholder="0.00"
                      className="flex-1 px-3 py-2 bg-[var(--bg-secondary)] border border-gray-600 rounded text-sm text-gray-200 font-mono focus:outline-none focus:border-yellow-500"
                      autoFocus
                    />
                    <button
                      onClick={() => handleLogPartialPayment(cp)}
                      className="px-3 py-2 rounded bg-yellow-500/20 text-yellow-300 border border-yellow-500/40 text-xs font-bold hover:bg-yellow-500/30"
                    >
                      Log
                    </button>
                    <button
                      onClick={() => { setCollectLoggingPartial(false); setCollectPartialInput('') }}
                      className="px-2 py-2 rounded bg-gray-700/50 text-gray-400 text-xs hover:bg-gray-600/50"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              {!collectLoggingPartial && (
                <div className="flex flex-col gap-2 mb-3">
                  <button
                    onClick={() => handleMarkFullPayment(cp)}
                    className="w-full py-2.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 transition-colors"
                  >
                    ✓ Mark Full Payment Received
                  </button>
                  <button
                    onClick={() => setCollectLoggingPartial(true)}
                    className="w-full py-2.5 rounded-lg bg-yellow-500/15 text-yellow-300 border border-yellow-500/30 text-xs font-bold hover:bg-yellow-500/25 transition-colors"
                  >
                    + Log Partial Payment
                  </button>
                </div>
              )}

              {/* Follow-up link */}
              <div className="border-t border-gray-700/50 pt-3 space-y-2">
                <button
                  onClick={() => { setCollectProject(null); window.dispatchEvent(new CustomEvent('poweron:show-money')) }}
                  className="text-[10px] text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline w-full text-left"
                >
                  Need to follow up? → Open Money / AR tab
                </button>

                {/* LEDGER AI stub */}
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-blue-500/5 border border-blue-500/15">
                  <span className="text-[10px] text-gray-400 flex-1">Want me to draft a payment follow-up message?</span>
                  <button
                    className="px-2.5 py-1 rounded text-[10px] font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/25 cursor-not-allowed opacity-60"
                    title="LEDGER AI — coming soon"
                    disabled
                  >
                    ✦ LEDGER <span className="text-[8px] opacity-70">(soon)</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
