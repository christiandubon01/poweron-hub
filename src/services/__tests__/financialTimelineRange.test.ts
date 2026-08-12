import { describe, expect, it } from 'vitest'
import {
  resolveTimelineRange,
  getTimelineCollected,
  TIMELINE_PRESETS,
  type TimelinePreset,
  type TimelineRangeOptions,
} from '@/services/financialTimelineRange'
import { getCurrentYearCollectedRevenue } from '@/services/collectedRevenueRange'
import { getDemoBackupData } from '@/services/demoDataService'
import { createEmptyBackup, type BackupData } from '@/services/backupDataService'

/**
 * KPI-TIMELINE-1 — controlled tests for the ONE canonical collected-cash range
 * selector. Every preset resolves to ONE half-open UTC-midnight range and shares
 * ONE canonical collected calculation. Unknown-date historical cash is never
 * fabricated into a precise period; ALL_TIME uses lifetime semantics.
 */

const TODAY = '2026-08-11' // Tuesday; current year 2026, current month August

function opts(extra: TimelineRangeOptions = {}): TimelineRangeOptions {
  return { todayKey: TODAY, ...extra }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function activeProject(id: string): any {
  return { id, name: id, status: 'active', contract: 0, billed: 0, paid: 0, rfis: [] }
}

/** Dated service payment (known receivedAt). */
function svcDated(id: string, collected: number, receivedAt: string): any {
  return {
    id,
    serviceLogId: id,
    quoted: collected,
    collected,
    payments: [
      { id: `${id}-pay`, amount: collected, receivedAt, recordedAt: '2026-01-01T00:00:00.000Z', kind: 'payment', voidedAt: null },
    ],
  }
}

/** Legacy undated service cash (scalar collected, no payments) → unknown date. */
function svcUndated(id: string, collected: number): any {
  return { id, serviceLogId: id, quoted: collected, collected }
}

/** Genuine dated project payment log. */
function projDated(id: string, projectId: string, date: string, collected: number): any {
  return { id, projectId, projId: projectId, date, collected, paymentsCollected: collected, hrs: 0 }
}

/** Synthetic paid-scalar backfill log (unknown-date provenance, lifetime only). */
function projBackfill(id: string, projectId: string, date: string, collected: number): any {
  return {
    id,
    projectId,
    projId: projectId,
    date,
    collected,
    paymentsCollected: collected,
    hrs: 0,
    notes: 'Backfilled from p.paid scalar (CFOT-COLLECTION-PATH-PARITY migration)',
  }
}

function backup(extra: Record<string, any> = {}): BackupData {
  return {
    projects: [activeProject('p1')],
    logs: [],
    serviceLogs: [],
    settings: { dayTarget: 200, annualTarget: 100000 },
    weeklyData: [],
    ...extra,
  } as unknown as BackupData
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const v of Object.values(value as any)) deepFreeze(v)
  }
  return value
}

const ALL_PRESETS: TimelinePreset[] = [
  'CURRENT_YEAR', 'PREVIOUS_YEAR', 'LAST_6_MONTHS', 'LAST_3_MONTHS',
  'LAST_90_DAYS', 'THIS_MONTH', 'ALL_TIME', 'CUSTOM',
]

// ── Preset → range resolution ─────────────────────────────────────────────────

describe('T1 — CURRENT_YEAR is half-open [Jan 1, next Jan 1)', () => {
  it('includes Jan 1 and excludes next Jan 1', () => {
    const b = backup({
      serviceLogs: [svcDated('s-in', 1000, '2026-01-01'), svcDated('s-out', 5000, '2027-01-01')],
    })
    const t = getTimelineCollected(b, 'CURRENT_YEAR', opts())
    expect(t.range.startInclusive).toEqual(new Date('2026-01-01T00:00:00.000Z'))
    expect(t.range.endExclusive).toEqual(new Date('2027-01-01T00:00:00.000Z'))
    expect(t.range.isAllTime).toBe(false)
    expect(t.provenance.knownTotal).toBe(1000)
    expect(t.displayValue).toBe(1000)
  })
})

describe('T2 — PREVIOUS_YEAR is half-open [prev Jan 1, this Jan 1)', () => {
  it('includes mid-previous-year, excludes this Jan 1 and prev New Year eve', () => {
    const b = backup({
      serviceLogs: [
        svcDated('s-in', 1000, '2025-06-15'),
        svcDated('s-edge', 500, '2026-01-01'),
        svcDated('s-before', 300, '2024-12-31'),
      ],
    })
    const t = getTimelineCollected(b, 'PREVIOUS_YEAR', opts())
    expect(t.range.startInclusive).toEqual(new Date('2025-01-01T00:00:00.000Z'))
    expect(t.range.endExclusive).toEqual(new Date('2026-01-01T00:00:00.000Z'))
    expect(t.provenance.knownTotal).toBe(1000)
    expect(t.displayValue).toBe(1000)
  })
})

describe('T3 — LAST_3_MONTHS correct month boundary [Jun 1, Sep 1)', () => {
  it('includes Jun 1 and Aug 31; excludes May 31 and Sep 1', () => {
    const b = backup({
      serviceLogs: [
        svcDated('s-jun1', 1000, '2026-06-01'),
        svcDated('s-aug31', 2000, '2026-08-31'),
        svcDated('s-may31', 4000, '2026-05-31'),
        svcDated('s-sep1', 8000, '2026-09-01'),
      ],
    })
    const t = getTimelineCollected(b, 'LAST_3_MONTHS', opts())
    expect(t.range.startInclusive).toEqual(new Date('2026-06-01T00:00:00.000Z'))
    expect(t.range.endExclusive).toEqual(new Date('2026-09-01T00:00:00.000Z'))
    expect(t.provenance.knownTotal).toBe(3000)
    expect(t.displayValue).toBe(3000)
  })
})

describe('T4 — LAST_6_MONTHS correct month boundary [Mar 1, Sep 1)', () => {
  it('includes Mar 1; excludes Feb 28', () => {
    const b = backup({
      serviceLogs: [
        svcDated('s-mar1', 1000, '2026-03-01'),
        svcDated('s-feb28', 2000, '2026-02-28'),
      ],
    })
    const t = getTimelineCollected(b, 'LAST_6_MONTHS', opts())
    expect(t.range.startInclusive).toEqual(new Date('2026-03-01T00:00:00.000Z'))
    expect(t.range.endExclusive).toEqual(new Date('2026-09-01T00:00:00.000Z'))
    expect(t.provenance.knownTotal).toBe(1000)
  })
})

describe('T5 — LAST_90_DAYS rolling day window [May 14, Aug 12)', () => {
  it('includes May 14 and Aug 11 (today); excludes May 13 and Aug 12', () => {
    const b = backup({
      serviceLogs: [
        svcDated('s-may14', 1000, '2026-05-14'),
        svcDated('s-today', 2000, '2026-08-11'),
        svcDated('s-may13', 4000, '2026-05-13'),
        svcDated('s-aug12', 8000, '2026-08-12'),
      ],
    })
    const t = getTimelineCollected(b, 'LAST_90_DAYS', opts())
    expect(t.range.startInclusive).toEqual(new Date('2026-05-14T00:00:00.000Z'))
    expect(t.range.endExclusive).toEqual(new Date('2026-08-12T00:00:00.000Z'))
    expect(t.provenance.knownTotal).toBe(3000)
  })
})

describe('T6 — THIS_MONTH is half-open [Aug 1, Sep 1)', () => {
  it('includes Aug 1 and Aug 31; excludes Jul 31 and Sep 1', () => {
    const b = backup({
      serviceLogs: [
        svcDated('s-aug1', 1000, '2026-08-01'),
        svcDated('s-aug31', 2000, '2026-08-31'),
        svcDated('s-jul31', 4000, '2026-07-31'),
        svcDated('s-sep1', 8000, '2026-09-01'),
      ],
    })
    const t = getTimelineCollected(b, 'THIS_MONTH', opts())
    expect(t.range.startInclusive).toEqual(new Date('2026-08-01T00:00:00.000Z'))
    expect(t.range.endExclusive).toEqual(new Date('2026-09-01T00:00:00.000Z'))
    expect(t.provenance.knownTotal).toBe(3000)
  })
})

describe('T7 — ALL_TIME uses lifetime semantics', () => {
  it('isAllTime is true; displayValue is lifetimeTotal (known + unknown)', () => {
    const b = backup({
      serviceLogs: [svcDated('s1', 1000, '2026-06-15'), svcUndated('s-leg', 2000)],
    })
    const t = getTimelineCollected(b, 'ALL_TIME', opts())
    expect(t.isAllTime).toBe(true)
    expect(t.displayValue).toBe(t.provenance.lifetimeTotal)
    expect(t.displayValue).toBe(3000)
    expect(t.provenance.knownTotal).toBe(1000)
    expect(t.provenance.unknownDateTotal).toBe(2000)
  })
})

describe('T8 — CUSTOM inclusive start/end normalize to half-open', () => {
  it('includes both boundary days; excludes the day after end and the day before start', () => {
    const b = backup({
      serviceLogs: [
        svcDated('s-start', 1000, '2026-03-05'),
        svcDated('s-end', 2000, '2026-06-20'),
        svcDated('s-before', 4000, '2026-03-04'),
        svcDated('s-after', 8000, '2026-06-21'),
      ],
    })
    const t = getTimelineCollected(b, 'CUSTOM', opts({ customStart: '2026-03-05', customEnd: '2026-06-20' }))
    expect(t.range.isAllTime).toBe(false)
    expect(t.range.startInclusive).toEqual(new Date('2026-03-05T00:00:00.000Z'))
    expect(t.range.endExclusive).toEqual(new Date('2026-06-21T00:00:00.000Z'))
    expect(t.provenance.knownTotal).toBe(3000)
    expect(t.displayValue).toBe(3000)
  })
})

describe('T9 — CUSTOM with reversed dates normalizes via lo/hi swap', () => {
  it('treats the earlier date as start and the later as end', () => {
    const b = backup({
      serviceLogs: [svcDated('s1', 1000, '2026-04-10'), svcDated('s2', 500, '2026-04-10')],
    })
    const t = getTimelineCollected(b, 'CUSTOM', opts({ customStart: '2026-04-10', customEnd: '2026-04-10' }))
    // Same-day inclusive range = exactly that one day.
    expect(t.range.startInclusive).toEqual(new Date('2026-04-10T00:00:00.000Z'))
    expect(t.range.endExclusive).toEqual(new Date('2026-04-11T00:00:00.000Z'))
    expect(t.provenance.knownTotal).toBe(1500)
  })

  it('swaps when start > end', () => {
    const b = backup({ serviceLogs: [svcDated('s1', 1000, '2026-05-10')] })
    const t = getTimelineCollected(b, 'CUSTOM', opts({ customStart: '2026-05-12', customEnd: '2026-05-05' }))
    expect(t.range.startInclusive).toEqual(new Date('2026-05-05T00:00:00.000Z'))
    expect(t.range.endExclusive).toEqual(new Date('2026-05-13T00:00:00.000Z'))
    expect(t.provenance.knownTotal).toBe(1000)
  })
})

// ── KPI-TIMELINE-1A — CUSTOM validation: invalid/incomplete is explicit ─────────
//
// ALL_TIME occurs ONLY when the owner explicitly selects ALL_TIME. A CUSTOM
// range with a missing or invalid start/end is an explicit incomplete state:
// no lifetime is calculated, zero is never presented as a valid financial
// result, and no other preset is silently substituted.

describe('C1 — Custom + no dates → invalid/incomplete, no lifetime value', () => {
  it('isInvalid true, displayValue null, isAllTime false, no lifetime computed', () => {
    const b = backup({ serviceLogs: [svcDated('s1', 1000, '2026-06-15'), svcUndated('s-leg', 2000)] })
    const t = getTimelineCollected(b, 'CUSTOM', opts())
    expect(t.isInvalid).toBe(true)
    expect(t.isAllTime).toBe(false)
    expect(t.displayValue).toBeNull()
    // No lifetime / known value is computed for an invalid range.
    expect(t.provenance.lifetimeTotal).toBe(0)
    expect(t.provenance.knownTotal).toBe(0)
    expect(t.provenance.unknownDateTotal).toBe(0)
  })
})

describe('C2 — Custom + start only → invalid/incomplete', () => {
  it('isInvalid true, displayValue null', () => {
    const b = backup({ serviceLogs: [svcDated('s1', 1000, '2026-06-15')] })
    const t = getTimelineCollected(b, 'CUSTOM', opts({ customStart: '2026-01-01' }))
    expect(t.isInvalid).toBe(true)
    expect(t.displayValue).toBeNull()
    expect(t.isAllTime).toBe(false)
  })
})

describe('C3 — Custom + end only → invalid/incomplete', () => {
  it('isInvalid true, displayValue null', () => {
    const b = backup({ serviceLogs: [svcDated('s1', 1000, '2026-06-15')] })
    const t = getTimelineCollected(b, 'CUSTOM', opts({ customEnd: '2026-08-11' }))
    expect(t.isInvalid).toBe(true)
    expect(t.displayValue).toBeNull()
    expect(t.isAllTime).toBe(false)
  })
})

describe('C4 — Custom + malformed date → invalid/incomplete', () => {
  it('garbage start → invalid; garbage end → invalid', () => {
    const b = backup({ serviceLogs: [svcDated('s1', 1000, '2026-06-15')] })
    expect(getTimelineCollected(b, 'CUSTOM', opts({ customStart: 'not-a-date', customEnd: '2026-08-11' })).isInvalid).toBe(true)
    expect(getTimelineCollected(b, 'CUSTOM', opts({ customStart: '2026-01-01', customEnd: '' })).isInvalid).toBe(true)
    expect(getTimelineCollected(b, 'CUSTOM', opts({ customStart: '2026-13-40', customEnd: '2026-08-11' })).isInvalid).toBe(true)
  })
})

describe('C5 — Custom valid same-day 2026-03-05 → 2026-03-05 includes only March 5', () => {
  it('half-open [2026-03-05, 2026-03-06); Mar 5 in, Mar 6 out', () => {
    const b = backup({
      serviceLogs: [
        svcDated('s-in', 1000, '2026-03-05'),
        svcDated('s-out', 5000, '2026-03-06'),
      ],
    })
    const t = getTimelineCollected(b, 'CUSTOM', opts({ customStart: '2026-03-05', customEnd: '2026-03-05' }))
    expect(t.isInvalid).toBe(false)
    expect(t.range.startInclusive).toEqual(new Date('2026-03-05T00:00:00.000Z'))
    expect(t.range.endExclusive).toEqual(new Date('2026-03-06T00:00:00.000Z'))
    expect(t.provenance.knownTotal).toBe(1000)
    expect(t.displayValue).toBe(1000)
  })
})

describe('C6 — Custom valid range 2026-03-01 → 2026-03-31 includes both ends', () => {
  it('half-open [2026-03-01, 2026-04-01); Mar 1 + Mar 31 in, Feb 28 + Apr 1 out', () => {
    const b = backup({
      serviceLogs: [
        svcDated('s-mar1', 1000, '2026-03-01'),
        svcDated('s-mar31', 2000, '2026-03-31'),
        svcDated('s-feb28', 4000, '2026-02-28'),
        svcDated('s-apr1', 8000, '2026-04-01'),
      ],
    })
    const t = getTimelineCollected(b, 'CUSTOM', opts({ customStart: '2026-03-01', customEnd: '2026-03-31' }))
    expect(t.isInvalid).toBe(false)
    expect(t.range.startInclusive).toEqual(new Date('2026-03-01T00:00:00.000Z'))
    expect(t.range.endExclusive).toEqual(new Date('2026-04-01T00:00:00.000Z'))
    expect(t.provenance.knownTotal).toBe(3000)
    expect(t.displayValue).toBe(3000)
  })
})

describe('C7 — ALL_TIME explicitly selected → lifetimeTotal still displayed', () => {
  it('isAllTime true, isInvalid false, displayValue = lifetimeTotal', () => {
    const b = backup({ serviceLogs: [svcDated('s1', 1000, '2026-06-15'), svcUndated('s-leg', 2000)] })
    const t = getTimelineCollected(b, 'ALL_TIME', opts())
    expect(t.isAllTime).toBe(true)
    expect(t.isInvalid).toBe(false)
    expect(t.displayValue).toBe(t.provenance.lifetimeTotal)
    expect(t.displayValue).toBe(3000)
  })
})

describe('C8 — Annual Target stays current-year regardless of incomplete Custom', () => {
  it('an invalid CUSTOM displayValue is null (never mistaken for the annual numerator); the annual numerator is invariant', () => {
    const b = backup({ serviceLogs: [svcDated('s1', 5000, '2026-03-10')] })
    const annualNumerator = getCurrentYearCollectedRevenue(b, 2026).knownTotal
    expect(annualNumerator).toBe(5000)
    const invalidCustom = getTimelineCollected(b, 'CUSTOM', opts())
    expect(invalidCustom.displayValue).toBeNull()
    // The Annual Target numerator is a pure function of backup + current year,
    // independent of the selected preset and of an incomplete Custom range.
    expect(getCurrentYearCollectedRevenue(b, 2026).knownTotal).toBe(annualNumerator)
  })
})

// ── Unknown-date cash is never fabricated into a precise period ───────────────

describe('T11 — undated legacy service cash is NOT fabricated into a precise period', () => {
  it('LAST_90_DAYS knownTotal excludes undated; ALL_TIME displayValue includes it', () => {
    const b = backup({
      serviceLogs: [svcDated('s-in', 1000, '2026-06-15'), svcUndated('s-leg', 2000)],
    })
    const t90 = getTimelineCollected(b, 'LAST_90_DAYS', opts())
    expect(t90.provenance.knownTotal).toBe(1000)
    expect(t90.provenance.unknownDateTotal).toBe(2000)
    expect(t90.displayValue).toBe(1000) // precise → undated NOT fabricated in

    const tAll = getTimelineCollected(b, 'ALL_TIME', opts())
    expect(tAll.displayValue).toBe(3000) // lifetime → undated visible
    expect(tAll.provenance.knownTotal).toBe(1000)
    expect(tAll.provenance.unknownDateTotal).toBe(2000)
  })
})

describe('T12 — synthetic paid-backfill project log is unknown-date, lifetime only', () => {
  it('precise range excludes backfill from knownTotal; ALL_TIME includes it', () => {
    const b = backup({
      logs: [
        projBackfill('log-paidbackfill-1', 'p1', '2026-06-15', 5000),
        projDated('log-1', 'p1', '2026-06-16', 1000),
      ],
    })
    const t90 = getTimelineCollected(b, 'LAST_90_DAYS', opts())
    expect(t90.provenance.knownTotal).toBe(1000) // backfill NOT known-dated
    expect(t90.provenance.unknownDateTotal).toBe(5000)
    expect(t90.displayValue).toBe(1000)

    const tAll = getTimelineCollected(b, 'ALL_TIME', opts())
    expect(tAll.displayValue).toBe(6000) // lifetime includes backfill
  })
})

// ── Single authority & semantics ──────────────────────────────────────────────

describe('T13 — CURRENT_YEAR shares the existing current-year authority', () => {
  it('displayValue equals getCurrentYearCollectedRevenue(backup, year).knownTotal', () => {
    const b = backup({ serviceLogs: [svcDated('s1', 1500, '2026-03-10')] })
    const t = getTimelineCollected(b, 'CURRENT_YEAR', opts())
    expect(t.displayValue).toBe(getCurrentYearCollectedRevenue(b, 2026).knownTotal)
  })
})

describe('T14 — resolveTimelineRange is idempotent', () => {
  it('resolving twice yields the same half-open bounds', () => {
    const o = opts({ customStart: '2026-03-01', customEnd: '2026-06-30' })
    const a = resolveTimelineRange('CUSTOM', o)
    const b2 = resolveTimelineRange('CUSTOM', o)
    expect(b2.startInclusive).toEqual(a.startInclusive)
    expect(b2.endExclusive).toEqual(a.endExclusive)
    expect(b2.isAllTime).toBe(a.isAllTime)
  })
})

describe('T15 — resolving does not mutate a deep-frozen input', () => {
  it('a deep-frozen backup resolves without throwing and stays byte-identical', () => {
    const b = backup({
      serviceLogs: [svcDated('s1', 1000, '2026-06-15'), svcUndated('s-leg', 2000)],
      logs: [projBackfill('log-paidbackfill-1', 'p1', '2026-06-15', 5000)],
    })
    const snapshot = JSON.parse(JSON.stringify(b))
    const frozen = deepFreeze(JSON.parse(JSON.stringify(b)))
    expect(() => getTimelineCollected(frozen, 'LAST_90_DAYS', opts())).not.toThrow()
    expect(JSON.stringify(b.serviceLogs)).toBe(JSON.stringify(snapshot.serviceLogs))
    expect(JSON.stringify(b.logs)).toBe(JSON.stringify(snapshot.logs))
  })
})

describe('T16 — Demo Mode safety: every preset yields a finite demo-universe value', () => {
  it('getTimelineCollected(getDemoBackupData(), preset) is finite for all presets', () => {
    for (const preset of ALL_PRESETS) {
      const t = getTimelineCollected(getDemoBackupData(), preset, opts({ customStart: '2026-01-01', customEnd: '2026-08-11' }))
      expect(Number.isFinite(t.displayValue)).toBe(true)
      expect(Number.isFinite(t.provenance.knownTotal)).toBe(true)
      expect(Number.isFinite(t.provenance.lifetimeTotal)).toBe(true)
    }
  })

  it('an empty real backup yields 0 known for precise presets and 0 lifetime for ALL_TIME', () => {
    for (const preset of ALL_PRESETS) {
      const t = getTimelineCollected(createEmptyBackup(), preset, opts({ customStart: '2026-01-01', customEnd: '2026-08-11' }))
      if (t.isAllTime) expect(t.displayValue).toBe(0)
      else expect(t.provenance.knownTotal).toBe(0)
    }
  })
})

describe('T17 — Annual Target isolation: preset selection never changes the current-year numerator', () => {
  it('the current-year known authority is invariant across preset selection', () => {
    const b = backup({ serviceLogs: [svcDated('s1', 5000, '2026-03-10')] })
    const annualNumerator = getCurrentYearCollectedRevenue(b, 2026).knownTotal
    expect(annualNumerator).toBe(5000)
    // Selecting other presets produces different displayValues, but the Annual
    // Target numerator (current-year known collected) is a pure function of the
    // backup + year — never of the selected preset.
    const others: TimelinePreset[] = ['LAST_90_DAYS', 'THIS_MONTH', 'ALL_TIME', 'PREVIOUS_YEAR']
    const displays = others.map(p => getTimelineCollected(b, p, opts()).displayValue)
    // THIS_MONTH (Aug) and LAST_90_DAYS (May14–Aug12) both exclude the March payment → 0.
    expect(displays[0]).toBe(0)
    expect(displays[1]).toBe(0)
    expect(displays[2]).toBe(5000) // ALL_TIME lifetime
    expect(displays[3]).toBe(0) // previous year
    for (const _p of others) {
      expect(getCurrentYearCollectedRevenue(b, 2026).knownTotal).toBe(annualNumerator)
    }
  })
})

describe('T18 — displayValue semantics: knownTotal (precise) / lifetimeTotal (ALL_TIME)', () => {
  it('precise presets show knownTotal; ALL_TIME shows lifetimeTotal', () => {
    const b = backup({ serviceLogs: [svcDated('s1', 1000, '2026-06-15'), svcUndated('s2', 2000)] })
    expect(getTimelineCollected(b, 'CURRENT_YEAR', opts()).displayValue).toBe(1000)
    expect(getTimelineCollected(b, 'LAST_90_DAYS', opts()).displayValue).toBe(1000)
    expect(getTimelineCollected(b, 'THIS_MONTH', opts()).displayValue).toBe(0) // June cash not in Aug
    expect(getTimelineCollected(b, 'ALL_TIME', opts()).displayValue).toBe(3000)
  })
})

// ── Preset catalog ────────────────────────────────────────────────────────────

describe('TIMELINE_PRESETS catalog', () => {
  it('exposes all eight presets in dropdown order', () => {
    const values = TIMELINE_PRESETS.map(p => p.value)
    expect(values).toEqual([
      'CURRENT_YEAR', 'PREVIOUS_YEAR', 'LAST_6_MONTHS', 'LAST_3_MONTHS',
      'LAST_90_DAYS', 'THIS_MONTH', 'ALL_TIME', 'CUSTOM',
    ])
    for (const p of TIMELINE_PRESETS) {
      expect(typeof p.short).toBe('string')
      expect(typeof p.label).toBe('string')
    }
  })

  it('every preset has a stable human-readable range label', () => {
    const labels: Record<TimelinePreset, string> = {
      CURRENT_YEAR: 'Current Year',
      PREVIOUS_YEAR: 'Previous Year',
      LAST_6_MONTHS: 'Last 6 Months',
      LAST_3_MONTHS: 'Last 3 Months',
      LAST_90_DAYS: 'Last 90 Days',
      THIS_MONTH: 'This Month',
      ALL_TIME: 'All Time',
      CUSTOM: 'Custom',
    }
    for (const preset of ALL_PRESETS) {
      expect(resolveTimelineRange(preset, opts({ customStart: '2026-01-01', customEnd: '2026-08-11' })).label).toBe(labels[preset])
    }
  })
})