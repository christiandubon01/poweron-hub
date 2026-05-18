// @ts-nocheck
import React, { useState, useCallback } from 'react'
import {
  saveBackupDataAndSync,
  num,
  fmt,
  buildProjectLogRollup,
  type BackupData,
  type BackupLog,
} from '@/services/backupDataService'
import { pushState } from '@/services/undoRedoService'
import { processSkillSignals } from '@/services/skillSignalExtractor'
import { Plus, Timer, Boxes, Route, CircleDollarSign, X, ClipboardList } from 'lucide-react'
import VoiceMaterialCapture from './VoiceMaterialCapture'
import {
  calculateProjectFinancials,
  VAN_MILE_RATE,
} from '@/utils/calculateProjectFinancials'

// ── Constants ────────────────────────────────────────────────────────────────

const PHASES = ['Rough-in', 'Trim', 'Demo', 'Underground', 'Finish', 'Material Run', 'Planning', 'Inspection']

function today() {
  return new Date().toISOString().slice(0, 10)
}

function getBalanceColor(balance: number, contract: number): string {
  if (balance < 0) return '#ef4444'
  if (contract <= 0) return '#10b981'
  const pctLeft = balance / contract
  if (pctLeft > 0.20) return '#10b981'
  if (pctLeft > 0.10) return '#f59e0b'
  return '#f97316'
}

function interleaveWithGaps(
  entries: any[],
  dateField: string,
): any[] {
  if (entries.length === 0) return []

  const datesWithEntries = new Set(entries.map(e => e[dateField]).filter(Boolean))
  const dates = entries.map(e => e[dateField]).filter(Boolean).sort()
  const startDate = dates[0]
  const endDate = today()

  const missingDays: string[] = []
  const current = new Date(startDate)
  const end = new Date(endDate)

  while (current <= end) {
    const dayOfWeek = current.getDay()
    const dateStr = current.toISOString().slice(0, 10)
    if (dayOfWeek >= 1 && dayOfWeek <= 5 && !datesWithEntries.has(dateStr)) {
      missingDays.push(dateStr)
    }
    current.setDate(current.getDate() + 1)
  }

  const gaps: Array<{ type: 'gap'; label: string; startDate: string; endDate: string; count: number }> = []
  let i = 0
  while (i < missingDays.length) {
    const startIdx = i
    const startGapDate = missingDays[i]
    while (i + 1 < missingDays.length) {
      const curr = new Date(missingDays[i])
      const next = new Date(missingDays[i + 1])
      const daysDiff = Math.floor((next.getTime() - curr.getTime()) / (1000 * 60 * 60 * 24))
      if (daysDiff === 1) { i++ } else { break }
    }
    const endGapDate = missingDays[i]
    const count = i - startIdx + 1
    if (count >= 3) {
      const [, m, d] = startGapDate.split('-')
      const [, m2, d2] = endGapDate.split('-')
      const label = `📅 No entries — ${m}/${d} to ${m2}/${d2} (${count} weekdays)`
      gaps.push({ type: 'gap', label, startDate: startGapDate, endDate: endGapDate, count })
    } else {
      for (let j = startIdx; j <= i; j++) {
        const dateStr = missingDays[j]
        const [, m, d] = dateStr.split('-')
        const dateObj = new Date(dateStr)
        const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' })
        const label = `📅 No entry — ${dayName}, ${m}/${d}`
        gaps.push({ type: 'gap', label, startDate: dateStr, endDate: dateStr, count: 1 })
      }
    }
    i++
  }

  return [
    ...entries.map(e => ({ type: 'entry', data: e, sortDate: e[dateField] })),
    ...gaps.map(g => ({ type: 'gap', ...g, sortDate: g.startDate })),
  ].sort((a, b) => String(b.sortDate).localeCompare(String(a.sortDate)))
}

// ── Component ────────────────────────────────────────────────────────────────

interface V15rProjectLogsTabProps {
  projectId: string
  onUpdate?: () => void
  backup: BackupData
}

export default function V15rProjectLogsTab({ projectId, onUpdate, backup }: V15rProjectLogsTabProps) {
  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])

  const [showProjForm, setShowProjForm] = useState(false)
  const [editLogId, setEditLogId] = useState<string | null>(null)
  const [showGaps, setShowGaps] = useState(true)

  // Form state
  const [flPhase, setFlPhase] = useState(PHASES[0])
  const [flDate, setFlDate] = useState(today())
  const [flEmp, setFlEmp] = useState('')
  const [flHrs, setFlHrs] = useState('')
  const [flMiles, setFlMiles] = useState('')
  const [flMat, setFlMat] = useState('')
  const [flCollected, setFlCollected] = useState('')
  const [flStore, setFlStore] = useState('')
  const [flEmatInfo, setFlEmatInfo] = useState('')
  const [flDetailLink, setFlDetailLink] = useState('')
  const [flNotes, setFlNotes] = useState('')

  const p = backup.projects?.find(x => x.id === projectId)
  const logs: BackupLog[] = backup.logs || []
  const employees = backup.employees || []
  const settings = backup.settings || {} as any

  function persist() {
    backup._lastSavedAt = new Date().toISOString()
    saveBackupDataAndSync(backup)
    window.dispatchEvent(new Event('storage'))
    window.dispatchEvent(new Event('poweron-data-saved'))
    forceUpdate()
    onUpdate?.()
  }

  function resetProjForm() {
    setFlPhase(PHASES[0]); setFlDate(today()); setFlEmp('')
    setFlHrs(''); setFlMiles(''); setFlMat(''); setFlCollected('')
    setFlStore(''); setFlEmatInfo(''); setFlDetailLink(''); setFlNotes('')
    setEditLogId(null); setShowProjForm(false)
  }

  function openNewForm() {
    resetProjForm()
    setShowProjForm(true)
  }

  function saveProjEntry() {
    if (!p) return
    pushState(backup)
    const entry: BackupLog = {
      id: editLogId || ('log' + Date.now()),
      projId: projectId,
      projName: p.name,
      phase: flPhase,
      date: flDate || today(),
      emp: employees.find(e => e.id === flEmp)?.name || 'Me',
      empId: flEmp,
      hrs: parseFloat(flHrs) || 0,
      miles: parseInt(flMiles) || 0,
      mat: parseFloat(flMat) || 0,
      collected: parseFloat(flCollected) || 0,
      store: flStore,
      emergencyMatInfo: flEmatInfo,
      detailLink: flDetailLink,
      notes: flNotes,
    }
    if (editLogId) {
      const idx = logs.findIndex(l => l.id === editLogId)
      if (idx >= 0) backup.logs[idx] = entry
    } else {
      backup.logs = [...logs, entry]
    }
    persist()
    if (flNotes && flNotes.trim().length > 10) {
      processSkillSignals(`Phase: ${flPhase}. Notes: ${flNotes}`, 'field_log')
    }
    resetProjForm()
  }

  function beginLogEdit(logId: string) {
    const l = logs.find(x => x.id === logId)
    if (!l) return
    setEditLogId(l.id)
    setFlPhase(l.phase); setFlDate(l.date); setFlEmp(l.empId || '')
    setFlHrs(String(l.hrs)); setFlMiles(String(l.miles)); setFlMat(String(l.mat))
    setFlCollected(String(l.collected)); setFlStore(l.store || ''); setFlEmatInfo(l.emergencyMatInfo || '')
    setFlDetailLink(l.detailLink || ''); setFlNotes(l.notes || '')
    setShowProjForm(true)
  }

  function deleteLogEntry(logId: string) {
    if (!confirm('Delete this log entry?')) return
    pushState(backup)
    backup.logs = logs.filter(l => l.id !== logId)
    persist()
  }

  if (!p) return <div className="text-red-400 p-4">Project not found</div>

  // Filter logs for this project only
  const projectLogs = logs.filter(l => l.projId === projectId)
  const sorted = [...projectLogs].sort((a, b) => {
    const da = String(b.date || ''), db = String(a.date || '')
    if (da !== db) return da.localeCompare(db)
    return String(b.id || '').localeCompare(String(a.id || ''))
  })

  const rollCache: Record<string, any> = {}
  const getRoll = (pId: string) => {
    if (!rollCache[pId]) rollCache[pId] = buildProjectLogRollup(backup, pId)
    return rollCache[pId]
  }

  const canonMileRate = num(backup.settings?.mileRate) || VAN_MILE_RATE
  const canonOpCost = Number(backup?.settings?.opCost) || 55
  const canonFin = p
    ? calculateProjectFinancials(p, sorted, canonMileRate, canonOpCost)
    : { quote: 0, labor_cost: 0, material_cost: 0, transportation_cost: 0, total_costs: 0, remaining_balance: 0, total_collected: 0, total_hours: 0, total_miles: 0, mile_rate: canonMileRate }
  const canonBalColor = getBalanceColor(canonFin.remaining_balance, canonFin.quote)

  // Form style constants (matching V15rFieldLogPanel)
  const projectLogInputClass = 'h-10 w-full rounded-lg border border-cyan-400/15 bg-slate-950/55 px-3 text-xs text-slate-100 shadow-inner shadow-black/20 outline-none transition-all placeholder:text-slate-500 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-400/20'
  const projectLogLabelClass = 'mb-1.5 block text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100/55'
  const projectLogSectionClass = 'rounded-xl border border-white/8 bg-slate-950/35 p-4 shadow-inner shadow-white/[0.025]'

  return (
    <div className="space-y-4">
      {/* Header controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowGaps(v => !v)}
            className={`px-2 py-1 rounded text-xs font-semibold transition-all ${
              showGaps
                ? 'bg-amber-600/20 text-amber-400 border border-amber-600/30'
                : 'bg-gray-700/30 text-gray-400 border border-gray-600/30'
            }`}
          >
            {showGaps ? 'Hide Gaps' : 'Show Gaps'}
          </button>
        </div>
        <button
          onClick={openNewForm}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
        >
          <Plus size={12} /> Log
        </button>
      </div>

      {/* Add / Edit Modal */}
      {showProjForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
        >
          <div
            className="relative mx-4 flex w-full max-w-5xl flex-col overflow-hidden rounded-2xl shadow-2xl"
            style={{
              maxHeight: '90vh',
              background: 'linear-gradient(145deg, rgba(15,23,42,0.98) 0%, rgba(8,31,47,0.98) 48%, rgba(2,16,28,0.99) 100%)',
              border: '1px solid rgba(45,212,191,0.28)',
              boxShadow: '0 28px 80px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06), inset 0 0 70px rgba(20,184,166,0.08)',
            }}
          >
            <div
              className="pointer-events-none absolute inset-0 opacity-50"
              style={{
                background: 'linear-gradient(115deg, transparent 0%, rgba(45,212,191,0.07) 32%, transparent 58%)',
                animation: 'projectLogModalGlare 9s ease-in-out infinite',
              }}
            />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-cyan-300/10 to-transparent" />

            <div className="relative flex flex-shrink-0 items-center justify-between border-b border-cyan-300/10 px-6 py-5">
              <div className="flex items-center gap-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-300/25 bg-emerald-400/10 text-emerald-300 shadow-lg shadow-emerald-950/30">
                  <ClipboardList size={20} />
                </div>
                <div>
                  <h2 className="text-2xl font-bold tracking-normal text-white">{editLogId ? 'Edit Project Log' : 'New Project Log'}</h2>
                  <p className="mt-1 text-sm text-cyan-100/58">{p.name} — Log labor, materials, mileage, and collection.</p>
                </div>
              </div>
              <button
                onClick={resetProjForm}
                className="rounded-lg border border-white/10 bg-white/5 p-2 text-slate-400 transition-colors hover:border-cyan-300/30 hover:bg-cyan-300/10 hover:text-white"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="relative flex-1 space-y-4 overflow-y-auto px-5 py-5">
              <div className={projectLogSectionClass}>
                <div className="mb-4 flex items-center gap-3">
                  <div className="h-px flex-1 bg-gradient-to-r from-emerald-300/45 via-cyan-300/15 to-transparent" />
                  <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-300/80">Job Context</div>
                  <div className="h-px flex-1 bg-gradient-to-l from-emerald-300/45 via-cyan-300/15 to-transparent" />
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <div>
                    <label className={projectLogLabelClass}>Project</label>
                    <div className="h-10 w-full rounded-lg border border-cyan-400/15 bg-slate-950/55 px-3 flex items-center text-xs text-slate-300 font-semibold truncate">
                      {p.name}
                    </div>
                  </div>
                  <div>
                    <label className={projectLogLabelClass}>Phase</label>
                    <select value={flPhase} onChange={e => setFlPhase(e.target.value)} className={projectLogInputClass}>
                      {PHASES.map(ph => <option key={ph} value={ph}>{ph}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={projectLogLabelClass}>Date</label>
                    <input type="date" value={flDate} onChange={e => setFlDate(e.target.value)} className={projectLogInputClass} />
                  </div>
                  <div>
                    <label className={projectLogLabelClass}>Employee</label>
                    <select value={flEmp} onChange={e => setFlEmp(e.target.value)} className={projectLogInputClass}>
                      <option value="">Me</option>
                      {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className={projectLogSectionClass}>
                <div className="mb-4 flex items-center gap-3">
                  <div className="h-px flex-1 bg-gradient-to-r from-cyan-300/40 via-emerald-300/15 to-transparent" />
                  <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-200/80">Time + Cost Inputs</div>
                  <div className="h-px flex-1 bg-gradient-to-l from-cyan-300/40 via-emerald-300/15 to-transparent" />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <div>
                    <label className={projectLogLabelClass}>Hours</label>
                    <input key={`flHrs-${editLogId || 'new'}`} type="number" step="0.5" defaultValue={flHrs} onBlur={e => setFlHrs(e.target.value)} className={projectLogInputClass} placeholder="0.0" />
                  </div>
                  <div>
                    <label className={projectLogLabelClass}>Miles RT</label>
                    <input key={`flMiles-${editLogId || 'new'}`} type="number" defaultValue={flMiles} onBlur={e => setFlMiles(e.target.value)} className={projectLogInputClass} placeholder="0" />
                  </div>
                  <VoiceMaterialCapture
                    className="!col-span-1 sm:!col-span-1 lg:!col-span-1 [&>label]:mb-1.5 [&>label]:block [&>label]:text-[10px] [&>label]:font-bold [&>label]:uppercase [&>label]:tracking-[0.16em] [&>label]:text-cyan-100/55 [&_input]:!h-10 [&_input]:!rounded-lg [&_input]:!border-cyan-400/15 [&_input]:!bg-slate-950/55 [&_input]:!px-3 [&_input]:!text-slate-100 [&_input]:outline-none [&_input]:transition-all [&_input:focus]:!border-cyan-300/70 [&_input:focus]:!ring-2 [&_input:focus]:!ring-cyan-400/20 [&_button]:!h-10 [&_button]:!w-10 [&_button]:!rounded-lg"
                    value={flMat}
                    onChange={setFlMat}
                    priceBook={Array.isArray(backup.priceBook) ? backup.priceBook : (backup.priceBook && typeof backup.priceBook === 'object' ? Object.values(backup.priceBook) : [])}
                    onConfirm={(total, note) => {
                      setFlMat(total > 0 ? total.toFixed(2) : flMat)
                      setFlNotes(prev => prev ? `${prev}\n${note}` : note)
                    }}
                  />
                  <div>
                    <label className={projectLogLabelClass}>Collected $</label>
                    <input key={`flCollected-${editLogId || 'new'}`} type="number" step="0.01" defaultValue={flCollected} onBlur={e => setFlCollected(e.target.value)} className={projectLogInputClass} placeholder="0.00" />
                  </div>
                  <div>
                    <label className={projectLogLabelClass}>Store</label>
                    <input key={`flStore-${editLogId || 'new'}`} defaultValue={flStore} onBlur={e => setFlStore(e.target.value)} placeholder="Home Depot..." className={projectLogInputClass} />
                  </div>
                </div>
              </div>

              <div className={projectLogSectionClass}>
                <div className="mb-4 flex items-center gap-3">
                  <div className="h-px flex-1 bg-gradient-to-r from-emerald-300/40 via-cyan-300/15 to-transparent" />
                  <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-200/80">Notes + Proof</div>
                  <div className="h-px flex-1 bg-gradient-to-l from-emerald-300/40 via-cyan-300/15 to-transparent" />
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className={projectLogLabelClass}>Emergency Mat Info</label>
                    <input key={`flEmatInfo-${editLogId || 'new'}`} defaultValue={flEmatInfo} onBlur={e => setFlEmatInfo(e.target.value)} className={projectLogInputClass} placeholder="PO, reason, approval..." />
                  </div>
                  <div>
                    <label className={projectLogLabelClass}>Detail Link</label>
                    <input key={`flDetailLink-${editLogId || 'new'}`} defaultValue={flDetailLink} onBlur={e => setFlDetailLink(e.target.value)} placeholder="Receipt, cart, item link" className={projectLogInputClass} />
                  </div>
                  <div className="md:col-span-2">
                    <label className={projectLogLabelClass}>Work Performed</label>
                    <textarea key={`flNotes-${editLogId || 'new'}`} defaultValue={flNotes} onBlur={e => setFlNotes(e.target.value)} rows={3} className={`${projectLogInputClass} h-auto min-h-[92px] resize-none py-3 leading-relaxed`} placeholder="Describe the work completed, blockers, and next steps..." />
                  </div>
                </div>
              </div>

              {/* Live entry preview */}
              {(() => {
                const previewBillRate = num(settings.billRate) || 95
                const previewMileRate = num(settings.mileRate) || 0.67
                const contract = num(p.contract)
                const projRollPreview = buildProjectLogRollup(backup, projectId)
                const existingLogs = projRollPreview.logs
                const baselineLogs = editLogId ? existingLogs.filter(l => l.id !== editLogId) : existingLogs
                const lastBaseline = baselineLogs[baselineLogs.length - 1]
                const lastRr = lastBaseline ? projRollPreview.byId[lastBaseline.id] : null
                const currentBalance = lastRr ? lastRr.remainingAfter : contract
                const previewHrs = parseFloat(flHrs) || 0
                const previewMat = parseFloat(flMat) || 0
                const previewMiles = parseFloat(flMiles) || 0
                const previewColl = parseFloat(flCollected) || 0
                const previewLaborCost = previewHrs * previewBillRate
                const previewMileageCost = previewMiles * previewMileRate
                const previewEntryCost = previewLaborCost + previewMat + previewMileageCost
                const remainingAfterSave = currentBalance - previewColl - previewEntryCost
                const quoteBurnPct = contract > 0 ? Math.abs(((currentBalance - remainingAfterSave) / contract) * 100) : 0
                const previewColor = getBalanceColor(remainingAfterSave, contract)
                return (
                  <div className="rounded-xl border border-cyan-300/12 bg-slate-950/45 p-3 shadow-inner shadow-white/[0.02]">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-100/55">Live Summary</div>
                      <div className="text-[10px] font-mono text-slate-500">{quoteBurnPct.toFixed(1)}% burn against {fmt(contract)}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                      {[
                        { label: 'Labor', value: previewLaborCost, color: 'text-rose-300' },
                        { label: 'Material', value: previewMat, color: 'text-orange-300' },
                        { label: 'Mileage', value: previewMileageCost, color: 'text-sky-300' },
                        { label: 'Collected', value: previewColl, color: 'text-emerald-300' },
                      ].map(item => (
                        <div key={item.label} className="rounded-lg border border-white/8 bg-white/[0.035] px-3 py-2">
                          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">{item.label}</div>
                          <div className={`mt-1 font-mono text-sm font-bold ${item.color}`}>{fmt(item.value)}</div>
                        </div>
                      ))}
                      <div className="rounded-lg border border-emerald-300/18 bg-emerald-300/[0.06] px-3 py-2">
                        <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-emerald-100/55">Est. Total</div>
                        <div className="mt-1 font-mono text-sm font-bold text-white">{fmt(previewEntryCost)}</div>
                        <div className="mt-0.5 text-[9px] font-mono" style={{ color: previewColor }}>Rem. {fmt(remainingAfterSave)}</div>
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>

            <div className="relative flex flex-shrink-0 items-center justify-between border-t border-cyan-300/10 bg-slate-950/70 px-8 py-5 shadow-[0_-18px_34px_rgba(2,6,23,0.35)]">
              <button
                onClick={resetProjForm}
                className="rounded-lg border border-white/12 bg-white/[0.03] px-4 py-2 text-xs font-semibold text-slate-300 transition-colors hover:border-white/25 hover:bg-white/[0.06] hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={saveProjEntry}
                className="flex items-center gap-2 rounded-lg border border-emerald-300/35 bg-gradient-to-r from-emerald-600 to-teal-500 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-950/35 transition-all hover:from-emerald-500 hover:to-teal-400"
              >
                {editLogId ? 'Update Log' : 'Save Log'}
              </button>
            </div>
            <style>{`
              @keyframes projectLogModalGlare {
                0%, 100% { transform: translateX(-22%); opacity: 0.28; }
                50% { transform: translateX(18%); opacity: 0.48; }
              }
            `}</style>
          </div>
        </div>
      )}

      {/* Last 7 Days Summary */}
      {sorted.length > 0 && (() => {
        const now = new Date()
        const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7)
        const parseLogDate = (dateStr: string | undefined | null): Date | null => {
          if (!dateStr) return null
          const d = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? new Date(dateStr + 'T00:00:00') : new Date(dateStr)
          return isNaN(d.getTime()) ? null : d
        }
        const recentLogs = sorted.filter(log => {
          const logDate = parseLogDate(log.date || log.logDate)
          return logDate && logDate >= sevenDaysAgo
        })
        const totalHours = recentLogs.reduce((s, l) => s + num(l.hrs || l.hours), 0)
        const totalMaterialCost = recentLogs.reduce((s, l) => s + num(l.mat || l.materialCost), 0)
        const totalMiles = recentLogs.reduce((s, l) => s + num(l.miles || l.mileRT), 0)
        const totalCollected7d = recentLogs.reduce((s, l) => s + num(l.collected), 0)
        const opCost7d = Number(backup.settings?.opCost) || 55
        const mileRate7d = num(backup.settings?.mileRate) || VAN_MILE_RATE
        const totalLaborCost7d = totalHours * opCost7d
        const totalMileageCost7d = totalMiles * mileRate7d
        const totalCost7d = totalLaborCost7d + totalMaterialCost + totalMileageCost7d
        const fin7d = p ? calculateProjectFinancials(p, sorted, mileRate7d, opCost7d) : null
        const remainingBalNow = fin7d?.remaining_balance ?? 0
        const projQuoteNow = fin7d?.quote ?? 0
        const balColor7d = getBalanceColor(remainingBalNow, projQuoteNow)

        const perDayData: Record<string, number> = {}
        for (let i = 0; i < 7; i++) {
          const d = new Date(now)
          d.setDate(d.getDate() - i)
          const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
          perDayData[key] = 0
        }
        recentLogs.forEach(l => {
          const key = l.date || l.logDate
          if (Object.prototype.hasOwnProperty.call(perDayData, key)) {
            perDayData[key] += num(l.hrs || l.hours)
          }
        })
        const maxDailyHours = Math.max(1, ...Object.values(perDayData))

        return (
          <div className="space-y-3">
            <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-3">
              <div className="text-[9px] font-bold text-gray-400 uppercase mb-3">Last 7 Days Summary</div>
              <div className="grid grid-cols-7 gap-3 text-center">
                {[
                  { label: 'Total Hours', value: `${totalHours.toFixed(1)}h`, color: 'text-white' },
                  { label: 'Labor Cost', sub: `Hrs × $${opCost7d.toFixed(2)}/hr`, value: fmt(totalLaborCost7d), color: 'text-red-400' },
                  { label: 'Material Cost', value: fmt(totalMaterialCost), color: '#fcd34d' },
                  { label: 'Mileage Cost', sub: `Mi × $${mileRate7d.toFixed(2)}`, value: fmt(totalMileageCost7d), color: '#60a5fa' },
                  { label: 'Total Costs', sub: 'L+M+T', value: fmt(totalCost7d), color: 'text-red-400' },
                  { label: 'Remaining Balance', sub: 'project, current', value: fmt(remainingBalNow), color: balColor7d },
                  { label: 'Collected', value: fmt(totalCollected7d), color: 'text-emerald-400' },
                ].map(({ label, sub, value, color }) => (
                  <div key={label}>
                    <div className="text-[9px] text-gray-500 uppercase font-bold">{label}</div>
                    {sub && <div className="text-[9px] text-gray-600">{sub}</div>}
                    <div className={`text-sm font-bold font-mono`} style={typeof color === 'string' && color.startsWith('#') ? { color } : undefined}>
                      <span className={typeof color === 'string' && !color.startsWith('#') ? color : ''}>{value}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-3">
              <div className="text-[9px] font-bold text-gray-400 uppercase mb-3">Daily Hours — Last 7 Days</div>
              <div className="flex items-end gap-2 h-24">
                {Object.entries(perDayData).reverse().map(([date, hours]) => {
                  const pct = maxDailyHours > 0 ? (hours / maxDailyHours) * 100 : 0
                  const isToday = date === today()
                  const d = new Date(date + 'T00:00:00')
                  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]
                  return (
                    <div key={date} className="flex-1 flex flex-col items-center gap-1 text-[10px]">
                      <div className="font-mono font-bold" style={{ color: isToday ? '#6ee7b7' : '#e5e7eb' }}>
                        {hours > 0 ? `${hours.toFixed(1)}h` : '—'}
                      </div>
                      <div
                        className={`w-full rounded-t transition-all ${isToday ? 'bg-emerald-300' : 'bg-emerald-600/50'}`}
                        style={{ height: `${Math.max(hours > 0 ? 4 : 1, pct)}%`, minHeight: hours > 0 ? '8px' : '2px' }}
                        title={`${date}: ${hours.toFixed(1)}h`}
                      />
                      <span className="text-gray-300 font-semibold">{dow}</span>
                      <span className="text-gray-500 text-[9px]">{date.slice(5).replace('-', '/')}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Running Totals Sticky Bar */}
      {sorted.length > 0 && (
        <div className="sticky top-0 z-10 bg-[var(--bg-input)] border border-gray-700 rounded-lg p-3 mb-3 shadow-lg">
          <div className="grid grid-cols-7 gap-2 text-center">
            <div>
              <div className="text-[9px] text-gray-300 uppercase font-bold">Total Hours</div>
              <div className="text-sm font-bold font-mono text-white">{canonFin.total_hours.toFixed(1)}</div>
            </div>
            <div>
              <div className="text-[9px] text-gray-300 uppercase font-bold">Labor Cost</div>
              <div className="text-[9px] text-gray-400">Hrs × ${canonOpCost.toFixed(2)}/hr</div>
              <div className="text-sm font-bold font-mono text-red-400">{fmt(canonFin.labor_cost)}</div>
            </div>
            <div>
              <div className="text-[9px] text-gray-300 uppercase font-bold">Material Cost</div>
              <div className="text-sm font-bold font-mono" style={{ color: '#fcd34d' }}>{fmt(canonFin.material_cost)}</div>
            </div>
            <div>
              <div className="text-[9px] text-gray-300 uppercase font-bold">Mileage Cost</div>
              <div className="text-[9px] text-gray-400">Mi × ${canonMileRate.toFixed(2)}</div>
              <div className="text-sm font-bold font-mono" style={{ color: '#60a5fa' }}>{fmt(canonFin.transportation_cost)}</div>
            </div>
            <div>
              <div className="text-[9px] text-gray-300 uppercase font-bold">Total Costs</div>
              <div className="text-[9px] text-gray-400">Lbr+Mat+Mil</div>
              <div className="text-sm font-bold font-mono text-red-400">{fmt(canonFin.total_costs)}</div>
            </div>
            <div>
              <div className="text-[9px] text-gray-300 uppercase font-bold">Remaining Balance</div>
              <div className="text-[9px] text-gray-400">Quote−Total Cost</div>
              <div className="text-sm font-bold font-mono" style={{ color: canonBalColor }}>{fmt(canonFin.remaining_balance)}</div>
            </div>
            <div>
              <div className="text-[9px] text-gray-300 uppercase font-bold">Total Collected</div>
              <div className="text-sm font-bold font-mono text-emerald-400">{fmt(canonFin.total_collected)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Log entries */}
      {sorted.length > 0 ? (
        <div className="space-y-2">
          {(() => {
            const interleaved = showGaps ? interleaveWithGaps(sorted, 'date') : sorted.map(e => ({ type: 'entry', data: e }))
            const realEntries = interleaved.filter((item: any) => item.type === 'entry').map((item: any) => item.data)

            return interleaved.map((item: any) => {
              if (item.type === 'gap') {
                return (
                  <div
                    key={`gap-${item.startDate}-${item.endDate}`}
                    className="rounded-lg border p-3"
                    style={{ borderColor: 'rgba(255,255,255,0.1)', borderStyle: 'dashed', background: 'rgba(31,41,55,0.4)', color: '#d97706' }}
                  >
                    <div className="text-[11px] font-semibold text-center">{item.label}</div>
                  </div>
                )
              }

              const l = item.data
              const projRoll = getRoll(l.projId)
              const rr = projRoll.byId[l.id] || {
                cumHours: num(l.hrs), cumMiles: num(l.miles), cumCollected: num(l.collected),
                cumLaborCost: 0, cumMaterialCost: num(l.mat), cumMileageCost: 0, cumTotalCost: 0,
                entryLaborCost: 0, entryMaterialCost: num(l.mat), entryMileageCost: 0, entryTotalCost: 0,
                dayCost: 0, actualCostToDate: 0, remainingAfter: projRoll.quote,
              }
              const balanceColor = getBalanceColor(num(rr.remainingAfter), projRoll.quote)
              const hasPay = num(l.collected) > 0
              const entryTotalStats = [
                { label: 'Labor', amount: fmt(num(rr.entryLaborCost)), Icon: Timer, color: '#e5e7eb', bg: 'rgba(229,231,235,0.06)', border: 'rgba(229,231,235,0.16)' },
                { label: 'Material', amount: fmt(num(l.mat)), Icon: Boxes, color: '#fcd34d', bg: 'rgba(252,211,77,0.08)', border: 'rgba(252,211,77,0.22)' },
                { label: 'Mileage', amount: fmt(num(rr.entryMileageCost)), Icon: Route, color: '#67e8f9', bg: 'rgba(103,232,249,0.08)', border: 'rgba(103,232,249,0.24)' },
                { label: 'Total', amount: fmt(num(rr.entryTotalCost)), Icon: CircleDollarSign, color: '#f87171', bg: 'rgba(248,113,113,0.11)', border: 'rgba(248,113,113,0.34)', featured: true },
              ]

              return (
                <div key={l.id} className="space-y-1">
                  <div
                    className="rounded-lg border border-gray-800 bg-[var(--bg-card)] p-3"
                    style={hasPay ? { background: 'linear-gradient(180deg, rgba(48,209,88,.10), rgba(48,209,88,.04))', borderLeft: '3px solid #10b981' } : { borderLeft: '3px solid #10b981' }}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 w-full space-y-2.5 lg:flex-[1_1_calc(100%-410px)]">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                          <span className="rounded-md border border-cyan-300/10 bg-cyan-400/[0.04] px-2 py-1 font-mono text-[10px] font-semibold text-cyan-100/70">
                            {l.date}
                          </span>
                          <span className="min-w-0 text-[15px] font-extrabold leading-tight text-white">
                            {l.projName}
                          </span>
                          <span className="h-1 w-1 rounded-full bg-cyan-300/35" />
                          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-300/80">{l.phase}</span>
                          <span className="text-[11px] font-semibold text-slate-400">{l.emp || 'Me'}</span>
                          {hasPay && <span className="rounded-full border border-emerald-400/20 bg-emerald-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-emerald-300">Collected</span>}
                        </div>
                        {l.notes && <div className="w-full text-[12px] font-medium leading-relaxed text-white">{l.notes}</div>}
                        {l.store && (
                          <div className="text-[11px] font-medium text-slate-300">
                            <span className="text-slate-500">Store</span> <span className="text-slate-200">{l.store}</span>
                          </div>
                        )}
                        <div className="flex max-w-full flex-wrap gap-2">
                          <div className="w-[96px] rounded-md border border-white/[0.06] bg-white/[0.025] px-2.5 py-2">
                            <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-500">Hrs</div>
                            <div className="mt-0.5 font-mono text-[12px] font-bold leading-none text-slate-100">{num(l.hrs).toFixed(1)}</div>
                          </div>
                          <div className="w-[122px] rounded-md border border-amber-300/[0.12] bg-amber-400/[0.025] px-2.5 py-2">
                            <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-500">Mat</div>
                            <div className="mt-0.5 font-mono text-[12px] font-bold leading-none" style={{ color: '#fcd34d' }}>{fmt(num(l.mat))}</div>
                          </div>
                          <div className="w-[98px] rounded-md border border-cyan-300/[0.10] bg-cyan-400/[0.025] px-2.5 py-2">
                            <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-500">Miles</div>
                            <div className="mt-0.5 font-mono text-[12px] font-bold leading-none" style={{ color: '#60a5fa' }}>{num(l.miles)}</div>
                          </div>
                          <div className="w-[132px] rounded-md border border-emerald-300/[0.12] bg-emerald-400/[0.025] px-2.5 py-2">
                            <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-500">Coll</div>
                            <div className="mt-0.5 font-mono text-[12px] font-bold leading-none" style={{ color: '#6ee7b7' }}>{fmt(num(l.collected))}</div>
                          </div>
                          <div className="w-[154px] rounded-md border border-cyan-200/[0.14] bg-slate-950/20 px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                            <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-400">Remaining</div>
                            <div className="mt-0.5 font-mono text-[13px] font-extrabold leading-none" style={{ color: balanceColor }}>{fmt(num(rr.remainingAfter))}</div>
                          </div>
                        </div>
                      </div>
                      <div className="ml-auto flex w-full flex-wrap justify-end gap-2 lg:w-auto lg:min-w-[390px] lg:flex-none">
                        {entryTotalStats.map(({ label, amount, Icon, color, bg, border, featured }) => (
                          <div
                            key={label}
                            className={`rounded-lg border text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${featured ? 'min-w-[118px] bg-red-950/10 px-3 py-2.5' : 'min-w-[78px] bg-slate-950/20 px-2.5 py-2'}`}
                            style={{ borderColor: border, boxShadow: featured ? `inset 0 1px 0 rgba(255,255,255,0.05), 0 0 18px ${bg}` : undefined }}
                          >
                            <div
                              className={`mx-auto mb-1 flex items-center justify-center rounded-md border ${featured ? 'h-7 w-7' : 'h-6 w-6'}`}
                              style={{ color, background: bg, borderColor: border }}
                            >
                              <Icon size={featured ? 15 : 13} strokeWidth={2} />
                            </div>
                            <div className={`${featured ? 'text-[9px]' : 'text-[8px]'} font-bold uppercase tracking-[0.12em] text-gray-400`}>{label}</div>
                            <div className={`mt-0.5 font-mono font-extrabold leading-tight ${featured ? 'text-[15px]' : 'text-[12px]'}`} style={{ color }}>
                              {amount}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Running totals sub-row */}
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-md border border-white/[0.06] bg-slate-950/20 px-3 py-1.5 text-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                      <span className="inline-flex items-baseline gap-1.5">
                        <span className="font-medium text-slate-500">Cum Hours</span>
                        <span className="font-mono font-medium text-slate-300">{num(rr.cumHours).toFixed(1)}h</span>
                      </span>
                      <span className="inline-flex items-baseline gap-1.5">
                        <span className="font-medium text-slate-500">Cum Mat</span>
                        <span className="font-mono font-medium" style={{ color: '#fcd34d' }}>{fmt(num(rr.cumMaterialCost))}</span>
                      </span>
                      <span className="inline-flex items-baseline gap-1.5">
                        <span className="font-medium text-slate-500">Cum Collected</span>
                        <span className="font-mono font-medium text-emerald-400">{fmt(num(rr.cumCollected))}</span>
                      </span>
                      <span className="inline-flex items-baseline gap-1.5">
                        <span className="font-medium text-slate-500">Cum Cost</span>
                        <span className="font-mono font-medium text-red-400">{fmt(num(rr.cumTotalCost))}</span>
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <button onClick={() => beginLogEdit(l.id)} className="rounded-md border border-white/[0.06] bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold text-slate-300 hover:bg-white/[0.07] hover:text-white">Edit</button>
                      <button onClick={() => deleteLogEntry(l.id)} className="rounded-md border border-red-400/10 bg-red-500/[0.06] px-2.5 py-1 text-[10px] font-semibold text-red-300 hover:bg-red-500/[0.10] hover:text-red-200">Delete</button>
                    </div>
                  </div>
                </div>
              )
            })
          })()}
        </div>
      ) : (
        <div className="text-center py-12 text-gray-500 text-sm">No log entries yet for this project. Click Log to add one.</div>
      )}

      {/* Bottom Running Totals */}
      {sorted.length > 0 && (
        <div style={{
          position: 'sticky',
          bottom: 0,
          backgroundColor: '#1e2130',
          borderTop: '1px solid #4b5563',
          padding: '12px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
          fontSize: '12px',
          fontWeight: '600',
          marginTop: '12px',
          borderRadius: '0 0 8px 8px',
        }}>
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
            <span style={{ color: '#9ca3af' }}>
              Total Hours: <span className="font-mono" style={{ color: '#e5e7eb' }}>{canonFin.total_hours.toFixed(1)}h</span>
            </span>
            <span style={{ color: '#9ca3af' }}>
              Total Labor: <span className="font-mono" style={{ color: '#e5e7eb' }}>{fmt(canonFin.labor_cost)}</span>
            </span>
            <span style={{ color: '#f59e0b' }}>
              Total Mat: <span className="font-mono" style={{ color: '#fcd34d' }}>{fmt(canonFin.material_cost)}</span>
            </span>
            <span style={{ color: '#60a5fa' }}>
              Total Mileage: <span className="font-mono" style={{ color: '#60a5fa' }}>{fmt(canonFin.transportation_cost)}</span>
            </span>
            <span style={{ color: '#10b981' }}>
              Total Collected: <span className="font-mono" style={{ color: '#6ee7b7' }}>{fmt(canonFin.total_collected)}</span>
            </span>
            <span style={{ color: '#ef4444' }}>
              Total Cost: <span className="font-mono">{fmt(canonFin.total_costs)}</span>
            </span>
            {canonFin.quote > 0 && (
              <span style={{ color: canonBalColor }}>
                Balance Left: <span className="font-mono">{fmt(canonFin.remaining_balance)}</span>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
