export type PortalContext = 'main' | 'employee'

const PORTAL_CONTEXT_KEY = 'poweron-hub-portal-context'

function readStoredPortalContext(): PortalContext | null {
  try {
    const stored = sessionStorage.getItem(PORTAL_CONTEXT_KEY)
    if (stored === 'employee' || stored === 'main') return stored
  } catch {
    // Non-browser/test environments may not expose sessionStorage.
  }
  return null
}

export function setPreferredPortalContext(context: PortalContext): void {
  try {
    sessionStorage.setItem(PORTAL_CONTEXT_KEY, context)
  } catch {
    // Best-effort only.
  }
}

export function clearPreferredPortalContext(): void {
  try {
    sessionStorage.removeItem(PORTAL_CONTEXT_KEY)
  } catch {
    // Best-effort only.
  }
}

export function getPreferredPortalContext(): PortalContext | null {
  return readStoredPortalContext()
}

export function detectPortalContext(pathname?: string): PortalContext {
  const currentPath =
    typeof pathname === 'string'
      ? pathname
      : typeof window !== 'undefined'
        ? window.location.pathname
        : '/'

  if (currentPath.startsWith('/employee')) return 'employee'
  return readStoredPortalContext() ?? 'main'
}
