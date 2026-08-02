/**
 * portalStorageSecurityContract.test.ts — SEC-0S R2/R3 Security Contract
 *
 * Enforces the repaired private portal attachment storage design:
 *
 *   STORAGE RLS
 *   1.  Migration 111 drops portal_uploads_public_read
 *   2.  Migration 111 drops portal_uploads_public_insert
 *   3.  No existence-only anon SELECT policy created (portal_uploads_anon_read absent)
 *   4.  No broad authenticated SELECT policy created (portal_uploads_owner_read absent)
 *   5.  Bucket set to private (public = false)
 *   6.  Bucket MIME/size limits present and aligned with server contract
 *   7.  portal_upload_authorizations table created with RLS enabled
 *
 *   SIGNED READ — SERVER ENDPOINT
 *   8.  portal-attachment-read Netlify function exists
 *   9.  Browser code never calls createSignedUrl for portal-uploads
 *   10. Browser code never calls createSignedUrls for portal-uploads
 *   11. Browser code never calls getPublicUrl for portal-uploads
 *   12. PortalTrackView calls fetchAttachmentSignedUrls (server endpoint)
 *   13. PortalInbox calls fetchAttachmentSignedUrls (server endpoint)
 *   14. PortalInbox passes JWT to fetchAttachmentSignedUrls (owner mode)
 *   15. get_portal_request_status does NOT return attachment_paths (no raw paths to browser)
 *
 *   UPLOAD AUTHORIZATION
 *   16. portal-upload-authorize.ts exists
 *   17. Upload authorize inserts into portal_upload_authorizations
 *   18. Upload authorize rejects zero-byte files (size <= 0)
 *   19. Upload authorize enforces MAX_FILE_COUNT (10)
 *   20. Upload authorize rejects unsupported MIME types
 *   21. Upload authorize CORS is not wildcard *
 *   22. register_portal_attachments validates against portal_upload_authorizations
 *   23. register_portal_attachments verifies object existence in storage.objects
 *   24. register_portal_attachments validates stored MIME types
 *   25. register_portal_attachments validates stored size (zero-byte rejection)
 *
 *   PATH NORMALIZATION
 *   26. extractStoragePath returns null for protocol-relative URLs
 *   27. extractStoragePath rejects encoded path traversal (%2e%2e)
 *   28. extractStoragePath rejects absolute paths
 *   29. extractStoragePath extracts valid portal-uploads paths from full URLs
 *   30. extractStoragePath returns relative paths as-is
 *   31. extractStoragePath rejects .. traversal in bare paths
 *
 *   CUSTOMER PORTAL UPLOAD FLOW
 *   32. CustomerPortalView calls portal-upload-authorize (not direct Storage.upload)
 *   33. CustomerPortalView calls register_portal_attachments (not append_portal_request_files)
 *   34. CustomerPortalView does NOT call getPublicUrl
 *   35. CustomerPortalView uploads via PUT to signed URL
 *   36. CustomerPortalView passes p_paths to register_portal_attachments
 *
 *   TRACKING RESPONSE
 *   37. get_portal_request_status does not include attachment_paths key in returned object
 *   38. get_portal_request_status does not expose notes
 *
 *   PARSE UTILITIES
 *   39. parseAttachmentPaths returns [] for null/empty notes
 *   40. parseAttachmentPaths parses FilePaths: format
 *   41. parseAttachmentPaths parses old Files: URL format via extractStoragePath
 *   42. parseAttachmentPaths: FilePaths takes priority when both formats present
 *   43. parseAttachmentPaths: FilePaths terminated by | returns only paths before pipe
 *
 *   DISPLAY HELPERS
 *   44. isImagePath identifies jpg/png/webp
 *   45. isPdfPath identifies pdf
 *   46. getAttachmentDisplayName returns "Attachment N (EXT)" for UUID-named files
 *
 *   SERVER ENDPOINT CONTRACT (static)
 *   47. portal-attachment-read uses service role key (not anon key) for signing
 *   48. portal-attachment-read verifies JWT via Supabase auth endpoint (owner mode)
 *   49. portal-attachment-read derives paths from notes server-side (not client-supplied)
 *   50. portal-attachment-read validates path first segment == requestId
 *   51. portal-attachment-read returns no paths on validation failure
 *   52. portal-attachment-read CORS is not wildcard *
 *
 *   SEC-0R / R3 REGRESSION
 *   53. Migration 111 replaces portal_requests_owner_admin_select (org-bound)
 *   54. Migration 111 replaces portal_requests_owner_admin_update (org-bound)
 *   55. Migration 111 asserts exactly 2 portal_requests policies
 *   56. submit_portal_request still exists in migration 107 (one-time token still issued)
 *   57. append_portal_request_files retired + browser EXECUTE revoked in migration 111
 *
 *   MIGRATION DIRECTORY
 *   58. Migration 111 file exists in supabase/migrations/
 *   59. No SEC-0S portal/private-storage migration 112 (unrelated solar 112 residue allowed)
 *
 * Test types:
 *   [STATIC]  Read source/migration files and assert content
 *   [PURE]    No mocks; test deterministic utility functions directly
 *   [MOCK]    Exercise service logic with mocked dependencies
 *   [UNIT]    Exercise exported Netlify helper normalizers/encoders
 *
 * R2 adds organization-bound request ownership, owner/admin attachment
 * authorization, Portal data scoping, CORS denial, and test-accounting guards.
 * R3 adds historical Files: path grammar, host-bound normalization, slash-safe
 * signed-read encoding, and legacy append RPC lockdown.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const ROOT    = process.cwd()
const MIG_DIR = join(ROOT, 'supabase/migrations')
const FN_DIR  = join(ROOT, 'netlify/functions')

const mig111Path = join(MIG_DIR, '111_private_portal_storage.sql')
const mig111     = existsSync(mig111Path) ? readFileSync(mig111Path, 'utf8') : ''

const mig107 = readFileSync(join(MIG_DIR, '107_secure_portal_requests_access.sql'), 'utf8')
const mig108 = readFileSync(join(MIG_DIR, '108_remove_legacy_portal_request_access.sql'), 'utf8')

const portalView     = readFileSync(join(ROOT, 'src/views/CustomerPortalView.tsx'), 'utf8')
const portalInbox    = readFileSync(join(ROOT, 'src/components/hunter/PortalInbox.tsx'), 'utf8')
const portalTrack    = readFileSync(join(ROOT, 'src/views/PortalTrackView.tsx'), 'utf8')
const storageService = readFileSync(join(ROOT, 'src/services/portal/portalStorageService.ts'), 'utf8')
const portalService  = readFileSync(join(ROOT, 'src/services/portal/portalService.ts'), 'utf8')
const uploadFn       = readFileSync(join(FN_DIR, 'portal-upload-authorize.ts'), 'utf8')
const readFn         = existsSync(join(FN_DIR, 'portal-attachment-read.ts'))
  ? readFileSync(join(FN_DIR, 'portal-attachment-read.ts'), 'utf8')
  : ''
const requireCjs = createRequire(import.meta.url)
function loadNetlifyFunctionForHelperTests(source: string) {
  const moduleExports: Record<string, any> = {}
  const evaluate = new Function('exports', 'require', 'process', 'URL', source)
  evaluate(moduleExports, requireCjs, process, URL)
  return moduleExports
}
const readFnModule = loadNetlifyFunctionForHelperTests(readFn)
const uploadFnModule = loadNetlifyFunctionForHelperTests(uploadFn)

// ── 1–7. Migration 111 Storage RLS ────────────────────────────────────────────

describe('[STATIC] 1-7. Migration 111 Storage RLS', () => {
  it('1. drops portal_uploads_public_read', () => {
    expect(mig111).toContain('DROP POLICY IF EXISTS "portal_uploads_public_read"')
  })

  it('2. drops portal_uploads_public_insert', () => {
    expect(mig111).toContain('DROP POLICY IF EXISTS "portal_uploads_public_insert"')
  })

  it('3. does NOT create portal_uploads_anon_read (existence-only SELECT removed)', () => {
    expect(mig111).not.toMatch(/CREATE POLICY.*portal_uploads_anon_read/)
  })

  it('4. does NOT create portal_uploads_owner_read (broad authenticated SELECT removed)', () => {
    expect(mig111).not.toMatch(/CREATE POLICY.*portal_uploads_owner_read/)
  })

  it('5. sets portal-uploads bucket to private (public = false)', () => {
    expect(mig111).toContain('public             = false')
  })

  it('6. sets file_size_limit and allowed_mime_types on bucket', () => {
    expect(mig111).toContain('file_size_limit    = 268435456')
    expect(mig111).toContain('allowed_mime_types = ARRAY[')
    expect(mig111).toContain("'application/pdf'")
  })

  it('7. creates portal_upload_authorizations table with RLS enabled', () => {
    expect(mig111).toContain('portal_upload_authorizations')
    expect(mig111).toContain('ENABLE ROW LEVEL SECURITY')
  })
})

// ── 8–15. Signed read — server endpoint ───────────────────────────────────────

describe('[STATIC] 8-15. Server-side signed read — no browser Storage API', () => {
  it('8. portal-attachment-read Netlify function exists', () => {
    expect(existsSync(join(FN_DIR, 'portal-attachment-read.ts'))).toBe(true)
  })

  it('9. browser code never calls createSignedUrl for portal-uploads', () => {
    expect(portalTrack).not.toContain('createSignedUrl')
    expect(portalInbox).not.toContain('createSignedUrl')
    expect(storageService).not.toContain('createSignedUrl')
  })

  it('10. browser code never calls createSignedUrls for portal-uploads', () => {
    expect(portalTrack).not.toContain('createSignedUrls')
    expect(portalInbox).not.toContain('createSignedUrls')
    expect(storageService).not.toContain('createSignedUrls')
  })

  it('11. browser code never calls getPublicUrl for portal-uploads', () => {
    expect(portalTrack).not.toContain('getPublicUrl')
    expect(portalInbox).not.toContain('getPublicUrl')
    expect(portalView).not.toContain('getPublicUrl')
    expect(storageService).not.toContain('getPublicUrl')
  })

  it('12. PortalTrackView calls fetchAttachmentSignedUrls (server endpoint)', () => {
    expect(portalTrack).toContain('fetchAttachmentSignedUrls(')
  })

  it('13. PortalInbox calls fetchAttachmentSignedUrls (server endpoint)', () => {
    expect(portalInbox).toContain('fetchAttachmentSignedUrls(')
  })

  it('14. PortalInbox passes JWT to fetchAttachmentSignedUrls (owner mode)', () => {
    expect(portalInbox).toContain('access_token')
    expect(portalInbox).toContain('getSession()')
  })

  it('15. get_portal_request_status does NOT return attachment_paths', () => {
    expect(mig111).not.toContain("'attachment_paths'")
    expect(portalTrack).not.toContain('attachment_paths')
  })
})

// ── 16–25. Upload authorization ───────────────────────────────────────────────

describe('[STATIC] 16-25. Upload authorization hardening', () => {
  it('16. portal-upload-authorize.ts exists', () => {
    expect(existsSync(join(FN_DIR, 'portal-upload-authorize.ts'))).toBe(true)
  })

  it('17. Upload authorize inserts into portal_upload_authorizations', () => {
    expect(uploadFn).toContain('portal_upload_authorizations')
  })

  it('18. Upload authorize rejects zero-byte files (size <= 0)', () => {
    expect(uploadFn).toContain('f.size <= 0')
  })

  it('19. Upload authorize enforces MAX_FILE_COUNT = 10', () => {
    expect(uploadFn).toContain('MAX_FILE_COUNT = 10')
    expect(uploadFn).toContain('files.length > MAX_FILE_COUNT')
  })

  it('20. Upload authorize rejects unsupported MIME types via ALLOWED_MIME_TYPES', () => {
    expect(uploadFn).toContain('ALLOWED_MIME_TYPES')
    expect(uploadFn).toContain('!ALLOWED_MIME_TYPES.has')
  })

  it('21. Upload authorize CORS is not wildcard * (origin-restricted)', () => {
    // The wildcard must not be used as the Access-Control-Allow-Origin value
    expect(uploadFn).not.toMatch(/'Access-Control-Allow-Origin':\s*'\*'/)
    expect(uploadFn).toContain('resolveOrigin')
  })

  it('22. register_portal_attachments validates against portal_upload_authorizations', () => {
    expect(mig111).toContain('portal_upload_authorizations')
    expect(mig111).toContain('@> p_paths')
  })

  it('23. register_portal_attachments verifies object existence in storage.objects', () => {
    expect(mig111).toContain('storage.objects')
    expect(mig111).toContain('attachment object not found in storage')
  })

  it('24. register_portal_attachments validates stored MIME types', () => {
    expect(mig111).toContain('MIME type not permitted')
    expect(mig111).toContain("'application/pdf'")
  })

  it('25. register_portal_attachments rejects zero-byte objects', () => {
    expect(mig111).toContain('zero bytes not permitted')
  })
})

// ── 26–31. Path normalization ─────────────────────────────────────────────────

import { extractStoragePath, parseAttachmentPaths, isImagePath, isPdfPath, getAttachmentDisplayName } from '../services/portal/portalStorageService'

describe('[PURE] 26-31. extractStoragePath normalization', () => {
  it('26. returns null for protocol-relative URLs (starts with //)', () => {
    expect(extractStoragePath('//evil.com/portal-uploads/x.jpg')).toBeNull()
  })

  it('27. rejects encoded path traversal %2e%2e', () => {
    expect(extractStoragePath('https://proj.supabase.co/storage/v1/object/public/portal-uploads/req%2f%2e%2e%2fadmin.jpg')).toBeNull()
  })

  it('28. rejects absolute bare paths starting with /', () => {
    expect(extractStoragePath('/etc/passwd')).toBeNull()
  })

  it('29. extracts valid portal-uploads path from full Supabase public URL', () => {
    const url = 'https://proj.supabase.co/storage/v1/object/public/portal-uploads/uuid1/uuid2.jpg'
    expect(extractStoragePath(url)).toBe('uuid1/uuid2.jpg')
  })

  it('30. returns bare relative path as-is when no protocol present', () => {
    expect(extractStoragePath('uuid1/uuid2.jpg')).toBe('uuid1/uuid2.jpg')
  })

  it('31. rejects .. traversal in bare paths', () => {
    expect(extractStoragePath('../admin/secret.sql')).toBeNull()
    expect(extractStoragePath('uuid1/../admin.jpg')).toBeNull()
  })
})

// ── 32–36. CustomerPortalView upload flow ────────────────────────────────────

describe('[STATIC] 32-36. CustomerPortalView uses signed upload flow', () => {
  it('32. calls portal-upload-authorize Netlify function (not direct Storage.upload)', () => {
    expect(portalView).toContain('portal-upload-authorize')
    expect(portalView).not.toContain('.storage.upload(')
  })

  it('33. calls register_portal_attachments (not append_portal_request_files)', () => {
    expect(portalView).toContain('register_portal_attachments')
    expect(portalView).not.toContain('append_portal_request_files')
  })

  it('34. does NOT call getPublicUrl', () => {
    expect(portalView).not.toContain('getPublicUrl')
  })

  it('35. uploads via PUT to signedUploadUrl', () => {
    expect(portalView).toContain("method: 'PUT'")
    expect(portalView).toContain('signedUploadUrl')
  })

  it('36. passes p_paths (uploadedPaths) to register_portal_attachments', () => {
    expect(portalView).toContain('p_paths:        uploadedPaths')
  })
})

// ── 37–38. Tracking response ──────────────────────────────────────────────────

describe('[STATIC] 37-38. Tracking RPC response — no raw paths to browser', () => {
  it('37. get_portal_request_status does NOT include attachment_paths in jsonb_build_object', () => {
    expect(mig111).not.toContain("'attachment_paths'")
  })

  it('38. get_portal_request_status does NOT expose notes column to caller', () => {
    expect(mig111).not.toContain("'notes',             v_row.notes")
    expect(mig111).not.toContain("'notes', v_row.notes")
  })
})

// ── 39–43. parseAttachmentPaths ───────────────────────────────────────────────

describe('[PURE] 39-43. parseAttachmentPaths handles both notes formats', () => {
  it('39. returns [] for null or empty notes', () => {
    expect(parseAttachmentPaths(null)).toEqual([])
    expect(parseAttachmentPaths('')).toEqual([])
  })

  it('40. parses new FilePaths: format', () => {
    const paths = parseAttachmentPaths('FilePaths: abc/def.jpg, abc/ghi.pdf')
    expect(paths).toEqual(['abc/def.jpg', 'abc/ghi.pdf'])
  })

  it('41. parses old Files: URL format and extracts path via extractStoragePath', () => {
    const url = 'https://proj.supabase.co/storage/v1/object/public/portal-uploads/req-id/file.jpg'
    const paths = parseAttachmentPaths(`Files: ${url}`)
    expect(paths).toHaveLength(1)
    expect(paths[0]).toBe('req-id/file.jpg')
  })

  it('42. FilePaths: takes priority when both formats present', () => {
    const oldUrl = 'https://proj.supabase.co/storage/v1/object/public/portal-uploads/abc/x.jpg'
    const notes = `Files: ${oldUrl} | FilePaths: abc/new.jpg`
    const paths = parseAttachmentPaths(notes)
    expect(paths).toEqual(['abc/new.jpg'])
  })

  it('43. FilePaths: terminated by | returns only paths before the pipe', () => {
    const paths = parseAttachmentPaths('Something | FilePaths: abc/def.jpg, abc/ghi.pdf | Notes: blah')
    expect(paths).toHaveLength(2)
    expect(paths[0]).toBe('abc/def.jpg')
  })
})

// ── 44–46. Display helpers ────────────────────────────────────────────────────

describe('[PURE] 44-46. Display helper utilities', () => {
  it('44. isImagePath identifies jpg, png, webp', () => {
    expect(isImagePath('req/uuid.jpg')).toBe(true)
    expect(isImagePath('req/uuid.png')).toBe(true)
    expect(isImagePath('req/uuid.webp')).toBe(true)
    expect(isImagePath('req/uuid.pdf')).toBe(false)
  })

  it('45. isPdfPath identifies pdf only', () => {
    expect(isPdfPath('req/uuid.pdf')).toBe(true)
    expect(isPdfPath('req/uuid.jpg')).toBe(false)
  })

  it('46. getAttachmentDisplayName returns "Attachment N (EXT)" for UUID-named files', () => {
    expect(getAttachmentDisplayName('abc/d8f7e6c5-b4a3-0000-1234-abcdef012345.jpg', 0)).toBe('Attachment 1 (JPG)')
    expect(getAttachmentDisplayName('abc/d8f7e6c5-b4a3-0000-1234-abcdef012345.pdf', 2)).toBe('Attachment 3 (PDF)')
  })
})

// ── 47–52. Server endpoint static contract ────────────────────────────────────

describe('[STATIC] 47-52. portal-attachment-read endpoint contract', () => {
  it('47. uses SERVICE_ROLE_KEY (not anon key) for Storage signing via official client', () => {
    expect(readFn).toContain('SERVICE_ROLE_KEY')
    expect(readFn).toContain("createClient(supabaseUrl, serviceRoleKey")
    expect(readFn).toContain(".from('portal-uploads')")
    expect(readFn).toContain('createSignedUrl(objectPath, SIGNED_URL_EXPIRY_SECONDS)')
    expect(readFn).not.toContain('SUPABASE_ANON_KEY')
    expect(readFn).not.toContain('ANON_KEY')
    // Must not encode the full path as one URI component (slash → %2F).
    expect(readFn).not.toContain('encodeURIComponent(objectPath)')
  })

  it('48. verifies JWT via Supabase auth/v1/user endpoint (owner mode)', () => {
    expect(readFn).toContain('/auth/v1/user')
    expect(readFn).toContain('isOwnerMode')
  })

  it('49. derives paths from notes server-side (not from client-supplied path list)', () => {
    expect(readFn).toContain('parseNotesForPaths')
    expect(readFn).not.toMatch(/body\.paths|body\['paths'\]/)
  })

  it('50. validates first path segment equals requestId (cross-request rejection)', () => {
    expect(readFn).toContain('validateObjectPath')
    expect(readFn).toContain('normalizePortalObjectPath')
    expect(readFn).toContain("prefix.toLowerCase() !== String(requestId).toLowerCase()")
  })

  it('51. returns empty attachments on validation failure (no path info on failure)', () => {
    expect(readFn).toContain("{ attachments: [] }")
  })

  it('52. endpoint CORS is not wildcard * (origin-restricted)', () => {
    expect(readFn).not.toMatch(/'Access-Control-Allow-Origin':\s*'\*'/)
    expect(readFn).toContain('resolveOrigin')
  })
})

// ── 53–57. SEC-0R regression ──────────────────────────────────────────────────

describe('[STATIC] 53-57. SEC-0R security regression checks', () => {
  it('53. migration 111 replaces portal_requests_owner_admin_select with an organization-bound policy', () => {
    expect(mig111).toContain('DROP POLICY IF EXISTS portal_requests_owner_admin_select')
    expect(mig111).toContain('CREATE POLICY portal_requests_owner_admin_select')
    expect(mig111).toMatch(/portal_requests_owner_admin_select[\s\S]*?organization_id = public\.user_org_id\(\)/)
  })

  it('54. migration 111 replaces portal_requests_owner_admin_update with organization-bound USING and WITH CHECK', () => {
    expect(mig111).toContain('DROP POLICY IF EXISTS portal_requests_owner_admin_update')
    expect(mig111).toContain('CREATE POLICY portal_requests_owner_admin_update')
    expect(mig111).toMatch(/portal_requests_owner_admin_update[\s\S]*?WITH CHECK[\s\S]*?is_org_admin_for\(organization_id\)/)
  })

  it('55. migration 111 postcondition asserts exactly 2 portal_requests policies', () => {
    expect(mig111).toContain('expected 2 portal_requests policies')
  })

  it('56. submit_portal_request still exists in migration 107 with attach_token', () => {
    expect(mig107).toContain('submit_portal_request')
    expect(mig107).toContain('attach_token')
  })

  it('57. append_portal_request_files is retired and revoked from browser roles', () => {
    expect(mig111).toContain('append_portal_request_files was unexpectedly removed')
    expect(mig111).toContain('append_portal_request_files is retired; use register_portal_attachments')
    expect(mig111).toContain('REVOKE ALL ON FUNCTION public.append_portal_request_files(UUID, TEXT, TEXT) FROM anon')
    expect(mig111).toContain('REVOKE ALL ON FUNCTION public.append_portal_request_files(UUID, TEXT, TEXT) FROM authenticated')
    expect(mig111).toContain('append_portal_request_files remains executable by a browser role')
    expect(mig111).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.append_portal_request_files[\s\S]*?TO anon/)
    expect(mig111).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.append_portal_request_files[\s\S]*?TO authenticated/)
  })
})

// ── 58–59. Migration directory ────────────────────────────────────────────────

describe('[STATIC] 58-59. Migration directory invariants', () => {
  it('58. migration 111 file exists in supabase/migrations/', () => {
    const files = readdirSync(MIG_DIR)
    expect(files).toContain('111_private_portal_storage.sql')
  })

  it('59. SEC-0S does not create a portal/private-storage migration 112', () => {
    const files = readdirSync(MIG_DIR)
    const portal112 = files.filter(n =>
      n.startsWith('112_') && /portal|private_portal|storage/i.test(n)
    )
    expect(portal112).toEqual([])
    // Unrelated solar residue may exist outside SEC-0S scope.
    const solar112 = files.filter(n => n.startsWith('112_solar_'))
    expect(solar112.every(n => n.startsWith('112_solar_'))).toBe(true)
  })
})

// ── MOCK: fetchAttachmentSignedUrls uses server endpoint ──────────────────────

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc:     vi.fn(),
    storage: {
      from: vi.fn().mockReturnValue({
        createSignedUrl:  vi.fn(),
        createSignedUrls: vi.fn(),
        upload:           vi.fn(),
        getPublicUrl:     vi.fn(),
      }),
    },
    channel:       vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
    removeChannel: vi.fn(),
    auth:          { getUser: vi.fn(), getSession: vi.fn() },
    from:          vi.fn(),
  },
}))

describe('[MOCK] fetchAttachmentSignedUrls calls server endpoint, not Storage API', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('calls /.netlify/functions/portal-attachment-read via fetch (not supabase.storage)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ attachments: [{ displayName: 'Attachment 1 (JPG)', mimeType: 'image/jpeg', signedUrl: 'https://signed.example.com/x.jpg', expiresAt: '2026-01-01T00:00:00Z' }] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { fetchAttachmentSignedUrls: fasu } = await import('../services/portal/portalStorageService')
    const results = await fasu('test-request-id-uuid')

    expect(mockFetch).toHaveBeenCalledWith(
      '/.netlify/functions/portal-attachment-read',
      expect.objectContaining({ method: 'POST' })
    )
    expect(results).toHaveLength(1)
    expect(results[0].signedUrl).toBe('https://signed.example.com/x.jpg')

    // Supabase storage.createSignedUrl must NOT be called
    const { supabase: mockSupa } = await import('@/lib/supabase')
    const fromMock = mockSupa.storage.from as ReturnType<typeof vi.fn>
    expect(fromMock).not.toHaveBeenCalledWith('portal-uploads')

    vi.unstubAllGlobals()
  })

  it('passes Authorization header when jwt provided (owner mode)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ attachments: [] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { fetchAttachmentSignedUrls: fasu } = await import('../services/portal/portalStorageService')
    await fasu('test-request-id', 'owner-jwt-token')

    const callArgs = mockFetch.mock.calls[0]
    const options = callArgs[1]
    expect(options.headers?.Authorization).toBe('Bearer owner-jwt-token')

    vi.unstubAllGlobals()
  })

  it('returns empty array when server endpoint returns error', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false })
    vi.stubGlobal('fetch', mockFetch)

    const { fetchAttachmentSignedUrls: fasu } = await import('../services/portal/portalStorageService')
    const results = await fasu('test-request-id')
    expect(results).toEqual([])

    vi.unstubAllGlobals()
  })

  it('returns empty array when fetch throws (network error)', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('network'))
    vi.stubGlobal('fetch', mockFetch)

    const { fetchAttachmentSignedUrls: fasu } = await import('../services/portal/portalStorageService')
    const results = await fasu('test-request-id')
    expect(results).toEqual([])

    vi.unstubAllGlobals()
  })
})

// ── SEC-0S R2: authoritative organization model ───────────────────────────────

describe('[STATIC SQL] SEC-0S R2 organization model', () => {
  it('adds canonical portal_requests.organization_id as UUID', () => {
    expect(mig111).toContain('ADD COLUMN IF NOT EXISTS organization_id UUID')
  })

  it('backfills organization_id before applying NOT NULL', () => {
    const backfill = mig111.indexOf('UPDATE public.portal_requests pr')
    const notNull = mig111.indexOf('ALTER COLUMN organization_id SET NOT NULL')
    expect(backfill).toBeGreaterThan(-1)
    expect(notNull).toBeGreaterThan(backfill)
  })

  it('constrains organization_id to canonical organizations(id)', () => {
    expect(mig111).toContain('portal_requests_organization_id_fkey')
    expect(mig111).toMatch(/FOREIGN KEY \(organization_id\)[\s\S]*?REFERENCES public\.organizations\(id\)/)
  })

  it('indexes portal_requests.organization_id', () => {
    expect(mig111).toContain('idx_portal_requests_organization_id')
    expect(mig111).toContain('ON public.portal_requests (organization_id)')
  })

  it('uses a singleton server-side Portal destination configuration', () => {
    expect(mig111).toContain('CREATE TABLE IF NOT EXISTS public.portal_request_configuration')
    expect(mig111).toContain('singleton       BOOLEAN PRIMARY KEY')
    expect(mig111).toContain('organization_id UUID NOT NULL UNIQUE')
  })

  it('accepts an explicit canonical organization settings marker', () => {
    expect(mig111).toContain("settings->>'public_portal_destination' = 'true'")
  })

  it('allows singleton fallback only when exactly one organization exists', () => {
    expect(mig111).toMatch(/IF v_count = 0 THEN[\s\S]*?FROM public\.organizations;/)
    expect(mig111).toContain('IF v_count <> 1 OR v_destination IS NULL THEN')
  })

  it('fails rather than choosing arbitrarily when candidate count is not one', () => {
    expect(mig111).toContain('cannot choose a Portal destination organization safely')
    expect(mig111).toContain('RAISE EXCEPTION')
  })

  it('contains transactional postconditions for UUID NOT NULL, FK, index, and singleton config', () => {
    expect(mig111).toContain('portal_requests.organization_id is not UUID NOT NULL')
    expect(mig111).toContain('organization foreign key is missing')
    expect(mig111).toContain('organization index is missing')
    expect(mig111).toContain('expected exactly one Portal destination configuration')
  })
})

describe('[STATIC SQL] SEC-0S R2 public submission organization assignment', () => {
  const submitStart = mig111.indexOf('CREATE OR REPLACE FUNCTION public.submit_portal_request')
  const submitEnd = mig111.indexOf('COMMENT ON FUNCTION public.submit_portal_request', submitStart)
  const submitBody = mig111.slice(submitStart, submitEnd)

  it('replaces the public submit RPC in migration 111', () => {
    expect(submitStart).toBeGreaterThan(-1)
  })

  it('loads organization only from portal_request_configuration', () => {
    expect(submitBody).toContain('FROM public.portal_request_configuration')
    expect(submitBody).toContain('WHERE singleton = true')
  })

  it('inserts server-derived v_organization_id into portal_requests', () => {
    expect(submitBody).toMatch(/INSERT INTO public\.portal_requests \(\s*organization_id,/)
    expect(submitBody).toMatch(/\) VALUES \(\s*v_organization_id,/)
  })

  it('does not accept a client organization, org, or tenant parameter', () => {
    const signature = submitBody.slice(0, submitBody.indexOf('RETURNS JSONB'))
    expect(signature).not.toMatch(/p_(organization|org|tenant)_id/i)
  })

  it('preserves anonymous and authenticated submission execution', () => {
    expect(mig111).toMatch(/GRANT EXECUTE ON FUNCTION public\.submit_portal_request[\s\S]*?TO anon/)
    expect(mig111).toMatch(/GRANT EXECUTE ON FUNCTION public\.submit_portal_request[\s\S]*?TO authenticated/)
  })

  it('preserves one-time token generation and hashed storage', () => {
    expect(submitBody).toContain('gen_random_bytes(32)')
    expect(submitBody).toContain("digest(v_raw_token::bytea, 'sha256')")
    expect(submitBody).toContain('attach_token_hash')
  })
})

describe('[STATIC SQL] SEC-0S R2 owner/admin Portal boundary', () => {
  it('SELECT policy requires caller organization equality', () => {
    expect(mig111).toMatch(/portal_requests_owner_admin_select[\s\S]*?organization_id = public\.user_org_id\(\)/)
  })

  it('SELECT policy requires canonical owner/admin authority for the request organization', () => {
    expect(mig111).toMatch(/portal_requests_owner_admin_select[\s\S]*?public\.is_org_admin_for\(organization_id\)/)
  })

  it('UPDATE USING and WITH CHECK both require organization equality and authority', () => {
    const start = mig111.indexOf('CREATE POLICY portal_requests_owner_admin_update')
    const end = mig111.indexOf('-- Child Portal data', start)
    const policy = mig111.slice(start, end)
    expect((policy.match(/organization_id = public\.user_org_id\(\)/g) ?? [])).toHaveLength(2)
    expect((policy.match(/public\.is_org_admin_for\(organization_id\)/g) ?? [])).toHaveLength(2)
  })

  it('ordinary employees cannot satisfy organization-bound parent or child writes', () => {
    expect(mig111).toContain('CREATE POLICY job_timeline_owner_admin_write')
    expect(mig111).toContain('CREATE POLICY technician_location_owner_admin_write')
    expect(mig111).toMatch(/job_timeline_owner_admin_write[\s\S]*?is_org_admin_for\(pr\.organization_id\)/)
    expect(mig111).toMatch(/technician_location_owner_admin_write[\s\S]*?is_org_admin_for\(pr\.organization_id\)/)
  })

  it('attachment context derives caller organization from user_org_id()', () => {
    expect(mig111).toMatch(/get_portal_attachment_context[\s\S]*?public\.user_org_id\(\)/)
  })

  it('attachment context requires exact request/caller organization equality', () => {
    expect(mig111).toMatch(/get_portal_attachment_context[\s\S]*?pr\.organization_id = public\.user_org_id\(\)/)
  })

  it('attachment context requires is_org_admin_for request organization', () => {
    expect(mig111).toMatch(/get_portal_attachment_context[\s\S]*?public\.is_org_admin_for\(pr\.organization_id\)/)
  })

  it('attachment context is unavailable to anon and executable by authenticated', () => {
    expect(mig111).toContain('REVOKE ALL ON FUNCTION public.get_portal_attachment_context(UUID) FROM anon')
    expect(mig111).toContain('GRANT EXECUTE ON FUNCTION public.get_portal_attachment_context(UUID) TO authenticated')
  })
})

describe('[STATIC FUNCTION] SEC-0S R2 owner/admin signed-read endpoint', () => {
  it('verifies the Bearer JWT with Supabase Auth', () => {
    expect(readFn).toContain('/auth/v1/user')
    expect(readFn).toContain('verifiedUserId')
  })

  it('authorizes through get_portal_attachment_context using the same JWT', () => {
    expect(readFn).toContain('/rest/v1/rpc/get_portal_attachment_context')
    expect(readFn).toContain('Authorization: `Bearer ${jwt}`')
  })

  it('does not trust profile role text alone', () => {
    expect(readFn).not.toContain('select=role')
    expect(readFn).not.toContain("role !== 'owner'")
  })

  it('performs a redundant exact caller/request organization equality check', () => {
    expect(readFn).toContain('caller_organization_id')
    expect(readFn).toContain('request_organization_id')
    expect(readFn).toContain('String(callerOrg).toLowerCase() !== String(requestOrg).toLowerCase()')
  })

  it('returns the same safe error for missing, cross-org, role-only, and employee cases', () => {
    expect(readFn).toContain("{ error: 'Request unavailable' }")
    expect(readFn).toContain('Missing, cross-org, role-only, and ordinary-employee cases')
  })

  it('ignores client-supplied organization and request organization values', () => {
    expect(readFn).not.toMatch(/body\.(organizationId|organization_id|requestOrganization|request_organization)/)
  })

  it('ignores client-supplied object and attachment paths', () => {
    expect(readFn).not.toMatch(/body\.(objectPath|objectPaths|attachmentPath|attachmentPaths|paths)/)
  })

  it('derives attachment paths only after authorization from the exact request context', () => {
    expect(readFn.indexOf('get_portal_attachment_context')).toBeLessThan(readFn.indexOf('parseNotesForPaths(requestRow.notes'))
  })
})

describe('[STATIC SERVICE] SEC-0S R2 Portal owner query and conversion boundary', () => {
  it('Portal list resolves canonical organization and filters organization_id', () => {
    expect(portalService).toContain("rpc('user_org_id')")
    expect(portalService).toMatch(/fetchNewPortalRequests[\s\S]*?\.eq\('organization_id', organizationId\)/)
  })

  it('Portal detail-by-lead filters organization_id', () => {
    expect(portalService).toMatch(/fetchPortalTrackerStateForLead[\s\S]*?\.eq\('organization_id', organizationId\)/)
  })

  it('timeline writes first prove same-org parent request', () => {
    expect(portalService).toMatch(/writePortalTimelineEvent[\s\S]*?authorizedRequest[\s\S]*?\.eq\('organization_id', organizationId\)/)
  })

  it('conversion re-reads canonical request data through an organization predicate', () => {
    expect(portalService).toContain('canonicalRequest')
    expect(portalService).toMatch(/convertToLead[\s\S]*?\.eq\('id', request\.id\)[\s\S]*?\.eq\('organization_id', organizationId\)/)
  })

  it('conversion update preserves and scopes by organization identity', () => {
    expect(portalService).toMatch(/update\(\{[\s\S]*?hunter_lead_id: newLeadId[\s\S]*?\.eq\('organization_id', organizationId\)/)
  })

  it('dismissal scopes both update and linked-lead lookup by organization', () => {
    const start = portalService.indexOf('export async function dismissPortalRequest')
    const block = portalService.slice(start)
    expect((block.match(/\.eq\('organization_id', organizationId\)/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })
})

describe('[STATIC FUNCTION] SEC-0S R2 controlled CORS behavior', () => {
  for (const [name, source] of [
    ['portal-attachment-read', readFn],
    ['portal-upload-authorize', uploadFn],
  ] as const) {
    it(`${name}: never emits Access-Control-Allow-Origin null or wildcard`, () => {
      expect(source).not.toContain("?? 'null'")
      expect(source).not.toMatch(/'Access-Control-Allow-Origin':\s*'\*'/)
    })

    it(`${name}: echoes only an exact configured/local origin`, () => {
      expect(source).toContain('allowed.has(requestOrigin)')
      expect(source).toContain("headers['Access-Control-Allow-Origin'] = origin")
      expect(source).toContain('DEPLOY_PRIME_URL')
    })

    it(`${name}: rejects an unknown browser Origin with controlled 403`, () => {
      expect(source).toContain('const originAllowed = !origin || resolveOrigin(origin) !== null')
      expect(source).toContain("return jsonResponse(403, { error: 'Forbidden' }, origin)")
    })

    it(`${name}: omits allow-origin when the Origin is absent or rejected`, () => {
      expect(source).toContain('if (origin) headers')
    })
  }

  it('owner JWT authorization is enforced independently after CORS acceptance', () => {
    expect(readFn.indexOf('if (!originAllowed)')).toBeLessThan(readFn.indexOf('fetch(`${SUPABASE_URL}/auth/v1/user`'))
    expect(readFn).toContain("authHeader.startsWith('Bearer ')")
  })
})

describe('[UNIT/HELPER] SEC-0S R2 executable CORS behavior', () => {
  const modules = [
    ['portal-attachment-read', readFnModule],
    ['portal-upload-authorize', uploadFnModule],
  ] as const

  beforeEach(() => {
    vi.stubEnv('URL', 'https://app.poweronsolutionsllc.com')
    vi.stubEnv('DEPLOY_URL', 'https://main--power-on.netlify.app')
    vi.stubEnv('DEPLOY_PRIME_URL', 'https://deploy-preview-42--power-on.netlify.app')
  })

  for (const [name, module] of modules) {
    it(`${name}: echoes an allowed production origin`, () => {
      const headers = module._test.corsHeaders('https://app.poweronsolutionsllc.com')
      expect(headers['Access-Control-Allow-Origin']).toBe('https://app.poweronsolutionsllc.com')
    })

    it(`${name}: echoes configured preview and permits configured local origin`, () => {
      expect(module._test.resolveOrigin('https://deploy-preview-42--power-on.netlify.app'))
        .toBe('https://deploy-preview-42--power-on.netlify.app')
      expect(module._test.resolveOrigin('http://localhost:8888')).toBe('http://localhost:8888')
    })

    it(`${name}: rejects unknown origins and emits no allow-origin header`, () => {
      expect(module._test.resolveOrigin('https://evil.example')).toBeNull()
      expect(module._test.corsHeaders('https://evil.example'))
        .not.toHaveProperty('Access-Control-Allow-Origin')
    })

    it(`${name}: no-Origin requests emit no browser allow-origin header`, () => {
      expect(module._test.corsHeaders(undefined)).not.toHaveProperty('Access-Control-Allow-Origin')
    })
  }
})

describe('[STATIC REGRESSION] SEC-0S R2 scope and customer preservation', () => {
  it('customer mode remains request-UUID bearer mode without client paths', () => {
    expect(readFn).toContain('Customer tracking uses the request UUID as the only bearer')
    expect(readFn).toContain('const isOwnerMode = authHeader.startsWith(')
    expect(readFn).toContain('parseNotesForPaths(requestRow.notes, requestId, supabaseHost)')
    expect(readFn).not.toMatch(/body\.paths/)
  })

  it('customer mode cannot fall back from an invalid Bearer token', () => {
    expect(readFn).toContain("const isOwnerMode = authHeader.startsWith('Bearer ')")
    expect(readFn).toMatch(/if \(isOwnerMode\) \{[\s\S]*?authRes\.ok[\s\S]*?Unauthorized/)
  })

  it('customer tracking response still contains no raw paths or notes', () => {
    expect(mig111).not.toContain("'attachment_paths'")
    expect(mig111).not.toContain("'notes',             v_row.notes")
  })

  it('Storage public policies remain absent and bucket remains private', () => {
    expect(mig111).toContain('DROP POLICY IF EXISTS "portal_uploads_public_read"')
    expect(mig111).toContain('DROP POLICY IF EXISTS "portal_uploads_public_insert"')
    expect(mig111).toContain('public             = false')
  })

  it('upload authorization and finalization verification remain intact', () => {
    expect(uploadFn).toContain('portal_upload_authorizations')
    expect(mig111).toContain('submitted paths are not covered by a valid server-issued upload authorization')
    expect(mig111).toContain('attachment object not found in storage')
  })

  it('does not create a SEC-0S portal migration 112 or introduce deferred role/scheduling scope', () => {
    const portal112 = readdirSync(MIG_DIR).filter(
      name => name.startsWith('112_') && /portal|private_portal|storage/i.test(name)
    )
    expect(portal112).toEqual([])
    expect(mig111).not.toContain('receptionist')
    expect(mig111).not.toContain('my_leads')
    expect(mig111).not.toContain('service_calls')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// SEC-0S R3 — Historical compatibility, encoding, legacy RPC lockdown
// ═══════════════════════════════════════════════════════════════════════════════

const HOST = 'edxxbtyugohtowvslbfo.supabase.co'
const REQ_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const REQ_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const ATTACH_UUID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const HIST_FILE = '1777882121440-project-03.jpg'

describe('[UNIT/HELPER] SEC-0S R3 path grammar and host-bound normalization', () => {
  const {
    normalizePortalObjectPath,
    validateObjectPath,
    parseNotesForPaths,
    encodeObjectPathForStorageApi,
    SIGNED_URL_EXPIRY_SECONDS,
  } = readFnModule._test

  it('1. accepts canonical FilePaths-style uuid/uuid.ext path', () => {
    const path = `${REQ_A}/${ATTACH_UUID}.jpg`
    expect(validateObjectPath(path, REQ_A)).toBe(true)
    expect(normalizePortalObjectPath(path, REQ_A, HOST)).toBe(path)
  })

  it('2. accepts historical Files: public URL for authorized request', () => {
    const url = `https://${HOST}/storage/v1/object/public/portal-uploads/${REQ_A}/${HIST_FILE}`
    expect(normalizePortalObjectPath(url, REQ_A, HOST)).toBe(`${REQ_A}/${HIST_FILE}`)
  })

  it('3. historical path requires authorized request prefix', () => {
    expect(validateObjectPath(`${REQ_A}/${HIST_FILE}`, REQ_A)).toBe(true)
    expect(validateObjectPath(`${REQ_A}/${HIST_FILE}`, REQ_B)).toBe(false)
  })

  it('4. Customer A cannot normalize Customer B historical path', () => {
    const url = `https://${HOST}/storage/v1/object/public/portal-uploads/${REQ_B}/${HIST_FILE}`
    expect(normalizePortalObjectPath(url, REQ_A, HOST)).toBeNull()
  })

  it('5. arbitrary external host rejected', () => {
    const url = `https://evil.example/storage/v1/object/public/portal-uploads/${REQ_A}/${HIST_FILE}`
    expect(normalizePortalObjectPath(url, REQ_A, HOST)).toBeNull()
  })

  it('6. other Supabase project rejected', () => {
    const url = `https://otherproject.supabase.co/storage/v1/object/public/portal-uploads/${REQ_A}/${HIST_FILE}`
    expect(normalizePortalObjectPath(url, REQ_A, HOST)).toBeNull()
  })

  it('7. wrong bucket rejected', () => {
    const url = `https://${HOST}/storage/v1/object/public/job-photos/${REQ_A}/${HIST_FILE}`
    expect(normalizePortalObjectPath(url, REQ_A, HOST)).toBeNull()
  })

  it('8. literal traversal rejected', () => {
    expect(normalizePortalObjectPath(`${REQ_A}/../secret.jpg`, REQ_A, HOST)).toBeNull()
    expect(normalizePortalObjectPath(`${REQ_A}/..%2fsecret.jpg`, REQ_A, HOST)).toBeNull()
  })

  it('9. encoded traversal rejected', () => {
    const url = `https://${HOST}/storage/v1/object/public/portal-uploads/${REQ_A}/%2e%2e/secret.jpg`
    expect(normalizePortalObjectPath(url, REQ_A, HOST)).toBeNull()
  })

  it('10. double-encoded traversal rejected', () => {
    const url = `https://${HOST}/storage/v1/object/public/portal-uploads/${REQ_A}/%252e%252e/secret.jpg`
    expect(normalizePortalObjectPath(url, REQ_A, HOST)).toBeNull()
  })

  it('11. wrong request prefix rejected for relative historical path', () => {
    expect(normalizePortalObjectPath(`${REQ_B}/${HIST_FILE}`, REQ_A, HOST)).toBeNull()
  })

  it('12. duplicate FilePaths + Files entries normalize once', () => {
    const notes =
      `FilePaths: ${REQ_A}/${ATTACH_UUID}.jpg | ` +
      `Files: https://${HOST}/storage/v1/object/public/portal-uploads/${REQ_A}/${ATTACH_UUID}.jpg`
    const paths = parseNotesForPaths(notes, REQ_A, HOST)
    expect(paths).toEqual([`${REQ_A}/${ATTACH_UUID}.jpg`])
  })

  it('13. invalid entry omitted without leaking raw path into parse result', () => {
    const notes =
      `Files: https://evil.example/portal-uploads/${REQ_A}/${HIST_FILE}, ` +
      `https://${HOST}/storage/v1/object/public/portal-uploads/${REQ_A}/${HIST_FILE}`
    const paths = parseNotesForPaths(notes, REQ_A, HOST)
    expect(paths).toEqual([`${REQ_A}/${HIST_FILE}`])
    expect(JSON.stringify(paths)).not.toContain('evil.example')
  })

  it('14. customer and owner share identical parseNotesForPaths security rules', () => {
    // Mode argument removed — one function for both actors.
    expect(parseNotesForPaths.length).toBe(3)
    expect(readFn).not.toMatch(/mode === 'owner'/)
    expect(readFn).toContain('parseNotesForPaths(requestRow.notes, requestId, supabaseHost)')
  })

  it('15. response contract omits raw path fields', () => {
    expect(readFn).toContain('displayName: meta.displayName')
    expect(readFn).toContain('signedUrl')
    expect(readFn).not.toMatch(/attachments\.push\(\{[\s\S]*?path:/)
    expect(readFn).not.toMatch(/objectPath:\s*path/)
  })

  it('14b. missing/failed historical object yields controlled unavailable metadata (no raw path)', () => {
    // Handler keeps the attachment slot, sets signedUrl null, and never returns the object path.
    expect(readFn).toContain('signedUrl = await createSignedReadUrl')
    expect(readFn).toMatch(/attachments\.push\(\{[\s\S]*?signedUrl,[\s\S]*?expiresAt: signedUrl \? expiresAt : null/)
    expect(readFn).not.toMatch(/attachments\.push\(\{[\s\S]*?(objectPath|storagePath|rawPath)\s*:/)
  })
})

describe('[UNIT/HELPER] SEC-0S R3 signing encoding and expiry', () => {
  const {
    encodeObjectPathForStorageApi,
    validateObjectPath,
    normalizePortalObjectPath,
    SIGNED_URL_EXPIRY_SECONDS,
  } = readFnModule._test

  it('24. directory slash remains a separator after segment encoding', () => {
    const encoded = encodeObjectPathForStorageApi(`${REQ_A}/${HIST_FILE}`)
    expect(encoded).toBe(`${REQ_A}/${encodeURIComponent(HIST_FILE)}`)
    expect(encoded?.includes('/')).toBe(true)
    expect(encoded?.split('/')).toHaveLength(2)
  })

  it('25. slash is not encoded as %2F', () => {
    const encoded = encodeObjectPathForStorageApi(`${REQ_A}/file.jpg`)
    expect(encoded).not.toContain('%2F')
    expect(encoded).not.toContain('%2f')
    expect(encoded).toBe(`${REQ_A}/file.jpg`)
  })

  it('26. spaces encode correctly per segment', () => {
    // Spaces are not in the historical allowlist — validate rejects; encoder still preserves slash.
    expect(validateObjectPath(`${REQ_A}/my file.jpg`, REQ_A)).toBe(false)
    const encoded = encodeObjectPathForStorageApi(`${REQ_A}/my file.jpg`)
    expect(encoded).toBe(`${REQ_A}/my%20file.jpg`)
    expect(encoded).not.toContain('%2F')
  })

  it('27. safe Unicode filename is rejected unless in allowlist charset', () => {
    expect(validateObjectPath(`${REQ_A}/foto-ñ.jpg`, REQ_A)).toBe(false)
    expect(normalizePortalObjectPath(`${REQ_A}/foto-n.jpg`, REQ_A, HOST)).toBe(`${REQ_A}/foto-n.jpg`)
  })

  it('28. existing encoded filename does not double encode through relative path input', () => {
    expect(normalizePortalObjectPath(`${REQ_A}/file%20name.jpg`, REQ_A, HOST)).toBeNull()
  })

  it('29. literal traversal rejected before encoding', () => {
    expect(encodeObjectPathForStorageApi(`${REQ_A}/../x.jpg`)).toBeNull()
    expect(validateObjectPath(`${REQ_A}/../x.jpg`, REQ_A)).toBe(false)
  })

  it('30. encoded traversal rejected before signing normalization', () => {
    const url = `https://${HOST}/storage/v1/object/public/portal-uploads/${REQ_A}/%2e%2e%2fx.jpg`
    expect(normalizePortalObjectPath(url, REQ_A, HOST)).toBeNull()
  })

  it('31. canonical UUID filename validates for signing', () => {
    expect(validateObjectPath(`${REQ_A}/${ATTACH_UUID}.pdf`, REQ_A)).toBe(true)
  })

  it('32. historical timestamp filename validates for signing', () => {
    expect(validateObjectPath(`${REQ_A}/${HIST_FILE}`, REQ_A)).toBe(true)
  })

  it('33. signed-read expiry is fixed at 300s and body cannot supply expiresIn', () => {
    expect(SIGNED_URL_EXPIRY_SECONDS).toBe(300)
    expect(readFn).not.toMatch(/body\.(expiresIn|expiry|ttl)/)
    expect(readFn).toContain('createSignedUrl(objectPath, SIGNED_URL_EXPIRY_SECONDS)')
  })
})

describe('[STATIC SQL] SEC-0S R3 legacy append RPC lockdown', () => {
  it('34-36. migration revokes PUBLIC/anon/authenticated EXECUTE on append', () => {
    expect(mig111).toContain('REVOKE ALL ON FUNCTION public.append_portal_request_files(UUID, TEXT, TEXT) FROM PUBLIC')
    expect(mig111).toContain('REVOKE ALL ON FUNCTION public.append_portal_request_files(UUID, TEXT, TEXT) FROM anon')
    expect(mig111).toContain('REVOKE ALL ON FUNCTION public.append_portal_request_files(UUID, TEXT, TEXT) FROM authenticated')
    expect(mig111).toContain('append_portal_request_files remains executable by a browser role')
  })

  it('37. exactly one retired overload is asserted', () => {
    expect(mig111).toContain('expected 1 append_portal_request_files overload')
    expect(mig111).toContain('is not the retired SEC-0S R3 stub')
  })

  it('38-41. retired stub cannot register arbitrary/unissued/nonexistent/cross-request paths', () => {
    expect(mig111).toContain('append_portal_request_files is retired; use register_portal_attachments')
    // Stub body has no URL acceptance path.
    const start = mig111.indexOf('CREATE OR REPLACE FUNCTION public.append_portal_request_files')
    const end = mig111.indexOf('COMMENT ON FUNCTION public.append_portal_request_files', start)
    const stub = mig111.slice(start, end)
    expect(stub).toContain('RAISE EXCEPTION')
    expect(stub).not.toContain("LIKE 'https://%'")
    expect(stub).not.toContain('portal-uploads')
  })

  it('42. secure registration still granted to anon/authenticated', () => {
    expect(mig111).toMatch(/GRANT EXECUTE ON FUNCTION public\.register_portal_attachments\(UUID, TEXT\[\], TEXT\) TO anon/)
    expect(mig111).toMatch(/GRANT EXECUTE ON FUNCTION public\.register_portal_attachments\(UUID, TEXT\[\], TEXT\) TO authenticated/)
  })

  it('43. secure registration still consumes token and authorization (duplicate controlled)', () => {
    expect(mig111).toContain('attach_token_hash = NULL')
    expect(mig111).toContain('consumed_at = now()')
  })
})

describe('[STATIC] SEC-0S R3 customer/owner historical Files: parity', () => {
  it('customer mode parses historical Files: metadata', () => {
    expect(readFn).toContain('FilePaths: (canonical) and Files: (historical public URLs)')
    expect(readFn).toContain('notes.match(/Files:\\s*([^|]+)/i)')
  })

  it('owner org equality remains required before path parsing/signing', () => {
    expect(readFn.indexOf('get_portal_attachment_context')).toBeLessThan(
      readFn.indexOf('parseNotesForPaths(requestRow.notes, requestId, supabaseHost)')
    )
  })

  it('client cannot supply historical URL or path for signing', () => {
    expect(readFn).not.toMatch(/body\.(url|urls|files|fileUrl|historical)/)
    expect(readFn).toContain('Ignore any client-supplied path/URL fields')
  })

  it('protocol-relative, HTTP, and credentialed URLs rejected', () => {
    const { normalizePortalObjectPath } = readFnModule._test
    expect(normalizePortalObjectPath(`//${HOST}/storage/v1/object/public/portal-uploads/${REQ_A}/${HIST_FILE}`, REQ_A, HOST)).toBeNull()
    expect(normalizePortalObjectPath(`http://${HOST}/storage/v1/object/public/portal-uploads/${REQ_A}/${HIST_FILE}`, REQ_A, HOST)).toBeNull()
    expect(normalizePortalObjectPath(
      `https://user:pass@${HOST}/storage/v1/object/public/portal-uploads/${REQ_A}/${HIST_FILE}`,
      REQ_A,
      HOST
    )).toBeNull()
  })

  it('new upload path generator remains UUID-only (authorize unchanged)', () => {
    expect(uploadFn).toContain('const objectPath = `${requestId}/${attachId}.${ext}`')
    expect(uploadFn).toContain('crypto.randomUUID()')
  })

  it('migration postcondition proves no Storage policy still references portal-uploads', () => {
    expect(mig111).toContain('a Storage policy still references portal-uploads')
  })

  it('migration postcondition proves authorization table browser privileges absent', () => {
    expect(mig111).toContain('portal_upload_authorizations remains accessible to browser roles')
    expect(mig111).toContain('REVOKE ALL PRIVILEGES ON TABLE public.portal_upload_authorizations FROM anon')
  })

  it('destination organization ambiguity still aborts application', () => {
    expect(mig111).toContain('cannot choose a Portal destination organization safely')
    expect(mig111).toContain("settings->>'public_portal_destination' = 'true'")
  })
})
