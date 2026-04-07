// @ts-nocheck
/**
 * VoiceHub.tsx — B18 | Voice Hub tab distinction
 * B20 | Quick Capture rework — focused capture-only interface
 *
 * Three distinctly different tabs:
 *   Quick Capture — Focused capture: mic button, transcription preview, category, recent 5
 *   Insights      — AI analysis of patterns across all voice entries
 *   Journal       — Full journal with all entries, filter by category, expandable entries
 */

import React, { useState, useEffect, useRef, useCallback, Suspense, lazy } from 'react'
import { callClaude, extractText } from '@/services/claudeProxy'
import { getRecentJournal, getWeeklyJournalEntries, saveJournalEntry, type JournalEntry } from '@/services/voiceJournalService'

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

// ── Quick Capture Tab — focused recording interface ────────────────────────────

type CaptureCategory = 'field' | 'financial' | 'personal' | 'project' | 'general'

const CAPTURE_CATEGORIES: { id: CaptureCategory; label: string }[] = [
  { id: 'field',     label: 'Field'     },
  { id: 'financial', label: 'Financial' },
  { id: 'personal',  label: 'Personal'  },
  { id: 'project',   label: 'Project'   },
  { id: 'general',   label: 'General'   },
]

interface CaptureEntry {
  id: string
  timestamp: string
  durationSecs: number
  category: CaptureCategory
  transcript: string
  synced: boolean
}

const CAPTURE_HISTORY_KEY = 'poweron_quick_captures'

function loadCaptureHistory(): CaptureEntry[] {
  try {
    const raw = localStorage.getItem(CAPTURE_HISTORY_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return []
}

function saveCaptureHistory(entries: CaptureEntry[]) {
  try { localStorage.setItem(CAPTURE_HISTORY_KEY, JSON.stringify(entries.slice(0, 50))) } catch { /* ignore */ }
}

// ── Whisper POST helper — MediaRecorder API only, zero connection to voice.ts ─
async function transcribeAudioBlob(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer()
  const uint8 = new Uint8Array(arrayBuffer)
  let binary = ''
  for (let i = 0; i < uint8.byteLength; i++) binary += String.fromCharCode(uint8[i])
  const base64 = btoa(binary)
  const mimeType = blob.type || 'audio/webm'
  const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm'
  const res = await fetch('/.netlify/functions/whisper', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio: base64, filename: `capture.${ext}`, language: 'en' }),
  })
  if (!res.ok) throw new Error(`Whisper error ${res.status}`)
  const data = await res.json()
  return (data.text || '').trim()
}

function QuickCaptureTab() {
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [transcript, setTranscript] = useState<string | null>(null)
  const [editedTranscript, setEditedTranscript] = useState('')
  const [category, setCategory] = useState<CaptureCategory>('general')
  const [recorderDuration, setRecorderDuration] = useState(0)
  const [recent, setRecent] = useState<CaptureEntry[]>(() => loadCaptureHistory())
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [captureError, setCaptureError] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(0)

  function startTimer() {
    setRecorderDuration(0)
    startTimeRef.current = Date.now()
    timerRef.current = setInterval(() => {
      setRecorderDuration(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)
  }

  function stopTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }

  async function toggleRecording() {
    if (isRecording) {
      // Stop recording — onstop handler will POST to Whisper
      stopTimer()
      mediaRecorderRef.current?.stop()
    } else {
      // Start recording — MediaRecorder API only, zero connection to voice.ts/agentBus/NEXUS
      setTranscript(null)
      setEditedTranscript('')
      setSaved(false)
      setCaptureError(null)
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        chunksRef.current = []
        const mr = new MediaRecorder(stream)
        mediaRecorderRef.current = mr

        mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
        mr.onstop = async () => {
          stream.getTracks().forEach(t => t.stop())
          const mimeType = mr.mimeType || 'audio/webm'
          const audioBlob = new Blob(chunksRef.current, { type: mimeType })
          chunksRef.current = []
          setIsTranscribing(true)
          try {
            // POST audio to /.netlify/functions/whisper — no voice.ts, no agentBus, no NEXUS
            const text = await transcribeAudioBlob(audioBlob)
            if (text) {
              setTranscript(text)
              setEditedTranscript(text)
            } else {
              setTranscript('(No speech detected — type your note below)')
              setEditedTranscript('')
            }
          } catch (err) {
            console.error('[QuickCapture] Whisper transcription failed:', err)
            setCaptureError('Transcription failed — type your note manually.')
            setTranscript('')
            setEditedTranscript('')
          } finally {
            setIsTranscribing(false)
          }
        }

        mr.start(100)
        startTimer()
        setIsRecording(true)
      } catch {
        setCaptureError('Microphone access denied. Please allow microphone permissions.')
      }
      return
    }
    setIsRecording(false)
  }

  function handleSave() {
    const text = editedTranscript.trim() || transcript || ''
    if (!text || text.startsWith('(')) return
    setSaving(true)
    const entry: CaptureEntry = {
      id: `cap-${Date.now()}`,
      timestamp: new Date().toISOString(),
      durationSecs: recorderDuration,
      category,
      transcript: text,
      synced: true,
    }
    const updated = [entry, ...recent]
    setRecent(updated)
    saveCaptureHistory(updated)
    // Attempt to persist via voiceJournalService (best effort)
    try {
      saveJournalEntry({ transcript: text, contextTag: category })
        .catch(() => { /* ignore — local copy already saved */ })
    } catch { /* ignore */ }
    setSaving(false)
    setSaved(true)
    setTranscript(null)
    setEditedTranscript('')
    setTimeout(() => setSaved(false), 3000)
  }

  function fmtDuration(secs: number): string {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }

  return (
    <div className="flex flex-col items-center gap-6 p-6">
      {/* Mic button */}
      <div className="flex flex-col items-center gap-3">
        <button
          onClick={toggleRecording}
          className={`w-24 h-24 rounded-full flex items-center justify-center shadow-lg transition-all duration-200 focus:outline-none focus:ring-4 ${
            isRecording
              ? 'bg-red-600 hover:bg-red-500 focus:ring-red-400/40 animate-pulse'
              : 'bg-gray-800 hover:bg-gray-700 focus:ring-gray-600/40 border border-gray-600'
          }`}
          title={isRecording ? 'Tap to stop' : 'Tap to record'}
        >
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </button>
        {isRecording ? (
          <span className="text-red-400 text-sm font-bold">{fmtDuration(recorderDuration)} — Recording… tap to stop</span>
        ) : isTranscribing ? (
          <span className="text-yellow-400 text-sm font-bold">Transcribing…</span>
        ) : (
          <span className="text-gray-500 text-sm">Tap to record</span>
        )}
        {captureError && (
          <span className="text-red-400 text-xs text-center max-w-xs">{captureError}</span>
        )}
      </div>

      {/* Transcription preview */}
      {transcript && !saved && (
        <div className="w-full max-w-lg space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Transcription Preview</p>
          <textarea
            value={editedTranscript}
            onChange={(e) => setEditedTranscript(e.target.value)}
            placeholder={transcript}
            rows={4}
            className="w-full px-3 py-2 rounded-lg border text-sm text-gray-100 resize-none outline-none focus:border-emerald-500 transition-colors"
            style={{ backgroundColor: '#111318', borderColor: '#2a2d38' }}
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 text-white text-sm font-bold rounded-lg transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => { setTranscript(null); setEditedTranscript('') }}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg transition-colors"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {saved && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-900/40 border border-emerald-600/40 text-emerald-400 text-sm font-semibold">
          ✓ Capture saved
        </div>
      )}

      {/* Category selector */}
      <div className="w-full max-w-lg">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Category</p>
        <div className="flex flex-wrap gap-2">
          {CAPTURE_CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                category === cat.id
                  ? 'bg-emerald-600 border-emerald-500 text-white'
                  : 'bg-transparent border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-300'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Recent captures */}
      {recent.length > 0 && (
        <div className="w-full max-w-lg">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Recent Captures</p>
          <div className="space-y-2">
            {recent.slice(0, 5).map(entry => (
              <div
                key={entry.id}
                className="flex items-start gap-3 px-3 py-2.5 rounded-lg border"
                style={{ borderColor: '#1e2128', backgroundColor: '#0a0b10' }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-200 truncate">{entry.transcript.slice(0, 120)}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-gray-600">{new Date(entry.timestamp).toLocaleString()}</span>
                    <span className="text-xs text-gray-600">·</span>
                    <span className="text-xs text-gray-600">{fmtDuration(entry.durationSecs)}</span>
                    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${CATEGORY_COLORS[entry.category] || CATEGORY_COLORS.general}`}>
                      {entry.category}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
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
        {/* Quick Capture — focused capture-only interface */}
        {activeTab === 'quick-capture' && (
          <QuickCaptureTab />
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
