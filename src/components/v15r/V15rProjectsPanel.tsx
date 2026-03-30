// @ts-nocheck
/**
 * V15rProjectsPanel — Projects panel grouped by Active / Coming / Completed.
 * Faithfully ported from HTML renderProjects().
 *
 * Each card shows: health score (0-100), progress bar, quoted/paid/exposure,
 * chips (stale days, completion %, open RFIs), edit/delete/move-status buttons.
 */

import { useState, useCallback } from 'react'
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
  pct,
  num,
  syncAllProjectFinanceBuckets,
  type BackupProject,
} from '@/services/backupDataService'
import { pushState } from '@/services/undoRedoService'
import QuickBooksImportModal from './QuickBooksImportModal'

interface Props {
  onSelectProject?: (projectId: string) => void
  prefillFromLead?: { name?: string; customer?: string; contract?: number; type?: string; notes?: string; leadId?: string; leadType?: string } | null
  onPrefillUsed?: () => void
}

const JOB_TYPES = ['Residential', 'Commercial', 'Service', 'Solar', 'New Construction', 'Commercial TI']
const STATUS_OPTIONS = ['active', 'coming']
const DEFAULT_PHASES = { Planning: 0, Estimating: 0, 'Site Prep': 0, 'Rough-in': 0, Trim: 0, Finish: 0 }

export default function V15rProjectsPanel({ onSelectProject, prefillFromLead, onPrefillUsed }: Props) {
  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])
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

  const backup = getBackupData()

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
    setShowNewProject(true)
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

  // Group projects by bucket
  const active = projects.filter(p => resolveProjectBucket(p) === 'active')
  const coming = projects.filter(p => resolveProjectBucket(p) === 'coming')
  const completed = projects.filter(p => resolveProjectBucket(p) === 'completed')

  function renderProjectCard(p: BackupProject, bucket: string) {
    const h = health(p, backup)
    const o = getOverallCompletion(p, backup)
    const d = daysSince(p.lastMove)
    const openR = (p.rfis || []).filter((r: any) => r.status !== 'answered').length
    const fin = getProjectFinancials(p, backup)

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
            <span className={`text-[9px] px-2 py-0.5 rounded font-semibold ${
              fin.paid >= fin.contract ? 'bg-emerald-500/20 text-emerald-400' : 'bg-yellow-500/20 text-yellow-400'
            }`}>
              {fin.paid >= fin.contract ? 'Fully Paid' : 'Balance Pending'}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2 border-t border-gray-700/50">
          {bucket !== 'completed' ? (
            <>
              <button onClick={() => onSelectProject?.(p.id)} className="flex-1 text-[10px] px-2 py-1.5 rounded bg-gray-700/50 text-gray-300 hover:bg-gray-600/50 font-semibold">
                <Edit3 size={10} className="inline mr-1" /> Edit
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
          <div className="bg-[#232738] border border-gray-700 rounded-xl w-full max-w-lg mx-4 p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-gray-200 uppercase tracking-wider">New Project</h3>
              <button onClick={() => setShowNewProject(false)} className="text-gray-500 hover:text-gray-300"><X size={16} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Project Name *</label>
                <input value={npName} onChange={e => setNpName(e.target.value)} className="w-full px-3 py-2 bg-[#1a1d27] border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-emerald-500" placeholder="e.g. Smith Residence Panel Upgrade" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Client / Customer</label>
                  <input value={npClient} onChange={e => setNpClient(e.target.value)} className="w-full px-3 py-2 bg-[#1a1d27] border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-emerald-500" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Contract Amount ($)</label>
                  <input type="number" value={npContract} onChange={e => setNpContract(e.target.value)} className="w-full px-3 py-2 bg-[#1a1d27] border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-emerald-500" placeholder="0" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Job Type</label>
                  <select value={npType} onChange={e => setNpType(e.target.value)} className="w-full px-3 py-2 bg-[#1a1d27] border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-emerald-500">
                    {JOB_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Start Date</label>
                  <input type="date" value={npStartDate} onChange={e => setNpStartDate(e.target.value)} className="w-full px-3 py-2 bg-[#1a1d27] border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-emerald-500" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Status</label>
                  <select value={npStatus} onChange={e => setNpStatus(e.target.value)} className="w-full px-3 py-2 bg-[#1a1d27] border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-emerald-500">
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s === 'active' ? 'Active' : 'Coming Up'}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 uppercase font-bold block mb-1">Notes</label>
                <textarea value={npNotes} onChange={e => setNpNotes(e.target.value)} rows={2} className="w-full px-3 py-2 bg-[#1a1d27] border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-emerald-500 resize-none" />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={saveNewProject} className="flex-1 px-4 py-2 bg-emerald-600 text-white text-xs font-bold rounded hover:bg-emerald-700 transition-colors">
                Create Project
              </button>
              <button onClick={() => setShowNewProject(false)} className="px-4 py-2 bg-gray-700 text-gray-300 text-xs font-bold rounded hover:bg-gray-600 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
