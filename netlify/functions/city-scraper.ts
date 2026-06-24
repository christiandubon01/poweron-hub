// @ts-nocheck
/**
 * Netlify Function — City Portal Permit Scraper
 *
 * Scrapes building permits from Indio and Palm Springs via Tyler EnerGov CSS API.
 * Routes on ?city=indio|palm-springs
 * Supports ?dry_run=true and ?source=manual|cron
 *
 * HUNTER-CITY-SCRAPER-APR30-2026-1
 *
 * Diagnostic probe (no DB writes):
 *   ?action=tlma-probe[&city=INDIO&type=BNR&days_back=30]
 *   Tests whether Netlify outbound IPs can reach publiclookup.rivco.org
 *   without a Cloudflare challenge. Returns JSON result only.
 *
 *   ?action=palm-desert-probe[&term=el%20paseo&pageSize=5&page=1]
 *   Fetches the public Palm Desert Salesforce/Aura search bootstrap, then
 *   calls the public Permit search action. No browser session or DB writes.
 *
 *   ?action=palm-desert-dry-run[&terms=electrical,lighting&pageSize=10&maxPages=2]
 *   Queries multiple public terms/pages, dedupes and classifies permits in
 *   memory, and returns a preview report. No Supabase writes.
 */

import { scrapeCity } from './city-scraper/shared'
import { INDIO_CONFIG } from './city-scraper/indio'
import { PALM_SPRINGS_CONFIG } from './city-scraper/palm-springs'
import { createClient } from '@supabase/supabase-js'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
}

// Maps short permit type codes to the full string TLMA uses in its query params.
const TLMA_PERMIT_TYPE_MAP = {
  BNR: 'Commercial Buildings (BNR)',
  BTI: 'Tenant Improvement (BTI)',
  BMN: 'Manufactured Buildings Commercial (BMN)',
  BRS: 'Residential Dwelling (BRS)',
  BAR: 'Residential Addition, Rehab (BAR)',
  BAS: 'Accessory Building (BAS)',
  BSP: 'Pool, Spa, Fountains (BSP)',
  BMR: 'Manufactured Home Residential (BMR)',
}

// Browser-like headers mirroring the Supabase tlma-scraper function (v10).
const TLMA_BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.116 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'max-age=0',
  'Referer': 'https://publiclookup.rivco.org/',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-User': '?1',
}

const PALM_DESERT_ORIGIN = 'https://palmdesert.my.site.com'
const PALM_DESERT_AURA_URL =
  `${PALM_DESERT_ORIGIN}/s/sfsites/aura` +
  '?r=79&ui-search-components-forcesearch-scopedresultsdataprovider.ScopedResultsDataProvider.getItems=1'
const PALM_DESERT_AURA_DESCRIPTOR =
  'serviceComponent://ui.search.components.forcesearch.scopedresultsdataprovider.' +
  'ScopedResultsDataProviderController/ACTION$getItems'
const PALM_DESERT_WRITE_CONFIRMATION = 'palm-desert-import'
const HUNTER_TENANT_ID = '31a60821-2796-41fa-b48d-d7df59e48198'
const HUNTER_USER_ID = '6a5c2d43-cf37-45ff-9f22-d4d315683cf8'
const PALM_DESERT_DEFAULT_TERMS = [
  'electrical',
  'tenant improvement',
  'lighting',
  'panel',
  'service',
  'meter',
  'sub meter',
  'EV',
  'solar',
  'commercial',
  'el paseo',
]

function clampInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback
}

function textSnippet(value: string, maxLength = 500) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function isBlockedPage(value: string) {
  return (
    /just a moment/i.test(value) ||
    /cf-browser-verification/i.test(value) ||
    /_cf_chl/i.test(value) ||
    /challenge-platform\/scripts/i.test(value) ||
    /access denied/i.test(value)
  )
}

function isLoginPage(value: string) {
  return (
    /<form[^>]+(?:login|signin)/i.test(value) ||
    /name=["']username["']/i.test(value) ||
    /\/login(?:\?|["'])/i.test(value) ||
    /login \| salesforce/i.test(value)
  )
}

function extractAuraBootstrap(pageHtml: string) {
  const encodedContexts = Array.from(
    pageHtml.matchAll(
      /\/s\/sfsites\/l\/([^/"']+)\/(?:inline|resources|bootstrap)\.js/gi
    ),
    match => match[1]
  )

  for (const encodedContext of encodedContexts) {
    try {
      const parsed = JSON.parse(decodeURIComponent(encodedContext))
      const loadedApplication = parsed?.loaded?.['APPLICATION@markup://siteforce:communityApp']
      if (parsed?.fwuid && parsed?.app && loadedApplication) {
        return {
          mode: parsed.mode || 'PROD',
          fwuid: parsed.fwuid,
          app: parsed.app,
          loaded: {
            'APPLICATION@markup://siteforce:communityApp': loadedApplication,
          },
        }
      }
    } catch {
      // The page can contain several encoded loader contexts.
    }
  }

  return null
}

function collectFieldNames(value: any, prefix = '', fields = new Set<string>()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fields

  for (const [key, nestedValue] of Object.entries(value)) {
    const fieldName = prefix ? `${prefix}.${key}` : key
    fields.add(fieldName)
    if (nestedValue && typeof nestedValue === 'object' && !Array.isArray(nestedValue)) {
      collectFieldNames(nestedValue, fieldName, fields)
    }
  }

  return fields
}

function permitSlug(permitNumber: string) {
  return permitNumber
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function normalizePalmDesertPermit(item: any, fallbackSearchUrl: string) {
  const record = item?.record || {}
  const recordId = item?.recordId || record.Id || null
  const permitNumber = record.Name || null
  const detailUrl =
    recordId && permitNumber
      ? `${PALM_DESERT_ORIGIN}/s/permit2/${encodeURIComponent(recordId)}/${permitSlug(permitNumber)}`
      : fallbackSearchUrl

  return {
    permit_number: permitNumber,
    source_record_id: recordId,
    address: record?.MUSW__Address__r?.Name || null,
    city: 'Palm Desert',
    apn: record?.APN__r?.Name || null,
    stage: record.Stage__c__l || record.Stage__c || null,
    status: record.MUSW__Status__c__l || record.MUSW__Status__c || null,
    description: record.MUSW__Description__c || null,
    issue_date: record.MUSW__Issue_Date__c || null,
    issue_date_display: record.MUSW__Issue_Date__c__f || null,
    created_date: record.CreatedDate || null,
    created_date_display: record.CreatedDate__f || null,
    last_modified_date: record.LastModifiedDate || null,
    expiration_date: record.MUSW__Expiration_Date__c || null,
    source_url: detailUrl,
  }
}

async function fetchPalmDesertBootstrap(term: string) {
  const encodedTerm = encodeURIComponent(term)
  const searchUrl = `${PALM_DESERT_ORIGIN}/s/global-search/${encodedTerm}`
  const response = await fetch(searchUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'PowerOn-SalesIntelligence-PalmDesert/1.0',
    },
  })
  const bodyText = await response.text()

  if (isBlockedPage(bodyText)) {
    return {
      ok: false,
      response_type: 'blocked_challenge_page',
      http_status: response.status,
      search_url: searchUrl,
      body_snippet: textSnippet(bodyText),
    }
  }

  if (isLoginPage(bodyText)) {
    return {
      ok: false,
      response_type: 'html_login_page',
      http_status: response.status,
      search_url: searchUrl,
      body_snippet: textSnippet(bodyText),
    }
  }

  const context = extractAuraBootstrap(bodyText)
  if (!context) {
    return {
      ok: false,
      response_type: 'bootstrap_parse_failure',
      http_status: response.status,
      search_url: searchUrl,
      body_snippet: textSnippet(bodyText),
    }
  }

  return {
    ok: true,
    response_type: 'successful_bootstrap',
    http_status: response.status,
    search_url: searchUrl,
    context,
  }
}

async function fetchPalmDesertAuraPage(
  term: string,
  pageSize: number,
  page: number,
  bootstrap: any
) {
  const encodedTerm = encodeURIComponent(term)
  const searchUrl = `${PALM_DESERT_ORIGIN}/s/global-search/${encodedTerm}`
  const message = {
    actions: [{
      id: '79;a',
      descriptor: PALM_DESERT_AURA_DESCRIPTOR,
      callingDescriptor: 'UNKNOWN',
      params: {
        scopeMap: {
          name: 'MUSW__Permit2__c',
          label: 'Permit',
          labelPlural: 'Permits',
          keyPrefix: 'a1B',
          id: 'forceCommunity:MUSW__Permit2__c',
        },
        term,
        pageSize,
        currentPage: page,
        sortBy: null,
        enableRowActions: false,
        withSpellCorrection: true,
      },
    }],
  }
  const auraContext = {
    mode: bootstrap.mode,
    fwuid: bootstrap.fwuid,
    app: bootstrap.app,
    loaded: bootstrap.loaded,
    dn: [],
    globals: {},
    uad: false,
  }
  const requestBody = new URLSearchParams({
    message: JSON.stringify(message),
    'aura.context': JSON.stringify(auraContext),
    'aura.pageURI': `/s/global-search/${encodedTerm}`,
    'aura.token': 'null',
  })
  const response = await fetch(PALM_DESERT_AURA_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Origin: PALM_DESERT_ORIGIN,
      Referer: searchUrl,
      'User-Agent': 'PowerOn-SalesIntelligence-PalmDesert/1.0',
    },
    body: requestBody.toString(),
  })
  const bodyText = await response.text()

  if (isBlockedPage(bodyText)) {
    return {
      ok: false,
      response_type: 'blocked_challenge_page',
      http_status: response.status,
      body_snippet: textSnippet(bodyText),
      items: [],
    }
  }

  if (/^\s*</.test(bodyText)) {
    return {
      ok: false,
      response_type: isLoginPage(bodyText) ? 'html_login_page' : 'unexpected_html',
      http_status: response.status,
      body_snippet: textSnippet(bodyText),
      items: [],
    }
  }

  let data: any
  try {
    data = JSON.parse(bodyText)
  } catch {
    return {
      ok: false,
      response_type: 'parse_failure',
      http_status: response.status,
      body_snippet: textSnippet(bodyText),
      items: [],
    }
  }

  const action = data?.actions?.[0]
  const result = action?.returnValue
  const errors = [
    ...(Array.isArray(action?.error) ? action.error : []),
    ...(Array.isArray(result?.error) ? result.error : []),
  ]
  const hasError =
    !response.ok ||
    action?.state !== 'SUCCESS' ||
    Boolean(result?.hasError) ||
    errors.length > 0

  return {
    ok: !hasError,
    response_type: hasError ? 'salesforce_aura_error' : 'successful_aura_json',
    http_status: response.status,
    total_size: result?.totalSize ?? null,
    more_results_available: result?.moreResultsAvailable ?? false,
    items: Array.isArray(result?.result) ? result.result : [],
    errors,
    body_snippet: hasError ? textSnippet(bodyText) : null,
  }
}

function parsePalmDesertTerms(value: string | undefined) {
  if (!value) return PALM_DESERT_DEFAULT_TERMS

  const terms = value
    .split(',')
    .map(term => term.trim())
    .filter(Boolean)
    .map(term => term.slice(0, 100))

  const uniqueTerms = Array.from(new Set(terms)).slice(0, 15)
  return uniqueTerms.length ? uniqueTerms : PALM_DESERT_DEFAULT_TERMS
}

function classifyPalmDesertOpportunity(permit: any) {
  const text = [
    permit.permit_number,
    permit.address,
    permit.stage,
    permit.status,
    permit.description,
  ].filter(Boolean).join(' ').toLowerCase()
  const statusText = `${permit.stage || ''} ${permit.status || ''}`.toLowerCase()

  const electricalKeywords = [
    'electrical', 'lighting', 'light fixture', 'led', 'panel', 'service upgrade',
    'meter', 'submeter', 'sub meter', 'ev charger', 'electric vehicle',
    'solar', 'photovoltaic', 'battery', 'generator', 'rewire', 'wiring',
    'circuit', 'transformer', 'switchgear', 'title 24',
  ].filter(keyword => text.includes(keyword))
  const commercialKeywords = [
    'commercial', 'retail', 'restaurant', 'office', 'store', 'suite', 'salon',
    'warehouse', 'hotel', 'business', 'shopping', 'mall',
  ].filter(keyword => text.includes(keyword))
  const tenantImprovementKeywords = [
    'tenant improvement', 'tenant improvements', 'tenant remodel',
    'commercial remodel', 'interior remodel', 'buildout', 'build-out',
  ].filter(keyword => text.includes(keyword))
  const activeStatus = /(pending|in progress|inspection|active|issued|review|approved)/.test(statusText)
  const completed = /(complete|completed|finaled|closed)/.test(statusText)
  const cancelled = /(cancelled|canceled|void|denied|withdrawn|expired)/.test(statusText)
  const lastTouched = Date.parse(permit.last_modified_date || permit.issue_date || '')
  const staleByAge = Number.isFinite(lastTouched) &&
    Date.now() - lastTouched > 365 * 24 * 60 * 60 * 1000
  const stale = completed || cancelled || staleByAge

  let score = 0
  const scoreFactors: string[] = []
  if (electricalKeywords.length) {
    score += 35
    scoreFactors.push(`electrical:${electricalKeywords.slice(0, 4).join('|')}`)
  }
  if (tenantImprovementKeywords.length) {
    score += 25
    scoreFactors.push('tenant_improvement')
  }
  if (commercialKeywords.length) {
    score += 20
    scoreFactors.push('commercial')
  }
  if (activeStatus && !stale) {
    score += 15
    scoreFactors.push('active_status')
  }
  if (permit.matched_terms?.length > 1) {
    score += Math.min(10, (permit.matched_terms.length - 1) * 2)
    scoreFactors.push(`multi_term:${permit.matched_terms.length}`)
  }
  if (completed) {
    score -= 30
    scoreFactors.push('completed')
  }
  if (cancelled) {
    score -= 40
    scoreFactors.push('cancelled_or_expired')
  } else if (staleByAge) {
    score -= 15
    scoreFactors.push('stale_age')
  }

  score = Math.max(0, Math.min(100, score))

  return {
    opportunity_score: score,
    opportunity_tier:
      stale ? 'stale' :
      score >= 60 ? 'high' :
      score >= 40 ? 'medium' :
      'low',
    score_factors: scoreFactors,
    opportunity_flags: {
      electrical: electricalKeywords.length > 0,
      commercial: commercialKeywords.length > 0,
      tenant_improvement: tenantImprovementKeywords.length > 0,
      active_status: activeStatus,
      stale,
      completed,
      cancelled,
    },
    matched_keywords: {
      electrical: electricalKeywords,
      commercial: commercialKeywords,
      tenant_improvement: tenantImprovementKeywords,
    },
  }
}

function palmDesertScoreTier(score: number) {
  if (score >= 85) return 'elite'
  if (score >= 75) return 'strong'
  if (score >= 60) return 'qualified'
  return 'expansion'
}

function palmDesertPermitTypeCode(permitNumber: string | null) {
  const match = String(permitNumber || '').trim().match(/^([A-Za-z]+)/)
  return match ? match[1].toUpperCase() : null
}

function palmDesertScoreFactors(record: any) {
  const factors: Record<string, number> = {}
  for (const factor of record.score_factors || []) {
    factors[String(factor)] = 1
  }
  factors.matched_terms = Array.isArray(record.matched_terms)
    ? record.matched_terms.length
    : 0
  return factors
}

function palmDesertLeadRow(record: any, now: string) {
  const dateOnly = (value: string | null | undefined) =>
    value ? String(value).slice(0, 10) : null

  return {
    tenant_id: HUNTER_TENANT_ID,
    user_id: HUNTER_USER_ID,
    source: 'palm_desert_aura',
    source_tag: 'city-portal',
    lead_type: 'permit',
    permit_number: record.permit_number,
    permit_url: record.source_url,
    permit_type_code: palmDesertPermitTypeCode(record.permit_number),
    permit_type_label: 'Palm Desert Permit',
    permit_status: record.status || record.stage || null,
    applied_date: dateOnly(record.created_date),
    issued_date: dateOnly(record.issue_date),
    expired_date: dateOnly(record.expiration_date),
    address: record.address || null,
    city: 'Palm Desert',
    description: record.description || null,
    score: record.opportunity_score,
    score_tier: palmDesertScoreTier(record.opportunity_score),
    score_factors: palmDesertScoreFactors(record),
    source_city: 'Palm Desert',
    portal_url: record.source_url,
    run_source: 'manual',
    last_seen_at: now,
    last_updated: now,
  }
}

async function importPalmDesertLeads(supabase: any, records: any[]) {
  let rowsInserted = 0
  let rowsUpdated = 0
  let rowsSkipped = 0
  let existingDuplicates = 0
  const errors: any[] = []
  const now = new Date().toISOString()
  const importable = records.filter(record => {
    if (record.permit_number) return true
    rowsSkipped += 1
    errors.push({
      source_record_id: record.source_record_id || null,
      error: 'Missing permit_number; row skipped.',
    })
    return false
  })

  for (let offset = 0; offset < importable.length; offset += 100) {
    const batch = importable.slice(offset, offset + 100)
    const permitNumbers = batch.map(record => record.permit_number)
    const { data: existingRows, error: lookupError } = await supabase
      .from('hunter_leads')
      .select('id, permit_number')
      .eq('tenant_id', HUNTER_TENANT_ID)
      .in('permit_number', permitNumbers)

    if (lookupError) {
      rowsSkipped += batch.length
      errors.push({
        batch_offset: offset,
        error: `Existing-lead lookup failed: ${lookupError.message || String(lookupError)}`,
      })
      continue
    }

    const existingByPermit = new Map(
      (existingRows || []).map((row: any) => [row.permit_number, row.id])
    )
    const existingRecords = batch.filter(record =>
      existingByPermit.has(record.permit_number)
    )
    const newRecords = batch.filter(record =>
      !existingByPermit.has(record.permit_number)
    )
    existingDuplicates += existingRecords.length

    const updateResults = await mapWithConcurrency(
      existingRecords,
      6,
      async record => {
        const { error } = await supabase
          .from('hunter_leads')
          .update(palmDesertLeadRow(record, now))
          .eq('id', existingByPermit.get(record.permit_number))
        return { record, error }
      }
    )
    for (const result of updateResults) {
      if (result.error) {
        rowsSkipped += 1
        errors.push({
          permit_number: result.record.permit_number,
          error: result.error.message || String(result.error),
        })
      } else {
        rowsUpdated += 1
      }
    }

    if (newRecords.length) {
      const { error: insertError } = await supabase
        .from('hunter_leads')
        .insert(newRecords.map(record => ({
          ...palmDesertLeadRow(record, now),
          status: 'new',
          discovered_at: now,
        })))

      if (insertError) {
        rowsSkipped += newRecords.length
        errors.push({
          batch_offset: offset,
          permit_numbers: newRecords.map(record => record.permit_number),
          error: `Insert batch failed: ${insertError.message || String(insertError)}`,
        })
      } else {
        rowsInserted += newRecords.length
      }
    }
  }

  return {
    rows_inserted: rowsInserted,
    rows_updated: rowsUpdated,
    rows_skipped: rowsSkipped,
    existing_duplicate_count: existingDuplicates,
    errors,
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>
) {
  const results = new Array<R>(values.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex++
      results[index] = await mapper(values[index], index)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker())
  )
  return results
}

function palmDesertProbeResponse(base: any, overrides: any) {
  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      ...base,
      totalSize: null,
      moreResultsAvailable: null,
      sample_count: 0,
      sample_records: [],
      raw_field_names: [],
      body_snippet: null,
      ...overrides,
    }),
  }
}

exports.handler = async (event: any) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' }
  }

  const params = event.queryStringParameters || {}

  // Diagnostic only: fresh public Aura bootstrap + cookie-free permit search.
  // No Supabase client, scoring, or hunter_leads writes are reached here.
  if (params.action === 'palm-desert-probe') {
    const term = String(params.term || 'el paseo').trim().slice(0, 200) || 'el paseo'
    const pageSize = clampInteger(params.pageSize, 5, 1, 50)
    const page = clampInteger(params.page, 1, 1, 100)
    const timestamp = new Date().toISOString()

    const baseResult = {
      source: 'palm_desert_aura',
      term,
      page_size: pageSize,
      page,
      http_status: null,
      bootstrap_http_status: null,
      has_error: true,
      response_type: 'fetch_failure',
      timestamp,
    }

    try {
      const bootstrapResult = await fetchPalmDesertBootstrap(term)
      if (!bootstrapResult.ok) {
        return palmDesertProbeResponse({
          ...baseResult,
          http_status: bootstrapResult.http_status,
          bootstrap_http_status: bootstrapResult.http_status,
        }, {
          response_type: bootstrapResult.response_type,
          body_snippet: bootstrapResult.body_snippet,
        })
      }

      const pageResult = await fetchPalmDesertAuraPage(
        term,
        pageSize,
        page,
        bootstrapResult.context
      )
      const items = pageResult.items || []
      const rawFieldNames = Array.from(
        items.reduce(
          (fields: Set<string>, item: any) => collectFieldNames(item?.record, '', fields),
          new Set<string>()
        )
      ).sort()

      return palmDesertProbeResponse({
        ...baseResult,
        http_status: pageResult.http_status,
        bootstrap_http_status: bootstrapResult.http_status,
      }, {
        has_error: !pageResult.ok,
        response_type: pageResult.response_type,
        totalSize: pageResult.total_size,
        moreResultsAvailable: pageResult.more_results_available,
        sample_count: items.length,
        sample_records: items.map((item: any) =>
          normalizePalmDesertPermit(item, bootstrapResult.search_url)
        ),
        raw_field_names: rawFieldNames,
        aura_errors: pageResult.errors || [],
        body_snippet: pageResult.body_snippet,
      })
    } catch (err: any) {
      return palmDesertProbeResponse(baseResult, {
        fetch_error: err?.message || String(err),
      })
    }
  }

  // ── PALM DESERT DRY-RUN IMPORTER ──────────────────────────────────────
  // Multi-term importer. Dry-run is the default; writes require both
  // write=true and the exact Palm Desert confirmation token.
  if (params.action === 'palm-desert-dry-run') {
    const writeRequested = String(params.write || 'false').toLowerCase() === 'true'
    const writeConfirmed =
      writeRequested && params.confirm === PALM_DESERT_WRITE_CONFIRMATION
    const dryRun = !writeConfirmed

    if (writeRequested && !writeConfirmed) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          source: 'palm_desert_aura',
          mode: 'dry_run',
          dry_run: true,
          write_requested: true,
          write_confirmed: false,
          rows_considered: 0,
          rows_inserted: 0,
          rows_updated: 0,
          rows_skipped: 0,
          duplicate_count: 0,
          error_count: 1,
          errors: [{
            error: `Write rejected. Pass confirm=${PALM_DESERT_WRITE_CONFIRMATION} exactly.`,
          }],
          timestamp: new Date().toISOString(),
        }),
      }
    }

    const terms = parsePalmDesertTerms(params.terms)
    const pageSize = clampInteger(params.pageSize, 10, 1, 25)
    const maxPages = clampInteger(params.maxPages, 2, 1, 5)
    const minScore = clampInteger(params.minScore, 40, 0, 100)
    const includeCompleted = String(params.includeCompleted || 'false').toLowerCase() === 'true'
    const timestamp = new Date().toISOString()
    const warnings = [
      'Opportunity scores are dry-run-only heuristics and are not yet the production HUNTER scoring model.',
      'Aura global search is term-based and does not expose a date-window filter in this action.',
    ]
    const errors: any[] = []
    const uniquePermits = new Map<string, any>()
    let pagesRequested = 0
    let rawRecordsSeen = 0

    try {
      const bootstrapResult = await fetchPalmDesertBootstrap(terms[0])
      if (!bootstrapResult.ok) {
        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            source: 'palm_desert_aura',
            mode: 'dry_run',
            dry_run: true,
            write_requested: writeRequested,
            write_confirmed: writeConfirmed,
            terms_searched: terms,
            page_size: pageSize,
            max_pages: maxPages,
            min_score: minScore,
            include_completed: includeCompleted,
            pages_requested: 0,
            raw_records_seen: 0,
            unique_records: 0,
            high_opportunity_count: 0,
            skipped_completed_count: 0,
            rows_considered: 0,
            rows_inserted: 0,
            rows_updated: 0,
            rows_skipped: 0,
            duplicate_count: 0,
            error_count: 1,
            warnings,
            errors: [{
              stage: 'bootstrap',
              response_type: bootstrapResult.response_type,
              http_status: bootstrapResult.http_status,
              body_snippet: bootstrapResult.body_snippet,
            }],
            term_results: [],
            records_preview: [],
            timestamp,
          }),
        }
      }

      const termResults = await mapWithConcurrency(terms, 3, async term => {
        const termResult = {
          term,
          pages_requested: 0,
          raw_records_seen: 0,
          unique_records_matched: 0,
          more_results_available: false,
          errors: [] as any[],
        }
        const termKeys = new Set<string>()

        for (let page = 1; page <= maxPages; page++) {
          pagesRequested += 1
          termResult.pages_requested += 1

          try {
            const pageResult = await fetchPalmDesertAuraPage(
              term,
              pageSize,
              page,
              bootstrapResult.context
            )

            if (!pageResult.ok) {
              const pageError = {
                term,
                page,
                response_type: pageResult.response_type,
                http_status: pageResult.http_status,
                aura_errors: pageResult.errors || [],
                body_snippet: pageResult.body_snippet,
              }
              errors.push(pageError)
              termResult.errors.push(pageError)
              break
            }

            const items = pageResult.items || []
            rawRecordsSeen += items.length
            termResult.raw_records_seen += items.length
            termResult.more_results_available = Boolean(pageResult.more_results_available)

            for (const item of items) {
              const permit = normalizePalmDesertPermit(item, bootstrapResult.search_url)
              const dedupeKey = permit.source_record_id
                ? `id:${permit.source_record_id}`
                : permit.permit_number
                ? `permit:${String(permit.permit_number).toLowerCase()}`
                : null

              if (!dedupeKey) {
                warnings.push(`Skipped one ${term} result with no record ID or permit number.`)
                continue
              }

              termKeys.add(dedupeKey)
              const existing = uniquePermits.get(dedupeKey)
              if (existing) {
                existing.matched_terms = Array.from(
                  new Set([...(existing.matched_terms || []), term])
                )
              } else {
                uniquePermits.set(dedupeKey, {
                  ...permit,
                  matched_terms: [term],
                })
              }
            }

            if (!pageResult.more_results_available || items.length === 0) break
          } catch (err: any) {
            const pageError = {
              term,
              page,
              response_type: 'fetch_failure',
              fetch_error: err?.message || String(err),
            }
            errors.push(pageError)
            termResult.errors.push(pageError)
            break
          }
        }

        termResult.unique_records_matched = termKeys.size
        return termResult
      })

      const classifiedRecords = Array.from(uniquePermits.values()).map(permit => ({
        ...permit,
        ...classifyPalmDesertOpportunity(permit),
      }))
      const skippedCompletedCount = classifiedRecords.filter(record =>
        record.opportunity_flags.completed || record.opportunity_flags.cancelled
      ).length
      const eligibleRecords = classifiedRecords.filter(record =>
        includeCompleted ||
        (!record.opportunity_flags.completed && !record.opportunity_flags.cancelled)
      )
      const scoredRecords = eligibleRecords
        .filter(record => record.opportunity_score >= minScore)
        .sort((a, b) =>
          b.opportunity_score - a.opportunity_score ||
          String(b.last_modified_date || '').localeCompare(String(a.last_modified_date || '')) ||
          String(a.permit_number || '').localeCompare(String(b.permit_number || ''))
        )
      const recordsPreview = scoredRecords.slice(0, 200)
      const inMemoryDuplicateCount = Math.max(0, rawRecordsSeen - classifiedRecords.length)
      let importResult = {
        rows_inserted: 0,
        rows_updated: 0,
        rows_skipped: 0,
        existing_duplicate_count: 0,
        errors: [] as any[],
      }

      if (writeConfirmed) {
        const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
        if (!supabaseUrl || !supabaseKey) {
          importResult.errors.push({
            error: 'Supabase env vars not configured; no rows were written.',
          })
          importResult.rows_skipped = scoredRecords.length
        } else {
          const supabase = createClient(supabaseUrl, supabaseKey)
          importResult = await importPalmDesertLeads(supabase, scoredRecords)
        }
      }

      if (scoredRecords.length > recordsPreview.length) {
        warnings.push(
          `Records preview capped at ${recordsPreview.length} of ${scoredRecords.length} scored records.`
        )
      }
      if (params.terms && terms.length === 15) {
        warnings.push('Custom search terms are capped at 15 per invocation.')
      }

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          source: 'palm_desert_aura',
          mode: dryRun ? 'dry_run' : 'write',
          dry_run: dryRun,
          write_requested: writeRequested,
          write_confirmed: writeConfirmed,
          terms_searched: terms,
          page_size: pageSize,
          max_pages: maxPages,
          min_score: minScore,
          include_completed: includeCompleted,
          bootstrap_http_status: bootstrapResult.http_status,
          pages_requested: pagesRequested,
          raw_records_seen: rawRecordsSeen,
          unique_records: classifiedRecords.length,
          eligible_records: eligibleRecords.length,
          records_meeting_min_score: scoredRecords.length,
          high_opportunity_count: eligibleRecords.filter(
            record => record.opportunity_score >= 60
          ).length,
          skipped_completed_count: includeCompleted ? 0 : skippedCompletedCount,
          rows_considered: scoredRecords.length,
          rows_inserted: importResult.rows_inserted,
          rows_updated: importResult.rows_updated,
          rows_skipped:
            classifiedRecords.length - scoredRecords.length + importResult.rows_skipped,
          duplicate_count:
            inMemoryDuplicateCount + importResult.existing_duplicate_count,
          in_memory_duplicate_count: inMemoryDuplicateCount,
          existing_duplicate_count: importResult.existing_duplicate_count,
          error_count: errors.length + importResult.errors.length,
          warnings: Array.from(new Set(warnings)),
          errors: [...errors, ...importResult.errors],
          term_results: termResults,
          records_preview_truncated: scoredRecords.length > recordsPreview.length,
          records_preview: recordsPreview,
          timestamp,
        }),
      }
    } catch (err: any) {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          source: 'palm_desert_aura',
          mode: dryRun ? 'dry_run' : 'write',
          dry_run: dryRun,
          write_requested: writeRequested,
          write_confirmed: writeConfirmed,
          terms_searched: terms,
          page_size: pageSize,
          max_pages: maxPages,
          min_score: minScore,
          include_completed: includeCompleted,
          pages_requested: pagesRequested,
          raw_records_seen: rawRecordsSeen,
          unique_records: uniquePermits.size,
          high_opportunity_count: 0,
          skipped_completed_count: 0,
          rows_considered: 0,
          rows_inserted: 0,
          rows_updated: 0,
          rows_skipped: uniquePermits.size,
          duplicate_count: Math.max(0, rawRecordsSeen - uniquePermits.size),
          error_count: errors.length + 1,
          warnings,
          errors: [
            ...errors,
            { stage: 'dry_run', fetch_error: err?.message || String(err) },
          ],
          term_results: [],
          records_preview: [],
          timestamp,
        }),
      }
    }
  }

  // ── TLMA REACHABILITY PROBE ───────────────────────────────────────────
  // Diagnostic only. Makes ONE request to publiclookup.rivco.org and returns
  // the HTTP status + Cloudflare detection result. No DB writes, no scoring.
  if (params.action === 'tlma-probe') {
    const probeCity = (params.city || 'INDIO').toUpperCase()
    const probeTypeCode = (params.type || 'BNR').toUpperCase()
    const probeDaysBack = Math.min(Math.max(parseInt(params.days_back || '30', 10), 1), 90)
    const permitType = TLMA_PERMIT_TYPE_MAP[probeTypeCode] || `Commercial Buildings (BNR)`

    const startDate = new Date()
    startDate.setDate(startDate.getDate() - probeDaysBack)
    const startDateStr = startDate.toISOString().slice(0, 10)

    const urlParams = new URLSearchParams({
      Page: '1',
      PageSize: '10',
      SortBy: 'AppliedDate',
      SortDesc: 'true',
      'Criteria.PermitType': permitType,
      'Criteria.City': probeCity,
      'Criteria.AppliedDateStart': startDateStr,
    })
    const targetUrl = 'https://publiclookup.rivco.org/?' + urlParams.toString()

    try {
      const resp = await fetch(targetUrl, { headers: TLMA_BROWSER_HEADERS })
      const bodyText = await resp.text()
      const bodySnippet = bodyText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
      const isCloudflareChallenge =
        bodyText.includes('Just a moment') ||
        bodyText.includes('cf-browser-verification') ||
        bodyText.includes('_cf_chl') ||
        bodyText.includes('data-cf-settings')
      const looksLikeTlmaTable =
        !isCloudflareChallenge && resp.ok &&
        bodyText.includes('<table') && /permit/i.test(bodyText)

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          probe: 'tlma-reachability',
          city: probeCity,
          permit_type: permitType,
          permit_type_code: probeTypeCode,
          days_back: probeDaysBack,
          target_url: targetUrl,
          timestamp: new Date().toISOString(),
          http_status: resp.status,
          is_cloudflare_challenge: isCloudflareChallenge,
          looks_parseable: looksLikeTlmaTable,
          body_snippet: bodySnippet,
        }),
      }
    } catch (err: any) {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          probe: 'tlma-reachability',
          city: probeCity,
          permit_type: permitType,
          permit_type_code: probeTypeCode,
          days_back: probeDaysBack,
          target_url: targetUrl,
          timestamp: new Date().toISOString(),
          http_status: null,
          is_cloudflare_challenge: false,
          looks_parseable: false,
          fetch_error: err?.message || String(err),
        }),
      }
    }
  }
  // ── END TLMA PROBE ───────────────────────────────────────────────────────

  const city = (params.city || '').toLowerCase()
  const dryRun = params.dry_run === 'true'
  const source = params.source || 'manual'

  const config = city === 'indio'
    ? INDIO_CONFIG
    : city === 'palm-springs'
    ? PALM_SPRINGS_CONFIG
    : null

  if (!config) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: 'Missing or invalid ?city param. Use city=indio or city=palm-springs',
      }),
    }
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

  if (!supabaseUrl || !supabaseKey) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Supabase env vars not configured' }),
    }
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  try {
    const result = await scrapeCity(supabase, config, { dryRun, source, daysBack: 30 })
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(result),
    }
  } catch (err: any) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err?.message || 'city-scraper internal error' }),
    }
  }
}
