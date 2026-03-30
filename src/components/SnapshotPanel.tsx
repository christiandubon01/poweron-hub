// @ts-nocheck
/**
 * SnapshotPanel.tsx — PowerOn Hub V2 Snapshot History Panel
 *
 * Rolling Supabase-backed snapshot browser with preview-before-restore.
 *
 * Rules (per spec):
 * - Preview shows data in modal — does NOT apply anything
 * - Restore button disabled until Preview is clicked for that row
 * - Restore requires explicit confirmation modal
 * - Pre-restore backup auto-created BEFORE executing any restore
 * - No auto-overwrite, no auto-deploy
 */

import { useState, useEffect, useCallback } from 'react'
import { Pin, PinOff, Eye, RotateCcw, Trash2, Plus, X, Clock, CheckCircle } from 'lucide-react'
import {
  listSnapshots,
  getSnapshot,
  createSnapshot,
  deleteSnapshot,
  pinSnapshot,
  shortTimestamp,
  type Snapshot,
} from '@/services/snapshotService'
import { getBackupData, saveBackupData } from '@/services/backupDataService'

// ── Types ────────────────────────────────────────────────────────────────────

type SnapshotSummary = Omit<Snapshot, 'snapshot_data'>

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  } catch {
    return iso
  }
}

// ── Sub-components ───────────────────────────────────────────────────────────

interface PreviewModalProps {
  snapshot: Snapshot
  onClose: () => void
  onConfirmRestore: () => void
}

function PreviewModal({ snapshot, onClose, onConfirmRestore }: PreviewModalProps) {
  const [showConfirm, setShowConfirm] = useState(false)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div
        className="w-full max-w-2xl rounded-xl border border-gray-700 flex flex-col"
        style={{ backgroundColor: 'var(--bg-card, #1f2937)', maxHeight: '85vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div>
            <h3 className="text-base font-bold text-gray-100">Snapshot Preview</h3>
            <p className="text-xs text-gray-400 mt-0.5">{snapshot.label}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Data preview */}
        <div className="flex-1 overflow-auto p-4">
          <pre className="text-xs text-gray-300 bg-gray-900 rounded-lg p-4 overflow-auto whitespace-pre-wrap break-all leading-relaxed">
            {JSON.stringify(snapshot.snapshot_data, null, 2)}
          </pre>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-gray-700 gap-3">
          <div className="text-xs text-gray-500">
            Saved {formatDate(snapshot.created_at)}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-700 transition-colors"
            >
              Close
            </button>
            {!showConfirm ? (
              <button
                onClick={() => setShowConfirm(true)}
                className="px-4 py-2 text-sm rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-medium transition-colors flex items-center gap-2"
              >
                <RotateCcw size={14} />
                Restore
              </button>
            ) : (
              <div className="flex items-center gap-2 bg-red-900/40 border border-red-700 rounded-lg px-3 py-1">
                <span className="text-xs text-red-300">Overwrite current state?</span>
                <button
                  onClick={() => {
                    setShowConfirm(false)
                    onClose()
                  }}
                  className="px-2 py-1 text-xs rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={onConfirmRestore}
                  className="px-2 py-1 text-xs rounded bg-red-600 hover:bg-red-500 text-white font-medium transition-colors"
                >
                  Confirm restore
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

interface RestoreConfirmModalProps {
  snapshot: SnapshotSummary
  onCancel: () => void
  onConfirm: () => void
}

function RestoreConfirmModal({ snapshot, onCancel, onConfirm }: RestoreConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div
        className="w-full max-w-md rounded-xl border border-orange-700 p-6"
        style={{ backgroundColor: 'var(--bg-card, #1f2937)' }}
      >
        <h3 className="text-base font-bold text-gray-100 mb-2">Restore Snapshot?</h3>
        <p className="text-sm text-gray-300 mb-1">
          Restore to <span className="font-semibold text-orange-300">"{snapshot.label}"</span>?
        </p>
        <p className="text-sm text-red-400 mb-6">
          This will overwrite your current state. This cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-medium transition-colors flex items-center gap-2"
          >
            <RotateCcw size={14} />
            Confirm restore
          </button>
        </div>
      </div>
    </div>
  )
}

interface ManualSnapshotFormProps {
  onSaved: () => void
  onCancel: () => void
}

function ManualSnapshotForm({ onSaved, onCancel }: ManualSnapshotFormProps) {
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!label.trim()) {
      setError('Label is required')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const currentData = getBackupData() || {}
      const result = await createSnapshot(
        label.trim(),
        currentData as Record<string, unknown>,
        description.trim() || undefined
      )

      if (!result) {
        setError('Failed to save snapshot — check connection')
        return
      }

      onSaved()
    } catch (err) {
      setError('Unexpected error saving snapshot')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border border-gray-700 rounded-lg p-4 bg-gray-900/50 space-y-3">
      <h4 className="text-sm font-semibold text-gray-300">Create Manual Snapshot</h4>
      <div>
        <label className="block text-xs text-gray-500 mb-1">
          Label <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="e.g. Before rate update"
          maxLength={200}
          className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
        />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Description (optional)</label>
        <input
          type="text"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="What changed?"
          maxLength={500}
          className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
        />
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-600 text-gray-400 hover:bg-gray-700 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium transition-colors flex items-center gap-2"
        >
          {saving ? (
            <>
              <span className="animate-spin inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full" />
              Saving…
            </>
          ) : (
            <>
              <CheckCircle size={14} />
              Save Snapshot
            </>
          )}
        </button>
      </div>
    </div>
  )
}

// ── Main Panel ───────────────────────────────────────────────────────────────

export default function SnapshotPanel() {
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // UI state
  const [showManualForm, setShowManualForm] = useState(false)
  const [previewSnapshot, setPreviewSnapshot] = useState<Snapshot | null>(null)
  const [confirmRestore, setConfirmRestore] = useState<SnapshotSummary | null>(null)
  // Track which rows have been previewed (enables Restore button)
  const [previewedIds, setPreviewedIds] = useState<Set<string>>(new Set())
  const [restoring, setRestoring] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadSnapshots = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listSnapshots()
      setSnapshots(data)
    } catch {
      setError('Failed to load snapshots')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSnapshots()
  }, [loadSnapshots])

  // ── Toast ────────────────────────────────────────────────────────────────

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  // ── Preview ──────────────────────────────────────────────────────────────

  async function handlePreview(id: string) {
    const snap = await getSnapshot(id)
    if (!snap) {
      showToast('Could not load snapshot data')
      return
    }
    // Mark as previewed — this enables the Restore button for this row
    setPreviewedIds(prev => new Set([...prev, id]))
    setPreviewSnapshot(snap)
  }

  // ── Restore ──────────────────────────────────────────────────────────────

  function handleRestoreClick(snap: SnapshotSummary) {
    setConfirmRestore(snap)
  }

  async function handleConfirmRestore() {
    if (!confirmRestore) return
    const snapId = confirmRestore.id
    const snapLabel = confirmRestore.label

    setConfirmRestore(null)
    setRestoring(snapId)

    try {
      // Step 1: Auto-save a pre-restore backup BEFORE overwriting anything
      const currentData = getBackupData() || {}
      await createSnapshot(
        `Pre-restore backup — ${shortTimestamp()}`,
        currentData as Record<string, unknown>,
        `Auto-saved before restoring: ${snapLabel}`
      )

      // Step 2: Load the full snapshot data
      const snap = await getSnapshot(snapId)
      if (!snap) {
        showToast('Failed to load snapshot for restore')
        return
      }

      // Step 3: Apply snapshot data to app state (save to localStorage via backupDataService)
      saveBackupData(snap.snapshot_data as any)

      // Step 4: Refresh snapshot list (pre-restore backup should now appear)
      await loadSnapshots()

      // Step 5: Notify app to refresh relevant panels
      // Dispatch a storage event so panels that listen for changes can react
      window.dispatchEvent(new CustomEvent('poweron:state-restored', {
        detail: { snapshotId: snapId, label: snapLabel },
      }))

      showToast(`Restored: ${snapLabel}`)
    } catch (err) {
      console.error('[SnapshotPanel] Restore error:', err)
      showToast('Restore failed — check console')
    } finally {
      setRestoring(null)
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────

  async function handleDelete(id: string) {
    setDeleting(id)
    try {
      const ok = await deleteSnapshot(id)
      if (ok) {
        setSnapshots(prev => prev.filter(s => s.id !== id))
        setPreviewedIds(prev => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        showToast('Snapshot deleted')
      } else {
        showToast('Delete failed')
      }
    } finally {
      setDeleting(null)
    }
  }

  // ── Pin ───────────────────────────────────────────────────────────────────

  async function handlePin(id: string, currentPinned: boolean) {
    const ok = await pinSnapshot(id, !currentPinned)
    if (ok) {
      await loadSnapshots()
      showToast(!currentPinned ? 'Snapshot pinned' : 'Snapshot unpinned')
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 px-4 py-2 rounded-lg bg-gray-800 border border-gray-600 text-sm text-gray-100 shadow-xl animate-fade-in">
          {toast}
        </div>
      )}

      {/* Modals */}
      {previewSnapshot && (
        <PreviewModal
          snapshot={previewSnapshot}
          onClose={() => setPreviewSnapshot(null)}
          onConfirmRestore={() => {
            const snap = confirmRestore ?? snapshots.find(s => s.id === previewSnapshot.id)
            setPreviewSnapshot(null)
            if (snap) setConfirmRestore(snap)
          }}
        />
      )}
      {confirmRestore && !previewSnapshot && (
        <RestoreConfirmModal
          snapshot={confirmRestore}
          onCancel={() => setConfirmRestore(null)}
          onConfirm={handleConfirmRestore}
        />
      )}

      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-gray-100 flex items-center gap-2">
            <Clock size={16} className="text-blue-400" />
            Snapshot History
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Rolling point-in-time saves — preview before you restore
          </p>
        </div>
        <button
          onClick={() => setShowManualForm(v => !v)}
          className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors flex items-center gap-2"
        >
          <Plus size={14} />
          Create manual snapshot
        </button>
      </div>

      {/* Manual snapshot form */}
      {showManualForm && (
        <ManualSnapshotForm
          onSaved={() => {
            setShowManualForm(false)
            loadSnapshots()
            showToast('Snapshot saved')
          }}
          onCancel={() => setShowManualForm(false)}
        />
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-8 text-gray-500 text-sm">
          <span className="animate-spin inline-block w-4 h-4 border-2 border-gray-600 border-t-gray-400 rounded-full mr-2" />
          Loading snapshots…
        </div>
      ) : error ? (
        <div className="py-4 text-center text-sm text-red-400">{error}</div>
      ) : snapshots.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-500">
          <Clock size={24} className="mx-auto mb-2 opacity-40" />
          No snapshots yet — auto-snapshots are created when you save estimates, projects, or payments.
        </div>
      ) : (
        <div className="space-y-2">
          {snapshots.map(snap => {
            const isPreviewed = previewedIds.has(snap.id)
            const isRestoring = restoring === snap.id
            const isDeleting = deleting === snap.id

            return (
              <div
                key={snap.id}
                className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                  snap.is_pinned
                    ? 'border-yellow-700/60 bg-yellow-900/10'
                    : 'border-gray-700 bg-gray-800/40 hover:bg-gray-800/70'
                }`}
              >
                {/* Pin icon */}
                <button
                  onClick={() => handlePin(snap.id, snap.is_pinned)}
                  className={`mt-0.5 p-1 rounded hover:bg-gray-700 transition-colors flex-shrink-0 ${
                    snap.is_pinned ? 'text-yellow-400' : 'text-gray-600 hover:text-gray-400'
                  }`}
                  title={snap.is_pinned ? 'Unpin' : 'Pin to top'}
                >
                  {snap.is_pinned ? <Pin size={13} /> : <PinOff size={13} />}
                </button>

                {/* Snapshot info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2">
                    <span className="text-sm font-medium text-gray-200 truncate">{snap.label}</span>
                    {snap.is_pinned && (
                      <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded bg-yellow-900/40 text-yellow-400 border border-yellow-700/40">
                        pinned
                      </span>
                    )}
                  </div>
                  {snap.description && (
                    <p className="text-xs text-gray-500 mt-0.5 truncate">{snap.description}</p>
                  )}
                  <p className="text-xs text-gray-600 mt-0.5">{formatDate(snap.created_at)}</p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {/* Preview */}
                  <button
                    onClick={() => handlePreview(snap.id)}
                    className="px-2.5 py-1 text-xs rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-700 hover:text-gray-100 transition-colors flex items-center gap-1.5"
                    title="Preview snapshot data"
                  >
                    <Eye size={12} />
                    Preview
                  </button>

                  {/* Restore — disabled until previewed */}
                  <button
                    onClick={() => handleRestoreClick(snap)}
                    disabled={!isPreviewed || isRestoring}
                    className={`px-2.5 py-1 text-xs rounded-lg transition-colors flex items-center gap-1.5 ${
                      isPreviewed && !isRestoring
                        ? 'border border-orange-700 text-orange-300 hover:bg-orange-900/30'
                        : 'border border-gray-700 text-gray-600 cursor-not-allowed opacity-50'
                    }`}
                    title={isPreviewed ? 'Restore to this snapshot' : 'Preview first to enable restore'}
                  >
                    {isRestoring ? (
                      <span className="animate-spin inline-block w-3 h-3 border-2 border-orange-400/30 border-t-orange-400 rounded-full" />
                    ) : (
                      <RotateCcw size={12} />
                    )}
                    Restore
                  </button>

                  {/* Delete */}
                  <button
                    onClick={() => handleDelete(snap.id)}
                    disabled={isDeleting}
                    className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-900/20 transition-colors disabled:opacity-40"
                    title="Delete snapshot"
                  >
                    {isDeleting ? (
                      <span className="animate-spin inline-block w-3 h-3 border-2 border-red-400/30 border-t-red-400 rounded-full" />
                    ) : (
                      <Trash2 size={13} />
                    )}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Refresh */}
      {!loading && snapshots.length > 0 && (
        <div className="pt-1 flex justify-end">
          <button
            onClick={loadSnapshots}
            className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
          >
            Refresh list
          </button>
        </div>
      )}
    </div>
  )
}
