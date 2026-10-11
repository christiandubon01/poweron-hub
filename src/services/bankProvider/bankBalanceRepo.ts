/**
 * src/services/bankProvider/bankBalanceRepo.ts
 *
 * SERVER-ONLY (PLAID-2E). Persistence of provider balance SNAPSHOTS over a Supabase SERVICE-ROLE client, into the existing append-only table
 * financial_provider_balance_snapshots (migration 153, already installed: no new SQL). It never reads or writes financial_accounts, the
 * ledger, mappings or transactions, so a provider balance can never overwrite a manual-ledger balance. Every query is organization-scoped.
 */
type Svc = { from: (table: string) => any }

export interface BalanceSnapshotRow {
  providerAccountRef: string
  observedAt: string
  currentMinor: number | null
  availableMinor: number | null
  limitMinor: number | null
  retrievedAt: string
  observedIsProvider: boolean
  source: string
}
export interface BalanceSnapshotWrite {
  organizationId: string
  providerAccountRef: string
  observedAt: string
  currentMinor: number | null
  availableMinor: number | null
  limitMinor: number | null
  retrievedAt: string
  observedIsProvider: boolean
  accountType: string | null
  accountSubtype: string | null
  source: string
}
export interface BankBalanceRepo {
  /** Idempotent on (account, observed_at, source): an identical reading is ignored, never updated. Returns how many rows were new. */
  insertSnapshots(rows: BalanceSnapshotWrite[]): Promise<number>
  /** The newest snapshot per provider account (organization-scoped). Accounts without a snapshot are absent. */
  latestSnapshots(organizationId: string, providerAccountRefs: string[]): Promise<Map<string, BalanceSnapshotRow>>
}

export const BALANCE_SOURCE = 'plaid_accounts_get'
const minor = (decimal: unknown): number | null => (decimal === null || decimal === undefined ? null : Math.round(Number(decimal) * 100))
function failed(): never { throw new Error('balance persistence failed') }

export function createBankBalanceRepo(svc: Svc): BankBalanceRepo {
  return {
    async insertSnapshots(rows) {
      if (rows.length === 0) return 0
      const payload = rows.map(r => ({
        organization_id: r.organizationId, provider_account_ref: r.providerAccountRef, observed_at: r.observedAt,
        current_balance: r.currentMinor === null ? null : r.currentMinor / 100, current_balance_minor: r.currentMinor,
        available_balance: r.availableMinor === null ? null : r.availableMinor / 100, available_balance_minor: r.availableMinor,
        currency: 'USD', source: r.source,
        // Allowlisted evidence only: the credit limit has no column, so it lives here with the provider's own timestamp semantics.
        raw_evidence: { retrieved_at: r.retrievedAt, observed_is_provider: r.observedIsProvider, account_type: r.accountType, account_subtype: r.accountSubtype,
          credit_limit_minor: r.limitMinor },
      }))
      const { data, error } = await svc.from('financial_provider_balance_snapshots')
        .upsert(payload, { onConflict: 'provider_account_ref,observed_at,source', ignoreDuplicates: true }).select('id')
      if (error) failed()
      return Array.isArray(data) ? data.length : 0
    },
    async latestSnapshots(organizationId, refs) {
      const out = new Map<string, BalanceSnapshotRow>()
      for (const ref of refs) {
        const { data, error } = await svc.from('financial_provider_balance_snapshots')
          .select('provider_account_ref, observed_at, current_balance, available_balance, source, raw_evidence')
          .eq('organization_id', organizationId).eq('provider_account_ref', ref).order('observed_at', { ascending: false }).limit(1)
        if (error) failed()
        const r = data?.[0]
        if (!r) continue
        const ev = r.raw_evidence ?? {}
        out.set(ref, {
          providerAccountRef: ref, observedAt: new Date(r.observed_at).toISOString(), currentMinor: minor(r.current_balance), availableMinor: minor(r.available_balance),
          limitMinor: typeof ev.credit_limit_minor === 'number' ? ev.credit_limit_minor : null,
          retrievedAt: typeof ev.retrieved_at === 'string' ? ev.retrieved_at : new Date(r.observed_at).toISOString(),
          observedIsProvider: ev.observed_is_provider === true, source: r.source,
        })
      }
      return out
    },
  }
}
