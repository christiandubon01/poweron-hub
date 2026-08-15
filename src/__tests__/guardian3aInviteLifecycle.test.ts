/**
 * GUARDIAN-3A / GUARDIAN-3A1 — Invite lifecycle regression coverage.
 *
 * RUNTIME blocks test pure functions and mocked client calls.
 * SOURCE-CONTRACT blocks verify the correct patterns exist in server/UI code.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildFounderContractorAdminReport } from '../../netlify/functions/pilot-telemetry'

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const FOUNDER_FN      = read('netlify/functions/pilot-telemetry.ts')
const FOUNDER_SURFACE = read('src/components/guardian/FounderContractorAdminSurface.tsx')

// ── Client service mocks ─────────────────────────────────────────────────────

const deps = vi.hoisted(() => ({
  fetch: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { access_token: 'founder-jwt' } } })),
    },
  },
}))

import { deleteInvite, revokeInvite } from '@/services/inviteService'

beforeEach(() => {
  deps.fetch.mockReset()
  ;(globalThis as any).fetch = deps.fetch
})

// ── A. Founder can revoke an effective pending invite ─────────────────────────

describe('A — founder revoke pending invite (SOURCE-CONTRACT)', () => {
  it('uses an atomic .eq(status, pending) guard so non-pending rows are excluded', () => {
    const revokeFn = FOUNDER_FN.slice(
      FOUNDER_FN.indexOf('async function handleFounderRevokeBetaInvite'),
      FOUNDER_FN.indexOf('async function handleFounderDeleteBetaInvite'),
    )
    expect(revokeFn).toContain(".eq('status', 'pending')")
    expect(revokeFn).toContain("requireFounder(user)")
  })

  it('client routes revoke through the founder-only endpoint (RUNTIME)', async () => {
    deps.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    const result = await revokeInvite('invite-pending')
    expect(result).toEqual({ success: true })
    const [, init] = deps.fetch.mock.calls[0]
    expect(JSON.parse(init.body)).toMatchObject({ action: 'founder_revoke_beta_invite', inviteId: 'invite-pending' })
    expect(init.headers.Authorization).toBe('Bearer founder-jwt')
  })
})

// ── B. Accepted invite cannot be revoked even by direct server call ───────────

describe('B — accepted invite cannot be revoked (SOURCE-CONTRACT)', () => {
  it('revoke returns invite_not_revokable when the row is not pending', () => {
    const revokeFn = FOUNDER_FN.slice(
      FOUNDER_FN.indexOf('async function handleFounderRevokeBetaInvite'),
      FOUNDER_FN.indexOf('async function handleFounderDeleteBetaInvite'),
    )
    // The response when data is null (accepted rows filtered by .eq('status','pending'))
    expect(revokeFn).toContain("'invite_not_revokable'")
    // Both the id filter and the status guard must both be present
    expect(revokeFn).toContain(".eq('id', inviteId)")
    expect(revokeFn).toContain(".eq('status', 'pending')")
  })

  it('client surfaces invite_not_revokable as an error (RUNTIME)', async () => {
    deps.fetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'invite_not_revokable' }),
    })
    const result = await revokeInvite('invite-accepted')
    expect(result).toMatchObject({ success: false, error: 'invite_not_revokable' })
  })
})

// ── C. Founder can delete a pending invite ────────────────────────────────────

describe('C — founder can delete pending invite (SOURCE-CONTRACT + RUNTIME)', () => {
  it('delete handler exists and requires requireFounder before any DB call', () => {
    const deleteFn = FOUNDER_FN.slice(
      FOUNDER_FN.indexOf('async function handleFounderDeleteBetaInvite'),
      FOUNDER_FN.indexOf('export async function handler'),
    )
    const founderPos = deleteFn.indexOf('requireFounder(user)')
    const dbPos = deleteFn.indexOf('getServiceClient()')
    expect(founderPos).toBeGreaterThan(-1)
    expect(founderPos).toBeLessThan(dbPos)
  })

  it('client calls founder_delete_beta_invite action (RUNTIME)', async () => {
    deps.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    const result = await deleteInvite('invite-pending')
    expect(result).toEqual({ success: true })
    const [, init] = deps.fetch.mock.calls[0]
    expect(JSON.parse(init.body)).toMatchObject({ action: 'founder_delete_beta_invite', inviteId: 'invite-pending' })
    expect(init.headers.Authorization).toBe('Bearer founder-jwt')
  })
})

// ── D. Deleting pending invite removes the token path ────────────────────────

describe('D — pending delete uses hard DELETE not status update (SOURCE-CONTRACT)', () => {
  it('delete handler issues a SQL DELETE, not an UPDATE to a soft-delete status', () => {
    const deleteFn = FOUNDER_FN.slice(
      FOUNDER_FN.indexOf('async function handleFounderDeleteBetaInvite'),
      FOUNDER_FN.indexOf('export async function handler'),
    )
    expect(deleteFn).toContain('.delete()')
    // Must not convert to 'revoked' or 'expired' — that would leave the row
    expect(deleteFn).not.toMatch(/update\s*\(\s*\{\s*status\s*:\s*['"]/)
  })
})

// ── E. Founder can delete an expired invite ───────────────────────────────────

describe('E — expired invites can be deleted (SOURCE-CONTRACT)', () => {
  it('neq guard excludes only accepted rows, allowing expired (pending-in-db) deletion', () => {
    const deleteFn = FOUNDER_FN.slice(
      FOUNDER_FN.indexOf('async function handleFounderDeleteBetaInvite'),
      FOUNDER_FN.indexOf('export async function handler'),
    )
    expect(deleteFn).toContain(".neq('status', 'accepted')")
    // No extra .eq('status', 'expired') — expired rows have status='pending' in DB
    expect(deleteFn).not.toContain(".eq('status', 'expired')")
  })
})

// ── F. Founder can delete a revoked invite ────────────────────────────────────

describe('F — revoked invites can be deleted (SOURCE-CONTRACT)', () => {
  it('neq(status, accepted) allows deletion of rows with status=revoked', () => {
    const deleteFn = FOUNDER_FN.slice(
      FOUNDER_FN.indexOf('async function handleFounderDeleteBetaInvite'),
      FOUNDER_FN.indexOf('export async function handler'),
    )
    // Only 'accepted' is blocked — 'revoked' passes the neq condition
    expect(deleteFn).toContain(".neq('status', 'accepted')")
    // There is no .neq('status', 'revoked') anywhere
    expect(deleteFn).not.toContain(".neq('status', 'revoked')")
  })
})

// ── G. Accepted invite cannot be deleted ─────────────────────────────────────

describe('G — accepted invite cannot be deleted (SOURCE-CONTRACT)', () => {
  it('pre-flight load check explicitly rejects accepted status', () => {
    const deleteFn = FOUNDER_FN.slice(
      FOUNDER_FN.indexOf('async function handleFounderDeleteBetaInvite'),
      FOUNDER_FN.indexOf('export async function handler'),
    )
    expect(deleteFn).toContain("invite.status === 'accepted'")
    expect(deleteFn).toContain("'invite_not_deletable'")
  })

  it('client surfaces invite_not_deletable as an error (RUNTIME)', async () => {
    deps.fetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'invite_not_deletable' }),
    })
    const result = await deleteInvite('invite-accepted')
    expect(result).toMatchObject({ success: false, error: 'invite_not_deletable' })
  })
})

// ── H. Non-founder revoke returns 403 ────────────────────────────────────────

describe('H — non-founder revoke is rejected (SOURCE-CONTRACT)', () => {
  it('revoke handler calls requireFounder before any operation', () => {
    const revokeFn = FOUNDER_FN.slice(
      FOUNDER_FN.indexOf('async function handleFounderRevokeBetaInvite'),
      FOUNDER_FN.indexOf('async function handleFounderDeleteBetaInvite'),
    )
    expect(revokeFn.indexOf('requireFounder(user)')).toBeLessThan(revokeFn.indexOf('.from('))
  })
})

// ── I. Non-founder delete returns 403 ────────────────────────────────────────

describe('I — non-founder delete is rejected (SOURCE-CONTRACT)', () => {
  it('delete handler calls requireFounder before any operation', () => {
    const deleteFn = FOUNDER_FN.slice(
      FOUNDER_FN.indexOf('async function handleFounderDeleteBetaInvite'),
      FOUNDER_FN.indexOf('export async function handler'),
    )
    expect(deleteFn.indexOf('requireFounder(user)')).toBeLessThan(deleteFn.indexOf('.from('))
  })

  it('action is registered in the handler dispatch (SOURCE-CONTRACT)', () => {
    const dispatchSection = FOUNDER_FN.slice(FOUNDER_FN.indexOf("export async function handler"))
    expect(dispatchSection).toContain("'founder_delete_beta_invite'")
    expect(dispatchSection).toContain('handleFounderDeleteBetaInvite')
  })
})

// ── J. Accepted account data is untouched by non-accepted invite deletion ─────

describe('J — accepted account data survives non-accepted invite deletion (RUNTIME + SOURCE-CONTRACT)', () => {
  it('buildFounderContractorAdminReport preserves accepted invite + linked org after other rows removed', () => {
    const report = buildFounderContractorAdminReport({
      organizations: [
        { id: 'org-a', owner_id: 'user-a', name: 'Sunrise Electric', created_at: '2026-01-01T00:00:00Z', settings: {} },
      ],
      profiles: [{ id: 'user-a', org_id: 'org-a', full_name: 'Alice Owner', is_active: true }],
      invites: [
        // accepted invite stays
        {
          id: 'invite-accepted',
          email: 'alice@sunrise.test',
          industry: 'Electrical',
          status: 'accepted',
          invited_at: '2026-01-01T00:00:00Z',
          accepted_at: '2026-01-02T00:00:00Z',
          expires_at: '2026-01-08T00:00:00Z',
          accepted_user_id: 'user-a',
          organization_id: 'org-a',
        },
        // pending invite removed (simulated by not including it)
      ],
      agreements: [],
      authUsers: [{ id: 'user-a', email: 'alice@sunrise.test', created_at: '2026-01-01T00:00:00Z' }],
    })

    // Accepted invite still in the report
    const inv = report.contractorBetaInvites.find((i: any) => i.id === 'invite-accepted')
    expect(inv).toBeDefined()
    expect(inv?.status).toBe('accepted')
    expect(inv?.organizationId).toBe('org-a')

    // Contractor account still exists
    const acct = report.contractorAccounts.find((a: any) => a.organizationId === 'org-a')
    expect(acct).toBeDefined()
    expect(acct?.ownerEmail).toBe('alice@sunrise.test')
  })

  it('delete handler only touches the beta_invites table (SOURCE-CONTRACT)', () => {
    const deleteFn = FOUNDER_FN.slice(
      FOUNDER_FN.indexOf('async function handleFounderDeleteBetaInvite'),
      FOUNDER_FN.indexOf('export async function handler'),
    )
    // Only reads from beta_invites
    const fromCalls = [...deleteFn.matchAll(/\.from\('([^']+)'\)/g)].map(m => m[1])
    expect(fromCalls.every((t: string) => t === 'beta_invites')).toBe(true)
    // Never touches organizations, profiles, auth tables
    expect(deleteFn).not.toContain('.from(\'organizations\')')
    expect(deleteFn).not.toContain('.from(\'profiles\')')
    expect(deleteFn).not.toContain('.from(\'auth')
  })
})

// ── K. UI exposes correct actions per invite status ───────────────────────────

describe('K — UI actions per invite status (SOURCE-CONTRACT)', () => {
  it('pending invites have both Revoke and Delete buttons', () => {
    // Revoke button only rendered when status === pending
    expect(FOUNDER_SURFACE).toContain("invite.status === 'pending'")
    expect(FOUNDER_SURFACE).toContain('Revoke')
    // Delete button rendered for non-accepted invites
    expect(FOUNDER_SURFACE).toContain('Delete')
    expect(FOUNDER_SURFACE).toContain("handleDelete(invite.id, invite.status)")
  })

  it('accepted invites show no destructive controls', () => {
    // The accepted guard renders '—' and never a Revoke/Delete button for accepted
    expect(FOUNDER_SURFACE).toContain("invite.status === 'accepted' ? '—'")
  })

  it('expired and revoked invites show Delete (not Revoke) — Revoke is inside pending-only gate', () => {
    // The pending gate in JSX: {invite.status === 'pending' && (<button ...handleRevoke.../>)}
    // then Delete button is a sibling (outside that gate) — handleDelete appears after handleRevoke in JSX
    const pendingGatePos = FOUNDER_SURFACE.indexOf("invite.status === 'pending' && (")
    expect(pendingGatePos).toBeGreaterThan(-1)

    // handleRevoke(invite.id) call is INSIDE the pending gate
    const revokeCallPos = FOUNDER_SURFACE.indexOf('handleRevoke(invite.id)', pendingGatePos)
    expect(revokeCallPos).toBeGreaterThan(pendingGatePos)

    // handleDelete(invite.id, invite.status) call is a sibling AFTER the revoke call
    const deleteCallPos = FOUNDER_SURFACE.indexOf('handleDelete(invite.id, invite.status)', revokeCallPos)
    expect(deleteCallPos).toBeGreaterThan(revokeCallPos)
  })

  it('pending delete confirmation includes the required warning text', () => {
    expect(FOUNDER_SURFACE).toContain(
      'Deleting this pending invitation will immediately invalidate its invite link and remove it from the invitation list.',
    )
  })

  it('revoke confirmation warns the invite will be unusable', () => {
    expect(FOUNDER_SURFACE).toContain(
      'This invitation will no longer be usable. Revoke it?',
    )
  })
})

// ── GUARDIAN-3A1 — effective-pending revoke guard ─────────────────────────────

describe('GUARDIAN-3A1 — effective-pending expires_at guard on revoke', () => {
  it('server handler requires expires_at > now in addition to status=pending (SOURCE-CONTRACT)', () => {
    const revokeFn = FOUNDER_FN.slice(
      FOUNDER_FN.indexOf('async function handleFounderRevokeBetaInvite'),
      FOUNDER_FN.indexOf('async function handleFounderDeleteBetaInvite'),
    )
    expect(revokeFn).toContain(".eq('status', 'pending')")
    expect(revokeFn).toContain(".gt('expires_at',")
    // Guard order: status filter then expires_at filter (both in the same update chain)
    expect(revokeFn.indexOf(".eq('status', 'pending')")).toBeLessThan(
      revokeFn.indexOf(".gt('expires_at',"),
    )
  })

  it('1. effective pending (future expires_at) — revoke succeeds (RUNTIME)', async () => {
    deps.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    const result = await revokeInvite('invite-effective-pending')
    expect(result).toEqual({ success: true })
  })

  it('2. expired pending row (past expires_at) — invite_not_revokable (RUNTIME)', async () => {
    deps.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'invite_not_revokable' }) })
    const result = await revokeInvite('invite-expired-pending')
    expect(result).toMatchObject({ success: false, error: 'invite_not_revokable' })
  })

  it('3. accepted — still invite_not_revokable (RUNTIME)', async () => {
    deps.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'invite_not_revokable' }) })
    const result = await revokeInvite('invite-accepted')
    expect(result).toMatchObject({ success: false, error: 'invite_not_revokable' })
  })

  it('4. revoked — still invite_not_revokable (RUNTIME)', async () => {
    deps.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'invite_not_revokable' }) })
    const result = await revokeInvite('invite-revoked')
    expect(result).toMatchObject({ success: false, error: 'invite_not_revokable' })
  })
})
