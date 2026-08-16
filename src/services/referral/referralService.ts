/**
 * LEAD-SRC-4B — Private referral index service.
 *
 * Owner-side only. No public surface. No aggregated analytics (LEAD-SRC-6).
 * Conservative matching: exact email/phone/full-name only.
 * No automatic resolution — suggestion → owner confirms.
 */

import { supabase } from '@/lib/supabase'
import { normalizePhone } from '@/services/calls/phoneNormalize'

export type ResolutionStatus = 'unresolved' | 'resolved' | 'ambiguous'

export interface ReferralClaim {
  id: string
  organization_id: string
  portal_request_id: string
  raw_referral_text: string
  resolution_status: ResolutionStatus
  resolved_client_id: string | null
  resolved_lead_id: string | null
  resolved_by: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export interface ReferralCandidate {
  type: 'client' | 'lead'
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

// ── Extended types (for referral index) ──────────────────────────────────────

export interface ReferralClaimWithPortalInfo extends ReferralClaim {
  portal_requests?: {
    id: string
    name: string
    status: string | null
    created_at: string
  } | null
}

export interface ResolvedReferralClaim extends ReferralClaimWithPortalInfo {
  clients?: { id: string; name: string } | null
  hunter_leads?: { id: string; contact_name: string } | null
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

export async function fetchPendingReferralClaims(): Promise<ReferralClaimWithPortalInfo[]> {
  const { data, error } = await (supabase as any)
    .from('referral_claims')
    .select('*, portal_requests(id, name, status, created_at)')
    .in('resolution_status', ['unresolved', 'ambiguous'])
    .order('created_at', { ascending: false })

  if (error) throw new Error(`fetchPendingReferralClaims: ${error.message}`)
  return data ?? []
}

export async function fetchResolvedReferralClaims(): Promise<ResolvedReferralClaim[]> {
  const { data, error } = await (supabase as any)
    .from('referral_claims')
    .select('*, portal_requests(id, name, status, created_at), clients(id, name), hunter_leads(id, contact_name)')
    .eq('resolution_status', 'resolved')
    .order('created_at', { ascending: false })

  if (error) throw new Error(`fetchResolvedReferralClaims: ${error.message}`)
  return data ?? []
}

// ── Matching ──────────────────────────────────────────────────────────────────

export async function findReferralCandidates(
  rawText: string
): Promise<ReferralCandidateResult> {
  const trimmed = rawText.trim()
  if (!trimmed) return { confidence: 'unresolved', candidates: [] }

  const email = extractEmailFromText(trimmed)
  const phone = extractPhoneFromText(trimmed)
  const nameIsFullName = isLikelyFullName(trimmed)

  const candidates: ReferralCandidate[] = []

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

  // ── Email match (exact, case-insensitive) ──
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

  // ── Phone match (complete paginated scan — all pages, stable id ordering) ──
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

// ── Resolution writes ─────────────────────────────────────────────────────────

export async function resolveReferralClaim(
  claimId: string,
  resolution: ResolveReferralInput
): Promise<void> {
  if (!resolution.client_id && !resolution.lead_id) {
    throw new Error('resolveReferralClaim: must provide client_id or lead_id')
  }
  if (resolution.client_id && resolution.lead_id) {
    throw new Error('resolveReferralClaim: client_id and lead_id are mutually exclusive')
  }

  const now = new Date().toISOString()
  const { error } = await (supabase as any)
    .from('referral_claims')
    .update({
      resolution_status:  'resolved',
      resolved_client_id: resolution.client_id ?? null,
      resolved_lead_id:   resolution.lead_id ?? null,
      resolved_at:        now,
      updated_at:         now,
    })
    .eq('id', claimId)

  if (error) throw new Error(`resolveReferralClaim: ${error.message}`)
}

export async function unresolveReferralClaim(claimId: string): Promise<void> {
  const { error } = await (supabase as any)
    .from('referral_claims')
    .update({
      resolution_status:  'unresolved',
      resolved_client_id: null,
      resolved_lead_id:   null,
      resolved_by:        null,
      resolved_at:        null,
      updated_at:         new Date().toISOString(),
    })
    .eq('id', claimId)

  if (error) throw new Error(`unresolveReferralClaim: ${error.message}`)
}

export async function markReferralClaimAmbiguous(claimId: string): Promise<void> {
  const { error } = await (supabase as any)
    .from('referral_claims')
    .update({
      resolution_status:  'ambiguous',
      resolved_client_id: null,
      resolved_lead_id:   null,
      resolved_at:        null,
      updated_at:         new Date().toISOString(),
    })
    .eq('id', claimId)

  if (error) throw new Error(`markReferralClaimAmbiguous: ${error.message}`)
}
