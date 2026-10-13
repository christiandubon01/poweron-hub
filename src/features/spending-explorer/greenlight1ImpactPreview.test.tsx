// @vitest-environment happy-dom
/**
 * GREENLIGHT-1 Stage 1: the owner's read-only impact preview on screen (for an iPad, which has no developer console).
 * Pins: nothing is requested until the owner taps; exactly one GET to the existing endpoint, never a write; every status flag and count is shown;
 * classification moves are grouped with counts; no id, description, account or token reaches the screen; dollars stay hidden until revealed;
 * refusal / failure / incomplete / unavailable / not-conserved states are explicit. The server's own rules are tested in plaid3a / plaid5.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'

vi.mock('@/services/authedFetch', () => ({ authedJsonHeaders: async () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer SECRET-TOKEN-xyz' }) }))
import ImpactPreview, { groupChanges } from './ImpactPreview'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 5)) }) }
const TX = '00000000-0000-4000-8000-000000000123', CP = '00000000-0000-4000-8000-000000000456'
const shape = (activity: string, relationship = 'none', bucket = 'none') => ({ activity, relationship, bucket })
const change = (dollars: number, off: any, on: any) => ({ id: TX, date: '2026-10-01', name: 'ONLINE TRANSFER TO SAVINGS 6960', amountMinor: Math.round(dollars * 100), account: 'WF Business Checking ••••6960', off, on })
const payload = (over: Record<string, unknown> = {}) => ({
  available: true, switch: 'off', complete: true, reason: null, window: { from: '2026-07-15', to: '2026-10-12' },
  summary: { rows: 412, changed: 3, totalOutMinor: 9_000_00, totalInMinor: 8_000_00, conserved: true },
  lines: [{ activity: 'income', label: 'Money in', offCount: 40, onCount: 38, offOutMinor: 0, onOutMinor: 0, offInMinor: 1, onInMinor: 1, deltaOutMinor: 0, deltaInMinor: -1_500_00 },
    { activity: 'unresolved', label: 'Unresolved', offCount: 10, onCount: 13, offOutMinor: 0, onOutMinor: 0, offInMinor: 0, onInMinor: 0, deltaOutMinor: 500_00, deltaInMinor: 1_500_00 }],
  changes: [
    change(1000, shape('income'), shape('unresolved', `transfer/suggested/high->${CP}`, 'transfers/suggested/possible')),
    change(500, shape('income'), shape('unresolved', `transfer/suggested/high->${CP}`, 'transfers/suggested/possible')),
    change(-500, shape('business'), shape('unresolved', 'transfer/suggested/low', 'none')),
  ],
  changesTruncated: false, ...over,
})

describe('GREENLIGHT-1 impact preview (read-only)', () => {
  let host: HTMLDivElement, root: Root, fetchMock: ReturnType<typeof vi.fn>
  const mount = async (status: number, body: unknown) => {
    fetchMock = vi.fn(async () => ({ ok: status < 400, status, json: async () => body }))
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => { root.render(<ImpactPreview />) }); await flush()
  }
  const q = (s: string) => host.querySelector(s) as HTMLElement | null
  const click = async (el: Element | null) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click() }); await flush() }
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

  it('requests nothing until tapped, then makes exactly ONE GET to the existing impact endpoint and never a write', async () => {
    await mount(200, payload())
    expect(fetchMock).not.toHaveBeenCalled()
    expect(q('[data-testid="impact-preview"]')!.textContent).toContain('Read-only')
    await click(q('[data-testid="impact-run"]'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/.netlify/functions/plaid-spending?impact=1'); expect(init.method).toBe('GET'); expect(init.body).toBeUndefined()
  })

  it('shows every status flag and count, groups the moves with counts, and keeps dollars hidden until revealed', async () => {
    await mount(200, payload())
    await click(q('[data-testid="impact-run"]'))
    const t = (id: string) => q(`[data-testid="impact-${id}"]`)!.textContent
    expect(t('available')).toContain('Yes'); expect(t('complete')).toContain('Yes'); expect(t('conserved')).toContain('Yes'); expect(t('switch')).toContain('Off')
    expect(t('rows')).toContain('412'); expect(t('changed')).toContain('3'); expect(t('truncated')).toContain('No')
    const groups = [...host.querySelectorAll('[data-testid="impact-group"]')].map(g => g.textContent)
    expect(groups).toHaveLength(2)
    expect(groups[0]).toContain('Money in → Unresolved'); expect(groups[0]).toContain('Proposed matched pair'); expect(groups[0]).toMatch(/2$/)
    expect(groups[1]).toContain('Business spending → Unresolved'); expect(groups[1]).toContain('no match proposed')
    expect(host.textContent).not.toContain('$')                                                         // no dollar figure until the owner asks
    await click(q('[data-testid="impact-dollars"]'))
    expect(q('[data-testid="impact-groups"]')!.textContent).toContain('$1,500.00')
  })

  it('never puts an id, a description, an account or the token on screen', async () => {
    await mount(200, payload())
    await click(q('[data-testid="impact-run"]')); await click(q('[data-testid="impact-dollars"]'))
    const text = host.innerHTML
    for (const secret of [TX, CP, 'ONLINE TRANSFER TO SAVINGS', '6960', 'WF Business Checking', 'SECRET-TOKEN', 'Bearer']) expect(text, secret).not.toContain(secret)
  })

  it('refusal (403), failure (500) and network errors are explicit and say nothing changed', async () => {
    await mount(403, { error: 'Only owners and admins can review spending.' })
    await click(q('[data-testid="impact-run"]'))
    expect(q('[data-testid="impact-error"]')!.textContent).toContain('Only the owner or an admin')
    act(() => root.unmount()); root = createRoot(host)
    await mount(500, {})
    await click(q('[data-testid="impact-run"]'))
    expect(q('[data-testid="impact-error"]')!.textContent).toContain('Nothing was changed')
    act(() => root.unmount()); root = createRoot(host)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await act(async () => { root.render(<ImpactPreview />) }); await click(q('[data-testid="impact-run"]'))
    expect(q('[data-testid="impact-error"]')!.textContent).toContain('could not be loaded')
  })

  it('unavailable and incomplete previews show the reason and no groups; not conserved and truncated are flagged', async () => {
    await mount(200, payload({ available: false, complete: false, summary: null, lines: [], changes: [], reason: 'The complete reporting source is not installed, so a full comparison is not possible.' }))
    await click(q('[data-testid="impact-run"]'))
    expect(q('[data-testid="impact-available"]')!.textContent).toContain('No')
    expect(q('[data-testid="impact-incomplete"]')!.textContent).toContain('reporting source is not installed')
    expect(q('[data-testid="impact-groups"]')).toBeNull()
    act(() => root.unmount()); root = createRoot(host)
    await mount(200, payload({ complete: false, summary: null, changes: [], reason: 'Evidence coverage was not verified.' }))
    await click(q('[data-testid="impact-run"]'))
    expect(q('[data-testid="impact-incomplete"]')!.textContent).toContain('Evidence coverage was not verified')
    act(() => root.unmount()); root = createRoot(host)
    await mount(200, payload({ summary: { rows: 5, changed: 250, totalOutMinor: 1, totalInMinor: 1, conserved: false }, changesTruncated: true }))
    await click(q('[data-testid="impact-run"]'))
    expect(q('[data-testid="impact-not-conserved"]')).toBeTruthy()
    expect(q('[data-testid="impact-truncated"]')!.textContent).toContain('Yes'); expect(q('[data-testid="impact-truncated-note"]')).toBeTruthy()
  })

  it('grouping is by before -> after and reason only', () => {
    expect(groupChanges(payload().changes as any).map(g => [g.from, g.to, g.count])).toEqual([['Money in', 'Unresolved', 2], ['Business spending', 'Unresolved', 1]])
  })

  it('static: the component only reads (no POST/PUT/DELETE, no other endpoint, no storage access)', () => {
    const src = readFileSync('src/features/spending-explorer/ImpactPreview.tsx', 'utf8')
    expect(src).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'|localStorage|sessionStorage|access_token|console\./)
    expect(src.match(/\/\.netlify\/functions\/[\w-]+(\?[\w=&]+)?/g)).toEqual(['/.netlify/functions/plaid-spending?impact=1'])
  })
})
