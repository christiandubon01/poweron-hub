/**
 * src/features/blueprint-vr/useBlueprintVRGeneration.ts
 *
 * Client-side generation state machine hook for Blueprint VR feature.
 *
 * This hook manages the lifecycle of a VR generation job, tracking progress
 * through multiple stages: extracting, underground, roughIn, trim, finished, complete.
 *
 * Currently simulates stage progression deterministically.
 * Future service integrations are marked with TODO: SERVICE_CALL comments.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import type { VRGenerationJob, VRStage, BlueprintSource, VRSceneManifest } from './types'

/**
 * Internal stage in the generation pipeline.
 * Includes both the final VR stages plus intermediate processing stages.
 */
type GenerationStage = 'extracting' | VRStage | 'complete'

/**
 * Status of a single generation stage.
 */
interface StageStatus {
  stage: GenerationStage
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number // 0-100
  error?: string
}

/**
 * State returned by the useBlueprintVRGeneration hook.
 */
export interface BlueprintVRGenerationState {
  // ── Current Job ────────────────────────────────────────────────────────────
  currentJob: VRGenerationJob | null

  // ── Stage Status ───────────────────────────────────────────────────────────
  stageStatuses: StageStatus[]

  // ── Progress ───────────────────────────────────────────────────────────────
  /** Overall progress as percentage (0-100) */
  progressPercentage: number

  // ── Lifecycle Timestamps ───────────────────────────────────────────────────
  startedAt: string | null
  completedAt: string | null

  // ── Error State ────────────────────────────────────────────────────────────
  error: string | null

  // ── Actions ────────────────────────────────────────────────────────────────
  /** Start a new VR generation job */
  startGeneration: (input: GenerationInput) => void

  /** Reset generation state to initial condition */
  resetGeneration: () => void
}

/**
 * Input parameters for starting a generation job.
 */
export interface GenerationInput {
  projectId?: string
  projectName?: string
  sourceBlueprints: BlueprintSource[]
  stages: VRStage[]
  outputManifest?: VRSceneManifest
}

/**
 * Ordered stages through which a generation job progresses.
 */
const GENERATION_PIPELINE: GenerationStage[] = [
  'extracting',
  'underground',
  'roughIn',
  'trim',
  'finished',
  'complete',
]

/**
 * Duration (in ms) for each stage simulation.
 * Adjusted for realistic but demo-friendly progression.
 */
const STAGE_DURATIONS: Record<GenerationStage, number> = {
  extracting: 3000,
  underground: 2000,
  roughIn: 2000,
  trim: 2000,
  finished: 2000,
  complete: 500,
}

/**
 * useBlueprintVRGeneration
 *
 * Manages VR generation lifecycle including blueprint extraction,
 * multi-stage VR generation, and rendering.
 *
 * @returns Blueprint VR generation state and control functions
 *
 * @example
 * const {
 *   currentJob,
 *   stageStatuses,
 *   progressPercentage,
 *   startGeneration,
 *   resetGeneration,
 * } = useBlueprintVRGeneration()
 *
 * return (
 *   <div>
 *     <button onClick={() => startGeneration({
 *       projectName: 'House A',
 *       sourceBlueprints: [{ id: '1', name: 'electrical.pdf' }],
 *       stages: ['underground', 'roughIn', 'trim', 'finished'],
 *     })}>
 *       Generate VR
 *     </button>
 *     <ProgressBar value={progressPercentage} />
 *   </div>
 * )
 */
export function useBlueprintVRGeneration(): BlueprintVRGenerationState {
  // ── State ──────────────────────────────────────────────────────────────────
  const [currentJob, setCurrentJob] = useState<VRGenerationJob | null>(null)
  const [stageStatuses, setStageStatuses] = useState<StageStatus[]>([])
  const [error, setError] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState<string | null>(null)
  const [completedAt, setCompletedAt] = useState<string | null>(null)

  // ── Refs ───────────────────────────────────────────────────────────────────
  // Track timeouts for cleanup on unmount
  const timeoutRefs = useRef<ReturnType<typeof setInterval>[]>([])
  const isRunningRef = useRef(false)

  /**
   * Calculate overall progress percentage across all stages.
   * Weighted by duration to give realistic progression sense.
   */
  const calculateProgressPercentage = useCallback((): number => {
    if (stageStatuses.length === 0) return 0

    const totalDuration = Object.values(STAGE_DURATIONS).reduce((a, b) => a + b, 0)
    let completedDuration = 0

    for (const stage of stageStatuses) {
      if (stage.status === 'completed') {
        completedDuration += STAGE_DURATIONS[stage.stage]
      } else if (stage.status === 'running') {
        completedDuration += (STAGE_DURATIONS[stage.stage] * stage.progress) / 100
      }
    }

    return Math.min(100, Math.round((completedDuration / totalDuration) * 100))
  }, [stageStatuses])

  /**
   * Simulate progression through a single stage.
   * TODO: SERVICE_CALL — Replace with actual API call to AI extraction/render service.
   */
  const simulateStageProgression = useCallback(
    (stage: GenerationStage, onComplete: () => void) => {
      const duration = STAGE_DURATIONS[stage]
      const steps = 10 // Update progress in 10 increments
      const stepDuration = duration / steps
      let step = 0

      const progressInterval = setInterval(() => {
        step += 1
        const progress = (step / steps) * 100

        setStageStatuses(prev =>
          prev.map(s =>
            s.stage === stage
              ? { ...s, progress: Math.min(100, progress) }
              : s
          )
        )

        if (step >= steps) {
          clearInterval(progressInterval)
          setStageStatuses(prev =>
            prev.map(s =>
              s.stage === stage
                ? { ...s, status: 'completed', progress: 100 }
                : s
            )
          )
          onComplete()
        }
      }, stepDuration)

      timeoutRefs.current.push(progressInterval)
    },
    []
  )

  /**
   * Sequentially process all stages in the generation pipeline.
   * TODO: SERVICE_CALL — When actual services are available, invoke them here.
   */
  const processStages = useCallback(async () => {
    for (const stage of GENERATION_PIPELINE) {
      if (!isRunningRef.current) break

      // Mark current stage as running
      setStageStatuses(prev =>
        prev.map(s =>
          s.stage === stage ? { ...s, status: 'running' } : s
        )
      )

      // Wait for simulation to complete
      await new Promise<void>(resolve => {
        simulateStageProgression(stage, () => resolve())
      })

      // Update job.progress proportionally after each stage
      const stageIdx = GENERATION_PIPELINE.indexOf(stage) + 1
      const progressPct = Math.round((stageIdx / GENERATION_PIPELINE.length) * 100)
      setCurrentJob(prev => prev ? { ...prev, progress: progressPct } : null)

      // Small delay between stages for visual breathing room
      await new Promise<void>(resolve => {
        const timeout = setTimeout(() => resolve(), 300)
        timeoutRefs.current.push(timeout)
      })
    }

    // Mark generation as complete
    setCompletedAt(new Date().toISOString())
    setCurrentJob(prev =>
      prev
        ? {
            ...prev,
            status: 'complete',
            progress: 100,
            completedAt: new Date().toISOString(),
          }
        : null
    )
  }, [simulateStageProgression])

  /**
   * Start a new VR generation job.
   * Initializes job, sets up stage tracking, and begins simulation.
   */
  const startGeneration = useCallback((input: GenerationInput) => {
    // Prevent duplicate starts
    if (isRunningRef.current) {
      setError('Generation already in progress')
      return
    }

    // Clear any previous errors
    setError(null)

    // Create a new job ID
    const jobId = `vr-job-${Date.now()}`
    const now = ISOString()

    // Initialize the job
    const newJob: VRGenerationJob = {
      id: jobId,
      status: 'extracting',
      projectId: input.projectId,
      discipline: 'electrical',
      stages: input.stages,
      sourceBlueprints: input.sourceBlueprints,
      outputManifest: input.outputManifest,
      progress: 0,
      createdAt: now,
      startedAt: now,
    }

    setCurrentJob(newJob)
    setStartedAt(now)
    setCompletedAt(null)

    // Initialize stage statuses
    const initialStatuses: StageStatus[] = GENERATION_PIPELINE.map(stage => ({
      stage,
      status: 'pending' as const,
      progress: 0,
    }))

    setStageStatuses(initialStatuses)

    // Begin processing
    isRunningRef.current = true
    processStages().catch(err => {
      setError(err instanceof Error ? err.message : 'Unknown error during generation')
      isRunningRef.current = false
    })
  }, [processStages])

  /**
   * Reset generation state to initial condition.
   * Clears all timeouts and returns to idle state.
   */
  const resetGeneration = useCallback(() => {
    // Cancel all pending timeouts and intervals
    timeoutRefs.current.forEach(timeout => {
      clearInterval(timeout)
    })
    timeoutRefs.current = []

    // Reset state
    isRunningRef.current = false
    setCurrentJob(null)
    setStageStatuses([])
    setError(null)
    setStartedAt(null)
    setCompletedAt(null)
  }, [])

  /**
   * Cleanup on unmount: clear all timeouts.
   */
  useEffect(() => {
    return () => {
      timeoutRefs.current.forEach(timeout => {
        clearInterval(timeout)
      })
      isRunningRef.current = false
    }
  }, [])

  // ── Return ────────────────────────────────────────────────────────────────
  return {
    currentJob,
    stageStatuses,
    progressPercentage: calculateProgressPercentage(),
    startedAt,
    completedAt,
    error,
    startGeneration,
    resetGeneration,
  }
}

/**
 * Helper to get ISO timestamp string.
 * Separated for easier mocking in tests.
 */
function ISOString(): string {
  return new Date().toISOString()
}
