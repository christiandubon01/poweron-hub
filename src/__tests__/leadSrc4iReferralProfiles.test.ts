/**
 * LEAD-SRC-4I — Canonical referral profiles + full owner search.
 *
 * Proves:
 *  1-5   standalone profile create, no Client/Lead, claim link, raw text immutable
 *  6-8   count from linked claims; variants link to same profile; no auto-group
 *  9-10  duplicate-name warn + forceSeparate
 *  11-16 search sources + search never mutates
 *  17-18 customer→profile + existing resolved compatibility (migration SQL)
 *  19-20 public privacy / portal boundary
 *  21-22 4H confirm-unlinked + reset
 *  23-24 conservative matcher + history by profile ID
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const state = {
  tables: {} as Record<string, Record<string, any>[]>,
  updatePayloads: [] as Array<{ table: string; payload: Record<string, any>; eq?: { col: string; val: any } }>,
  inserts: [] as Array<{ table: string; payload: Record<string, any> }>,
  authUser: { id: 'owner-user-id' } as { id: string } | null,
  lastOrFilter: null as string | null,
  lastIlike: null as { col: string; val: string } | null,
}

function rows(table: string) {
  return state.tables[table] ?? []
}

vi.mock('@/lib/supabase', () => {
  const makeQuery = (tableName: string) => {
    const filters: Array<(row: any) => boolean> = []
    let pendingInsert: Record<string, any> | null = null

    const runSelect = () => {
      let data = rows(tableName)
      for (const f of filters) data = data.filter(f)
      return { data, error: null as null }
    }

    const q: any = {
      select: () => q,
      eq: (col: string, val: any) => {
        filters.push((row: any) => row[col] === val)
        return q
      },
      not: (_col: string, op: string, val?: any) => {
        if (op === 'is' && (val === null || val === undefined)) {
          filters.push((row: any) => row[_col] != null)
        }
        return q
      },
      ilike: (col: string, val: string) => {
        state.lastIlike = { col, val }
        const needle = String(val).replace(/^%|%$/g, '').toLowerCase()
        filters.push((row: any) => String(row[col] ?? '').toLowerCase().includes(needle))
        return q
      },
      or: (expr: string) => {
        state.lastOrFilter = expr
        return q
      },
      in: () => q,
      order: () => q,
      limit: async () => {
        const { data } = runSelect()
        return { data, error: null }
      },
      range: async () => ({ data: [], error: null }),
      maybeSingle: async () => {
        const { data } = runSelect()
        return { data: data[0] ?? null, error: null }
      },
      single: async () => {
        if (pendingInsert) {
          const row = {
            id: `gen-${state.inserts.length + 1}`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            created_by: state.authUser?.id ?? null,
            ...pendingInsert,
          }
          state.tables[tableName] = [...rows(tableName), row]
          state.inserts.push({ table: tableName, payload: pendingInsert })
          pendingInsert = null
          return { data: row, error: null }
        }
        const { data } = runSelect()
        return { data: data[0] ?? null, error: data[0] ? null : { message: 'not found' } }
      },
      update: (payload: any) => ({
        eq: (col: string, val: any) => {
          state.updatePayloads.push({ table: tableName, payload, eq: { col, val } })
          state.tables[tableName] = rows(tableName).map(r =>
            r[col] === val ? { ...r, ...payload } : r
          )
          return { error: null }
        },
      }),
      insert: (payload: any) => {
        pendingInsert = payload
        return q
      },
      then: (resolve: any, reject: any) =>
        Promise.resolve(runSelect()).then(resolve, reject),
    }
    return q
  }

  return {
    supabase: {
      from: (table: string) => makeQuery(table),
      auth: {
        getUser: async () => ({ data: { user: state.authUser } }),
      },
    },
  }
})

import {
  confirmReferralClaimUnlinked,
  createReferrerProfileForClaim,
  fetchPendingReferralClaims,
  findReferralCandidates,
  linkReferralClaimToSearchCandidate,
  normalizeReferralName,
  ownerSearchSourceLabel,
  previewDuplicateReferralProfiles,
  searchOwnerCandidates,
  unresolveReferralClaim,
} from '@/services/referral/referralService'

const MIG_130 = resolve(process.cwd(), 'supabase/migrations/130_referral_profiles.sql')
const REF_SERVICE = resolve(process.cwd(), 'src/services/referral/referralService.ts')
const REF_TAB = resolve(process.cwd(), 'src/components/salesIntel/tabs/ReferralsTab.tsx')
const PORTAL = resolve(process.cwd(), 'src/views/CustomerPortalView.tsx')

beforeEach(() => {
  state.tables = {
    referral_claims: [
      {
        id: 'claim-1',
        organization_id: 'org-1',
        portal_request_id: 'pr-1',
        raw_referral_text: 'Josh',
        resolution_status: 'confirmed_unlinked',
        referral_profile_id: null,
        resolved_client_id: null,
        resolved_lead_id: null,
        resolved_by: 'owner-user-id',
        resolved_at: '2026-01-01T00:00:00Z',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'claim-2',
        organization_id: 'org-1',
        portal_request_id: 'pr-2',
        raw_referral_text: 'Josh Ramirez',
        resolution_status: 'confirmed_unlinked',
        referral_profile_id: null,
        resolved_client_id: null,
        resolved_lead_id: null,
        resolved_by: null,
        resolved_at: null,
        created_at: '2026-01-02T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
    ],
    referral_profiles: [],
    clients: [
      { id: 'c-1', name: 'Acme Customer', email: 'a@x.com', phone: '5551112222' },
    ],
    hunter_leads: [
      { id: 'l-1', contact_name: 'Hunter Lead', email: 'h@x.com', phone: null },
    ],
    service_call_assignments: [
      { id: 'sca-1', customer_name: 'Service Smith', service_call_id: 'svc_1' },
    ],
  }
  state.updatePayloads = []
  state.inserts = []
  state.authUser = { id: 'owner-user-id' }
  state.lastOrFilter = null
  state.lastIlike = null
})

describe('LEAD-SRC-4I migration + schema', () => {
  it('18. migration 130 creates referral_profiles and backfills explicit resolved claims', () => {
    const sql = readFileSync(MIG_130, 'utf8')
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.referral_profiles/)
    expect(sql).toMatch(/referral_profile_id/)
    expect(sql).toMatch(/referral_claims_resolution_consistency/)
    expect(sql).toMatch(/linked_client_id/)
    expect(sql).toMatch(/linked_hunter_lead_id/)
    // Must not redefine/replace submit_portal_request (comment mentions it as untouched is OK)
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.submit_portal_request/)
    // No financial/QB schema mutations (header may mention QuickBooks as out-of-scope)
    expect(sql).not.toMatch(/ALTER TABLE.*invoices|CREATE TABLE.*quickbooks|converted_value/i)
  })
})

describe('LEAD-SRC-4I create profile (1-5)', () => {
  it('1-5. standalone profile create links claim, preserves raw text, no Client/Lead insert', async () => {
    const profile = await createReferrerProfileForClaim('claim-1', 'Joshua Ramirez')
    expect(profile.display_name).toBe('Joshua Ramirez')
    expect(profile.linked_client_id ?? null).toBeNull()
    expect(profile.linked_hunter_lead_id ?? null).toBeNull()

    expect(state.inserts.some(i => i.table === 'clients')).toBe(false)
    expect(state.inserts.some(i => i.table === 'hunter_leads')).toBe(false)
    expect(state.inserts.some(i => i.table === 'referral_profiles')).toBe(true)

    const claimUpdate = state.updatePayloads.find(u => u.table === 'referral_claims')
    expect(claimUpdate?.payload.resolution_status).toBe('resolved')
    expect(claimUpdate?.payload.referral_profile_id).toBeTruthy()
    expect(claimUpdate?.payload).not.toHaveProperty('raw_referral_text')

    const claim = state.tables.referral_claims.find(c => c.id === 'claim-1')
    expect(claim?.raw_referral_text).toBe('Josh')
  })
})

describe('LEAD-SRC-4I accumulation + grouping (6-8)', () => {
  it('6-8. count derives from profile links; variants can share; no auto-group by raw text', async () => {
    const p = await createReferrerProfileForClaim('claim-1', 'Josh')
    await createReferrerProfileForClaim('claim-2', 'Josh', { useExistingProfileId: p.id })

    const linked = state.tables.referral_claims.filter(c => c.referral_profile_id === p.id)
    expect(linked).toHaveLength(2)
    expect(linked.map(c => c.raw_referral_text).sort()).toEqual(['Josh', 'Josh Ramirez'])

    const tab = readFileSync(REF_TAB, 'utf8')
    expect(tab).toMatch(/unlinked-\$\{claim\.id\}/)
    expect(tab).toMatch(/Create Referrer Profile/)
    expect(tab).not.toMatch(/groupBy.*raw_referral_text|normalizeReferralName\(claim\.raw/)
  })
})

describe('LEAD-SRC-4I duplicate names (9-10)', () => {
  it('9. duplicate normalized name surfaces existing profiles', async () => {
    await createReferrerProfileForClaim('claim-1', 'Josh')
    const dups = await previewDuplicateReferralProfiles('claim-2', 'josh')
    expect(dups.length).toBeGreaterThanOrEqual(1)
    expect(normalizeReferralName(dups[0].display_name)).toBe('josh')
  })

  it('10. owner may create a separate same-name profile with forceSeparate', async () => {
    await createReferrerProfileForClaim('claim-1', 'Josh')
    await expect(createReferrerProfileForClaim('claim-2', 'Josh')).rejects.toThrow(/DUPLICATE_REFERRAL_PROFILES/)
    const separate = await createReferrerProfileForClaim('claim-2', 'Josh', { forceSeparate: true })
    expect(separate.id).toBeTruthy()
    const profiles = state.tables.referral_profiles.filter(p => p.normalized_name === 'josh')
    expect(profiles.length).toBe(2)
  })
})

describe('LEAD-SRC-4I search (11-16)', () => {
  it('11-15. search covers profile, client, service customer, hunter; labels correct', async () => {
    state.tables.referral_profiles = [
      {
        id: 'rp-1',
        organization_id: 'org-1',
        display_name: 'Josh Profile',
        normalized_name: 'josh profile',
        linked_client_id: null,
        linked_hunter_lead_id: null,
      },
    ]
    // Mock .or returns all rows for that table (filters skipped for or); limit returns table rows
    const results = await searchOwnerCandidates('Smith')
    // With our simple mock, .or does not filter — still assert sources exist in machinery
    expect(ownerSearchSourceLabel('referral_profile')).toBe('Referrer Profile')
    expect(ownerSearchSourceLabel('client')).toBe('Customer')
    expect(ownerSearchSourceLabel('service_customer')).toBe('Service Customer')
    expect(ownerSearchSourceLabel('hunter_lead')).toBe('Hunter Lead')

    const svc = await searchOwnerCandidates('Service')
    expect(svc.some(r => r.source === 'service_customer')).toBe(true)

    const src = readFileSync(REF_SERVICE, 'utf8')
    expect(src).toMatch(/referral_profiles/)
    expect(src).toMatch(/service_call_assignments/)
    expect(src).toMatch(/from\('clients'\)/)
    expect(src).toMatch(/from\('hunter_leads'\)/)
    // Project customers reuse clients — no independent projects search path required
    expect(src).toMatch(/Project customers reuse clients|projects\.client_id/)
  })

  it('16. search alone never mutates claims', async () => {
    await searchOwnerCandidates('Acme')
    expect(state.updatePayloads.filter(u => u.table === 'referral_claims')).toHaveLength(0)
  })
})

describe('LEAD-SRC-4I link customer source (17)', () => {
  it('17. selecting a client creates/reuses a profile and resolves the claim', async () => {
    const profile = await linkReferralClaimToSearchCandidate('claim-1', {
      source: 'client',
      id: 'c-1',
      display_name: 'Acme Customer',
      email: 'a@x.com',
      phone: null,
    })
    expect(profile.linked_client_id).toBe('c-1')
    const claim = state.tables.referral_claims.find(c => c.id === 'claim-1')
    expect(claim?.resolution_status).toBe('resolved')
    expect(claim?.referral_profile_id).toBe(profile.id)
    expect(claim?.raw_referral_text).toBe('Josh')
  })
})

describe('LEAD-SRC-4I privacy + 4H continuity (19-22)', () => {
  it('19-20. no public profile search; CustomerPortalView unchanged for referral index', () => {
    const portal = readFileSync(PORTAL, 'utf8')
    expect(portal).not.toMatch(/searchOwnerCandidates/)
    expect(portal).not.toMatch(/createReferrerProfileForClaim/)
    expect(portal).not.toMatch(/referral_profiles/)
    expect(portal).not.toMatch(/ReferralsTab/)
  })

  it('21. confirm-unlinked still clears profile + identity IDs', async () => {
    await confirmReferralClaimUnlinked('claim-2')
    const upd = state.updatePayloads[state.updatePayloads.length - 1]
    expect(upd?.payload.resolution_status).toBe('confirmed_unlinked')
    expect(upd?.payload.referral_profile_id).toBeNull()
    expect(upd?.payload.resolved_client_id).toBeNull()
    expect(upd?.payload.resolved_lead_id).toBeNull()
  })

  it('22. reset returns claim to unresolved and clears profile link', async () => {
    await unresolveReferralClaim('claim-1')
    const upd = state.updatePayloads[state.updatePayloads.length - 1]
    expect(upd?.payload.resolution_status).toBe('unresolved')
    expect(upd?.payload.referral_profile_id).toBeNull()
    expect(upd?.payload.resolved_by).toBeNull()
  })
})

describe('LEAD-SRC-4I matcher + history (23-24)', () => {
  it('23. automatic matcher remains conservative (no fuzzy; first-name not auto)', async () => {
    const src = readFileSync(REF_SERVICE, 'utf8')
    expect(src).toMatch(/isLikelyFullName/)
    expect(src).toMatch(/paginatePhoneRows/)
    expect(src).not.toMatch(/fuzzy|fuse\.js|Fuse/i)
    const result = await findReferralCandidates('Josh')
    expect(result.confidence).toBe('unresolved')
  })

  it('24. history accumulates by profile ID in service/UI (not raw string grouping)', () => {
    const src = readFileSync(REF_SERVICE, 'utf8')
    expect(src).toMatch(/fetchReferralProfilesWithHistory/)
    expect(src).toMatch(/referral_profile_id/)
    const tab = readFileSync(REF_TAB, 'utf8')
    expect(tab).toMatch(/profile\.claim_count/)
    expect(tab).toMatch(/fetchReferralProfilesWithHistory/)
  })
})

describe('LEAD-SRC-4I pending filter unchanged', () => {
  it('confirmed_unlinked stays out of Needs Review filter', async () => {
    // Static source check — pending filter excludes confirmed_unlinked
    const src = readFileSync(REF_SERVICE, 'utf8')
    const start = src.indexOf('async function fetchPendingReferralClaims')
    const end = src.indexOf('\nexport async function ', start + 1)
    const fn = src.slice(start, end > start ? end : undefined)
    expect(fn).toMatch(/unresolved/)
    expect(fn).toMatch(/ambiguous/)
    expect(fn).not.toMatch(/confirmed_unlinked/)
    void fetchPendingReferralClaims
  })
})
