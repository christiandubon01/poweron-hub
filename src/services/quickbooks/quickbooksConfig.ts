/**
 * src/services/quickbooks/quickbooksConfig.ts
 *
 * Build QuickBooks OAuth configuration from an environment-like map.
 *
 * The caller (a Netlify function) passes `process.env`; tests pass a fake map.
 * This module never reads `process.env` directly, so no credential value is
 * reachable from browser-bundled code — the secret only ever lives in the
 * server process and flows through as an injected parameter.
 *
 * Missing configuration fails closed, naming the missing key but never a value.
 *
 * STATE SECRET HARDENING: production must use a dedicated INTUIT_OAUTH_STATE_SECRET.
 * JWT_SECRET is permitted ONLY as an explicit non-production dev fallback and is
 * never silently substituted in production. Fail closed otherwise.
 */
import { QuickBooksConfigError } from './quickbooksTypes'
import type { QuickBooksConfig, QuickBooksConfigKey } from './quickbooksTypes'

/** Environment-like lookup. `process.env` is injected by the server handler. */
export type QboEnvLike = Record<string, string | undefined>

/**
 * Whether the running context is a production server deploy.
 * Netlify production deploys set CONTEXT=production; Node also sets NODE_ENV.
 */
export function isQboProductionEnv(env: QboEnvLike): boolean {
  return env.NODE_ENV === 'production' || env.CONTEXT === 'production'
}

export function loadQuickBooksConfig(env: QboEnvLike): QuickBooksConfig {
  const clientId = env.INTUIT_CLIENT_ID
  const clientSecret = env.INTUIT_CLIENT_SECRET
  const redirectUri = env.INTUIT_REDIRECT_URI

  const requireKey = (value: string | undefined, key: QuickBooksConfigKey): string => {
    if (!value || !value.trim()) throw new QuickBooksConfigError(key)
    return value
  }

  // State secret: production MUST use a dedicated INTUIT_OAUTH_STATE_SECRET.
  // JWT_SECRET is allowed only as an explicit non-production dev fallback.
  // INTUIT_CLIENT_SECRET is never reused as the state secret.
  const dedicated = env.INTUIT_OAUTH_STATE_SECRET
  let stateSecret: string | undefined
  if (dedicated && dedicated.trim()) {
    stateSecret = dedicated
  } else if (!isQboProductionEnv(env)) {
    const devFallback = env.JWT_SECRET
    if (devFallback && devFallback.trim()) stateSecret = devFallback
  }

  return {
    clientId: requireKey(clientId, 'INTUIT_CLIENT_ID'),
    clientSecret: requireKey(clientSecret, 'INTUIT_CLIENT_SECRET'),
    redirectUri: requireKey(redirectUri, 'INTUIT_REDIRECT_URI'),
    stateSecret: requireKey(stateSecret, 'INTUIT_OAUTH_STATE_SECRET'),
  }
}