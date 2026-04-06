// @ts-nocheck
/**
 * VoiceHub.tsx — B18 | Voice Hub tab distinction
 *
 * Three distinctly different tabs:
 *   Quick Capture — Voice capture/recording interface (tap to record, recent captures, category tags)
 *   Insights      — AI analysis of patterns across all voice entries
 *   Journal       — Full journal with all entries, filter by category, expandable entries
 */

import React, { useState, useEffect, Suspense, lazy } from 'react'
import { callClaude, extractText } from '@/services/claudeProxy'
import { getRecentJournal, getWeeklyJournalEntries, type JournalEntry } from '@/services/voiceJournalService'

// Lazy-load underlying components (same pattern used in AppShell)
function chunkRetry<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((): any => { window.location.reload(); return { default: () => null } })
}

const VoiceJournalingV2 = lazy(() => chunkRetry(() => import('@/views/VoiceJournalingV2')))
const JournalPanel = lazy(() =>
  import('@/components/JournalPanel')
    .then(m => ({ default: m.JournalPanel }))
    .catch((): any => { window.location.reload(); return { default: () => null } })
)

type VoiceHubTab = 'quick-capture' | 'insights' | 'journal'

const TABS: { id: VoiceHubTab; label: string }[] = [
  { id: 'quick-capture', label: 'Quick Capture' },
  { id: 'insights',      label: 'Insights'       },
  { id: 'journal',       label: 'Journal'        },
]

function PanelLoading() {
  return (
    <div className="flex items-center justify-center h-32">
      <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

// ── Insights Tab — AI pattern analysis across all voice entries ───────────────

const CATEGORY_COLORS: Record<string, string> = {
  field:     'bg-amber-900/40 text-amber-300 border-amber-700/60',
  financial: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/60',
  personal:  'bg-violet-900/40 text-violet-300 border-violet-700/60',
  project:   'bg-sky-900/40 text-sky-300 border-sky-700/60',
  general:   'bg-gray-800/60 text-gray-400 border-gray-700',
}

function InsightsTab() {
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [aiLoading, setAiLoading] = useState(false)
  const [analysis, setAnalysis] = useState<{
    themes: string[]
    decisions: string[]
    projects: string[]
    weeklySummary: string
  } | null>(null)
  const [error, setError] = useState<string>('')

  useEffect(() => {
    getWeeklyJournalEntries()
      .then(e => { setEntries(e); setLoading(false) })
      .catch(() => { setLoading(false) })
  }, [])

  async function runInsights() {
    if (entries.length === 0) return
    setAiLoading(true)
    setError('')
    try {
      const corpus = entries.slice(0, 30).map((e, i) =>
        `[${i + 1}] ${new Date(e.timestamp).toLocaleDateString()} | ${e.category} | ${e.transcript}`
      ).join('\n')

      const prompt = `You are ECHO, an AI assistant for a field electrical contractor. Analyze these voice journal entries from the past 7 days and extract:
1. THEMES: Recurring topics or concerns that appear multiple times (list up to 5 as short phrases)
2. DECISIONS: Specific decisions the owner made or is considering (list up to 5)
3. PROJECTS: Project names or job sites mentioned (list unique names only, up to 8)
4. WEEKLY_SUMMARY: A 2–3 sentence summary of the week's activity and focus areas.

Respond in this exact JSON format:
{
  "themes": ["theme1", "theme2"],
  "decisions": ["decision1", "decision2"],
  "projects": ["project1", "project2"],
  "weekly_summary": "Summary text here."
}

Entries:
${corpus}`

      const res = await callClaude([{ role: 'user', content: prompt }])
      const text = extractText(res)
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        setAnalysis({
          themes: parsed.themes || [],
          decisions: parsed.decisions || [],
          projects: parsed.projects || [],
          weeklySummary: parsed.weekly_summary || '',
        })
      } else {
        setError('Could not parse AI response. Try again.')
      }
    } catch (e: any) {
      setError('AI analysis unavailable — check Claude API connection.')
    } finally {
      setAiLoading(false)
    }
  }

  if (loading) return <PanelLoading />

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 p-6 text-center">
        <span style={{ fontSize: '3rem' }}>🎙️</span>
        <h3 className="text-lg font-semibold text-gray-200">No entries yet</h3>
        <p className="text-sm text-gray-500 max-w-xs">
          Start recording voice notes in Quick Capture and your AI-powered insights will appear here — themes, decisions, project mentions, and weekly summaries.
        </p>
      </div>
    )
  }

  // Category distribution
  const categoryCounts: Record<string, number> = {}
  entries.forEach(e => { categoryCounts[e.category] = (categoryCounts[e.category] || 0) + 1 })

  return (
    <div className="p-4 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-gray-100">Voice Insights</h2>
          <p className="text-xs text-gray-500 mt-0.5">{entries.length} entries from the past 7 days</p>
        </div>
        <button
          onClick={runInsights}
          disabled={aiLoading}
          className="px-4 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors"
        >
          {aiLoading ? 'Analyzing…' : '✨ Analyze Patterns'}
        </button>
      </div>

      {/* Category distribution */}
      <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Entry Breakdown</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(categoryCounts).map(([cat, count]) => (
            <span key={cat} className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${CATEGORY_COLORS[cat] || CATEGORY_COLORS.general}`}>
              {cat} <span className="opacity-70">({count})</span>
            </span>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-950/40 border border-red-800 rounded-xl px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      {/* AI Analysis results */}
      {analysis ? (
        <div className="space-y-4">
          {/* Weekly summary */}
          {analysis.weeklySummary && (
            <div className="bg-emerald-950/30 border border-emerald-800/50 rounded-xl p-4">
              <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2">Weekly Summary</p>
              <p className="text-sm text-gray-300 leading-relaxed">{analysis.weeklySummary}</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Themes */}
            {analysis.themes.length > 0 && (
              <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
                <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-3">🔁 Recurring Themes</p>
                <ul className="space-y-1.5">
                  {analysis.themes.map((t, i) => (
                    <li key={i} className="text-sm text-gray-300 flex items-start gap-2">
                      <span className="text-amber-500 mt-0.5 flex-shrink-0">•</span>{t}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Decisions */}
            {analysis.decisions.length > 0 && (
              <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
                <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-3">✅ Decisions Made</p>
                <ul className="space-y-1.5">
                  {analysis.decisions.map((d, i) => (
                    <li key={i} className="text-sm text-gray-300 flex items-start gap-2">
                      <span className="text-blue-500 mt-0.5 flex-shrink-0">•</span>{d}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Projects */}
            {analysis.projects.length > 0 && (
              <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
                <p className="text-xs font-semibold text-sky-400 uppercase tracking-wider mb-3">🏗️ Projects Mentioned</p>
                <ul className="space-y-1.5">
                  {analysis.projects.map((p, i) => (
                    <li key={i} className="text-sm text-gray-300 flex items-start gap-2">
                      <span className="text-sky-500 mt-0.5 flex-shrink-0">•</span>{p}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-gray-800/30 border border-gray-700 rounded-xl p-6 text-center">
          <p className="text-sm text-gray-400">Click <strong className="text-gray-300">Analyze Patterns</strong> to surface recurring themes, decisions, project mentions, and a weekly summary from your voice entries.</p>
        </div>
      )}
    </div>
  )
}

// ── Main VoiceHub component ───────────────────────────────────────────────────

export default function VoiceHub() {
  const [activeTab, setActiveTab] = useState<VoiceHubTab>('quick-capture')

  return (
    <div className="flex flex-col h-full" style={{ color: 'var(--text-primary)' }}>
      {/* Horizontal tab bar */}
      <div
        className="flex-shrink-0 flex items-center border-b gap-1 px-4 pt-3"
        style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
      >
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors rounded-t-md focus:outline-none ${
              activeTab === tab.id
                ? 'border-b-2 border-emerald-500 text-emerald-400'
                : 'text-gray-400 hover:text-gray-200'
            }`}
            style={{ marginBottom: activeTab === tab.id ? '-1px' : undefined }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {/* Quick Capture — voice recording interface with recent captures and category tags */}
        {activeTab === 'quick-capture' && (
          <Suspense fallback={<PanelLoading />}>
            <VoiceJournalingV2 />
          </Suspense>
        )}

        {/* Insights — AI analysis of patterns across all voice entries */}
        {activeTab === 'insights' && (
          <InsightsTab />
        )}

        {/* Journal — full journal with all entries, filter by category, expandable */}
        {activeTab === 'journal' && (
          <Suspense fallback={<PanelLoading />}>
            <JournalPanel />
          </Suspense>
        )}
      </div>
    </div>
  )
}
