// @ts-nocheck
/**
 * SparkCoachPanel.tsx
 * SP12 — SPARK Nightly Coach UI
 *
 * Displays the nightly communication review:
 *   - Per-conversation expandable scorecards
 *   - 7-day trend SVG line chart (no chart library)
 *   - Best/Worst moment audio replay (if audio stored)
 *   - Improvement suggestions + practice phrases
 *   - Weekly SPARK Score prominently displayed
 *
 * Trigger: SPARK, let's review — or manual "Run Review" button.
 */

import { useState, useCallback, useEffect } from 'react'
import {
  Zap, ChevronDown, ChevronUp, TrendingUp, TrendingDown,
  Minus, Play, AlertTriangle, CheckCircle2, Loader2,
  BarChart2, MessageSquare, Target, Shield, DollarSign, Brain,
  Mic, RefreshCw,
} from 'lucide-react'
import clsx from 'clsx'
import {
  runNightlyReview,
  getTodayReview,
  getWeeklyTrend,
  type DailyCoachReport,
  type ConversationScore,
  type WeeklyTrend,
  type DailySparkRecord,
} from '@/services/sparkLiveCall/SparkNightlyCoach'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 8) return 'text-green-400'
  if (score >= 6) return 'text-yellow-400'
  if (score >= 4) return 'text-orange-400'
  return 'text-red-400'
}

function scoreBg(score: number): string {
  if (score >= 8) return 'bg-green-500/15 border-green-500/30'
  if (score >= 6) return 'bg-yellow-500/15 border-yellow-500/30'
  if (score >= 4) return 'bg-orange-500/15 border-orange-500/30'
  return 'bg-red-500/15 border-red-500/30'
}

function sparkBadgeColor(score: number): string {
  if (score >= 8) return 'text-green-300 border-green-500/40 bg-green-500/10'
  if (score >= 6) return 'text-yellow-300 border-yellow-500/40 bg-yellow-500/10'
  if (score >= 4) return 'text-orange-300 border-orange-500/40 bg-orange-500/10'
  return 'text-red-300 border-red-500/40 bg-red-500/10'
}

function paceLabel(rating: ConversationScore['paceRating']): string {
  if (rating === 'too_fast') return 'Too Fast'
  if (rating === 'too_slow') return 'Too Slow'
  if (rating === 'good')     return 'Good Pace'
  return '—'
}

function paceColor(rating: ConversationScore['paceRating']): string {
  if (rating === 'too_fast') return 'text-orange-400'
  if (rating === 'too_slow') return 'text-blue-400'
  if (rating === 'good')     return 'text-green-400'
  return 'text-zinc-500'
}

// ─────────────────────────────────────────────────────────────────────────────
// Score Bar — thin horizontal bar showing 1-10
// ─────────────────────────────────────────────────────────────────────────────

function ScoreBar({ label, score, icon: Icon }: {
  label: string
  score: number
  icon: React.ElementType
}) {
  const pct = (score / 10) * 100
  return (
    <div className="flex items-center gap-3">
      <Icon size={14} className="text-zinc-500 shrink-0" />
      <span className="text-xs text-zinc-400 w-36 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={clsx(
            'h-full rounded-full transition-all duration-500',
            score >= 8 ? 'bg-green-500' : score >= 6 ? 'bg-yellow-500' : score >= 4 ? 'bg-orange-500' : 'bg-red-500',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={clsx('text-sm font-semibold w-6 text-right shrink-0', scoreColor(score))}>
        {score}
      </span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Weekly SVG Trend Chart
// ─────────────────────────────────────────────────────────────────────────────

function WeeklyTrendChart({ records }: { records: DailySparkRecord[] }) {
  const W = 420
  const H = 120
  const PAD = { top: 12, right: 16, bottom: 28, left: 28 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  if (records.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-zinc-600 text-sm">
        No weekly data yet — run your first review.
      </div>
    )
  }

  const scores = records.map(r => r.sparkScore)
  const minScore = Math.max(0, Math.min(...scores) - 1)
  const maxScore = Math.min(10, Math.max(...scores) + 1)
  const range = maxScore - minScore || 1

  const xStep = records.length > 1 ? innerW / (records.length - 1) : innerW / 2

  const points = records.map((r, i) => {
    const x = PAD.left + (records.length > 1 ? i * xStep : innerW / 2)
    const y = PAD.top + innerH - ((r.sparkScore - minScore) / range) * innerH
    return { x, y, record: r }
  })

  const polyline = points.map(p => `${p.x},${p.y}`).join(' ')

  // Gradient area path
  const areaPath =
    `M ${points[0].x} ${PAD.top + innerH} ` +
    points.map(p => `L ${p.x} ${p.y}`).join(' ') +
    ` L ${points[points.length - 1].x} ${PAD.top + innerH} Z`

  const dayLabel = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00')
    return d.toLocaleDateString('en-US', { weekday: 'short' })
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      aria-label="7-day SPARK score trend"
    >
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#facc15" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#facc15" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map(pct => {
        const y = PAD.top + innerH * pct
        return (
          <line
            key={pct}
            x1={PAD.left}
            y1={y}
            x2={PAD.left + innerW}
            y2={y}
            stroke="#3f3f46"
            strokeWidth="0.5"
          />
        )
      })}

      {/* Area fill */}
      <path d={areaPath} fill="url(#spark-grad)" />

      {/* Line */}
      <polyline
        points={polyline}
        fill="none"
        stroke="#facc15"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Data points */}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r="4"
          fill="#18181b"
          stroke="#facc15"
          strokeWidth="2"
        />
      ))}

      {/* X-axis day labels */}
      {points.map((p, i) => (
        <text
          key={i}
          x={p.x}
          y={H - 4}
          textAnchor="middle"
          fontSize="9"
          fill="#71717a"
        >
          {dayLabel(records[i].date)}
        </text>
      ))}

      {/* Score labels on points */}
      {points.map((p, i) => (
        <text
          key={`score-${i}`}
          x={p.x}
          y={p.y - 8}
          textAnchor="middle"
          fontSize="9"
          fontWeight="600"
          fill="#facc15"
        >
          {records[i].sparkScore}
        </text>
      ))}
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversation Score Card
// ─────────────────────────────────────────────────────────────────────────────

function ConversationCard({ score, index }: { score: ConversationScore; index: number }) {
  const [expanded, setExpanded] = useState(false)

  // Audio replay (only available if browser has stored the blob URL via ECHO)
  const bestAudioKey  = `echo_audio_${score.conversationId}_best`
  const worstAudioKey = `echo_audio_${score.conversationId}_worst`
  const bestUrl  = localStorage.getItem(bestAudioKey)  ?? null
  const worstUrl = localStorage.getItem(worstAudioKey) ?? null

  const playAudio = useCallback((url: string | null) => {
    if (!url) return
    const audio = new Audio(url)
    audio.play().catch(() => {/* ignore if blocked */})
  }, [])

  const fillerList = Object.entries(score.fillerStats.counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
      {/* Card header — always visible */}
      <button
        className="w-full flex items-center justify-between p-4 text-left hover:bg-zinc-800/40 transition-colors"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3">
          <div
            className={clsx(
              'w-9 h-9 rounded-full border flex items-center justify-center text-xs font-bold shrink-0',
              sparkBadgeColor(score.sparkScore),
            )}
          >
            {score.sparkScore.toFixed(1)}
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-100 leading-tight">
              {score.label}
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Conversation #{index + 1} &nbsp;·&nbsp; {score.fillerStats.total} fillers &nbsp;·&nbsp;
              <span className={paceColor(score.paceRating)}>{paceLabel(score.paceRating)}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className={clsx('text-xs font-semibold', scoreColor(score.closing))}>
            Closing {score.closing}/10
          </span>
          {expanded ? <ChevronUp size={16} className="text-zinc-500" /> : <ChevronDown size={16} className="text-zinc-500" />}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 space-y-5 border-t border-zinc-800">
          {/* Score bars */}
          <div className="pt-4 space-y-2.5">
            <ScoreBar label="Clarity"            score={score.clarity}            icon={MessageSquare} />
            <ScoreBar label="Confidence"          score={score.confidence}         icon={Shield} />
            <ScoreBar label="Technical Depth"     score={score.technicalDepth}     icon={Brain} />
            <ScoreBar label="Closing"             score={score.closing}            icon={Target} />
            <ScoreBar label="Emotional Control"   score={score.emotionalControl}   icon={Zap} />
            <ScoreBar label="Pricing Discipline"  score={score.pricingDiscipline}  icon={DollarSign} />
          </div>

          {/* Best / Worst moments */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-lg bg-green-500/8 border border-green-500/20 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-green-400 flex items-center gap-1.5">
                  <CheckCircle2 size={12} /> Best Moment
                </span>
                {bestUrl && (
                  <button
                    onClick={() => playAudio(bestUrl)}
                    className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300"
                    title="Replay audio"
                  >
                    <Play size={11} /> Play
                  </button>
                )}
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed">{score.bestMoment}</p>
            </div>

            <div className="rounded-lg bg-red-500/8 border border-red-500/20 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-red-400 flex items-center gap-1.5">
                  <AlertTriangle size={12} /> Worst Moment
                </span>
                {worstUrl && (
                  <button
                    onClick={() => playAudio(worstUrl)}
                    className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300"
                    title="Replay audio"
                  >
                    <Play size={11} /> Play
                  </button>
                )}
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed">{score.worstMoment}</p>
            </div>
          </div>

          {/* Practice phrase */}
          {score.practicePhrase && (
            <div className="rounded-lg bg-yellow-500/8 border border-yellow-500/20 p-3">
              <p className="text-xs font-semibold text-yellow-400 mb-1.5">Practice saying instead:</p>
              <p className="text-sm text-zinc-200 italic leading-relaxed">"{score.practicePhrase}"</p>
            </div>
          )}

          {/* Filler word breakdown */}
          {score.fillerStats.total > 0 && (
            <div>
              <p className="text-xs font-semibold text-zinc-400 mb-2">
                Filler Words ({score.fillerStats.total} total)
              </p>
              <div className="flex flex-wrap gap-2">
                {fillerList.map(([word, count]) => (
                  <span
                    key={word}
                    className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700"
                  >
                    "{word}" ×{count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Delivery stats */}
          <div className="flex gap-4 text-xs text-zinc-500">
            <span>
              Pace:{' '}
              <span className={clsx('font-semibold', paceColor(score.paceRating))}>
                {score.paceWPM !== 'unknown' ? `${score.paceWPM} wpm · ` : ''}
                {paceLabel(score.paceRating)}
              </span>
            </span>
            <span>
              Power Language:{' '}
              <span className={clsx('font-semibold', score.powerLanguageRatio >= 0.65 ? 'text-green-400' : 'text-orange-400')}>
                {Math.round(score.powerLanguageRatio * 100)}%
              </span>
            </span>
            <span>
              Hedges:{' '}
              <span className={clsx('font-semibold', score.hedgeCount === 0 ? 'text-green-400' : score.hedgeCount > 5 ? 'text-red-400' : 'text-yellow-400')}>
                {score.hedgeCount}
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Panel
// ─────────────────────────────────────────────────────────────────────────────

export function SparkCoachPanel() {
  const [report,  setReport]  = useState<DailyCoachReport | null>(null)
  const [trend,   setTrend]   = useState<WeeklyTrend | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [tab, setTab] = useState<'today' | 'week'>('today')

  // Load cached data on mount
  useEffect(() => {
    const cached = getTodayReview()
    if (cached) setReport(cached)
    setTrend(getWeeklyTrend())
  }, [])

  const handleRunReview = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await runNightlyReview()
      setReport(result)
      setTrend(getWeeklyTrend())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Review failed — try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  const overallScore = report?.overallSparkScore ?? null

  return (
    <div className="flex flex-col gap-6 p-4 max-w-2xl mx-auto">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Zap size={18} className="text-yellow-400" />
            <h2 className="text-lg font-bold text-zinc-100">SPARK Nightly Coach</h2>
          </div>
          <p className="text-xs text-zinc-500">
            End-of-day communication review · {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
          </p>
        </div>

        <button
          onClick={handleRunReview}
          disabled={loading}
          className={clsx(
            'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-all',
            loading
              ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
              : 'bg-yellow-500/15 border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/25',
          )}
        >
          {loading ? (
            <><Loader2 size={14} className="animate-spin" /> Analyzing…</>
          ) : (
            <><RefreshCw size={14} /> Run Review</>
          )}
        </button>
      </div>

      {/* ── Error ────────────────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400 flex items-center gap-2">
          <AlertTriangle size={14} className="shrink-0" />
          {error}
        </div>
      )}

      {/* ── Overall SPARK Score ──────────────────────────────────────────────── */}
      {overallScore !== null && (
        <div className={clsx(
          'rounded-xl border p-5 flex items-center justify-between',
          scoreBg(overallScore),
        )}>
          <div>
            <p className="text-xs text-zinc-400 mb-1">Today's Overall SPARK Score</p>
            <p className={clsx('text-4xl font-black tracking-tight', scoreColor(overallScore))}>
              {overallScore.toFixed(1)}
              <span className="text-lg text-zinc-500 font-normal">/10</span>
            </p>
            <p className="text-xs text-zinc-500 mt-1">
              {report!.conversationScores.length} conversation(s) reviewed
            </p>
          </div>
          <div className="text-right space-y-1">
            <p className="text-xs text-zinc-500">Filler words</p>
            <p className="text-2xl font-bold text-zinc-200">{report!.totalFillerWords}</p>
            <p className="text-xs text-zinc-500">Power ratio</p>
            <p className="text-lg font-semibold text-zinc-200">
              {Math.round(report!.avgPowerRatio * 100)}%
            </p>
          </div>
        </div>
      )}

      {/* ── Tabs ─────────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 p-1 rounded-lg bg-zinc-900 border border-zinc-800">
        {(['today', 'week'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              'flex-1 py-1.5 rounded-md text-xs font-semibold transition-all',
              tab === t
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300',
            )}
          >
            {t === 'today' ? "Today's Review" : '7-Day Trend'}
          </button>
        ))}
      </div>

      {/* ── TODAY TAB ───────────────────────────────────────────────────────── */}
      {tab === 'today' && (
        <div className="space-y-4">

          {/* Highlights + Flags */}
          {report && (report.highlights.length > 0 || report.flags.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {report.highlights.length > 0 && (
                <div className="rounded-xl border border-green-500/20 bg-green-500/8 p-4 space-y-2">
                  <p className="text-xs font-semibold text-green-400 flex items-center gap-1.5">
                    <CheckCircle2 size={12} /> Highlights
                  </p>
                  <ul className="space-y-1.5">
                    {report.highlights.map((h, i) => (
                      <li key={i} className="text-xs text-zinc-300 leading-relaxed">• {h}</li>
                    ))}
                  </ul>
                </div>
              )}
              {report.flags.length > 0 && (
                <div className="rounded-xl border border-orange-500/20 bg-orange-500/8 p-4 space-y-2">
                  <p className="text-xs font-semibold text-orange-400 flex items-center gap-1.5">
                    <AlertTriangle size={12} /> Flags
                  </p>
                  <ul className="space-y-1.5">
                    {report.flags.map((f, i) => (
                      <li key={i} className="text-xs text-zinc-300 leading-relaxed">• {f}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Conversation cards */}
          {report && report.conversationScores.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                Conversation Scorecards
              </p>
              {report.conversationScores.map((score, i) => (
                <ConversationCard key={score.conversationId} score={score} index={i} />
              ))}
            </div>
          ) : !loading && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-8 text-center space-y-3">
              <Mic size={28} className="text-zinc-600 mx-auto" />
              <p className="text-sm text-zinc-500">
                {report
                  ? 'No conversations logged today.'
                  : 'Run your nightly review to see scorecards.'}
              </p>
              <p className="text-xs text-zinc-600">
                Say "SPARK, let's review" or tap <strong>Run Review</strong> above.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── WEEK TAB ────────────────────────────────────────────────────────── */}
      {tab === 'week' && (
        <div className="space-y-5">

          {/* Weekly SPARK Score trend chart */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <BarChart2 size={14} className="text-yellow-400" />
              <p className="text-sm font-semibold text-zinc-200">7-Day SPARK Score</p>
              {trend && trend.records.length >= 2 && (() => {
                const first = trend.records[0].sparkScore
                const last  = trend.records[trend.records.length - 1].sparkScore
                const delta = last - first
                if (delta > 0.2)  return <TrendingUp   size={14} className="text-green-400 ml-auto" />
                if (delta < -0.2) return <TrendingDown  size={14} className="text-red-400 ml-auto" />
                return <Minus size={14} className="text-zinc-500 ml-auto" />
              })()}
            </div>
            <WeeklyTrendChart records={trend?.records ?? []} />
          </div>

          {/* Narrative */}
          {trend && trend.narrative.length > 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-2">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Weekly Insights</p>
              <ul className="space-y-2">
                {trend.narrative.map((line, i) => (
                  <li key={i} className="text-sm text-zinc-300 leading-relaxed flex gap-2">
                    <span className="text-yellow-500 shrink-0 mt-0.5">›</span>
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Daily records table */}
          {trend && trend.records.length > 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="text-left px-4 py-2.5 text-zinc-500 font-semibold">Day</th>
                    <th className="text-center px-3 py-2.5 text-zinc-500 font-semibold">SPARK</th>
                    <th className="text-center px-3 py-2.5 text-zinc-500 font-semibold">Closing</th>
                    <th className="text-center px-3 py-2.5 text-zinc-500 font-semibold">Pricing</th>
                    <th className="text-center px-3 py-2.5 text-zinc-500 font-semibold">Fillers</th>
                  </tr>
                </thead>
                <tbody>
                  {[...trend.records].reverse().map(r => {
                    const dayName = new Date(r.date + 'T12:00:00').toLocaleDateString('en-US', {
                      weekday: 'short', month: 'short', day: 'numeric',
                    })
                    return (
                      <tr key={r.date} className="border-b border-zinc-800/50 hover:bg-zinc-800/20">
                        <td className="px-4 py-2.5 text-zinc-300">{dayName}</td>
                        <td className={clsx('px-3 py-2.5 text-center font-bold', scoreColor(r.sparkScore))}>
                          {r.sparkScore}
                        </td>
                        <td className={clsx('px-3 py-2.5 text-center font-semibold', scoreColor(r.closingScore))}>
                          {r.closingScore}
                        </td>
                        <td className={clsx('px-3 py-2.5 text-center font-semibold', scoreColor(r.pricingScore))}>
                          {r.pricingScore}
                        </td>
                        <td className={clsx(
                          'px-3 py-2.5 text-center',
                          r.totalFillers > 20 ? 'text-red-400' : r.totalFillers > 10 ? 'text-yellow-400' : 'text-green-400',
                        )}>
                          {r.totalFillers}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {trend && trend.records.length === 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-8 text-center">
              <p className="text-sm text-zinc-500">No weekly data yet — complete at least one nightly review.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default SparkCoachPanel
