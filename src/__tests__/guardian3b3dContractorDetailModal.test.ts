import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  reconcileSelectedOrganizationId,
  hasGuardianPresenceSnapshot,
  describeAgreementArtifactState,
} from '@/components/guardian/FounderContractorAdminSurface'

const ROOT = process.cwd()
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const SURFACE_SOURCE = read('src/components/guardian/FounderContractorAdminSurface.tsx')

describe('GUARDIAN-3B3D contractor detail modal + 2×2 grid (SOURCE-CONTRACT)', () => {
  // --- Layout: drawer replaced by modal ---

  it('replaces the fixed-width aside drawer with a fullscreen modal overlay', () => {
    expect(SURFACE_SOURCE).not.toContain('xl:w-[520px]')
    expect(SURFACE_SOURCE).not.toContain('xl:flex-row')
    expect(SURFACE_SOURCE).toContain('data-testid="contractor-detail-modal"')
    expect(SURFACE_SOURCE).toContain('fixed inset-0 z-50')
  })

  it('renders the modal with correct role and size constraints', () => {
    expect(SURFACE_SOURCE).toContain('role="dialog"')
    expect(SURFACE_SOURCE).toContain('aria-modal="true"')
    expect(SURFACE_SOURCE).toContain('max-w-[1400px]')
    expect(SURFACE_SOURCE).toContain('max-h-[90vh]')
  })

  it('closes modal on Escape key via window event listener', () => {
    expect(SURFACE_SOURCE).toContain("if (e.key === 'Escape')")
    expect(SURFACE_SOURCE).toContain("window.addEventListener('keydown', handler)")
    expect(SURFACE_SOURCE).toContain("window.removeEventListener('keydown', handler)")
  })

  it('closes modal when overlay backdrop is clicked (target === currentTarget guard)', () => {
    expect(SURFACE_SOURCE).toContain('if (e.target === e.currentTarget)')
    expect(SURFACE_SOURCE).toContain('setSelectedOrganizationId(null)')
  })

  it('preserves close button aria-label and click handler contracts from guardian1 test', () => {
    expect(SURFACE_SOURCE).toContain('aria-label="Close contractor details"')
    // close button must call setSelectedOrganizationId(null)
    const closeButtonBlock = SURFACE_SOURCE.slice(
      SURFACE_SOURCE.indexOf('aria-label="Close contractor details"') - 200,
      SURFACE_SOURCE.indexOf('aria-label="Close contractor details"') + 100,
    )
    expect(closeButtonBlock).toContain('setSelectedOrganizationId(null)')
  })

  it('uses a 2×2 responsive grid for the four operational cards', () => {
    expect(SURFACE_SOURCE).toContain('grid-cols-1')
    expect(SURFACE_SOURCE).toContain('md:grid-cols-2')
  })

  it('includes all four ModalCard titles in the grid', () => {
    expect(SURFACE_SOURCE).toContain('Live Presence / Sessions')
    expect(SURFACE_SOURCE).toContain('Devices')
    expect(SURFACE_SOURCE).toContain('Recent Sessions')
    expect(SURFACE_SOURCE).toContain('Security History')
    expect(SURFACE_SOURCE).not.toContain('Access Control History')
  })

  it('defines ModalCard helper component with title, description and scrollable support', () => {
    expect(SURFACE_SOURCE).toContain('function ModalCard(')
    expect(SURFACE_SOURCE).toContain('scrollable')
    expect(SURFACE_SOURCE).toContain('max-h-72 overflow-auto')
  })

  it('defines CompactMeta helper component for compact header metadata', () => {
    expect(SURFACE_SOURCE).toContain('function CompactMeta(')
    expect(SURFACE_SOURCE).toContain('label: string')
  })

  it('preserves metadata fields required by guardian1 source-contract', () => {
    expect(SURFACE_SOURCE).toContain('Owner full name')
    expect(SURFACE_SOURCE).toContain('Employee count')
    expect(SURFACE_SOURCE).toContain('User / member count')
    expect(SURFACE_SOURCE).toContain('Last activity')
    expect(SURFACE_SOURCE).toContain('Last login')
  })

  it('adds Users / Access compactly inside the modal header instead of adding a fifth large card', () => {
    expect(SURFACE_SOURCE).toContain('Users / Access')
    expect(SURFACE_SOURCE).toContain('Canonical profile-backed users for this contractor organization.')
    expect(SURFACE_SOURCE).toContain('Revoke Access')
    expect(SURFACE_SOURCE).toContain('Restore Access')
  })

  it('preserves the showContractorDetail && selectedAccount && guard required by guardian1 test', () => {
    expect(SURFACE_SOURCE).toContain('showContractorDetail && selectedAccount && (')
  })

  it('preserves selectedOrganizationId state and setter required by guardian1 test', () => {
    expect(SURFACE_SOURCE).toContain('const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null)')
    expect(SURFACE_SOURCE).toContain('setSelectedOrganizationId(account.organizationId)')
  })

  it('includes all empty-state messages from guardian3b3 source-contract', () => {
    expect(SURFACE_SOURCE).toContain('No session history')
    expect(SURFACE_SOURCE).toContain('No device grouping is available yet for this contractor.')
    expect(SURFACE_SOURCE).toContain('No recent new-runtime sessions found for this contractor.')
  })

  it('keeps Recent Sessions card scrollable with fixed max-height', () => {
    // ModalCard for Recent Sessions passes scrollable prop — max-h-72 overflow-auto appears
    const recentIdx = SURFACE_SOURCE.indexOf('Recent Sessions')
    const securityIdx = SURFACE_SOURCE.indexOf('Security History')
    const recentCard = SURFACE_SOURCE.slice(recentIdx, securityIdx)
    expect(recentCard).toContain('scrollable')
  })

  // --- Functional exports unchanged ---

  it('reconcileSelectedOrganizationId preserves null when account list is empty', () => {
    expect(reconcileSelectedOrganizationId('org-1', [])).toBeNull()
    expect(reconcileSelectedOrganizationId(null, [])).toBeNull()
  })

  it('reconcileSelectedOrganizationId returns id when account still present', () => {
    const accounts = [
      { organizationId: 'org-1' } as Parameters<typeof reconcileSelectedOrganizationId>[1][number],
    ]
    expect(reconcileSelectedOrganizationId('org-1', accounts)).toBe('org-1')
    expect(reconcileSelectedOrganizationId('org-2', accounts)).toBeNull()
  })

  it('hasGuardianPresenceSnapshot returns true with any snapshot content', () => {
    expect(hasGuardianPresenceSnapshot({ summaries: [], alerts: [], serverNow: null })).toBe(false)
    expect(hasGuardianPresenceSnapshot({ summaries: [], alerts: [], serverNow: '2026-08-14T00:00:00.000Z' })).toBe(true)
  })

  it('describeAgreementArtifactState handles grandfathered and pdf-on-file cases', () => {
    expect(describeAgreementArtifactState({ ndaState: 'GRANDFATHERED_LEGACY_ACCESS', hasPdf: false, artifactStatus: '' })).toContain('grandfathered')
    expect(describeAgreementArtifactState({ ndaState: 'SIGNED', hasPdf: true, artifactStatus: '' })).toContain('on file')
  })
})
