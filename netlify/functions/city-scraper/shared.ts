// @ts-nocheck
/**
 * Shared types, EnerGov fetch engine, scoring, and Supabase write layer.
 * Used by indio.ts and palm-springs.ts
 *
 * HUNTER-CITY-SCRAPER-APR30-2026-1
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface CityConfig {
  baseUrl: string       // full tylerhost.net endpoint URL
  tenantName: string    // tenantname header value
  tenantUrl: string     // tyler-tenanturl header value
  cityLabel: string     // stored in hunter_leads.source_city e.g. "Indio"
}

export interface EnerGovPermit {
  PermitNumber: string
  PermitType?: string
  WorkClass?: string
  Status?: string
  ApplyDate?: string
  IssueDate?: string | null
  MainAddress?: string
  ProjectName?: string | null
  Description?: string | null
  ContractorName?: string | null
}

export interface ScrapeOptions {
  dryRun?: boolean
  source?: string
  daysBack?: number
}

export interface ScrapeResult {
  city: string
  dry_run: boolean
  new_leads: number
  updated_leads: number
  errors: number
  error_messages: string[]
  permits_fetched: number
  permits_scored: number
}

// ── EnerGov API fetch ─────────────────────────────────────────────────────

function toISO(d: Date): string {
  return d.toISOString().split('T')[0]
}

function buildPayload(applyDateFrom: string, applyDateTo: string, page: number, pageSize: number) {
  const nullCriteria = {
    PageNumber: 0,
    PageSize: 0,
    SortBy: null,
    SortAscending: false,
  }
  return {
    Keyword: '',
    ExactMatch: true,
    SearchModule: 1,
    FilterModule: 2,
    SearchMainAddress: false,
    PlanCriteria: { ...nullCriteria, PlanNumber: null, PlanTypeId: null, PlanWorkclassId: null, PlanStatusId: null, ProjectName: null, ApplyDateFrom: null, ApplyDateTo: null, ExpireDateFrom: null, ExpireDateTo: null, CompleteDateFrom: null, CompleteDateTo: null, Address: null, Description: null, SearchMainAddress: false, ContactId: null, ParcelNumber: null, TypeId: null, WorkClassIds: null, ExcludeCases: null, EnableDescriptionSearch: false },
    PermitCriteria: {
      PermitNumber: null,
      PermitTypeId: 'none',
      PermitWorkclassId: null,
      PermitStatusId: 'none',
      ProjectName: null,
      IssueDateFrom: null,
      IssueDateTo: null,
      Address: null,
      Description: null,
      ExpireDateFrom: null,
      ExpireDateTo: null,
      FinalDateFrom: null,
      FinalDateTo: null,
      ApplyDateFrom: applyDateFrom,
      ApplyDateTo: applyDateTo,
      SearchMainAddress: false,
      ContactId: null,
      TypeId: null,
      WorkClassIds: null,
      ParcelNumber: null,
      ExcludeCases: null,
      EnableDescriptionSearch: true,
      PageNumber: page,
      PageSize: pageSize,
      SortBy: 'ApplyDate',
      SortAscending: false,
    },
    InspectionCriteria: { ...nullCriteria, Keyword: null, ExactMatch: false, Complete: null, InspectionNumber: null, InspectionTypeId: null, InspectionStatusId: null, RequestDateFrom: null, RequestDateTo: null, ScheduleDateFrom: null, ScheduleDateTo: null, Address: null, SearchMainAddress: false, ContactId: null, TypeId: [], WorkClassIds: [], ParcelNumber: null, DisplayCodeInspections: false, ExcludeCases: [], ExcludeFilterModules: [], HiddenInspectionTypeIDs: null },
    CodeCaseCriteria: { ...nullCriteria, CodeCaseNumber: null, CodeCaseTypeId: null, CodeCaseStatusId: null, ProjectName: null, OpenedDateFrom: null, OpenedDateTo: null, ClosedDateFrom: null, ClosedDateTo: null, Address: null, ParcelNumber: null, Description: null, SearchMainAddress: false, RequestId: null, ExcludeCases: null, ContactId: null, EnableDescriptionSearch: false },
    RequestCriteria: { ...nullCriteria, RequestNumber: null, RequestTypeId: null, RequestStatusId: null, ProjectName: null, EnteredDateFrom: null, EnteredDateTo: null, DeadlineDateFrom: null, DeadlineDateTo: null, CompleteDateFrom: null, CompleteDateTo: null, Address: null, ParcelNumber: null, SearchMainAddress: false },
    BusinessLicenseCriteria: { ...nullCriteria, LicenseNumber: null, LicenseTypeId: null, LicenseClassId: null, LicenseStatusId: null, BusinessStatusId: null, LicenseYear: null, ApplicationDateFrom: null, ApplicationDateTo: null, IssueDateFrom: null, IssueDateTo: null, ExpirationDateFrom: null, ExpirationDateTo: null, SearchMainAddress: false, CompanyTypeId: null, CompanyName: null, BusinessTypeId: null, Description: null, CompanyOpenedDateFrom: null, CompanyOpenedDateTo: null, CompanyClosedDateFrom: null, CompanyClosedDateTo: null, LastAuditDateFrom: null, LastAuditDateTo: null, ParcelNumber: null, Address: null, TaxID: null, DBA: null, ExcludeCases: null, TypeId: null, WorkClassIds: null, ContactId: null },
    ProjectCriteria: { ...nullCriteria, ProjectNumber: null, ProjectName: null, Address: null, ParcelNumber: null, StartDateFrom: null, StartDateTo: null, ExpectedEndDateFrom: null, ExpectedEndDateTo: null, CompleteDateFrom: null, CompleteDateTo: null, Description: null, SearchMainAddress: false, ContactId: null, TypeId: null, ExcludeCases: null, EnableDescriptionSearch: false },
    ExcludeCases: null,
    PageNumber: page,
    PageSize: pageSize,
    SortBy: 'ApplyDate',
    SortAscending: false,
  }
}

export async function fetchEnerGovPermits(
  config: CityConfig,
  daysBack: number
): Promise<EnerGovPermit[]> {
  const today = new Date()
  const from = new Date(today)
  from.setDate(from.getDate() - daysBack)

  const applyDateFrom = toISO(from)
  const applyDateTo = toISO(today)
  const PAGE_SIZE = 50
  const MAX_PAGES = 20

  const headers: Record<string, string> = {
    'Content-Type': 'application/json;charset=UTF-8',
    'accept': 'application/json, text/plain, */*',
    'tenantid': '1',
    'tenantname': config.tenantName,
    'tyler-tenant-culture': 'en-US',
    'tyler-tenanturl': config.tenantUrl,
    'origin': new URL(config.baseUrl).origin,
    'referer': new URL(config.baseUrl).origin + '/apps/SelfService',
  }

  const allPermits: EnerGovPermit[] = []

  for (let page = 1; page <= MAX_PAGES; page++) {
    const payload = buildPayload(applyDateFrom, applyDateTo, page, PAGE_SIZE)
    const res = await fetch(config.baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      throw new Error(`EnerGov API returned ${res.status} for ${config.cityLabel} page ${page}`)
    }

    const data = await res.json()
    // EnerGov response shape: { Permits: { Result: [...], Total: N } }
    const permits: EnerGovPermit[] = data?.Permits?.Result ?? []
    allPermits.push(...permits)

    // Stop paginating when we get fewer results than a full page
    if (permits.length < PAGE_SIZE) break
  }

  return allPermits
}

// ── Scoring ───────────────────────────────────────────────────────────────

interface ScoreResult {
  score: number
  score_factors: string[]
}

export function scorePermit(p: EnerGovPermit): ScoreResult {
  let score = 0
  const factors: string[] = []
  const desc = (p.Description ?? '').toLowerCase()
  const wc = (p.WorkClass ?? '').toLowerCase()
  const status = (p.Status ?? '').toLowerCase()

  // Work class signals — what kind of project
  if (wc.includes('new construction')) {
    score += 30; factors.push('new_construction')
  } else if (wc.includes('adu') || wc.includes('accessory dwelling')) {
    score += 25; factors.push('adu')
  } else if (wc.includes('addition')) {
    score += 22; factors.push('addition')
  } else if (wc.includes('remodel') || wc.includes('alteration')) {
    score += 18; factors.push('remodel')
  } else if (wc.includes('commercial')) {
    score += 20; factors.push('commercial')
  }

  // Electrical keywords in description — direct signal
  const elecKeywords = [
    'electrical', 'panel upgrade', 'service upgrade', 'main panel',
    'sub-panel', 'subpanel', 'wiring', 'rewire', 'circuit',
    'meter', 'ev charger', 'electric vehicle', 'solar', 'photovoltaic',
    'pv system', 'battery storage', 'ess', 'generator',
  ]
  for (const kw of elecKeywords) {
    if (desc.includes(kw)) {
      score += 20
      factors.push(`elec_kw:${kw.replace(/ /g, '_')}`)
      break // one keyword match is enough
    }
  }

  // Status signals — early = better opportunity
  if (status.includes('applied') || status.includes('submitted')) {
    score += 15; factors.push('status:applied')
  } else if (status.includes('plan check') || status.includes('plan review')) {
    score += 12; factors.push('status:plan_check')
  } else if (status.includes('issued')) {
    score += 8; factors.push('status:issued')
  } else if (status.includes('finaled') || status.includes('closed') || status.includes('expired')) {
    score -= 20; factors.push('status:closed')
  }

  // No contractor assigned = open opportunity
  if (!p.ContractorName || p.ContractorName.trim() === '') {
    score += 10; factors.push('no_contractor')
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    score_factors: factors,
  }
}

// ── Supabase write ────────────────────────────────────────────────────────

export async function scrapeCity(
  supabase: any,
  config: CityConfig,
  options: ScrapeOptions = {}
): Promise<ScrapeResult> {
  const { dryRun = false, source = 'cron', daysBack = 30 } = options
  const errorMessages: string[] = []

  let permits: EnerGovPermit[] = []
  try {
    permits = await fetchEnerGovPermits(config, daysBack)
  } catch (err: any) {
    return {
      city: config.cityLabel,
      dry_run: dryRun,
      new_leads: 0,
      updated_leads: 0,
      errors: 1,
      error_messages: [err?.message ?? 'Fetch failed'],
      permits_fetched: 0,
      permits_scored: 0,
    }
  }

  // Score all permits
  const scored = permits.map((p) => {
    const { score, score_factors } = scorePermit(p)
    return { permit: p, score, score_factors }
  })

  // Only keep score >= 10 to avoid noise
  const viable = scored.filter((s) => s.score >= 10)

  if (dryRun) {
    return {
      city: config.cityLabel,
      dry_run: true,
      new_leads: viable.length,
      updated_leads: 0,
      errors: 0,
      error_messages: [],
      permits_fetched: permits.length,
      permits_scored: viable.length,
    }
  }

  // Upsert into hunter_leads
  let newCount = 0
  let updatedCount = 0

  for (const { permit: p, score, score_factors } of viable) {
    try {
      // Check existing by (permit_number, source_city)
      const { data: existing } = await supabase
        .from('hunter_leads')
        .select('id, score')
        .eq('permit_number', p.PermitNumber)
        .eq('source_city', config.cityLabel)
        .maybeSingle()

      const portalBase = new URL(config.baseUrl).origin
      const portalUrl = `${portalBase}/apps/SelfService#/permit/${p.PermitNumber}`

      const leadRow = {
        permit_number: p.PermitNumber,
        permit_type: p.PermitType ?? null,
        work_class: p.WorkClass ?? null,
        status: p.Status ?? null,
        apply_date: p.ApplyDate ?? null,
        issue_date: p.IssueDate ?? null,
        address: p.MainAddress ?? null,
        project_name: p.ProjectName ?? null,
        description: p.Description ?? null,
        contractor_name: p.ContractorName ?? null,
        score,
        score_factors,
        source: 'city-portal',
        source_city: config.cityLabel,
        portal_url: portalUrl,
        last_scraped_at: new Date().toISOString(),
        run_source: source,
      }

      if (existing) {
        await supabase
          .from('hunter_leads')
          .update(leadRow)
          .eq('id', existing.id)
        updatedCount++
      } else {
        await supabase
          .from('hunter_leads')
          .insert(leadRow)
        newCount++
      }
    } catch (err: any) {
      errorMessages.push(`${p.PermitNumber}: ${err?.message ?? 'upsert failed'}`)
    }
  }

  return {
    city: config.cityLabel,
    dry_run: false,
    new_leads: newCount,
    updated_leads: updatedCount,
    errors: errorMessages.length,
    error_messages: errorMessages,
    permits_fetched: permits.length,
    permits_scored: viable.length,
  }
}
