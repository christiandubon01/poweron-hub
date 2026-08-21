// @ts-nocheck
/**
 * netlify/functions/quickbooks/qbo-connection-status.ts
 *
 * Authenticated, sanitized QuickBooks connection STATUS for the browser menu.
 *
 * QBO-3A: returns only { connected: false } or { connected: true, companyName,
 * connectedAt }. No realmId, no tokens, no encrypted blobs, no expiry, no
 * technical metadata. No provider API call and no token refresh is performed —
 * connection status is persisted metadata, not a live accounting query. Opening
 * the QuickBooks menu never triggers a provider round-trip.
 *
 * Only owners/admins of the org may read status (same authority as connect /
 * disconnect). Ordinary members receive 403.
 *
 * Server-only env: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from '@supabase/supabase-js'
import { getSanitizedStatus } from '../../../src/services/quickbooks/quickbooksConnectionStore'
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
  if (event.httpMethod !== 'GET') {
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
    return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Only owners and admins can view QuickBooks connection status.' }) }
  }

  const svc = serviceClient()
  if (!svc) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Server unavailable.' }) }
  }

  const status = await getSanitizedStatus(createConnectionRepo(svc), orgId)
  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(status) }
}