/**
 * src/features/display-colors/DisplayColors.tsx
 *
 * BANK-6D: the shared color context and the small building blocks every surface uses (stripe, account dot, swatch picker, colors panel).
 * Reusable on purpose: the Bank Connection panel and Spending Explorer redesigns can mount the same provider and blocks. Visual only.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { SWATCHES, swatchName } from './palette'
import { createDeviceColorStore, createSharedColorStore, EMPTY_COLORS, loadTint, planImport, saveTint, type ColorMaps, type ColorStorage, type ColorTarget, type DisplayColorStore, type ImportEntry, type TintPrefs } from './colorStore'
import { accountStripe, stripeStyle, tintStyle, type Stripe } from './stripes'

export interface ColorAccount { id: string; label: string }
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
  setTint: (patch: Partial<TintPrefs>) => void
  importDeviceColors: (replaceConflicts: boolean) => Promise<void>
}
const OFF: Ctx = {
  enabled: false, colors: EMPTY_COLORS, storage: null, tint: { rows: false, accounts: false }, accounts: [], error: null, importPlan: null, importNote: null,
  categoryColor: () => null, accountColor: () => null, setColor: async () => {}, setTint: () => {}, importDeviceColors: async () => {},
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
    categoryColor: (key: string) => colors.categories[key] ?? null,
    accountColor: (id: string | null | undefined) => (id ? colors.accounts[id.toLowerCase()] ?? null : null),
    setColor, setTint, importDeviceColors,
  }), [active, colors, storage, tint, accounts, error, importPlan, importNote, setColor, setTint, importDeviceColors])
  return <ColorCtx.Provider value={value}>{children}</ColorCtx.Provider>
}

/** The thin left stripe. The parent must be `relative`. Decorative: the entry's text already says what it is. */
export function StripeBar({ stripe }: { stripe: Stripe }) {
  const style = stripeStyle(stripe)
  return <span aria-hidden="true" data-testid="color-stripe" data-stripe={stripe.kind} data-color={stripe.color ?? ''}
    className="pointer-events-none absolute bottom-1 left-0 top-1 w-1 rounded-full" style={style ?? { display: 'none' }} />
}
export { tintStyle }

/** A small account-colored square shown next to the account NAME (the name text is always there). */
export function AccountColorDot({ accountId }: { accountId: string | null | undefined }) {
  const { accountColor } = useDisplayColors()
  const c = accountColor(accountId)
  if (!c) return null
  return <span aria-hidden="true" data-testid="account-color-dot" data-color={c} className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: c }} />
}

export function ColorSwatchPicker({ label, value, onChange, disabled }: { label: string; value: string | null; onChange: (c: string | null) => void; disabled?: boolean }) {
  const item = 'flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg ring-1 ring-[var(--border-primary)] disabled:opacity-50'
  return <div role="radiogroup" aria-label={`Color for ${label}`} className="flex flex-wrap gap-1.5" data-testid="color-picker">
    <button type="button" role="radio" aria-checked={value === null} aria-label="No color" title="No color" disabled={disabled} onClick={() => onChange(null)}
      className={`${item} px-2 text-xs ${value === null ? 'ring-2 ring-[var(--text-primary)]' : ''}`}>None</button>
    {SWATCHES.map(s => <button key={s.id} type="button" role="radio" aria-checked={value === s.hex} aria-label={s.name} title={s.name} disabled={disabled} onClick={() => onChange(s.hex)}
      className={`${item} ${value === s.hex ? 'ring-2 ring-[var(--text-primary)]' : ''}`} data-swatch={s.id}>
      <span aria-hidden="true" className="h-6 w-6 rounded-full" style={{ background: s.hex }} />
    </button>)}
  </div>
}

function ColorLine({ label, value, onChange, open, onOpen }: { label: string; value: string | null; onChange: (c: string | null) => void; open: boolean; onOpen: () => void }) {
  return <li className="py-1.5" data-testid="color-line">
    <button type="button" className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left text-sm" aria-expanded={open} onClick={onOpen}>
      <span className="min-w-0 truncate">{label}</span>
      <span className="flex shrink-0 items-center gap-2 text-xs text-[var(--text-secondary)]">
        {value ? <span aria-hidden="true" className="h-4 w-4 rounded-full" style={{ background: value }} /> : null}{swatchName(value) ?? 'No color'}
      </span>
    </button>
    {open && <div className="mt-1"><ColorSwatchPicker label={label} value={value} onChange={c => { onChange(c) }} /></div>}
  </li>
}

function Toggle({ label, on, onChange, testId }: { label: string; on: boolean; onChange: (v: boolean) => void; testId: string }) {
  return <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} data-testid={testId}
    className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-lg px-1 text-left text-sm">
    <span>{label}</span>
    <span aria-hidden="true" className={`inline-flex h-6 w-10 items-center rounded-full p-0.5 ring-1 ring-[var(--border-primary)] ${on ? 'justify-end bg-white/15' : 'justify-start'}`}><span className="h-5 w-5 rounded-full bg-[var(--text-secondary)]" /></span>
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
  const btn = 'min-h-[44px] rounded-lg px-3 text-sm font-semibold ring-1 ring-[var(--border-primary)] hover:bg-white/5 disabled:opacity-50'
  const nameOf = (hex: string | null) => swatchName(hex) ?? 'No color'
  return <section className="space-y-2 rounded-lg border border-[var(--border-primary)] p-3" aria-label="Colors saved on this device" data-testid="import-device-colors">
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
            <input type="checkbox" className="h-5 w-5" checked={replace} onChange={e => setReplace(e.target.checked)} data-testid="import-replace" />
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

export function ColorsPanel({ categories }: { categories: Array<{ key: string; label: string }> }) {
  const { enabled, colors, accounts, tint, setTint, setColor, storage, error } = useDisplayColors()
  const [open, setOpen] = useState<string | null>(null)
  if (!enabled) return null
  const labelOf = (kind: 'category' | 'account', key: string) => (kind === 'category' ? categories.find(c => c.key === key)?.label : accounts.find(a => a.id.toLowerCase() === key)?.label) ?? key
  const toggle = (id: string) => setOpen(o => (o === id ? null : id))
  return <div className="mt-2 space-y-3 rounded-xl border border-[var(--border-primary)] p-3" data-testid="colors-panel">
    <p className="text-xs text-[var(--text-secondary)]">Colors only help you recognise things at a glance. They never mean approved or reviewed, and they change nothing in your records.
      {storage === 'device' ? ' Colors are saved on this device for now.' : storage === 'shared' ? ' Colors are shared with your organization.' : ''}</p>
    {error && <p role="alert" className="text-xs" style={{ color: 'var(--fin-negative)' }}>{error}</p>}
    <ImportDeviceColors labelOf={labelOf} />
    <div>
      <Toggle label="Tint confirmed transactions" on={tint.rows} onChange={v => setTint({ rows: v })} testId="tint-rows" />
      <Toggle label="Tint account cards" on={tint.accounts} onChange={v => setTint({ accounts: v })} testId="tint-accounts" />
      <p className="text-xs text-[var(--text-secondary)]">The thin stripe always shows. Tint applies only to confirmed categories, never to suggestions. Tint settings stay on this device.</p>
    </div>
    <section aria-label="Expense category colors">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Expense categories</p>
      <ul className="divide-y divide-[var(--border-primary)]">{categories.map(c => <ColorLine key={c.key} label={c.label} value={colors.categories[c.key] ?? null} open={open === `c:${c.key}`} onOpen={() => toggle(`c:${c.key}`)} onChange={v => void setColor('category', c.key, v)} />)}</ul>
    </section>
    {accounts.length > 0 && <section aria-label="Account colors">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Accounts</p>
      <ul className="divide-y divide-[var(--border-primary)]">{accounts.map(a => <ColorLine key={a.id} label={a.label} value={colors.accounts[a.id.toLowerCase()] ?? null} open={open === `a:${a.id}`} onOpen={() => toggle(`a:${a.id}`)} onChange={v => void setColor('account', a.id, v)} />)}</ul>
    </section>}
  </div>
}

/** A financial account card with its permanent account stripe and the optional (device-local) card tint. Archived cards never tint. */
export function AccountColorCard({ accountId, className = '', archived = false, children }: { accountId: string; className?: string; archived?: boolean; children: React.ReactNode }) {
  const { accountColor, tint } = useDisplayColors()
  const stripe = accountStripe(accountColor(accountId), tint.accounts && !archived)
  const t = tintStyle(stripe)
  return <div className={`relative ${className}`} style={t} data-testid="account-card" data-account-id={accountId} data-tint={t ? 'on' : 'off'}>
    <StripeBar stripe={stripe} />{children}
  </div>
}
