/**
 * SERVICE-LOG-1 polish — slider, status, layout and render-cost contract.
 *
 * The Service Log panel has no render harness in this repo, so layout/wiring is
 * asserted as a source contract (the established pattern in src/__tests__),
 * while the payment-status behaviour is exercised against the real exported
 * helper that both the modal and the save path use.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  TOTAL_QUOTED_STEP,
  reconcileServicePayment,
  roundUpToQuoteStep,
  snapToQuoteStep,
} from '@/features/service-quote/servicePaymentStatus'

const panel = readFileSync(
  join(process.cwd(), 'src/components/v15r/V15rFieldLogPanel.tsx'),
  'utf8',
)

function sliceServiceCallModal(): string {
  const start = panel.indexOf('{/* Service Call Modal')
  const end = panel.indexOf('{/* Collections Queue */}')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return panel.slice(start, end)
}

// ── C. Total Quoted slider ───────────────────────────────────────────────────

describe('Total Quoted slider', () => {
  it('moves in $5 increments', () => {
    expect(TOTAL_QUOTED_STEP).toBe(5)
    expect(panel).toContain('step={TOTAL_QUOTED_STEP}')
  })

  it('is a draggable range control, not an arrow spinner', () => {
    expect(panel).toContain('type="range"')
    expect(panel).toContain('data-testid="total-quoted-slider"')
    expect(panel).toContain('aria-label="Total Quoted slider"')
    // The old always-controlled number input with a 0.01 spinner step is gone.
    expect(panel).not.toContain('step="0.01"\n              aria-label="Total Quoted"')
  })

  it('snaps the thumb to the $5 grid without changing the persisted value', () => {
    expect(snapToQuoteStep(437.44)).toBe(435)
    expect(snapToQuoteStep(438)).toBe(440)
    expect(panel).toContain('snapToQuoteStep(total)')
    // The snap is display-only: sliderValue feeds the range input, never the save.
    expect(panel).toContain('value={sliderValue}')
    expect(panel).not.toContain('quoted: sliderValue')
  })

  it('keeps a paired numeric input that commits on blur/Enter', () => {
    expect(panel).toContain('data-testid="total-quoted-input"')
    expect(panel).toContain('onBlur={(e) => onTotalQuotedChange(e.target.value)}')
    expect(panel).toContain("if (e.key === 'Enter') (e.target as HTMLInputElement).blur()")
  })

  it('keeps the slider max above the suggestion and stable while dragging', () => {
    expect(roundUpToQuoteStep(437.44)).toBe(440)
    expect(panel).toContain('roundUpToQuoteStep(quote.suggestedQuote * 2)')
    expect(panel).toContain('roundUpToQuoteStep(total)')
  })

  it('preserves the existing persisted Total Quoted behaviour', () => {
    // Same state, same manual flag, same saved fields as before this pass.
    expect(panel).toContain('onTotalQuotedChange={(raw) => { setSlQuoted(raw); setSlQuotedManual(true) }}')
    expect(panel).toContain('onTotalQuotedChange={(raw) => { setEstTotalQuoted(raw); setEstQuotedManual(true) }}')
    expect(panel).toContain('quotedManual: slQuotedManual')
    expect(panel).toContain('quotedManual: estQuotedManual')
  })

  it('keeps Use Suggested Quote and leaves Suggested Quote informational', () => {
    expect(panel).toContain('Use Suggested Quote')
    expect(panel).toContain('onUseSuggested={() => { setSlQuoted(String(quote.suggestedQuote)); setSlQuotedManual(false) }}')
    expect(panel).toContain('data-testid="suggested-quote"')
  })

  it('applies to the estimate modal too (shared panel)', () => {
    expect(panel.match(/<ServiceQuotePanel/g)).toHaveLength(2)
    expect(panel).toContain('accent="blue"')
    expect(panel).toContain('accent="orange"')
  })
})

// ── D. Status behaviour ──────────────────────────────────────────────────────

describe('payment status', () => {
  it('honours an explicit Paid in Full even with nothing typed in Collected', () => {
    const r = reconcileServicePayment('Y', '', 685)
    expect(r.payStatus).toBe('Y')
    expect(r.collected).toBe(685)
    expect(r.balanceDue).toBe(0)
  })

  it('honours an explicit Unpaid even when an amount was typed', () => {
    const r = reconcileServicePayment('N', 300, 685)
    expect(r.payStatus).toBe('N')
    expect(r.collected).toBe(0)
    expect(r.balanceDue).toBe(685)
  })

  it('keeps a real partial amount as Partial', () => {
    const r = reconcileServicePayment('P', 300, 685)
    expect(r.payStatus).toBe('P')
    expect(r.collected).toBe(300)
    expect(r.balanceDue).toBe(385)
  })

  it('resolves an unrepresentable Partial to the truthful status', () => {
    expect(reconcileServicePayment('P', 0, 685).payStatus).toBe('N')
    expect(reconcileServicePayment('P', 700, 685)).toEqual({ payStatus: 'Y', collected: 685, balanceDue: 0 })
  })

  it('never returns a negative collected or balance', () => {
    const r = reconcileServicePayment('P', -50, 685)
    expect(r.collected).toBe(0)
    expect(r.balanceDue).toBe(685)
    expect(reconcileServicePayment('Y', 10, 0).balanceDue).toBe(0)
  })

  it('defaults an unknown status to Unpaid', () => {
    expect(reconcileServicePayment('', 0, 685).payStatus).toBe('N')
    expect(reconcileServicePayment('bogus', 0, 685).payStatus).toBe('N')
  })

  it('is the single save path — the old derive-from-collected override is gone', () => {
    expect(panel).toContain('const payment = reconcileServicePayment(slPayStatus, collected, quoted)')
    expect(panel).not.toContain('if (collected <= 0.009) payStatus = \'N\'')
    expect(panel).toContain('collected, payStatus, balanceDue,')
  })

  it('reloads the saved status into the modal on edit', () => {
    expect(panel).toContain("setSlPayStatus(l.payStatus || 'N')")
  })

  it('shows the owner the Collected amount their status implies', () => {
    const modal = sliceServiceCallModal()
    expect(modal).toContain('const reconciled = reconcileServicePayment(next, slCollected, serviceCallQuote().totalQuoted)')
    // Remounting on status change is what makes the uncontrolled input redisplay.
    expect(modal).toContain('key={`slCollected-${editSvcId || \'new\'}-${slPayStatus}`}')
  })

  it('offers all three statuses', () => {
    const modal = sliceServiceCallModal()
    expect(modal).toContain('<option value="Y">Paid in Full</option>')
    expect(modal).toContain('<option value="P">Partial</option>')
    expect(modal).toContain('<option value="N">Unpaid</option>')
  })
})

// ── A. Render cost ───────────────────────────────────────────────────────────

describe('render cost', () => {
  it('no longer parses the whole backup inside the rollup', () => {
    const rollupStart = panel.indexOf('function getServiceRollup(')
    const rollupEnd = panel.indexOf('function serviceBalanceDue(')
    const rollup = panel.slice(rollupStart, rollupEnd)
    expect(rollup).toContain('readServiceRateSettings()')
    expect(rollup).not.toContain('getBackupData()')
  })

  it('invalidates the cached rates on the events every save path dispatches', () => {
    expect(panel).toContain("window.addEventListener('storage', __resetServiceRateCache)")
    expect(panel).toContain("window.addEventListener('poweron-data-saved', __resetServiceRateCache)")
    expect(panel).toContain('SERVICE_RATE_CACHE_TTL_MS')
  })

  it('keeps the same default rates as before', () => {
    expect(panel).toContain('opCost: num(settings.opCost) || 43')
    expect(panel).toContain('mileRate: num(settings.mileRate) || 0.66')
  })
})

// ── B. Layout ────────────────────────────────────────────────────────────────

describe('Service Call modal layout', () => {
  it('groups Collected and Status together', () => {
    const modal = sliceServiceCallModal()
    const row = modal.slice(modal.indexOf('{/* Collected + Status */}'), modal.indexOf('{/* Materials + Store */}'))
    expect(row).toContain('Collected $')
    expect(row).toContain('Status')
    expect(row).toContain('grid-cols-1 md:grid-cols-2')
  })

  it('puts Materials and Store next to each other', () => {
    const modal = sliceServiceCallModal()
    const row = modal.slice(modal.indexOf('{/* Materials + Store */}'), modal.indexOf('{/* Emergency material info'))
    expect(row).toContain('VoiceMaterialCapture')
    expect(row).toContain('Store')
    expect(row).toContain('grid-cols-1 md:grid-cols-2')
  })

  it('places Materials / Store directly above Emergency Mat Info and Detail Link', () => {
    const modal = sliceServiceCallModal()
    const materials = modal.indexOf('{/* Materials + Store */}')
    const emergency = modal.indexOf('{/* Emergency material info / Detail link */}')
    expect(materials).toBeGreaterThan(-1)
    expect(emergency).toBeGreaterThan(materials)
    // Nothing else sits between the two rows.
    const between = modal.slice(materials, emergency)
    expect(between).not.toContain('AssignedEmployeesField')
    expect(between).not.toContain('ServiceQuotePanel')
  })

  it('keeps Collected/Status above Materials/Store', () => {
    const modal = sliceServiceCallModal()
    expect(modal.indexOf('{/* Collected + Status */}')).toBeLessThan(modal.indexOf('{/* Materials + Store */}'))
  })

  it('constrains the Materials field so it is no longer oversized', () => {
    const modal = sliceServiceCallModal()
    expect(modal).toContain('className="max-w-sm"')
    expect(modal).toContain('<div className="max-w-sm">')
  })

  it('keeps every field that was in the modal before this pass', () => {
    const modal = sliceServiceCallModal()
    for (const field of [
      'Relationship Account', 'Customer / Job Name', 'Address', 'Date', 'Job Type',
      'Est. Hours', 'Actual Hours', 'Bill Rate $', 'Miles RT', 'VoiceMaterialCapture',
      'Collected $', 'Store', 'Status', 'Emergency Mat Info', 'Detail Link', 'Notes',
      'AssignedEmployeesField', 'ServiceQuotePanel',
    ]) {
      expect(modal).toContain(field)
    }
  })
})
