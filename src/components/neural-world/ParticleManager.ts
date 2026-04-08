/**
 * ParticleManager.ts — NW15: Global particle cap + FPS auto-reduction.
 *
 * Singleton that tracks total active particles across all Neural World layers.
 * Rules:
 *   - Hard cap: MAX_PARTICLES = 5000 total across all layers
 *   - FPS watchdog: if FPS drops below 30 for 3 consecutive seconds,
 *     emit 'nw:reduce-particles' event (50% reduction request)
 *   - Layers should call registerParticles() / unregisterParticles() and
 *     subscribe to 'nw:reduce-particles' to halve their counts
 */

const MAX_PARTICLES = 5000

// ── Participant registry ──────────────────────────────────────────────────────

interface ParticleEntry {
  label: string
  count: number
}

const registry = new Map<string, ParticleEntry>()
let totalParticles = 0

/** Register/update a particle source's count. Returns allowed count (may be capped). */
export function registerParticles(id: string, label: string, requested: number): number {
  const existing = registry.get(id)
  const prev = existing?.count ?? 0
  const headroom = MAX_PARTICLES - (totalParticles - prev)
  const allowed = Math.max(0, Math.min(requested, headroom))
  registry.set(id, { label, count: allowed })
  totalParticles = 0
  for (const e of registry.values()) totalParticles += e.count
  return allowed
}

/** Remove a particle source from the registry. */
export function unregisterParticles(id: string): void {
  const entry = registry.get(id)
  if (entry) {
    totalParticles = Math.max(0, totalParticles - entry.count)
    registry.delete(id)
  }
}

/** Returns current total registered particle count. */
export function getTotalParticles(): number {
  return totalParticles
}

// ── FPS watchdog ──────────────────────────────────────────────────────────────

const FPS_THRESHOLD     = 30      // FPS below this triggers reduction
const FPS_WATCH_SECONDS = 3       // consecutive low-FPS seconds before action
const COOLDOWN_SECONDS  = 10      // minimum seconds between reductions

let lowFpsFrames  = 0
let lastFpsWindow = performance.now()
let frameCount    = 0
let lastReductionTime = 0
let watchdogActive = false

function onFrame() {
  frameCount++
  const now = performance.now()
  const elapsed = now - lastFpsWindow
  if (elapsed >= 1000) {
    const fps = Math.round(frameCount * 1000 / elapsed)
    frameCount    = 0
    lastFpsWindow = now

    if (fps < FPS_THRESHOLD) {
      lowFpsFrames++
      if (lowFpsFrames >= FPS_WATCH_SECONDS) {
        const cooldownOk = (now - lastReductionTime) > COOLDOWN_SECONDS * 1000
        if (cooldownOk && totalParticles > 100) {
          lastReductionTime = now
          lowFpsFrames      = 0
          console.warn(
            `[ParticleManager] FPS ${fps} below threshold for ${FPS_WATCH_SECONDS}s — ` +
            `requesting 50% particle reduction (total: ${totalParticles})`
          )
          window.dispatchEvent(new CustomEvent('nw:reduce-particles', {
            detail: { factor: 0.5, reason: 'fps_low', fps }
          }))
          // Also halve the registry so future registerParticles calls stay within cap
          for (const [id, entry] of registry) {
            registry.set(id, { ...entry, count: Math.floor(entry.count * 0.5) })
          }
          totalParticles = 0
          for (const e of registry.values()) totalParticles += e.count
        }
      }
    } else {
      lowFpsFrames = Math.max(0, lowFpsFrames - 1)
    }
  }
}

/** Call once to start the FPS watchdog (idempotent). */
export function startParticleWatchdog(): void {
  if (watchdogActive) return
  watchdogActive = true
  window.addEventListener('nw:frame', onFrame)
}

/** Stop the FPS watchdog (e.g. on unmount). */
export function stopParticleWatchdog(): void {
  if (!watchdogActive) return
  watchdogActive = false
  window.removeEventListener('nw:frame', onFrame)
  registry.clear()
  totalParticles = 0
  lowFpsFrames   = 0
}
