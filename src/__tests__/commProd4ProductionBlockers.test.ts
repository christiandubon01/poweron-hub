/**
 * COMM-PROD-4 focused regression coverage.
 *
 * RUNTIME blocks execute pure/state-machine behavior. SOURCE-CONTRACT blocks
 * verify UI/server wiring where this repository has no component DOM harness.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  isPasswordRecoveryLocation,
  passwordRecoveryRedirectUrl,
  validateNewPassword,
} from '@/lib/auth/passwordRecovery'
import {
  buildFounderContractorAdminReport,
  isFounderUser,
  requireFounder,
} from '../../netlify/functions/pilot-telemetry'

const ROOT = process.cwd()
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const LOGIN = read('src/components/auth/LoginFlow.tsx')
const AUTH = read('src/store/authStore.ts')
const INITIAL_SETUP = read('src/components/auth/InitialSetupFlow.tsx')
const PASSCODE = read('src/lib/auth/passcode.ts')
const EMPLOYEE_INVITE = read('src/components/employee/EmployeeInviteAccept.tsx')
const APP_SHELL = read('src/components/layout/AppShell.tsx')
const NDA = read('src/services/ndaService.ts')
const NDA_AUTHORITY = read('src/services/ndaAuthority.ts')
const GUARDIAN = read('src/views/GuardianView.tsx')
const FOUNDER_SURFACE = read('src/components/guardian/FounderContractorAdminSurface.tsx')
const FOUNDER_FN = read('netlify/functions/pilot-telemetry.ts')
const SEND_INVITE_FN = read('netlify/functions/sendInvite.ts')
const MIGRATION = read('supabase/migrations/119_founder_contractor_admin_and_beta_invite_security.sql')
const NDA_MIGRATION = read('supabase/migrations/121_nda_access_authority.sql')
const APP = read('src/App.tsx')

describe('COMM-PROD-4 password recovery (RUNTIME)', () => {
  it('distinguishes recovery callbacks from normal signup confirmation', () => {
    expect(isPasswordRecoveryLocation({ pathname: '/auth/reset-password', search: '?code=pkce', hash: '' })).toBe(true)
    expect(isPasswordRecoveryLocation({ pathname: '/', search: '', hash: '#access_token=x&type=recovery' })).toBe(true)
    expect(isPasswordRecoveryLocation({ pathname: '/', search: '?verified=true', hash: '' })).toBe(false)
    expect(passwordRecoveryRedirectUrl('https://hub.example/')).toBe('https://hub.example/auth/reset-password')
  })

  it('requires both password values and rejects weak or mismatched values', () => {
    expect(validateNewPassword('', '')).toMatch(/required/i)
    expect(validateNewPassword('short', 'short')).toMatch(/at least 8/i)
    expect(validateNewPassword('strong-pass', 'different-pass')).toMatch(/do not match/i)
    expect(validateNewPassword('strong-pass', 'strong-pass')).toBeNull()
  })
})

describe('COMM-PROD-4 password recovery UI (SOURCE-CONTRACT)', () => {
  it('updates Supabase, clears recovery state, and exits to normal signed-out auth', () => {
    expect(LOGIN).toContain('placeholder="New password (min 8 chars)"')
    expect(LOGIN).toContain('placeholder="Confirm password"')
    expect(LOGIN).toContain('supabase.auth.updateUser({ password })')
    expect(LOGIN).toMatch(/clearPasswordRecoveryIntent\(\)[\s\S]{0,100}await signOut\(\)/)
    expect(LOGIN).toContain("case 'password_recovery':")
  })
})

describe('COMM-PROD-4 owner bootstrap and PIN boundary (SOURCE-CONTRACT)', () => {
  it('holds the shell until PIN, tenant bootstrap, and organization identity resolve', () => {
    expect(AUTH).toContain("apply({ status: 'needs_passcode_setup', user, profile })")
    expect(AUTH).toContain("status: 'hydrating_user_data'")
    expect(AUTH).toContain('await loadOrganizationIdentity(organizationId)')
    expect(AUTH.indexOf('await loadOrganizationIdentity(organizationId)')).toBeLessThan(AUTH.indexOf('markTenantDataReady(userId)'))
    expect(LOGIN.indexOf("case 'hydrating_user_data':")).toBeLessThan(LOGIN.indexOf("case 'authenticated':"))
  })

  it('requires server PIN readback before owner session establishment', () => {
    expect(INITIAL_SETUP).toContain('const result = await setPasscode(user.id, pin)')
    expect(PASSCODE).toContain(".select('id, passcode_hash')")
    expect(PASSCODE).toContain('passcode_hash !== hash')
    expect(AUTH).toContain(".select('id, org_id, full_name, role, is_active, passcode_hash')")
    expect(AUTH).toContain("!refreshed?.id || !refreshed?.org_id || !refreshed?.passcode_hash")
    expect(AUTH).toContain('Passcode readback did not confirm the saved profile')
  })
})

describe('COMM-PROD-4 employee context and branding (SOURCE-CONTRACT)', () => {
  it('establishes employee intent before authentication and retains it for acceptance', () => {
    const intent = EMPLOYEE_INVITE.indexOf("setPreferredPortalContext('employee')")
    const authSession = EMPLOYEE_INVITE.indexOf('supabase.auth.getSession()')
    expect(intent).toBeGreaterThan(-1)
    expect(intent).toBeLessThan(authSession)
    const authFlow = EMPLOYEE_INVITE.slice(EMPLOYEE_INVITE.indexOf('async function handleAuth'), EMPLOYEE_INVITE.indexOf('async function handleResetPassword'))
    expect(authFlow.indexOf("setPreferredPortalContext('employee')")).toBeLessThan(authFlow.indexOf('signInWithPassword'))
    const acceptFlow = EMPLOYEE_INVITE.slice(EMPLOYEE_INVITE.indexOf('const handleAccept'), EMPLOYEE_INVITE.indexOf('// â”€â”€ Auto-accept'))
    expect(acceptFlow.indexOf('acceptEmployeeInvite(token)')).toBeLessThan(acceptFlow.indexOf("setPreferredPortalContext('employee')"))
    expect(acceptFlow).toContain('await useAuthStore.getState().initialize()')
  })

  it('keeps employee and owner organization hydration separated', () => {
    expect(AUTH).toContain("if (role === 'employee')")
    expect(AUTH).toContain('clearActiveTenantUser()')
    expect(AUTH).toContain("const activeOrgId = role === 'employee' ? employerOrgId : profile.org_id")
    expect(AUTH).toContain('appSession.orgId !== activeOrgId || appSession.role !== role')
  })

  it('clears session-scoped tenant and role artifacts on logout before another account hydrates', () => {
    expect(AUTH).toContain('resetSessionScopedBackupClientState()')
    expect(AUTH).toContain('clearPersistedPortalRoleState()')
    expect(AUTH).toContain('clearPreferredPortalContext()')
    expect(AUTH).toContain("sessionStorage.removeItem('poweron_password_authed')")
  })

  it('uses employer or product branding without Customer Zero leakage', () => {
    expect(EMPLOYEE_INVITE).not.toContain('Power On Solutions')
    expect(EMPLOYEE_INVITE).toContain("invite?.org_name || 'PowerOn Hub'")
    expect(EMPLOYEE_INVITE).toContain('PowerOn Hub Employee Portal')
  })
})

describe('COMM-PROD-4 founder report (RUNTIME)', () => {
  const report = buildFounderContractorAdminReport({
    organizations: [{
      id: 'org-new', owner_id: 'owner-new', name: 'WestCoast Lighting',
      created_at: '2026-08-13T10:00:00Z', settings: { onboarding: { complete: true }, pilot: { classification: 'design_partner' } },
    }],
    profiles: [{ id: 'owner-new', org_id: 'org-new', full_name: 'New Owner', is_active: true }],
    invites: [{
      id: 'invite-new', email: 'owner@westcoast.test', industry: 'Electrical', status: 'accepted',
      invited_at: '2026-08-12T10:00:00Z', accepted_at: '2026-08-13T09:00:00Z', expires_at: '2026-08-19T10:00:00Z',
      accepted_user_id: 'owner-new', organization_id: 'org-new',
    }],
    agreements: [{
      id: 'nda-new', user_id: 'owner-new', typed_name: 'New Owner', email: 'owner@westcoast.test',
      agreement_type: 'nda_beta_v1', signed_at: '2026-08-13T09:30:00Z', created_at: '2026-08-13T09:30:01Z',
      signature_image: 'data:image/png;base64,current-signature', pdf_url: 'nda.pdf',
    }],
    authUsers: [{ id: 'owner-new', email: 'owner@westcoast.test', created_at: '2026-08-13T08:00:00Z', last_sign_in_at: '2026-08-13T12:00:00Z' }],
  }, Date.parse('2026-08-13T12:00:00Z'))

  it('includes the current beta invite and links it to its resulting organization', () => {
    expect(report.contractorBetaInvites).toContainEqual(expect.objectContaining({
      id: 'invite-new', status: 'accepted', organizationId: 'org-new', organizationName: 'WestCoast Lighting',
    }))
  })

  it('includes the accepted contractor organization/account', () => {
    expect(report.contractorAccounts).toContainEqual(expect.objectContaining({
      organizationId: 'org-new', ownerEmail: 'owner@westcoast.test', agreementStatus: 'signed', ndaState: 'SIGNED_CURRENT', accountStatus: 'active',
    }))
  })

  it('includes the newly signed agreement with signer and organization', () => {
    expect(report.signedAgreements).toContainEqual(expect.objectContaining({
      id: 'nda-new', signer: 'New Owner', organizationId: 'org-new', ndaState: 'SIGNED_CURRENT', hasPdf: true,
    }))
  })
})

describe('COMM-PROD-4 founder security and persistence', () => {
  it('recognizes only the configured founder identity (RUNTIME)', () => {
    expect(isFounderUser({ email: 'Founder@Example.com' }, 'founder@example.com')).toBe(true)
    expect(isFounderUser({ email: 'owner@example.com' }, 'founder@example.com')).toBe(false)
    expect(isFounderUser({ email: 'employee@example.com' }, 'founder@example.com')).toBe(false)
    expect(isFounderUser({ email: 'founder@example.com' }, '')).toBe(false)
    expect(requireFounder({ email: 'founder@example.com' }, 'founder@example.com')).toBeNull()
    expect(requireFounder({ email: 'owner@example.com' }, 'founder@example.com')).toMatchObject({ statusCode: 403 })
    expect(requireFounder({ email: 'employee@example.com' }, 'founder@example.com')).toMatchObject({ statusCode: 403 })
  })

  it('guards service-role reads before creating the privileged query client (SOURCE-CONTRACT)', () => {
    const start = FOUNDER_FN.indexOf('async function handleFounderContractorAdmin')
    const end = FOUNDER_FN.indexOf('async function handleFounderRevokeBetaInvite')
    const handler = FOUNDER_FN.slice(start, end)
    expect(handler.indexOf('requireFounder(user)')).toBeLessThan(handler.indexOf('getServiceClient()'))
    expect(FOUNDER_SURFACE).toContain('fetchFounderContractorAdminReport')
    expect(FOUNDER_SURFACE).not.toMatch(/\.from\(['"](?:organizations|beta_invites|signed_agreements)/)
    expect(SEND_INVITE_FN).toContain('Founder access required')
  })

  it('makes NDA access fail closed and records a real server row before caching (SOURCE-CONTRACT)', () => {
    const insert = NDA.indexOf(".from('signed_agreements')")
    const cache = NDA.indexOf('setNdaCacheAccepted(finalUserId)', insert)
    expect(insert).toBeGreaterThan(-1)
    expect(cache).toBeGreaterThan(insert)
    expect(NDA).toContain("throw new Error(error?.message || 'Signed agreement insert returned no row')")
    expect(NDA).toContain("export const SIGNED_NDA_READ_SELECT = '*'")
    expect(NDA).toContain('export class NDAAuthorityUnavailableError extends Error')
    expect(NDA).toContain("this.code = 'NDA_AUTHORITY_SCHEMA_UNAVAILABLE'")
    expect(NDA).toContain('throw new NDAAuthorityUnavailableError(')
    expect(NDA).toContain('export async function getCanonicalNDAStatus')
    expect(NDA).toContain('resolveNDAStatus')
    expect(NDA).toContain('export async function hasNDAAccess')
    expect(NDA).toContain('Error checking authoritative NDA status; keeping gate closed')
    expect(NDA).not.toContain("'pin_verified',")
    expect(NDA).not.toContain("'verification_timestamp',")
    expect(NDA).not.toContain("'revoked',")
    expect(APP_SHELL).toContain('hasNDAAccess(profile.id)')
    expect(APP_SHELL).toContain('NDA authority unavailable')
    expect(APP_SHELL).toContain('Checking NDA access')
  })

  it('uses token-scoped invite RPCs and removes anonymous table enumeration (SOURCE-CONTRACT)', () => {
    expect(MIGRATION).toContain('DROP POLICY IF EXISTS "anon_token_lookup"')
    expect(MIGRATION).toContain('FUNCTION public.validate_beta_invite')
    expect(MIGRATION).toContain('FUNCTION public.accept_beta_invite')
    expect(MIGRATION).toContain('accepted_user_id')
    expect(MIGRATION).toContain('organization_id')
    expect(NDA_MIGRATION).toContain('CREATE TABLE IF NOT EXISTS public.nda_access_authority')
    expect(NDA_MIGRATION).toContain('FROM public.organizations o')
    expect(NDA_MIGRATION).toContain('JOIN public.profiles p')
    expect(NDA_MIGRATION).toContain('FROM public.signed_agreements sa')
    expect(NDA_MIGRATION).toContain('INSERT INTO public.nda_access_authority')
    expect(NDA_MIGRATION).toContain("'GRANDFATHERED_LEGACY_ACCESS'")
    expect(NDA_MIGRATION).toContain("'REVOKED'")
    expect(NDA_MIGRATION).toContain("'legacy_owner_access_compatibility'")
    expect(NDA_MIGRATION).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
    expect(NDA_MIGRATION).not.toContain('INSERT INTO public.signed_agreements')
    expect(NDA_MIGRATION).not.toContain('UPDATE public.signed_agreements')
    expect(NDA_MIGRATION).not.toContain('pre_2026_08_14_owner_account_without_server_agreement')
    expect(NDA_MIGRATION).not.toContain('au.last_sign_in_at IS NOT NULL')
  })

  it('keeps runtime NDA resolution free of account-specific identities and age heuristics (SOURCE-CONTRACT)', () => {
    const resolverBody = NDA_AUTHORITY.slice(NDA_AUTHORITY.indexOf('export function resolveNDAStatus'))
    expect(NDA).not.toContain('themarmelow17@gmail.com')
    expect(NDA_AUTHORITY).not.toContain('themarmelow17@gmail.com')
    expect(NDA_AUTHORITY).not.toContain('Christian Dubon')
    expect(resolverBody).not.toContain('authCreatedAt')
    expect(resolverBody).not.toContain('lastSignInAt')
    expect(resolverBody).not.toContain('profileCreatedAt')
    expect(resolverBody).not.toContain('organizationCreatedAt')
  })
})

describe('COMM-PROD-4 Guardian structure and preserved crew routing (SOURCE-CONTRACT)', () => {
  it('separates accounts, beta invites, and agreements in Guardian', () => {
    expect(GUARDIAN).toContain("id: 'contractor-accounts', label: 'Contractor Accounts'")
    expect(GUARDIAN).toContain("id: 'beta-invites', label: 'Contractor Beta Invites'")
    expect(GUARDIAN).toContain("id: 'signed-ndas',  label: 'Signed NDAs / Agreements'")
  })

  it('preserves the existing Crew Portal role branch', () => {
    expect(APP).toMatch(/case 'crew':[\s\S]{0,180}<CrewPortal \/>/)
  })
})
