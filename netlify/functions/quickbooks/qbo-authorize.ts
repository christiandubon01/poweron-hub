// @ts-nocheck
/**
 * netlify/functions/quickbooks/qbo-authorize.ts
 *
 * Server-side QuickBooks Online OAuth 2.0 authorization URL builder.
 *
 * QBO-3A: persists a single-use OAuth state row (nonce hash only) so the
 * callback can atomically consume it, closing the QBO-1A replay gap.
 *
 * An authenticated PowerOn OWNER/ADMIN requests a connection URL. The OAuth
 * `state` is signed here with the server-only INTUIT_OAUTH_STATE_SECRET (dev
 * fallback JWT_SECRET) and bound to the caller's verified PowerOn user + org
 * identity, which is read from the profiles row under RLS — never from the
 * request body. Only owners/admins may initiate a connection; ordinary members
 * receive 403.
 *
 * The signed state carries the raw nonce; only sha256(nonce) is persisted to
 * public.quickbooks_oauth_states (service-role client) along with org, user,
 * a safe return path, and expiry.
 *
 * Server-only env:
 *   INTUIT_CLIENT_ID, INTUIT_CLIENT_SECRET, INTUIT_REDIRECT_URI,
 *   INTUIT_OAUTH_STATE_SECRET (required in production; JWT_SECRET dev-only fallback),
 *   VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from '@supabase/supabase-js'
import { loadQuickBooksConfig } from '../../../src/services/quickbooks/quickbooksConfig'
import { buildAuthorizationUrl } from '../../../src/services/quickbooks/quickbooksOAuth'
import { createState } from '../../../src/services/quickbooks/quickbooksOauthStateStore'
import { createStateRepo } from './qboRepos'

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
  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
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
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
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

  // Identity, org and role come from the profiles row under RLS — never the body.
  let orgId = ''
  const db = userScopedClient(event)
  if (db) {
    const { data } = await db.from('profiles').select('org_id, role, is_active').eq('id', user.id).maybeSingle()
    if (data?.is_active === false) {
      return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Access unavailable' }) }
    }
    orgId = data?.org_id || ''
    // QBO-3A: only owners/admins may initiate a QuickBooks connection.
    if (!data?.role || !['owner', 'admin'].includes(data.role)) {
      return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Only owners and admins can connect QuickBooks.' }) }
    }
  }
  if (!orgId) {
    return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Organization required.' }) }
  }

  let config
  try {
    config = loadQuickBooksConfig(process.env)
  } catch (err) {
    // Fail closed; name the missing key, never a value.
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'QuickBooks not configured', missingKey: err?.missingKey ?? null }),
    }
  }

  const { url, state } = buildAuthorizationUrl(config, { userId: user.id, orgId })

  // Persist the single-use nonce (hash only) so the callback can atomically
  // consume it. Best-effort: if the state store is unavailable, refuse to issue
  // a state we cannot later validate (fail closed — no replayable state).
  const svc = serviceClient()
  if (!svc) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'QuickBooks connection store unavailable.' }) }
  }
  let returnPath = '/'
  try {
    const body = event.body ? JSON.parse(event.body) : {}
    if (body && typeof body.returnPath === 'string') returnPath = body.returnPath
  } catch {
    // Ignore malformed body; default return path is used.
  }
  try {
    await createState(createStateRepo(svc), {
      nonce: state.nonce,
      organizationId: orgId,
      userId: user.id,
      returnPath,
      expiresAt: new Date(state.expiresAt),
    })
  } catch {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'QuickBooks connection could not be prepared.' }) }
  }

  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ authorizationUrl: url }) }
}