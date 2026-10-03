import { supabase } from '@/lib/supabase'
import { resolveFinanceContext } from './manualLedgerService'
import { readCashPages } from './cashReadPagination'
import type { LiabilityTermsInput, LiabilityTermsRow } from '@/finance/liabilityTermsTypes'

function db(): any {
  return supabase as any
}

/** Read all liability terms rows for the calling user's org. */
export async function readLiabilityTerms(): Promise<LiabilityTermsRow[]> {
  const ctx = await resolveFinanceContext()
  const rows = await readCashPages<LiabilityTermsRow>(
    'financial_liability_terms',
    q => q.select('*').eq('organization_id', ctx.organizationId),
    db().from.bind(db()),
  )
  if (rows.some(r => r.organization_id !== ctx.organizationId)) {
    throw new Error('Liability terms organization mismatch')
  }
  return rows
}

/**
 * Upsert debt contract terms for a single liability account.
 * Organization is always derived from the authenticated session — never caller-supplied.
 * Editing terms does NOT create financial transactions; balance authority remains the ledger.
 */
export async function upsertLiabilityTerms(
  accountId: string,
  terms: LiabilityTermsInput,
): Promise<LiabilityTermsRow> {
  if (!accountId) throw new Error('accountId required')
  const ctx = await resolveFinanceContext()

  // Verify the target account belongs to caller's org and is a liability-class account.
  // asset accounts (checking, savings, cash, other_asset) must be rejected before upsert.
  const { data: acct, error: acctErr } = await db()
    .from('financial_accounts')
    .select('id, organization_id, account_class')
    .eq('id', accountId)
    .eq('organization_id', ctx.organizationId)
    .single()
  if (acctErr || !acct) throw new Error(`Account not found in organization: ${accountId}`)
  if (acct.account_class !== 'liability') {
    throw new Error(
      `Account ${accountId} has account_class '${acct.account_class}', must be 'liability'`,
    )
  }

  const { data, error } = await db()
    .from('financial_liability_terms')
    .upsert(
      {
        organization_id: ctx.organizationId,
        account_id: accountId,
        ...terms,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id,organization_id' },
    )
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  if (data.organization_id !== ctx.organizationId) throw new Error('Liability terms organization mismatch')
  return data as LiabilityTermsRow
}
