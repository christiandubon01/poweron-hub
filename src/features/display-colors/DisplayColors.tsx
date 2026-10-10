/**
 * src/features/display-colors/DisplayColors.tsx
 *
 * BANK-6D: the shared color context and the small building blocks every surface uses (stripe, account dot, swatch picker, colors panel).
 * Reusable on purpose: the Bank Connection panel and Spending Explorer redesigns can mount the same provider and blocks. Visual only.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { SWATCH_GROUPS, SWATCHES, swatchName, withAlpha } from './palette'
import { createDeviceColorStore, createSharedColorStore, EMPTY_COLORS, loadTint, planImport, saveTint, type ColorMaps, type ColorStorage, type ColorTarget, type DisplayColorStore, type ImportEntry, type TintPrefs } from './colorStore'
import { parentColorKey } from './hierarchyColors'
import { accountStripe, stripeStyle, tintStyle, type Stripe } from './stripes'

export interface ColorAccount { id: string; label: string; /** e.g. "Business · Checking" (shown under the name in the Colors panel) */ detail?: string }
export interface ImportPlan { additions: ImportEntry[]; conflicts: ImportEntry[]; skipped: number }
interface Ctx {
  enabled: boolean
  colors: ColorMaps
  storage: ColorStorage | null
  tint: TintPrefs
  accounts: ColorAccount[]
  error: string | null
  /** Device colors of THIS organization that are not (or not equally) in its shared colors. Only once shared colors exist; never applied automatically. */
  importPlan: ImportPlan | null
  importNote: string | null
  categoryColor: (key: string) => string | null
  accountColor: (id: string | null | undefined) => string | null
  setColor: (kind: ColorTarget, key: string, color: string | null) => Promise<void>
  /** Synchronize a color already persisted atomically by classification management. */
  acceptSavedCategoryColor: (key: string, color: string | null) => void
  setTint: (patch: Partial<TintPrefs>) => void
  importDeviceColors: (replaceConflicts: boolean) => Promise<void>
}
const OFF: Ctx = {
  enabled: false, colors: EMPTY_COLORS, storage: null, tint: { rows: false, accounts: false }, accounts: [], error: null, importPlan: null, importNote: null,
  categoryColor: () => null, accountColor: () => null, setColor: async () => {}, acceptSavedCategoryColor: () => {}, setTint: () => {}, importDeviceColors: async () => {},
}
const ColorCtx = createContext<Ctx>(OFF)
/** Outside a provider everything is colorless and nothing can be edited (surfaces render exactly as before). */
export const useDisplayColors = (): Ctx => useContext(ColorCtx)

async function defaultStore(device: DisplayColorStore): Promise<DisplayColorStore> {
  try { const { supabase } = await import('@/lib/supabase'); return createSharedColorStore(supabase as never, device) } catch { return device }
}

/**
 * Colors for ONE organization. `organizationId` scopes the device fallback; without it (and without an injected store) the provider stays OFF:
 * no colors are read or written, and no shared storage key is ever used. Switching organization clears the colors before the new ones load.
 */
export function DisplayColorsProvider({ children, accounts = [], organizationId, store, deviceStore }: {
  children: React.ReactNode; accounts?: ColorAccount[]; organizationId?: string | null; store?: DisplayColorStore; deviceStore?: DisplayColorStore
}) {
  const device = useMemo(() => deviceStore ?? createDeviceColorStore(organizationId), [deviceStore, organizationId])
  const active = !!store || (device as { available?: boolean }).available !== false
  const storePromise = useMemo(() => (!active ? null : store ? Promise.resolve(store) : defaultStore(device)), [active, store, device])
  const [colors, setColors] = useState<ColorMaps>(EMPTY_COLORS)
  const [deviceColors, setDeviceColors] = useState<ColorMaps>(EMPTY_COLORS)
  const [storage, setStorage] = useState<ColorStorage | null>(null)
  const [tint, setTintState] = useState<TintPrefs>(() => loadTint())
  const [error, setError] = useState<string | null>(null)
  const [importNote, setImportNote] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setColors(EMPTY_COLORS); setDeviceColors(EMPTY_COLORS); setStorage(null); setError(null); setImportNote(null) // never show the previous organization's colors
    if (!storePromise) return () => { live = false }
    storePromise.then(s => s.load()).then(async r => {
      if (!live) return
      setColors(r.colors); setStorage(r.storage)
      if (r.storage === 'shared') { const d = await device.load(); if (live) setDeviceColors(d.colors) }
    }).catch(() => { if (live) setError('Colors could not be loaded. Everything else works as usual.') })
    return () => { live = false }
  }, [storePromise, device])

  const setColor = useCallback(async (kind: ColorTarget, key: string, color: string | null) => {
    if (!storePromise) return
    const k = kind === 'account' ? key.toLowerCase() : key
    const before = colors
    const next: ColorMaps = { categories: { ...colors.categories }, accounts: { ...colors.accounts } }
    const map = kind === 'category' ? next.categories : next.accounts
    if (color) map[k] = color; else delete map[k]
    setColors(next); setError(null) // optimistic: the stripe changes at once, and is put back if saving fails
    try { const r = await (await storePromise).set(kind, k, color); setStorage(r.storage) } catch (e) { setColors(before); setError((e as Error).message || 'That color could not be saved.') }
  }, [colors, storePromise])
  const setTint = useCallback((patch: Partial<TintPrefs>) => setTintState(prev => { const n = { ...prev, ...patch }; saveTint(n); return n }), [])

  const knownAccounts = useMemo(() => new Set(accounts.map(a => a.id.toLowerCase())), [accounts])
  const importPlan = useMemo<ImportPlan | null>(() => {
    if (storage !== 'shared') return null
    const plan = planImport(deviceColors, colors, knownAccounts)
    return plan.additions.length || plan.conflicts.length ? plan : null
  }, [storage, deviceColors, colors, knownAccounts])

  /** OWNER-CONTROLLED: writes each device color through the shared store (row-level security: owners/admins only). Conflicts only when confirmed. */
  const importDeviceColors = useCallback(async (replaceConflicts: boolean) => {
    if (!storePromise || !importPlan) return
    const todo = [...importPlan.additions, ...(replaceConflicts ? importPlan.conflicts : [])]
    const s = await storePromise
    let done = 0
    setError(null); setImportNote(null)
    for (const e of todo) {
      try {
        const r = await s.set(e.kind, e.key, e.device)
        if (r.storage !== 'shared') throw new Error('Shared colors are not available, so nothing was imported.')
        done += 1
        setColors(prev => { const n = { categories: { ...prev.categories }, accounts: { ...prev.accounts } }; (e.kind === 'category' ? n.categories : n.accounts)[e.key] = e.device; return n })
      } catch (err) { setError((err as Error).message || 'Import stopped.'); break }
    }
    const left = todo.length - done
    setImportNote(done ? `Imported ${done} color${done === 1 ? '' : 's'} from this device.${left ? ` ${left} not imported.` : ''}` : null)
  }, [storePromise, importPlan])

  const value = useMemo<Ctx>(() => ({
    enabled: active, colors, storage, tint, accounts, error, importPlan, importNote,
    acceptSavedCategoryColor: (key, color) => setColors(prev => { const categories = { ...prev.categories }; if (color) categories[key] = color; else delete categories[key]; return { ...prev, categories } }),
    categoryColor: (key: string) => colors.categories[key] ?? null,
    accountColor: (id: string | null | undefined) => (id ? colors.accounts[id.toLowerCase()] ?? null : null),
    setColor, setTint, importDeviceColors,
  }), [active, colors, storage, tint, accounts, error, importPlan, importNote, setColor, setTint, importDeviceColors])
  return <ColorCtx.Provider value={value}>{children}</ColorCtx.Provider>
}

/**
 * The left color RAIL (BANK-6E). The parent must be `relative`. `card` sits flush in a rounded-xl card, `card-sm` in a rounded-lg one, `inset` floats
 * in a plain list row. Decorative: the entry's own text always says what it is (confirmed / suggested / needs review / ignored).
 */
export function StripeBar({ stripe, shape = 'inset' }: { stripe: Stripe; shape?: 'card' | 'card-sm' | 'inset' }) {
  // A floating capsule (BANK-6E): wide enough that the HOLLOW suggested rail reads as an outline, not as a thinner solid line.
  const place = shape === 'card' ? 'bottom-2 left-1.5 top-2 w-[7px]' : shape === 'card-sm' ? 'bottom-1.5 left-1 top-1.5 w-[6px]' : 'bottom-1 left-0 top-1 w-[6px]'
  return <span aria-hidden="true" data-testid="color-stripe" data-stripe={stripe.kind} data-color={stripe.color ?? ''}
    className={`pointer-events-none absolute rounded-full ${place}`} style={stripeStyle(stripe)} />
}
export { tintStyle }

/** A small account-colored square shown next to the account NAME (the name text is always there). */
export function AccountColorDot({ accountId }: { accountId: string | null | undefined }) {
  const { accountColor } = useDisplayColors()
  const c = accountColor(accountId)
  if (!c) return null
  return <span aria-hidden="true" data-testid="account-color-dot" data-color={c} className="mr-1.5 inline-block h-2.5 w-2.5 rounded-[3px] align-[-1px]" style={{ background: c, boxShadow: '0 0 0 1px rgba(0,0,0,0.25)' }} />
}

/** A category color dot (solid when confirmed / a plain indicator, hollow ring when the category is only a suggestion). Nothing when uncolored. */
export function CategoryDot({ categoryKey, hollow = false, className = '' }: { categoryKey: string | null | undefined; hollow?: boolean; className?: string }) {
  const { categoryColor } = useDisplayColors()
  const c = categoryKey ? categoryColor(categoryKey) : null
  if (!c) return null
  return <span aria-hidden="true" data-testid="category-dot" data-color={c} className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${className}`}
    style={hollow ? { boxShadow: `inset 0 0 0 2px ${c}` } : { background: c }} />
}

/**
 * The category PILL: the explicit, text-first category indicator (BANK-6E).
 *   confirmed -> "✓ Fuel / Vehicle", solid dot, a light wash of the color
 *   suggested -> "Suggested · Fuel / Vehicle", hollow dot, DASHED outline, no fill (a suggestion never looks approved)
 *   draft     -> "Your choice · Fuel / Vehicle" (BANK-6F D13): the owner picked it but has not approved it yet, so it keeps the dashed, unfilled look
 *   none      -> the plain muted label
 */
export function CategoryPill({ categoryKey, label, state }: { categoryKey: string | null; label: string; state: 'confirmed' | 'suggested' | 'draft' | 'none' }) {
  const { categoryColor } = useDisplayColors()
  const c = categoryKey && state !== 'none' ? categoryColor(categoryKey) : null
  const base = 'inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4'
  if (state === 'confirmed') {
    return <span data-testid="category-pill" data-state="confirmed" className={`${base} ring-1`}
      style={c ? { background: withAlpha(c, 0.14), boxShadow: `inset 0 0 0 1px ${withAlpha(c, 0.45)}`, color: 'var(--text-primary)' } : { color: 'var(--text-primary)', boxShadow: 'inset 0 0 0 1px var(--surface-line)' }}>
      {c && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: c }} />}<span className="truncate">✓ {label}</span>
    </span>
  }
  if (state === 'suggested' || state === 'draft') {
    return <span data-testid="category-pill" data-state={state} className={`${base} border border-dashed ${state === 'draft' ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`} style={{ borderColor: c ?? 'var(--border-primary)' }}>
      {c && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ boxShadow: `inset 0 0 0 1.5px ${c}` }} />}<span className="truncate">{state === 'draft' ? 'Your choice' : 'Suggested'} · {label}</span>
    </span>
  }
  return <span data-testid="category-pill" data-state="none" className={`${base} text-[var(--text-secondary)]`} style={{ boxShadow: 'inset 0 0 0 1px var(--border-primary)' }}><span className="truncate">{label}</span></span>
}

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)]'

/** Grouped, named swatches (44px targets) with an unmistakable selected state and a "Selected: …" line. */
export function ColorSwatchPicker({ label, value, onChange, disabled }: { label: string; value: string | null; onChange: (c: string | null) => void; disabled?: boolean }) {
  const item = `relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl motion-safe:transition-transform motion-safe:[@media(hover:hover)]:hover:scale-105 disabled:opacity-50 ${focusRing}`
  return <div role="radiogroup" aria-label={`Color for ${label}`} className="space-y-2" data-testid="color-picker">
    <div className="flex flex-wrap items-center gap-1">
      <button type="button" role="radio" aria-checked={value === null} aria-label="No color" title="No color" disabled={disabled} onClick={() => onChange(null)}
        className={`${item} gap-1.5 px-2.5 text-xs font-semibold ${value === null ? 'bg-[var(--surface-selected)] ring-2 ring-[var(--text-primary)]' : 'ring-1 ring-[var(--border-primary)]'}`}>
        <span aria-hidden="true" className="h-5 w-5 rounded-full border-2 border-dashed border-[var(--text-secondary)]" />None
      </button>
    </div>
    {SWATCH_GROUPS.map(g => <div key={g.id}>
      <p className="mb-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-secondary)]">{g.name}</p>
      <div className="flex flex-wrap gap-0.5">{SWATCHES.filter(s => s.group === g.id).map(s => {
        const on = value === s.hex
        return <button key={s.id} type="button" role="radio" aria-checked={on} aria-label={s.name} title={s.name} disabled={disabled} onClick={() => onChange(s.hex)} className={item} data-swatch={s.id}>
          <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold text-white"
            style={{ background: s.hex, boxShadow: on ? `0 0 0 2px var(--bg-card), 0 0 0 4px var(--text-primary)` : '0 1px 2px rgba(0,0,0,0.35)', textShadow: '0 1px 1px rgba(0,0,0,0.5)' }}>{on ? '✓' : ''}</span>
        </button>
      })}</div>
    </div>)}
    <p className="text-xs text-[var(--text-secondary)]" aria-live="polite" data-testid="picker-selected">Selected: <span className="font-semibold text-[var(--text-primary)]">{swatchName(value) ?? 'No color'}</span></p>
  </div>
}

/** Live preview of how a category color will look on real entries: confirmed AND suggested, side by side. */
function CategoryPreview({ label, color }: { label: string; color: string | null }) {
  const sample = (state: 'confirmed' | 'suggested') => {
    const stripe: Stripe = color ? { kind: state === 'confirmed' ? 'solid' : 'faded', color, tint: false } : { kind: 'none', color: null, tint: false }
    return <div className="relative flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-[var(--surface-line)] bg-[var(--surface-1)] py-1.5 pl-4 pr-2">
      <StripeBar stripe={stripe} shape="card-sm" />
      <span className="min-w-0"><span className="block truncate text-xs font-semibold">Sample merchant</span>
        <span className={`mt-0.5 inline-flex items-center gap-1 rounded-full px-1.5 text-[10px] font-semibold ${state === 'suggested' ? 'border border-dashed text-[var(--text-secondary)]' : ''}`}
          style={state === 'confirmed' ? (color ? { background: withAlpha(color, 0.14), boxShadow: `inset 0 0 0 1px ${withAlpha(color, 0.45)}` } : { boxShadow: 'inset 0 0 0 1px var(--border-primary)' }) : { borderColor: color ?? 'var(--border-primary)' }}>
          {state === 'confirmed' ? `✓ ${label}` : `Suggested · ${label}`}</span></span>
      <span className="shrink-0 text-xs font-semibold tabular-nums">−$42.00</span>
    </div>
  }
  return <div className="flex flex-col gap-1.5 sm:flex-row" data-testid="color-preview">{sample('confirmed')}{sample('suggested')}</div>
}
function AccountPreview({ label, color }: { label: string; color: string | null }) {
  return <div className="relative rounded-xl border border-[var(--surface-line)] bg-[var(--surface-1)] py-2 pl-5 pr-3" data-testid="color-preview">
    <StripeBar stripe={color ? { kind: 'solid', color, tint: false } : { kind: 'none', color: null, tint: false }} shape="card" />
    <p className="truncate text-sm font-semibold">{color && <span aria-hidden="true" className="mr-1.5 inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />}{label}</p>
    <p className="text-xs tabular-nums text-[var(--text-secondary)]">$12,480.00</p>
  </div>
}

function ColorLine({ label, detail, value, onChange, open, onOpen, kind }: { label: string; detail?: string; value: string | null; onChange: (c: string | null) => void; open: boolean; onOpen: () => void; kind: 'category' | 'account' }) {
  return <li className={`rounded-xl ${open ? 'bg-[var(--surface-1)] ring-1 ring-[var(--surface-line)]' : ''}`} data-testid="color-line">
    <button type="button" className={`flex min-h-[52px] w-full items-center gap-3 rounded-xl px-2 text-left motion-safe:transition-colors [@media(hover:hover)]:hover:bg-[var(--surface-2)] ${focusRing}`} aria-expanded={open} onClick={onOpen}>
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{label}</span>
        {detail && <span className="block truncate text-xs text-[var(--text-secondary)]">{detail}</span>}</span>
      <span className="flex shrink-0 items-center gap-2 text-xs text-[var(--text-secondary)]">
        {value ? <span aria-hidden="true" className="h-6 w-6 rounded-full" style={{ background: value, boxShadow: '0 1px 2px rgba(0,0,0,0.35)' }} />
          : <span aria-hidden="true" className="h-6 w-6 rounded-full border-2 border-dashed border-[var(--border-primary)]" />}
        <span className="w-16 truncate">{swatchName(value) ?? 'No color'}</span>
        <span aria-hidden="true" className={`motion-safe:transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
      </span>
    </button>
    {open && <div className="space-y-3 px-2 pb-3 pt-1">
      {kind === 'category' ? <CategoryPreview label={label} color={value} /> : <AccountPreview label={label} color={value} />}
      <ColorSwatchPicker label={label} value={value} onChange={onChange} />
    </div>}
  </li>
}

function Toggle({ label, on, onChange, testId }: { label: string; on: boolean; onChange: (v: boolean) => void; testId: string }) {
  return <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} data-testid={testId}
    className={`flex min-h-[44px] flex-1 items-center justify-between gap-3 rounded-xl px-3 text-left text-sm ring-1 ring-[var(--border-primary)] ${focusRing}`}>
    <span>{label}</span>
    <span aria-hidden="true" className={`inline-flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 motion-safe:transition-colors ${on ? 'justify-end bg-[var(--fin-cash-border)]' : 'justify-start bg-[var(--surface-selected)] ring-1 ring-inset ring-[var(--surface-line)]'}`}><span className="h-5 w-5 rounded-full bg-[var(--text-primary)] shadow" /></span>
  </button>
}

/** One place to choose colors: expense categories, financial accounts, and the two device-local tint switches (both off by default). */
/**
 * After shared colors become available: offer (never apply) this device's colors. New colors are added only when the owner confirms; colors that
 * would REPLACE a different shared color are listed and are replaced only with an extra, explicit opt-in. "Not now" writes nothing.
 */
function ImportDeviceColors({ labelOf }: { labelOf: (kind: 'category' | 'account', key: string) => string }) {
  const { importPlan, importDeviceColors, importNote } = useDisplayColors()
  const [step, setStep] = useState<'offer' | 'confirm' | 'declined'>('offer')
  const [replace, setReplace] = useState(false)
  const [busy, setBusy] = useState(false)
  if (importNote && !importPlan) return <p className="text-xs" role="status" data-testid="import-note">{importNote}</p>
  if (!importPlan || step === 'declined') return importNote ? <p className="text-xs" role="status" data-testid="import-note">{importNote}</p> : null
  const { additions, conflicts, skipped } = importPlan
  const btn = `min-h-[44px] rounded-xl bg-[var(--surface-1)] px-3.5 text-sm font-semibold ring-1 ring-[var(--border-primary)] [@media(hover:hover)]:hover:bg-[var(--surface-2)] disabled:opacity-50 ${focusRing}`
  const nameOf = (hex: string | null) => swatchName(hex) ?? 'No color'
  return <section className="space-y-2 rounded-xl border border-[var(--surface-line)] p-3" aria-label="Colors saved on this device" data-testid="import-device-colors">
    {importNote && <p className="text-xs" role="status" data-testid="import-note">{importNote}</p>}
    <p className="text-sm">This device has {additions.length + conflicts.length} color{additions.length + conflicts.length === 1 ? '' : 's'} that your organization's shared colors do not have yet.</p>
    {conflicts.length > 0 && <div data-testid="import-conflicts">
      <p className="text-xs text-[var(--text-secondary)]">{conflicts.length} already {conflicts.length === 1 ? 'has' : 'have'} a different shared color:</p>
      <ul className="text-xs">{conflicts.map(c => <li key={`${c.kind}:${c.key}`}>{labelOf(c.kind, c.key)}: shared {nameOf(c.shared)}, this device {nameOf(c.device)}</li>)}</ul>
    </div>}
    {skipped > 0 && <p className="text-xs text-[var(--text-secondary)]">{skipped} color{skipped === 1 ? ' is' : 's are'} for accounts that are no longer listed and will not be imported.</p>}
    {step === 'offer'
      ? <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} onClick={() => { setReplace(false); setStep('confirm') }} data-testid="import-start">Import device colors…</button>
          <button type="button" className={btn} onClick={() => setStep('declined')} data-testid="import-decline">Not now</button>
        </div>
      : <div role="alertdialog" aria-label="Confirm import" className="space-y-2" data-testid="import-confirm">
          <p className="text-sm">Add {additions.length} new shared color{additions.length === 1 ? '' : 's'} for everyone in your organization.{conflicts.length ? ' Different shared colors stay as they are unless you choose to replace them.' : ''}</p>
          {conflicts.length > 0 && <label className="flex min-h-[44px] items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5" style={{ appearance: 'auto', WebkitAppearance: 'checkbox' as never, accentColor: 'var(--fin-protected)' }} checked={replace} onChange={e => setReplace(e.target.checked)} data-testid="import-replace" />
            Also replace the {conflicts.length} shared color{conflicts.length === 1 ? '' : 's'} listed above
          </label>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn} disabled={busy || (!additions.length && !replace)} data-testid="import-confirm-button"
              onClick={async () => { setBusy(true); try { await importDeviceColors(replace) } finally { setBusy(false); setStep('offer') } }}>Confirm import</button>
            <button type="button" className={btn} disabled={busy} onClick={() => setStep('offer')} data-testid="import-cancel">Cancel</button>
          </div>
        </div>}
  </section>
}

export function ColorsPanel({ categories, parents = [], hideClassifications = false }: { hideClassifications?: boolean; categories: Array<{ key: string; label: string; hint?: string }>; parents?: Array<{ key: string; label: string; color: string | null }> }) {
  const { enabled, colors, accounts, tint, setTint, setColor, storage, error } = useDisplayColors()
  const [open, setOpen] = useState<string | null>(null)
  if (!enabled) return null
  const labelOf = (kind: 'category' | 'account', key: string) => (kind === 'category' ? categories.find(c => c.key === key)?.label ?? parents.find(p => parentColorKey(p.key) === key)?.label : accounts.find(a => a.id.toLowerCase() === key)?.label) ?? key
  const toggle = (id: string) => setOpen(o => (o === id ? null : id))
  const heading = 'text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]'
  return <div className="mt-2 space-y-4 rounded-2xl border border-[var(--surface-line)] bg-[var(--surface-1)] p-3 sm:p-4" data-testid="colors-panel">
    <div>
      <p className="text-sm font-semibold">Colors</p>
      <p className="text-xs text-[var(--text-secondary)]">Colors only help you recognise things at a glance. They never mean approved or reviewed, and they change nothing in your records.
        {storage === 'device' ? ' Colors are saved on this device for now.' : storage === 'shared' ? ' Colors are shared with your organization.' : ''}</p>
    </div>
    {error && <p role="alert" className="text-xs" style={{ color: 'var(--fin-negative)' }}>{error}</p>}
    <ImportDeviceColors labelOf={labelOf} />
    <div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Toggle label="Tint confirmed transactions" on={tint.rows} onChange={v => setTint({ rows: v })} testId="tint-rows" />
        <Toggle label="Tint account cards" on={tint.accounts} onChange={v => setTint({ accounts: v })} testId="tint-accounts" />
      </div>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">The color rail always shows. Tint applies only to confirmed categories, never to suggestions. Tint settings stay on this device.</p>
    </div>
    {!hideClassifications && parents.length > 0 && <section aria-label="Parent bucket colors">
      <p className={heading}>Parent buckets · {parents.length}</p>
      <p className="text-xs text-[var(--text-secondary)]">Shared display colors. Changing a color never enables classification writes.</p>
      <ul className="mt-1 space-y-0.5">{parents.map(p => <ColorLine key={p.key} kind="category" label={p.label} detail="Parent reporting bucket" value={colors.categories[parentColorKey(p.key)] ?? p.color} open={open === `p:${p.key}`} onOpen={() => toggle(`p:${p.key}`)} onChange={v => void setColor('category', parentColorKey(p.key), v)} />)}</ul>
    </section>}
    {!hideClassifications && <section aria-label="Expense category colors">
      <p className={heading}>Expense categories · {categories.length}</p>
      <ul className="mt-1 space-y-0.5">{categories.map(c => <ColorLine key={c.key} kind="category" label={c.label} detail={c.hint} value={colors.categories[c.key] ?? null} open={open === `c:${c.key}`} onOpen={() => toggle(`c:${c.key}`)} onChange={v => void setColor('category', c.key, v)} />)}</ul>
    </section>}
    {accounts.length > 0 && <section aria-label="Account colors">
      <p className={heading}>Accounts · {accounts.length}</p>
      <ul className="mt-1 space-y-0.5">{accounts.map(a => <ColorLine key={a.id} kind="account" label={a.label} detail={a.detail} value={colors.accounts[a.id.toLowerCase()] ?? null} open={open === `a:${a.id}`} onOpen={() => toggle(`a:${a.id}`)} onChange={v => void setColor('account', a.id, v)} />)}</ul>
    </section>}
  </div>
}

/** A financial account card with its permanent account stripe and the optional (device-local) card tint. Archived cards never tint. */
export function AccountColorCard({ accountId, className = '', archived = false, children }: { accountId: string; className?: string; archived?: boolean; children: React.ReactNode }) {
  const { accountColor, tint } = useDisplayColors()
  const stripe = accountStripe(accountColor(accountId), tint.accounts && !archived)
  const t = tintStyle(stripe)
  return <div className={`relative ${className}`} style={t} data-testid="account-card" data-account-id={accountId} data-tint={t ? 'on' : 'off'}>
    <StripeBar stripe={stripe} shape="card" />{children}
  </div>
}
