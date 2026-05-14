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
  /** Project identifier (string id, or name when no id is available). */
  projectKey: string
  /** Source-set identifier (blueprint set id / name, or 'auto'). */
  sourceSetKey: string
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

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

function safeKey(value: string | null | undefined): string {
  if (!value) return 'unknown'
  return String(value).trim().toLowerCase().replace(/\s+/g, '-')
}

/**
 * Build a cache key from project + source set identifiers. The same project /
 * source set pair always produces the same key.
 */
export function getBlueprintVRCacheKey(
  projectKey: string | null | undefined,
  sourceSetKey: string | null | undefined,
): string {
  return `${safeKey(projectKey)}::${safeKey(sourceSetKey)}`
}

// ---------------------------------------------------------------------------
// Cache storage (module-level)
// ---------------------------------------------------------------------------

const cache = new Map<string, BlueprintVRProjectCacheEntry>()

/**
 * Look up a cached entry by project + source-set keys.
 */
export function getCachedProjectModel(
  projectKey: string | null | undefined,
  sourceSetKey: string | null | undefined,
): BlueprintVRProjectCacheEntry | undefined {
  return cache.get(getBlueprintVRCacheKey(projectKey, sourceSetKey))
}

/**
 * Store a generated model for a project + source-set pair. Replaces any
 * existing entry with the same key.
 */
export function setCachedProjectModel(
  projectKey: string | null | undefined,
  sourceSetKey: string | null | undefined,
  entry: Omit<BlueprintVRProjectCacheEntry, 'key' | 'projectKey' | 'sourceSetKey' | 'generatedAt'> & {
    sourceSetLabel?: string
  },
): BlueprintVRProjectCacheEntry {
  const key = getBlueprintVRCacheKey(projectKey, sourceSetKey)
  const stored: BlueprintVRProjectCacheEntry = {
    key,
    projectKey: safeKey(projectKey),
    sourceSetKey: safeKey(sourceSetKey),
    generatedAt: new Date().toISOString(),
    sourceSetLabel: entry.sourceSetLabel,
    model: entry.model,
    scan: entry.scan,
    fullSetScan: entry.fullSetScan,
    modelDerivation:
      entry.scan.scanResultKind === 'measured-trace'
        ? 'trace-derived'
        : entry.scan.scanResultKind === 'fallback'
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
  projectKey: string | null | undefined,
  sourceSetKey: string | null | undefined,
): boolean {
  return cache.delete(getBlueprintVRCacheKey(projectKey, sourceSetKey))
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
