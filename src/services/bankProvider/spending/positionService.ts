/**
 * src/services/bankProvider/spending/positionService.ts
 *
 * SERVER-ONLY (PLAID-3C). The consolidated position of the owner's connected money, built from the application's own data paths, read-only:
 *
 *   balances    getBalances (newest provider snapshot per live account of THIS environment, interpreted, with freshness)
 *   activity    the same derived rows the Explorer, Smart Review and the BANK-6G reports read (explorerFromContext), loaded the best way the database allows
 *   sync state  the connections' own status and last successful sync
 *
 * Trust model: the organization and the acting user come from the authenticated profile (a request can name neither); the only request value read is the window
 * length (30 / 60 / 90 days). Off unless the server sets CASH_OS_POSITION_ENABLED=true: while off it returns `{ enabled: false }` BEFORE reading anything.
 * It writes nothing and calls no bank. A section that cannot be read is reported as unreadable (and logged); it is never shown as zero or as "no accounts".
 *
 * The browser merges the manual ledger it already holds (compareManualLedger in src/finance/bankPosition.ts): the server does not read the ledger, so the two
 * can never be silently blended here.
 */
import { assertAuthority, type BankActor, type BankConnectionView } from '../bankConnectionService'
import { classifyAccount, type AccountClass } from '../balanceModel'
import { getBalances, type AccountBalanceView, type BalanceReadDeps } from '../bankBalanceService'
import { addDays } from './analytics'
import { buildPosition } from './consolidatedPosition'
import { explorerFromContext, loadContextForRange, type SpendingDeps } from './spendingService'
import type { PositionResponse } from '../../../finance/bankPosition'

export interface PositionDeps extends SpendingDeps {
  /** CASH_OS_POSITION_ENABLED === 'true' (server configuration). */
  positionEnabled?: boolean
  /** PLAID_BALANCES_ENABLED === 'true' (server configuration). */
  balancesEnabled?: boolean
  accounts: BalanceReadDeps['accounts']
  balances: BalanceReadDeps['balances']
  connections: { listItems(organizationId: string): Promise<BankConnectionView[]> }
}

export const POSITION_WINDOWS = [30, 60, 90] as const
const clock = (d: { now?: () => number }) => (d.now ? d.now() : Date.now())

export async function getConsolidatedPosition(deps: PositionDeps, actor: BankActor, raw: Record<string, unknown> = {}): Promise<PositionResponse> {
  assertAuthority(actor)
  if (deps.positionEnabled !== true) return { enabled: false } // nothing below runs: a switched-off position reads no data at all
  const nowMs = clock(deps)
  const asOf = new Date(nowMs).toISOString().slice(0, 10)
  const days = (POSITION_WINDOWS as readonly number[]).includes(Number(raw.days)) ? Number(raw.days) : 30
  const window = { from: addDays(asOf, -(days - 1)), to: asOf, days }
  const environment: 'sandbox' | 'production' = deps.environment === 'production' ? 'production' : 'sandbox'
  const org = actor.organizationId
  const guarded = async <T>(section: string, run: () => Promise<T>): Promise<T | null> => {
    try { return await run() } catch { try { deps.log?.({ event: `bank.position.${section}_failed`, organizationId: org, code: 'persistence_failed' }) } catch { /* logging never breaks the read */ } return null }
  }

  const balancesOn = deps.balancesEnabled === true
  const [balanceResult, items, evidence] = await Promise.all([
    balancesOn ? guarded('balances', () => getBalances({ accounts: deps.accounts, balances: deps.balances, balancesEnabled: true, environment, now: deps.now }, actor)) : Promise.resolve({ accounts: [] as AccountBalanceView[], enabled: false }),
    guarded('connections', () => deps.connections.listItems(org)),
    // pairs are at most a week apart, so two weeks before the window is enough to see both legs of anything that touches it
    guarded('activity', () => loadContextForRange(deps, org, { completeSince: addDays(window.from, -14), explorerSince: addDays(window.from, -14) })),
  ])

  // Rows of THIS environment only (the Explorer's "all" view also lists the other environment's evidence; a Sandbox test row is never real activity).
  const rows = evidence ? explorerFromContext(evidence.ctx, asOf, 'all', environment).rows.filter(r => r.account.environment === environment) : null
  const balances = balanceResult?.accounts ?? []
  // Account classes: the bank's own type/subtype, from the interpreted balances and from the evidence's account list (either is enough).
  const accountClassOf = new Map<string, AccountClass>()
  for (const a of evidence?.ctx.accounts ?? []) if (a.providerType || a.providerSubtype) accountClassOf.set(a.providerAccountRef, classifyAccount(a.providerType, a.providerSubtype).accountClass)
  for (const b of balances) accountClassOf.set(b.accountRef, b.accountClass)

  return buildPosition({
    nowMs, environment, balancesEnabled: balancesOn, balances, rows, accountClassOf, window, coverage: evidence?.coverage ?? { complete: false, reason: 'Bank activity could not be read.' },
    syncs: (items ?? []).filter(i => i.environment === environment && i.status !== 'disconnected').map(i => ({ label: i.institutionName ?? 'Your bank', status: i.status, lastSyncedAt: i.lastSuccessfulSyncAt })),
    reconciliation: deps.reconciliationEnabled === true, balancesError: balancesOn && balanceResult === null, syncError: items === null,
  })
}
