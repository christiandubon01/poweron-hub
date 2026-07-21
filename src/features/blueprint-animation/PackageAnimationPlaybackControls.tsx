import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { RouteBuilderAnnotation } from './routeBuilderModel'
import { preparePlaybackGeometry } from './playbackGeometry'
import { calculatePlaybackFrame, createPlaybackTimeline, type PlaybackFrame } from './playbackModel'
import { parseBlueprintAnimationScene } from './sceneSchema'
import {
  buildPlaybackActivationEventNodeIds,
  classifyPlaybackNodeVisualRole,
  resolvePlaybackDeviceVisual,
  type PlaybackDeviceVisualKind,
  type PlaybackFixtureAppearance,
} from './playbackFixtureAppearance'
import {
  PLAYBACK_PATH_NOT_YET_OPACITY,
  PLAYBACK_PATH_PULSE_DURATION_MS,
  PLAYBACK_PATH_PULSE_OPACITIES,
  PLAYBACK_PATH_SOLID_OPACITY,
  PLAYBACK_PATH_STROKE_WIDTH,
  resolvePlaybackChannelColor,
  resolvePlaybackPathState,
} from './playbackPathAppearance'

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
  /** Resting Light Output of each route fixture, keyed by annotation id and resolved by the
   *  viewer from the annotation's own saved meta. Playback only ever reads these. */
  fixtureAppearances?: Record<string, PlaybackFixtureAppearance>
  /** Mirrors the viewer's Lighting Effects toggle. Playback honours it: with effects hidden the
   *  devices still show their reaction and ready rings, but no fixture glow is forced on. */
  lightingEffectsVisible?: boolean
  onActivate(): void
  onDeactivate(): void
}

/** Ring tints per treatment. "ready" is deliberately neutral — a control that has merely been
 *  reached must never read as one that has switched on. */
const DEVICE_RING_COLORS: Record<Exclude<PlaybackDeviceVisualKind, 'none'>, string> = {
  'source-pulse': '#fde68a',
  ready: '#94a3b8',
  reacting: '#67e8f9',
  energized: '#a7f3d0',
}

// Gradient stops mirror the viewer's resting fixture glow so a fully activated fixture is
// indistinguishable from its saved appearance; only the opacity multiplier animates.
const GLOW_STOPS: Array<{ offset: string; opacity: number }> = [
  { offset: '0%', opacity: 0.5 },
  { offset: '55%', opacity: 0.24 },
  { offset: '100%', opacity: 0 },
]

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
  fixtureAppearances,
  lightingEffectsVisible = true,
  onActivate,
  onDeactivate,
}: PackageAnimationPlaybackControlsProps) {
  const pageAspect = Number.isFinite(pageWidth / pageHeight) && pageHeight > 0
    ? Number((pageWidth / pageHeight).toFixed(6))
    : 0
  const prepared = useMemo(() => {
    // Both indexes are derived once per scene: the timeline reports device state by node id, but
    // painting a fixture needs the annotation it is anchored to, and the activation-event set is
    // what keeps a control from ever lighting itself up.
    const nodeAnnotationIds = new Map<string, string>()
    try {
      const parsed = parseBlueprintAnimationScene(scene)
      if (parsed.status !== 'supported') throw new Error('The saved animation scene is not playable by this app version.')
      const geometry = preparePlaybackGeometry({ scene: parsed.scene, annotations, pageMetrics: { width: pageAspect, height: 1 } })
      parsed.scene.nodes.forEach((node) => {
        if (node.anchor.kind !== 'virtual-point') nodeAnnotationIds.set(node.id, node.anchor.annotationId)
      })
      return {
        timeline: createPlaybackTimeline(geometry, parsed.scene.playbackOptions),
        nodeAnnotationIds,
        activationEventNodeIds: buildPlaybackActivationEventNodeIds(parsed.scene.events),
        error: undefined,
      }
    } catch (error) {
      return {
        timeline: undefined,
        nodeAnnotationIds,
        activationEventNodeIds: new Set<string>(),
        error: error instanceof Error ? error.message : 'Animation geometry could not be resolved.',
      }
    }
  }, [annotations, pageAspect, scene])
  const nodesById = useMemo(
    () => new Map((prepared.timeline?.nodes ?? []).map((node) => [node.id, node])),
    [prepared.timeline],
  )
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
  const energizedEdgesByStepId = new Map((frame?.energizedEdges ?? []).map((edge) => [edge.step.id, edge]))

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
            {prepared.timeline?.steps.filter((step) => (
              step.kind === 'circuit-segment' && step.pageNumber === currentPage && step.geometry
            )).map((step) => {
              const geometry = step.geometry!
              const points = geometry.renderPoints.map((point) => `${point.x * pageWidth},${point.y * pageHeight}`).join(' ')
              const pathState = resolvePlaybackPathState({
                elapsedMs: frame.elapsedMs,
                travelStartMs: step.travelStartMs,
                travelEndMs: step.travelEndMs,
                reducedMotion: prepared.timeline?.options.reducedMotion,
              })
              const energizedEdge = energizedEdgesByStepId.get(step.id)
              const solidProgress = pathState === 'solid' ? 1 : energizedEdge?.progress ?? 0
              const stroke = resolvePlaybackChannelColor(step.channel)
              const sharedProps = {
                points,
                fill: 'none',
                stroke,
                strokeWidth: PLAYBACK_PATH_STROKE_WIDTH,
                strokeLinecap: 'round' as const,
                strokeLinejoin: 'round' as const,
                pathLength: 1,
                vectorEffect: 'non-scaling-stroke' as const,
              }
              return (
                <Fragment key={step.id}>
                  {pathState !== 'solid' && (
                    <polyline
                      {...sharedProps}
                      opacity={pathState === 'not-yet' ? PLAYBACK_PATH_NOT_YET_OPACITY : PLAYBACK_PATH_PULSE_OPACITIES[0]}
                    >
                      {pathState === 'dim-pulsing' && status === 'playing' && (
                        <animate
                          attributeName="opacity"
                          values={PLAYBACK_PATH_PULSE_OPACITIES.join(';')}
                          dur={`${PLAYBACK_PATH_PULSE_DURATION_MS}ms`}
                          repeatCount="indefinite"
                        />
                      )}
                    </polyline>
                  )}
                  {solidProgress > 0 && (
                    <polyline
                      {...sharedProps}
                      strokeDasharray={solidProgress < 1 ? `${solidProgress} 1` : undefined}
                      opacity={PLAYBACK_PATH_SOLID_OPACITY}
                    />
                  )}
                </Fragment>
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
          {frame.devices.map((device) => {
            if (device.pageNumber !== currentPage) return null
            const node = nodesById.get(device.nodeId)
            const visual = resolvePlaybackDeviceVisual({
              visualRole: classifyPlaybackNodeVisualRole(node?.roles, device.nodeId === prepared.timeline?.sourceNodeId),
              phase: device.phase,
              progress: device.progress,
              elapsedMs: frame.elapsedMs,
              hasActivationEvent: prepared.activationEventNodeIds.has(device.nodeId),
              reducedMotion: prepared.timeline?.options.reducedMotion === true,
            })
            if (visual.kind === 'none') return null
            const annotationId = prepared.nodeAnnotationIds.get(device.nodeId)
            const appearance = annotationId ? fixtureAppearances?.[annotationId] : undefined
            const ringColor = DEVICE_RING_COLORS[visual.kind]
            const isPulse = visual.kind === 'source-pulse'
            // The source pulse expands as it fades; every other ring grows into its treatment.
            const ringSize = isPulse ? 16 + (1 - visual.ringStrength) * 24 : 16 + visual.ringStrength * 10
            const ringOpacity = isPulse ? visual.ringStrength : 0.35 + visual.ringStrength * 0.65
            return (
              <Fragment key={device.nodeId}>
                {/* The fixture's own saved Light Output, faded in. Rendered here rather than on the
                    annotation so the per-frame clock never re-renders the viewer, and so Stop
                    leaves nothing behind — the annotation's stored meta is only ever read. */}
                {lightingEffectsVisible && appearance && visual.glowOpacity > 0 && (
                  <div
                    className="absolute pointer-events-none select-none"
                    style={{
                      left: `${appearance.rect.x * 100}%`,
                      top: `${appearance.rect.y * 100}%`,
                      width: `${appearance.rect.w * 100}%`,
                      height: `${appearance.rect.h * 100}%`,
                      zIndex: 25,
                    }}
                    aria-hidden="true"
                  >
                    <svg
                      className="absolute inset-0 overflow-visible"
                      viewBox="0 0 100 100"
                      width="100%"
                      height="100%"
                      preserveAspectRatio="xMidYMid meet"
                    >
                      <defs>
                        <radialGradient id={`playback-glow-${device.nodeId}`} cx="50%" cy="50%" r="50%">
                          {GLOW_STOPS.map((stop) => (
                            <stop
                              key={stop.offset}
                              offset={stop.offset}
                              stopColor={appearance.glowColor}
                              stopOpacity={stop.opacity * visual.glowOpacity}
                            />
                          ))}
                        </radialGradient>
                      </defs>
                      <circle
                        cx={50}
                        cy={50}
                        r={appearance.glowRadius * visual.glowRadiusFraction}
                        fill={`url(#playback-glow-${device.nodeId})`}
                        stroke="none"
                      />
                    </svg>
                  </div>
                )}
                <div
                  className={`absolute pointer-events-none select-none -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${visual.kind === 'ready' ? 'border-dashed' : ''}`}
                  style={{
                    left: `${device.point.x * 100}%`,
                    top: `${device.point.y * 100}%`,
                    width: `${ringSize}px`,
                    height: `${ringSize}px`,
                    borderColor: ringColor,
                    zIndex: 27,
                    opacity: ringOpacity,
                    ...(visual.kind === 'ready' ? {} : { boxShadow: `0 0 ${6 + visual.ringStrength * 10}px ${ringColor}` }),
                  }}
                  aria-hidden="true"
                />
              </Fragment>
            )
          })}
        </>,
        overlayTarget,
      )}
    </>
  )
}

export default PackageAnimationPlaybackControls
