/**
 * TemporalNavigator.tsx — NW39: Time scrub slider + temporal world controls.
 *
 * HUD ELEMENT: Bottom-center of screen, full width minus 100px each side.
 * Visible only when "time-navigation" layer is ON.
 *
 * SLIDER:
 *   - Thin 4px teal track
 *   - Glowing teal handle with date label above
 *   - Range: -6 months (past) to +12 months (future) from present
 *   - Gold vertical line at center = PRESENT marker, always visible
 *   - Drag left = past, drag right = future
 *   - Double-click = snap back to present
 *
 * OVERLAYS (when not at present):
 *   - "VIEWING: [date]"  (past)  — dim text top-center
 *   - "PROJECTION: [date]" (future) — dim text top-center
 *   - Pulsing amber border (past) or pulsing blue border (future)
 *
 * COMPARISON MODE:
 *   - Hold Shift while in past/future → present state overlays as ghost wireframe
 *   - Solid outline = viewed date, ghost wireframe = today
 *
 * PLAYBACK:
 *   - ▶ button: auto-advances from current position to present (1 mo / 3 s)
 *   - ⏸ button when playing
 *   - 2× for double speed
 *
 * Dispatches 'nw:temporal-change' CustomEvent on every date change.
 * Listens for 'nw:layer-toggle' with id 'time-navigation' to show/hide.
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react'
import {
  useTemporalEngine,
  addMonths,
  formatTemporalLabel,
  getPresentDate,
  type TemporalMode,
} from './TemporalDataEngine'

// ── Constants ────────────────────────────────────────────────────────────────

const PAST_MONTHS  = 6    // slider left extent
const FUTURE_MONTHS = 12  // slider right extent
const TOTAL_MONTHS = PAST_MONTHS + FUTURE_MONTHS
// Present is at PAST_MONTHS / TOTAL_MONTHS fraction = 0.333...
const PRESENT_FRACTION = PAST_MONTHS / TOTAL_MONTHS

// ── Helper: fraction → date ──────────────────────────────────────────────────

function fractionToDate(fraction: number, presentDate: Date): Date {
  // fraction 0 = -6 months, PRESENT_FRACTION = present, 1 = +12 months
  const offsetMonths = (fraction - PRESENT_FRACTION) * TOTAL_MONTHS
  return addMonths(presentDate, offsetMonths)
}

function dateToFraction(d: Date, presentDate: Date): number {
  const msPerMonth = 30.44 * 24 * 3600 * 1000
  const offsetMs = d.getTime() - presentDate.getTime()
  const offsetMonths = offsetMs / msPerMonth
  return PRESENT_FRACTION + offsetMonths / TOTAL_MONTHS
}

// ── Injected keyframes (once) ─────────────────────────────────────────────────

const KEYFRAMES = `
@keyframes nw-temporal-amber-pulse {
  0%,100% { box-shadow: inset 0 0 0 3px rgba(255,180,0,0.55), 0 0 24px rgba(255,180,0,0.18); }
  50%      { box-shadow: inset 0 0 0 3px rgba(255,180,0,0.25), 0 0 10px rgba(255,180,0,0.08); }
}
@keyframes nw-temporal-blue-pulse {
  0%,100% { box-shadow: inset 0 0 0 3px rgba(80,160,255,0.55), 0 0 24px rgba(80,160,255,0.18); }
  50%      { box-shadow: inset 0 0 0 3px rgba(80,160,255,0.25), 0 0 10px rgba(80,160,255,0.08); }
}
@keyframes nw-temporal-label-in {
  from { opacity:0; transform: translateX(-50%) translateY(-6px); }
  to   { opacity:1; transform: translateX(-50%) translateY(0); }
}
@keyframes nw-temporal-handle-glow {
  0%,100% { box-shadow: 0 0 8px 2px rgba(0,229,204,0.9), 0 0 20px 4px rgba(0,229,204,0.5); }
  50%      { box-shadow: 0 0 12px 4px rgba(0,229,204,1),   0 0 32px 8px rgba(0,229,204,0.6); }
}
`

// ── Sub-components ────────────────────────────────────────────────────────────

/** Pulsing edge border overlay (past = amber, future = blue) */
function TemporalBorderOverlay({ mode }: { mode: TemporalMode }) {
  if (mode === 'present') return null
  const animation = mode === 'past'
    ? 'nw-temporal-amber-pulse 2s ease-in-out infinite'
    : 'nw-temporal-blue-pulse 2s ease-in-out infinite'
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 28,
        animation,
        borderRadius: 0,
      }}
    />
  )
}

/** "VIEWING: APR 2024" or "PROJECTION: JUN 2027" at top-center */
function TemporalDateBadge({
  mode,
  viewDate,
}: {
  mode: TemporalMode
  viewDate: Date
}) {
  if (mode === 'present') return null
  const label = mode === 'past'
    ? `VIEWING: ${formatTemporalLabel(viewDate)}`
    : `PROJECTION: ${formatTemporalLabel(viewDate)}`
  const color = mode === 'past' ? 'rgba(255,200,60,0.65)' : 'rgba(80,160,255,0.65)'
  return (
    <div
      style={{
        position: 'absolute',
        top: 14,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 42,
        pointerEvents: 'none',
        fontFamily: 'monospace',
        fontSize: 14,
        letterSpacing: 3,
        color,
        textShadow: `0 0 12px ${color}`,
        animation: 'nw-temporal-label-in 0.3s ease both',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </div>
  )
}

/** Comparison mode ghost wireframe info badge */
function ComparisonBadge({ active }: { active: boolean }) {
  if (!active) return null
  return (
    <div
      style={{
        position: 'absolute',
        top: 40,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 42,
        pointerEvents: 'none',
        fontFamily: 'monospace',
        fontSize: 12,
        letterSpacing: 2,
        color: 'rgba(200,220,255,0.5)',
        whiteSpace: 'nowrap',
      }}
    >
      ◫ COMPARISON — SOLID = VIEWED · WIREFRAME = TODAY
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

interface TemporalNavigatorProps {
  visible: boolean
}

export default function TemporalNavigator({ visible }: TemporalNavigatorProps) {
  const {
    viewDate,
    snapshot,
    isPlaying,
    playSpeed,
    comparisonMode,
    setViewDate,
    snapToPresent,
    togglePlay,
    setPlaySpeed,
    setComparisonMode,
  } = useTemporalEngine()

  const presentDate = useMemo(() => getPresentDate(), [])

  // Slider fraction state (0–1)
  const [fraction, setFraction] = useState<number>(PRESENT_FRACTION)
  const isDraggingRef = useRef(false)
  const trackRef = useRef<HTMLDivElement>(null)
  const lastTapRef = useRef<number>(0)

  // Sync fraction when viewDate changes externally (e.g. playback)
  useEffect(() => {
    const f = dateToFraction(viewDate, presentDate)
    setFraction(f)
  }, [viewDate, presentDate])

  // Shift key → comparison mode
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Shift') setComparisonMode(true)
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === 'Shift') setComparisonMode(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [setComparisonMode])

  // Convert pointer position to fraction
  const pointerToFraction = useCallback((clientX: number): number => {
    if (!trackRef.current) return PRESENT_FRACTION
    const rect = trackRef.current.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }, [])

  const applyFraction = useCallback((f: number) => {
    const clamped = Math.max(0, Math.min(1, f))
    setFraction(clamped)
    const d = fractionToDate(clamped, presentDate)
    setViewDate(d)
  }, [presentDate, setViewDate])

  // Pointer events for drag
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Double-tap / double-click → snap to present
    const now = Date.now()
    if (now - lastTapRef.current < 350) {
      snapToPresent()
      setFraction(PRESENT_FRACTION)
      return
    }
    lastTapRef.current = now

    isDraggingRef.current = true
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    applyFraction(pointerToFraction(e.clientX))
  }, [applyFraction, pointerToFraction, snapToPresent])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return
    applyFraction(pointerToFraction(e.clientX))
  }, [applyFraction, pointerToFraction])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    isDraggingRef.current = false
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  }, [])

  // Month tick marks
  const ticks = useMemo(() => {
    const result: Array<{ fraction: number; label: string; isPresent: boolean }> = []
    for (let m = -PAST_MONTHS; m <= FUTURE_MONTHS; m++) {
      const f = PRESENT_FRACTION + m / TOTAL_MONTHS
      const d = addMonths(presentDate, m)
      const isPresent = m === 0
      const label = isPresent ? 'NOW' : m % 3 === 0
        ? (m < 0 ? `-${Math.abs(m)}mo` : `+${m}mo`)
        : ''
      result.push({ fraction: f, label, isPresent })
    }
    return result
  }, [presentDate])

  const mode: TemporalMode = snapshot?.mode ?? 'present'
  const handleDate = fractionToDate(fraction, presentDate)
  const handleFraction = fraction

  if (!visible) return null

  return (
    <>
      {/* Injected CSS */}
      <style>{KEYFRAMES}</style>

      {/* ── Edge border overlay ─────────────────────────────────────────── */}
      <TemporalBorderOverlay mode={mode} />

      {/* ── Top-center date badge ───────────────────────────────────────── */}
      <TemporalDateBadge mode={mode} viewDate={handleDate} />

      {/* ── Comparison mode badge ───────────────────────────────────────── */}
      <ComparisonBadge active={comparisonMode && mode !== 'present'} />

      {/* ── Ghost wireframe comparison overlay ─────────────────────────── */}
      {comparisonMode && mode !== 'present' && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 27,
            pointerEvents: 'none',
            // Subtle blue-white gradient shimmer to indicate "present" ghost
            background: 'radial-gradient(ellipse at center, rgba(120,160,255,0.04) 0%, transparent 70%)',
            border: '1px solid rgba(120,160,255,0.12)',
            mixBlendMode: 'screen',
          }}
        />
      )}

      {/* ── Bottom Slider Panel ─────────────────────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          bottom: 64,
          left: 100,
          right: 100,
          zIndex: 38,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: 0,
          pointerEvents: 'none',
        }}
      >
        {/* ── Labels row ──────────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: 4,
            pointerEvents: 'none',
          }}
        >
          <span style={{
            fontFamily: 'monospace',
            fontSize: 10,
            letterSpacing: 2,
            color: 'rgba(255,180,60,0.55)',
          }}>
            ◀ PAST {PAST_MONTHS}mo
          </span>
          <span style={{
            fontFamily: 'monospace',
            fontSize: 10,
            letterSpacing: 2,
            color: mode === 'present' ? 'rgba(255,215,0,0.75)' : 'rgba(255,215,0,0.35)',
          }}>
            PRESENT
          </span>
          <span style={{
            fontFamily: 'monospace',
            fontSize: 10,
            letterSpacing: 2,
            color: 'rgba(80,160,255,0.55)',
          }}>
            FUTURE {FUTURE_MONTHS}mo ▶
          </span>
        </div>

        {/* ── Track + handle area ──────────────────────────────────────── */}
        <div
          ref={trackRef}
          style={{
            position: 'relative',
            height: 32,
            display: 'flex',
            alignItems: 'center',
            cursor: 'ew-resize',
            pointerEvents: 'all',
            userSelect: 'none',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {/* Track background */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              height: 4,
              borderRadius: 2,
              background: 'rgba(255,255,255,0.08)',
              overflow: 'hidden',
            }}
          >
            {/* Filled portion (past = amber tint, future = blue tint) */}
            <div
              style={{
                position: 'absolute',
                left: 0,
                width: `${handleFraction * 100}%`,
                height: '100%',
                background: mode === 'future'
                  ? 'linear-gradient(90deg, rgba(255,140,40,0.5) 0%, rgba(255,140,40,0.5) 33%, rgba(60,140,255,0.5) 33%)'
                  : `rgba(255,140,40,0.55)`,
                transition: isDraggingRef.current ? 'none' : 'width 0.15s',
              }}
            />
          </div>

          {/* Tick marks */}
          {ticks.map(tick => (
            <div
              key={tick.fraction}
              style={{
                position: 'absolute',
                left: `${tick.fraction * 100}%`,
                transform: 'translateX(-50%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                pointerEvents: 'none',
              }}
            >
              <div
                style={{
                  width: tick.isPresent ? 2 : 1,
                  height: tick.isPresent ? 12 : 6,
                  background: tick.isPresent
                    ? 'rgba(255,215,0,0.9)'
                    : 'rgba(255,255,255,0.2)',
                  marginBottom: tick.label ? 2 : 0,
                  borderRadius: 1,
                  marginTop: tick.isPresent ? -4 : -1,
                }}
              />
              {tick.label && (
                <span style={{
                  fontFamily: 'monospace',
                  fontSize: 8,
                  color: tick.isPresent ? 'rgba(255,215,0,0.7)' : 'rgba(255,255,255,0.25)',
                  letterSpacing: 0.5,
                  marginTop: 2,
                  whiteSpace: 'nowrap',
                  position: 'absolute',
                  top: 14,
                }}>
                  {tick.label}
                </span>
              )}
            </div>
          ))}

          {/* Gold present line — always visible */}
          <div
            style={{
              position: 'absolute',
              left: `${PRESENT_FRACTION * 100}%`,
              transform: 'translateX(-50%)',
              width: 2,
              height: 20,
              background: 'rgba(255,215,0,0.9)',
              borderRadius: 1,
              boxShadow: '0 0 6px 1px rgba(255,215,0,0.7)',
              zIndex: 2,
              marginTop: -8,
            }}
          />

          {/* Draggable handle */}
          <div
            style={{
              position: 'absolute',
              left: `${handleFraction * 100}%`,
              transform: 'translateX(-50%)',
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: mode === 'future'
                ? 'linear-gradient(135deg, #40a0ff, #0099cc)'
                : mode === 'past'
                ? 'linear-gradient(135deg, #00e5cc, #007a88)'
                : 'linear-gradient(135deg, #00e5cc, #00b399)',
              boxShadow: '0 0 8px 2px rgba(0,229,204,0.9), 0 0 20px 4px rgba(0,229,204,0.5)',
              animation: 'nw-temporal-handle-glow 2s ease-in-out infinite',
              zIndex: 3,
              cursor: 'grab',
            }}
          />

          {/* Date label above handle */}
          <div
            style={{
              position: 'absolute',
              left: `${handleFraction * 100}%`,
              bottom: 20,
              transform: 'translateX(-50%)',
              fontFamily: 'monospace',
              fontSize: 14,
              letterSpacing: 2,
              color: mode === 'future'
                ? 'rgba(80,180,255,0.9)'
                : mode === 'past'
                ? 'rgba(255,200,60,0.9)'
                : 'rgba(0,229,204,0.9)',
              textShadow: mode === 'future'
                ? '0 0 10px rgba(80,180,255,0.7)'
                : mode === 'past'
                ? '0 0 10px rgba(255,200,60,0.7)'
                : '0 0 10px rgba(0,229,204,0.7)',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              zIndex: 4,
            }}
          >
            {formatTemporalLabel(handleDate)}
          </div>
        </div>

        {/* ── Playback controls ────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 8,
            marginTop: 18,
            pointerEvents: 'all',
          }}
        >
          {/* Play / Pause */}
          <button
            onClick={togglePlay}
            title={isPlaying ? 'Pause timelapse' : 'Play timelapse to present'}
            style={{
              background: isPlaying ? 'rgba(255,80,80,0.15)' : 'rgba(0,229,204,0.12)',
              border: `1px solid ${isPlaying ? 'rgba(255,80,80,0.4)' : 'rgba(0,229,204,0.35)'}`,
              borderRadius: 6,
              color: isPlaying ? 'rgba(255,120,120,0.9)' : 'rgba(0,229,204,0.9)',
              fontFamily: 'monospace',
              fontSize: 16,
              width: 32,
              height: 32,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s',
            }}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>

          {/* Speed toggle: 1× / 2× */}
          <button
            onClick={() => setPlaySpeed(playSpeed === 1 ? 2 : 1)}
            title={`Playback speed: ${playSpeed}×`}
            style={{
              background: playSpeed === 2 ? 'rgba(255,180,40,0.15)' : 'rgba(60,60,80,0.3)',
              border: `1px solid ${playSpeed === 2 ? 'rgba(255,180,40,0.4)' : 'rgba(120,120,160,0.25)'}`,
              borderRadius: 6,
              color: playSpeed === 2 ? 'rgba(255,200,60,0.9)' : 'rgba(160,160,200,0.6)',
              fontFamily: 'monospace',
              fontSize: 11,
              letterSpacing: 1,
              width: 36,
              height: 32,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {playSpeed}×
          </button>

          {/* Snap to present */}
          {mode !== 'present' && (
            <button
              onClick={() => { snapToPresent(); setFraction(PRESENT_FRACTION) }}
              title="Snap to present"
              style={{
                background: 'rgba(255,215,0,0.1)',
                border: '1px solid rgba(255,215,0,0.35)',
                borderRadius: 6,
                color: 'rgba(255,215,0,0.8)',
                fontFamily: 'monospace',
                fontSize: 10,
                letterSpacing: 1,
                padding: '0 10px',
                height: 32,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s',
              }}
            >
              ◎ NOW
            </button>
          )}

          {/* Shift-key hint */}
          <span style={{
            fontFamily: 'monospace',
            fontSize: 9,
            letterSpacing: 1,
            color: comparisonMode ? 'rgba(200,220,255,0.6)' : 'rgba(255,255,255,0.2)',
            marginLeft: 4,
          }}>
            {comparisonMode ? '⇧ COMPARISON ON' : '⇧ HOLD FOR COMPARE'}
          </span>
        </div>

        {/* ── Snapshot stats strip ─────────────────────────────────────── */}
        {snapshot && mode !== 'present' && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: 20,
              marginTop: 8,
              pointerEvents: 'none',
            }}
          >
            {[
              {
                label: 'PROJECTS',
                value: String(snapshot.activeProjectCount),
                color: 'rgba(0,229,204,0.55)',
              },
              {
                label: 'REVENUE',
                value: snapshot.totalRevenueAtDate >= 1000
                  ? `$${(snapshot.totalRevenueAtDate / 1000).toFixed(0)}k`
                  : `$${snapshot.totalRevenueAtDate.toFixed(0)}`,
                color: 'rgba(0,229,204,0.55)',
              },
              {
                label: mode === 'future' ? 'PROJECTED' : 'UNPAID',
                value: mode === 'future'
                  ? `+${snapshot.projects.filter(p => p.isProjected).length}`
                  : String(snapshot.invoices.filter(i => i.unpaidAtDate).length),
                color: mode === 'future' ? 'rgba(80,160,255,0.55)' : 'rgba(255,140,60,0.55)',
              },
            ].map(stat => (
              <div
                key={stat.label}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                }}
              >
                <span style={{
                  fontFamily: 'monospace',
                  fontSize: 8,
                  letterSpacing: 2,
                  color: 'rgba(255,255,255,0.25)',
                }}>
                  {stat.label}
                </span>
                <span style={{
                  fontFamily: 'monospace',
                  fontSize: 14,
                  letterSpacing: 1,
                  color: stat.color,
                }}>
                  {stat.value}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// ── Exported button for LayersPanel / external toggle ─────────────────────────

export function TemporalNavButton({
  onClick,
  active,
}: {
  onClick: () => void
  active: boolean
}) {
  return (
    <button
      onClick={onClick}
      title="Time Navigation — scrub through past and future world states"
      style={{
        background: active ? 'rgba(0,229,204,0.15)' : 'rgba(40,40,60,0.5)',
        border: `1px solid ${active ? 'rgba(0,229,204,0.5)' : 'rgba(120,120,180,0.2)'}`,
        borderRadius: 6,
        color: active ? 'rgba(0,229,204,0.9)' : 'rgba(160,160,200,0.5)',
        fontFamily: 'monospace',
        fontSize: 11,
        letterSpacing: 1,
        padding: '4px 10px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        transition: 'all 0.2s',
      }}
    >
      <span style={{ fontSize: 14 }}>⏱</span>
      TIME NAV
    </button>
  )
}
