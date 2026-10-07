// @ts-nocheck
/**
 * portal-attachment-read — SEC-0S R3: Server-side signed read URL generation
 * for portal-uploads attachments.
 *
 * TWO MODES (selected by presence of Authorization header):
 *
 * CUSTOMER MODE (no Authorization header):
 *   POST { requestId: string }
 *   - Verifies requestId is a valid UUID (no other credential required)
 *   - Loads the portal request server-side using the service-role key
 *   - Extracts attachment paths from "FilePaths: ..." and historical "Files: ..."
 *   - Normalizes through the same strict host/request-prefix path validator
 *   - Signs each object using the service-role Supabase storage client
 *   - Returns short-lived signed URLs and safe display metadata
 *   - Returns no attachment info for invalid/nonexistent requestId
 *
 *   SEC-0 LIMITATION (preserved from SEC-0R):
 *   Customer tracking uses the request UUID as the only bearer.  The UUID
 *   provides ~122 bits of entropy and is not guessable by enumeration.
 *   This is not equivalent to a session credential.  Org-level customer
 *   authentication is a future phase.
 *
 * OWNER/ADMIN MODE (Authorization: Bearer <supabase-jwt>):
 *   POST { requestId: string }
 *   Headers: Authorization: Bearer <supabase-session-jwt>
 *   - Verifies the JWT via Supabase auth (/auth/v1/user)
 *   - Derives user_id server-side (never trusts client-supplied identity)
 *   - Calls get_portal_attachment_context with that exact JWT
 *   - Requires exact caller-org = request-org equality before path parsing
 *   - Uses the same path normalizer as customer mode
 *   - Signs each object using the service-role Storage client
 *
 * PATH GRAMMAR (SEC-0S R3):
 *   Canonical:  {request-uuid}/{attachment-uuid}.{allowed-ext}
 *   Historical: {request-uuid}/{safe-historical-filename}.{allowed-ext}
 *
 * SECURITY PROPERTIES:
 *   - service-role key never leaves this function
 *   - browser never calls createSignedUrl / createSignedUrls / getPublicUrl
 *   - signed URLs expire in 300 seconds (5 minutes); client cannot override
 *   - raw storage paths are never returned to the client
 *   - client cannot supply or influence which paths are signed
 *   - cross-request path substitution is rejected (path prefix == requestId)
 *   - path traversal and external host injection are rejected
 *   - signed URLs are not logged
 *   - authorization failure returns no path/URL/count information
 */

const { createClient } = require('@supabase/supabase-js')

const SIGNED_URL_EXPIRY_SECONDS = 300 // 5 minutes
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const UUID_SEGMENT = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const ALLOWED_EXT_RE = '(?:jpg|jpeg|png|gif|webp|heic|heif|mp4|mov|pdf)'
const CANONICAL_PATH_RE = new RegExp(
  `^${UUID_SEGMENT}/${UUID_SEGMENT}\\.${ALLOWED_EXT_RE}$`,
  'i'
)
// Historical filename: nonempty, no separators/traversal, bounded length, allowed chars.
const HISTORICAL_FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._()\[\]@+\-]{0,198}$/
const MAX_OBJECT_PATH_LENGTH = 500

const ALLOWED_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'mp4', 'mov', 'pdf'])
const EXT_TO_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
  mp4: 'video/mp4', mov: 'video/quicktime', pdf: 'application/pdf',
}

// ── CORS ──────────────────────────────────────────────────────────────────────

function buildAllowedOrigins() {
  const origins = new Set([
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:8888',
  ])
  const siteUrl = process.env.URL
  const deployUrl = process.env.DEPLOY_URL
  const deployPrimeUrl = process.env.DEPLOY_PRIME_URL
  if (siteUrl) origins.add(siteUrl.replace(/\/$/, ''))
  if (deployUrl) origins.add(deployUrl.replace(/\/$/, ''))
  if (deployPrimeUrl) origins.add(deployPrimeUrl.replace(/\/$/, ''))
  return origins
}

// Netlify's Lambda event Host is preferred; forwarded Host is a fallback only.
// Reject ambiguous authority strings before stripping an optional numeric port.
function normalizeRequestHost(host) {
  if (typeof host !== 'string' || !host || /[\s,/@?#\\]/.test(host) || containsControlChars(host)) return null
  const match = /^([a-z0-9.-]+)(?::([0-9]{1,5}))?$/i.exec(host)
  if (!match || (match[2] && (Number(match[2]) < 1 || Number(match[2]) > 65535))) return null
  const hostname = match[1].toLowerCase()
  if (hostname.length > 253 || !hostname.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null
  return hostname
}

function isTrustedPowerOnNetlifyHost(host) {
  const hostname = normalizeRequestHost(host)
  const site = 'incomparable-croissant-a86c81.netlify.app'
  if (hostname === site) return true
  if (!hostname?.endsWith(`--${site}`)) return false
  const prefix = hostname.slice(0, -(`--${site}`.length))
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(prefix)
}

function requestHostFromHeaders(headers = {}) {
  // Never let a forwarded header override a supplied (even invalid) Host.
  return normalizeRequestHost(headers.host ?? headers.Host ?? headers['x-forwarded-host'] ?? headers['X-Forwarded-Host'])
}

function resolveOrigin(requestOrigin, requestHost) {
  if (!requestOrigin) return null
  const allowed = buildAllowedOrigins()
  if (allowed.has(requestOrigin)) return requestOrigin
  if (typeof requestOrigin !== 'string' || /[\s\\]/.test(requestOrigin) || containsControlChars(requestOrigin)) return null
  const host = normalizeRequestHost(requestHost)
  if (!isTrustedPowerOnNetlifyHost(host)) return null
  try {
    const url = new URL(requestOrigin)
    // Origin is an authority only: reject even a trailing slash or empty ?/#.
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || requestOrigin.toLowerCase() !== `https://${url.hostname}` || url.hostname !== host) return null
    return requestOrigin
  } catch { return null }
}

function corsHeaders(requestOrigin, requestHost) {
  const origin = resolveOrigin(requestOrigin, requestHost)
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  }
  if (origin) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

function jsonResponse(statusCode, body, requestOrigin, requestHost) {
  return {
    statusCode,
    headers: { ...corsHeaders(requestOrigin, requestHost), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

// ── Path normalization (shared customer + owner) ──────────────────────────────

function containsControlChars(s) {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    if (code < 32 || code === 127) return true
  }
  return false
}

/**
 * Decode a URL path segment at most once. Reject malformed encoding, residual
 * percent-encoding (blocks double-encoding), and traversal residues.
 */
function safeDecodeOnce(raw) {
  if (typeof raw !== 'string' || !raw) return null
  let decoded
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return null
  }
  if (/%(?:2e|2f|5c)/i.test(decoded) || decoded.includes('%')) return null
  if (decoded.includes('..') || decoded.includes('\\') || decoded.includes('/')) return null
  if (containsControlChars(decoded)) return null
  return decoded
}

/**
 * Validate a bucket-relative object path against the SEC-0S R3 grammar and
 * bind it to the authorized request ID.
 */
function validateObjectPath(path, requestId) {
  if (!path || typeof path !== 'string' || !requestId) return false
  if (path.length > MAX_OBJECT_PATH_LENGTH) return false
  if (path.includes('\\') || path.includes('..') || path.startsWith('/') || path.endsWith('/')) return false
  if (containsControlChars(path)) return false
  if (path.includes('%')) return false

  const parts = path.split('/')
  if (parts.length !== 2) return false

  const [prefix, filename] = parts
  if (prefix.toLowerCase() !== String(requestId).toLowerCase()) return false
  if (!UUID_RE.test(prefix)) return false
  if (!filename || filename.includes('/') || filename.includes('\\')) return false

  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (!ALLOWED_EXTS.has(ext)) return false
  if (filename.toLowerCase() === `.${ext}` || !filename.includes('.')) return false

  // Canonical new uploads: {uuid}/{uuid}.{ext}
  if (CANONICAL_PATH_RE.test(path)) return true

  // Historical: {uuid}/{safe-filename}.{ext}
  const base = filename.slice(0, -(ext.length + 1))
  if (!HISTORICAL_FILENAME_RE.test(base)) return false
  if (base.includes('..')) return false
  return true
}

/**
 * Normalize a URL or relative path into a validated portal-uploads object path.
 * Historical URLs are accepted only for the configured Supabase host + bucket.
 */
function normalizePortalObjectPath(urlOrPath, requestId, supabaseHost) {
  if (!urlOrPath || typeof urlOrPath !== 'string' || !requestId || !supabaseHost) return null
  const s = urlOrPath.trim()
  if (!s) return null

  // Protocol-relative and non-HTTPS absolute URLs rejected.
  if (s.startsWith('//')) return null

  let candidate = null

  if (s.includes('://')) {
    let url
    try { url = new URL(s) }
    catch { return null }

    if (url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    if (url.host !== supabaseHost) return null
    if (url.search || url.hash) {
      // Query/fragment allowed only as Storage signing residue AFTER the object
      // path; reject when they appear before we extract a clean path segment.
      // Public historical URLs should not carry query/fragment. Signed-style
      // URLs may include ?token= — strip by using pathname only below.
    }

    const m = url.pathname.match(
      /^\/storage\/v1\/object\/(?:public|sign)\/portal-uploads\/(.+)$/
    )
    if (!m) return null

    const encodedPath = m[1]
    const lowerEncoded = encodedPath.toLowerCase()
    if (
      lowerEncoded.includes('%2e%2e') ||
      lowerEncoded.includes('%2f') ||
      lowerEncoded.includes('%5c') ||
      lowerEncoded.includes('%252e') ||
      encodedPath.includes('\\') ||
      encodedPath.includes('..')
    ) {
      return null
    }

    // Decode each path segment independently; preserve directory structure.
    const segments = encodedPath.split('/')
    if (segments.length !== 2) return null
    const decodedSegments = []
    for (const seg of segments) {
      // Reject pre-encoded slash inside a segment (%2F already blocked above).
      const decoded = safeDecodeOnce(seg)
      if (decoded === null) return null
      decodedSegments.push(decoded)
    }
    candidate = decodedSegments.join('/')
  } else {
    if (s.startsWith('/') || s.startsWith('\\')) return null
    const lower = s.toLowerCase()
    if (lower.includes('%2e%2e') || lower.includes('%2f') || lower.includes('%5c') || lower.includes('%252e')) {
      return null
    }
    if (s.includes('%')) {
      // Relative paths must already be decoded; refuse encoded relative input.
      return null
    }
    if (s.includes('..') || s.includes('\\')) return null
    candidate = s
  }

  if (!validateObjectPath(candidate, requestId)) return null
  return candidate
}

/**
 * Parse attachment paths from portal_requests.notes for BOTH customer and owner.
 * Supports FilePaths: (canonical) and Files: (historical public URLs).
 * Deduplicates by normalized object path while preserving first-seen order.
 */
function parseNotesForPaths(notes, requestId, supabaseHost) {
  if (!notes || typeof notes !== 'string') return []

  const collected = []

  const filePathsMatch = notes.match(/FilePaths:\s*([^|]+)/i)
  if (filePathsMatch) {
    for (const part of filePathsMatch[1].split(',')) {
      const normalized = normalizePortalObjectPath(part.trim(), requestId, supabaseHost)
      if (normalized) collected.push(normalized)
    }
  }

  const filesMatch = notes.match(/Files:\s*([^|]+)/i)
  if (filesMatch) {
    for (const part of filesMatch[1].split(',')) {
      const normalized = normalizePortalObjectPath(part.trim(), requestId, supabaseHost)
      if (normalized) collected.push(normalized)
    }
  }

  const seen = new Set()
  const deduped = []
  for (const path of collected) {
    const key = path.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(path)
  }
  return deduped
}

function getPathMeta(path, index) {
  const segment = path.split('/').pop() ?? path
  const ext = segment.split('.').pop()?.toLowerCase() ?? ''
  const mime = EXT_TO_MIME[ext] ?? null
  if (/^[0-9a-f-]{36}\.[a-z0-9]+$/i.test(segment)) {
    return { displayName: `Attachment ${index + 1}${ext ? ` (${ext.toUpperCase()})` : ''}`, mimeType: mime }
  }
  // Historical filename — never return the storage path; sanitize display label.
  const safeLabel = segment.replace(/[^\w.\-()[\]@+]+/g, '_').slice(0, 80)
  return { displayName: safeLabel || `Attachment ${index + 1}`, mimeType: mime }
}

/**
 * Encode an already-validated object path for Storage REST URLs when needed.
 * Preserves `/` as a directory separator; encodes each segment independently.
 * Official createSignedUrl preferred — this helper is for contract tests / fallback.
 */
function encodeObjectPathForStorageApi(objectPath) {
  if (!objectPath || typeof objectPath !== 'string') return null
  if (objectPath.includes('\\') || objectPath.includes('..') || objectPath.startsWith('/')) return null
  if (objectPath.includes('%')) return null
  const parts = objectPath.split('/')
  if (parts.length !== 2) return null
  if (parts.some(p => !p || p.includes('/') || p.includes('\\') || p.includes('..'))) return null
  return parts.map(segment => encodeURIComponent(segment)).join('/')
}

async function createSignedReadUrl(supabaseUrl, serviceRoleKey, objectPath) {
  // Prefer the official Storage client so path separators remain intact.
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase.storage
    .from('portal-uploads')
    .createSignedUrl(objectPath, SIGNED_URL_EXPIRY_SECONDS)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

exports._test = {
  normalizeRequestHost, isTrustedPowerOnNetlifyHost, requestHostFromHeaders,
  buildAllowedOrigins,
  resolveOrigin,
  corsHeaders,
  normalizePortalObjectPath,
  validateObjectPath,
  parseNotesForPaths,
  encodeObjectPathForStorageApi,
  getPathMeta,
  SIGNED_URL_EXPIRY_SECONDS,
  ALLOWED_EXTS,
}

// ── Handler ───────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  const origin = event.headers?.origin ?? event.headers?.Origin
  const requestHost = requestHostFromHeaders(event.headers)
  const reply = (status, body) => jsonResponse(status, body, origin, requestHost)
  const originAllowed = !origin || resolveOrigin(origin, requestHost) !== null

  if (!originAllowed) {
    return reply(403, { error: 'Forbidden' })
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(origin, requestHost), body: '' }
  }
  if (event.httpMethod !== 'POST') {
    return reply(405, { error: 'Method not allowed' })
  }

  const SUPABASE_URL     = process.env.SUPABASE_URL
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('portal-attachment-read: missing env vars')
    return reply(500, { error: 'Server configuration error' })
  }

  const supabaseHost = (() => { try { return new URL(SUPABASE_URL).host } catch { return '' } })()
  if (!supabaseHost) {
    console.error('portal-attachment-read: invalid SUPABASE_URL')
    return reply(500, { error: 'Server configuration error' })
  }

  let body
  try { body = JSON.parse(event.body || '{}') }
  catch { return reply(400, { error: 'Invalid JSON body' }) }

  // Ignore any client-supplied path/URL fields — only requestId is accepted.
  const { requestId } = body
  if (!requestId || typeof requestId !== 'string' || !UUID_RE.test(requestId)) {
    return reply(400, { error: 'Invalid requestId' })
  }

  const authHeader = event.headers?.authorization ?? event.headers?.Authorization ?? ''
  const isOwnerMode = authHeader.startsWith('Bearer ')
  const jwt = isOwnerMode ? authHeader.slice('Bearer '.length).trim() : null

  const serviceHeaders = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  }

  let ownerRequestContext = null

  if (isOwnerMode) {
    let verifiedUserId
    try {
      const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: {
          Authorization: `Bearer ${jwt}`,
          apikey: SERVICE_ROLE_KEY,
        },
      })
      if (!authRes.ok) {
        return reply(403, { error: 'Unauthorized' })
      }
      const authData = await authRes.json()
      verifiedUserId = authData?.id
      if (!verifiedUserId) {
        return reply(403, { error: 'Unauthorized' })
      }
    } catch (err) {
      console.error('portal-attachment-read: auth verification error', err?.message)
      return reply(503, { error: 'Authentication service unavailable' })
    }

    try {
      const contextRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_portal_attachment_context`, {
        method: 'POST',
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${jwt}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_id: requestId }),
      })
      if (!contextRes.ok) {
        console.error('portal-attachment-read: attachment context query error', contextRes.status)
        return reply(503, { error: 'Request unavailable' })
      }
      const contexts = await contextRes.json()
      ownerRequestContext = Array.isArray(contexts) ? contexts[0] ?? null : null
    } catch (err) {
      console.error('portal-attachment-read: attachment context fetch error', err?.message)
      return reply(503, { error: 'Database unavailable' })
    }

    const callerOrg = ownerRequestContext?.caller_organization_id
    const requestOrg = ownerRequestContext?.request_organization_id
    if (
      !ownerRequestContext ||
      !callerOrg ||
      !requestOrg ||
      String(callerOrg).toLowerCase() !== String(requestOrg).toLowerCase()
    ) {
      // Missing, cross-org, role-only, and ordinary-employee cases deliberately
      // share one response and disclose no request/path/attachment information.
      return reply(404, { error: 'Request unavailable' })
    }
  }

  let requestRow = isOwnerMode
    ? { id: ownerRequestContext.request_id, notes: ownerRequestContext.notes }
    : null

  if (!isOwnerMode) {
    try {
      const { denyPlannerUuidRead } = require('./lib/planner-legacy-guard.cjs')
      if (await denyPlannerUuidRead(fetch, SUPABASE_URL, serviceHeaders, requestId)) {
        return reply(403, { error: 'Planner recovery capability required' })
      }
    } catch {
      return reply(503, { error: 'Request unavailable' })
    }
    try {
      const selectFields = 'id,notes'
      const reqRes = await fetch(
        `${SUPABASE_URL}/rest/v1/portal_requests?id=eq.${encodeURIComponent(requestId)}&select=${selectFields}&limit=1`,
        { headers: serviceHeaders }
      )
      if (!reqRes.ok) {
        console.error('portal-attachment-read: request query error', reqRes.status)
        return reply(500, { error: 'Database error' })
      }
      const rows = await reqRes.json()
      requestRow = rows?.[0] ?? null
    } catch (err) {
      console.error('portal-attachment-read: request fetch error', err?.message)
      return reply(503, { error: 'Database unavailable' })
    }
  }

  if (!requestRow) {
    if (isOwnerMode) {
      return reply(404, { error: 'Request unavailable' })
    }
    return reply(200, { attachments: [] })
  }

  // Owner authority is established above. Planner reads use registered objects only,
  // with safe manifest metadata; notes and superseded allocations are not authoritative.
  let plannerPhotos = null
  if (isOwnerMode) {
    try {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/portal_request_planner_details?request_id=eq.${encodeURIComponent(requestId)}&select=photo_manifest,photo_transport&limit=1`,
        { headers: serviceHeaders }
      )
      if (!response.ok) return reply(503, { error: 'Request unavailable' })
      const rows = await response.json()
      if (!Array.isArray(rows)) return reply(503, { error: 'Request unavailable' })
      if (rows.length) {
        const { registeredOwnerPhotos } = require('./lib/planner-owner-photos.cjs')
        plannerPhotos = registeredOwnerPhotos(rows[0], requestId, validateObjectPath)
      }
    } catch {
      return reply(503, { error: 'Request unavailable' })
    }
  }

  // Owner organization equality is already enforced. Planner paths were validated
  // against registered objects; ordinary notes retain the existing normalizer.
  const validPaths = plannerPhotos !== null
    ? plannerPhotos.map(photo => photo.path)
    : parseNotesForPaths(requestRow.notes, requestId, supabaseHost)

  if (validPaths.length === 0) {
    return reply(200, { attachments: [] })
  }

  const expiresAt = new Date(Date.now() + SIGNED_URL_EXPIRY_SECONDS * 1000).toISOString()
  const attachments = []

  for (let i = 0; i < validPaths.length; i++) {
    const path = validPaths[i]
    const meta = getPathMeta(path, i)
    let signedUrl = null
    try {
      signedUrl = await createSignedReadUrl(SUPABASE_URL, SERVICE_ROLE_KEY, path)
    } catch (err) {
      console.error('portal-attachment-read: sign error for path index', i, err?.message)
    }
    attachments.push({
      ...(plannerPhotos !== null ? {
        clientPhotoId: plannerPhotos[i].clientPhotoId,
        category: plannerPhotos[i].category,
        caption: plannerPhotos[i].caption,
      } : {}),
      displayName: meta.displayName,
      mimeType: meta.mimeType,
      signedUrl,
      expiresAt: signedUrl ? expiresAt : null,
    })
  }

  return reply(200, { attachments })
}
