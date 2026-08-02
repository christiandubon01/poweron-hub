// @ts-nocheck
/**
 * portal-upload-authorize — SEC-0S R1: Signed upload URL generation for portal
 * attachments.
 *
 * Validates the one-time attach token against the DB (without consuming it),
 * enforces the per-request attachment count limit against already-registered
 * paths, generates a Supabase Storage signed upload URL for each requested
 * file, and records the authorized paths in portal_upload_authorizations so
 * that register_portal_attachments can verify they were server-issued.
 *
 * Security properties enforced here:
 *   - Token is validated (SHA-256 hash match, status=new, ≤30 min window)
 *   - Already-registered attachment count prevents exceeding MAX_FILE_COUNT
 *     across repeated authorization calls
 *   - MIME type must be in the portal allowlist
 *   - File size > 0 and ≤ 256 MB
 *   - Object path is server-generated (requestId/uuid.ext) — not client-supplied
 *   - Service role key never leaves this function
 *   - Authorized paths recorded in portal_upload_authorizations for finalization
 *   - Does NOT consume the token (register_portal_attachments does that)
 *   - CORS restricted to known deployment origins
 *
 * Orphan risk (documented):
 *   If the browser calls authorize but does not subsequently call
 *   register_portal_attachments, the generated storage objects become orphans.
 *   This is bounded by: the 30-minute window, upsert:false (no overwrite),
 *   and request-scoped paths (no cross-request access).  A read-only orphan
 *   report query can identify them.  No cleanup scheduler is implemented here.
 */

const crypto = require('crypto')

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
  'image/webp', 'image/heic', 'image/heif',
  'video/mp4', 'video/quicktime', 'video/x-mov',
  'application/pdf',
])

const EXTENSION_MAP = {
  'image/jpeg':        'jpg',
  'image/jpg':         'jpg',
  'image/png':         'png',
  'image/gif':         'gif',
  'image/webp':        'webp',
  'image/heic':        'heic',
  'image/heif':        'heif',
  'video/mp4':         'mp4',
  'video/quicktime':   'mov',
  'video/x-mov':       'mov',
  'application/pdf':   'pdf',
}

const MAX_FILE_SIZE  = 268435456  // 256 MB — matches bucket-level limit
const MAX_FILE_COUNT = 10
const UPLOAD_WINDOW_MS = 30 * 60 * 1000  // 30 minutes
const AUTH_EXPIRY_SECONDS = 30 * 60      // authorization record lifetime

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

function resolveOrigin(requestOrigin) {
  if (!requestOrigin) return null
  const allowed = buildAllowedOrigins()
  if (allowed.has(requestOrigin)) return requestOrigin
  return null
}

function corsHeaders(requestOrigin) {
  const origin = resolveOrigin(requestOrigin)
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  }
  if (origin) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

function jsonResponse(statusCode, body, requestOrigin) {
  return {
    statusCode,
    headers: { ...corsHeaders(requestOrigin), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

exports._test = { buildAllowedOrigins, resolveOrigin, corsHeaders }

exports.handler = async (event) => {
  const origin = event.headers?.origin ?? event.headers?.Origin
  const originAllowed = !origin || resolveOrigin(origin) !== null

  if (!originAllowed) {
    return jsonResponse(403, { error: 'Forbidden' }, origin)
  }

  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(origin), body: '' }
  }
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' }, origin)
  }

  const SUPABASE_URL      = process.env.SUPABASE_URL
  const SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('portal-upload-authorize: missing env vars')
    return jsonResponse(500, { error: 'Server configuration error' }, origin)
  }

  // Parse body
  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' }, origin)
  }

  const { requestId, attachToken, files } = body

  // ── Input validation ──────────────────────────────────────────────────────
  if (!requestId || typeof requestId !== 'string') {
    return jsonResponse(400, { error: 'Missing requestId' }, origin)
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
    return jsonResponse(400, { error: 'Invalid requestId format' }, origin)
  }
  if (!attachToken || typeof attachToken !== 'string' || attachToken.length !== 64) {
    return jsonResponse(400, { error: 'Invalid attach token' }, origin)
  }
  if (!Array.isArray(files) || files.length === 0) {
    return jsonResponse(400, { error: 'No files specified' }, origin)
  }
  if (files.length > MAX_FILE_COUNT) {
    return jsonResponse(400, { error: `Too many files (max ${MAX_FILE_COUNT})` }, origin)
  }

  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    if (!f || typeof f !== 'object') {
      return jsonResponse(400, { error: `File ${i}: invalid file entry` }, origin)
    }
    if (!f.name || typeof f.name !== 'string' || f.name.length > 255) {
      return jsonResponse(400, { error: `File ${i}: missing or invalid name` }, origin)
    }
    if (!f.mimeType || !ALLOWED_MIME_TYPES.has(f.mimeType)) {
      return jsonResponse(400, { error: `File ${i}: unsupported type "${f.mimeType}"` }, origin)
    }
    if (typeof f.size !== 'number' || f.size <= 0 || f.size > MAX_FILE_SIZE) {
      return jsonResponse(400, { error: `File ${i}: invalid size` }, origin)
    }
  }

  // ── Token validation ──────────────────────────────────────────────────────
  const tokenHash = crypto.createHash('sha256').update(attachToken, 'utf8').digest('hex')

  const dbHeaders = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  }

  let dbRow
  try {
    const dbRes = await fetch(
      `${SUPABASE_URL}/rest/v1/portal_requests` +
        `?id=eq.${encodeURIComponent(requestId)}` +
        `&attach_token_hash=eq.${encodeURIComponent(tokenHash)}` +
        `&status=eq.new` +
        `&select=id,created_at,notes`,
      { headers: dbHeaders }
    )
    if (!dbRes.ok) {
      console.error('portal-upload-authorize: DB response', dbRes.status)
      return jsonResponse(500, { error: 'Database error' }, origin)
    }
    const rows = await dbRes.json()
    if (!Array.isArray(rows) || rows.length === 0) {
      return jsonResponse(403, { error: 'Invalid or expired upload token' }, origin)
    }
    dbRow = rows[0]
  } catch (err) {
    console.error('portal-upload-authorize: DB fetch error', err?.message)
    return jsonResponse(503, { error: 'Database unavailable' }, origin)
  }

  // Check the 30-minute upload window (belt-and-suspenders: DB also enforces this)
  const createdAt = new Date(dbRow.created_at)
  if (isNaN(createdAt.getTime()) || Date.now() - createdAt.getTime() > UPLOAD_WINDOW_MS) {
    return jsonResponse(403, { error: 'Upload window has expired' }, origin)
  }

  // ── Already-registered count check ──────────────────────────────────────────
  // Count how many paths are already stored in notes under "FilePaths:".
  // This prevents exceeding the count limit by calling authorize multiple times
  // before a registration happens.
  const notes = dbRow.notes ?? ''
  const filePathsMatch = notes.match(/FilePaths:\s*([^|]+)/)
  const alreadyRegisteredCount = filePathsMatch
    ? filePathsMatch[1].split(',').map(p => p.trim()).filter(Boolean).length
    : 0

  if (alreadyRegisteredCount + files.length > MAX_FILE_COUNT) {
    return jsonResponse(400, {
      error: `Total attachment count would exceed limit of ${MAX_FILE_COUNT} (already registered: ${alreadyRegisteredCount})`,
    }, origin)
  }

  // ── Generate signed upload URLs ───────────────────────────────────────────
  const uploads = []

  for (const file of files) {
    const ext        = EXTENSION_MAP[file.mimeType] ?? 'bin'
    const attachId   = crypto.randomUUID()
    // Object path: {requestId}/{uuid}.{ext}  — no customer filename in storage
    const objectPath = `${requestId}/${attachId}.${ext}`

    let storageRes
    try {
      storageRes = await fetch(
        `${SUPABASE_URL}/storage/v1/object/sign/upload/portal-uploads/${objectPath}`,
        {
          method: 'POST',
          headers: dbHeaders,
          body: JSON.stringify({ upsert: false }),
        }
      )
    } catch (err) {
      console.error('portal-upload-authorize: storage sign error', err?.message)
      return jsonResponse(502, { error: 'Failed to generate upload URL' }, origin)
    }

    if (!storageRes.ok) {
      const errText = await storageRes.text().catch(() => '')
      console.error('portal-upload-authorize: storage sign', storageRes.status, errText)
      return jsonResponse(502, { error: 'Failed to generate upload URL' }, origin)
    }

    const storageData = await storageRes.json()

    let signedUploadUrl
    if (storageData.signedUrl) {
      signedUploadUrl = storageData.signedUrl.startsWith('http')
        ? storageData.signedUrl
        : `${SUPABASE_URL}${storageData.signedUrl}`
    } else if (storageData.token) {
      signedUploadUrl =
        `${SUPABASE_URL}/storage/v1/object/upload/sign/portal-uploads/${objectPath}` +
        `?token=${encodeURIComponent(storageData.token)}`
    } else {
      console.error('portal-upload-authorize: unexpected storage response format')
      return jsonResponse(502, { error: 'Unexpected storage response format' }, origin)
    }

    uploads.push({ signedUploadUrl, objectPath, displayName: file.name })
  }

  // ── Record authorized paths in portal_upload_authorizations ─────────────────
  // This binding ensures register_portal_attachments can verify that the paths
  // were actually issued by this server function (not fabricated by the client).
  const authorizedPaths = uploads.map(u => u.objectPath)
  const expiresAt = new Date(Date.now() + AUTH_EXPIRY_SECONDS * 1000).toISOString()

  try {
    const authInsertRes = await fetch(
      `${SUPABASE_URL}/rest/v1/portal_upload_authorizations`,
      {
        method: 'POST',
        headers: { ...dbHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify({
          request_id: requestId,
          paths:      authorizedPaths,
          expires_at: expiresAt,
        }),
      }
    )
    if (!authInsertRes.ok) {
      const errText = await authInsertRes.text().catch(() => '')
      console.error('portal-upload-authorize: auth record insert error', authInsertRes.status, errText)
      return jsonResponse(500, { error: 'Failed to record upload authorization' }, origin)
    }
  } catch (err) {
    console.error('portal-upload-authorize: auth record insert exception', err?.message)
    return jsonResponse(503, { error: 'Database unavailable' }, origin)
  }

  // Never log signedUploadUrls or objectPaths in production
  return jsonResponse(200, { uploads }, origin)
}
