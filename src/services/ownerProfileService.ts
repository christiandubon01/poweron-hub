/**
 * Owner Profile Service
 *
 * Reads and writes the business owner's strategic profile from/to Supabase
 * (owner_profile table — migration 041).
 *
 * The profile is intentionally separate from the main app_state backup so it
 * can be queried independently by the NEXUS context builder without touching
 * the heavy app_state blob.
 */

import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CityLicense {
  city: string
  status: 'active' | 'pending' | 'needed'
}

export interface OpenPermit {
  projectName: string
  city: string
  permitNumber: string
  status: string
}

export interface OwnerProfile {
  id?: string
  org_id?: string
  skill_inventory: string[]
  knowledge_gaps: string[]
  active_city_licenses: CityLicense[]
  open_permits: OpenPermit[]
  business_goals: string[]
  bandwidth_notes: string
  updated_at?: string
}

// ── Default profile ───────────────────────────────────────────────────────────

export const DEFAULT_OWNER_PROFILE: OwnerProfile = {
  skill_inventory: [],
  knowledge_gaps: [],
  active_city_licenses: [],
  open_permits: [],
  business_goals: [],
  bandwidth_notes: '',
}

// ── localStorage cache key ────────────────────────────────────────────────────

const LOCAL_KEY = 'poweron_owner_profile'

// ── Local cache helpers ───────────────────────────────────────────────────────

export function getLocalOwnerProfile(): OwnerProfile {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (!raw) return { ...DEFAULT_OWNER_PROFILE }
    return { ...DEFAULT_OWNER_PROFILE, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_OWNER_PROFILE }
  }
}

export function saveLocalOwnerProfile(profile: OwnerProfile): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(profile))
  } catch {
    // Non-critical
  }
}

// ── Supabase read ─────────────────────────────────────────────────────────────

export async function loadOwnerProfile(orgId: string): Promise<OwnerProfile> {
  try {
    const { data, error } = await supabase
      .from('owner_profile' as never)
      .select('*')
      .eq('org_id', orgId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw error
    if (!data) return getLocalOwnerProfile()

    const profile: OwnerProfile = {
      id: (data as any).id,
      org_id: (data as any).org_id,
      skill_inventory: (data as any).skill_inventory ?? [],
      knowledge_gaps: (data as any).knowledge_gaps ?? [],
      active_city_licenses: (data as any).active_city_licenses ?? [],
      open_permits: (data as any).open_permits ?? [],
      business_goals: (data as any).business_goals ?? [],
      bandwidth_notes: (data as any).bandwidth_notes ?? '',
      updated_at: (data as any).updated_at,
    }

    // Sync to local cache
    saveLocalOwnerProfile(profile)
    return profile
  } catch (err) {
    console.warn('[OwnerProfile] Supabase load failed — using local cache:', err)
    return getLocalOwnerProfile()
  }
}

// ── Supabase write ────────────────────────────────────────────────────────────

export async function saveOwnerProfile(
  orgId: string,
  profile: OwnerProfile
): Promise<{ ok: boolean; error?: string }> {
  // Always persist to local cache immediately (local-first)
  saveLocalOwnerProfile(profile)

  try {
    const payload = {
      org_id: orgId,
      skill_inventory: profile.skill_inventory,
      knowledge_gaps: profile.knowledge_gaps,
      active_city_licenses: profile.active_city_licenses,
      open_permits: profile.open_permits,
      business_goals: profile.business_goals,
      bandwidth_notes: profile.bandwidth_notes,
      updated_at: new Date().toISOString(),
    }

    if (profile.id) {
      // Update existing row
      const { error } = await supabase
        .from('owner_profile' as never)
        // @ts-ignore — owner_profile table not in generated Supabase types yet
        .update(payload)
        .eq('id', profile.id)
      if (error) throw error
    } else {
      // Insert new row
      const { error } = await supabase
        .from('owner_profile' as never)
        // @ts-ignore — owner_profile table not in generated Supabase types yet
        .insert(payload)
      if (error) throw error
    }

    return { ok: true }
  } catch (err: any) {
    console.warn('[OwnerProfile] Supabase save failed — local cache updated only:', err)
    return { ok: false, error: err?.message || 'Unknown error' }
  }
}

// ── NEXUS context builder ─────────────────────────────────────────────────────

/**
 * Returns a formatted markdown block of the owner profile for NEXUS injection.
 * Reads from local cache — no async needed in the hot path.
 */
export function buildOwnerProfileContext(): string {
  const p = getLocalOwnerProfile()

  const hasAnyData =
    p.skill_inventory.length > 0 ||
    p.knowledge_gaps.length > 0 ||
    p.active_city_licenses.length > 0 ||
    p.open_permits.length > 0 ||
    p.business_goals.length > 0 ||
    p.bandwidth_notes.trim().length > 0

  if (!hasAnyData) return ''

  const skills = p.skill_inventory.length
    ? p.skill_inventory.join(', ')
    : 'Not specified'

  const gaps = p.knowledge_gaps.length
    ? p.knowledge_gaps.join(', ')
    : 'None listed'

  const licenses = p.active_city_licenses.length
    ? p.active_city_licenses
        .map(l => `${l.city} (${l.status})`)
        .join(', ')
    : 'None listed'

  const permits = p.open_permits.length
    ? p.open_permits
        .map(pmt => `${pmt.projectName} — ${pmt.city} — Permit #${pmt.permitNumber} [${pmt.status}]`)
        .join('\n  ')
    : 'None listed'

  const goals = p.business_goals.length
    ? p.business_goals.map(g => `• ${g}`).join('\n  ')
    : 'None set'

  const bandwidth = p.bandwidth_notes.trim() || 'Not specified'

  return `## Business Owner Profile
Skills: ${skills}
Learning/Gaps: ${gaps}
Active city licenses: ${licenses}
Open permits:
  ${permits}
Goals:
  ${goals}
Current bandwidth: ${bandwidth}

Use this profile to give personalized strategic advice, not just operational data analysis.`
}
