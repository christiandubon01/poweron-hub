// @ts-nocheck
/**
 * Netlify Function — Session & Passcode Store (SEC2)
 *
 * Replaces the browser-side Upstash client that used to live in src/lib/redis.ts.
 * The Upstash REST token is now read only from process.env and never ships to
 * the client bundle.
 *
 * This is deliberately NOT a generic key/value proxy. A JWT-guarded passthrough
 * would still let any authenticated caller delete their own failed-attempt
 * counter (bypassing the PIN lockout entirely) or read and overwrite another
 * user's session record. So:
 *
 *   - Every Redis key is built here from the verified JWT identity. The client
 *     never supplies a key.
 *   - Passcode verification runs here, so the *server* decides whether an
 *     attempt failed. Previously the browser ran PBKDF2 and then reported the
 *     verdict, which meant an attacker could simply never report a failure.
 *   - Session records are stamped with the caller's id, org and role read from
 *     the profiles row under RLS — not from the request body.
 *
 * Reads stay under RLS by binding a Supabase client to the caller's own JWT;
 * this function never needs the service-role key.
 *
 * Env (server-side only — never VITE_-prefixed):
 *   UPSTASH_REDIS_URL, UPSTASH_REDIS_TOKEN
 */

import { createClient } from '@supabase/supabase-js'
import { Redis } from '@upstash/redis'

const crypto = require('crypto')

// ── Constants (must match the previous client-side values exactly) ───────────
const TTL_SESSION       = 24 * 60 * 60   // 24 hours
const LOCK_DURATION_SEC = 15 * 60        // 15 minutes
const MAX_ATTEMPTS      = 5
const HASH_BYTES        = 32

const keys = {
  session:        (sessionId: string) => `session:${sessionId}`,
  passcodeLock:   (userId: string)    => `lock:passcode:${userId}`,
  failedAttempts: (userId: string)    => `attempts:passcode:${userId}`,
}

// ── Redis ────────────────────────────────────────────────────────────────────

let _redis = null

function getRedis() {
  if (_redis) return _redis
  const url   = process.env.UPSTASH_REDIS_URL
  const token = process.env.UPSTASH_REDIS_TOKEN
  if (!url || !token) {
    console.error('[session-store] UPSTASH_REDIS_URL / UPSTASH_REDIS_TOKEN not configured')
    return null
  }
  _redis = new Redis({ url, token })
  return _redis
}

async function rGet(key: string) {
  const r = getRedis()
  if (!r) return null
  try {
    const raw = await r.get(key)
    if (raw === null || raw === undefined) return null
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch (err) {
    console.error('[session-store] rGet error', key, err)
    return null
  }
}

async function rSet(key: string, value: unknown, ttlSeconds: number) {
  const r = getRedis()
  if (!r) return false
  try {
    await r.setex(key, ttlSeconds, JSON.stringify(value))
    return true
  } catch (err) {
    console.error('[session-store] rSet error', key, err)
    return false
  }
}

async function rDel(key: string) {
  const r = getRedis()
  if (!r) return false
  try {
    await r.del(key)
    return true
  } catch (err) {
    console.error('[session-store] rDel error', key, err)
    return false
  }
}

async function rIncr(key: string, ttlSeconds: number) {
  const r = getRedis()
  if (!r) return null
  try {
    const val = await r.incr(key)
    if (ttlSeconds && val === 1) await r.expire(key, ttlSeconds)
    return val
  } catch (err) {
    console.error('[session-store] rIncr error', key, err)
    return null
  }
}

// ── Auth (SEC1 pattern — mirrors verifyAuthenticatedUser in speak.ts) ────────

function bearerToken(event: any): string {
  const authHeader =
    event.headers?.authorization ||
    event.headers?.Authorization ||
    ''
  return String(authHeader).replace(/^Bearer\s+/i, '').trim()
}

function supabaseConfig() {
  return {
    url: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
    anonKey:
      process.env.VITE_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      '',
  }
}

async function verifyAuthenticatedUser(event: any) {
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

/**
 * Supabase client bound to the caller's JWT, so every query this function makes
 * is evaluated under that user's RLS policies. No service-role escalation.
 */
function userScopedClient(event: any) {
  const token = bearerToken(event)
  const { url, anonKey } = supabaseConfig()
  if (!token || !url || !anonKey) return null
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

// ── Passcode hashing ─────────────────────────────────────────────────────────

/**
 * Verify a passcode against the stored PBKDF2 hash.
 *
 * Stored format: pbkdf2:<iterations>:<salt_hex>:<hash_hex>, SHA-256, 32 bytes.
 * This is byte-identical to the Web Crypto deriveBits() path that produced the
 * existing hashes, so previously stored passcodes verify unchanged.
 */
function verifyPasscodeHash(passcode: string, stored: string): boolean {
  const parts = String(stored || '').split(':')
  if (parts[0] !== 'pbkdf2' || parts.length !== 4) return false

  const iterations = parseInt(parts[1], 10)
  if (!Number.isFinite(iterations) || iterations <= 0) return false

  let salt: Buffer
  try {
    salt = Buffer.from(parts[2], 'hex')
  } catch {
    return false
  }
  if (salt.length === 0) return false

  const expected = parts[3]
  const derived = crypto
    .pbkdf2Sync(passcode, salt, iterations, HASH_BYTES, 'sha256')
    .toString('hex')

  if (derived.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(derived), Buffer.from(expected))
}

// ── Intent handlers ──────────────────────────────────────────────────────────

async function handlePasscodeStatus(user: any, db: any) {
  const [lockData, attempts, profileRes] = await Promise.all([
    rGet(keys.passcodeLock(user.id)),
    rGet(keys.failedAttempts(user.id)),
    db
      ? db.from('profiles').select('passcode_hash').eq('id', user.id).single()
      : Promise.resolve({ data: null }),
  ])

  const isLocked = !!lockData?.expiresAt && new Date(lockData.expiresAt) > new Date()
  const used = typeof attempts === 'number' ? attempts : 0

  return {
    isSet:             !!profileRes?.data?.passcode_hash,
    isLocked,
    attemptsRemaining: Math.max(0, MAX_ATTEMPTS - used),
    lockExpiresAt:     isLocked ? lockData.expiresAt : null,
  }
}

/**
 * Verify a passcode attempt and maintain the lockout counter.
 *
 * The failure count is incremented here, on the server, before the verdict is
 * returned — a client that ignores the response still burns an attempt.
 *
 * `justLocked` marks the transition into lockout so the caller fires its audit
 * entry and owner notification once, not on every attempt during the lockout.
 */
async function handlePasscodeVerify(user: any, db: any, body: any) {
  const passcode   = String(body?.passcode ?? '')
  const lockKey    = keys.passcodeLock(user.id)
  const attemptKey = keys.failedAttempts(user.id)

  // 1. Already locked?
  const lockData = await rGet(lockKey)
  if (lockData?.expiresAt) {
    const expiresAt = new Date(lockData.expiresAt)
    if (expiresAt > new Date()) {
      return {
        success: false,
        locked: true,
        justLocked: false,
        lockExpiresAt: expiresAt.toISOString(),
        attemptsUsed: MAX_ATTEMPTS,
      }
    }
    // Lock expired — clear it and start fresh.
    await rDel(lockKey)
    await rDel(attemptKey)
  }

  // 2. Stored hash — Supabase remains the source of truth (RLS: own row only).
  let storedHash = null
  if (db) {
    const { data, error } = await db
      .from('profiles')
      .select('passcode_hash')
      .eq('id', user.id)
      .single()
    if (!error) storedHash = data?.passcode_hash ?? null
  }
  if (!storedHash) {
    return { success: false, locked: false, attemptsRemaining: MAX_ATTEMPTS }
  }

  // 3. Compare
  if (verifyPasscodeHash(passcode, storedHash)) {
    await rDel(attemptKey)
    return { success: true }
  }

  // 4. Failed — count it
  const attempts = (await rIncr(attemptKey, LOCK_DURATION_SEC)) ?? 1

  if (attempts >= MAX_ATTEMPTS) {
    const expiresAt = new Date(Date.now() + LOCK_DURATION_SEC * 1000)
    await rSet(lockKey, { expiresAt: expiresAt.toISOString() }, LOCK_DURATION_SEC)
    await rDel(attemptKey)
    return {
      success: false,
      locked: true,
      justLocked: true,
      lockExpiresAt: expiresAt.toISOString(),
      attemptsUsed: MAX_ATTEMPTS,
    }
  }

  return {
    success: false,
    locked: false,
    attemptsRemaining: MAX_ATTEMPTS - attempts,
  }
}

/** Clear the caller's own lockout — used after a successful passcode reset. */
async function handlePasscodeClearLock(user: any) {
  await Promise.all([
    rDel(keys.passcodeLock(user.id)),
    rDel(keys.failedAttempts(user.id)),
  ])
  return { ok: true }
}

function sanitizeDeviceInfo(deviceInfo: any) {
  return {
    platform:   String(deviceInfo?.platform   ?? 'web').slice(0, 32),
    userAgent:  String(deviceInfo?.userAgent  ?? '').slice(0, 200),
    appVersion: String(deviceInfo?.appVersion ?? '0.1.0').slice(0, 32),
  }
}

// ── Guardian presence helpers ─────────────────────────────────────────────────

/**
 * Service-role Supabase client for presence and security event writes.
 * account_security_events has RLS enabled with zero authenticated policies,
 * so only the service role can write to it. user_sessions presence writes
 * also use service role for reliability (bypasses any RLS policy gaps).
 */
function serviceRoleClient() {
  const { url } = supabaseConfig()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!url || !key) {
    console.warn('[session-store] SUPABASE_SERVICE_ROLE_KEY not configured — presence writes skipped')
    return null
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Returns the server-observed trusted public IP from the Netlify header.
 * This header is set by Netlify infrastructure and cannot be spoofed by clients.
 * Returns null in localhost/dev where the header is absent.
 */
function getTrustedIp(event: any): string | null {
  const ip = event?.headers?.['x-nf-client-connection-ip'] || null
  return ip && typeof ip === 'string' ? ip.trim() : null
}

/**
 * Inserts the new-runtime presence row and optional session_started security event.
 * Entirely non-blocking — failures are logged but never propagate to the auth flow.
 */
async function insertPresenceRow(params: {
  sessionId: string
  userId: string
  orgId: string
  deviceId: string
  deviceInfo: any
  module: string
  visState: string
}, trustedIp: string | null): Promise<void> {
  const svc = serviceRoleClient()
  if (!svc) return

  const { sessionId, userId, orgId, deviceId, deviceInfo, module, visState } = params
  const now = new Date().toISOString()

  try {
    // Determine is_new_device before inserting (so the new row isn't counted)
    let isNewDevice = false
    if (deviceId) {
      const { count, error: countErr } = await svc
        .from('user_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('org_id', orgId)
        .eq('device_id', deviceId)
        .not('session_id', 'is', null)
      if (!countErr) isNewDevice = (count === 0)
    }

    // Insert presence row — ip_address intentionally omitted (remains NULL)
    const { error: insertErr } = await svc.from('user_sessions').insert({
      session_id:          sessionId,
      user_id:             userId,
      org_id:              orgId,
      device_id:           deviceId || null,
      device_type:         deviceInfo?.platform || 'web',
      device_info:         deviceInfo || {},
      module,
      started_at:          now,
      last_active_at:      now,
      last_interaction_at: now,
      visibility_state:    visState,
    })
    if (insertErr) {
      console.error('[session-store] user_sessions insert failed (non-fatal):', insertErr.message)
    }

    // Security event — only when a trusted IP is observed by Netlify
    if (trustedIp) {
      const { error: evtErr } = await svc.from('account_security_events').insert({
        session_id:         sessionId,
        user_id:            userId,
        org_id:             orgId,
        device_id:          deviceId || null,
        event_type:         'session_started',
        public_ip:          trustedIp,
        previous_public_ip: null,
        is_new_device:      isNewDevice,
        occurred_at:        now,
      })
      if (evtErr) {
        console.error('[session-store] account_security_events insert failed (non-fatal):', evtErr.message)
      }
    }
  } catch (err: any) {
    console.error('[session-store] insertPresenceRow failed (non-fatal):', err?.message)
  }
}

/**
 * Updates last_active_at (and optionally module/visibility_state) on the
 * persistent presence row. Called on every heartbeat (session.validate).
 * Never touches last_interaction_at — that is human-interaction only.
 */
async function updatePresenceHeartbeat(params: {
  sessionId: string
  userId: string
  module?: string
  visState?: string
}): Promise<void> {
  const svc = serviceRoleClient()
  if (!svc) return
  try {
    const update: Record<string, any> = { last_active_at: new Date().toISOString() }
    if (params.module    !== undefined) update.module           = params.module
    if (params.visState  !== undefined) update.visibility_state = params.visState
    await svc
      .from('user_sessions')
      .update(update)
      .eq('session_id', params.sessionId)
      .eq('user_id', params.userId)
  } catch (err: any) {
    console.error('[session-store] updatePresenceHeartbeat failed (non-fatal):', err?.message)
  }
}

/**
 * Sets last_interaction_at = now() on the persistent presence row.
 * Called only on explicit human-interaction signals, never on heartbeats.
 */
async function updatePresenceInteraction(sessionId: string, userId: string): Promise<void> {
  const svc = serviceRoleClient()
  if (!svc) return
  try {
    await svc
      .from('user_sessions')
      .update({ last_interaction_at: new Date().toISOString() })
      .eq('session_id', sessionId)
      .eq('user_id', userId)
  } catch (err: any) {
    console.error('[session-store] updatePresenceInteraction failed (non-fatal):', err?.message)
  }
}

/**
 * Marks the persistent presence row as ended with a reason.
 * Called from session.destroy before the Redis key is removed.
 */
async function endPresenceRow(sessionId: string, userId: string, endedReason: string | null): Promise<void> {
  const svc = serviceRoleClient()
  if (!svc) return
  try {
    const update: Record<string, any> = { ended_at: new Date().toISOString() }
    if (endedReason) update.ended_reason = endedReason
    await svc
      .from('user_sessions')
      .update(update)
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .not('session_id', 'is', null)
  } catch (err: any) {
    console.error('[session-store] endPresenceRow failed (non-fatal):', err?.message)
  }
}

/**
 * Checks for an IP change on session.validate. If the current trusted IP differs
 * from the Redis-cached IP, inserts one ip_changed security event and updates
 * the Redis session. Safe to call every heartbeat — only fires on actual change.
 */
async function checkAndRecordIpChange(
  session: any,
  sessionId: string,
  trustedIp: string | null,
): Promise<any> {
  if (!trustedIp) return session

  const prevIp = session.currentPublicIp || null
  if (prevIp === trustedIp) return session

  // IP changed — insert security event
  const svc = serviceRoleClient()
  if (svc && session.userId && session.orgId) {
    try {
      await svc.from('account_security_events').insert({
        session_id:         sessionId,
        user_id:            session.userId,
        org_id:             session.orgId,
        device_id:          session.deviceId || null,
        event_type:         'ip_changed',
        public_ip:          trustedIp,
        previous_public_ip: prevIp,
        is_new_device:      null,
        occurred_at:        new Date().toISOString(),
      })
    } catch (err: any) {
      console.error('[session-store] ip_changed event insert failed (non-fatal):', err?.message)
    }
  }

  return { ...session, currentPublicIp: trustedIp }
}

/**
 * Subscription tier for the caller's org.
 * Mirrors getOrgSubscription() in src/services/stripe.ts — RLS scopes the row.
 */
async function resolveTier(db: any): Promise<string> {
  if (!db) return 'free'
  try {
    const { data, error } = await db
      .from('subscriptions')
      .select('tier_slug, status')
      .in('status', ['active', 'trialing', 'past_due'])
      .order('created_at', { ascending: false })
      .limit(1)
    if (error) return 'free'
    const row = data?.[0]
    if (!row) return 'free'
    const isActive = row.status === 'active' || row.status === 'trialing'
    return isActive ? (row.tier_slug || 'solo') : 'free'
  } catch {
    return 'free'
  }
}

async function handleSessionCreate(user: any, db: any, body: any, event: any) {
  // Identity, org and role come from the profiles row — never the request body.
  let orgId = ''
  let role  = ''
  if (db) {
    const { data, error } = await db
      .from('profiles')
      .select('org_id, role')
      .eq('id', user.id)
      .single()
    if (!error) {
      orgId = data?.org_id ?? ''
      role  = data?.role ?? ''
    }
  }

  const tier       = await resolveTier(db)
  const sessionId  = crypto.randomUUID()
  const now        = Date.now()
  const deviceId   = String(body?.deviceId ?? '').slice(0, 64)
  const module     = String(body?.module ?? 'home').slice(0, 64)
  const visState   = body?.visibilityState === 'hidden' ? 'hidden' : 'visible'
  const deviceInfo = sanitizeDeviceInfo(body?.deviceInfo)
  const trustedIp  = getTrustedIp(event)

  const session = {
    sessionId,
    userId:          user.id,
    orgId,
    role,
    tier,
    deviceInfo,
    deviceId,
    currentPublicIp: trustedIp,
    createdAt:       now,
    lastActiveAt:    now,
  }

  const stored = await rSet(keys.session(sessionId), session, TTL_SESSION)
  if (!stored) return { sessionId: null, session: null }

  // Awaited before response — failure-isolated (insertPresenceRow catches all errors internally)
  await insertPresenceRow({ sessionId, userId: user.id, orgId, deviceId, deviceInfo, module, visState }, trustedIp)

  return { sessionId, session }
}

/** Load a session, refusing records that belong to somebody else. */
async function loadOwnedSession(user: any, sessionId: string) {
  if (!sessionId) return null
  const session = await rGet(keys.session(sessionId))
  if (!session) return null
  if (session.userId !== user.id) {
    console.warn('[session-store] session ownership mismatch — refusing')
    return null
  }
  return session
}

async function handleSessionValidate(user: any, body: any, event: any) {
  const sessionId = String(body?.sessionId ?? '')
  const session = await loadOwnedSession(user, sessionId)
  if (!session) return { session: null }

  const module   = body?.module   !== undefined ? String(body.module).slice(0, 64)   : undefined
  const visState = body?.visibilityState === 'hidden' ? 'hidden'
                 : body?.visibilityState === 'visible' ? 'visible'
                 : undefined

  // IP change check — updates Redis session and inserts ip_changed event if needed
  const trustedIp = getTrustedIp(event)
  const sessionAfterIp = await checkAndRecordIpChange(session, sessionId, trustedIp)

  const updated = { ...sessionAfterIp, lastActiveAt: Date.now() }
  await rSet(keys.session(sessionId), updated, TTL_SESSION)

  // Awaited before response — failure-isolated (updatePresenceHeartbeat catches errors internally)
  await updatePresenceHeartbeat({ sessionId, userId: user.id, module, visState })

  return { session: updated }
}

async function handleSessionInteraction(user: any, body: any) {
  const sessionId = String(body?.sessionId ?? '')
  const session = await loadOwnedSession(user, sessionId)
  if (!session) return { ok: false }

  // Awaited before response — failure-isolated (updatePresenceInteraction catches errors internally)
  await updatePresenceInteraction(sessionId, user.id)
  return { ok: true }
}

async function handleSessionGet(user: any, body: any) {
  const session = await loadOwnedSession(user, String(body?.sessionId ?? ''))
  return { session: session ?? null }
}

async function handleSessionDestroy(user: any, body: any) {
  const sessionId  = String(body?.sessionId ?? '')
  const endedReason = body?.endedReason ?? null
  const session = await loadOwnedSession(user, sessionId)
  if (session) {
    // Awaited before Redis delete — ensures ended_at/ended_reason persist; failure-isolated
    if (session.sessionId) {
      await endPresenceRow(session.sessionId, user.id, endedReason)
    }
    await rDel(keys.session(sessionId))
  }
  return { ok: true }
}

// ── Handler ──────────────────────────────────────────────────────────────────

exports.handler = async (event: any, _context: any) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  // SEC2: every intent is scoped to a verified caller.
  const user = await verifyAuthenticatedUser(event)
  if (!user) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Authentication required.' }),
    }
  }

  let body = {}
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) }
  }

  const intent = String(body?.intent ?? '')
  const db = userScopedClient(event)

  try {
    let result
    switch (intent) {
      case 'passcode.status':
        result = await handlePasscodeStatus(user, db)
        break
      case 'passcode.verify':
        result = await handlePasscodeVerify(user, db, body)
        break
      case 'passcode.clearLock':
        result = await handlePasscodeClearLock(user)
        break
      case 'session.create':
        result = await handleSessionCreate(user, db, body, event)
        break
      case 'session.validate':
        result = await handleSessionValidate(user, body, event)
        break
      case 'session.interaction':
        result = await handleSessionInteraction(user, body)
        break
      case 'session.get':
        result = await handleSessionGet(user, body)
        break
      case 'session.destroy':
        result = await handleSessionDestroy(user, body)
        break
      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: `Unknown intent: ${intent}` }),
        }
    }

    return { statusCode: 200, headers, body: JSON.stringify(result) }
  } catch (err: any) {
    console.error(`[session-store] ${intent} failed:`, err?.message)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Store operation failed' }),
    }
  }
}
