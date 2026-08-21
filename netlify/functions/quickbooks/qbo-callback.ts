// @ts-nocheck
/**
 * netlify/functions/quickbooks/qbo-callback.ts
 *
 * QuickBooks Online OAuth 2.0 redirect callback handler.
 *
 * QBO-3A: validates the signed state, atomically consumes the single-use nonce
 * (closing the replay gap), exchanges the authorization code, encrypts the
 * tokens + realmId at rest with POWERON_QBO_TOKEN_ENCRYPTION_KEY, upserts the
 * organization's ONE connection row, best-effort fetches the company display
 * name, and redirects same-tab back to PowerOn with SANITIZED status
 * (?qbo=connected | ?qbo=cancelled | ?qbo=error).
 *
 * Security:
 *   - realmId is the QuickBooks company id, NOT a PowerOn org id. PowerOn org
 *     identity comes exclusively from the validated signed state.
 *   - No authorization code, state, token, refresh token, realmId, or provider
 *     error is ever placed in the redirect URL. The browser sees only ?qbo=….
 *   - The return path comes from the consumed nonce row (validated at authorize
 *     time) and is re-validated here — never an open redirect.
 *   - If anything fails AFTER the nonce is consumed, the user must start Connect
 *     QuickBooks again (the consumed nonce blocks a replay).
 *
 * Server-only env:
 *   INTUIT_CLIENT_ID, INTUIT_CLIENT_SECRET, INTUIT_REDIRECT_URI,
 *   INTUIT_OAUTH_STATE_SECRET, POWERON_QBO_TOKEN_ENCRYPTION_KEY,
 *   INTUIT_API_ENV (sandbox | production; default production),
 *   VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from '@supabase/supabase-js'
import { loadQuickBooksConfig } from '../../../src/services/quickbooks/quickbooksConfig'
import { validateCallback } from '../../../src/services/quickbooks/quickbooksCallback'
import { exchangeAuthorizationCode, QboOAuthError } from '../../../src/services/quickbooks/quickbooksOAuth'
import { consumeState, safeReturnPath } from '../../../src/services/quickbooks/quickbooksOauthStateStore'
import { encryptToken, loadQboTokenEncryptionKey } from '../../../src/services/quickbooks/quickbooksTokenCrypto'
import { fetchCompanyName } from '../../../src/services/quickbooks/quickbooksCompanyInfo'
import { upsertConnection } from '../../../src/services/quickbooks/quickbooksConnectionStore'
import { createStateRepo, createConnectionRepo } from './qboRepos'

function supabaseConfig() {
  return {
    url: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  }
}

function serviceClient() {
  const { url, serviceKey } = supabaseConfig()
  if (!url || !serviceKey) return null
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function resolveEnvironment(): 'sandbox' | 'production' {
  return process.env.INTUIT_API_ENV === 'sandbox' ? 'sandbox' : 'production'
}

/** Sanitized same-tab redirect. The query carries only a safe status token. */
function redirect(path: string | null | undefined, qbo: 'connected' | 'cancelled' | 'error'): {
  statusCode: number
  headers: Record<string, string>
  body: string
} {
  const safe = safeReturnPath(path)
  const sep = safe.includes('?') ? '&' : '?'
  return {
    statusCode: 302,
    headers: { Location: `${safe}${sep}qbo=${qbo}`, 'Cache-Control': 'no-store' },
    body: '',
  }
}

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  let config
  try {
    config = loadQuickBooksConfig(process.env)
  } catch (_err) {
    return redirect('/', 'error')
  }

  const qs = event.queryStringParameters || {}
  const validation = validateCallback(
    {
      state: qs.state,
      code: qs.code,
      realmId: qs.realmId,
      error: qs.error,
      errorDescription: qs.error_description,
    },
    config.stateSecret,
  )

  if (!validation.ok) {
    // Provider denial = the owner cancelled at Intuit. Everything else is an error.
    const cancelled = validation.error?.category === 'provider_denied'
    return redirect('/', cancelled ? 'cancelled' : 'error')
  }

  const context = validation.context
  const svc = serviceClient()
  if (!svc) {
    return redirect('/', 'error')
  }

  // Atomically consume the single-use nonce. Rejects replay / expired / org or
  // user mismatch vs the verified signed state.
  const consumed = await consumeState(createStateRepo(svc), validation.nonce, context, new Date())
  if (!consumed.ok) {
    return redirect('/', 'error')
  }
  const returnPath = consumed.returnPath

  // Exchange the authorization code. If this fails, the nonce is already
  // consumed — the owner must start Connect QuickBooks again (no replay).
  let rawTokens
  try {
    rawTokens = await exchangeAuthorizationCode(config, validation.code, validation.realmId, fetch)
  } catch (_err) {
    return redirect(returnPath, 'error')
  }

  // Encrypt tokens + realmId at rest.
  let encKey
  try {
    encKey = loadQboTokenEncryptionKey(process.env)
  } catch (_err) {
    return redirect(returnPath, 'error')
  }
  const environment = resolveEnvironment()
  const encAccessToken = encryptToken(rawTokens.accessToken, encKey)
  const encRefreshToken = encryptToken(rawTokens.refreshToken, encKey)
  const encRealmId = encryptToken(validation.realmId, encKey)

  // Best-effort company display name. Failure -> null; the connection is still
  // saved below. Never lose valid tokens because optional metadata is unavailable.
  let companyName: string | null = null
  try {
    companyName = await fetchCompanyName(rawTokens.accessToken, validation.realmId, environment, fetch)
  } catch {
    companyName = null
  }

  // Upsert the org's ONE connection row. Org identity is the verified signed
  // state org — a callback can never attach to a different org.
  try {
    await upsertConnection(createConnectionRepo(svc), {
      organizationId: context.orgId,
      userId: context.userId,
      environment,
      encryptedAccessToken: encAccessToken,
      encryptedRefreshToken: encRefreshToken,
      encryptedRealmId: encRealmId,
      accessTokenExpiresAt: new Date(rawTokens.accessExpiresAt).toISOString(),
      refreshTokenExpiresAt: rawTokens.refreshExpiresAt ? new Date(rawTokens.refreshExpiresAt).toISOString() : null,
      companyName,
    }, new Date())
  } catch (_err) {
    return redirect(returnPath, 'error')
  }

  return redirect(returnPath, 'connected')
}