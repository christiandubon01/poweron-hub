/**
 * src/services/bankProvider/bankAccountService.ts
 *
 * SERVER-ONLY (BANK-3). Provider account discovery + OWNER-CREATED mapping of a provider account to an existing Cash OS
 * financial account. Everything above the Plaid adapter is provider-neutral: this file speaks "provider account", never "Plaid".
 *
 * What it does:  discover accounts for a connected Item (free /accounts/get through the adapter), upsert allowlisted metadata
 *                idempotently by the provider account id WITHIN one provider Item, list accounts with their mapping state, and create / change /
 *                remove an owner mapping.
 * What it never does: retrieve or store transactions, store or show provider balances, change a Cash OS account (include_in_cash,
 *                class, type, balance, ownership) or a ledger row, delete provider evidence, or auto-map anything.
 *
 * Identity semantics (BANK-3A): the provider account id is the identity of an account only within ONE provider Item, i.e.
 * (provider_item_ref, provider_account_id). Plaid does NOT guarantee that an account_id survives every lifecycle: it can change when
 * Plaid cannot reconcile the account with institution data, or when an access token is deleted and the same credentials later create a
 * new Item. So a relinked Item's accounts are NEW provider accounts: they are never matched to historical ones by name, mask,
 * type/subtype or balance, they inherit no mapping, and the owner maps them again. Old rows and mapping history are kept as evidence.
 * persistent_account_id (available only at some institutions) is deliberately NOT used as an identity key; a future enhancement may
 * offer it as an optional, owner-confirmed hint.
 *
 * Mapping-change atomicity: a change is two writes (deactivate, then insert, with a restore on failure) so the worst case is
 * "unmapped", never a wrong mapping. Atomic replacement (one database function) must be revisited BEFORE mappings are allowed to
 * trigger any automated financial effect.
 *
 * Mapping uniqueness (enforced by migration 153's partial unique indexes, mirrored here for friendly errors):
 *   - one ACTIVE mapping per provider account, and one ACTIVE mapping per Cash OS account;
 *   - inactive rows are kept forever as history, and an inactive mapping is never reactivated (a new row is created instead);
 *   - a mapping whose provider account is no longer live (disconnected Item or account no longer returned) does NOT block a new
 *     mapping of that Cash OS account: it is superseded (kept, marked inactive), which is what makes a bank migration possible.
 */
import { BankConnectionError, UUID, assertAuthority, decryptFor, loadCredential, note, type BankActor, type BankConnectionDeps } from './bankConnectionService'
import { PlaidApiFailure, type ProviderAccountSummary } from './plaidPort'

/** The only provider-account fields persisted. Balances are NOT here and are never stored by BANK-3. */
export interface ProviderAccountRecord {
  providerAccountId: string
  name: string | null
  officialName: string | null
  mask: string | null
  providerAccountType: string | null
  providerAccountSubtype: string | null
}

export interface ProviderAccountRow extends ProviderAccountRecord {
  id: string
  providerItemRef: string
  status: 'active' | 'inactive'
}

export interface MappingRow { id: string; providerAccountRef: string; financialAccountId: string }

export interface CashAccountRow { id: string; displayName: string; accountType: string; ownershipContext: string }

export interface BankAccountRepo {
  listProviderAccounts(organizationId: string, itemId: string): Promise<ProviderAccountRow[]>
  /** One statement, idempotent on (item, provider account id). Re-activates a returned account; never touches created_at. */
  upsertProviderAccounts(organizationId: string, itemId: string, accounts: ProviderAccountRecord[]): Promise<void>
  deactivateProviderAccounts(organizationId: string, ids: string[]): Promise<void>
  /** Marks a healthy/connecting Item as needing the owner to sign in again (status only; nothing else changes). */
  markItemLoginRequired(organizationId: string, itemId: string): Promise<void>
  getProviderAccount(organizationId: string, id: string): Promise<(ProviderAccountRow & { itemStatus: string }) | null>
  listAllProviderAccounts(organizationId: string): Promise<Array<ProviderAccountRow & { institutionName: string | null; itemStatus: string }>>
  getFinancialAccount(organizationId: string, id: string): Promise<(CashAccountRow & { status: string }) | null>
  listCashAccounts(organizationId: string): Promise<CashAccountRow[]>
  listActiveMappings(organizationId: string): Promise<MappingRow[]>
  /** Throws BankConnectionError('conflict') when the database's active-mapping uniqueness rejects it. */
  insertMapping(input: { organizationId: string; providerAccountRef: string; financialAccountId: string; actorUserId: string }): Promise<MappingRow>
  deactivateMapping(organizationId: string, mappingId: string, actorUserId: string, reason: string): Promise<void>
}

export interface BankAccountDeps extends BankConnectionDeps { accounts: BankAccountRepo }

export interface BankAccountView {
  id: string
  connectionId: string
  institutionName: string | null
  name: string | null
  officialName: string | null
  mask: string | null
  type: string | null
  subtype: string | null
  /** True only while the bank connection is alive AND the bank still returns this account. A disconnected account never looks syncable. */
  live: boolean
  mapping: { id: string; financialAccountId: string; financialAccountName: string } | null
}

const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,128}$/
const MAX_ACCOUNTS = 200
const clip = (v: string | null, max: number): string | null => { const t = typeof v === 'string' ? v.trim() : ''; return t ? t.slice(0, max) : null }

/** Reduce an adapter summary to the persisted allowlist. Anything that cannot satisfy the schema is skipped, never fabricated. */
export function toProviderAccountRecord(a: ProviderAccountSummary): ProviderAccountRecord | null {
  if (!a || typeof a.accountId !== 'string' || !ACCOUNT_ID.test(a.accountId)) return null
  if (a.currency !== 'USD') return null // the schema is USD-only; an unsupported currency is skipped rather than coerced
  const mask = clip(a.mask, 16)
  return {
    providerAccountId: a.accountId, name: clip(a.name, 120), officialName: clip(a.officialName, 160), mask,
    providerAccountType: clip(a.type, 32), providerAccountSubtype: clip(a.subtype, 48),
  }
}

const unavailable = () => new BankConnectionError('plaid_unavailable', 502, 'The bank connection service is unavailable. Try again shortly.')
const requireUuid = (v: unknown, what: string): string => {
  if (typeof v !== 'string' || !UUID.test(v)) throw new BankConnectionError('invalid_request', 400, `A valid ${what} is required.`)
  return v
}

/**
 * Fetch the accounts at a connected Item and persist the allowlisted metadata. A separate authenticated call (not part of the
 * exchange) so a failure here can never undo an otherwise valid connection; it is retry-safe and idempotent.
 */
export async function discoverAccounts(deps: BankAccountDeps, actor: BankActor, input: { itemId?: unknown }) {
  assertAuthority(actor)
  const { item, envelope } = await loadCredential(deps, actor, input.itemId as string)
  if (item.status === 'disconnected' || !envelope) throw new BankConnectionError('conflict', 409, 'This bank connection is disconnected. Connect it again first.')
  const token = decryptFor(deps, actor, item, envelope)
  let summaries: ProviderAccountSummary[]
  try {
    summaries = await deps.plaid.getAccounts(token)
  } catch (error) {
    if (error instanceof PlaidApiFailure && error.code === 'ITEM_LOGIN_REQUIRED') {
      // The same sanitized state the sync path uses: the connection shows "Sign-in needed" with Reconnect. No raw Plaid error is exposed.
      try { await deps.accounts.markItemLoginRequired(actor.organizationId, item.id) } catch { /* the owner message below is still correct */ }
      note(deps, { event: 'bank.accounts.discovery_failed', organizationId: actor.organizationId, itemId: item.id, code: 'ITEM_LOGIN_REQUIRED' })
      throw new BankConnectionError('login_required', 409, 'The bank needs you to sign in again. Use Reconnect.')
    }
    note(deps, { event: 'bank.accounts.discovery_failed', organizationId: actor.organizationId, itemId: item.id, code: error instanceof PlaidApiFailure ? error.code : 'ERROR' })
    throw unavailable()
  }
  const seen = new Set<string>()
  const records: ProviderAccountRecord[] = []
  for (const s of summaries.slice(0, MAX_ACCOUNTS)) {
    const r = toProviderAccountRecord(s)
    if (r && !seen.has(r.providerAccountId)) { seen.add(r.providerAccountId); records.push(r) }
  }
  try {
    const existing = await deps.accounts.listProviderAccounts(actor.organizationId, item.id)
    const known = new Set(existing.map(e => e.providerAccountId))
    if (records.length > 0) await deps.accounts.upsertProviderAccounts(actor.organizationId, item.id, records)
    // An empty answer is never treated as "everything disappeared": evidence is only retired when the bank returned other accounts.
    const gone = records.length > 0 ? existing.filter(e => e.status === 'active' && !seen.has(e.providerAccountId)).map(e => e.id) : []
    if (gone.length > 0) await deps.accounts.deactivateProviderAccounts(actor.organizationId, gone)
    const created = records.filter(r => !known.has(r.providerAccountId)).length
    note(deps, { event: 'bank.accounts.discovered', organizationId: actor.organizationId, itemId: item.id, outcome: `${created}/${records.length}/${gone.length}` })
    return { discovered: records.length, created, deactivated: gone.length, skipped: summaries.length - records.length }
  } catch {
    note(deps, { event: 'bank.accounts.persist_failed', organizationId: actor.organizationId, itemId: item.id, code: 'persistence_failed' })
    throw new BankConnectionError('persistence_failed', 503, 'The bank accounts could not be saved. Your connection is fine; try again.')
  }
}

/** Provider accounts with their mapping state, plus the Cash OS accounts an owner may map to. No balances, no provider ids. */
export async function listBankAccounts(deps: BankAccountDeps, actor: BankActor) {
  assertAuthority(actor)
  const [accounts, mappings, cash] = await Promise.all([
    deps.accounts.listAllProviderAccounts(actor.organizationId),
    deps.accounts.listActiveMappings(actor.organizationId),
    deps.accounts.listCashAccounts(actor.organizationId),
  ])
  const cashById = new Map(cash.map(c => [c.id, c]))
  const mappingByAccount = new Map(mappings.map(m => [m.providerAccountRef, m]))
  const views: BankAccountView[] = accounts.map(a => {
    const m = mappingByAccount.get(a.id)
    const fin = m ? cashById.get(m.financialAccountId) : undefined
    return {
      id: a.id, connectionId: a.providerItemRef, institutionName: a.institutionName, name: a.name, officialName: a.officialName, mask: a.mask,
      type: a.providerAccountType, subtype: a.providerAccountSubtype, live: a.status === 'active' && a.itemStatus !== 'disconnected',
      mapping: m ? { id: m.id, financialAccountId: m.financialAccountId, financialAccountName: fin?.displayName ?? 'Cash OS account' } : null,
    }
  })
  return { accounts: views, cashAccounts: cash.map(c => ({ id: c.id, displayName: c.displayName, accountType: c.accountType, ownershipContext: c.ownershipContext })) }
}

/** Create or change the mapping of ONE provider account. Organization comes from the actor; both records are re-read under it. */
export async function mapAccount(deps: BankAccountDeps, actor: BankActor, input: { providerAccountId?: unknown; financialAccountId?: unknown }) {
  assertAuthority(actor)
  const providerAccountId = requireUuid(input.providerAccountId, 'bank account')
  const financialAccountId = requireUuid(input.financialAccountId, 'Cash OS account')
  const org = actor.organizationId

  const provider = await deps.accounts.getProviderAccount(org, providerAccountId)
  if (!provider) throw new BankConnectionError('not_found', 404, 'Bank account not found.')
  if (provider.status !== 'active' || provider.itemStatus === 'disconnected') throw new BankConnectionError('conflict', 409, 'This bank account is not currently connected.')
  const financial = await deps.accounts.getFinancialAccount(org, financialAccountId)
  if (!financial) throw new BankConnectionError('not_found', 404, 'Cash OS account not found.')
  if (financial.status !== 'active') throw new BankConnectionError('conflict', 409, 'That Cash OS account is archived.')

  const mappings = await deps.accounts.listActiveMappings(org)
  const current = mappings.find(m => m.providerAccountRef === providerAccountId)
  if (current && current.financialAccountId === financialAccountId) return { outcome: 'unchanged' as const }

  const holder = mappings.find(m => m.financialAccountId === financialAccountId && m.providerAccountRef !== providerAccountId)
  if (holder) {
    const holderAccount = await deps.accounts.getProviderAccount(org, holder.providerAccountRef)
    const holderLive = !!holderAccount && holderAccount.status === 'active' && holderAccount.itemStatus !== 'disconnected'
    if (holderLive) throw new BankConnectionError('conflict', 409, 'That Cash OS account is already mapped to another bank account. Remove that mapping first.')
  }

  // Two steps (the schema forbids two active rows, and an inactive row is never reactivated). Everything is validated first, and a
  // failed insert restores the previous mapping, so the worst case is "unmapped", never a wrong or doubled mapping.
  const deactivated: Array<{ id: string; providerAccountRef: string; financialAccountId: string }> = []
  try {
    if (current) { await deps.accounts.deactivateMapping(org, current.id, actor.userId, 'owner_changed'); deactivated.push(current) }
    if (holder) { await deps.accounts.deactivateMapping(org, holder.id, actor.userId, 'superseded_provider_gone'); deactivated.push(holder) }
    const created = await deps.accounts.insertMapping({ organizationId: org, providerAccountRef: providerAccountId, financialAccountId, actorUserId: actor.userId })
    note(deps, { event: 'bank.account.mapped', organizationId: org, itemId: provider.providerItemRef, outcome: current ? 'changed' : 'created' })
    return { outcome: (current ? 'changed' : 'created') as 'changed' | 'created', mappingId: created.id }
  } catch (error) {
    for (const d of deactivated) {
      try { await deps.accounts.insertMapping({ organizationId: org, providerAccountRef: d.providerAccountRef, financialAccountId: d.financialAccountId, actorUserId: actor.userId }) } catch { /* best effort */ }
    }
    if (error instanceof BankConnectionError) throw error
    note(deps, { event: 'bank.account.map_failed', organizationId: org, code: 'persistence_failed' })
    throw new BankConnectionError('persistence_failed', 503, 'The mapping could not be saved. Nothing was changed; please try again.')
  }
}

/** Remove the active mapping of a provider account. History is kept; no provider evidence or ledger row is touched. Idempotent. */
export async function unmapAccount(deps: BankAccountDeps, actor: BankActor, input: { providerAccountId?: unknown }) {
  assertAuthority(actor)
  const providerAccountId = requireUuid(input.providerAccountId, 'bank account')
  const provider = await deps.accounts.getProviderAccount(actor.organizationId, providerAccountId)
  if (!provider) throw new BankConnectionError('not_found', 404, 'Bank account not found.')
  const current = (await deps.accounts.listActiveMappings(actor.organizationId)).find(m => m.providerAccountRef === providerAccountId)
  if (!current) return { outcome: 'already_unmapped' as const }
  try {
    await deps.accounts.deactivateMapping(actor.organizationId, current.id, actor.userId, 'owner_removed')
  } catch {
    throw new BankConnectionError('persistence_failed', 503, 'The mapping could not be removed. Nothing was changed; please try again.')
  }
  note(deps, { event: 'bank.account.unmapped', organizationId: actor.organizationId, itemId: provider.providerItemRef, outcome: 'removed' })
  return { outcome: 'removed' as const }
}
