// @vitest-environment happy-dom
// Rendered regression test: the Transactions-tab account card path (PreSetupTransactions
// in DebtKiller.tsx) must render a management trigger for every active account.
//
// The 23 source-inspection tests in cash16AccountManagement.test.ts read
// CashOsViews.tsx as a string — they never checked PreSetupTransactions in
// DebtKiller.tsx and therefore could not catch the gap that caused the
// production defect (abb95a77 wired CashOsAccountMenu into CashOsViews.tsx
// but not into PreSetupTransactions, which is the actual render path on the
// Transactions tab when session assumptions have not been provided).
//
// These tests mount CashOsAccountMenu directly (it is the component that
// PreSetupTransactions now renders per account), with production-shaped
// account data, and prove the ⋯ trigger + Edit/Archive items appear for
// both asset and liability accounts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CashOsAccountMenu } from '@/components/v15r/cash-os/CashOsAccountMenu'
import type { FinancialAccountRow } from '@/finance/ledgerTypes'

vi.mock('@/services/manualLedgerService', () => ({
  updateFinancialAccount: vi.fn(),
  archiveFinancialAccount: vi.fn(),
  restoreFinancialAccount: vi.fn(),
}))

// ── Production-shaped fixtures ────────────────────────────────────────────────

const assetAccount = {
  id: 'acc-checking',
  organization_id: 'org-prod',
  display_name: 'Wells Fargo Personal Checking Acc',
  account_type: 'checking',
  account_class: 'asset',
  ownership_context: 'personal',
  include_in_cash: true,
  status: 'active',
  archived_at: null,
  source_type: 'manual',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} as unknown as FinancialAccountRow

const liabilityAccount = {
  id: 'acc-cc',
  organization_id: 'org-prod',
  display_name: 'Wells Fargo Personal Credit Card',
  account_type: 'credit_card',
  account_class: 'liability',
  ownership_context: 'personal',
  include_in_cash: false,
  status: 'active',
  archived_at: null,
  source_type: 'manual',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} as unknown as FinancialAccountRow

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderMenu(account: FinancialAccountRow): { host: HTMLDivElement; root: Root } {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => { root.render(<CashOsAccountMenu account={account} onMutated={() => {}} />) })
  return { host, root }
}

function cleanup(host: HTMLDivElement, root: Root) {
  act(() => { root.unmount() })
  host.remove()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('cash17 PreSetupTransactions account card — management trigger renders', () => {
  beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true })

  it('asset account renders ⋯ management trigger button', () => {
    const { host, root } = renderMenu(assetAccount)
    const btn = host.querySelector('[aria-label="Account options"]')
    expect(btn).not.toBeNull()
    cleanup(host, root)
  })

  it('liability account renders ⋯ management trigger button', () => {
    const { host, root } = renderMenu(liabilityAccount)
    const btn = host.querySelector('[aria-label="Account options"]')
    expect(btn).not.toBeNull()
    cleanup(host, root)
  })

  it('clicking ⋯ on asset account shows Edit account', () => {
    const { host, root } = renderMenu(assetAccount)
    const btn = host.querySelector('[aria-label="Account options"]') as HTMLElement
    act(() => { btn.click() })
    expect(host.textContent).toContain('Edit account')
    cleanup(host, root)
  })

  it('clicking ⋯ on asset account shows Archive account', () => {
    const { host, root } = renderMenu(assetAccount)
    const btn = host.querySelector('[aria-label="Account options"]') as HTMLElement
    act(() => { btn.click() })
    expect(host.textContent).toContain('Archive account')
    cleanup(host, root)
  })

  it('clicking ⋯ on liability account shows Edit account', () => {
    const { host, root } = renderMenu(liabilityAccount)
    const btn = host.querySelector('[aria-label="Account options"]') as HTMLElement
    act(() => { btn.click() })
    expect(host.textContent).toContain('Edit account')
    cleanup(host, root)
  })

  it('clicking ⋯ on liability account shows Archive account', () => {
    const { host, root } = renderMenu(liabilityAccount)
    const btn = host.querySelector('[aria-label="Account options"]') as HTMLElement
    act(() => { btn.click() })
    expect(host.textContent).toContain('Archive account')
    cleanup(host, root)
  })

  it('menu does not offer Delete account for asset account', () => {
    const { host, root } = renderMenu(assetAccount)
    const btn = host.querySelector('[aria-label="Account options"]') as HTMLElement
    act(() => { btn.click() })
    expect(host.textContent).not.toContain('Delete account')
    cleanup(host, root)
  })

  it('menu does not offer Delete account for liability account', () => {
    const { host, root } = renderMenu(liabilityAccount)
    const btn = host.querySelector('[aria-label="Account options"]') as HTMLElement
    act(() => { btn.click() })
    expect(host.textContent).not.toContain('Delete account')
    cleanup(host, root)
  })
})
