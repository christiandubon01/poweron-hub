export const HOST_RESTART_REQUIRED_MESSAGE = 'Host restart required — connected Host is running older code.'

const FINGERPRINT = /^[0-9a-f]{64}$/

/** Matching fingerprints are healthy. Missing fingerprints stay silent. No restart is performed. */
export function hostRestartRequired(connected: string | null | undefined, canonical: string | null | undefined): boolean {
  if (!connected || !canonical) return false
  if (!FINGERPRINT.test(connected) || !FINGERPRINT.test(canonical)) return false
  return connected !== canonical
}

export function readHostSourceFingerprint(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const fingerprint = (entry as Record<string, unknown>).sourceFingerprint
    if (typeof fingerprint === 'string' && FINGERPRINT.test(fingerprint)) return fingerprint
  }
  return null
}

/** The dev middleware reports the tree on disk. Production has no canonical hash yet. */
export async function loadCanonicalAgentHostFingerprint(): Promise<string | null> {
  if (import.meta.env.MODE !== 'test') {
    try {
      const response = await fetch('/__agent-host-source-fingerprint', { cache: 'no-store' })
      if (response.ok) {
        const body = await response.json() as { fingerprint?: unknown }
        if (typeof body.fingerprint === 'string' && FINGERPRINT.test(body.fingerprint)) return body.fingerprint
      }
    } catch {
      // Built apps have no dev route.
    }
  }
  return null
}
