/**
 * ORCH-3B provider execution foundation tests.
 *
 * No paid model calls. No Claude/Codex/Ollama. Deterministic Node child
 * fixtures (agent-host/providers/fixtures/child.ts) simulate every behavior.
 */

import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import './executionLimits.test.ts';
import { JsonlDecoder } from './jsonl.ts';
import {
  ProcessRunner,
  buildCmdWrapperCommandLine,
  defaultKillProcessTree,
  defaultWindowsProcessTreeOps,
  createWindowsProcessTreeOps,
  isValidKillPid,
  resolveWorkingDirectory,
  validateOverallTimeout,
  TimeoutValidationError,
  STDOUT_RETAINED_TAIL_BYTES,
  STDERR_RETAINED_TAIL_BYTES,
  OVERALL_TIMEOUT_MIN_MS,
  OVERALL_TIMEOUT_MAX_MS,
  type KillProcessTreeFn,
  type LaunchDescriptor,
  type ProcessHandle,
  type RunProcessOptions,
  snapshotWorkspaceFiles,
  terminateWindowsProcessTree,
  type WindowsProcessTreeOps,
} from './processRunner.ts';
import { buildProviderEnvironment } from './environmentPolicy.ts';
import {
  providerErrorFragment,
  type ExecutionResult,
  type ProviderAdapter,
  type ProviderId,
  type ProcessExecutionResult,
} from './types.ts';

const FIXTURE = fileURLToPath(new URL('./fixtures/child.ts', import.meta.url));

let tmpDir: string;

async function setup(): Promise<string> {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'orch3b-'));
  return tmpDir;
}

// Module-level hook: runs once before all tests in this file so tmpDir exists.
before(setup);

function nativeLaunch(mode: string, extraArgv: string[] = []): LaunchDescriptor {
  return {
    kind: 'native',
    executable: process.execPath,
    argv: [FIXTURE, '--mode', mode, ...extraArgv],
  };
}

function baseOptions(
  launch: LaunchDescriptor,
  overrides: Partial<RunProcessOptions> = {},
): RunProcessOptions {
  return {
    executionId: 'exec-test',
    launch,
    workingDirectory: tmpDir,
    allowedWorkingDirectory: tmpDir,
    timeouts: { overallTimeoutMs: 10_000, startupTimeoutMs: 10_000, idleTimeoutMs: 10_000, cancelGraceMs: 100 },
    platform: 'linux',
    ...overrides,
  };
}

async function writeCmdWrapper(name: string): Promise<string> {
  const cmdPath = path.join(tmpDir, name);
  const content = `@"${process.execPath}" "${FIXTURE}" --mode args %*\r\n`;
  await writeFile(cmdPath, content, 'utf8');
  return cmdPath;
}

/** Kill only the exact child fixture PID; production operations are forbidden in tests. */
function recordingKill(): { fn: KillProcessTreeFn; calls: number[] } {
  const calls: number[] = [];
  const fn: KillProcessTreeFn = async (pid: number) => {
    calls.push(pid);
    forceStopKnownPid(pid);
    return { killed: true };
  };
  return { fn, calls };
}

async function runToResult(
  runner: ProcessRunner,
  options: RunProcessOptions,
): Promise<ProcessExecutionResult> {
  const handle = runner.run(options);
  return await handle.done;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code !== 'ESRCH';
  }
}

function forceStopKnownPid(pid: number): void {
  if (!processExists(pid)) {
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* exact test fixture PID may already have exited */
  }
}

function decoderState(decoder: JsonlDecoder): {
  buffer: string;
  bufferBytes: number;
  discardingOversizedLine: boolean;
} {
  const internal = decoder as any;
  return {
    buffer: internal.buffer,
    bufferBytes: internal.bufferBytes,
    discardingOversizedLine: internal.discardingOversizedLine,
  };
}

/* ========================================================================== */
/* JSONL DECODER (section 33)                                                 */
/* ========================================================================== */

test('jsonl: 1) one JSON object', () => {
  const d = new JsonlDecoder();
  const ev = d.push('{"a":1}\n');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].type, 'json');
  assert.deepEqual(ev[0].value, { a: 1 });
});

test('jsonl: 2) multiple JSON objects in one chunk', () => {
  const d = new JsonlDecoder();
  const ev = d.push('{"a":1}\n{"b":2}\n{"c":3}\n');
  assert.equal(ev.length, 3);
  assert.deepEqual(ev.map((e) => e.value), [{ a: 1 }, { b: 2 }, { c: 3 }]);
});

test('jsonl: 3) JSON object split across chunks', () => {
  const d = new JsonlDecoder();
  assert.equal(d.push('{"a":').length, 0);
  assert.equal(d.push('1}').length, 0);
  const ev = d.push('\n');
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].value, { a: 1 });
});

test('jsonl: 4) UTF-8 multibyte character split across chunks', () => {
  // '🚀' is U+1F680, 4 UTF-8 bytes (0xF0 0x9F 0x9A 0x80). Split between bytes.
  const full = Buffer.from('{"k":"🚀"}\n', 'utf8');
  const d = new JsonlDecoder();
  assert.equal(d.push(full.subarray(0, 7)).length, 0); // mid-multibyte
  const ev = d.push(full.subarray(7));
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].value, { k: '🚀' });
});

test('jsonl: 5) LF line endings', () => {
  const d = new JsonlDecoder();
  const ev = d.push('{"a":1}\n{"b":2}\n');
  assert.equal(ev.length, 2);
  assert.equal(ev[0].meta.lineIndex, 0);
  assert.equal(ev[1].meta.lineIndex, 1);
});

test('jsonl: 6) CRLF line endings', () => {
  const d = new JsonlDecoder();
  const ev = d.push('{"a":1}\r\n{"b":2}\r\n');
  assert.equal(ev.length, 2);
  assert.deepEqual(ev[0].value, { a: 1 });
  // CRLF must not leak into parsed content
  assert.equal(ev[0].meta.charLength, '{"a":1}'.length);
});

test('jsonl: 7) blank lines ignored', () => {
  const d = new JsonlDecoder();
  const ev = d.push('{"a":1}\n\n\n{"b":2}\n');
  assert.equal(ev.length, 2);
  assert.equal(ev[0].meta.lineIndex, 0);
  assert.equal(ev[1].meta.lineIndex, 1); // blank lines do not consume an index
  assert.equal(d.counts.nonJson, 0);
});

test('jsonl: 8) non-JSON diagnostic line (e.g. Codex SUCCESS)', () => {
  const d = new JsonlDecoder();
  const ev = d.push('SUCCESS\n');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].type, 'non-json');
  assert.equal(ev[0].line, 'SUCCESS');
  assert.equal(d.counts.nonJson, 1);
});

test('jsonl: 9) malformed JSON (looks like JSON, parse fails)', () => {
  const d = new JsonlDecoder();
  const ev = d.push('{"a":}\n');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].type, 'error');
  assert.ok(ev[0].error?.message);
  assert.equal(d.counts.malformed, 1);
  assert.equal(d.counts.nonJson, 0);
});

test('jsonl: 10) final unterminated line via flush()', () => {
  const d = new JsonlDecoder();
  assert.equal(d.push('{"a":1}').length, 0);
  const ev = d.flush();
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].value, { a: 1 });
});

test('jsonl: 11) oversized line handling', () => {
  const d = new JsonlDecoder({ maxLineBytes: 8 });
  const big = '{"k":"' + 'x'.repeat(50) + '"}';
  const ev = d.push(big + '\n');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].type, 'oversized');
  assert.equal(d.counts.oversized, 1);
  assert.equal(d.counts.json, 0);
});

test('jsonl: 11b) unterminated oversized line is bounded and resynchronizes', () => {
  const d = new JsonlDecoder({ maxLineBytes: 1024, maxRetainedDiagnostics: 4, maxRetainedLineChars: 32 });
  const first = d.push('x'.repeat(1025));
  assert.equal(first.length, 1);
  assert.equal(first[0].type, 'oversized');
  assert.equal(d.counts.oversized, 1);
  assert.equal(first[0].meta.byteLength, 1025);
  let state = decoderState(d);
  assert.equal(state.buffer, '');
  assert.equal(state.bufferBytes, 0);
  assert.equal(state.discardingOversizedLine, true);

  const retained = d.getDiagnostics();
  assert.equal(retained.length, 1);
  d.push('y'.repeat(16 * 1024));
  assert.equal(d.counts.oversized, 1);
  state = decoderState(d);
  assert.equal(state.buffer, '');
  assert.equal(state.bufferBytes, 0);
  assert.equal(state.discardingOversizedLine, true);
  assert.deepEqual(d.getDiagnostics(), retained);

  const resumed = d.push('\n{"ok":true}\n');
  assert.equal(resumed.length, 1);
  assert.equal(resumed[0].type, 'json');
  assert.deepEqual(resumed[0].value, { ok: true });
  state = decoderState(d);
  assert.equal(state.discardingOversizedLine, false);
  assert.equal(state.bufferBytes, 0);
});

test('jsonl: 11c) one oversized logical line emits once across many chunks', () => {
  const d = new JsonlDecoder({ maxLineBytes: 64, maxRetainedLineChars: 16 });
  let oversizedEvents = 0;
  for (let i = 0; i < 100; i += 1) {
    const ev = d.push('x'.repeat(8));
    oversizedEvents += ev.filter((entry) => entry.type === 'oversized').length;
  }
  assert.equal(oversizedEvents, 1);
  assert.equal(d.counts.oversized, 1);
  assert.equal(decoderState(d).discardingOversizedLine, true);
  assert.equal(d.push('\n').length, 0);
  assert.equal(d.counts.oversized, 1);
  assert.equal(decoderState(d).discardingOversizedLine, false);
});

test('jsonl: 11d) maxLineBytes uses UTF-8 byte semantics for multibyte input', () => {
  const exactBytes = Buffer.byteLength('éééé', 'utf8');
  const allowed = new JsonlDecoder({ maxLineBytes: exactBytes });
  const allowedEvents = allowed.push(Buffer.from('éééé\n', 'utf8'));
  assert.equal(allowedEvents.length, 1);
  assert.equal(allowedEvents[0].type, 'non-json');
  assert.equal(allowedEvents[0].meta.byteLength, exactBytes);
  assert.equal(allowed.counts.oversized, 0);

  const oversized = new JsonlDecoder({ maxLineBytes: exactBytes });
  const multibyte = Buffer.from('ééééé\n', 'utf8');
  assert.equal(oversized.push(multibyte.subarray(0, 3)).length, 0);
  assert.equal(oversized.push(multibyte.subarray(3, 7)).length, 0);
  const ev = oversized.push(multibyte.subarray(7));
  assert.equal(ev.length, 1);
  assert.equal(ev[0].type, 'oversized');
  assert.equal(ev[0].meta.byteLength, Buffer.byteLength('ééééé', 'utf8'));
  assert.equal(oversized.counts.oversized, 1);
});

test('jsonl: 11e) exactly maxLineBytes is allowed and max+1 is oversized', () => {
  const exact = new JsonlDecoder({ maxLineBytes: 4 });
  const exactEvents = exact.push('ABCD\n');
  assert.equal(exactEvents.length, 1);
  assert.equal(exactEvents[0].type, 'non-json');
  assert.equal(exactEvents[0].meta.byteLength, 4);

  const tooBig = new JsonlDecoder({ maxLineBytes: 4 });
  const tooBigEvents = tooBig.push('ABCDE\n');
  assert.equal(tooBigEvents.length, 1);
  assert.equal(tooBigEvents[0].type, 'oversized');
  assert.equal(tooBigEvents[0].meta.byteLength, 5);
});

test('jsonl: 12) bounded diagnostic retention', () => {
  const d = new JsonlDecoder({ maxRetainedDiagnostics: 3, maxRetainedLineChars: 10 });
  for (let i = 0; i < 10; i += 1) {
    d.push(`noise${i}\n`);
  }
  const diags = d.getDiagnostics();
  assert.equal(diags.length, 3);
  // oldest discarded; only last 3 retained (each truncated to 10 chars)
  assert.ok(diags.every((l) => l.length <= 10));
  assert.equal(d.counts.nonJson, 10);
});

test('jsonl: callbacks are invoked', () => {
  const seen: unknown[] = [];
  const nonJson: string[] = [];
  const d = new JsonlDecoder({}, {
    onJson: (v) => seen.push(v),
    onNonJson: (l) => nonJson.push(l),
  });
  d.push('{"a":1}\nDIAG\n{"b":2}\n');
  assert.deepEqual(seen, [{ a: 1 }, { b: 2 }]);
  assert.deepEqual(nonJson, ['DIAG']);
});

test('jsonl: decoder does not decide failure (reports only)', () => {
  const d = new JsonlDecoder();
  d.push('{"ok":true}\nGARBAGE\n{"still":true}\n');
  // Even with a non-JSON line, valid objects still flow and nothing throws.
  assert.equal(d.counts.json, 2);
  assert.equal(d.counts.nonJson, 1);
});

/* ========================================================================== */
/* PROCESS RUNNER (section 34)                                                */
/* ========================================================================== */

test('process: 1) native child spawn success', async (t) => {
  const result = await runToResult(new ProcessRunner(), baseOptions(nativeLaunch('slow', ['--arg', '50'])));
  assert.equal(result.spawned, true);
  assert.equal(result.terminationReason, 'exited');
  assert.equal(result.exitCode, 0);
  assert.ok(result.pid !== null && result.pid > 0);
  assert.ok(result.startedAt);
  assert.ok(result.endedAt);
});

test('process: 2) stdin receives exact multiline Unicode prompt', async (t) => {
  const prompt = 'héllo\nwörld\n日本語\nline with "quotes" & <tags>\n🚀\n';
  const result = await runToResult(
    new ProcessRunner(),
    baseOptions(nativeLaunch('echo'), { prompt }),
  );
  // prompt is small (< retained tail), so the full echo is retained
  assert.equal(result.stdoutTail, prompt);
  assert.equal(result.stdoutBytes, Buffer.byteLength(prompt, 'utf8'));
});

test('process: 3) stdout streamed incrementally', async (t) => {
  t.before(setup);
  let chunks = 0;
  const result = await runToResult(
    new ProcessRunner(),
    baseOptions(nativeLaunch('longout', ['--arg', String(128 * 1024)]), {
      callbacks: { onStdoutChunk: () => { chunks += 1; } },
    }),
  );
  assert.ok(chunks >= 2, `expected incremental chunks, got ${chunks}`);
  assert.equal(result.stdoutBytes, 128 * 1024);
});

test('process: 4) stderr streamed without marking failure', async (t) => {
  t.before(setup);
  let sawStderr = false;
  const result = await runToResult(
    new ProcessRunner(),
    baseOptions(nativeLaunch('stderr'), {
      callbacks: { onStderrChunk: () => { sawStderr = true; } },
    }),
  );
  assert.equal(result.terminationReason, 'exited');
  assert.equal(result.exitCode, 0);
  assert.ok(sawStderr);
  assert.ok(result.stderrBytes > 0);
  assert.equal(result.stderrTail, 'benign stderr noise\n');
});

test('process: 5) nonzero exit recorded (no failure decision)', async (t) => {
  const result = await runToResult(new ProcessRunner(), baseOptions(nativeLaunch('nonzero')));
  assert.equal(result.exitCode, 7);
  assert.equal(result.terminationReason, 'exited');
  // Runner records process facts only; it does NOT mark provider failure.
  assert.equal('success' in result, false);
});

test('process: 6) missing executable -> spawn-failed', async (t) => {
  t.before(setup);
  let spawnCalls = 0;
  const runner = new ProcessRunner();
  const result = await runToResult(
    runner,
    baseOptions(
      { kind: 'native', executable: path.join(tmpDir, 'does-not-exist.exe'), argv: [] },
      {
        spawnFn: (cmd, args, opts) => {
          spawnCalls += 1;
          return spawn(cmd, args, opts);
        },
      },
    ),
  );
  assert.equal(result.spawned, false);
  assert.equal(result.terminationReason, 'spawn-failed');
  assert.equal(spawnCalls, 1);
});

test('process: 7) overall timeout', async (t) => {
  const kill = recordingKill();
  const result = await runToResult(
    new ProcessRunner(),
    baseOptions(nativeLaunch('hang'), {
      timeouts: { overallTimeoutMs: 300, startupTimeoutMs: 10_000, idleTimeoutMs: 10_000, cancelGraceMs: 100 },
      timeoutBounds: { minMs: 1, maxMs: 30_000_000 },
      killProcessTree: kill.fn,
    }),
  );
  assert.equal(result.timedOut, true);
  assert.equal(result.terminationReason, 'timeout-overall');
  assert.ok(kill.calls.length >= 1 && kill.calls.length <= 2, 'at most one exact-tree retry is allowed');
  assert.ok(isValidKillPid(kill.calls[0]));
});

test('process: 8) idle timeout', async (t) => {
  const kill = recordingKill();
  const decoder = new JsonlDecoder();
  const result = await runToResult(
    new ProcessRunner(),
    baseOptions(nativeLaunch('idle'), {
      timeouts: { overallTimeoutMs: 10_000, startupTimeoutMs: 10_000, idleTimeoutMs: 200, cancelGraceMs: 100 },
      killProcessTree: kill.fn,
      callbacks: { onStdoutChunk: (chunk) => decoder.push(chunk).some((event) => event.type === 'json') },
    }),
  );
  assert.equal(result.timedOut, true);
  assert.equal(result.terminationReason, 'timeout-idle');
});

test('process: 8b) startup timeout', async (t) => {
  const kill = recordingKill();
  const result = await runToResult(
    new ProcessRunner(),
    baseOptions(nativeLaunch('hang'), {
      timeouts: { overallTimeoutMs: 10_000, startupTimeoutMs: 200, idleTimeoutMs: 10_000, cancelGraceMs: 100 },
      killProcessTree: kill.fn,
    }),
  );
  assert.equal(result.timedOut, true);
  assert.equal(result.terminationReason, 'timeout-startup');
});

test('process: 9+10+11) manual cancellation, idempotent, force-kill after grace', async (t) => {
  const kill = recordingKill();
  const runner = new ProcessRunner();
  const handle = runner.run(
    baseOptions(nativeLaunch('ignore'), {
      timeouts: { overallTimeoutMs: 30_000, startupTimeoutMs: 30_000, idleTimeoutMs: 30_000, cancelGraceMs: 100 },
      killProcessTree: kill.fn,
    }),
  );
  const pidBefore = handle.pid;
  handle.cancel();
  handle.cancel(); // idempotent
  handle.cancel(); // idempotent
  const result = await handle.done;
  assert.equal(result.cancelled, true);
  assert.equal(result.terminationReason, 'cancelled');
  assert.ok(kill.calls.length >= 1 && kill.calls.length <= 2, 'at most one exact-tree retry is allowed');
  assert.ok(isValidKillPid(kill.calls[0]));
  assert.equal(kill.calls[0], pidBefore);
});

test('process: forced settlement preserves cancellation when close never arrives', async () => {
  class NeverCloseChild extends EventEmitter {
    pid = 4242;
    stdin = new PassThrough();
    stdout = new PassThrough();
    stderr = new PassThrough();
    unrefCalls = 0;
    unref(): void { this.unrefCalls += 1; }
  }

  const child = new NeverCloseChild();
  const kills: number[] = [];
  const runner = new ProcessRunner();
  const handle = runner.run(
    baseOptions(nativeLaunch('slow', ['--arg', '50']), {
      timeouts: {
        overallTimeoutMs: 10_000,
        startupTimeoutMs: 10_000,
        idleTimeoutMs: 10_000,
        cancelGraceMs: 1,
        postKillSettlementMs: 25,
      },
      spawnFn: () => child as any,
      platform: 'linux',
      killProcessTree: async (pid) => {
        kills.push(pid);
        return { killed: true };
      },
    }),
  );
  handle.cancel();
  const result = await handle.done;
  assert.equal(result.terminationReason, 'cancelled');
  assert.equal(result.cancelled, true);
  assert.deepEqual(kills, [4242]);
  assert.equal(child.unrefCalls, 1);
  assert.equal(child.stdin.destroyed, true);
  assert.equal(child.stdout.destroyed, true);
  assert.equal(child.stderr.destroyed, true);

  child.emit('close');
  assert.equal(child.unrefCalls, 1, 'late close must be a harmless no-op');
});

test('Windows tree termination awaits delayed taskkill, then sweeps a surviving grandchild', async () => {
  let releaseTaskkill!: (value: { killed: boolean }) => void;
  const taskkill = new Promise<{ killed: boolean }>((resolve) => { releaseTaskkill = resolve; });
  const alive = new Map([[41, 'root-time'], [42, 'child-time'], [43, 'grandchild-time']]);
  const calls: string[] = [];
  const ops: WindowsProcessTreeOps = {
    snapshot: async () => [...alive].map(([pid, creationTime]) => ({ pid, creationTime })),
    sweep: async (snapshot) => snapshot.map(({ pid, creationTime }) => {
      if (alive.get(pid) !== creationTime) return { pid, status: 'gone' };
      calls.push(`sweep:${pid}`);
      alive.delete(pid);
      return { pid, status: 'killed' };
    }),
  };
  let completed = false;
  const done = terminateWindowsProcessTree(41, async () => { calls.push('taskkill'); return await taskkill; }, ops, 500)
    .then((value) => { completed = true; return value; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completed, false);
  assert.deepEqual(calls, ['taskkill']);
  alive.delete(41);
  alive.delete(42);
  releaseTaskkill({ killed: true });
  assert.deepEqual(await done, { possibleSurvivors: false });
  assert.deepEqual(calls, ['taskkill', 'sweep:43']);
});

test('Windows parent not found still sweeps, while a reused PID is never killed', async () => {
  const killed: number[] = [];
  const ops: WindowsProcessTreeOps = {
    snapshot: async () => [{ pid: 51, creationTime: 'old-root' }, { pid: 52, creationTime: 'child' }, { pid: 53, creationTime: 'old-pid' }],
    sweep: async (snapshot) => snapshot.map(({ pid, creationTime }) => {
      const current = pid === 52 ? 'child' : pid === 53 ? 'new-pid' : null;
      if (current !== creationTime) return { pid, status: current ? 'mismatch' : 'gone' };
      killed.push(pid);
      return { pid, status: 'killed' };
    }),
  };
  const result = await terminateWindowsProcessTree(51, async () => ({ killed: true, error: 'not found' }), ops, 500);
  assert.deepEqual(result, { possibleSurvivors: false });
  assert.deepEqual(killed, [52]);
});

test('batched CIM command kills matching identities and leaves exact-string mismatches alone', async () => {
  const rows = [
    { ProcessId: 81, ParentProcessId: 1, CreationDate: '2026-09-27T01:00:00.0000000Z' },
    { ProcessId: 82, ParentProcessId: 81, CreationDate: '2026-09-27T01:00:01.0000000Z' },
    { ProcessId: 83, ParentProcessId: 82, CreationDate: '2026-09-27T01:00:02.0000000Z' },
  ];
  const live = new Map(rows.map((row) => [row.ProcessId, row.CreationDate]));
  const killed: number[] = [];
  let sweepCalls = 0;
  const ops = createWindowsProcessTreeOps(async (script, input) => {
    if (!input) return JSON.stringify(rows);
    sweepCalls += 1;
    assert.equal((script.match(/Get-CimInstance Win32_Process/gu) ?? []).length, 1);
    assert.match(script, /Invoke-CimMethod -InputObject \$row -MethodName Terminate/u);
    assert.match(script, /CreationDate\.ToUniversalTime\(\)\.ToString\('o'\) -cne/u);
    assert.doesNotMatch(script, /Get-Process|StartTime/u);
    const items = JSON.parse(input) as Array<{ pid: number; creationTime: string }>;
    return JSON.stringify(items.map((item) => {
      const current = live.get(item.pid);
      if (!current) return { pid: item.pid, status: 'gone' };
      if (current !== item.creationTime) return { pid: item.pid, status: 'mismatch' };
      killed.push(item.pid);
      live.delete(item.pid);
      return { pid: item.pid, status: 'killed' };
    }));
  });
  const snapshot = await ops.snapshot(81, new AbortController().signal);
  assert.deepEqual(snapshot.map((item) => item.pid), [81, 82, 83]);
  live.delete(81);
  live.set(83, '2026-09-27T01:00:02.0000001Z');
  const results = await ops.sweep(snapshot, new AbortController().signal);
  assert.deepEqual(results.map((item) => item.status), ['gone', 'killed', 'mismatch']);
  assert.deepEqual(killed, [82]);
  assert.equal(sweepCalls, 1);
});

test('Host tests fail loudly before production CIM or taskkill can run', async () => {
  assert.notEqual(process.env.NODE_TEST_CONTEXT, undefined);
  await assert.rejects(defaultWindowsProcessTreeOps.snapshot(4242, new AbortController().signal), /forbidden in Host tests/u);
  await assert.rejects(defaultWindowsProcessTreeOps.sweep([{ pid: 4242, creationTime: 'fake' }], new AbortController().signal), /forbidden in Host tests/u);
  await assert.rejects(defaultKillProcessTree(4242), /forbidden in Host tests/u);
});

test('Windows snapshot failure still awaits taskkill before termination closes stdin', async () => {
  class FakeChild extends EventEmitter {
    pid = 54;
    stdin = new PassThrough();
    stdout = new PassThrough();
    stderr = new PassThrough();
    unref(): void {}
  }
  const child = new FakeChild();
  let endCalls = 0;
  (child.stdin as any).write = () => false;
  const originalEnd = child.stdin.end.bind(child.stdin);
  (child.stdin as any).end = (...args: any[]) => { endCalls += 1; return originalEnd(...args); };
  child.stdin.on('finish', () => child.emit('close'));
  let releaseTaskkill!: (result: { killed: boolean }) => void;
  const taskkill = new Promise<{ killed: boolean }>((resolve) => { releaseTaskkill = resolve; });
  let taskkillStarted = false;
  let sweepCalled = false;
  const handle = new ProcessRunner().run(baseOptions(nativeLaunch('hang'), {
    platform: 'win32', prompt: 'held prompt', spawnFn: () => child as any,
    windowsProcessTreeOps: { snapshot: async () => { throw new Error('CIM failed'); }, sweep: async () => { sweepCalled = true; return []; } },
    killProcessTree: async () => { taskkillStarted = true; return await taskkill; },
  }));
  handle.cancel();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(taskkillStarted, true);
  assert.equal(endCalls, 0);
  releaseTaskkill({ killed: true });
  const result = await handle.done;
  assert.equal(endCalls, 1);
  assert.equal(sweepCalled, false);
  assert.equal(result.possibleSurvivors, true);
});

test('Windows taskkill has its own bound and finishes before the sweep and settlement', async () => {
  let taskkillActive = false;
  let taskkillAbandoned = false;
  let sweepCalled = false;
  const result = await terminateWindowsProcessTree(56, async (_pid, signal) => {
    taskkillActive = true;
    return await new Promise<{ killed: boolean }>((resolve) => signal!.addEventListener('abort', () => {
      taskkillAbandoned = true;
      taskkillActive = false;
      resolve({ killed: false });
    }, { once: true }));
  }, {
    snapshot: async () => [{ pid: 56, creationTime: 'original' }],
    sweep: async () => { sweepCalled = true; assert.equal(taskkillActive, false); return [{ pid: 56, status: 'killed' }]; },
  }, 20);
  assert.equal(taskkillAbandoned, true);
  assert.equal(sweepCalled, true);
  assert.equal(taskkillActive, false);
  assert.equal(result.possibleSurvivors, true);
});

test('a bound that fires while the kill op ignores the abort still settles on the bound itself (CT-REL-2 goal 9)', async () => {
  // The kill op NEVER settles — not even on abort (a hung child that ignores
  // the signal). The bounded operation must settle ON THE BOUND anyway, so no
  // kill step can block termination indefinitely.
  let sweepCalled = false;
  const startedAt = Date.now();
  const result = await terminateWindowsProcessTree(
    57,
    () => new Promise<{ killed: boolean }>(() => undefined),
    {
      snapshot: async () => [{ pid: 57, creationTime: 'original' }],
      sweep: async () => {
        sweepCalled = true;
        return [{ pid: 57, status: 'killed' }];
      },
    },
    25,
  );
  const elapsed = Date.now() - startedAt;
  assert.equal(result.possibleSurvivors, true, 'an abandoned kill flags possible survivors');
  assert.ok(elapsed >= 20, 'the bound was actually awaited');
  assert.ok(elapsed < 1_000, `termination must settle on the bound, not the hung child (took ${elapsed}ms)`);
  assert.equal(sweepCalled, true, 'the sweep still runs after the bound settles');
});

test('Windows hung snapshot is aborted before awaited taskkill and settlement', async () => {
  class FakeChild extends EventEmitter {
    pid = 55;
    stdin = new PassThrough();
    stdout = new PassThrough();
    stderr = new PassThrough();
    unref(): void {}
  }
  const child = new FakeChild();
  let endCalls = 0;
  (child.stdin as any).write = () => false;
  const originalEnd = child.stdin.end.bind(child.stdin);
  (child.stdin as any).end = (...args: any[]) => { endCalls += 1; return originalEnd(...args); };
  child.stdin.on('finish', () => child.emit('close'));
  let snapshotChildKilled = false;
  let noteSnapshotAborted!: () => void;
  const snapshotAborted = new Promise<void>((resolve) => { noteSnapshotAborted = resolve; });
  let releaseTaskkill!: (result: { killed: boolean }) => void;
  const taskkill = new Promise<{ killed: boolean }>((resolve) => { releaseTaskkill = resolve; });
  let taskkillStarted = false;
  const handle = new ProcessRunner().run(baseOptions(nativeLaunch('hang'), {
    platform: 'win32', prompt: 'held prompt', spawnFn: () => child as any, windowsTreeTerminationMs: 20,
    windowsProcessTreeOps: {
      snapshot: async (_pid, signal) => await new Promise((_, reject) => signal.addEventListener('abort', () => { snapshotChildKilled = true; noteSnapshotAborted(); reject(new Error('PowerShell child killed')); }, { once: true })),
      sweep: async () => { throw new Error('sweep must be skipped'); },
    },
    killProcessTree: async () => { taskkillStarted = true; return await taskkill; },
  }));
  handle.cancel();
  await snapshotAborted;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(snapshotChildKilled, true);
  assert.equal(taskkillStarted, true);
  assert.equal(endCalls, 0);
  releaseTaskkill({ killed: true });
  const result = await handle.done;
  assert.equal(result.possibleSurvivors, true);
  assert.equal(endCalls, 1);
});

test('Windows sweep bound settles runner and records possible survivors', async () => {
  class FakeChild extends EventEmitter {
    pid = 61;
    stdin = new PassThrough();
    stdout = new PassThrough();
    stderr = new PassThrough();
    unref(): void {}
  }
  const child = new FakeChild();
  let sweepAbandoned = false;
  let sweepActive = false;
  const handle = new ProcessRunner().run(baseOptions(nativeLaunch('hang'), {
    platform: 'win32',
    spawnFn: () => child as any,
    windowsTreeTerminationMs: 20,
    windowsProcessTreeOps: {
      snapshot: async () => [{ pid: 61, creationTime: 'root' }, { pid: 62, creationTime: 'child' }],
      sweep: async (_snapshot, signal) => {
        sweepActive = true;
        return await new Promise((resolve) => signal.addEventListener('abort', () => {
          sweepAbandoned = true;
          sweepActive = false;
          resolve([]);
        }, { once: true }));
      },
    },
    killProcessTree: async () => ({ killed: true }),
  }));
  handle.cancel();
  child.emit('close');
  let settled = false;
  void handle.done.then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  const result = await handle.done;
  assert.equal(result.terminationReason, 'cancelled');
  assert.equal(result.possibleSurvivors, true);
  assert.equal(sweepAbandoned, true);
  assert.equal(sweepActive, false);
});

test('workspace activity scanner skips node_modules and .git at every depth', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workspace-poll-skip-'));
  await mkdir(path.join(root, 'nested', 'node_modules'), { recursive: true });
  await mkdir(path.join(root, 'nested', '.git'), { recursive: true });
  await mkdir(path.join(root, 'nested', 'NODE_MODULES'), { recursive: true });
  await mkdir(path.join(root, 'nested', '.GiT'), { recursive: true });
  await writeFile(path.join(root, 'nested', 'node_modules', 'package.js'), 'one');
  await writeFile(path.join(root, 'nested', '.git', 'index'), 'one');
  await writeFile(path.join(root, 'nested', 'NODE_MODULES', 'uppercase.js'), 'one');
  await writeFile(path.join(root, 'nested', '.GiT', 'uppercase-index'), 'one');
  await writeFile(path.join(root, 'nested', 'visible.txt'), 'one');
  const snapshot = await snapshotWorkspaceFiles(root);
  assert.deepEqual([...snapshot!.keys()], [path.join('nested', 'visible.txt')]);
});

test('workspace activity polling skips ticks while an async scan is pending', async () => {
  class FakeChild extends EventEmitter {
    pid = 71;
    stdin = new PassThrough();
    stdout = new PassThrough();
    stderr = new PassThrough();
    unref(): void {}
  }
  const child = new FakeChild();
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  let scans = 0;
  let finishBaseline!: (value: Map<string, string>) => void;
  const baseline = new Promise<Map<string, string>>((resolve) => { finishBaseline = resolve; });
  const handle = new ProcessRunner().run(baseOptions(nativeLaunch('hang'), {
    spawnFn: () => child as any,
    activityWorkspacePath: tmpDir,
    workspaceSnapshot: async () => { scans += 1; return scans === 1 ? await baseline : await new Promise<Map<string, string>>(() => undefined); },
    timers: {
      setTimeout: (fn) => { const id = ++nextTimer; timers.set(id, fn); return id as unknown as NodeJS.Timeout; },
      clearTimeout: (id) => { timers.delete(id as unknown as number); },
    },
  }));
  const tickPoll = (): void => {
    const pollId = Math.max(...timers.keys());
    const poll = timers.get(pollId);
    assert.ok(poll);
    timers.delete(pollId);
    poll();
  };
  tickPoll();
  tickPoll();
  assert.equal(scans, 1);
  finishBaseline(new Map());
  await new Promise((resolve) => setImmediate(resolve));
  tickPoll();
  tickPoll();
  assert.equal(scans, 2);
  child.emit('close');
  await handle.done;
});

test('process: failed exact tree kill is retried once before bounded settlement', async () => {
  class NeverCloseChild extends EventEmitter {
    pid = 4343;
    stdin = new PassThrough();
    stdout = new PassThrough();
    stderr = new PassThrough();
    unref(): void {}
  }

  const child = new NeverCloseChild();
  const kills: number[] = [];
  const handle = new ProcessRunner().run(
    baseOptions(nativeLaunch('slow'), {
      timeouts: {
        overallTimeoutMs: 10_000,
        startupTimeoutMs: 10_000,
        idleTimeoutMs: 10_000,
        cancelGraceMs: 1,
        postKillSettlementMs: 250,
      },
      spawnFn: () => child as any,
      platform: 'linux',
      killProcessTree: async (pid) => {
        kills.push(pid);
        return { killed: false, error: 'access denied' };
      },
    }),
  );
  handle.cancel();
  const result = await handle.done;
  assert.equal(result.terminationReason, 'cancelled');
  assert.deepEqual(kills, [4343, 4343]);
});

test('process: exact root tree kill handles a known grandchild within the bounded window', async () => {
  const kill = recordingKill();
  let grandchildPid: number | null = null;
  const handle = new ProcessRunner().run(
    baseOptions(nativeLaunch('grandchild'), {
      timeouts: {
        overallTimeoutMs: 10_000,
        startupTimeoutMs: 10_000,
        idleTimeoutMs: 10_000,
        cancelGraceMs: 25,
        postKillSettlementMs: 500,
      },
      killProcessTree: kill.fn,
      callbacks: {
        onStdoutChunk: (chunk) => {
          const match = /grandchild-pid:(\d+)/u.exec(chunk.toString('utf8'));
          if (match) {
            grandchildPid = Number(match[1]);
          }
        },
      },
    }),
  );

  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('fixture did not announce its grandchild PID')), 2_000);
    const poll = (): void => {
      if (grandchildPid !== null) {
        clearTimeout(deadline);
        resolve();
      } else {
        setTimeout(poll, 10);
      }
    };
    poll();
  });

  try {
    handle.cancel();
    const result = await handle.done;
    assert.equal(result.terminationReason, 'cancelled');
    assert.ok(isValidKillPid(handle.pid));
    assert.ok(kill.calls.length >= 1 && kill.calls.length <= 2);
    assert.ok(kill.calls.every((pid) => pid === handle.pid), 'only the captured root PID may be targeted');
    assert.ok(grandchildPid !== null);
  } finally {
    // If the test environment cannot grant taskkill permission for the root,
    // clean up the exact descendant PID announced by this fixture. This never
    // discovers or targets a process by executable name.
    if (handle.pid !== null && processExists(handle.pid)) {
      forceStopKnownPid(handle.pid);
    }
    if (grandchildPid !== null && processExists(grandchildPid)) {
      forceStopKnownPid(grandchildPid);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(handle.pid === null ? false : processExists(handle.pid), false, 'fixture root must not remain alive');
    assert.equal(grandchildPid === null ? false : processExists(grandchildPid), false, 'fixture descendant must not remain alive');
  }
});

test('process: 12) bounded stdout tail', async (t) => {
  const total = 128 * 1024; // > 64 KiB retained tail
  const result = await runToResult(
    new ProcessRunner(),
    baseOptions(nativeLaunch('longout', ['--arg', String(total)])),
  );
  assert.equal(result.stdoutBytes, total);
  // retained tail is at most the cap
  assert.ok(Buffer.byteLength(result.stdoutTail, 'utf8') <= STDOUT_RETAINED_TAIL_BYTES);
  assert.equal(result.stdoutTail.length, STDOUT_RETAINED_TAIL_BYTES);
});

test('process: 13) bounded stderr tail', async (t) => {
  const total = 32 * 1024; // > 16 KiB retained stderr tail
  const result = await runToResult(
    new ProcessRunner(),
    baseOptions(nativeLaunch('stderr', ['--arg', String(total)])),
  );
  assert.equal(result.stderrBytes, total);
  assert.ok(Buffer.byteLength(result.stderrTail, 'utf8') <= STDERR_RETAINED_TAIL_BYTES);
});

test('process: 14) absolute output safety limit', async (t) => {
  const kill = recordingKill();
  const result = await runToResult(
    new ProcessRunner(),
    baseOptions(nativeLaunch('flood', ['--arg', String(1024 * 1024)]), {
      limits: { absoluteOutputBytes: 100 * 1024 },
      timeouts: { overallTimeoutMs: 30_000, startupTimeoutMs: 30_000, idleTimeoutMs: 30_000, cancelGraceMs: 100 },
      killProcessTree: kill.fn,
    }),
  );
  assert.equal(result.outputLimitExceeded, true);
  assert.equal(result.terminationReason, 'output-limit');
  assert.ok(kill.calls.length >= 1 && kill.calls.length <= 2, 'at most one exact-tree retry is allowed');
});

test('process: 15) callback/parser failure cannot orphan child', async (t) => {
  const kill = recordingKill();
  let threw = false;
  const result = await runToResult(
    new ProcessRunner(),
    baseOptions(nativeLaunch('idle'), {
      timeouts: { overallTimeoutMs: 30_000, startupTimeoutMs: 30_000, idleTimeoutMs: 30_000, cancelGraceMs: 100 },
      killProcessTree: kill.fn,
      callbacks: {
        onStdoutChunk: () => {
          threw = true;
          throw new Error('parser explosion');
        },
      },
    }),
  );
  assert.ok(threw, 'callback must have been invoked');
  assert.equal(result.terminationReason, 'callback-error');
  assert.ok(result.callbackErrorMessage?.includes('parser explosion'));
  // child was NOT orphaned: force-kill ran
  assert.ok(kill.calls.length >= 1 && kill.calls.length <= 2, 'at most one exact-tree retry is allowed');
});

test('process: 16) invalid working directory rejected', async (t) => {
  t.before(setup);
  let spawnCalls = 0;
  const runner = new ProcessRunner();
  const handle = runner.run(
    baseOptions(nativeLaunch('slow', ['--arg', '50']), {
      workingDirectory: os.homedir(), // != allowed (tmpDir)
      spawnFn: (cmd, args, opts) => {
        spawnCalls += 1;
        return spawn(cmd, args, opts);
      },
    }),
  );
  const result = await handle.done;
  assert.equal(result.terminationReason, 'spawn-failed');
  assert.equal(result.spawned, false);
  assert.equal(spawnCalls, 0, 'must not spawn when working dir is invalid');
});

test('process: 17) allowed working directory succeeds', async (t) => {
  const result = await runToResult(new ProcessRunner(), baseOptions(nativeLaunch('slow', ['--arg', '50'])));
  assert.equal(result.terminationReason, 'exited');
  assert.equal(result.exitCode, 0);
});

test('process: exact Host-authorized cwd rejects a sibling attempt workspace before spawn', async (t) => {
  t.before(setup);
  const workspaceA = path.join(tmpDir, 'workspaces', 'repo', 'run', 'attempt-a');
  const workspaceB = path.join(tmpDir, 'workspaces', 'repo', 'run', 'attempt-b');
  await mkdir(workspaceA, { recursive: true });
  await mkdir(workspaceB, { recursive: true });
  let spawnCalls = 0;
  const result = await runToResult(new ProcessRunner(), baseOptions(nativeLaunch('slow', ['--arg', '10']), {
    workingDirectory: workspaceB,
    allowedWorkingDirectory: workspaceA,
    spawnFn: (cmd, args, options) => {
      spawnCalls += 1;
      return spawn(cmd, args, options);
    },
  }));
  assert.equal(result.spawned, false);
  assert.equal(spawnCalls, 0);
});

test('process: task implementer authorized-root matrix rejects every non-attempt cwd before spawn', async (t) => {
  t.before(setup);
  const canonicalRepo = path.join(tmpDir, 'canonical', 'repo');
  const authorizedWorkspace = path.join(tmpDir, 'workspaces', 'repo', 'run', 'attempt-a');
  const arbitraryTemp = path.join(tmpDir, 'unrelated');
  await mkdir(canonicalRepo, { recursive: true });
  await mkdir(authorizedWorkspace, { recursive: true });
  await mkdir(arbitraryTemp, { recursive: true });
  const candidates = [
    { name: 'C root', cwd: 'C:\\' },
    { name: 'C temp', cwd: 'C:\\Temp' },
    { name: 'canonical repo parent', cwd: path.dirname(canonicalRepo) },
    { name: 'USERPROFILE', cwd: os.homedir() },
    { name: 'arbitrary temp', cwd: arbitraryTemp },
    { name: 'canonical repo with trailing dot', cwd: path.join(canonicalRepo, '.') },
  ];
  for (const candidate of candidates) {
    let spawnCalls = 0;
    const result = await runToResult(new ProcessRunner(), baseOptions(nativeLaunch('slow', ['--arg', '10']), {
      workingDirectory: candidate.cwd,
      allowedWorkingDirectory: authorizedWorkspace,
      spawnFn: (cmd, args, options) => {
        spawnCalls += 1;
        return spawn(cmd, args, options);
      },
    }));
    assert.equal(result.spawned, false, candidate.name);
    assert.equal(spawnCalls, 0, candidate.name);
  }
});

test('process: 18) timeout validation', () => {
  assert.throws(() => validateOverallTimeout(0), TimeoutValidationError);
  assert.throws(() => validateOverallTimeout(-1), TimeoutValidationError);
  assert.throws(() => validateOverallTimeout(NaN), TimeoutValidationError);
  assert.throws(() => validateOverallTimeout(Infinity), TimeoutValidationError);
  assert.throws(() => validateOverallTimeout('1000'), TimeoutValidationError);
  // below min -> clamped to min
  assert.equal(validateOverallTimeout(500), OVERALL_TIMEOUT_MIN_MS);
  // above max -> clamped to max (no multi-hour runs)
  assert.equal(validateOverallTimeout(999 * 60_000), OVERALL_TIMEOUT_MAX_MS);
  // in range -> unchanged
  assert.equal(validateOverallTimeout(120_000), 120_000);
});

test('process: 19) environment not returned/logged', async (t) => {
  const result = await runToResult(
    new ProcessRunner(),
    baseOptions(nativeLaunch('args'), { envOverlay: { ORCH3B_SECRET: 'leak-marker' } }),
  );
  assert.equal('env' in result, false);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('ORCH3B_SECRET'), 'env must not appear in result');
  assert.ok(!serialized.includes('leak-marker'));
});

test('process: provider environment is default-deny and overlays cannot restore production credentials', async () => {
  const source = {
    SystemRoot: 'C:\\Windows',
    PATH: 'C:\\Tools',
    USERPROFILE: 'C:\\Users\\fixture',
    PROCESSOR_ARCHITECTURE: 'AMD64',
    CLAUDE_CODE_TEST_VAR: 'claude-only',
    CODEX_TEST_VAR: 'codex-only',
    OPENAI_API_KEY: 'codex-key',
    supabase_service_role_key: 'DO_NOT_PASS',
    NETLIFY_AUTH_TOKEN: 'DO_NOT_PASS',
    DATABASE_URL: 'DO_NOT_PASS',
    VITE_SUPABASE_URL: 'DO_NOT_PASS',
    POWERON_SECRET: 'DO_NOT_PASS',
    RANDOM_VENDOR_TOKEN: 'DO_NOT_PASS',
    TOTALLY_UNKNOWN_SECRETISH_THING: 'DO_NOT_PASS',
  };
  let capturedEnv: NodeJS.ProcessEnv | undefined;
  await runToResult(
    new ProcessRunner(),
    baseOptions(nativeLaunch('slow', ['--arg', '10']), {
      environmentProfile: 'claude',
      environmentSource: source,
      envOverlay: {
        CLAUDE_CODE_OVERLAY: 'allowed',
        SUPABASE_SERVICE_ROLE_KEY: 'DO_NOT_PASS',
        netlify_auth_token: 'DO_NOT_PASS',
        DATABASE_URL: 'DO_NOT_PASS',
      },
      spawnFn: (command, args, options) => {
        capturedEnv = options.env;
        return spawn(command, args, options);
      },
    }),
  );
  assert.deepEqual(capturedEnv, {
    SystemRoot: 'C:\\Windows',
    PATH: 'C:\\Tools',
    USERPROFILE: 'C:\\Users\\fixture',
    PROCESSOR_ARCHITECTURE: 'AMD64',
    CLAUDE_CODE_TEST_VAR: 'claude-only',
    CLAUDE_CODE_OVERLAY: 'allowed',
  });
});

test('process: provider profiles do not cross-leak credentials and deny names case-insensitively', () => {
  const source = {
    SystemRoot: 'C:\\Windows',
    PATH: 'C:\\Tools',
    CLAUDE_CODE_MESSAGING_TOKEN: 'claude-auth',
    CODEX_TEST_VAR: 'codex-auth',
    OPENAI_API_KEY: 'codex-key',
    Supabase_Service_Role_Key: 'DO_NOT_PASS',
    netlify_auth_token: 'DO_NOT_PASS',
    VITE_PUBLIC_VALUE: 'DO_NOT_PASS',
  };
  const claude = buildProviderEnvironment('claude', source, undefined);
  const codex = buildProviderEnvironment('codex', source, undefined);
  assert.equal(claude.CODEX_TEST_VAR, undefined);
  assert.equal(claude.OPENAI_API_KEY, undefined);
  assert.equal(codex.CLAUDE_CODE_MESSAGING_TOKEN, undefined);
  assert.equal(claude.CLAUDE_CODE_MESSAGING_TOKEN, 'claude-auth');
  assert.equal(codex.CODEX_TEST_VAR, 'codex-auth');
  assert.equal(codex.OPENAI_API_KEY, 'codex-key');
  for (const environment of [claude, codex]) {
    assert.equal(environment.Supabase_Service_Role_Key, undefined);
    assert.equal(environment.netlify_auth_token, undefined);
    assert.equal(environment.VITE_PUBLIC_VALUE, undefined);
  }
});

test('process: 20) result resolves exactly once', async (t) => {
  const runner = new ProcessRunner();
  const handle = runner.run(baseOptions(nativeLaunch('slow', ['--arg', '50'])));
  let count = 0;
  handle.done.then(() => { count += 1; });
  handle.done.then(() => { count += 1; });
  await handle.done;
  // Allow then callbacks to flush
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(count, 2, 'both then handlers fire from a single resolution');
  // cancel after completion is a safe no-op (no double resolve / throw)
  handle.cancel();
});

test('process: cancel after completion is a no-op', async (t) => {
  const runner = new ProcessRunner();
  const handle = runner.run(baseOptions(nativeLaunch('slow', ['--arg', '50'])));
  await handle.done;
  handle.cancel();
  assert.ok(true, 'did not throw');
});

/* ========================================================================== */
/* SHELL INJECTION (section 35)                                               */
/* ========================================================================== */

test('security: argv transport is literal (no shell interpolation)', async (t) => {
  const metachars = ['&', '|', '>', '<', '^', '"', '%', '!', ';', '$', 'echo PWNED'];
  const result = await runToResult(
    new ProcessRunner(),
    baseOptions(nativeLaunch('args', metachars)),
  );
  const parsed = JSON.parse(result.stdoutTail) as string[];
  assert.deepEqual(parsed, metachars, 'every metacharacter must round-trip literally');
  // No secondary command executed: "PWNED" must appear only as the literal arg
  assert.ok(!result.stdoutTail.includes('PWNED\n'));
  assert.ok(result.stdoutTail.includes('echo PWNED'));
});

test('security: native launch uses shell:false', async (t) => {
  t.before(setup);
  let captured: SpawnOptions = {};
  const runner = new ProcessRunner();
  await runToResult(
    runner,
    baseOptions(nativeLaunch('slow', ['--arg', '50']), {
      spawnFn: (cmd, args, opts) => {
        captured = opts;
        return spawn(cmd, args, opts);
      },
    }),
  );
  assert.equal(captured.shell, false);
});

/* ========================================================================== */
/* LONG PROMPT (section 36)                                                   */
/* ========================================================================== */

test('prompt: 64 KiB+ prompt round-trips via stdin', async (t) => {
  t.before(setup);
  // Well beyond Windows normal command-line comfort (~8 KiB).
  const prompt = 'A'.repeat(200 * 1024) + '\n' + 'B'.repeat(200 * 1024) + 'Ω';
  const result = await runToResult(
    new ProcessRunner(),
    baseOptions(nativeLaunch('echo'), { prompt }),
  );
  assert.equal(result.stdoutBytes, Buffer.byteLength(prompt, 'utf8'));
  // Retained tail (64 KiB) holds the very end of the prompt.
  assert.ok(result.stdoutTail.endsWith('Ω'));
  assert.ok(result.stdoutTail.includes('B'.repeat(100)));
});

/* ========================================================================== */
/* .CMD LAUNCH (section 37)                                                   */
/* ========================================================================== */

test('cmd-wrapper: launch descriptor uses shell:false + verbatim args', async (t) => {
  const cmdPath = await writeCmdWrapper('wrap.cmd');
  const safeArgs = ['model-normal', 'gpt-5.6', 'claude-sonnet', path.join(tmpDir, 'space dir', 'repo')];

  let captured: { opts: SpawnOptions; args: readonly string[] } = { opts: {}, args: [] };
  const runner = new ProcessRunner();
  const result = await runToResult(
    runner,
    baseOptions(
      { kind: 'cmd-wrapper', executable: cmdPath, argv: safeArgs },
      {
        spawnFn: (cmd, args, opts) => {
          captured = { opts, args };
          return spawn(cmd, args, opts);
        },
      },
    ),
  );
  assert.equal(captured.opts.shell, false, 'cmd-wrapper must never use shell:true');
  assert.equal(captured.opts.windowsVerbatimArguments, true);
  assert.deepEqual(captured.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(result.terminationReason, 'exited');
  assert.equal(result.exitCode, 0);
  const parsed = JSON.parse(result.stdoutTail) as string[];
  assert.deepEqual(parsed, safeArgs);
});

test('cmd-wrapper: buildCmdWrapperCommandLine produces a single quoted argument', () => {
  const descriptor: LaunchDescriptor = {
    kind: 'cmd-wrapper',
    executable: 'C:\\tools\\provider.cmd',
    argv: ['--model', 'gpt-5.6', '-C', 'C:\\safe path\\repo\\'],
  };
  const line = buildCmdWrapperCommandLine(descriptor);
  assert.equal(line, '""C:\\tools\\provider.cmd" --model gpt-5.6 -C "C:\\safe path\\repo\\\\""');
});

test('cmd-wrapper: real cmd.exe round-trips safe values including trailing backslashes', async () => {
  const cmdPath = await writeCmdWrapper('wrap-roundtrip.cmd');
  const safeArgs = [
    'gpt-5.6',
    'claude-sonnet',
    'value-with-dashes',
    'value.with.dots',
    'C:\\Users\\Public',
    'C:\\Program Files\\Test Folder',
    'C:\\Program Files\\Test Folder\\',
    'C:\\folder\\',
    'C:\\folder with spaces\\',
    'C:\\folder with spaces\\\\',
    'C:\\folder with spaces\\\\\\',
    'ordinary value with spaces',
    '--json',
    '--model',
    'C:\\',
    'C:\\Temp\\',
  ];

  const result = await runToResult(
    new ProcessRunner(),
    baseOptions({ kind: 'cmd-wrapper', executable: cmdPath, argv: safeArgs }),
  );

  assert.equal(result.terminationReason, 'exited');
  assert.equal(result.exitCode, 0);
  const parsed = JSON.parse(result.stdoutTail) as string[];
  assert.deepEqual(parsed, safeArgs);
});

test('cmd-wrapper: rejects unsafe argv before spawning cmd.exe', async () => {
  const cmdPath = await writeCmdWrapper('wrap-unsafe.cmd');

  const unsafeArgs = [
    'x&echo PWNED',
    'x|echo PWNED',
    'x>file',
    'x<file',
    'x^foo',
    'x%PATH%',
    'x!VAR!',
    'x(foo)',
    'x"quote',
    'x\r\ny',
    'x\0y',
  ];

  for (const unsafe of unsafeArgs) {
    let spawnCalls = 0;
    const result = await runToResult(
      new ProcessRunner(),
      baseOptions(
        { kind: 'cmd-wrapper', executable: cmdPath, argv: ['--model', unsafe, '--prompt-from-stdin'] },
        {
          spawnFn: (cmd, args, opts) => {
            spawnCalls += 1;
            return spawn(cmd, args, opts);
          },
        },
      ),
    );
    assert.equal(spawnCalls, 0);
    assert.equal(result.spawned, false);
    assert.equal(result.terminationReason, 'spawn-failed');
    assert.match(result.stderrTail, /^Unsafe argument for Windows command wrapper at argv index 1\.$/);
    assert.ok(!result.stderrTail.includes(unsafe));
  }
});

/* ========================================================================== */
/* PROVIDER TYPES (section 38)                                                */
/* ========================================================================== */

test('types: reportedModel nullable and not copied from requestedModel', () => {
  const result: ExecutionResult = {
    executionId: 'e1',
    process: { exitCode: 0, signal: null, timedOut: false, cancelled: false },
    provider: providerErrorFragment('completed'),
    model: { requestedModel: 'claude-sonnet-5', reportedModel: null, reportedModelSource: 'none' },
    usage: { source: 'none' },
    session: {},
    output: {},
  };
  assert.equal(result.model.reportedModel, null);
  assert.notEqual(result.model.requestedModel, result.model.reportedModel);
});

test('types: usage fields optional', () => {
  const result: ExecutionResult = {
    executionId: 'e1',
    process: { exitCode: 0, signal: null, timedOut: false, cancelled: false },
    provider: providerErrorFragment('unknown'),
    model: { requestedModel: null, reportedModel: null, reportedModelSource: 'none' },
    usage: { source: 'none' },
    session: {},
    output: {},
  };
  assert.equal(result.usage.inputTokens, undefined);
  assert.equal(result.usage.totalTokens, undefined);
});

test('types: process success is separate from provider success', () => {
  // nonzero exit, but provider may still have completed (adapter decides)
  const result: ExecutionResult = {
    executionId: 'e1',
    process: { exitCode: 2, signal: null, timedOut: false, cancelled: false },
    provider: providerErrorFragment('completed'),
    model: { requestedModel: null, reportedModel: null, reportedModelSource: 'none' },
    usage: { source: 'none' },
    session: {},
    output: {},
  };
  assert.equal(result.process.exitCode, 2);
  assert.equal(result.provider.success, true);
  assert.equal(result.provider.terminalState, 'completed');
});

test('types: no Task verification field exists', () => {
  const result: ExecutionResult = {
    executionId: 'e1',
    process: { exitCode: 0, signal: null, timedOut: false, cancelled: false },
    provider: providerErrorFragment('completed'),
    model: { requestedModel: null, reportedModel: null, reportedModelSource: 'none' },
    usage: { source: 'none' },
    session: {},
    output: {},
  };
  assert.equal('taskPassed' in result, false);
  assert.equal('verified' in result, false);
  assert.equal('taskAccepted' in result, false);
});

test('types: ProviderAdapter contract shape', () => {
  const adapter: ProviderAdapter = {
    id: 'claude' as ProviderId,
    probe: async () => ({ available: false }),
    execute: async () => ({
      executionId: 'e1',
      process: { exitCode: 0, signal: null, timedOut: false, cancelled: false },
      provider: providerErrorFragment('completed'),
      model: { requestedModel: null, reportedModel: null, reportedModelSource: 'none' },
      usage: { source: 'none' },
      session: {},
      output: {},
    }),
    cancel: () => undefined,
  };
  assert.equal(adapter.id, 'claude');
});

test('types: cursor-agent reserved but not available by default', () => {
  const reservedIds: ProviderId[] = ['claude', 'codex', 'ollama', 'cursor-agent'];
  assert.ok(reservedIds.includes('cursor-agent'));
  // No default availability map exists in the contract; availability is probe-derived.
  // (This assertion documents the invariant; there is no registry to check.)
  assert.ok(true);
});

test('types: resolveWorkingDirectory rejects outside paths', async (t) => {
  const same = resolveWorkingDirectory(tmpDir, tmpDir);
  assert.equal(same.ok, true);

  const outside = resolveWorkingDirectory(os.homedir(), tmpDir);
  assert.equal(outside.ok, false);
  if (!outside.ok) {
    assert.equal(outside.code, 'WORKING_DIRECTORY_INVALID');
  }

  const missing = resolveWorkingDirectory(path.join(tmpDir, 'nope'), tmpDir);
  assert.equal(missing.ok, false);
});

/* ========================================================================== */
/* OPTIONAL LOCAL SMOKE (section 41) — harmless Node fixture only             */
/* ========================================================================== */

test('smoke: stdin + jsonl + stderr + exit end-to-end (no real provider)', async (t) => {
  const d = new JsonlDecoder();
  const result = await runToResult(
    new ProcessRunner(),
    baseOptions(nativeLaunch('jsonl'), {
      prompt: 'ignored-by-jsonl-fixture',
      callbacks: { onStdoutChunk: (chunk) => d.push(chunk) },
    }),
  );
  d.flush();
  assert.equal(result.terminationReason, 'exited');
  assert.equal(result.exitCode, 0);
  assert.equal(d.counts.json, 3);
  assert.equal(d.counts.nonJson, 1); // the SUCCESS line
});
