export type PlaybackLoopStatus = 'idle' | 'playing' | 'paused' | 'complete'

export interface PlaybackLoopRuntime {
  requestAnimationFrame(callback: FrameRequestCallback): number
  cancelAnimationFrame(handle: number): void
  setTimeout?(callback: () => void, delayMs: number): number
  clearTimeout?(handle: number): void
}

export interface PlaybackLoopControllerCallbacks {
  onElapsedMs(elapsedMs: number): void
  onStatus(status: PlaybackLoopStatus): void
  onCycleReset?(cycleIndex: number): void
  onCycleStart?(cycleIndex: number): void
  onCycleComplete?(cycleIndex: number): void
}

export interface PlaybackLoopController {
  play(): void
  pause(): void
  resume(): void
  restart(): void
  stop(): void
  dispose(): void
  schedulePlaybackTimeout(callback: () => void, delayMs: number): number | null
  getSnapshot(): {
    sessionId: number
    status: PlaybackLoopStatus
    cycleIndex: number
    elapsedMs: number
    activeFrameCount: number
    activeTimeoutCount: number
  }
}

function defaultRuntime(): PlaybackLoopRuntime {
  return {
    requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
    cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (handle) => window.clearTimeout(handle),
  }
}

export function createPlaybackLoopController(options: {
  totalDurationMs: number
  runtime?: PlaybackLoopRuntime
  callbacks: PlaybackLoopControllerCallbacks
}): PlaybackLoopController {
  const runtime = options.runtime ?? defaultRuntime()
  const totalDurationMs = Math.max(0, Number.isFinite(options.totalDurationMs) ? options.totalDurationMs : 0)
  let sessionId = 0
  let status: PlaybackLoopStatus = 'idle'
  let cycleIndex = 0
  let elapsedMs = 0
  let startedAt: number | null = null
  let accumulatedMs = 0
  let frameHandle: number | null = null
  let restartFrameHandle: number | null = null
  const timeoutHandles = new Set<number>()

  const cancelFrames = () => {
    if (frameHandle != null) runtime.cancelAnimationFrame(frameHandle)
    if (restartFrameHandle != null) runtime.cancelAnimationFrame(restartFrameHandle)
    frameHandle = null
    restartFrameHandle = null
  }

  const clearPlaybackTimeouts = () => {
    if (!runtime.clearTimeout) {
      timeoutHandles.clear()
      return
    }
    timeoutHandles.forEach((handle) => runtime.clearTimeout?.(handle))
    timeoutHandles.clear()
  }

  const invalidate = () => {
    sessionId += 1
    cancelFrames()
    clearPlaybackTimeouts()
  }

  const setElapsed = (nextElapsedMs: number) => {
    elapsedMs = Math.max(0, nextElapsedMs)
    options.callbacks.onElapsedMs(elapsedMs)
  }

  const setStatus = (nextStatus: PlaybackLoopStatus) => {
    status = nextStatus
    options.callbacks.onStatus(status)
  }

  const resetCycle = () => {
    startedAt = null
    accumulatedMs = 0
    setElapsed(0)
    options.callbacks.onCycleReset?.(cycleIndex)
  }

  const scheduleTick = (activeSessionId: number) => {
    frameHandle = runtime.requestAnimationFrame((timestamp) => tick(activeSessionId, timestamp))
  }

  const startCycle = (activeSessionId: number) => {
    if (activeSessionId !== sessionId || status !== 'playing') return
    resetCycle()
    cycleIndex += 1
    options.callbacks.onCycleStart?.(cycleIndex)
    if (totalDurationMs <= 0) {
      options.callbacks.onCycleComplete?.(cycleIndex)
      setStatus('complete')
      frameHandle = null
      return
    }
    scheduleTick(activeSessionId)
  }

  const queueNextCycle = (activeSessionId: number) => {
    resetCycle()
    restartFrameHandle = runtime.requestAnimationFrame(() => {
      restartFrameHandle = null
      startCycle(activeSessionId)
    })
  }

  const tick = (activeSessionId: number, timestamp: number) => {
    if (activeSessionId !== sessionId || status !== 'playing') return
    if (startedAt == null) startedAt = timestamp
    const nextElapsedMs = accumulatedMs + timestamp - startedAt
    if (nextElapsedMs >= totalDurationMs) {
      setElapsed(totalDurationMs)
      options.callbacks.onCycleComplete?.(cycleIndex)
      frameHandle = null
      queueNextCycle(activeSessionId)
      return
    }
    setElapsed(nextElapsedMs)
    scheduleTick(activeSessionId)
  }

  return {
    play() {
      invalidate()
      setStatus('playing')
      startCycle(sessionId)
    },
    pause() {
      if (status !== 'playing') return
      if (frameHandle != null) runtime.cancelAnimationFrame(frameHandle)
      frameHandle = null
      accumulatedMs = elapsedMs
      startedAt = null
      setStatus('paused')
    },
    resume() {
      if (status !== 'paused') return
      setStatus('playing')
      scheduleTick(sessionId)
    },
    restart() {
      invalidate()
      setStatus('playing')
      startCycle(sessionId)
    },
    stop() {
      invalidate()
      cycleIndex = 0
      resetCycle()
      setStatus('idle')
    },
    dispose() {
      invalidate()
      setStatus('idle')
    },
    schedulePlaybackTimeout(callback, delayMs) {
      if (!runtime.setTimeout) return null
      const activeSessionId = sessionId
      const handle = runtime.setTimeout(() => {
        timeoutHandles.delete(handle)
        if (activeSessionId === sessionId) callback()
      }, delayMs)
      timeoutHandles.add(handle)
      return handle
    },
    getSnapshot() {
      return {
        sessionId,
        status,
        cycleIndex,
        elapsedMs,
        activeFrameCount: (frameHandle == null ? 0 : 1) + (restartFrameHandle == null ? 0 : 1),
        activeTimeoutCount: timeoutHandles.size,
      }
    },
  }
}
