import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('COMM-1F contractor commercialization gate contracts', () => {
  const telemetryShared = read('src/services/pilotTelemetryShared.ts')
  const telemetryFunction = read('netlify/functions/pilot-telemetry.ts')
  const telemetryMigration = read('supabase/migrations/117_pilot_telemetry.sql')
  const telemetryHardeningMigration = read('supabase/migrations/118_pilot_telemetry_hardening.sql')
  const blueprintLibrary = read('src/services/blueprintLibraryService.ts')
  const employeePortal = read('src/components/employee/EmployeePortal.tsx')
  const app = read('src/App.tsx')
  const billingView = read('src/views/BillingView.tsx')

  it('allow-lists product telemetry event names on the shared contract and server boundary', () => {
    expect(telemetryShared).toContain('export const PILOT_TELEMETRY_EVENT_NAMES')
    expect(telemetryShared).toContain('export function isPilotTelemetryEventName')
    expect(telemetryFunction).toContain("return json(400, { error: 'Invalid pilot telemetry event name.' })")
  })

  it('keeps telemetry writes org-derived on the server instead of trusting a browser org id', () => {
    expect(telemetryFunction).toContain('const actor = await resolveActorContext(supabase, user.id)')
    expect(telemetryFunction).toContain('organization_id: actor.organizationId')
    expect(telemetryFunction).not.toContain('organization_id: payload?.organizationId')
  })

  it('keeps founder-only cross-org telemetry surfaces behind explicit founder checks', () => {
    expect(telemetryFunction).toContain("if (String(user?.email || '').trim().toLowerCase() !== founderEmail())")
    expect(telemetryFunction).toContain("if (action === 'founder_report') return await handleFounderReport(user)")
    expect(telemetryFunction).toContain("if (action === 'set_org_classification') return await handleSetOrgClassification(event, user)")
  })

  it('hardens raw telemetry table privileges through a forward corrective migration', () => {
    expect(telemetryMigration).toContain('ALTER TABLE public.pilot_telemetry_events ENABLE ROW LEVEL SECURITY;')
    expect(telemetryMigration).toContain('CREATE POLICY pilot_telemetry_owner_admin_read')
    expect(telemetryHardeningMigration).toContain('REVOKE ALL PRIVILEGES ON TABLE public.pilot_telemetry_events FROM PUBLIC;')
    expect(telemetryHardeningMigration).toContain('REVOKE ALL PRIVILEGES ON TABLE public.pilot_telemetry_events FROM anon;')
    expect(telemetryHardeningMigration).toContain('GRANT SELECT ON TABLE public.pilot_telemetry_events TO authenticated;')
  })

  it('keeps live blueprint storage paths bound to the authenticated profile org instead of caller-supplied org ids', () => {
    expect(blueprintLibrary).toContain(".from('profiles')")
    expect(blueprintLibrary).toContain(".select('org_id')")
    expect(blueprintLibrary).toContain("throw new Error('Could not resolve organization for blueprint upload.')")
    expect(blueprintLibrary).toContain('const orgId = String(profile.org_id)')
  })

  it('keeps employee employer branding resolved from employer organization identity', () => {
    expect(employeePortal).toContain('const orgId = employerOrgId || data.org_id')
    expect(employeePortal).toContain("select('name, settings')")
    expect(employeePortal).toContain('normalizeOrganizationIdentity')
  })

  it('keeps Demo Mode and AuditGate separate so demo cannot inherit audit bypass semantics', () => {
    expect(app).toContain('if (isDemoRuntimeActive()) return')
    expect(app).toContain("const token = params.get('audit')")
    expect(app).toContain('ReadOnlyContext.Provider')
  })

  it('keeps pilot billing on the founder-managed manual path for design partners', () => {
    expect(billingView).toContain('getPilotOrganizationClassification')
    expect(billingView).toContain("classification === 'design_partner' || classification === 'customer_zero'")
    expect(billingView).toContain('Billing is manually managed during the pilot')
  })
})
