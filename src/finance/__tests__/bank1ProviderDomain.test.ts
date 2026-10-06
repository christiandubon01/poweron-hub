import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { canTransitionInterpretation, minorToDecimalString, providerAmountToMinor, providerTransactionLedgerSource, validateInterpretationDraft } from '../bankProviderDomain'
import { INTERPRETATION_KINDS, PROVIDER_ITEM_STATUSES } from '../bankProviderTypes'

describe('BANK-1 money representation', () => {
  it('converts provider decimals to exact signed minor units without floating-point drift', () => {
    expect(providerAmountToMinor('-12.34')).toBe(-1234)
    expect(providerAmountToMinor('900.00')).toBe(90000)
    expect(providerAmountToMinor('0.1')).toBe(10)
    expect(providerAmountToMinor('38')).toBe(3800)
    expect(providerAmountToMinor('1234567.89')).toBe(123456789)
    expect(providerAmountToMinor('-0.00')).toBe(0)
    expect(providerAmountToMinor('12.3400')).toBe(1234) // trailing zeros are still exact
    expect(providerAmountToMinor(19.99)).toBe(1999) // a number that is mathematically exact in cents
    expect(providerAmountToMinor(0.1 + 0.2 === 0.3 ? 0.3 : 0.30000000000000004)).toBe(30)
  })

  it('refuses sub-cent, malformed and out-of-range amounts instead of guessing', () => {
    for (const bad of ['12.345', '1.001', '', 'abc', '1,000.00', '1e3', '12.', '.5']) expect(() => providerAmountToMinor(bad), bad).toThrow()
    expect(() => providerAmountToMinor(Number.NaN)).toThrow()
    expect(() => providerAmountToMinor(1.005)).toThrow()
    expect(() => providerAmountToMinor('99999999999999999999')).toThrow(/range/)
  })

  it('round-trips with the decimal evidence string and preserves the provider sign (no universal sign assumption)', () => {
    for (const minor of [0, 1, -1, 99, -99, 100, 123456, -123456]) expect(providerAmountToMinor(minorToDecimalString(minor))).toBe(minor)
    expect(minorToDecimalString(-5)).toBe('-0.05')
    // The helper never flips a sign: depository / card / loan meaning is decided later, per account class.
    expect(providerAmountToMinor('38.00')).toBe(3800)
    expect(providerAmountToMinor('-38.00')).toBe(-3800)
  })
})

describe('BANK-1 ledger adoption identity', () => {
  it('derives a deterministic, organization-scoped source identity from one provider transaction', () => {
    const a = providerTransactionLedgerSource('org-1', 'ptx-1')
    expect(a).toEqual({ source_type: 'future_provider', source_organization_id: 'org-1', source_kind: 'provider_transaction', source_record_id: 'ptx-1', idempotency_key: 'provider_transaction:ptx-1' })
    expect(providerTransactionLedgerSource('org-1', 'ptx-1')).toEqual(a) // same input, same identity: the ledger's unique source index then allows only one live row
    expect(providerTransactionLedgerSource('org-1', 'ptx-2').idempotency_key).not.toBe(a.idempotency_key)
    expect(() => providerTransactionLedgerSource('', 'x')).toThrow()
  })

  it('reuses existing ledger source fields (no new ledger columns are required)', () => {
    const ledgerTypes = readFileSync('src/finance/ledgerTypes.ts', 'utf8')
    for (const field of ['source_type', 'source_organization_id', 'source_kind', 'source_record_id', 'idempotency_key']) expect(ledgerTypes).toContain(field)
    expect(ledgerTypes).toContain("'future_provider'")
  })
})

describe('BANK-1 interpretation rules (mirror of the database contract)', () => {
  it('is reversible: only suggested->confirmed/rejected/undone and confirmed->undone; rejected and undone are final', () => {
    expect(canTransitionInterpretation('suggested', 'confirmed')).toBe(true)
    expect(canTransitionInterpretation('suggested', 'rejected')).toBe(true)
    expect(canTransitionInterpretation('confirmed', 'undone')).toBe(true)
    for (const to of ['suggested', 'confirmed', 'rejected'] as const) expect(canTransitionInterpretation('undone', to)).toBe(false)
    expect(canTransitionInterpretation('rejected', 'confirmed')).toBe(false)
    expect(canTransitionInterpretation('confirmed', 'suggested')).toBe(false)
    expect(canTransitionInterpretation('confirmed', 'rejected')).toBe(false)
  })

  it('requires the right targets per kind and never invents a project-payment or payroll-paid target', () => {
    const ok = (d: any) => validateInterpretationDraft({ status: 'suggested', ...d }).ok
    expect(ok({ kind: 'ledger_match', ledgerTransactionId: 'l', matchMode: 'linked' })).toBe(true)
    expect(ok({ kind: 'ledger_match', ledgerTransactionId: 'l' })).toBe(false)
    expect(ok({ kind: 'category', category: 'Software' })).toBe(true)
    expect(ok({ kind: 'category' })).toBe(false)
    expect(ok({ kind: 'obligation', obligationOccurrenceId: 'o' })).toBe(true)
    expect(ok({ kind: 'obligation', obligationOccurrenceId: 'o', cashCommitmentId: 'c' })).toBe(false) // exactly one
    expect(ok({ kind: 'obligation' })).toBe(false)
    expect(ok({ kind: 'debt', debtAccountId: 'a' })).toBe(true)
    expect(ok({ kind: 'debt' })).toBe(false)
    expect(ok({ kind: 'transfer', counterpartProviderTransactionRef: 'p' })).toBe(true)
    expect(ok({ kind: 'transfer' })).toBe(false)
    expect(ok({ kind: 'project', projectId: 'dw' })).toBe(true)
    expect(ok({ kind: 'project' })).toBe(false)
    expect(ok({ kind: 'ignored' })).toBe(true)
    expect(ok({ kind: 'ignored', category: 'x' })).toBe(false) // a stray target is refused
    expect(ok({ kind: 'payroll', projectId: 'dw' })).toBe(false)
    // exactly the kinds the database allows
    expect([...INTERPRETATION_KINDS].sort()).toEqual(['category', 'debt', 'ignored', 'ledger_match', 'obligation', 'payroll', 'project', 'transfer'])
  })

  it('a confirmed meaning that touches money-adjacent truth needs the canonical ledger row; project meaning cannot be confirmed without one', () => {
    expect(validateInterpretationDraft({ kind: 'project', projectId: 'dw', status: 'confirmed' }).errors.join()).toMatch(/ledger transaction/)
    expect(validateInterpretationDraft({ kind: 'project', projectId: 'dw', status: 'confirmed', ledgerTransactionId: 'l' }).ok).toBe(true)
    expect(validateInterpretationDraft({ kind: 'category', category: 'x', status: 'confirmed' }).ok).toBe(true) // a category needs no ledger row
    expect(validateInterpretationDraft({ kind: 'ignored', status: 'confirmed' }).ok).toBe(true)
    expect(validateInterpretationDraft({ kind: 'debt', debtAccountId: 'a', status: 'confirmed' }).ok).toBe(false)
  })

  it('models only persisted connection states (not_connected is the absence of an item)', () => {
    expect([...PROVIDER_ITEM_STATUSES]).toEqual(['connecting', 'healthy', 'login_required', 'error', 'disconnected'])
  })
})

describe('BANK-1 has no financial effect on existing Cash OS behavior', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
  const read = (p: string) => readFileSync(p, 'utf8')

  it('no Cash OS calculation, read service, hook or view references provider evidence', () => {
    const scoped = [
      ...walk('src/finance').filter(f => /\.tsx?$/.test(f) && !/__tests__|bankProvider/.test(f)),
      ...walk('src/services').filter(f => /cash|manualLedger|ledger|liabilityTerms/i.test(f) && /\.tsx?$/.test(f) && !/test/.test(f)),
      ...walk('src/components/v15r/cash-os').filter(f => /\.tsx?$/.test(f) && !/test/.test(f)),
      'src/hooks/useCashOsSnapshot.ts', 'src/views/DebtKiller.tsx',
    ]
    expect(scoped.length).toBeGreaterThan(40)
    const offenders = scoped.filter(f => /financial_provider|bankProvider|provider_transaction|providerTransaction/.test(read(f)))
    expect(offenders).toEqual([])
  })

  it('the Cash OS source bundle reads only the canonical tables (provider tables are not an input)', () => {
    const service = read('src/services/cashOsReadService.ts')
    expect(service).not.toMatch(/financial_provider/)
    expect(service).toMatch(/financial_accounts|readFinancialLedgerState/)
  })

  it('the new domain files import nothing from the app runtime (pure, no network, no SDK)', () => {
    for (const file of ['src/finance/bankProviderDomain.ts', 'src/finance/bankProviderTypes.ts']) {
      const imports = [...read(file).matchAll(/^import .* from ['"]([^'"]+)['"]/gm)].map(m => m[1])
      for (const spec of imports) expect(spec, `${file} imports ${spec}`).toMatch(/^\.\/(bankProviderTypes)$/)
    }
  })
})
