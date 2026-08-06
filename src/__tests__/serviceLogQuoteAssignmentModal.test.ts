/**
 * SERVICE-LOG-1 — Service Call modal, persistence and Employee Portal wiring.
 *
 * The Service Log panel is one 4k-line component with no render harness in this
 * repo, so its UI wiring is asserted the same way every other panel contract in
 * src/__tests__ is (source contract), while the money and assignment behaviour
 * is exercised against the real shared helpers.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  computeServiceQuote,
  isManuallyQuoted,
  resolveTotalQuoted,
} from '@/features/service-quote/serviceQuoteMath'
import {
  addAssignment,
  assignedProfileIds,
  normalizeAssignments,
  removeAssignment,
  assignmentKey,
} from '@/features/service-quote/serviceAssignments'

const panel = readFileSync(
  join(process.cwd(), 'src/components/v15r/V15rFieldLogPanel.tsx'),
  'utf8',
)
const portal = readFileSync(
  join(process.cwd(), 'src/components/employee/EmployeePortal.tsx'),
  'utf8',
)
const portalPanel = readFileSync(
  join(process.cwd(), 'src/components/employee/EmployeeMyServiceCallsPanel.tsx'),
  'utf8',
)

const RATES = { mileRate: 0.66, taxRatePct: 8.25, opCostRate: 42.45 }

// ── Modal contract ───────────────────────────────────────────────────────────

describe('New Service Call modal', () => {
  it('opens from the Service Log button', () => {
    expect(panel).toContain('data-testid="new-service-call-button"')
    expect(panel).toContain('onClick={() => { resetSvcForm(); setShowSvcForm(true) }}')
    expect(panel).toContain('New Service Call')
  })

  it('is a centered overlay modal, not an inline form', () => {
    expect(panel).toContain('data-testid="service-call-modal"')
    expect(panel).toContain('className="fixed inset-0 z-50 flex items-center justify-center"')
    expect(panel).not.toContain('{/* Entry form with LIVE PROFIT PREVIEW */}')
    expect(panel).not.toContain('rounded-xl border border-orange-700/50 bg-[var(--bg-input)] p-4 space-y-3')
  })

  it('has a close X, a Cancel button and a primary Save button', () => {
    const modal = sliceModal()
    expect(modal).toContain('aria-label="Close"')
    expect(modal).toContain('>\n                  Cancel\n                </button>')
    expect(modal).toContain('data-testid="save-service-call"')
  })

  it('closes without saving on Cancel, close X and outside click', () => {
    const modal = sliceModal()
    // Every dismissal path goes through resetSvcForm, which never persists.
    expect(modal).toContain('onClick={e => { if (e.target === e.currentTarget) resetSvcForm() }}')
    expect(modal.match(/onClick=\{resetSvcForm\}/g)?.length).toBeGreaterThanOrEqual(2)
    const resetStart = panel.indexOf('function resetSvcForm()')
    const resetBody = panel.slice(resetStart, panel.indexOf('\n  }\n', resetStart))
    expect(resetBody).not.toMatch(/persist|save/i)
  })

  it('closes on Escape', () => {
    expect(panel).toContain("if (e.key === 'Escape') resetSvcForm()")
    expect(panel).toContain("window.addEventListener('keydown', onKeyDown)")
  })

  it('saves through one create path', () => {
    expect(panel).toContain('onClick={saveSvcEntry}')
    expect(panel.match(/onClick=\{saveSvcEntry\}/g)).toHaveLength(1)
  })

  it('opens the same canonical form in edit mode', () => {
    expect(panel).toContain("{editSvcId ? 'Edit Service Call' : 'New Service Call'}")
    expect(panel).toContain('onClick={() => beginSvcEdit(l.id)}')
    // The old detour through the blue Service Estimate modal is gone.
    expect(panel).not.toContain('beginSvcEditInModal')
    expect(panel).not.toContain('Edit Service Entry')
  })

  it('uses a service-call identity distinct from the estimate modal', () => {
    const modal = sliceModal()
    expect(modal).toContain("border: '1px solid rgba(249,115,22,0.35)'")
    expect(modal).toContain('<ClipboardList size={18}')
    expect(modal).toContain('bg-orange-600')
    expect(panel).toContain("border: '1px solid rgba(59,130,246,0.3)'") // estimate stays blue
  })

  it('stays usable at desktop, iPad and mobile widths', () => {
    const modal = sliceModal()
    expect(modal).toContain('max-w-5xl mx-4 sm:mx-6')
    expect(modal).toContain("maxHeight: '90vh'")
    expect(modal).toContain('flex-1 overflow-y-auto')   // scrollable body
    expect(modal).toContain('flex-shrink-0')            // separated header/footer
    expect(modal).toContain('grid-cols-1 md:grid-cols-3')
  })

  it('keeps every existing service-call field', () => {
    const modal = sliceModal()
    for (const field of [
      'Relationship Account', 'Customer / Job Name', 'Address', 'Date', 'Job Type',
      'Est. Hours', 'Actual Hours', 'Bill Rate $', 'Miles RT', 'VoiceMaterialCapture',
      'Collected $', 'Store', 'Status', 'Emergency Mat Info', 'Detail Link', 'Notes',
      'AssignedEmployeesField', 'ServiceQuotePanel',
    ]) {
      expect(modal).toContain(field)
    }
  })

  it('routes New, Edit and the estimate modal through one calculation helper', () => {
    expect(panel).toContain('const quoteFor = (inputs: any, totalQuotedOverride?: number | null) => computeServiceQuote(')
    expect(panel).toContain('function serviceCallQuote(')
    // No hand-rolled quote math left behind in the save paths.
    expect(panel).not.toContain('const totalQuote = labor + estMat + mileageCost + taxAmount')
    expect(panel).not.toContain('ProfitPreview')
  })
})

// ── Quote terminology in the panel ───────────────────────────────────────────

describe('Suggested Quote vs Total Quoted in the UI', () => {
  it('labels both numbers and offers Use Suggested Quote', () => {
    expect(panel).toContain('Suggested Quote')
    expect(panel).toContain('Total Quoted')
    expect(panel).toContain('Use Suggested Quote')
    expect(panel).toContain('data-testid="quote-variance"')
    expect(panel).toContain('data-testid="actual-estimated-profit"')
  })

  it('marks the quote manual as soon as the owner edits it', () => {
    expect(panel).toContain('onTotalQuotedChange={(raw) => { setSlQuoted(raw); setSlQuotedManual(true) }}')
    expect(panel).toContain('onTotalQuotedChange={(raw) => { setEstTotalQuoted(raw); setEstQuotedManual(true) }}')
  })

  it('persists the manual flag and the suggestion snapshot alongside the existing quote field', () => {
    expect(panel).toContain('quotedManual: slQuotedManual')
    expect(panel).toContain('quotedManual: estQuotedManual')
    expect(panel).toContain('suggestedQuote: svcQuote.suggestedQuote')
    expect(panel).toContain('suggestedQuote: quote.suggestedQuote')
  })
})

// ── Persistence + backward compatibility ─────────────────────────────────────

describe('persistence and backward compatibility', () => {
  const inputs = { hours: 4, billRate: 95, materials: 45, miles: 18, ...RATES }

  it('loads an existing quoted record into Total Quoted unchanged', () => {
    const legacy = { id: 'svc-old', quoted: 512.5, mat: 45, hrs: 4, miles: 18 }
    expect(resolveTotalQuoted(legacy)).toBe(512.5)
    const suggested = computeServiceQuote(inputs).suggestedQuote
    expect(isManuallyQuoted(legacy, suggested)).toBe(true)
    // Reopening recalculates the suggestion but never rewrites the customer amount.
    expect(resolveTotalQuoted(legacy)).toBe(512.5)
  })

  it('persists a new Total Quoted through save and reopen', () => {
    const quote = computeServiceQuote(inputs, 685)
    const saved = {
      id: 'svc-1',
      quoted: quote.totalQuoted,
      suggestedQuote: quote.suggestedQuote,
      quotedManual: true,
    }
    expect(resolveTotalQuoted(saved)).toBe(685)
    expect(isManuallyQuoted(saved, computeServiceQuote(inputs).suggestedQuote)).toBe(true)
  })

  it('keeps the manual amount when a cost input changes after save', () => {
    const saved = { id: 'svc-1', quoted: 685, quotedManual: true }
    const reQuoted = computeServiceQuote({ ...inputs, materials: 400 }, resolveTotalQuoted(saved))
    expect(reQuoted.totalQuoted).toBe(685)
    expect(reQuoted.suggestedQuote).not.toBe(685)
  })

  it('carries Total Quoted through estimate → service call conversion', () => {
    const estimate = { id: 'est-1', totalQuote: 685, suggestedQuote: 441.57, quotedManual: true }
    const converted = {
      id: 'svc-2',
      quoted: resolveTotalQuoted(estimate),
      suggestedQuote: estimate.suggestedQuote,
      quotedManual: estimate.quotedManual,
    }
    expect(converted.quoted).toBe(685)
    expect(panel).toContain('const carriedTotalQuoted = resolveTotalQuoted(est)')
    expect(panel).toContain('quoted: carriedTotalQuoted')
  })

  it('drives collections and balance from Total Quoted', () => {
    const collected = 300
    const totalQuoted = resolveTotalQuoted({ quoted: 685 })
    expect(Math.max(0, totalQuoted - collected)).toBe(385)
    // The panel's rollup still reads the same canonical `quoted` field.
    expect(panel).toContain('const baseQuoted = num(l?.quoted)')
  })
})

// ── Multi-employee assignment + portal ───────────────────────────────────────

describe('multi-employee assignment end to end', () => {
  const alex = { employeeId: 'emp-alex', profileId: 'profile-alex', name: 'Alex Rivera' }
  const sam = { employeeId: 'emp-sam', profileId: 'profile-sam', name: 'Sam Chen' }

  it('saves two employees, reopens with both, and removing one keeps the other', () => {
    const saved = { id: 'svc-1', assignedEmployees: addAssignment(addAssignment([], alex), sam) }
    const reopened = normalizeAssignments(saved)
    expect(reopened).toHaveLength(2)

    const after = removeAssignment(reopened, assignmentKey(alex))
    expect(after.map(a => a.profileId)).toEqual(['profile-sam'])
  })

  it('prevents duplicate assignment on the same record', () => {
    const list = addAssignment(addAssignment([], alex), alex)
    expect(list).toHaveLength(1)
  })

  it('sends canonical profile ids to the portal write', () => {
    const list = addAssignment(addAssignment([], alex), sam)
    expect(assignedProfileIds(list)).toEqual(['profile-alex', 'profile-sam'])
  })

  it('wires every service-call save to the portal sync', () => {
    expect(panel).toContain('function syncAssignmentsToPortal(')
    expect(panel).toContain("syncAssignmentsToPortal(entry, 'service_call', slAssignments)")
    expect(panel).toContain("syncAssignmentsToPortal(estimate, 'service_estimate', estAssignments)")
    expect(panel).toContain("syncAssignmentsToPortal(activeEntry, 'service_call', normalizeAssignments(activeEntry))")
  })

  it('replaces the single Technician selector with Assigned Employees', () => {
    expect(panel).toContain('Assigned Employees')
    expect(panel).not.toContain('Select technician...')
    expect(panel).not.toContain('technicianId: estTech')
  })

  it('surfaces assigned service calls in the Employee Portal', () => {
    expect(portal).toContain("{ key: 'service-calls'")
    expect(portal).toContain('EmployeeMyServiceCallsPanel')
    expect(portalPanel).toContain('getMyServiceCallAssignments')
  })

  it('keeps owner financials out of the employee-facing panel', () => {
    for (const forbidden of ['quoted', 'totalQuote', 'profit', 'margin', 'collected', 'balance']) {
      expect(portalPanel.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })
})

function sliceModal(): string {
  const start = panel.indexOf('{/* Service Call Modal')
  const end = panel.indexOf('{/* Collections Queue */}')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return panel.slice(start, end)
}
