// @ts-nocheck
/**
 * ImportBackupButton — Lets users import a v15r PowerOn backup JSON file.
 *
 * Visible on the Dashboard. Opens a file picker, parses the JSON,
 * stores it in localStorage, and triggers a page reload so all panels
 * pick up the backup data immediately.
 */

import { useState, useRef } from 'react'
import { Upload, Check, AlertCircle, Database, Trash2 } from 'lucide-react'
import { clsx } from 'clsx'
import {
  importBackupFromFile,
  hasBackupData,
  getBackupData,
  clearBackupData,
  isSupabaseConfigured,
} from '@/services/backupDataService'

export default function ImportBackupButton() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const hasData = hasBackupData()
  const supabaseOk = isSupabaseConfigured()

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setStatus('loading')
    setMessage('Importing...')

    try {
      const { data, summary } = await importBackupFromFile(file)
      setStatus('success')
      const parts = Object.entries(summary.merged).map(([k, v]) => `${v} ${k}`).join(', ')
      setMessage(
        summary.total > 0
          ? `Merged: ${parts} — existing data preserved`
          : 'Import complete — no new records found (all duplicates)'
      )
      // Reload after a short delay so all panels pick up the new data
      setTimeout(() => window.location.reload(), 1200)
    } catch (err) {
      setStatus('error')
      setMessage(err instanceof Error ? err.message : 'Failed to parse backup file')
    }

    // Reset file input so the same file can be re-selected
    if (fileRef.current) fileRef.current.value = ''
  }

  function handleClear() {
    if (!confirm('Clear all imported data? This cannot be undone.')) return
    clearBackupData()
    window.location.reload()
  }

  // Summary of loaded backup
  const backup = hasData ? getBackupData() : null
  const summary = backup
    ? `${backup.projects?.length ?? 0} projects, ${backup.logs?.length ?? 0} logs loaded`
    : null

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4 space-y-3">
      {/* Connection status */}
      <div className="flex items-center gap-2 text-xs">
        <Database size={14} className={supabaseOk ? 'text-emerald-400' : 'text-yellow-400'} />
        <span className={supabaseOk ? 'text-emerald-400' : 'text-yellow-400'}>
          {supabaseOk ? 'Supabase configured' : 'Supabase not connected — using local backup'}
        </span>
      </div>

      {/* Import button */}
      <div className="flex items-center gap-3">
        <label
          className={clsx(
            'flex items-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-sm cursor-pointer transition-colors',
            status === 'loading'
              ? 'bg-gray-700 text-gray-400 cursor-wait'
              : 'bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30'
          )}
        >
          {status === 'success' ? (
            <Check size={16} />
          ) : status === 'error' ? (
            <AlertCircle size={16} />
          ) : (
            <Upload size={16} />
          )}
          {hasData ? 'Re-import v15r Backup' : 'Import v15r Backup'}
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            onChange={handleFileChange}
            disabled={status === 'loading'}
            className="hidden"
          />
        </label>

        {hasData && (
          <button
            onClick={handleClear}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-sm text-red-400 hover:bg-red-500/10 transition-colors"
            title="Clear imported backup data"
          >
            <Trash2 size={14} />
            Clear
          </button>
        )}
      </div>

      {/* Status message */}
      {message && (
        <p className={clsx(
          'text-xs',
          status === 'success' ? 'text-emerald-400' :
          status === 'error' ? 'text-red-400' :
          'text-gray-400'
        )}>
          {message}
        </p>
      )}

      {/* Loaded data summary */}
      {hasData && summary && !message && (
        <p className="text-xs text-gray-500">{summary}</p>
      )}
    </div>
  )
}
