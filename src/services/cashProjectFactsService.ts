import { supabase } from '@/lib/supabase'
import { resolveFinanceContext } from './manualLedgerService'
import { readCashPages } from './cashReadPagination'
import {
  projectFactsPayload, validateProjectFactsInput,
  type CashProjectFactsInput, type CashProjectFactsRow,
} from '@/finance/cashProjectFacts'

function db(): any {
  return supabase as any
}

/** Read every project-facts row for the caller's organization. */
export async function readCashProjectFacts(): Promise<CashProjectFactsRow[]> {
  const ctx = await resolveFinanceContext()
  const rows = await readCashPages<CashProjectFactsRow>(
    'cash_project_facts',
    q => q.select('*').eq('organization_id', ctx.organizationId),
    db().from.bind(db()),
  )
  if (rows.some(row => row.organization_id !== ctx.organizationId)) throw new Error('Project facts organization mismatch')
  return rows
}

/**
 * Save the owner's facts for one project. Organization is always derived from the session. Only the keys
 * provided are written; this never creates a transaction, receivable, or project change.
 */
export async function upsertCashProjectFacts(projectId: string, input: CashProjectFactsInput): Promise<CashProjectFactsRow> {
  if (!projectId || !projectId.trim()) throw new Error('projectId required')
  const problem = validateProjectFactsInput(input)
  if (problem) throw new Error(problem)
  const ctx = await resolveFinanceContext()
  const { data, error } = await db()
    .from('cash_project_facts')
    .upsert(
      { organization_id: ctx.organizationId, project_id: projectId.trim(), ...projectFactsPayload(input) },
      { onConflict: 'organization_id,project_id' },
    )
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  if (data.organization_id !== ctx.organizationId) throw new Error('Project facts organization mismatch')
  return data as CashProjectFactsRow
}
