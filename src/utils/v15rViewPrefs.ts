/**
 * UI-only view preferences for inner project tabs (per project). Not financial data.
 * Stored in localStorage — not project backup.
 */

export const INNER_PROJECT_VIEW_LS_PREFIX = 'poweron:v15r:innerProjectView:'

export type InnerProjectEstimateView = {
  showInternalBreakdown?: boolean
  /** Estimate tab — "Estimate Pipeline Overview" section expanded when true */
  showPipelineOverview?: boolean
}

export type InnerProjectProgressView = {
  /** true = phase bucket is collapsed */
  collapsedPhases?: Record<string, boolean>
  /** true = manual phase % override is active */
  overrideEnabled?: Record<string, boolean>
}

export type InnerProjectMTOView = {
  /** true = phase bucket is collapsed */
  collapsedPhases?: Record<string, boolean>
}

export type InnerProjectViewPrefs = {
  estimate?: InnerProjectEstimateView
  progress?: InnerProjectProgressView
  mto?: InnerProjectMTOView
}

export function getInnerProjectViewStorageKey(projectId: string): string | null {
  if (projectId == null || projectId === '') return null
  if (typeof projectId !== 'string') return null
  return `${INNER_PROJECT_VIEW_LS_PREFIX}${projectId}`
}

export function loadInnerProjectViewPrefs(projectId: string): InnerProjectViewPrefs {
  const key = getInnerProjectViewStorageKey(projectId)
  if (!key || typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(key)
    if (raw == null || raw === '') return {}
    const parsed = JSON.parse(raw) as unknown
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as InnerProjectViewPrefs
  } catch {
    return {}
  }
}

function writeInnerProjectViewPrefs(projectId: string, next: InnerProjectViewPrefs): void {
  const key = getInnerProjectViewStorageKey(projectId)
  if (!key || typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify(next))
  } catch {
    // Quota, private mode, SSR, etc.
  }
}

/**
 * Deep-merge partial view prefs into existing storage for this project.
 */
export function mergeInnerProjectViewPrefs(projectId: string, patch: InnerProjectViewPrefs): void {
  const key = getInnerProjectViewStorageKey(projectId)
  if (!key) return

  const prev = loadInnerProjectViewPrefs(projectId)

  const nextEstimate =
    patch.estimate !== undefined ? { ...prev.estimate, ...patch.estimate } : prev.estimate

  let nextProgress = prev.progress
  if (patch.progress !== undefined) {
    const collapsedPhases =
      patch.progress.collapsedPhases !== undefined
        ? { ...prev.progress?.collapsedPhases, ...patch.progress.collapsedPhases }
        : prev.progress?.collapsedPhases

    const overrideEnabled =
      patch.progress.overrideEnabled !== undefined
        ? { ...prev.progress?.overrideEnabled, ...patch.progress.overrideEnabled }
        : prev.progress?.overrideEnabled

    nextProgress = {
      ...prev.progress,
      ...patch.progress,
      collapsedPhases,
      overrideEnabled,
    }
  }

  let nextMto = prev.mto
  if (patch.mto !== undefined) {
    const collapsedPhases =
      patch.mto.collapsedPhases !== undefined
        ? { ...prev.mto?.collapsedPhases, ...patch.mto.collapsedPhases }
        : prev.mto?.collapsedPhases

    nextMto = {
      ...prev.mto,
      ...patch.mto,
      collapsedPhases,
    }
  }

  const next: InnerProjectViewPrefs = {
    ...prev,
    estimate: nextEstimate,
    progress: nextProgress,
    mto: nextMto,
  }

  writeInnerProjectViewPrefs(projectId, next)
}

/** Remove LS entries for a deleted custom phase (keeps JSON tidy; missing keys also work). */
export function removeProgressPhaseViewKeys(projectId: string, phaseName: string): void {
  const key = getInnerProjectViewStorageKey(projectId)
  if (!key) return
  const prev = loadInnerProjectViewPrefs(projectId)
  const cp = { ...(prev.progress?.collapsedPhases || {}) }
  const oe = { ...(prev.progress?.overrideEnabled || {}) }
  delete cp[phaseName]
  delete oe[phaseName]
  writeInnerProjectViewPrefs(projectId, {
    ...prev,
    progress: {
      ...prev.progress,
      collapsedPhases: cp,
      overrideEnabled: oe,
    },
  })
}

/** Map persisted collapsed flags → phaseExpanded react shape (false = collapsed). */
export function phaseExpandedFromCollapsedPhases(
  collapsed: Record<string, boolean> | undefined,
): Record<string, boolean> {
  if (!collapsed) return {}
  const out: Record<string, boolean> = {}
  for (const ph of Object.keys(collapsed)) {
    out[ph] = !collapsed[ph]
  }
  return out
}
