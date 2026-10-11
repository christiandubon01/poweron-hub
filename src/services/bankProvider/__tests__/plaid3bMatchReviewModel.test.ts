import { describe, expect, it } from 'vitest'
import { buildMatchReview, describeEvidenceChange, historyOf, parseFingerprint, type MatchAccountInfo, type PairDecisionRow } from '../spending/matchReview'
import { pairFingerprint, reconcile } from '../spending/reconciliation'
import type { EvidenceTx } from '../spending/types'

const ACCTS: MatchAccountInfo[] = [
  { ref: 'chk', label: 'Checking', mask: '1111', ownership: 'business', accountClass: 'bank_cash', institution: 'Wells Fargo' },
  { ref: 'sav', label: 'Savings', mask: '2222', ownership: 'business', accountClass: 'bank_cash', institution: 'Wells Fargo' },
  { ref: 'card', label: 'Visa', mask: '3333', ownership: 'business', accountClass: 'credit_card', institution: 'Chase' },
]
const tx = (id: string, account: string, amountMinor: number, date: string, name = 'ONLINE TRANSFER', o: Partial<EvidenceTx> = {}): EvidenceTx => ({ id, providerAccountRef: account, date, name, merchantName: null, amountMinor, pending: false, removed: false, category: null, ...o })
const WINDOW = { from: '2026-09-01', to: '2026-09-30' }
const row = (o: Partial<PairDecisionRow> & Pick<PairDecisionRow, 'txId' | 'counterpartTxId' | 'status'>): PairDecisionRow => ({ id: `r${Math.random()}`, source: 'owner', fingerprint: null, pairId: null, pairKind: null, decidedAt: '2026-09-20T10:00:00Z', undoneAt: null, undoReason: null, createdAt: '2026-09-20T10:00:00Z', ...o })
const run = (txs: EvidenceTx[], pairDecisions: PairDecisionRow[] = [], confirmedPairs: Array<[string, string]> = []) => {
  const recon = reconcile({ txs, accounts: ACCTS.map(a => ({ ref: a.ref, label: a.label, accountClass: a.accountClass, ownership: a.ownership })), confirmedPairs })
  return buildMatchReview({ txs, accounts: ACCTS, recon, pairDecisions, refundDecisions: [], window: WINDOW })
}

describe('PLAID-3B match review model', () => {
  const O = tx('o', 'chk', 50_000, '2026-09-05'), I = tx('i', 'sav', -50_000, '2026-09-05')
  const fp = pairFingerprint(O, I)

  it('the fingerprint round-trips and names exactly what changed', () => {
    expect(parseFingerprint(fp)).toEqual({ o: { id: 'o', account: 'chk', amountMinor: 50_000, date: '2026-09-05', pending: false }, i: { id: 'i', account: 'sav', amountMinor: -50_000, date: '2026-09-05', pending: false } })
    expect(parseFingerprint('nonsense')).toBeNull(); expect(parseFingerprint(null)).toBeNull()
    expect(describeEvidenceChange(fp, { o: O, i: I })).toEqual([])
    expect(describeEvidenceChange(fp, { o: { ...O, amountMinor: 50_100 }, i: { ...I, date: '2026-09-07', pending: true, providerAccountRef: 'card' } })).toEqual(['The outgoing amount changed.', 'The incoming date changed.', 'The incoming account changed.', 'The incoming transaction is pending again.'])
    expect(describeEvidenceChange(fp, { o: O, i: undefined })).toEqual(['The incoming transaction is no longer in your bank data.'])
  })

  it('a legacy one-leg confirmation stays CONFIRMED (not alarming), says so, and can be re-confirmed to record both sides', () => {
    const r = run([O, I], [row({ txId: 'o', counterpartTxId: 'i', status: 'confirmed' })], [['o', 'i']])
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({ state: 'confirmed', needsReview: false, decision: { legacy: true }, actions: ['reverse', 'reconfirm'] })
    expect(r.items[0].reasons.join(' ')).toMatch(/confirmed on one side only/)
  })

  it('a pair recorded by the review whose other side was later decided differently is flagged; legs that left the data are named, not hidden', () => {
    const rows = [row({ txId: 'o', counterpartTxId: 'i', status: 'confirmed', fingerprint: fp, pairId: 'p1' }), row({ txId: 'i', counterpartTxId: 'o', status: 'undone', fingerprint: fp, pairId: 'p1', undoneAt: '2026-09-25T10:00:00Z', undoReason: 'something else' })]
    const half = run([O, I], rows, [['o', 'i']])
    expect(half.items[0]).toMatchObject({ state: 'evidence_changed', needsReview: true }); expect(half.items[0].changes.join(' ')).toMatch(/different meaning/)
    const gone = run([O, { ...I, removed: true }], [row({ txId: 'o', counterpartTxId: 'i', status: 'confirmed', fingerprint: fp }), row({ txId: 'i', counterpartTxId: 'o', status: 'confirmed', fingerprint: fp })], [])
    expect(gone.items[0]).toMatchObject({ state: 'evidence_changed', inflow: { missing: true, id: 'i' }, actions: ['reverse'] })
    expect(gone.items[0].changes.join(' ')).toMatch(/no longer in your bank data/)
  })

  it('pairs whose legs are outside the loaded history are not mentioned (nothing can be said about them), and old decided pairs stay out of the window', () => {
    const r = run([O], [row({ txId: 'o', counterpartTxId: 'not-loaded', status: 'confirmed', fingerprint: 'v1|o:o:chk:50000:2026-09-05:0|i:not-loaded:sav:-50000:2026-09-05:0' })])
    expect(r.items).toEqual([])
    const old = [tx('oo', 'chk', 9_000, '2026-06-01'), tx('ii', 'sav', -9_000, '2026-06-01')]
    expect(run(old).items).toEqual([]) // outside the window
    expect(run(old, [row({ txId: 'oo', counterpartTxId: 'ii', status: 'rejected', fingerprint: pairFingerprint(old[0], old[1]) })]).items).toEqual([])
  })

  it('the trail is oldest-first, reports each event once for the two rows of a pair, and a reversal makes the pair "reversed"', () => {
    const base = { fingerprint: fp, pairId: 'p1' }
    const rows = [
      row({ txId: 'o', counterpartTxId: 'i', status: 'undone', ...base, decidedAt: '2026-09-10T10:00:00Z', undoneAt: '2026-09-12T10:00:00Z', undoReason: 'pair_reversed', createdAt: '2026-09-10T10:00:00Z' }),
      row({ txId: 'i', counterpartTxId: 'o', status: 'undone', ...base, decidedAt: '2026-09-10T10:00:00Z', undoneAt: '2026-09-12T10:00:00Z', undoReason: 'pair_reversed', createdAt: '2026-09-10T10:00:00Z' }),
    ]
    expect(historyOf(rows)).toEqual([{ at: '2026-09-10T10:00:00Z', event: 'confirmed' }, { at: '2026-09-12T10:00:00Z', event: 'reversed' }])
    const r = run([O, I], rows)
    expect(r.items[0]).toMatchObject({ state: 'reversed', needsReview: true, actions: ['confirm', 'reject'] })
    expect(r.counts).toMatchObject({ reversed: 1, suggested: 0, needsReview: 1 })
  })

  it('orders what needs a look first, then newest and largest; counts every state and the unresolved groups', () => {
    const txs = [O, I, tx('o2', 'chk', 9_000, '2026-09-10', 'MISC'), tx('i2', 'sav', -9_000, '2026-09-10', 'MISC'), tx('o3', 'chk', 700, '2026-09-20'), tx('i3', 'sav', -700, '2026-09-20')]
    const r = run(txs)
    expect(r.items.map(i => i.outflow.id)).toEqual(['o2', 'o3', 'o']) // the 'possible' pair (no wording) first, then high-confidence newest first
    expect(r.counts).toMatchObject({ suggested: 3, needsReview: 1, ambiguous: 0 })
  })

  it('counts an ambiguous group as something to review and lists its candidate pairs with their own fingerprints', () => {
    const r = run([tx('o1', 'chk', 400, '2026-09-14', 'MISC'), tx('o2', 'sav', 400, '2026-09-14', 'MISC'), tx('i1', 'card', -400, '2026-09-15', 'PAYMENT')])
    expect(r.groups).toHaveLength(1); expect(r.counts).toMatchObject({ ambiguous: 1, needsReview: 1 })
    expect(r.groups[0].candidates.map(c => `${c.outflowId}>${c.inflowId}`).sort()).toEqual(['o1>i1', 'o2>i1'])
    expect(r.groups[0].candidates.every(c => c.fingerprint.startsWith('v1|o:'))).toBe(true)
  })
})
