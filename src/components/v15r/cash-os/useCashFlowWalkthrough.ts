import { useCallback, useEffect, useRef, useState } from 'react'

/** One dated stop for the pulse: a day that has canonical cash events. */
export interface WalkStop { id: string; frac: number; date: string }

export type WalkStep =
  | { at: number; kind: 'start' }
  | { at: number; kind: 'move'; frac: number; travelMs: number }
  | { at: number; kind: 'arrive'; id: string }
  | { at: number; kind: 'leave' }
  | { at: number; kind: 'finish' }

export const WALK_LEAD_MS = 450
export const WALK_TRAVEL_TOTAL_MS = 2400
export const WALK_TARGET_MS = 6200
export const WALK_MIN_LEG_MS = 40
export const WALK_MIN_DWELL_MS = 140
export const WALK_MAX_DWELL_MS = 900
export const WALK_FADE_MS = 350

/**
 * Range-aware pacing. 7d / 14d / 30d are the owner-approved feel and use factor 1 (identical to before).
 * Longer windows have more timeline to explain, so they travel and budget more time:
 *   60d: modestly slower (x1.25 travel, x1.25 target)   90d: substantially slower (x2.25 travel, x2 target)
 * Per-stop dwell is still capped/floored, so dense sets compress locally and sparse ones do not pause.
 */
export function walkthroughPacing(horizonDays: number): { travel: number; target: number } {
  if (horizonDays <= 30) return { travel: 1, target: 1 }
  if (horizonDays <= 60) return { travel: 1.25, target: 1.25 }
  return { travel: 2.25, target: 2 }
}

/**
 * Pure schedule for one walkthrough. Roughly 5–8s for a normal 7–30d event set; dwell per event shrinks as the
 * set grows (with a floor) instead of spending seconds on each one.
 */
export function planWalkthrough(stops: readonly WalkStop[], horizonDays = 30): { steps: WalkStep[]; totalMs: number } {
  const pace = walkthroughPacing(horizonDays)
  const travelTotal = WALK_TRAVEL_TOTAL_MS * pace.travel
  const target = WALK_TARGET_MS * pace.target
  const steps: WalkStep[] = [{ at: 0, kind: 'start' }]
  if (stops.length === 0) { steps.push({ at: 0, kind: 'finish' }); return { steps, totalMs: 0 } }
  const lastFrac = Math.max(stops[stops.length - 1].frac, 0.0001)
  const legs = stops.map((stop, i) => Math.max(WALK_MIN_LEG_MS, Math.round(travelTotal * (stop.frac - (i === 0 ? 0 : stops[i - 1].frac)) / lastFrac)))
  const travelSum = legs.reduce((a, b) => a + b, 0)
  const dwell = Math.min(WALK_MAX_DWELL_MS, Math.max(WALK_MIN_DWELL_MS, Math.round((target - WALK_LEAD_MS - travelSum - WALK_FADE_MS) / stops.length)))
  let t = WALK_LEAD_MS
  stops.forEach((stop, i) => {
    steps.push({ at: t, kind: 'move', frac: stop.frac, travelMs: legs[i] })
    t += legs[i]
    steps.push({ at: t, kind: 'arrive', id: stop.id })
    t += dwell
    steps.push({ at: t, kind: 'leave' })
  })
  steps.push({ at: t + WALK_FADE_MS, kind: 'finish' })
  return { steps, totalMs: t + WALK_FADE_MS }
}

export function prefersReducedMotion(): boolean {
  try { return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(query.matches)
    onChange()
    query.addEventListener?.('change', onChange)
    return () => query.removeEventListener?.('change', onChange)
  }, [])
  return reduced
}

const memoryGuard = new Set<string>()
function guardHas(key: string): boolean {
  try { return sessionStorage.getItem(key) === '1' } catch { return memoryGuard.has(key) }
}
function guardSet(key: string): void { try { sessionStorage.setItem(key, '1') } catch { memoryGuard.add(key) } }
function guardClear(key: string): void { try { sessionStorage.removeItem(key) } catch { memoryGuard.delete(key) } }

export type WalkPhase = 'idle' | 'running' | 'done'

export interface Walkthrough {
  phase: WalkPhase
  /** Pulse position as a 0..1 fraction of the plot, or null when not visible. */
  orbFrac: number | null
  travelMs: number
  /** Id of the stop the pulse is currently at (its marker is illuminated), if any. */
  activeId: string | null
  start: () => void
  cancel: () => void
}

/**
 * One-time cash-flow walkthrough. State changes only at stop boundaries (about two per event), and the
 * pulse's travel is a CSS transition, so nothing re-renders per frame.
 *
 * First-run rule: auto-starts at most once per browser session per `storageKey` (sessionStorage; no database).
 * The guard is only kept if the run began; an interrupted run (unmount mid-way) clears it so it can play again.
 * Reduced motion never auto-starts and `start()` is a no-op.
 */
export function useCashFlowWalkthrough({ stops, enabled, storageKey, autoStart = true, horizonDays = 30 }: {
  stops: readonly WalkStop[]
  enabled: boolean
  storageKey: string
  autoStart?: boolean
  /** Visible window; selects the pacing policy (see walkthroughPacing). */
  horizonDays?: number
}): Walkthrough {
  const [phase, setPhase] = useState<WalkPhase>('idle')
  const [orbFrac, setOrbFrac] = useState<number | null>(null)
  const [travelMs, setTravelMs] = useState(0)
  const [activeId, setActiveId] = useState<string | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const runningRef = useRef(false)
  const stopsRef = useRef(stops)
  stopsRef.current = stops
  const horizonRef = useRef(horizonDays)
  horizonRef.current = horizonDays

  const clearTimers = useCallback(() => { timers.current.forEach(clearTimeout); timers.current = [] }, [])
  const reset = useCallback((next: WalkPhase) => {
    clearTimers(); runningRef.current = false
    setPhase(next); setOrbFrac(null); setActiveId(null); setTravelMs(0)
  }, [clearTimers])

  const start = useCallback(() => {
    if (!enabled || prefersReducedMotion() || stopsRef.current.length === 0) return
    clearTimers()
    runningRef.current = true
    guardSet(storageKey)
    const { steps } = planWalkthrough(stopsRef.current, horizonRef.current)
    for (const step of steps) {
      timers.current.push(setTimeout(() => {
        switch (step.kind) {
          case 'start': setPhase('running'); setOrbFrac(0); setTravelMs(0); setActiveId(null); break
          case 'move': setTravelMs(step.travelMs); setOrbFrac(step.frac); break
          case 'arrive': setActiveId(step.id); break
          case 'leave': setActiveId(null); break
          case 'finish': runningRef.current = false; timers.current = []; setPhase('done'); setOrbFrac(null); setActiveId(null); setTravelMs(0); break
        }
      }, step.at))
    }
  }, [enabled, storageKey, clearTimers])

  /** Owner interaction: stop immediately and keep the finished (static) timeline. */
  const cancel = useCallback(() => { if (runningRef.current) reset('done') }, [reset])

  useEffect(() => {
    if (!autoStart || !enabled || prefersReducedMotion() || stopsRef.current.length === 0 || guardHas(storageKey)) return
    start()
    return () => {
      // Real unmount (or Strict Mode's simulated one) mid-run: stop timers and allow it to play again later.
      if (runningRef.current) { clearTimers(); runningRef.current = false; guardClear(storageKey) }
    }
    // Auto-start is a mount-time decision; later stop/prop changes must not replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => clearTimers(), [clearTimers])

  return { phase, orbFrac, travelMs, activeId, start, cancel }
}
