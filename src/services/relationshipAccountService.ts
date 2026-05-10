import { supabase } from '@/lib/supabase'

export type RelationshipEntityType = 'project' | 'service_log' | 'service_estimate' | 'active_service_call' | 'service_lead' | string

type RelationshipAccountInput = {
  id?: string
  role?: string
  company?: string
  contact?: string
  phone?: string
  email?: string
  address?: string
  city?: string
  notes?: string
  tags?: string
  legacy_gc_id?: string
  legacy_payload?: any
}

type LinkInput = {
  orgId?: string | null
  accountId: string
  entityType: RelationshipEntityType
  entityId: string
  entityLabel?: string
  legacyCustomerText?: string
  metadata?: any
  createdBy?: string | null
}

type EventInput = {
  orgId?: string | null
  accountId: string
  entityType: RelationshipEntityType
  entityId: string
  title?: string
  description?: string
  quotedAmount?: number
  collectedAmount?: number
  outstandingAmount?: number
  metadata?: any
  createdBy?: string | null
}

async function resolveContext(providedOrgId?: string | null, providedUserId?: string | null) {
  const { data } = await supabase.auth.getUser()
  const userId = providedUserId || data?.user?.id || null
  let orgId = providedOrgId || null
  if (!orgId && userId) {
    try {
      const { data: profile } = await (supabase as any)
        .from('profiles')
        .select('org_id')
        .eq('id', userId)
        .maybeSingle()
      orgId = profile?.org_id || null
    } catch (err) {
      console.warn('[relationshipAccountService] profile org lookup failed', err)
    }
  }
  return { orgId, userId }
}

export async function getRelationshipAccounts(orgId?: string | null) {
  const ctx = await resolveContext(orgId, null)
  if (!ctx.orgId) return []
  const { data, error } = await (supabase as any)
    .from('relationship_accounts')
    .select('*')
    .eq('org_id', ctx.orgId)
    .order('updated_at', { ascending: false })
  if (error) {
    console.warn('[relationshipAccountService] getRelationshipAccounts failed', error)
    return []
  }
  return data || []
}

export async function upsertRelationshipAccount({
  orgId,
  ownerUserId,
  account,
}: {
  orgId?: string | null
  ownerUserId?: string | null
  account: RelationshipAccountInput
}) {
  const ctx = await resolveContext(orgId, ownerUserId || null)
  if (!ctx.orgId) return null
  const payload = {
    id: account.id,
    org_id: ctx.orgId,
    owner_user_id: ownerUserId || ctx.userId || null,
    account_type: account.role || null,
    company: account.company || null,
    contact: account.contact || null,
    phone: account.phone || null,
    email: account.email || null,
    address: account.address || null,
    city: account.city || null,
    notes: account.notes || null,
    tags: account.tags || null,
    legacy_gc_id: account.legacy_gc_id || account.id || null,
    legacy_payload: account.legacy_payload ?? null,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await (supabase as any)
    .from('relationship_accounts')
    .upsert(payload, { onConflict: 'id' })
    .select()
    .maybeSingle()
  if (error) {
    console.warn('[relationshipAccountService] upsertRelationshipAccount failed', error)
    return null
  }
  return data
}

export async function linkEntityToAccount(input: LinkInput) {
  const ctx = await resolveContext(input.orgId, input.createdBy || null)
  if (!ctx.orgId || !input.accountId || !input.entityId) return null
  const payload = {
    org_id: ctx.orgId,
    account_id: input.accountId,
    entity_type: input.entityType,
    entity_id: input.entityId,
    entity_label: input.entityLabel || null,
    legacy_customer_text: input.legacyCustomerText || null,
    metadata: input.metadata ?? null,
    created_by: input.createdBy || ctx.userId || null,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await (supabase as any)
    .from('relationship_account_links')
    .upsert(payload, { onConflict: 'org_id,entity_type,entity_id' })
    .select()
    .maybeSingle()
  if (error) {
    console.warn('[relationshipAccountService] linkEntityToAccount failed', error)
    return null
  }
  return data
}

export async function upsertRelationshipEvent(input: EventInput) {
  const ctx = await resolveContext(input.orgId, input.createdBy || null)
  if (!ctx.orgId || !input.accountId || !input.entityId) return null

  let existing: any = null
  try {
    const { data } = await (supabase as any)
      .from('relationship_account_events')
      .select('id')
      .eq('org_id', ctx.orgId)
      .eq('entity_type', input.entityType)
      .eq('entity_id', input.entityId)
      .maybeSingle()
    existing = data || null
  } catch (err) {
    console.warn('[relationshipAccountService] event lookup failed', err)
  }

  const payload = {
    id: existing?.id || undefined,
    org_id: ctx.orgId,
    account_id: input.accountId,
    entity_type: input.entityType,
    entity_id: input.entityId,
    title: input.title || null,
    description: input.description || null,
    quoted_amount: input.quotedAmount ?? null,
    collected_amount: input.collectedAmount ?? null,
    outstanding_amount: input.outstandingAmount ?? null,
    metadata: input.metadata ?? null,
    created_by: input.createdBy || ctx.userId || null,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await (supabase as any)
    .from('relationship_account_events')
    .upsert(payload, { onConflict: 'id' })
    .select()
    .maybeSingle()
  if (error) {
    console.warn('[relationshipAccountService] upsertRelationshipEvent failed', error)
    return null
  }
  return data
}

export async function getRelationshipLinks(orgId?: string | null) {
  const ctx = await resolveContext(orgId, null)
  if (!ctx.orgId) return []
  const { data, error } = await (supabase as any)
    .from('relationship_account_links')
    .select('*')
    .eq('org_id', ctx.orgId)
    .order('updated_at', { ascending: false })
  if (error) {
    console.warn('[relationshipAccountService] getRelationshipLinks failed', error)
    return []
  }
  return data || []
}

export async function getRelationshipEvents(orgId?: string | null) {
  const ctx = await resolveContext(orgId, null)
  if (!ctx.orgId) return []
  const { data, error } = await (supabase as any)
    .from('relationship_account_events')
    .select('*')
    .eq('org_id', ctx.orgId)
    .order('updated_at', { ascending: false })
  if (error) {
    console.warn('[relationshipAccountService] getRelationshipEvents failed', error)
    return []
  }
  return data || []
}

