import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { RouteBuilderAnnotation } from './routeBuilderModel'
import { preparePlaybackGeometry } from './playbackGeometry'
import { calculatePlaybackFrame, createPlaybackTimeline, type PlaybackFrame } from './playbackModel'
import { parseBlueprintAnimationScene } from './sceneSchema'

type PlaybackStatus = 'idle' | 'playing' | 'paused' | 'complete'

export interface PackageAnimationPlaybackControlsProps {
  active: boolean
  scene: unknown
  annotations: RouteBuilderAnnotation[]
  currentPage: number
  pageWidth: number
  pageHeight: number
  overlayWidth: number
  overlayHeight: number
  overlayTarget: HTMLElement | null
  onActivate(): void
  onDeactivate(): void
}

const CHANNEL_COLORS: Record<string, string> = {
  'switched-line-voltage': '#facc15',
  'constant-line-voltage': '#fb923c',
  'zero-to-ten-volt-control': '#a78bfa',
  'low-voltage-control-signal': '#38bdf8',
  'emergency-power': '#f43f5e',
  'generic-route': '#22d3ee',
}

export function PackageAnimationPlaybackControls({
  active,
  scene,
  annotations,
  currentPage,
  pageWidth,
  pageHeight,
  overlayWidth,
  overlayHeight,
  overlayTarget,
  onActivate,
  onDeactivate,
}: PackageAnimationPlaybackControlsProps) {
  const pageAspect = Number.isFinite(pageWidth / pageHeight) && pageHeight > 0
    ? Number((pageWidth / pageHeight).toFixed(6))
    : 0
  const prepared = useMemo(() => {
    try {
      const parsed = parseBlueprintAnimationScene(scene)
      if (parsed.status !== 'supported') throw new Error('The saved animation scene is not playable by this app version.')
      const geometry = preparePlaybackGeometry({ scene: parsed.scene, annotations, pageMetrics: { width: pageAspect, height: 1 } })
      return { timeline: createPlaybackTimeline(geometry, parsed.scene.playbackOptions), error: undefined }
    } catch (error) {
      return { timeline: undefined, error: error instanceof Error ? error.message : 'Animation geometry could not be resolved.' }
    }
  }, [annotations, pageAspect, scene])
  const [status, setStatus] = useState<PlaybackStatus>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [runToken, setRunToken] = useState(0)
  const rafRef = useRef<number | null>(null)
  const accumulatedRef = useRef(0)

  useEffect(() => {
    if (!active || !prepared.timeline) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      accumulatedRef.current = 0
      setElapsedMs(0)
      setStatus('idle')
      return
    }
    accumulatedRef.current = 0
    setElapsedMs(0)
    setStatus(prepared.timeline.totalDurationMs === 0 ? 'complete' : 'playing')
    setRunToken((value) => value + 1)
  }, [active, prepared.timeline])

  useEffect(() => {
    const timeline = prepared.timeline
    if (!active || !timeline || status !== 'playing') return
    let startedAt: number | null = null
    const tick = (timestamp: number) => {
      if (startedAt == null) startedAt = timestamp
      const nextElapsed = accumulatedRef.current + timestamp - startedAt
      const nextFrame = calculatePlaybackFrame(timeline, nextElapsed)
      setElapsedMs(nextElapsed)
      if (nextFrame.complete) {
        accumulatedRef.current = timeline.totalDurationMs
        setElapsedMs(timeline.totalDurationMs)
        setStatus('complete')
        rafRef.current = null
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [active, prepared.timeline, runToken, status])

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
  }, [])

  const frame: PlaybackFrame | null = active && prepared.timeline
    ? calculatePlaybackFrame(prepared.timeline, elapsedMs)
    : null

  const play = () => {
    if (!prepared.timeline) return
    if (!active) {
      onActivate()
      return
    }
    accumulatedRef.current = 0
    setElapsedMs(0)
    setStatus(prepared.timeline.totalDurationMs === 0 ? 'complete' : 'playing')
    setRunToken((value) => value + 1)
  }
  const pause = () => {
    accumulatedRef.current = elapsedMs
    setStatus('paused')
  }
  const resume = () => {
    accumulatedRef.current = elapsedMs
    setStatus('playing')
    setRunToken((value) => value + 1)
  }
  const restart = () => {
    if (!active) onActivate()
    accumulatedRef.current = 0
    setElapsedMs(0)
    setStatus(prepared.timeline?.totalDurationMs === 0 ? 'complete' : 'playing')
    setRunToken((value) => value + 1)
  }
  const stop = () => {
    accumulatedRef.current = 0
    setElapsedMs(0)
    setStatus('idle')
    onDeactivate()
  }

  const primaryLabel = status === 'playing' ? 'Pause' : status === 'paused' ? 'Resume' : 'Play'
  const primaryAction = status === 'playing' ? pause : status === 'paused' ? resume : play
  const buttonClass = 'min-h-7 rounded border px-2 text-[10px] font-semibold disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <>
      <div className="flex flex-wrap gap-1.5" title={prepared.error}>
        <button
          type="button"
          onClick={primaryAction}
          disabled={!!prepared.error}
          className={`${buttonClass} border-emerald-500/50 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20`}
        >
          {primaryLabel}
        </button>
        <button
          type="button"
          onClick={restart}
          disabled={!active || !!prepared.error}
          className={`${buttonClass} border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/10`}
        >
          Restart
        </button>
        <button
          type="button"
          onClick={stop}
          disabled={!active}
          className={`${buttonClass} border-gray-600 text-gray-300 hover:bg-white/5`}
        >
          Stop
        </button>
      </div>
      {prepared.error && <div className="mt-1 text-[9px] text-amber-300/80">Playback unavailable: {prepared.error}</div>}
      {active && frame && overlayTarget && pageWidth > 0 && pageHeight > 0 && createPortal(
        <>
          <svg
            className="absolute inset-0 pointer-events-none overflow-visible select-none"
            width={overlayWidth}
            height={overlayHeight}
            viewBox={`0 0 ${pageWidth} ${pageHeight}`}
            style={{ zIndex: 26 }}
            aria-hidden="true"
          >
            {frame.energizedEdges.filter((edge) => edge.pageNumber === currentPage && edge.step.geometry).map((edge) => {
              const geometry = edge.step.geometry!
              const points = geometry.renderPoints.map((point) => `${point.x * pageWidth},${point.y * pageHeight}`).join(' ')
              return (
                <polyline
                  key={edge.edgeId}
                  points={points}
                  fill="none"
                  stroke={CHANNEL_COLORS[edge.channel] || CHANNEL_COLORS['generic-route']}
                  strokeWidth={6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pathLength={1}
                  strokeDasharray={`${edge.progress} 1`}
                  opacity={0.9}
                  vectorEffect="non-scaling-stroke"
                />
              )
            })}
            {frame.orb?.pageNumber === currentPage && (
              <circle
                cx={frame.orb.point.x * pageWidth}
                cy={frame.orb.point.y * pageHeight}
                r={7}
                fill="#ffffff"
                stroke="#22d3ee"
                strokeWidth={3}
                vectorEffect="non-scaling-stroke"
                style={{ filter: 'drop-shadow(0 0 6px rgba(34,211,238,0.95))' }}
              />
            )}
          </svg>
          {frame.devices.filter((device) => device.pageNumber === currentPage && device.phase !== 'idle').map((device) => (
            <div
              key={device.nodeId}
              className="absolute pointer-events-none select-none -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-200"
              style={{
                left: `${device.point.x * 100}%`,
                top: `${device.point.y * 100}%`,
                width: `${16 + device.progress * 10}px`,
                height: `${16 + device.progress * 10}px`,
                zIndex: 27,
                opacity: 0.35 + device.progress * 0.65,
                boxShadow: `0 0 ${6 + device.progress * 10}px rgba(34,211,238,0.85)`,
              }}
              aria-hidden="true"
            />
          ))}
        </>,
        overlayTarget,
      )}
    </>
  )
}

export default PackageAnimationPlaybackControls
