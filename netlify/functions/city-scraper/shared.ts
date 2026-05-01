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
  CaseId?: string
  CaseNumber: string
  CaseType?: string
  CaseWorkclass?: string
  CaseStatus?: string
  ApplyDate?: string
  IssueDate?: string | null
  AddressDisplay?: string
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
  return {
    Keyword: '',
    ExactMatch: true,
    SearchModule: 1,
    FilterModule: 2,
    SearchMainAddress: false,
    PlanCriteria: { PlanNumber: null, PlanTypeId: null, PlanWorkclassId: null, PlanStatusId: null, ProjectName: null, ApplyDateFrom: null, ApplyDateTo: null, ExpireDateFrom: null, ExpireDateTo: null, CompleteDateFrom: null, CompleteDateTo: null, Address: null, Description: null, SearchMainAddress: false, ContactId: null, ParcelNumber: null, TypeId: null, WorkClassIds: null, ExcludeCases: null, EnableDescriptionSearch: false, PageNumber: 0, PageSize: 0, SortBy: null, SortAscending: false },
    PermitCriteria: { PermitNumber: null, PermitTypeId: 'none', PermitWorkclassId: null, PermitStatusId: 'none', ProjectName: null, IssueDateFrom: null, IssueDateTo: null, Address: null, Description: null, ExpireDateFrom: null, ExpireDateTo: null, FinalDateFrom: null, FinalDateTo: null, ApplyDateFrom: applyDateFrom, ApplyDateTo: applyDateTo, SearchMainAddress: false, ContactId: null, TypeId: null, WorkClassIds: null, ParcelNumber: null, ExcludeCases: null, EnableDescriptionSearch: false, PageNumber: page, PageSize: pageSize, SortBy: 'ApplyDate', SortAscending: false },
    InspectionCriteria: { Keyword: null, ExactMatch: false, Complete: null, InspectionNumber: null, InspectionTypeId: null, InspectionStatusId: null, RequestDateFrom: null, RequestDateTo: null, ScheduleDateFrom: null, ScheduleDateTo: null, Address: null, SearchMainAddress: false, ContactId: null, TypeId: [], WorkClassIds: [], ParcelNumber: null, DisplayCodeInspections: false, ExcludeCases: [], ExcludeFilterModules: [], HiddenInspectionTypeIDs: null, PageNumber: 0, PageSize: 0, SortBy: null, SortAscending: false },
    CodeCaseCriteria: { CodeCaseNumber: null, CodeCaseTypeId: null, CodeCaseStatusId: null, ProjectName: null, OpenedDateFrom: null, OpenedDateTo: null, ClosedDateFrom: null, ClosedDateTo: null, Address: null, ParcelNumber: null, Description: null, SearchMainAddress: false, RequestId: null, ExcludeCases: null, ContactId: null, EnableDescriptionSearch: false, PageNumber: 0, PageSize: 0, SortBy: null, SortAscending: false },
    RequestCriteria: { RequestNumber: null, RequestTypeId: null, RequestStatusId: null, ProjectName: null, EnteredDateFrom: null, EnteredDateTo: null, DeadlineDateFrom: null, DeadlineDateTo: null, CompleteDateFrom: null, CompleteDateTo: null, Address: null, ParcelNumber: null, SearchMainAddress: false, PageNumber: 0, PageSize: 0, SortBy: null, SortAscending: false },
    BusinessLicenseCriteria: { LicenseNumber: null, LicenseTypeId: null, LicenseClassId: null, LicenseStatusId: null, BusinessStatusId: null, LicenseYear: null, ApplicationDateFrom: null, ApplicationDateTo: null, IssueDateFrom: null, IssueDateTo: null, ExpirationDateFrom: null, ExpirationDateTo: null, SearchMainAddress: false, CompanyTypeId: null, CompanyName: null, BusinessTypeId: null, Description: null, CompanyOpenedDateFrom: null, CompanyOpenedDateTo: null, CompanyClosedDateFrom: null, CompanyClosedDateTo: null, LastAuditDateFrom: null, LastAuditDateTo: null, ParcelNumber: null, Address: null, TaxID: null, DBA: null, ExcludeCases: null, TypeId: null, WorkClassIds: null, ContactId: null, PageNumber: 0, PageSize: 0, SortBy: null, SortAscending: false },
    ProfessionalLicenseCriteria: { LicenseNumber: null, HolderFirstName: null, HolderMiddleName: null, HolderLastName: null, HolderCompanyName: null, LicenseTypeId: null, LicenseClassId: null, LicenseStatusId: null, IssueDateFrom: null, IssueDateTo: null, ExpirationDateFrom: null, ExpirationDateTo: null, ApplicationDateFrom: null, ApplicationDateTo: null, Address: null, MainParcel: null, SearchMainAddress: false, ExcludeCases: null, TypeId: null, WorkClassIds: null, ContactId: null, PageNumber: 0, PageSize: 0, SortBy: null, SortAscending: false },
    LicenseCriteria: { LicenseNumber: null, LicenseTypeId: null, LicenseClassId: null, LicenseStatusId: null, BusinessStatusId: null, ApplicationDateFrom: null, ApplicationDateTo: null, IssueDateFrom: null, IssueDateTo: null, ExpirationDateFrom: null, ExpirationDateTo: null, SearchMainAddress: false, CompanyTypeId: null, CompanyName: null, BusinessTypeId: null, Description: null, CompanyOpenedDateFrom: null, CompanyOpenedDateTo: null, CompanyClosedDateFrom: null, CompanyClosedDateTo: null, LastAuditDateFrom: null, LastAuditDateTo: null, ParcelNumber: null, Address: null, TaxID: null, DBA: null, ExcludeCases: null, TypeId: null, WorkClassIds: null, ContactId: null, HolderFirstName: null, HolderMiddleName: null, HolderLastName: null, MainParcel: null, EnableDescriptionSearchForBLicense: false, EnableDescriptionSearchForPLicense: false, EnableDescriptionSearchForOperationalPermit: false, IsOperationalPermit: false, PageNumber: 0, PageSize: 0, SortBy: null, SortAscending: false },
    ProjectCriteria: { ProjectNumber: null, ProjectName: null, Address: null, ParcelNumber: null, StartDateFrom: null, StartDateTo: null, ExpectedEndDateFrom: null, ExpectedEndDateTo: null, CompleteDateFrom: null, CompleteDateTo: null, Description: null, SearchMainAddress: false, ContactId: null, TypeId: null, ExcludeCases: null, EnableDescriptionSearch: false, PageNumber: 0, PageSize: 0, SortBy: null, SortAscending: false },
    PlanSortList: [{ Key: 'relevance', Value: 'Relevance' }, { Key: 'PlanNumber.keyword', Value: 'Plan Number' }, { Key: 'ProjectName.keyword', Value: 'Project' }, { Key: 'MainAddress', Value: 'Address' }, { Key: 'ApplyDate', Value: 'Apply Date' }],
    PermitSortList: [{ Key: 'relevance', Value: 'Relevance' }, { Key: 'PermitNumber.keyword', Value: 'Permit Number' }, { Key: 'ProjectName.keyword', Value: 'Project' }, { Key: 'MainAddress', Value: 'Address' }, { Key: 'IssueDate', Value: 'Issued Date' }, { Key: 'FinalDate', Value: 'Finalized Date' }],
    InspectionSortList: [{ Key: 'relevance', Value: 'Relevance' }, { Key: 'InspectionNumber.keyword', Value: 'Inspection Number' }, { Key: 'MainAddress', Value: 'Address' }, { Key: 'ScheduledDate', Value: 'Schedule Date' }, { Key: 'RequestDate', Value: 'Request Date' }],
    CodeCaseSortList: [{ Key: 'relevance', Value: 'Relevance' }, { Key: 'CaseNumber.keyword', Value: 'Code Case Number' }, { Key: 'ProjectName.keyword', Value: 'Project' }, { Key: 'MainAddress', Value: 'Address' }, { Key: 'OpenedDate', Value: 'Opened Date' }, { Key: 'ClosedDate', Value: 'Closed Date' }],
    RequestSortList: [{ Key: 'relevance', Value: 'Relevance' }, { Key: 'RequestNumber.keyword', Value: 'Request Number' }, { Key: 'ProjectName.keyword', Value: 'Project Name' }, { Key: 'MainAddress', Value: 'Address' }, { Key: 'EnteredDate', Value: 'Date Entered' }, { Key: 'CompleteDate', Value: 'Completion Date' }],
    LicenseSortList: [{ Key: 'relevance', Value: 'Relevance' }, { Key: 'LicenseNumber.keyword', Value: 'License Number' }, { Key: 'LicenseNumber.keyword', Value: 'Operational Permit Number' }, { Key: 'CompanyName.keyword', Value: 'Company Name' }, { Key: 'AppliedDate', Value: 'Applied Date' }, { Key: 'MainAddress', Value: 'Address' }],
    ProjectSortList: [{ Key: 'relevance', Value: 'Relevance' }, { Key: 'ProjectNumber.keyword', Value: 'Project Number' }, { Key: 'ProjectName.keyword', Value: 'Project Name' }, { Key: 'StartDate', Value: 'Start Date' }, { Key: 'CompleteDate', Value: 'Completed Date' }, { Key: 'ExpectedEndDate', Value: 'Expected End Date' }, { Key: 'MainAddress', Value: 'Address' }],
    SortOrderList: [{ Key: true, Value: 'Ascending' }, { Key: false, Value: 'Descending' }],
    ExcludeCases: null,
    HiddenInspectionTypeIDs: null,
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
  const MAX_PAGES = 2

  const headers: Record<string, string> = {
    'Content-Type': 'application/json;charset=UTF-8',
    'accept': 'application/json, text/plain, */*',
    'cookie': 'Tyler-Tenant-Culture=en-US',
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
    const permits: EnerGovPermit[] = data?.Result?.EntityResults ?? []
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
  const wc = (p.CaseWorkclass ?? '').toLowerCase().trim()
  const pt = (p.CaseType ?? '').toLowerCase()
  const status = (p.CaseStatus ?? '').toLowerCase().trim()

  // ── Work class signals (tuned to real EnerGov values) ─────────────────────

  // Tier 1: Direct C-10 electrical work (+35)
  const directElec = [
    'panel upgrade', 'simple main panel upgrade',
    'electrical modification', 'electrical',
    'residential ev station',
    'residential energy storage system (ess)',
  ]
  if (directElec.some(v => wc === v || wc.includes(v))) {
    score += 35; factors.push('direct_electrical')
  }
  // Tier 2: New construction — always needs electrical rough-in (+30)
  else if (wc === 'new' || wc.includes('condominiums new') || wc.includes('new commercial')) {
    score += 30; factors.push('new_construction')
  }
  // Tier 3: Solar / PV / ESS — adjacent C-10 work (+25)
  else if (
    wc.includes('photovoltaic') || wc.includes('solar panel') ||
    wc.includes('simple photovoltaic') || wc.includes('energy storage')
  ) {
    score += 25; factors.push('solar_pv')
  }
  // Tier 4: ADU / additions (+22)
  else if (wc.includes('adu') || wc.includes('accessory dwelling')) {
    score += 22; factors.push('adu')
  }
  // Tier 5: Additions / alterations (+18)
  else if (wc.includes('addition') || wc.includes('alteration') || wc.includes('remodel')) {
    score += 18; factors.push('addition_remodel')
  }
  // Tier 6: Commercial non-residential (+20)
  else if (wc.includes('non residential') || wc.includes('commercial') || pt.includes('commercial')) {
    score += 20; factors.push('commercial')
  }
  // Tier 7: Pool & Spa — has electrical component (+12)
  else if (wc.includes('pool') || wc.includes('spa')) {
    score += 12; factors.push('pool_spa')
  }

  // ── Electrical keywords in description — direct signal (+20) ─────────────
  const elecKeywords = [
    'electrical', 'panel upgrade', 'service upgrade', 'main panel',
    'sub-panel', 'subpanel', 'wiring', 'rewire', 'circuit',
    'meter', 'ev charger', 'electric vehicle', 'solar', 'photovoltaic',
    'pv system', 'battery storage', 'ess', 'generator', 'interconnect',
  ]
  for (const kw of elecKeywords) {
    if (desc.includes(kw)) {
      score += 20
      factors.push(`elec_kw:${kw.replace(/ /g, '_')}`)
      break // one match is enough
    }
  }

  // ── Status signals (tuned to real EnerGov permit_status values) ───────────
  if (
    status === 'submitted' || status === 'submitted - online' ||
    status === 'in review' || status === 'ready to review'
  ) {
    score += 15; factors.push('status:early')
  } else if (status === 'fees due' || status === "outstanding coa's") {
    score += 12; factors.push('status:fees_due')
  } else if (status === 'issued') {
    score += 8; factors.push('status:issued')
  } else if (status === 'corrections requested') {
    score += 5; factors.push('status:corrections')
  } else if (
    status === 'denied' || status === 'void' ||
    status === 'canceled' || status === 'complete'
  ) {
    score -= 15; factors.push('status:closed')
  }

  // ── No contractor assigned = open opportunity (+10) ───────────────────────
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
  const { dryRun = false, source = 'cron', daysBack = 7 } = options
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
        .eq('permit_number', p.CaseNumber)
        .eq('source_city', config.cityLabel)
        .maybeSingle()

      const portalBase = new URL(config.baseUrl).origin
      const portalUrl = p.CaseId
        ? `${portalBase}/apps/SelfService#/permit/${p.CaseId}`
        : `${portalBase}/apps/SelfService#/permit/${p.CaseNumber}`

      const leadRow = {
        tenant_id: '31a60821-2796-41fa-b48d-d7df59e48198',
        user_id: '6a5c2d43-cf37-45ff-9f22-d4d315683cf8',
        source: 'city-portal',
        lead_type: 'permit',
        permit_number: p.CaseNumber,
        permit_type_label: p.CaseType ?? null,
        work_class_code: p.CaseWorkclass ?? null,
        permit_status: p.CaseStatus ?? null,
        applied_date: p.ApplyDate ? p.ApplyDate.split('T')[0] : null,
        issued_date: p.IssueDate ? p.IssueDate.split('T')[0] : null,
        address: p.AddressDisplay ?? null,
        city: config.cityLabel,
        description: p.Description ?? null,
        score,
        score_factors: score_factors.reduce((acc: Record<string, number>, f: string) => {
          acc[f] = 1; return acc
        }, {}),
        source_city: config.cityLabel,
        portal_url: portalUrl,
        run_source: source,
        contractor_name: p.ContractorName ?? null,
        contractor_name: p.ContractorName ?? null,
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
      errorMessages.push(`${p.CaseNumber}: ${err?.message ?? 'upsert failed'}`)
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
