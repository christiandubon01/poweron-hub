/**
 * ATB-1: frontend telemetry adapter tests.
 *
 * Proves the browser maps interim verdicts / handoffs / signals HONESTLY:
 *   - present arrays map through with typed, bounded values;
 *   - a pre-ATB-1 snapshot (no telemetry fields) still maps, arrays default to [];
 *   - malformed entries are dropped, never fabricated;
 *   - unknown signal categories are rejected (no misleading warnings);
 *   - arrays are defensively capped even if a Host over-publishes.
 */
import { describe, expect, it } from 'vitest'
import {
  mapHandoffs,
  mapInterimVerdicts,
  mapRunSnapshotRow,
  mapSignals,
} from './controlTowerAdapter'
import type { RunSnapshotRow } from './controlTowerService'

function snapshotRow(snapshot: Record<string, unknown>): RunSnapshotRow {
  return {
    run_id: 'run-1',
    repo_key: 'repo-key-1',
    objective: 'objective',
    status: 'running',
    snapshot,
    published_at: '2026-09-22T00:00:00.000Z',
    updated_at: '2026-09-22T00:00:00.000Z',
  }
}

const CORE_SNAPSHOT = {
  schemaVersion: 1,
  run: { runId: 'run-1', title: 'run', objective: 'objective', status: 'running', createdAt: '2026-09-22T00:00:00.000Z', updatedAt: '2026-09-22T00:00:01.000Z', startedAt: null, completedAt: null },
  tasks: [{ taskId: 't-1', clientTaskKey: 'impl', title: 'Implement', role: 'implementer', status: 'running', position: 0, dependencies: [], plannedAreas: [], permissionProfile: 'task-implementer' }],
  attempts: [],
  gate: null,
  changeset: null,
  verification: null,
}

describe('ATB-1 telemetry adapter', () => {
  it('maps present telemetry arrays into the run view', () => {
    const view = mapRunSnapshotRow(snapshotRow({
      ...CORE_SNAPSHOT,
      interimVerdicts: [{ verdictId: 'v1', role: 'guard', taskId: 't-1', attemptId: 'a-1', state: 'NEEDS_OWNER', summary: 'Guard requires approval', evidenceRefs: ['x.sql'], evidenceCount: 1, severity: 'critical', recommendedAction: 'owner-review', mayContinue: false, timestamp: '2026-09-22T00:00:02.000Z' }],
      handoffs: [{ handoffId: 'h1', from: 'implementer', to: 'verifier', taskId: 't-1', payloadType: 'changeset', summary: '1 file', evidenceCount: 1, status: 'delivered', timestamp: '2026-09-22T00:00:03.000Z', latencyMs: 12, resultingVerdict: null }],
      signals: [{ signalId: 's1', category: 'protected-path', severity: 'critical', source: 'guard', taskId: 't-1', attemptId: 'a-1', message: 'Protected path touched', evidenceCount: 1, evidenceRefs: ['.env'], firstSeen: '2026-09-22T00:00:02.000Z', lastSeen: '2026-09-22T00:00:02.000Z', resolvedAt: null, ownerActionRequired: true }],
    }))
    expect(view).not.toBeNull()
    expect(view!.interimVerdicts!).toHaveLength(1)
    expect(view!.interimVerdicts![0].state).toBe('NEEDS_OWNER')
    expect(view!.handoffs![0].to).toBe('verifier')
    expect(view!.signals![0].category).toBe('protected-path')
    expect(view!.signals![0].ownerActionRequired).toBe(true)
  })

  it('a pre-ATB-1 snapshot with no telemetry fields maps to empty arrays (backward compatible)', () => {
    const view = mapRunSnapshotRow(snapshotRow(CORE_SNAPSHOT))
    expect(view).not.toBeNull()
    expect(view!.interimVerdicts).toEqual([])
    expect(view!.handoffs).toEqual([])
    expect(view!.signals).toEqual([])
  })

  it('drops malformed verdict/handoff entries instead of fabricating them', () => {
    const verdicts = mapInterimVerdicts([
      { verdictId: 'ok', state: 'WATCH', role: 'host', timestamp: '2026-09-22T00:00:02.000Z' },
      { state: 'PASS' }, // no id / timestamp → dropped
      'not-an-object',
    ])
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0].verdictId).toBe('ok')

    const handoffs = mapHandoffs([{ from: 'host', to: 'owner' }, { handoffId: 'h', timestamp: '2026-09-22T00:00:02.000Z' }])
    expect(handoffs).toHaveLength(1)
  })

  it('rejects unknown signal categories and normalizes enum-ish fields', () => {
    const signals = mapSignals([
      { signalId: 's-bad', category: 'totally-made-up', severity: 'critical', firstSeen: 't', lastSeen: 't' },
      { signalId: 's-ok', category: 'human-gate', severity: 'weird', source: 'nope', firstSeen: '2026-09-22T00:00:02.000Z', lastSeen: '2026-09-22T00:00:02.000Z' },
    ])
    expect(signals).toHaveLength(1)
    expect(signals[0].category).toBe('human-gate')
    expect(signals[0].severity).toBe('notice') // invalid → safe fallback
    expect(signals[0].source).toBe('host') // invalid → safe fallback
  })

  it('maps ATB-4 first-class drift categories without collapsing them', () => {
    const signals = mapSignals([
      { signalId: 's-dep', category: 'dependency-mutation', severity: 'warning', source: 'guard', firstSeen: '2026-09-22T00:00:02.000Z', lastSeen: '2026-09-22T00:00:02.000Z', ownerActionRequired: true },
      { signalId: 's-db', category: 'db-mutation', severity: 'critical', source: 'guard', firstSeen: '2026-09-22T00:00:02.000Z', lastSeen: '2026-09-22T00:00:02.000Z', ownerActionRequired: true },
      { signalId: 's-mig', category: 'migration-outside-plan', severity: 'critical', source: 'guard', firstSeen: '2026-09-22T00:00:02.000Z', lastSeen: '2026-09-22T00:00:02.000Z', ownerActionRequired: true },
      { signalId: 's-area', category: 'unplanned-area', severity: 'warning', source: 'guard', firstSeen: '2026-09-22T00:00:02.000Z', lastSeen: '2026-09-22T00:00:02.000Z', ownerActionRequired: true },
      { signalId: 's-fb', category: 'provider-fallback', severity: 'notice', source: 'host', firstSeen: '2026-09-22T00:00:02.000Z', lastSeen: '2026-09-22T00:00:02.000Z' },
      { signalId: 's-disagree', category: 'verifier-implementer-disagreement', severity: 'warning', source: 'host', firstSeen: '2026-09-22T00:00:02.000Z', lastSeen: '2026-09-22T00:00:02.000Z' },
    ])
    expect(signals.map((signal) => signal.category)).toEqual([
      'dependency-mutation',
      'db-mutation',
      'migration-outside-plan',
      'unplanned-area',
      'provider-fallback',
      'verifier-implementer-disagreement',
    ])
    expect(signals[0].ownerActionRequired).toBe(true)
  })

  it('caps arrays defensively even if a Host over-publishes', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ signalId: `s${i}`, category: 'policy-gate', severity: 'warning', source: 'guard', firstSeen: '2026-09-22T00:00:02.000Z', lastSeen: '2026-09-22T00:00:02.000Z' }))
    expect(mapSignals(many).length).toBeLessThanOrEqual(30)
  })
})
