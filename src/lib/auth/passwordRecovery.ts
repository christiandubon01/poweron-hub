export const PASSWORD_RECOVERY_PATH = '/auth/reset-password'
export const PASSWORD_RECOVERY_FLAG = 'poweron_password_recovery'
export const PASSWORD_RECOVERY_REQUEST_KEY = 'poweron_password_recovery_request'

const PASSWORD_RECOVERY_REQUEST_TTL_MS = 2 * 60 * 60 * 1000

type RecoveryLocation = Pick<Location, 'pathname' | 'search' | 'hash'>
type RecoveryRequestRecord = {
  requestedAt: number
  redirectTo: string | null
}

function callbackType(value: string): string {
  const params = new URLSearchParams(value.replace(/^[?#]/, ''))
  return String(params.get('type') ?? '').trim().toLowerCase()
}

function callbackParams(value: string): URLSearchParams {
  return new URLSearchParams(value.replace(/^[?#]/, ''))
}

function hasAuthCodeCallback(location: RecoveryLocation): boolean {
  return callbackParams(location.search).has('code')
}

function readPendingRecoveryRequest(): RecoveryRequestRecord | null {
  try {
    const raw = localStorage.getItem(PASSWORD_RECOVERY_REQUEST_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<RecoveryRequestRecord>
    if (typeof parsed?.requestedAt !== 'number') {
      localStorage.removeItem(PASSWORD_RECOVERY_REQUEST_KEY)
      return null
    }
    if ((Date.now() - parsed.requestedAt) > PASSWORD_RECOVERY_REQUEST_TTL_MS) {
      localStorage.removeItem(PASSWORD_RECOVERY_REQUEST_KEY)
      return null
    }
    return {
      requestedAt: parsed.requestedAt,
      redirectTo: typeof parsed.redirectTo === 'string' && parsed.redirectTo.trim()
        ? parsed.redirectTo.trim()
        : null,
    }
  } catch {
    return null
  }
}

/**
 * Supabase PKCE recovery callbacks may contain only `?code=...`, while legacy
 * implicit callbacks include `type=recovery`. The dedicated pathname is the
 * durable signal for PKCE and keeps signup/email-verification callbacks separate.
 */
export function isPasswordRecoveryLocation(location: RecoveryLocation): boolean {
  return location.pathname === PASSWORD_RECOVERY_PATH
    || callbackType(location.search) === 'recovery'
    || callbackType(location.hash) === 'recovery'
}

export function markPasswordRecoveryIntent(): void {
  try { sessionStorage.setItem(PASSWORD_RECOVERY_FLAG, '1') } catch { /* unavailable */ }
}

export function markPasswordRecoveryRequest(redirectTo?: string | null): void {
  try {
    localStorage.setItem(PASSWORD_RECOVERY_REQUEST_KEY, JSON.stringify({
      requestedAt: Date.now(),
      redirectTo: typeof redirectTo === 'string' && redirectTo.trim() ? redirectTo.trim() : null,
    }))
  } catch { /* unavailable */ }
}

export function hasPasswordRecoveryIntent(location?: RecoveryLocation): boolean {
  if (location && isPasswordRecoveryLocation(location)) return true
  try {
    if (sessionStorage.getItem(PASSWORD_RECOVERY_FLAG) === '1') return true
  } catch { /* unavailable */ }
  return Boolean(location && hasAuthCodeCallback(location) && readPendingRecoveryRequest())
}

export function clearPasswordRecoveryIntent(): void {
  try { sessionStorage.removeItem(PASSWORD_RECOVERY_FLAG) } catch { /* unavailable */ }
  try { localStorage.removeItem(PASSWORD_RECOVERY_REQUEST_KEY) } catch { /* unavailable */ }
  if (typeof window !== 'undefined' && (isPasswordRecoveryLocation(window.location) || hasAuthCodeCallback(window.location))) {
    const nextPath = isPasswordRecoveryLocation(window.location) ? '/' : window.location.pathname || '/'
    window.history.replaceState({}, document.title, nextPath)
  }
}

export function passwordRecoveryRedirectUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}${PASSWORD_RECOVERY_PATH}`
}

export function validateNewPassword(password: string, confirmation: string): string | null {
  if (!password || !confirmation) return 'New password and confirmation are required.'
  if (password.length < 8) return 'Password must be at least 8 characters.'
  if (password !== confirmation) return 'Passwords do not match.'
  return null
}
