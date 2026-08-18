/**
 * SALES-CONVERSION-1 / LEAD-SRC-6C — Source normalization.
 *
 * Derives {family, detail, raw} from the acquisition metadata that already
 * exists on a hunter_lead row. The rules below read ONLY acquisition fields:
 *
 *   source        primary acquisition token written at ingest
 *                 Portal: paid_search / organic_search / ai_assistant / …
 *                 (channel stays on source_tag). Non-portal: tlma_riverside,
 *                 customer_portal (legacy/fallback), city-portal, etc.
 *   source_tag    secondary grouping / channel marker
 *                 Portal channel: always 'customer_portal'
 *                 TLMA: permit_* / tlma_browser_import
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

/** Portal submission channel marker stored on hunter_leads.source_tag. */
export const PORTAL_CHANNEL_TAG = 'customer_portal'

/**
 * Allowed portal_requests.source_category values (migration 120).
 * These are acquisition sources — distinct from the Customer Portal channel.
 */
export const PORTAL_ACQUISITION_CATEGORIES = [
  'paid_search',
  'ai_assistant',
  'gbp',
  'referral_site',
  'social',
  'organic_search',
  'direct',
  'other',
] as const

export type PortalAcquisitionCategory = (typeof PORTAL_ACQUISITION_CATEGORIES)[number]

const PORTAL_ACQUISITION_SET = new Set<string>(PORTAL_ACQUISITION_CATEGORIES)

/** Separator for grouping keys — cannot appear in a family or detail value. */
const SUMMARY_KEY_SEPARATOR = String.fromCharCode(31)

/**
 * Canonical channel/acquisition token -> display family. Keys are the values
 * actually written by the ingest paths in this repo.
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
  // Portal attribution categories (portal_requests.source_category)
  paid_search: 'Paid Search',
  ai_assistant: 'AI Assistant',
  gbp: 'Google Business Profile',
  referral_site: 'Referral Site',
  organic_search: 'Organic Search',
  social: 'Social',
  direct: 'Direct',
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
 * Normalize portal_requests.source_category for Hunter lead.source.
 * Invalid / empty → null (caller falls back to customer_portal channel-as-source).
 */
export function normalizePortalAcquisitionCategory(
  value: unknown
): PortalAcquisitionCategory | null {
  const key = normalizeToken(value)
  if (!key || !PORTAL_ACQUISITION_SET.has(key)) return null
  return key as PortalAcquisitionCategory
}

export function isPortalAcquisitionCategory(value: unknown): boolean {
  return normalizePortalAcquisitionCategory(value) != null
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
 *
 * Portal LEAD-SRC-6C shape:
 *   source      = paid_search | … (acquisition)
 *   source_tag  = customer_portal (channel)
 * → family Paid Search, detail Customer Portal
 *
 * Legacy portal / fallback:
 *   source = source_tag = customer_portal
 * → family Customer Portal
 */
export function deriveConversionSource(
  lead: Record<string, unknown> | null | undefined
): ConversionSource {
  const source = (lead?.source ?? lead?.leadSource ?? '') as string
  const sourceTag = (lead?.source_tag ?? lead?.sourceTag ?? '') as string
  const sourceCity = (lead?.source_city ?? lead?.sourceCity ?? '') as string

  // `source` is the primary acquisition token; `source_tag` is the fallback
  // grouping / channel marker used by feeds whose `source` is a per-scraper
  // implementation name — and by portal leads for Customer Portal channel.
  const family =
    familyFromToken(source) ?? familyFromToken(sourceTag) ?? UNKNOWN_SOURCE_FAMILY

  const cityDetail = detailFromSourceCity(sourceCity)
  const portalChannel =
    normalizeToken(sourceTag) === PORTAL_CHANNEL_TAG ||
    normalizeToken(source) === PORTAL_CHANNEL_TAG
  // When acquisition is finer than the portal channel, keep Customer Portal as
  // secondary detail so Source Performance rows are acquisition-primary.
  const detail =
    cityDetail ??
    (portalChannel && family !== 'Customer Portal' ? 'Customer Portal' : null)

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
