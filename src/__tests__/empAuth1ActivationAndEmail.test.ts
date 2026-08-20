/**
 * EMP-AUTH-1 + ROLE-2.4 — activation flow, NDA separation, invite reuse & email.
 *
 * MIXED test file. Each describe block is labelled:
 *   (RUNTIME)         — executes real code paths.
 *   (SOURCE-CONTRACT) — asserts on source text only. These verify wiring/shape;
 *                       they are NOT proof of runtime behaviour. Component-level
 *                       runtime (React Testing Library / jsdom) is not available
 *                       in this repo, and true end-to-end activation additionally
 *                       requires a real inbox + fresh-user signup (owner-only).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = join(TEST_DIR, '../..')
const SRC = join(ROOT, 'src')
const FN = join(ROOT, 'netlify/functions')

const read = (p: string) => readFileSync(p, 'utf8')
const INVITE_ACCEPT = read(join(SRC, 'components/employee/EmployeeInviteAccept.tsx'))
const AUTH_STORE = read(join(SRC, 'store/authStore.ts'))
const APP_SHELL = read(join(SRC, 'components/layout/AppShell.tsx'))
const EMP_LOGIN = read(join(SRC, 'components/employee/EmployeeLogin.tsx'))
const SEND_FN = read(join(FN, 'sendEmployeeInvite.ts'))
const RESEND_FN = read(join(FN, 'resendEmployeeInvite.ts'))
const TEAM = read(join(SRC, 'components/v15r/V15rTeamPanel.tsx'))
const EMP_ROUTES = read(join(SRC, 'lib/employeeRoutes.ts'))

// ── RUNTIME: invite service passes backupEmployeeId through to the function ────

const fetchMock = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok-123' } } }) },
    rpc: () => ({}),
  },
}))

import { sendEmployeeInvite } from '@/services/employeeInviteService'

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true, inviteId: 'pp-1', email: 'x@y.com', reused: true }),
  })
  ;(global as any).fetch = fetchMock
})

describe('EMP-AUTH-1 invite service (RUNTIME)', () => {
  it('forwards backupEmployeeId in the POST body so the server can reuse/link the profile', async () => {
    const res = await sendEmployeeInvite({
      displayName: 'Bob',
      email: 'bob@x.com',
      backupEmployeeId: 'emp-42',
    })
    expect(res.success).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.backupEmployeeId).toBe('emp-42')
    expect(body.displayName).toBe('Bob')
  })

  it('omits backupEmployeeId when not provided (plain invite path)', async () => {
    await sendEmployeeInvite({ displayName: 'Ann', email: 'ann@x.com' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect('backupEmployeeId' in body).toBe(false)
  })
})

// ── SOURCE-CONTRACT: activation owns the flow ─────────────────────────────────

describe('EMP-AUTH-1 EmployeeInviteAccept (SOURCE-CONTRACT)', () => {
  it('awaits a fresh initialize() before routing (no fire-and-forget)', () => {
    expect(INVITE_ACCEPT).toMatch(/await useAuthStore\.getState\(\)\.initialize\(\)/)
    expect(INVITE_ACCEPT).not.toMatch(/void useAuthStore\.getState\(\)\.initialize\(\)/)
  })
  it('routes via the shared Employee Portal helper (no ambiguous inline navigate)', () => {
    expect(INVITE_ACCEPT).toContain("from '@/lib/employeeRoutes'")
    expect(INVITE_ACCEPT).toContain('goToEmployeePortal(navigate)')
    expect(INVITE_ACCEPT).not.toMatch(/navigate\(\s*['"]\/['"]/) // no bare navigate('/')
  })
  it('auto-accepts once a matching authenticated session exists', () => {
    expect(INVITE_ACCEPT).toContain('autoAcceptTriedRef')
    expect(INVITE_ACCEPT).toContain('acceptInFlightRef') // idempotent guard
  })
  it('removes the generic Continue → "/" hand-off', () => {
    expect(INVITE_ACCEPT).not.toMatch(/<Link\s+to="\/"[^>]*>\s*Continue/)
  })
})

describe('EMP-AUTH-1A owner-fallback removal (SOURCE-CONTRACT)', () => {
  it('resolveUserRole reports an explicit resolution status and never fabricates owner on failure', () => {
    expect(AUTH_STORE).toMatch(/status\?:\s*'resolved'\s*\|\s*'unresolved'/)
    expect(AUTH_STORE).toContain("status: 'unresolved'")
    // A clean owner is only concluded when BOTH lookups completed (no failure).
    expect(AUTH_STORE).toMatch(/if \(crew\.failed \|\| emp\.failed\) return \{ resolved: null, failed: true \}/)
  })

  it('initialize resolves identity directly and never converts a timeout into owner', () => {
    // The portal-role gate now calls resolveUserRole directly (no 5s owner-fallback
    // wrapper). Unresolved identity enters a safe resolving/retry state instead.
    expect(AUTH_STORE).toContain('const portalRole = await resolveUserRole(user.id)')
    expect(AUTH_STORE).toContain("portalRole.status === 'unresolved'")
    expect(AUTH_STORE).toContain('scheduleIdentityReinit()')
    expect(AUTH_STORE).toContain('MAX_IDENTITY_RETRIES')
    // The portal-role gate must not be wrapped in a withTimeout owner fallback.
    const gateIdx = AUTH_STORE.indexOf('// 4b. Portal role gate')
    const gateSegment = AUTH_STORE.slice(gateIdx, gateIdx + 900)
    expect(gateSegment).not.toMatch(/withTimeout\([\s\S]*role:\s*'owner'/)
  })
})

describe('EMP-AUTH-1A explicit Employee Portal route (SOURCE-CONTRACT)', () => {
  it('a single shared module names the route and helper', () => {
    expect(EMP_ROUTES).toMatch(/export const EMPLOYEE_PORTAL_ROUTE = '\/'/)
    expect(EMP_ROUTES).toContain('export function goToEmployeePortal')
  })
  it('activation and normal login both use the shared helper', () => {
    expect(INVITE_ACCEPT).toContain('goToEmployeePortal(navigate)')
    expect(EMP_LOGIN).toContain('goToEmployeePortal(navigate)')
    expect(EMP_LOGIN).not.toMatch(/navigate\(\s*['"]\/['"]/)
  })
})

describe('EMP-AUTH-1 authStore reentrancy guard (SOURCE-CONTRACT)', () => {
  it('guards initialize() commits behind a sequence so a stale owner resolve cannot win', () => {
    expect(AUTH_STORE).toContain('let _initSeq = 0')
    expect(AUTH_STORE).toMatch(/const seq = \+\+_initSeq/)
    expect(AUTH_STORE).toMatch(/if \(seq === _initSeq\) set\(partial\)/)
    // the owner-onboarding entry (PIN setup) is committed via the guarded apply()
    expect(AUTH_STORE).toMatch(/apply\(\{ status: 'needs_passcode_setup', user, profile \}\)/)
  })
})

describe('EMP-AUTH-1 NDA separation (SOURCE-CONTRACT)', () => {
  it('AppShell never evaluates the NDA for a confirmed employee/crew identity', () => {
    expect(APP_SHELL).toMatch(/authRole === 'employee' \|\| authRole === 'crew'/)
  })
  it('the only NDA gate remains AppShell (owner surface) — activation/login never invoke NDA machinery', () => {
    expect(INVITE_ACCEPT).not.toMatch(/NDASigningFlow|hasUserSignedNDA|signed_agreements/)
    expect(EMP_LOGIN).not.toMatch(/NDASigningFlow|hasUserSignedNDA|signed_agreements/)
  })
})

describe('EMP-AUTH-1 employee sign-in routing (SOURCE-CONTRACT)', () => {
  it('EmployeeLogin awaits initialize then routes by the resolved role', () => {
    expect(EMP_LOGIN).toMatch(/await useAuthStore\.getState\(\)\.initialize\(\)/)
    expect(EMP_LOGIN).toMatch(/getState\(\)\.role/)
    expect(EMP_LOGIN).toMatch(/inactive/i)   // disabled-account message
    expect(EMP_LOGIN).toMatch(/resend your invitation/i) // pending message
  })
})

// ── SOURCE-CONTRACT: invite reuse / duplicate prevention + email copy ─────────

describe('ROLE-2.4 invite reuse & duplicate prevention (SOURCE-CONTRACT)', () => {
  it('server reuses an existing profile by backup_employee_id instead of inserting', () => {
    expect(SEND_FN).toContain('supabaseSelectByBackupId')
    expect(SEND_FN).toContain('supabaseSelectByEmail')
    expect(SEND_FN).toContain('chooseEmailReuseCandidate')
    expect(SEND_FN).toMatch(/reuse.*backup_employee_id/i)
    expect(SEND_FN).toContain('linkedExistingAccount')
    // new inserts carry the backup link so they are unified from creation
    expect(SEND_FN).toMatch(/backup_employee_id: backupEmployeeId/)
  })
  it('Team panel passes the Cost Model employee context into the invite modal', () => {
    expect(TEAM).toContain('setInviteModalEmployee')
    expect(TEAM).toMatch(/backupEmployeeId: inviteModalEmployee\.backupEmployeeId/)
    // name-based auto-link removed
    expect(TEAM).not.toMatch(/portalProfileMap\.get\(`name:/)
  })
})

describe('ROLE-2.4 employee invite email copy (SOURCE-CONTRACT)', () => {
  for (const [label, src] of [['send', SEND_FN], ['resend', RESEND_FN]] as const) {
    it(`${label} email states an Employee Account, offers a portal sign-in link, mentions expiry, and has no NDA/contractor language`, () => {
      expect(src).toContain('Power On Solutions Employee Account')
      expect(src).toContain('/employee/login')       // future sign-in link
      expect(src).toMatch(/expires in 7 days/i)       // expiration guidance
      expect(src).toMatch(/contact your employer/i)   // support guidance
      // No contractor NDA / agreement language in the employee email body.
      expect(src).not.toMatch(/\bNDA\b/i)
      expect(src).not.toMatch(/non-disclosure/i)
      expect(src).not.toMatch(/contractor agreement/i)
    })
  }
})
