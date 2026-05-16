export const DEFAULT_PROJECT_PHASES = ['Estimating', 'Planning', 'Site Prep', 'Rough-in', 'Finish', 'Trim']

function cleanPhaseName(name: unknown): string {
  return String(name || '').trim().replace(/\s+/g, ' ')
}

function phaseKey(name: unknown): string {
  return cleanPhaseName(name).toLowerCase().replace(/[^a-z0-9]/g, '')
}

function uniqueClean(values: unknown[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values || []) {
    const clean = cleanPhaseName(value)
    const key = phaseKey(clean)
    if (!clean || seen.has(key)) continue
    seen.add(key)
    out.push(clean)
  }
  return out
}

function settingsPhaseWeightNames(backup: any): string[] {
  const weights = backup?.settings?.phaseWeights
  if (!weights || typeof weights !== 'object' || Array.isArray(weights)) return []
  return uniqueClean(Object.keys(weights))
}

function settingsMtoPhaseNames(backup: any): string[] {
  const phases = backup?.settings?.mtoPhases
  return Array.isArray(phases) ? uniqueClean(phases) : []
}

export function getProjectPhaseNames(backup: any): string[] {
  const weightNames = settingsPhaseWeightNames(backup)
  if (weightNames.length > 0) return weightNames

  const mtoNames = settingsMtoPhaseNames(backup)
  if (mtoNames.length > 0) return mtoNames

  return [...DEFAULT_PROJECT_PHASES]
}

export function normalizePhaseName(name: unknown, phases: string[] = DEFAULT_PROJECT_PHASES): string {
  const clean = cleanPhaseName(name)
  if (!clean) return ''

  const byKey = new Map<string, string>()
  for (const phase of phases || []) {
    byKey.set(phaseKey(phase), phase)
  }

  const exactKey = phaseKey(clean)
  if (byKey.has(exactKey)) return byKey.get(exactKey) || clean

  // Safe legacy variants only: spelling, hyphen, spacing, and casing around Rough-in.
  if (['roughin', 'rouchin'].includes(exactKey)) {
    return byKey.get('roughin') || clean
  }

  return clean
}

export function isKnownProjectPhase(name: unknown, phases: string[] = DEFAULT_PROJECT_PHASES): boolean {
  const normalized = normalizePhaseName(name, phases)
  const known = new Set((phases || []).map(phaseKey))
  return known.has(phaseKey(normalized))
}

export function getLegacyPhaseNames(values: unknown[], phases: string[] = DEFAULT_PROJECT_PHASES): string[] {
  const seen = new Set<string>()
  const legacy: string[] = []
  for (const value of values || []) {
    const normalized = normalizePhaseName(value, phases)
    if (!normalized || isKnownProjectPhase(normalized, phases)) continue
    const key = phaseKey(normalized)
    if (seen.has(key)) continue
    seen.add(key)
    legacy.push(normalized)
  }
  return legacy.sort((a, b) => a.localeCompare(b))
}

export function sortByProjectPhaseOrder<T>(
  items: T[],
  getPhase: (item: T) => unknown,
  phases: string[] = DEFAULT_PROJECT_PHASES,
): T[] {
  const order = new Map((phases || []).map((phase, idx) => [phaseKey(phase), idx]))
  return [...(items || [])].sort((a, b) => {
    const aName = normalizePhaseName(getPhase(a), phases)
    const bName = normalizePhaseName(getPhase(b), phases)
    const aOrder = order.has(phaseKey(aName)) ? order.get(phaseKey(aName))! : Number.MAX_SAFE_INTEGER
    const bOrder = order.has(phaseKey(bName)) ? order.get(phaseKey(bName))! : Number.MAX_SAFE_INTEGER
    if (aOrder !== bOrder) return aOrder - bOrder
    return aName.localeCompare(bName)
  })
}
