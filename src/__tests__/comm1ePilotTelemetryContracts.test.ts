import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('COMM-1E pilot telemetry contracts', () => {
  const migration = read('supabase/migrations/117_pilot_telemetry.sql')
  const functionSource = read('netlify/functions/pilot-telemetry.ts')
  const clientSource = read('src/services/pilotTelemetryClient.ts')
  const authStore = read('src/store/authStore.ts')
  const blueprintViewer = read('src/components/blueprint/OperationsBlueprintPdfViewer.tsx')

  it('creates a dedicated pilot telemetry table instead of reusing usage_tracking', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.pilot_telemetry_events')
    expect(migration).not.toContain('usage_tracking')
  })

  it('keeps raw telemetry reads scoped to same-org owner/admin users only', () => {
    expect(migration).toContain('CREATE POLICY pilot_telemetry_owner_admin_read')
    expect(migration).toContain('public.is_org_admin_for(organization_id)')
  })

  it('uses a server-side function for event writes and founder reports', () => {
    expect(clientSource).toContain("/.netlify/functions/pilot-telemetry")
    expect(functionSource).toContain("action === 'founder_report'")
    expect(functionSource).toContain("action === 'track_event'")
  })

  it('protects founder support incidents behind founder-only server checks', () => {
    expect(functionSource).toContain('Founder access required.')
    expect(functionSource).toContain("event_name: 'founder_support_incident'")
  })

  it('records login success from SIGNED_IN without coupling it to TOKEN_REFRESHED', () => {
    expect(authStore).toContain("if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')")
    expect(authStore).toContain("if (event === 'SIGNED_IN') {")
  })

  it('wires blueprint viewer telemetry for opens and persisted actions', () => {
    expect(blueprintViewer).toContain('trackPilotTelemetryEvent')
    expect(blueprintViewer).toContain("eventName: 'blueprint_opened'")
    expect(blueprintViewer).toContain("eventName: 'work_package_created'")
  })
})
