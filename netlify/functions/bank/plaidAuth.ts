// @ts-nocheck
/**
 * netlify/functions/bank/plaidAuth.ts
 *
 * BANK-2 — shared SERVER-ONLY security bootstrap for every Plaid sandbox connection endpoint. Mirrors the proven
 * QuickBooks bootstrap (qboCustomerAuth.ts), in this order:
 *   1. Authenticate the bearer user (auth.getUser). No user => 401.
 *   2. Resolve organization + role from the caller's profile row UNDER RLS. NEVER from the request body.
 *   3. Active account + owner/admin only. Anything else => 403.
 *   4. Build the service-role client (the only authority for the server-only credential table).
 *   5. Load Plaid config (sandbox only) and the bank token encryption key from process.env. Fail closed => 500.
 *
 * NEVER ACCEPTED FROM THE BROWSER: organization id, role, provider item id as authority, Plaid environment, any secret.
 * NEVER RETURNED TO THE BROWSER: Plaid client id/secret, access tokens, encrypted credentials, cursors, raw Plaid responses.
 * Logging emits only sanitized events (provider, internal ids, status, safe code).
 */
import { createClient } from '@supabase/supabase-js'
import { loadPlaidConfig } from '../../../src/services/bankProvider/plaidConfig'
import { loadBankTokenEncryptionKey } from '../../../src/services/bankProvider/providerTokenCrypto'
import { createPlaidSdkPort } from '../../../src/services/bankProvider/plaidPort'
import { createBankConnectionRepo } from '../../../src/services/bankProvider/bankConnectionRepo'
import { createBankAccountRepo } from '../../../src/services/bankProvider/bankAccountRepo'
import { BankConnectionError } from '../../../src/services/bankProvider/bankConnectionService'

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
}

export function jsonResponse(statusCode, payload) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(payload) }
}
export function corsPreflight() {
  return { statusCode: 200, headers: CORS_HEADERS, body: '' }
}

function bearerToken(event) {
  const header = event.headers?.authorization || event.headers?.Authorization || ''
  return String(header).replace(/^Bearer\s+/i, '').trim()
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
  const { url, anonKey } = supabaseConfig()
  if (!token || !url || !anonKey) return null
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await client.auth.getUser(token)
  return error || !data?.user ? null : data.user
}
function userScopedClient(event) {
  const token = bearerToken(event)
  const { url, anonKey } = supabaseConfig()
  if (!token || !url || !anonKey) return null
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } })
}
function serviceClient() {
  const { url, serviceKey } = supabaseConfig()
  return url && serviceKey ? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null
}

/** Only these fields can ever be logged. */
export function safeLog(event) {
  const { event: name, organizationId, itemId, outcome, code } = event
  console.log(JSON.stringify({ event: name, organizationId, itemId, outcome, code }))
}

export async function resolveBankContext(event, overrides = {}) {
  const user = await (overrides.verifyUser ?? verifyAuthenticatedUser)(event)
  if (!user) return { ok: false, response: jsonResponse(401, { error: 'Authentication required.' }) }

  const db = (overrides.userClient ?? userScopedClient)(event)
  if (!db) return { ok: false, response: jsonResponse(500, { error: 'Server unavailable.' }) }
  const { data } = await db.from('profiles').select('org_id, role, is_active').eq('id', user.id).maybeSingle()
  if (data?.is_active === false) return { ok: false, response: jsonResponse(403, { error: 'Access unavailable.' }) }
  const organizationId = data?.org_id || ''
  if (!organizationId || !['owner', 'admin'].includes(data?.role)) {
    return { ok: false, response: jsonResponse(403, { error: 'Only owners and admins can manage bank connections.' }) }
  }

  const svc = (overrides.serviceClient ?? serviceClient)()
  if (!svc) return { ok: false, response: jsonResponse(500, { error: 'Server unavailable.' }) }

  let config, key
  try {
    config = loadPlaidConfig(process.env)
    key = loadBankTokenEncryptionKey(process.env)
  } catch {
    return { ok: false, response: jsonResponse(500, { error: 'Bank connection is not configured.' }) }
  }

  return {
    ok: true,
    actor: { organizationId, userId: user.id, role: data.role },
    deps: { plaid: (overrides.plaidPort ?? createPlaidSdkPort)(config), repo: (overrides.connectionRepo ?? createBankConnectionRepo)(svc), accounts: (overrides.accountRepo ?? createBankAccountRepo)(svc), key, environment: config.environment, log: safeLog },
  }
}

export function parseJsonBody(event, maxBytes = 4096) {
  const raw = event.body || ''
  if (raw.length > maxBytes) throw new BankConnectionError('invalid_request', 400, 'Invalid request.')
  try { return raw ? JSON.parse(raw) : {} } catch { throw new BankConnectionError('invalid_request', 400, 'Invalid request body.') }
}

/** Turns any thrown value into a sanitized response. Unknown errors expose nothing (no message, no stack). */
export function errorResponse(error) {
  if (error instanceof BankConnectionError) return jsonResponse(error.httpStatus, { error: error.message, code: error.code })
  safeLog({ event: 'bank.unhandled_error', code: 'internal' })
  return jsonResponse(500, { error: 'Request failed.' })
}
