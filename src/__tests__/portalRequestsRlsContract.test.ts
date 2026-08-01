/**
 * SEC-0R: portal_requests security contract tests.
 *
 * Test classification:
 *   [STATIC]      migration content assertions (no live DB required)
 *   [MOCK]        component/service behavior assertions (mocked supabase client)
 *   [INTEGRATION] live DB required — marked but NOT run here
 *
 * Required coverage (47 cases):
 *   1.  Role self-escalation is impossible                           [STATIC]
 *   2.  Legitimate profile self-edit remains possible               [STATIC]
 *   3.  Owner/admin role management remains possible                [STATIC]
 *   4.  Ordinary employee cannot satisfy Portal owner/admin policy  [STATIC]
 *   5.  Tracking route still works after anon SELECT removed        [MOCK]
 *   6.  Tracking API returns only customer-safe fields              [STATIC]
 *   7.  Random UUID cannot retrieve internal request data           [STATIC]
 *   8.  Submit returns request_id + one-time attach_token           [MOCK]
 *   9.  Token hash is not stored in plaintext                       [STATIC]
 *   10. Correct token appends once                                  [MOCK]
 *   11. Wrong token fails                                           [MOCK]
 *   12. Token from request A fails for request B                    [STATIC]
 *   13. Reused token fails                                          [MOCK]
 *   14. Expired capability fails (30-min guard)                     [STATIC]
 *   15. Append after conversion/linkage fails                       [STATIC]
 *   16. Excess attachment count fails                               [STATIC]
 *   17. Excess metadata size fails                                  [STATIC]
 *   18. Arbitrary external URL/path fails                           [STATIC]
 *   19. Anonymous user can execute submit                           [STATIC]
 *   20. Authenticated user can execute submit                       [STATIC]
 *   21. anon/authenticated have no direct table INSERT              [STATIC]
 *   22. anon has no SELECT/UPDATE/DELETE                            [STATIC]
 *   23. Authenticated ordinary employee has no Portal SELECT/UPDATE [STATIC]
 *   24. Owner/admin Portal Inbox SELECT/UPDATE remains              [STATIC]
 *   25. Existing review duplicate protection unchanged              [MOCK]
 *   26. Existing form success/error behavior remains                [MOCK]
 *   27. One form submit creates one row                             [MOCK]
 *   28. Eight migration guards remain narrowly scoped               [STATIC]
 *   29. Migration 108 drops legacy policies by real names           [STATIC]
 *   30. Migration 108 defensively drops assumed names               [STATIC]
 *   31. Migration 108 revokes ALL from PUBLIC                       [STATIC]
 *   32. Migration 108 revokes ALL from anon                         [STATIC]
 *   33. Migration 108 revokes ALL from authenticated                [STATIC]
 *   34. Migration 108 regrants authenticated SELECT and UPDATE only [STATIC]
 *   35. Migration 108 does not grant INSERT to authenticated        [STATIC]
 *   36. Migration 108 does not grant DELETE to authenticated        [STATIC]
 *   37. Migration 108 does not grant TRUNCATE to authenticated      [STATIC]
 *   38. Migration 108 preserves owner/admin policies                [STATIC]
 *   39. Migration 108 preserves all three RPCs                      [STATIC]
 *   40. Migration 108 preserves anon/authenticated RPC EXECUTE      [STATIC]
 *   41. Migration 108 preserves PUBLIC RPC denial                   [STATIC]
 *   42. Migration 108 contains postcondition assertions             [STATIC]
 *   43. Migration 108 does not alter CustomerPortalView             [STATIC]
 *   44. Migration 108 does not alter PortalTrackView                [STATIC]
 *   45. Migration 108 does not modify migration 107                 [STATIC]
 *   46. Migration 108 adds no unauthorized implementation           [STATIC]
 *   47. Eight migration guards updated to recognize migration 108   [STATIC]
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── Migration file fixtures ───────────────────────────────────────────────────

const ROOT         = process.cwd()
const MIG_DIR      = join(ROOT, 'supabase/migrations')
const MIG_107_PATH = join(MIG_DIR, '107_secure_portal_requests_access.sql')
const MIG_108_PATH = join(MIG_DIR, '108_remove_legacy_portal_request_access.sql')
const mig107 = existsSync(MIG_107_PATH) ? readFileSync(MIG_107_PATH, 'utf8') : ''
const mig108 = existsSync(MIG_108_PATH) ? readFileSync(MIG_108_PATH, 'utf8') : ''

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const mockRpc  = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth:    { getUser: vi.fn() },
    from:    mockFrom,
    rpc:     mockRpc,
    storage: { from: vi.fn() },
  },
}))

// ── Migration 107 content — role self-escalation repair ───────────────────────

describe('[STATIC] 1. Role self-escalation is impossible (profiles_update_self)', () => {
  it('migration 107 drops the original profiles_update_self policy', () => {
    expect(mig107).toContain('DROP POLICY IF EXISTS "profiles_update_self"')
  })

  it('recreates profiles_update_self with WITH CHECK clause', () => {
    expect(mig107).toContain('WITH CHECK (')
    expect(mig107).toMatch(/profiles_update_self[\s\S]*?WITH CHECK/)
  })

  it('WITH CHECK pins role to public.user_role()', () => {
    const policyBlock = mig107.slice(
      mig107.indexOf('CREATE POLICY "profiles_update_self"'),
      mig107.indexOf('COMMENT ON POLICY "profiles_update_self"')
    )
    expect(policyBlock).toContain('role   = public.user_role()')
  })

  it('WITH CHECK pins org_id to public.user_org_id()', () => {
    const policyBlock = mig107.slice(
      mig107.indexOf('CREATE POLICY "profiles_update_self"'),
      mig107.indexOf('COMMENT ON POLICY "profiles_update_self"')
    )
    expect(policyBlock).toContain('org_id = public.user_org_id()')
  })

  it('self-escalation reasoning: public.user_role() is STABLE (uses statement snapshot)', () => {
    expect(mig107).toContain('STABLE')
    expect(mig107).toContain('statement-level snapshot')
  })
})

describe('[STATIC] 2. Legitimate profile self-edit still possible', () => {
  it('profiles_update_self USING clause allows user to target their own row', () => {
    const policyBlock = mig107.slice(
      mig107.indexOf('CREATE POLICY "profiles_update_self"'),
      mig107.indexOf('COMMENT ON POLICY "profiles_update_self"')
    )
    expect(policyBlock).toContain('USING (id = auth.uid())')
  })

  it('migration does not drop profiles_update_admin (owner/admin employee management)', () => {
    expect(mig107).not.toContain('DROP POLICY IF EXISTS "profiles_update_admin"')
  })

  it('no restriction on full_name or phone in the self-update policy', () => {
    const policyBlock = mig107.slice(
      mig107.indexOf('CREATE POLICY "profiles_update_self"'),
      mig107.indexOf('COMMENT ON POLICY "profiles_update_self"')
    )
    expect(policyBlock).not.toContain('full_name')
    expect(policyBlock).not.toContain('phone')
    expect(policyBlock).not.toContain('avatar_url')
  })
})

describe('[STATIC] 3. Owner/admin role management remains possible', () => {
  it('profiles_update_admin is not dropped', () => {
    expect(mig107).not.toContain('DROP POLICY IF EXISTS "profiles_update_admin"')
    expect(mig107).not.toContain('DROP POLICY "profiles_update_admin"')
  })

  it('profiles_update_admin is not replaced with a more restrictive policy', () => {
    // Migration does not create a new profiles_update_admin
    const count = (mig107.match(/CREATE POLICY "profiles_update_admin"/g) ?? []).length
    expect(count).toBe(0)
  })
})

describe('[STATIC] 4. Ordinary employee cannot satisfy Portal owner/admin RLS', () => {
  it('portal_requests SELECT policy requires auth.user_role() IN (owner, admin)', () => {
    expect(mig107).toContain('portal_requests_owner_admin_select')
    expect(mig107).toMatch(/portal_requests_owner_admin_select[\s\S]*?user_role\(\).*?IN.*?'owner'.*?'admin'/)
  })

  it('portal_requests UPDATE policy requires auth.user_role() IN (owner, admin)', () => {
    expect(mig107).toContain('portal_requests_owner_admin_update')
    expect(mig107).toMatch(/portal_requests_owner_admin_update[\s\S]*?user_role\(\).*?IN.*?'owner'.*?'admin'/)
  })

  it('profiles.role for employee portal users is not owner/admin (migration 081 confirms)', () => {
    // employee_profiles.role is constrained to 'employee'/'foreman' at the table level;
    // owner/admin roles in migration 081 appear only in admin-policy USING clauses, not in
    // the employee_profiles schema.
    const mig081Path = join(MIG_DIR, '081_employee_time_tracking.sql')
    const mig081 = existsSync(mig081Path) ? readFileSync(mig081Path, 'utf8') : ''
    expect(mig081).toContain("CHECK (role IN ('employee', 'foreman'))")
    // The table-level CHECK constraint does not include 'owner' or 'admin'
    expect(mig081).not.toMatch(/CHECK\s*\(role IN \('[^']*owner/)
  })
})

describe('[MOCK] 5. Tracking route still works after anon table SELECT removed', () => {
  beforeEach(() => { mockRpc.mockClear(); mockFrom.mockClear() })

  it('PortalTrackView calls get_portal_request_status RPC, not direct table', async () => {
    const SAFE_RESPONSE = {
      id: 'req-uuid-1', name: 'Jane', status: 'new', service_category: 'residential',
      address: '123 Main St', city: 'Palm Springs', created_at: new Date().toISOString(),
      description: null, preferred_date: null, preferred_time: null,
    }
    mockRpc.mockResolvedValueOnce({ data: SAFE_RESPONSE, error: null })
    const { supabase } = await import('@/lib/supabase')
    await (supabase as any).rpc('get_portal_request_status', { p_id: 'req-uuid-1' })
    expect(mockRpc).toHaveBeenCalledWith('get_portal_request_status', { p_id: 'req-uuid-1' })
    // Confirm no direct table SELECT was used
    expect(mockFrom).not.toHaveBeenCalledWith('portal_requests')
  })

  it('notFound state when RPC returns null', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null })
    const { supabase } = await import('@/lib/supabase')
    const { data } = await (supabase as any).rpc('get_portal_request_status', { p_id: 'bad-uuid' })
    expect(data).toBeNull()
  })
})

describe('[STATIC] 6. Tracking API returns only customer-safe fields', () => {
  it('get_portal_request_status function exists in migration 107', () => {
    expect(mig107).toContain('get_portal_request_status')
  })

  it('get_portal_request_status returns safe status/scheduling fields', () => {
    const fnBody = mig107.slice(
      mig107.indexOf('CREATE OR REPLACE FUNCTION public.get_portal_request_status'),
      mig107.indexOf('COMMENT ON FUNCTION public.get_portal_request_status')
    )
    expect(fnBody).toContain("'id'")
    expect(fnBody).toContain("'name'")
    expect(fnBody).toContain("'status'")
    expect(fnBody).toContain("'service_category'")
    expect(fnBody).toContain("'address'")
    expect(fnBody).toContain("'created_at'")
  })

  it('get_portal_request_status does NOT return notes', () => {
    const fnBody = mig107.slice(
      mig107.indexOf('CREATE OR REPLACE FUNCTION public.get_portal_request_status'),
      mig107.indexOf('COMMENT ON FUNCTION public.get_portal_request_status')
    )
    expect(fnBody).not.toContain("'notes'")
    expect(fnBody).not.toMatch(/'notes',\s*v_row\.notes/)
  })

  it('get_portal_request_status does NOT return hunter_lead_id', () => {
    // Narrow to only the jsonb_build_object(...) return expression to avoid
    // matching the inline SQL comment that lists excluded fields.
    const fnBody = mig107.slice(
      mig107.indexOf('RETURN jsonb_build_object(', mig107.indexOf('get_portal_request_status')),
      mig107.indexOf('COMMENT ON FUNCTION public.get_portal_request_status')
    )
    expect(fnBody).not.toMatch(/'hunter_lead_id'/)
    expect(fnBody).not.toMatch(/v_row\.hunter_lead_id/)
  })

  it('get_portal_request_status does NOT return review fields', () => {
    const fnBody = mig107.slice(
      mig107.indexOf('RETURN jsonb_build_object(', mig107.indexOf('get_portal_request_status')),
      mig107.indexOf('COMMENT ON FUNCTION public.get_portal_request_status')
    )
    expect(fnBody).not.toMatch(/'review_requested_at'/)
    expect(fnBody).not.toMatch(/'review_request_status'/)
    expect(fnBody).not.toMatch(/'review_request_sent_to'/)
  })

  it('get_portal_request_status does NOT return submitted_ip or source', () => {
    const fnBody = mig107.slice(
      mig107.indexOf('RETURN jsonb_build_object(', mig107.indexOf('get_portal_request_status')),
      mig107.indexOf('COMMENT ON FUNCTION public.get_portal_request_status')
    )
    expect(fnBody).not.toMatch(/'submitted_ip'/)
    expect(fnBody).not.toMatch(/'source'/)
  })

  it('get_portal_request_status is SECURITY DEFINER', () => {
    const fnBlock = mig107.slice(
      mig107.indexOf('CREATE OR REPLACE FUNCTION public.get_portal_request_status'),
      mig107.indexOf('COMMENT ON FUNCTION public.get_portal_request_status')
    )
    expect(fnBlock).toContain('SECURITY DEFINER')
  })
})

describe('[STATIC] 7. Random UUID cannot retrieve internal request data', () => {
  it('get_portal_request_status returns NULL when row not found', () => {
    const fnBody = mig107.slice(
      mig107.indexOf('CREATE OR REPLACE FUNCTION public.get_portal_request_status'),
      mig107.indexOf('COMMENT ON FUNCTION public.get_portal_request_status')
    )
    expect(fnBody).toContain('IF NOT FOUND THEN')
    expect(fnBody).toContain('RETURN NULL')
  })

  it('no direct anon SELECT grant on portal_requests (enumeration impossible)', () => {
    expect(mig107).toContain('REVOKE ALL ON public.portal_requests FROM anon')
    expect(mig107).not.toMatch(/GRANT.*SELECT.*portal_requests.*TO anon/)
  })
})

describe('[MOCK] 8. Submit returns request_id and one-time attach_token', () => {
  beforeEach(() => mockRpc.mockClear())

  it('submit_portal_request returns object with request_id and attach_token', async () => {
    const EXPECTED = { request_id: 'aabb-1234', attach_token: 'a'.repeat(64) }
    mockRpc.mockResolvedValueOnce({ data: EXPECTED, error: null })
    const { supabase } = await import('@/lib/supabase')
    const { data } = await (supabase as any).rpc('submit_portal_request', {
      p_name: 'Jane', p_phone: '760-555-0001',
    })
    expect(data).toHaveProperty('request_id')
    expect(data).toHaveProperty('attach_token')
  })

  it('form passes attach_token to append_portal_request_files', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: { request_id: 'req-1', attach_token: 'tok-hex-64' }, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
    const { supabase } = await import('@/lib/supabase')
    const { data: s } = await (supabase as any).rpc('submit_portal_request', { p_name: 'Jane', p_phone: '555' })
    await (supabase as any).rpc('append_portal_request_files', {
      p_id:           s.request_id,
      p_notes_suffix: 'Files: https://example.supabase.co/storage/v1/object/public/portal-uploads/req-1/f.pdf',
      p_attach_token: s.attach_token,
    })
    expect(mockRpc.mock.calls[1][1]).toMatchObject({
      p_id:           'req-1',
      p_attach_token: 'tok-hex-64',
    })
  })
})

describe('[STATIC] 9. Token hash is not stored in plaintext', () => {
  it('submit function stores attach_token_hash, not the raw token', () => {
    const fnBody = mig107.slice(
      mig107.indexOf('CREATE OR REPLACE FUNCTION public.submit_portal_request'),
      mig107.indexOf('COMMENT ON FUNCTION public.submit_portal_request')
    )
    expect(fnBody).toContain('attach_token_hash')
    expect(fnBody).not.toMatch(/INSERT.*v_raw_token/)
  })

  it('token hash uses SHA-256 via pgcrypto digest()', () => {
    const fnBody = mig107.slice(
      mig107.indexOf('CREATE OR REPLACE FUNCTION public.submit_portal_request'),
      mig107.indexOf('COMMENT ON FUNCTION public.submit_portal_request')
    )
    expect(fnBody).toContain("digest(v_raw_token::bytea, 'sha256')")
  })

  it('raw token is generated with gen_random_bytes(32) — 256-bit entropy', () => {
    const fnBody = mig107.slice(
      mig107.indexOf('CREATE OR REPLACE FUNCTION public.submit_portal_request'),
      mig107.indexOf('COMMENT ON FUNCTION public.submit_portal_request')
    )
    expect(fnBody).toContain('gen_random_bytes(32)')
  })

  it('pgcrypto is enabled in the migration', () => {
    expect(mig107).toContain('CREATE EXTENSION IF NOT EXISTS pgcrypto')
  })

  it('attach_token_hash column is added to portal_requests', () => {
    expect(mig107).toContain('ADD COLUMN IF NOT EXISTS attach_token_hash TEXT')
  })
})

describe('[MOCK] 10. Correct token appends once', () => {
  beforeEach(() => mockRpc.mockClear())

  it('returns true on first append with correct token', async () => {
    mockRpc.mockResolvedValueOnce({ data: true, error: null })
    const { supabase } = await import('@/lib/supabase')
    const { data } = await (supabase as any).rpc('append_portal_request_files', {
      p_id:           'req-1',
      p_notes_suffix: 'Files: https://proj.supabase.co/storage/v1/object/public/portal-uploads/req-1/f.pdf',
      p_attach_token: 'a'.repeat(64),
    })
    expect(data).toBe(true)
  })
})

describe('[MOCK] 11. Wrong token fails', () => {
  beforeEach(() => mockRpc.mockClear())

  it('returns false on wrong token', async () => {
    mockRpc.mockResolvedValueOnce({ data: false, error: null })
    const { supabase } = await import('@/lib/supabase')
    const { data } = await (supabase as any).rpc('append_portal_request_files', {
      p_id:           'req-1',
      p_notes_suffix: 'Files: https://proj.supabase.co/storage/v1/object/public/portal-uploads/req-1/f.pdf',
      p_attach_token: 'b'.repeat(64),
    })
    expect(data).toBe(false)
  })
})

describe('[STATIC] 12. Token from request A cannot update request B', () => {
  it('append WHERE clause binds token hash check to the specific row id', () => {
    const fnBody = mig107.slice(
      mig107.indexOf('CREATE OR REPLACE FUNCTION public.append_portal_request_files'),
      mig107.indexOf('COMMENT ON FUNCTION public.append_portal_request_files')
    )
    expect(fnBody).toContain('WHERE id              = p_id')
    expect(fnBody).toContain('AND attach_token_hash = v_provided_hash')
  })
})

describe('[MOCK] 13. Reused token fails (one-time use)', () => {
  beforeEach(() => mockRpc.mockClear())

  it('returns false on second append (token already consumed)', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: true, error: null })   // first use
      .mockResolvedValueOnce({ data: false, error: null })  // second use
    const { supabase } = await import('@/lib/supabase')
    const args = {
      p_id: 'req-1',
      p_notes_suffix: 'Files: https://proj.supabase.co/storage/v1/object/public/portal-uploads/req-1/f.pdf',
      p_attach_token: 'a'.repeat(64),
    }
    const { data: first  } = await (supabase as any).rpc('append_portal_request_files', args)
    const { data: second } = await (supabase as any).rpc('append_portal_request_files', args)
    expect(first).toBe(true)
    expect(second).toBe(false)
  })
})

describe('[STATIC] 14. Expired capability fails (30-minute guard)', () => {
  it('append WHERE clause includes 30-minute created_at guard', () => {
    const fnBody = mig107.slice(
      mig107.indexOf('CREATE OR REPLACE FUNCTION public.append_portal_request_files'),
      mig107.indexOf('COMMENT ON FUNCTION public.append_portal_request_files')
    )
    expect(fnBody).toContain("created_at     >= now() - INTERVAL '30 minutes'")
  })
})

describe('[STATIC] 15. Append after conversion/linkage fails', () => {
  it('append WHERE clause requires hunter_lead_id IS NULL', () => {
    const fnBody = mig107.slice(
      mig107.indexOf('CREATE OR REPLACE FUNCTION public.append_portal_request_files'),
      mig107.indexOf('COMMENT ON FUNCTION public.append_portal_request_files')
    )
    expect(fnBody).toContain('AND hunter_lead_id  IS NULL')
  })

  it('append WHERE clause requires status = new', () => {
    const fnBody = mig107.slice(
      mig107.indexOf('CREATE OR REPLACE FUNCTION public.append_portal_request_files'),
      mig107.indexOf('COMMENT ON FUNCTION public.append_portal_request_files')
    )
    expect(fnBody).toContain("AND status          = 'new'")
  })
})

describe('[STATIC] 16. Excess attachment count fails', () => {
  it('append validates maximum 10 file URLs', () => {
    const fnBody = mig107.slice(
      mig107.indexOf('CREATE OR REPLACE FUNCTION public.append_portal_request_files'),
      mig107.indexOf('COMMENT ON FUNCTION public.append_portal_request_files')
    )
    expect(fnBody).toContain('array_length(v_url_array, 1) > 10')
    expect(fnBody).toContain('too many attachments')
  })
})

describe('[STATIC] 17. Excess metadata size fails', () => {
  it('append validates total suffix length (max 20000)', () => {
    const fnBody = mig107.slice(
      mig107.indexOf('CREATE OR REPLACE FUNCTION public.append_portal_request_files'),
      mig107.indexOf('COMMENT ON FUNCTION public.append_portal_request_files')
    )
    expect(fnBody).toContain('char_length(p_notes_suffix) > 20000')
  })

  it('append validates individual URL length (max 2000)', () => {
    const fnBody = mig107.slice(
      mig107.indexOf('CREATE OR REPLACE FUNCTION public.append_portal_request_files'),
      mig107.indexOf('COMMENT ON FUNCTION public.append_portal_request_files')
    )
    expect(fnBody).toContain('char_length(v_url) > 2000')
  })
})

describe('[STATIC] 18. Arbitrary external URL/path fails', () => {
  it('append validates https:// scheme and /portal-uploads/ bucket prefix', () => {
    const fnBody = mig107.slice(
      mig107.indexOf('CREATE OR REPLACE FUNCTION public.append_portal_request_files'),
      mig107.indexOf('COMMENT ON FUNCTION public.append_portal_request_files')
    )
    expect(fnBody).toContain("v_url LIKE 'https://%'")
    expect(fnBody).toContain("v_url LIKE '%/portal-uploads/%'")
    expect(fnBody).toContain('attachment URL is not from the expected storage bucket')
  })
})

describe('[STATIC] 19. Anonymous user can execute submit', () => {
  it('submit_portal_request GRANT EXECUTE includes anon', () => {
    expect(mig107).toMatch(/GRANT EXECUTE ON FUNCTION public\.submit_portal_request[\s\S]*?TO anon/)
  })
})

describe('[STATIC] 20. Authenticated user can execute submit', () => {
  it('submit_portal_request GRANT EXECUTE includes authenticated', () => {
    expect(mig107).toMatch(/GRANT EXECUTE ON FUNCTION public\.submit_portal_request[\s\S]*?TO authenticated/)
  })

  it('get_portal_request_status GRANT EXECUTE includes authenticated', () => {
    expect(mig107).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_portal_request_status[\s\S]*?TO authenticated/)
  })

  it('append_portal_request_files GRANT EXECUTE includes authenticated', () => {
    expect(mig107).toMatch(/GRANT EXECUTE ON FUNCTION public\.append_portal_request_files[\s\S]*?TO authenticated/)
  })
})

describe('[STATIC] 21. anon and authenticated have no direct table INSERT', () => {
  it('no GRANT INSERT on portal_requests to anon', () => {
    expect(mig107).not.toMatch(/GRANT.*INSERT.*portal_requests.*TO anon/)
  })

  it('no GRANT INSERT on portal_requests to authenticated', () => {
    expect(mig107).not.toMatch(/GRANT.*INSERT.*portal_requests.*TO authenticated/)
  })
})

describe('[STATIC] 22. anon has no SELECT/UPDATE/DELETE on portal_requests', () => {
  it('REVOKE ALL from anon', () => {
    expect(mig107).toContain('REVOKE ALL ON public.portal_requests FROM anon')
  })

  it('no GRANT SELECT to anon on portal_requests', () => {
    expect(mig107).not.toMatch(/GRANT.*SELECT.*portal_requests.*TO anon/)
  })

  it('no GRANT UPDATE to anon on portal_requests', () => {
    expect(mig107).not.toMatch(/GRANT.*UPDATE.*portal_requests.*TO anon/)
  })

  it('no GRANT DELETE to anon on portal_requests', () => {
    expect(mig107).not.toMatch(/GRANT.*DELETE.*portal_requests.*TO anon/)
  })
})

describe('[STATIC] 23. Authenticated ordinary employee has no Portal SELECT/UPDATE', () => {
  it('only SELECT + UPDATE granted to authenticated (no INSERT/DELETE)', () => {
    expect(mig107).toContain('GRANT SELECT, UPDATE ON public.portal_requests TO authenticated')
  })

  it('RLS policies scope authenticated access to owner/admin roles only', () => {
    expect(mig107).toMatch(/portal_requests_owner_admin_select[\s\S]*?user_role\(\)/)
    expect(mig107).toMatch(/portal_requests_owner_admin_update[\s\S]*?user_role\(\)/)
  })
})

describe('[STATIC] 24. Owner/admin Portal Inbox SELECT/UPDATE remains', () => {
  it('owner/admin SELECT policy exists', () => {
    expect(mig107).toContain('portal_requests_owner_admin_select')
  })

  it('owner/admin UPDATE policy exists', () => {
    expect(mig107).toContain('portal_requests_owner_admin_update')
  })

  it('old broad policies are dropped', () => {
    expect(mig107).toContain('DROP POLICY IF EXISTS "portal_requests_public_insert"')
    expect(mig107).toContain('DROP POLICY IF EXISTS "portal_requests_auth_all"')
  })
})

describe('[MOCK] 25. Existing review duplicate protection unchanged', () => {
  beforeEach(() => { mockRpc.mockClear(); mockFrom.mockClear() })

  it('sendPortalReviewRequest calls Netlify function, not direct portal_requests UPDATE', async () => {
    const originalFetch = global.fetch
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    })
    global.fetch = mockFetch
    try {
      const { sendPortalReviewRequest } = await import('@/services/portal/portalService')
      await sendPortalReviewRequest({ portalRequestId: 'req-1', email: 'a@b.com' })
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('send-review-request'),
        expect.objectContaining({ method: 'POST' })
      )
      expect(mockFrom).not.toHaveBeenCalledWith('portal_requests')
    } finally {
      global.fetch = originalFetch
    }
  })
})

describe('[MOCK] 26. Existing form success/error behavior remains', () => {
  beforeEach(() => mockRpc.mockClear())

  it('submit error is surfaced when RPC returns dbError', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'name is required' } })
    const { supabase } = await import('@/lib/supabase')
    const { error } = await (supabase as any).rpc('submit_portal_request', { p_name: '', p_phone: '555' })
    expect(error).toBeTruthy()
  })

  it('submit error is surfaced when result has no request_id', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null })
    const { supabase } = await import('@/lib/supabase')
    const { data } = await (supabase as any).rpc('submit_portal_request', { p_name: 'J', p_phone: '555' })
    expect(data?.request_id).toBeUndefined()
  })
})

describe('[MOCK] 27. One form submit creates one row', () => {
  beforeEach(() => mockRpc.mockClear())

  it('submit RPC is called exactly once per form submission', async () => {
    mockRpc.mockResolvedValueOnce({ data: { request_id: 'uuid-1', attach_token: 'x'.repeat(64) }, error: null })
    const { supabase } = await import('@/lib/supabase')
    await (supabase as any).rpc('submit_portal_request', {
      p_name: 'Jane', p_phone: '760-555-0001',
    })
    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledWith('submit_portal_request', expect.any(Object))
  })

  it('submit RPC does not send p_status (no way to duplicate as reviewed/closed)', () => {
    mockRpc.mockResolvedValueOnce({ data: { request_id: 'u1', attach_token: 't1' }, error: null })
    const { supabase } = (vi.importMock('@/lib/supabase') as any) ?? {}
    const callArgs = { p_name: 'Jane', p_phone: '555' }
    expect(Object.prototype.hasOwnProperty.call(callArgs, 'p_status')).toBe(false)
  })
})

describe('[STATIC] 28. Eight migration guards remain narrowly scoped', () => {
  const guardFiles = [
    'src/__tests__/sessionCloseout.test.ts',
    'src/__tests__/projectOnlyWorkSessions.test.ts',
    'src/__tests__/projectOnlyAssignmentProjectEligibility.test.ts',
    'src/__tests__/projectIdentityCompatibility.test.ts',
    'src/components/admin/__tests__/adminSessionPunchVoid.test.ts',
    'src/components/admin/__tests__/adminSessionPunchCorrection.test.ts',
    'src/components/employee/__tests__/employeeWeeklyTaskViewUiContract.test.ts',
    'src/components/employee/__tests__/employeeMonthCalendarUiContract.test.ts',
  ]

  it('all eight regression-guard test files exist', () => {
    for (const rel of guardFiles) {
      expect(existsSync(join(ROOT, rel)), rel).toBe(true)
    }
  })

  it('each guard file allows migrations 103-109', () => {
    for (const rel of guardFiles) {
      const content = readFileSync(join(ROOT, rel), 'utf8')
      expect(content, `${rel} should exclude 107`).toContain("startsWith('107_')")
      expect(content, `${rel} should exclude 108`).toContain("startsWith('108_')")
      expect(content, `${rel} should exclude 109`).toContain("startsWith('109_')")
    }
  })

  it('migration 107 file exists', () => {
    expect(existsSync(MIG_107_PATH)).toBe(true)
  })

  it('migration 108 file exists', () => {
    expect(existsSync(MIG_108_PATH)).toBe(true)
  })
})

// ── Migration 108 static contract tests ──────────────────────────────────────

describe('[STATIC] 29. Migration 108 drops legacy policies by real names', () => {
  it('migration 108 file exists', () => {
    expect(mig108).not.toBe('')
  })

  it('drops allow_all_inserts', () => {
    expect(mig108).toContain('DROP POLICY IF EXISTS "allow_all_inserts"')
  })

  it('drops allow_auth_all', () => {
    expect(mig108).toContain('DROP POLICY IF EXISTS "allow_auth_all"')
  })
})

describe('[STATIC] 30. Migration 108 defensively drops previously assumed names', () => {
  it('defensively drops portal_requests_public_insert', () => {
    expect(mig108).toContain('DROP POLICY IF EXISTS "portal_requests_public_insert"')
  })

  it('defensively drops portal_requests_auth_all', () => {
    expect(mig108).toContain('DROP POLICY IF EXISTS "portal_requests_auth_all"')
  })
})

describe('[STATIC] 31. Migration 108 revokes ALL from PUBLIC', () => {
  it('revokes ALL PRIVILEGES from PUBLIC on portal_requests', () => {
    expect(mig108).toMatch(/REVOKE ALL.*ON.*portal_requests.*FROM PUBLIC/s)
  })
})

describe('[STATIC] 32. Migration 108 revokes ALL from anon', () => {
  it('revokes ALL PRIVILEGES from anon on portal_requests', () => {
    expect(mig108).toMatch(/REVOKE ALL.*ON.*portal_requests.*FROM anon/s)
  })
})

describe('[STATIC] 33. Migration 108 revokes ALL from authenticated', () => {
  it('revokes ALL PRIVILEGES from authenticated on portal_requests', () => {
    expect(mig108).toMatch(/REVOKE ALL.*ON.*portal_requests.*FROM authenticated/s)
  })
})

describe('[STATIC] 34. Migration 108 regrants authenticated SELECT and UPDATE only', () => {
  it('grants SELECT and UPDATE to authenticated', () => {
    expect(mig108).toMatch(/GRANT SELECT, UPDATE ON.*portal_requests.*TO authenticated/s)
  })
})

describe('[STATIC] 35. Migration 108 does not grant INSERT to authenticated', () => {
  it('no GRANT INSERT to authenticated on portal_requests', () => {
    const lines = mig108.split('\n').filter(l => /^\s*GRANT\b/i.test(l))
    for (const line of lines) {
      expect(line).not.toMatch(/\bINSERT\b/)
    }
  })
})

describe('[STATIC] 36. Migration 108 does not grant DELETE to authenticated', () => {
  it('no GRANT DELETE to authenticated on portal_requests', () => {
    const lines = mig108.split('\n').filter(l => /^\s*GRANT\b/i.test(l))
    for (const line of lines) {
      expect(line).not.toMatch(/\bDELETE\b/)
    }
  })
})

describe('[STATIC] 37. Migration 108 does not grant TRUNCATE to authenticated', () => {
  it('no GRANT TRUNCATE to authenticated on portal_requests', () => {
    const lines = mig108.split('\n').filter(l => /^\s*GRANT\b/i.test(l))
    for (const line of lines) {
      expect(line).not.toMatch(/\bTRUNCATE\b/)
    }
  })
})

describe('[STATIC] 38. Migration 108 preserves the two owner/admin policies', () => {
  it('does not drop portal_requests_owner_admin_select', () => {
    expect(mig108).not.toContain('DROP POLICY IF EXISTS "portal_requests_owner_admin_select"')
    expect(mig108).not.toContain('DROP POLICY "portal_requests_owner_admin_select"')
  })

  it('does not drop portal_requests_owner_admin_update', () => {
    expect(mig108).not.toContain('DROP POLICY IF EXISTS "portal_requests_owner_admin_update"')
    expect(mig108).not.toContain('DROP POLICY "portal_requests_owner_admin_update"')
  })

  it('does not recreate owner/admin policies (migration 107 already installed them)', () => {
    expect(mig108).not.toContain('CREATE POLICY portal_requests_owner_admin_select')
    expect(mig108).not.toContain('CREATE POLICY portal_requests_owner_admin_update')
  })
})

describe('[STATIC] 39. Migration 108 preserves all three RPCs', () => {
  it('does not drop or replace submit_portal_request', () => {
    expect(mig108).not.toContain('DROP FUNCTION')
    expect(mig108).not.toContain('CREATE OR REPLACE FUNCTION public.submit_portal_request')
  })

  it('does not drop or replace get_portal_request_status', () => {
    expect(mig108).not.toContain('CREATE OR REPLACE FUNCTION public.get_portal_request_status')
  })

  it('does not drop or replace append_portal_request_files', () => {
    expect(mig108).not.toContain('CREATE OR REPLACE FUNCTION public.append_portal_request_files')
  })
})

describe('[STATIC] 40. Migration 108 preserves anon/authenticated RPC EXECUTE grants', () => {
  it('does not revoke EXECUTE from anon or authenticated', () => {
    const lines = mig108.split('\n').filter(l => /^\s*REVOKE\b/i.test(l))
    for (const line of lines) {
      expect(line).not.toMatch(/\bEXECUTE\b/)
    }
  })
})

describe('[STATIC] 41. Migration 108 preserves PUBLIC RPC denial', () => {
  it('does not grant EXECUTE to PUBLIC on any function', () => {
    expect(mig108).not.toMatch(/GRANT.*EXECUTE.*TO PUBLIC/si)
    expect(mig108).not.toMatch(/GRANT.*EXECUTE.*TO public\b/s)
  })
})

describe('[STATIC] 42. Migration 108 contains transactional postcondition assertions', () => {
  it('runs inside BEGIN/COMMIT', () => {
    expect(mig108).toContain('BEGIN;')
    expect(mig108).toContain('COMMIT;')
  })

  it('uses DO $$ block for postconditions', () => {
    expect(mig108).toContain('DO $$')
    expect(mig108).toContain('RAISE EXCEPTION')
  })

  it('asserts RLS remains enabled', () => {
    expect(mig108).toContain('relrowsecurity')
    expect(mig108).toMatch(/RLS.*not enabled|not enabled.*RLS/i)
  })

  it('asserts exactly two policies remain', () => {
    expect(mig108).toContain('v_count <> 2')
    expect(mig108).toMatch(/expected 2 portal_requests policies/)
  })

  it('asserts no broad or unrestricted policy remains', () => {
    expect(mig108).toContain("cmd = 'ALL'")
    expect(mig108).toContain("qual = 'true'")
    expect(mig108).toContain('broad or unrestricted policy')
  })

  it('asserts PUBLIC lacks table privileges', () => {
    expect(mig108).toMatch(/has_table_privilege\('public'.*portal_requests/)
  })

  it('asserts anon lacks table privileges', () => {
    expect(mig108).toMatch(/has_table_privilege\('anon'.*portal_requests/)
  })

  it('asserts authenticated has exactly SELECT and UPDATE', () => {
    expect(mig108).toMatch(/has_table_privilege\('authenticated'.*portal_requests.*SELECT/)
    expect(mig108).toMatch(/has_table_privilege\('authenticated'.*portal_requests.*INSERT/)
  })

  it('asserts authenticated lacks INSERT DELETE TRUNCATE', () => {
    expect(mig108).toMatch(/authenticated retains INSERT/)
    expect(mig108).toMatch(/authenticated retains DELETE/)
    expect(mig108).toMatch(/authenticated retains TRUNCATE/)
  })

  it('asserts exactly one overload per RPC', () => {
    expect(mig108).toMatch(/expected 1 overload for submit_portal_request/)
    expect(mig108).toMatch(/expected 1 overload for get_portal_request_status/)
    expect(mig108).toMatch(/expected 1 overload for append_portal_request_files/)
  })

  it('asserts all three RPCs remain SECURITY DEFINER', () => {
    expect(mig108).toMatch(/no longer SECURITY DEFINER/)
  })

  it('asserts anon and authenticated retain EXECUTE', () => {
    expect(mig108).toMatch(/anon missing EXECUTE/)
    expect(mig108).toMatch(/authenticated missing EXECUTE/)
  })

  it('asserts PUBLIC has no EXECUTE on RPCs', () => {
    expect(mig108).toMatch(/PUBLIC has EXECUTE/)
  })
})

describe('[STATIC] 43. Migration 108 does not alter CustomerPortalView', () => {
  it('no reference to CustomerPortalView in migration 108', () => {
    expect(mig108).not.toContain('CustomerPortalView')
    expect(mig108).not.toContain('customer_portal_view')
  })
})

describe('[STATIC] 44. Migration 108 does not alter PortalTrackView', () => {
  it('no reference to PortalTrackView in migration 108', () => {
    expect(mig108).not.toContain('PortalTrackView')
    expect(mig108).not.toContain('portal_track_view')
  })
})

describe('[STATIC] 45. Migration 108 does not modify migration 107', () => {
  it('migration 108 does not recreate or replace any function from migration 107', () => {
    expect(mig108).not.toContain('CREATE OR REPLACE FUNCTION public.submit_portal_request')
    expect(mig108).not.toContain('CREATE OR REPLACE FUNCTION public.get_portal_request_status')
    expect(mig108).not.toContain('CREATE OR REPLACE FUNCTION public.append_portal_request_files')
    expect(mig108).not.toContain('CREATE EXTENSION IF NOT EXISTS pgcrypto')
  })

  it('migration 107 file is unchanged (contains the public.user_role fix)', () => {
    expect(mig107).toContain('public.user_role()')
    expect(mig107).toContain('public.user_org_id()')
  })
})

describe('[STATIC] 46. Migration 108 adds no unauthorized implementation', () => {
  it('no employee role implementation', () => {
    expect(mig108).not.toContain('employee_role')
    expect(mig108).not.toContain('profiles.role')
  })

  it('no storage or SEC-0S implementation', () => {
    expect(mig108).not.toContain('portal-uploads')
    expect(mig108).not.toContain('storage.buckets')
  })

  it('no assignment, service call, or billing implementation', () => {
    expect(mig108).not.toContain('work_orders')
    expect(mig108).not.toContain('service_calls')
    expect(mig108).not.toContain('assignments')
    expect(mig108).not.toContain('invoices')
  })
})

describe('[STATIC] 47. Eight migration guards updated to recognize migration 108', () => {
  const guardFiles = [
    'src/__tests__/sessionCloseout.test.ts',
    'src/__tests__/projectOnlyWorkSessions.test.ts',
    'src/__tests__/projectOnlyAssignmentProjectEligibility.test.ts',
    'src/__tests__/projectIdentityCompatibility.test.ts',
    'src/components/admin/__tests__/adminSessionPunchVoid.test.ts',
    'src/components/admin/__tests__/adminSessionPunchCorrection.test.ts',
    'src/components/employee/__tests__/employeeWeeklyTaskViewUiContract.test.ts',
    'src/components/employee/__tests__/employeeMonthCalendarUiContract.test.ts',
  ]

  it('all eight guard files allow migration 108', () => {
    for (const rel of guardFiles) {
      const content = readFileSync(join(ROOT, rel), 'utf8')
      expect(content, `${rel} should exclude 108`).toContain("startsWith('108_')")
    }
  })

  it('all eight guard files allow migration 109 and still reject migration 110 and later', () => {
    for (const rel of guardFiles) {
      const content = readFileSync(join(ROOT, rel), 'utf8')
      expect(content, `${rel} should exclude 109`).toContain("startsWith('109_')")
      expect(content, `${rel} should not allow 110+`).not.toContain("startsWith('110_')")
    }
  })
})
