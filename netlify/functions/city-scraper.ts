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
    const encodedTerm = encodeURIComponent(term)
    const searchUrl = `${PALM_DESERT_ORIGIN}/s/global-search/${encodedTerm}`
    const timestamp = new Date().toISOString()
    let bootstrapStatus: number | null = null
    let auraStatus: number | null = null

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
      const bootstrapResponse = await fetch(searchUrl, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': 'PowerOn-SalesIntelligence-PalmDesert-Probe/1.0',
        },
      })
      bootstrapStatus = bootstrapResponse.status
      const bootstrapHtml = await bootstrapResponse.text()
      const bootstrapResult = {
        ...baseResult,
        http_status: bootstrapStatus,
        bootstrap_http_status: bootstrapStatus,
      }

      if (isBlockedPage(bootstrapHtml)) {
        return palmDesertProbeResponse(bootstrapResult, {
          response_type: 'blocked_challenge_page',
          body_snippet: textSnippet(bootstrapHtml),
        })
      }

      if (isLoginPage(bootstrapHtml)) {
        return palmDesertProbeResponse(bootstrapResult, {
          response_type: 'html_login_page',
          body_snippet: textSnippet(bootstrapHtml),
        })
      }

      const bootstrap = extractAuraBootstrap(bootstrapHtml)
      if (!bootstrap) {
        return palmDesertProbeResponse(bootstrapResult, {
          response_type: 'bootstrap_parse_failure',
          body_snippet: textSnippet(bootstrapHtml),
        })
      }

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

      const auraResponse = await fetch(PALM_DESERT_AURA_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Origin: PALM_DESERT_ORIGIN,
          Referer: searchUrl,
          'User-Agent': 'PowerOn-SalesIntelligence-PalmDesert-Probe/1.0',
        },
        body: requestBody.toString(),
      })
      auraStatus = auraResponse.status
      const auraText = await auraResponse.text()
      const auraResult = {
        ...baseResult,
        http_status: auraStatus,
        bootstrap_http_status: bootstrapStatus,
      }

      if (isBlockedPage(auraText)) {
        return palmDesertProbeResponse(auraResult, {
          response_type: 'blocked_challenge_page',
          body_snippet: textSnippet(auraText),
        })
      }

      if (/^\s*</.test(auraText)) {
        return palmDesertProbeResponse(auraResult, {
          response_type: isLoginPage(auraText) ? 'html_login_page' : 'unexpected_html',
          body_snippet: textSnippet(auraText),
        })
      }

      let auraData: any
      try {
        auraData = JSON.parse(auraText)
      } catch {
        return palmDesertProbeResponse(auraResult, {
          response_type: 'parse_failure',
          body_snippet: textSnippet(auraText),
        })
      }

      const action = auraData?.actions?.[0]
      const result = action?.returnValue
      const auraErrors = [
        ...(Array.isArray(action?.error) ? action.error : []),
        ...(Array.isArray(result?.error) ? result.error : []),
      ]
      const hasAuraError =
        !auraResponse.ok ||
        action?.state !== 'SUCCESS' ||
        Boolean(result?.hasError) ||
        auraErrors.length > 0
      const items = Array.isArray(result?.result) ? result.result : []
      const rawFieldNames = Array.from(
        items.reduce(
          (fields: Set<string>, item: any) => collectFieldNames(item?.record, '', fields),
          new Set<string>()
        )
      ).sort()

      return palmDesertProbeResponse(auraResult, {
        has_error: hasAuraError,
        response_type: hasAuraError ? 'salesforce_aura_error' : 'successful_aura_json',
        totalSize: result?.totalSize ?? null,
        moreResultsAvailable: result?.moreResultsAvailable ?? null,
        sample_count: items.length,
        sample_records: items.map((item: any) => normalizePalmDesertPermit(item, searchUrl)),
        raw_field_names: rawFieldNames,
        aura_errors: hasAuraError ? auraErrors : [],
        body_snippet: hasAuraError ? textSnippet(auraText) : null,
      })
    } catch (err: any) {
      return palmDesertProbeResponse({
        ...baseResult,
        http_status: auraStatus ?? bootstrapStatus,
        bootstrap_http_status: bootstrapStatus,
      }, {
        fetch_error: err?.message || String(err),
      })
    }
  }

  // ── TLMA REACHABILITY PROBE ──────────────────────────────────────────���───
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
