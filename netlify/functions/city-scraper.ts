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

exports.handler = async (event: any) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' }
  }

  const params = event.queryStringParameters || {}

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
