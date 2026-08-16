/**
 * LEAD-SRC-4B / 4H / 4I — Private referral index + canonical referral profiles.
 *
 * Owner-side only. No public surface. No aggregated analytics (LEAD-SRC-6).
 * Conservative automatic matching: exact email/phone/full-name only.
 * No automatic resolution — suggestion → owner confirms.
 *
 * LEAD-SRC-4I:
 *   • referral_profiles = canonical referrer identity (may exist without Client/Lead)
 *   • resolved = claim assigned to exactly one referral_profile_id
 *   • Create Referrer Profile without creating Client/Hunter Lead
 *   • Owner search across profiles, clients, service-call customers, hunter leads
 *   • Project customers reuse clients (SQL projects.client_id → clients)
 */

import { supabase } from '@/lib/supabase'
import { normalizePhone } from '@/services/calls/phoneNormalize'

export type ResolutionStatus = 'unresolved' | 'resolved' | 'ambiguous' | 'confirmed_unlinked'

export type OwnerSearchSource =
  | 'referral_profile'
  | 'client'
  | 'service_customer'
  | 'hunter_lead'

export interface ReferralClaim {
  id: string
  organization_id: string
  portal_request_id: string
  raw_referral_text: string
  resolution_status: ResolutionStatus
  referral_profile_id: string | null
  resolved_client_id: string | null
  resolved_lead_id: string | null
  resolved_by: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export interface ReferralProfile {
  id: string
  organization_id: string
  display_name: string
  normalized_name: string
  linked_client_id: string | null
  linked_hunter_lead_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface ReferralCandidate {
  type: 'client' | 'lead' | 'profile'
  id: string
  display_name: string
  email: string | null
  phone: string | null
  match_reason: 'name' | 'email' | 'phone'
}

export type MatchConfidence = 'suggestion' | 'ambiguous' | 'unresolved'

export interface ReferralCandidateResult {
  confidence: MatchConfidence
  candidates: ReferralCandidate[]
}

export interface ResolveReferralInput {
  client_id?: string
  lead_id?: string
  profile_id?: string
}

// ── Private text extractors ───────────────────────────────────────────────────

export function extractEmailFromText(text: string): string | null {
  const m = text.match(/[\w.+%'"-]+@[\w-]+(?:\.[a-z]{2,})+/i)
  return m ? m[0].toLowerCase() : null
}

export function extractPhoneFromText(text: string): string | null {
  const patterns = text.match(/\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/g)
  if (!patterns) return null
  for (const p of patterns) {
    const norm = normalizePhone(p)
    if (norm) return norm
  }
  return null
}

export function isLikelyFullName(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || !/ /.test(trimmed)) return false
  if (trimmed.includes('@')) return false
  if (/\d{7,}/.test(trimmed)) return false
  const tokens = trimmed.split(/\s+/)
  return tokens.length >= 2 && tokens.every(t => t.length > 0)
}

export function normalizeReferralName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Matches migration 130 referral_profiles_display_maxlen. */
export const REFERRAL_PROFILE_DISPLAY_NAME_MAX = 200

// ── Internal paging helper ────────────────────────────────────────────────────

const PHONE_PAGE_SIZE = 500

async function paginatePhoneRows<T>(table: string, selectCols: string): Promise<T[]> {
  const rows: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await (supabase as any)
      .from(table)
      .select(selectCols)
      .not('phone', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + PHONE_PAGE_SIZE - 1)
    if (error) throw new Error(`paginatePhoneRows(${table}): ${error.message}`)
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < PHONE_PAGE_SIZE) break
    from += PHONE_PAGE_SIZE
  }
  return rows
}

// ── Extended types ────────────────────────────────────────────────────────────

export interface ReferralClaimWithPortalInfo extends ReferralClaim {
  portal_requests?: {
    id: string
    name: string
    status: string | null
    created_at: string
  } | null
  referral_profiles?: ReferralProfile | null
}

export interface ResolvedReferralClaim extends ReferralClaimWithPortalInfo {
  clients?: { id: string; name: string } | null
  hunter_leads?: { id: string; contact_name: string } | null
}

export interface ReferralProfileWithHistory extends ReferralProfile {
  claim_count: number
  most_recent_at: string | null
  claims: ResolvedReferralClaim[]
  linked_label: string | null
}

export interface OwnerSearchCandidate {
  source: OwnerSearchSource
  id: string
  display_name: string
  email: string | null
  phone: string | null
  /** Present for service_customer hits (BackupData / assignment free-text). */
  service_call_id?: string | null
}

/**
 * Build a PostgREST-safe `ilike` pattern for `.or(...)` filters.
 */
function toSafeOwnerSearchIlikePattern(query: string): string | null {
  const literal = query.replace(/[%_]/g, '')
  if (!literal.trim()) return null
  const pattern = `%${literal}%`
  return `"${pattern.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

async function getAuthUserId(): Promise<string | null> {
  const { data: { user } } = await (supabase as any).auth.getUser()
  return user?.id ?? null
}

async function fetchClaimRow(claimId: string): Promise<ReferralClaim> {
  const { data, error } = await (supabase as any)
    .from('referral_claims')
    .select('*')
    .eq('id', claimId)
    .maybeSingle()
  if (error) throw new Error(`fetchClaimRow: ${error.message}`)
  if (!data) throw new Error(`fetchClaimRow: claim not found (${claimId})`)
  return data as ReferralClaim
}

async function insertReferralProfile(input: {
  organization_id: string
  display_name: string
  linked_client_id?: string | null
  linked_hunter_lead_id?: string | null
}): Promise<ReferralProfile> {
  const display = input.display_name.trim()
  if (!display) throw new Error('insertReferralProfile: display_name required')
  if (display.length > REFERRAL_PROFILE_DISPLAY_NAME_MAX) {
    throw new Error(
      `insertReferralProfile: display name too long (max ${REFERRAL_PROFILE_DISPLAY_NAME_MAX})`
    )
  }
  const userId = await getAuthUserId()
  const now = new Date().toISOString()
  const { data, error } = await (supabase as any)
    .from('referral_profiles')
    .insert({
      organization_id:       input.organization_id,
      display_name:          display,
      normalized_name:       normalizeReferralName(display),
      linked_client_id:      input.linked_client_id ?? null,
      linked_hunter_lead_id: input.linked_hunter_lead_id ?? null,
      created_by:            userId,
      created_at:            now,
      updated_at:            now,
    })
    .select('*')
    .single()
  if (error) throw new Error(`insertReferralProfile: ${error.message}`)
  return data as ReferralProfile
}

async function findProfileByLinkedClient(
  organizationId: string,
  clientId: string
): Promise<ReferralProfile | null> {
  const { data, error } = await (supabase as any)
    .from('referral_profiles')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('linked_client_id', clientId)
    .maybeSingle()
  if (error) throw new Error(`findProfileByLinkedClient: ${error.message}`)
  return data ?? null
}

async function findProfileByLinkedLead(
  organizationId: string,
  leadId: string
): Promise<ReferralProfile | null> {
  const { data, error } = await (supabase as any)
    .from('referral_profiles')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('linked_hunter_lead_id', leadId)
    .maybeSingle()
  if (error) throw new Error(`findProfileByLinkedLead: ${error.message}`)
  return data ?? null
}

async function ensureProfileForClient(
  organizationId: string,
  clientId: string
): Promise<ReferralProfile> {
  const existing = await findProfileByLinkedClient(organizationId, clientId)
  if (existing) return existing

  const { data: client, error } = await (supabase as any)
    .from('clients')
    .select('id, name')
    .eq('id', clientId)
    .maybeSingle()
  if (error) throw new Error(`ensureProfileForClient: ${error.message}`)
  if (!client) throw new Error('ensureProfileForClient: client not found')

  return insertReferralProfile({
    organization_id:  organizationId,
    display_name:     client.name,
    linked_client_id: clientId,
  })
}

async function ensureProfileForLead(
  organizationId: string,
  leadId: string
): Promise<ReferralProfile> {
  const existing = await findProfileByLinkedLead(organizationId, leadId)
  if (existing) return existing

  const { data: lead, error } = await (supabase as any)
    .from('hunter_leads')
    .select('id, contact_name')
    .eq('id', leadId)
    .maybeSingle()
  if (error) throw new Error(`ensureProfileForLead: ${error.message}`)
  if (!lead) throw new Error('ensureProfileForLead: lead not found')

  return insertReferralProfile({
    organization_id:         organizationId,
    display_name:            (lead.contact_name || 'Unknown referrer').trim() || 'Unknown referrer',
    linked_hunter_lead_id:   leadId,
  })
}

async function assignClaimToProfile(
  claimId: string,
  profile: ReferralProfile
): Promise<void> {
  const userId = await getAuthUserId()
  const now = new Date().toISOString()
  const { error } = await (supabase as any)
    .from('referral_claims')
    .update({
      resolution_status:    'resolved',
      referral_profile_id:  profile.id,
      resolved_client_id:   profile.linked_client_id,
      resolved_lead_id:     profile.linked_hunter_lead_id,
      resolved_by:          userId,
      resolved_at:          now,
      updated_at:           now,
    })
    .eq('id', claimId)
  if (error) throw new Error(`assignClaimToProfile: ${error.message}`)
}

// ── Owner candidate search (private) ─────────────────────────────────────────

/**
 * Private owner search — profiles, clients (incl. project customers via client_id),
 * service-call assignment customer names, and hunter leads.
 *
 * Owner explicitly selects a result; no automatic linking occurs.
 * Results capped at `limit` (default/max 20).
 *
 * NOT a public RPC. NOT exposed in CustomerPortalView.
 */
export async function searchOwnerCandidates(
  query: string,
  limit = 20
): Promise<OwnerSearchCandidate[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const capped = Math.min(Math.max(1, limit), 20)
  const pattern = toSafeOwnerSearchIlikePattern(trimmed)
  if (!pattern) return []

  const likeLiteral = `%${trimmed.replace(/[%_]/g, '')}%`

  const [profilesRes, clientsRes, leadsRes, serviceRes] = await Promise.all([
    (supabase as any)
      .from('referral_profiles')
      .select('id, display_name, linked_client_id, linked_hunter_lead_id')
      .or(`display_name.ilike.${pattern},normalized_name.ilike.${pattern}`)
      .limit(capped),
    (supabase as any)
      .from('clients')
      .select('id, name, email, phone')
      .or(`name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`)
      .limit(capped),
    (supabase as any)
      .from('hunter_leads')
      .select('id, contact_name, email, phone')
      .or(`contact_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`)
      .limit(capped),
    // Name-only free-text from SQL assignment denorm (service calls have no clients FK).
    (supabase as any)
      .from('service_call_assignments')
      .select('id, customer_name, service_call_id')
      .ilike('customer_name', likeLiteral)
      .limit(capped),
  ])

  if (profilesRes.error) {
    throw new Error(`searchOwnerCandidates(profiles): ${profilesRes.error.message}`)
  }
  if (clientsRes.error) {
    throw new Error(`searchOwnerCandidates(clients): ${clientsRes.error.message}`)
  }
  if (leadsRes.error) {
    throw new Error(`searchOwnerCandidates(leads): ${leadsRes.error.message}`)
  }
  // Service assignments may be empty/unavailable for some orgs — soft-fail to [].
  const serviceRows = serviceRes.error ? [] : (serviceRes.data ?? [])

  const results: OwnerSearchCandidate[] = []

  for (const p of (profilesRes.data ?? [])) {
    results.push({
      source:       'referral_profile',
      id:           p.id,
      display_name: p.display_name,
      email:        null,
      phone:        null,
    })
  }
  for (const c of (clientsRes.data ?? [])) {
    results.push({
      source:       'client',
      id:           c.id,
      display_name: c.name,
      email:        c.email ?? null,
      phone:        c.phone ?? null,
    })
  }
  // Deduplicate service customers by normalized name
  const seenService = new Set<string>()
  for (const s of serviceRows) {
    const name = String(s.customer_name ?? '').trim()
    if (!name) continue
    const key = normalizeReferralName(name)
    if (seenService.has(key)) continue
    seenService.add(key)
    results.push({
      source:          'service_customer',
      id:              `svc:${s.service_call_id || s.id}`,
      display_name:    name,
      email:           null,
      phone:           null,
      service_call_id: s.service_call_id ?? null,
    })
  }
  for (const l of (leadsRes.data ?? [])) {
    results.push({
      source:       'hunter_lead',
      id:           l.id,
      display_name: l.contact_name,
      email:        l.email ?? null,
      phone:        l.phone ?? null,
    })
  }

  return results.slice(0, capped)
}

export function ownerSearchSourceLabel(source: OwnerSearchSource): string {
  switch (source) {
    case 'referral_profile': return 'Referrer Profile'
    case 'client':           return 'Customer'
    case 'service_customer': return 'Service Customer'
    case 'hunter_lead':      return 'Hunter Lead'
  }
}

// ── Profile reads / writes ────────────────────────────────────────────────────

export async function findReferralProfilesByNormalizedName(
  organizationId: string,
  displayName: string
): Promise<ReferralProfile[]> {
  const normalized = normalizeReferralName(displayName)
  if (!normalized) return []
  const { data, error } = await (supabase as any)
    .from('referral_profiles')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('normalized_name', normalized)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`findReferralProfilesByNormalizedName: ${error.message}`)
  return data ?? []
}

/**
 * Create a standalone referrer profile and resolve the claim to it.
 * Does NOT create a Client or Hunter Lead. raw_referral_text is unchanged.
 */
export async function createReferrerProfileForClaim(
  claimId: string,
  displayName: string,
  options?: { forceSeparate?: boolean; useExistingProfileId?: string }
): Promise<ReferralProfile> {
  const claim = await fetchClaimRow(claimId)
  const name = displayName.trim() || claim.raw_referral_text.trim()
  if (!name) throw new Error('createReferrerProfileForClaim: display name required')

  if (options?.useExistingProfileId) {
    const { data, error } = await (supabase as any)
      .from('referral_profiles')
      .select('*')
      .eq('id', options.useExistingProfileId)
      .maybeSingle()
    if (error) throw new Error(`createReferrerProfileForClaim: ${error.message}`)
    if (!data) throw new Error('createReferrerProfileForClaim: existing profile not found')
    await assignClaimToProfile(claimId, data as ReferralProfile)
    return data as ReferralProfile
  }

  const existing = await findReferralProfilesByNormalizedName(claim.organization_id, name)
  if (existing.length > 0 && !options?.forceSeparate) {
    throw new Error(
      'DUPLICATE_REFERRAL_PROFILES: matching profile(s) exist — use existing or forceSeparate'
    )
  }

  const profile = await insertReferralProfile({
    organization_id: claim.organization_id,
    display_name:    name,
  })
  await assignClaimToProfile(claimId, profile)
  return profile
}

/**
 * Preview duplicate profiles before create (owner UI).
 */
export async function previewDuplicateReferralProfiles(
  claimId: string,
  displayName: string
): Promise<ReferralProfile[]> {
  const claim = await fetchClaimRow(claimId)
  return findReferralProfilesByNormalizedName(claim.organization_id, displayName)
}

/**
 * Owner/admin: update a referral profile display name only.
 * Does not mutate claims, clients, hunter leads, projects, or service calls.
 * raw_referral_text is never touched.
 */
export async function updateReferralProfile(
  profileId: string,
  input: { displayName: string }
): Promise<void> {
  const name = input.displayName.trim()
  if (!name) throw new Error('updateReferralProfile: display name required')
  if (name.length > REFERRAL_PROFILE_DISPLAY_NAME_MAX) {
    throw new Error(
      `updateReferralProfile: display name too long (max ${REFERRAL_PROFILE_DISPLAY_NAME_MAX})`
    )
  }
  const now = new Date().toISOString()
  const { error } = await (supabase as any)
    .from('referral_profiles')
    .update({
      display_name:    name,
      normalized_name: normalizeReferralName(name),
      updated_at:      now,
    })
    .eq('id', profileId)
  if (error) throw new Error(`updateReferralProfile: ${error.message}`)
}

/** @deprecated Prefer updateReferralProfile */
export async function renameReferralProfile(
  profileId: string,
  displayName: string
): Promise<void> {
  await updateReferralProfile(profileId, { displayName })
}

/**
 * Link claim to an owner-selected search candidate via referral_profile.
 */
export async function linkReferralClaimToSearchCandidate(
  claimId: string,
  candidate: OwnerSearchCandidate
): Promise<ReferralProfile> {
  const claim = await fetchClaimRow(claimId)

  if (candidate.source === 'referral_profile') {
    const { data, error } = await (supabase as any)
      .from('referral_profiles')
      .select('*')
      .eq('id', candidate.id)
      .maybeSingle()
    if (error) throw new Error(`linkReferralClaimToSearchCandidate: ${error.message}`)
    if (!data) throw new Error('linkReferralClaimToSearchCandidate: profile not found')
    await assignClaimToProfile(claimId, data as ReferralProfile)
    return data as ReferralProfile
  }

  if (candidate.source === 'client') {
    const profile = await ensureProfileForClient(claim.organization_id, candidate.id)
    await assignClaimToProfile(claimId, profile)
    return profile
  }

  if (candidate.source === 'hunter_lead') {
    const profile = await ensureProfileForLead(claim.organization_id, candidate.id)
    await assignClaimToProfile(claimId, profile)
    return profile
  }

  // service_customer: free-text identity — create standalone profile (no Client/Lead).
  const profile = await insertReferralProfile({
    organization_id: claim.organization_id,
    display_name:    candidate.display_name,
  })
  await assignClaimToProfile(claimId, profile)
  return profile
}

/**
 * @deprecated Prefer linkReferralClaimToSearchCandidate / createReferrerProfileForClaim.
 * Kept for Needs Review candidate confirm path (client/lead → profile).
 */
export async function linkReferralClaimToIdentity(
  claimId: string,
  resolution: ResolveReferralInput
): Promise<void> {
  if (resolution.profile_id) {
    const { data, error } = await (supabase as any)
      .from('referral_profiles')
      .select('*')
      .eq('id', resolution.profile_id)
      .maybeSingle()
    if (error) throw new Error(`linkReferralClaimToIdentity: ${error.message}`)
    if (!data) throw new Error('linkReferralClaimToIdentity: profile not found')
    await assignClaimToProfile(claimId, data as ReferralProfile)
    return
  }
  if (!resolution.client_id && !resolution.lead_id) {
    throw new Error('linkReferralClaimToIdentity: must provide client_id, lead_id, or profile_id')
  }
  if (resolution.client_id && resolution.lead_id) {
    throw new Error('linkReferralClaimToIdentity: client_id and lead_id are mutually exclusive')
  }

  const claim = await fetchClaimRow(claimId)
  const profile = resolution.client_id
    ? await ensureProfileForClient(claim.organization_id, resolution.client_id)
    : await ensureProfileForLead(claim.organization_id, resolution.lead_id!)
  await assignClaimToProfile(claimId, profile)
}

export async function resolveReferralClaim(
  claimId: string,
  resolution: ResolveReferralInput
): Promise<void> {
  await linkReferralClaimToIdentity(claimId, resolution)
}

export async function fetchReferralProfilesWithHistory(): Promise<ReferralProfileWithHistory[]> {
  const { data: profiles, error } = await (supabase as any)
    .from('referral_profiles')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) throw new Error(`fetchReferralProfilesWithHistory: ${error.message}`)

  const { data: claims, error: claimsErr } = await (supabase as any)
    .from('referral_claims')
    .select('*, portal_requests(id, name, status, created_at), clients(id, name), hunter_leads(id, contact_name), referral_profiles(*)')
    .eq('resolution_status', 'resolved')
    .not('referral_profile_id', 'is', null)
    .order('created_at', { ascending: false })
  if (claimsErr) throw new Error(`fetchReferralProfilesWithHistory(claims): ${claimsErr.message}`)

  const byProfile = new Map<string, ResolvedReferralClaim[]>()
  for (const c of (claims ?? []) as ResolvedReferralClaim[]) {
    const pid = c.referral_profile_id
    if (!pid) continue
    const list = byProfile.get(pid) ?? []
    list.push(c)
    byProfile.set(pid, list)
  }

  const result: ReferralProfileWithHistory[] = []
  for (const p of (profiles ?? []) as ReferralProfile[]) {
    const list = byProfile.get(p.id) ?? []
    let linkedLabel: string | null = null
    if (p.linked_client_id) linkedLabel = 'Customer'
    else if (p.linked_hunter_lead_id) linkedLabel = 'Hunter Lead'
    result.push({
      ...p,
      claim_count:    list.length,
      most_recent_at: list[0]?.created_at ?? null,
      claims:         list,
      linked_label:   linkedLabel,
    })
  }

  result.sort((a, b) => b.claim_count - a.claim_count || (b.most_recent_at ?? '').localeCompare(a.most_recent_at ?? ''))
  return result
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export async function fetchReferralClaimForRequest(
  portalRequestId: string
): Promise<ReferralClaim | null> {
  const { data, error } = await (supabase as any)
    .from('referral_claims')
    .select('*')
    .eq('portal_request_id', portalRequestId)
    .maybeSingle()

  if (error) throw new Error(`fetchReferralClaimForRequest: ${error.message}`)
  return data ?? null
}

export async function fetchReferralClaimsForClient(
  clientId: string
): Promise<ReferralClaim[]> {
  const { data, error } = await (supabase as any)
    .from('referral_claims')
    .select('*')
    .eq('resolved_client_id', clientId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`fetchReferralClaimsForClient: ${error.message}`)
  return data ?? []
}

export async function fetchReferralClaimsForLead(
  leadId: string
): Promise<ReferralClaim[]> {
  const { data, error } = await (supabase as any)
    .from('referral_claims')
    .select('*')
    .eq('resolved_lead_id', leadId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`fetchReferralClaimsForLead: ${error.message}`)
  return data ?? []
}

export async function fetchReferralClaimsForProfile(
  profileId: string
): Promise<ReferralClaim[]> {
  const { data, error } = await (supabase as any)
    .from('referral_claims')
    .select('*')
    .eq('referral_profile_id', profileId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`fetchReferralClaimsForProfile: ${error.message}`)
  return data ?? []
}

/**
 * Claims that need owner review: unresolved or ambiguous.
 * confirmed_unlinked is intentionally excluded — it has already been acted on.
 */
export async function fetchPendingReferralClaims(): Promise<ReferralClaimWithPortalInfo[]> {
  const { data, error } = await (supabase as any)
    .from('referral_claims')
    .select('*, portal_requests(id, name, status, created_at)')
    .in('resolution_status', ['unresolved', 'ambiguous'])
    .order('created_at', { ascending: false })

  if (error) throw new Error(`fetchPendingReferralClaims: ${error.message}`)
  return data ?? []
}

/**
 * Claims that have been owner-confirmed: resolved (linked to a profile) or
 * owner-confirmed as valid but not yet assigned a referral profile.
 */
export async function fetchResolvedReferralClaims(): Promise<ResolvedReferralClaim[]> {
  const { data, error } = await (supabase as any)
    .from('referral_claims')
    .select('*, portal_requests(id, name, status, created_at), clients(id, name), hunter_leads(id, contact_name), referral_profiles(*)')
    .in('resolution_status', ['resolved', 'confirmed_unlinked'])
    .order('created_at', { ascending: false })

  if (error) throw new Error(`fetchResolvedReferralClaims: ${error.message}`)
  return data ?? []
}

// ── Resolution writes ─────────────────────────────────────────────────────────

/**
 * Owner confirms a referral claim as valid, but has not assigned a referral profile.
 */
export async function confirmReferralClaimUnlinked(claimId: string): Promise<void> {
  const userId = await getAuthUserId()
  const now = new Date().toISOString()
  const { error } = await (supabase as any)
    .from('referral_claims')
    .update({
      resolution_status:   'confirmed_unlinked',
      referral_profile_id: null,
      resolved_client_id:  null,
      resolved_lead_id:    null,
      resolved_by:         userId,
      resolved_at:         now,
      updated_at:          now,
    })
    .eq('id', claimId)

  if (error) throw new Error(`confirmReferralClaimUnlinked: ${error.message}`)
}

export async function unresolveReferralClaim(claimId: string): Promise<void> {
  const { error } = await (supabase as any)
    .from('referral_claims')
    .update({
      resolution_status:   'unresolved',
      referral_profile_id: null,
      resolved_client_id:  null,
      resolved_lead_id:    null,
      resolved_by:         null,
      resolved_at:         null,
      updated_at:          new Date().toISOString(),
    })
    .eq('id', claimId)

  if (error) throw new Error(`unresolveReferralClaim: ${error.message}`)
}

export async function markReferralClaimAmbiguous(claimId: string): Promise<void> {
  const { error } = await (supabase as any)
    .from('referral_claims')
    .update({
      resolution_status:   'ambiguous',
      referral_profile_id: null,
      resolved_client_id:  null,
      resolved_lead_id:    null,
      resolved_at:         null,
      updated_at:          new Date().toISOString(),
    })
    .eq('id', claimId)

  if (error) throw new Error(`markReferralClaimAmbiguous: ${error.message}`)
}

// ── Automatic matching (conservative) ─────────────────────────────────────────
// findReferralCandidates is last so write functions can be audited independently.

export async function findReferralCandidates(
  rawText: string
): Promise<ReferralCandidateResult> {
  const trimmed = rawText.trim()
  if (!trimmed) return { confidence: 'unresolved', candidates: [] }

  const email = extractEmailFromText(trimmed)
  const phone = extractPhoneFromText(trimmed)
  const nameIsFullName = isLikelyFullName(trimmed)
  const normalized = normalizeReferralName(trimmed)

  const candidates: ReferralCandidate[] = []

  // ── Referral profiles (exact normalized full name only) ──
  if (nameIsFullName) {
    const { data: profilesByName } = await (supabase as any)
      .from('referral_profiles')
      .select('id, display_name')
      .eq('normalized_name', normalized)

    for (const p of (profilesByName ?? [])) {
      candidates.push({
        type: 'profile',
        id: p.id,
        display_name: p.display_name,
        email: null,
        phone: null,
        match_reason: 'name',
      })
    }
  }

  // ── Name match (exact, case-insensitive) ──
  if (nameIsFullName) {
    const { data: clientsByName } = await (supabase as any)
      .from('clients')
      .select('id, name, email, phone')
      .ilike('name', trimmed)

    const { data: leadsByName } = await (supabase as any)
      .from('hunter_leads')
      .select('id, contact_name, email, phone')
      .ilike('contact_name', trimmed)

    for (const c of (clientsByName ?? [])) {
      candidates.push({ type: 'client', id: c.id, display_name: c.name, email: c.email ?? null, phone: c.phone ?? null, match_reason: 'name' })
    }
    for (const l of (leadsByName ?? [])) {
      candidates.push({ type: 'lead', id: l.id, display_name: l.contact_name, email: l.email ?? null, phone: l.phone ?? null, match_reason: 'name' })
    }
  }

  // ── Email match (exact, case-insensitive) — clients / leads only ──
  if (email) {
    const { data: clientsByEmail } = await (supabase as any)
      .from('clients')
      .select('id, name, email, phone')
      .ilike('email', email)

    const { data: leadsByEmail } = await (supabase as any)
      .from('hunter_leads')
      .select('id, contact_name, email, phone')
      .ilike('email', email)

    for (const c of (clientsByEmail ?? [])) {
      if (!candidates.some(x => x.type === 'client' && x.id === c.id)) {
        candidates.push({ type: 'client', id: c.id, display_name: c.name, email: c.email ?? null, phone: c.phone ?? null, match_reason: 'email' })
      }
    }
    for (const l of (leadsByEmail ?? [])) {
      if (!candidates.some(x => x.type === 'lead' && x.id === l.id)) {
        candidates.push({ type: 'lead', id: l.id, display_name: l.contact_name, email: l.email ?? null, phone: l.phone ?? null, match_reason: 'email' })
      }
    }
  }

  // ── Phone match (complete paginated scan) ──
  if (phone) {
    const allClients = await paginatePhoneRows<{id: string; name: string; email: string | null; phone: string | null}>(
      'clients', 'id, name, email, phone'
    )
    const allLeads = await paginatePhoneRows<{id: string; contact_name: string; email: string | null; phone: string | null}>(
      'hunter_leads', 'id, contact_name, email, phone'
    )

    for (const c of allClients) {
      if (normalizePhone(c.phone ?? '') === phone && !candidates.some(x => x.type === 'client' && x.id === c.id)) {
        candidates.push({ type: 'client', id: c.id, display_name: c.name, email: c.email ?? null, phone: c.phone ?? null, match_reason: 'phone' })
      }
    }
    for (const l of allLeads) {
      if (normalizePhone(l.phone ?? '') === phone && !candidates.some(x => x.type === 'lead' && x.id === l.id)) {
        candidates.push({ type: 'lead', id: l.id, display_name: l.contact_name, email: l.email ?? null, phone: l.phone ?? null, match_reason: 'phone' })
      }
    }
  }

  if (candidates.length === 0) return { confidence: 'unresolved', candidates: [] }
  if (candidates.length === 1) return { confidence: 'suggestion', candidates }
  return { confidence: 'ambiguous', candidates }
}
