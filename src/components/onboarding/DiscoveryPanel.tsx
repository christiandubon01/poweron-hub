/**
 * DiscoveryPanel.tsx
 * V4-OB2 — Platform mastery panel showing all benchmarks and feature unlocks.
 *
 * Shows:
 *   - Visual progress bar per benchmark
 *   - Locked features with blur + teaser
 *   - "How to unlock" hint per locked feature
 *   - Overall platform mastery percentage
 *
 * Matches PowerOn dark theme.  Self-contained — fetches its own data.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Lock, Unlock, ChevronRight, Zap, BarChart2, Clock,
  Mic, TrendingUp, Target, Sparkles, RefreshCw,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import {
  getBenchmarkProgress,
  getNextBenchmarkHint,
  BENCHMARK_DEFINITIONS,
  FEATURE_DEFINITIONS,
  type BenchmarkProgress,
  type FeatureId,
} from '@/services/onboarding/ProgressiveDiscovery'

// ── Icon map for features ──────────────────────────────────────────────────────

const FEATURE_ICONS: Record<FeatureId, React.ElementType> = {
  charts_panel:           BarChart2,
  ar_aging_view:          Clock,
  profitability_trends:   TrendingUp,
  voice_sessions:         Mic,
  advanced_analytics:     Target,
  scout_recommendations:  Sparkles,
}

// ── Helper: compute mastery % ─────────────────────────────────────────────────

function computeMastery(progress: BenchmarkProgress[]): number {
  if (progress.length === 0) return 0
  const reached = progress.filter((p) => p.reached).length
  return Math.round((reached / progress.length) * 100)
}

// ── Helper: clamp progress bar width ─────────────────────────────────────────

function progressPercent(current: number, threshold: number): number {
  return Math.min(100, Math.round((current / Math.max(1, threshold)) * 100))
}

// ── Sub-components ─────────────────────────────────────────────────────────────

interface BenchmarkRowProps {
  prog: BenchmarkProgress
  unlockedFeatureIds: Set<FeatureId>
}

function BenchmarkRow({ prog, unlockedFeatureIds }: BenchmarkRowProps) {
  const { benchmark, currentValue, reached } = prog
  const pct = progressPercent(currentValue, benchmark.threshold)

  return (
    <div
      className={[
        'rounded-xl border p-4 transition-colors',
        reached
          ? 'border-emerald-500/30 bg-emerald-500/5'
          : 'border-white/10 bg-white/[0.03]',
      ].join(' ')}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            {reached ? (
              <Unlock className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            ) : (
              <Lock className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
            )}
            <span
              className={[
                'text-sm font-semibold leading-snug',
                reached ? 'text-white' : 'text-zinc-300',
              ].join(' ')}
            >
              {benchmark.label}
            </span>
          </div>
          <p className="text-xs text-zinc-500 leading-snug pl-5">
            {benchmark.description}
          </p>
        </div>

        {/* Status badge */}
        <span
          className={[
            'shrink-0 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full',
            reached
              ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30'
              : 'bg-zinc-800 text-zinc-500',
          ].join(' ')}
        >
          {reached ? 'Reached' : `${currentValue} / ${benchmark.threshold}`}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="flex justify-between text-[10px] text-zinc-500 mb-1">
          <span>Progress</span>
          <span>{pct}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
          <div
            className={[
              'h-full rounded-full transition-all duration-700',
              reached ? 'bg-emerald-500' : 'bg-zinc-600',
            ].join(' ')}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Unlocked features */}
      <div className="flex flex-wrap gap-2">
        {benchmark.unlocks.map((featureId) => {
          const featureDef = FEATURE_DEFINITIONS.find((f) => f.id === featureId)
          const Icon = FEATURE_ICONS[featureId] ?? Zap
          const isUnlocked = unlockedFeatureIds.has(featureId)

          return (
            <div
              key={featureId}
              className={[
                'flex items-center gap-1.5 rounded-lg px-2.5 py-1',
                'text-xs font-medium',
                isUnlocked
                  ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20'
                  : 'bg-zinc-800/60 text-zinc-500 ring-1 ring-white/5',
              ].join(' ')}
            >
              <Icon className="h-3 w-3 shrink-0" />
              {featureDef?.label ?? featureId}
              {benchmark.tierGated && (
                <span className="text-[9px] text-amber-500 ml-0.5">(tier)</span>
              )}
            </div>
          )
        })}
      </div>

      {/* "How to unlock" hint when not yet reached */}
      {!reached && (
        <div className="mt-3 flex items-start gap-1.5 rounded-lg bg-zinc-900/60 px-3 py-2">
          <ChevronRight className="h-3.5 w-3.5 text-zinc-500 mt-0.5 shrink-0" />
          <p className="text-xs text-zinc-400 leading-snug">{benchmark.hint}</p>
        </div>
      )}
    </div>
  )
}

// ── Locked feature preview ─────────────────────────────────────────────────────

interface LockedFeatureCardProps {
  featureId: FeatureId
}

function LockedFeatureCard({ featureId }: LockedFeatureCardProps) {
  const featureDef = FEATURE_DEFINITIONS.find((f) => f.id === featureId)
  const Icon = FEATURE_ICONS[featureId] ?? Lock

  if (!featureDef) return null

  return (
    <div className="relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.02] p-4">
      {/* Blurred teaser content */}
      <div className="select-none blur-[3px] pointer-events-none">
        <div className="flex items-center gap-2 mb-2">
          <Icon className="h-4 w-4 text-zinc-400" />
          <span className="text-sm font-semibold text-zinc-300">{featureDef.label}</span>
        </div>
        <p className="text-xs text-zinc-500 leading-snug">{featureDef.description}</p>
        {/* Fake chart bars as visual teaser */}
        <div className="mt-3 flex items-end gap-1 h-10">
          {[40, 65, 50, 80, 55, 70, 45].map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-sm bg-zinc-700"
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
      </div>

      {/* Lock overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0f1117]/70 backdrop-blur-[1px] rounded-xl">
        <Lock className="h-5 w-5 text-zinc-500 mb-1.5" />
        <p className="text-xs font-medium text-zinc-400 text-center px-4 leading-snug">
          {featureDef.teaser}
        </p>
      </div>
    </div>
  )
}

// ── Main panel ─────────────────────────────────────────────────────────────────

export function DiscoveryPanel() {
  const { user } = useAuth()

  const [progress, setProgress]               = useState<BenchmarkProgress[]>([])
  const [nextHint, setNextHint]               = useState<string>('')
  const [loading, setLoading]                 = useState(true)
  const [refreshing, setRefreshing]           = useState(false)

  // Derive unlocked feature ids from progress
  const unlockedFeatureIds = new Set<FeatureId>(
    progress
      .filter((p) => p.reached)
      .flatMap((p) => p.benchmark.unlocks)
  )

  const lockedFeatureIds: FeatureId[] = FEATURE_DEFINITIONS
    .map((f) => f.id)
    .filter((id) => !unlockedFeatureIds.has(id))

  const mastery = computeMastery(progress)

  // ── Data fetch ───────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    if (!user?.id) return

    try {
      const [prog, hint] = await Promise.all([
        getBenchmarkProgress(user.id),
        getNextBenchmarkHint(user.id),
      ])
      setProgress(prog)
      setNextHint(hint)
    } catch {
      // Non-fatal — keep previous state
    }
  }, [user?.id])

  useEffect(() => {
    setLoading(true)
    fetchData().finally(() => setLoading(false))
  }, [fetchData])

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchData()
    setRefreshing(false)
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6 max-w-2xl mx-auto w-full">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Zap className="h-5 w-5 text-emerald-400" />
            <h2 className="text-lg font-bold text-white">Platform Mastery</h2>
          </div>
          <p className="text-sm text-zinc-400 leading-snug">
            Unlock features by using PowerOn Hub — no tutorials, just discovery.
          </p>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={loading || refreshing}
          aria-label="Refresh progress"
          className={[
            'flex items-center gap-1.5 rounded-lg px-3 py-1.5',
            'text-xs font-medium text-zinc-400 hover:text-white',
            'border border-white/10 hover:border-white/20',
            'bg-white/[0.03] hover:bg-white/[0.06]',
            'transition-colors',
            'focus:outline-none focus-visible:ring-1 focus-visible:ring-white/20',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          ].join(' ')}
        >
          <RefreshCw
            className={['h-3 w-3', refreshing ? 'animate-spin' : ''].join(' ')}
          />
          Refresh
        </button>
      </div>

      {/* ── Mastery gauge ── */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <div className="flex items-end justify-between mb-3">
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-0.5">
              Overall mastery
            </p>
            <p className="text-4xl font-bold text-white">{mastery}%</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-zinc-500 mb-0.5">Features unlocked</p>
            <p className="text-lg font-semibold text-emerald-400">
              {unlockedFeatureIds.size}
              <span className="text-sm font-normal text-zinc-500">
                /{FEATURE_DEFINITIONS.length}
              </span>
            </p>
          </div>
        </div>

        {/* Mastery bar */}
        <div className="h-2 w-full rounded-full bg-white/5 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-700"
            style={{ width: `${mastery}%` }}
          />
        </div>

        {/* AI hint */}
        {nextHint && !loading && (
          <p className="mt-3 text-xs text-zinc-400 leading-relaxed">{nextHint}</p>
        )}
      </div>

      {/* ── Loading skeleton ── */}
      {loading && (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-28 rounded-xl border border-white/10 bg-white/[0.03] animate-pulse"
            />
          ))}
        </div>
      )}

      {/* ── Benchmark list ── */}
      {!loading && progress.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Benchmarks
          </p>
          {progress.map((prog) => (
            <BenchmarkRow
              key={prog.benchmark.id}
              prog={prog}
              unlockedFeatureIds={unlockedFeatureIds}
            />
          ))}
        </div>
      )}

      {/* ── Locked features teaser ── */}
      {!loading && lockedFeatureIds.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
            Coming soon — keep building
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {lockedFeatureIds.map((id) => (
              <LockedFeatureCard key={id} featureId={id} />
            ))}
          </div>
        </div>
      )}

      {/* ── All unlocked state ── */}
      {!loading && mastery === 100 && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5 text-center">
          <Sparkles className="h-6 w-6 text-emerald-400 mx-auto mb-2" />
          <p className="text-sm font-semibold text-white mb-1">
            Full Mastery Achieved
          </p>
          <p className="text-xs text-zinc-400">
            You've unlocked every feature in PowerOn Hub. Ask SCOUT what to tackle next.
          </p>
        </div>
      )}
    </div>
  )
}
