/**
 * Owner-managed expected JOB VALUE profiles for portal → hunter lead conversion.
 *
 * Persisted in tenant_settings under lead_value_profiles_v1 — same tenant
 * authority convertToLead already uses for hunter_leads.tenant_id and
 * home_base_address lookups. These are expected job values, not internal costs.
 */

import { supabase } from '@/lib/supabase'

export const LEAD_VALUE_PROFILES_SETTING_KEY = 'lead_value_profiles_v1'

/** Portal service_category values accepted by submit_portal_request. */
export const LEAD_VALUE_SERVICE_CATEGORIES = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'solar', label: 'Solar / PV' },
  { value: 'maintenance', label: 'Maintenance & Service' },
  { value: 'panel_upgrade', label: 'Panel Upgrade' },
  { value: 'ev_charger', label: 'EV Charger Installation' },
  { value: 'other', label: 'Other' },
] as const

export type LeadValueServiceCategory =
  (typeof LEAD_VALUE_SERVICE_CATEGORIES)[number]['value']

export interface LeadValueProfile {
  id: string
  name: string
  serviceCategory: string
  minValue: number
  maxValue: number
}

export interface LeadValueProfilesPayload {
  version: 1
  profiles: LeadValueProfile[]
}

export type LeadValueProfileInput = {
  id?: string
  name: string
  serviceCategory: string
  minValue: number
  maxValue: number
}

export class LeadValueProfileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LeadValueProfileError'
  }
}

const VALID_CATEGORIES = new Set(
  LEAD_VALUE_SERVICE_CATEGORIES.map((c) => c.value)
)

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function createLeadValueProfileId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `lvp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export function normalizeServiceCategory(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase()
}

export function profileMidpoint(minValue: number, maxValue: number): number {
  return Math.round((minValue + maxValue) / 2)
}

export function parseLeadValueProfilesPayload(raw: unknown): LeadValueProfile[] {
  const record = asRecord(raw)
  if (!record) return []
  const profiles = Array.isArray(record.profiles) ? record.profiles : []
  const parsed: LeadValueProfile[] = []
  for (const entry of profiles) {
    const row = asRecord(entry)
    if (!row) continue
    const id = typeof row.id === 'string' ? row.id.trim() : ''
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    const serviceCategory = normalizeServiceCategory(
      typeof row.serviceCategory === 'string' ? row.serviceCategory : ''
    )
    const minValue = Number(row.minValue)
    const maxValue = Number(row.maxValue)
    if (!id || !name || !serviceCategory) continue
    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) continue
    parsed.push({ id, name, serviceCategory, minValue, maxValue })
  }
  return parsed
}

export function serializeLeadValueProfiles(
  profiles: LeadValueProfile[]
): LeadValueProfilesPayload {
  return { version: 1, profiles }
}

/**
 * Validates a single profile draft. Pass existingProfiles (excluding self when
 * editing) so duplicate serviceCategory mappings are rejected.
 */
export function validateLeadValueProfile(
  input: LeadValueProfileInput,
  existingProfiles: LeadValueProfile[] = []
): LeadValueProfile {
  const name = String(input.name ?? '').trim()
  const serviceCategory = normalizeServiceCategory(input.serviceCategory)
  const minValue = Number(input.minValue)
  const maxValue = Number(input.maxValue)

  if (!name) {
    throw new LeadValueProfileError('Profile name is required')
  }
  if (!serviceCategory || !VALID_CATEGORIES.has(serviceCategory as LeadValueServiceCategory)) {
    throw new LeadValueProfileError('A valid service category is required')
  }
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
    throw new LeadValueProfileError('Minimum and maximum values must be numbers')
  }
  if (minValue < 0 || maxValue < 0) {
    throw new LeadValueProfileError('Values must be greater than or equal to 0')
  }
  if (maxValue < minValue) {
    throw new LeadValueProfileError('Maximum value must be greater than or equal to minimum value')
  }

  const editingId = typeof input.id === 'string' ? input.id.trim() : ''
  const duplicate = existingProfiles.find(
    (p) =>
      p.id !== editingId &&
      normalizeServiceCategory(p.serviceCategory) === serviceCategory
  )
  if (duplicate) {
    throw new LeadValueProfileError(
      `A profile already maps to service category "${serviceCategory}"`
    )
  }

  return {
    id: editingId || createLeadValueProfileId(),
    name,
    serviceCategory,
    minValue,
    maxValue,
  }
}

export function upsertLeadValueProfile(
  profiles: LeadValueProfile[],
  input: LeadValueProfileInput
): LeadValueProfile[] {
  const next = validateLeadValueProfile(input, profiles)
  const idx = profiles.findIndex((p) => p.id === next.id)
  if (idx >= 0) {
    const copy = profiles.slice()
    copy[idx] = next
    return copy
  }
  return [...profiles, next]
}

export function deleteLeadValueProfile(
  profiles: LeadValueProfile[],
  profileId: string
): LeadValueProfile[] {
  const id = String(profileId ?? '').trim()
  if (!id) return profiles
  return profiles.filter((p) => p.id !== id)
}

/**
 * Deterministic exact match on normalized service_category.
 * Ambiguous duplicates are prevented at write time; if legacy data somehow
 * contains duplicates, the first match in stored order wins (stable).
 */
export function matchLeadValueProfile(
  profiles: LeadValueProfile[],
  serviceCategory: string | null | undefined
): LeadValueProfile | null {
  const key = normalizeServiceCategory(serviceCategory)
  if (!key) return null
  return (
    profiles.find((p) => normalizeServiceCategory(p.serviceCategory) === key) ??
    null
  )
}

export function estimatedValueFromProfile(
  profile: LeadValueProfile | null | undefined
): number | null {
  if (!profile) return null
  return profileMidpoint(profile.minValue, profile.maxValue)
}

export async function getCurrentTenantIdForProfiles(): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await (supabase as any)
    .from('user_tenants')
    .select('tenant_id')
    .eq('user_id', user.id)
    .limit(1)
    .single()
  if (error || !data) return null
  return data.tenant_id as string
}

export async function loadLeadValueProfiles(
  tenantId: string
): Promise<LeadValueProfile[]> {
  const { data, error } = await (supabase as any)
    .from('tenant_settings')
    .select('setting_value')
    .eq('tenant_id', tenantId)
    .eq('setting_key', LEAD_VALUE_PROFILES_SETTING_KEY)
    .maybeSingle()

  if (error) throw new LeadValueProfileError(error.message || 'Failed to load profiles')
  return parseLeadValueProfilesPayload(data?.setting_value)
}

export async function saveLeadValueProfiles(
  tenantId: string,
  userId: string,
  profiles: LeadValueProfile[]
): Promise<LeadValueProfile[]> {
  // Re-validate the full set so duplicate categories cannot persist.
  const normalized: LeadValueProfile[] = []
  for (const profile of profiles) {
    normalized.push(validateLeadValueProfile(profile, normalized))
  }

  const { error } = await (supabase as any)
    .from('tenant_settings')
    .upsert(
      {
        tenant_id: tenantId,
        setting_key: LEAD_VALUE_PROFILES_SETTING_KEY,
        setting_value: serializeLeadValueProfiles(normalized),
        updated_at: new Date().toISOString(),
        updated_by: userId,
      },
      { onConflict: 'tenant_id,setting_key' }
    )

  if (error) throw new LeadValueProfileError(error.message || 'Failed to save profiles')
  return normalized
}

/**
 * Resolve estimated_value for portal conversion using the caller's tenant
 * profiles. Returns null when no matching profile exists — never fabricates.
 */
export async function resolvePortalLeadEstimatedValue(params: {
  tenantId: string
  serviceCategory: string | null | undefined
}): Promise<number | null> {
  const profiles = await loadLeadValueProfiles(params.tenantId)
  return estimatedValueFromProfile(
    matchLeadValueProfile(profiles, params.serviceCategory)
  )
}
