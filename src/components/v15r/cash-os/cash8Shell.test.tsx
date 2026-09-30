// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import V15rMoneyPanel from '../V15rMoneyPanel'

const control = vi.hoisted(() => ({ demo: false, navigate: vi.fn() }))
vi.mock('@/store/demoStore', () => ({ useDemoMode: () => ({ isDemoMode: control.demo, hasHydrated: true }) }))
vi.mock('@/hooks/useCashOsSnapshot', () => ({ useCashOsSnapshot: () => ({
  status: 'loading', scope: null, setup: null, snapshot: null, reason: null, error: null,
  editing: false, setEditing: vi.fn(), resetSetup: vi.fn(), confirmSetup: vi.fn(),
  refresh: vi.fn(), lastRefreshedAt: null, horizonDays: 30, setHorizonDays: vi.fn(),
  confidenceMode: 'conservative', setConfidenceMode: vi.fn(),
}) }))
vi.mock('../V15rMoneyPerformancePanel', () => ({ default: () => <div>Legacy Performance analytics</div> }))

describe('CASH-8 Money workspace shell', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    control.demo = false; control.navigate.mockClear()
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  })
  afterEach(async () => { await act(async () => { root.unmount() }); host.remove() })
  async function click(label: string) {
    const button = [...host.querySelectorAll('button')].find(node => node.textContent?.trim() === label)
    expect(button).toBeDefined()
    await act(async () => { button!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  }
  it('defaults to Outlook with no fake zero during loading', async () => {
    await act(async () => { root.render(<V15rMoneyPanel onNavigate={control.navigate} />) })
    expect(host.querySelector('h1')?.textContent).toBe('Outlook')
    expect(host.textContent).toContain('Loading canonical cash sources')
    expect(host.textContent).not.toContain('$0')
  })
  it('keeps all eight workspace tabs in order', async () => {
    await act(async () => { root.render(<V15rMoneyPanel onNavigate={control.navigate} />) })
    expect([...host.querySelectorAll('nav button')].map(node => node.textContent)).toEqual([
      'Outlook', 'Calendar', 'Projects', 'Payroll', 'Transactions', 'Obligations', 'Debt Killer', 'Performance',
    ])
  })
  it('keeps legacy analytics reachable through Performance', async () => {
    await act(async () => { root.render(<V15rMoneyPanel onNavigate={control.navigate} />) })
    await click('Performance')
    expect(host.textContent).toContain('Legacy Performance analytics')
  })
  it('navigates to standalone Debt Killer without embedding its calculations', async () => {
    await act(async () => { root.render(<V15rMoneyPanel onNavigate={control.navigate} />) })
    await click('Debt Killer'); await click('Open Debt Killer')
    expect(control.navigate).toHaveBeenCalledWith('debt-killer')
  })
  it('keeps demo Performance available while Cash OS is unavailable', async () => {
    control.demo = true
    await act(async () => { root.render(<V15rMoneyPanel onNavigate={control.navigate} />) })
    expect(host.textContent).toContain('Cash OS unavailable in Demo Mode')
    await click('Performance')
    expect(host.textContent).toContain('Legacy Performance analytics')
  })
})
