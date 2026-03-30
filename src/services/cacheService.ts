// @ts-nocheck
/**
 * Cache Service — Phase F Redis caching layer using Upstash.
 *
 * Wraps @/lib/redis.ts with a simpler get/set/invalidate API and adds
 * named key helpers for the specific Phase F caching requirements:
 *
 *   - NEXUS conversation context  (key: nexus:context:{userId}, TTL: 1 hour)
 *   - getPatterns() result         (key: patterns:{orgId}, TTL: 15 minutes)
 *   - Agent capability map         (key: capabilities, TTL: 24 hours)
 *
 * All operations degrade gracefully when Redis is unavailable (no Upstash
 * credentials configured). Never throws.
 */

import { rGet, rSet, rDel, TTL as REDIS_TTL } from '@/lib/redis'

// ── TTL constants for Phase F (seconds) ──────────────────────────────────────
export const CACHE_TTL = {
  NEXUS_CONTEXT:    1  * 60 * 60,  // 1 hour
  PATTERNS:         15 * 60,       // 15 minutes
  CAPABILITIES:     24 * 60 * 60,  // 24 hours
  AGENT_CONTEXT:    REDIS_TTL.AGENT_CONTEXT,
  SESSION:          REDIS_TTL.SESSION,
} as const

// ── Key builders ──────────────────────────────────────────────────────────────
export const cacheKeys = {
  nexusContext:    (userId: string) => `nexus:context:${userId}`,
  patterns:        (orgId: string)  => `patterns:${orgId}`,
  capabilities:    ()               => `capabilities`,
  agentContext:    (orgId: string, agentId: string) => `agent:context:${orgId}:${agentId}`,
}

// ── Core API ──────────────────────────────────────────────────────────────────

/**
 * Get a cached value. Returns null if missing, expired, or Redis unavailable.
 */
export async function get<T = unknown>(key: string): Promise<T | null> {
  try {
    return await rGet<T>(key)
  } catch {
    return null
  }
}

/**
 * Store a value with a TTL in seconds.
 * Returns false if Redis unavailable (non-critical).
 */
export async function set<T = unknown>(
  key: string,
  value: T,
  ttlSeconds: number
): Promise<boolean> {
  try {
    return await rSet(key, value, ttlSeconds)
  } catch {
    return false
  }
}

/**
 * Delete a cached key. Returns false if Redis unavailable.
 */
export async function invalidate(key: string): Promise<boolean> {
  try {
    return await rDel(key)
  } catch {
    return false
  }
}

// ── Higher-level helpers ──────────────────────────────────────────────────────

/**
 * Cache-wrapped getter — reads from cache, calls loader on miss, writes result.
 * Useful for wrapping expensive operations.
 *
 * @example
 *   const patterns = await cached(
 *     cacheKeys.patterns(orgId),
 *     CACHE_TTL.PATTERNS,
 *     () => getPatterns(orgId)
 *   )
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>
): Promise<T> {
  // Check cache
  const hit = await get<T>(key)
  if (hit !== null) {
    return hit
  }
  // Cache miss — call loader
  const value = await loader()
  // Store result (fire-and-forget)
  set(key, value, ttlSeconds).catch(() => { /* non-critical */ })
  return value
}

// ── Named helpers used by Phase F components ──────────────────────────────────

/**
 * Get NEXUS conversation context for a user.
 * Returns null if cache miss or Redis unavailable.
 */
export async function getNexusContext(userId: string): Promise<unknown> {
  return get(cacheKeys.nexusContext(userId))
}

/**
 * Store NEXUS conversation context for a user (TTL: 1 hour).
 */
export async function setNexusContext(userId: string, context: unknown): Promise<void> {
  await set(cacheKeys.nexusContext(userId), context, CACHE_TTL.NEXUS_CONTEXT)
}

/**
 * Invalidate NEXUS context for a user (e.g. on logout or reset).
 */
export async function invalidateNexusContext(userId: string): Promise<void> {
  await invalidate(cacheKeys.nexusContext(userId))
}

/**
 * Get cached patterns for an org.
 */
export async function getCachedPatterns(orgId: string): Promise<unknown> {
  return get(cacheKeys.patterns(orgId))
}

/**
 * Store patterns for an org (TTL: 15 minutes).
 * Called by patternService.getPatterns() on successful load.
 */
export async function setCachedPatterns(orgId: string, patterns: unknown): Promise<void> {
  await set(cacheKeys.patterns(orgId), patterns, CACHE_TTL.PATTERNS)
}

/**
 * Invalidate cached patterns for an org.
 * Call this after analyzeAfterWrite() completes.
 */
export async function invalidateCachedPatterns(orgId: string): Promise<void> {
  await invalidate(cacheKeys.patterns(orgId))
}

/**
 * Get cached agent capability map.
 */
export async function getCachedCapabilities(): Promise<unknown> {
  return get(cacheKeys.capabilities())
}

/**
 * Store agent capability map (TTL: 24 hours).
 */
export async function setCachedCapabilities(capabilities: unknown): Promise<void> {
  await set(cacheKeys.capabilities(), capabilities, CACHE_TTL.CAPABILITIES)
}
