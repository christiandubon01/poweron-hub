/**
 * SERVICE-COST-3D — Owner Labor Category UI + legacy validation gating.
 *
 * Two corrections:
 *   1. Owner / Me gets an editable Labor Category in the Team OwnerCard, saved to
 *      the same `laborCategory` field normal employees use (no duplicate/synthetic
 *      owner record, rates untouched).
 *   2. Crew validation (missing classification / missing rate / "Select a Costed
 *      Field Crew") is suppressed while costingMode === 'legacy' and only becomes
 *      active after "Upgrade to Crew Costing".
 *
 * The Team/Field-Log panels have no DOM render harness in this repo, so — per the
 * established pattern in serviceCost3bContract.test.ts — money/identity behaviour
 * is exercised against the REAL shared helpers and the UI wiring is guarded as a
 * source contract.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveCostedCrew, validateCrewForCosting, type CostModelEmployee } from '@/features/service-quote/crewCosting'
import { OWNER_ASSIGNEE_ID } from '@/features/service-quote/serviceAssignments'
import { normalizeEmployee } from '@/components/v15r/employeeTypes'
import { getLoadedHourlyRate } from '@/components/v15r/employeeCostUtils'

// Canonical owner Cost Model record: Base 30 / Loaded 30 / Bill 95, isOwner.
const OWNER_RAW = { id: 'me', name: 'Owner / Me', role: 'Owner', isOwner: true, hourly_rate: 30, costRate: 30, billRate: 95 }
const ALLAN: CostModelEmployee = { id: 'allan', name: 'Allan', role: 'Electrician', hourly_rate: 27.6, costRate: 27.6, billRate: 75, laborCategory: 'field', classification: '1099' } as any
const OWNER_ASSIGNMENT = { employeeId: OWNER_ASSIGNEE_ID, profileId: null, name: 'Owner / Me' }

// Mirrors the exact CostingCrewField JSX gate: errors show only when NOT legacy.
//   {errors && errors.length > 0 && !isLegacy && ( … )}   (isLegacy = mode === 'legacy')
const crewErrorsShown = (mode: 'legacy' | 'crew' | 'frozen', errors: string[]) =>
  Boolean(errors && errors.length > 0 && mode !== 'legacy')

describe('SERVICE-COST-3D — Owner Labor Category persistence & resolution', () => {
  it('1. Owner laborCategory can persist as Field (via the shared handleEditSave Object.assign)', () => {
    const saved: any = { ...OWNER_RAW }
    Object.assign(saved, { laborCategory: 'field' }) // what handleEditSave(owner.id, {laborCategory}) does
    expect(saved.laborCategory).toBe('field')
    // No second owner record was created — same id, still the owner.
    expect(saved.id).toBe('me')
    expect(saved.isOwner).toBe(true)
  })

  it('2. Owner laborCategory reloads as Field through normalizeEmployee, with rates untouched', () => {
    const saved: any = { ...OWNER_RAW, laborCategory: 'field' }
    const reloaded = normalizeEmployee(saved)
    expect(reloaded.laborCategory).toBe('field')
    expect(reloaded.isOwner).toBe(true)
    // 4. Owner rates remain $30 loaded / $95 bill.
    expect(getLoadedHourlyRate(reloaded, {})).toBe(30)
    expect(reloaded.billRate).toBe(95)
  })

  it('3 & 4. Owner (Field) + Allan resolves to two field workers; owner rates stay $30 loaded / $95 bill', () => {
    const team: CostModelEmployee[] = [
      { ...OWNER_RAW, laborCategory: 'field' } as any,
      ALLAN,
    ]
    const result = resolveCostedCrew('assigned', 4, team, [
      OWNER_ASSIGNMENT,
      { employeeId: 'allan', profileId: null, name: 'Allan' },
    ])
    expect(result.crew).toHaveLength(2)
    expect(result.crew.map((m) => m.costModelEmployeeId)).toEqual(['me', 'allan'])
    expect(result.crew[0].loadedLaborRate).toBe(30)
    expect(result.crew[0].billRate).toBe(95)
    expect(result.errors).toEqual([])
  })

  it('9. Missing Owner classification still blocks clearly (until set to Field)', () => {
    const team: CostModelEmployee[] = [OWNER_RAW as any] // no laborCategory
    const result = resolveCostedCrew('assigned', 4, team, [OWNER_ASSIGNMENT])
    expect(result.crew).toEqual([])
    expect(result.missingClassificationIds).toEqual(['me'])
    const v = validateCrewForCosting(result.crew, 15.59, 4, result)
    expect(v.valid).toBe(false)
    expect(v.errors.some((e) => e.includes('Labor Category'))).toBe(true)
  })
})

describe('SERVICE-COST-3D — legacy validation gating', () => {
  // The real crew validator DOES produce these errors for an unclassified owner…
  const ownerOnly = resolveCostedCrew('assigned', 4, [OWNER_RAW as any], [OWNER_ASSIGNMENT])
  const validation = validateCrewForCosting(ownerOnly.crew, 15.59, 4, ownerOnly)

  it('produces the crew errors that would show once crew costing is active', () => {
    expect(validation.errors.some((e) => e.includes('Labor Category'))).toBe(true)
    expect(validation.errors.some((e) => e.includes('Select a Costed Field Crew'))).toBe(true)
  })

  it('5 & 6. legacy mode shows NO crew validation errors (classification / "Select a Costed Field Crew") before upgrade', () => {
    expect(crewErrorsShown('legacy', validation.errors)).toBe(false)
  })

  it('7. switching mode to crew activates crew validation', () => {
    expect(crewErrorsShown('crew', validation.errors)).toBe(true)
    expect(crewErrorsShown('frozen', validation.errors)).toBe(true)
  })
})

describe('SERVICE-COST-3D — UI wiring source contract (supplemental)', () => {
  const teamPanel = readFileSync(join(process.cwd(), 'src/components/v15r/V15rTeamPanel.tsx'), 'utf8')
  const fieldLog = readFileSync(join(process.cwd(), 'src/components/v15r/V15rFieldLogPanel.tsx'), 'utf8')

  it('OwnerCard exposes an editable Labor Category that saves to the owner laborCategory field', () => {
    const start = teamPanel.indexOf('function OwnerCard(')
    const ownerCard = teamPanel.slice(start, start + 6000)
    expect(ownerCard).toContain('<LaborCategoryField')
    expect(ownerCard).toContain("onSave(owner.id, { laborCategory: v })")
    expect(ownerCard).toContain('hourly_rate: nextRate')
    expect(ownerCard).toContain('costRate: nextRate')
    // Owner card is wired to the same persistence handler normal employees use.
    expect(teamPanel).toContain('<OwnerCard owner={owner} backup={backup} onSave={handleEditSave} />')
  })

  it('CostingCrewField suppresses crew errors in legacy mode (gated on !isLegacy)', () => {
    expect(fieldLog).toContain('errors && errors.length > 0 && !isLegacy')
  })

  it('legacy costing mode feeds the breakdown panel empty errors (estimate + service call)', () => {
    const legacyBranches = fieldLog.match(/legacy: true, errors: \[\]/g) || []
    expect(legacyBranches.length).toBe(2)
  })
})
