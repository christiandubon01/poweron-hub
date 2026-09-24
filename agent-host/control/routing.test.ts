/**
 * ATB-2: Role routing + model ladder + effort-propagation tests.
 * Fixtures only — NO live model executions.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { openOrchestrationStore, type OrchestrationStore } from '../lib/store.ts';
import { ProductionExecutionPort } from './supervisorPort.ts';
import {
  resolveRoleRouting,
  selectRoutingCandidate,
  effortForRole,
} from './routing.ts';
import { buildClaudeLaunchDescriptor } from '../providers/claude.ts';
import type { ExecutionRequest } from '../providers/types.ts';
import type { JsonValue } from '../lib/orchestrationTypes.ts';

async function withStore(work: (store: OrchestrationStore) => Promise<void>): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'orch-routing-'));
  const store = openOrchestrationStore({
    dbPath: path.join(tempDir, 'orchestration.sqlite'),
    repoKey: 'repo-key-1', hostId: 'host-1', hostVersion: '0.1.0',
    idGenerator: (() => { let n = 0; return () => `evt-${++n}`; })(),
  });
  try { await work(store); } finally { store.close(); await rm(tempDir, { recursive: true, force: true }); }
}

function specWithEffort(effort: string | null): JsonValue {
  return {
    control: { provider: 'codex', requestedModel: 'gpt-5.6', reasoningEffort: effort, permissionProfile: 'task-implementer', prompt: 'Do the work.', timeoutMs: 600_000 },
    policy: { authorizedWritePaths: ['a.ts'] },
    workingDirectory: 'C:\\repo',
    plan: { clientTaskKey: 'impl', role: 'implementer', plannedAreas: ['a'] },
  } as unknown as JsonValue;
}

/* -------------------------------------------------------------------------- */
/* Routing data contract                                                       */
/* -------------------------------------------------------------------------- */

test('resolveRoleRouting with no config yields empty ladders (nothing assumed available)', () => {
  const { routing } = resolveRoleRouting();
  for (const role of ['architect', 'implementer', 'verifier'] as const) {
    assert.deepEqual(routing[role].candidates, []);
    assert.equal(routing[role].identity, null);
  }
});

test('routing preserves identity and sorts candidates by priority', () => {
  const { routing } = resolveRoleRouting({
    implementer: {
      identity: 'Fable',
      candidates: [
        { providerId: 'claude', modelId: null, priority: 2 },
        { providerId: 'codex', modelId: 'gpt-5.6', effort: 'high', priority: 1 },
      ],
    },
  });
  assert.equal(routing.implementer.identity, 'Fable');
  assert.equal(routing.implementer.candidates[0].providerId, 'codex');
  assert.equal(routing.implementer.candidates[0].effort, 'high');
  assert.equal(routing.implementer.candidates[1].providerId, 'claude');
});

test('J(routing): an effort a provider does not support is dropped to null and reported (never coerced)', () => {
  // ATB-2B: codex and claude both genuinely support all four normalized levels
  // (extra-high → native xhigh); OLLAMA supports none — its candidates' effort
  // is dropped to null and reported, never coerced to another level.
  const { routing, effortIssues } = resolveRoleRouting({
    implementer: { candidates: [{ providerId: 'codex', modelId: 'gpt-5.6-sol', effort: 'extra-high' }] },
    verifier: { candidates: [{ providerId: 'claude', modelId: null, effort: 'high' }] },
    architect: { candidates: [{ providerId: 'ollama', modelId: 'qwen3:14b', effort: 'high' }] },
  });
  assert.equal(routing.implementer.candidates[0].effort, 'extra-high', 'codex extra-high now supported (native xhigh)');
  assert.equal(routing.verifier.candidates[0].effort, 'high', 'claude effort is supported');
  assert.equal(routing.architect.candidates[0].effort, null, 'ollama supports no effort');
  assert.equal(effortIssues.length, 1);
  assert.ok(effortIssues.some((i) => i.providerId === 'ollama' && i.effort === 'high'));
});

test('P(fallback): selection falls to a lower-priority candidate only on real provider unavailability', () => {
  const { routing } = resolveRoleRouting({
    implementer: { candidates: [
      { providerId: 'codex', modelId: 'gpt-5.6', priority: 0 },
      { providerId: 'claude', modelId: null, priority: 1 },
    ] },
  });
  // Codex available → preferred, no fallback.
  const primary = selectRoutingCandidate(routing.implementer, (p) => p === 'codex');
  assert.equal(primary.candidate?.providerId, 'codex');
  assert.equal(primary.fellBack, false);
  // Codex unavailable → real fallback to claude.
  const fallback = selectRoutingCandidate(routing.implementer, (p) => p === 'claude');
  assert.equal(fallback.candidate?.providerId, 'claude');
  assert.equal(fallback.fellBack, true);
  // Nothing available → no candidate (never a fabricated switch).
  const none = selectRoutingCandidate(routing.implementer, () => false);
  assert.equal(none.candidate, null);
});

/* -------------------------------------------------------------------------- */
/* Effort propagation: routing → task control → ExecutionRequest               */
/* -------------------------------------------------------------------------- */

test('K: effort propagates from role routing through the task spec to the ExecutionRequest', async () => {
  await withStore(async (store) => {
    const resolution = resolveRoleRouting({ implementer: { candidates: [{ providerId: 'codex', modelId: 'gpt-5.6', effort: 'high' }] } });
    const effort = effortForRole('implementer', resolution);
    assert.equal(effort, 'high');

    store.createRun({ runId: 'run-1', title: 'run' });
    store.createTask({ taskId: 'task-1', runId: 'run-1', title: 'task', goal: 'goal', spec: specWithEffort(effort) });

    const captured: Array<Record<string, unknown>> = [];
    const fakeExecutor = {
      execute: async (input: Record<string, unknown>) => {
        captured.push(input);
        return {
          executionId: 'exec-1',
          attempt: { attemptId: input.attemptId, status: 'passed' },
          result: { executionId: 'exec-1', process: { exitCode: 0, signal: null, timedOut: false, cancelled: false }, provider: { terminalState: 'completed', success: true }, model: { requestedModel: 'gpt-5.6', reportedModel: null, reportedModelSource: 'none' }, usage: { source: 'none' }, session: {}, output: {} },
          startedEvent: null, terminalEvent: null, terminalAttemptStatus: 'passed' as const, policy: { accepted: true },
        };
      },
      cancel: () => false,
      shutdown: async () => ({}),
    };

    const port = new ProductionExecutionPort({ store, executor: fakeExecutor as never });
    await port.execute({ runId: 'run-1', taskId: 'task-1', attemptId: 'att-1', attemptOrdinal: 1, hostInstanceId: 'host-1', task: store.getTask('task-1') as never });

    assert.equal(captured.length, 1);
    assert.equal(captured[0].reasoningEffort, 'high', 'effort reached the ExecutionRequest input');
    assert.equal(captured[0].provider, 'codex');
  });
});

test('L: effort is fixed on the created spec — a later routing change never mutates an existing task', async () => {
  await withStore(async (store) => {
    store.createRun({ runId: 'run-1', title: 'run' });
    // Task created with effort 'medium' (a running/created Attempt keeps this).
    store.createTask({ taskId: 'task-1', runId: 'run-1', title: 'task', goal: 'goal', spec: specWithEffort('medium') });

    // The owner "changes" routing to 'high' afterwards — this only affects FUTURE
    // specs; the already-created task's spec is immutable.
    const later = effortForRole('implementer', resolveRoleRouting({ implementer: { candidates: [{ providerId: 'codex', modelId: 'gpt-5.6', effort: 'high' }] } }));
    assert.equal(later, 'high');

    const captured: Array<Record<string, unknown>> = [];
    const fakeExecutor = {
      execute: async (input: Record<string, unknown>) => {
        captured.push(input);
        return {
          executionId: 'exec-1', attempt: { attemptId: input.attemptId, status: 'passed' },
          result: { executionId: 'exec-1', process: { exitCode: 0, signal: null, timedOut: false, cancelled: false }, provider: { terminalState: 'completed', success: true }, model: { requestedModel: 'gpt-5.6', reportedModel: null, reportedModelSource: 'none' }, usage: { source: 'none' }, session: {}, output: {} },
          startedEvent: null, terminalEvent: null, terminalAttemptStatus: 'passed' as const, policy: { accepted: true },
        };
      },
      cancel: () => false, shutdown: async () => ({}),
    };
    const port = new ProductionExecutionPort({ store, executor: fakeExecutor as never });
    await port.execute({ runId: 'run-1', taskId: 'task-1', attemptId: 'att-1', attemptOrdinal: 1, hostInstanceId: 'host-1', task: store.getTask('task-1') as never });

    assert.equal(captured[0].reasoningEffort, 'medium', 'the existing task keeps its original effort, not the new routing value');
  });
});

test('Q: routing → task spec → ExecutionRequest → provider launch descriptor carries model + effort', async () => {
  await withStore(async (store) => {
    // 1) Role routing resolves a claude candidate with model + extra-high effort.
    const resolution = resolveRoleRouting({
      implementer: { candidates: [{ providerId: 'claude', modelId: 'claude-fable-5', effort: 'extra-high' }] },
    });
    const { candidate } = selectRoutingCandidate(resolution.routing.implementer, () => true);
    assert.ok(candidate);
    assert.equal(candidate.providerId, 'claude');
    assert.equal(candidate.modelId, 'claude-fable-5');
    assert.equal(candidate.effort, 'extra-high');

    // 2) The task spec is created from the resolved candidate.
    store.createRun({ runId: 'run-1', title: 'run' });
    store.createTask({
      taskId: 'task-1', runId: 'run-1', title: 'task', goal: 'goal',
      spec: {
        control: {
          provider: candidate.providerId,
          requestedModel: candidate.modelId,
          reasoningEffort: candidate.effort,
          permissionProfile: 'task-implementer',
          prompt: 'Do the work.',
          timeoutMs: 600_000,
        },
        policy: { authorizedWritePaths: ['a.ts'] },
        workingDirectory: 'C:\\repo',
        plan: { clientTaskKey: 'impl', role: 'implementer', plannedAreas: ['a'] },
      } as unknown as JsonValue,
    });

    // 3) The production port propagates the spec into the executor input.
    const captured: Array<Record<string, unknown>> = [];
    const fakeExecutor = {
      execute: async (input: Record<string, unknown>) => {
        captured.push(input);
        return {
          executionId: 'exec-1', attempt: { attemptId: input.attemptId, status: 'passed' },
          result: { executionId: 'exec-1', process: { exitCode: 0, signal: null, timedOut: false, cancelled: false }, provider: { terminalState: 'completed', success: true }, model: { requestedModel: 'claude-fable-5', reportedModel: null, reportedModelSource: 'none' }, usage: { source: 'none' }, session: {}, output: {} },
          startedEvent: null, terminalEvent: null, terminalAttemptStatus: 'passed' as const, policy: { accepted: true },
        };
      },
      cancel: () => false, shutdown: async () => ({}),
    };
    const port = new ProductionExecutionPort({ store, executor: fakeExecutor as never });
    await port.execute({ runId: 'run-1', taskId: 'task-1', attemptId: 'att-1', attemptOrdinal: 1, hostInstanceId: 'host-1', task: store.getTask('task-1') as never });

    assert.equal(captured.length, 1);
    assert.equal(captured[0].provider, 'claude');
    assert.equal(captured[0].requestedModel, 'claude-fable-5');
    assert.equal(captured[0].reasoningEffort, 'extra-high');

    // 4) The provider adapter turns that request into the real CLI launch flags.
    const request: ExecutionRequest = {
      executionId: 'att-1', attemptId: 'att-1', taskId: 'task-1', runId: 'run-1',
      workingDirectory: 'C:\\repo',
      prompt: 'Do the work.',
      requestedModel: captured[0].requestedModel as string,
      reasoningEffort: captured[0].reasoningEffort as string,
      permissionProfile: 'task-implementer',
      timeoutMs: 600_000,
    };
    const launch = buildClaudeLaunchDescriptor({ providerId: 'claude', executable: 'C:\\Tools\\claude.exe' }, request);
    const modelIndex = launch.argv.indexOf('--model');
    const effortIndex = launch.argv.indexOf('--effort');
    assert.equal(launch.argv[modelIndex + 1], 'claude-fable-5');
    assert.equal(launch.argv[effortIndex + 1], 'xhigh');
  });
});
