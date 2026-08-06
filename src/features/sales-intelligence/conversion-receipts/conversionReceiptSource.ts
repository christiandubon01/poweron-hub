/**
 * SALES-CONVERSION-1 — Source normalization.
 *
 * Derives {family, detail, raw} from the acquisition metadata that already
 * exists on a hunter_lead row. The rules below read ONLY acquisition fields:
 *
 *   source        free-form channel token written at ingest
 *                 ('customer_portal', 'city-portal', 'tlma_riverside',
 *                  'palm_desert_aura', 'manual_entry', 'referral', ...)
 *   source_tag    grouping marker written alongside it ('city-portal', ...)
 *   source_city   the feed/city the row was acquired FROM — migration 074.
 *                 The city-scraper writes its cityLabel here ('Indio',
 *                 'Palm Desert'); migration 074 backfilled the literal 'TLMA'
 *                 onto pre-existing rows that have no known city.
 *
 * It deliberately does NOT read `address` or `city`. Those describe where the
 * job site is, not where the lead came from, and inferring "Indio" from a
 * street address would fabricate acquisition data.
 */

import type { ConversionSource } from './conversionReceiptTypes'

/** Fallback family when no source metadata exists at all. */
export const UNKNOWN_SOURCE_FAMILY = 'Other'

/** Separator for grouping keys — cannot appear in a family or detail value. */
const SUMMARY_KEY_SEPARATOR = String.fromCharCode(31)

/**
 * Canonical channel token -> display family. Keys are the values actually
 * written by the ingest paths in this repo.
 */
const FAMILY_BY_TOKEN: Record<string, string> = {
  customer_portal: 'Customer Portal',
  'city-portal': 'City Portal',
  city_portal: 'City Portal',
  palm_desert_aura: 'City Portal',
  manual_entry: 'Manual',
  manual: 'Manual',
  referral: 'Referral',
  website: 'Website',
  web: 'Website',
  google: 'Google',
  yelp_ad: 'Yelp Ad',
  phone_call: 'Phone Call',
  facebook: 'Facebook',
  other: 'Other',
}

/**
 * `source_city` values that are markers rather than real feed locations.
 * Migration 074 stamped 'TLMA' onto legacy rows; that is the family, not a
 * detail, so it must not surface as "TLMA / TLMA".
 */
const NON_LOCATION_SOURCE_CITY = new Set(['tlma', 'unknown', 'n/a', 'none'])

function normalizeToken(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

/** Title-cases an unmapped token so 'some_new_feed' reads 'Some New Feed'. */
function humanizeToken(token: string): string {
  return token
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/** Maps one channel token to a display family, or null when unrecognizable. */
export function familyFromToken(token: unknown): string | null {
  const key = normalizeToken(token)
  if (!key) return null
  if (FAMILY_BY_TOKEN[key]) return FAMILY_BY_TOKEN[key]
  // Every TLMA ingest variant (tlma_riverside, tlma_publiclookup,
  // tlma_browser_import) belongs to the one operator-facing family.
  if (key.startsWith('tlma')) return 'TLMA'
  return humanizeToken(key) || null
}

/**
 * Reads `source_city` as an acquisition detail. Returns null for the marker
 * values so a missing detail never becomes a fake one.
 */
export function detailFromSourceCity(sourceCity: unknown): string | null {
  const raw = typeof sourceCity === 'string' ? sourceCity.trim() : ''
  if (!raw) return null
  if (NON_LOCATION_SOURCE_CITY.has(raw.toLowerCase())) return null
  return raw
}

/**
 * Derive the normalized source for a lead-shaped object. Accepts both the
 * snake_case Supabase row and the camelCase panel shape.
 */
export function deriveConversionSource(
  lead: Record<string, unknown> | null | undefined
): ConversionSource {
  const source = (lead?.source ?? lead?.leadSource ?? '') as string
  const sourceTag = (lead?.source_tag ?? lead?.sourceTag ?? '') as string
  const sourceCity = (lead?.source_city ?? lead?.sourceCity ?? '') as string

  // `source` is the primary channel; `source_tag` is the fallback grouping
  // marker used by feeds whose `source` is a per-scraper implementation name.
  const family =
    familyFromToken(source) ?? familyFromToken(sourceTag) ?? UNKNOWN_SOURCE_FAMILY

  const detail = detailFromSourceCity(sourceCity)

  const rawParts = [source, sourceTag, sourceCity]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
  // De-duplicate so 'customer_portal | customer_portal' does not get stored.
  const raw = [...new Set(rawParts)].join(' | ') || null

  return { family, detail, raw }
}

/** "TLMA / Indio" when a detail exists, otherwise just the family. */
export function formatSourceLabel(family: string, detail: string | null): string {
  return detail ? `${family} / ${detail}` : family
}

/** Stable grouping key for summaries and filters. */
export function sourceSummaryKey(family: string, detail: string | null): string {
  return [family, detail ?? ''].join(SUMMARY_KEY_SEPARATOR)
}
