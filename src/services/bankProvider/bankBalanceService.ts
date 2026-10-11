/**
 * src/services/bankProvider/bankBalanceService.ts
 *
 * SERVER-ONLY (PLAID-2E). Owner/admin-triggered refresh and read of provider balances.
 *
 *   refreshBalances  - one /accounts/get (cached balances, no per-call fee), validated, stored as append-only SNAPSHOTS. Never the ledger, never a
 *                      Cash OS account, never a mapping, never an overwrite of a manual-ledger balance.
 *   getBalances      - the newest snapshot per account, read through balanceModel (bank cash, card debt and unused credit stay separate; every
 *                      reading carries its timestamp and freshness).
 *
 * Off unless the server sets PLAID_BALANCES_ENABLED=true. A skipped or rejected account never fails the others.
 */
import { BankConnectionError, assertAuthority, decryptFor, loadCredential, note, type BankActor } from './bankConnectionService'
import type { BankAccountDeps } from './bankAccountService'
import { PlaidApiFailure } from './plaidPort'
import { BALANCE_SOURCE, type BankBalanceRepo } from './bankBalanceRepo'
import { classifyAccount, interpretBalance, toExactMinor, type InterpretedBalance } from './balanceModel'

export interface BankBalanceDeps extends BankAccountDeps {
  balances: BankBalanceRepo
  balancesEnabled?: boolean
  now?: () => number
}
const clock = (d: BankBalanceDeps) => (d.now ? d.now() : Date.now())

/** A bank can report a balance timestamp in the future or years in the past; only a sane one is trusted as "when this was true". */
export function trustedProviderTime(lastUpdatedAt: string | null, nowMs: number): string | null {
  if (!lastUpdatedAt) return null
  const t = Date.parse(lastUpdatedAt)
  if (!Number.isFinite(t) || t > nowMs + 5 * 60_000 || t < nowMs - 400 * 86_400_000) return null
  return new Date(t).toISOString()
}

export interface RefreshResult { stored: number; unchanged: number; unknownAccounts: number; rejected: number; unsupportedCurrency: number }

export async function refreshBalances(deps: BankBalanceDeps, actor: BankActor, input: { itemId?: unknown }): Promise<RefreshResult> {
  assertAuthority(actor)
  if (deps.balancesEnabled !== true) throw new BankConnectionError('feature_disabled', 403, 'Bank balances are not enabled yet.')
  if (!deps.plaid.getAccountBalances) throw new BankConnectionError('plaid_unavailable', 502, 'The bank connection service is unavailable. Try again shortly.')
  const { item, envelope } = await loadCredential(deps, actor, input.itemId as string)
  if (item.status === 'disconnected' || !envelope) throw new BankConnectionError('conflict', 409, 'This bank connection is disconnected. Connect it again first.')
  const token = decryptFor(deps, actor, item, envelope)
  const org = actor.organizationId
  const retrievedMs = clock(deps), retrievedAt = new Date(retrievedMs).toISOString()
  let readings
  try {
    readings = await deps.plaid.getAccountBalances(token)
  } catch (error) {
    if (error instanceof PlaidApiFailure && error.code === 'ITEM_LOGIN_REQUIRED') {
      try { await deps.accounts.markItemLoginRequired(org, item.id) } catch { /* the owner message below is still correct */ }
      throw new BankConnectionError('login_required', 409, 'The bank needs you to sign in again. Use Reconnect.')
    }
    note(deps, { event: 'bank.balances.failed', organizationId: org, itemId: item.id, code: error instanceof PlaidApiFailure ? error.code : 'ERROR' })
    throw new BankConnectionError('plaid_unavailable', 502, 'The bank connection service is unavailable. Try again shortly.')
  }
  const accounts = new Map((await deps.accounts.listProviderAccounts(org, item.id)).filter(a => a.status === 'active').map(a => [a.providerAccountId, a]))
  const result: RefreshResult = { stored: 0, unchanged: 0, unknownAccounts: 0, rejected: 0, unsupportedCurrency: 0 }
  const writes = []
  const refs: string[] = []
  const seen = new Set<string>()
  for (const r of readings.slice(0, 200)) {
    if (!r || typeof r.accountId !== 'string' || seen.has(r.accountId)) { result.rejected += 1; continue }
    seen.add(r.accountId)
    const acct = accounts.get(r.accountId)
    if (!acct) { result.unknownAccounts += 1; continue } // a shared-but-unsaved account is never created here
    if (r.currency !== 'USD') { result.unsupportedCurrency += 1; continue }
    const current = toExactMinor(r.current), available = toExactMinor(r.available), limit = toExactMinor(r.limit)
    // A value the bank reported but that is not exact cents rejects the WHOLE account reading: a partially trusted balance is worse than none.
    if ((r.current !== null && current === null) || (r.available !== null && available === null) || (r.limit !== null && limit === null) || (current === null && available === null)) { result.rejected += 1; continue }
    const providerTime = trustedProviderTime(r.lastUpdatedAt, retrievedMs)
    writes.push({ organizationId: org, providerAccountRef: acct.id, observedAt: providerTime ?? retrievedAt, currentMinor: current, availableMinor: available, limitMinor: limit,
      retrievedAt, observedIsProvider: providerTime !== null, accountType: r.type, accountSubtype: r.subtype, source: BALANCE_SOURCE })
    refs.push(acct.id)
  }
  // A reading with no bank timestamp is taken "now"; skip it when the newest snapshot already says exactly the same within 15 minutes (no spam rows).
  const latest = await deps.balances.latestSnapshots(org, refs)
  const fresh = writes.filter(w => {
    const prev = latest.get(w.providerAccountRef)
    if (!prev) return true
    const same = prev.currentMinor === w.currentMinor && prev.availableMinor === w.availableMinor && prev.limitMinor === w.limitMinor
    if (same && !w.observedIsProvider && retrievedMs - Date.parse(prev.observedAt) < 15 * 60_000) return false
    return true
  })
  result.unchanged = writes.length - fresh.length
  try {
    const inserted = await deps.balances.insertSnapshots(fresh)
    result.stored = inserted
    result.unchanged += fresh.length - inserted // identical (account, bank timestamp) already stored
  } catch {
    throw new BankConnectionError('persistence_failed', 503, 'The balances could not be saved. Your connection is fine; try again.')
  }
  note(deps, { event: 'bank.balances.refreshed', organizationId: org, itemId: item.id, outcome: `${result.stored}/${result.unchanged}/${result.rejected}/${result.unknownAccounts}` })
  return result
}

export interface AccountBalanceView extends InterpretedBalance {
  /** Cash OS's internal provider-account row id (never the bank's own account id). */
  accountRef: string
  connectionId: string
  institutionName: string | null
  name: string | null
  mask: string | null
  type: string | null
  subtype: string | null
  live: boolean
  mappedFinancialAccountId: string | null
  /** Ownership of the MAPPED Cash OS account; null = not mapped (unmapped accounts are never counted as business or personal). */
  ownership: 'business' | 'personal' | null
}

/** Newest snapshot per live provider account, interpreted. Never includes provider ids, tokens or raw provider data. */
export async function getBalances(deps: BankBalanceDeps, actor: BankActor): Promise<{ accounts: AccountBalanceView[]; enabled: boolean }> {
  assertAuthority(actor)
  if (deps.balancesEnabled !== true) return { accounts: [], enabled: false }
  const org = actor.organizationId
  const [all, mappings, cash] = await Promise.all([deps.accounts.listAllProviderAccounts(org), deps.accounts.listActiveMappings(org), deps.accounts.listCashAccounts(org)])
  const ownerOf = new Map(cash.map(c => [c.id, c.ownershipContext === 'personal' ? 'personal' as const : c.ownershipContext === 'business' ? 'business' as const : null]))
  const live = all.filter(a => a.status === 'active' && a.itemStatus !== 'disconnected')
  const latest = await deps.balances.latestSnapshots(org, live.map(a => a.id))
  const mapped = new Map(mappings.map(m => [m.providerAccountRef, m.financialAccountId]))
  const now = clock(deps)
  return { enabled: true, accounts: live.map(a => ({
    ...interpretBalance({ type: a.providerAccountType, subtype: a.providerAccountSubtype }, latest.get(a.id) ?? null, now, a.itemStatus === 'healthy'),
    accountRef: a.id, connectionId: a.providerItemRef, institutionName: a.institutionName, name: a.name, mask: a.mask,
    type: a.providerAccountType, subtype: a.providerAccountSubtype, live: true, mappedFinancialAccountId: mapped.get(a.id) ?? null, ownership: ownerOf.get(mapped.get(a.id) ?? '') ?? null,
  })) }
}
export { classifyAccount }
