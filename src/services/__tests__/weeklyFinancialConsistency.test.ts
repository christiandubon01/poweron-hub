import { describe, expect, it } from 'vitest'
import {
  calculateWeeklyFinancialsForRange,
  recalculateWeeklyData,
  resolveWeeklyDataForRead,
} from '../weeklyFinancialPolicy'
import {
  mergeRemoteWeeklyDataIntoOutgoing,
  mergeWeeklyDataIntoRemote,
  mergeWeeklyRowsByWk,
} from '../weeklyDataScopeMerge'

const OLD = '2026-08-01T10:00:00.000Z'
const NEW = '2026-08-02T10:00:00.000Z'
const NEWER = '2026-08-03T10:00:00.000Z'
const CURRENT = new Date('2026-08-05T12:00:00.000Z')
const CURRENT_START = '2026-08-02'

function row(extra: Record<string, any> = {}): any {
  return {
    wk: 32,
    start: CURRENT_START,
    proj: 100,
    svc: 25,
    accum: 500,
    unbilled: 0,
    pendingInv: 0,
    totalExposure: 0,
    _empty: false,
    ...extra,
  }
}

function backup(extra: Record<string, any> = {}): any {
  return {
    projects: [{ id: 'project-1', status: 'active', contract: 1_000, billed: 250 }],
    logs: [{ id: 'project-log-1', projId: 'project-1', date: '2026-08-04', collected: 200 }],
    serviceLogs: [{ id: 'service-log-1', serviceLogId: 'service-log-1', date: '2026-08-05', quoted: 300, collected: 75, payments: [{ id: 'pay-svc1', amount: 75, receivedAt: '2026-08-05', recordedAt: '2026-08-05T00:00:00.000Z', kind: 'payment', voidedAt: null }] }],
    weeklyData: [row()],
    settings: {},
    ...extra,
  }
}

describe('SYNC-05 weekly row persistence contract', () => {
  it('keeps a newer manual weekly row over a derived recalculation', () => {
    const manual = row({ proj: 900, manualOverride: true, weeklyUpdatedAt: NEWER })
    const derived = row({ proj: 200, manualOverride: false, derivedAt: NEWER, weeklyUpdatedAt: NEWER })

    expect(mergeWeeklyRowsByWk([manual], [derived])[0]).toMatchObject({
      proj: 900,
      manualOverride: true,
      weeklyUpdatedAt: NEWER,
    })
  })

  it('keeps the newer legitimate derived row over a stale derived row', () => {
    const stale = row({ proj: 100, derivedAt: OLD, weeklyUpdatedAt: OLD })
    const fresh = row({ proj: 450, derivedAt: NEW, weeklyUpdatedAt: NEW })

    expect(mergeWeeklyRowsByWk([stale], [fresh])[0].proj).toBe(450)
    expect(mergeWeeklyRowsByWk([fresh], [stale])[0].proj).toBe(450)
  })

  it('protects a newer remote weekly row from a broad stale BackupData save', () => {
    const outgoing = backup({
      projects: [{ id: 'project-local', status: 'active' }],
      weeklyData: [row({ proj: 100, derivedAt: OLD, weeklyUpdatedAt: OLD })],
    })
    const remote = backup({
      projects: [{ id: 'project-remote', status: 'active' }],
      weeklyData: [row({ proj: 700, derivedAt: NEW, weeklyUpdatedAt: NEW })],
    })

    const result = mergeRemoteWeeklyDataIntoOutgoing(outgoing, remote)

    expect(result.weeklyData[0].proj).toBe(700)
    expect(result.projects).toEqual(outgoing.projects)
  })

  it('preserves a manual historical row through a cross-device weekly merge', () => {
    const historicalManual = row({
      wk: 31,
      start: '2026-07-26',
      proj: 1_250,
      manualOverride: true,
      weeklyUpdatedAt: NEW,
    })
    const remote = backup({ weeklyData: [historicalManual] })
    const staleDevice = backup({
      weeklyData: [row({ wk: 31, start: '2026-07-26', proj: 200, derivedAt: OLD, weeklyUpdatedAt: OLD })],
    })

    const result = mergeWeeklyDataIntoRemote(remote, staleDevice)

    expect(result.weeklyData[0]).toMatchObject({ proj: 1_250, manualOverride: true })
  })
})

describe('SYNC-05 current versus historical reader policy', () => {
  it('derives the same current-week result from identical canonical snapshots', () => {
    const first = backup()
    const second = structuredClone(first)

    expect(resolveWeeklyDataForRead(first, CURRENT)).toEqual(resolveWeeklyDataForRead(second, CURRENT))
  })

  // FORENSIC-KPI-2B2-2H: the reader is now an AUTOMATIC derived view. Every
  // non-manual row is re-derived from canonical truth on read — there is no
  // "historical rows stay persisted" special case. Stored proj/svc on a
  // non-manual row are stale scaffolding; only wk + start are authoritative.
  it('derives non-manual historical rows from canonical truth and preserves a current manual override', () => {
    // Stale stored values (proj 900 / svc 80) that are NOT backed by canonical cash
    // in week 31 (the canonical log + service payment both fall in week 32).
    const historical = row({ wk: 31, start: '2026-07-26', proj: 900, svc: 80, accum: 980 })
    const manualCurrent = row({ proj: 777, svc: 88, accum: 1_845, manualOverride: true, weeklyUpdatedAt: NEW })
    const source = backup({ weeklyData: [historical, manualCurrent] })

    const result = resolveWeeklyDataForRead(source, CURRENT)

    // Historical non-manual row is RE-DERIVED: canonical log (2026-08-04) and
    // service payment (2026-08-05) fall in week 32, so week 31's actuals are 0/0
    // and the stale 900/80 are discarded. accum resets to the derived chain (0).
    expect(result[0]).toMatchObject({ wk: 31, start: '2026-07-26', proj: 0, svc: 0, accum: 0 })
    // Manual override is preserved verbatim — owner values authoritative.
    expect(result[1]).toEqual(manualCurrent)
  })

  // FORENSIC-KPI-2A: previously required archived period cash to vanish (proj: 0).
  // Owner-approved semantics keep collected cash in the period it was received;
  // only current-work figures (unbilled) follow the active project lifecycle.
  it('keeps an archived project period cash but drops its current-work unbilled', () => {
    const source = backup({
      projects: [{ id: 'project-1', status: 'active', archived: true, archivedAt: NEW, contract: 1_000, billed: 250 }],
    })

    expect(resolveWeeklyDataForRead(source, CURRENT)[0]).toMatchObject({ proj: 200, unbilled: 0 })
  })

  it('returns a restored project to current-work unbilled without duplicating period cash', () => {
    const source = backup({
      projects: [{ id: 'project-1', status: 'active', archived: false, archivedAt: null, contract: 1_000, billed: 250 }],
    })

    expect(resolveWeeklyDataForRead(source, CURRENT)[0]).toMatchObject({ proj: 200, unbilled: 750 })
  })

  // FORENSIC-KPI-2A TEST 3 — period collected cash survives archive / lost / cancelled.
  // Current-work unbilled correctly drops to 0 in every non-active state.
  it('keeps period collected cash through archive, lost and cancelled states', () => {
    const source = backup({
      projects: [{ id: 'project-1', status: 'active', contract: 1_000, billed: 250 }],
    })
    const range = () =>
      calculateWeeklyFinancialsForRange(
        source,
        new Date('2026-08-02T00:00:00.000Z'),
        new Date('2026-08-09T00:00:00.000Z'),
      )

    expect(range()).toMatchObject({ proj: 200, unbilled: 750 })

    source.projects[0] = { id: 'project-1', status: 'active', archived: true, archivedAt: NEW, contract: 1_000, billed: 250 }
    expect(range()).toMatchObject({ proj: 200, unbilled: 0 })

    source.projects[0] = { id: 'project-1', status: 'lost', outcome: 'lost', contract: 1_000, billed: 250 }
    expect(range()).toMatchObject({ proj: 200, unbilled: 0 })

    source.projects[0] = { id: 'project-1', status: 'cancelled', contract: 1_000, billed: 250 }
    expect(range()).toMatchObject({ proj: 200, unbilled: 0 })
  })

  it('keeps a tombstoned payment log excluded even on an archived project', () => {
    const source = backup({
      projects: [{ id: 'project-1', status: 'active', archived: true, archivedAt: NEW, contract: 1_000, billed: 250 }],
      logs: [
        { id: 'project-log-1', projId: 'project-1', date: '2026-08-04', collected: 200 },
        { id: 'project-log-void', projId: 'project-1', date: '2026-08-04', collected: 900, deletedAt: NEW },
      ],
    })

    expect(resolveWeeklyDataForRead(source, CURRENT)[0]).toMatchObject({ proj: 200 })
  })

  it('excludes a deleted project and its payment activity', () => {
    const source = backup({
      projects: [{ id: 'project-1', status: 'deleted', deletedAt: NEW, contract: 1_000, billed: 250 }],
    })

    expect(resolveWeeklyDataForRead(source, CURRENT)[0]).toMatchObject({ proj: 0, unbilled: 0 })
  })

  it('uses project and service logs as canonical inputs without duplicating them into weeklyData', () => {
    const source = backup()
    const before = structuredClone(source)

    const [current] = resolveWeeklyDataForRead(source, CURRENT)

    expect(current).toMatchObject({ proj: 200, svc: 75 })
    expect(source).toEqual(before)
    expect(source.weeklyData).toHaveLength(1)
  })

  it('keeps service-log collection and pending-payment inputs consistent', () => {
    const source = backup({
      serviceLogs: [
        { id: 'paid', serviceLogId: 'paid', date: '2026-08-05', quoted: 300, collected: 75, payments: [{ id: 'pay-paid', amount: 75, receivedAt: '2026-08-05', recordedAt: '2026-08-05T00:00:00.000Z', kind: 'payment', voidedAt: null }] },
        { id: 'pending', serviceLogId: 'pending', date: '2026-08-05', quoted: 425, collected: 0 },
        { id: 'archived', serviceLogId: 'archived', date: '2026-08-05', quoted: 999, collected: 999, archived: true, payments: [{ id: 'pay-archived', amount: 999, receivedAt: '2026-08-05', recordedAt: '2026-08-05T00:00:00.000Z', kind: 'payment', voidedAt: null }] },
      ],
    })

    expect(resolveWeeklyDataForRead(source, CURRENT)[0]).toMatchObject({ svc: 75, pendingInv: 425 })
  })

  it('preserves manual rows during an explicit recalculation', () => {
    const manual = row({ wk: 31, start: '2026-07-26', proj: 999, svc: 1, manualOverride: true, weeklyUpdatedAt: NEW })
    const source = backup({ weeklyData: [manual, row()] })

    const result = recalculateWeeklyData(source, NEWER)

    expect(result[0]).toEqual(manual)
    expect(result[1]).toMatchObject({ proj: 200, svc: 75, derivedAt: NEWER, weeklyUpdatedAt: NEWER })
  })

  it('keeps the existing future-service exclusion during explicit recalculation', () => {
    const future = row({ wk: 33, start: '2026-08-09' })
    const source = backup({
      serviceLogs: [{ id: 'future-service', serviceLogId: 'future-service', date: '2026-08-10', quoted: 300, collected: 75, payments: [{ id: 'pay-future', amount: 75, receivedAt: '2026-08-10', recordedAt: '2026-08-10T00:00:00.000Z', kind: 'payment', voidedAt: null }] }],
      weeklyData: [future],
    })

    expect(recalculateWeeklyData(source, NEWER)[0].svc).toBe(0)
  })

  it('makes the current-week persisted reader and Dashboard-equivalent range calculation agree', () => {
    const source = backup()
    const reader = resolveWeeklyDataForRead(source, CURRENT)[0]
    const dashboard = calculateWeeklyFinancialsForRange(
      source,
      new Date('2026-08-02T00:00:00.000Z'),
      new Date('2026-08-09T00:00:00.000Z'),
    )

    expect({ proj: reader.proj, svc: reader.svc }).toEqual({ proj: dashboard.proj, svc: dashboard.svc })
  })

})
