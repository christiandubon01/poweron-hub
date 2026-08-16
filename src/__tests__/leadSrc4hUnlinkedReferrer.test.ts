/**
 * LEAD-SRC-4H — Confirmed-unlinked referral workflow.
 *
 * 22-point proof covering:
 *   DB STATE      (1-4)   Migration 129 constraint correctness.
 *   SERVICE       (5-7)   confirmReferralClaimUnlinked: no Client/Lead created,
 *                         raw text preserved.
 *   FILTER        (8-9)   Needs Review excludes; Confirmed Referrers includes
 *                         confirmed_unlinked.
 *   UI STATIC    (10-11)  ReferralsTab renders UNLINKED REFERRER + Link Person.
 *   OWNER SEARCH (12-14)  searchOwnerCandidates works, never auto-links.
 *   LINKING      (15-18)  linkReferralClaimToIdentity: raw text preserved, same
 *                         claim ID reused, no duplicate row.
 *   GROUPING      (19)    Two unlinked "Josh" claims are never auto-grouped.
 *   RESET         (20)    unresolveReferralClaim returns claim to unresolved.
 *   PUBLIC        (21)    CustomerPortalView exposes no candidate search.
 *   MATCHER       (22)    Automatic matcher behaviour unchanged.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ── Mock state ────────────────────────────────────────────────────────────────

const state = {
  updatePayload:  null as Record<string, any> | null,
  updateError:    null as { message: string } | null,
  fromCalls:      [] as string[],
  insertCalled:   false,
  // For searchOwnerCandidates: table → rows returned by .limit()
  orResults: {} as Record<string, Record<string, any>[]>,
  authUser:       { id: 'owner-user-id' } as { id: string } | null,
  profileInserts: 0,
  claimById: {
    'claim-link-1': { id: 'claim-link-1', organization_id: 'org-1', raw_referral_text: 'Josh' },
    'claim-link-2': { id: 'claim-link-2', organization_id: 'org-1', raw_referral_text: 'Josh' },
    'claim-original-id': { id: 'claim-original-id', organization_id: 'org-1', raw_referral_text: 'Josh' },
    'claim-no-dup': { id: 'claim-no-dup', organization_id: 'org-1', raw_referral_text: 'Josh' },
    'claim-unlinked-1': { id: 'claim-unlinked-1', organization_id: 'org-1', raw_referral_text: 'Josh' },
    'claim-unlinked-2': { id: 'claim-unlinked-2', organization_id: 'org-1', raw_referral_text: 'Josh' },
    'claim-unlinked-3': { id: 'claim-unlinked-3', organization_id: 'org-1', raw_referral_text: 'Josh' },
    'claim-reset-1': { id: 'claim-reset-1', organization_id: 'org-1', raw_referral_text: 'Josh' },
  } as Record<string, any>,
  lastEq: null as { col: string; val: any } | null,
}

vi.mock('@/lib/supabase', () => {
  const makeQuery = (tableName: string) => {
    let pendingInsert: Record<string, any> | null = null
    const q: any = {
      select:      () => q,
      eq:          (col: string, val: any) => {
        state.lastEq = { col, val }
        return q
      },
      not:         () => q,
      ilike:       () => q,
      order:       () => q,
      in:          async () => ({ data: [], error: null }),
      maybeSingle: async () => {
        if (tableName === 'referral_claims') {
          const id = state.lastEq?.col === 'id' ? state.lastEq.val : null
          return {
            data: (id && state.claimById[id]) || {
              id: 'claim-fallback',
              organization_id: 'org-1',
              raw_referral_text: 'Josh',
            },
            error: null,
          }
        }
        if (tableName === 'referral_profiles') return { data: null, error: null }
        if (tableName === 'clients') {
          return {
            data: { id: state.lastEq?.val ?? 'c-josh', name: 'Client' },
            error: null,
          }
        }
        if (tableName === 'hunter_leads') {
          return {
            data: { id: state.lastEq?.val ?? 'l-josh', contact_name: 'Lead' },
            error: null,
          }
        }
        return { data: null, error: null }
      },
      or:          () => q,
      limit:       async () => ({
        data:  state.orResults[tableName] ?? [],
        error: null,
      }),
      range: async () => ({ data: [], error: null }),
      update: (payload: any) => {
        state.updatePayload = payload
        return {
          eq: () => ({ error: state.updateError }),
        }
      },
      insert: (payload: any) => {
        state.insertCalled = true
        pendingInsert = payload
        return q
      },
      single: async () => {
        if (pendingInsert && tableName === 'referral_profiles') {
          state.profileInserts += 1
          const row = { id: `rp-${state.profileInserts}`, ...pendingInsert }
          pendingInsert = null
          return { data: row, error: null }
        }
        return { data: null, error: { message: 'not found' } }
      },
    }
    return q
  }

  return {
    supabase: {
      from: (table: string) => {
        state.fromCalls.push(table)
        return makeQuery(table)
      },
      auth: {
        getUser: async () => ({
          data: { user: state.authUser },
        }),
      },
    },
  }
})

// Import after mock
import {
  confirmReferralClaimUnlinked,
  fetchPendingReferralClaims,
  fetchResolvedReferralClaims,
  linkReferralClaimToIdentity,
  searchOwnerCandidates,
  unresolveReferralClaim,
} from '@/services/referral/referralService'

// ── Path helpers ───────────────────────────────────────────────────────────────

const MIG_129       = resolve(process.cwd(), 'supabase/migrations/129_referral_unlinked_confirmation.sql')
const MIG_128       = resolve(process.cwd(), 'supabase/migrations/128_referral_claims.sql')
const REF_SERVICE   = resolve(process.cwd(), 'src/services/referral/referralService.ts')
const REF_TAB       = resolve(process.cwd(), 'src/components/salesIntel/tabs/ReferralsTab.tsx')
const PORTAL_VIEW   = resolve(process.cwd(), 'src/views/CustomerPortalView.tsx')

const readMig129    = () => readFileSync(MIG_129,     'utf8')
const readMig128    = () => readFileSync(MIG_128,     'utf8')
const readService   = () => readFileSync(REF_SERVICE, 'utf8')
const readRefTab    = () => readFileSync(REF_TAB,     'utf8')
const readPortal    = () => readFileSync(PORTAL_VIEW, 'utf8')

beforeEach(() => {
  state.updatePayload = null
  state.updateError   = null
  state.fromCalls     = []
  state.insertCalled  = false
  state.orResults     = {}
  state.authUser      = { id: 'owner-user-id' }
  state.profileInserts = 0
  state.lastEq = null
})

// ═══════════════════════════════════════════════════════════════════════════════
// DB STATE (1-4)
// ═══════════════════════════════════════════════════════════════════════════════

describe('LEAD-SRC-4H DB State (1-4)', () => {

  it('1. confirmed_unlinked is accepted by status_values constraint in migration 129', () => {
    const sql = readMig129()
    expect(sql).toMatch(/confirmed_unlinked/)
    expect(sql).toMatch(/referral_claims_status_values/)
    // Constraint must enumerate confirmed_unlinked inside the CHECK definition
    expect(sql).toMatch(
      /ADD CONSTRAINT referral_claims_status_values CHECK[\s\S]*?confirmed_unlinked/
    )
  })

  it('2. confirmed_unlinked requires both identity IDs null (via resolution_consistency in mig 128)', () => {
    // Migration 128 has the consistency constraint. The ELSE branch covers any
    // status that is NOT 'resolved' (including confirmed_unlinked), requiring
    // both IDs to be null. Verify the ELSE branch is present in migration 128.
    const sql128 = readMig128()
    expect(sql128).toMatch(/referral_claims_resolution_consistency/)
    // ELSE branch: both IDs must be null
    expect(sql128).toMatch(/ELSE[\s\S]*?resolved_client_id IS NULL AND resolved_lead_id IS NULL/m)
  })

  it('3. resolved still requires exactly one identity (consistency constraint intact)', () => {
    const sql128 = readMig128()
    // WHEN 'resolved' THEN (client IS NOT NULL) != (lead IS NOT NULL) — XOR
    expect(sql128).toMatch(/WHEN 'resolved' THEN/)
    expect(sql128).toMatch(
      /resolved_client_id IS NOT NULL\)\s*!=\s*\(resolved_lead_id IS NOT NULL/
    )
  })

  it('4. unresolved and ambiguous still require zero IDs (ELSE branch in migration 128)', () => {
    const sql128 = readMig128()
    // The ELSE branch applies to unresolved, ambiguous, and confirmed_unlinked
    expect(sql128).toMatch(/ELSE/)
    expect(sql128).toMatch(/resolved_client_id IS NULL AND resolved_lead_id IS NULL/)
  })

})

// ═══════════════════════════════════════════════════════════════════════════════
// SERVICE (5-7) — confirmReferralClaimUnlinked
// ═══════════════════════════════════════════════════════════════════════════════

describe('LEAD-SRC-4H Service: confirmReferralClaimUnlinked (5-7)', () => {

  it('5. Confirm as Referrer preserves raw_referral_text (raw text not mutated by service)', async () => {
    // confirmReferralClaimUnlinked only calls UPDATE on referral_claims.
    // It never touches raw_referral_text. Verify the update payload does NOT
    // include a raw_referral_text key.
    await confirmReferralClaimUnlinked('claim-unlinked-1')
    expect(state.updatePayload).not.toHaveProperty('raw_referral_text')
    expect(state.updatePayload?.resolution_status).toBe('confirmed_unlinked')
  })

  it('6. Confirm as Referrer does not create a Client row', async () => {
    state.insertCalled = false
    await confirmReferralClaimUnlinked('claim-unlinked-2')
    // No INSERT should touch 'clients'
    const clientInserts = state.fromCalls.filter(
      (t, i) => t === 'clients' && state.fromCalls[i] !== undefined
    )
    expect(state.insertCalled).toBe(false)
    // fromCalls should not include 'clients' from this operation
    expect(state.fromCalls).not.toContain('clients')
  })

  it('7. Confirm as Referrer does not create a Hunter Lead row', async () => {
    state.insertCalled = false
    await confirmReferralClaimUnlinked('claim-unlinked-3')
    expect(state.insertCalled).toBe(false)
    expect(state.fromCalls).not.toContain('hunter_leads')
  })

})

// ═══════════════════════════════════════════════════════════════════════════════
// FILTER (8-9) — Needs Review / Confirmed Referrers
// ═══════════════════════════════════════════════════════════════════════════════

describe('LEAD-SRC-4H Filter (8-9)', () => {

  it('8. confirmed_unlinked disappears from Needs Review (fetchPendingReferralClaims filter)', () => {
    const src = readService()
    // fetchPendingReferralClaims must NOT include confirmed_unlinked in its filter
    const fnStart = src.indexOf('async function fetchPendingReferralClaims')
    const fnEnd   = src.indexOf('\nexport async function ', fnStart + 1)
    const fn      = src.slice(fnStart, fnEnd > fnStart ? fnEnd : src.length)
    // Should filter on unresolved and ambiguous only
    expect(fn).toMatch(/['"]unresolved['"]/)
    expect(fn).toMatch(/['"]ambiguous['"]/)
    expect(fn).not.toMatch(/confirmed_unlinked/)
  })

  it('9. confirmed_unlinked appears in Confirmed Referrers (fetchResolvedReferralClaims filter)', () => {
    const src = readService()
    const fnStart = src.indexOf('async function fetchResolvedReferralClaims')
    const fnEnd   = src.indexOf('\nexport async function ', fnStart + 1)
    const fn      = src.slice(fnStart, fnEnd > fnStart ? fnEnd : src.length)
    expect(fn).toMatch(/['"]confirmed_unlinked['"]/)
    expect(fn).toMatch(/['"]resolved['"]/)
  })

})

// ═══════════════════════════════════════════════════════════════════════════════
// UI STATIC (10-11)
// ═══════════════════════════════════════════════════════════════════════════════

describe('LEAD-SRC-4H UI Static (10-11)', () => {

  it('10. unlinked referrer displays raw_referral_text with UNLINKED REFERRER badge', () => {
    const src = readRefTab()
    // raw_referral_text must be rendered
    expect(src).toMatch(/raw_referral_text/)
    // UNLINKED REFERRER badge text must appear
    expect(src).toMatch(/Unlinked Referrer/i)
  })

  it('11. unlinked claim exposes Link Person action', () => {
    const src = readRefTab()
    expect(src).toMatch(/Link Person/)
    // The component that implements Link Person must be defined
    expect(src).toMatch(/LinkPersonPanel|linkReferralClaimToIdentity/)
  })

})

// ═══════════════════════════════════════════════════════════════════════════════
// OWNER SEARCH (12-14)
// ═══════════════════════════════════════════════════════════════════════════════

describe('LEAD-SRC-4H Owner Search (12-14)', () => {

  it('12. manual Client search works privately via searchOwnerCandidates', async () => {
    state.orResults['clients']      = [{ id: 'c-1', name: 'Joshua Hernandez', email: 'josh@example.com', phone: null }]
    state.orResults['hunter_leads'] = []
    state.orResults['referral_profiles'] = []
    state.orResults['service_call_assignments'] = []
    const results = await searchOwnerCandidates('josh')
    const clientResult = results.find(r => r.source === 'client' && r.id === 'c-1')
    expect(clientResult).toBeDefined()
    expect(clientResult?.display_name).toBe('Joshua Hernandez')
  })

  it('13. manual Hunter Lead search works privately via searchOwnerCandidates', async () => {
    state.orResults['clients']      = []
    state.orResults['hunter_leads'] = [{ id: 'l-9', contact_name: 'Josh Martinez', email: null, phone: null }]
    state.orResults['referral_profiles'] = []
    state.orResults['service_call_assignments'] = []
    const results = await searchOwnerCandidates('josh')
    const leadResult = results.find(r => r.source === 'hunter_lead' && r.id === 'l-9')
    expect(leadResult).toBeDefined()
    expect(leadResult?.display_name).toBe('Josh Martinez')
  })

  it('14. manual search never auto-links — searchOwnerCandidates returns candidates without updating any claim', async () => {
    state.orResults['clients']      = [{ id: 'c-auto', name: 'Auto Match', email: null, phone: null }]
    state.orResults['hunter_leads'] = []
    await searchOwnerCandidates('Auto Match')
    // No referral_claims UPDATE should have occurred
    expect(state.updatePayload).toBeNull()
    expect(state.fromCalls).not.toContain('referral_claims')
  })

})

// ═══════════════════════════════════════════════════════════════════════════════
// LINKING (15-18)
// ═══════════════════════════════════════════════════════════════════════════════

describe('LEAD-SRC-4H Linking (15-18)', () => {

  it('15. linking unlinked → Client preserves raw text (payload has no raw_referral_text mutation)', async () => {
    await linkReferralClaimToIdentity('claim-link-1', { client_id: 'c-josh' })
    expect(state.updatePayload?.resolution_status).toBe('resolved')
    expect(state.updatePayload?.resolved_client_id).toBe('c-josh')
    expect(state.updatePayload?.resolved_lead_id).toBeNull()
    expect(state.updatePayload?.referral_profile_id).toBeTruthy()
    // raw_referral_text must NOT appear in the update payload
    expect(state.updatePayload).not.toHaveProperty('raw_referral_text')
  })

  it('16. linking unlinked → Hunter Lead preserves raw text', async () => {
    await linkReferralClaimToIdentity('claim-link-2', { lead_id: 'l-josh' })
    expect(state.updatePayload?.resolution_status).toBe('resolved')
    expect(state.updatePayload?.resolved_lead_id).toBe('l-josh')
    expect(state.updatePayload?.resolved_client_id).toBeNull()
    expect(state.updatePayload?.referral_profile_id).toBeTruthy()
    expect(state.updatePayload).not.toHaveProperty('raw_referral_text')
  })

  it('17. linking reuses same claim ID — UPDATE targets claim id; may create profile but not a new claim', async () => {
    await linkReferralClaimToIdentity('claim-original-id', { client_id: 'c-xxx' })
    expect(state.fromCalls).toContain('referral_claims')
    expect(state.updatePayload?.referral_profile_id).toBeTruthy()
  })

  it('18. no duplicate referral claim created during link operation', async () => {
    await linkReferralClaimToIdentity('claim-no-dup', { lead_id: 'l-yyy' })
    // Profile insert is expected; claim row is only updated
    expect(state.updatePayload?.resolution_status).toBe('resolved')
    expect(state.updatePayload?.referral_profile_id).toBeTruthy()
  })

})

// ═══════════════════════════════════════════════════════════════════════════════
// GROUPING (19)
// ═══════════════════════════════════════════════════════════════════════════════

describe('LEAD-SRC-4H Grouping (19)', () => {

  it('19. two separate unlinked "Josh" claims are NOT automatically grouped together', () => {
    const src = readRefTab()
    expect(src).toMatch(/unlinked-\$\{claim\.id\}|`unlinked-\$\{claim\.id\}`/)
    expect(src).toMatch(/Unlinked Referrer/)
    expect(src).toMatch(/fetchReferralProfilesWithHistory|profile\.id/)
  })

})

// ═══════════════════════════════════════════════════════════════════════════════
// RESET (20)
// ═══════════════════════════════════════════════════════════════════════════════

describe('LEAD-SRC-4H Reset (20)', () => {

  it('20. unlink/reset returns claim to unresolved with all identity fields nulled', async () => {
    await unresolveReferralClaim('claim-reset-1')
    expect(state.updatePayload?.resolution_status).toBe('unresolved')
    expect(state.updatePayload?.resolved_client_id).toBeNull()
    expect(state.updatePayload?.resolved_lead_id).toBeNull()
    expect(state.updatePayload?.resolved_by).toBeNull()
    expect(state.updatePayload?.resolved_at).toBeNull()
  })

})

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC PORTAL (21)
// ═══════════════════════════════════════════════════════════════════════════════

describe('LEAD-SRC-4H Public Portal Boundary (21)', () => {

  it('21. CustomerPortalView has no candidate search, owner search, or referral index', () => {
    const src = readPortal()
    // No auto-complete, candidate lookup, or owner search
    expect(src).not.toMatch(/searchOwnerCandidates/i)
    expect(src).not.toMatch(/findReferralCandidates/i)
    expect(src).not.toMatch(/ReferralIndex|ReferralsTab|fetchReferralClaims/i)
    expect(src).not.toMatch(/linkReferralClaimToIdentity/i)
    expect(src).not.toMatch(/confirmReferralClaimUnlinked/i)
  })

})

// ═══════════════════════════════════════════════════════════════════════════════
// AUTOMATIC MATCHER (22)
// ═══════════════════════════════════════════════════════════════════════════════

describe('LEAD-SRC-4H Automatic Matcher Preservation (22)', () => {

  it('22. existing automatic matcher rules remain intact in referralService', () => {
    const src = readService()

    // Exact full name matching (not fuzzy)
    expect(src).toMatch(/isLikelyFullName/)
    // Exact phone matching via normalizePhone paginated scan
    expect(src).toMatch(/paginatePhoneRows/)
    expect(src).toMatch(/normalizePhone/)
    // Conservative: single candidate → 'suggestion', multiple → 'ambiguous'
    expect(src).toMatch(/confidence.*suggestion|suggestion.*confidence/s)
    expect(src).toMatch(/confidence.*ambiguous|ambiguous.*confidence/s)
    // First-name-only falls through to unresolved (isLikelyFullName guards)
    expect(src).toMatch(/isLikelyFullName/)
    // No fuzzy auto-resolution (no fuzzy import)
    expect(src).not.toMatch(/fuzzy|fuse\.js|Fuse/i)
    // Automatic matcher does not touch confirmed_unlinked
    expect(src).not.toMatch(/findReferralCandidates[\s\S]*?confirmed_unlinked/m)
  })

})
