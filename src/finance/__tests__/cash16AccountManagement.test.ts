// Behavioral tests for financial account management (edit/archive/restore).
// Service mutations are verified via source inspection — no live Supabase needed.
// Architecture correctness (service wiring, UI filter, identity-immutability) is
// verified via source text, matching the pattern in cash9Reconciliation.test.ts.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const serviceSrc = readFileSync(
  resolve(__dirname, '../../services/manualLedgerService.ts'), 'utf8',
)
const menuSrc = readFileSync(
  resolve(__dirname, '../../components/v15r/cash-os/CashOsAccountMenu.tsx'), 'utf8',
)
const viewsSrc = readFileSync(
  resolve(__dirname, '../../components/v15r/cash-os/CashOsViews.tsx'), 'utf8',
)
const migrationSrc = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/139_cash_accounts_manual_ledger.sql'), 'utf8',
)

// ── Rename: preserves account identity ───────────────────────────────────────

describe('ACCT-MGMT rename preserves account identity', () => {
  it('updateFinancialAccount patches only mutable fields — not identity fields', () => {
    expect(serviceSrc).toContain('export async function updateFinancialAccount(')
    const start = serviceSrc.indexOf('export async function updateFinancialAccount(')
    const end = serviceSrc.indexOf('\nexport async function archiveFinancialAccount(')
    const body = serviceSrc.slice(start, end)
    // Mutable fields are patched
    expect(body).toContain('display_name')
    expect(body).toContain('ownership_context')
    expect(body).toContain('include_in_cash')
    // Identity fields must NOT appear as patch values
    expect(body).not.toContain('account_type:')
    expect(body).not.toContain('account_class:')
    expect(body).not.toContain('currency:')
    expect(body).not.toContain('organization_id:')
  })

  it('updateFinancialAccount is scoped to organization_id and status=active', () => {
    const start = serviceSrc.indexOf('export async function updateFinancialAccount(')
    const end = serviceSrc.indexOf('\nexport async function archiveFinancialAccount(')
    const body = serviceSrc.slice(start, end)
    expect(body).toContain(".eq('organization_id', ctx.organizationId)")
    expect(body).toContain(".eq('status', 'active')")
  })

  it('updateFinancialAccount rejects blank display_name before any DB call', () => {
    const start = serviceSrc.indexOf('export async function updateFinancialAccount(')
    const end = serviceSrc.indexOf('\nexport async function archiveFinancialAccount(')
    const body = serviceSrc.slice(start, end)
    expect(body).toContain('Account name cannot be blank')
  })

  it('DB identity trigger blocks account_type / account_class / currency from being changed', () => {
    expect(migrationSrc).toContain('enforce_financial_account_identity')
    expect(migrationSrc).toContain('account_type')
    expect(migrationSrc).toContain('account_class')
    expect(migrationSrc).toContain('currency')
  })
})

// ── Edit form: account_type and account_class are not editable ────────────────

describe('ACCT-MGMT edit form does not expose identity fields', () => {
  it('EditForm renders no input or control for account_type', () => {
    const start = menuSrc.indexOf('function EditForm(')
    const end = menuSrc.indexOf('\nfunction ArchiveConfirm(')
    const body = menuSrc.slice(start, end)
    expect(body).not.toContain('account_type')
  })

  it('EditForm renders no editable control for account_class (only reads it for include_in_cash gate)', () => {
    const start = menuSrc.indexOf('function EditForm(')
    const end = menuSrc.indexOf('\nfunction ArchiveConfirm(')
    const body = menuSrc.slice(start, end)
    expect(body).not.toContain('setAccountClass')
    expect(body).not.toContain("'account_class'")
  })

  it('include_in_cash edit is gated on account_class === asset', () => {
    expect(menuSrc).toContain("account.account_class === 'asset'")
  })

  it('edit form guard rejects blank name', () => {
    expect(menuSrc).toContain('Account name cannot be blank')
  })
})

// ── Archive: preserves ledger history ────────────────────────────────────────

describe('ACCT-MGMT archive preserves ledger history', () => {
  it('archiveFinancialAccount issues an UPDATE (not DELETE), preserving all FK-referenced rows', () => {
    expect(serviceSrc).toContain('export async function archiveFinancialAccount(')
    const start = serviceSrc.indexOf('export async function archiveFinancialAccount(')
    const end = serviceSrc.indexOf('\nexport async function restoreFinancialAccount(')
    const body = serviceSrc.slice(start, end)
    expect(body).toContain("status: 'archived'")
    expect(body).toContain('archived_at')
    expect(body).not.toContain('.delete(')
  })

  it('archiveFinancialAccount only archives currently-active rows', () => {
    const start = serviceSrc.indexOf('export async function archiveFinancialAccount(')
    const end = serviceSrc.indexOf('\nexport async function restoreFinancialAccount(')
    const body = serviceSrc.slice(start, end)
    expect(body).toContain(".eq('status', 'active')")
    expect(body).toContain(".eq('organization_id', ctx.organizationId)")
  })

  it('schema enforces archive_consistency: status=archived requires archived_at non-null', () => {
    expect(migrationSrc).toContain('archive_consistency')
    expect(migrationSrc).toContain('archived_at IS NOT NULL')
  })

  it('transaction FK uses ON DELETE RESTRICT — archive cannot orphan financial history', () => {
    expect(migrationSrc).toContain('ON DELETE RESTRICT')
  })
})

// ── Archive: excluded from active selectors ───────────────────────────────────

describe('ACCT-MGMT archived account excluded from active views', () => {
  it('CashTransactionsView filters accounts to status=active only', () => {
    expect(viewsSrc).toContain("filter(a => a.status === 'active')")
  })

  it('archived accounts appear in a separate archived section (not the active grid)', () => {
    expect(viewsSrc).toContain("status === 'archived'")
    expect(viewsSrc).toContain('CashOsAccountRestore')
  })
})

// ── Restore: account returns to active, history intact ────────────────────────

describe('ACCT-MGMT restore archived account', () => {
  it('restoreFinancialAccount sets status=active and clears archived_at', () => {
    expect(serviceSrc).toContain('export async function restoreFinancialAccount(')
    const start = serviceSrc.indexOf('export async function restoreFinancialAccount(')
    const end = serviceSrc.indexOf('\nexport async function voidStandaloneFinancialTransaction(')
    const body = serviceSrc.slice(start, end)
    expect(body).toContain("status: 'active'")
    expect(body).toContain('archived_at: null')
    expect(body).toContain(".eq('status', 'archived')")
    expect(body).toContain(".eq('organization_id', ctx.organizationId)")
  })

  it('restore does not touch financial_transactions — history remains intact', () => {
    const start = serviceSrc.indexOf('export async function restoreFinancialAccount(')
    const end = serviceSrc.indexOf('\nexport async function voidStandaloneFinancialTransaction(')
    const body = serviceSrc.slice(start, end)
    expect(body).not.toContain('financial_transactions')
  })
})

// ── No owner-facing permanent Delete action exists ────────────────────────────

describe('ACCT-MGMT no permanent Delete action', () => {
  it('menu renders Edit account and Archive account — no Delete option', () => {
    expect(menuSrc).toContain('Edit account')
    expect(menuSrc).toContain('Archive account')
    expect(menuSrc).not.toContain('Delete account')
    expect(menuSrc).not.toContain('deleteFinancialAccount')
  })

  it('no deleteFinancialAccount function exists in the service', () => {
    expect(serviceSrc).not.toContain('deleteFinancialAccount')
  })

  it('schema has no GRANT DELETE on financial_accounts', () => {
    expect(migrationSrc).not.toMatch(/GRANT\s+DELETE\s+ON\s+public\.financial_accounts/i)
  })

  it('schema has no DELETE RLS policy on financial_accounts', () => {
    expect(migrationSrc).not.toMatch(/FOR DELETE/)
  })
})

// ── UI wiring ─────────────────────────────────────────────────────────────────

describe('ACCT-MGMT UI wiring', () => {
  it('CashTransactionsView exposes onRefresh prop and calls it after mutations', () => {
    expect(viewsSrc).toContain('onRefresh')
    expect(viewsSrc).toContain('onRefresh?.()')
  })

  it('CashOsAccountMenu is rendered for each active account card', () => {
    expect(viewsSrc).toContain('CashOsAccountMenu')
    expect(viewsSrc).toContain('onMutated={handleMutated}')
  })

  it('CashOsAccountMenu no longer accepts snapshot prop — accountHasHistory removed', () => {
    expect(menuSrc).not.toContain('accountHasHistory')
    expect(menuSrc).not.toContain('CashOsSnapshot')
    // snapshot prop must not appear in the component signature
    const mainCompStart = menuSrc.indexOf('export function CashOsAccountMenu(')
    const mainCompEnd = menuSrc.indexOf('\nexport function CashOsAccountRestore(')
    const mainCompBody = menuSrc.slice(mainCompStart, mainCompEnd)
    expect(mainCompBody).not.toContain('snapshot')
  })
})
