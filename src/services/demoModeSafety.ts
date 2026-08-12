export const DEMO_MODE_KEY = 'poweron-demo-mode'
export const DEMO_INDUSTRY_KEY = 'poweron_demo_industry'
export const DEMO_RESET_EVENT = 'poweron:demo-reset'

export function isDemoUrlActive(search?: string): boolean {
  try {
    const params = new URLSearchParams(search ?? window.location.search)
    return params.get('demo') === 'true'
  } catch {
    return false
  }
}

export function loadPersistedDemoMode(): boolean {
  try {
    return localStorage.getItem(DEMO_MODE_KEY) === 'true'
  } catch {
    return false
  }
}

export function getPersistedDemoIndustry(): string {
  try {
    return localStorage.getItem(DEMO_INDUSTRY_KEY) || 'electrical'
  } catch {
    return 'electrical'
  }
}

export function getActiveDemoIndustry(search?: string): string {
  try {
    const params = new URLSearchParams(search ?? window.location.search)
    const fromUrl = params.get('industry')
    if (fromUrl) return fromUrl
  } catch {
    /* ignore */
  }
  return getPersistedDemoIndustry()
}

export function isDemoRuntimeActive(search?: string): boolean {
  return isDemoUrlActive(search) || loadPersistedDemoMode()
}

export function getDemoBackupStorageKey(industry = getActiveDemoIndustry()): string {
  const safeIndustry = String(industry || 'electrical').trim() || 'electrical'
  return `poweron_demo_backup_${safeIndustry}`
}

export function resetDemoBackupStorage(industry = getActiveDemoIndustry()): void {
  try {
    localStorage.removeItem(getDemoBackupStorageKey(industry))
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(DEMO_RESET_EVENT, { detail: { industry } }))
  } catch {
    /* ignore */
  }
}
