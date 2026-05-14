/**
 * src/features/blueprint-vr/blueprintVRProjectModelCache.ts
 *
 * Lightweight in-memory cache for Generate VR results keyed by
 * (project, source set). The Generate VR experience reads this cache so that
 * switching pages inside the same project does not re-generate a brand-new
 * model — only an explicit source-set change or rescan invalidates the cache.
 *
 * Scope:
 *  - Session-only, module-level Map. Cleared on full page reload.
 *  - No backend persistence; no external services.
 *  - Deterministic key format keeps cache lookups stable.
 *
 * The cache stores both the generated BlueprintBuildingModel and the scan
 * result that produced it, so warnings / confidence can be re-displayed
 * without rescanning.
 */

import type { BlueprintBuildingModel } from './buildingModel'
import type {
  BlueprintPlanScanResult,
  BlueprintFullSetScanResult,
} from './blueprintPlanScanner'

// ---------------------------------------------------------------------------
// Cache entry shape
// ---------------------------------------------------------------------------

export interface BlueprintVRProjectCacheEntry {
  /** Cache key used to look up / store this entry. */
  key: string
  /** Short stable key hash for status/debug display. */
  keyHash: string
  /** Full source identity used to produce this cache entry. */
  sourceIdentity: BlueprintVRCacheIdentity
  /** Generated building model. */
  model: BlueprintBuildingModel
  /** Plan scan result that produced this model. */
  scan: BlueprintPlanScanResult
  /** Optional full-set scan result when available. */
  fullSetScan?: BlueprintFullSetScanResult
  /** How this model was derived for scanner transparency. */
  modelDerivation?: 'fallback-derived' | 'inferred-derived' | 'trace-derived'
  /** Display label (e.g. "Full Set", or set title). */
  sourceSetLabel?: string
  /** When the cache entry was created (ISO timestamp). */
  generatedAt: string
}

export interface BlueprintVRCacheIdentity {
  projectId?: string | null
  sourceSetId?: string | null
  sourceSetName?: string | null
  blueprintId?: string | null
  fileName?: string | null
  selectedFloorPlanPage?: number | null
  pageCount?: number | null
  scannerVersion?: string | null
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

function safeKey(value: string | null | undefined): string {
  if (!value) return 'unknown'
  return String(value).trim().toLowerCase().replace(/\s+/g, '-')
}

function safeCount(value: number | null | undefined): string {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 'na'
  return String(Math.floor(parsed))
}

function hashKey(input: string): string {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function buildBlueprintVRCacheIdentityKey(identity: BlueprintVRCacheIdentity): string {
  return [
    safeKey(identity.projectId || undefined),
    safeKey(identity.sourceSetId || undefined),
    safeKey(identity.sourceSetName || undefined),
    safeKey(identity.blueprintId || undefined),
    safeKey(identity.fileName || undefined),
    safeCount(identity.selectedFloorPlanPage || undefined),
    safeCount(identity.pageCount || undefined),
    safeKey(identity.scannerVersion || undefined),
  ].join('::')
}

/**
 * Build a cache key from project + source set identifiers. The same project /
 * source set pair always produces the same key.
 */
export function getBlueprintVRCacheKey(
  identityOrProjectKey: BlueprintVRCacheIdentity | string | null | undefined,
  sourceSetKey?: string | null | undefined,
): string {
  if (typeof identityOrProjectKey === 'object' && identityOrProjectKey !== null) {
    return buildBlueprintVRCacheIdentityKey(identityOrProjectKey)
  }
  return `${safeKey(identityOrProjectKey || undefined)}::${safeKey(sourceSetKey || undefined)}`
}

// ---------------------------------------------------------------------------
// Cache storage (module-level)
// ---------------------------------------------------------------------------

const cache = new Map<string, BlueprintVRProjectCacheEntry>()

/**
 * Look up a cached entry by project + source-set keys.
 */
export function getCachedProjectModel(
  identityOrProjectKey: BlueprintVRCacheIdentity | string | null | undefined,
  sourceSetKey?: string | null | undefined,
): BlueprintVRProjectCacheEntry | undefined {
  return cache.get(getBlueprintVRCacheKey(identityOrProjectKey, sourceSetKey))
}

/**
 * Store a generated model for a project + source-set pair. Replaces any
 * existing entry with the same key.
 */
export function setCachedProjectModel(
  identityOrProjectKey: BlueprintVRCacheIdentity | string | null | undefined,
  sourceSetKeyOrEntry:
    | string
    | null
    | undefined
    | (Omit<BlueprintVRProjectCacheEntry, 'key' | 'keyHash' | 'sourceIdentity' | 'generatedAt'> & {
        sourceSetLabel?: string
      }),
  entry?: Omit<BlueprintVRProjectCacheEntry, 'key' | 'keyHash' | 'sourceIdentity' | 'generatedAt'> & {
    sourceSetLabel?: string
  },
): BlueprintVRProjectCacheEntry {
  const identity: BlueprintVRCacheIdentity =
    typeof identityOrProjectKey === 'object' && identityOrProjectKey !== null
      ? identityOrProjectKey
      : {
          projectId: String(identityOrProjectKey || ''),
          sourceSetId:
            typeof sourceSetKeyOrEntry === 'string' || sourceSetKeyOrEntry == null
              ? String(sourceSetKeyOrEntry || '')
              : '',
        }
  const resolvedEntry =
    typeof sourceSetKeyOrEntry === 'object' && sourceSetKeyOrEntry !== null
      ? sourceSetKeyOrEntry
      : entry
  if (!resolvedEntry) {
    throw new Error('setCachedProjectModel requires a cache entry payload.')
  }
  const key = getBlueprintVRCacheKey(identity)
  const stored: BlueprintVRProjectCacheEntry = {
    key,
    keyHash: hashKey(key),
    sourceIdentity: {
      projectId: identity.projectId || null,
      sourceSetId: identity.sourceSetId || null,
      sourceSetName: identity.sourceSetName || null,
      blueprintId: identity.blueprintId || null,
      fileName: identity.fileName || null,
      selectedFloorPlanPage: Number(identity.selectedFloorPlanPage || 0) || null,
      pageCount: Number(identity.pageCount || 0) || null,
      scannerVersion: identity.scannerVersion || null,
    },
    generatedAt: new Date().toISOString(),
    sourceSetLabel: resolvedEntry.sourceSetLabel,
    model: resolvedEntry.model,
    scan: resolvedEntry.scan,
    fullSetScan: resolvedEntry.fullSetScan,
    modelDerivation:
      resolvedEntry.scan.scanResultKind === 'measured-trace'
        ? 'trace-derived'
        : resolvedEntry.scan.scanResultKind === 'fallback'
        ? 'fallback-derived'
        : 'inferred-derived',
  }
  cache.set(key, stored)
  return stored
}

/**
 * Clear all entries for a given project (any source set). Useful when a
 * blueprint set is uploaded / deleted for that project.
 */
export function clearProjectCache(projectKey: string | null | undefined): number {
  const prefix = safeKey(projectKey) + '::'
  let removed = 0
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key)
      removed += 1
    }
  }
  return removed
}

/**
 * Drop a single cache entry. Returns true when something was removed.
 */
export function clearCachedProjectModel(
  identityOrProjectKey: BlueprintVRCacheIdentity | string | null | undefined,
  sourceSetKey?: string | null | undefined,
): boolean {
  return cache.delete(getBlueprintVRCacheKey(identityOrProjectKey, sourceSetKey))
}

/**
 * Drop the entire cache (test / dev helper).
 */
export function clearAllProjectModelCache(): void {
  cache.clear()
}

/**
 * Snapshot of every entry currently held in the cache. Useful for inspection
 * UIs and diagnostics — does not expose the underlying Map.
 */
export function listCachedProjectModels(): BlueprintVRProjectCacheEntry[] {
  return Array.from(cache.values())
}
