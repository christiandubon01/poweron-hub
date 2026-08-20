import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildFounderContractorAdminReport,
  requireFounder,
} from '../../netlify/functions/pilot-telemetry'
import { reconcileSelectedOrganizationId } from '@/components/guardian/FounderContractorAdminSurface'

const ROOT = process.cwd()
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const SURFACE = read('src/components/guardian/FounderContractorAdminSurface.tsx')
const SERVICE = read('src/services/founderContractorAdminService.ts')

function accountByOrg(report: ReturnType<typeof buildFounderContractorAdminReport>, orgId: string) {
  const match = report.contractorAccounts.find((account) => account.organizationId === orgId)
  expect(match).toBeTruthy()
  return match!
}

describe('GUARDIAN-1 contractor detail view (SOURCE-CONTRACT)', () => {
  it('renders a selectable contractor detail panel from the compact accounts table', () => {
    expect(SURFACE).toContain('selectedOrganizationId')
    expect(SURFACE).toMatch(/setSelectedOrganizationId\((account|row)\.organizationId\)/)
    expect(SURFACE).toContain('showContractorDetail && selectedAccount')
    expect(SURFACE).toContain('Owner full name')
    expect(SURFACE).toContain('Employee count')
    expect(SURFACE).toContain('User / member count')
    expect(SURFACE).toContain('Last activity')
    expect(SURFACE).toContain('Last login')
  })

  it('keeps the all-contractor list as the primary surface and removes first-account auto-selection', () => {
    expect(SURFACE).toContain("['Company / Org', 'Owner Email', 'Created', 'Onboarding', 'NDA State', 'Classification', 'Account Status']")
    expect(SURFACE).not.toContain('accounts[0]?.organizationId')
    expect(SURFACE).toContain('reconcileSelectedOrganizationId(current, report?.contractorAccounts ?? [])')
    expect(SURFACE).toContain('const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null)')
  })

  it('keeps all contractor rows available while detail is open and provides a close action', () => {
    expect(SURFACE).toContain('report.contractorAccounts.map((account) => {')
    expect(SURFACE).toContain('showContractorDetail && selectedAccount && (')
    expect(SURFACE).toContain('aria-label="Close contractor details"')
    expect(SURFACE).toContain('onClick={() => setSelectedOrganizationId(null)}')
  })

  it('keeps the client contract founder-operational only', () => {
    expect(SERVICE).toContain('ownerFullName')
    expect(SERVICE).toContain('employeeCount')
    expect(SERVICE).toContain('memberCount')
    expect(SERVICE).toContain('lastActivityAt')
    expect(SERVICE).toContain('lastLoginAt')
    expect(SERVICE).not.toContain('projectCount')
    expect(SERVICE).not.toContain('customerCount')
    expect(SERVICE).not.toContain('blueprint')
  })
})

describe('GUARDIAN-1 contractor detail view (RUNTIME)', () => {
  it('does not auto-select a contractor and only preserves an explicitly chosen valid selection', () => {
    const accounts = [
      { organizationId: 'org-a' },
      { organizationId: 'org-b' },
    ] as any

    expect(reconcileSelectedOrganizationId(null, accounts)).toBeNull()
    expect(reconcileSelectedOrganizationId('org-a', accounts)).toBe('org-a')
    expect(reconcileSelectedOrganizationId('org-missing', accounts)).toBeNull()
  })

  it('uses canonical owner identity sources for owner full name', () => {
    const report = buildFounderContractorAdminReport({
      organizations: [
        { id: 'org-a', owner_id: 'owner-a', name: 'Alpha Electric', created_at: '2026-08-10T00:00:00Z', settings: {} },
        { id: 'org-b', owner_id: 'owner-b', name: 'Beta Solar', created_at: '2026-08-11T00:00:00Z', settings: {} },
      ],
      profiles: [
        { id: 'owner-a', org_id: 'org-a', full_name: 'Profile Owner', is_active: true, role: 'owner', created_at: '2026-08-10T00:00:00Z' },
        { id: 'owner-b', org_id: 'org-b', full_name: '', is_active: true, role: 'owner', created_at: '2026-08-11T00:00:00Z' },
      ],
      invites: [],
      agreements: [],
      employeeProfiles: [],
      activityEvents: [],
      authUsers: [
        { id: 'owner-a', email: 'profile-owner@example.test', created_at: '2026-08-10T00:00:00Z', last_sign_in_at: null },
        { id: 'owner-b', email: 'metadata-owner@example.test', created_at: '2026-08-11T00:00:00Z', last_sign_in_at: null, user_metadata: { full_name: 'Metadata Owner' } },
      ],
    })

    expect(accountByOrg(report, 'org-a').ownerFullName).toBe('Profile Owner')
    expect(accountByOrg(report, 'org-b').ownerFullName).toBe('Metadata Owner')
  })

  it('keeps employee and member counts organization-scoped without cross-org bleed', () => {
    const report = buildFounderContractorAdminReport({
      organizations: [
        { id: 'org-a', owner_id: 'owner-a', name: 'Alpha Electric', created_at: '2026-08-10T00:00:00Z', settings: {} },
        { id: 'org-b', owner_id: 'owner-b', name: 'Beta Solar', created_at: '2026-08-11T00:00:00Z', settings: {} },
      ],
      profiles: [
        { id: 'owner-a', org_id: 'org-a', full_name: 'Owner A', is_active: true, role: 'owner', created_at: '2026-08-10T00:00:00Z' },
        { id: 'manager-a', org_id: 'org-a', full_name: 'Manager A', is_active: true, role: 'admin', created_at: '2026-08-10T01:00:00Z' },
        { id: 'owner-b', org_id: 'org-b', full_name: 'Owner B', is_active: true, role: 'owner', created_at: '2026-08-11T00:00:00Z' },
      ],
      invites: [],
      agreements: [],
      employeeProfiles: [
        { id: 'ep-a1', org_id: 'org-a', user_id: 'owner-a', active: true },
        { id: 'ep-a2', org_id: 'org-a', user_id: 'employee-a', active: true },
        { id: 'ep-b1', org_id: 'org-b', user_id: 'employee-b', active: true },
      ],
      activityEvents: [],
      authUsers: [
        { id: 'owner-a', email: 'owner-a@example.test', created_at: '2026-08-10T00:00:00Z', last_sign_in_at: null },
        { id: 'manager-a', email: 'manager-a@example.test', created_at: '2026-08-10T01:00:00Z', last_sign_in_at: null },
        { id: 'owner-b', email: 'owner-b@example.test', created_at: '2026-08-11T00:00:00Z', last_sign_in_at: null },
      ],
    })

    expect(accountByOrg(report, 'org-a')).toMatchObject({ memberCount: 2, employeeCount: 2 })
    expect(accountByOrg(report, 'org-b')).toMatchObject({ memberCount: 1, employeeCount: 1 })
  })

  it('preserves current, legacy, and grandfathered NDA states', () => {
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
          pdf_url: 'nda/current.pdf',
        },
        {
          id: 'nda-legacy',
          user_id: 'owner-legacy',
          agreement_type: 'nda_beta_v1',
          signed_at: '2026-04-06T01:57:05.984Z',
          created_at: '2026-04-06T01:57:07.400095Z',
          typed_name: 'Legacy Owner',
          signature_image: 'data:image/png;base64,legacy-signature',
          pdf_url: 'stub-pdf-url-1775440625984',
          email: null,
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

    expect(accountByOrg(report, 'org-current')).toMatchObject({ ndaState: 'SIGNED_CURRENT', agreementStatus: 'signed' })
    expect(accountByOrg(report, 'org-legacy')).toMatchObject({ ndaState: 'SIGNED_LEGACY', agreementStatus: 'signed' })
    expect(accountByOrg(report, 'org-grand')).toMatchObject({ ndaState: 'GRANDFATHERED_LEGACY_ACCESS', agreementStatus: 'grandfathered' })
  })

  it('keeps optional activity fields nullable when trustworthy activity is unavailable', () => {
    const report = buildFounderContractorAdminReport({
      organizations: [
        { id: 'org-a', owner_id: 'owner-a', name: 'Alpha Electric', created_at: '2026-08-10T00:00:00Z', settings: {} },
      ],
      profiles: [
        { id: 'owner-a', org_id: 'org-a', full_name: 'Owner A', is_active: true, role: 'owner', created_at: '2026-08-10T00:00:00Z' },
      ],
      invites: [],
      agreements: [],
      employeeProfiles: [],
      activityEvents: [],
      authUsers: [
        { id: 'owner-a', email: 'owner-a@example.test', created_at: '2026-08-10T00:00:00Z', last_sign_in_at: null },
      ],
    })

    expect(accountByOrg(report, 'org-a')).toMatchObject({
      lastActivityAt: null,
      lastLoginAt: null,
    })
  })

  it('keeps founder reporting denied for non-founder callers', () => {
    expect(requireFounder({ email: 'owner@example.test' }, 'founder@example.test')).toMatchObject({ statusCode: 403 })
    expect(requireFounder({ email: 'founder@example.test' }, 'founder@example.test')).toBeNull()
  })

  it('does not return customer, project, estimate, or blueprint detail payloads', () => {
    const report = buildFounderContractorAdminReport({
      organizations: [
        { id: 'org-a', owner_id: 'owner-a', name: 'Alpha Electric', created_at: '2026-08-10T00:00:00Z', settings: {} },
      ],
      profiles: [
        { id: 'owner-a', org_id: 'org-a', full_name: 'Owner A', is_active: true, role: 'owner', created_at: '2026-08-10T00:00:00Z' },
      ],
      invites: [],
      agreements: [],
      employeeProfiles: [],
      activityEvents: [],
      authUsers: [
        { id: 'owner-a', email: 'owner-a@example.test', created_at: '2026-08-10T00:00:00Z', last_sign_in_at: null },
      ],
    })

    const account = accountByOrg(report, 'org-a')
    expect(account).not.toHaveProperty('customers')
    expect(account).not.toHaveProperty('projects')
    expect(account).not.toHaveProperty('estimates')
    expect(account).not.toHaveProperty('blueprints')
  })
})
