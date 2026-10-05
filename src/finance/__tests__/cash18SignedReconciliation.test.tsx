// @vitest-environment happy-dom
// Regression: an overdrawn ASSET account must reconcile to a NEGATIVE canonical balance.
// Production case: Wells Fargo Personal Checking 3809, canonical $0.00, bank shows -$103.00.
// The Add sheet used to strip the minus sign (parseFloat of the digits only) and display +$103.00.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import CashOsAddSheet from '@/components/v15r/cash-os/CashOsAddSheet'
import {
  parseSignedDollarsToMinor, resolveReconciliationEntry,
} from '@/finance/balanceReconciliation'
import { accountBalanceMinor } from '@/finance/ledgerCalculations'
import { recordBalanceReconciliation, computeReconciliationDeltaMinor } from '@/services/manualLedgerService'

const inserted = vi.hoisted(() => ({ rows: [] as any[] }))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    rpc: async () => ({ data: 'org-1', error: null }),
    from: () => ({
      insert: (row: any) => ({
        select: () => ({
          single: async () => { inserted.rows.push(row); return { data: { id: 'new', ...row }, error: null } },
        }),
      }),
    }),
  },
}))

const asset = { id: 'bank', display_name: 'Wells Fargo Personal Checking 3809', status: 'active',
  account_class: 'asset', account_type: 'checking', ownership_context: 'personal', include_in_cash: true }
const card = { id: 'card', display_name: 'Wells Fargo Personal Credit Card', status: 'active',
  account_class: 'liability', account_type: 'credit_card', ownership_context: 'personal', include_in_cash: false }

function sourcesWith(accountId: string, balanceMinor: number) {
  return {
    accounts: [asset, card],
    transactions: [{ id: 'seed', account_id: accountId, status: 'posted', transaction_date: '2026-01-01',
      amount_minor: balanceMinor, transaction_kind: 'opening_balance' }],
  } as any
}

describe('signed reconciliation entry (pure)', () => {
  it('parses signed owner input without stripping the minus sign', () => {
    expect(parseSignedDollarsToMinor('-103')).toBe(-10300)
    expect(parseSignedDollarsToMinor('-$103.00')).toBe(-10300)
    expect(parseSignedDollarsToMinor('$-103')).toBe(-10300)
    expect(parseSignedDollarsToMinor('−103')).toBe(-10300)
    expect(parseSignedDollarsToMinor('(103.00)')).toBe(-10300)
    expect(parseSignedDollarsToMinor('53')).toBe(5300)
    expect(parseSignedDollarsToMinor('$1,234.56')).toBe(123456)
    expect(parseSignedDollarsToMinor('0')).toBe(0)
    expect(parseSignedDollarsToMinor('-0')).toBe(0)
  })
  it('rejects text that is not a plain amount instead of silently stripping it', () => {
    for (const bad of ['', '-', 'abc', '12abc', '--5', '(-5)', '1.2.3', '5-']) {
      expect(parseSignedDollarsToMinor(bad)).toBeNull()
    }
  })
  it.each([
    ['asset 0 -> 53', 'asset', '53', 0, 5300, 5300],
    ['asset 1 -> 53', 'asset', '53', 100, 5300, 5200],
    ['asset 0 -> -103', 'asset', '-103', 0, -10300, -10300],
    ['asset 50 -> -25', 'asset', '-25', 5000, -2500, -7500],
    ['asset -100 -> -25', 'asset', '-25', -10000, -2500, 7500],
    ['liability owed 4877 from 0', 'liability', '4877', 0, 487700, 487700],
  ] as const)('%s', (_label, cls, raw, current, target, delta) => {
    const entry = resolveReconciliationEntry({ accountClass: cls, rawAmount: raw, currentCanonicalMinor: current })
    expect(entry).toEqual({ ok: true, targetMinor: target, deltaMinor: delta })
  })
  it('refuses a negative amount owed for a liability instead of flipping it', () => {
    expect(resolveReconciliationEntry({ accountClass: 'liability', rawAmount: '-4877', currentCanonicalMinor: 0 }))
      .toEqual({ ok: false, reason: 'negative_liability' })
  })
})

describe('persisted ledger adjustment (real service, fake Supabase)', () => {
  beforeEach(() => { inserted.rows = [] })

  it('writes a NEGATIVE balance_reconciliation row for 0 -> -103 and canonical balance lands on -103', async () => {
    await recordBalanceReconciliation({
      accountId: 'bank', targetOwnerMinor: -10300, currentCanonicalMinor: 0,
      asOfDate: '2026-10-05', idempotencyKey: 'k1',
    })
    expect(inserted.rows).toHaveLength(1)
    const row = inserted.rows[0]
    expect(row.amount_minor).toBe(-10300)
    expect(row.transaction_kind).toBe('balance_reconciliation')
    expect(row.economic_effect).toBe('none')
    expect(row.economic_amount_minor).toBe(0)
    const ledger = [{ account_id: 'bank', status: 'posted', transaction_date: '2026-10-05', amount_minor: row.amount_minor }] as any
    expect(accountBalanceMinor('bank', ledger)).toBe(-10300)
  })

  it.each([
    [0, 5300, 5300], [100, 5300, 5200], [5000, -2500, -7500], [-10000, -2500, 7500],
  ])('current %i -> target %i writes %i and lands on the target', async (current, target, delta) => {
    await recordBalanceReconciliation({
      accountId: 'bank', targetOwnerMinor: target, currentCanonicalMinor: current,
      asOfDate: '2026-10-05', idempotencyKey: 'k',
    })
    expect(inserted.rows[0].amount_minor).toBe(delta)
    expect(current + inserted.rows[0].amount_minor).toBe(target)
  })

  it('writes nothing when already reconciled and keeps the liability amount-owed delta', async () => {
    expect(await recordBalanceReconciliation({
      accountId: 'bank', targetOwnerMinor: 5300, currentCanonicalMinor: 5300,
      asOfDate: '2026-10-05', idempotencyKey: 'k',
    })).toBeNull()
    expect(inserted.rows).toHaveLength(0)
    expect(computeReconciliationDeltaMinor(487700, 0)).toBe(487700)
  })
})

describe('Opening Balance / Reconcile sheet (rendered)', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  })
  afterEach(async () => { await act(async () => { root.unmount() }); host.remove() })

  async function openReconcile(sources: any) {
    await act(async () => {
      root.render(<CashOsAddSheet organizationId="org-1" sources={sources} onClose={() => {}} onSuccess={() => {}} />)
    })
    const tab = [...host.querySelectorAll('nav button')].find(b => b.textContent?.includes('Reconcile')) as HTMLButtonElement
    await act(async () => { tab.click() })
  }
  async function pickAccount(id: string) {
    const select = host.querySelector('select') as HTMLSelectElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, id)
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }
  async function type(value: string) {
    const input = host.querySelector('input[type="text"]') as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const adjustment = () => {
    const label = [...host.querySelectorAll('span')].find(s => s.textContent === 'Adjustment to record')
    return label?.parentElement?.querySelector('p')?.textContent ?? null
  }

  it.each([
    ['asset 0 -> 53', 0, '53', '+$53.00'],
    ['asset 1 -> 53', 100, '53', '+$52.00'],
    ['asset 0 -> -103 (the production case)', 0, '-103', '-$103.00'],
    ['asset 50 -> -25', 5000, '-25', '-$75.00'],
    ['asset -100 -> -25', -10000, '-25', '+$75.00'],
  ])('%s displays %s', async (_label, current, typed, expected) => {
    await openReconcile(sourcesWith('bank', current))
    await type(typed)
    expect(adjustment()).toBe(expected)
  })

  it('keeps liability as a positive amount owed', async () => {
    await openReconcile(sourcesWith('card', 0))
    await pickAccount('card')
    await type('4877')
    expect(adjustment()).toBe('+$4,877.00')
    expect(host.textContent).toContain('Enter the positive amount you currently owe.')
  })

  it('does not silently flip a negative liability entry', async () => {
    await openReconcile(sourcesWith('card', 0))
    await pickAccount('card')
    await type('-4877')
    expect(adjustment()).toBeNull()
    expect(host.textContent).toContain('Enter the amount owed as a positive number.')
    expect((host.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true)
  })

  it('tells the owner that an overdrawn asset takes a minus sign, not a positive number', async () => {
    await openReconcile(sourcesWith('bank', 0))
    expect(host.textContent).toContain('Use a minus sign if the account is overdrawn')
    expect(host.textContent).not.toContain('as a positive number')
  })
})
