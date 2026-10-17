import type { HistoryRecoveryRecord, HistoryRecoveryRepo, HistoryRecoveryView } from './historyRecoveryService'

type Svc = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> }
const failed = () => { throw new Error('history recovery persistence failed') }
const row = (data: any) => Array.isArray(data) ? data[0] : data
const view = (r: any): HistoryRecoveryView => ({
  id: r.id, sourceItemId: r.sourceItemId, replacementItemId: r.replacementItemId ?? null, institutionName: r.institutionName ?? null,
  state: r.state, requestedDays: 730, createdAt: r.createdAt, updatedAt: r.updatedAt,
  accounts: Array.isArray(r.accounts) ? r.accounts : [],
  transactionReview: Array.isArray(r.transactionReview) ? r.transactionReview : [],
  overlap: { confirmed: Number(r.overlap?.confirmed) || 0, review: Number(r.overlap?.review) || 0, missingFromReplacement: Number(r.overlap?.missingFromReplacement) || 0 },
  errorCode: r.errorCode ?? null,
})
const record = (r: any): HistoryRecoveryRecord => ({ ...view(r), institutionId: r.institutionId ?? null, environment: r.environment === 'production' ? 'production' : 'sandbox', sourceProviderItemId: r.sourceProviderItemId })

export function createHistoryRecoveryRepo(svc: Svc): HistoryRecoveryRepo {
  const rpc = async (name: string, args: Record<string, unknown>) => { const { data, error } = await svc.rpc(name, args); if (error) failed(); return data }
  return {
    async start(i) { return record(row(await rpc('financial_provider_history_recovery_start', { p_organization_id: i.organizationId, p_source_item_id: i.sourceItemId, p_actor: i.actorUserId, p_environment: i.environment, p_requested_days: i.requestedDays }))) },
    async get(organizationId, recoveryId) { const out = row(await rpc('financial_provider_history_recovery_get', { p_organization_id: organizationId, p_recovery_id: recoveryId })); return out ? record(out) : null },
    async list(organizationId, environment) { const out = await rpc('financial_provider_history_recovery_list', { p_organization_id: organizationId, p_environment: environment }); return (Array.isArray(out) ? out : []).map(view) },
    async connectReplacement(i) { const out = row(await rpc('financial_provider_history_recovery_connect_item', { p_organization_id: i.organizationId, p_recovery_id: i.recoveryId, p_provider_item_id: i.providerItemId, p_institution_id: i.institutionId, p_institution_name: i.institutionName, p_encrypted_access_token: i.encryptedAccessToken, p_actor: i.actorUserId, p_environment: i.environment })); if (!out?.item_id) failed(); return { itemId: out.item_id } },
    async markError(organizationId, recoveryId, code) { await rpc('financial_provider_history_recovery_mark_error', { p_organization_id: organizationId, p_recovery_id: recoveryId, p_error_code: code.slice(0, 64) }) },
    async prepareAccounts(organizationId, recoveryId) { await rpc('financial_provider_history_recovery_prepare_accounts', { p_organization_id: organizationId, p_recovery_id: recoveryId }) },
    async confirmAccount(i) { await rpc('financial_provider_history_recovery_confirm_account', { p_organization_id: i.organizationId, p_recovery_id: i.recoveryId, p_match_id: i.matchId, p_replacement_account_id: i.replacementAccountId, p_actor: i.actorUserId }) },
    async confirmTransaction(i) { await rpc('financial_provider_history_recovery_confirm_transaction', { p_organization_id: i.organizationId, p_recovery_id: i.recoveryId, p_match_id: i.matchId, p_actor: i.actorUserId }) },
    async reconcile(organizationId, recoveryId) { await rpc('financial_provider_history_recovery_reconcile', { p_organization_id: organizationId, p_recovery_id: recoveryId }) },
    async activate(i) { await rpc('financial_provider_history_recovery_activate', { p_organization_id: i.organizationId, p_recovery_id: i.recoveryId, p_actor: i.actorUserId }) },
    async excludedBalanceAccountIds(organizationId, environment) {
      const out = await rpc('financial_provider_history_recovery_balance_exclusions', { p_organization_id: organizationId, p_environment: environment })
      return (Array.isArray(out) ? out : []).map((x: any) => typeof x === 'string' ? x : x.account_id).filter((x: unknown): x is string => typeof x === 'string')
    },
  }
}
