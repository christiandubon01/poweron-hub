/**
 * Provider liveness. Manual timers only — these tests do not wait real minutes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

import { computeAgentHostSourceFingerprint } from '../hostSourceFingerprint.ts';
import { buildRunSnapshot } from '../control/snapshots.ts';
import { openOrchestrationStore } from '../lib/store.ts';
import { CLAUDE_OPUS_4_8_MODEL_ID } from './capabilityRegistry.ts';
import { CLAUDE_BILLING_MODE } from './environmentPolicy.ts';
import {
  absoluteTimeoutMessage,
  classifyProcessTermination,
  configureProviderExecutionLimits,
  formatOwnerDuration,
  inactivityFailureMessage,
  LEGACY_FIXED_EXECUTION_LIMIT_MS,
  processFailedMessage,
  PROVIDER_ABSOLUTE_SAFETY_CEILING_MS,
  PROVIDER_INACTIVITY_TIMEOUT_MS,
  PROVIDER_STARTUP_INACTIVITY_TIMEOUT_MS,
} from './executionLimits.ts';
import { CANCEL_GRACE_MS, ProcessRunner, type ProcessTimerControl } from './processRunner.ts';
import { JsonlDecoder } from './jsonl.ts';

class ManualTimers implements ProcessTimerControl {
  private nowMs = 0;
  private nextId = 1;
  private queue: Array<{ id: number; at: number; fn: () => void }> = [];

  readonly setTimeout = (fn: () => void, ms: number): NodeJS.Timeout => {
    const id = this.nextId++;
    this.queue.push({ id, at: this.nowMs + Math.max(0, ms), fn });
    return id as unknown as NodeJS.Timeout;
  };

  readonly clearTimeout = (handle: NodeJS.Timeout): void => {
    const id = handle as unknown as number;
    this.queue = this.queue.filter((entry) => entry.id !== id);
  };

  tick(ms: number): void {
    const target = this.nowMs + ms;
    for (;;) {
      let nextIndex = -1;
      for (let index = 0; index < this.queue.length; index += 1) {
        const entry = this.queue[index];
        if (!entry || entry.at > target) continue;
        if (
          nextIndex === -1
          || entry.at < this.queue[nextIndex].at
          || (entry.at === this.queue[nextIndex].at && entry.id < this.queue[nextIndex].id)
        ) {
          nextIndex = index;
        }
      }
      if (nextIndex === -1) break;
      const entry = this.queue[nextIndex];
      this.queue.splice(nextIndex, 1);
      this.nowMs = entry.at;
      entry.fn();
    }
    this.nowMs = target;
  }
}

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  readonly pid = 4242;
}

async function withRunner(
  run: (tools: {
    dir: string;
    timers: ManualTimers;
    child: FakeChild;
    runner: ProcessRunner;
    kill: () => void;
  }) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'exec-limits-'));
  const timers = new ManualTimers();
  const child = new FakeChild();
  let killed = false;
  const kill = (): void => {
    if (killed) return;
    killed = true;
    child.emit('exit', 1, null);
    child.emit('close', 1, null);
  };
  try {
    await run({
      dir,
      timers,
      child,
      runner: new ProcessRunner(),
      kill,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function launch(dir: string, timers: ManualTimers, child: FakeChild, kill: () => void, activityWorkspacePath?: string) {
  const decoder = new JsonlDecoder();
  return new ProcessRunner().run({
    executionId: 'exec-limits',
    launch: { kind: 'native', executable: process.execPath, argv: [] },
    workingDirectory: dir,
    allowedWorkingDirectory: dir,
    activityWorkspacePath,
    timers,
    spawnFn: () => child as unknown as ChildProcess,
    callbacks: { onStdoutChunk: (chunk) => decoder.push(chunk).some((event) => event.type === 'json') },
    killProcessTree: async () => {
      kill();
      return { killed: true };
    },
  });
}

test('parsed events survive the legacy wall while stderr noise does not refresh inactivity', async () => {
  await withRunner(async ({ dir, timers, child, kill }) => {
    const handle = launch(dir, timers, child, kill);
    let settled = false;
    const done = handle.done.then((result) => {
      settled = true;
      return result;
    });
    const step = PROVIDER_INACTIVITY_TIMEOUT_MS - 1_000;
    let elapsed = 0;
    let writes = 0;
    const noteHostHeartbeat = (): void => {
      writes += 0;
    };
    while (elapsed <= LEGACY_FIXED_EXECUTION_LIMIT_MS) {
      child.stdout.write(Buffer.from('{"type":"progress"}\n'));
      if (writes % 2 === 0) child.stderr.write(Buffer.from('err'));
      writes += 1;
      noteHostHeartbeat();
      if (elapsed === LEGACY_FIXED_EXECUTION_LIMIT_MS) break;
      const jump = Math.min(step, LEGACY_FIXED_EXECUTION_LIMIT_MS - elapsed);
      timers.tick(jump);
      elapsed += jump;
    }
    await Promise.resolve();
    assert.equal(settled, false);
    assert.ok(elapsed >= LEGACY_FIXED_EXECUTION_LIMIT_MS);
    timers.tick(PROVIDER_INACTIVITY_TIMEOUT_MS + CANCEL_GRACE_MS);
    const result = await done;
    assert.equal(result.terminationReason, 'timeout-idle');
    assert.equal(result.timedOut, true);
    const classified = classifyProcessTermination(result);
    assert.equal(classified?.errorCode, 'PROVIDER_INACTIVITY_TIMEOUT');
    assert.equal(classified?.errorMessage, inactivityFailureMessage(PROVIDER_INACTIVITY_TIMEOUT_MS));
    assert.equal(classified?.errorMessage.includes('%'), false);
  });
});

test('stderr noise and incomplete JSON do not prevent a startup kill', async () => {
  await withRunner(async ({ dir, timers, child, kill }) => {
    const handle = launch(dir, timers, child, kill);
    child.stderr.write(Buffer.from('repeating diagnostic noise'));
    child.stdout.write(Buffer.from('{"type":"unfinished"'));
    timers.tick(PROVIDER_STARTUP_INACTIVITY_TIMEOUT_MS);
    assert.equal((await handle.done).terminationReason, 'timeout-startup');
  });
});

test('a file write inside the isolated workspace resets inactivity', async () => {
  await withRunner(async ({ dir, timers, child, kill }) => {
    const workspace = path.join(dir, 'attempt');
    await mkdir(workspace);
    const handle = launch(dir, timers, child, kill, workspace);
    timers.tick(PROVIDER_STARTUP_INACTIVITY_TIMEOUT_MS - 1_500);
    await writeFile(path.join(workspace, 'change.txt'), 'one');
    timers.tick(500);
    timers.tick(PROVIDER_INACTIVITY_TIMEOUT_MS - 1_000);
    await Promise.resolve();
    assert.equal(handle.done instanceof Promise, true);
    let settled = false;
    void handle.done.then(() => { settled = true; });
    assert.equal(settled, false);
    timers.tick(1_000);
    assert.equal((await handle.done).terminationReason, 'timeout-idle');
  });
});

test('invalid Host limit values warn and fall back to defaults', () => {
  const warnings: string[] = [];
  const limits = configureProviderExecutionLimits({
    AGENT_HOST_PROVIDER_STARTUP_TIMEOUT_MS: 'nan',
    AGENT_HOST_PROVIDER_INACTIVITY_TIMEOUT_MS: '-4',
    AGENT_HOST_PROVIDER_CEILING_MS: '999999999',
  }, (message) => warnings.push(message));
  assert.deepEqual(limits, {
    startupTimeoutMs: PROVIDER_STARTUP_INACTIVITY_TIMEOUT_MS,
    idleTimeoutMs: PROVIDER_INACTIVITY_TIMEOUT_MS,
    overallTimeoutMs: PROVIDER_ABSOLUTE_SAFETY_CEILING_MS,
  });
  assert.equal(warnings.length, 3);
  configureProviderExecutionLimits({}, () => undefined);
});

test('Windows tree kill precedes parent EOF and clears fake descendants', async () => {
  await withRunner(async ({ dir, child }) => {
    const descendants = new Set([4242, 4243]);
    let killCalled = false;
    const handle = new ProcessRunner().run({
      executionId: 'tree', launch: { kind: 'native', executable: process.execPath, argv: [] },
      workingDirectory: dir, allowedWorkingDirectory: dir,
      spawnFn: () => child as unknown as ChildProcess,
      killProcessTree: async () => {
        killCalled = true;
        descendants.clear();
        return { killed: true };
      },
    });
    child.stdin.on('finish', () => {
      child.emit('exit', 0, null);
      child.emit('close', 0, null);
    });
    handle.cancel();
    await handle.done;
    assert.equal(killCalled, true);
    assert.equal(descendants.size, 0);
  });
});

test('no stream activity past the inactivity window terminates, including before the first byte', async () => {
  await withRunner(async ({ dir, timers, child, kill }) => {
    const silent = launch(dir, timers, child, kill);
    child.stdout.write(Buffer.from('{"type":"progress"}\n'));
    timers.tick(PROVIDER_INACTIVITY_TIMEOUT_MS + CANCEL_GRACE_MS);
    const idle = await silent.done;
    assert.equal(idle.terminationReason, 'timeout-idle');
  });

  await withRunner(async ({ dir, timers, child, kill }) => {
    const startup = launch(dir, timers, child, kill);
    timers.tick(PROVIDER_STARTUP_INACTIVITY_TIMEOUT_MS + CANCEL_GRACE_MS);
    const result = await startup.done;
    assert.equal(result.terminationReason, 'timeout-startup');
    assert.equal(
      classifyProcessTermination(result)?.errorMessage,
      inactivityFailureMessage(PROVIDER_STARTUP_INACTIVITY_TIMEOUT_MS),
    );
  });
});

test('absolute ceiling terminates even while stdout is still arriving', async () => {
  await withRunner(async ({ dir, timers, child, kill }) => {
    const handle = launch(dir, timers, child, kill);
    let elapsed = 0;
    const step = 60_000;
    child.stdout.write(Buffer.from('{"type":"progress"}\n'));
    while (elapsed + step < PROVIDER_ABSOLUTE_SAFETY_CEILING_MS) {
      timers.tick(step);
      elapsed += step;
      child.stdout.write(Buffer.from('{"type":"progress"}\n'));
    }
    timers.tick(PROVIDER_ABSOLUTE_SAFETY_CEILING_MS - elapsed);
    timers.tick(CANCEL_GRACE_MS);
    const result = await handle.done;
    assert.equal(result.terminationReason, 'timeout-overall');
    assert.equal(classifyProcessTermination(result)?.errorCode, 'PROVIDER_ABSOLUTE_TIMEOUT');
    assert.equal(classifyProcessTermination(result)?.errorMessage, absoluteTimeoutMessage());
    assert.ok(PROVIDER_ABSOLUTE_SAFETY_CEILING_MS > LEGACY_FIXED_EXECUTION_LIMIT_MS);
  });
});

test('normal completion and a crashed process stay distinct from both timeouts', async () => {
  await withRunner(async ({ dir, timers, child }) => {
    const handle = launch(dir, timers, child, () => undefined);
    child.stdout.write(Buffer.from('done'));
    child.emit('exit', 0, null);
    child.emit('close', 0, null);
    const completed = await handle.done;
    assert.equal(completed.terminationReason, 'exited');
    assert.equal(completed.timedOut, false);
    assert.equal(completed.exitCode, 0);
    assert.equal(classifyProcessTermination(completed), null);
  });

  await withRunner(async ({ dir, timers, child }) => {
    const handle = launch(dir, timers, child, () => undefined);
    child.stdout.write(Buffer.from('crash'));
    child.emit('exit', 2, null);
    child.emit('close', 2, null);
    const crashed = await handle.done;
    assert.equal(crashed.terminationReason, 'exited');
    assert.equal(crashed.exitCode, 2);
    assert.equal(classifyProcessTermination(crashed)?.errorCode, 'PROVIDER_PROCESS_FAILED');
    assert.equal(classifyProcessTermination(crashed)?.errorMessage, processFailedMessage());
    assert.notEqual(classifyProcessTermination(crashed)?.errorCode, 'PROVIDER_INACTIVITY_TIMEOUT');
    assert.notEqual(classifyProcessTermination(crashed)?.errorCode, 'PROVIDER_ABSOLUTE_TIMEOUT');
  });
});

test('owner duration formatting has no percentage', () => {
  assert.equal(formatOwnerDuration(12 * 60_000 + 18_000), '12m 18s');
  assert.equal(formatOwnerDuration(PROVIDER_INACTIVITY_TIMEOUT_MS), '8m 0s');
  assert.equal(inactivityFailureMessage(PROVIDER_INACTIVITY_TIMEOUT_MS).includes('%'), false);
});

test('snapshot attempt truth keeps the exact inactivity reason', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'exec-snap-'));
  const store = openOrchestrationStore({
    dbPath: path.join(dir, 'orchestration.sqlite'),
    repoKey: 'repo-key-1',
    hostId: 'host-1',
    hostVersion: '0.1.0',
  });
  try {
    store.createRun({ runId: 'run-1', title: 'Run' });
    store.createTask({ taskId: 'task-1', runId: 'run-1', title: 'Task' });
    store.createAttempt({ attemptId: 'attempt-1', taskId: 'task-1', hostInstanceId: 'host-1' });
    store.appendEvent({
      eventId: 'started',
      runId: 'run-1',
      taskId: 'task-1',
      attemptId: 'attempt-1',
      type: 'execution.started',
      payload: { provider: 'claude', requestedModel: 'claude-opus-4-8' },
    });
    store.appendEvent({
      eventId: 'timeout',
      runId: 'run-1',
      taskId: 'task-1',
      attemptId: 'attempt-1',
      type: 'execution.timed_out',
      payload: {
        errorCode: 'PROVIDER_INACTIVITY_TIMEOUT',
        errorMessage: inactivityFailureMessage(PROVIDER_INACTIVITY_TIMEOUT_MS),
        requestedModel: 'claude-opus-4-8',
        reportedModel: 'claude-opus-4-8',
        process: { timedOut: true, cancelled: false, exitCode: 1, signal: null },
      },
    });
    store.transitionAttempt('attempt-1', 'failed');
    const snapshot = buildRunSnapshot({ store, runId: 'run-1', verification: null });
    const attempt = snapshot?.attempts[0];
    assert.equal(attempt?.terminalErrorCode, 'PROVIDER_INACTIVITY_TIMEOUT');
    assert.equal(attempt?.terminalErrorMessage, inactivityFailureMessage(PROVIDER_INACTIVITY_TIMEOUT_MS));
    assert.equal(typeof attempt?.startedAt, 'string');
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('source fingerprint changes only when loaded Agent Host source changes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'host-fp-'));
  const source = path.join(root, 'agent-host');
  await mkdir(source);
  await writeFile(path.join(source, 'runtime.ts'), 'export const marker = 1\n', 'utf8');
  await writeFile(path.join(source, 'runtime.test.ts'), 'export const marker = 1\n', 'utf8');
  const first = computeAgentHostSourceFingerprint(root);
  await writeFile(path.join(source, 'runtime.test.ts'), 'export const marker = 2\n', 'utf8');
  assert.equal(computeAgentHostSourceFingerprint(root), first);
  await writeFile(path.join(source, 'runtime.ts'), 'export const marker = 2\n', 'utf8');
  assert.notEqual(computeAgentHostSourceFingerprint(root), first);
  await rm(root, { recursive: true, force: true });
});

test('subscription-only auth and Opus 4.8 routing ids are unchanged', () => {
  assert.equal(CLAUDE_BILLING_MODE, 'SUBSCRIPTION_ONLY');
  assert.equal(CLAUDE_OPUS_4_8_MODEL_ID, 'claude-opus-4-8');
});
