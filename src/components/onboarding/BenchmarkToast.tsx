/**
 * BenchmarkToast.tsx
 * V4-OB2 — Celebratory toast notification when a usage benchmark is reached.
 *
 * Shows "You just unlocked [Feature]!" with a brief description.
 * Matches PowerOn dark theme with a green accent pulse animation.
 * Auto-dismisses after 5 seconds; click to explore the new feature.
 */

import { useEffect, useCallback, useState } from 'react'
import { Zap, X, ChevronRight, Sparkles } from 'lucide-react'
import type { UnlockedFeature } from '@/services/onboarding/ProgressiveDiscovery'
import { getFeatureDef } from '@/services/onboarding/ProgressiveDiscovery'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface BenchmarkToastProps {
  /** The unlock event that triggered this toast. */
  unlock: UnlockedFeature
  /** Optional callback when the user clicks "Explore". */
  onExplore?: (featureId: string) => void
  /** Optional callback when the toast is dismissed (auto or manual). */
  onDismiss?: () => void
  /** How long to show the toast before auto-dismissing (ms). Default: 5000. */
  durationMs?: number
}

// ── Animation classes (Tailwind) ───────────────────────────────────────────────
// We animate in from the bottom-right and slide out on dismiss.

const ANIMATION_IN  = 'translate-y-0 opacity-100'
const ANIMATION_OUT = 'translate-y-4 opacity-0'

// ── Component ──────────────────────────────────────────────────────────────────

export function BenchmarkToast({
  unlock,
  onExplore,
  onDismiss,
  durationMs = 5000,
}: BenchmarkToastProps) {
  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  // Resolve feature metadata — fall back gracefully if unknown id
  let featureLabel: string = unlock.featureId
  let featureDescription = ''
  try {
    const def = getFeatureDef(unlock.featureId)
    featureLabel = def.label
    featureDescription = def.description
  } catch {
    // Defensive — getFeatureDef throws on unknown ids; keep raw id
  }

  // ── Dismiss handler ────────────────────────────────────────────────────────

  const dismiss = useCallback(() => {
    setVisible(false)
    // Let the exit animation play before calling parent
    setTimeout(() => {
      setDismissed(true)
      onDismiss?.()
    }, 300)
  }, [onDismiss])

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  // Animate in on mount
  useEffect(() => {
    const enter = requestAnimationFrame(() => {
      requestAnimationFrame(() => setVisible(true))
    })
    return () => cancelAnimationFrame(enter)
  }, [])

  // Auto-dismiss after duration
  useEffect(() => {
    const timer = setTimeout(dismiss, durationMs)
    return () => clearTimeout(timer)
  }, [dismiss, durationMs])

  if (dismissed) return null

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Feature unlocked: ${featureLabel}`}
      className={[
        // Positioning & layout
        'fixed bottom-6 right-6 z-[9999]',
        'flex items-start gap-3',
        'w-[340px] max-w-[calc(100vw-2rem)]',
        // Surface
        'rounded-xl border border-emerald-500/40',
        'bg-[#0f1117] shadow-2xl',
        'p-4',
        // Transition
        'transition-all duration-300 ease-out',
        visible ? ANIMATION_IN : ANIMATION_OUT,
      ].join(' ')}
    >
      {/* ── Green pulse icon ── */}
      <div className="relative mt-0.5 shrink-0">
        <div className="absolute inset-0 animate-ping rounded-full bg-emerald-500 opacity-30" />
        <div className="relative flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/20 ring-1 ring-emerald-500/50">
          <Sparkles className="h-4 w-4 text-emerald-400" />
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 min-w-0">
        {/* Header row */}
        <div className="flex items-center gap-1.5 mb-0.5">
          <Zap className="h-3 w-3 text-emerald-400 shrink-0" />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400">
            Feature Unlocked
          </span>
        </div>

        {/* Feature name */}
        <p className="text-sm font-semibold text-white leading-snug truncate">
          {featureLabel}
        </p>

        {/* Description */}
        {featureDescription && (
          <p className="mt-0.5 text-xs text-zinc-400 leading-snug line-clamp-2">
            {featureDescription}
          </p>
        )}

        {/* Explore button */}
        {onExplore && (
          <button
            type="button"
            onClick={() => {
              onExplore(unlock.featureId)
              dismiss()
            }}
            className={[
              'mt-2 inline-flex items-center gap-1',
              'text-xs font-medium text-emerald-400',
              'hover:text-emerald-300 transition-colors',
              'focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400 rounded',
            ].join(' ')}
          >
            Explore now
            <ChevronRight className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* ── Dismiss button ── */}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss notification"
        className={[
          'shrink-0 mt-0.5',
          'flex h-6 w-6 items-center justify-center rounded-md',
          'text-zinc-500 hover:text-zinc-300',
          'hover:bg-white/5 transition-colors',
          'focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500',
        ].join(' ')}
      >
        <X className="h-3.5 w-3.5" />
      </button>

      {/* ── Progress bar (countdown) ── */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden rounded-b-xl">
        <div
          className="h-full bg-emerald-500 origin-left"
          style={{
            animation: `poweron-toast-shrink ${durationMs}ms linear forwards`,
          }}
        />
      </div>

      {/* Keyframe style injected inline to avoid needing a global CSS file */}
      <style>{`
        @keyframes poweron-toast-shrink {
          from { transform: scaleX(1); }
          to   { transform: scaleX(0); }
        }
      `}</style>
    </div>
  )
}

// ── Multi-toast container ──────────────────────────────────────────────────────

export interface BenchmarkToastManagerProps {
  /** List of unlocks to render as toasts (most recent first). */
  unlocks: UnlockedFeature[]
  onExplore?: (featureId: string) => void
  onDismiss?: (featureId: string) => void
  durationMs?: number
}

/**
 * Renders up to 3 stacked BenchmarkToast notifications at once.
 * Pass the full list of newly unlocked features; the manager handles
 * stacking offsets and individual dismissal.
 */
export function BenchmarkToastManager({
  unlocks,
  onExplore,
  onDismiss,
  durationMs = 5000,
}: BenchmarkToastManagerProps) {
  const visible = unlocks.slice(0, 3)

  if (visible.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-[9999] flex flex-col-reverse gap-3 pointer-events-auto">
      {visible.map((unlock, index) => (
        <BenchmarkToast
          key={`${unlock.featureId}-${unlock.unlockedAt}`}
          unlock={unlock}
          onExplore={onExplore}
          onDismiss={() => onDismiss?.(unlock.featureId)}
          // Stagger the auto-dismiss so toasts don't all vanish at once
          durationMs={durationMs + index * 1500}
        />
      ))}
    </div>
  )
}
