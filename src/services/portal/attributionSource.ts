const AI_ASSISTANT_HOSTS = [
  'chatgpt.com',
  'perplexity.ai',
  'gemini.google.com',
  'copilot.microsoft.com',
  'claude.ai',
] as const

const REFERRAL_SITE_PATTERNS = [
  'yelp.',
  'angi.',
  'nextdoor.',
  'thumbtack.',
  'buildzoom.',
  'planhub.',
] as const

const SOCIAL_PATTERNS = [
  'facebook.',
  'instagram.',
  'linkedin.',
  'x.com',
  'twitter.',
] as const

const ORGANIC_SEARCH_PATTERNS = [
  'google.',
  'bing.',
  'duckduckgo.',
  'yahoo.',
] as const

function normalizedValue(attribution: Record<string, string>, key: string): string {
  return (attribution[key] ?? '').trim().toLowerCase()
}

function parseReferrer(referrer: string): URL | null {
  if (!referrer) return null
  try {
    return new URL(referrer)
  } catch {
    return null
  }
}

function hostnameMatches(hostname: string, candidate: string): boolean {
  return hostname === candidate || hostname.endsWith(`.${candidate}`)
}

function hostnameContainsPattern(hostname: string, pattern: string): boolean {
  return hostname === pattern || hostname.includes(pattern)
}

export function classifySource(attribution: Record<string, string>): string {
  const gclid = normalizedValue(attribution, 'gclid')
  const gbraid = normalizedValue(attribution, 'gbraid')
  const wbraid = normalizedValue(attribution, 'wbraid')

  if (gclid || gbraid || wbraid) {
    return 'paid_search'
  }

  const utmMedium = normalizedValue(attribution, 'utm_medium')
  if (utmMedium === 'cpc' || utmMedium === 'ppc' || utmMedium === 'paid') {
    return 'paid_search'
  }

  const utmSource = normalizedValue(attribution, 'utm_source')
  if (AI_ASSISTANT_HOSTS.some((host) => hostnameMatches(utmSource, host))) {
    return 'ai_assistant'
  }

  const referrer = normalizedValue(attribution, 'referrer')
  const parsedReferrer = parseReferrer(referrer)
  const referrerHostname = parsedReferrer?.hostname.toLowerCase() ?? ''
  const referrerPathname = parsedReferrer?.pathname.toLowerCase() ?? ''

  if (AI_ASSISTANT_HOSTS.some((host) => hostnameMatches(referrerHostname, host))) {
    return 'ai_assistant'
  }

  if (
    referrerHostname === 'share.google' ||
    ((referrerHostname === 'google.com' || referrerHostname.endsWith('.google.com')) &&
      referrerPathname.startsWith('/maps'))
  ) {
    return 'gbp'
  }

  if (REFERRAL_SITE_PATTERNS.some((pattern) => hostnameContainsPattern(referrerHostname, pattern))) {
    return 'referral_site'
  }

  if (SOCIAL_PATTERNS.some((pattern) => hostnameContainsPattern(referrerHostname, pattern))) {
    return 'social'
  }

  if (ORGANIC_SEARCH_PATTERNS.some((pattern) => hostnameContainsPattern(referrerHostname, pattern))) {
    return 'organic_search'
  }

  if (!referrer) {
    return 'direct'
  }

  if (referrerHostname && hostnameMatches(referrerHostname, 'poweronsolutionsllc.com')) {
    return 'direct'
  }

  return 'other'
}
