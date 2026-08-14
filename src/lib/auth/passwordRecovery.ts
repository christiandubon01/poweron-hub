export const PASSWORD_RECOVERY_PATH = '/auth/reset-password'
export const PASSWORD_RECOVERY_FLAG = 'poweron_password_recovery'

type RecoveryLocation = Pick<Location, 'pathname' | 'search' | 'hash'>

function callbackType(value: string): string {
  const params = new URLSearchParams(value.replace(/^[?#]/, ''))
  return String(params.get('type') ?? '').trim().toLowerCase()
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

export function hasPasswordRecoveryIntent(location?: RecoveryLocation): boolean {
  if (location && isPasswordRecoveryLocation(location)) return true
  try { return sessionStorage.getItem(PASSWORD_RECOVERY_FLAG) === '1' } catch { return false }
}

export function clearPasswordRecoveryIntent(): void {
  try { sessionStorage.removeItem(PASSWORD_RECOVERY_FLAG) } catch { /* unavailable */ }
  if (typeof window !== 'undefined' && isPasswordRecoveryLocation(window.location)) {
    window.history.replaceState({}, document.title, '/')
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
