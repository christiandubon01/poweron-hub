import { describe, expect, it } from 'vitest'
import {
  applyAssignedHoursOverride,
  formatWorkOrderHours,
  parseAssignedHoursInput,
  presentAssignedActualVariance,
} from '../assignedHours'

describe('parseAssignedHoursInput', () => {
  it('treats empty input as omitted (canonical package default)', () => {
    expect(parseAssignedHoursInput('')).toEqual({ ok: true, value: null })
    expect(parseAssignedHoursInput('   ')).toEqual({ ok: true, value: null })
    expect(parseAssignedHoursInput(null)).toEqual({ ok: true, value: null })
  })

  it('accepts practical non-negative decimals without silent rounding', () => {
    expect(parseAssignedHoursInput('1')).toEqual({ ok: true, value: 1 })
    expect(parseAssignedHoursInput('1.5')).toEqual({ ok: true, value: 1.5 })
    expect(parseAssignedHoursInput('2.25')).toEqual({ ok: true, value: 2.25 })
    expect(parseAssignedHoursInput('8')).toEqual({ ok: true, value: 8 })
    expect(parseAssignedHoursInput('0')).toEqual({ ok: true, value: 0 })
    expect(parseAssignedHoursInput('4.5')).toEqual({ ok: true, value: 4.5 })
  })

  it('rejects negative, nonnumeric, NaN, and infinite values', () => {
    expect(parseAssignedHoursInput('-1').ok).toBe(false)
    expect(parseAssignedHoursInput('-0.5').ok).toBe(false)
    expect(parseAssignedHoursInput('abc').ok).toBe(false)
    expect(parseAssignedHoursInput('1e2').ok).toBe(false)
    expect(parseAssignedHoursInput('Infinity').ok).toBe(false)
    expect(parseAssignedHoursInput('NaN').ok).toBe(false)
    expect(parseAssignedHoursInput('1.2.3').ok).toBe(false)
  })
})

describe('applyAssignedHoursOverride', () => {
  it('overrides totalHours only and preserves component labor fields', () => {
    const draft = {
      labor: {
        roughInHours: 1,
        trimHours: 2,
        testingHours: 0,
        cleanupHours: 0,
        totalHours: 3,
      },
    }
    const next = applyAssignedHoursOverride(draft, 2.25)
    expect(next.labor.totalHours).toBe(2.25)
    expect(next.labor.roughInHours).toBe(1)
    expect(next.labor.trimHours).toBe(2)
  })

  it('rejects invalid overrides', () => {
    expect(() => applyAssignedHoursOverride({ labor: { totalHours: 1 } }, -1)).toThrow()
    expect(() => applyAssignedHoursOverride({ labor: { totalHours: 1 } }, Number.NaN)).toThrow()
  })
})

describe('presentAssignedActualVariance', () => {
  it('shows under / over / on-target wording from actual - assigned', () => {
    expect(presentAssignedActualVariance({ assignedHours: 4, actualHours: 3 })).toMatchObject({
      assignedLabel: '4h',
      actualLabel: '3h',
      varianceLabel: '1h under',
      varianceTone: 'under',
    })
    expect(presentAssignedActualVariance({ assignedHours: 4, actualHours: 5.5 })).toMatchObject({
      assignedLabel: '4h',
      actualLabel: '5.5h',
      varianceLabel: '1.5h over',
      varianceTone: 'over',
    })
    expect(presentAssignedActualVariance({ assignedHours: 4, actualHours: 4 })).toMatchObject({
      varianceLabel: 'On target',
      varianceTone: 'on_target',
    })
  })

  it('does not show 0h actual when hours have not been recorded', () => {
    const pending = presentAssignedActualVariance({ assignedHours: 4, actualHours: null })
    expect(pending.actualLabel).toBe('Not recorded')
    expect(pending.varianceLabel).toBe('Pending completion')
    expect(pending.varianceTone).toBe('pending')
    expect(formatWorkOrderHours(null)).toBe('0h')
  })

  it('uses the recorded hours value once without inventing a second source', () => {
    const once = presentAssignedActualVariance({ assignedHours: 8, actualHours: 7.25 })
    expect(once.actualLabel).toBe('7.25h')
    expect(once.varianceLabel).toBe('0.75h under')
  })
})
