import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { loadBankTokenEncryptionKey } from '../providerTokenCrypto'
import { activateHistoryRecovery, confirmHistoryRecoveryTransaction, createHistoryRecoveryLinkToken, exchangeHistoryRecoveryPublicToken, getHistoryRecoveries, reconcileHistoryRecovery, type HistoryRecoveryDeps, type HistoryRecoveryRecord } from '../historyRecoveryService'

const ORG = '10000000-0000-4000-8000-000000000001'
const USER = '20000000-0000-4000-8000-000000000001'
const SOURCE = '30000000-0000-4000-8000-000000000001'
const RECOVERY = '40000000-0000-4000-8000-000000000001'
const REPLACEMENT = '50000000-0000-4000-8000-000000000001'
const actor = { organizationId: ORG, userId: USER, role: 'owner' }

const baseRecord = (): HistoryRecoveryRecord => ({
  id: RECOVERY, sourceItemId: SOURCE, replacementItemId: null, institutionId: 'ins_127991', institutionName: 'Wells Fargo',
  environment: 'production', sourceProviderItemId: 'item-old', state: 'link_pending', requestedDays: 730,
  createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z', accounts: [],
  overlap: { confirmed: 0, review: 0, missingFromReplacement: 0 }, errorCode: null,
  transactionReview: [],
})

function world() {
  const record = baseRecord()
  const removed: string[] = []
  const source = { id: SOURCE, provider: 'plaid', providerItemId: 'item-old', status: 'healthy' as const, environment: 'production' as const }
  const repo = {
    getItem: vi.fn(async (_org: string, itemId: string) => itemId === SOURCE ? source : null),
    findItemOwner: vi.fn(async () => null), listItems: vi.fn(async () => []), getActiveCredential: vi.fn(), listLiveInstitutions: vi.fn(async () => []),
    connectItem: vi.fn(), disconnectItem: vi.fn(), markHealthy: vi.fn(),
  }
  const recovery = {
    start: vi.fn(async () => record), get: vi.fn(async () => record), list: vi.fn(async () => [record]),
    connectReplacement: vi.fn(async () => { record.replacementItemId = REPLACEMENT; record.state = 'accounts_pending'; return { itemId: REPLACEMENT } }),
    markError: vi.fn(async () => undefined), prepareAccounts: vi.fn(), confirmAccount: vi.fn(), confirmTransaction: vi.fn(), reconcile: vi.fn(), activate: vi.fn(), excludedBalanceAccountIds: vi.fn(async () => []),
  }
  const plaid = {
    createLinkToken: vi.fn(async () => ({ linkToken: 'link-production-730', expiration: '2026-10-14T01:00:00Z' })),
    exchangePublicToken: vi.fn(async () => ({ accessToken: 'access-production-replacement-secret', itemId: 'item-new' })),
    getItem: vi.fn(async () => ({ itemId: 'item-new', institutionId: 'ins_127991', hasError: false })),
    getInstitutionName: vi.fn(async () => 'Wells Fargo'), removeItem: vi.fn(async (token: string) => { removed.push(token) }),
    getAccounts: vi.fn(), syncTransactions: vi.fn(), getWebhookVerificationKey: vi.fn(),
  }
  const deps = { plaid, repo, recovery, historyRecoveryEnabled: true, environment: 'production',
    key: loadBankTokenEncryptionKey({ POWERON_BANK_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') }) } as unknown as HistoryRecoveryDeps
  return { deps, record, recovery, plaid, repo, removed, source }
}

describe('PLAID-730 controlled history recovery', () => {
  it('starts a new 730-day Link session while preserving the source Item', async () => {
    const w = world(); const before = structuredClone(w.source)
    await expect(createHistoryRecoveryLinkToken(w.deps, actor, { sourceItemId: SOURCE })).resolves.toMatchObject({ mode: 'history_recovery', requestedDays: 730, recoveryId: RECOVERY })
    expect(w.plaid.createLinkToken).toHaveBeenCalledWith({ clientUserId: `${ORG}.${USER}` })
    expect(w.repo.getItem).toHaveBeenCalledWith(ORG, SOURCE); expect(w.source).toEqual(before); expect(w.plaid.removeItem).not.toHaveBeenCalled()
  })

  it('allows the verified same-institution replacement to coexist and never removes the old Item', async () => {
    const w = world()
    const out = await exchangeHistoryRecoveryPublicToken(w.deps, actor, { recoveryId: RECOVERY, publicToken: 'public-production-1234567890', institutionId: 'ins_127991' })
    expect(out).toMatchObject({ connection: { id: REPLACEMENT }, outcome: 'created' })
    expect(w.recovery.connectReplacement).toHaveBeenCalledOnce(); expect(w.plaid.removeItem).not.toHaveBeenCalled(); expect(w.repo.disconnectItem).not.toHaveBeenCalled()
    expect(w.record.sourceItemId).toBe(SOURCE); expect(w.record.replacementItemId).toBe(REPLACEMENT)
  })

  it('rejects a different institution and compensates only the unpersisted replacement', async () => {
    const w = world(); w.plaid.getItem.mockResolvedValueOnce({ itemId: 'item-new', institutionId: 'ins_other', hasError: false })
    await expect(exchangeHistoryRecoveryPublicToken(w.deps, actor, { recoveryId: RECOVERY, publicToken: 'public-production-1234567890' })).rejects.toMatchObject({ code: 'conflict' })
    expect(w.plaid.removeItem).toHaveBeenCalledWith('access-production-replacement-secret'); expect(w.repo.disconnectItem).not.toHaveBeenCalled(); expect(w.record.replacementItemId).toBeNull()
  })

  it('is production-only, so sandbox evidence cannot enter the recovery workflow', async () => {
    const w = world(); (w.deps as any).environment = 'sandbox'
    await expect(createHistoryRecoveryLinkToken(w.deps, actor, { sourceItemId: SOURCE })).rejects.toMatchObject({ code: 'conflict' })
    expect(w.recovery.start).not.toHaveBeenCalled(); expect(w.plaid.createLinkToken).not.toHaveBeenCalled()
  })

  it('reports coverage separately per account without transaction bodies', async () => {
    const w = world(); w.record.accounts = [
      { id: SOURCE, oldAccountId: SOURCE, newAccountId: REPLACEMENT, oldLabel: 'Checking ••••6960', newLabel: 'Checking ••••6960', financialAccountName: 'Business Checking', matchBasis: 'provider_account_id', status: 'confirmed', oldestDate: '2026-01-01', newestDate: '2026-10-14', transactionCount: 291 },
      { id: REPLACEMENT, oldAccountId: REPLACEMENT, newAccountId: SOURCE, oldLabel: 'Card ••••3657', newLabel: 'Card ••••3657', financialAccountName: 'Platinum Card', matchBasis: 'account_details', status: 'review', oldestDate: '2026-02-01', newestDate: '2026-10-13', transactionCount: 4 },
    ]
    const out = await getHistoryRecoveries(w.deps, actor)
    expect(out.recoveries[0].accounts.map(a => [a.oldLabel, a.oldestDate, a.newestDate])).toEqual([
      ['Checking ••••6960', '2026-01-01', '2026-10-14'], ['Card ••••3657', '2026-02-01', '2026-10-13'],
    ])
    expect(JSON.stringify(out)).not.toContain('merchant')
  })

  it('keeps reconciliation and activation retryable and separate from provider removal', async () => {
    const w = world()
    await reconcileHistoryRecovery(w.deps, actor, RECOVERY); await reconcileHistoryRecovery(w.deps, actor, RECOVERY)
    await confirmHistoryRecoveryTransaction(w.deps, actor, { recoveryId: RECOVERY, matchId: REPLACEMENT })
    await activateHistoryRecovery(w.deps, actor, RECOVERY)
    expect(w.recovery.reconcile).toHaveBeenCalledTimes(2); expect(w.recovery.activate).toHaveBeenCalledOnce()
    expect(w.recovery.confirmTransaction).toHaveBeenCalledWith({ organizationId: ORG, recoveryId: RECOVERY, matchId: REPLACEMENT, actorUserId: USER })
    expect(w.plaid.removeItem).not.toHaveBeenCalled(); expect(w.repo.disconnectItem).not.toHaveBeenCalled()
  })

  it('the reviewed SQL isolates mappings, uses conservative overlap, copies decisions, and retains both Items', () => {
    const sql = readFileSync('docs/plaid730/history-recovery-proposal.sql', 'utf8')
    expect(sql).toContain("replacement accounts stay unmapped")
    expect(sql).toContain("provider_transaction_id','confirmed")
    expect(sql).toContain('unique_full_provider_facts')
    expect(sql).toContain('old_candidates=1 AND new_candidates=1')
    expect(sql).toContain('history_recovery_source_interpretation')
    expect(sql).toContain("deactivation_reason='history_recovery_replaced'")
    expect(sql).toContain("state='activated'")
    expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.financial_provider_(items|transactions|interpretations)/i)
    expect(sql).not.toContain('sync_cursor=')
    expect(sql).not.toContain('financial_provider_disconnect_item')
  })
})
