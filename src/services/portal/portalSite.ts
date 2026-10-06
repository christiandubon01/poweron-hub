/**
 * Portal site routing (migration 149).
 *
 * A public site key is an opaque, NON-SECRET routing identifier. The database resolves it to
 * exactly one enabled portal_site_integrations row and from there to the organization. The browser
 * never supplies organization_id, tenant ids or recipients.
 */

export const PORTAL_SITE_KEY_PATTERN = /^ps_[a-z0-9]{24,64}$/

/** Power On Solutions' own integration (seeded by migration 149). The shared app origin alone never selects a tenant. */
export const POWER_ON_PORTAL_SITE_KEY = 'ps_3f9c1e7ab25d4086b1c7e0aa'

export interface PortalSitePublicConfig {
  site_label: string
  display_name: string
  logo_url: string | null
  public_phone: string | null
  public_email: string | null
  tracking_base_url: string
}

/** Platform tracking host (not tied to any organization identity). */
export const DEFAULT_TRACKING_BASE_URL = 'https://app.poweronsolutionsllc.com'

export function isPortalSiteKey(value: unknown): value is string {
  return typeof value === 'string' && PORTAL_SITE_KEY_PATTERN.test(value)
}

/** Explicit env/link identifiers reach server validation; only absent identifiers use Power On. */
export function resolvePortalSiteKey(search: string = '', envKey?: string): string {
  if (envKey !== undefined && envKey !== '') return envKey
  try {
    const fromLink = new URLSearchParams(search).get('site')
    if (fromLink !== null) return fromLink
  } catch { /* fall through to the default */ }
  return POWER_ON_PORTAL_SITE_KEY
}

export function buildTrackingUrl(requestId: string, baseUrl: string = DEFAULT_TRACKING_BASE_URL): string {
  return `${baseUrl.replace(/\/$/, '')}/portal/track/${requestId}`
}

type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> }

/** Safe public branding projection; null for unknown/disabled keys. */
export async function fetchPortalSitePublicConfig(client: RpcClient, siteKey: string): Promise<PortalSitePublicConfig | null> {
  if (!isPortalSiteKey(siteKey)) return null
  const { data, error } = await client.rpc('get_portal_site_public_config', { p_site_key: siteKey })
  if (error || !data || typeof data !== 'object') return null
  return data as PortalSitePublicConfig
}
