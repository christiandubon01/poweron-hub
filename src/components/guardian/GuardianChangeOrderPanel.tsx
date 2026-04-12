// @ts-nocheck
/**
 * GuardianChangeOrderPanel.tsx
 *
 * Displays all change orders per project.
 * Enforces the HARD RULE: no scope change proceeds without a signed, approved CO.
 *
 * Features:
 *  - Change order list with status badges
 *  - Original scope vs change comparison
 *  - Cost + timeline impact
 *  - Approve button (requires Christian's confirmation)
 *  - Reject button with reason
 *  - Electronic signature field (type name + date)
 *  - Warning banner when work is proceeding without an approved CO
 *  - Scope change detection input for field logs / voice entries
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  FileText,
  Plus,
  RefreshCw,
  PenLine,
  DollarSign,
  Calendar,
  User,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  generateChangeOrder,
  approveChangeOrder,
  rejectChangeOrder,
  recordSignature,
  detectScopeChange,
  getPendingChangeOrders,
  type GuardianChangeOrder,
  type ChangeOrderStatus,
  type ChangeOrderInputData,
} from '@/services/guardian/GuardianChangeOrderGenerator'

// ── Props ─────────────────────────────────────────────────────────────────────

interface GuardianChangeOrderPanelProps {
  projectId: string
  ownerName?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusBadge(status: ChangeOrderStatus) {
  const map: Record<ChangeOrderStatus, { label: string; classes: string }> = {
    pending_approval: { label: 'Pending Approval', classes: 'bg-amber-700 text-amber-100' },
    approved: { label: 'Approved', classes: 'bg-green-700 text-green-100' },
    rejected: { label: 'Rejected', classes: 'bg-red-700 text-red-100' },
  }
  const { label, classes } = map[status] ?? { label: status, classes: 'bg-gray-600 text-gray-200' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${classes}`}>
      {label}
    </span>
  )
}

function fmtMoney(n: number): string {
  const abs = Math.abs(n)
  const prefix = n < 0 ? '-' : n > 0 ? '+' : ''
  return `${prefix}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ── Empty form state ──────────────────────────────────────────────────────────

interface NewCOFormState {
  originalScope: string
  changeDescription: string
  reason: string
  costImpact: string
  timelineImpactDays: string
  requestedBy: string
}

const EMPTY_CO_FORM: NewCOFormState = {
  originalScope: '',
  changeDescription: '',
  reason: '',
  costImpact: '0',
  timelineImpactDays: '0',
  requestedBy: '',
}

// ── Component ─────────────────────────────────────────────────────────────────

const GuardianChangeOrderPanel: React.FC<GuardianChangeOrderPanelProps> = ({
  projectId,
  ownerName = 'Christian Dubon',
}) => {
  const [changeOrders, setChangeOrders] = useState<GuardianChangeOrder[]>([])
  const [loading, setLoading] = useState(false)
  const [showNewForm, setShowNewForm] = useState(false)
  const [form, setForm] = useState<NewCOFormState>({ ...EMPTY_CO_FORM })
  const [generating, setGenerating] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Approve/reject confirmation
  const [confirmApprove, setConfirmApprove] = useState<string | null>(null)
  const [rejectModal, setRejectModal] = useState<{ coId: string; reason: string } | null>(null)

  // Signature modal
  const [sigModal, setSigModal] = useState<{ coId: string; name: string; date: string } | null>(null)

  // Scope-change detection playground
  const [detectInput, setDetectInput] = useState('')
  const [detectResult, setDetectResult] = useState<ReturnType<typeof detectScopeChange> | null>(null)

  // ── Load Change Orders ─────────────────────────────────────────────────────

  const loadCOs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: dbErr } = await (supabase.from('guardian_change_orders') as any)
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
      if (dbErr) throw dbErr
      setChangeOrders((data ?? []) as GuardianChangeOrder[])
    } catch (err) {
      setError('Could not load change orders. Supabase may be unavailable.')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    loadCOs()
  }, [loadCOs])

  // ── Generate CO ────────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    const cost = parseFloat(form.costImpact) || 0
    const days = parseInt(form.timelineImpactDays) || 0
    if (!form.originalScope || !form.changeDescription || !form.requestedBy) {
      setError('Please fill in all required fields.')
      return
    }
    setGenerating(true)
    setError(null)
    try {
      const data: ChangeOrderInputData = {
        originalScope: form.originalScope,
        changeDescription: form.changeDescription,
        reason: form.reason,
        costImpact: cost,
        timelineImpactDays: days,
        requestedBy: form.requestedBy,
        autoDetected: false,
      }
      const co = await generateChangeOrder(projectId, data)
      setChangeOrders(prev => [co, ...prev])
      setShowNewForm(false)
      setForm({ ...EMPTY_CO_FORM })
      setExpandedId(co.id)
    } catch (err) {
      setError('Failed to generate change order. Please try again.')
    } finally {
      setGenerating(false)
    }
  }

  // ── Approve ────────────────────────────────────────────────────────────────

  const handleApprove = async (coId: string) => {
    setError(null)
    try {
      await approveChangeOrder(coId, ownerName)
      setChangeOrders(prev =>
        prev.map(co =>
          co.id === coId
            ? { ...co, status: 'approved', approved_by: ownerName, approved_at: new Date().toISOString() }
            : co
        )
      )
      setConfirmApprove(null)
    } catch (err) {
      setError('Failed to approve change order.')
    }
  }

  // ── Reject ─────────────────────────────────────────────────────────────────

  const handleReject = async () => {
    if (!rejectModal) return
    setError(null)
    try {
      await rejectChangeOrder(rejectModal.coId, rejectModal.reason)
      setChangeOrders(prev =>
        prev.map(co =>
          co.id === rejectModal.coId
            ? { ...co, status: 'rejected', rejected_reason: rejectModal.reason }
            : co
        )
      )
      setRejectModal(null)
    } catch (err) {
      setError('Failed to reject change order.')
    }
  }

  // ── Signature ──────────────────────────────────────────────────────────────

  const handleSign = async () => {
    if (!sigModal) return
    setError(null)
    try {
      await recordSignature(sigModal.coId, sigModal.name, sigModal.date)
      setChangeOrders(prev =>
        prev.map(co =>
          co.id === sigModal.coId
            ? { ...co, signer_name: sigModal.name, signed_at: sigModal.date }
            : co
        )
      )
      setSigModal(null)
    } catch (err) {
      setError('Failed to record signature.')
    }
  }

  // ── Scope-Change Detection ─────────────────────────────────────────────────

  const handleDetect = () => {
    if (!detectInput.trim()) return
    const result = detectScopeChange(detectInput)
    setDetectResult(result)
  }

  // ── Derived state ──────────────────────────────────────────────────────────

  const unsignedPending = changeOrders.filter(
    co => co.status === 'pending_approval' && !co.signer_name
  )
  const workWithoutCO = unsignedPending.length > 0

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Warning Banner */}
      {workWithoutCO && (
        <div className="flex items-start gap-3 px-4 py-3 bg-red-900/50 border border-red-600 rounded-xl text-red-200">
          <ShieldAlert className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold">⚠ Scope Change Without Approved Change Order</p>
            <p className="text-xs mt-0.5 text-red-300">
              {unsignedPending.length} change order{unsignedPending.length > 1 ? 's' : ''} pending signature and approval.
              No work on these changes should proceed until signed by customer/GC.
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-amber-400" />
            Change Orders
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {changeOrders.length} total ·{' '}
            <span className="text-amber-400">
              {changeOrders.filter(c => c.status === 'pending_approval').length} pending
            </span>
            {' · '}
            <span className="text-green-400">
              {changeOrders.filter(c => c.status === 'approved').length} approved
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadCOs}
            disabled={loading}
            className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowNewForm(v => !v)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-600 text-white text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Change Order
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

      {/* New CO Form */}
      {showNewForm && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-white">New Change Order</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs text-gray-400 block mb-1">Original Scope *</label>
              <textarea
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 resize-none"
                rows={2}
                value={form.originalScope}
                onChange={e => setForm(f => ({ ...f, originalScope: e.target.value }))}
                placeholder="Describe the original contracted scope…"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-gray-400 block mb-1">Change Description *</label>
              <textarea
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500 resize-none"
                rows={2}
                value={form.changeDescription}
                onChange={e => setForm(f => ({ ...f, changeDescription: e.target.value }))}
                placeholder="What is changing from the original scope…"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-gray-400 block mb-1">Reason for Change</label>
              <input
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-amber-500"
                value={form.reason}
                onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                placeholder="Customer request, field condition, etc."
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Cost Impact ($)</label>
              <input
                type="number"
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-amber-500"
                value={form.costImpact}
                onChange={e => setForm(f => ({ ...f, costImpact: e.target.value }))}
                placeholder="0.00 (positive = increase)"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Timeline Impact (days)</label>
              <input
                type="number"
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-amber-500"
                value={form.timelineImpactDays}
                onChange={e => setForm(f => ({ ...f, timelineImpactDays: e.target.value }))}
                placeholder="0"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Requested By *</label>
              <input
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-amber-500"
                value={form.requestedBy}
                onChange={e => setForm(f => ({ ...f, requestedBy: e.target.value }))}
                placeholder="GC name / owner name"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setShowNewForm(false); setForm({ ...EMPTY_CO_FORM }) }}
              className="px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 text-sm hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="flex items-center gap-1 px-4 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-600 text-white text-sm font-medium transition-colors disabled:opacity-60"
            >
              {generating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              {generating ? 'Generating…' : 'Generate Change Order'}
            </button>
          </div>
        </div>
      )}

      {/* Change Order List */}
      {loading && changeOrders.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">Loading change orders…</div>
      ) : changeOrders.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          No change orders for this project yet.
        </div>
      ) : (
        <div className="space-y-3">
          {changeOrders.map(co => (
            <div
              key={co.id}
              className={`bg-gray-800 border rounded-xl overflow-hidden ${
                co.status === 'pending_approval' && !co.signer_name
                  ? 'border-red-700'
                  : co.status === 'approved'
                  ? 'border-green-800'
                  : co.status === 'rejected'
                  ? 'border-gray-700'
                  : 'border-amber-800'
              }`}
            >
              {/* Card Header */}
              <div
                className="flex items-start gap-3 p-4 cursor-pointer hover:bg-gray-750 transition-colors"
                onClick={() => setExpandedId(expandedId === co.id ? null : co.id)}
              >
                <FileText className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    {statusBadge(co.status)}
                    {co.auto_detected && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-purple-800 text-purple-200">
                        Auto-Detected
                      </span>
                    )}
                    {co.signer_name && (
                      <span className="inline-flex items-center gap-1 text-xs text-green-400">
                        <PenLine className="w-3 h-3" />
                        Signed by {co.signer_name}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-white font-medium leading-snug">
                    {co.change_description.slice(0, 120)}
                    {co.change_description.length > 120 ? '…' : ''}
                  </p>
                  <div className="flex flex-wrap gap-4 mt-1.5 text-xs text-gray-500">
                    <span className={co.cost_impact > 0 ? 'text-red-400' : co.cost_impact < 0 ? 'text-green-400' : 'text-gray-400'}>
                      <DollarSign className="w-3 h-3 inline" />
                      {fmtMoney(co.cost_impact)}
                    </span>
                    <span className="text-gray-400">
                      <Calendar className="w-3 h-3 inline mr-0.5" />
                      {co.timeline_impact_days}d
                    </span>
                    <span className="text-gray-400">
                      <User className="w-3 h-3 inline mr-0.5" />
                      {co.requested_by}
                    </span>
                    <span className="text-gray-500">
                      {new Date(co.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                {expandedId === co.id
                  ? <ChevronUp className="w-4 h-4 text-gray-500 flex-shrink-0" />
                  : <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" />
                }
              </div>

              {/* Expanded */}
              {expandedId === co.id && (
                <div className="border-t border-gray-700 px-4 pb-4 space-y-3">
                  {/* Scope Comparison */}
                  <div className="grid sm:grid-cols-2 gap-3 mt-3">
                    <div>
                      <p className="text-xs text-gray-500 font-semibold mb-1 uppercase tracking-wide">Original Scope</p>
                      <p className="text-sm text-gray-300 bg-gray-900 rounded-lg p-3">{co.original_scope}</p>
                    </div>
                    <div>
                      <p className="text-xs text-amber-400 font-semibold mb-1 uppercase tracking-wide">Change</p>
                      <p className="text-sm text-amber-200 bg-amber-900/20 border border-amber-800 rounded-lg p-3">{co.change_description}</p>
                    </div>
                  </div>

                  {/* Document */}
                  <div>
                    <p className="text-xs text-gray-500 font-semibold mb-1 uppercase tracking-wide">Document</p>
                    <pre className="text-xs text-gray-300 bg-gray-900 rounded-lg p-3 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto">
                      {co.document_body}
                    </pre>
                  </div>

                  {/* Rejection reason */}
                  {co.rejected_reason && (
                    <div className="bg-red-900/20 border border-red-800 rounded-lg p-3">
                      <p className="text-xs text-red-400 font-semibold mb-1">Rejection Reason</p>
                      <p className="text-sm text-red-300">{co.rejected_reason}</p>
                    </div>
                  )}

                  {/* Actions */}
                  {co.status === 'pending_approval' && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {/* Signature */}
                      {!co.signer_name && (
                        <button
                          onClick={() => setSigModal({ coId: co.id, name: '', date: new Date().toISOString().slice(0, 10) })}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-800 hover:bg-blue-700 text-white text-xs font-medium transition-colors"
                        >
                          <PenLine className="w-3 h-3" />
                          Customer / GC Signature
                        </button>
                      )}

                      {/* Approve — requires confirmation */}
                      {confirmApprove === co.id ? (
                        <div className="flex items-center gap-2 bg-green-900/40 border border-green-700 rounded-lg px-3 py-1.5 text-xs text-green-300">
                          <span>Confirm approval as {ownerName}?</span>
                          <button
                            onClick={() => handleApprove(co.id)}
                            className="text-green-200 font-semibold hover:text-white"
                          >
                            Yes, Approve
                          </button>
                          <button
                            onClick={() => setConfirmApprove(null)}
                            className="text-gray-400 hover:text-white"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmApprove(co.id)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-800 hover:bg-green-700 text-white text-xs font-medium transition-colors"
                        >
                          <CheckCircle className="w-3 h-3" />
                          Approve
                        </button>
                      )}

                      {/* Reject */}
                      <button
                        onClick={() => setRejectModal({ coId: co.id, reason: '' })}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-800 hover:bg-red-700 text-white text-xs font-medium transition-colors"
                      >
                        <XCircle className="w-3 h-3" />
                        Reject
                      </button>
                    </div>
                  )}

                  {co.status === 'approved' && (
                    <div className="flex items-center gap-2 text-xs text-green-400">
                      <CheckCircle className="w-4 h-4" />
                      Approved by {co.approved_by} on {co.approved_at ? new Date(co.approved_at).toLocaleDateString() : '—'}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Scope Change Detection Widget */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-purple-400" />
          Scope Change Detector
        </h3>
        <p className="text-xs text-gray-500">
          Paste a field log entry or voice note to scan for verbal scope-change language.
        </p>
        <textarea
          className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500 resize-none"
          rows={3}
          value={detectInput}
          onChange={e => { setDetectInput(e.target.value); setDetectResult(null) }}
          placeholder='"While we are here, can you also add two more outlets in the kitchen..."'
        />
        <div className="flex items-center gap-2">
          <button
            onClick={handleDetect}
            disabled={!detectInput.trim()}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-purple-800 hover:bg-purple-700 text-white text-xs font-medium transition-colors disabled:opacity-60"
          >
            <ShieldAlert className="w-3 h-3" />
            Analyze for Scope Change
          </button>
          {detectResult && (
            <span className={`text-xs font-semibold ${detectResult.detected ? 'text-red-400' : 'text-green-400'}`}>
              {detectResult.detected
                ? `⚠ Scope change detected (${Math.round(detectResult.confidence * 100)}% confidence)`
                : '✓ No scope change signals found'}
            </span>
          )}
        </div>
        {detectResult?.detected && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 space-y-2">
            <p className="text-xs text-red-300 font-semibold">
              GUARDIAN: Verbal scope change detected. No change order exists. Corrective action required.
            </p>
            <p className="text-xs text-gray-400">
              <span className="text-gray-300">Triggers matched:</span> {detectResult.triggers.join(', ')}
            </p>
            <p className="text-xs text-gray-400">
              <span className="text-gray-300">Extracted change:</span> {detectResult.extractedChange}
            </p>
            <button
              onClick={() => {
                setForm(f => ({
                  ...f,
                  changeDescription: detectResult.extractedChange,
                  requestedBy: '',
                }))
                setShowNewForm(true)
                setDetectInput('')
                setDetectResult(null)
              }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-600 text-white text-xs font-medium transition-colors"
            >
              <Plus className="w-3 h-3" />
              Create Change Order from This
            </button>
          </div>
        )}
      </div>

      {/* Reject Modal */}
      {rejectModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-600 rounded-xl w-full max-w-md space-y-4 p-6">
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-400" />
              Reject Change Order
            </h3>
            <textarea
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-500 resize-none"
              rows={3}
              value={rejectModal.reason}
              onChange={e => setRejectModal(r => r ? { ...r, reason: e.target.value } : null)}
              placeholder="Reason for rejection (optional)…"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setRejectModal(null)}
                className="px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 text-sm hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                className="flex items-center gap-1 px-4 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm font-medium transition-colors"
              >
                <XCircle className="w-4 h-4" />
                Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Signature Modal */}
      {sigModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-600 rounded-xl w-full max-w-md space-y-4 p-6">
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <PenLine className="w-4 h-4 text-blue-400" />
              Electronic Signature
            </h3>
            <p className="text-xs text-gray-400">
              By typing your name and date, you acknowledge the scope change described in this change order.
              <span className="text-red-300 font-semibold"> No work shall proceed until this is signed AND approved.</span>
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Full Name (Customer / GC)</label>
                <input
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                  value={sigModal.name}
                  onChange={e => setSigModal(s => s ? { ...s, name: e.target.value } : null)}
                  placeholder="Type full name to sign"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Date</label>
                <input
                  type="date"
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                  value={sigModal.date}
                  onChange={e => setSigModal(s => s ? { ...s, date: e.target.value } : null)}
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setSigModal(null)}
                className="px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 text-sm hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSign}
                disabled={!sigModal.name.trim()}
                className="flex items-center gap-1 px-4 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-sm font-medium transition-colors disabled:opacity-60"
              >
                <PenLine className="w-4 h-4" />
                Sign Change Order
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default GuardianChangeOrderPanel
