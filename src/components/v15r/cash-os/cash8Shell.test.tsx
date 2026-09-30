// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import DebtKiller from '@/views/DebtKiller'

const control = vi.hoisted(() => ({ demo: false }))
vi.mock('@/store/demoStore', () => ({
  useDemoMode: () => ({ isDemoMode: control.demo, hasHydrated: true }),
}))
vi.mock('@/hooks/useCashOsSnapshot', () => ({
  useCashOsSnapshot: () => ({
    status: 'loading',
    scope: null,
    setup: null,
    snapshot: null,
    reason: null,
    error: null,
    editing: false,
    setEditing: vi.fn(),
    resetSetup: vi.fn(),
    confirmSetup: vi.fn(),
    refresh: vi.fn(),
    lastRefreshedAt: null,
    horizonDays: 30,
    setHorizonDays: vi.fn(),
    confidenceMode: 'conservative',
    setConfidenceMode: vi.fn(),
  }),
}))
vi.mock('@/views/DebtKillerLegacy', () => ({
  default: () => <div>Legacy Debt Plan</div>,
}))

describe('CASH-8 Debt Killer workspace shell', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    control.demo = false
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    host.remove()
  })

  async function click(label: string) {
    const button = [...host.querySelectorAll('button')].find(node => node.textContent?.trim() === label)
    expect(button).toBeDefined()
    await act(async () => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }

  it('defaults Debt Killer to Outlook with no fake zero during loading', async () => {
    await act(async () => { root.render(<DebtKiller />) })
    expect(host.querySelector('h1')?.textContent).toBe('Outlook')
    expect(host.textContent).toContain('Loading canonical cash sources')
    expect(host.textContent).not.toContain('$0')
  })

  it('keeps the seven Debt Killer workspace tabs in order', async () => {
    await act(async () => { root.render(<DebtKiller />) })
    expect([...host.querySelectorAll('nav button')].map(node => node.textContent)).toEqual([
      'Outlook', 'Calendar', 'Projects', 'Payroll', 'Transactions', 'Obligations', 'Debt Plan',
    ])
  })

  it('keeps the old Debt Killer tool reachable under Debt Plan', async () => {
    await act(async () => { root.render(<DebtKiller />) })
    await click('Debt Plan')
    expect(host.textContent).toContain('Legacy Debt Plan')
  })

  it('does not put a Money or Performance tab inside Debt Killer', async () => {
    await act(async () => { root.render(<DebtKiller />) })
    const labels = [...host.querySelectorAll('nav button')].map(node => node.textContent)
    expect(labels).not.toContain('Performance')
    expect(labels).not.toContain('Money')
  })

  it('keeps Debt Plan available while Cash OS is unavailable in Demo Mode', async () => {
    control.demo = true
    await act(async () => { root.render(<DebtKiller />) })
    expect(host.textContent).toContain('Cash OS unavailable in Demo Mode')
    await click('Debt Plan')
    expect(host.textContent).toContain('Legacy Debt Plan')
  })
})
