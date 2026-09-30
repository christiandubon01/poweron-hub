import { supabase } from '@/lib/supabase'
import { resolveFinanceContext } from './manualLedgerService'
import { readCashPages } from './cashReadPagination'
import type { CashOsBucket, CashOsEnvelope, CashOsEnvelopeBalance } from '@/finance/cashOsAllocationTypes'

function db(): any { return supabase as any }

function mapBucket(row: any): CashOsBucket {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description ?? null,
    color: row.color ?? null,
    archived: row.archived,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapEnvelope(row: any): CashOsEnvelope {
  return {
    id: row.id,
    organizationId: row.organization_id,
    bucketId: row.bucket_id ?? null,
    name: row.name,
    description: row.description ?? null,
    targetAmountMinor: row.target_amount_minor ?? null,
    archived: row.archived,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listCashOsBuckets(): Promise<CashOsBucket[]> {
  const ctx = await resolveFinanceContext()
  const rows = await readCashPages<any>(
    'cash_os_buckets',
    q => q.select('id,organization_id,name,description,color,archived,created_at,updated_at')
      .eq('organization_id', ctx.organizationId)
      .eq('archived', false),
    (table: string) => db().from(table),
  )
  if (rows.some((r: any) => r.organization_id !== ctx.organizationId)) throw new Error('CASH_OS_SCOPE_CHANGED')
  return rows.map(mapBucket)
}

export async function createCashOsBucket(input: {
  name: string
  description?: string | null
  color?: string | null
}): Promise<CashOsBucket> {
  const ctx = await resolveFinanceContext()
  const { data, error } = await db().from('cash_os_buckets').insert({
    organization_id: ctx.organizationId,
    name: input.name,
    description: input.description ?? null,
    color: input.color ?? null,
  }).select('id,organization_id,name,description,color,archived,created_at,updated_at').single()
  if (error) throw new Error(error.message)
  return mapBucket(data)
}

export async function updateCashOsBucket(
  id: string,
  update: { name?: string; description?: string | null; color?: string | null },
): Promise<CashOsBucket> {
  const ctx = await resolveFinanceContext()
  const { data, error } = await db().from('cash_os_buckets')
    .update({ ...update })
    .eq('id', id)
    .eq('organization_id', ctx.organizationId)
    .eq('archived', false)
    .select('id,organization_id,name,description,color,archived,created_at,updated_at')
    .single()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Bucket not found')
  return mapBucket(data)
}

export async function archiveCashOsBucket(id: string): Promise<void> {
  const ctx = await resolveFinanceContext()
  const { error } = await db().from('cash_os_buckets')
    .update({ archived: true })
    .eq('id', id)
    .eq('organization_id', ctx.organizationId)
    .eq('archived', false)
  if (error) throw new Error(error.message)
}

export async function listCashOsEnvelopes(): Promise<CashOsEnvelope[]> {
  const ctx = await resolveFinanceContext()
  const rows = await readCashPages<any>(
    'cash_os_envelopes',
    q => q.select('id,organization_id,bucket_id,name,description,target_amount_minor,archived,created_at,updated_at')
      .eq('organization_id', ctx.organizationId)
      .eq('archived', false),
    (table: string) => db().from(table),
  )
  if (rows.some((r: any) => r.organization_id !== ctx.organizationId)) throw new Error('CASH_OS_SCOPE_CHANGED')
  return rows.map(mapEnvelope)
}

export async function createCashOsEnvelope(input: {
  name: string
  description?: string | null
  targetAmountMinor?: number | null
  bucketId?: string | null
}): Promise<CashOsEnvelope> {
  const ctx = await resolveFinanceContext()
  const { data, error } = await db().from('cash_os_envelopes').insert({
    organization_id: ctx.organizationId,
    bucket_id: input.bucketId ?? null,
    name: input.name,
    description: input.description ?? null,
    target_amount_minor: input.targetAmountMinor ?? null,
  }).select('id,organization_id,bucket_id,name,description,target_amount_minor,archived,created_at,updated_at').single()
  if (error) throw new Error(error.message)
  return mapEnvelope(data)
}

export async function updateCashOsEnvelope(
  id: string,
  update: {
    name?: string
    description?: string | null
    targetAmountMinor?: number | null
    bucketId?: string | null
  },
): Promise<CashOsEnvelope> {
  const ctx = await resolveFinanceContext()
  const patch: Record<string, unknown> = {}
  if (update.name !== undefined) patch.name = update.name
  if (update.description !== undefined) patch.description = update.description
  if (update.targetAmountMinor !== undefined) patch.target_amount_minor = update.targetAmountMinor
  if (update.bucketId !== undefined) patch.bucket_id = update.bucketId
  const { data, error } = await db().from('cash_os_envelopes')
    .update(patch)
    .eq('id', id)
    .eq('organization_id', ctx.organizationId)
    .eq('archived', false)
    .select('id,organization_id,bucket_id,name,description,target_amount_minor,archived,created_at,updated_at')
    .single()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Envelope not found')
  return mapEnvelope(data)
}

export async function archiveCashOsEnvelope(id: string): Promise<void> {
  const ctx = await resolveFinanceContext()
  const { error } = await db().from('cash_os_envelopes')
    .update({ archived: true })
    .eq('id', id)
    .eq('organization_id', ctx.organizationId)
    .eq('archived', false)
  if (error) throw new Error(error.message)
}

export async function allocateToEnvelope(
  envelopeId: string,
  amountMinor: number,
  note?: string | null,
): Promise<void> {
  const ctx = await resolveFinanceContext()
  const { error } = await db().from('cash_os_envelope_entries').insert({
    organization_id: ctx.organizationId,
    envelope_id: envelopeId,
    amount_minor: amountMinor,
    direction: 'allocate',
    note: note ?? null,
  })
  if (error) throw new Error(error.message)
}

export async function releaseFromEnvelope(
  envelopeId: string,
  amountMinor: number,
  note?: string | null,
): Promise<void> {
  const ctx = await resolveFinanceContext()
  const { error } = await db().from('cash_os_envelope_entries').insert({
    organization_id: ctx.organizationId,
    envelope_id: envelopeId,
    amount_minor: amountMinor,
    direction: 'release',
    note: note ?? null,
  })
  if (error) throw new Error(error.message)
}

export async function transferBetweenEnvelopes(
  fromEnvelopeId: string,
  toEnvelopeId: string,
  amountMinor: number,
  note?: string | null,
): Promise<{ fromEntryId: string; toEntryId: string }> {
  const ctx = await resolveFinanceContext()
  const { data, error } = await db().rpc('transfer_between_envelopes', {
    p_organization_id: ctx.organizationId,
    p_from_envelope_id: fromEnvelopeId,
    p_to_envelope_id: toEnvelopeId,
    p_amount_minor: amountMinor,
    p_note: note ?? null,
  })
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  return { fromEntryId: row.from_entry_id, toEntryId: row.to_entry_id }
}

export async function readEnvelopeBalances(): Promise<CashOsEnvelopeBalance[]> {
  const ctx = await resolveFinanceContext()
  const [envelopes, entries] = await Promise.all([
    readCashPages<any>(
      'cash_os_envelopes',
      q => q.select('id').eq('organization_id', ctx.organizationId).eq('archived', false),
      (table: string) => db().from(table),
    ),
    readCashPages<any>(
      'cash_os_envelope_entries',
      q => q.select('envelope_id,amount_minor,direction').eq('organization_id', ctx.organizationId),
      (table: string) => db().from(table),
    ),
  ])
  const sums = new Map<string, { allocatedMinor: number; releasedMinor: number }>(
    envelopes.map((e: any) => [e.id, { allocatedMinor: 0, releasedMinor: 0 }]),
  )
  for (const entry of entries) {
    const s = sums.get(entry.envelope_id)
    if (!s) continue
    if (entry.direction === 'allocate') s.allocatedMinor += entry.amount_minor
    else s.releasedMinor += entry.amount_minor
  }
  return [...sums.entries()].map(([envelopeId, s]) => ({
    envelopeId,
    allocatedMinor: s.allocatedMinor,
    releasedMinor: s.releasedMinor,
    balanceMinor: s.allocatedMinor - s.releasedMinor,
  }))
}
