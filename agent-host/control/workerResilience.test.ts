/**
 * CT-REL-2: Host resilience tests (fakes + temp dirs only).
 *
 * Part A — source fingerprint staleness (Host is the single source of truth):
 *   - a line-ending-only (CRLF vs LF) change NEVER changes the fingerprint;
 *   - a real content change DOES (including the one external runtime import);
 *   - the 30s watch flips restartRequired exactly once (sticky);
 *   - a stale Host refuses NEW create_plan / approve_plan with the exact
 *     HOST_RESTART_REQUIRED message, while cancel_run / apply_candidate /
 *     import_scope_pack keep working.
 * Part B — connection resilience: withRetry backoff bounds + budget + refusal
 *   of non-idempotent ops, the health tracker (healthy → degraded → reset),
 *   latest-wins snapshot publishing (amendment 2), the Host log (goal 8 +
 *   amendment 4), process guards (goal 8), and lost-claim recovery
 *   (amendment 3).
 * Amendment 6 — the presence host-status marker is clearly namespaced and can
 *   never be mistaken for a provider.
 *
 * NO live system access: no network, no process kills, no %LOCALAPPDATA% —
 * only temp dirs under os.tmpdir() and injected fakes.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { computeAgentHostSourceFingerprint } from '../hostSourceFingerprint.ts';
import {
  SOURCE_FINGERPRINT_RECHECK_MS,
  startSourceFingerprintWatch,
} from './sourceFingerprintWatch.ts';
import {
  HOST_RESTART_REQUIRED_REQUEST_ERROR,
  buildHostStatusMarker,
  dispatchClaimedBatch,
  gateRestartRequiredRequest,
  isRefusedWhileRestartRequired,
  handleCancelRun,
} from './worker.ts';
import {
  NonIdempotentOperationError,
  jitteredBackoffDelay,
  withRetry,
} from './retry.ts';
import {
  ControlPlane,
  ControlPlaneHealthTracker,
  DEGRADED_CONSECUTIVE_FAILURES,
  DEGRADED_GIVE_UP_WINDOW_MS,
} from './supabaseControl.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScopePackContract } from './scopePack.ts';
import { createLatestWinsPublisher } from './snapshotPublisher.ts';
import {
  HOST_CLAIM_LOST_MESSAGE,
  LOST_CLAIM_THRESHOLD_MS,
  createHeldRequestTracker,
  recoverLostClaims,
} from './lostClaims.ts';
import { handleUncaughtException, handleUnhandledRejection } from './processGuards.ts';
import { createHostLog, HOST_LOG_RETENTION_FILES } from '../lib/hostLog.ts';
import type { HostLog } from '../lib/hostLog.ts';
import type { ClaimedControlRequest } from './supabaseControl.ts';
import type { OrchestrationStore } from '../lib/store.ts';
import { ControlRequestScheduler } from './requestPump.ts';
import {
  HOST_CLAIM_ORPHAN_MESSAGE,
  ORPHAN_CLAIM_THRESHOLD_MS,
  findOrphanClaims,
  sweepOrphanClaims,
} from './orphanClaims.ts';
import { HEARTBEAT_STALE_MS } from '../types.ts';

const NOW = '2026-09-27T10:00:00.000Z';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function controlRequest(type: ClaimedControlRequest['request_type'], payload: Record<string, unknown> = {}): ClaimedControlRequest {
  return {
    id: 'req-1',
    repo_key: 'repo-key-1',
    request_type: type,
    client_request_id: 'client-1',
    payload,
    status: 'claimed',
    created_at: NOW,
  };
}

function requestWith(id: string, type: ClaimedControlRequest['request_type'] = 'cancel_run'): ClaimedControlRequest {
  return { ...controlRequest(type), id };
}

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ct-rel-2-'));
  await mkdir(path.join(root, 'agent-host'), { recursive: true });
  await mkdir(path.join(root, 'src', 'features', 'control-tower'), { recursive: true });
  return root;
}

/* -------------------------------------------------------------------------- */
/* Part A goal 1-2: fingerprint normalization + drift detection                 */
/* -------------------------------------------------------------------------- */

test('a line-ending-only change (LF → CRLF) keeps the fingerprint equal', async () => {
  const root = await makeTempRoot();
  try {
    const sourcePath = path.join(root, 'agent-host', 'sample.ts');
    await writeFile(sourcePath, 'export const value = 1;\nexport const other = 2;\n');
    const withLf = computeAgentHostSourceFingerprint(root);
    await writeFile(sourcePath, 'export const value = 1;\r\nexport const other = 2;\r\n');
    const withCrlf = computeAgentHostSourceFingerprint(root);
    assert.equal(withCrlf, withLf, 'CRLF-only churn must not flip restartRequired');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a real content change (including the external runtime import) changes the fingerprint', async () => {
  const root = await makeTempRoot();
  try {
    await writeFile(path.join(root, 'agent-host', 'sample.ts'), 'export const value = 1;\n');
    const externalPath = path.join(root, 'src', 'features', 'control-tower', 'capacity.ts');
    await writeFile(externalPath, 'export const LIMIT = 1;\n');
    const baseline = computeAgentHostSourceFingerprint(root);

    await writeFile(path.join(root, 'agent-host', 'sample.ts'), 'export const value = 2;\n');
    const changedSource = computeAgentHostSourceFingerprint(root);
    assert.notEqual(changedSource, baseline);

    await writeFile(path.join(root, 'agent-host', 'sample.ts'), 'export const value = 1;\n');
    assert.equal(computeAgentHostSourceFingerprint(root), baseline);

    // The one runtime import outside agent-host/ (amendment 5) is fingerprinted.
    await writeFile(externalPath, 'export const LIMIT = 2;\n');
    const changedExternal = computeAgentHostSourceFingerprint(root);
    assert.notEqual(changedExternal, baseline);

    // Its absence is part of the honest identity too — never a crash.
    await rm(externalPath);
    const missingExternal = computeAgentHostSourceFingerprint(root);
    assert.notEqual(missingExternal, baseline);
    assert.notEqual(missingExternal, changedExternal);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the fingerprint recheck flips restartRequired exactly once (sticky) within one interval', async () => {
  assert.equal(SOURCE_FINGERPRINT_RECHECK_MS, 30_000);
  let calls = 0;
  const drifts: Array<{ detectedAt: string; currentFingerprint: string }> = [];
  const errors: unknown[] = [];
  const watch = startSourceFingerprintWatch({
    repoRoot: 'ignored-by-fake-compute',
    initialFingerprint: 'startup',
    intervalMs: 5,
    compute: () => {
      calls += 1;
      if (calls === 3) throw new Error('disk read hiccup');
      return calls < 4 ? 'startup' : 'changed';
    },
    onDrift: (drift) => {
      drifts.push(drift);
    },
    onError: (error) => {
      errors.push(error);
    },
  });
  try {
    await sleep(80);
    assert.equal(drifts.length, 1, 'drift fires exactly once');
    assert.equal(drifts[0]!.currentFingerprint, 'changed');
    assert.ok(Number.isFinite(Date.parse(drifts[0]!.detectedAt)), 'detection time is reported');
    assert.equal(errors.length, 1, 'a failing recheck is reported, never fatal');
    const callsAtDrift = calls;
    await sleep(40);
    assert.ok(calls <= callsAtDrift + 1, 'detection is sticky — no repeated drift');
    // stop() halts the watch.
    const callsAtStop = calls;
    watch.stop();
    await sleep(30);
    assert.equal(calls, callsAtStop, 'stop() stops the recheck timer');
  } finally {
    watch.stop();
  }
});

/* -------------------------------------------------------------------------- */
/* Part A goal 3: stale Host refuses NEW plan work only                        */
/* -------------------------------------------------------------------------- */

test('a restart-required Host refuses create_plan and approve_plan with the exact message', async () => {
  const failed: Array<{ id: string; error: string }> = [];
  const failRequest = async (id: string, error: string): Promise<void> => {
    failed.push({ id, error });
  };

  for (const type of ['create_plan', 'approve_plan'] as const) {
    failed.length = 0;
    const request = controlRequest(type);
    const refused = await gateRestartRequiredRequest({ request, restartRequired: true, failRequest });
    assert.equal(refused, true, `${type} is refused while stale`);
    assert.deepEqual(failed, [{ id: 'req-1', error: HOST_RESTART_REQUIRED_REQUEST_ERROR }]);
    assert.equal(
      HOST_RESTART_REQUIRED_REQUEST_ERROR,
      'HOST_RESTART_REQUIRED: the connected Host is running older Agent Host code. Stop the Host window and run: npm.cmd run agent-host:control',
    );
  }

  // cancel_run / apply_candidate / import_scope_pack keep working while stale.
  for (const type of ['cancel_run', 'apply_candidate', 'import_scope_pack'] as const) {
    assert.equal(isRefusedWhileRestartRequired(type), false, `${type} is never gated`);
    failed.length = 0;
    const refused = await gateRestartRequiredRequest({ request: controlRequest(type), restartRequired: true, failRequest });
    assert.equal(refused, false);
    assert.equal(failed.length, 0, `${type} must not be failed by the gate`);
  }

  // A fresh Host gates nothing.
  assert.equal(isRefusedWhileRestartRequired('create_plan'), true);
  failed.length = 0;
  assert.equal(await gateRestartRequiredRequest({ request: controlRequest('create_plan'), restartRequired: false, failRequest }), false);
  assert.equal(failed.length, 0);

  // A failRequest failure leaves the row claimed (lost-claim recovery reports it later).
  const refused = await gateRestartRequiredRequest({
    request: controlRequest('create_plan'),
    restartRequired: true,
    failRequest: async () => {
      throw new Error('network down');
    },
  });
  assert.equal(refused, true);
});

test('cancel_run still completes while the Host is restart-required (in-flight / ungated work is unaffected)', async () => {
  const transitions: string[] = [];
  const events: Array<{ type: string; runId: string }> = [];
  const store = {
    getRun: () => ({ runId: 'run-1', status: 'running' }),
    listTasks: () => [],
    listAttempts: () => [],
    listEvents: () => events,
    appendEvent: (input: { type: string; runId: string }) => {
      events.push({ type: input.type, runId: input.runId });
      return input;
    },
    transitionRun: (_runId: string, status: string) => {
      transitions.push(status);
    },
  } as unknown as OrchestrationStore;
  const completed: Array<{ id: string; result: Record<string, unknown> }> = [];
  const controlPlane = {
    completeRequest: async (id: string, result: Record<string, unknown>) => {
      completed.push({ id, result });
    },
    failRequest: async () => {
      throw new Error('cancel_run must not fail while stale');
    },
  } as unknown as ControlPlane;
  // A non-driving run (no active drive, no running attempts): handleCancelRun
  // records the durable intent, finalizes the run, and completes the request.
  await handleCancelRun({
    store,
    controlPlane,
    request: controlRequest('cancel_run', { runId: 'run-1' }),
    isActivelyDriving: () => false,
  });
  assert.deepEqual(transitions, ['cancelled'], 'the run is finalized to cancelled');
  assert.equal(events.length, 1);
  assert.equal(events[0]!.type, 'control.run.cancel_requested', 'durable owner cancel intent is recorded first');
  assert.equal(completed.length, 1);
  assert.equal(completed[0]!.id, 'req-1');
  assert.equal(completed[0]!.result.status, 'cancelling');
});

/* -------------------------------------------------------------------------- */
/* Part B goal 6 + amendment 2: withRetry                                       */
/* -------------------------------------------------------------------------- */

test('jittered backoff grows exponentially, is capped at 30s, and jitters within [half, full]', () => {
  // random() === 1 → the full capped delay; random() === 0 → exactly half.
  assert.equal(jitteredBackoffDelay(0, () => 1), 1_000);
  assert.equal(jitteredBackoffDelay(1, () => 1), 2_000);
  assert.equal(jitteredBackoffDelay(2, () => 1), 4_000);
  assert.equal(jitteredBackoffDelay(4, () => 1), 16_000);
  assert.equal(jitteredBackoffDelay(5, () => 1), 30_000, 'capped at RETRY_MAX_DELAY_MS');
  assert.equal(jitteredBackoffDelay(30, () => 1), 30_000);
  assert.equal(jitteredBackoffDelay(0, () => 0), 500);
  assert.equal(jitteredBackoffDelay(3, () => 0), 4_000);
  for (let index = 0; index < 10; index += 1) {
    const low = jitteredBackoffDelay(index, () => 0);
    const high = jitteredBackoffDelay(index, () => 1);
    assert.ok(low >= high / 2 - 1, 'equal jitter stays in the lower half band');
    assert.ok(high <= 30_000);
  }
});

test('withRetry refuses a non-idempotent operation BEFORE running it', async () => {
  let ran = false;
  await assert.rejects(
    withRetry({
      idempotent: false,
      attempt: async () => {
        ran = true;
        return 'must-not-run';
      },
    }),
    NonIdempotentOperationError,
  );
  assert.equal(ran, false, 'the operation must never execute');
});

test('withRetry retries an idempotent operation with the backoff sequence and returns on success', async () => {
  const delays: number[] = [];
  let attempts = 0;
  const failures: number[] = [];
  const result = await withRetry<string>({
    idempotent: true,
    attempt: async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('transient');
      return 'ok';
    },
    sleep: async (ms) => {
      delays.push(ms);
    },
    random: () => 1,
    now: () => 0,
    onAttemptFailure: (_error, attemptCount) => {
      failures.push(attemptCount);
    },
  });
  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [1_000, 2_000]);
  assert.deepEqual(failures, [1, 2]);
});

test('withRetry gives up once the 60s total budget is spent and reports the give-up', async () => {
  let clock = 0;
  let failures = 0;
  let giveUps = 0;
  const slept: number[] = [];
  const boom = new Error('control plane down');
  await assert.rejects(
    withRetry({
      idempotent: true,
      attempt: async () => {
        clock += 45_000; // each attempt consumes most of the budget
        failures += 1;
        throw boom;
      },
      totalBudgetMs: 60_000,
      now: () => clock,
      sleep: async (ms) => {
        slept.push(ms);
      },
      random: () => 1,
      onGiveUp: () => {
        giveUps += 1;
      },
    }),
    (error: unknown) => error === boom,
  );
  assert.equal(failures, 2, 'budget spent on the second failure');
  assert.deepEqual(slept, [1_000], 'only the first backoff fits in the budget');
  assert.equal(giveUps, 1, 'the give-up is reported once and counts toward health');
});

test('withRetry stops retrying the moment the abort signal fires (shutdown)', async () => {
  const controller = new AbortController();
  controller.abort();
  const slept: number[] = [];
  let failures = 0;
  await assert.rejects(
    withRetry({
      idempotent: true,
      attempt: async () => {
        failures += 1;
        throw new Error('transient');
      },
      signal: controller.signal,
      sleep: async (ms) => {
        slept.push(ms);
      },
    }),
    /transient/,
  );
  assert.equal(failures, 1);
  assert.deepEqual(slept, [], 'an aborted Host never waits on another retry');
});

/* -------------------------------------------------------------------------- */
/* Amendment 1: control-plane health tracker (degraded thresholds)              */
/* -------------------------------------------------------------------------- */

test('health: healthy → degraded at 3 consecutive failures → reset on success → give-up window', () => {
  assert.equal(DEGRADED_CONSECUTIVE_FAILURES, 3);
  assert.equal(DEGRADED_GIVE_UP_WINDOW_MS, 60_000);
  const tracker = new ControlPlaneHealthTracker();

  assert.deepEqual(tracker.getHealth(1_000), { state: 'healthy', consecutiveFailures: 0, lastFailureAt: null });

  tracker.noteAttemptFailure(2_000);
  tracker.noteAttemptFailure(3_000);
  assert.equal(tracker.getHealth(4_000).state, 'healthy', 'two failures are not degraded yet');

  tracker.noteAttemptFailure(4_500);
  const degraded = tracker.getHealth(5_000);
  assert.equal(degraded.state, 'degraded');
  assert.equal(degraded.consecutiveFailures, 3);
  assert.equal(degraded.lastFailureAt, new Date(4_500).toISOString());

  tracker.noteSuccess();
  assert.deepEqual(tracker.getHealth(6_000), { state: 'healthy', consecutiveFailures: 0, lastFailureAt: new Date(4_500).toISOString() });

  // A retry-budget give-up degrades the Host for the following 60s window.
  tracker.noteGiveUp(10_000);
  assert.equal(tracker.getHealth(10_001).state, 'degraded');
  assert.equal(tracker.getHealth(10_000 + 60_000).state, 'degraded', 'still inside the window');
  assert.equal(tracker.getHealth(10_000 + 60_001).state, 'healthy', 'window elapsed');
});

/* -------------------------------------------------------------------------- */
/* Amendment 2: latest-wins snapshot publishing                                 */
/* -------------------------------------------------------------------------- */

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

test('latest-wins publisher drops superseded pending publishes instead of queueing them', async () => {
  const ran: string[] = [];
  const errors: unknown[] = [];
  const publisher = createLatestWinsPublisher({ onError: (error) => errors.push(error) });
  const gate = deferred();

  publisher.publish('run-1', async () => {
    ran.push('job1');
    await gate.promise;
  });
  publisher.publish('run-1', async () => {
    ran.push('job2');
  });
  publisher.publish('run-1', async () => {
    ran.push('job3');
  });
  assert.deepEqual(publisher.inFlightKeys(), ['run-1']);
  assert.deepEqual(publisher.pendingKeys(), ['run-1'], 'job2 was replaced by job3 while pending');

  gate.resolve();
  await sleep(20);
  assert.deepEqual(ran, ['job1', 'job3'], 'the superseded job2 never ran');
  assert.deepEqual(publisher.inFlightKeys(), []);
  assert.deepEqual(publisher.pendingKeys(), []);
  assert.equal(errors.length, 0);
});

test('publishing never blocks the caller, and different run ids stay independent', async () => {
  const ran: string[] = [];
  const publisher = createLatestWinsPublisher();
  const gate = deferred();

  publisher.publish('run-a', async () => {
    ran.push('a');
    await gate.promise;
  });
  // publish() returns immediately even though run-a's job never settles.
  publisher.publish('run-a', () => new Promise<void>(() => undefined));
  publisher.publish('run-b', async () => {
    ran.push('b');
  });
  await sleep(20);
  assert.deepEqual(ran, ['a', 'b'], 'run-b runs even while run-a is stuck in flight');
  gate.resolve();
  await sleep(20);
});

test('a failed publish job is reported through onError and never poisons the key', async () => {
  const errors: unknown[] = [];
  const publisher = createLatestWinsPublisher({ onError: (error) => errors.push(error) });
  const ran: string[] = [];
  publisher.publish('run-1', async () => {
    throw new Error('publish failed');
  });
  publisher.publish('run-1', async () => {
    ran.push('recovered');
  });
  await sleep(20);
  assert.equal(errors.length, 1);
  assert.deepEqual(ran, ['recovered']);
});

/* -------------------------------------------------------------------------- */
/* Goal 8 + amendment 4: Host log (daily files, retention, rate limit)          */
/* -------------------------------------------------------------------------- */

test('host log writes daily files outside the repo with a 14-file retention cap', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ct-rel-2-log-'));
  try {
    assert.equal(HOST_LOG_RETENTION_FILES, 14);
    // Pre-seed 16 older daily files; the FIRST write to today's file must sweep
    // retention and keep only the newest 14.
    for (let day = 1; day <= 16; day += 1) {
      const stamp = `2020-01-${String(day).padStart(2, '0')}`;
      await writeFile(path.join(dir, `agent-host-${stamp}.log`), 'old\n');
    }
    const clockMs = Date.parse('2026-09-27T10:00:00Z');
    const log = createHostLog({ dir, now: () => new Date(clockMs), echo: () => undefined });
    log.info('started');
    log.error('retention sweep trigger');
    const names = (await readdir(dir)).filter((name) => name.startsWith('agent-host-'));
    assert.equal(names.length, 14, 'only the newest 14 daily files survive');
    assert.ok(!names.includes('agent-host-2020-01-01.log'), 'oldest file deleted');
    assert.ok(!names.includes('agent-host-2020-01-02.log'), 'second-oldest file deleted');
    assert.ok(names.includes('agent-host-2026-09-27.log'), 'the active daily file exists');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('host log rate-limits identical errors to one line per minute with a suppressed-count line', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ct-rel-2-log-'));
  try {
    let clockMs = Date.parse('2026-09-27T10:00:00Z');
    const log = createHostLog({ dir, now: () => new Date(clockMs), echo: () => undefined });
    log.error('presence publish failed: connection refused');
    log.error('presence publish failed: connection refused');
    log.error('presence publish failed: connection refused');
    let file = path.join(dir, 'agent-host-2026-09-27.log');
    let contents = await readFile(file, 'utf8');
    assert.equal(contents.split('\n').filter((line) => line.includes('presence publish failed')).length, 1,
      'at most one line per distinct message per minute');

    clockMs += 61_000; // window rolls over
    log.error('presence publish failed: connection refused');
    contents = await readFile(file, 'utf8');
    assert.match(contents, /\[suppressed 2 duplicate line\(s\) in the last minute\]/u);

    // flush() emits pending suppressed counts immediately.
    log.error('presence publish failed: connection refused');
    clockMs += 61_000;
    log.flush();
    contents = await readFile(file, 'utf8');
    assert.match(contents, /\[suppressed 1 duplicate line\(s\) in the last minute\]/u);

    // Only sanitized caller-provided messages are ever written; lines are capped.
    const long = `x`.repeat(600);
    log.error(long);
    contents = await readFile(file, 'utf8');
    assert.ok(contents.includes('…'), 'overlong lines are truncated');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/* -------------------------------------------------------------------------- */
/* Goal 8: process guards                                                      */
/* -------------------------------------------------------------------------- */

test('unhandledRejection is logged and the Host keeps running', () => {
  const lines: string[] = [];
  const log: HostLog = { info: (m) => lines.push(m), error: (m) => lines.push(m), flush: () => undefined };
  let shutdowns = 0;
  handleUnhandledRejection(log, new Error('late background rejection'));
  assert.deepEqual(lines, ['unhandledRejection: late background rejection']);
  assert.equal(shutdowns, 0);
});

test('uncaughtException is logged and shuts down with a FORCED non-zero exit code', async () => {
  const lines: string[] = [];
  const log: HostLog = { info: (m) => lines.push(m), error: (m) => lines.push(m), flush: () => undefined };
  const shutdowns: Array<{ signal: string; code: number }> = [];
  await handleUncaughtException({
    log,
    error: new Error('boom'),
    shutdown: (signal, code) => {
      shutdowns.push({ signal, code });
    },
  });
  assert.deepEqual(lines, ['uncaughtException: boom — shutting down']);
  assert.deepEqual(shutdowns, [{ signal: 'uncaughtException', code: 1 }]);
});

/* -------------------------------------------------------------------------- */
/* Amendment 3: lost-claim recovery                                            */
/* -------------------------------------------------------------------------- */

test('lost-claim recovery fails only THIS Host\'s stale, NOT-HELD claims — never re-executes', async () => {
  assert.equal(LOST_CLAIM_THRESHOLD_MS, 120_000);
  const now = Date.parse(NOW);
  const rows = [
    { id: 'lost-old', claimed_at: new Date(now - 121_000).toISOString() }, // > 120s, not held → recovered
    { id: 'lost-held', claimed_at: new Date(now - 121_000).toISOString() }, // > 120s but HELD → untouched
    { id: 'fresh', claimed_at: new Date(now - 10_000).toISOString() }, // recently claimed → untouched
    { id: 'no-claim-time', claimed_at: null }, // unattributed time → skipped
    { id: 'bad-time', claimed_at: 'not-a-date' }, // unparseable → skipped
  ];
  const failed: Array<{ id: string; error: string }> = [];
  const recovered: string[] = [];
  const held = createHeldRequestTracker();
  held.hold('lost-held');
  const count = await recoverLostClaims({
    listOwnClaimed: async () => rows,
    isHeld: held.isHeld,
    failRequest: async (id, error) => {
      failed.push({ id, error });
    },
    now: () => now,
    onRecovered: (id) => recovered.push(id),
  });
  assert.equal(count, 1);
  assert.deepEqual(failed, [{ id: 'lost-old', error: HOST_CLAIM_LOST_MESSAGE }]);
  assert.equal(HOST_CLAIM_LOST_MESSAGE, 'HOST_CLAIM_LOST: the Host lost track of this request — submit it again.');
  assert.deepEqual(recovered, ['lost-old']);

  // The tracker is a pure in-memory set: hold/release/isHeld (+ poison set).
  held.release('lost-held');
  assert.equal(held.isHeld('lost-held'), false);
  held.markPoisoned('lost-old');
  assert.equal(held.isPoisoned('lost-old'), true);
  assert.equal(held.isPoisoned('anything-else'), false);
});

test('lost-claim recovery reports a failing control plane and fails nothing', async () => {
  const errors: unknown[] = [];
  const failed: string[] = [];
  const count = await recoverLostClaims({
    listOwnClaimed: async () => {
      throw new Error('control plane unreachable');
    },
    isHeld: () => false,
    failRequest: async (id) => {
      failed.push(id);
    },
    onError: (error) => errors.push(error),
  });
  assert.equal(count, 0);
  assert.equal(failed.length, 0);
  assert.equal(errors.length, 1);

  // A per-row failRequest failure is reported without stopping the sweep.
  const recovered: string[] = [];
  const count2 = await recoverLostClaims({
    listOwnClaimed: async () => [
      { id: 'row-fails', claimed_at: new Date(Date.parse(NOW) - 200_000).toISOString() },
      { id: 'row-works', claimed_at: new Date(Date.parse(NOW) - 200_000).toISOString() },
    ],
    isHeld: () => false,
    failRequest: async (id) => {
      if (id === 'row-fails') throw new Error('write failed');
    },
    now: () => Date.parse(NOW),
    onRecovered: (id) => recovered.push(id),
    onError: () => undefined,
  });
  assert.equal(count2, 1);
  assert.deepEqual(recovered, ['row-works']);
});

/* -------------------------------------------------------------------------- */
/* CT-REL-2.1 goal 2: health returns to healthy on the FIRST success            */
/* -------------------------------------------------------------------------- */

test('CT-REL-2.1 goal 2: health returns to healthy on the FIRST success after a retry-budget give-up', () => {
  const tracker = new ControlPlaneHealthTracker();
  tracker.noteGiveUp(10_000);
  assert.equal(tracker.getHealth(10_001).state, 'degraded', 'a give-up degrades the Host');
  assert.equal(tracker.getHealth(10_000 + 60_000).state, 'degraded', 'still degraded inside the window');
  tracker.noteSuccess();
  assert.equal(tracker.getHealth(10_002).state, 'healthy', 'the first success clears the give-up immediately');
  assert.deepEqual(tracker.getHealth(10_003), { state: 'healthy', consecutiveFailures: 0, lastFailureAt: null });
});

test('withRetry reports the successful attempt once, so callers reset (health/backoff) on success', async () => {
  let successes = 0;
  let attempts = 0;
  const result = await withRetry({
    idempotent: true,
    attempt: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('transient');
      return 'ok';
    },
    sleep: async () => undefined,
    random: () => 1,
    now: () => 0,
    onSuccess: () => {
      successes += 1;
    },
  });
  assert.equal(result, 'ok');
  assert.equal(attempts, 2);
  assert.equal(successes, 1, 'onSuccess fires exactly once, after the final attempt');
});

/* -------------------------------------------------------------------------- */
/* CT-REL-2.1 goal 1: batch dispatch holds every row from receipt               */
/* -------------------------------------------------------------------------- */

test('CT-REL-2.1 goal 1: rows 2 and 3 of a batch are never failed as lost while row 1 runs past the threshold, and dispatch normally', async () => {
  const held = createHeldRequestTracker();
  const rows = [requestWith('req-1'), requestWith('req-2'), requestWith('req-3')];
  const failed: Array<{ id: string; error: string }> = [];
  let clockMs = 1_000;
  const dispatchOrder: string[] = [];

  await dispatchClaimedBatch({
    requests: rows,
    held,
    isRunning: () => true,
    dispatch: async (request) => {
      dispatchOrder.push(request.id);
      if (request.id === 'req-1') {
        // Row 1's handler outlives the lost-claim threshold while rows 2 and 3
        // are still waiting their turn in the SAME batch — recovery (the 30s
        // timer) must not fail the held siblings.
        clockMs = LOST_CLAIM_THRESHOLD_MS + 2_000;
        const recovered = await recoverLostClaims({
          listOwnClaimed: async () => rows.map((row) => ({ id: row.id, claimed_at: new Date(0).toISOString() })),
          isHeld: held.isHeld,
          failRequest: async (id, error) => {
            failed.push({ id, error });
          },
          now: () => clockMs,
        });
        assert.equal(recovered, 0, 'held batch siblings are never lost claims');
        assert.ok(held.isHeld('req-2') && held.isHeld('req-3'), 'waiting siblings stay held');
      }
    },
  });

  assert.deepEqual(dispatchOrder, ['req-1', 'req-2', 'req-3'], 'all three rows dispatch normally');
  assert.equal(failed.length, 0);
  assert.ok(
    !held.isHeld('req-1') && !held.isHeld('req-2') && !held.isHeld('req-3'),
    'every row is released once its handling finishes',
  );
});

test('CT-REL-2.1 goal 1: a genuinely lost claim (never received, so never held) IS failed after 120s and poisoned', async () => {
  const held = createHeldRequestTracker();
  const failed: Array<{ id: string; error: string }> = [];
  const count = await recoverLostClaims({
    listOwnClaimed: async () => [{ id: 'lost-1', claimed_at: new Date(0).toISOString() }],
    isHeld: held.isHeld,
    failRequest: async (id, error) => {
      failed.push({ id, error });
    },
    now: () => LOST_CLAIM_THRESHOLD_MS + 1,
    onRecovered: (id) => held.markPoisoned(id), // mirrors the worker's wiring
  });
  assert.equal(count, 1);
  assert.deepEqual(failed, [{ id: 'lost-1', error: HOST_CLAIM_LOST_MESSAGE }]);
  assert.ok(held.isPoisoned('lost-1'), 'the recovered row is poisoned locally');
  assert.equal(held.isHeld('lost-1'), false, 'a lost claim was never held by this Host');
});

test('CT-REL-2.1 goal 1: a row failed by recovery is NEVER dispatched if it later appears in a batch', async () => {
  const held = createHeldRequestTracker();
  held.markPoisoned('lost-1');
  const dispatched: string[] = [];
  await dispatchClaimedBatch({
    requests: [requestWith('lost-1'), requestWith('req-9')],
    held,
    isRunning: () => true,
    dispatch: async (request) => {
      dispatched.push(request.id);
    },
  });
  assert.deepEqual(dispatched, ['req-9'], 'the recovered row is skipped without dispatching');
  assert.equal(held.isHeld('lost-1'), false, 'the skipped row is released, not stuck in the held set');
});

/* -------------------------------------------------------------------------- */
/* CT-REL-2.1 goal 3: insertScopePack 23505 fallback performs ONE lookup        */
/* -------------------------------------------------------------------------- */

function minimalScopePackContract(): ScopePackContract {
  return {
    packId: 'pack-new',
    orgId: 'org-1',
    repoKey: 'repo-key-1',
    title: 'Pack',
    sourceFilename: 'pack.json',
    sourceHash: 'hash-1',
    importedAt: NOW,
    updatedAt: NOW,
    historicalCheckpoint: null,
    intent: 'test',
    foundationClaims: [],
    lockedRules: [],
    doNotTouch: [],
    roadmapPhases: [],
    currentPhaseId: null,
    acceptanceCriteria: [],
    runtimeAcceptanceRequired: false,
    ownerDecisions: [],
    supersededDecisions: [],
    knownRisks: [],
    relatedAppAreas: [],
    reconciliationState: 'current',
    reconciliationSummary: null,
    lastReconciledAt: null,
    version: 1,
  };
}

function fakeScopePacksClient(options: {
  lookupRows?: Array<Record<string, unknown>>;
  lookupError?: { message: string } | null;
}): { client: unknown; counts: { inserts: number; lookups: number } } {
  const counts = { inserts: 0, lookups: 0 };
  const client = {
    from: (_table: string) => ({
      // .insert(...).select('*').single()
      insert: () => {
        counts.inserts += 1;
        return {
          select: () => ({
            single: async () => ({
              data: null,
              error: { code: '23505', message: 'duplicate key value violates unique constraint' },
            }),
          }),
        };
      },
      // .select('*').eq(...).eq(...).limit(1)
      select: () => {
        counts.lookups += 1;
        return {
          eq: () => ({
            eq: () => ({
              limit: async () => ({
                data: options.lookupRows ?? [],
                error: options.lookupError ?? null,
              }),
            }),
          }),
        };
      },
    }),
  };
  return { client, counts };
}

test('CT-REL-2.1 goal 3: the insertScopePack 23505 fallback performs exactly ONE lookup and returns the existing row', async () => {
  const { client, counts } = fakeScopePacksClient({
    lookupRows: [{
      id: 'pack-existing',
      organization_id: 'org-1',
      repo_key: 'repo-key-1',
      title: 'Pack',
      source_filename: 'pack.json',
      source_hash: 'hash-1',
      pack: { foundationClaims: [] },
      reconciliation_state: 'CURRENT',
      current_phase_id: null,
      version: 1,
      created_at: NOW,
      updated_at: NOW,
      last_reconciled_at: null,
    }],
  });
  const controlPlane = new ControlPlane(
    {
      supabaseUrl: 'http://localhost',
      serviceRoleKey: 'test-key',
      organizationId: 'org-1',
      repoKey: 'repo-key-1',
      hostInstanceId: 'host-1',
      hostVersion: 'test',
    },
    client as unknown as SupabaseClient,
  );
  const result = await controlPlane.insertScopePack(minimalScopePackContract(), 'source-req-1');
  assert.equal(result.packId, 'pack-existing', 'the existing row wins the unique-constraint race');
  assert.equal(counts.inserts, 1);
  assert.equal(counts.lookups, 1, 'exactly one fallback lookup — it opens no second, nested retry budget');
});

test('CT-REL-2.1 goal 3: a FAILING fallback lookup fails the insert operation itself (one lookup, one insert, no nested retries)', async () => {
  const { client, counts } = fakeScopePacksClient({ lookupError: { message: 'connection refused' } });
  const controlPlane = new ControlPlane(
    {
      supabaseUrl: 'http://localhost',
      serviceRoleKey: 'test-key',
      organizationId: 'org-1',
      repoKey: 'repo-key-1',
      hostInstanceId: 'host-1',
      hostVersion: 'test',
    },
    client as unknown as SupabaseClient,
  );
  // Abort the retry signal so the single attempt fails fast without sleeping.
  controlPlane.abort();
  await assert.rejects(
    controlPlane.insertScopePack(minimalScopePackContract(), 'source-req-1'),
    /Failed to look up Scope Pack by request/u,
  );
  assert.equal(counts.lookups, 1, 'the fallback lookup ran exactly once inside the outer operation');
  assert.equal(counts.inserts, 1);
});

/* -------------------------------------------------------------------------- */
/* CT-REL-2.1 goal 4: the fingerprint walk skips symlinks / junctions          */
/* -------------------------------------------------------------------------- */

test('CT-REL-2.1 goal 4: the fingerprint walk never follows symlinks or directory junctions', async () => {
  const root = await makeTempRoot();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'ct-rel-2-out-'));
  try {
    await writeFile(path.join(root, 'agent-host', 'real.ts'), 'export const real = 1;\n');
    await writeFile(path.join(outside, 'sneaky.ts'), 'export const sneaky = 1;\n');
    // A directory junction needs no symlink privilege on Windows and is the
    // realistic escape hatch (junctions report as symlinks to Dirent).
    await symlink(outside, path.join(root, 'agent-host', 'escape'), 'junction');
    const baseline = computeAgentHostSourceFingerprint(root);
    assert.ok(baseline.length > 0);
    // Content reachable ONLY through the junction is not Host source: changing
    // it must not flip restartRequired.
    await writeFile(path.join(outside, 'sneaky.ts'), 'export const sneaky = 2;\n');
    assert.equal(computeAgentHostSourceFingerprint(root), baseline, 'a junctioned tree is never fingerprinted');
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

/* -------------------------------------------------------------------------- */
/* Amendment 6: namespaced host-status presence marker                          */
/* -------------------------------------------------------------------------- */

test('the presence host-status marker is namespaced and can never render as a provider', () => {
  const marker = buildHostStatusMarker({
    sourceFingerprint: 'a'.repeat(64),
    restartRequired: true,
    restartDetectedAt: NOW,
    health: { state: 'degraded', consecutiveFailures: 4, lastFailureAt: NOW },
  });
  assert.equal(marker.kind, 'host-status');
  assert.equal(marker.restartRequired, true);
  assert.equal(marker.restartDetectedAt, NOW);
  assert.deepEqual(marker.health, { state: 'degraded', consecutiveFailures: 4, lastFailureAt: NOW });
  // The browser provider fleet mapper requires a providerId — the marker must not carry one.
  assert.equal('providerId' in marker, false, 'the marker is not a provider entry');
});
/* -------------------------------------------------------------------------- */
/* CT-REL-3 goal 1 + A3: responsive request scheduler                           */
/* -------------------------------------------------------------------------- */

function typedRequest(id: string, type: ClaimedControlRequest['request_type']): ClaimedControlRequest {
  return { ...controlRequest(type), id, client_request_id: id };
}

test('CT-REL-3 scheduler: cancel_run bypasses the FIFO and is handled while a non-cancel job still executes', async () => {
  const held = createHeldRequestTracker();
  const jobGate = deferred();
  const dispatched: string[] = [];
  const cancels: string[] = [];
  const scheduler = new ControlRequestScheduler({
    held,
    isRunning: () => true,
    log: { error: () => undefined },
    dispatchNonCancel: async (request) => {
      dispatched.push(request.id);
      await jobGate.promise;
    },
    handleCancel: async (request) => {
      cancels.push(request.id);
    },
    failRequest: async () => undefined,
  });

  await scheduler.offer([typedRequest('job-1', 'approve_plan')]);
  assert.ok(scheduler.isBusy(), 'the non-cancel job holds the single slot');

  // Cancel arrives WHILE the job is still blocked — it must not wait behind it.
  await scheduler.offer([typedRequest('cancel-1', 'cancel_run')]);
  assert.deepEqual(cancels, ['cancel-1'], 'the cancel is handled without waiting for the active job');
  assert.ok(scheduler.isBusy(), 'the active job is still running');

  jobGate.resolve();
  await sleep(10);
  assert.equal(scheduler.isBusy(), false);
  assert.deepEqual(dispatched, ['job-1']);
});

test('CT-REL-3 scheduler: non-cancel rows queue behind the active job, stay held (never lost), and dispatch in order', async () => {
  const held = createHeldRequestTracker();
  const gates = new Map<string, ReturnType<typeof deferred>>();
  for (const id of ['r1', 'r2', 'r3']) gates.set(id, deferred());
  const order: string[] = [];
  const scheduler = new ControlRequestScheduler({
    held,
    isRunning: () => true,
    log: { error: () => undefined },
    dispatchNonCancel: async (request) => {
      order.push(request.id);
      await gates.get(request.id)!.promise;
    },
    handleCancel: async () => undefined,
    failRequest: async () => undefined,
  });

  await scheduler.offer([typedRequest('r1', 'create_plan'), typedRequest('r2', 'create_plan'), typedRequest('r3', 'create_plan')]);
  assert.deepEqual(order, ['r1'], 'only the first job starts — Runs stay serial (no concurrency)');
  assert.equal(scheduler.queueDepth(), 2);
  assert.ok(held.isHeld('r2') && held.isHeld('r3'), 'queued siblings stay held');

  // A lost-claim sweep over old-claimed rows must NOT fail the held queued rows.
  const failed: string[] = [];
  await recoverLostClaims({
    listOwnClaimed: async () => [
      { id: 'r2', claimed_at: new Date(0).toISOString() },
      { id: 'r3', claimed_at: new Date(0).toISOString() },
    ],
    isHeld: held.isHeld,
    failRequest: async (id) => { failed.push(id); },
    now: () => LOST_CLAIM_THRESHOLD_MS + 1_000,
  });
  assert.deepEqual(failed, [], 'a queued-but-held row is never a lost claim');

  gates.get('r1')!.resolve();
  await sleep(5);
  gates.get('r2')!.resolve();
  await sleep(5);
  gates.get('r3')!.resolve();
  await sleep(5);
  assert.deepEqual(order, ['r1', 'r2', 'r3'], 'queued rows dispatch in FIFO order after the active job');
  assert.ok(!held.isHeld('r1') && !held.isHeld('r2') && !held.isHeld('r3'), 'every row is released once handled');
  assert.equal(scheduler.isBusy(), false);
});

test('CT-REL-3 scheduler: a queued create_plan is refused with HOST_RESTART_REQUIRED if the Host went stale while it waited', async () => {
  const held = createHeldRequestTracker();
  let restartRequired = false;
  const gate = deferred();
  const dispatched: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  const failRequest = async (id: string, error: string): Promise<void> => { failed.push({ id, error }); };
  const scheduler = new ControlRequestScheduler({
    held,
    isRunning: () => true,
    log: { error: () => undefined },
    dispatchNonCancel: async (request) => {
      if (request.request_type === 'approve_plan') {
        await gate.promise; // the blocking active job
        return;
      }
      // The restart gate is applied at DISPATCH time, not at claim time.
      if (await gateRestartRequiredRequest({ request, restartRequired, failRequest })) return;
      dispatched.push(request.id);
    },
    handleCancel: async () => undefined,
    failRequest,
  });

  await scheduler.offer([typedRequest('a1', 'approve_plan'), typedRequest('r1', 'create_plan')]);
  assert.equal(scheduler.queueDepth(), 1, 'create_plan waits behind the active approve');

  // The Host goes stale WHILE r1 waits its turn.
  restartRequired = true;
  gate.resolve();
  await sleep(10);

  assert.deepEqual(dispatched, [], 'the stale-gated create_plan never dispatched');
  assert.equal(failed.length, 1);
  assert.equal(failed[0]!.id, 'r1');
  assert.equal(failed[0]!.error, HOST_RESTART_REQUIRED_REQUEST_ERROR, 'refused at dispatch time with the exact message');
});

test('CT-REL-3 scheduler A3: a throwing background job is caught, logged, and the request is failed safely — no unhandled rejection', async () => {
  const held = createHeldRequestTracker();
  const logs: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  const scheduler = new ControlRequestScheduler({
    held,
    isRunning: () => true,
    log: { error: (message) => logs.push(message) },
    dispatchNonCancel: async () => { throw new Error('job blew up'); },
    handleCancel: async () => undefined,
    failRequest: async (id, error) => { failed.push({ id, error }); },
  });

  await scheduler.offer([typedRequest('r1', 'create_plan')]);
  await sleep(10);

  assert.equal(scheduler.isBusy(), false, 'the slot is freed after a throwing job');
  assert.equal(held.isHeld('r1'), false, 'the row is released');
  assert.equal(failed.length, 1);
  assert.match(failed[0]!.error, /REQUEST_HANDLER_FAILED/u);
  assert.ok(logs.some((line) => line.includes('job blew up')), 'the failure is logged safely');
});

test('CT-REL-3 scheduler A3: shutdown stops new jobs and drain is bounded (the loop never hangs)', async () => {
  const held = createHeldRequestTracker();
  const gate = deferred();
  let runningFlag = true;
  const dispatched: string[] = [];
  const scheduler = new ControlRequestScheduler({
    held,
    isRunning: () => runningFlag,
    log: { error: () => undefined },
    dispatchNonCancel: async (request) => {
      dispatched.push(request.id);
      await gate.promise;
    },
    handleCancel: async () => undefined,
    failRequest: async () => undefined,
  });

  await scheduler.offer([typedRequest('r1', 'approve_plan')]);
  assert.ok(scheduler.isBusy());

  // Shutdown: no NEW job starts even though one is offered.
  runningFlag = false;
  await scheduler.offer([typedRequest('r2', 'create_plan')]);
  assert.equal(scheduler.queueDepth(), 1, 'no new job starts during shutdown');
  assert.deepEqual(dispatched, ['r1']);

  // drain honors its bound while the active job is still blocked — never hangs.
  assert.equal(await scheduler.drain(30), false, 'drain returns within its bound instead of hanging');

  // Once the active job settles, drain resolves.
  gate.resolve();
  await sleep(10);
  assert.equal(await scheduler.drain(1_000), true);
});

/* -------------------------------------------------------------------------- */
/* CT-REL-3 goal 6: previous-Host orphan-claim sweep                            */
/* -------------------------------------------------------------------------- */

test('CT-REL-3 goal 6: findOrphanClaims fails a dead instance stale claim, and spares live instances + young claims', () => {
  const now = Date.parse(NOW);
  const rows = [
    { id: 'orphan', claimed_by_host: 'HOST-DEAD', claimed_at: new Date(now - (ORPHAN_CLAIM_THRESHOLD_MS + 5_000)).toISOString() },
    { id: 'live', claimed_by_host: 'HOST-LIVE', claimed_at: new Date(now - 300_000).toISOString() },
    { id: 'young', claimed_by_host: 'HOST-DEAD', claimed_at: new Date(now - 60_000).toISOString() },
    { id: 'no-claimer', claimed_by_host: null, claimed_at: new Date(0).toISOString() },
    { id: 'no-time', claimed_by_host: 'HOST-DEAD', claimed_at: null },
  ];
  const presence = [
    { host_instance_id: 'HOST-LIVE', last_seen_at: new Date(now - 5_000).toISOString() }, // fresh → alive
  ];
  assert.deepEqual(
    findOrphanClaims({ rows, presence, now }),
    ['orphan'],
    'only a stale claim by a gone instance is orphaned; live instance + young claim + unattributed rows are spared',
  );
});

test('CT-REL-3 goal 6: an instance with only a STALE presence row is treated as gone; a fresh row spares it', () => {
  const now = Date.parse(NOW);
  const rows = [{ id: 'orphan', claimed_by_host: 'HOST-X', claimed_at: new Date(now - 300_000).toISOString() }];
  const stale = [{ host_instance_id: 'HOST-X', last_seen_at: new Date(now - (HEARTBEAT_STALE_MS + 5_000)).toISOString() }];
  assert.deepEqual(findOrphanClaims({ rows, presence: stale, now }), ['orphan'], 'a stale presence row means gone');
  const fresh = [{ host_instance_id: 'HOST-X', last_seen_at: new Date(now - 1_000).toISOString() }];
  assert.deepEqual(findOrphanClaims({ rows, presence: fresh, now }), [], 'a fresh presence row spares the claim');
});

test('CT-REL-3 goal 6: sweepOrphanClaims fails orphaned rows with the exact message and never executes them', async () => {
  const now = Date.parse(NOW);
  const failed: Array<{ id: string; error: string }> = [];
  const recovered: string[] = [];
  const count = await sweepOrphanClaims({
    listForeignClaimed: async () => [
      { id: 'orphan', claimed_by_host: 'HOST-DEAD', claimed_at: new Date(now - 300_000).toISOString() },
      { id: 'live', claimed_by_host: 'HOST-LIVE', claimed_at: new Date(now - 300_000).toISOString() },
    ],
    listPresence: async () => [{ host_instance_id: 'HOST-LIVE', last_seen_at: new Date(now - 2_000).toISOString() }],
    failRequest: async (id, error) => { failed.push({ id, error }); },
    now: () => now,
    onRecovered: (id) => recovered.push(id),
  });
  assert.equal(count, 1);
  assert.deepEqual(failed, [{ id: 'orphan', error: HOST_CLAIM_ORPHAN_MESSAGE }]);
  assert.equal(
    HOST_CLAIM_ORPHAN_MESSAGE,
    'HOST_CLAIM_LOST: the previous Host stopped before finishing this request — submit it again.',
  );
  assert.deepEqual(recovered, ['orphan'], 'only the orphan is swept; a live instance claim is untouched');
});

test('CT-REL-3 goal 6: a control-plane fault during the sweep is reported and fails nothing', async () => {
  const errors: unknown[] = [];
  const count = await sweepOrphanClaims({
    listForeignClaimed: async () => { throw new Error('control plane down'); },
    listPresence: async () => [],
    failRequest: async () => { throw new Error('must never run'); },
    onError: (error) => errors.push(error),
  });
  assert.equal(count, 0);
  assert.equal(errors.length, 1);
});
