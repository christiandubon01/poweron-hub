// @ts-nocheck
/**
 * V15rLeadsPanel — Leads with 3 tabs: GC Contacts, Service Leads, Weekly Reviews.
 * Faithfully ported from HTML renderLeads(), renderGCTable(), renderSvcTable(), renderWeeklyReview().
 *
 * Enhanced with:
 * - Quick Log Contact button per GC row with inline form (contact method, notes, auto-timestamp)
 * - AI Suggested Script button placeholder
 * - Follow-up overdue badge with red tint
 * - Next Best Action AI badge per GC
 * - Contact activity timeline (expandable row showing contactLog entries)
 */

import { useState, useCallback } from 'react'
import { Plus, Edit3, Trash2, ChevronDown, ChevronUp, ArrowRight, X } from 'lucide-react'
import {
  getBackupData,
  saveBackupData,
  saveBackupDataAndSync,
  fmtK,
  fmt,
  num,
  daysSince,
  type BackupGCContact,
} from '@/services/backupDataService'
import { pushState } from '@/services/undoRedoService'
import { AskAIButton, AskAIPanel } from './AskAIPanel'
import type { Insight } from './AskAIPanel'

// ── Phase colors ─────────────────────────────────────────────────────────────

const PHASE_COLORS: Record<string, string> = {
  'Awarded': '#10b981',
  'Active Bidding': '#3b82f6',
  'Qualified': '#f59e0b',
  'Prospecting': '#6b7280',
  'First Contact': '#06b6d4',
  'Dormant': '#374151',
  'Converted': '#10b981',
}

const SVC_STATUS_COLORS: Record<string, string> = {
  'Advance': '#10b981',
  'Quoted': '#3b82f6',
  'Booked': '#06b6d4',
  'Park': '#f59e0b',
  'Kill': '#ef4444',
  'Converted': '#10b981',
}
const SVC_STATUS_CYCLE = ['Advance', 'Quoted', 'Booked', 'Park', 'Kill']

function today() {
  return new Date().toISOString().slice(0, 10)
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function V15rLeadsPanel() {
  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])
  const [activeTab, setActiveTab] = useState<'gc' | 'svc' | 'weekly'>('gc')
  const [expandedGCId, setExpandedGCId] = useState<string | null>(null)
  const [openLogFormId, setOpenLogFormId] = useState<string | null>(null)
  const [logFormData, setLogFormData] = useState({ method: 'Call', notes: '' })
  const [aiOpen, setAiOpen] = useState(false)
  const [loggingContactId, setLoggingContactId] = useState<string | null>(null)
  const [logType, setLogType] = useState('Call')
  const [logNotes, setLogNotes] = useState('')

  const backup = getBackupData()
  if (!backup) {
    return (
      <div className="flex items-center justify-center w-full h-64 bg-[#1a1d27]">
        <div className="text-gray-500 text-sm">No backup data. Import to view leads.</div>
      </div>
    )
  }

  const gcContacts = backup.gcContacts || []
  const serviceLeads = backup.serviceLeads || []
  const weeklyReviews = backup.weeklyReviews || []

  function persist() {
    backup._lastSavedAt = new Date().toISOString()
    saveBackupData(backup)
    forceUpdate()
  }

  // ── GC Contacts CRUD ───────────────────────────────────────────────────

  function deleteGC(id: string) {
    if (!confirm('Delete this GC contact?')) return
    pushState(backup)
    backup.gcContacts = gcContacts.filter(c => c.id !== id)
    persist()
  }

  function editGC(id: string) {
    const c = gcContacts.find(x => x.id === id)
    if (!c) return
    const company = prompt('Company:', c.company)
    if (company === null) return
    pushState(backup)
    c.company = company
    const contact = prompt('Contact name:', c.contact)
    if (contact !== null) c.contact = contact
    const phone = prompt('Phone:', c.phone)
    if (phone !== null) c.phone = phone
    const phase = prompt('Phase (First Contact / Prospecting / Qualified / Active Bidding / Awarded / Dormant):', c.phase)
    if (phase !== null) c.phase = phase
    const action = prompt('Next action:', c.action)
    if (action !== null) c.action = action
    const due = prompt('Due date (YYYY-MM-DD):', c.due)
    if (due !== null) c.due = due
    persist()
  }

  function addGC() {
    const company = prompt('Company name:')
    if (!company) return
    const contact = prompt('Contact name:') || ''
    const newGC: any = {
      id: 'gc' + Date.now(),
      company,
      contact,
      role: '',
      phone: '',
      email: '',
      intro: '',
      sent: 0,
      awarded: 0,
      avg: 0,
      pay: '',
      phase: 'First Contact',
      fit: 0,
      action: '',
      due: '',
      notes: '',
      created: today(),
      contactLog: [],
    }
    pushState(backup)
    backup.gcContacts = [...gcContacts, newGC]
    persist()
  }

  function addContactLog(contactId: string) {
    const c = gcContacts.find(x => x.id === contactId)
    if (!c) return
    if (!c.contactLog) c.contactLog = []
    pushState(backup)
    c.contactLog.push({
      timestamp: new Date().toISOString(),
      method: logFormData.method,
      notes: logFormData.notes,
    })
    setOpenLogFormId(null)
    setLogFormData({ method: 'Call', notes: '' })
    persist()
  }

  // ── Lead-to-Project Conversion ───────────────────────────────────────────

  function convertGCToProject(gc: any) {
    if (!confirm(`Convert "${gc.company}" to a new project?`)) return
    pushState(backup)
    const projId = 'proj' + Date.now() + Math.random().toString(36).slice(2, 6)
    const newProj: any = {
      id: projId, name: gc.company + (gc.contact ? ' — ' + gc.contact : ''),
      client: gc.company, type: 'Commercial', status: 'active',
      contract: num(gc.avg), billed: 0, paid: 0, mileRT: 0, miDays: 0,
      phases: { Planning: 0, Estimating: 0, 'Site Prep': 0, 'Rough-in': 0, Trim: 0, Finish: 0 },
      tasks: { Planning: [], Estimating: [], 'Site Prep': [], 'Rough-in': [], Trim: [], Finish: [] },
      laborRows: [], ohRows: [], matRows: [], mtoRows: [], rfis: [], coord: {}, logs: [], finance: {},
      lastMove: today(), notes: gc.notes || '', created: new Date().toISOString(),
      convertedFromLeadId: gc.id, convertedFromLeadType: 'gcContact',
    }
    backup.projects = [...(backup.projects || []), newProj]
    // Update GC contact phase to Converted and link
    gc.phase = 'Converted'
    gc.convertedProjectId = projId
    saveBackupDataAndSync(backup)
    forceUpdate()
    alert(`Project created: ${newProj.name}`)
  }

  function convertSvcLeadToProject(lead: any) {
    if (!confirm(`Convert service lead "${lead.customer}" to a new project?`)) return
    pushState(backup)
    const projId = 'proj' + Date.now() + Math.random().toString(36).slice(2, 6)
    const newProj: any = {
      id: projId, name: lead.customer || 'Service Project',
      client: lead.customer, type: lead.type || 'Service', status: 'active',
      contract: num(lead.price || lead.totalQuote || 0), billed: 0, paid: 0, mileRT: num(lead.miles || lead.milesRT || 0), miDays: 0,
      phases: { Planning: 0, Estimating: 0, 'Site Prep': 0, 'Rough-in': 0, Trim: 0, Finish: 0 },
      tasks: { Planning: [], Estimating: [], 'Site Prep': [], 'Rough-in': [], Trim: [], Finish: [] },
      laborRows: [], ohRows: [], matRows: [], mtoRows: [], rfis: [], coord: {}, logs: [], finance: {},
      lastMove: today(), notes: lead.notes || '', created: new Date().toISOString(),
      convertedFromLeadId: lead.id, convertedFromLeadType: 'serviceLead',
    }
    backup.projects = [...(backup.projects || []), newProj]
    // Update service lead status to Converted and link
    lead.status = 'Converted'
    lead.convertedProjectId = projId
    saveBackupDataAndSync(backup)
    forceUpdate()
    alert(`Project created: ${newProj.name}`)
  }

  // ── Service Leads CRUD ─────────────────────────────────────────────────

  function deleteSvcLead(id: string) {
    if (!confirm('Delete this service lead?')) return
    pushState(backup)
    backup.serviceLeads = serviceLeads.filter((l: any) => l.id !== id)
    persist()
  }

  function cycleSvcStatus(id: string) {
    const l = serviceLeads.find((x: any) => x.id === id)
    if (!l) return
    pushState(backup)
    const idx = SVC_STATUS_CYCLE.indexOf(l.status)
    l.status = SVC_STATUS_CYCLE[(idx + 1) % SVC_STATUS_CYCLE.length]
    persist()
  }

  function addSvcLead() {
    const customer = prompt('Customer name:')
    if (!customer) return
    pushState(backup)
    const newLead = {
      id: 'sl' + Date.now(),
      date: today(),
      source: '',
      customer,
      city: '',
      type: '',
      miles: 0,
      urgency: '',
      status: 'Advance',
      price: 0,
      followup: '',
      notes: '',
      created: today(),
    }
    backup.serviceLeads = [...serviceLeads, newLead]
    persist()
  }

  // ── Weekly Reviews CRUD ────────────────────────────────────────────────

  function deleteWeeklyReview(id: string) {
    if (!confirm('Delete this weekly review?')) return
    pushState(backup)
    backup.weeklyReviews = weeklyReviews.filter((w: any) => w.id !== id)
    persist()
  }

  function addWeeklyReview() {
    pushState(backup)
    const newReview = {
      id: 'wr' + Date.now(),
      date: today(),
      total: 0,
      advance: 0,
      park: 0,
      kill: 0,
      svc: 0,
      proj: 0,
      source: '',
      notes: '',
      created: today(),
    }
    backup.weeklyReviews = [...weeklyReviews, newReview]
    persist()
  }

  // ── Tab styling ────────────────────────────────────────────────────────

  const tabStyle = (key: string) => ({
    background: activeTab === key ? '#3b82f6' : '#1e2130',
    color: activeTab === key ? '#fff' : '#9ca3af',
    border: activeTab === key ? '1px solid transparent' : '1px solid #2e2e3a',
  })

  // ── GC Aggregation Function ────────────────────────────────────────────

  function getGCAggregation(gc: any, backup: any) {
    const companyLower = (gc.company || '').toLowerCase().trim()
    if (!companyLower) return { sent: gc.sent || 0, awarded: gc.awarded || 0, avg: gc.avg || 0, linkedLeads: [], linkedLogs: [] }

    const leads = (backup.serviceLeads || []).filter((l: any) =>
      (l.customer || '').toLowerCase().includes(companyLower) ||
      companyLower.includes((l.customer || '').toLowerCase())
    )
    const logs = (backup.serviceLogs || []).filter((l: any) =>
      (l.customer || '').toLowerCase().includes(companyLower) ||
      companyLower.includes((l.customer || '').toLowerCase())
    )

    const sent = Math.max(gc.sent || 0, leads.length)
    const awarded = Math.max(gc.awarded || 0, logs.length)
    const totalQuoted = logs.reduce((s: number, l: any) => s + num(l.quoted || 0), 0)
    const avg = logs.length > 0 ? totalQuoted / logs.length : num(gc.avg || 0)

    return { sent, awarded, avg, linkedLeads: leads, linkedLogs: logs }
  }

  // ── Render GC Table ────────────────────────────────────────────────────

  function renderGCTable() {
    return (
      <div>
        <div className="flex justify-end mb-3">
          <button onClick={addGC} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold">
            <Plus size={12} /> Add GC
          </button>
        </div>
        {gcContacts.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-gray-500 uppercase border-b border-gray-700">
                  <th className="text-left py-2 px-2 font-bold">Company / Contact</th>
                  <th className="text-left py-2 px-2 font-bold">Role</th>
                  <th className="text-left py-2 px-2 font-bold">Phone</th>
                  <th className="text-right py-2 px-2 font-bold">Sent</th>
                  <th className="text-right py-2 px-2 font-bold">Awarded</th>
                  <th className="text-right py-2 px-2 font-bold">Avg Job</th>
                  <th className="text-left py-2 px-2 font-bold">Pay</th>
                  <th className="text-left py-2 px-2 font-bold">Phase</th>
                  <th className="text-right py-2 px-2 font-bold">Fit</th>
                  <th className="text-left py-2 px-2 font-bold">Action / Due</th>
                  <th className="text-center py-2 px-2 font-bold">AI Score</th>
                  <th className="text-center py-2 px-2 font-bold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {gcContacts.map(c => {
                  const phaseClr = PHASE_COLORS[c.phase] || '#6b7280'
                  const fitClr = c.fit >= 4 ? '#10b981' : c.fit >= 3 ? '#f59e0b' : '#ef4444'
                  const isOverdue = c.due && c.due < today()
                  const isExpanded = expandedGCId === c.id
                  const agg = getGCAggregation(c, backup)

                  return (
                    <tbody key={c.id}>
                      <tr className={`border-b border-gray-800/50 hover:bg-gray-700/20 ${isOverdue ? 'bg-red-900/10' : ''}`}>
                        <td className="py-2 px-2">
                          <div className="font-semibold text-gray-200">{c.company}</div>
                          <div className="text-gray-500">{c.contact}</div>
                          {c.lastContact && (
                            <span className="text-xs text-gray-500">Last contact: {c.lastContact}</span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-gray-400">{c.role}</td>
                        <td className="py-2 px-2 text-gray-400">{c.phone}</td>
                        <td className="py-2 px-2 text-right font-mono text-gray-300">{agg.sent}</td>
                        <td className="py-2 px-2 text-right font-mono text-emerald-400">{agg.awarded}</td>
                        <td className="py-2 px-2 text-right font-mono text-gray-300">{fmtK(agg.avg)}</td>
                        <td className="py-2 px-2 text-gray-400">{(c.pay || '').split('(')[0]}</td>
                        <td className="py-2 px-2">
                          <span className="text-[9px] px-2 py-0.5 rounded font-semibold" style={{ background: phaseClr + '22', color: phaseClr }}>
                            {c.phase}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right font-mono font-bold" style={{ color: fitClr }}>{c.fit}</td>
                        <td className="py-2 px-2">
                          <div className="text-gray-300">{c.action}</div>
                          {c.due && (
                            <div className={`text-[9px] ${isOverdue ? 'text-red-400 font-bold' : 'text-gray-500'}`}>
                              {isOverdue && <span className="bg-red-600 text-white px-1 rounded text-[8px] mr-1">{Math.ceil((new Date(c.due).getTime() - new Date(today()).getTime()) / (1000*60*60*24))} days</span>}
                              {c.due}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-2 text-center">
                          <button onClick={() => alert('AI script generation coming soon - will send lead context to NEXUS')} className="text-[9px] px-1.5 py-0.5 rounded bg-purple-700/50 text-purple-300 hover:text-purple-200">AI Script</button>
                        </td>
                        <td className="py-2 px-2 text-center">
                          <div className="flex gap-1 justify-center">
                            {c.phase === 'Awarded' && !c.convertedProjectId && (
                              <button onClick={() => convertGCToProject(c)} className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-700/50 text-emerald-300 hover:text-emerald-200 font-semibold" title="Convert to Project">→Proj</button>
                            )}
                            {c.convertedProjectId && (
                              <span className="text-[8px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">Converted</span>
                            )}
                            <button onClick={() => editGC(c.id)} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-400 hover:text-gray-300">✎</button>
                            <button onClick={() => deleteGC(c.id)} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-700/50 text-red-400 hover:text-red-300">✕</button>
                            <button onClick={() => setExpandedGCId(isExpanded ? null : c.id)} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-400">
                              {isExpanded ? '▲' : '▼'}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded row: Contact Log + Quick Log Form + Next Best Action */}
                      {isExpanded && (
                        <tr className="border-b border-gray-800/50 bg-gray-800/30">
                          <td colSpan={12} className="py-3 px-4">
                            <div className="space-y-4">
                              {/* Next Best Action AI Chip */}
                              <div className="flex gap-2">
                                <button onClick={() => alert('AI: Analyze - NEXUS will recommend next best action')} className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-cyan-600/30 text-cyan-300 text-xs font-semibold hover:bg-cyan-600/40">
                                  🤖 Next Best Action
                                </button>
                              </div>

                              {/* Contact Log Timeline */}
                              <div className="mt-3 space-y-2">
                                <div className="flex justify-between items-center">
                                  <h5 className="text-xs font-medium text-gray-400">Contact Log</h5>
                                  <button
                                    onClick={() => {
                                      setLoggingContactId(c.id)
                                      setLogType('Call')
                                      setLogNotes('')
                                    }}
                                    className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                                  >
                                    <Plus className="w-3 h-3" /> Log Interaction
                                  </button>
                                </div>

                                {/* Add interaction form */}
                                {loggingContactId === c.id && (
                                  <div className="p-3 bg-gray-900/50 border border-gray-700/50 rounded-lg space-y-2">
                                    <select
                                      value={logType}
                                      onChange={(e) => setLogType(e.target.value)}
                                      className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-200 text-xs"
                                    >
                                      <option>Call</option>
                                      <option>Email</option>
                                      <option>Meeting</option>
                                      <option>Site Visit</option>
                                      <option>Bid Submitted</option>
                                    </select>
                                    <textarea
                                      value={logNotes}
                                      onChange={(e) => setLogNotes(e.target.value)}
                                      placeholder="Notes..."
                                      className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-200 text-xs h-16"
                                    />
                                    <div className="flex gap-2">
                                      <button
                                        onClick={() => {
                                          const logEntry = {
                                            id: `cl_${Date.now()}`,
                                            date: new Date().toISOString().slice(0, 10),
                                            type: logType,
                                            notes: logNotes,
                                          }
                                          const updatedContacts = (backup.gcContacts || []).map(gc =>
                                            gc.id === c.id
                                              ? { ...gc, contactLog: [...(gc.contactLog || []), logEntry], lastContact: logEntry.date }
                                              : gc
                                          )
                                          saveBackupData({ ...backup, gcContacts: updatedContacts })
                                          setLoggingContactId(null)
                                          forceUpdate()
                                        }}
                                        className="px-3 py-1 bg-cyan-600/20 text-cyan-400 rounded text-xs"
                                      >
                                        Save
                                      </button>
                                      <button onClick={() => setLoggingContactId(null)} className="px-3 py-1 bg-gray-700 text-gray-400 rounded text-xs">Cancel</button>
                                    </div>
                                  </div>
                                )}

                                {/* Log entries */}
                                {(c.contactLog || []).slice().reverse().map((log: any) => (
                                  <div key={log.id || log.date} className="flex items-start gap-2 pl-3 border-l-2 border-gray-700">
                                    <div>
                                      <span className="text-xs text-gray-300">{log.date}</span>
                                      <span className="text-xs text-cyan-400 ml-2">{log.type}</span>
                                      {log.notes && <p className="text-xs text-gray-400 mt-0.5">{log.notes}</p>}
                                    </div>
                                  </div>
                                ))}

                                {(c.contactLog || []).length === 0 && (
                                  <p className="text-gray-600 text-xs">No interactions logged yet</p>
                                )}
                              </div>

                              {/* Quick Log Contact Form */}
                              {openLogFormId === c.id ? (
                                <div className="bg-[#1a1d27] rounded p-3 border border-gray-700 space-y-2">
                                  <div className="text-xs font-bold text-gray-400">Quick Log Contact</div>
                                  <select
                                    value={logFormData.method}
                                    onChange={(e) => setLogFormData({...logFormData, method: e.target.value})}
                                    className="w-full text-xs px-2 py-1.5 rounded bg-gray-800 text-gray-100 border border-gray-700"
                                  >
                                    <option>Call</option>
                                    <option>Text</option>
                                    <option>Email</option>
                                  </select>
                                  <textarea
                                    placeholder="Notes (optional)"
                                    value={logFormData.notes}
                                    onChange={(e) => setLogFormData({...logFormData, notes: e.target.value})}
                                    className="w-full text-xs px-2 py-1.5 rounded bg-gray-800 text-gray-100 border border-gray-700 h-12"
                                  />
                                  <div className="flex gap-1">
                                    <button onClick={() => addContactLog(c.id)} className="flex-1 px-2 py-1 bg-emerald-600 text-white text-xs rounded font-semibold hover:bg-emerald-700">Save</button>
                                    <button onClick={() => setOpenLogFormId(null)} className="flex-1 px-2 py-1 bg-gray-700 text-gray-300 text-xs rounded font-semibold hover:bg-gray-600">Cancel</button>
                                  </div>
                                </div>
                              ) : (
                                <button onClick={() => setOpenLogFormId(c.id)} className="px-3 py-1.5 bg-blue-600/30 text-blue-300 text-xs rounded font-semibold hover:bg-blue-600/40">
                                  + Quick Log Contact
                                </button>
                              )}

                              {/* Linked Jobs Section */}
                              <div className="bg-[#1a1d27] rounded p-3 border border-gray-700 space-y-3">
                                <div className="text-xs font-bold text-gray-400">Linked Jobs</div>

                                {/* Linked Service Leads */}
                                {agg.linkedLeads.length > 0 && (
                                  <div>
                                    <div className="text-[9px] font-semibold text-gray-500 mb-2">Service Leads ({agg.linkedLeads.length})</div>
                                    <div className="space-y-1.5">
                                      {agg.linkedLeads.map((lead: any) => {
                                        const statusClr = SVC_STATUS_COLORS[lead.status] || '#6b7280'
                                        return (
                                          <div key={lead.id} className="bg-[#232738] rounded p-2 border border-gray-800 text-[9px] space-y-1">
                                            <div className="flex justify-between">
                                              <span className="text-gray-400">{lead.date}</span>
                                              <span className="text-gray-500">{lead.customer}</span>
                                            </div>
                                            <div className="flex justify-between items-center">
                                              <span className="text-gray-400">{lead.type || '—'}</span>
                                              <span className="text-[8px] px-1.5 py-0.5 rounded font-semibold" style={{ background: statusClr + '22', color: statusClr }}>
                                                {lead.status}
                                              </span>
                                            </div>
                                            {lead.price > 0 && <div className="text-gray-400">Price: {fmtK(lead.price)}</div>}
                                          </div>
                                        )
                                      })}
                                    </div>
                                  </div>
                                )}

                                {/* Linked Service Logs */}
                                {agg.linkedLogs.length > 0 && (
                                  <div>
                                    <div className="text-[9px] font-semibold text-gray-500 mb-2">Service Logs ({agg.linkedLogs.length})</div>
                                    <div className="space-y-1.5">
                                      {agg.linkedLogs.map((log: any) => (
                                        <div key={log.id} className="bg-[#232738] rounded p-2 border border-gray-800 text-[9px] space-y-1">
                                          <div className="flex justify-between">
                                            <span className="text-gray-400">{log.date}</span>
                                            <span className="text-gray-500">{log.customer}</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-gray-400">{log.jtype || '—'}</span>
                                            <span className="text-gray-400">{log.payStatus || '—'}</span>
                                          </div>
                                          <div className="flex justify-between text-gray-400">
                                            <span>Quoted: {fmtK(log.quoted || 0)}</span>
                                            <span>Collected: {fmtK(log.collected || 0)}</span>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {agg.linkedLeads.length === 0 && agg.linkedLogs.length === 0 && (
                                  <div className="text-xs text-gray-500">No linked service jobs found</div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-xs text-gray-500">No GC contacts yet.</div>
        )}
      </div>
    )
  }

  // ── Render Service Leads Table ─────────────────────────────────────────

  function renderSvcTable() {
    return (
      <div>
        <div className="flex justify-end mb-3">
          <button onClick={addSvcLead} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-orange-600 text-white text-xs font-semibold">
            <Plus size={12} /> Add Lead
          </button>
        </div>
        {serviceLeads.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-gray-500 uppercase border-b border-gray-700">
                  <th className="text-left py-2 px-2 font-bold">Date</th>
                  <th className="text-left py-2 px-2 font-bold">Customer</th>
                  <th className="text-left py-2 px-2 font-bold">Type</th>
                  <th className="text-left py-2 px-2 font-bold">Source</th>
                  <th className="text-right py-2 px-2 font-bold">Miles</th>
                  <th className="text-left py-2 px-2 font-bold">Urgency</th>
                  <th className="text-left py-2 px-2 font-bold">Status</th>
                  <th className="text-right py-2 px-2 font-bold">Price</th>
                  <th className="text-left py-2 px-2 font-bold">Follow-up</th>
                  <th className="text-center py-2 px-2 font-bold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {serviceLeads.map((l: any) => {
                  const statusClr = SVC_STATUS_COLORS[l.status] || '#6b7280'
                  const urgClr = l.urgency === 'Emergency' ? '#ef4444' : l.urgency === 'This Week' ? '#f59e0b' : '#6b7280'
                  const isOverdue = l.followup && l.followup < today()

                  return (
                    <tr key={l.id} className={`border-b border-gray-800/50 hover:bg-gray-700/20 ${isOverdue ? 'bg-red-900/10' : ''}`}>
                      <td className="py-2 px-2 text-gray-500 font-mono">{l.date}</td>
                      <td className="py-2 px-2 text-gray-200 font-medium">{l.customer}</td>
                      <td className="py-2 px-2 text-gray-400">{l.type}</td>
                      <td className="py-2 px-2 text-gray-500">{l.source}</td>
                      <td className="py-2 px-2 text-right font-mono text-gray-300">{l.miles}mi</td>
                      <td className="py-2 px-2">
                        <span style={{ color: urgClr }}>{l.urgency || '—'}</span>
                      </td>
                      <td className="py-2 px-2">
                        <span className="text-[9px] px-2 py-0.5 rounded font-semibold cursor-pointer" style={{ background: statusClr + '22', color: statusClr }} onClick={() => cycleSvcStatus(l.id)}>
                          {l.status}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-gray-300">{l.price ? fmtK(l.price) : '—'}</td>
                      <td className="py-2 px-2">
                        <span className={isOverdue ? 'text-red-400 font-bold' : 'text-gray-500'}>
                          {l.followup || '—'}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-center">
                        <div className="flex gap-1 justify-center">
                          {l.status === 'Booked' && !l.convertedProjectId && (
                            <button onClick={() => convertSvcLeadToProject(l)} className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-700/50 text-emerald-300 hover:text-emerald-200 font-semibold" title="Convert to Project">→Proj</button>
                          )}
                          {l.convertedProjectId && (
                            <span className="text-[8px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">Converted</span>
                          )}
                          <button onClick={() => cycleSvcStatus(l.id)} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-400 hover:text-gray-300">↻</button>
                          <button onClick={() => deleteSvcLead(l.id)} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-700/50 text-red-400 hover:text-red-300">✕</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-xs text-gray-500">No service leads yet.</div>
        )}
      </div>
    )
  }

  // ── Render Weekly Reviews Table ────────────────────────────────────────

  function renderWeeklyTable() {
    // Summary stats (last 4 reviews)
    const last4 = weeklyReviews.slice(-4)
    const avg4Leads = last4.length > 0 ? last4.reduce((s: number, w: any) => s + num(w.total), 0) / last4.length : 0
    const avg4Advance = last4.length > 0 ? last4.reduce((s: number, w: any) => s + num(w.advance), 0) / last4.length : 0
    const convRate = avg4Leads > 0 ? ((avg4Advance / avg4Leads) * 100).toFixed(0) : '0'

    return (
      <div>
        {/* Summary KPIs */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          {[
            { lbl: '4-Wk Avg Leads', val: avg4Leads.toFixed(1) },
            { lbl: '4-Wk Avg Advance', val: avg4Advance.toFixed(1), clr: '#10b981' },
            { lbl: 'Conversion Rate', val: convRate + '%', clr: Number(convRate) >= 30 ? '#10b981' : '#f59e0b' },
            { lbl: 'Total Reviews', val: String(weeklyReviews.length) },
          ].map((k, i) => (
            <div key={i} className="bg-[#232738] rounded-lg p-2.5 border border-gray-800">
              <div className="text-[8px] uppercase text-gray-500 font-bold">{k.lbl}</div>
              <div className="text-sm font-bold font-mono mt-1" style={{ color: k.clr || '#e5e7eb' }}>{k.val}</div>
            </div>
          ))}
        </div>

        <div className="flex justify-end mb-3">
          <button onClick={addWeeklyReview} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold">
            <Plus size={12} /> Add Review
          </button>
        </div>

        {weeklyReviews.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-gray-500 uppercase border-b border-gray-700">
                  <th className="text-left py-2 px-2 font-bold">Date</th>
                  <th className="text-right py-2 px-2 font-bold">Total</th>
                  <th className="text-right py-2 px-2 font-bold">Advance</th>
                  <th className="text-right py-2 px-2 font-bold">Park</th>
                  <th className="text-right py-2 px-2 font-bold">Kill</th>
                  <th className="text-right py-2 px-2 font-bold">Service ($)</th>
                  <th className="text-right py-2 px-2 font-bold">Projects ($)</th>
                  <th className="text-left py-2 px-2 font-bold">Notes</th>
                  <th className="text-center py-2 px-2 font-bold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {weeklyReviews.map((w: any) => (
                  <tr key={w.id} className="border-b border-gray-800/50 hover:bg-gray-700/20">
                    <td className="py-2 px-2 text-gray-500 font-mono">{w.date}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-300">{w.total}</td>
                    <td className="py-2 px-2 text-right font-mono text-emerald-400">{w.advance}</td>
                    <td className="py-2 px-2 text-right font-mono text-yellow-400">{w.park}</td>
                    <td className="py-2 px-2 text-right font-mono text-red-400">{w.kill}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-300">{fmt(w.svc)}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-300">{fmt(w.proj)}</td>
                    <td className="py-2 px-2 text-gray-500 max-w-[200px] truncate">{w.notes || '—'}</td>
                    <td className="py-2 px-2 text-center">
                      <button onClick={() => deleteWeeklyReview(w.id)} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-700/50 text-red-400 hover:text-red-300">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-xs text-gray-500">No weekly reviews yet.</div>
        )}
      </div>
    )
  }

  // ── Generate AI insights ────────────────────────────────────────────────

  const generateLeadsInsights = (): Insight[] => {
    const insights: Insight[] = []

    // Flag contacts with no activity in 30+ days
    const staleContacts = gcContacts.filter(gc => {
      const daysSinceContact = daysSince(gc.lastContactDate || '1970-01-01')
      return daysSinceContact >= 30
    })
    if (staleContacts.length > 0) {
      insights.push({
        icon: '⚠️',
        text: `${staleContacts.length} GC contact(s) dormant 30+ days. Reach out to stay warm.`,
        severity: 'warning',
      })
    }

    // Suggest next actions based on phase
    const awaitingBid = gcContacts.filter(gc => gc.phase === 'Active Bidding').length
    const qualified = gcContacts.filter(gc => gc.phase === 'Qualified').length
    if (awaitingBid > 0) {
      insights.push({
        icon: 'ℹ️',
        text: `${awaitingBid} bid(s) pending. Follow up if no response in 7 days.`,
        severity: 'info',
      })
    }
    if (qualified > 0) {
      insights.push({
        icon: 'ℹ️',
        text: `${qualified} contact(s) qualified. Push toward contract or set follow-up reminder.`,
        severity: 'info',
      })
    }

    // Highlight high-fit contacts not engaged
    const prospecting = gcContacts.filter(gc => gc.phase === 'Prospecting' && daysSince(gc.lastContactDate || '1970-01-01') > 7)
    if (prospecting.length > 0) {
      insights.push({
        icon: 'ℹ️',
        text: `${prospecting.length} prospective contact(s) ready for outreach.`,
        severity: 'info',
      })
    }

    if (insights.length === 0) {
      insights.push({
        icon: '✓',
        text: 'Leads and contacts engagement looks good.',
        severity: 'success',
      })
    }

    return insights
  }

  // ── Main return ────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#1a1d27] p-6">
      {/* Tab switcher */}
      <div className="flex gap-2 mb-6 items-center">
        {[
          { key: 'gc' as const, label: 'GC / Relations' },
          { key: 'svc' as const, label: 'Service Pipeline' },
          { key: 'weekly' as const, label: 'Weekly Review' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="px-4 py-2 rounded-lg text-xs font-bold transition-all"
            style={tabStyle(tab.key)}
          >
            {tab.label}
          </button>
        ))}
        <div className="ml-auto">
          <AskAIButton onClick={() => setAiOpen(true)} />
        </div>
      </div>

      {activeTab === 'gc' && renderGCTable()}
      {activeTab === 'svc' && renderSvcTable()}
      {activeTab === 'weekly' && renderWeeklyTable()}

      <AskAIPanel
        panelName="Leads"
        insights={generateLeadsInsights()}
        dataContext={{
          gcContactCount: gcContacts.length,
          gcContacts: gcContacts.slice(0, 20).map(c => ({
            company: c.company, contact: c.contact, status: c.status,
            lastContact: c.lastContact, nextFollowUp: c.nextFollowUp,
          })),
          serviceLeadCount: serviceLeads.length,
          serviceLeads: serviceLeads.slice(0, 20).map(l => ({
            name: l.name, source: l.source, status: l.status,
            lastContact: l.lastContact, value: l.value,
          })),
          weeklyReviewCount: weeklyReviews.length,
        }}
        isOpen={aiOpen}
        onClose={() => setAiOpen(false)}
      />
    </div>
  )
}
