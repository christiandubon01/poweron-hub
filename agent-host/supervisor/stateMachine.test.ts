import test from 'node:test';
import assert from 'node:assert/strict';

import type { AttemptStatus, JsonValue, RunStatus, TaskStatus } from '../lib/orchestrationTypes.ts';
import {
  decideTaskAfterAttempt,
  evaluateRetryBudget,
  evaluateRunLifecycle,
  normalizeMaxAttempts,
  resolveMaxAttempts,
} from './stateMachine.ts';
import { DEFAULT_MAX_ATTEMPTS, MAX_SUPERVISOR_ATTEMPTS } from './types.ts';
import type { AttemptFailureSummary, RunTaskSnapshot } from './types.ts';

function task(status: TaskStatus = 'running', spec: JsonValue | null = null) {
  return { taskId: 'task-1', status, spec };
}

function attempt(status: AttemptStatus, ordinal = 1) {
  return { taskId: 'task-1', status, ordinal };
}

function failure(cause: AttemptFailureSummary['cause']): AttemptFailureSummary {
  return { cause };
}

function run(status: RunStatus = 'running') {
  return { runId: 'run-1', status };
}

function runTask(taskId: string, status: TaskStatus, retryAvailable?: boolean): RunTaskSnapshot {
  return { taskId, status, ...(retryAvailable === undefined ? {} : { retryAvailable }) };
}

test('supervisor: passed Attempt marks its running Task passed', () => {
  assert.deepEqual(decideTaskAfterAttempt({ task: task(), attempt: attempt('passed') }), {
    type: 'MARK_TASK_PASSED', taskId: 'task-1',
  });
});

test('supervisor: already-passed Task is idempotent for a passed Attempt', () => {
  assert.equal(decideTaskAfterAttempt({ task: task('passed'), attempt: attempt('passed') }).type, 'NO_ACTION');
});

test('supervisor: pending Task plus passed Attempt converges parent truth without redispatch', () => {
  assert.equal(decideTaskAfterAttempt({ task: task('pending'), attempt: attempt('passed') }).type, 'MARK_TASK_PASSED');
});

test('supervisor: retryable failure under budget schedules the next durable ordinal', () => {
  assert.deepEqual(decideTaskAfterAttempt({
    task: task('running', { supervisor: { maxAttempts: 3 } }),
    attempt: attempt('failed', 1),
    failure: failure('provider-process-failure'),
  }), {
    type: 'SCHEDULE_RETRY',
    taskId: 'task-1',
    completedAttemptOrdinal: 1,
    nextAttemptOrdinal: 2,
    maxAttempts: 3,
    transitionPath: ['failed', 'blocked', 'pending'],
    requiresDependencyReevaluation: true,
  });
});

test('supervisor: retryable failure at budget marks the Task failed', () => {
  assert.deepEqual(decideTaskAfterAttempt({
    task: task('running', { supervisor: { maxAttempts: 2 } }),
    attempt: attempt('failed', 2),
    failure: failure('provider-process-failure'),
  }), { type: 'MARK_TASK_FAILED', taskId: 'task-1', reason: 'budget-exhausted' });
});

test('supervisor: policy rejection never retries even with remaining budget', () => {
  assert.deepEqual(decideTaskAfterAttempt({
    task: task('running', { supervisor: { maxAttempts: 5 } }),
    attempt: attempt('failed'),
    failure: failure('policy-rejection'),
  }), { type: 'MARK_TASK_FAILED', taskId: 'task-1', reason: 'non-retryable-cause' });
});

test('supervisor: timeout retries only when the configured budget remains', () => {
  assert.equal(decideTaskAfterAttempt({
    task: task('running', { supervisor: { maxAttempts: 2 } }),
    attempt: attempt('failed'),
    failure: failure('execution-timeout'),
  }).type, 'SCHEDULE_RETRY');
});

test('supervisor: timeout at its maximum ordinal is exhausted', () => {
  assert.equal(decideTaskAfterAttempt({
    task: task('running', { supervisor: { maxAttempts: 2 } }),
    attempt: attempt('failed', 2),
    failure: failure('execution-timeout'),
  }).type, 'MARK_TASK_FAILED');
});

test('supervisor: interrupted Attempt retries under budget', () => {
  assert.equal(decideTaskAfterAttempt({
    task: task('running', { supervisor: { maxAttempts: 2 } }),
    attempt: attempt('interrupted'),
  }).type, 'SCHEDULE_RETRY');
});

test('supervisor: interrupted Attempt fails when budget is exhausted', () => {
  assert.equal(decideTaskAfterAttempt({ task: task(), attempt: attempt('interrupted') }).type, 'MARK_TASK_FAILED');
});

test('supervisor: cancelled Attempt marks Task cancelled and never retries', () => {
  assert.equal(decideTaskAfterAttempt({
    task: task('running', { supervisor: { maxAttempts: 10 } }),
    attempt: attempt('cancelled'),
  }).type, 'MARK_TASK_CANCELLED');
});

test('supervisor: running Attempt has no terminal propagation action', () => {
  assert.equal(decideTaskAfterAttempt({ task: task(), attempt: attempt('running') }).type, 'NO_ACTION');
});

test('supervisor: crash snapshot running Task plus terminal Attempt converges to passed', () => {
  assert.equal(decideTaskAfterAttempt({ task: task('running'), attempt: attempt('passed') }).type, 'MARK_TASK_PASSED');
});

test('supervisor: default maxAttempts is one initial Attempt and zero retries', () => {
  assert.equal(resolveMaxAttempts(null), DEFAULT_MAX_ATTEMPTS);
  assert.equal(decideTaskAfterAttempt({
    task: task(), attempt: attempt('failed'), failure: failure('provider-process-failure'),
  }).type, 'MARK_TASK_FAILED');
});

test('supervisor: malformed maxAttempts values fail closed to one', () => {
  const malformed = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_SUPERVISOR_ATTEMPTS + 1, '3', null];
  for (const value of malformed) {
    assert.equal(normalizeMaxAttempts(value), 1);
    assert.equal(resolveMaxAttempts({ supervisor: { maxAttempts: value } } as unknown as JsonValue), 1);
  }
});

test('supervisor: valid maximum retry bound is accepted', () => {
  assert.equal(resolveMaxAttempts({ supervisor: { maxAttempts: MAX_SUPERVISOR_ATTEMPTS } }), 10);
});

test('supervisor: retry budget examples use durable Attempt ordinal', () => {
  assert.equal(evaluateRetryBudget({ attemptOrdinal: 1, maxAttempts: 1, cause: 'provider-process-failure' }).retryAllowed, false);
  assert.equal(evaluateRetryBudget({ attemptOrdinal: 1, maxAttempts: 2, cause: 'provider-process-failure' }).retryAllowed, true);
  assert.equal(evaluateRetryBudget({ attemptOrdinal: 2, maxAttempts: 2, cause: 'provider-process-failure' }).retryAllowed, false);
});

test('supervisor: retry budget rejects policy, cancellation, and invalid ordinals', () => {
  assert.equal(evaluateRetryBudget({ attemptOrdinal: 1, maxAttempts: 5, cause: 'policy-rejection' }).retryAllowed, false);
  assert.equal(evaluateRetryBudget({ attemptOrdinal: 1, maxAttempts: 5, cause: 'cancelled' }).retryAllowed, false);
  assert.equal(evaluateRetryBudget({ attemptOrdinal: 0, maxAttempts: 5, cause: 'host-interrupted' }).retryAllowed, false);
});

test('supervisor: human gate produces safe pause metadata without retry', () => {
  assert.deepEqual(decideTaskAfterAttempt({
    task: task(),
    attempt: attempt('failed'),
    failure: { cause: 'human-gate', gate: { taskId: 'task-1', gateKind: 'protected-write', reason: 'Owner approval required.' } },
  }), {
    type: 'PAUSE_FOR_GATE',
    scope: 'task',
    taskId: 'task-1',
    gateKind: 'protected-write',
    reason: 'Owner approval required.',
    transitionPath: [],
  });
});

test('supervisor: mismatched Attempt and Task identities fail closed', () => {
  assert.equal(decideTaskAfterAttempt({
    task: task(), attempt: { ...attempt('passed'), taskId: 'task-other' },
  }).type, 'NO_ACTION');
});

test('supervisor: zero-task Run does not vacuously complete', () => {
  assert.deepEqual(evaluateRunLifecycle({ run: run('pending'), tasks: [] }), {
    type: 'NO_ACTION', scope: 'run', reason: 'zero-tasks-no-progress',
  });
});

test('supervisor: pending Task starts a pending Run', () => {
  assert.deepEqual(evaluateRunLifecycle({ run: run('pending'), tasks: [runTask('task-1', 'pending')] }), {
    type: 'MARK_RUN_RUNNING', runId: 'run-1', transitionPath: ['running'],
  });
});

test('supervisor: running Task keeps a running Run active', () => {
  assert.equal(evaluateRunLifecycle({ run: run(), tasks: [runTask('task-1', 'running')] }).type, 'NO_ACTION');
});

test('supervisor: single passed Task completes a running Run', () => {
  assert.equal(evaluateRunLifecycle({ run: run(), tasks: [runTask('task-1', 'passed')] }).type, 'MARK_RUN_COMPLETED');
});

test('supervisor: single terminally failed required Task fails the Run', () => {
  assert.equal(evaluateRunLifecycle({ run: run(), tasks: [runTask('task-1', 'failed')] }).type, 'MARK_RUN_FAILED');
});

test('supervisor: independently cancelled required Task fails the Run', () => {
  assert.equal(evaluateRunLifecycle({ run: run(), tasks: [runTask('task-1', 'cancelled')] }).type, 'MARK_RUN_FAILED');
});

test('supervisor: two passed Tasks complete the Run', () => {
  assert.equal(evaluateRunLifecycle({
    run: run(), tasks: [runTask('task-1', 'passed'), runTask('task-2', 'passed')],
  }).type, 'MARK_RUN_COMPLETED');
});

test('supervisor: one passed Task never completes a multi-task Run with pending work', () => {
  assert.equal(evaluateRunLifecycle({
    run: run(), tasks: [runTask('task-1', 'passed'), runTask('task-2', 'pending')],
  }).type, 'NO_ACTION');
});

test('supervisor: one passed Task never completes a multi-task Run with running work', () => {
  assert.equal(evaluateRunLifecycle({
    run: run(), tasks: [runTask('task-1', 'passed'), runTask('task-2', 'running')],
  }).type, 'NO_ACTION');
});

test('supervisor: terminal failure wins over a passed sibling', () => {
  assert.equal(evaluateRunLifecycle({
    run: run(), tasks: [runTask('task-1', 'passed'), runTask('task-2', 'failed')],
  }).type, 'MARK_RUN_FAILED');
});

test('supervisor: all progress blocked by a human gate pauses the Run', () => {
  assert.deepEqual(evaluateRunLifecycle({
    run: run(),
    tasks: [runTask('task-1', 'blocked')],
    blockedByHumanGate: { taskId: 'task-1', gateKind: 'owner-approval', reason: 'Owner decision required.' },
  }), {
    type: 'PAUSE_FOR_GATE',
    scope: 'run',
    runId: 'run-1',
    taskId: 'task-1',
    gateKind: 'owner-approval',
    reason: 'Owner decision required.',
    transitionPath: ['paused'],
  });
});

test('supervisor: unknown human-gate Task metadata cannot pause a Run', () => {
  assert.equal(evaluateRunLifecycle({
    run: run(),
    tasks: [runTask('task-1', 'pending')],
    blockedByHumanGate: { taskId: 'task-missing', gateKind: 'owner-approval', reason: 'Unknown gate.' },
  }).type, 'NO_ACTION');
});

test('supervisor: already completed Run is not completed twice', () => {
  assert.equal(evaluateRunLifecycle({ run: run('completed'), tasks: [runTask('task-1', 'passed')] }).type, 'NO_ACTION');
});

test('supervisor: already failed Run is not resurrected', () => {
  assert.equal(evaluateRunLifecycle({ run: run('failed'), tasks: [runTask('task-1', 'pending')] }).type, 'NO_ACTION');
});

test('supervisor: cancelled Run is never resurrected', () => {
  assert.equal(evaluateRunLifecycle({ run: run('cancelled'), tasks: [runTask('task-1', 'passed')] }).type, 'NO_ACTION');
});

test('supervisor: explicit cancellation request produces Run cancellation only', () => {
  assert.deepEqual(evaluateRunLifecycle({
    run: run(), tasks: [runTask('task-1', 'running')], cancellationRequested: true,
  }), { type: 'MARK_RUN_CANCELLED', runId: 'run-1', transitionPath: ['cancelled'] });
});

test('supervisor: retryable failed Task keeps the Run progressing', () => {
  assert.equal(evaluateRunLifecycle({
    run: run(), tasks: [runTask('task-1', 'failed', true)],
  }).type, 'NO_ACTION');
});

test('supervisor: Attempt decisions are deterministic and deep-equal', () => {
  const input = {
    task: task('running', { supervisor: { maxAttempts: 3 } }),
    attempt: attempt('interrupted'),
  };
  assert.deepEqual(decideTaskAfterAttempt(input), decideTaskAfterAttempt(input));
});

test('supervisor: Run decisions are deterministic and deep-equal', () => {
  const input = { run: run(), tasks: [runTask('task-1', 'passed'), runTask('task-2', 'pending')] };
  assert.deepEqual(evaluateRunLifecycle(input), evaluateRunLifecycle(input));
});
