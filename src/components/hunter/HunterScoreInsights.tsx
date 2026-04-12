// @ts-nocheck
/**
 * HunterScoreInsights — Scoring weight learning dashboard card — HT11
 *
 * Renders a compact insights card inside the HUNTER panel showing:
 *   - Horizontal stacked bar chart of current factor weight distribution
 *   - Confidence level badge (Low / Medium / High) based on debrief count
 *   - Last adjustment date and sample size
 *   - Top performing factor (highlighted green)
 *   - Weakest factor (highlighted amber)
 *   - Expandable "View Weight History" section listing all past adjustments
 *
 * Consumes:
 *   HunterScoreLearning.ts — getCurrentWeights(), getWeightHistory()
 */

import React, { useState, useEffect } from 'react'
import { ChevronDown, ChevronUp, TrendingUp, TrendingDown, Brain } from 'lucide-react'
import {
  getCurrentWeights,
  getWeightHistory,
  type WeightedResult,
  type WeightHistoryEntry,
  type CorrelationMap,
} from '@/services/hunter/HunterScoreLearning'

// ─── Factor Display Config ──────────────────────────────────────────────────────

const FACTOR_CONFIG = {
  estimatedJobValue:  { label: 'Job Value',       color: '#3b82f6' },  // blue-500
  profitMargin:       { label: 'Margin',           color: '#10b981' },  // emerald-500
  closeProbability:   { label: 'Close Prob.',      color: '#8b5cf6' },  // violet-500
  leadFreshness:      { label: 'Freshness',        color: '#06b6d4' },  // cyan-500
  contactQuality:     { label: 'Contact Quality',  color: '#f59e0b' },  // amber-500
  jobTypeMatch:       { label: 'Job Type Match',   color: '#f97316' },  // orange-500
  distanceEfficiency: { label: 'Distance',         color: '#f43f5e' },  // rose-500
  competitorGap:      { label: 'Competitor Gap',   color: '#a855f7' },  // purple-500
}

const FACTOR_KEYS = Object.keys(FACTOR_CONFIG)

// ─── Helpers ───────────────────────────────────────────────────────────────────

function confidenceBadgeStyle(confidence) {
  switch (confidence) {
    case 'high':   return 'bg-emerald-900 text-emerald-300 border-emerald-700'
    case 'medium': return 'bg-yellow-900 text-yellow-300 border-yellow-700'
    default:       return 'bg-amber-900 text-amber-300 border-amber-700'
  }
}

function formatDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

function formatFactorLabel(key) {
  return FACTOR_CONFIG[key]?.label ?? key
}

function formatFactorColor(key) {
  return FACTOR_CONFIG[key]?.color ?? '#6b7280'
}

function formatDelta(oldVal, newVal) {
  const delta = newVal - oldVal
  if (delta > 0)  return <span className="text-emerald-400">+{delta}</span>
  if (delta < 0)  return <span className="text-rose-400">{delta}</span>
  return <span className="text-gray-500">0</span>
}

// ─── Weight Distribution Bar ───────────────────────────────────────────────────

function WeightDistributionBar({ weights, topFactor, weakestFactor }) {
  const [hoveredFactor, setHoveredFactor] = useState(null)

  return (
    <div>
      {/* Stacked horizontal bar */}
      <div className="flex h-5 rounded overflow-hidden w-full">
        {FACTOR_KEYS.map((key) => {
          const weight = weights[key] ?? 0
          const isTop     = key === topFactor
          const isWeakest = key === weakestFactor
          return (
            <div
              key={key}
              className="relative transition-all duration-300 cursor-pointer"
              style={{
                width:      `${weight}%`,
                background: formatFactorColor(key),
                opacity:    hoveredFactor && hoveredFactor !== key ? 0.45 : 1,
                outline:    isTop     ? '2px solid #10b981' :
                            isWeakest ? '2px solid #f59e0b' : 'none',
              }}
              onMouseEnter={() => setHoveredFactor(key)}
              onMouseLeave={() => setHoveredFactor(null)}
              title={`${formatFactorLabel(key)}: ${weight}%`}
            />
          )
        })}
      </div>

      {/* Legend row */}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {FACTOR_KEYS.map((key) => {
          const weight    = weights[key] ?? 0
          const isTop     = key === topFactor
          const isWeakest = key === weakestFactor
          return (
            <div
              key={key}
              className="flex items-center gap-1 text-xs"
              onMouseEnter={() => setHoveredFactor(key)}
              onMouseLeave={() => setHoveredFactor(null)}
            >
              <span
                className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: formatFactorColor(key) }}
              />
              <span
                className={
                  isTop     ? 'text-emerald-400 font-semibold' :
                  isWeakest ? 'text-amber-400 font-semibold'   :
                              'text-gray-400'
                }
              >
                {formatFactorLabel(key)}&nbsp;
                <span className="text-gray-500">{weight}%</span>
                {isTop     && <span className="ml-1 text-emerald-400">↑</span>}
                {isWeakest && <span className="ml-1 text-amber-400">↓</span>}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── History Entry Row ─────────────────────────────────────────────────────────

function HistoryEntryRow({ entry, index }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border border-gray-700 rounded overflow-hidden">
      {/* Summary row */}
      <button
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-800 hover:bg-gray-750 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium text-gray-300">
            #{index + 1}
          </span>
          <span className="text-xs text-gray-400 truncate">
            {formatDate(entry.adjustedAt)}
          </span>
          <span className="text-xs text-gray-500">
            {entry.sampleSize} debriefs
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          <span className="text-xs text-emerald-400 font-medium">
            ↑ {formatFactorLabel(entry.topFactor)}
          </span>
          <span className="text-xs text-amber-400">
            ↓ {formatFactorLabel(entry.weakestFactor)}
          </span>
          {expanded
            ? <ChevronUp size={12} className="text-gray-400" />
            : <ChevronDown size={12} className="text-gray-400" />
          }
        </div>
      </button>

      {/* Expanded weight diff table */}
      {expanded && (
        <div className="p-3 bg-gray-900 space-y-1">
          <div className="text-xs text-gray-500 mb-2 font-medium">Factor weight changes:</div>
          <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-xs">
            <span className="text-gray-500">Factor</span>
            <span className="text-gray-500 text-right">Old</span>
            <span className="text-gray-500 text-right">New</span>

            {FACTOR_KEYS.map((key) => {
              const oldVal = entry.oldWeights?.[key] ?? 0
              const newVal = entry.newWeights?.[key] ?? 0
              const isTop     = key === entry.topFactor
              const isWeakest = key === entry.weakestFactor
              return (
                <React.Fragment key={key}>
                  <span
                    className={
                      isTop     ? 'text-emerald-400 font-medium' :
                      isWeakest ? 'text-amber-400 font-medium'   :
                                  'text-gray-400'
                    }
                  >
                    {formatFactorLabel(key)}
                  </span>
                  <span className="text-gray-400 text-right">{oldVal}%</span>
                  <span className="text-right">
                    {formatDelta(oldVal, newVal)}&nbsp;
                    <span className="text-gray-400">({newVal}%)</span>
                  </span>
                </React.Fragment>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export interface HunterScoreInsightsProps {
  /** Optional CSS class override */
  className?: string
}

export function HunterScoreInsights({ className = '' }) {
  const [result, setResult]         = useState(null)
  const [history, setHistory]       = useState([])
  const [showHistory, setShowHistory] = useState(false)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)

  // Load weights + history on mount
  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const [weightResult, weightHistory] = await Promise.all([
          getCurrentWeights(),
          Promise.resolve(getWeightHistory()),
        ])
        if (!cancelled) {
          setResult(weightResult)
          setHistory(weightHistory)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError('Could not load weight data')
          console.warn('[HunterScoreInsights] Load error:', err)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  // ── Loading State ──
  if (loading) {
    return (
      <div className={`bg-gray-900 border border-gray-700 rounded p-4 ${className}`}>
        <div className="flex items-center gap-2 text-gray-400 text-sm animate-pulse">
          <Brain size={16} />
          <span>Loading scoring intelligence…</span>
        </div>
      </div>
    )
  }

  // ── Error State ──
  if (error || !result) {
    return (
      <div className={`bg-gray-900 border border-gray-700 rounded p-4 ${className}`}>
        <div className="text-xs text-gray-500 flex items-center gap-2">
          <Brain size={14} className="opacity-50" />
          <span>Scoring insights unavailable — no debrief data yet</span>
        </div>
      </div>
    )
  }

  const { weights, confidence, confidenceLabel, sampleSize } = result
  const latestEntry = history[0] ?? null

  // Determine top/weakest factor from history, falling back to highest/lowest weight
  const topFactor = latestEntry?.topFactor
    ?? FACTOR_KEYS.reduce((a, b) => (weights[a] ?? 0) >= (weights[b] ?? 0) ? a : b)

  const weakestFactor = latestEntry?.weakestFactor
    ?? FACTOR_KEYS.reduce((a, b) => (weights[a] ?? 0) <= (weights[b] ?? 0) ? a : b)

  return (
    <div className={`bg-gray-900 border border-gray-700 rounded overflow-hidden ${className}`}>
      {/* Header */}
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain size={16} className="text-violet-400" />
          <span className="text-sm font-semibold text-white">Score Learning</span>
        </div>
        {/* Confidence badge */}
        <span
          className={`text-xs px-2 py-0.5 rounded border font-medium ${confidenceBadgeStyle(confidence)}`}
        >
          {confidence === 'high'   ? '⬤ High'   :
           confidence === 'medium' ? '◐ Medium' :
                                     '○ Low'}
        </span>
      </div>

      {/* Confidence label */}
      <div className="px-4 pb-2">
        <p className="text-xs text-gray-400">{confidenceLabel}</p>
      </div>

      {/* Weight distribution bar */}
      <div className="px-4 pb-3">
        <div className="text-xs text-gray-500 mb-1.5 font-medium">Factor Weight Distribution</div>
        <WeightDistributionBar
          weights={weights}
          topFactor={topFactor}
          weakestFactor={weakestFactor}
        />
      </div>

      {/* Top / Weakest callout row */}
      <div className="px-4 pb-3 grid grid-cols-2 gap-2">
        {/* Top factor */}
        <div className="bg-gray-800 border border-emerald-800 rounded p-2">
          <div className="flex items-center gap-1 mb-0.5">
            <TrendingUp size={12} className="text-emerald-400" />
            <span className="text-xs text-emerald-400 font-medium">Top Factor</span>
          </div>
          <div className="text-sm font-semibold text-white">
            {formatFactorLabel(topFactor)}
          </div>
          <div className="text-xs text-gray-400">{weights[topFactor] ?? 0}% weight</div>
        </div>

        {/* Weakest factor */}
        <div className="bg-gray-800 border border-amber-800 rounded p-2">
          <div className="flex items-center gap-1 mb-0.5">
            <TrendingDown size={12} className="text-amber-400" />
            <span className="text-xs text-amber-400 font-medium">Weakest Factor</span>
          </div>
          <div className="text-sm font-semibold text-white">
            {formatFactorLabel(weakestFactor)}
          </div>
          <div className="text-xs text-gray-400">{weights[weakestFactor] ?? 0}% weight</div>
        </div>
      </div>

      {/* Last adjustment info */}
      {latestEntry ? (
        <div className="px-4 pb-3">
          <div className="text-xs text-gray-500">
            Last adjusted: <span className="text-gray-300">{formatDate(latestEntry.adjustedAt)}</span>
            {' · '}
            <span className="text-gray-300">{latestEntry.sampleSize} debriefs</span>
          </div>
        </div>
      ) : (
        <div className="px-4 pb-3">
          <div className="text-xs text-gray-600 italic">
            No adjustments yet — weights will calibrate after {10 - (sampleSize % 10 || 10)} more debriefs
          </div>
        </div>
      )}

      {/* View Weight History toggle */}
      <div className="border-t border-gray-800">
        <button
          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-800 transition-colors text-left"
          onClick={() => setShowHistory(!showHistory)}
        >
          <span className="text-xs font-medium text-gray-300">
            Weight History
            {history.length > 0 && (
              <span className="ml-1 text-gray-500">({history.length} adjustments)</span>
            )}
          </span>
          {showHistory
            ? <ChevronUp size={14} className="text-gray-400" />
            : <ChevronDown size={14} className="text-gray-400" />
          }
        </button>

        {showHistory && (
          <div className="px-4 pb-4 space-y-2 max-h-72 overflow-y-auto">
            {history.length === 0 ? (
              <div className="text-xs text-gray-500 text-center py-4 italic">
                No weight adjustments yet.
                <br />
                Weights calibrate automatically every 10 debriefs.
              </div>
            ) : (
              history.map((entry, idx) => (
                <HistoryEntryRow key={entry.id} entry={entry} index={idx} />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default HunterScoreInsights
