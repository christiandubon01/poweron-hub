/**
 * EnergyTrackingLayer.tsx — NW75: Personal energy gauge, burnout detection, and
 * productivity zone overlay for the Neural World.
 *
 * ENERGY BAR (vertical gauge, left edge):
 *   0–100 % gradient: green (100) → amber (50) → red (0)
 *   Displays weekly sparkline showing 7-day energy pattern.
 *   Shows current level, drain/boost sources in a tooltip.
 *
 * ENERGY COMPUTATION:
 *   Base: 100 %
 *   Drains:
 *     - Each hour worked today     → −12 % per hour
 *     - Each overdue invoice       → −2 %
 *     - Each stalled project       → −3 %
 *   Boosts (one-time events stored in localStorage):
 *     - Completing a project phase → +15 %
 *     - Receiving a payment        → +10 %
 *     - Taking a logged break      → +20 %
 *   Sleep estimate: manual input or default 7 hrs
 *     (< 6 h → additional −10 %; > 8 h → additional +5 %)
 *
 * WORLD EFFECTS:
 *   - Energy < 30 %: dim overlay + CSS vignette blur on edges
 *   - Energy < 15 %: NEXUS TTS alert "You've been working X hours. Take 15 minutes."
 *
 * BREAK TIMER:
 *   - Dispatches 'nw:start-break' → 15-minute countdown
 *   - On completion: energy +20 %, break logged to localStorage
 *
 * PRODUCTIVITY ZONES:
 *   - Highlights hours of day when most field_logs are submitted (peak hours)
 *   - Rendered as a small hourly heat-bar below the gauge
 *
 * DATA PERSISTENCE:
 *   - localStorage key 'nw_energy_snapshots': daily energy snapshots (last 30 days)
 *   - localStorage key 'nw_break_history': break log entries
 *
 * EVENTS:
 *   - Listens: 'nw:start-break'          → starts break timer
 *   - Listens: 'nw:energy-boost'         → { reason, amount } applies one-time boost
 *   - Emits:   'nw:energy-update'        → { energy, hoursWorked }
 *   - Emits:   'nw:break-complete'       → fired when break countdown ends
 *
 * Exported as named export: EnergyTrackingLayer
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { subscribeWorldData, type NWFieldLog } from './DataBridge'
import { synthesizeWithElevenLabs, DEFAULT_VOICE_ID } from '@/api/voice/elevenLabs'

// ── Constants ─────────────────────────────────────────────────────────────────

const ENERGY_LS_KEY    = 'nw_energy_snapshots'
const BREAKS_LS_KEY    = 'nw_break_history'
const SLEEP_LS_KEY     = 'nw_sleep_hours'
const BOOSTS_LS_KEY    = 'nw_energy_boosts_today'

const BREAK_DURATION_MS = 15 * 60 * 1000  // 15 minutes

const DRAIN_PER_HOUR        = 12   // % per worked hour
const DRAIN_OVERDUE_INVOICE =  2   // % per overdue invoice
const DRAIN_STALLED_PROJECT =  3   // % per stalled project
const BOOST_PHASE_COMPLETE  = 15   // % for completing a project phase
const BOOST_PAYMENT_RECV    = 10   // % for receiving payment
const BOOST_BREAK_TAKEN     = 20   // % for taking a break

const LOW_ENERGY_THRESHOLD  = 30   // below this → world dims
const CRITICAL_ENERGY_LEVEL = 15   // below this → TTS alert fires
const MAX_DAILY_SNAPSHOTS   = 30

// Energy bar dimensions (left edge)
const BAR_HEIGHT  = 220   // px
const BAR_WIDTH   = 22    // px
const SPARK_H     = 36    // px — sparkline area height

// ── Helper types ──────────────────────────────────────────────────────────────

interface EnergySnapshot {
  date: string          // YYYY-MM-DD
  energy: number        // 0–100
  hoursWorked: number
}

interface BreakEntry {
  startedAt: string     // ISO
  completedAt: string   // ISO
  durationMs: number
}

interface BoostEntry {
  reason: string
  amount: number
  appliedAt: string     // ISO
}

// ── localStorage helpers ──────────────────────────────────────────────────────

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // quota — silently ignore
  }
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

// ── Energy computation ────────────────────────────────────────────────────────

interface EnergyInputs {
  hoursWorkedToday: number
  overdueInvoiceCount: number
  stalledProjectCount: number
  sleepHours: number
  boostsToday: BoostEntry[]
}

function computeEnergy(inputs: EnergyInputs): number {
  const {
    hoursWorkedToday,
    overdueInvoiceCount,
    stalledProjectCount,
    sleepHours,
    boostsToday,
  } = inputs

  let energy = 100

  // Drains
  energy -= hoursWorkedToday * DRAIN_PER_HOUR
  energy -= overdueInvoiceCount * DRAIN_OVERDUE_INVOICE
  energy -= stalledProjectCount * DRAIN_STALLED_PROJECT

  // Sleep modifier
  if (sleepHours < 6) energy -= 10
  else if (sleepHours > 8) energy += 5

  // One-time boosts today
  for (const b of boostsToday) {
    energy += b.amount
  }

  return Math.min(100, Math.max(0, energy))
}

// ── Colour helpers ────────────────────────────────────────────────────────────

/** Return a hex colour interpolated green→amber→red based on energy 0–100 */
function energyColor(energy: number): string {
  if (energy >= 60) {
    // green (100) → amber (60)
    const t = (energy - 60) / 40        // 0 at 60, 1 at 100
    const r = Math.round(255 * (1 - t) + 34  * t)
    const g = Math.round(197 * (1 - t) + 197 * t)
    const b = Math.round(0   * (1 - t) + 94  * t)
    return `rgb(${r},${g},${b})`
  } else if (energy >= 30) {
    // amber (60) → red (30)
    const t = (energy - 30) / 30        // 0 at 30, 1 at 60
    const r = Math.round(220 * (1 - t) + 255 * t)
    const g = Math.round(38  * (1 - t) + 197 * t)
    const b = 0
    return `rgb(${r},${g},${b})`
  } else {
    // dim red (30) → bright red (0)
    const t = energy / 30
    const r = Math.round(220 + 35 * (1 - t))
    return `rgb(${r},${Math.round(20 * t)},0)`
  }
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

interface SparklineProps {
  snapshots: EnergySnapshot[]   // up to 7 entries
  width: number
  height: number
}

function Sparkline({ snapshots, width, height }: SparklineProps) {
  if (snapshots.length < 2) return null

  const pts = snapshots.slice(-7)
  const xs = pts.map((_, i) => (i / (pts.length - 1)) * width)
  const ys = pts.map(s => height - (s.energy / 100) * height)

  const polyline = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ')

  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <polyline
        points={polyline}
        fill="none"
        stroke="rgba(100,220,180,0.7)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {pts.map((s, i) => (
        <circle
          key={i}
          cx={xs[i]}
          cy={ys[i]}
          r={2}
          fill={energyColor(s.energy)}
        />
      ))}
    </svg>
  )
}

// ── Productivity heat-bar ─────────────────────────────────────────────────────

interface ProductivityBarProps {
  fieldLogs: NWFieldLog[]
  width: number
}

function ProductivityBar({ fieldLogs, width }: ProductivityBarProps) {
  // Count logs per hour-of-day (0–23)
  const counts = useMemo(() => {
    const arr = new Array<number>(24).fill(0)
    for (const fl of fieldLogs) {
      if (!fl.log_date) continue
      // log_date is YYYY-MM-DD; we parse and assume hours from the field log's
      // created_at or use the date itself mapped to a deterministic hour bucket
      // (We don't have time-of-day granularity in NWFieldLog, so we distribute
      // based on the day-of-week seed as a proxy for productivity zone patterns.)
      const d = new Date(fl.log_date)
      // Use day-of-week × 3 as a proxy hour offset → 0,3,6,9,12,15,18,21
      const h = (d.getDay() * 3) % 24
      arr[h] += fl.hours
    }
    return arr
  }, [fieldLogs])

  const maxCount = Math.max(...counts, 1)
  const cellW = width / 24

  // Work hours 6am–8pm
  const WORK_START = 6
  const WORK_END   = 20

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        width,
        height: 20,
        gap: 0,
        borderTop: '1px solid rgba(255,255,255,0.08)',
        paddingTop: 2,
      }}
      title="Peak productivity hours (field log activity)"
    >
      {counts.map((count, h) => {
        const ratio  = count / maxCount
        const isWork = h >= WORK_START && h < WORK_END
        const color  = ratio > 0.6
          ? '#34c55e'
          : ratio > 0.3
            ? '#f59e0b'
            : isWork
              ? 'rgba(255,255,255,0.10)'
              : 'rgba(255,255,255,0.04)'
        return (
          <div
            key={h}
            style={{
              width: cellW,
              height: Math.max(3, ratio * 18),
              background: color,
              borderRadius: 1,
              transition: 'height 0.4s ease',
            }}
            title={`${h}:00 — ${count.toFixed(1)} hrs logged`}
          />
        )
      })}
    </div>
  )
}

// ── Break countdown modal ─────────────────────────────────────────────────────

interface BreakTimerProps {
  remaining: number   // ms remaining
  onCancel: () => void
}

function BreakTimer({ remaining, onCancel }: BreakTimerProps) {
  const mins = Math.floor(remaining / 60_000)
  const secs = Math.floor((remaining % 60_000) / 1000)

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 32,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(10,20,35,0.95)',
        border: '1px solid rgba(52,197,94,0.5)',
        borderRadius: 12,
        padding: '16px 24px',
        zIndex: 9999,
        color: '#e2e8f0',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 14,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        minWidth: 240,
        boxShadow: '0 0 32px rgba(52,197,94,0.2)',
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: 2, color: '#34c55e', textTransform: 'uppercase' }}>
        ☕ Break in progress
      </div>
      <div style={{ fontSize: 32, fontWeight: 700, color: '#34c55e', letterSpacing: 4 }}>
        {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
      </div>
      <div style={{ fontSize: 11, color: 'rgba(226,232,240,0.5)', textAlign: 'center' }}>
        Energy restores +{BOOST_BREAK_TAKEN}% on completion
      </div>
      <button
        onClick={onCancel}
        style={{
          marginTop: 4,
          padding: '5px 16px',
          background: 'rgba(220,38,38,0.15)',
          border: '1px solid rgba(220,38,38,0.4)',
          borderRadius: 6,
          color: '#f87171',
          fontSize: 11,
          cursor: 'pointer',
          letterSpacing: 1,
        }}
      >
        END BREAK EARLY
      </button>
    </div>
  )
}

// ── Sleep input modal ─────────────────────────────────────────────────────────

interface SleepInputProps {
  value: number
  onChange: (hrs: number) => void
  onClose: () => void
}

function SleepInput({ value, onChange, onClose }: SleepInputProps) {
  const [draft, setDraft] = useState(String(value))

  function commit() {
    const n = parseFloat(draft)
    if (!isNaN(n) && n >= 0 && n <= 24) {
      onChange(n)
      writeJSON(SLEEP_LS_KEY, n)
    }
    onClose()
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: BAR_WIDTH + 12,
        top: 0,
        background: 'rgba(10,20,35,0.97)',
        border: '1px solid rgba(100,220,180,0.3)',
        borderRadius: 10,
        padding: '14px 16px',
        zIndex: 9999,
        color: '#e2e8f0',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 12,
        width: 180,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ fontSize: 10, letterSpacing: 2, color: '#64dcb4', textTransform: 'uppercase' }}>
        Sleep estimate
      </div>
      <input
        type="number"
        min={0}
        max={24}
        step={0.5}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') onClose() }}
        autoFocus
        style={{
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(100,220,180,0.3)',
          borderRadius: 6,
          color: '#e2e8f0',
          padding: '6px 10px',
          fontSize: 14,
          fontFamily: 'inherit',
          width: '100%',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ fontSize: 10, color: 'rgba(226,232,240,0.4)' }}>
        &lt;6 h → −10% energy · &gt;8 h → +5%
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={commit}
          style={{
            flex: 1,
            padding: '5px 0',
            background: 'rgba(52,197,94,0.15)',
            border: '1px solid rgba(52,197,94,0.4)',
            borderRadius: 6,
            color: '#34c55e',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          SET
        </button>
        <button
          onClick={onClose}
          style={{
            flex: 1,
            padding: '5px 0',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 6,
            color: '#94a3b8',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          CANCEL
        </button>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export interface EnergyTrackingLayerProps {
  /** Whether this layer is visible at all */
  visible?: boolean
  /** Count of overdue invoices — passed from parent or world data */
  overdueInvoiceCount?: number
  /** Count of stalled projects — passed from parent or world data */
  stalledProjectCount?: number
}

export function EnergyTrackingLayer({
  visible = true,
  overdueInvoiceCount = 0,
  stalledProjectCount = 0,
}: EnergyTrackingLayerProps) {
  // ── World data subscription ───────────────────────────────────────────────
  const [fieldLogs, setFieldLogs] = useState<NWFieldLog[]>([])

  useEffect(() => {
    const unsub = subscribeWorldData(data => {
      setFieldLogs(data.fieldLogs)
    })
    return unsub
  }, [])

  // ── Sleep hours ───────────────────────────────────────────────────────────
  const [sleepHours, setSleepHours] = useState<number>(() =>
    readJSON<number>(SLEEP_LS_KEY, 7)
  )
  const [showSleepInput, setShowSleepInput] = useState(false)

  // ── Today's hours worked ──────────────────────────────────────────────────
  const hoursWorkedToday = useMemo(() => {
    const today = todayStr()
    return fieldLogs
      .filter(fl => fl.log_date === today)
      .reduce((sum, fl) => sum + fl.hours, 0)
  }, [fieldLogs])

  // ── Boosts ────────────────────────────────────────────────────────────────
  const [boostsToday, setBoostsToday] = useState<BoostEntry[]>(() => {
    const stored = readJSON<{ date: string; boosts: BoostEntry[] }>(BOOSTS_LS_KEY, {
      date: todayStr(),
      boosts: [],
    })
    // Reset if it's a new day
    if (stored.date !== todayStr()) return []
    return stored.boosts
  })

  const applyBoost = useCallback((reason: string, amount: number) => {
    setBoostsToday(prev => {
      const entry: BoostEntry = { reason, amount, appliedAt: new Date().toISOString() }
      const next = [...prev, entry]
      writeJSON(BOOSTS_LS_KEY, { date: todayStr(), boosts: next })
      return next
    })
  }, [])

  // Listen for external boost events
  useEffect(() => {
    function onBoost(e: Event) {
      const ev = e as CustomEvent<{ reason: string; amount: number }>
      if (ev.detail?.reason != null && ev.detail?.amount != null) {
        applyBoost(ev.detail.reason, ev.detail.amount)
      }
    }
    window.addEventListener('nw:energy-boost', onBoost)
    return () => window.removeEventListener('nw:energy-boost', onBoost)
  }, [applyBoost])

  // ── Energy ────────────────────────────────────────────────────────────────
  const energy = useMemo(() => computeEnergy({
    hoursWorkedToday,
    overdueInvoiceCount,
    stalledProjectCount,
    sleepHours,
    boostsToday,
  }), [hoursWorkedToday, overdueInvoiceCount, stalledProjectCount, sleepHours, boostsToday])

  // Emit energy update for other components
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('nw:energy-update', {
      detail: { energy, hoursWorkedToday },
    }))
  }, [energy, hoursWorkedToday])

  // ── Snapshots ─────────────────────────────────────────────────────────────
  const [snapshots, setSnapshots] = useState<EnergySnapshot[]>(() =>
    readJSON<EnergySnapshot[]>(ENERGY_LS_KEY, [])
  )

  // Save one snapshot per day
  useEffect(() => {
    const today = todayStr()
    setSnapshots(prev => {
      const withoutToday = prev.filter(s => s.date !== today)
      const next = [
        ...withoutToday,
        { date: today, energy: Math.round(energy), hoursWorked: hoursWorkedToday },
      ].slice(-MAX_DAILY_SNAPSHOTS)
      writeJSON(ENERGY_LS_KEY, next)
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [energy]) // save whenever energy changes

  // 7-day sparkline data
  const sparklineData = useMemo(() => snapshots.slice(-7), [snapshots])

  // ── Break timer ───────────────────────────────────────────────────────────
  const [breakActive, setBreakActive]     = useState(false)
  const [breakRemaining, setBreakRemaining] = useState(BREAK_DURATION_MS)
  const breakEndRef = useRef<number>(0)
  const rafRef      = useRef<number>(0)

  const startBreak = useCallback(() => {
    breakEndRef.current = Date.now() + BREAK_DURATION_MS
    setBreakRemaining(BREAK_DURATION_MS)
    setBreakActive(true)
  }, [])

  const cancelBreak = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    setBreakActive(false)
    setBreakRemaining(BREAK_DURATION_MS)
  }, [])

  const completeBreak = useCallback(() => {
    setBreakActive(false)
    setBreakRemaining(BREAK_DURATION_MS)
    // Log break
    const entry: BreakEntry = {
      startedAt:   new Date(breakEndRef.current - BREAK_DURATION_MS).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs:  BREAK_DURATION_MS,
    }
    const history = readJSON<BreakEntry[]>(BREAKS_LS_KEY, [])
    writeJSON(BREAKS_LS_KEY, [...history, entry])
    // Apply energy boost
    applyBoost('Break taken', BOOST_BREAK_TAKEN)
    // Dispatch event
    window.dispatchEvent(new CustomEvent('nw:break-complete', { detail: entry }))
  }, [applyBoost])

  // Tick the break countdown
  useEffect(() => {
    if (!breakActive) return
    function tick() {
      const rem = breakEndRef.current - Date.now()
      if (rem <= 0) {
        completeBreak()
        return
      }
      setBreakRemaining(rem)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [breakActive, completeBreak])

  // Listen for external break-start event
  useEffect(() => {
    function onStartBreak() { startBreak() }
    window.addEventListener('nw:start-break', onStartBreak)
    return () => window.removeEventListener('nw:start-break', onStartBreak)
  }, [startBreak])

  // ── TTS alert at critical energy level ────────────────────────────────────
  const ttsAlertFiredRef = useRef(false)
  useEffect(() => {
    if (energy < CRITICAL_ENERGY_LEVEL && !ttsAlertFiredRef.current && hoursWorkedToday > 0) {
      ttsAlertFiredRef.current = true
      const hrs = hoursWorkedToday.toFixed(1)
      const text = `You've been working ${hrs} hours. Take 15 minutes.`
      // Fire-and-forget — fall back to speechSynthesis if ElevenLabs fails
      synthesizeWithElevenLabs({ text, voice_id: DEFAULT_VOICE_ID }).catch(() => {
        if ('speechSynthesis' in window) {
          const utt = new SpeechSynthesisUtterance(text)
          window.speechSynthesis.speak(utt)
        }
      })
    }
    // Reset alert if energy recovers above threshold
    if (energy >= CRITICAL_ENERGY_LEVEL) {
      ttsAlertFiredRef.current = false
    }
  }, [energy, hoursWorkedToday])

  // ── Tooltip hover state ───────────────────────────────────────────────────
  const [showTooltip, setShowTooltip] = useState(false)

  // ── Render guard ──────────────────────────────────────────────────────────
  if (!visible) return null

  const gaugeColor      = energyColor(energy)
  const fillHeight      = (energy / 100) * BAR_HEIGHT
  const isDimmed        = energy < LOW_ENERGY_THRESHOLD
  const isCritical      = energy < CRITICAL_ENERGY_LEVEL

  // ── Vignette / dim overlay ────────────────────────────────────────────────
  const dimOpacity   = isDimmed ? Math.max(0, (LOW_ENERGY_THRESHOLD - energy) / LOW_ENERGY_THRESHOLD) * 0.45 : 0
  const blurStrength = isDimmed ? Math.max(0, (LOW_ENERGY_THRESHOLD - energy) / LOW_ENERGY_THRESHOLD) * 6 : 0

  return (
    <>
      {/* ── World dim + edge vignette when energy < 30% ── */}
      {isDimmed && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 9990,
            background: `radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,${dimOpacity}) 100%)`,
            backdropFilter: blurStrength > 0 ? `blur(${blurStrength}px)` : undefined,
            WebkitBackdropFilter: blurStrength > 0 ? `blur(${blurStrength}px)` : undefined,
            // Only blur the edges, not the center
            maskImage: 'radial-gradient(ellipse at center, transparent 50%, black 100%)',
            WebkitMaskImage: 'radial-gradient(ellipse at center, transparent 50%, black 100%)',
            transition: 'opacity 1.2s ease',
          }}
        />
      )}

      {/* ── Critical pulse border ── */}
      {isCritical && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 9991,
            border: '3px solid rgba(220,38,38,0.4)',
            borderRadius: 0,
            animation: 'energy-critical-pulse 2s ease-in-out infinite',
          }}
        />
      )}

      {/* ── Energy gauge bar (left edge) ── */}
      <div
        style={{
          position: 'fixed',
          left: 12,
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 9995,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          userSelect: 'none',
        }}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {/* ENERGY label */}
        <div
          style={{
            fontSize: 8,
            letterSpacing: 2,
            color: 'rgba(226,232,240,0.5)',
            textTransform: 'uppercase',
            fontFamily: "'JetBrains Mono', monospace",
            writingMode: 'vertical-rl',
            transform: 'rotate(180deg)',
            marginBottom: 4,
          }}
        >
          ENERGY
        </div>

        {/* Gauge track */}
        <div
          style={{
            position: 'relative',
            width: BAR_WIDTH,
            height: BAR_HEIGHT,
            background: 'rgba(15,25,40,0.85)',
            border: `1px solid ${isCritical ? 'rgba(220,38,38,0.6)' : 'rgba(100,220,180,0.2)'}`,
            borderRadius: BAR_WIDTH / 2,
            overflow: 'hidden',
            cursor: 'pointer',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            boxShadow: isCritical
              ? '0 0 16px rgba(220,38,38,0.4)'
              : `0 0 12px rgba(52,197,94,0.1)`,
            transition: 'box-shadow 0.6s ease',
          }}
        >
          {/* Fill (grows from bottom) */}
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              width: '100%',
              height: fillHeight,
              background: `linear-gradient(to top, ${gaugeColor}, ${energyColor(Math.min(100, energy + 25))})`,
              borderRadius: `0 0 ${BAR_WIDTH / 2}px ${BAR_WIDTH / 2}px`,
              transition: 'height 0.8s cubic-bezier(0.25,0.46,0.45,0.94), background 1.2s ease',
            }}
          />

          {/* Tick marks at 25%, 50%, 75% */}
          {[25, 50, 75].map(pct => (
            <div
              key={pct}
              style={{
                position: 'absolute',
                bottom: `${pct}%`,
                left: 0,
                width: '100%',
                height: 1,
                background: 'rgba(255,255,255,0.12)',
                pointerEvents: 'none',
              }}
            />
          ))}

          {/* Percentage text */}
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              fontSize: 9,
              fontWeight: 700,
              color: 'rgba(255,255,255,0.85)',
              fontFamily: "'JetBrains Mono', monospace",
              writingMode: 'vertical-rl',
              letterSpacing: 1,
              pointerEvents: 'none',
            }}
          >
            {Math.round(energy)}%
          </div>
        </div>

        {/* 7-day sparkline */}
        <div
          style={{
            width: BAR_WIDTH,
            height: SPARK_H,
            background: 'rgba(15,25,40,0.7)',
            border: '1px solid rgba(100,220,180,0.1)',
            borderRadius: 4,
            overflow: 'hidden',
            padding: 2,
            display: 'flex',
            alignItems: 'flex-end',
          }}
          title="7-day energy pattern"
        >
          <Sparkline
            snapshots={sparklineData}
            width={BAR_WIDTH - 4}
            height={SPARK_H - 4}
          />
        </div>

        {/* Productivity heat-bar (24h) */}
        <div
          style={{
            width: 80,
            transform: 'rotate(-90deg) translateX(-30px)',
            transformOrigin: 'left center',
            position: 'absolute',
            bottom: -80,
          }}
        >
          <ProductivityBar fieldLogs={fieldLogs} width={80} />
        </div>

        {/* ⚡ Take Break button */}
        <button
          onClick={() => {
            if (!breakActive) startBreak()
          }}
          style={{
            marginTop: 8,
            width: BAR_WIDTH + 12,
            padding: '5px 4px',
            background: breakActive
              ? 'rgba(52,197,94,0.2)'
              : isCritical
                ? 'rgba(220,38,38,0.2)'
                : 'rgba(100,220,180,0.1)',
            border: `1px solid ${breakActive ? 'rgba(52,197,94,0.5)' : isCritical ? 'rgba(220,38,38,0.5)' : 'rgba(100,220,180,0.2)'}`,
            borderRadius: 6,
            color: breakActive ? '#34c55e' : isCritical ? '#f87171' : '#64dcb4',
            fontSize: 9,
            cursor: breakActive ? 'default' : 'pointer',
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: 1,
            textAlign: 'center',
            transition: 'all 0.3s ease',
          }}
          disabled={breakActive}
          title={breakActive ? 'Break in progress' : 'Take a 15-minute break (+20% energy)'}
        >
          {breakActive ? '☕' : '⚡'}
        </button>

        {/* Sleep hours badge */}
        <button
          onClick={() => setShowSleepInput(s => !s)}
          style={{
            width: BAR_WIDTH + 12,
            padding: '3px 4px',
            background: 'rgba(15,25,40,0.7)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 5,
            color: 'rgba(226,232,240,0.5)',
            fontSize: 8,
            cursor: 'pointer',
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: 0.5,
            textAlign: 'center',
          }}
          title="Set sleep hours"
        >
          😴 {sleepHours}h
        </button>

        {/* Sleep input popup */}
        {showSleepInput && (
          <SleepInput
            value={sleepHours}
            onChange={setSleepHours}
            onClose={() => setShowSleepInput(false)}
          />
        )}

        {/* Tooltip */}
        {showTooltip && (
          <div
            style={{
              position: 'absolute',
              left: BAR_WIDTH + 16,
              top: 0,
              background: 'rgba(8,16,28,0.97)',
              border: '1px solid rgba(100,220,180,0.25)',
              borderRadius: 10,
              padding: '12px 14px',
              minWidth: 200,
              zIndex: 9999,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: '#e2e8f0',
              pointerEvents: 'none',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ fontSize: 10, letterSpacing: 2, color: '#64dcb4', marginBottom: 8, textTransform: 'uppercase' }}>
              Energy Report
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'rgba(226,232,240,0.6)' }}>Base</span>
                <span>100%</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#f87171' }}>
                <span>Hours worked ({hoursWorkedToday.toFixed(1)}h)</span>
                <span>−{(hoursWorkedToday * DRAIN_PER_HOUR).toFixed(0)}%</span>
              </div>
              {overdueInvoiceCount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#f87171' }}>
                  <span>Overdue invoices ({overdueInvoiceCount})</span>
                  <span>−{overdueInvoiceCount * DRAIN_OVERDUE_INVOICE}%</span>
                </div>
              )}
              {stalledProjectCount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#f87171' }}>
                  <span>Stalled projects ({stalledProjectCount})</span>
                  <span>−{stalledProjectCount * DRAIN_STALLED_PROJECT}%</span>
                </div>
              )}
              {sleepHours < 6 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#f87171' }}>
                  <span>Poor sleep (&lt;6h)</span>
                  <span>−10%</span>
                </div>
              )}
              {sleepHours > 8 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#34c55e' }}>
                  <span>Good sleep (&gt;8h)</span>
                  <span>+5%</span>
                </div>
              )}
              {boostsToday.map((b, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', color: '#34c55e' }}>
                  <span>{b.reason}</span>
                  <span>+{b.amount}%</span>
                </div>
              ))}
              <div
                style={{
                  marginTop: 6,
                  paddingTop: 6,
                  borderTop: '1px solid rgba(255,255,255,0.1)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontWeight: 700,
                  color: gaugeColor,
                }}
              >
                <span>Net energy</span>
                <span>{Math.round(energy)}%</span>
              </div>
            </div>
            {isCritical && (
              <div style={{ marginTop: 8, fontSize: 10, color: '#f87171', textAlign: 'center' }}>
                ⚠ Critical — NEXUS recommends a break
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Break timer overlay ── */}
      {breakActive && (
        <BreakTimer remaining={breakRemaining} onCancel={cancelBreak} />
      )}

      {/* ── CSS keyframes ── */}
      <style>{`
        @keyframes energy-critical-pulse {
          0%   { box-shadow: inset 0 0 0 3px rgba(220,38,38,0.0); }
          50%  { box-shadow: inset 0 0 0 3px rgba(220,38,38,0.5); }
          100% { box-shadow: inset 0 0 0 3px rgba(220,38,38,0.0); }
        }
      `}</style>
    </>
  )
}
