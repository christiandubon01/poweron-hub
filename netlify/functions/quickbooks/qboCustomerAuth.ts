// @ts-nocheck
/**
 * netlify/functions/quickbooks/qboCustomerAuth.ts
 *
 * QBO-4A.3 Task 2 — shared SERVER-ONLY security/authorization bootstrap for every
 * Customer API endpoint (search / current-mapping / link / create / unlink).
 *
 * It establishes, server-side and IN THIS ORDER:
 *   1. Authenticate the bearer user (auth.getUser) — no user => 401.
 *   2. Resolve the profile row under RLS (org_id, role, is_active) — NEVER from body.
 *   3. Enforce the account is active — inactive => 403.
 *   4. Enforce owner/admin authorization — anything else => 403.
 *   5. Build the service-role client (SUPABASE_SERVICE_ROLE_KEY) — sole authority for
 *      the RLS-revoked quickbooks_connections / quickbooks_customer_mappings tables.
 *   6. Load QuickBooks config + token encryption key from process.env (fail closed).
 *   7. Build the connection + mapping repos.
 *
 * For endpoints that need a LIVE QBO company scope, resolveQboCompanyScope(ctx)
 * then:
 *   8. Obtain a valid access token via getValidQboAccessToken (refresh + CAS as
 *      needed). No usable connection => 422 "not connected" (NOT a 500 — the owner
 *      must connect QuickBooks first).
 *   9. Derive the domain-separated company fingerprint from the DECRYPTED realmId.
 *
 * NEVER ACCEPT FROM THE BROWSER BODY (and these endpoints never read them):
 *   organizationId as authority, realmId, company fingerprint, access token,
 *   refresh token, environment authority. The server derives all of these.
 *
 * This module is imported only by the Netlify handlers + tests. It performs no
 * financial-authority write and imports no financial-authority module.
 */
import { createClient } from '@supabase/supabase-js'

import { loadQuickBooksConfig } from '../../../src/services/quickbooks/quickbooksConfig'
import { loadQboTokenEncryptionKey } from '../../../src/services/quickbooks/quickbooksTokenCrypto'
import { computeQboCompanyFingerprint } from '../../../src/services/quickbooks/quickbooksCompanyFingerprint'
import { getValidQboAccessToken } from '../../../src/services/quickbooks/quickbooksTokenAuthority'
import { resolveQboBearer, type QboAccountingBearer } from '../../../src/services/quickbooks/qboAccountingClient'
import { QboCustomerApiError } from '../../../src/services/quickbooks/qboCustomerContract'
import { createConnectionRepo } from './qboRepos'
import { createCustomerMappingRepo } from './qboCustomerMappingRepo'
import { createRelationshipAccountIdentityRepo } from './qboCustomerIdentityRepo'

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
}

/** A JSON HTTP response with CORS headers. */
export function jsonResponse(statusCode: number, payload: unknown) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(payload) }
}

/** CORS preflight. */
export function corsPreflight() {
  return { statusCode: 200, headers: CORS_HEADERS, body: '' }
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

/** Resolved server-side context for a Customer API request. */
export interface CustomerApiContext {
  user: { id: string }
  /** Server-resolved org id (RLS profile row) — never the request body. */
  orgId: string
  role: string
  svc: any
  config: any
  encKey: Buffer
  connectionRepo: any
  mappingRepo: any
  /** Canonical PowerOn customer identity lookup (relationship_accounts, service role). */
  identityRepo: any
  fetchImpl: any
  now: Date
}

/** The two possible outcomes of resolving a Customer API context. */
export type CustomerAuthResult =
  | { ok: true; ctx: CustomerApiContext }
  | { ok: false; response: ReturnType<typeof jsonResponse> }

/**
 * Resolve the full server-side context for a Customer API request, or a sanitized
 * HTTP error response (401 / 403 / 500). Never throws; failures become 401/403/500.
 */
export async function resolveCustomerApiContext(event): Promise<CustomerAuthResult> {
  const user = await verifyAuthenticatedUser(event)
  if (!user) {
    return { ok: false, response: jsonResponse(401, { error: 'Authentication required.' }) }
  }

  // Org + role from the profiles row under RLS — NEVER the body.
  const db = userScopedClient(event)
  if (!db) {
    return { ok: false, response: jsonResponse(500, { error: 'Server unavailable.' }) }
  }
  const { data } = await db
    .from('profiles')
    .select('org_id, role, is_active')
    .eq('id', user.id)
    .maybeSingle()

  if (data?.is_active === false) {
    return { ok: false, response: jsonResponse(403, { error: 'Access unavailable.' }) }
  }
  const orgId = data?.org_id || ''
  if (!orgId || !data?.role || !['owner', 'admin'].includes(data.role)) {
    return { ok: false, response: jsonResponse(403, { error: 'Only owners and admins can manage QuickBooks customers.' }) }
  }

  const svc = serviceClient()
  if (!svc) {
    return { ok: false, response: jsonResponse(500, { error: 'Server unavailable.' }) }
  }

  let config
  try {
    config = loadQuickBooksConfig(process.env)
  } catch {
    return { ok: false, response: jsonResponse(500, { error: 'QuickBooks is not configured.' }) }
  }

  let encKey
  try {
    encKey = loadQboTokenEncryptionKey(process.env)
  } catch {
    return { ok: false, response: jsonResponse(500, { error: 'QuickBooks is not configured.' }) }
  }

  return {
    ok: true,
    ctx: {
      user,
      orgId,
      role: data.role,
      svc,
      config,
      encKey,
      connectionRepo: createConnectionRepo(svc),
      mappingRepo: createCustomerMappingRepo(svc),
      identityRepo: createRelationshipAccountIdentityRepo(svc),
      fetchImpl: fetch,
      now: new Date(),
    },
  }
}

/** A resolved live QBO company scope (token + company identity), server-derived. */
export interface QboCompanyScope {
  bearer: QboAccountingBearer
  /** Domain-separated SHA-256 of the decrypted realmId — the mapping scope key. */
  fingerprint: string
  environment: 'sandbox' | 'production'
}

/** Resolve a live QBO company scope for the org, or a sanitized HTTP error. */
export type QboCompanyScopeResult =
  | { ok: true; scope: QboCompanyScope }
  | { ok: false; response: ReturnType<typeof jsonResponse> }

/**
 * Resolve a usable access token + the company fingerprint for the current org. The
 * realmId is decrypted inside getValidQboAccessToken and never returned; only the
 * fingerprint (a hash) is exposed to the mapping scope. Returns 422 "not connected"
 * (NOT 500) when the org has no usable connection — the owner must connect first.
 */
export async function resolveQboCompanyScope(ctx: CustomerApiContext): Promise<QboCompanyScopeResult> {
  const acctCtx = {
    config: ctx.config,
    encKey: ctx.encKey,
    connectionRepo: ctx.connectionRepo,
    organizationId: ctx.orgId,
    fetchImpl: ctx.fetchImpl,
    now: ctx.now,
  }
  let bearer: QboAccountingBearer
  try {
    bearer = await resolveQboBearer(acctCtx)
  } catch (err) {
    if (err instanceof QboCustomerApiError) {
      if (err.category === 'not_connected') {
        return { ok: false, response: jsonResponse(422, { error: 'QuickBooks is not connected for this organization.' }) }
      }
      return { ok: false, response: jsonResponse(502, { error: err.toSanitized().message }) }
    }
    return { ok: false, response: jsonResponse(502, { error: 'QuickBooks connection could not be established.' }) }
  }
  const fingerprint = computeQboCompanyFingerprint(bearer.realmId)
  return {
    ok: true,
    scope: { bearer, fingerprint, environment: bearer.environment },
  }
}

/** The composite mapping scope for a PowerOn customer in the current QBO company/env. */
export interface CustomerMappingScopeFields {
  organizationId: string
  poweronCustomerId: string
  qboCompanyFingerprint: string
  qboEnvironment: 'sandbox' | 'production'
}

/** Build the mapping scope from the resolved context + company scope + canonical customer id. */
export function mappingScope(ctx: CustomerApiContext, scope: QboCompanyScope, poweronCustomerId: string): CustomerMappingScopeFields {
  return {
    organizationId: ctx.orgId,
    poweronCustomerId,
    qboCompanyFingerprint: scope.fingerprint,
    qboEnvironment: scope.environment,
  }
}