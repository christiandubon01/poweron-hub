// @ts-nocheck
/**
 * JournalPanel — Voice journal entries panel.
 *
 * Session 8 upgrades:
 * - ECHO auto-tag chips (tag_type + priority + project_name)
 * - Text search across entry content (real-time)
 * - Filter by tag type
 * - Filter by project name
 * - Filter by date range
 * - Sort by date or priority
 * - Weekly Summary modal with Copy to Clipboard
 *
 * Context badge colours:
 *   job_site=amber  driving=blue  office=teal  general=gray
 */

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { RefreshCw, BookOpen, Search, X, Filter, BarChart2, ChevronDown, Copy, Check } from 'lucide-react'
import {
  getJournalWithFilters,
  getWeeklyJournalEntries,
  type JournalEntry,
  type JournalFilterOptions,
  type JournalTagType,
  type JournalPriority,
} from '@/services/voiceJournalService'
import { setVoiceContext, type VoiceContext } from '@/services/voice'
import { callClaude, extractText } from '@/services/claudeProxy'

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

// ── Tag type helpers ──────────────────────────────────────────────────────────

const TAG_TYPE_LABELS: Record<JournalTagType, string> = {
  project_note:    'Project',
  collection_note: 'Collection',
  lead_note:       'Lead',
  personal:        'Personal',
  task:            'Task',
  decision:        'Decision',
}

const TAG_TYPE_COLORS: Record<JournalTagType, string> = {
  project_note:    'bg-blue-500/20 text-blue-300 border-blue-500/30',
  collection_note: 'bg-green-500/20 text-green-300 border-green-500/30',
  lead_note:       'bg-purple-500/20 text-purple-300 border-purple-500/30',
  personal:        'bg-gray-500/20 text-gray-300 border-gray-500/30',
  task:            'bg-orange-500/20 text-orange-300 border-orange-500/30',
  decision:        'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
}

// ── Priority helpers ──────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<JournalPriority, string> = {
  high:   'bg-red-500/20 text-red-400 border-red-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  low:    'bg-gray-500/20 text-gray-400 border-gray-500/30',
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
    <div
      className="rounded-xl border p-4 space-y-2"
      style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Context badge */}
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${contextClass(tag)}`}>
            {CONTEXT_LABELS[tag] ?? tag}
          </span>

          {/* ECHO tag_type chip */}
          {entry.tag_type && TAG_TYPE_LABELS[entry.tag_type] && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${TAG_TYPE_COLORS[entry.tag_type] ?? 'bg-gray-500/20 text-gray-400 border-gray-500/30'}`}>
              {TAG_TYPE_LABELS[entry.tag_type]}
            </span>
          )}

          {/* Priority chip */}
          {entry.priority && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${PRIORITY_COLORS[entry.priority] ?? ''}`}>
              {entry.priority.toUpperCase()}
            </span>
          )}

          {/* Project name chip */}
          {entry.project_name && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              {entry.project_name}
            </span>
          )}

          {/* Legacy job_reference chip (shown only if no project_name) */}
          {!entry.project_name && entry.job_reference && (
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

// ── Weekly Summary Modal ──────────────────────────────────────────────────────

function WeeklySummaryModal({ onClose }: { onClose: () => void }) {
  const [summary, setSummary] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        const entries = await getWeeklyJournalEntries()

        if (entries.length === 0) {
          if (!cancelled) {
            setSummary('No journal entries found in the past 7 days.')
            setLoading(false)
          }
          return
        }

        // Build a text corpus from the entries
        const corpus = entries.map((e, i) => {
          const date = new Date(e.created_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
          const tagStr = e.tag_type ? ` [${e.tag_type}]` : ''
          const projStr = e.project_name ? ` (${e.project_name})` : ''
          return `${i + 1}. ${date}${tagStr}${projStr}: ${e.raw_transcript}`
        }).join('\n\n')

        const response = await callClaude({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 800,
          system: `You are ECHO, the long-term memory agent for Power On Solutions LLC, a C-10 electrical contractor. Summarize the owner's journal entries from the past 7 days into a structured weekly briefing.

Format your response with these exact sections:
## What Got Done
[bullet points of completed work or progress made]

## What's Pending
[bullet points of open tasks, unresolved issues, or work in progress]

## Key Decisions Made
[bullet points of decisions or choices recorded]

## Follow-Ups Needed
[bullet points of action items, calls to make, things to chase down]

Be specific and concise. Use the actual content from the notes — don't generalize. If a section has nothing, write "None recorded this week."`,
          messages: [{
            role: 'user',
            content: `Here are the journal entries from the past 7 days:\n\n${corpus}`,
          }],
        })

        if (!cancelled) {
          setSummary(extractText(response))
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError('Could not generate summary. Please try again.')
          setLoading(false)
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  const handleCopy = () => {
    navigator.clipboard?.writeText(summary).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border shadow-2xl flex flex-col max-h-[85vh]"
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border-primary)' }}>
          <div className="flex items-center gap-2">
            <BarChart2 size={18} className="text-emerald-400" />
            <h3 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Weekly Summary</h3>
            <span className="text-[10px] text-gray-500 font-mono">last 7 days · ECHO</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Modal body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-8 justify-center">
              <RefreshCw size={16} className="animate-spin text-emerald-400" />
              <span>ECHO is summarizing your week…</span>
            </div>
          ) : error ? (
            <p className="text-sm text-red-400 py-4">{error}</p>
          ) : (
            <pre className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap font-sans">{summary}</pre>
          )}
        </div>

        {/* Modal footer */}
        {!loading && !error && summary && (
          <div className="flex items-center justify-end px-5 py-3 border-t gap-2" style={{ borderColor: 'var(--border-primary)' }}>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
              style={{
                backgroundColor: copied ? 'rgba(52,211,153,0.15)' : 'var(--bg-secondary)',
                color: copied ? '#34d399' : 'var(--text-secondary)',
                border: '1px solid var(--border-primary)',
              }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copied!' : 'Copy to clipboard'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── JournalPanel ──────────────────────────────────────────────────────────────

export function JournalPanel() {
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [activeContext, setActiveContext] = useState<VoiceContext>('general')
  const [showSummaryModal, setShowSummaryModal] = useState(false)
  const [showFilters, setShowFilters] = useState(false)

  // Filter state
  const [searchText, setSearchText] = useState('')
  const [filterTagType, setFilterTagType] = useState<JournalTagType | ''>('')
  const [filterProject, setFilterProject] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [sortBy, setSortBy] = useState<JournalFilterOptions['sort_by']>('date_desc')

  // Debounce timer for search
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (opts: JournalFilterOptions = {}) => {
    setLoading(true)
    try {
      const data = await getJournalWithFilters(opts, 100)
      setEntries(data)
    } catch (err) {
      console.error('[JournalPanel] Failed to load entries:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  // Build filter object from state
  const buildFilters = useCallback((): JournalFilterOptions => {
    const opts: JournalFilterOptions = {}
    if (searchText.trim())   opts.search       = searchText.trim()
    if (filterTagType)       opts.tag_type      = filterTagType
    if (filterProject.trim()) opts.project_name = filterProject.trim()
    if (filterDateFrom)      opts.date_from     = filterDateFrom
    if (filterDateTo)        opts.date_to       = filterDateTo
    if (sortBy)              opts.sort_by       = sortBy
    return opts
  }, [searchText, filterTagType, filterProject, filterDateFrom, filterDateTo, sortBy])

  // Load on mount
  useEffect(() => {
    load()
    const stored = typeof window !== 'undefined' ? (localStorage.getItem('nexus_voice_context') as VoiceContext) : null
    if (stored) setActiveContext(stored)
  }, [load])

  // Listen for the poweron:show-journal event
  useEffect(() => {
    const handler = () => load(buildFilters())
    window.addEventListener('poweron:show-journal', handler)
    return () => window.removeEventListener('poweron:show-journal', handler)
  }, [load, buildFilters])

  // Debounced re-load when filters change
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      load(buildFilters())
    }, 300)
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [searchText, filterTagType, filterProject, filterDateFrom, filterDateTo, sortBy]) // eslint-disable-line

  const handleContextChange = (ctx: VoiceContext) => {
    setActiveContext(ctx)
    setVoiceContext(ctx)
  }

  const clearFilters = () => {
    setSearchText('')
    setFilterTagType('')
    setFilterProject('')
    setFilterDateFrom('')
    setFilterDateTo('')
    setSortBy('date_desc')
  }

  const hasActiveFilters = searchText || filterTagType || filterProject || filterDateFrom || filterDateTo || sortBy !== 'date_desc'

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <BookOpen size={20} className="text-emerald-400" />
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Voice Journal</h2>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Weekly Summary */}
          <button
            onClick={() => setShowSummaryModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
            style={{
              backgroundColor: 'rgba(52,211,153,0.10)',
              color: '#34d399',
              border: '1px solid rgba(52,211,153,0.25)',
            }}
          >
            <BarChart2 size={13} />
            Weekly Summary
          </button>

          {/* Toggle filters */}
          <button
            onClick={() => setShowFilters(f => !f)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors border ${
              hasActiveFilters
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                : 'border-[var(--border-primary)] text-gray-400 hover:text-gray-300'
            }`}
            style={!hasActiveFilters ? { backgroundColor: 'var(--bg-card)' } : {}}
          >
            <Filter size={13} />
            Filter{hasActiveFilters ? ' ●' : ''}
          </button>

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
            onClick={() => load(buildFilters())}
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

      {/* Search bar (always visible) */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          placeholder="Search journal entries…"
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          className="w-full pl-9 pr-8 py-2 rounded-xl text-sm focus:outline-none"
          style={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-primary)',
            color: 'var(--text-primary)',
          }}
        />
        {searchText && (
          <button
            onClick={() => setSearchText('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* Filter panel (collapsible) */}
      {showFilters && (
        <div
          className="rounded-xl border p-4 space-y-3"
          style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-primary)' }}
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {/* Tag type filter */}
            <div className="space-y-1">
              <label className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Type</label>
              <select
                value={filterTagType}
                onChange={e => setFilterTagType(e.target.value as JournalTagType | '')}
                className="w-full rounded-lg px-2 py-1.5 text-xs border focus:outline-none"
                style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}
              >
                <option value="">All types</option>
                <option value="project_note">Project</option>
                <option value="collection_note">Collection</option>
                <option value="lead_note">Lead</option>
                <option value="task">Task</option>
                <option value="decision">Decision</option>
                <option value="personal">Personal</option>
              </select>
            </div>

            {/* Project filter */}
            <div className="space-y-1">
              <label className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Project</label>
              <input
                type="text"
                placeholder="Project name…"
                value={filterProject}
                onChange={e => setFilterProject(e.target.value)}
                className="w-full rounded-lg px-2 py-1.5 text-xs border focus:outline-none"
                style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}
              />
            </div>

            {/* Sort */}
            <div className="space-y-1">
              <label className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Sort</label>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as JournalFilterOptions['sort_by'])}
                className="w-full rounded-lg px-2 py-1.5 text-xs border focus:outline-none"
                style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}
              >
                <option value="date_desc">Newest first</option>
                <option value="date_asc">Oldest first</option>
                <option value="priority_high">Priority: High first</option>
              </select>
            </div>

            {/* Date from */}
            <div className="space-y-1">
              <label className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">From</label>
              <input
                type="date"
                value={filterDateFrom}
                onChange={e => setFilterDateFrom(e.target.value)}
                className="w-full rounded-lg px-2 py-1.5 text-xs border focus:outline-none"
                style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}
              />
            </div>

            {/* Date to */}
            <div className="space-y-1">
              <label className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">To</label>
              <input
                type="date"
                value={filterDateTo}
                onChange={e => setFilterDateTo(e.target.value)}
                className="w-full rounded-lg px-2 py-1.5 text-xs border focus:outline-none"
                style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}
              />
            </div>
          </div>

          {/* Clear filters */}
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-[11px] text-red-400 hover:text-red-300 transition-colors flex items-center gap-1"
            >
              <X size={11} /> Clear all filters
            </button>
          )}
        </div>
      )}

      {/* Result count */}
      {!loading && (
        <p className="text-[11px] text-gray-500">
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          {hasActiveFilters && ' matching filters'}
        </p>
      )}

      {/* Entries */}
      {loading ? (
        <div className="text-sm text-gray-500 text-center py-16">Loading journal…</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-16 space-y-2">
          <BookOpen size={36} className="mx-auto text-gray-600" />
          {hasActiveFilters ? (
            <>
              <p className="text-sm text-gray-500">No entries match your filters.</p>
              <button onClick={clearFilters} className="text-xs text-emerald-400 hover:text-emerald-300">
                Clear filters
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-500">No voice notes yet.</p>
              <p className="text-xs text-gray-600">
                Say <span className="text-emerald-400">"remember this"</span> or{' '}
                <span className="text-emerald-400">"save this"</span> to NEXUS to capture thoughts on the go.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map(entry => (
            <EntryCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}

      {/* Weekly Summary Modal */}
      {showSummaryModal && (
        <WeeklySummaryModal onClose={() => setShowSummaryModal(false)} />
      )}
    </div>
  )
}
