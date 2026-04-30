// @ts-nocheck
/**
 * Netlify Function — City Portal Permit Scraper
 *
 * Scrapes building permits from Indio and Palm Springs via Tyler EnerGov CSS API.
 * Routes on ?city=indio|palm-springs
 * Supports ?dry_run=true and ?source=manual|cron
 *
 * HUNTER-CITY-SCRAPER-APR30-2026-1
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

exports.handler = async (event: any) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' }
  }

  const params = event.queryStringParameters || {}
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
