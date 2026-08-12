import { describe, expect, it } from 'vitest'
import { resolveWeeklyDataForRead, calculateWeeklyFinancialsForRange } from '@/services/weeklyFinancialPolicy'
import { getKPIs, type BackupData } from '@/services/backupDataService'
import { getCurrentYearCollectedRevenue } from '@/services/collectedRevenueRange'

/**
 * FORENSIC-KPI-2B2-2H — controlled tests for the AUTOMATIC canonical 52-week derive.
 *
 * The 52-week view is a pure/automatic derived view of canonical dated cash. These
 * tests prove the owner never needs to click "Recalculate from Data": canonical
 * records change → resolveWeeklyDataForRead reflects them on the next read, with
 * no save / reload / sync. Manual overrides are preserved; the accum chain is
 * deterministic; the source is not mutated; the result is idempotent; and resolving
 * the 52-week view changes no Header KPI.
 */

const NOW = new Date('2026-08-11T12:00:00.000Z')

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildWeeks(startMondayIso: string, count: number): any[] {
  const base = new Date(startMondayIso + 'T00:00:00.000Z').getTime()
  const rows: any[] = []
  for (let wk = 1; wk <= count; wk++) {
    const startMs = base + (wk - 1) * 7 * 86_400_000
    rows.push({
      wk,
      start: new Date(startMs).toISOString().slice(0, 10),
      proj: 0,
      svc: 0,
      unbilled: 0,
      pendingInv: 0,
      accum: 0,
      manualOverride: false,
    })
  }
  return rows
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const v of Object.values(value as any)) deepFreeze(v)
  }
  return value
}

/** Find the weekly row whose half-open [start, start+7d) range contains `dateStr`. */
function findWeekContaining(rows: any[], dateStr: string): any {
  const ms = new Date(dateStr + 'T00:00:00.000Z').getTime()
  return rows.find(r => {
    const start = new Date(r.start + 'T00:00:00.000Z').getTime()
    return ms >= start && ms < start + 7 * 86_400_000
  })
}

function serviceLog(id: string, quoted: number, collected: number, receivedAt?: string): any {
  const log: any = { id, serviceLogId: id, quoted, collected }
  if (receivedAt) {
    log.payments = [
      { id: `${id}-pay`, amount: collected, receivedAt, recordedAt: NOW.toISOString(), kind: 'payment', voidedAt: null },
    ]
  }
  return log
}

function projectLog(id: string, projectId: string, date: string, collected: number, extra: Record<string, any> = {}): any {
  return { id, projectId, date, collected, paymentsCollected: collected, hrs: 0, ...extra }
}

function activeProject(id: string, contract = 0, billed = 0, paid = 0, extra: Record<string, any> = {}): any {
  return { id, name: id, status: 'active', contract, billed, paid, rfis: [], ...extra }
}

/** 52 weeks starting Monday 2026-01-05, spanning all of 2026. */
function year2026Backup(extra: Record<string, any> = {}): BackupData {
  return {
    projects: [],
    logs: [],
    serviceLogs: [],
    settings: { dayTarget: 200, annualTarget: 100000 } as any,
    weeklyData: buildWeeks('2026-01-05', 52),
    ...extra,
  } as unknown as BackupData
}

// ── A1: automatic service update (no recalc/save) ─────────────────────────────

describe('A1 — service payment date change reflects automatically without recalc/save', () => {
  it('payment +500 @ 2026-02-10 lands in the Feb week; moving it to 2026-03-10 moves the cash with NO save', () => {
    const before = year2026Backup({
      serviceLogs: [serviceLog('s1', 500, 500, '2026-02-10')],
    })
    const beforeRows = resolveWeeklyDataForRead(before, NOW)
    const febWk = findWeekContaining(beforeRows, '2026-02-10')
    expect(febWk).toBeTruthy()
    expect(febWk.svc).toBeCloseTo(500, 2)

    // Mutate canonical fixture (no save, no reload, no recalc button) and re-resolve.
    const after = deepClone(before)
    ;(after.serviceLogs as any[])[0].payments[0].receivedAt = '2026-03-10'
    const afterRows = resolveWeeklyDataForRead(after, NOW)
    expect(findWeekContaining(afterRows, '2026-02-10').svc).toBeCloseTo(0, 2)
    expect(findWeekContaining(afterRows, '2026-03-10').svc).toBeCloseTo(500, 2)
  })
})

// ── A2: historical resolution auto-flow ───────────────────────────────────────

describe('A2 — legacy undated service cash has no weekly bucket until resolved to a date', () => {
  it('undated 951.39 appears in NO weekly bucket; resolving to 2025-07-15 flows it into that week', () => {
    // Weekly rows spanning mid-2025 so 2025-07-15 is in range; now is after them.
    const weeks = buildWeeks('2025-07-14', 6)
    const undated: BackupData = {
      projects: [],
      logs: [],
      serviceLogs: [serviceLog('s-leg', 951.39, 951.39)], // scalar collected, NO payments
      settings: {} as any,
      weeklyData: weeks,
    } as unknown as BackupData
    const undatedRows = resolveWeeklyDataForRead(undated, new Date('2025-08-15T12:00:00.000Z'))
    const derivedSvcSum = undatedRows.reduce((s, r) => s + r.svc, 0)
    expect(derivedSvcSum).toBeCloseTo(0, 2) // lifetime cash only — no weekly bucket

    // Resolve the fixture to a dated payment and re-resolve (no save).
    const resolved = deepClone(undated)
    ;(resolved.serviceLogs as any[])[0].payments = [
      { id: 's-leg-pay', amount: 951.39, receivedAt: '2025-07-15', recordedAt: '2025-08-15T00:00:00.000Z', kind: 'payment', voidedAt: null },
    ]
    const resolvedRows = resolveWeeklyDataForRead(resolved, new Date('2025-08-15T12:00:00.000Z'))
    const wk = findWeekContaining(resolvedRows, '2025-07-15')
    expect(wk).toBeTruthy()
    expect(wk.svc).toBeCloseTo(951.39, 2)
  })
})

// ── A3: genuine project payment ───────────────────────────────────────────────

describe('A3 — genuine dated project payment lands in its actual week', () => {
  it('genuine project payment 3000 @ 2026-05-10 → that week proj +3000', () => {
    const backup = year2026Backup({
      projects: [activeProject('p1', 10000, 0, 3000)],
      logs: [projectLog('log-1', 'p1', '2026-05-10', 3000)],
    })
    const rows = resolveWeeklyDataForRead(backup, NOW)
    const wk = findWeekContaining(rows, '2026-05-10')
    expect(wk).toBeTruthy()
    expect(wk.proj).toBeCloseTo(3000, 2)
  })
})

// ── A4: synthetic project backfill excluded from weekly bucket ───────────────

describe('A4 — synthetic paid-scalar backfill gets NO precise weekly bucket', () => {
  it('log-paidbackfill- 10000 dated 2026-07-20 contributes 0 to weekly proj', () => {
    const backup = year2026Backup({
      projects: [activeProject('p1', 50000, 20000, 10000)],
      logs: [
        projectLog('log-paidbackfill-001', 'p1', '2026-07-20', 10000, {
          notes: 'Backfilled from p.paid scalar (CFOT-COLLECTION-PATH-PARITY migration)',
        }),
      ],
    })
    const rows = resolveWeeklyDataForRead(backup, NOW)
    const wk = findWeekContaining(rows, '2026-07-20')
    expect(wk).toBeTruthy()
    // Synthetic backfill is NOT precise cash-date authority → excluded from the week.
    expect(wk.proj).toBeCloseTo(0, 2)
    // No derived week reports the backfill as dated project cash.
    const derivedProjSum = rows.filter(r => r.manualOverride !== true).reduce((s, r) => s + r.proj, 0)
    expect(derivedProjSum).toBeCloseTo(0, 2)
    // Lifetime cash still keeps it (collectedRevenueRange), proven elsewhere.
    const lifetime = getCurrentYearCollectedRevenue(backup, 2026).lifetimeTotal
    expect(lifetime).toBeCloseTo(10000, 2)
  })
})

// ── A5: manualPaidAdjustment gets no precise week ─────────────────────────────

describe('A5 — manualPaidAdjustment is never assigned a precise week', () => {
  it('project.finance.manualPaidAdjustment 5000 appears in no weekly proj bucket', () => {
    const backup = year2026Backup({
      projects: [activeProject('p1', 10000, 0, 5000, { finance: { manualPaidAdjustment: 5000 } })],
      logs: [],
    })
    const rows = resolveWeeklyDataForRead(backup, NOW)
    const derivedProjSum = rows.reduce((s, r) => s + r.proj, 0)
    expect(derivedProjSum).toBeCloseTo(0, 2)
  })
})

// ── A6: manual override preservation ──────────────────────────────────────────

describe('A6 — manual override row is preserved over the derived value', () => {
  it('stored manualOverride proj 1200 / svc 700 beats the derived proj 1000 / svc 500', () => {
    // Canonical would derive proj 1000 (genuine log) + svc 500 (dated service) for wk 6.
    const base = year2026Backup({
      projects: [activeProject('p1', 10000, 0, 1000)],
      logs: [projectLog('log-1', 'p1', '2026-02-10', 1000)],
      serviceLogs: [serviceLog('s1', 500, 500, '2026-02-10')],
    })
    const wk6Start = findWeekContaining(base.weeklyData as any[], '2026-02-10').start
    // Owner manually overrides that same week with proj 1200 / svc 700.
    const backup = deepClone(base)
    ;(backup.weeklyData as any[]).forEach((r: any) => {
      if (r.start === wk6Start) {
        r.manualOverride = true
        r.proj = 1200
        r.svc = 700
        r.accum = 1900
        r.weeklyUpdatedAt = '2026-06-01T00:00:00.000Z'
      }
    })
    const rows = resolveWeeklyDataForRead(backup, NOW)
    const manual = rows.find(r => r.start === wk6Start)
    expect(manual).toBeTruthy()
    if (!manual) return
    expect(manual.manualOverride).toBe(true)
    expect(manual.proj).toBe(1200)
    expect(manual.svc).toBe(700)
  })
})

// ── A7: accum chain ───────────────────────────────────────────────────────────

describe('A7 — accum accumulates chronologically with no gaps or double-count', () => {
  it('derived + manual rows form a correct cumulative chain', () => {
    const base = year2026Backup({
      projects: [activeProject('p1', 100000, 0, 0)],
      logs: [
        projectLog('log-1', 'p1', '2026-01-07', 1000), // week 1
        projectLog('log-3', 'p1', '2026-01-21', 300), // week 3
      ],
    })
    // Owner manual override on week 2: proj 500 / svc 500.
    const backup = deepClone(base)
    const wk2 = (backup.weeklyData as any[])[1]
    wk2.manualOverride = true
    wk2.proj = 500
    wk2.svc = 500
    wk2.accum = 2000
    const rows = resolveWeeklyDataForRead(backup, NOW)
    // wk1 derived: proj 1000, svc 0 → accum 1000
    expect(rows[0].proj).toBeCloseTo(1000, 2)
    expect(rows[0].accum).toBeCloseTo(1000, 2)
    // wk2 manual: preserved (proj 500 / svc 500); running accum advances by 1000.
    expect(rows[1].manualOverride).toBe(true)
    expect(rows[1].proj).toBe(500)
    // wk3 derived: proj 300 → accum = (running 2000) + 300 = 2300
    expect(rows[2].proj).toBeCloseTo(300, 2)
    expect(rows[2].accum).toBeCloseTo(2300, 2)
  })
})

// ── A8: source immutability ───────────────────────────────────────────────────

describe('A8 — resolving does not mutate a deep-frozen canonical input', () => {
  it('a deep-frozen backup resolves without throwing and is byte-identical after', () => {
    const backup = year2026Backup({
      projects: [activeProject('p1', 10000, 0, 1000)],
      logs: [projectLog('log-1', 'p1', '2026-02-10', 1000)],
      serviceLogs: [serviceLog('s1', 500, 500, '2026-02-10')],
    })
    const snapshot = deepClone(backup)
    const frozen = deepFreeze(deepClone(backup))
    expect(() => resolveWeeklyDataForRead(frozen, NOW)).not.toThrow()
    expect(JSON.stringify(backup.projects)).toBe(JSON.stringify(snapshot.projects))
    expect(JSON.stringify(backup.logs)).toBe(JSON.stringify(snapshot.logs))
    expect(JSON.stringify(backup.serviceLogs)).toBe(JSON.stringify(snapshot.serviceLogs))
    expect(JSON.stringify(backup.weeklyData)).toBe(JSON.stringify(snapshot.weeklyData))
  })
})

// ── A9: idempotency ───────────────────────────────────────────────────────────

describe('A9 — resolveWeeklyDataForRead is idempotent', () => {
  it('resolve(resolve(input)) carries the same derived values as resolve(input)', () => {
    const backup = year2026Backup({
      projects: [activeProject('p1', 10000, 0, 1000)],
      logs: [projectLog('log-1', 'p1', '2026-02-10', 1000)],
      serviceLogs: [serviceLog('s1', 500, 500, '2026-02-10')],
    })
    const once = resolveWeeklyDataForRead(backup, NOW)
    // Feed the derived rows back in as the weeklyData scaffolding — only wk + start
    // are read for non-manual rows, so a second pass yields identical derived values.
    const twice = resolveWeeklyDataForRead({ ...backup, weeklyData: once } as any, NOW)
    const strip = (rows: any[]) =>
      rows.map(r => ({ wk: r.wk, proj: r.proj, svc: r.svc, unbilled: r.unbilled, pendingInv: r.pendingInv, accum: r.accum, manualOverride: r.manualOverride }))
    expect(strip(twice)).toEqual(strip(once))
  })
})

// ── A11: header stability ─────────────────────────────────────────────────────

describe('A11 — resolving the 52-week view changes no Header KPI', () => {
  it('Pipeline / Paid YTD / Exposure / Service Unbilled / Open Projects / Open RFIs are stable across resolve', () => {
    const backup = year2026Backup({
      projects: [activeProject('p1', 10000, 2500, 1000)],
      logs: [projectLog('log-1', 'p1', '2026-02-10', 1000)],
      serviceLogs: [serviceLog('s1', 500, 500, '2026-02-10')],
    })
    const snapshot = deepClone(backup)
    // Resolve (the act under test).
    resolveWeeklyDataForRead(backup, NOW)
    // Canonical arrays untouched.
    expect(JSON.stringify(backup.projects)).toBe(JSON.stringify(snapshot.projects))
    expect(JSON.stringify(backup.logs)).toBe(JSON.stringify(snapshot.logs))
    expect(JSON.stringify(backup.serviceLogs)).toBe(JSON.stringify(snapshot.serviceLogs))
    // Header KPIs (read via fresh clones — getKPIs writes inside a read) unchanged.
    const kpiBefore = getKPIs(deepClone(snapshot))
    const kpiAfter = getKPIs(deepClone(backup))
    for (const key of ['pipeline', 'paid', 'billed', 'exposure', 'svcUnbilled', 'openRfis', 'activeProjects'] as const) {
      expect(kpiAfter[key]).toBe(kpiBefore[key])
    }
    // Paid YTD (current-year known collected) unchanged.
    const ytdBefore = getCurrentYearCollectedRevenue(snapshot, 2026).knownTotal
    const ytdAfter = getCurrentYearCollectedRevenue(backup, 2026).knownTotal
    expect(ytdAfter).toBeCloseTo(ytdBefore, 2)
  })
})

// ── Range consistency: reader agrees with per-range calculation ───────────────

describe('reader row agrees with calculateWeeklyFinancialsForRange for the same week', () => {
  it('a derived week proj/svc equals the direct range calculation for that week', () => {
    const backup = year2026Backup({
      projects: [activeProject('p1', 10000, 0, 1000)],
      logs: [projectLog('log-1', 'p1', '2026-02-10', 1000)],
      serviceLogs: [serviceLog('s1', 500, 500, '2026-02-10')],
    })
    const rows = resolveWeeklyDataForRead(backup, NOW)
    const wk = findWeekContaining(rows, '2026-02-10')
    const start = new Date(wk.start + 'T00:00:00.000Z')
    const end = new Date(start.getTime() + 7 * 86_400_000)
    const direct = calculateWeeklyFinancialsForRange(backup, start, end)
    expect(wk.proj).toBeCloseTo(direct.proj, 2)
    expect(wk.svc).toBeCloseTo(direct.svc, 2)
  })
})