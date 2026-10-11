import { describe, expect, it } from 'vitest'
import { pairFingerprint, reconcile, type ReconAccount } from '../spending/reconciliation'
import { buildRows } from '../spending/explorer'
import type { AccountContext, Decision, EvidenceTx } from '../spending/types'

const ACCTS: ReconAccount[] = [
  { ref: 'chk', label: 'Business Checking', accountClass: 'bank_cash', ownership: 'business' }, { ref: 'sav', label: 'Business Savings', accountClass: 'bank_cash', ownership: 'business' },
  { ref: 'pchk', label: 'Personal Checking', accountClass: 'bank_cash', ownership: 'personal' }, { ref: 'card', label: 'Visa', accountClass: 'credit_card', ownership: 'business' },
  { ref: 'mystery', label: 'Unmapped unknown', accountClass: null, ownership: null }, { ref: 'umchk', label: 'Unmapped checking', accountClass: 'bank_cash', ownership: null },
]
let n = 0
const tx = (account: string, amountMinor: number, date: string, name = 'GENERIC', o: Partial<EvidenceTx> = {}): EvidenceTx =>
  ({ id: o.id ?? `t${++n}`, providerAccountRef: account, date, name, merchantName: null, amountMinor, pending: false, removed: false, category: null, ...o })
const run = (txs: EvidenceTx[], extra: Partial<Parameters<typeof reconcile>[0]> = {}) => reconcile({ txs, accounts: ACCTS, ...extra })

describe('PLAID-3A engine rules added for the switch (ON path)', () => {
  it('a business <-> personal pair is never better than possible and says why (owner draw / contribution)', () => {
    const r = run([tx('chk', 90_000, '2026-09-01', 'ONLINE TRANSFER', { id: 'o' }), tx('pchk', -90_000, '2026-09-01', 'ONLINE TRANSFER', { id: 'i' })])
    expect(r.pairs[0]).toMatchObject({ confidence: 'possible', crossScope: true, caps: ['cross_scope'] })
    expect(r.pairs[0].reasons.join(' ')).toMatch(/owner draw or a contribution/)
    // same ownership with the same wording stays high
    expect(run([tx('chk', 90_000, '2026-09-01', 'ONLINE TRANSFER', { id: 'o' }), tx('sav', -90_000, '2026-09-01', 'ONLINE TRANSFER', { id: 'i' })]).pairs[0]).toMatchObject({ confidence: 'high', crossScope: false, caps: [] })
    // an unmapped account is not "cross scope" (its ownership is unknown, not different)
    expect(run([tx('chk', 90_000, '2026-09-01', 'ONLINE TRANSFER', { id: 'o' }), tx('umchk', -90_000, '2026-09-01', 'ONLINE TRANSFER', { id: 'i' })]).pairs[0]).toMatchObject({ crossScope: false, confidence: 'high' })
  })

  it('an unknown account type can never be "high": nothing certain can be said about a card payment or a transfer', () => {
    const r = run([tx('chk', 5_000, '2026-09-01', 'CARD AUTOPAY', { id: 'o' }), tx('mystery', -5_000, '2026-09-02', 'PAYMENT THANK YOU', { id: 'i' })])
    expect(r.pairs[0]).toMatchObject({ confidence: 'possible', kind: 'internal_transfer' })   // cannot even be called a card payment
    expect(r.pairs[0].caps).toContain('class_unknown')
    expect(r.pairs[0].reasons.join(' ')).toMatch(/not known/)
    // a strong textual signal does not lift the cap
    expect(run([tx('chk', 5_000, '2026-09-01', 'ONLINE TRANSFER', { id: 'o' }), tx('mystery', -5_000, '2026-09-01', 'ONLINE TRANSFER', { id: 'i' })]).pairs[0]).toMatchObject({ confidence: 'possible', caps: ['class_unknown'] })
  })

  it('legs the owner already decided as something else are never offered to a pairing or refund match', () => {
    const base = [tx('chk', 5_000, '2026-09-01', 'TRANSFER', { id: 'o' }), tx('sav', -5_000, '2026-09-01', 'TRANSFER', { id: 'i' })]
    expect(run(base).pairs).toHaveLength(1)
    for (const reason of ['personal', 'project', 'payroll', 'obligation', 'debt', 'ignored', 'categorized']) {
      expect(run(base, { excluded: new Map([['o', reason]]) }).pairs).toHaveLength(0)
      expect(run(base, { excluded: new Map([['i', reason]]) }).pairs).toHaveLength(0)
    }
    const buy = tx('card', 8_999, '2026-08-01', 'HOME DEPOT #12', { id: 'buy' }), ref = tx('card', -8_999, '2026-08-20', 'HOME DEPOT RETURN', { id: 'ref' })
    expect(run([buy, ref]).refunds).toHaveLength(1)
    expect(run([buy, ref], { excluded: new Map([['ref', 'categorized']]) }).refunds).toHaveLength(0)
  })

  it('through the classifier: confirmed decisions elsewhere remove a leg from the pairing, a confirmed "transfers" category does not', () => {
    const acct = (ref: string, type: string, sub: string): AccountContext => ({ providerAccountRef: ref, label: ref, mask: null, ownership: 'business', financialAccountId: `fa-${ref}`, financialAccountName: ref, environment: 'production', providerType: type, providerSubtype: sub })
    const accounts = [acct('chk', 'depository', 'checking'), acct('sav', 'depository', 'savings')]
    const txs = [tx('chk', 5_000, '2026-09-01', 'ONLINE TRANSFER', { id: 'o' }), tx('sav', -5_000, '2026-09-01', 'ONLINE TRANSFER', { id: 'i' })]
    const dec = (id: string, txId: string, kind: Decision['kind'], category: string | null = null): Decision => ({ id, txId, kind, status: 'confirmed', category, projectId: null, obligationId: null, commitmentId: null, debtAccountId: null, counterpartTxId: null, confidence: 'high', source: 'owner', decidedAt: 'x' })
    const rel = (decisions: Decision[], id: string) => buildRows({ asOf: '2026-09-30', txs, accounts, decisions, bills: [], obligationLabels: new Map(), commitmentLabels: new Map(), debts: [], projects: [], reconciliation: true }).rows.find(r => r.id === id)!.relationship
    expect(rel([], 'o')).toMatchObject({ kind: 'transfer', state: 'suggested', confidence: 'high' })
    expect(rel([dec('d1', 'i', 'personal')], 'o').target?.id ?? null).toBeNull()                    // the owner said the deposit is personal
    expect(rel([dec('d1', 'i', 'category', 'customer_payment')], 'o').target?.id ?? null).toBeNull()   // ... or a customer payment
    expect(rel([dec('d1', 'i', 'category', 'transfers')], 'o').target?.id).toBe('i')                 // ... but confirming the bucket "Transfers" is consistent with pairing
  })

  it('the fingerprint binds a decision to the exact evidence: ids, accounts, signed amounts, dates, pending flags (not descriptions)', () => {
    const o = tx('chk', 5_000, '2026-09-01', 'A', { id: 'o' }), i = tx('sav', -5_000, '2026-09-01', 'B', { id: 'i' })
    const f = pairFingerprint(o, i)
    expect(f).toBe('v1|o:o:chk:5000:2026-09-01:0|i:i:sav:-5000:2026-09-01:0')
    expect(pairFingerprint({ ...o, name: 'REWRITTEN BY THE BANK' } as any, i)).toBe(f)
    for (const changed of [{ ...o, amountMinor: 5_001 }, { ...o, date: '2026-09-02' }, { ...o, pending: true }, { ...o, providerAccountRef: 'x' }]) expect(pairFingerprint(changed as any, i)).not.toBe(f)
    expect(run([o, i]).pairs[0].fingerprint).toBe(f)
  })

  it('pending legs are paired for information only (provisional) and never mixed with posted ones', () => {
    const r = run([tx('chk', 5_000, '2026-09-01', 'TRANSFER', { id: 'o', pending: true }), tx('sav', -5_000, '2026-09-01', 'TRANSFER', { id: 'i', pending: true })])
    expect(r.pairs[0]).toMatchObject({ provisional: true })
    expect(run([tx('chk', 5_000, '2026-09-01', 'TRANSFER', { id: 'o', pending: true }), tx('sav', -5_000, '2026-09-01', 'TRANSFER', { id: 'i' })]).pairs).toHaveLength(0)
  })

  it('credit cards across different institutions pair exactly like accounts at one institution', () => {
    // 'chk' and 'card' belong to different Items (institutions) in production; the engine only sees accounts
    const r = run([tx('chk', 123_456, '2026-09-10', 'ACH PAYMENT CHASE CARD', { id: 'o' }), tx('card', -123_456, '2026-09-12', 'AUTOMATIC PAYMENT - THANK YOU', { id: 'i' })])
    expect(r.pairs[0]).toMatchObject({ kind: 'card_payment', confidence: 'high', daysApart: 2 })
  })

  it('same-amount unrelated purchases are never a pair: purchases on a card are not outflow legs, equal purchases at two merchants stay separate', () => {
    const r = run([tx('card', 4_999, '2026-09-01', 'ADOBE', { id: 'p1' }), tx('chk', 4_999, '2026-09-01', 'NETFLIX', { id: 'p2' }), tx('sav', -4_999, '2026-09-30', 'INTEREST', { id: 'x' })])
    expect(r.pairs).toHaveLength(0)
    expect(r.ambiguous).toHaveLength(0)
  })
})
