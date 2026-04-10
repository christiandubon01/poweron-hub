// @ts-nocheck
/**
 * GuardianRFIPanel.tsx
 *
 * Lists all RFIs per project, allows generating new RFIs, sending follow-ups,
 * and recording responses.  Integrates with GuardianRFIGenerator service.
 *
 * Status badge colours:
 *   draft            — grey
 *   sent             — blue
 *   awaiting_response — amber
 *   responded        — green
 *   overdue          — red
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Mail,
  Plus,
  RefreshCw,
  Send,
  MessageSquare,
  FileText,
  XCircle,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  generateRFI,
  sendRFI,
  markRFIResponse,
  checkRFIFollowUp,
  type GuardianRFI,
  type RFIStatus,
  type GuardianRFIConflictData,
} from '@/services/guardian/GuardianRFIGenerator'

// ── Props ─────────────────────────────────────────────────────────────────────

interface GuardianRFIPanelProps {
  projectId: string
  projectAddress?: string
}

// ── Badge helpers ─────────────────────────────────────────────────────────────

function statusBadge(status: RFIStatus) {
  const map: Record<RFIStatus, { label: string; classes: string }> = {
    draft: { label: 'Draft', classes: 'bg-gray-700 text-gray-300' },
    sent: { label: 'Sent', classes: 'bg-blue-700 text-blue-100' },
    awaiting_response: { label: 'Awaiting Response', classes: 'bg-amber-700 text-amber-100' },
    responded: { label: 'Responded', classes: 'bg-green-700 text-green-100' },
    overdue: { label: 'Overdue', classes: 'bg-red-700 text-red-100' },
  }
  const { label, classes } = map[status] ?? { label: status, classes: 'bg-gray-600 text-gray-200' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${classes}`}>
      {label}
    </span>
  )
}

function statusIcon(status: RFIStatus) {
  switch (status) {
    case 'responded':
      return <CheckCircle className="w-4 h-4 text-green-400" />
    case 'overdue':
      return <AlertTriangle className="w-4 h-4 text-red-400" />
    case 'sent':
    case 'awaiting_response':
      return <Clock className="w-4 h-4 text-amber-400" />
    default:
      return <FileText className="w-4 h-4 text-gray-400" />
  }
}

// ── Average response time ─────────────────────────────────────────────────────

function avgResponseHours(rfis: GuardianRFI[]): string {
  const responded = rfis.filter(r => r.sent_at && r.responded_at)
  if (responded.length === 0) return 'N/A'
  const total = responded.reduce((sum, r) => {
    const sent = new Date(r.sent_at!).getTime()
    const resp = new Date(r.responded_at!).getTime()
    return sum + (resp - sent)
  }, 0)
  const avgMs = total / responded.length
  const hours = avgMs / 1000 / 60 / 60
  if (hours < 24) return `${Math.round(hours)}h`
  return `${(hours / 24).toFixed(1)} days`
}

// ── New RFI Form ──────────────────────────────────────────────────────────────

interface NewRFIFormState {
  projectAddress: string
  permitNumber: string
  conflictDescription: string
  necReference: string
  requiredCorrectiveAction: string
  recipientEmail: string
  directedTo: string
}

const EMPTY_FORM: NewRFIFormState = {
  projectAddress: '',
  permitNumber: '',
  conflictDescription: '',
  necReference: '',
  requiredCorrectiveAction: '',
  recipientEmail: '',
  directedTo: '',
}

// ── Component ─────────────────────────────────────────────────────────────────

const GuardianRFIPanel: React.FC<GuardianRFIPanelProps> = ({ projectId, projectAddress = '' }) => {
  const [rfis, setRfis] = useState<GuardianRFI[]>([])
  const [loading, setLoading] = useState(false)
  const [showNewForm, setShowNewForm] = useState(false)
  const [form, setForm] = useState<NewRFIFormState>({ ...EMPTY_FORM, projectAddress })
  const [generating, setGenerating] = useState(false)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [responseModal, setResponseModal] = useState<{ rfiId: string; text: string } | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ── Load RFIs ──────────────────────────────────────────────────────────────

  const loadRFIs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: dbErr } = await (supabase.from('guardian_rfis') as any)
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
      if (dbErr) throw dbErr
      setRfis((data ?? []) as GuardianRFI[])
    } catch (err) {
      setError('Could not load RFIs. Supabase may be unavailable.')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    loadRFIs()
  }, [loadRFIs])

  // ── Generate RFI ───────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    const {
      projectAddress: addr,
      permitNumber,
      conflictDescription,
      necReference,
      requiredCorrectiveAction,
      directedTo,
    } = form
    if (!addr || !conflictDescription || !necReference || !requiredCorrectiveAction) {
      setError('Please fill in all required fields.')
      return
    }
    setGenerating(true)
    setError(null)
    try {
      const conflict: GuardianRFIConflictData = {
        projectAddress: addr,
        permitNumber,
        conflictDescription,
        necReference,
        requiredCorrectiveAction,
        directedTo,
      }
      const rfi = await generateRFI(projectId, conflict)
      setRfis(prev => [rfi, ...prev])
      setShowNewForm(false)
      setForm({ ...EMPTY_FORM, projectAddress })
      setExpandedId(rfi.id)
    } catch (err) {
      setError('Failed to generate RFI. Please try again.')
    } finally {
      setGenerating(false)
    }
  }

  // ── Send RFI ───────────────────────────────────────────────────────────────

  const handleSend = async (rfi: GuardianRFI) => {
    const email = rfi.recipient_email || prompt('Enter recipient email address:')
    if (!email) return
    setSendingId(rfi.id)
    setError(null)
    try {
      await sendRFI(rfi.id, email)
      setRfis(prev =>
        prev.map(r =>
          r.id === rfi.id
            ? { ...r, status: 'sent', recipient_email: email, sent_at: new Date().toISOString() }
            : r
        )
      )
    } catch (err) {
      setError('Failed to send RFI email. Check Resend API key configuration.')
    } finally {
      setSendingId(null)
    }
  }

  // ── Follow-Up ──────────────────────────────────────────────────────────────

  const handleFollowUp = async (rfi: GuardianRFI) => {
    setSendingId(rfi.id)
    setError(null)
    try {
      await checkRFIFollowUp()
      await loadRFIs()
    } catch (err) {
      setError('Follow-up check failed.')
    } finally {
      setSendingId(null)
    }
  }

  // ── Record Response ────────────────────────────────────────────────────────

  const handleSaveResponse = async () => {
    if (!responseModal) return
    setError(null)
    try {
      await markRFIResponse(responseModal.rfiId, responseModal.text)
      setRfis(prev =>
        prev.map(r =>
          r.id === responseModal.rfiId
            ? {
                ...r,
                status: 'responded',
                response_text: responseModal.text,
                responded_at: new Date().toISOString(),
              }
            : r
        )
      )
      setResponseModal(null)
    } catch (err) {
      setError('Could not save response.')
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const overdue = rfis.filter(r => r.status === 'overdue').length
  const pending = rfis.filter(r => r.status === 'sent' || r.status === 'awaiting_response').length

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Mail className="w-5 h-5 text-blue-400" />
            RFI Manager
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {rfis.length} total · {pending} pending · {overdue > 0 && (
              <span className="text-red-400">{overdue} overdue</span>
            )}
            {overdue === 0 && <span className="text-green-400">0 overdue</span>}
            {' · Avg response: '}
            <span className="text-amber-400">{avgResponseHours(rfis)}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadRFIs}
            disabled={loading}
            className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowNewForm(v => !v)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            Generate New RFI
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-900/40 border border-red-700 rounded-lg text-red-300 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto"><XCircle className="w-4 h-4" /></button>
        </div>
      )}

      {/* New RFI Form */}
      {showNewForm && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-white">New RFI</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Project Address *</label>
              <input
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                value={form.projectAddress}
                onChange={e => setForm(f => ({ ...f, projectAddress: e.target.value }))}
                placeholder="123 Main St, Los Angeles, CA"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Permit Number</label>
              <input
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                value={form.permitNumber}
                onChange={e => setForm(f => ({ ...f, permitNumber: e.target.value }))}
                placeholder="2024-ELEC-00123"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-gray-400 block mb-1">Conflict Description *</label>
              <textarea
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 resize-none"
                rows={2}
                value={form.conflictDescription}
                onChange={e => setForm(f => ({ ...f, conflictDescription: e.target.value }))}
                placeholder="Describe the code conflict or issue…"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">NEC Reference *</label>
              <input
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                value={form.necReference}
                onChange={e => setForm(f => ({ ...f, necReference: e.target.value }))}
                placeholder="e.g. NEC 210.52(A)"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Directed To</label>
              <input
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                value={form.directedTo}
                onChange={e => setForm(f => ({ ...f, directedTo: e.target.value }))}
                placeholder="GC / Inspector name"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-gray-400 block mb-1">Required Corrective Action *</label>
              <textarea
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 resize-none"
                rows={2}
                value={form.requiredCorrectiveAction}
                onChange={e => setForm(f => ({ ...f, requiredCorrectiveAction: e.target.value }))}
                placeholder="What must be corrected before work proceeds…"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setShowNewForm(false); setForm({ ...EMPTY_FORM, projectAddress }) }}
              className="px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 text-sm hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="flex items-center gap-1 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors disabled:opacity-60"
            >
              {generating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              {generating ? 'Generating…' : 'Generate RFI'}
            </button>
          </div>
        </div>
      )}

      {/* RFI List */}
      {loading && rfis.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">Loading RFIs…</div>
      ) : rfis.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          No RFIs for this project yet.
          <br />
          <span className="text-gray-600">Use "Generate New RFI" to create one.</span>
        </div>
      ) : (
        <div className="space-y-3">
          {rfis.map(rfi => (
            <div
              key={rfi.id}
              className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden"
            >
              {/* Card Header */}
              <div
                className="flex items-start gap-3 p-4 cursor-pointer hover:bg-gray-750 transition-colors"
                onClick={() => setExpandedId(expandedId === rfi.id ? null : rfi.id)}
              >
                <div className="mt-0.5">{statusIcon(rfi.status)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    {statusBadge(rfi.status)}
                    <span className="text-xs text-gray-500 font-mono">{rfi.id}</span>
                  </div>
                  <p className="text-sm text-white font-medium leading-snug">
                    {rfi.conflict_description.slice(0, 120)}
                    {rfi.conflict_description.length > 120 ? '…' : ''}
                  </p>
                  <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-gray-500">
                    <span><span className="text-gray-400">NEC:</span> {rfi.nec_reference}</span>
                    {rfi.sent_at && (
                      <span><span className="text-gray-400">Sent:</span> {new Date(rfi.sent_at).toLocaleDateString()}</span>
                    )}
                    {rfi.response_deadline && !rfi.responded_at && (
                      <span className={new Date(rfi.response_deadline) < new Date() ? 'text-red-400' : 'text-amber-400'}>
                        <Clock className="w-3 h-3 inline mr-0.5" />
                        Deadline: {new Date(rfi.response_deadline).toLocaleDateString()}
                      </span>
                    )}
                    {rfi.responded_at && (
                      <span className="text-green-400">
                        <CheckCircle className="w-3 h-3 inline mr-0.5" />
                        Responded: {new Date(rfi.responded_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Expanded Detail */}
              {expandedId === rfi.id && (
                <div className="border-t border-gray-700 px-4 pb-4 space-y-3">
                  {/* Email Body */}
                  <div>
                    <p className="text-xs text-gray-500 font-semibold mt-3 mb-1 uppercase tracking-wide">Email Body</p>
                    <pre className="text-xs text-gray-300 bg-gray-900 rounded-lg p-3 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto">
                      {rfi.email_body}
                    </pre>
                  </div>

                  {/* Response */}
                  {rfi.response_text && (
                    <div>
                      <p className="text-xs text-gray-500 font-semibold mb-1 uppercase tracking-wide">Response</p>
                      <p className="text-sm text-green-300 bg-green-900/20 border border-green-800 rounded-lg p-3">
                        {rfi.response_text}
                      </p>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {/* Send */}
                    {(rfi.status === 'draft' || rfi.status === 'sent') && (
                      <button
                        onClick={() => handleSend(rfi)}
                        disabled={sendingId === rfi.id}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-xs font-medium transition-colors disabled:opacity-60"
                      >
                        {sendingId === rfi.id
                          ? <RefreshCw className="w-3 h-3 animate-spin" />
                          : <Send className="w-3 h-3" />}
                        {rfi.status === 'draft' ? 'Send RFI' : 'Resend'}
                      </button>
                    )}

                    {/* Follow Up */}
                    {(rfi.status === 'overdue') && (
                      <button
                        onClick={() => handleFollowUp(rfi)}
                        disabled={sendingId === rfi.id}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-white text-xs font-medium transition-colors disabled:opacity-60"
                      >
                        {sendingId === rfi.id
                          ? <RefreshCw className="w-3 h-3 animate-spin" />
                          : <AlertTriangle className="w-3 h-3" />}
                        Send Follow-Up
                      </button>
                    )}

                    {/* Record Response */}
                    {rfi.status !== 'responded' && rfi.status !== 'draft' && (
                      <button
                        onClick={() => setResponseModal({ rfiId: rfi.id, text: '' })}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-800 hover:bg-green-700 text-white text-xs font-medium transition-colors"
                      >
                        <MessageSquare className="w-3 h-3" />
                        Record Response
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Response Modal */}
      {responseModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-600 rounded-xl w-full max-w-md space-y-4 p-6">
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-green-400" />
              Record RFI Response
            </h3>
            <textarea
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-green-500 resize-none"
              rows={5}
              value={responseModal.text}
              onChange={e => setResponseModal(r => r ? { ...r, text: e.target.value } : null)}
              placeholder="Paste or type the GC / inspector's response here…"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setResponseModal(null)}
                className="px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 text-sm hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveResponse}
                disabled={!responseModal.text.trim()}
                className="flex items-center gap-1 px-4 py-1.5 rounded-lg bg-green-700 hover:bg-green-600 text-white text-sm font-medium transition-colors disabled:opacity-60"
              >
                <CheckCircle className="w-4 h-4" />
                Save Response
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default GuardianRFIPanel
