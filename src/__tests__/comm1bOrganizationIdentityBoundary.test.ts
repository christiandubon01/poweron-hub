import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

function read(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8')
}

describe('COMM-1B organization identity boundary wiring', () => {
  it('employee portal header uses passed organization branding and preserves PowerOn Hub as the product label', () => {
    const src = read('src/components/employee/EmployeePortalBrandHeader.tsx')
    expect(src).toContain('companyName?: string | null')
    expect(src).toContain('logoUrl?: string | null')
    expect(src).toContain('PowerOn Hub Employee Portal')
    expect(src).toContain('resolvedCompanyName')
  })

  it('employee portal resolves employer organization branding from organizations settings', () => {
    const src = read('src/components/employee/EmployeePortal.tsx')
    expect(src).toContain("select('name, settings')")
    expect(src).toContain('normalizeOrganizationIdentity')
    expect(src).toContain('companyName={profileSummary?.org_name}')
    expect(src).toContain('logoUrl={profileSummary?.logo_url}')
  })

  it('employee invite send path uses employer org branding and PowerOn Hub wording', () => {
    const src = read('netlify/functions/sendEmployeeInvite.ts')
    expect(src).toContain('loadOrgBranding')
    expect(src).toContain('invited you to join PowerOn Hub')
    expect(src).toContain('buildComm1bEmployeeInviteHtml')
    expect(src).toContain('select=name,settings')
  })

  it('employee invite resend path uses employer org branding and PowerOn Hub wording', () => {
    const src = read('netlify/functions/resendEmployeeInvite.ts')
    expect(src).toContain('buildComm1bResendInviteHtml')
    expect(src).toContain('orgBranding = await loadOrgBranding')
    expect(src).toContain('invited you to join PowerOn Hub')
  })

  it('auth magic links derive the redirect host from config/current origin instead of only the legacy production domain', () => {
    const src = read('src/store/authStore.ts')
    expect(src).toContain('resolveProductRedirectUrl')
    expect(src).toContain('MAGIC_LINK_REDIRECT_URL')
    expect(src).toContain("options: { emailRedirectTo: MAGIC_LINK_REDIRECT_URL }")
  })
})
