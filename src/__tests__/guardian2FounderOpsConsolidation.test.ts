import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildFounderContractorAdminReport,
  buildFounderPilotRecentActivity,
  requireFounder,
} from '../../netlify/functions/pilot-telemetry'
import {
  describeAgreementArtifactState,
} from '@/components/guardian/FounderContractorAdminSurface'
import {
  buildSupportOrganizationOptions,
  reconcileSelectedOrganizationId,
} from '@/components/guardian/FounderPilotOperationsSurface'

const ROOT = process.cwd()
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const GUARDIAN = read('src/views/GuardianView.tsx')
const AGREEMENTS_SURFACE = read('src/components/guardian/FounderContractorAdminSurface.tsx')
const PILOT_SURFACE = read('src/components/guardian/FounderPilotOperationsSurface.tsx')
const ADMIN_TOOLS = read('src/views/AdminToolsView.tsx')
const FOUNDER_SERVICE = read('src/services/founderContractorAdminService.ts')
const FOUNDER_FN = read('netlify/functions/pilot-telemetry.ts')
const MIGRATIONS = readdirSync(join(ROOT, 'supabase/migrations'))

function agreementById(report: ReturnType<typeof buildFounderContractorAdminReport>, id: string) {
  const agreement = report.signedAgreements.find((entry) => entry.id === id)
  expect(agreement).toBeTruthy()
  return agreement!
}

describe('GUARDIAN-2 founder operations consolidation (SOURCE-CONTRACT)', () => {
  it('adds Guardian tabs for pilot activity and support while preserving the founder account surfaces', () => {
    expect(GUARDIAN).toContain("id: 'contractor-accounts', label: 'Contractor Accounts'")
    expect(GUARDIAN).toContain("id: 'beta-invites', label: 'Contractor Beta Invites'")
    expect(GUARDIAN).toContain("id: 'signed-ndas',  label: 'Signed NDAs / Agreements'")
    expect(GUARDIAN).toContain("id: 'pilot-activity', label: 'Pilot Activity'")
    expect(GUARDIAN).toContain("id: 'support', label: 'Support'")
    expect(GUARDIAN).toContain('<FounderPilotOperationsSurface section="activity" />')
    expect(GUARDIAN).toContain('<FounderPilotOperationsSurface section="support" />')
  })

  it('uses founder-only artifact access for agreement quick view and download', () => {
    expect(AGREEMENTS_SURFACE).toContain('Quick View')
    expect(AGREEMENTS_SURFACE).toContain('Download')
    expect(AGREEMENTS_SURFACE).toContain('fetchFounderAgreementArtifactAccess')
    expect(AGREEMENTS_SURFACE).toContain('Agreement quick view')
    expect(AGREEMENTS_SURFACE).toContain('<iframe')
    expect(FOUNDER_SERVICE).toContain("action: 'founder_agreement_artifact'")
  })

  it('keeps pilot activity and support on the canonical server endpoints instead of direct table writes', () => {
    expect(PILOT_SURFACE).toContain('fetchFounderPilotReport')
    expect(PILOT_SURFACE).toContain('fetchFounderContractorAdminReport')
    expect(PILOT_SURFACE).toContain('setOrganizationPilotClassification')
    expect(PILOT_SURFACE).toContain('logFounderSupportIncident')
    expect(PILOT_SURFACE).toContain('supportOrganizations.map((organization) => (')
    expect(PILOT_SURFACE).not.toContain('report.allOrganizations.map((organization) => (')
    expect(PILOT_SURFACE).not.toMatch(/\.from\(['"]organizations['"]\)/)
    expect(PILOT_SURFACE).not.toMatch(/\.from\(['"]pilot_telemetry_events['"]\)/)
  })

  it('moves the duplicate Admin Tools founder editors behind a Guardian handoff message', () => {
    expect(ADMIN_TOOLS).toContain('Pilot Activity and Support now live in GUARDIAN')
    expect(ADMIN_TOOLS).toContain('const isFounder = false')
    expect(ADMIN_TOOLS).not.toContain('FounderContractorAdminSurface')
    expect(ADMIN_TOOLS).not.toContain('FounderPilotOperationsSurface')
  })

  it('keeps Guardian founder operations routed through the canonical surfaces instead of reviving legacy tab bodies', () => {
    expect(GUARDIAN).toContain('<FounderContractorAdminSurface section="invites" />')
    expect(GUARDIAN).toContain('<FounderContractorAdminSurface section="agreements" />')
    expect(GUARDIAN).not.toContain('<SignedNDAsAdminTab')
    expect(GUARDIAN).not.toContain('<BetaInvitesTab')
  })

  it('leaves login-ip history out of founder reporting and does not add migration 123+', () => {
    expect(MIGRATIONS.some((name) => name.startsWith('123_'))).toBe(false)
    expect(FOUNDER_SERVICE).not.toContain('lastLoginIp')
    expect(FOUNDER_SERVICE).not.toContain('signupIp')
    expect(FOUNDER_SERVICE).not.toContain('recentSecurityIps')
  })

  it('guards founder artifact access before creating the privileged query client', () => {
    const start = FOUNDER_FN.indexOf('async function handleFounderAgreementArtifact')
    const end = FOUNDER_FN.indexOf('async function handleFounderRevokeBetaInvite')
    const handler = FOUNDER_FN.slice(start, end)
    expect(handler.indexOf('requireFounder(user)')).toBeLessThan(handler.indexOf('getServiceClient()'))
    expect(handler).toContain(".createSignedUrl(")
    expect(handler).toContain('hasRealNDAArtifact')
  })
})

describe('GUARDIAN-2 founder operations consolidation (RUNTIME)', () => {
  it('shows real artifacts as actionable and keeps historical no-artifact states factual', () => {
    const report = buildFounderContractorAdminReport({
      organizations: [
        { id: 'org-current', owner_id: 'owner-current', name: 'Current Co', created_at: '2026-08-13T08:00:00Z', settings: {} },
        { id: 'org-legacy', owner_id: 'owner-legacy', name: 'Legacy Co', created_at: '2026-04-06T00:00:00Z', settings: {} },
        { id: 'org-grand', owner_id: 'owner-grand', name: 'Grandfather Co', created_at: '2026-01-01T00:00:00Z', settings: {} },
      ],
      profiles: [
        { id: 'owner-current', org_id: 'org-current', full_name: 'Current Owner', is_active: true, role: 'owner', created_at: '2026-08-13T08:00:00Z' },
        { id: 'owner-legacy', org_id: 'org-legacy', full_name: 'Legacy Owner', is_active: true, role: 'owner', created_at: '2026-04-06T00:00:00Z' },
        { id: 'owner-grand', org_id: 'org-grand', full_name: 'Grand Owner', is_active: true, role: 'owner', created_at: '2026-01-01T00:00:00Z' },
      ],
      invites: [],
      agreements: [
        {
          id: 'nda-current',
          user_id: 'owner-current',
          agreement_type: 'nda_beta_v1',
          signed_at: '2026-08-13T09:30:00Z',
          created_at: '2026-08-13T09:30:01Z',
          typed_name: 'Current Owner',
          email: 'current@example.test',
          signature_image: 'data:image/png;base64,current-signature',
          pdf_url: 'owner-current/nda-current.pdf',
        },
        {
          id: 'nda-legacy',
          user_id: 'owner-legacy',
          agreement_type: 'nda_beta_v1',
          signed_at: '2026-04-06T01:57:05.984Z',
          created_at: '2026-04-06T01:57:07.400095Z',
          typed_name: 'Legacy Owner',
          email: 'legacy@example.test',
          signature_image: 'data:image/png;base64,legacy-signature',
          pdf_url: 'stub-pdf-url-1775440625984',
        },
      ],
      overrides: [
        {
          user_id: 'owner-grand',
          access_state: 'GRANDFATHERED_LEGACY_ACCESS',
          source_classification: 'manual_legacy_access_review',
          reason: 'Historical accepted access',
          effective_at: '2026-08-14T00:00:00Z',
          created_at: '2026-08-14T00:00:00Z',
        },
      ],
      employeeProfiles: [],
      activityEvents: [],
      authUsers: [
        { id: 'owner-current', email: 'current@example.test', created_at: '2026-08-13T08:00:00Z', last_sign_in_at: null },
        { id: 'owner-legacy', email: 'legacy@example.test', created_at: '2026-04-06T00:00:00Z', last_sign_in_at: null },
        { id: 'owner-grand', email: 'grand@example.test', created_at: '2026-01-01T00:00:00Z', last_sign_in_at: null },
      ],
    })

    expect(agreementById(report, 'nda-current')).toMatchObject({
      hasPdf: true,
      artifactStatus: 'signed_document_on_file',
    })
    expect(describeAgreementArtifactState(agreementById(report, 'nda-current'))).toBe('Signed document on file')

    expect(agreementById(report, 'nda-legacy')).toMatchObject({
      hasPdf: false,
      artifactStatus: 'no_signed_pdf_captured',
    })
    expect(describeAgreementArtifactState(agreementById(report, 'nda-legacy'))).toBe('No signed PDF captured')

    expect(agreementById(report, 'nda-access-owner-grand')).toMatchObject({
      hasPdf: false,
      artifactStatus: 'access_grandfathered_no_signed_document',
    })
    expect(describeAgreementArtifactState(agreementById(report, 'nda-access-owner-grand'))).toBe('Access grandfathered - no signed document')
  })

  it('keeps founder recent activity org-attributed and strips customer/project/estimate/Blueprint detail', () => {
    const activity = buildFounderPilotRecentActivity({
      organizations: [
        { organizationId: 'org-a', organizationName: 'Alpha Electric', classification: 'design_partner' },
      ],
      telemetry: [
        {
          organization_id: 'org-a',
          event_name: 'founder_support_incident',
          module: 'support',
          feature: 'onboarding',
          occurred_at: '2026-08-14T18:00:00Z',
          metadata: {
            category: 'onboarding',
            minutesSpent: 12,
            step: 'invite_followup',
            projectId: 'proj-1',
            estimateNumber: 'EST-22',
            blueprintName: 'Main Panel',
            customerName: 'Sensitive Customer',
            summary: 'Sensitive note',
          },
        },
      ],
    })

    expect(activity).toHaveLength(1)
    expect(activity[0]).toMatchObject({
      organizationId: 'org-a',
      organizationName: 'Alpha Electric',
      classification: 'design_partner',
      eventName: 'founder_support_incident',
    })
    expect(activity[0].metadata).toMatchObject({
      category: 'onboarding',
      minutesSpent: 12,
      step: 'invite_followup',
    })
    expect(activity[0].metadata).not.toHaveProperty('projectId')
    expect(activity[0].metadata).not.toHaveProperty('estimateNumber')
    expect(activity[0].metadata).not.toHaveProperty('blueprintName')
    expect(activity[0].metadata).not.toHaveProperty('customerName')
    expect(activity[0].metadata).not.toHaveProperty('summary')
  })

  it('preserves or clears selected support organization context without stale carryover', () => {
    const organizations = [
      { organizationId: 'org-a', organizationName: 'Alpha Electric', createdAt: '2026-08-14T00:00:00Z', classification: 'design_partner' as const },
      { organizationId: 'org-b', organizationName: 'Beta Solar', createdAt: '2026-08-14T00:00:00Z', classification: 'normal' as const },
    ]

    expect(reconcileSelectedOrganizationId(null, organizations)).toBeNull()
    expect(reconcileSelectedOrganizationId('org-a', organizations)).toBe('org-a')
    expect(reconcileSelectedOrganizationId('org-missing', organizations)).toBeNull()
  })

  it('builds support selector options from all founder contractor accounts even when pilot telemetry is empty', () => {
    const contractorReport = buildFounderContractorAdminReport({
      organizations: [
        { id: 'org-a', owner_id: 'owner-a', name: 'Alpha Electric', created_at: '2026-08-10T00:00:00Z', settings: {} },
        { id: 'org-b', owner_id: 'owner-b', name: 'Beta Solar', created_at: '2026-08-11T00:00:00Z', settings: {} },
        { id: 'org-c', owner_id: 'owner-c', name: 'Gamma Power', created_at: '2026-08-12T00:00:00Z', settings: {} },
        { id: 'org-d', owner_id: 'owner-d', name: 'Delta Controls', created_at: '2026-08-13T00:00:00Z', settings: {} },
      ],
      profiles: [
        { id: 'owner-a', org_id: 'org-a', full_name: 'Owner A', is_active: true, role: 'owner', created_at: '2026-08-10T00:00:00Z' },
        { id: 'owner-b', org_id: 'org-b', full_name: 'Owner B', is_active: true, role: 'owner', created_at: '2026-08-11T00:00:00Z' },
        { id: 'owner-c', org_id: 'org-c', full_name: 'Owner C', is_active: true, role: 'owner', created_at: '2026-08-12T00:00:00Z' },
        { id: 'owner-d', org_id: 'org-d', full_name: 'Owner D', is_active: true, role: 'owner', created_at: '2026-08-13T00:00:00Z' },
      ],
      invites: [],
      agreements: [],
      employeeProfiles: [],
      activityEvents: [],
      authUsers: [
        { id: 'owner-a', email: 'owner-a@example.test', created_at: '2026-08-10T00:00:00Z', last_sign_in_at: null },
        { id: 'owner-b', email: 'owner-b@example.test', created_at: '2026-08-11T00:00:00Z', last_sign_in_at: null },
        { id: 'owner-c', email: 'owner-c@example.test', created_at: '2026-08-12T00:00:00Z', last_sign_in_at: null },
        { id: 'owner-d', email: 'owner-d@example.test', created_at: '2026-08-13T00:00:00Z', last_sign_in_at: null },
      ],
    })

    const supportOrganizations = buildSupportOrganizationOptions(contractorReport.contractorAccounts)
    expect(supportOrganizations.map((organization) => organization.organizationId)).toEqual(['org-d', 'org-c', 'org-b', 'org-a'])
    expect(supportOrganizations.map((organization) => organization.organizationName)).toEqual(['Delta Controls', 'Gamma Power', 'Beta Solar', 'Alpha Electric'])
    expect(reconcileSelectedOrganizationId('org-c', supportOrganizations)).toBe('org-c')
  })

  it('does not expose unverified signup or login IP history in the founder contractor account payload', () => {
    const report = buildFounderContractorAdminReport({
      organizations: [
        { id: 'org-a', owner_id: 'owner-a', name: 'Alpha Electric', created_at: '2026-08-10T00:00:00Z', settings: {} },
      ],
      profiles: [
        {
          id: 'owner-a',
          org_id: 'org-a',
          full_name: 'Owner A',
          is_active: true,
          role: 'owner',
          created_at: '2026-08-10T00:00:00Z',
          last_login_at: '2026-08-14T12:00:00Z',
          last_login_ip: '203.0.113.10',
        },
      ],
      invites: [],
      agreements: [],
      employeeProfiles: [],
      activityEvents: [],
      authUsers: [
        { id: 'owner-a', email: 'owner-a@example.test', created_at: '2026-08-10T00:00:00Z', last_sign_in_at: '2026-08-14T14:00:00Z' },
      ],
    })

    expect(report.contractorAccounts).toHaveLength(1)
    expect(report.contractorAccounts[0]).toMatchObject({
      organizationId: 'org-a',
      lastLoginAt: '2026-08-14T14:00:00Z',
    })
    expect(report.contractorAccounts[0]).not.toHaveProperty('lastLoginIp')
    expect(report.contractorAccounts[0]).not.toHaveProperty('signupIp')
    expect(report.contractorAccounts[0]).not.toHaveProperty('recentSecurityIps')
  })

  it('keeps founder-only server access denied for non-founder callers', () => {
    expect(requireFounder({ email: 'owner@example.test' }, 'founder@example.test')).toMatchObject({ statusCode: 403 })
    expect(requireFounder({ email: 'founder@example.test' }, 'founder@example.test')).toBeNull()
  })
})
