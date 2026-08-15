/**
 * LEAD-SRC-3B — durable call log service.
 *
 * Organization authority via user_org_id.
 * Hunter tenant via resolveHunterTenantId (no user_tenants LIMIT 1).
 * Does not write phones to pilot telemetry.
 */

import { supabase } from '@/lib/supabase'
import {
  resolveHunterTenantId,
  resolveHunterTenantIdOrNull,
} from '@/services/hunter/resolveHunterTenantId'
import {
  linksFromMatchResult,
  matchEntitiesByNormalizedPhone,
  type CallEntityCandidate,
  type CallEntityMatchResult,
} from './matchCallEntities'
import { normalizePhone, openTelDialer } from './phoneNormalize'

export const CALL_DIRECTIONS = ['inbound', 'outbound'] as const
export type CallDirection = (typeof CALL_DIRECTIONS)[number]

export const CALL_OUTCOMES = [
  'unknown',
  'answered',
  'missed',
  'no_answer',
  'voicemail',
] as const
export type CallOutcome = (typeof CALL_OUTCOMES)[number]

export const CALL_CLASSIFICATIONS = [
  'unclassified',
  'new_lead',
  'existing_customer',
  'spam',
  'vendor',
  'other',
] as const
export type CallClassification = (typeof CALL_CLASSIFICATIONS)[number]

export interface CallLog {
  id: string
  organizationId: string
  hunterTenantId: string | null
  loggedBy: string
  occurredAt: string
  createdAt: string
  updatedAt: string
  direction: CallDirection
  outcome: CallOutcome
  classification: CallClassification
  phoneRaw: string
  phoneNormalized: string | null
  notes: string | null
  hunterLeadId: string | null
  portalRequestId: string | null
  clientId: string | null
}

export interface CreateCallLogInput {
  phoneRaw: string
  direction: CallDirection
  outcome?: CallOutcome
  classification?: CallClassification
  notes?: string | null
  occurredAt?: string
  hunterLeadId?: string | null
  portalRequestId?: string | null
  clientId?: string | null
  /** When true (default for Hunter lead calls), resolve mapped hunter tenant. */
  requireHunterTenant?: boolean
  /** Auto-link from phone match when no explicit entity ids provided. */
  autoLinkFromMatch?: boolean
}

export class CallLogAuthorityError extends Error {
  readonly code: 'call_log_unauthenticated' | 'call_log_org_missing'

  constructor(code: CallLogAuthorityError['code'], message?: string) {
    super(message ?? code)
    this.name = 'CallLogAuthorityError'
    this.code = code
  }
}

function mapRow(row: Record<string, unknown>): CallLog {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    hunterTenantId: row.hunter_tenant_id ? String(row.hunter_tenant_id) : null,
    loggedBy: String(row.logged_by),
    occurredAt: String(row.occurred_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    direction: row.direction as CallDirection,
    outcome: row.outcome as CallOutcome,
    classification: row.classification as CallClassification,
    phoneRaw: String(row.phone_raw),
    phoneNormalized: row.phone_normalized ? String(row.phone_normalized) : null,
    notes: row.notes != null ? String(row.notes) : null,
    hunterLeadId: row.hunter_lead_id ? String(row.hunter_lead_id) : null,
    portalRequestId: row.portal_request_id ? String(row.portal_request_id) : null,
    clientId: row.client_id ? String(row.client_id) : null,
  }
}

async function resolveActiveOrganizationId(): Promise<{
  userId: string
  organizationId: string
}> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user?.id) {
    throw new CallLogAuthorityError(
      'call_log_unauthenticated',
      'Not authenticated; cannot write call logs.',
    )
  }

  const { data: orgIdRaw, error: orgError } = await (supabase as any).rpc(
    'user_org_id',
  )
  const organizationId =
    typeof orgIdRaw === 'string' && orgIdRaw.trim() ? orgIdRaw.trim() : null
  if (orgError || !organizationId) {
    throw new CallLogAuthorityError(
      'call_log_org_missing',
      'No active organization; cannot write call logs.',
    )
  }

  return { userId: user.id, organizationId }
}

function entityLabel(row: {
  contact_name?: string | null
  company_name?: string | null
  name?: string | null
  company?: string | null
}): string {
  return (
    (row.contact_name || row.name || row.company_name || row.company || 'Unknown').trim() ||
    'Unknown'
  )
}

/** Read-only candidate fetch for matching. Never mutates source rows. */
export async function collectPhoneMatchCandidates(params: {
  organizationId: string
  hunterTenantId?: string | null
}): Promise<CallEntityCandidate[]> {
  const candidates: CallEntityCandidate[] = []

  const { data: portalRows } = await (supabase as any)
    .from('portal_requests')
    .select('id, phone, name')
    .eq('organization_id', params.organizationId)
    .not('phone', 'is', null)
    .limit(500)

  for (const row of portalRows ?? []) {
    candidates.push({
      kind: 'portal_request',
      id: String(row.id),
      label: entityLabel(row),
      phoneRaw: row.phone,
    })
  }

  const { data: clientRows } = await (supabase as any)
    .from('clients')
    .select('id, phone, name, company')
    .eq('org_id', params.organizationId)
    .not('phone', 'is', null)
    .limit(500)

  for (const row of clientRows ?? []) {
    candidates.push({
      kind: 'client',
      id: String(row.id),
      label: entityLabel(row),
      phoneRaw: row.phone,
    })
  }

  if (params.hunterTenantId) {
    const { data: leadRows } = await (supabase as any)
      .from('hunter_leads')
      .select('id, phone, contact_name, company_name')
      .eq('tenant_id', params.hunterTenantId)
      .not('phone', 'is', null)
      .limit(500)

    for (const row of leadRows ?? []) {
      candidates.push({
        kind: 'hunter_lead',
        id: String(row.id),
        label: entityLabel(row),
        phoneRaw: row.phone,
      })
    }
  }

  return candidates
}

export async function matchPhoneAgainstOrgEntities(
  phoneRaw: string,
): Promise<CallEntityMatchResult> {
  const { organizationId } = await resolveActiveOrganizationId()
  const hunterTenantId = await resolveHunterTenantIdOrNull()
  const candidates = await collectPhoneMatchCandidates({
    organizationId,
    hunterTenantId,
  })
  return matchEntitiesByNormalizedPhone(phoneRaw, candidates)
}

export async function createCallLog(
  input: CreateCallLogInput,
): Promise<CallLog> {
  const phoneRaw = String(input.phoneRaw || '').trim()
  if (!phoneRaw) {
    throw new Error('phone_raw is required')
  }

  const { userId, organizationId } = await resolveActiveOrganizationId()
  const phoneNormalized = normalizePhone(phoneRaw)

  let hunterTenantId: string | null = null
  const needsHunter =
    input.requireHunterTenant === true ||
    Boolean(input.hunterLeadId) ||
    input.autoLinkFromMatch === true

  if (needsHunter) {
    try {
      hunterTenantId = input.requireHunterTenant
        ? await resolveHunterTenantId()
        : await resolveHunterTenantIdOrNull()
    } catch (err) {
      if (input.requireHunterTenant) throw err
      hunterTenantId = null
    }
  }

  let hunterLeadId = input.hunterLeadId ?? null
  let portalRequestId = input.portalRequestId ?? null
  let clientId = input.clientId ?? null

  if (
    input.autoLinkFromMatch &&
    !hunterLeadId &&
    !portalRequestId &&
    !clientId
  ) {
    const candidates = await collectPhoneMatchCandidates({
      organizationId,
      hunterTenantId,
    })
    const match = matchEntitiesByNormalizedPhone(phoneRaw, candidates)
    const links = linksFromMatchResult(match)
    hunterLeadId = links.hunter_lead_id ?? null
    portalRequestId = links.portal_request_id ?? null
    clientId = links.client_id ?? null
    if (hunterLeadId && !hunterTenantId) {
      hunterTenantId = await resolveHunterTenantIdOrNull()
    }
  }

  if (hunterLeadId && !hunterTenantId) {
    hunterTenantId = await resolveHunterTenantId()
  }

  const payload = {
    organization_id: organizationId,
    hunter_tenant_id: hunterTenantId,
    logged_by: userId,
    occurred_at: input.occurredAt ?? new Date().toISOString(),
    direction: input.direction,
    outcome: input.outcome ?? 'unknown',
    classification: input.classification ?? 'unclassified',
    phone_raw: phoneRaw.slice(0, 40),
    phone_normalized: phoneNormalized,
    notes: input.notes?.trim() ? input.notes.trim().slice(0, 5000) : null,
    hunter_lead_id: hunterLeadId,
    portal_request_id: portalRequestId,
    client_id: clientId,
  }

  const { data, error } = await (supabase as any)
    .from('call_logs')
    .insert(payload)
    .select('*')
    .single()

  if (error) throw new Error(error.message || 'Failed to create call log')
  return mapRow(data)
}

export async function updateCallLogClassification(params: {
  callLogId: string
  classification?: CallClassification
  outcome?: CallOutcome
  notes?: string | null
}): Promise<CallLog> {
  await resolveActiveOrganizationId()

  const patch: Record<string, unknown> = {}
  if (params.classification != null) patch.classification = params.classification
  if (params.outcome != null) patch.outcome = params.outcome
  if (params.notes !== undefined) {
    patch.notes =
      params.notes == null || !String(params.notes).trim()
        ? null
        : String(params.notes).trim().slice(0, 5000)
  }

  if (Object.keys(patch).length === 0) {
    throw new Error('No call log fields to update')
  }

  const { data, error } = await (supabase as any)
    .from('call_logs')
    .update(patch)
    .eq('id', params.callLogId)
    .select('*')
    .single()

  if (error) throw new Error(error.message || 'Failed to update call log')
  return mapRow(data)
}

export async function fetchRecentCallLogs(limit = 25): Promise<CallLog[]> {
  const { organizationId } = await resolveActiveOrganizationId()
  const { data, error } = await (supabase as any)
    .from('call_logs')
    .select('*')
    .eq('organization_id', organizationId)
    .order('occurred_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100))

  if (error) throw new Error(error.message || 'Failed to fetch call logs')
  return (data ?? []).map(mapRow)
}

export async function fetchCallLogsForHunterLead(
  hunterLeadId: string,
  limit = 25,
): Promise<CallLog[]> {
  const { organizationId } = await resolveActiveOrganizationId()
  const { data, error } = await (supabase as any)
    .from('call_logs')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('hunter_lead_id', hunterLeadId)
    .order('occurred_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100))

  if (error) throw new Error(error.message || 'Failed to fetch lead call logs')
  return (data ?? []).map(mapRow)
}

/**
 * Log a Hunter outbound attempt inside PowerOn.
 * External tel: dialer is OPTIONAL — only when openDialer=true.
 * Logging does not claim the call connected (outcome=unknown).
 */
export async function initiateHunterOutboundCall(params: {
  leadId: string
  phone: string
  /** When true, invoke tel: after attempting to log. Default false. */
  openDialer?: boolean
  openHref?: (href: string) => void
}): Promise<{
  dialerOpened: boolean
  callLog: CallLog | null
  logError: string | null
}> {
  let callLog: CallLog | null = null
  let logError: string | null = null
  try {
    callLog = await createCallLog({
      phoneRaw: params.phone,
      direction: 'outbound',
      outcome: 'unknown',
      classification: 'unclassified',
      hunterLeadId: params.leadId,
      requireHunterTenant: true,
      autoLinkFromMatch: false,
    })
  } catch (err) {
    logError = err instanceof Error ? err.message : 'Failed to log call'
  }

  const dialerOpened =
    params.openDialer === true
      ? openTelDialer(params.phone, params.openHref)
      : false

  return { dialerOpened, callLog, logError }
}
