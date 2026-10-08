// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { clearDraft, DRAFT_MAX_AGE_MS, DRAFT_MAX_IDS, draftKey, loadDraft, saveDraft } from './reviewDraft'

/** The review draft is a convenience only: ids and category choices, scoped, expiring, validated, and never an approval. */
const SCOPE = 'abcdef0123456789'
const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const NOW = 1_800_000_000_000

describe('review draft storage', () => {
  beforeEach(() => window.localStorage.clear())

  it('round-trips ids, unchecked ids and category choices - and nothing else', () => {
    saveDraft(SCOPE, { ids: [u(1), u(2)], off: [u(2)], overrides: { [u(1)]: 'tools_equipment' } }, NOW)
    expect(loadDraft(SCOPE, NOW + 1000)).toEqual({ ids: [u(1), u(2)], off: [u(2)], overrides: { [u(1)]: 'tools_equipment' } })
    expect(Object.keys(JSON.parse(window.localStorage.getItem(draftKey(SCOPE))!)).sort()).toEqual(['at', 'ids', 'off', 'overrides', 'v'])
  })
  it('is private to its scope (organization + user): another scope reads nothing', () => {
    saveDraft(SCOPE, { ids: [u(1)], off: [], overrides: {} }, NOW)
    expect(loadDraft('0123456789abcdef', NOW)).toBeNull()
    expect(window.localStorage.getItem(draftKey(SCOPE))).not.toBeNull() // and the other scope did not touch it
  })
  it('refuses a malformed scope, so a bad value can never address another key', () => {
    saveDraft('../etc', { ids: [u(1)], off: [], overrides: {} }, NOW); saveDraft('', { ids: [u(1)], off: [], overrides: {} }, NOW)
    expect(window.localStorage.length).toBe(0)
    expect(loadDraft('not-a-scope', NOW)).toBeNull()
  })
  it('expires after 24 hours, rejects a draft from the future, and discards both', () => {
    saveDraft(SCOPE, { ids: [u(1)], off: [], overrides: {} }, NOW)
    expect(loadDraft(SCOPE, NOW + DRAFT_MAX_AGE_MS - 1)).not.toBeNull()
    expect(loadDraft(SCOPE, NOW + DRAFT_MAX_AGE_MS + 1)).toBeNull(); expect(window.localStorage.getItem(draftKey(SCOPE))).toBeNull()
    saveDraft(SCOPE, { ids: [u(1)], off: [], overrides: {} }, NOW)
    expect(loadDraft(SCOPE, NOW - 5000)).toBeNull(); expect(window.localStorage.getItem(draftKey(SCOPE))).toBeNull()
  })
  it('validates on save and on load: only UUIDs, unchecked ids that are in the draft, and sane category keys survive; tampering is dropped', () => {
    saveDraft(SCOPE, { ids: [u(1), 'not-a-uuid', u(1)], off: [u(1), u(9)], overrides: { [u(1)]: 'materials', [u(9)]: 'materials', [u(1) + 'x']: 'meals' } }, NOW)
    expect(loadDraft(SCOPE, NOW)).toEqual({ ids: [u(1)], off: [u(1)], overrides: { [u(1)]: 'materials' } })
    window.localStorage.setItem(draftKey(SCOPE), JSON.stringify({ v: 1, at: NOW, ids: [u(1), 7, '<script>'], off: [u(5), u(1)], overrides: { [u(1)]: 'Robert); DROP TABLE', [u(2)]: 'meals' } }))
    expect(loadDraft(SCOPE, NOW)).toEqual({ ids: [u(1)], off: [u(1)], overrides: {} })
  })
  it('discards garbage, a wrong version, and an empty draft instead of throwing', () => {
    for (const bad of ['{not json', JSON.stringify({ v: 2, at: NOW, ids: [u(1)] }), JSON.stringify({ v: 1, at: NOW, ids: [] }), JSON.stringify({ v: 1, ids: [u(1)] }), 'null', '[]']) {
      window.localStorage.setItem(draftKey(SCOPE), bad)
      expect(loadDraft(SCOPE, NOW)).toBeNull(); expect(window.localStorage.getItem(draftKey(SCOPE))).toBeNull()
    }
  })
  it('bounds its size, and an empty draft removes the stored copy', () => {
    saveDraft(SCOPE, { ids: Array.from({ length: DRAFT_MAX_IDS + 40 }, (_, i) => u(i + 1)), off: [], overrides: {} }, NOW)
    expect(loadDraft(SCOPE, NOW)!.ids).toHaveLength(DRAFT_MAX_IDS)
    saveDraft(SCOPE, { ids: [], off: [], overrides: {} }, NOW)
    expect(window.localStorage.getItem(draftKey(SCOPE))).toBeNull()
    saveDraft(SCOPE, { ids: [u(1)], off: [], overrides: {} }, NOW); clearDraft(SCOPE)
    expect(window.localStorage.getItem(draftKey(SCOPE))).toBeNull()
  })
  it('never throws when storage is unavailable', () => {
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage')!
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('blocked') } })
    try {
      expect(() => saveDraft(SCOPE, { ids: [u(1)], off: [], overrides: {} }, NOW)).not.toThrow()
      expect(loadDraft(SCOPE, NOW)).toBeNull(); expect(() => clearDraft(SCOPE)).not.toThrow()
    } finally { Object.defineProperty(window, 'localStorage', real) }
  })
  it('remember is optional, validated, limited to saved ids, and absent in older drafts', () => {
    const a = '00000000-0000-4000-8000-000000000001', b = '00000000-0000-4000-8000-000000000002'
    saveDraft('abcdef0123456789', { ids: [a], off: [], overrides: {}, remember: [a, b, 'x'] }, 1000, 'smart')
    expect(loadDraft('abcdef0123456789', 1001, 'smart')!.remember).toEqual([a])
    saveDraft('abcdef0123456789', { ids: [a], off: [], overrides: {} }, 1000)
    expect(loadDraft('abcdef0123456789', 1001)!.remember).toBeUndefined()
  })
})
