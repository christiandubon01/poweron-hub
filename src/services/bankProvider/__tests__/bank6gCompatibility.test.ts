import { describe, expect, it } from 'vitest'
import { buildRows, viewCounts } from '../spending/explorer'
import { buildMerchantHistory } from '../spending/classifier'
import { isBucketKey } from '../spending/taxonomy'
import type { Decision, EvidenceTx } from '../spending/types'

const tx: EvidenceTx = { id: 'tx', providerAccountRef: 'acc', date: '2026-10-09', name: 'HOME DEPOT', merchantName: null, amountMinor: 1500, pending: false, removed: false, category: null }
const decision: Decision = { id: 'decision', txId: tx.id, kind: 'category', status: 'confirmed', category: 'custom_shop_supplies', projectId: null, obligationId: null, commitmentId: null, debtAccountId: null, counterpartTxId: null, confidence: 'high', source: 'owner', decidedAt: '2026-10-09' }
describe('BANK-6G compatibility bridge', () => {
  it('preserves unfamiliar owner decisions and reviewed counts even without a registry; never replaces them with merchant suggestions', () => {
    const evidenceBefore = JSON.stringify(tx), decisionBefore = JSON.stringify(decision)
    const { rows, analytics } = buildRows({ asOf: tx.date, txs: [tx], accounts: [], decisions: [decision], bills: [], debts: [], projects: [], obligationLabels: new Map(), commitmentLabels: new Map() })
    expect(rows[0].bucket).toMatchObject({ key: decision.category, state: 'confirmed' })
    expect(rows[0].review).toBe('confirmed')
    expect(viewCounts(rows)).toMatchObject({ reviewed: 1, review_queue: 0 })
    expect(analytics.unassigned).toMatchObject({ totalMinor: 1500, count: 1 })
    expect(analytics.unassigned.byBucket[0].key).toBe(decision.category)
    expect(JSON.stringify(tx)).toBe(evidenceBefore); expect(JSON.stringify(decision)).toBe(decisionBefore)
  })
  it('does not loosen built-in write validation or learn custom names into approvals/relationships', () => {
    expect(isBucketKey(decision.category)).toBe(false)
    expect(buildMerchantHistory([tx], [decision]).size).toBe(0)
  })
})
