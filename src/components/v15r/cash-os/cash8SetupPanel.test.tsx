// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import CashOsSetupPanel from './CashOsSetupPanel'

vi.mock('@/services/cashOsReadService', () => ({
  CASH_OS_TIMEZONE: 'America/Los_Angeles',
  readCashOsSources: vi.fn(),
}))

vi.mock('./cashOsUi', () => ({
  CashCard: ({ children, title }: { children: React.ReactNode; title?: string }) => (
    <div data-testid="cash-card">{title && <h3>{title}</h3>}{children}</div>
  ),
}))

const baseProps = {
  organizationId: 'org-1',
  storedTimezone: 'America/Los_Angeles',
  existing: null as any,
  reason: null as any,
  onConfirm: vi.fn(),
}

// Use native prototype setter so React's onChange fires in happy-dom
function setInputValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

function setSelectValue(el: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

// Fill every required field with a valid value (leaves checkbox alone)
async function fillAllFields(host: HTMLElement) {
  await act(async () => {
    const inputs = [...host.querySelectorAll('input')] as HTMLInputElement[]
    const selects = [...host.querySelectorAll('select')] as HTMLSelectElement[]

    // paidThrough (date), horizon (number), floor (decimal)
    const dateInput = inputs.find(i => i.type === 'date')
    const numInput = inputs.find(i => i.type === 'number')
    const decimalInputs = inputs.filter(i => i.getAttribute('inputmode') === 'decimal' && i.type !== 'checkbox')

    if (dateInput) setInputValue(dateInput, '2026-09-01')
    if (numInput) setInputValue(numInput, '30')
    if (decimalInputs[0]) setInputValue(decimalInputs[0], '1000')  // operating floor

    // taxKind → 'disabled' (avoids needing conditional tax amount field)
    if (selects[0]) setSelectValue(selects[0], 'disabled')
    // optional obligations → 'false'
    if (selects[1]) setSelectValue(selects[1], 'false')
    // open shift estimates → 'false'
    if (selects[2]) setSelectValue(selects[2], 'false')
  })
}

describe('CashOsSetupPanel timezone checkbox', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    baseProps.onConfirm = vi.fn()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    host.remove()
  })

  // 1. Timezone control renders
  it('renders the timezone confirmation checkbox', async () => {
    await act(async () => { root.render(<CashOsSetupPanel {...baseProps} />) })
    const cb = host.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(cb).not.toBeNull()
    expect(host.textContent).toContain('America/Los_Angeles')
  })

  // 2. Starts unchecked when existing is null
  it('starts unchecked when no existing setup', async () => {
    await act(async () => { root.render(<CashOsSetupPanel {...baseProps} />) })
    const cb = host.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(cb.checked).toBe(false)
  })

  // 3. Clicking the checkbox input toggles to true
  it('clicking the checkbox input toggles timezoneConfirmed to true', async () => {
    await act(async () => { root.render(<CashOsSetupPanel {...baseProps} />) })
    const cb = host.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(cb.checked).toBe(false)
    await act(async () => { cb.click() })
    expect(cb.checked).toBe(true)
  })

  // 4. Clicking the label element also toggles (Safari iOS label-tap fix)
  it('clicking the label element toggles timezoneConfirmed', async () => {
    await act(async () => { root.render(<CashOsSetupPanel {...baseProps} />) })
    const label = host.querySelector('label:has(input[type="checkbox"])') as HTMLLabelElement
    expect(label).not.toBeNull()
    const cb = label.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(cb.checked).toBe(false)
    await act(async () => {
      label.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(cb.checked).toBe(true)
  })

  // 5. Label has cursor-pointer and checkbox has explicit size classes
  it('label has cursor-pointer and checkbox has h-5 w-5 for touch target', async () => {
    await act(async () => { root.render(<CashOsSetupPanel {...baseProps} />) })
    const label = host.querySelector('label:has(input[type="checkbox"])') as HTMLLabelElement
    const cb = label.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(label.className).toContain('cursor-pointer')
    expect(cb.className).toContain('h-5')
    expect(cb.className).toContain('w-5')
  })

  // 6. Confirm is blocked while timezoneConfirmed is false
  it('form submit is blocked with error when timezone not confirmed', async () => {
    await act(async () => { root.render(<CashOsSetupPanel {...baseProps} />) })
    await fillAllFields(host)
    // Leave checkbox unchecked
    const form = host.querySelector('form') as HTMLFormElement
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(baseProps.onConfirm).not.toHaveBeenCalled()
    const alert = host.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('Complete and confirm every assumption')
  })

  // 7. Confirm succeeds when all fields valid and timezone is checked
  it('form submit calls onConfirm when all fields are valid and timezone is checked', async () => {
    await act(async () => { root.render(<CashOsSetupPanel {...baseProps} />) })
    await fillAllFields(host)
    const cb = host.querySelector('input[type="checkbox"]') as HTMLInputElement
    await act(async () => { cb.click() })
    expect(cb.checked).toBe(true)
    const form = host.querySelector('form') as HTMLFormElement
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(baseProps.onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      timezoneConfirmed: true,
      organizationId: 'org-1',
    }))
  })
})
