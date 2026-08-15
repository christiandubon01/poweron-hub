/**
 * LEAD-SRC-3C / 3C2 — Live Call workspace + optional Open Dialer contracts.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('LEAD-SRC-3C Live Call workspace placement', () => {
  const hunter = () => read('src/components/hunter/HunterPanel.tsx')
  const liveCall = () => read('src/components/salesIntel/tabs/LiveCallTab.tsx')
  const leadsTab = () => read('src/components/salesIntel/tabs/LeadsTab.tsx')
  const salesPanel = () =>
    read('src/components/salesIntel/SalesIntelligencePanel.tsx')
  const migration = () =>
    read('supabase/migrations/127_call_logs.sql')
  const service = () => read('src/services/calls/callLogService.ts')
  const modal = () => read('src/components/hunter/CallLogModal.tsx')
  const recent = () => read('src/components/hunter/RecentCallsPanel.tsx')
  const phoneNorm = () => read('src/services/calls/phoneNormalize.ts')

  it('1. Leads/Hunter does NOT render generic + Log Call', () => {
    expect(hunter()).not.toMatch(/>\s*Log Call\s*</)
    expect(hunter()).not.toContain('Manually log an inbound')
  })

  it('2. Leads/Hunter does NOT render Recent Calls panel', () => {
    expect(hunter()).not.toContain('RecentCallsPanel')
    expect(hunter()).not.toContain('fetchRecentCallLogs')
  })

  it('3. individual Hunter lead Call opens outbound log modal (no auto tel:)', () => {
    const src = hunter()
    expect(src).toContain('handleCallLead')
    expect(src).toContain('onCall={handleCallLead}')
    expect(src).toContain('CallLogModal')
    expect(src).toContain('showOptionalDialer')
    expect(src).toContain('defaultDirection="outbound"')
    expect(src).not.toContain('initiateHunterOutboundCall')
    expect(src).not.toContain('openTelDialer')
    expect(src).not.toContain('tel:')
  })

  it('4. LIVE CALL renders + Log Call', () => {
    const src = liveCall()
    expect(src).toContain('Log Call')
    expect(src).toContain('openLogCall')
  })

  it('5. LIVE CALL renders recent call history', () => {
    const src = liveCall()
    expect(src).toContain('live-call-history')
    expect(src).toContain('RecentCallsPanel')
    expect(src).toContain('fetchRecentCallLogs')
    expect(src).toContain('Call History')
  })

  it('6. LIVE CALL supports empty state', () => {
    const src = liveCall()
    expect(src).toContain('live-call-empty-state')
    expect(src).toContain('No calls logged yet.')
    expect(src).toContain('Log an inbound call or call a lead')
  })

  it('7. manual inbound workflow opens from LIVE CALL', () => {
    const src = liveCall()
    expect(src).toContain("setModalMode('create')")
    expect(src).toContain("setModalDirection('inbound')")
    expect(src).toContain('defaultDirection={modalDirection}')
    expect(src).toContain('CallLogModal')
    expect(src).toContain('showOptionalDialer')
  })

  it('8. call classification/edit flow works from LIVE CALL', () => {
    const src = liveCall()
    expect(src).toContain("setModalMode('classify')")
    expect(src).toContain('openClassify')
    expect(src).toContain('onSelectCall={openClassify}')
  })

  it('9. existing legitimate Live Call functionality remains mounted', () => {
    const src = liveCall()
    const panel = salesPanel()
    expect(panel).toContain('LiveCallTab')
    expect(panel).toContain("case 'live_call'")
    expect(src).toContain('live-call-guidance-placeholder')
    expect(src).toContain('Real-time call guidance')
    expect(leadsTab()).toContain('HunterPanel')
  })

  it('10. migration/service behavior remains unchanged; dialer optional', () => {
    const sql = migration()
    const svc = service()
    const m = modal()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.call_logs')
    expect(sql).toContain('organization_id = public.user_org_id()')
    expect(svc).toContain('resolveHunterTenantId')
    expect(svc).not.toMatch(/limit\s*\(\s*1\s*\)/i)
    expect(svc).toContain('initiateHunterOutboundCall')
    expect(svc).toContain("direction: 'outbound'")
    expect(svc).toContain("outcome: 'unknown'")
    expect(svc).toContain("classification: 'unclassified'")
    expect(svc).toContain('openDialer')
    expect(svc).toMatch(/params\.openDialer\s*===\s*true/)
    expect(m).toContain('Log Call')
    expect(m).toContain('Open Dialer')
    expect(m).toContain('showOptionalDialer')
  })
})

describe('LEAD-SRC-3C2 optional Open Dialer inside Live Call', () => {
  const liveCall = () => read('src/components/salesIntel/tabs/LiveCallTab.tsx')
  const modal = () => read('src/components/hunter/CallLogModal.tsx')
  const recent = () => read('src/components/hunter/RecentCallsPanel.tsx')
  const phoneNorm = () => read('src/services/calls/phoneNormalize.ts')
  const migration = () => read('supabase/migrations/127_call_logs.sql')

  it('1. Live Call modal exposes Open Dialer when phone is valid', () => {
    const src = liveCall()
    const m = modal()
    expect(src).toContain('showOptionalDialer')
    expect(m).toContain('data-testid="call-log-open-dialer"')
    expect(m).toContain('canOpenDialer')
    expect(m).toContain('dialerDigits')
    expect(m).toContain('disabled={loading || !canOpenDialer}')
  })

  it('2. Open Dialer never fires automatically', () => {
    const src = liveCall()
    const m = modal()
    const r = recent()
    // Mount / open paths must not invoke dialer
    expect(src).not.toMatch(/useEffect\([\s\S]{0,200}openTelDialer/)
    expect(src).toContain('onClick={openLogCall}')
    expect(m).toContain("onClick={() => void handleOpenDialer()}")
    expect(r).toContain('onClick={() => onOpenDialer(c)}')
    // Call Again must not auto-dial
    const againStart = src.indexOf('const handleCallAgain')
    expect(againStart).toBeGreaterThan(-1)
    const againFn = src.slice(againStart, src.indexOf('const hasCalls'))
    expect(againFn).not.toContain('openTelDialer')
    expect(againFn).not.toContain('tel:')
  })

  it('3. saved call → Open Dialer invokes tel: without duplicate row', () => {
    const m = modal()
    const dialerFnStart = m.indexOf('const handleOpenDialer')
    const dialerFn = m.slice(dialerFnStart)
    expect(dialerFn).toContain("mode === 'classify' || callLog?.id")
    expect(dialerFn).toMatch(
      /mode === 'classify' \|\| callLog\?\.id[\s\S]{0,120}openTelDialer/,
    )
    // classify branch returns before saveCreateLog
    const classifyBranch = dialerFn.slice(
      dialerFn.indexOf("mode === 'classify' || callLog?.id"),
      dialerFn.indexOf('Brand-new unsaved'),
    )
    expect(classifyBranch).toContain('openTelDialer')
    expect(classifyBranch).not.toContain('saveCreateLog')
    expect(classifyBranch).not.toContain('createCallLog')
  })

  it('4. unsaved outbound call → Open Dialer saves truthful call first', () => {
    const m = modal()
    const dialerFn = m.slice(m.indexOf('const handleOpenDialer'))
    expect(dialerFn).toContain('saveCreateLog')
    expect(dialerFn).toMatch(/saveCreateLog\(\)[\s\S]{0,200}openTelDialer/)
    // Defaults remain truthful via form state (unknown/unclassified)
    expect(m).toContain("callLog?.outcome ?? 'unknown'")
    expect(m).toContain("callLog?.classification ?? 'unclassified'")
  })

  it('5. invalid phone cannot invoke tel:', () => {
    const m = modal()
    const phone = phoneNorm()
    expect(m).toContain('if (!dialerDigits(phoneForDial))')
    expect(m).toContain("setError('Invalid phone number')")
    expect(m).toContain('disabled={loading || !canOpenDialer}')
    expect(phone).toContain('export function dialerDigits')
    expect(phone).toContain('export function openTelDialer')
    expect(phone).toMatch(/if \(!digits\) return false/)
  })

  it('6. Call History row can optionally Open Dialer', () => {
    const src = liveCall()
    const r = recent()
    expect(src).toContain('onOpenDialer={handleHistoryOpenDialer}')
    expect(src).toContain('openTelDialer(call.phoneRaw)')
    expect(r).toContain('data-testid="call-history-open-dialer"')
    expect(r).toContain('aria-label="Open Dialer"')
    expect(r).toContain('dialerDigits(c.phoneRaw)')
  })

  it('7. historical row is not mutated into a new call', () => {
    const src = liveCall()
    const r = recent()
    // History Open Dialer is tel: only
    const histDialer = src.slice(
      src.indexOf('const handleHistoryOpenDialer'),
      src.indexOf('const handleCallAgain'),
    )
    expect(histDialer).toContain('openTelDialer')
    expect(histDialer).not.toContain('createCallLog')
    expect(histDialer).not.toContain('updateCallLogClassification')
    // Call Again creates a separate record; does not update historical id
    const againFn = src.slice(
      src.indexOf('const handleCallAgain'),
      src.indexOf('const hasCalls'),
    )
    expect(againFn).toContain('createCallLog')
    expect(againFn).not.toContain('updateCallLogClassification')
    expect(againFn).not.toMatch(/\.update\(/)
    expect(r).toContain('onCallAgain')
  })

  it('8. Call Again creates NEW outbound unknown/unclassified record', () => {
    const src = liveCall()
    const againFn = src.slice(
      src.indexOf('const handleCallAgain'),
      src.indexOf('const hasCalls'),
    )
    expect(againFn).toContain("direction: 'outbound'")
    expect(againFn).toContain("outcome: 'unknown'")
    expect(againFn).toContain("classification: 'unclassified'")
    expect(againFn).toContain('hunterLeadId: call.hunterLeadId')
    expect(againFn).toContain('portalRequestId: call.portalRequestId')
    expect(againFn).toContain('clientId: call.clientId')
    expect(againFn).toContain("setModalMode('classify')")
    expect(againFn).toContain('setModalOpen(true)')
    expect(againFn).not.toContain('openTelDialer')
    expect(src).toContain('onCallAgain=')
    expect(recent()).toContain('data-testid="call-history-call-again"')
  })

  it('9. lead/customer status remains untouched', () => {
    const src = liveCall()
    const m = modal()
    const r = recent()
    expect(src).not.toMatch(/updateLead|setLeadStatus|customer\.status/i)
    expect(m).not.toMatch(/hunter_leads|portal_requests|clients/)
    expect(m).toContain('Never mutates leads/customers')
    expect(r).not.toMatch(/updateLead|setLeadStatus/)
  })

  it('10. PowerOn-only logging still works without external dialer', () => {
    const src = liveCall()
    const m = modal()
    expect(src).toContain('openLogCall')
    expect(src).toContain('Log Call')
    expect(m).toContain('data-testid="call-log-save-only"')
    expect(m).toContain('handleLogCall')
    const logFn = m.slice(
      m.indexOf('const handleLogCall'),
      m.indexOf('const handleOpenDialer'),
    )
    expect(logFn).not.toContain('openTelDialer')
    expect(logFn).not.toContain('tel:')
    // migration 127 untouched marker
    expect(migration()).toContain('CREATE TABLE IF NOT EXISTS public.call_logs')
  })
})
