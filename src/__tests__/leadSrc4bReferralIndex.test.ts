/**
 * LEAD-SRC-4B — Private referral index contracts.
 *
 *   SECURITY (1-13)       Static audit of migration 128.
 *   SUBMISSION (14-24)    CustomerPortalView form state + RPC parameter contracts.
 *   MATCHING (25-33)      Pure unit tests for text extraction + isLikelyFullName.
 *   RESOLUTION (34-41)    Mock Supabase service operation contracts.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ── Mock state (must be declared before vi.mock) ──────────────────────────────

const state = {
  claimRow: null as Record<string, any> | null,
  updatePayload: null as Record<string, any> | null,
  updateError: null as { message: string } | null,
  fromCalls: [] as string[],
  // Phone paging: table → ordered array of pages (each page is an array of rows)
  phonePages: {} as Record<string, Record<string, any>[][]>,
  _pageIdx: {} as Record<string, number>,
}

// vi.mock is hoisted, so the factory runs before any import
vi.mock('@/lib/supabase', () => {
  const makeQuery = (tableName: string) => {
    const q: any = {
      select: () => q,
      eq: () => q,
      not: () => q,
      ilike: () => q,
      order: () => q,
      in: () => q,
      limit: async () => ({ data: [], error: null }),
      range: async (_from: number, _to: number) => {
        const pages = state.phonePages[tableName]
        if (!pages) return { data: [], error: null }
        const idx = state._pageIdx[tableName] ?? 0
        state._pageIdx[tableName] = idx + 1
        return { data: pages[idx] ?? [], error: null }
      },
      maybeSingle: async () => ({ data: state.claimRow, error: null }),
      update: (payload: any) => {
        state.updatePayload = payload
        return { eq: () => ({ error: state.updateError }) }
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
    },
  }
})

// Import service under test (after vi.mock so the hoisted mock is in place)
import {
  extractEmailFromText,
  extractPhoneFromText,
  isLikelyFullName,
  findReferralCandidates,
  fetchReferralClaimForRequest,
  fetchReferralClaimsForClient,
  fetchReferralClaimsForLead,
  resolveReferralClaim,
  unresolveReferralClaim,
  markReferralClaimAmbiguous,
} from '@/services/referral/referralService'

// ── File reader helpers ────────────────────────────────────────────────────────

const MIG          = resolve(process.cwd(), 'supabase/migrations/128_referral_claims.sql')
const PORTAL_VIEW  = resolve(process.cwd(), 'src/views/CustomerPortalView.tsx')
const PORTAL_INBOX = resolve(process.cwd(), 'src/components/hunter/PortalInbox.tsx')

function readMig():        string { return readFileSync(MIG,          'utf8') }
function readPortalView(): string { return readFileSync(PORTAL_VIEW,  'utf8') }
function readPortalInbox(): string { return readFileSync(PORTAL_INBOX, 'utf8') }

// ── SECURITY (1-13) ──────────────────────────────────────────────────────────
describe('LEAD-SRC-4B Security (1-13)', () => {
  it('1. migration 128 file exists', () => {
    expect(() => readMig()).not.toThrow()
  })

  it('2. referral_claims table created', () => {
    expect(readMig()).toMatch(/CREATE TABLE IF NOT EXISTS public\.referral_claims/)
  })

  it('3. RLS enabled on referral_claims', () => {
    expect(readMig()).toMatch(/ALTER TABLE public\.referral_claims ENABLE ROW LEVEL SECURITY/)
  })

  it('4. anon explicitly revoked on referral_claims', () => {
    expect(readMig()).toMatch(/REVOKE ALL ON TABLE public\.referral_claims FROM anon/)
  })

  it('5. authenticated explicitly revoked on referral_claims', () => {
    expect(readMig()).toMatch(/REVOKE ALL ON TABLE public\.referral_claims FROM authenticated/)
  })

  it('6. owner/admin SELECT policy exists', () => {
    expect(readMig()).toMatch(/referral_claims_owner_admin_select/)
  })

  it('7. owner/admin UPDATE policy exists', () => {
    expect(readMig()).toMatch(/referral_claims_owner_admin_update/)
  })

  it('8. no INSERT policy on referral_claims', () => {
    const sql = readMig()
    const policyBlocks = sql.match(/CREATE POLICY[^;]+;/gs) ?? []
    const insertPolicies = policyBlocks.filter(p =>
      p.includes('referral_claims') && /FOR INSERT/i.test(p)
    )
    expect(insertPolicies).toHaveLength(0)
  })

  it('9. old 23-param submit_portal_request is DROPped', () => {
    expect(readMig()).toMatch(/DROP FUNCTION IF EXISTS public\.submit_portal_request/)
  })

  it('10. exactly-one-overload postcondition present', () => {
    expect(readMig()).toMatch(/v_overload_count != 1/)
  })

  it('11. 24-param postcondition present', () => {
    expect(readMig()).toMatch(/v_param_count != 24/)
  })

  it('12. UNIQUE(portal_request_id) constraint present', () => {
    expect(readMig()).toMatch(/referral_claims_portal_request_unique/)
  })

  it('13. attach_token non-regression postcondition present', () => {
    expect(readMig()).toMatch(/attach_token_hash/)
    expect(readMig()).toMatch(/regression/i)
  })
})

// ── SUBMISSION (14-24) ────────────────────────────────────────────────────────
describe('LEAD-SRC-4B Submission (14-24)', () => {
  it('14. referred_by field present in FormState type', () => {
    expect(readPortalView()).toMatch(/referred_by:\s*string/)
  })

  it('15. referred_by initialized to empty string in BLANK', () => {
    expect(readPortalView()).toMatch(/referred_by:\s*''/)
  })

  it('16. p_referred_by_text passed to submit_portal_request RPC', () => {
    expect(readPortalView()).toMatch(/p_referred_by_text/)
  })

  it('17. p_referred_by_text is trimmed before passing', () => {
    expect(readPortalView()).toMatch(/form\.referred_by\.trim\(\)/)
  })

  it('18. empty referred_by sends null to RPC', () => {
    expect(readPortalView()).toMatch(/form\.referred_by\.trim\(\)\s*\|\|\s*null/)
  })

  it('19. referral input field renders in the form', () => {
    expect(readPortalView()).toMatch(/Were you referred by someone/)
  })

  it('20. referral label indicates field is optional', () => {
    expect(readPortalView()).toMatch(/Optional/)
  })

  it('21. referral field has maxLength 500', () => {
    expect(readPortalView()).toMatch(/maxLength=\{500\}/)
  })

  it('22. referral input uses pr-input class with text type', () => {
    const src = readPortalView()
    // The input block has both markers on adjacent lines
    expect(src).toMatch(/className="pr-input"[\s\S]{0,100}type="text"[\s\S]{0,200}form\.referred_by/)
  })

  it('23. PortalInbox imports from referralService', () => {
    expect(readPortalInbox()).toMatch(/@\/services\/referral\/referralService/)
  })

  it('24. PortalInbox renders Referred By section', () => {
    expect(readPortalInbox()).toMatch(/Referred By/)
  })
})

// ── MATCHING (25-33) ──────────────────────────────────────────────────────────
describe('LEAD-SRC-4B Matching (25-33)', () => {
  it('25. extractEmailFromText extracts standard email', () => {
    expect(extractEmailFromText('Contact john@example.com for details')).toBe('john@example.com')
  })

  it('26. extractEmailFromText returns null when no email present', () => {
    expect(extractEmailFromText('John Smith')).toBeNull()
  })

  it('27. extractEmailFromText normalizes to lowercase', () => {
    expect(extractEmailFromText('JOHN@EXAMPLE.COM')).toBe('john@example.com')
  })

  it('28. extractPhoneFromText extracts 10-digit formatted phone', () => {
    expect(extractPhoneFromText('Call me at (619) 555-1234 anytime')).toBe('6195551234')
  })

  it('29. extractPhoneFromText extracts dot-separated phone', () => {
    expect(extractPhoneFromText('my number is 760.555.9876')).toBe('7605559876')
  })

  it('30. extractPhoneFromText returns null when no phone pattern present', () => {
    expect(extractPhoneFromText('Jane Doe')).toBeNull()
  })

  it('31. isLikelyFullName returns true for two-word name', () => {
    expect(isLikelyFullName('John Smith')).toBe(true)
  })

  it('32. isLikelyFullName returns false for single token', () => {
    expect(isLikelyFullName('John')).toBe(false)
  })

  it('33. isLikelyFullName returns false when @ present', () => {
    expect(isLikelyFullName('john@example.com')).toBe(false)
  })
})

// ── RESOLUTION (34-41) ────────────────────────────────────────────────────────
describe('LEAD-SRC-4B Resolution (34-41)', () => {
  beforeEach(() => {
    state.claimRow     = null
    state.updatePayload = null
    state.updateError  = null
    state.fromCalls    = []
  })

  it('34. fetchReferralClaimForRequest queries referral_claims and returns claim', async () => {
    state.claimRow = {
      id: 'claim-1', portal_request_id: 'req-1',
      raw_referral_text: 'Jane', resolution_status: 'unresolved',
      resolved_client_id: null, resolved_lead_id: null,
      resolved_by: null, resolved_at: null,
      organization_id: 'org-1', created_at: '2026-01-01', updated_at: '2026-01-01',
    }
    const result = await fetchReferralClaimForRequest('req-1')
    expect(state.fromCalls).toContain('referral_claims')
    expect(result?.id).toBe('claim-1')
  })

  it('35. fetchReferralClaimForRequest returns null when no claim exists', async () => {
    state.claimRow = null
    const result = await fetchReferralClaimForRequest('req-no-claim')
    expect(result).toBeNull()
  })

  it('36. fetchReferralClaimsForClient queries referral_claims', async () => {
    await fetchReferralClaimsForClient('client-1')
    expect(state.fromCalls).toContain('referral_claims')
  })

  it('37. fetchReferralClaimsForLead queries referral_claims', async () => {
    await fetchReferralClaimsForLead('lead-1')
    expect(state.fromCalls).toContain('referral_claims')
  })

  it('38. resolveReferralClaim sets resolved status and client_id', async () => {
    await resolveReferralClaim('claim-1', { client_id: 'client-abc' })
    expect(state.updatePayload?.resolution_status).toBe('resolved')
    expect(state.updatePayload?.resolved_client_id).toBe('client-abc')
    expect(state.updatePayload?.resolved_lead_id).toBeNull()
  })

  it('39. resolveReferralClaim sets resolved status and lead_id', async () => {
    await resolveReferralClaim('claim-1', { lead_id: 'lead-xyz' })
    expect(state.updatePayload?.resolution_status).toBe('resolved')
    expect(state.updatePayload?.resolved_lead_id).toBe('lead-xyz')
    expect(state.updatePayload?.resolved_client_id).toBeNull()
  })

  it('40. unresolveReferralClaim sets status to unresolved and nulls all resolution fields', async () => {
    await unresolveReferralClaim('claim-1')
    expect(state.updatePayload?.resolution_status).toBe('unresolved')
    expect(state.updatePayload?.resolved_client_id).toBeNull()
    expect(state.updatePayload?.resolved_lead_id).toBeNull()
    expect(state.updatePayload?.resolved_by).toBeNull()
    expect(state.updatePayload?.resolved_at).toBeNull()
  })

  it('41. markReferralClaimAmbiguous sets status to ambiguous and nulls resolution fields', async () => {
    await markReferralClaimAmbiguous('claim-1')
    expect(state.updatePayload?.resolution_status).toBe('ambiguous')
    expect(state.updatePayload?.resolved_client_id).toBeNull()
    expect(state.updatePayload?.resolved_lead_id).toBeNull()
  })
})

// ── FK CORRECTION (42) ────────────────────────────────────────────────────────
describe('LEAD-SRC-4D FK Correction (42)', () => {
  it('42. resolved_client_id and resolved_lead_id use ON DELETE RESTRICT not SET NULL', () => {
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/128_referral_claims.sql'), 'utf8')
    expect(sql).not.toMatch(/resolved_client_id[^\n;]{0,150}ON DELETE SET NULL/)
    expect(sql).not.toMatch(/resolved_lead_id[^\n;]{0,150}ON DELETE SET NULL/)
    expect(sql).toMatch(/resolved_client_id[^\n;]{0,150}ON DELETE RESTRICT/)
    expect(sql).toMatch(/resolved_lead_id[^\n;]{0,150}ON DELETE RESTRICT/)
    // Postcondition verifies FK delete behavior at migration apply time
    expect(sql).toMatch(/resolved_client_id_fkey/)
    expect(sql).toMatch(/resolved_lead_id_fkey/)
    expect(sql).toMatch(/confdeltype.*r|RESTRICT.*r/s)
  })
})

// ── MATCHING-PAGED (43-47) ────────────────────────────────────────────────────
describe('LEAD-SRC-4D Matching-Paged (43-47)', () => {
  beforeEach(() => {
    state.fromCalls = []
    state._pageIdx  = {}
    state.phonePages = {}
  })

  it('43. phone match located after row 500 is found (not truncated)', async () => {
    const page0 = Array.from({ length: 500 }, (_, i) => ({
      id: `c-${i}`, name: `Client ${i}`, email: null,
      phone: `555000${i.toString().padStart(4, '0')}`,
    }))
    const matchRow = { id: 'c-target', name: 'Jane Doe', email: null, phone: '6195551234' }
    state.phonePages = {
      clients:      [page0, [matchRow], []],
      hunter_leads: [[]],
    }
    const result = await findReferralCandidates('6195551234')
    expect(result.confidence).toBe('suggestion')
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].id).toBe('c-target')
  })

  it('44. duplicate matching phones across pages → ambiguous', async () => {
    // Page 0 must be exactly PAGE_SIZE (500) so the loop continues to page 1
    const r1 = { id: 'c-1', name: 'Alice A', email: null, phone: '6195551234' }
    const nonMatching = Array.from({ length: 499 }, (_, i) => ({
      id: `c-nm-${i}`, name: `Client ${i}`, email: null,
      phone: `800000${i.toString().padStart(4, '0')}`,
    }))
    const page0 = [...nonMatching, r1]  // 500 rows → continues to page 1
    const r2 = { id: 'c-2', name: 'Alice B', email: null, phone: '6195551234' }
    state.phonePages = {
      clients:      [page0, [r2], []],
      hunter_leads: [[]],
    }
    const result = await findReferralCandidates('6195551234')
    expect(result.confidence).toBe('ambiguous')
    expect(result.candidates.length).toBeGreaterThanOrEqual(2)
  })

  it('45. no phone match after >500 rows → truly unresolved', async () => {
    const page0 = Array.from({ length: 500 }, (_, i) => ({
      id: `c-${i}`, name: `C ${i}`, email: null,
      phone: `800000${i.toString().padStart(4, '0')}`,
    }))
    const page1 = [{ id: 'c-501', name: 'C 501', email: null, phone: '9009990001' }]
    state.phonePages = {
      clients:      [page0, page1, []],
      hunter_leads: [[]],
    }
    const result = await findReferralCandidates('6195551234')
    expect(result.confidence).toBe('unresolved')
    expect(result.candidates).toHaveLength(0)
  })

  it('46. phone paging uses stable id ordering (source check)', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/services/referral/referralService.ts'),
      'utf8',
    )
    expect(src).toMatch(/\.order\s*\(\s*['"]id['"]/)
  })

  it('47. raw text with no valid 10-digit phone produces no phone candidates', async () => {
    // '555-12' has no 10-digit phone pattern — phone branch never fires
    state.phonePages = { clients: [[]], hunter_leads: [[]] }
    const result = await findReferralCandidates('555-12')
    expect(result.confidence).toBe('unresolved')
    expect(result.candidates).toHaveLength(0)
  })
})

// ── REFERRAL INDEX (48-64) ────────────────────────────────────────────────────
describe('LEAD-SRC-4D Referral Index (48-64)', () => {
  const SI_STORE  = resolve(process.cwd(), 'src/components/salesIntel/SalesIntelStore.ts')
  const SI_PANEL  = resolve(process.cwd(), 'src/components/salesIntel/SalesIntelligencePanel.tsx')
  const SI_TABBAR = resolve(process.cwd(), 'src/components/salesIntel/SalesIntelTabBar.tsx')
  const REF_TAB   = resolve(process.cwd(), 'src/components/salesIntel/tabs/ReferralsTab.tsx')

  const readStore  = () => readFileSync(SI_STORE,  'utf8')
  const readPanel  = () => readFileSync(SI_PANEL,  'utf8')
  const readTabBar = () => readFileSync(SI_TABBAR, 'utf8')
  const readRefTab = () => readFileSync(REF_TAB,   'utf8')

  // 6. Sub-tab registration
  it('48. SalesIntelStore includes referrals tab type', () => {
    expect(readStore()).toMatch(/['"]referrals['"]/)
  })

  it('49. SalesIntelTabBar renders REFERRALS tab', () => {
    const src = readTabBar()
    expect(src).toMatch(/id:\s*['"]referrals['"]/)
    expect(src).toMatch(/REFERRALS/)
  })

  it('50. SalesIntelligencePanel includes referrals switch case', () => {
    expect(readPanel()).toMatch(/case\s+['"]referrals['"]/)
  })

  it('51. ReferralsTab.tsx exists and imports referralService', () => {
    expect(() => readRefTab()).not.toThrow()
    expect(readRefTab()).toMatch(/referralService/)
  })

  // 7-8. Needs Review section
  it('52. ReferralsTab renders Needs Review section', () => {
    expect(readRefTab()).toMatch(/Needs\s+Review/)
  })

  it('53. ReferralsTab surfaces unresolved claims in Needs Review', () => {
    expect(readRefTab()).toMatch(/unresolved/)
  })

  it('54. ReferralsTab surfaces ambiguous claims in Needs Review', () => {
    expect(readRefTab()).toMatch(/ambiguous/)
  })

  // 9-10. Confirmed referrers
  it('55. ReferralsTab groups confirmed referrers by resolved_client_id or resolved_lead_id', () => {
    const src = readRefTab()
    expect(src).toMatch(/resolved_client_id/)
    expect(src).toMatch(/resolved_lead_id/)
    expect(src).toMatch(/Confirmed Referrers|buildReferrerGroups/)
  })

  it('56. confirmed client referrer shows Client identity type', () => {
    expect(readRefTab()).toMatch(/Client/)
  })

  it('57. confirmed Hunter Lead referrer shows Hunter Lead identity type', () => {
    expect(readRefTab()).toMatch(/Hunter Lead/)
  })

  // 11. Count from actual claims
  it('58. referral count derives from actual claim rows, no analytics table', () => {
    const src = readRefTab()
    expect(src).toMatch(/claims\.length|\.length/)
    expect(src).not.toMatch(/revenue.*referrer|referral.*ROI|leaderboard|BarChart|LineChart|AreaChart/i)
  })

  // 12-13. History preserves raw text
  it('59. referrer history shows raw_referral_text', () => {
    expect(readRefTab()).toMatch(/raw_referral_text/)
  })

  it('60. raw_referral_text is rendered in JSX output, not suppressed', () => {
    const src = readRefTab()
    const rendered = src.match(/\{[^}]*raw_referral_text[^}]*\}/)
    expect(rendered).not.toBeNull()
  })

  // 14. Date shown
  it('61. claim created_at date is displayed', () => {
    expect(readRefTab()).toMatch(/created_at/)
  })

  // 15. Actions reuse service
  it('62. resolution actions reuse referralService operations', () => {
    const src = readRefTab()
    expect(src).toMatch(/resolveReferralClaim/)
    expect(src).toMatch(/unresolveReferralClaim/)
    expect(src).toMatch(/markReferralClaimAmbiguous/)
  })

  // 16. No analytics
  it('63. no analytics charts introduced in ReferralsTab', () => {
    const src = readRefTab()
    expect(src).not.toMatch(/BarChart|LineChart|AreaChart|revenue.*referrer|referral.*ROI|leaderboard/i)
  })

  // 17. Public portal clean
  it('64. CustomerPortalView never renders referral index or candidate lookup', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/views/CustomerPortalView.tsx'), 'utf8')
    expect(src).not.toMatch(/ReferralIndex|ReferralsTab|fetchReferralClaims|findReferralCandidates/i)
  })
})
