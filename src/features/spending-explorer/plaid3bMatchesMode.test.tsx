// @vitest-environment happy-dom
/**
 * PLAID-3B: the Matches mode inside the Spending Explorer. It exists ONLY while the server's reconciliation switch is on (the explorer payload carries
 * `matches` only then), so with the switch off the screen is exactly what it was. These tests mount the real SpendingExplorer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import SpendingExplorer from './SpendingExplorer'
import { DisplayColorsProvider } from '@/features/display-colors/DisplayColors'
import { categoryOptions, defaultHierarchy } from '@/finance/bankSpendingHierarchy'
import type { Options } from './useSpendingExplorer'

vi.mock('@/services/authedFetch', () => ({ authedJsonHeaders: async () => ({}) }))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const h = { ...defaultHierarchy(), available: true, writesEnabled: false }
const account = { ref: 'a', label: 'Business checking', mask: '0000', ownership: 'business' as const, mapped: true, mappedTo: 'Business Checking', environment: 'production' as const, financialAccountId: null }
const row = { id: 'tx1', date: '2026-10-09', name: 'Adobe', merchant: 'Adobe', merchantKey: 'adobe', amountMinor: 4000, direction: 'money_out', pending: false, account, bucket: { key: 'software_subscriptions', label: 'Software', state: 'suggested', confidence: 'high', reasons: [] },
  relationship: { kind: 'unknown', label: 'Unknown', state: 'none', target: null, confidence: null, reasons: [] }, review: 'suggested', scope: { value: 'business', source: 'account' }, unassigned: true, repeatedPattern: false, pattern: null }
const options: Options = { buckets: categoryOptions(h), batchBuckets: [], accounts: [{ ref: 'a', label: 'Business checking', mask: '0000' }], projects: [], obligations: [], commitments: [], debts: [] }
const explorer = (extra: Record<string, unknown> = {}) => ({ asOf: '2026-10-09', environment: 'production', accounts: 'mapped', hierarchy: h, coverage: { complete: true, reason: null }, draftScope: 'scope', total: 1, rows: [row], options,
  meta: { hiddenUnmapped: 0, olderThanPeriod: 0, billCandidates: 0, activeObligations: 0, scheduledCommitments: 0, evidenceRows: 1, periodFrom: '2026-07-12' },
  viewCounts: { all: 1, reviewed: 0, review_queue: 1, known_bills: 0, unassigned: 1, repeated_spending: 0, needs_review: 0 },
  analytics: { asOf: '2026-10-09', windowDays: 30, unassigned: { totalMinor: 4000, count: 1, previousMinor: 0, deltaMinor: 0, byBucket: [] }, knownBills: { totalMinor: 0, count: 0 }, pending: { totalMinor: 0, count: 0 }, unclassified: { totalMinor: 0, count: 0 }, observations: [], suggestions: [] }, ...extra })
const matches = { enabled: true, decisionsAvailable: true, tab: 'review', counts: { suggested: 0, waiting: 0, ambiguous: 0, confirmed: 0, rejected: 0, reversed: 0, evidence_changed: 0, needsReview: 0, refunds: 0 }, total: 0, items: [], groups: [], refunds: [], coverage: { complete: true, reason: null }, contract: 'A match is your statement that two bank movements are the same event.' }

let host: HTMLDivElement, root: Root, fetchMock: ReturnType<typeof vi.fn>
const flush = async () => act(async () => { await new Promise(r => setTimeout(r, 15)) })
const click = async (el: HTMLElement) => { await act(async () => el.click()); await flush() }
const q = (s: string) => host.querySelector<HTMLElement>(s)
async function mount(payload: unknown) {
  fetchMock = vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => (new URL(String(url), 'https://x.invalid').searchParams.has('matches') ? matches : payload) }))
  vi.stubGlobal('fetch', fetchMock)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<DisplayColorsProvider store={{ load: async () => ({ storage: 'shared', colors: { categories: {}, accounts: {} } }), set: async () => ({ storage: 'shared' as const }) }}><SpendingExplorer /></DisplayColorsProvider>)); await flush(); await flush()
}
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); vi.unstubAllGlobals() })

describe('Matches mode in the Spending Explorer (PLAID-3B)', () => {
  it('is NOT offered when the server payload carries no `matches` (switch off): the workflow control is exactly Explore + Smart Review and no matches request is ever made', async () => {
    await mount(explorer())
    expect(q('[data-testid="spending-mode-explorer"]')).toBeTruthy(); expect(q('[data-testid="spending-mode-smart"]')).toBeTruthy()
    expect(q('[data-testid="spending-mode-matches"]')).toBeNull()
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('matches'))).toBe(false)
  })

  it('is offered only when enabled; opening it shows the review, and the Explore controls disappear until the owner goes back', async () => {
    await mount(explorer({ matches: { enabled: true } }))
    const mode = q('[data-testid="spending-mode-matches"]')!
    expect(mode.textContent).toContain('Matches')
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('matches'))).toBe(false) // nothing is fetched until the owner opens it
    await click(mode)
    expect(q('[data-testid="match-review"]')).toBeTruthy(); expect(q('[data-testid="spending-list"]')).toBeNull(); expect(q('[data-testid="spending-scope-review"]')).toBeNull()
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('matches=1'))).toHaveLength(1)
    await click(q('[data-testid="spending-mode-explorer"]')!)
    expect(q('[data-testid="match-review"]')).toBeNull(); expect(q('[data-testid="spending-list"]')).toBeTruthy()
  })
})
