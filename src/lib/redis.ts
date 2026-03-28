import { Redis } from '@upstash/redis'

const redisUrl   = import.meta.env.VITE_UPSTASH_REDIS_URL   as string | undefined
const redisToken = import.meta.env.VITE_UPSTASH_REDIS_TOKEN as string | undefined

// ── Redis client (Upstash serverless) ────────────────────────────────────────
// Used for:
//   Layer 1 memory: active agent context (TTL 4h)
//   Session state:  post-passcode session tokens (TTL 24h)
//   Real-time flags: LEDGER overdue, CHRONO conflicts (TTL 12h)
//   NEXUS threads:  conversation history per org (TTL 2h)
//   Rate limiting:  per-agent, per-org (TTL 60s)
//
// In environments without Redis configured (dev / test), all operations
// are no-ops that return null. This prevents crashing the dev server
// before Upstash is wired up.
// ─────────────────────────────────────────────────────────────────────────────

let _redis: Redis | null = null

function getRedis(): Redis | null {
  if (_redis) return _redis
  if (!redisUrl || !redisToken) {
    if (import.meta.env.DEV) {
      console.warn('[Redis] VITE_UPSTASH_REDIS_URL / TOKEN not set — Redis is disabled in dev')
    }
    return null
  }
  _redis = new Redis({ url: redisUrl, token: redisToken })
  return _redis
}

// ── Key schema ───────────────────────────────────────────────────────────────
// All keys follow a consistent namespaced pattern for easy wildcard scanning.
export const redisKeys = {
  /** Agent short-term context: 4h TTL */
  agentContext: (orgId: string, agentId: string) =>
    `agent:context:${orgId}:${agentId}`,

  /** App session after successful passcode/biometric: 24h TTL */
  session: (sessionId: string) =>
    `session:${sessionId}`,

  /** Real-time flag set per org: 12h TTL */
  flags: (orgId: string) =>
    `flags:${orgId}`,

  /** NEXUS conversation thread: 2h TTL */
  conversation: (orgId: string, threadId: string) =>
    `conversation:${orgId}:${threadId}`,

  /** Rate limiter counter: 60s TTL */
  rateLimit: (orgId: string, agentId: string) =>
    `ratelimit:${orgId}:${agentId}`,

  /** Passcode lockout: 15min TTL */
  passcodeLock: (userId: string) =>
    `lock:passcode:${userId}`,

  /** Failed attempt counter: 15min TTL */
  failedAttempts: (userId: string) =>
    `attempts:passcode:${userId}`,
}

// ── TTL constants (seconds) ──────────────────────────────────────────────────
export const TTL = {
  AGENT_CONTEXT:  4  * 60 * 60,   // 4 hours
  SESSION:        24 * 60 * 60,   // 24 hours
  FLAGS:          12 * 60 * 60,   // 12 hours
  CONVERSATION:   2  * 60 * 60,   // 2 hours
  RATE_LIMIT:     60,             // 1 minute
  PASSCODE_LOCK:  15 * 60,        // 15 minutes
} as const

// ── Type-safe wrappers ───────────────────────────────────────────────────────

/** Set a JSON value with TTL. Returns false if Redis unavailable. */
export async function rSet<T>(key: string, value: T, ttlSeconds: number): Promise<boolean> {
  const r = getRedis()
  if (!r) return false
  try {
    await r.setex(key, ttlSeconds, JSON.stringify(value))
    return true
  } catch (err) {
    console.error('[Redis] rSet error', key, err)
    return false
  }
}

/** Get and parse a JSON value. Returns null if missing or Redis unavailable. */
export async function rGet<T>(key: string): Promise<T | null> {
  const r = getRedis()
  if (!r) return null
  try {
    const raw = await r.get<string>(key)
    if (raw === null || raw === undefined) return null
    return typeof raw === 'string' ? JSON.parse(raw) as T : raw as T
  } catch (err) {
    console.error('[Redis] rGet error', key, err)
    return null
  }
}

/** Delete a key. Returns false if Redis unavailable. */
export async function rDel(key: string): Promise<boolean> {
  const r = getRedis()
  if (!r) return false
  try {
    await r.del(key)
    return true
  } catch (err) {
    console.error('[Redis] rDel error', key, err)
    return false
  }
}

/** Increment a counter with optional TTL. Returns new value or null. */
export async function rIncr(key: string, ttlSeconds?: number): Promise<number | null> {
  const r = getRedis()
  if (!r) return null
  try {
    const val = await r.incr(key)
    if (ttlSeconds && val === 1) {
      await r.expire(key, ttlSeconds)
    }
    return val
  } catch (err) {
    console.error('[Redis] rIncr error', key, err)
    return null
  }
}

/** Refresh TTL on an existing key. */
export async function rExpire(key: string, ttlSeconds: number): Promise<boolean> {
  const r = getRedis()
  if (!r) return false
  try {
    await r.expire(key, ttlSeconds)
    return true
  } catch (err) {
    console.error('[Redis] rExpire error', key, err)
    return false
  }
}

export { getRedis }
