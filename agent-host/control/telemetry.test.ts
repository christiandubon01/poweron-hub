/**
 * ATB-1: Agent Team runtime telemetry projection tests (fakes only — NO live
 * model calls, NO network, NO provider processes).
 *
 * The projection functions are PURE over (run, tasks, events); most cases build
 * typed records directly and assert the projection. The store is used only for
 * the buildRunSnapshot integration cases (backward compatibility, no-persistence,
 * and the fail-safe malformed-evidence guarantee).
 *
 * Proves: interim-verdict / handoff / signal projection; dedupe + idempotency;
 * bounded array caps; bounded string payloads; a backward-compatible snapshot;
 * and — critically — that projection NEVER persists an event and NEVER throws on
 * malformed evidence (telemetry is observability and can never strand a Run).
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { openOrchestrationStore, type OrchestrationStore } from '../lib/store.ts';
import { buildRunSnapshot } from './snapshots.ts';
import { driveRunToCompletion } from './worker.ts';
import type { ProductionExecutionPort } from './supervisorPort.ts';
import type { ControlPlane } from './supabaseControl.ts';
import type { AttemptExecutionContext } from '../supervisor/supervisor.ts';
import {
  projectInterimVerdicts,
  projectHandoffs,
  projectSignals,
  projectRunTelemetry,
  TELEMETRY_EXCESSIVE_RETRY_THRESHOLD,
} from './telemetry.ts';
import {
  MAX_SNAPSHOT_HANDOFFS,
  MAX_SNAPSHOT_INTERIM_VERDICTS,
  MAX_SNAPSHOT_SIGNALS,
  TELEMETRY_EVIDENCE_REF_MAX,
  TELEMETRY_EVIDENCE_REF_MAX_CHARS,
  TELEMETRY_MESSAGE_MAX_CHARS,
  TELEMETRY_SUMMARY_MAX_CHARS,
} from './types.ts';
import type {
  JsonValue,
  OrchestrationEventRecord,
  RunRecord,
  RunStatus,
  TaskRecord,
} from '../lib/orchestrationTypes.ts';

/* -------------------------------------------------------------------------- */
/* Typed record builders (pure projection needs no store)                      */
/* -------------------------------------------------------------------------- */

const BASE = Date.parse('2026-09-22T00:00:00.000Z');

function iso(offsetSeconds: number): string {
  return new Date(BASE + offsetSeconds * 1_000).toISOString();
}

function mkRun(status: RunStatus, overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: 'run-1',
    title: 'run',
    goal: 'objective',
    status,
    createdAt: iso(0),
    updatedAt: iso(100),
    startedAt: status === 'pending' ? null : iso(1),
    completedAt: status === 'completed' || status === 'failed' || status === 'cancelled' ? iso(100) : null,
    ...overrides,
  };
}

function mkTask(taskId: string, spec: JsonValue, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    taskId,
    runId: 'run-1',
    title: taskId,
    goal: 'g',
    status: 'running',
    position: 0,
    spec,
    createdAt: iso(0),
    updatedAt: iso(1),
    startedAt: iso(1),
    completedAt: null,
    ...overrides,
  };
}

interface EventDef {
  type: string;
  taskId?: string | null;
  attemptId?: string | null;
  payload?: JsonValue | null;
  createdAt?: string;
}

function mkEvents(defs: EventDef[]): OrchestrationEventRecord[] {
  return defs.map((def, index) => ({
    seq: index + 1,
    eventId: `evt-${index + 1}`,
    runId: 'run-1',
    taskId: def.taskId ?? null,
    attemptId: def.attemptId ?? null,
    type: def.type,
    createdAt: def.createdAt ?? iso(index + 1),
    payload: def.payload ?? null,
  }));
}

function implementerSpec(overrides: { plannedAreas?: string[]; authorizedWritePaths?: string[]; role?: string } = {}): JsonValue {
  return {
    control: { provider: 'claude', requestedModel: null, permissionProfile: 'task-implementer', prompt: 'SECRET PROMPT', timeoutMs: 600_000 },
    policy: { authorizedWritePaths: overrides.authorizedWritePaths ?? ['agent-host/smoke/example.txt'] },
    workingDirectory: '/repo',
    plan: { clientTaskKey: 'create-file', role: overrides.role ?? 'implementer', plannedAreas: overrides.plannedAreas ?? ['agent-host/smoke'] },
  } as unknown as JsonValue;
}

function verifierSpec(): JsonValue {
  return {
    control: { provider: 'claude', requestedModel: null, permissionProfile: 'verifier', prompt: 'SECRET PROMPT', timeoutMs: 600_000 },
    policy: { authorizedWritePaths: [] },
    workingDirectory: '/repo',
    plan: { clientTaskKey: 'verify-file', role: 'verifier', plannedAreas: ['agent-host/smoke'] },
  } as unknown as JsonValue;
}

async function withStore(work: (store: OrchestrationStore) => Promise<void>): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'orch-telemetry-'));
  const dbPath = path.join(tempDir, 'orchestration.sqlite');
  let counter = 0;
  const store = openOrchestrationStore({
    dbPath,
    repoKey: 'repo-key-1',
    hostId: 'host-1',
    hostVersion: '0.1.0',
    idGenerator: () => `evt-${++counter}`,
  });
  try {
    await work(store);
  } finally {
    store.close();
    await rm(tempDir, { recursive: true, force: true });
  }
}

/* -------------------------------------------------------------------------- */
/* A. Interim verdict projection                                               */
/* -------------------------------------------------------------------------- */

test('projectInterimVerdicts derives verdicts from lifecycle boundaries + run terminal', () => {
  const tasks = [mkTask('t-impl', implementerSpec()), mkTask('t-ver', verifierSpec(), { taskId: 't-ver', position: 1 })];
  const events = mkEvents([
    { type: 'execution.started', taskId: 't-impl', attemptId: 'a-impl' },
    { type: 'workspace.changeset.ready', taskId: 't-impl', attemptId: 'a-impl', payload: { changeCount: 2 } },
    { type: 'policy.evaluated', taskId: 't-impl', attemptId: 'a-impl', payload: { accepted: true, changeCount: 2, changes: [{ path: 'agent-host/smoke/example.txt', decision: 'allow', reasonCode: 'in-scope', category: 'AUTHORIZED_CHANGE' }] } },
    { type: 'control.verifier.verdict', taskId: 't-ver', attemptId: 'a-ver', payload: { verdict: 'pass' } },
  ]);

  const verdicts = projectInterimVerdicts({ run: mkRun('completed'), tasks, events });
  const byId = new Map(verdicts.map((v) => [v.verdictId, v]));

  assert.equal(byId.get('verdict:started:a-impl')!.role, 'implementer');
  assert.equal(byId.get('verdict:changeset:a-impl')!.state, 'CONTINUE');
  assert.equal(byId.get('verdict:policy:a-impl')!.role, 'guard');
  assert.equal(byId.get('verdict:verifier:a-ver')!.state, 'PASS');
  const runVerdict = byId.get('verdict:run:run-1:completed')!;
  assert.equal(runVerdict.role, 'host');
  assert.equal(runVerdict.state, 'PASS');
});

test('a human-gated policy change yields a NEEDS_OWNER guard verdict, never a fabricated pass', () => {
  const events = mkEvents([
    { type: 'policy.evaluated', taskId: 't-impl', attemptId: 'a-impl', payload: { accepted: false, changeCount: 1, changes: [{ path: 'supabase/migrations/x.sql', decision: 'deny', requiresHuman: true, reasonCode: 'protected-path', category: 'PROTECTED_CHANGE' }] } },
  ]);
  const verdicts = projectInterimVerdicts({ run: mkRun('paused'), tasks: [mkTask('t-impl', implementerSpec())], events });
  const guard = verdicts.find((v) => v.verdictId === 'verdict:policy:a-impl')!;
  assert.equal(guard.state, 'NEEDS_OWNER');
  assert.equal(guard.mayContinue, false);
  assert.equal(guard.recommendedAction, 'owner-review');
});

/* -------------------------------------------------------------------------- */
/* B. Handoff projection                                                        */
/* -------------------------------------------------------------------------- */

test('projectHandoffs projects the canonical role-to-role lifecycle', () => {
  const tasks = [mkTask('t-impl', implementerSpec()), mkTask('t-ver', verifierSpec(), { taskId: 't-ver', position: 1 })];
  const events = mkEvents([
    { type: 'execution.started', taskId: 't-impl', attemptId: 'a-impl' },
    { type: 'workspace.changeset.ready', taskId: 't-impl', attemptId: 'a-impl', payload: { changeCount: 1 } },
    { type: 'control.verifier.verdict', taskId: 't-ver', attemptId: 'a-ver', payload: { verdict: 'fail' } },
  ]);

  const handoffs = projectHandoffs({ run: mkRun('failed'), tasks, events });
  const byId = new Map(handoffs.map((h) => [h.handoffId, h]));

  assert.equal(byId.get('handoff:plan-approved:run-1')!.from, 'owner');
  assert.equal(byId.get('handoff:plan-approved:run-1')!.to, 'host');
  assert.equal(byId.get('handoff:task-ready:t-impl')!.to, 'implementer');
  assert.equal(byId.get('handoff:changeset:a-impl')!.from, 'implementer');
  assert.equal(byId.get('handoff:changeset:a-impl')!.to, 'verifier');
  assert.equal(byId.get('handoff:verification:a-ver')!.resultingVerdict, 'FAIL');
  assert.equal(byId.get('handoff:verification:a-ver')!.status, 'rejected');
  assert.equal(byId.get('handoff:run-result:run-1')!.to, 'owner');
  assert.equal(byId.get('handoff:run-result:run-1')!.resultingVerdict, 'FAIL');
  // task-ready latency is derived from run.createdAt → first execution.started.
  assert.ok((byId.get('handoff:task-ready:t-impl')!.latencyMs ?? -1) >= 0);
});

test('a human gate produces a Host→Owner gate handoff queued for the owner', () => {
  const events = mkEvents([
    { type: 'supervisor.blocked', taskId: 't-impl', attemptId: 'a-impl', payload: { reason: 'human-gate', gateKind: 'protected-path' } },
  ]);
  const handoffs = projectHandoffs({ run: mkRun('paused'), tasks: [mkTask('t-impl', implementerSpec())], events });
  const gate = handoffs.find((h) => h.handoffId === 'handoff:gate:a-impl')!;
  assert.equal(gate.from, 'host');
  assert.equal(gate.to, 'owner');
  assert.equal(gate.status, 'queued');
  assert.equal(gate.resultingVerdict, 'NEEDS_OWNER');
});

/* -------------------------------------------------------------------------- */
/* C. Signal projection                                                         */
/* -------------------------------------------------------------------------- */

test('projectSignals emits protected-path, out-of-scope, head-move and policy-gate signals', () => {
  const events = mkEvents([
    {
      type: 'policy.evaluated', taskId: 't-impl', attemptId: 'a-impl',
      payload: {
        accepted: false, headMoved: true, changeCount: 3,
        changes: [
          { path: '.env', decision: 'deny', reasonCode: 'protected-path', category: 'PROTECTED_CHANGE' },
          { path: 'src/other.ts', decision: 'deny', reasonCode: 'out-of-scope-write', category: 'OUT_OF_SCOPE_CHANGE' },
          { path: 'src/weird.ts', decision: 'deny', reasonCode: 'invalid-write-scope', category: 'OUT_OF_SCOPE_CHANGE' },
        ],
      },
    },
  ]);
  const signals = projectSignals({ run: mkRun('running'), tasks: [mkTask('t-impl', implementerSpec())], events });
  const categories = new Set(signals.map((s) => s.category));
  assert.ok(categories.has('protected-path'));
  assert.ok(categories.has('out-of-scope-write'));
  assert.ok(categories.has('unexpected-head-move'));
  assert.ok(categories.has('policy-gate'));
  const protectedSignal = signals.find((s) => s.category === 'protected-path')!;
  assert.equal(protectedSignal.severity, 'critical');
  assert.equal(protectedSignal.ownerActionRequired, true);
});

test('human-gate + excessive-retry + model-routing-mismatch signals', () => {
  const retryEvents: EventDef[] = [];
  for (let i = 0; i < TELEMETRY_EXCESSIVE_RETRY_THRESHOLD; i += 1) {
    retryEvents.push({ type: 'supervisor.retry.scheduled', taskId: 't-impl', attemptId: `a-${i}`, payload: { completedAttemptOrdinal: i + 1, nextAttemptOrdinal: i + 2, maxAttempts: 5 } });
  }
  const events = mkEvents([
    { type: 'supervisor.blocked', taskId: 't-impl', attemptId: 'a-1', payload: { gateKind: 'db-mutation' } },
    ...retryEvents,
    { type: 'execution.completed', taskId: 't-impl', attemptId: 'a-1', payload: { requestedModel: 'claude-opus-5', reportedModel: 'claude-sonnet-5' } },
  ]);
  const signals = projectSignals({ run: mkRun('paused'), tasks: [mkTask('t-impl', implementerSpec())], events });
  const categories = new Set(signals.map((s) => s.category));
  assert.ok(categories.has('human-gate'));
  assert.ok(categories.has('excessive-retry'));
  assert.ok(categories.has('model-routing-mismatch'));
  const mismatch = signals.find((s) => s.category === 'model-routing-mismatch')!;
  assert.ok(mismatch.evidenceRefs.some((r) => r.includes('claude-opus-5')));
  assert.ok(mismatch.evidenceRefs.some((r) => r.includes('claude-sonnet-5')));
});

test('ATB-4: first-class drift reason codes project as themselves, never policy-gate', () => {
  const events = mkEvents([
    {
      type: 'policy.evaluated', taskId: 't-impl', attemptId: 'a-impl',
      payload: {
        accepted: false, headMoved: false, changeCount: 5,
        changes: [
          { path: 'package.json', decision: 'deny', reasonCode: 'dependency-mutation', requiresHuman: true },
          { path: 'supabase/migrations/001.sql', decision: 'deny', reasonCode: 'db-mutation', requiresHuman: true },
          { path: 'supabase/migrations/002.sql', decision: 'deny', reasonCode: 'migration-outside-plan', requiresHuman: true },
          { path: 'src/other.ts', decision: 'deny', reasonCode: 'unplanned-area', requiresHuman: true },
          { path: 'host', decision: 'deny', reasonCode: 'unknown-command', requiresHuman: true },
        ],
      },
    },
  ]);
  const signals = projectSignals({ run: mkRun('paused'), tasks: [mkTask('t-impl', implementerSpec())], events });
  const byCategory = new Map(signals.map((signal) => [signal.category, signal]));
  assert.equal(byCategory.get('dependency-mutation')?.ownerActionRequired, true);
  assert.equal(byCategory.get('db-mutation')?.severity, 'critical');
  assert.equal(byCategory.get('migration-outside-plan')?.ownerActionRequired, true);
  assert.equal(byCategory.get('unplanned-area')?.severity, 'warning');
  assert.equal(byCategory.get('unknown-command')?.ownerActionRequired, true);
  assert.ok(!signals.some((signal) => signal.category === 'policy-gate'));
});

test('ATB-4B: launch-contract projects as a single policy-gate, not a second drift finding', () => {
  const signals = projectSignals({
    run: mkRun('failed'),
    tasks: [mkTask('t-impl', implementerSpec())],
    events: mkEvents([{
      type: 'policy.evaluated', taskId: 't-impl', attemptId: 'a-impl',
      payload: {
        accepted: false, changeCount: 1,
        changes: [{ path: 'task.spec', decision: 'deny', reasonCode: 'launch-contract' }],
      },
    }]),
  });
  assert.equal(signals.filter((signal) => signal.category === 'policy-gate').length, 1);
  assert.ok(!signals.some((signal) => signal.category === 'dependency-mutation' || signal.category === 'unplanned-area'));
});

test('ATB-5: stale Scope Pack projects one warning signal; conflict requires owner action', () => {
  const stale = projectSignals({
    run: mkRun('running'),
    tasks: [mkTask('t-impl', { plan: { role: 'implementer' }, scopePack: { packId: 'pack-1', version: 1, phaseId: 'QBO-4B1', reconciliationState: 'stale' } })],
    events: mkEvents([]),
  });
  const staleSignal = stale.find((signal) => signal.category === 'scope-pack-stale');
  assert.ok(staleSignal);
  assert.equal(staleSignal.severity, 'warning');
  assert.equal(staleSignal.ownerActionRequired, false);
  assert.equal(stale.filter((signal) => signal.category === 'scope-pack-stale').length, 1);

  const conflict = projectSignals({
    run: mkRun('paused'),
    tasks: [mkTask('t-impl', { plan: { role: 'implementer' }, scopePack: { packId: 'pack-1', version: 1, phaseId: 'QBO-4B1', reconciliationState: 'conflict' } })],
    events: mkEvents([]),
  });
  const conflictSignal = conflict.find((signal) => signal.category === 'scope-pack-stale');
  assert.ok(conflictSignal);
  assert.equal(conflictSignal.ownerActionRequired, true);
  assert.equal(conflictSignal.severity, 'critical');
});

test('ATB-4: provider-fallback and verifier-implementer-disagreement project only from real evidence', () => {
  const withEvidence = projectSignals({
    run: mkRun('running'),
    tasks: [mkTask('t-impl', implementerSpec()), mkTask('t-ver', verifierSpec())],
    events: mkEvents([
      { type: 'workspace.changeset.ready', taskId: 't-impl', attemptId: 'a-impl', payload: { changeCount: 1 } },
      { type: 'control.verifier.verdict', taskId: 't-ver', attemptId: 'a-ver', payload: { verdict: 'fail' } },
      { type: 'execution.completed', taskId: 't-impl', attemptId: 'a-impl', payload: { requestedModel: 'm', reportedModel: 'm', fellBack: true, requestedProvider: 'codex', provider: 'claude' } },
    ]),
  });
  const categories = new Set(withEvidence.map((signal) => signal.category));
  assert.ok(categories.has('provider-fallback'));
  assert.ok(categories.has('verifier-implementer-disagreement'));

  const noEvidence = projectSignals({
    run: mkRun('running'),
    tasks: [mkTask('t-impl', implementerSpec())],
    events: mkEvents([
      { type: 'execution.completed', taskId: 't-impl', attemptId: 'a-impl', payload: { requestedModel: 'm', reportedModel: 'm', provider: 'claude' } },
    ]),
  });
  assert.ok(!noEvidence.some((signal) => signal.category === 'provider-fallback'));
  assert.ok(!noEvidence.some((signal) => signal.category === 'verifier-implementer-disagreement'));
});

test('ATB-7B2: a passed verifier attempt with verdict FAIL still emits disagreement', () => {
  const signals = projectSignals({
    run: mkRun('completed'),
    tasks: [mkTask('t-impl', implementerSpec()), mkTask('t-ver', verifierSpec())],
    events: mkEvents([
      { type: 'workspace.changeset.ready', taskId: 't-impl', attemptId: 'a-impl', payload: { changeCount: 1 } },
      { type: 'execution.completed', taskId: 't-ver', attemptId: 'a-ver', payload: { providerSuccess: true } },
      { type: 'control.verifier.verdict', taskId: 't-ver', attemptId: 'a-ver', payload: { verdict: 'fail', attemptStatus: 'passed', summary: 'Expected smoke file was not visible in the verifier workspace.' } },
    ]),
  });
  const disagreement = signals.find((signal) => signal.category === 'verifier-implementer-disagreement');
  assert.ok(disagreement);
  assert.equal(disagreement.evidenceRefs.includes('verdict=fail'), true);
});

test('changeset-oversized fires when changes exceed authorized paths; identical models never mismatch', () => {
  const events = mkEvents([
    { type: 'workspace.changeset.ready', taskId: 't-impl', attemptId: 'a-1', payload: { changeCount: 5 } },
    { type: 'execution.completed', taskId: 't-impl', attemptId: 'a-1', payload: { requestedModel: 'm', reportedModel: 'm' } },
  ]);
  const signals = projectSignals({ run: mkRun('running'), tasks: [mkTask('t-impl', implementerSpec({ authorizedWritePaths: ['a.ts'] }))], events });
  assert.ok(signals.some((s) => s.category === 'changeset-oversized'));
  assert.ok(!signals.some((s) => s.category === 'model-routing-mismatch'), 'identical requested/reported model is not a mismatch');
});

test('attempt-stalled is honest: a normal long run is NOT flagged; only an over-budget open attempt is', () => {
  // implementerSpec sets control.timeoutMs = 600_000 (10m); budget+grace = 660_000.
  const events = mkEvents([{ type: 'execution.started', taskId: 't-impl', attemptId: 'a-1', createdAt: iso(0) }]);
  const startedMs = BASE;

  // Just started — not stalled.
  assert.ok(!projectSignals({ run: mkRun('running'), tasks: [mkTask('t-impl', implementerSpec())], events, nowMs: startedMs + 1_000 })
    .some((s) => s.category === 'attempt-stalled'));

  // 9 minutes into a healthy long provider turn (under the 10m budget) — a normal
  // RUNNING attempt, NOT a stall. ATB-1's fixed 5m window would have overclaimed here.
  assert.ok(!projectSignals({ run: mkRun('running'), tasks: [mkTask('t-impl', implementerSpec())], events, nowMs: startedMs + 9 * 60_000 })
    .some((s) => s.category === 'attempt-stalled'));

  // 15 minutes — well past the configured 10m budget + grace → genuinely overdue.
  assert.ok(projectSignals({ run: mkRun('running'), tasks: [mkTask('t-impl', implementerSpec())], events, nowMs: startedMs + 15 * 60_000 })
    .some((s) => s.category === 'attempt-stalled'));

  // A terminated attempt (has a terminal execution event) is never stalled.
  const closed = mkEvents([
    { type: 'execution.started', taskId: 't-impl', attemptId: 'a-1', createdAt: iso(0) },
    { type: 'execution.completed', taskId: 't-impl', attemptId: 'a-1', createdAt: iso(1) },
  ]);
  assert.ok(!projectSignals({ run: mkRun('running'), tasks: [mkTask('t-impl', implementerSpec())], events: closed, nowMs: startedMs + 15 * 60_000 })
    .some((s) => s.category === 'attempt-stalled'));
});

/* -------------------------------------------------------------------------- */
/* D. Dedupe / idempotency                                                      */
/* -------------------------------------------------------------------------- */

test('projection is idempotent and duplicate boundary events never duplicate telemetry', () => {
  const tasks = [mkTask('t-impl', implementerSpec())];
  const events = mkEvents([{ type: 'execution.started', taskId: 't-impl', attemptId: 'a-1' }]);
  // Fixed nowMs (under the attempt budget) so both projections are byte-identical.
  const first = projectRunTelemetry({ run: mkRun('running'), tasks, events, nowMs: BASE + 2_000 });
  const second = projectRunTelemetry({ run: mkRun('running'), tasks, events, nowMs: BASE + 2_000 });
  assert.deepEqual(first, second);
  assert.equal(first.interimVerdicts.filter((v) => v.verdictId === 'verdict:started:a-1').length, 1);
});

/* -------------------------------------------------------------------------- */
/* E. Array caps                                                                */
/* -------------------------------------------------------------------------- */

test('telemetry arrays never exceed their caps under many events', () => {
  const defs: EventDef[] = [];
  for (let i = 0; i < 60; i += 1) {
    defs.push({ type: 'execution.started', taskId: 't-impl', attemptId: `a-${i}` });
    defs.push({ type: 'policy.evaluated', taskId: 't-impl', attemptId: `a-${i}`, payload: { accepted: false, changeCount: 1, changes: [{ path: `src/f${i}.ts`, decision: 'deny', reasonCode: 'out-of-scope-write', category: 'OUT_OF_SCOPE_CHANGE' }] } });
  }
  const telemetry = projectRunTelemetry({ run: mkRun('running'), tasks: [mkTask('t-impl', implementerSpec())], events: mkEvents(defs) });
  assert.ok(telemetry.interimVerdicts.length <= MAX_SNAPSHOT_INTERIM_VERDICTS);
  assert.ok(telemetry.handoffs.length <= MAX_SNAPSHOT_HANDOFFS);
  assert.ok(telemetry.signals.length <= MAX_SNAPSHOT_SIGNALS);
});

/* -------------------------------------------------------------------------- */
/* F. Payload byte bounds                                                        */
/* -------------------------------------------------------------------------- */

test('every telemetry item stays within summary/message/evidence bounds', () => {
  const hugePath = `src/${'x'.repeat(5_000)}.ts`;
  const events = mkEvents([
    { type: 'policy.evaluated', taskId: 't-impl', attemptId: 'a-1', payload: { accepted: false, changeCount: 1, changes: [{ path: hugePath, decision: 'deny', reasonCode: 'out-of-scope-write', category: 'OUT_OF_SCOPE_CHANGE', requiresHuman: true }] } },
  ]);
  const telemetry = projectRunTelemetry({ run: mkRun('running'), tasks: [mkTask('t-impl', implementerSpec())], events });
  for (const verdict of telemetry.interimVerdicts) {
    assert.ok(verdict.summary.length <= TELEMETRY_SUMMARY_MAX_CHARS);
    assert.ok(verdict.evidenceRefs.length <= TELEMETRY_EVIDENCE_REF_MAX);
    for (const ref of verdict.evidenceRefs) assert.ok(ref.length <= TELEMETRY_EVIDENCE_REF_MAX_CHARS);
  }
  for (const signal of telemetry.signals) {
    assert.ok(signal.message.length <= TELEMETRY_MESSAGE_MAX_CHARS);
    assert.ok(signal.evidenceRefs.length <= TELEMETRY_EVIDENCE_REF_MAX);
    for (const ref of signal.evidenceRefs) assert.ok(ref.length <= TELEMETRY_EVIDENCE_REF_MAX_CHARS);
  }
  for (const handoff of telemetry.handoffs) assert.ok(handoff.summary.length <= TELEMETRY_SUMMARY_MAX_CHARS);
});

/* -------------------------------------------------------------------------- */
/* G. buildRunSnapshot integration + backward compatibility                     */
/* -------------------------------------------------------------------------- */

test('buildRunSnapshot always includes bounded telemetry arrays (empty for a bare run) and never leaks the prompt', async () => {
  await withStore(async (store) => {
    store.createRun({ runId: 'run-1', title: 'run', goal: 'objective' });
    store.createTask({ taskId: 't-impl', runId: 'run-1', title: 'Implement', goal: 'g', spec: implementerSpec() });
    const snapshot = buildRunSnapshot({ store, runId: 'run-1', verification: null });
    assert.ok(snapshot);
    assert.deepEqual(snapshot.interimVerdicts, []);
    assert.deepEqual(snapshot.signals, []);
    // A run always has an approved plan, so the synthesized Owner→Host handoff is
    // always present; nothing else is, for a run with no lifecycle events yet.
    assert.equal(snapshot.handoffs.length, 1);
    assert.equal(snapshot.handoffs[0].handoffId, 'handoff:plan-approved:run-1');
    assert.ok(!JSON.stringify(snapshot).includes('SECRET PROMPT'));
  });
});

test('buildRunSnapshot does NOT persist any event while projecting telemetry', async () => {
  await withStore(async (store) => {
    store.createRun({ runId: 'run-1', title: 'run', goal: 'objective' });
    store.createTask({ taskId: 't-impl', runId: 'run-1', title: 'Implement', goal: 'g', spec: implementerSpec() });
    store.createAttempt({ attemptId: 'a-1', taskId: 't-impl', hostInstanceId: 'host-1' });
    store.appendEvent({ eventId: 'e-start', runId: 'run-1', taskId: 't-impl', attemptId: 'a-1', type: 'execution.started', payload: {} });
    const before = store.listEvents().length;
    buildRunSnapshot({ store, runId: 'run-1', verification: null });
    buildRunSnapshot({ store, runId: 'run-1', verification: null });
    assert.equal(before, store.listEvents().length, 'telemetry projection must add no durable events');
  });
});

/* -------------------------------------------------------------------------- */
/* H. Telemetry failure cannot strand orchestration                             */
/* -------------------------------------------------------------------------- */

test('malformed event payloads never throw and never blank the core snapshot', async () => {
  await withStore(async (store) => {
    store.createRun({ runId: 'run-1', title: 'run', goal: 'objective' });
    store.createTask({ taskId: 't-impl', runId: 'run-1', title: 'Implement', goal: 'g', spec: implementerSpec() });
    store.createAttempt({ attemptId: 'a-1', taskId: 't-impl', hostInstanceId: 'host-1' });
    store.appendEvent({ eventId: 'e-1', runId: 'run-1', taskId: 't-impl', attemptId: 'a-1', type: 'policy.evaluated', payload: { accepted: 'nope', changes: 'not-an-array', headMoved: 'yes' } as unknown as JsonValue });
    store.appendEvent({ eventId: 'e-2', runId: 'run-1', taskId: 't-impl', attemptId: 'a-1', type: 'workspace.changeset.ready', payload: [] as unknown as JsonValue });
    store.appendEvent({ eventId: 'e-3', runId: 'run-1', taskId: 't-impl', attemptId: 'a-1', type: 'execution.started', payload: null });

    // If projection over malformed evidence threw, this call throws and the test
    // fails — proving the core snapshot is never blanked or stranded.
    const snapshot = buildRunSnapshot({ store, runId: 'run-1', verification: null });
    assert.ok(snapshot);
    assert.equal(snapshot.run.runId, 'run-1');
    assert.ok(Array.isArray(snapshot.interimVerdicts));
    assert.ok(Array.isArray(snapshot.signals));
    assert.ok(Array.isArray(snapshot.handoffs));
  });
});

/* -------------------------------------------------------------------------- */
/* ATB-1B: active-run snapshot heartbeat during a long provider attempt         */
/* -------------------------------------------------------------------------- */

const STUB_CONTROL_PLANE = {} as unknown as ControlPlane;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

test('active-run heartbeat publishes fresh snapshots while a provider Attempt is still awaiting completion', async () => {
  await withStore(async (store) => {
    store.createRun({ runId: 'run-1', title: 'run', goal: 'objective' });
    store.createTask({ taskId: 't-impl', runId: 'run-1', title: 'Implement', goal: 'g', spec: implementerSpec() });

    const published: Array<{ status: string }> = [];
    const publishSnapshot = async (runId: string): Promise<void> => {
      const snap = buildRunSnapshot({ store, runId, verification: null });
      if (snap) published.push({ status: snap.run.status });
    };

    let publishesAtExecuteStart = 0;
    let publishesBeforeResolve = 0;
    let midRunStatus = '';
    let midTaskStatus = '';
    let midAttemptCount = 0;

    const port = {
      execute: async (ctx: AttemptExecutionContext): Promise<void> => {
        publishesAtExecuteStart = published.length;
        // The provider "runs" for a while WITHOUT terminalizing the Attempt.
        await delay(300);
        // Heartbeat is observability only: it must NOT have transitioned anything.
        midRunStatus = store.getRun('run-1')!.status;
        midTaskStatus = store.getTask('t-impl')!.status;
        midAttemptCount = store.listAttempts('t-impl').length;
        publishesBeforeResolve = published.length;
        store.transitionAttempt(ctx.attemptId, 'passed');
      },
    } as unknown as ProductionExecutionPort;

    await driveRunToCompletion({
      store,
      controlPlane: STUB_CONTROL_PLANE,
      executionPort: port,
      runId: 'run-1',
      hostInstanceId: 'host-1',
      publishSnapshot,
      tickIntervalMs: 0,
      snapshotHeartbeatMs: 50,
    });

    // B/F: at least two fresh snapshots published WHILE the provider was awaiting.
    assert.ok(publishesBeforeResolve - publishesAtExecuteStart >= 2, `expected >=2 heartbeat publishes during the wait, got ${publishesBeforeResolve - publishesAtExecuteStart}`);
    // E: heartbeat caused no Run/Task transition and created no Attempt.
    assert.equal(midRunStatus, 'running');
    assert.equal(midTaskStatus, 'running');
    assert.equal(midAttemptCount, 1);
    // C/D: exactly one Attempt, ordinal 1 — no duplicate.
    assert.deepEqual(store.listAttempts('t-impl').map((a) => a.ordinal), [1]);
    // J: final authoritative snapshot reflects supervisor progress.
    assert.equal(store.getRun('run-1')!.status, 'completed');
    assert.equal(published[published.length - 1].status, 'completed');

    // G/H: heartbeat stops cleanly on completion — no ongoing publishes, no timer leak.
    await delay(120); // let any in-flight straggler settle
    const settled = published.length;
    await delay(200);
    assert.equal(published.length, settled, 'no heartbeat publishes after the drive completed');
  });
});

test('a failed heartbeat publish never aborts provider execution or the run', async () => {
  await withStore(async (store) => {
    store.createRun({ runId: 'run-1', title: 'run', goal: 'objective' });
    store.createTask({ taskId: 't-impl', runId: 'run-1', title: 'Implement', goal: 'g', spec: implementerSpec() });

    let failNextHeartbeat = false;
    const publishSnapshot = async (runId: string): Promise<void> => {
      if (failNextHeartbeat) { failNextHeartbeat = false; throw new Error('simulated Supabase publish failure'); }
      buildRunSnapshot({ store, runId, verification: null });
    };
    let snapshotErrors = 0;
    const onSnapshotError = (): void => { snapshotErrors += 1; };

    const port = {
      execute: async (ctx: AttemptExecutionContext): Promise<void> => {
        failNextHeartbeat = true; // the next heartbeat publish will throw
        await delay(200);
        store.transitionAttempt(ctx.attemptId, 'passed');
      },
    } as unknown as ProductionExecutionPort;

    await driveRunToCompletion({
      store,
      controlPlane: STUB_CONTROL_PLANE,
      executionPort: port,
      runId: 'run-1',
      hostInstanceId: 'host-1',
      publishSnapshot,
      tickIntervalMs: 0,
      snapshotHeartbeatMs: 50,
      onSnapshotError,
    });

    // I: the run still completed and the failure was reported (not swallowed silently).
    assert.equal(store.getRun('run-1')!.status, 'completed');
    assert.equal(store.getTask('t-impl')!.status, 'passed');
    assert.ok(snapshotErrors >= 1, 'the heartbeat publish failure must be reported via onSnapshotError');
  });
});

test('a terminal Run creates no active heartbeat loop', async () => {
  await withStore(async (store) => {
    store.createRun({ runId: 'run-1', title: 'run', goal: 'objective' });
    store.createTask({ taskId: 't-impl', runId: 'run-1', title: 'Implement', goal: 'g', spec: implementerSpec() });
    store.transitionRun('run-1', 'running');
    store.transitionRun('run-1', 'completed');

    let publishes = 0;
    const publishSnapshot = async (): Promise<void> => { publishes += 1; };
    const neverPort = { execute: async () => { throw new Error('a terminal run must not execute'); } } as unknown as ProductionExecutionPort;

    await driveRunToCompletion({
      store,
      controlPlane: STUB_CONTROL_PLANE,
      executionPort: neverPort,
      runId: 'run-1',
      hostInstanceId: 'host-1',
      publishSnapshot,
      tickIntervalMs: 0,
      snapshotHeartbeatMs: 20,
    });

    const afterDrive = publishes;
    await delay(120);
    assert.equal(publishes, afterDrive, 'no heartbeat loop keeps publishing for a terminal run');
    assert.ok(afterDrive <= 2, 'a terminal run publishes only the authoritative snapshot(s), not a heartbeat stream');
  });
});
