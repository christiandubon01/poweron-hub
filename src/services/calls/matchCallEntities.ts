/**
 * LEAD-SRC-3B — read-only best-effort phone entity matching.
 * Never mutates hunter_leads / portal_requests / clients.
 */

import { normalizePhone } from './phoneNormalize'

export type CallEntityKind = 'hunter_lead' | 'portal_request' | 'client'

export interface CallEntityCandidate {
  kind: CallEntityKind
  id: string
  label: string
  phoneRaw: string | null | undefined
}

export interface CallEntityMatch {
  kind: CallEntityKind
  id: string
  label: string
  phoneNormalized: string
}

export type CallEntityMatchResult =
  | { status: 'none' }
  | { status: 'single'; match: CallEntityMatch }
  | { status: 'ambiguous'; matches: CallEntityMatch[] }

/**
 * Exact normalized equality only. Multiple hits → ambiguous (no guess).
 */
export function matchEntitiesByNormalizedPhone(
  phoneRaw: string | null | undefined,
  candidates: CallEntityCandidate[],
): CallEntityMatchResult {
  const target = normalizePhone(phoneRaw)
  if (!target) return { status: 'none' }

  const matches: CallEntityMatch[] = []
  const seen = new Set<string>()

  for (const c of candidates) {
    const n = normalizePhone(c.phoneRaw)
    if (!n || n !== target) continue
    const key = `${c.kind}:${c.id}`
    if (seen.has(key)) continue
    seen.add(key)
    matches.push({
      kind: c.kind,
      id: c.id,
      label: c.label,
      phoneNormalized: n,
    })
  }

  if (matches.length === 0) return { status: 'none' }
  if (matches.length === 1) return { status: 'single', match: matches[0]! }
  return { status: 'ambiguous', matches }
}

export function linksFromMatchResult(result: CallEntityMatchResult): {
  hunter_lead_id?: string
  portal_request_id?: string
  client_id?: string
} {
  if (result.status !== 'single') return {}
  const m = result.match
  if (m.kind === 'hunter_lead') return { hunter_lead_id: m.id }
  if (m.kind === 'portal_request') return { portal_request_id: m.id }
  return { client_id: m.id }
}
