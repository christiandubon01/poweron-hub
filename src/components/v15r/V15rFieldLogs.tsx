// @ts-nocheck
/**
 * V15rFieldLogs — Field log entries matching v15r layout
 *
 * Features:
 * - Date / Employee / Hours / Miles / Materials / Phase / Notes
 * - Emergency material info & detail link
 * - Filter by project
 * - Running profit display
 * - Add new entry form (saves to localStorage backup)
 */

import { useState, useMemo } from 'react'
import { Plus, Filter, ExternalLink, Zap, X, Save } from 'lucide-react'
import {
  getBackupData,
  saveBackupData,
  type BackupData,
  type BackupLog,
} from '@/services/backupDataService'
import ImportBackupButton from '@/components/ImportBackupButton'

export default function V15rFieldLogs() {
  const backup = getBackupData()
  if (!backup) return <NoData />

  const [filterProject, setFilterProject] = useState<string>('all')
  const [showAddForm, setShowAddForm] = useState(false)

  const projects = useMemo(() => {
    const map = new Map<string, string>()
    backup.projects.forEach(p => map.set(p.id, p.name))
    return map
  }, [backup])

  const filtered = useMemo(() => {
    const logs = [...backup.logs].reverse() // newest first
    if (filterProject === 'all') return logs
    return logs.filter(l => l.projId === filterProject)
  }, [backup, filterProject])

  const totalHrs = filtered.reduce((s, l) => s + (l.hrs || 0), 0)
  const totalMat = filtered.reduce((s, l) => s + (l.mat || 0), 0)
  const totalMiles = filtered.reduce((s, l) => s + (l.miles || 0), 0)

  function handleAddLog(newLog: BackupLog) {
    const updated: BackupData = {
      ...backup,
      logs: [...backup.logs, newLog],
    }
    saveBackupData(updated)
    window.location.reload()
  }

  return (
    <div className="space-y-6 p-5 min-h-screen">
      <ImportBackupButton />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-gray-200 uppercase tracking-wider">
          Field Logs ({filtered.length})
        </h2>
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-gray-500" />
          <select
            value={filterProject}
            onChange={e => setFilterProject(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="all">All Projects</option>
            {backup.projects.map(p => (
              <option key={p.id} value={p.id}>{p.projectCode || p.id} — {p.name}</option>
            ))}
          </select>
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/30 transition-colors"
          >
            <Plus size={14} /> Add Log
          </button>
        </div>
      </div>

      {/* Summary Bar */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-gray-700 bg-gray-800/40 p-3 text-center">
          <div className="text-[10px] text-gray-500 uppercase">Total Hours</div>
          <div className="text-lg font-bold text-gray-200 font-mono">{totalHrs.toFixed(1)}</div>
        </div>
        <div className="rounded-xl border border-gray-700 bg-gray-800/40 p-3 text-center">
          <div className="text-[10px] text-gray-500 uppercase">Total Materials</div>
          <div className="text-lg font-bold text-orange-400 font-mono">{fmt(totalMat)}</div>
        </div>
        <div className="rounded-xl border border-gray-700 bg-gray-800/40 p-3 text-center">
          <div className="text-[10px] text-gray-500 uppercase">Total Miles</div>
          <div className="text-lg font-bold text-cyan-400 font-mono">{totalMiles.toFixed(0)}</div>
        </div>
      </div>

      {/* Log Table */}
      <div className="rounded-xl border border-gray-700 bg-gray-800/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-700 text-gray-500">
                <th className="text-left py-2.5 px-3">Date</th>
                <th className="text-left py-2.5 px-3">Employee</th>
                <th className="text-left py-2.5 px-3">Project</th>
                <th className="text-right py-2.5 px-3">Hours</th>
                <th className="text-right py-2.5 px-3">Miles</th>
                <th className="text-right py-2.5 px-3">Materials</th>
                <th className="text-left py-2.5 px-3">Phase</th>
                <th className="text-right py-2.5 px-3">Quoted</th>
                <th className="text-right py-2.5 px-3">Collected</th>
                <th className="text-right py-2.5 px-3">Profit</th>
                <th className="text-left py-2.5 px-3">Notes</th>
                <th className="text-center py-2.5 px-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(l => (
                <tr key={l.id} className="border-b border-gray-800 hover:bg-gray-700/20 transition-colors">
                  <td className="py-2 px-3 text-gray-300 font-mono whitespace-nowrap">{l.date}</td>
                  <td className="py-2 px-3 text-gray-300">{l.emp}</td>
                  <td className="py-2 px-3 text-gray-400 truncate max-w-[120px]" title={l.projName}>
                    {l.projName}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-gray-200">{l.hrs}</td>
                  <td className="py-2 px-3 text-right font-mono text-gray-400">{l.miles}</td>
                  <td className="py-2 px-3 text-right font-mono text-orange-400">{fmt(l.mat)}</td>
                  <td className="py-2 px-3 text-gray-400">{l.phase}</td>
                  <td className="py-2 px-3 text-right font-mono text-cyan-400">{fmt(l.quoted)}</td>
                  <td className="py-2 px-3 text-right font-mono text-emerald-400">{fmt(l.collected)}</td>
                  <td className={`py-2 px-3 text-right font-mono font-bold ${(l.profit || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {fmt(l.profit)}
                  </td>
                  <td className="py-2 px-3 text-gray-500 truncate max-w-[150px]" title={l.notes}>
                    {l.notes}
                    {l.emergencyMatInfo && (
                      <span className="ml-1 text-red-400" title={l.emergencyMatInfo}>⚠</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-center">
                    {l.detailLink && (
                      <a
                        href={l.detailLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-500 hover:text-cyan-400 transition-colors"
                        title="View detail"
                      >
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="text-center text-gray-500 py-10 text-sm">
            No field logs found for this filter.
          </div>
        )}
      </div>

      {/* Add Log Modal */}
      {showAddForm && (
        <AddLogForm
          projects={backup.projects}
          onSave={handleAddLog}
          onClose={() => setShowAddForm(false)}
        />
      )}

      <div className="text-[10px] text-gray-600 flex items-center gap-1">
        <Zap size={10} /> NEXUS AI can summarize your daily logs — ask in the chat panel
      </div>
    </div>
  )
}

// ── Add Log Form ──────────────────────────────────────────────────────────────

function AddLogForm({
  projects,
  onSave,
  onClose,
}: {
  projects: any[]
  onSave: (log: BackupLog) => void
  onClose: () => void
}) {
  const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
  const [form, setForm] = useState({
    projId: projects[0]?.id || '',
    emp: '',
    hrs: '',
    miles: '',
    mat: '',
    phase: 'Rough-in',
    notes: '',
    quoted: '',
    collected: '',
    store: '',
    emergencyMatInfo: '',
  })

  const set = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }))

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const proj = projects.find(p => p.id === form.projId)
    const log: BackupLog = {
      id: `log-${Date.now()}`,
      emp: form.emp,
      hrs: parseFloat(form.hrs) || 0,
      mat: parseFloat(form.mat) || 0,
      date: today,
      empId: '',
      miles: parseFloat(form.miles) || 0,
      notes: form.notes,
      phase: form.phase,
      store: form.store,
      profit: (parseFloat(form.collected) || 0) - (parseFloat(form.mat) || 0),
      projId: form.projId,
      quoted: parseFloat(form.quoted) || 0,
      projName: proj?.name || '',
      collected: parseFloat(form.collected) || 0,
      detailLink: '',
      projectQuote: proj?.contract || 0,
      emergencyMatInfo: form.emergencyMatInfo,
    }
    onSave(log)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-gray-800 border border-gray-700 rounded-xl w-full max-w-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-200 uppercase tracking-wider">New Field Log</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-[10px] text-gray-500 uppercase">Project</span>
              <select value={form.projId} onChange={e => set('projId', e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300">
                {projects.map(p => <option key={p.id} value={p.id}>{p.projectCode || p.id} — {p.name}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] text-gray-500 uppercase">Employee</span>
              <input value={form.emp} onChange={e => set('emp', e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300" placeholder="Name" />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] text-gray-500 uppercase">Hours</span>
              <input type="number" step="0.5" value={form.hrs} onChange={e => set('hrs', e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300" />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] text-gray-500 uppercase">Miles</span>
              <input type="number" value={form.miles} onChange={e => set('miles', e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300" />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] text-gray-500 uppercase">Materials $</span>
              <input type="number" step="0.01" value={form.mat} onChange={e => set('mat', e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300" />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] text-gray-500 uppercase">Phase</span>
              <select value={form.phase} onChange={e => set('phase', e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300">
                {['Planning', 'Estimating', 'Site Prep', 'Rough-in', 'Trim', 'Finish'].map(ph => (
                  <option key={ph} value={ph}>{ph}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] text-gray-500 uppercase">Quoted $</span>
              <input type="number" step="0.01" value={form.quoted} onChange={e => set('quoted', e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300" />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] text-gray-500 uppercase">Collected $</span>
              <input type="number" step="0.01" value={form.collected} onChange={e => set('collected', e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300" />
            </label>
          </div>
          <label className="space-y-1 block">
            <span className="text-[10px] text-gray-500 uppercase">Notes</span>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300" />
          </label>
          <label className="space-y-1 block">
            <span className="text-[10px] text-gray-500 uppercase">Store / Supplier</span>
            <input value={form.store} onChange={e => set('store', e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300" />
          </label>
          <button type="submit"
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-sm bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/30 transition-colors">
            <Save size={14} /> Save Field Log
          </button>
        </form>
      </div>
    </div>
  )
}

function NoData() {
  return (
    <div className="p-6 space-y-4">
      <ImportBackupButton />
      <div className="text-center text-gray-500 py-20">
        <p className="text-lg font-semibold mb-2">No field log data</p>
        <p className="text-sm">Import your v15r backup file to see your field logs</p>
      </div>
    </div>
  )
}

function fmt(n: number): string {
  if (!n && n !== 0) return '$0'
  if (Math.abs(n) >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return '$' + n.toFixed(0)
}
