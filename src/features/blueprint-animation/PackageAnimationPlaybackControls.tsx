import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createPlaybackLoopController, type PlaybackLoopController } from './playbackLoopController'
import type { RouteBuilderAnnotation } from './routeBuilderModel'
import { preparePlaybackGeometry } from './playbackGeometry'
import { calculatePlaybackFrame, createPlaybackTimeline, type PlaybackFrame, type PlaybackTimeline } from './playbackModel'
import { parseBlueprintAnimationScene } from './sceneSchema'
import {
  buildPlaybackActivationEventNodeIds,
  classifyPlaybackNodeVisualRole,
  resolvePlaybackDeviceVisual,
  type PlaybackDeviceVisualKind,
  type PlaybackFixtureAppearance,
} from './playbackFixtureAppearance'
import {
  PLAYBACK_PATH_PULSE_DURATION_MS,
  PLAYBACK_PATH_PULSE_OPACITIES,
  PLAYBACK_PATH_SOLID_OPACITY,
  PLAYBACK_PATH_STROKE_WIDTH,
  buildPlaybackRouteEdgeAppearanceMap,
  resolvePlaybackOrbColor,
  resolvePlaybackPathState,
  type PlaybackRouteEdgeAppearance,
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

export interface PlaybackRouteOverlayProps {
  frame: PlaybackFrame
  steps: PlaybackTimeline['steps']
  routeEdgeAppearances: ReadonlyMap<string, PlaybackRouteEdgeAppearance>
  currentPage: number
  pageWidth: number
  pageHeight: number
  overlayWidth: number
  overlayHeight: number
  reducedMotion?: boolean
  playing?: boolean
}

function stepRenderPoints(step: PlaybackTimeline['steps'][number]) {
  return step.geometry?.renderPoints ?? [step.start, step.end]
}

export function PlaybackRouteOverlay({
  frame,
  steps,
  routeEdgeAppearances,
  currentPage,
  pageWidth,
  pageHeight,
  overlayWidth,
  overlayHeight,
  reducedMotion,
  playing,
}: PlaybackRouteOverlayProps) {
  const energizedEdgesByStepId = new Map((frame.energizedEdges ?? []).map((edge) => [edge.step.id, edge]))
  return (
    <svg
      className="absolute inset-0 pointer-events-none overflow-visible select-none"
      width={overlayWidth}
      height={overlayHeight}
      viewBox={`0 0 ${pageWidth} ${pageHeight}`}
      style={{ zIndex: 26 }}
      aria-hidden="true"
      data-playback-route-overlay="true"
    >
      {steps.filter((step) => step.pageNumber === currentPage).map((step) => {
        const points = stepRenderPoints(step).map((point) => `${point.x * pageWidth},${point.y * pageHeight}`).join(' ')
        const pathState = resolvePlaybackPathState({
          elapsedMs: frame.elapsedMs,
          travelStartMs: step.travelStartMs,
          travelEndMs: step.travelEndMs,
          reducedMotion,
        })
        const energizedEdge = energizedEdgesByStepId.get(step.id)
        const solidProgress = pathState === 'solid' ? 1 : energizedEdge?.progress ?? 0
        const stroke = routeEdgeAppearances.get(step.edgeId)?.overlayColor ?? '#facc15'
        const sharedProps = {
          points,
          fill: 'none',
          stroke,
          strokeWidth: PLAYBACK_PATH_STROKE_WIDTH,
          strokeLinecap: 'round' as const,
          strokeLinejoin: 'round' as const,
          pathLength: 1,
          vectorEffect: 'non-scaling-stroke' as const,
          pointerEvents: 'none' as const,
        }
        if (pathState === 'not-yet' || solidProgress <= 0) return null
        return (
          <Fragment key={step.id}>
            <polyline
              {...sharedProps}
              strokeWidth={PLAYBACK_PATH_STROKE_WIDTH + 8}
              strokeDasharray={solidProgress < 1 ? `${solidProgress} 1` : undefined}
              opacity={pathState === 'dim-pulsing' ? PLAYBACK_PATH_PULSE_OPACITIES[0] : 0.42}
              style={{ filter: `drop-shadow(0 0 6px ${stroke})` }}
              data-playback-route-glow={step.kind}
            >
              {pathState === 'dim-pulsing' && playing && (
                <animate
                  attributeName="opacity"
                  values={PLAYBACK_PATH_PULSE_OPACITIES.join(';')}
                  dur={`${PLAYBACK_PATH_PULSE_DURATION_MS}ms`}
                  repeatCount="indefinite"
                />
              )}
            </polyline>
            {pathState === 'solid' && (
              <polyline {...sharedProps} opacity={PLAYBACK_PATH_SOLID_OPACITY} data-playback-route-solid={step.kind} />
            )}
          </Fragment>
        )
      })}
      {frame.orbs.filter((orb) => orb.pageNumber === currentPage).map((orb) => {
        const stroke = resolvePlaybackOrbColor(routeEdgeAppearances.get(orb.edgeId))
        return (
          <circle
            key={orb.edgeId}
            cx={orb.point.x * pageWidth}
            cy={orb.point.y * pageHeight}
            r={7}
            fill="#ffffff"
            stroke={stroke}
            strokeWidth={3}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
            style={{ filter: `drop-shadow(0 0 6px ${stroke})` }}
            data-playback-orb="true"
          />
        )
      })}
    </svg>
  )
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
      // The source connector is the primary edge leaving the source node — structural, stable across
      // Playback adds an ephemeral glow over the route; the underlying Circuit Path/Arc keeps its
      // authored annotation color and style.
      return {
        timeline: createPlaybackTimeline(geometry, { ...parsed.scene.playbackOptions, loop: false }),
        nodeAnnotationIds,
        activationEventNodeIds: buildPlaybackActivationEventNodeIds(parsed.scene.events),
        routeEdgeAppearances: buildPlaybackRouteEdgeAppearanceMap(parsed.scene, annotations),
        error: undefined,
      }
    } catch (error) {
      return {
        timeline: undefined,
        nodeAnnotationIds,
        activationEventNodeIds: new Set<string>(),
        routeEdgeAppearances: new Map<string, { baseColor: string; overlayColor: string }>(),
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
  const playbackControllerRef = useRef<PlaybackLoopController | null>(null)

  useEffect(() => {
    playbackControllerRef.current?.dispose()
    playbackControllerRef.current = prepared.timeline
      ? createPlaybackLoopController({
          totalDurationMs: prepared.timeline.totalDurationMs,
          callbacks: {
            onElapsedMs: setElapsedMs,
            onStatus: (nextStatus) => setStatus(nextStatus),
          },
        })
      : null
    setElapsedMs(0)
    setStatus('idle')
    return () => {
      playbackControllerRef.current?.dispose()
      playbackControllerRef.current = null
    }
  }, [prepared.timeline])

  useEffect(() => {
    const controller = playbackControllerRef.current
    if (!active || !controller) {
      controller?.stop()
      return
    }
    controller.play()
  }, [active, prepared.timeline])

  const frame: PlaybackFrame | null = active && prepared.timeline
    ? calculatePlaybackFrame(prepared.timeline, elapsedMs)
    : null
  const playbackTimeline = prepared.timeline
  const play = () => {
    const controller = playbackControllerRef.current
    if (!prepared.timeline || !controller) return
    if (!active) {
      onActivate()
      return
    }
    controller.play()
  }
  const pause = () => {
    playbackControllerRef.current?.pause()
  }
  const resume = () => {
    playbackControllerRef.current?.resume()
  }
  const restart = () => {
    if (!active) {
      onActivate()
      return
    }
    playbackControllerRef.current?.restart()
  }
  const stop = () => {
    playbackControllerRef.current?.stop()
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
      {active && frame && playbackTimeline && overlayTarget && pageWidth > 0 && pageHeight > 0 && createPortal(
        <>
          <PlaybackRouteOverlay
            frame={frame}
            steps={playbackTimeline.steps}
            routeEdgeAppearances={prepared.routeEdgeAppearances}
            currentPage={currentPage}
            pageWidth={pageWidth}
            pageHeight={pageHeight}
            overlayWidth={overlayWidth}
            overlayHeight={overlayHeight}
            reducedMotion={playbackTimeline.options.reducedMotion}
            playing={status === 'playing'}
          />
          {frame.devices.map((device) => {
            if (device.pageNumber !== currentPage) return null
            const node = nodesById.get(device.nodeId)
            const visual = resolvePlaybackDeviceVisual({
              visualRole: classifyPlaybackNodeVisualRole(node?.roles, device.nodeId === playbackTimeline.sourceNodeId),
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
