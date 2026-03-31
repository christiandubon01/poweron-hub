// @ts-nocheck
/**
 * JournalPanel — Scrollable voice journal entries panel.
 *
 * Shows voice notes captured via NEXUS voice commands.
 * Opened via sidebar "Journal" tab or poweron:show-journal event.
 *
 * Context badge colours:
 *   job_site=amber  driving=blue  office=teal  general=gray
 */

import React, { useEffect, useState, useCallback } from 'react'
import { RefreshCw, BookOpen } from 'lucide-react'
import { getRecentJournal, type JournalEntry } from '@/services/voiceJournalService'
import { setVoiceContext, type VoiceContext } from '@/services/voice'

// ── Context helpers ───────────────────────────────────────────────────────────

const CONTEXT_LABELS: Record<string, string> = {
  job_site: 'Job Site',
  driving:  'Driving',
  office:   'Office',
  general:  'General',
}

const CONTEXT_COLORS: Record<string, string> = {
  job_site: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  driving:  'bg-blue-500/20 text-blue-400 border-blue-500/30',
  office:   'bg-teal-500/20 text-teal-400 border-teal-500/30',
  general:  'bg-gray-500/20 text-gray-400 border-gray-500/30',
}

function contextClass(tag: string): string {
  return CONTEXT_COLORS[tag] ?? CONTEXT_COLORS.general
}

// ── Relative time ─────────────────────────────────────────────────────────────

function relativeTime(isoString: string): string {
  const date = new Date(isoString)
  const now = Date.now()
  const diffMs = now - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1)    return 'just now'
  if (diffMins < 60)   return `${diffMins} min ago`
  if (diffHours < 24)  return `${diffHours} hr ago`
  if (diffDays === 1)  return 'yesterday'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ── Entry Card ────────────────────────────────────────────────────────────────

function EntryCard({ entry }: { entry: JournalEntry }) {
  const [expanded, setExpanded] = useState(false)
  const tag = entry.context_tag || 'general'
  const isLong = entry.raw_transcript.length > 180

  return (
    <div className="rounded-xl border p-4 space-y-2" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Context badge */}
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${contextClass(tag)}`}>
            {CONTEXT_LABELS[tag] ?? tag}
          </span>
          {/* Job reference tag */}
          {entry.job_reference && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/30">
              {entry.job_reference}
            </span>
          )}
        </div>
        <span className="text-[11px] text-gray-500 flex-shrink-0">{relativeTime(entry.created_at)}</span>
      </div>

      {/* Transcript */}
      <button
        className="text-left w-full"
        onClick={() => isLong && setExpanded(e => !e)}
        style={{ cursor: isLong ? 'pointer' : 'default' }}
      >
        <p
          className="text-sm text-gray-300 leading-relaxed"
          style={{
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: expanded ? undefined : 3,
            overflow: expanded ? 'visible' : 'hidden',
          }}
        >
          {entry.raw_transcript}
        </p>
        {isLong && !expanded && (
          <span className="text-[11px] text-emerald-400 mt-0.5 inline-block">tap to expand</span>
        )}
      </button>

      {/* Action items */}
      {entry.action_items && entry.action_items.length > 0 && (
        <ul className="space-y-0.5 mt-1">
          {entry.action_items.map((item, i) => (
            <li key={i} className="text-[11px] text-gray-500 flex gap-1.5">
              <span className="text-emerald-500/70 flex-shrink-0">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── JournalPanel ──────────────────────────────────────────────────────────────

export function JournalPanel() {
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [activeContext, setActiveContext] = useState<VoiceContext>('general')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getRecentJournal(50)
      setEntries(data)
    } catch (err) {
      console.error('[JournalPanel] Failed to load entries:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    // Restore saved context from localStorage
    const stored = typeof window !== 'undefined' ? (localStorage.getItem('nexus_voice_context') as VoiceContext) : null
    if (stored) setActiveContext(stored)
  }, [load])

  // Listen for the poweron:show-journal event
  useEffect(() => {
    const handler = () => load()
    window.addEventListener('poweron:show-journal', handler)
    return () => window.removeEventListener('poweron:show-journal', handler)
  }, [load])

  const handleContextChange = (ctx: VoiceContext) => {
    setActiveContext(ctx)
    setVoiceContext(ctx)
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <BookOpen size={20} className="text-emerald-400" />
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Voice Journal</h2>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Context selector */}
          <select
            value={activeContext}
            onChange={e => handleContextChange(e.target.value as VoiceContext)}
            className="text-xs rounded-lg px-2 py-1.5 border focus:outline-none"
            style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}
          >
            <option value="general">General</option>
            <option value="office">Office</option>
            <option value="job_site">Job Site</option>
            <option value="driving">Driving</option>
          </select>

          {/* Refresh button */}
          <button
            onClick={load}
            disabled={loading}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-300 transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-primary)' }}
            title="Refresh journal"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Context hint */}
      <p className="text-[11px] text-gray-500">
        Active context: <span className="text-emerald-400 font-medium">{CONTEXT_LABELS[activeContext]}</span>
        {' '}— NEXUS will use this for new voice notes.
      </p>

      {/* Entries */}
      {loading ? (
        <div className="text-sm text-gray-500 text-center py-16">Loading journal…</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-16 space-y-2">
          <BookOpen size={36} className="mx-auto text-gray-600" />
          <p className="text-sm text-gray-500">No voice notes yet.</p>
          <p className="text-xs text-gray-600">
            Say <span className="text-emerald-400">"remember this"</span> or{' '}
            <span className="text-emerald-400">"save this"</span> to NEXUS to capture thoughts on the go.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map(entry => (
            <EntryCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  )
}
