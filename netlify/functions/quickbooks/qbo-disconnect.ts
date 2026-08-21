// @ts-nocheck
/**
 * netlify/functions/quickbooks/qbo-disconnect.ts
 *
 * Disconnect the organization's QuickBooks connection.
 *
 * QBO-3A: verifies owner/admin authority, decrypts the refresh token server-side,
 * calls the Intuit revoke primitive, and on success marks the connection
 * disconnected (clears all encrypted credentials + expiry; preserves safe
 * company_name / connected_at / environment audit metadata).
 *
 * Failure handling (spec-faithful):
 *   - Intuit reports the token already invalid/revoked (HTTP 400/401 — access is
 *     gone): normalize safely to disconnected and clear local credentials.
 *   - Transient provider/network/server failure (HTTP 5xx or network error):
 *     fail safely. Do NOT falsely mark disconnected. The owner may retry. No
 *     provider secret details are exposed.
 *
 * Only owners/admins of the org may disconnect. Ordinary members receive 403.
 * No provider tokens ever become browser-readable.
 *
 * Server-only env: INTUIT_* (OAuth config), POWERON_QBO_TOKEN_ENCRYPTION_KEY,
 *   VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from '@supabase/supabase-js'
import { loadQuickBooksConfig } from '../../../src/services/quickbooks/quickbooksConfig'
import { revokeTokensDetail, QboOAuthError } from '../../../src/services/quickbooks/quickbooksOAuth'
import { decryptToken, loadQboTokenEncryptionKey } from '../../../src/services/quickbooks/quickbooksTokenCrypto'
import {
  isConnectionUsable,
  loadConnection,
  markDisconnected,
} from '../../../src/services/quickbooks/quickbooksConnectionStore'
import { createConnectionRepo } from './qboRepos'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
}

function bearerToken(event) {
  const authHeader = event.headers?.authorization || event.headers?.Authorization || ''
  return String(authHeader).replace(/^Bearer\s+/i, '').trim()
}

function supabaseConfig() {
  return {
    url: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
    anonKey: process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '',
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  }
}

async function verifyAuthenticatedUser(event) {
  const token = bearerToken(event)
  if (!token) return null
  const { url, anonKey } = supabaseConfig()
  if (!url || !anonKey) return null
  const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await authClient.auth.getUser(token)
  if (error || !data?.user) return null
  return data.user
}

function userScopedClient(event) {
  const token = bearerToken(event)
  const { url, anonKey } = supabaseConfig()
  if (!token || !url || !anonKey) return null
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

function serviceClient() {
  const { url, serviceKey } = supabaseConfig()
  if (!url || !serviceKey) return null
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' }
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  const user = await verifyAuthenticatedUser(event)
  if (!user) {
    return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Authentication required.' }) }
  }

  // Org + role from the profiles row under RLS — never the body.
  const db = userScopedClient(event)
  if (!db) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Server unavailable.' }) }
  }
  const { data } = await db.from('profiles').select('org_id, role, is_active').eq('id', user.id).maybeSingle()
  if (data?.is_active === false) {
    return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Access unavailable' }) }
  }
  const orgId = data?.org_id || ''
  if (!orgId || !data?.role || !['owner', 'admin'].includes(data.role)) {
    return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Only owners and admins can disconnect QuickBooks.' }) }
  }

  const svc = serviceClient()
  if (!svc) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Server unavailable.' }) }
  }
  const repo = createConnectionRepo(svc)

  // Already disconnected / no connection — idempotent success.
  const row = await loadConnection(repo, orgId)
  if (!isConnectionUsable(row)) {
    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ disconnected: true }) }
  }

  let config
  try {
    config = loadQuickBooksConfig(process.env)
  } catch (err) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'QuickBooks not configured', missingKey: err?.missingKey ?? null }) }
  }

  let encKey
  try {
    encKey = loadQboTokenEncryptionKey(process.env)
  } catch (_err) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'QuickBooks encryption not configured.' }) }
  }

  const refreshToken = decryptToken(row.encryptedRefreshToken, encKey)

  try {
    const result = await revokeTokensDetail(config, refreshToken, fetch)
    if (result.revoked) {
      await markDisconnected(repo, orgId, new Date())
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ disconnected: true }) }
    }
    // Provider HTTP error. 400/401 => token already invalid/revoked (access
    // gone) => normalize to disconnected. 5xx and other => transient => fail
    // safely without marking disconnected.
    if (result.status === 400 || result.status === 401) {
      await markDisconnected(repo, orgId, new Date())
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ disconnected: true }) }
    }
    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({ disconnected: false, error: 'QuickBooks could not be disconnected. Please try again.' }),
    }
  } catch (_err) {
    // Network/server-unreachable failure (QboOAuthError 'revoke_failed') is
    // transient — do NOT falsely mark disconnected. Let the owner retry.
    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({ disconnected: false, error: 'QuickBooks could not be disconnected. Please try again.' }),
    }
  }
}