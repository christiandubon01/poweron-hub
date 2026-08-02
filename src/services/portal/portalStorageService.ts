/**
 * portalStorageService — SEC-0S R1: Attachment helpers for portal views.
 *
 * SEC-0S R1 design:
 *   - No browser-side Storage signing or public URL generation calls.
 *   - Signed read URLs are generated server-side by portal-attachment-read.
 *   - fetchAttachmentSignedUrls() calls that endpoint; callers pass requestId
 *     and (for owner/admin mode) the authenticated session JWT.
 *   - parseAttachmentPaths() is retained for display-only use (e.g., count
 *     badge in PortalInbox list rows) — it does NOT touch Storage.
 *   - extractStoragePath() is retained for display-only parsing; it now
 *     rejects arbitrary hosts and encoded traversal.
 */

/**
 * Attachment entry returned by portal-attachment-read.
 */
export interface AttachmentEntry {
  displayName: string
  mimeType: string | null
  signedUrl: string | null
  expiresAt: string | null
}

/**
 * Call the portal-attachment-read server endpoint to obtain signed read URLs.
 *
 * Customer mode (PortalTrackView): pass requestId only (jwt = undefined).
 * Owner/admin mode (PortalInbox):  pass requestId + authenticated session JWT.
 *
 * Returns an empty array on any error or if no attachments exist.
 * Never throws — callers can treat an empty result as "no attachments" or
 * "unavailable".
 */
export async function fetchAttachmentSignedUrls(
  requestId: string,
  jwt?: string
): Promise<AttachmentEntry[]> {
  if (!requestId) return []

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (jwt) {
    headers['Authorization'] = `Bearer ${jwt}`
  }

  try {
    const res = await fetch('/.netlify/functions/portal-attachment-read', {
      method: 'POST',
      headers,
      body: JSON.stringify({ requestId }),
    })
    if (!res.ok) return []
    const data = await res.json() as { attachments?: AttachmentEntry[] }
    return Array.isArray(data.attachments) ? data.attachments : []
  } catch {
    return []
  }
}

/**
 * Extract a portal-uploads storage path from a full public/signed URL or
 * return a bare relative path as-is.  Returns null if the input cannot be
 * resolved to a valid, safe, relative path.
 *
 * SECURITY NOTE: This function is for display-only use (e.g., extracting
 * paths from notes for the attachment count badge).  It is NOT used to
 * construct paths sent to Storage.  Server-side path extraction in
 * portal-attachment-read.ts applies stricter host validation.
 *
 * Rejected inputs:
 *   - Arbitrary external hosts (URL must contain /portal-uploads/ segment)
 *   - Absolute paths (starts with /)
 *   - Path traversal (.. sequences, encoded or literal)
 *   - Protocol-relative URLs (starts with //)
 *   - Empty or non-string input
 */
export function extractStoragePath(urlOrPath: string): string | null {
  if (!urlOrPath || typeof urlOrPath !== 'string') return null
  const s = urlOrPath.trim()
  if (!s) return null

  if (s.startsWith('//')) return null  // protocol-relative rejected

  if (s.includes('://')) {
    // URL: accept only if it contains the expected storage path segment
    const match = s.match(/\/portal-uploads\/([^?#]+)/)
    if (!match) return null
    const decoded = decodeURIComponent(match[1])
    // Reject traversal in the decoded segment
    if (decoded.includes('..') || decoded.startsWith('/') || decoded.startsWith('\\')) return null
    // Reject if the original segment contains encoded traversal
    const seg = match[1].toLowerCase()
    if (seg.includes('%2e%2e') || seg.includes('%2f') || seg.includes('%5c')) return null
    return decoded
  }

  // Bare relative path
  if (s.startsWith('/') || s.startsWith('\\')) return null
  if (s.includes('..')) return null
  const lower = s.toLowerCase()
  if (lower.includes('%2e%2e') || lower.includes('%2f') || lower.includes('%5c')) return null
  return s
}

/**
 * Parse attachment storage paths from a portal_requests notes string.
 * Used only for display purposes (e.g., attachment count badge).
 *
 * Supported formats:
 *   New: "FilePaths: {requestId}/uuid.jpg, {requestId}/uuid.pdf"
 *   Old: "Files: https://....supabase.co/storage/v1/object/public/portal-uploads/..."
 *
 * The server endpoint (portal-attachment-read) performs authoritative path
 * extraction with full host validation.  This function is for UI display only.
 */
export function parseAttachmentPaths(notes: string | null | undefined): string[] {
  if (!notes) return []

  // New format: "FilePaths: path1, path2, ..." (terminated by | or end of string)
  const filePathsMatch = notes.match(/FilePaths:\s*([^|]+)/)
  if (filePathsMatch) {
    return filePathsMatch[1]
      .split(',')
      .map(p => p.trim())
      .filter(Boolean)
  }

  // Old format: "Files: https://url1, https://url2, ..."
  const filesMatch = notes.match(/Files:\s*(.+)/)
  if (filesMatch) {
    return filesMatch[1]
      .split(',')
      .map(u => extractStoragePath(u.trim()))
      .filter((p): p is string => p !== null)
  }

  return []
}

/** Returns true when the path extension indicates an image. */
export function isImagePath(path: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i.test(path)
}

/** Returns true when the path extension indicates a video. */
export function isVideoPath(path: string): boolean {
  return /\.(mp4|mov)$/i.test(path)
}

/** Returns true when the path extension indicates a PDF. */
export function isPdfPath(path: string): boolean {
  return /\.pdf$/i.test(path)
}

/**
 * Human-readable display name for a storage path.
 * UUID-named files (new format) → "Attachment N (EXT)"
 * Legacy paths with filename → decoded filename
 */
export function getAttachmentDisplayName(path: string, index: number): string {
  const segment = path.split('/').pop() ?? path
  if (/^[0-9a-f-]{36}\.[a-z0-9]+$/i.test(segment)) {
    const ext = segment.split('.').pop()?.toUpperCase() ?? ''
    return `Attachment ${index + 1}${ext ? ` (${ext})` : ''}`
  }
  return decodeURIComponent(segment).replace(/^\d+-/, '')
}
