/**
 * src/features/spending-explorer/reviewDraft.ts
 *
 * A browser-only DRAFT of an in-progress batch review, so an accidental reload does not lose the owner's work. It is a convenience, never a decision:
 *   - It stores only transaction IDS, which of them are unchecked, and category CHOICES (a bucket key per id). No merchant, amount, description, token or
 *     account detail is ever written.
 *   - It is private to one organization AND user: the key includes an opaque scope the server derives from both, so another user or organization on the
 *     same browser never sees it.
 *   - It carries no approval. Restoring it only re-selects rows that are STILL eligible bank evidence; confirming is always a fresh, explicit step and the
 *     server re-validates everything.
 *   - It expires after 24 hours, and anything malformed is discarded.
 */
const VERSION = 1
export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000
export const DRAFT_MAX_IDS = 200
const SCOPE = /^[0-9a-f]{16}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BUCKET = /^[a-z][a-z_]{1,39}$/

export interface ReviewDraft { ids: string[]; off: string[]; overrides: Record<string, string> }

export const draftKey = (scope: string): string => `poweron.spending.review.draft.v${VERSION}:${scope}`

function store(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

export function clearDraft(scope: string): void {
  try { if (SCOPE.test(scope)) store()?.removeItem(draftKey(scope)) } catch { /* storage may be blocked */ }
}

export function saveDraft(scope: string, draft: ReviewDraft, now = Date.now()): void {
  if (!SCOPE.test(scope)) return
  const ids = [...new Set(draft.ids)].filter(id => UUID.test(id)).slice(0, DRAFT_MAX_IDS)
  if (ids.length === 0) { clearDraft(scope); return }
  const keep = new Set(ids)
  const body = {
    v: VERSION, at: now, ids,
    off: [...new Set(draft.off)].filter(id => keep.has(id)),
    overrides: Object.fromEntries(Object.entries(draft.overrides).filter(([id, b]) => keep.has(id) && BUCKET.test(b))),
  }
  try { store()?.setItem(draftKey(scope), JSON.stringify(body)) } catch { /* a full or blocked store only costs the convenience */ }
}

/** Returns a validated draft, or null (and removes the stored copy) when it is missing, expired, from the future, or malformed. */
export function loadDraft(scope: string, now = Date.now()): ReviewDraft | null {
  if (!SCOPE.test(scope)) return null
  try {
    const raw = store()?.getItem(draftKey(scope))
    if (!raw) return null
    const v = JSON.parse(raw) as { v?: unknown; at?: unknown; ids?: unknown; off?: unknown; overrides?: unknown }
    if (v.v !== VERSION || typeof v.at !== 'number' || now - v.at > DRAFT_MAX_AGE_MS || now < v.at || !Array.isArray(v.ids)) { clearDraft(scope); return null }
    const ids = [...new Set(v.ids.filter((x): x is string => typeof x === 'string' && UUID.test(x)))].slice(0, DRAFT_MAX_IDS)
    if (ids.length === 0) { clearDraft(scope); return null }
    const keep = new Set(ids)
    const off = Array.isArray(v.off) ? v.off.filter((x): x is string => typeof x === 'string' && keep.has(x)) : []
    const overrides: Record<string, string> = {}
    if (v.overrides && typeof v.overrides === 'object' && !Array.isArray(v.overrides)) {
      for (const [id, b] of Object.entries(v.overrides as Record<string, unknown>)) if (keep.has(id) && typeof b === 'string' && BUCKET.test(b)) overrides[id] = b
    }
    return { ids, off, overrides }
  } catch { clearDraft(scope); return null }
}
