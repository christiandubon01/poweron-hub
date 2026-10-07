/**
 * src/services/bankProvider/bankConnectionRepo.ts
 *
 * SERVER-ONLY persistence for the bank connection service, over a Supabase SERVICE-ROLE client. Every read is scoped by the
 * organization the server resolved, uses an explicit column list (never `*`, so the sync cursor and diagnostics cannot
 * leak), and every write goes through the atomic service-role functions from migration 154.
 */
import { BankConnectionError, type BankConnectionRepo, type BankConnectionView } from './bankConnectionService'

const VIEW_COLUMNS = 'id, provider, status, institution_name, connected_at, disconnected_at, last_successful_sync_at'

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> }
type Svc = Rpc & { from: (table: string) => any }

const toView = (row: any): BankConnectionView => ({
  id: row.id, provider: row.provider, status: row.status, institutionName: row.institution_name ?? null,
  connectedAt: row.connected_at ?? null, disconnectedAt: row.disconnected_at ?? null, lastSuccessfulSyncAt: row.last_successful_sync_at ?? null,
})

/** Database errors become a generic failure: the raw message may contain identifiers and is never forwarded. */
function failed(): never { throw new Error('bank connection persistence failed') }

export function createBankConnectionRepo(svc: Svc): BankConnectionRepo {
  return {
    async findItemOwner(provider, providerItemId) {
      const { data, error } = await svc.from('financial_provider_items').select('id, organization_id').eq('provider', provider).eq('provider_item_id', providerItemId).maybeSingle()
      if (error) failed()
      return data ? { id: data.id, organizationId: data.organization_id } : null
    },
    async connectItem(input) {
      const { data, error } = await svc.rpc('financial_provider_connect_item', {
        p_organization_id: input.organizationId, p_provider: input.provider, p_provider_item_id: input.providerItemId,
        p_institution_id: input.institutionId, p_institution_name: input.institutionName,
        p_encrypted_access_token: input.encryptedAccessToken, p_actor: input.actorUserId,
      })
      if (error) {
        if (String(error.message ?? '').includes('PROVIDER_ITEM_OWNED_BY_ANOTHER_ORGANIZATION')) {
          throw new BankConnectionError('item_owned_elsewhere', 409, 'This bank connection cannot be completed.')
        }
        failed()
      }
      const row = Array.isArray(data) ? data[0] : data
      if (!row?.item_id || !row?.outcome) failed()
      return { itemId: row.item_id, outcome: row.outcome }
    },
    async getItem(organizationId, itemId) {
      const { data, error } = await svc.from('financial_provider_items').select('id, provider, provider_item_id, status').eq('organization_id', organizationId).eq('id', itemId).maybeSingle()
      if (error) failed()
      return data ? { id: data.id, provider: data.provider, providerItemId: data.provider_item_id, status: data.status } : null
    },
    async listItems(organizationId) {
      const { data, error } = await svc.from('financial_provider_items').select(VIEW_COLUMNS).eq('organization_id', organizationId).order('created_at', { ascending: true })
      if (error) failed()
      return (data ?? []).map(toView)
    },
    async getActiveCredential(organizationId, itemId) {
      const { data, error } = await svc.from('financial_provider_credentials').select('encrypted_access_token').eq('organization_id', organizationId).eq('provider_item_ref', itemId).eq('status', 'active').maybeSingle()
      if (error) failed()
      return data?.encrypted_access_token ?? null
    },
    async disconnectItem(organizationId, itemId) {
      const { data, error } = await svc.rpc('financial_provider_disconnect_item', { p_organization_id: organizationId, p_item_id: itemId })
      if (error) failed()
      return data === 'already_disconnected' ? 'already_disconnected' : 'disconnected'
    },
    async markHealthy(organizationId, itemId) {
      const { data, error } = await svc.rpc('financial_provider_mark_item_healthy', { p_organization_id: organizationId, p_item_id: itemId })
      if (error) failed()
      return data === true
    },
  }
}
