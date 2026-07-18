// ── Redis: server-side only as of SEC2 ───────────────────────────────────────
//
// This module used to construct an Upstash client in the browser from
// VITE_UPSTASH_REDIS_URL / VITE_UPSTASH_REDIS_TOKEN. That token is a full
// read/write REST credential and shipped inside the public bundle, so anyone
// could read or overwrite sessions and passcode lockout counters.
//
// All live Redis access now goes through /.netlify/functions/session-store,
// which holds the token in process.env and derives every key from the caller's
// verified JWT. See src/lib/auth/sessionStoreClient.ts.
//
// The key schema and TTL tables below are kept as the shared reference for the
// key names the server builds.
//
// The rXxx() wrappers remain only so the two legacy modules that still import
// them keep compiling — src/services/cacheService.ts and
// src/lib/memory/redis-context.ts, neither of which is imported anywhere in the
// app. They are no-ops that return exactly what they already returned in any
// environment without Upstash credentials configured (null / false), which is
// the documented "degrade gracefully" behaviour of both callers. If either
// module is ever revived, give it a session-store intent instead of restoring a
// browser-side Redis client.
// ─────────────────────────────────────────────────────────────────────────────

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

// ── Legacy no-op wrappers (see header) ───────────────────────────────────────

/** No-op. Redis writes moved server-side in SEC2. */
export async function rSet<T>(_key: string, _value: T, _ttlSeconds: number): Promise<boolean> {
  return false
}

/** No-op. Redis reads moved server-side in SEC2. */
export async function rGet<T>(_key: string): Promise<T | null> {
  return null
}

/** No-op. Redis deletes moved server-side in SEC2. */
export async function rDel(_key: string): Promise<boolean> {
  return false
}

/** No-op. Counter increments moved server-side in SEC2. */
export async function rIncr(_key: string, _ttlSeconds?: number): Promise<number | null> {
  return null
}

/** No-op. TTL refreshes moved server-side in SEC2. */
export async function rExpire(_key: string, _ttlSeconds: number): Promise<boolean> {
  return false
}
