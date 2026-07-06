/**
 * Map parsed TLMA table rows to Hunter lead import payloads.
 * Scoring mirrors supabase/functions/tlma-scraper/scoring.ts.
 */

import type { ParsedTlmaPermit } from './tlmaTableParser'

export interface TlmaScoreResult {
  final_score: number
  score_tier: 'elite' | 'strong' | 'qualified' | 'expansion' | 'archived'
  base_score: number
  sqft_bonus: number
  keyword_hits: Array<{ keyword: string; weight: number }>
  contact_signal_weight: number
  status_modifier: number
  penalties: Array<{ reason: string; weight: number }>
  force_overrides: Array<{ rule: string; new_score_floor?: number; new_score_ceiling?: number }>
  transparency_notes: string[]
}

export interface TlmaImportRow {
  permit_number: string
  source: 'tlma_riverside'
  source_tag: string
  lead_type: string
  contact_name: string | null
  company_name: string | null
  contact_company: string | null
  contact_type_label: string | null
  phone: string | null
  email: null
  address: string | null
  city: string | null
  description: string | null
  estimated_value: null
  score: number
  score_tier: string
  score_factors: Record<string, unknown>
  status: 'new' | 'archived'
  permit_url: string
  permit_type_code: string
  permit_type_label: string
  work_class_code: null
  permit_status: string
  total_sqft: number | null
  sqft_breakdown: Record<string, number> | null
  applied_date: string | null
  issued_date: string | null
  finalized_date: string | null
  expired_date: string | null
  source_city: string | null
  portal_url: string
  run_source: 'manual'
}

const BASE_SCORES: Record<string, number> = {
  BNR: 70,
  BTI: 65,
  BMN: 60,
  BRS: 55,
  BAR: 50,
  BAS: 50,
  BSP: 40,
  BMR: 35,
  BEL: 68,
  BWE: 60,
  BME: 50,
  BPL: 45,
  BGR: 40,
}

const KEYWORD_DEFS = [
  { keyword: 'electric', weight: 18 },
  { keyword: 'electrical', weight: 18 },
  { keyword: 'main panel', weight: 20 },
  { keyword: 'subpanel', weight: 20 },
  { keyword: 'panel', weight: 16 },
  { keyword: 'panel upgrade', weight: 20 },
  { keyword: 'service upgrade', weight: 20 },
  { keyword: 'meter', weight: 14 },
  { keyword: 'lighting', weight: 14 },
  { keyword: 'rewire', weight: 18 },
  { keyword: 'ev charger', weight: 18 },
  { keyword: 'evse', weight: 18 },
  { keyword: 'ev charging', weight: 18 },
  { keyword: 'ev ', weight: 12 },
  { keyword: 'generator', weight: 16 },
  { keyword: 'switchgear', weight: 18 },
  { keyword: 'title 24', weight: 14 },
  { keyword: 't24', weight: 14 },
  { keyword: 'low voltage', weight: 14 },
  { keyword: 'sign', weight: 10 },
  { keyword: 'kitchen', weight: 12 },
  { keyword: 'restaurant', weight: 14 },
  { keyword: 'retail', weight: 12 },
  { keyword: 'shell', weight: 10 },
  { keyword: 'buildout', weight: 12 },
  { keyword: 'build-out', weight: 12 },
  { keyword: 'commercial', weight: 12 },
  { keyword: 'solar addition', weight: 18 },
  { keyword: 'solar replacement', weight: 18 },
  { keyword: 'battery storage', weight: 18 },
  { keyword: 'battery', weight: 18 },
  { keyword: 'ess', weight: 15 },
  { keyword: 'solar', weight: 15 },
  { keyword: 'parking lot lighting', weight: 18 },
  { keyword: 'commercial lighting', weight: 18 },
  { keyword: 'lighting maintenance', weight: 15 },
  { keyword: 'lighting upgrade', weight: 12 },
  { keyword: 'exterior lighting', weight: 12 },
  { keyword: 'shopping center', weight: 15 },
  { keyword: 'pool equipment', weight: 12 },
  { keyword: 'hoa', weight: 12 },
  { keyword: 'common area', weight: 12 },
  { keyword: 'public space', weight: 12 },
  { keyword: 'park', weight: 10 },
  { keyword: 'tenant improvement', weight: 12 },
  { keyword: 'adu', weight: 12 },
  { keyword: 'guest', weight: 10 },
  { keyword: 'addition', weight: 8 },
  { keyword: 'remodel', weight: 8 },
  { keyword: 'owner-builder', weight: -25, isPenalty: true },
  { keyword: 'diy', weight: -20, isPenalty: true },
  { keyword: 'self-perform', weight: -15, isPenalty: true },
]

const ELECTRICAL_SIGNAL_KEYWORDS = new Set([
  'electric',
  'electrical',
  'solar',
  'solar addition',
  'solar replacement',
  'ev charger',
  'evse',
  'ev charging',
  'ev ',
  'battery',
  'battery storage',
  'ess',
  'generator',
  'switchgear',
  'low voltage',
  'subpanel',
  'main panel',
  'panel upgrade',
  'service upgrade',
])

export function extractPermitTypeCode(label: string) {
  const match = String(label || '').match(/\(([A-Z]+)\)\s*$/)
  return match ? match[1] : ''
}

function inferLeadType(permitTypeCode: string) {
  if (['BNR', 'BTI', 'BMN'].includes(permitTypeCode)) return 'commercial'
  if (['BRS', 'BAR', 'BAS', 'BMR'].includes(permitTypeCode)) return 'residential'
  if (['BSP'].includes(permitTypeCode)) return 'service'
  return 'commercial'
}

export function scoreTlmaPermit(permit: ParsedTlmaPermit): TlmaScoreResult {
  const notes: string[] = []
  const keywordHits: Array<{ keyword: string; weight: number }> = []
  const penalties: Array<{ reason: string; weight: number }> = []
  const forceOverrides: TlmaScoreResult['force_overrides'] = []
  const permitTypeCode = extractPermitTypeCode(permit.permit_type)

  const baseScore = BASE_SCORES[permitTypeCode] ?? 0
  if (baseScore > 0) notes.push(`Base score for ${permitTypeCode || 'unknown type'}: ${baseScore}`)
  else notes.push(`Unknown permit type code '${permitTypeCode}' (base=0)`)

  let sqftBonus = 0
  const sqft = permit.total_sqft
  if (sqft != null) {
    if (sqft > 5000) sqftBonus = 25
    else if (sqft >= 2000) sqftBonus = 15
    else if (sqft >= 1000) sqftBonus = 5
  }

  const searchText = [permit.description, permit.project_name].filter(Boolean).join(' ').toLowerCase()
  const sortedKeywords = [...KEYWORD_DEFS].sort((a, b) => b.keyword.length - a.keyword.length)
  for (const def of sortedKeywords) {
    if (!searchText.includes(def.keyword.toLowerCase())) continue
    if (def.isPenalty) penalties.push({ reason: def.keyword, weight: def.weight })
    else keywordHits.push({ keyword: def.keyword, weight: def.weight })
  }

  let contactSignalWeight = 0
  const contactType = permit.contact_type ?? ''
  const contactCompany = permit.contact_company ?? ''
  const companyLower = contactCompany.toLowerCase()
  if (contactType === 'Applicant' && /construction|builders|contracting|electric|builder/i.test(contactCompany)) {
    contactSignalWeight += 15
  }
  if (contactType === 'Engineer') contactSignalWeight += 5
  if (/architecture|architect/i.test(companyLower)) contactSignalWeight += 10
  if (contactType === 'Owner' && !contactCompany.trim()) contactSignalWeight -= 10
  if (contactType === 'Owner' && /owner.builder|owner builder/i.test(companyLower)) contactSignalWeight -= 15

  let statusModifier = 0
  const permitStatus = permit.status ?? ''
  if (/issued/i.test(permitStatus)) statusModifier = 10
  else if (/plan/i.test(permitStatus)) statusModifier = 5
  else if (/payment pending/i.test(permitStatus)) statusModifier = -5
  else if (/finalized/i.test(permitStatus)) statusModifier = -50
  else if (/expired/i.test(permitStatus)) statusModifier = -100

  const keywordSum = keywordHits.reduce((acc, item) => acc + item.weight, 0)
  const penaltySum = penalties.reduce((acc, item) => acc + item.weight, 0)
  let clamped = Math.max(
    0,
    Math.min(100, baseScore + sqftBonus + keywordSum + contactSignalWeight + statusModifier + penaltySum),
  )

  if (['BNR', 'BTI'].includes(permitTypeCode) && /issued/i.test(permitStatus) && sqft != null && sqft > 2000 && clamped < 75) {
    forceOverrides.push({ rule: 'Rule1_CommercialIssuedLarge', new_score_floor: 75 })
    clamped = 75
  }
  if (keywordHits.some(item => ELECTRICAL_SIGNAL_KEYWORDS.has(item.keyword.toLowerCase())) && clamped < 60) {
    forceOverrides.push({ rule: 'Rule2_DirectElectricalSignal', new_score_floor: 60 })
    clamped = 60
  }
  if (sqft != null && sqft > 4000 && clamped < 60) {
    forceOverrides.push({ rule: 'Rule3_LargeProject', new_score_floor: 60 })
    clamped = 60
  }
  if (/finalized|expired/i.test(permitStatus) && clamped > 20) {
    forceOverrides.push({ rule: 'Rule4_ClosedPermit', new_score_ceiling: 20 })
    clamped = 20
  }
  if (contactType === 'Owner' && !contactCompany.trim() && clamped > 35) {
    forceOverrides.push({ rule: 'Rule5_OwnerNoCompany', new_score_ceiling: 35 })
    clamped = 35
  }

  let scoreTier: TlmaScoreResult['score_tier'] = 'archived'
  if (clamped >= 85) scoreTier = 'elite'
  else if (clamped >= 75) scoreTier = 'strong'
  else if (clamped >= 60) scoreTier = 'qualified'
  else if (clamped >= 30) scoreTier = 'expansion'

  return {
    final_score: clamped,
    score_tier: scoreTier,
    base_score: baseScore,
    sqft_bonus: sqftBonus,
    keyword_hits: keywordHits,
    contact_signal_weight: contactSignalWeight,
    status_modifier: statusModifier,
    penalties,
    force_overrides: forceOverrides,
    transparency_notes: notes,
  }
}

export function buildTlmaImportRow(permit: ParsedTlmaPermit): TlmaImportRow {
  const score = scoreTlmaPermit(permit)
  const permitTypeCode = extractPermitTypeCode(permit.permit_type)
  const phone =
    permit.contact_business_phone ||
    permit.contact_mobile_phone ||
    permit.contact_home_phone ||
    null

  return {
    permit_number: permit.permit_number,
    source: 'tlma_riverside',
    source_tag: permitTypeCode ? `permit_${permitTypeCode}` : 'tlma_browser_import',
    lead_type: inferLeadType(permitTypeCode),
    contact_name: permit.contact,
    company_name: permit.contact_company,
    contact_company: permit.contact_company,
    contact_type_label: permit.contact_type,
    phone,
    email: null,
    address: permit.street_name || permit.address,
    city: permit.city || null,
    description: permit.description || null,
    estimated_value: null,
    score: score.final_score,
    score_tier: score.score_tier,
    score_factors: {
      base_score: score.base_score,
      sqft_bonus: score.sqft_bonus,
      keyword_hits: score.keyword_hits,
      contact_signal_weight: score.contact_signal_weight,
      status_modifier: score.status_modifier,
      penalties: score.penalties,
      force_overrides: score.force_overrides,
      transparency_notes: score.transparency_notes,
      import_mode: 'browser_table',
    },
    status: score.final_score < 30 ? 'archived' : 'new',
    permit_url: permit.source_url,
    permit_type_code: permitTypeCode,
    permit_type_label: permit.permit_type,
    work_class_code: null,
    permit_status: permit.status,
    total_sqft: permit.total_sqft,
    sqft_breakdown:
      permit.sqft_breakdown && Object.keys(permit.sqft_breakdown).length > 0
        ? permit.sqft_breakdown
        : null,
    applied_date: permit.applied_date,
    issued_date: permit.issued_date,
    finalized_date: permit.finalized_date,
    expired_date: permit.expired_date,
    source_city: permit.city || null,
    portal_url: permit.source_url,
    run_source: 'manual',
  }
}

export function buildTlmaImportRows(permits: ParsedTlmaPermit[]) {
  const unique = new Map<string, ParsedTlmaPermit>()
  for (const permit of permits) {
    if (permit.permit_number) unique.set(permit.permit_number, permit)
  }
  return Array.from(unique.values()).map(buildTlmaImportRow)
}

export function previewTlmaImportRows(permits: ParsedTlmaPermit[], limit = 5) {
  return buildTlmaImportRows(permits)
    .slice(0, limit)
    .map(row => ({
      permit_number: row.permit_number,
      city: row.city,
      permit_type: row.permit_type_label,
      status: row.permit_status,
      address: row.address,
      description: row.description,
      score: row.score,
      score_tier: row.score_tier,
    }))
}
