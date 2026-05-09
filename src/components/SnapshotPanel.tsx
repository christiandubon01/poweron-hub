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
import { getBackupData, saveBackupDataAndSync, forceSyncToCloud } from '@/services/backupDataService'

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

function asRecord(value: any): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function itemCount(data: any, key: string): number {
  const value = asRecord(data)[key]
  return Array.isArray(value) ? value.length : 0
}

function hasObjectData(data: any, key: string): boolean {
  const value = asRecord(data)[key]
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 KB'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function snapshotDataSize(data: any): string {
  try {
    return formatBytes(new Blob([JSON.stringify(data ?? {})]).size)
  } catch {
    return 'Unavailable'
  }
}

function companyName(data: any): string {
  return asRecord(asRecord(data).settings).company || 'Not set'
}

function calendarStatus(data: any): string {
  return asRecord(asRecord(data).settings).gcalUrl ? 'Present' : 'Not set'
}

function areaStatus(data: any, key: string, kind: 'array' | 'object'): string {
  if (kind === 'array') {
    const count = itemCount(data, key)
    return count > 0 ? `${count} item${count === 1 ? '' : 's'}` : 'No data'
  }
  return hasObjectData(data, key) ? 'Saved' : 'No data'
}

function labelFromKey(key: string): string {
  return key
    .replace(/^_/, '')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^\w/, c => c.toUpperCase())
}

function getIncludedAreas(data: any) {
  const known = [
    { key: 'settings', label: 'Settings', kind: 'object' },
    { key: 'projects', label: 'Projects', kind: 'array' },
    { key: 'serviceLogs', label: 'Service Logs', kind: 'array' },
    { key: 'logs', label: 'Field Logs', kind: 'array' },
    { key: 'imports', label: 'Imports', kind: 'array' },
    { key: 'customers', label: 'Customers', kind: 'array' },
    { key: 'employees', label: 'Employees', kind: 'array' },
    { key: 'templates', label: 'Templates', kind: 'array' },
    { key: 'priceBook', label: 'Price Book', kind: 'array' },
  ]

  const knownKeys = new Set(known.map(area => area.key))
  const extra = Object.entries(asRecord(data))
    .filter(([key, value]) => !knownKeys.has(key) && !key.startsWith('_') && value && typeof value === 'object')
    .filter(([, value]) => Array.isArray(value) ? value.length > 0 : Object.keys(value as any).length > 0)
    .map(([key, value]) => ({
      key,
      label: labelFromKey(key),
      kind: Array.isArray(value) ? 'array' : 'object',
    }))

  return [...known, ...extra]
}

interface PreviewModalProps {
  snapshot: Snapshot
  onClose: () => void
  onConfirmRestore: () => void
}

function PreviewModal({ snapshot, onClose, onConfirmRestore }: PreviewModalProps) {
  const [showConfirm, setShowConfirm] = useState(false)
  const snapshotData = snapshot.snapshot_data || {}
  const currentData = getBackupData() || {}
  const summaryCards = [
    { label: 'Projects', value: itemCount(snapshotData, 'projects') },
    { label: 'Service Logs', value: itemCount(snapshotData, 'serviceLogs') },
    { label: 'Field Logs', value: itemCount(snapshotData, 'logs') },
    { label: 'Data Size', value: snapshotDataSize(snapshotData) },
  ]
  const changes = [
    { label: 'Projects', current: itemCount(currentData, 'projects'), restore: itemCount(snapshotData, 'projects') },
    { label: 'Service Logs', current: itemCount(currentData, 'serviceLogs'), restore: itemCount(snapshotData, 'serviceLogs') },
    { label: 'Field Logs', current: itemCount(currentData, 'logs'), restore: itemCount(snapshotData, 'logs') },
    { label: 'Company Name', current: companyName(currentData), restore: companyName(snapshotData) },
    { label: 'Google Calendar URL', current: calendarStatus(currentData), restore: calendarStatus(snapshotData) },
  ]
  const includedAreas = getIncludedAreas(snapshotData)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div
        className="w-full max-w-4xl rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-slate-950 via-blue-950/30 to-slate-950 shadow-2xl shadow-blue-950/40 flex flex-col"
        style={{ maxHeight: '88vh' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-5 border-b border-cyan-400/15">
          <div>
            <p className="text-xs uppercase tracking-wider text-cyan-200/70 font-bold">Restore Point Preview</p>
            <h3 className="text-lg font-bold text-gray-100 mt-1">{snapshot.label || 'Untitled restore point'}</h3>
            <p className="text-xs text-gray-400 mt-1">
              Created {formatDate(snapshot.created_at)} - Snapshot of saved app state
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-cyan-400/10 text-gray-400 hover:text-gray-200 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {summaryCards.map(card => (
              <div key={card.label} className="rounded-xl border border-cyan-400/15 bg-slate-950/65 p-3 shadow-inner shadow-blue-950/20">
                <p className="text-[10px] uppercase tracking-wider text-cyan-200/60 font-bold">{card.label}</p>
                <p className="text-lg font-bold text-gray-100 mt-1">{card.value}</p>
              </div>
            ))}
          </div>

          <section className="rounded-xl border border-cyan-400/15 bg-slate-950/55 overflow-hidden">
            <div className="px-4 py-3 border-b border-cyan-400/10">
              <h4 className="text-sm font-bold text-gray-100">What will change</h4>
              <p className="text-xs text-gray-500 mt-0.5">Current app data compared with this restore point.</p>
            </div>
            <div className="divide-y divide-cyan-400/10">
              {changes.map(change => {
                const unchanged = change.current === change.restore
                return (
                  <div key={change.label} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-2 px-4 py-3 text-sm">
                    <div className="font-semibold text-gray-200">{change.label}</div>
                    <div>
                      <span className="block text-[10px] uppercase tracking-wider text-gray-500 font-bold">Current</span>
                      <span className="text-gray-300">{String(change.current)}</span>
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase tracking-wider text-cyan-200/60 font-bold">Restore Point</span>
                      <span className="text-gray-100">{String(change.restore)}</span>
                    </div>
                    <div className="md:text-right">
                      <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${
                        unchanged
                          ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
                          : 'border-amber-400/25 bg-amber-400/10 text-amber-200'
                      }`}>
                        {unchanged ? 'Unchanged' : 'Will change'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="rounded-xl border border-cyan-400/15 bg-slate-950/55 p-4">
            <h4 className="text-sm font-bold text-gray-100">Areas included in this restore point</h4>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {includedAreas.map(area => (
                <div key={area.key} className="flex items-center justify-between gap-3 rounded-lg border border-cyan-400/10 bg-slate-900/50 px-3 py-2">
                  <span className="text-sm text-gray-200 truncate">{area.label}</span>
                  <span className="text-[11px] rounded-full border border-cyan-400/15 bg-cyan-400/10 px-2 py-0.5 text-cyan-100 whitespace-nowrap">
                    {areaStatus(snapshotData, area.key, area.kind)}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <details className="rounded-xl border border-gray-700/70 bg-slate-950/70">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-gray-300 hover:text-gray-100">
              Technical Details / Raw Data
            </summary>
            <div className="border-t border-gray-800 p-4">
              <pre className="max-h-72 overflow-auto rounded-lg bg-gray-950/90 p-4 text-xs leading-relaxed text-gray-300 whitespace-pre-wrap break-all">
                {JSON.stringify(snapshot.snapshot_data, null, 2)}
              </pre>
            </div>
          </details>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-cyan-400/15 gap-3">
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
  onSaved: () => void | Promise<void>
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

      await onSaved()
    } catch (err) {
      setError('Unexpected error saving snapshot')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border border-cyan-400/15 rounded-xl p-4 bg-slate-950/60 space-y-3 shadow-inner shadow-blue-950/20">
      <h4 className="text-sm font-semibold text-gray-100">Create Manual Snapshot</h4>
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
          className="w-full px-3 py-2 text-sm bg-slate-950/80 border border-cyan-400/15 rounded-lg text-gray-100 placeholder-gray-600 focus:outline-none focus:border-cyan-400/50"
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
          className="w-full px-3 py-2 text-sm bg-slate-950/80 border border-cyan-400/15 rounded-lg text-gray-100 placeholder-gray-600 focus:outline-none focus:border-cyan-400/50"
        />
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-700 text-gray-400 hover:bg-gray-800 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1.5 text-sm rounded-lg border border-cyan-400/30 bg-cyan-500/15 hover:bg-cyan-500/25 disabled:opacity-50 text-cyan-100 font-semibold transition-colors flex items-center gap-2"
        >
          {saving ? (
            <>
              <span className="animate-spin inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full" />
              Saving…
            </>
          ) : (
            <>
              <CheckCircle size={14} />
              Save Restore Point
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

  useEffect(() => {
    const handleRefresh = () => {
      loadSnapshots()
    }

    window.addEventListener('poweron:snapshots-refresh', handleRefresh)

    return () => {
      window.removeEventListener('poweron:snapshots-refresh', handleRefresh)
    }
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

      // Step 3: Apply snapshot data to app state and wait for cloud write
      await saveBackupDataAndSync(snap.snapshot_data as any, 'snapshotRestore')

      // Step 3B: Force a final Supabase sync before reload so hydration pulls restored data
      const syncResult = await forceSyncToCloud()
      if (!syncResult.success) {
        showToast(`Restore saved locally, but cloud sync failed: ${syncResult.error || 'Unknown error'}`)
        return
      }

      // Step 4: Refresh snapshot list
      await loadSnapshots()

      // Step 5: Notify app that live state was restored
      window.dispatchEvent(new CustomEvent('poweron:state-restored', {
        detail: { snapshotId: snapId, label: snapLabel },
      }))

      showToast(`Restored: ${snapLabel}. Reloading workspace...`)

      // Restore replaces the live app state. A full reload prevents stale KPI,
      // project, and dashboard state from staying mounted after restore.
      setTimeout(() => {
        window.location.reload()
      }, 1500)
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
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-gray-100 flex items-center gap-2">
            <Clock size={16} className="text-cyan-300" />
            Restore Points
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Rolling point-in-time saves — preview before you restore
          </p>
        </div>
        <button
          onClick={() => setShowManualForm(v => !v)}
          className="px-3 py-1.5 text-sm rounded-lg border border-cyan-400/30 bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-100 font-semibold transition-colors flex items-center gap-2 shadow-sm shadow-blue-950/30"
        >
          <Plus size={14} />
          Create Restore Point
        </button>
      </div>

      {/* Manual snapshot form */}
      {showManualForm && (
        <ManualSnapshotForm
          onSaved={async () => {
            setShowManualForm(false)
            await loadSnapshots()
            window.dispatchEvent(new CustomEvent('poweron:snapshots-refresh'))
            setTimeout(() => {
              loadSnapshots()
            }, 500)
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
        <div className="overflow-hidden rounded-xl border border-cyan-400/10 bg-slate-950/50">
          {snapshots.map(snap => {
            const isPreviewed = previewedIds.has(snap.id)
            const isRestoring = restoring === snap.id
            const isDeleting = deleting === snap.id

            return (
              <div
                key={snap.id}
                className={`flex items-start gap-3 p-3 border-b last:border-b-0 transition-colors ${
                  snap.is_pinned
                    ? 'border-yellow-500/20 bg-yellow-500/10'
                    : 'border-cyan-400/10 bg-slate-950/20 hover:bg-slate-900/70'
                }`}
              >
                {/* Pin icon */}
                <button
                  onClick={() => handlePin(snap.id, snap.is_pinned)}
                  className={`mt-0.5 p-1 rounded-lg transition-colors flex-shrink-0 ${
                    snap.is_pinned ? 'text-yellow-300 bg-yellow-400/10' : 'text-gray-600 hover:text-cyan-300 hover:bg-cyan-400/10'
                  }`}
                  title={snap.is_pinned ? 'Unpin' : 'Pin to top'}
                >
                  {snap.is_pinned ? <Pin size={13} /> : <PinOff size={13} />}
                </button>

                {/* Snapshot info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2">
                    <span className="text-sm font-semibold text-gray-100 truncate">{snap.label}</span>
                    {snap.is_pinned && (
                      <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded-full bg-yellow-400/10 text-yellow-300 border border-yellow-400/25">
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
                    className="px-2.5 py-1 text-xs rounded-lg border border-cyan-400/20 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/15 transition-colors flex items-center gap-1.5"
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
                        ? 'border border-amber-400/25 bg-amber-400/10 text-amber-200 hover:bg-amber-400/15'
                        : 'border border-gray-700/70 bg-gray-900/30 text-gray-600 cursor-not-allowed opacity-50'
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
                    className="p-1.5 rounded-lg text-gray-600 hover:text-red-300 hover:bg-red-500/10 transition-colors disabled:opacity-40"
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
            className="text-xs font-medium text-cyan-300/70 hover:text-cyan-200 transition-colors"
          >
            Refresh list
          </button>
        </div>
      )}
    </div>
  )
}
