/**
 * src/services/bankProvider/bankAccountRepo.ts
 *
 * SERVER-ONLY persistence for BANK-3 over a Supabase SERVICE-ROLE client. Every query is scoped by the organization the server
 * resolved and names its columns explicitly (never `*`). It writes only: allowlisted provider-account metadata, and the owner
 * mapping rows. It never touches financial_accounts, financial_transactions, provider transactions or balance snapshots, and it
 * stores no raw provider JSON (provider_metadata is left at its empty default). Account identity is (item, provider account id): it is
 * NOT assumed to survive a relink to a new Item, and no cross-Item matching happens here.
 */
import { BankConnectionError } from './bankConnectionService'
import type { BankAccountRepo, CashAccountRow, MappingRow, ProviderAccountRow } from './bankAccountService'

type Svc = { from: (table: string) => any }

const ACCOUNT_COLUMNS = 'id, provider_item_ref, provider_account_id, name, official_name, mask, provider_account_type, provider_account_subtype, status'
const MAPPING_COLUMNS = 'id, provider_account_ref, financial_account_id'
const CASH_COLUMNS = 'id, display_name, account_type, ownership_context'

/** Database errors become a generic failure: the raw message may contain identifiers and is never forwarded. */
function failed(): never { throw new Error('bank account persistence failed') }

const toAccount = (r: any): ProviderAccountRow => ({
  id: r.id, providerItemRef: r.provider_item_ref, providerAccountId: r.provider_account_id, name: r.name ?? null, officialName: r.official_name ?? null,
  mask: r.mask ?? null, providerAccountType: r.provider_account_type ?? null, providerAccountSubtype: r.provider_account_subtype ?? null, status: r.status,
})
const toMapping = (r: any): MappingRow => ({ id: r.id, providerAccountRef: r.provider_account_ref, financialAccountId: r.financial_account_id })
const toCash = (r: any): CashAccountRow => ({ id: r.id, displayName: r.display_name, accountType: r.account_type, ownershipContext: r.ownership_context })

export function createBankAccountRepo(svc: Svc): BankAccountRepo {
  const itemStatuses = async (organizationId: string) => {
    const { data, error } = await svc.from('financial_provider_items').select('id, institution_name, status').eq('organization_id', organizationId)
    if (error) failed()
    return new Map<string, { institutionName: string | null; status: string }>((data ?? []).map((i: any) => [i.id, { institutionName: i.institution_name ?? null, status: i.status }]))
  }
  return {
    async listProviderAccounts(organizationId, itemId) {
      const { data, error } = await svc.from('financial_provider_accounts').select(ACCOUNT_COLUMNS).eq('organization_id', organizationId).eq('provider_item_ref', itemId)
      if (error) failed()
      return (data ?? []).map(toAccount)
    },
    async upsertProviderAccounts(organizationId, itemId, accounts) {
      const rows = accounts.map(a => ({
        organization_id: organizationId, provider_item_ref: itemId, provider_account_id: a.providerAccountId,
        name: a.name, official_name: a.officialName, mask: a.mask,
        provider_account_type: a.providerAccountType, provider_account_subtype: a.providerAccountSubtype,
        currency: 'USD', status: 'active', deactivated_at: null,
      }))
      const { error } = await svc.from('financial_provider_accounts').upsert(rows, { onConflict: 'provider_item_ref,provider_account_id' })
      if (error) failed()
    },
    async deactivateProviderAccounts(organizationId, ids) {
      if (ids.length === 0) return
      const { error } = await svc.from('financial_provider_accounts').update({ status: 'inactive', deactivated_at: new Date().toISOString() })
        .eq('organization_id', organizationId).in('id', ids).eq('status', 'active')
      if (error) failed()
    },
    async markItemLoginRequired(organizationId, itemId) {
      const { error } = await svc.from('financial_provider_items').update({ status: 'login_required', status_changed_at: new Date().toISOString() })
        .eq('organization_id', organizationId).eq('id', itemId).in('status', ['healthy', 'connecting'])
      if (error) failed()
    },
    async getProviderAccount(organizationId, id) {
      const { data, error } = await svc.from('financial_provider_accounts').select(ACCOUNT_COLUMNS).eq('organization_id', organizationId).eq('id', id).maybeSingle()
      if (error) failed()
      if (!data) return null
      const item = (await itemStatuses(organizationId)).get(data.provider_item_ref)
      return { ...toAccount(data), itemStatus: item?.status ?? 'disconnected' }
    },
    async listAllProviderAccounts(organizationId) {
      const { data, error } = await svc.from('financial_provider_accounts').select(ACCOUNT_COLUMNS).eq('organization_id', organizationId).order('created_at', { ascending: true })
      if (error) failed()
      const items = await itemStatuses(organizationId)
      return (data ?? []).map((r: any) => ({ ...toAccount(r), institutionName: items.get(r.provider_item_ref)?.institutionName ?? null, itemStatus: items.get(r.provider_item_ref)?.status ?? 'disconnected' }))
    },
    async getFinancialAccount(organizationId, id) {
      const { data, error } = await svc.from('financial_accounts').select(`${CASH_COLUMNS}, status`).eq('organization_id', organizationId).eq('id', id).maybeSingle()
      if (error) failed()
      return data ? { ...toCash(data), status: data.status } : null
    },
    async listCashAccounts(organizationId) {
      const { data, error } = await svc.from('financial_accounts').select(CASH_COLUMNS).eq('organization_id', organizationId).eq('status', 'active').order('display_name', { ascending: true })
      if (error) failed()
      return (data ?? []).map(toCash)
    },
    async listActiveMappings(organizationId) {
      const { data, error } = await svc.from('financial_provider_account_mappings').select(MAPPING_COLUMNS).eq('organization_id', organizationId).eq('status', 'active')
      if (error) failed()
      return (data ?? []).map(toMapping)
    },
    async insertMapping(input) {
      const { data, error } = await svc.from('financial_provider_account_mappings')
        .insert({ organization_id: input.organizationId, provider_account_ref: input.providerAccountRef, financial_account_id: input.financialAccountId, mapped_by: input.actorUserId, status: 'active' })
        .select(MAPPING_COLUMNS).single()
      if (error) {
        if (error.code === '23505') throw new BankConnectionError('conflict', 409, 'That mapping already exists. Refresh and try again.')
        failed()
      }
      return toMapping(data)
    },
    async deactivateMapping(organizationId, mappingId, actorUserId, reason) {
      const { error } = await svc.from('financial_provider_account_mappings')
        .update({ status: 'inactive', deactivated_at: new Date().toISOString(), deactivated_by: actorUserId, deactivation_reason: reason })
        .eq('organization_id', organizationId).eq('id', mappingId).eq('status', 'active')
      if (error) failed()
    },
  }
}
