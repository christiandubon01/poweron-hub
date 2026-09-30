// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useCashOsSnapshot } from './useCashOsSnapshot'
import { cashOsSessionKey, type CashOsSessionSetup } from '@/services/cashOsSessionSetup'

const control = vi.hoisted(() => ({
  org: 'org-1', reads: 0,
  timezone: 'America/Los_Angeles' as string | null,
  accountMode: 'ready' as 'ready' | 'none' | 'empty',
  readFailure: null as string | null,
  authCallback: null as null | (() => void),
  org1Deferred: null as null | ((value: any) => void),
}))

vi.mock('@/lib/supabase', () => ({ supabase: { auth: {
  onAuthStateChange: (callback: () => void) => {
    control.authCallback = callback
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  },
} } }))

vi.mock('@/services/cashOsReadService', () => ({
  CASH_OS_TIMEZONE: 'America/Los_Angeles',
  resolveCashOsScope: async () => ({ context: { organizationId: control.org, userId: `user-${control.org}` },
    storedTimezone: control.timezone }),
  readCashOsSources: async (scope: any) => {
    control.reads++
    if (control.readFailure) throw new Error(control.readFailure)
    const source = { organizationId: scope.context.organizationId,
      accounts: control.accountMode === 'none' ? [] : [{ id: 'bank', status: 'active', account_class: 'asset', include_in_cash: true }],
      transactions: control.accountMode === 'empty' ? [] : [{ id: 'opening', status: 'posted', account_id: 'bank' }] }
    if (scope.context.organizationId === 'org-1' && control.org1Deferred) {
      return new Promise(resolve => { control.org1Deferred = resolve })
    }
    return source
  },
}))

vi.mock('@/finance/cashOsSnapshot', () => ({
  buildCashOsSnapshot: (input: any) => ({ ...input,
    payrollDiagnostics: [], projection: { anchor: { closingCashMinor: 0 } } }),
}))

function assumption(org: string): CashOsSessionSetup {
  return { version: 1, organizationId: org, payrollPaidThroughDate: '2026-09-28',
    protectionHorizonDays: 7, operatingFloorMinor: 0, taxReserve: { kind: 'disabled' },
    includeOptionalObligations: false, includeOpenShiftEstimates: false,
    timezoneConfirmed: true, confirmedAt: '2026-09-29T20:00:00Z' }
}

function Probe({ demo = false }: { demo?: boolean }) {
  const cash = useCashOsSnapshot(demo)
  return <div data-testid="cash">{cash.scope?.context.organizationId ?? 'none'}:{cash.status}:{cash.reason ?? ''}</div>
}

describe('CASH-8 hook lifecycle', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    control.org = 'org-1'; control.reads = 0; control.org1Deferred = null; control.authCallback = null
    control.timezone = 'America/Los_Angeles'; control.accountMode = 'ready'; control.readFailure = null
    sessionStorage.clear()
    sessionStorage.setItem(cashOsSessionKey('org-1'), JSON.stringify(assumption('org-1')))
    sessionStorage.setItem(cashOsSessionKey('org-2'), JSON.stringify(assumption('org-2')))
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => { root.unmount() })
    host.remove()
  })

  it('does not fetch live sources in Demo Mode', async () => {
    await act(async () => { root.render(<Probe demo />) })
    expect(control.reads).toBe(0)
    expect(host.textContent).toContain('DEMO_UNAVAILABLE')
  })
  it('loads raw sources even when no session assumptions exist', async () => {
    sessionStorage.clear()
    await act(async () => { root.render(<Probe />) })
    expect(control.reads).toBe(1)
    expect(host.textContent).toContain('SESSION_SETUP_REQUIRED')
  })
  it('has scope and sources but no setup or snapshot when setup_required', async () => {
    sessionStorage.clear()
    let captured: any = null
    function Capture() {
      const cash = useCashOsSnapshot(false)
      captured = cash
      return null
    }
    await act(async () => { root.render(<Capture />) })
    expect(captured.status).toBe('setup_required')
    expect(captured.scope).not.toBeNull()
    expect(captured.sources).not.toBeNull()
    expect(captured.setup).toBeNull()
    expect(captured.snapshot).toBeNull()
  })
  it('does not have a snapshot (no allocation/projection fabricated) when setup is absent', async () => {
    sessionStorage.clear()
    // Verified implicitly: the state capture test above checks snapshot === null.
    // This named test asserts the same via the Probe text to make the intent explicit.
    await act(async () => { root.render(<Probe />) })
    const text = host.textContent ?? ''
    // status is setup_required and there is no ready/partial that would imply a built snapshot
    expect(text).toContain('setup_required')
    expect(text).not.toContain(':ready')
    expect(text).not.toContain(':partial')
  })
  it('requires account setup rather than treating missing accounts as zero', async () => {
    control.accountMode = 'none'
    await act(async () => { root.render(<Probe />) })
    expect(host.textContent).toContain('ACCOUNT_SETUP_REQUIRED')
  })
  it('marks a successfully read ledger without posted cash as empty', async () => {
    control.accountMode = 'empty'
    await act(async () => { root.render(<Probe />) })
    expect(host.textContent).toContain('empty:LEDGER_EMPTY')
  })
  it('can display a genuine zero once a posted cash row is loaded', async () => {
    await act(async () => { root.render(<Probe />) })
    expect(host.textContent).toContain('ready')
  })
  it('keeps a failed ledger read as an error', async () => {
    control.readFailure = 'LEDGER_READ_FAILED: denied'
    await act(async () => { root.render(<Probe />) })
    expect(host.textContent).toContain('error:LEDGER_READ_FAILED')
  })
  it('requires timezone confirmation when the stored value is absent — but still loads sources', async () => {
    control.timezone = null
    sessionStorage.clear()
    await act(async () => { root.render(<Probe />) })
    expect(host.textContent).toContain('TIMEZONE_CONFIRMATION_REQUIRED')
    // Sources load even without timezone confirmation (assumption gap, not hard conflict)
    expect(control.reads).toBe(1)
  })
  it('has sources but no snapshot when TIMEZONE_CONFIRMATION_REQUIRED', async () => {
    control.timezone = null
    sessionStorage.clear()
    let captured: any = null
    function Capture() {
      const cash = useCashOsSnapshot(false)
      captured = cash
      return null
    }
    await act(async () => { root.render(<Capture />) })
    expect(captured.status).toBe('setup_required')
    expect(captured.reason).toBe('TIMEZONE_CONFIRMATION_REQUIRED')
    expect(captured.sources).not.toBeNull()
    expect(captured.snapshot).toBeNull()
  })
  it('blocks a conflicting stored timezone and does not load sources', async () => {
    control.timezone = 'America/New_York'
    await act(async () => { root.render(<Probe />) })
    expect(host.textContent).toContain('TIMEZONE_MISMATCH')
    expect(control.reads).toBe(0)
  })
  it('prevents an older tenant read from replacing a newer tenant snapshot', async () => {
    control.org1Deferred = (() => {}) as any
    await act(async () => { root.render(<Probe />) })
    expect(host.textContent).toContain('loading')
    control.org = 'org-2'
    await act(async () => { control.authCallback?.(); await new Promise(resolve => setTimeout(resolve, 170)) })
    expect(host.textContent).toContain('org-2:ready')
    await act(async () => { control.org1Deferred?.({ organizationId: 'org-1', accounts: [], transactions: [] }) })
    expect(host.textContent).toContain('org-2:ready')
  })
  it('coalesces overlapping save and remote refresh events', async () => {
    await act(async () => { root.render(<Probe />) })
    expect(control.reads).toBe(1)
    await act(async () => {
      window.dispatchEvent(new Event('poweron-remote-data-refreshed'))
      window.dispatchEvent(new Event('poweron-data-saved'))
      await new Promise(resolve => setTimeout(resolve, 170))
    })
    expect(control.reads).toBe(2)
  })
})
