/**
 * Display-only value range for Hunter lead cards / pipeline totals.
 * Portal leads with null estimated_value must never fall back to work-class maps.
 */

export function isCustomerPortalLead(lead: {
  source?: string | null
  source_tag?: string | null
}): boolean {
  return lead.source_tag === 'customer_portal' || lead.source === 'customer_portal'
}

export function resolveHunterPanelValueRange(params: {
  estimatedValue?: number | null
  source?: string | null
  sourceTag?: string | null
  workClassCode?: string | null
  permitTypeCode?: string | null
  workClassEstimates: Record<string, { min: number; max: number }>
}): { min: number; max: number } | undefined {
  const estValue =
    typeof params.estimatedValue === 'number' && Number.isFinite(params.estimatedValue)
      ? params.estimatedValue
      : null

  if (estValue != null && estValue > 0) {
    return { min: Math.round(estValue * 0.85), max: Math.round(estValue * 1.15) }
  }

  if (
    isCustomerPortalLead({
      source: params.source,
      source_tag: params.sourceTag,
    })
  ) {
    return undefined
  }

  const wcKey = (params.workClassCode ?? '').toLowerCase().trim()
  const ptKey = (params.permitTypeCode ?? '').toLowerCase().trim()
  return params.workClassEstimates[wcKey] ?? params.workClassEstimates[ptKey]
}

/** Sum only known positive estimated values — never treat null as fabricated dollars. */
export function sumKnownLeadEstimatedValues(
  leads: Array<{ estimated_value?: number | null; status?: string }>,
  options?: { excludeStatuses?: string[] }
): number {
  const excluded = new Set(options?.excludeStatuses ?? [])
  return leads.reduce((sum, lead) => {
    if (lead.status && excluded.has(lead.status)) return sum
    const value = lead.estimated_value
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return sum
    return sum + value
  }, 0)
}
