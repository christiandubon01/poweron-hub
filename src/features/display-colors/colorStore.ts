/**
 * src/features/display-colors/colorStore.ts
 *
 * BANK-6D: where category / account colors live. Colors are ORGANIZATION-WIDE display preferences (migration 158,
 * cash_os_display_colors), written only through the cash_os_set_display_color function, which applies row-level security (owners and admins of the
 * caller's own organization). Until migration 158 is applied, colors fall back to this device so the feature still works; nothing about any
 * financial record is ever read for writing or changed. The tint toggles are deliberately DEVICE-local (a viewing preference).
 */
import { ACCOUNT_ID, CATEGORY_KEY, isPaletteColor } from './palette'

export interface ColorMaps { categories: Record<string, string>; accounts: Record<string, string> }
export type ColorStorage = 'shared' | 'device'
export type ColorTarget = 'category' | 'account'
export interface DisplayColorStore {
  load(): Promise<{ colors: ColorMaps; storage: ColorStorage }>
  set(kind: ColorTarget, key: string, color: string | null): Promise<{ storage: ColorStorage }>
}
export const EMPTY_COLORS: ColorMaps = { categories: {}, accounts: {} }

/** Keeps only stable keys and curated colors; anything else (tampered storage, a future palette, a bad row) is dropped. */
export function sanitizeColors(raw: unknown): ColorMaps {
  const out: ColorMaps = { categories: {}, accounts: {} }
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Record<string, unknown>
  for (const [map, pattern] of [['categories', CATEGORY_KEY], ['accounts', ACCOUNT_ID]] as const) {
    const m = r[map]
    if (!m || typeof m !== 'object' || Array.isArray(m)) continue
    for (const [k, v] of Object.entries(m as Record<string, unknown>)) if (pattern.test(k) && isPaletteColor(v)) out[map][map === 'accounts' ? k.toLowerCase() : k] = v
  }
  return out
}
export const validTarget = (kind: ColorTarget, key: string): boolean => (kind === 'category' ? CATEGORY_KEY : ACCOUNT_ID).test(key)

function storage(): Storage | null { try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null } }
const COLORS_PREFIX = 'poweron.display.colors.v1:'
const TINT_KEY = 'poweron.display.tint.v1'
/** Device colors are kept PER ORGANIZATION. Without a valid organization id there is no storage at all (safe defaults, never a shared key). */
export const deviceColorsKey = (organizationId: string | null | undefined): string | null =>
  typeof organizationId === 'string' && ACCOUNT_ID.test(organizationId) ? `${COLORS_PREFIX}${organizationId.toLowerCase()}` : null

/** This device only, for ONE organization. Used before migration 158 exists, and as the source of an owner's "Import device colors". */
export function createDeviceColorStore(organizationId: string | null | undefined): DisplayColorStore & { available: boolean } {
  const key = deviceColorsKey(organizationId)
  const read = (): ColorMaps => {
    if (!key) return { categories: {}, accounts: {} }
    try { return sanitizeColors(JSON.parse(storage()?.getItem(key) ?? 'null')) } catch { return { categories: {}, accounts: {} } }
  }
  return {
    available: !!key,
    async load() { return { colors: read(), storage: 'device' } },
    async set(kind, k, color) {
      if (!key) throw new Error('Colors cannot be saved right now because your organization could not be identified.')
      if (!validTarget(kind, k) || (color !== null && !isPaletteColor(color))) throw new Error('That color could not be saved.')
      const next = read(), map = kind === 'category' ? next.categories : next.accounts
      const id = kind === 'account' ? k.toLowerCase() : k
      if (color) map[id] = color; else delete map[id]
      try { storage()?.setItem(key, JSON.stringify(next)) } catch { /* a blocked store only costs the convenience */ }
      return { storage: 'device' }
    },
  }
}

/** What an owner would import from this device into the organization's shared colors. Shared colors are never overwritten without confirmation. */
export interface ImportEntry { kind: ColorTarget; key: string; device: string; shared: string | null }
export function planImport(device: ColorMaps, shared: ColorMaps, knownAccounts: Set<string>): { additions: ImportEntry[]; conflicts: ImportEntry[]; skipped: number } {
  const additions: ImportEntry[] = [], conflicts: ImportEntry[] = []
  let skipped = 0
  for (const [kind, d, s] of [['category', device.categories, shared.categories], ['account', device.accounts, shared.accounts]] as const) {
    for (const [key, color] of Object.entries(d)) {
      if (kind === 'account' && !knownAccounts.has(key)) { skipped += 1; continue } // an account that is no longer in this organization's list
      const cur = s[key] ?? null
      if (cur === color) continue
      ;(cur ? conflicts : additions).push({ kind, key, device: color, shared: cur })
    }
  }
  return { additions, conflicts, skipped }
}

type Client = {
  from: (t: string) => { select: (c: string) => PromiseLike<{ data: any; error: any }> }
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>
}
const missing = (e: any, name: string) => ['42P01', 'PGRST205', '42883', 'PGRST202'].includes(String(e?.code ?? '')) || new RegExp(`${name}.*(does not exist|schema cache|not find)`, 'i').test(String(e?.message ?? ''))

/** Organization-wide colors (migration 158). Falls back to this device, and says so, while the table or function does not exist yet. */
export function createSharedColorStore(client: Client, fallback: DisplayColorStore): DisplayColorStore {
  return {
    async load() {
      const { data, error } = await client.from('cash_os_display_colors').select('target_kind, category_key, financial_account_id, color')
      if (error) {
        if (missing(error, 'cash_os_display_colors')) return fallback.load()
        throw new Error('Colors could not be loaded.')
      }
      const raw: ColorMaps = { categories: {}, accounts: {} }
      for (const r of (data ?? []) as Array<Record<string, unknown>>) {
        if (r.target_kind === 'category' && typeof r.category_key === 'string') raw.categories[r.category_key] = r.color as string
        if (r.target_kind === 'account' && typeof r.financial_account_id === 'string') raw.accounts[r.financial_account_id] = r.color as string
      }
      return { colors: sanitizeColors(raw), storage: 'shared' }
    },
    async set(kind, key, color) {
      if (!validTarget(kind, key) || (color !== null && !isPaletteColor(color))) throw new Error('That color could not be saved.')
      const { error } = await client.rpc('cash_os_set_display_color', { p_kind: kind, p_key: key, p_color: color })
      if (!error) return { storage: 'shared' }
      if (missing(error, 'cash_os_set_display_color')) return fallback.set(kind, key, color)
      if (String(error.code) === '42501' || /FORBIDDEN/.test(String(error.message ?? ''))) throw new Error('Only owners and admins can change colors.')
      if (String(error.code) === '23503') throw new Error('That account was not found.')
      throw new Error('That color could not be saved.')
    },
  }
}

export interface TintPrefs { rows: boolean; accounts: boolean }
/** Device-local, both OFF by default. */
export function loadTint(): TintPrefs {
  try { const v = JSON.parse(storage()?.getItem(TINT_KEY) ?? 'null'); return { rows: v?.rows === true, accounts: v?.accounts === true } } catch { return { rows: false, accounts: false } }
}
export function saveTint(t: TintPrefs): void { try { storage()?.setItem(TINT_KEY, JSON.stringify({ rows: !!t.rows, accounts: !!t.accounts })) } catch { /* blocked storage */ } }
