import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  recalculateWeeklyData,
} from '@/services/weeklyFinancialPolicy'
import {
  buildWeeklyRecalcOutgoing,
  mergeWeeklyDataIntoRemote,
} from '@/services/weeklyDataScopeMerge'
import { getKPIs, type BackupData } from '@/services/backupDataService'
import { getCurrentYearCollectedRevenue } from '@/services/collectedRevenueRange'
import { getServiceCashForRange } from '@/features/service-quote/serviceCashDate'

/**
 * FORENSIC-KPI-2B2-2F — 52-Week "Recalculate from my data" must NOT mutate canonical
 * financial truth. A reporting recalculation rebuilds the derived weeklyData cache
 * from current source truth; it must not change Header KPIs (Pipeline / Paid YTD /
 * Exposure / Service Unbilled / Open Projects / Open RFIs), which read canonical
 * projects/logs/serviceLogs via getKPIs.
 *
 * Root cause (proven below): the handler previously built
 *   merged = mergeWeeklyDataIntoRemote(remote, local)
 * and passed the whole blob to saveBackupWithRemoteBaselineSync. That blob is a
 * clone of the REMOTE snapshot with only weeklyData swapped, so its canonical arrays
 * are remote's. saveBackupWithRemoteBaselineSync → mergeScopedIncomingIntoLocal then
 * folded those remote canonical arrays into local (it ignores _scopes), so after the
 * post-save reload the Header KPIs changed to reflect remote canonical.
 *
 * Fix: buildWeeklyRecalcOutgoing(local, remote, recalced) pairs the SAME weeklyData
 * merge result with LOCAL canonical, so mergeScopedIncomingIntoLocal(local, outgoing)
 * merges local→local for every canonical key (a no-op under prefer-newer id merge) and
 * only weeklyData moves. These tests prove that with a controlled fixture where remote
 * canonical is INTENTIONALLY different from local canonical.
 */

const NOW_ISO = '2026-08-11T12:00:00.000Z'

// ── Fixture builders ───────────────────────────────────────────────────────────

/** 52 weekly rows, wk 1..52, starting Monday 2026-01-05, UTC-midnight start dates. */
function buildWeeklyRows(): any[] {
  const rows: any[] = []
  const base = new Date('2026-01-05T00:00:00.000Z').getTime()
  for (let wk = 1; wk <= 52; wk++) {
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
      weeklyUpdatedAt: '2025-12-01T00:00:00.000Z',
      derivedAt: '2025-12-01T00:00:00.000Z',
    })
  }
  return rows
}

function localBackup(): BackupData {
  return {
    projects: [
      {
        id: 'p1',
        name: 'Project One',
        status: 'active',
        contract: 50000,
        billed: 20000,
        paid: 10000,
        rfis: [],
      },
    ],
    logs: [
      {
        id: 'log-1',
        projectId: 'p1',
        date: '2026-03-10',
        collected: 10000,
        paymentsCollected: 10000,
        hrs: 8,
      },
    ],
    serviceLogs: [
      // S1: scalar collected, NO payment date → unknown-date legacy cash.
      { id: 's1', serviceLogId: 's1', quoted: 5000, collected: 5000 },
      // S2: dated 2026-05-15 → known dated service cash in that week.
      {
        id: 's2',
        serviceLogId: 's2',
        quoted: 3000,
        collected: 3000,
        payments: [
          {
            id: 's2-pay',
            amount: 3000,
            receivedAt: '2026-05-15',
            recordedAt: '2026-05-16T00:00:00.000Z',
            kind: 'payment',
            voidedAt: null,
          },
        ],
      },
    ],
    settings: { dayTarget: 200, annualTarget: 100000 } as any,
    weeklyData: buildWeeklyRows(),
  } as unknown as BackupData
}

/**
 * Remote canonical is INTENTIONALLY different from local: project paid is 99999,
 * service S1 collected is 9999. If the recalc adopts remote canonical, Header KPIs
 * change. The fix must keep local canonical. Remote also carries a manual weekly
 * override row that must survive the recalc.
 */
function remoteBackup(): BackupData {
  return {
    projects: [{ id: 'p1', name: 'Project One', status: 'active', contract: 50000, billed: 20000, paid: 99999, rfis: [] }],
    logs: [{ id: 'log-1', projectId: 'p1', date: '2026-03-10', collected: 99999, paymentsCollected: 99999, hrs: 8 }],
    serviceLogs: [{ id: 's1', serviceLogId: 's1', quoted: 5000, collected: 9999 }],
    settings: { dayTarget: 200, annualTarget: 100000 } as any,
    weeklyData: [
      // Manual override on wk 10 — must be preserved (never clobbered by recalc).
      {
        wk: 10,
        start: new Date(new Date('2026-01-05T00:00:00.000Z').getTime() + 9 * 7 * 86_400_000).toISOString().slice(0, 10),
        proj: 1234,
        svc: 567,
        unbilled: 0,
        pendingInv: 0,
        accum: 1801,
        manualOverride: true,
        weeklyUpdatedAt: '2026-06-01T00:00:00.000Z',
        derivedAt: '2026-06-01T00:00:00.000Z',
        note: 'owner manual entry',
      },
    ],
  } as unknown as BackupData
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

// ── R1: source immutability ────────────────────────────────────────────────────

describe('FORENSIC-KPI-2B2-2F R1 — recalculation does not mutate canonical source', () => {
  it('recalculateWeeklyData is pure: a deep-frozen input is not mutated', () => {
    const local = deepFreeze(deepClone(localBackup()))
    const snapshotBefore = deepClone(localBackup())
    // Must not throw: pure helpers use map/filter/reduce/spread, never in-place
    // sort/push/splice/assignment into the source.
    expect(() => recalculateWeeklyData(local, NOW_ISO)).not.toThrow()
    // Canonical arrays + settings are byte-identical to the pre-recalc snapshot.
    expect(JSON.stringify(local.projects)).toBe(JSON.stringify(snapshotBefore.projects))
    expect(JSON.stringify(local.logs)).toBe(JSON.stringify(snapshotBefore.logs))
    expect(JSON.stringify(local.serviceLogs)).toBe(JSON.stringify(snapshotBefore.serviceLogs))
    expect(JSON.stringify((local as any).settings)).toBe(JSON.stringify((snapshotBefore as any).settings))
  })

  it('buildWeeklyRecalcOutgoing is pure: frozen local + remote inputs are not mutated', () => {
    const local = deepFreeze(deepClone(localBackup()))
    const remote = deepFreeze(deepClone(remoteBackup()))
    const recalced = recalculateWeeklyData(deepClone(localBackup()), NOW_ISO)
    const localBefore = deepClone(localBackup())
    const remoteBefore = deepClone(remoteBackup())
    expect(() => buildWeeklyRecalcOutgoing(local, remote, recalced)).not.toThrow()
    expect(JSON.stringify(local.projects)).toBe(JSON.stringify(localBefore.projects))
    expect(JSON.stringify(local.serviceLogs)).toBe(JSON.stringify(localBefore.serviceLogs))
    expect(JSON.stringify(remote.projects)).toBe(JSON.stringify(remoteBefore.projects))
  })
})

// ── Core contrast: old leak vs fix ─────────────────────────────────────────────

describe('FORENSIC-KPI-2B2-2F — old outgoing adopted remote canonical; fix keeps local', () => {
  it('OLD mergeWeeklyDataIntoRemote carries REMOTE canonical (the leak)', () => {
    const local = localBackup()
    const remote = remoteBackup()
    const recalced = recalculateWeeklyData(local, NOW_ISO)
    const oldOutgoing = mergeWeeklyDataIntoRemote(remote, { ...local, weeklyData: recalced })
    // The old blob's canonical is remote's: paid 99999, not local's 10000.
    expect((oldOutgoing.projects[0] as any).paid).toBe(99999)
    expect((oldOutgoing.serviceLogs[0] as any).collected).toBe(9999)
  })

  it('NEW buildWeeklyRecalcOutgoing keeps LOCAL canonical', () => {
    const local = localBackup()
    const remote = remoteBackup()
    const recalced = recalculateWeeklyData(local, NOW_ISO)
    const outgoing = buildWeeklyRecalcOutgoing(local, remote, recalced)
    // Canonical arrays are local's, not remote's.
    expect((outgoing.projects[0] as any).paid).toBe(10000)
    expect((outgoing.serviceLogs[0] as any).collected).toBe(5000)
    expect(outgoing.projects).toBe(local.projects)
    expect(outgoing.logs).toBe(local.logs)
    expect(outgoing.serviceLogs).toBe(local.serviceLogs)
  })

  it('NEW outgoing weeklyData equals the OLD weeklyData result (same merge, different base)', () => {
    const local = localBackup()
    const remote = remoteBackup()
    const recalced = recalculateWeeklyData(local, NOW_ISO)
    const oldOutgoing = mergeWeeklyDataIntoRemote(remote, { ...local, weeklyData: recalced })
    const outgoing = buildWeeklyRecalcOutgoing(local, remote, recalced)
    // The weeklyData cache is reconciled identically; only the canonical base differs.
    expect(JSON.stringify(outgoing.weeklyData)).toBe(JSON.stringify(oldOutgoing.weeklyData))
    // Remote manual override row survives in both.
    const manual = (outgoing.weeklyData as any[]).find(r => r.manualOverride === true)
    expect(manual).toBeTruthy()
    expect(manual.proj).toBe(1234)
    expect(manual.svc).toBe(567)
  })
})

// ── R2: Header KPI stability ───────────────────────────────────────────────────

describe('FORENSIC-KPI-2B2-2F R2 — Header KPIs are stable across the recalc', () => {
  it('getKPIs(outgoing) deep-equals getKPIs(local); the old outgoing would have changed them', () => {
    const local = localBackup()
    const remote = remoteBackup()
    const recalced = recalculateWeeklyData(local, NOW_ISO)
    const outgoing = buildWeeklyRecalcOutgoing(local, remote, recalced)

    // getKPIs calls syncAllProjectFinanceBuckets(d) (a write inside a read), so pass
    // fresh deep clones — never the shared canonical refs.
    const kpiLocal = getKPIs(deepClone(local))
    const kpiOutgoing = getKPIs(deepClone(outgoing))
    expect(kpiOutgoing).toEqual(kpiLocal)

    // Negative proof: the OLD remote-canonical outgoing WOULD have changed KPIs.
    const oldOutgoing = mergeWeeklyDataIntoRemote(remote, { ...local, weeklyData: recalced })
    const kpiOld = getKPIs(deepClone(oldOutgoing))
    expect(kpiOld.paid).not.toBe(kpiLocal.paid)
  })

  it('every canonical-driven Header field is individually stable', () => {
    const local = localBackup()
    const recalced = recalculateWeeklyData(local, NOW_ISO)
    const outgoing = buildWeeklyRecalcOutgoing(local, remoteBackup(), recalced)
    const a = getKPIs(deepClone(local))
    const b = getKPIs(deepClone(outgoing))
    for (const key of ['pipeline', 'paid', 'billed', 'exposure', 'svcUnbilled', 'openRfis', 'totalHours', 'activeProjects'] as const) {
      expect(b[key]).toBe(a[key])
    }
  })
})

// ── R3: Paid YTD invariant ─────────────────────────────────────────────────────

describe('FORENSIC-KPI-2B2-2F R3 — Paid YTD (current-year known collected) invariant', () => {
  it('knownTotal is unchanged by the recalc (2026 known stays 2026 known; unknown stays unknown)', () => {
    const local = localBackup()
    const recalced = recalculateWeeklyData(local, NOW_ISO)
    const outgoing = buildWeeklyRecalcOutgoing(local, remoteBackup(), recalced)
    const before = getCurrentYearCollectedRevenue(local, 2026)
    const after = getCurrentYearCollectedRevenue(outgoing, 2026)
    // Local fixture 2026 known = project 10000 (log 2026-03-10) + service S2 3000
    // (receivedAt 2026-05-15) = 13000. S1 5000 is unknown-date → excluded from known.
    expect(before.knownTotal).toBeCloseTo(13000, 2)
    expect(after.knownTotal).toBeCloseTo(before.knownTotal, 2)
    // Unknown-date service cash is preserved (not reclassified by a reporting recalc).
    expect(after.serviceUnknownDateCash).toBeCloseTo(before.serviceUnknownDateCash, 2)
    expect(after.serviceUnknownDateCash).toBeCloseTo(5000, 2)
    // Lifetime unchanged.
    expect(after.lifetimeTotal).toBeCloseTo(before.lifetimeTotal, 2)
  })

  it('the OLD remote-canonical outgoing WOULD have changed Paid YTD', () => {
    const local = localBackup()
    const remote = remoteBackup()
    const recalced = recalculateWeeklyData(local, NOW_ISO)
    const oldOutgoing = mergeWeeklyDataIntoRemote(remote, { ...local, weeklyData: recalced })
    const before = getCurrentYearCollectedRevenue(local, 2026)
    const oldAfter = getCurrentYearCollectedRevenue(oldOutgoing, 2026)
    // Remote S1 is collected 9999 with no date → unknown-date, but remote project log
    // collected 99999 dated 2026-03-10 → knownTotal would jump to 99999 + 0 (remote
    // has no S2). Either way it must differ from local's 13000.
    expect(oldAfter.knownTotal).not.toBeCloseTo(before.knownTotal, 2)
  })
})

// ── R4: Service date authority (FLOW by receivedAt) ────────────────────────────

describe('FORENSIC-KPI-2B2-2F R4 — service cash flows by receivedAt, not work date', () => {
  it('the week containing 2026-05-15 carries S2 service cash; S1 unknown cash is not faked into any week', () => {
    const local = localBackup()
    const recalced = recalculateWeeklyData(local, NOW_ISO)
    const outgoing = buildWeeklyRecalcOutgoing(local, remoteBackup(), recalced)
    const wk = findWeekContaining(outgoing.weeklyData as any[], '2026-05-15')
    expect(wk).toBeTruthy()
    expect(wk.svc).toBeCloseTo(3000, 2)
    // No DERIVED week reports the unknown S1 5000 as dated service cash. (Manual
    // override rows are excluded — they are owner entries, not derived cash.)
    const derivedSvcSum = (outgoing.weeklyData as any[])
      .filter(r => r.manualOverride !== true)
      .reduce((s, r) => s + (r.svc || 0), 0)
    expect(derivedSvcSum).toBeCloseTo(3000, 2)
  })

  it('outgoing serviceLogs are local (untouched) so getServiceCashForRange matches local', () => {
    const local = localBackup()
    const recalced = recalculateWeeklyData(local, NOW_ISO)
    const outgoing = buildWeeklyRecalcOutgoing(local, remoteBackup(), recalced)
    const start = new Date('2026-01-01T00:00:00.000Z')
    const end = new Date('2027-01-01T00:00:00.000Z')
    const localCash = getServiceCashForRange(local.serviceLogs as any[], start, end)
    const outCash = getServiceCashForRange(outgoing.serviceLogs as any[], start, end)
    expect(outCash.knownDatedCash).toBeCloseTo(localCash.knownDatedCash, 2)
    expect(outCash.unknownDateCash).toBeCloseTo(localCash.unknownDateCash, 2)
    expect(outCash.lifetimeCash).toBeCloseTo(localCash.lifetimeCash, 2)
  })
})

// ── R5: Unknown-date cash excluded from period buckets, kept in lifetime ───────

describe('FORENSIC-KPI-2B2-2F R5 — unknown-date cash stays out of period buckets', () => {
  it('S1 5000 is lifetime cash but appears in no weekly svc bucket', () => {
    const local = localBackup()
    const recalced = recalculateWeeklyData(local, NOW_ISO)
    const outgoing = buildWeeklyRecalcOutgoing(local, remoteBackup(), recalced)
    const lifetime = getServiceCashForRange(
      outgoing.serviceLogs as any[],
      new Date('1970-01-01T00:00:00.000Z'),
      new Date('2100-01-01T00:00:00.000Z'),
    ).lifetimeCash
    expect(lifetime).toBeCloseTo(8000, 2) // S1 5000 (unknown) + S2 3000 (dated)
    // Derived weekly svc buckets total only the dated S2 3000; manual override rows
    // are excluded (owner entries, not derived cash), and the unknown S1 5000 appears
    // in NO weekly bucket — it is lifetime cash only.
    const derivedSvcSum = (outgoing.weeklyData as any[])
      .filter(r => r.manualOverride !== true)
      .reduce((s, r) => s + (r.svc || 0), 0)
    expect(derivedSvcSum).toBeCloseTo(3000, 2)
  })
})

// ── R6 / R7: half-open range bounds ────────────────────────────────────────────

describe('FORENSIC-KPI-2B2-2F R6/R7 — weekly ranges are half-open [start, start+7d)', () => {
  it('R7: a payment dated exactly on a week start IS included (start inclusive)', () => {
    const local = localBackup()
    // Place a service payment exactly on the Monday start of the week containing it.
    const startMonday = '2026-05-11' // Monday; week [2026-05-11, 2026-05-18)
    ;(local.serviceLogs as any[]).push({
      id: 's-edge-start',
      serviceLogId: 's-edge-start',
      quoted: 100,
      collected: 100,
      payments: [{ id: 's-edge-start-p', amount: 100, receivedAt: startMonday, recordedAt: NOW_ISO, kind: 'payment', voidedAt: null }],
    })
    const recalced = recalculateWeeklyData(local, NOW_ISO)
    const outgoing = buildWeeklyRecalcOutgoing(local, remoteBackup(), recalced)
    const wk = findWeekContaining(outgoing.weeklyData as any[], startMonday)
    expect(wk).toBeTruthy()
    expect(wk.start).toBe(startMonday)
    // 100 (edge-start) + 3000 (S2 on 2026-05-15, same week) = 3100.
    expect(wk.svc).toBeCloseTo(3100, 2)
  })

  it('R6: a payment dated exactly on a week END (start+7d) is NOT included (end exclusive)', () => {
    const local = localBackup()
    // 2026-05-18 is the end of the week [2026-05-11, 2026-05-18); it belongs to the
    // NEXT week [2026-05-18, 2026-05-25).
    const edgeEnd = '2026-05-18'
    ;(local.serviceLogs as any[]).push({
      id: 's-edge-end',
      serviceLogId: 's-edge-end',
      quoted: 100,
      collected: 100,
      payments: [{ id: 's-edge-end-p', amount: 100, receivedAt: edgeEnd, recordedAt: NOW_ISO, kind: 'payment', voidedAt: null }],
    })
    const recalced = recalculateWeeklyData(local, NOW_ISO)
    const outgoing = buildWeeklyRecalcOutgoing(local, remoteBackup(), recalced)
    const weekBefore = (outgoing.weeklyData as any[]).find(r => r.start === '2026-05-11')
    const weekOf = (outgoing.weeklyData as any[]).find(r => r.start === '2026-05-18')
    expect(weekBefore).toBeTruthy()
    expect(weekOf).toBeTruthy()
    // weekBefore [05-11, 05-18) contains S2 3000 but NOT the 05-18 edge payment.
    expect(weekBefore.svc).toBeCloseTo(3000, 2)
    // weekOf [05-18, 05-25) contains the edge 100.
    expect(weekOf.svc).toBeCloseTo(100, 2)
  })
})

// ── R8: no future leak ─────────────────────────────────────────────────────────

describe('FORENSIC-KPI-2B2-2F R8 — future-dated cash does not leak into current/past weeks', () => {
  it('a future service payment is not pulled into the current week (2026-08-11)', () => {
    const local = localBackup()
    ;(local.serviceLogs as any[]).push({
      id: 's-future',
      serviceLogId: 's-future',
      quoted: 9999,
      collected: 9999,
      payments: [{ id: 's-future-p', amount: 9999, receivedAt: '2026-10-20', recordedAt: NOW_ISO, kind: 'payment', voidedAt: null }],
    })
    const recalced = recalculateWeeklyData(local, NOW_ISO)
    const outgoing = buildWeeklyRecalcOutgoing(local, remoteBackup(), recalced)
    const currentWk = findWeekContaining(outgoing.weeklyData as any[], '2026-08-11')
    expect(currentWk).toBeTruthy()
    // Current week svc must not include the 2026-10-20 future cash.
    expect(currentWk.svc).toBeCloseTo(0, 2)
    // The future week containing 2026-10-20 has svc=0 too: deriveRow zeroes svc for
    // weeks whose start is after the recalc timestamp (collections are not recognized
    // early). This is the explicit "future service weeks do not recognize collections
    // early" rule — a reporting recalc must not pre-recognize future cash.
    const futureWk = findWeekContaining(outgoing.weeklyData as any[], '2026-10-20')
    expect(futureWk).toBeTruthy()
    expect(Number(new Date(futureWk.start + 'T00:00:00.000Z').getTime())).toBeGreaterThan(Number(new Date(NOW_ISO).getTime()))
    expect(futureWk.svc).toBeCloseTo(0, 2)
  })
})

// ── R9: recalculate idempotency ────────────────────────────────────────────────

describe('FORENSIC-KPI-2B2-2F R9 — recalculation is idempotent', () => {
  it('recalculateWeeklyData(recalculateWeeklyData(b)) weeklyData equals recalculateWeeklyData(b) weeklyData', () => {
    const local = localBackup()
    const once = recalculateWeeklyData(local, NOW_ISO)
    // Second pass reads the first recalc's weeklyData scaffolding and recomputes
    // values from the SAME canonical source → identical values.
    const twiceInput: BackupData = { ...local, weeklyData: once }
    const twice = recalculateWeeklyData(twiceInput, NOW_ISO)
    // Compare the derived value fields (proj/svc/unbilled/pendingInv/accum) per wk.
    const strip = (rows: any[]) => rows.map(r => ({ wk: r.wk, proj: r.proj, svc: r.svc, unbilled: r.unbilled, pendingInv: r.pendingInv, accum: r.accum, manualOverride: r.manualOverride }))
    expect(strip(twice)).toEqual(strip(once))
  })

  it('buildWeeklyRecalcOutgoing never drifts LOCAL canonical across repeated application', () => {
    const local = localBackup()
    const remote = remoteBackup()
    const recalced = recalculateWeeklyData(local, NOW_ISO)
    const outgoing1 = buildWeeklyRecalcOutgoing(local, remote, recalced)
    // A second recalc from the outgoing blob (which carries local canonical) must not
    // drift canonical back toward remote. (The weeklyData accum may re-flow once a
    // preserved manual row is present — that is a pre-existing merge property and not
    // a canonical-drift concern; canonical arrays are the release-gate invariant.)
    const recalced2 = recalculateWeeklyData(outgoing1, NOW_ISO)
    const outgoing2 = buildWeeklyRecalcOutgoing(outgoing1, remote, recalced2)
    expect((outgoing2.projects[0] as any).paid).toBe(10000)
    expect((outgoing2.serviceLogs[0] as any).collected).toBe(5000)
    expect(outgoing2.projects).toBe(outgoing1.projects)
    expect(outgoing2.serviceLogs).toBe(outgoing1.serviceLogs)
  })
})

// ── Source contract: the owner-facing manual recalc is RETIRED (2B2-2H) ─────────

describe('FORENSIC-KPI-2B2-2H source contract — manual recalc UI retired, automatic derive wired', () => {
  const ROOT = process.cwd()
  const moneySrc = readFileSync(join(ROOT, 'src/components/v15r/V15rMoneyPanel.tsx'), 'utf8')
  const mergeSrc = readFileSync(join(ROOT, 'src/services/weeklyDataScopeMerge.ts'), 'utf8')
  const policySrc = readFileSync(join(ROOT, 'src/services/weeklyFinancialPolicy.ts'), 'utf8')

  it('no longer renders the "Recalculate from Data" owner control', () => {
    expect(moneySrc).not.toContain('Recalculate from Data')
    expect(moneySrc).not.toContain('Recalculating...')
    expect(moneySrc).not.toContain('recalcWeeklyFromData')
    expect(moneySrc).not.toContain('recalculating')
  })

  it('removed the save/reload/sync path used solely to refresh derived weekly reporting', () => {
    expect(moneySrc).not.toContain('window.location.reload')
    // The recalc-only sync imports are gone from the panel (shared sync fns remain
    // globally available — only the obsolete calls/imports are removed).
    expect(moneySrc).not.toContain('fetchLatestRemoteBackup')
    expect(moneySrc).not.toContain('saveBackupWithRemoteBaselineSync')
    expect(moneySrc).not.toContain('saveBackupDataAndSync')
    expect(moneySrc).not.toContain("buildWeeklyRecalcOutgoing")
    expect(moneySrc).not.toContain('recalculateWeeklyData')
  })

  it('wires the 52-week view through the automatic canonical resolver', () => {
    expect(moneySrc).toContain('resolveWeeklyDataForRead(backup)')
    // CRLF-tolerant: the panel imports only the resolver + current-row predicate.
    expect(moneySrc).toMatch(/import \{\r?\n  isCurrentWeeklyRow,\r?\n  resolveWeeklyDataForRead,\r?\n\} from '@\/services\/weeklyFinancialPolicy'/)
  })

  it('buildWeeklyRecalcOutgoing remains exported as a retired/tested utility (no longer UI-wired)', () => {
    // The pure merge helper is preserved (it documents the explicit-refresh merge
    // semantics and backs the isolation tests above) but is no longer imported by
    // the owner-facing panel.
    expect(mergeSrc).toContain('export function buildWeeklyRecalcOutgoing(')
  })

  it('the reader derives every non-manual row from canonical truth (no current-row-only special case)', () => {
    expect(policySrc).toContain('FORENSIC-KPI-2B2-2H')
    expect(policySrc).toContain('isSyntheticPaidBackfillLog')
    expect(policySrc).not.toContain('only the current non-manual row is overlaid')
  })
})