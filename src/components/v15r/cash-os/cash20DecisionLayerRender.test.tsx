// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import CashOsDecisionLayer from './CashOsDecisionLayer'
import { buildCashOsSnapshot } from '@/finance/cashOsSnapshot'
import type { BackupData } from '@/services/backupDataService'

const ORG = 'org-1'
const account = (id: string, over: Record<string, unknown> = {}) => ({ id, organization_id: ORG, display_name: id,
  account_type: 'checking', account_class: 'asset', ownership_context: 'business', include_in_cash: true, currency: 'USD',
  status: 'active', source_type: 'manual', source_metadata: {}, created_at: '', updated_at: '', archived_at: null, ...over })
const tx = (id: string, accountId: string, amount: number) => ({ id, organization_id: ORG, account_id: accountId,
  amount_minor: amount, currency: 'USD', transaction_date: '2026-10-05', effective_at: null, posted_at: null, status: 'posted',
  transaction_kind: 'opening_balance', economic_effect: 'none', economic_amount_minor: 0, description: id, counterparty: null,
  category: null, project_id: null, employee_id: null, debt_account_id: null, source_type: 'opening_balance',
  source_organization_id: null, source_kind: null, source_record_id: null, source_effective_date: null, source_timestamp: null,
  source_metadata: {}, idempotency_key: id, created_at: '', updated_at: '', voided_at: null, voided_by: null, void_reason: null })

function snapshot() {
  return buildCashOsSnapshot({ organizationId: ORG, asOfDate: '2026-10-05', asOfTimestamp: '2026-10-05T20:00:00Z',
    accounts: [account('bank'), account('care', { display_name: 'CareCredit', account_class: 'liability', account_type: 'credit_card', include_in_cash: false })] as any,
    transactions: [tx('o1', 'bank', 15000), tx('o2', 'care', 341905)] as any,
    obligations: [], occurrences: [], commitments: [], timeEntries: [], sessions: [], bridges: [], employees: [],
    liabilityTerms: [{ id: 't', organization_id: ORG, account_id: 'care', debt_structure: 'revolving', apr_basis_points: 3299,
      promo_apr_basis_points: 0, promo_type: 'deferred_interest', promo_started_on: null, promo_expires_on: '2026-12-22',
      minimum_payment_minor: 11300, payment_due_day: null, next_due_date: null, scheduled_payment_minor: null,
      original_principal_minor: null, maturity_date: null, owner_notes: null, created_at: '', updated_at: '' }] as any,
    backup: { settings: {}, employees: [], logs: [{ id: 'l', projId: 'dw', date: '2026-09-01', collected: 2050 }],
      projects: [{ id: 'dw', name: 'Desert Willow', type: 'project', status: 'active', contract: 3000, billed: 0, paid: 0, phase_timeline: [] },
        { id: 'ss', name: 'Surgery Center', type: 'project', status: 'active', contract: 0, billed: 0, paid: 0, phase_timeline: [] }] } as unknown as BackupData,
    setup: { version: 1, organizationId: ORG, payrollPaidThroughDate: '2026-10-04', protectionHorizonDays: 14, operatingFloorMinor: 5000,
      taxReserve: { kind: 'disabled' }, includeOptionalObligations: false, includeOpenShiftEstimates: false, timezoneConfirmed: true,
      confirmedAt: '2026-10-05T20:00:00Z' }, horizonDays: 30, confidenceMode: 'conservative' })
}

describe('owner decision layer (rendered)', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  })
  afterEach(async () => { await act(async () => { root.unmount() }); host.remove() })

  it('answers the owner questions compactly, with future money kept apart from cash', async () => {
    await act(async () => { root.render(<CashOsDecisionLayer snapshot={snapshot()} />) })
    const text = host.textContent ?? ''
    // The four cash-status numbers belong to Outlook's single status row, not this layer.
    expect(text).not.toContain('Where you stand today')
    expect(text).not.toContain('Cash you have')
    for (const title of ['Today', 'Needs attention', 'Money', 'Next']) expect(host.querySelector(`section[aria-label="${title}"]`), title).not.toBeNull()
    expect(text).toContain('None of this is in your cash total')
    const rows = [...host.querySelectorAll('[data-testid="money-row"]')]
    const dw = rows.find(r => r.textContent?.includes('Desert Willow'))!
    expect(dw.querySelector('[data-money-state="unlockable"]')).not.toBeNull()
    expect(dw.textContent).toContain('$950.00')
    expect(rows.find(r => r.textContent?.includes('Surgery Center'))?.querySelector('[data-money-state="not_counted"]')).not.toBeNull()
    expect(text).toContain('CareCredit: promotional deadline 2026-12-22')
    // The old always-expanded walls are gone.
    for (const old of ['Watch out for', 'What you could do next', "Money that isn't cash yet", 'Next 7 days']) expect(text).not.toContain(old)
    // The system's internal vocabulary does not leak into the owner layer.
    for (const jargon of ['Collection Clock', 'funding gap', 'Required before', 'bucket', 'envelope', 'cash commitment']) {
      expect(text.toLowerCase()).not.toContain(jargon.toLowerCase())
    }
  })

  it('every action shows a reason when opened and flags what it cannot know', async () => {
    await act(async () => { root.render(<CashOsDecisionLayer snapshot={snapshot()} />) })
    const more = [...host.querySelectorAll('[data-testid="command-next"] button')].find(b => /^Show d+ more$/.test(b.textContent ?? ''))
    if (more) await act(async () => { (more as HTMLElement).click() })
    const rows = [...host.querySelectorAll('[data-testid="next-row"]')]
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) await act(async () => { (row.querySelector('button[aria-expanded]') as HTMLElement).click() })
    for (const el of host.querySelectorAll('[data-testid="next-row"]')) {
      expect(el.querySelectorAll('li').length).toBeGreaterThan(0)
      expect(el.getAttribute('data-row-id')).toMatch(/^next:/)
    }
    expect([...host.querySelectorAll('[data-testid="next-row"]')].some(el => (el.textContent ?? '').includes('Not known yet'))).toBe(true)
    expect(host.querySelector('[data-testid="decision-data-gaps"]')?.textContent).toContain('Past-due and catch-up amounts are not stored')
  })

  it('withholds cash numbers when Cash OS withholds them, instead of hiding the diagnostic', async () => {
    await act(async () => { root.render(<CashOsDecisionLayer snapshot={snapshot()} partial />) })
    const text = host.textContent ?? ''
    expect(text).toContain('Cash totals are being held back')
    expect(text).not.toContain('$150.00')
  })

  it('shows a calm message instead of crashing when there is no snapshot', async () => {
    await act(async () => { root.render(<CashOsDecisionLayer snapshot={null} />) })
    expect(host.textContent).toContain('No cash summary is available yet')
  })
})
