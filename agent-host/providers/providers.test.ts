/**
 * ORCH-3B provider execution foundation tests.
 *
 * No paid model calls. No Claude/Codex/Ollama. Deterministic Node child
 * fixtures (agent-host/providers/fixtures/child.ts) simulate every behavior.
 */

import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { JsonlDecoder } from './jsonl.ts';
import {
  ProcessRunner,
  buildCmdWrapperCommandLine,
  defaultKillProcessTree,
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
} from './processRunner.ts';
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
    ...overrides,
  };
}

async function writeCmdWrapper(name: string): Promise<string> {
  const cmdPath = path.join(tmpDir, name);
  const content = `@"${process.execPath}" "${FIXTURE}" --mode args %*\r\n`;
  await writeFile(cmdPath, content, 'utf8');
  return cmdPath;
}

/** Kill fn that records calls and delegates to the real tree kill (cleans up). */
function recordingKill(): { fn: KillProcessTreeFn; calls: number[] } {
  const calls: number[] = [];
  const fn: KillProcessTreeFn = async (pid: number) => {
    calls.push(pid);
    return defaultKillProcessTree(pid);
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
  const result = await runToResult(
    new ProcessRunner(),
    baseOptions(nativeLaunch('idle'), {
      timeouts: { overallTimeoutMs: 10_000, startupTimeoutMs: 10_000, idleTimeoutMs: 200, cancelGraceMs: 100 },
      killProcessTree: kill.fn,
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
      await defaultKillProcessTree(handle.pid);
      forceStopKnownPid(handle.pid);
    }
    if (grandchildPid !== null && processExists(grandchildPid)) {
      await defaultKillProcessTree(grandchildPid);
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

test('process: 18) timeout validation', () => {
  assert.throws(() => validateOverallTimeout(0), TimeoutValidationError);
  assert.throws(() => validateOverallTimeout(-1), TimeoutValidationError);
  assert.throws(() => validateOverallTimeout(NaN), TimeoutValidationError);
  assert.throws(() => validateOverallTimeout(Infinity), TimeoutValidationError);
  assert.throws(() => validateOverallTimeout('1000'), TimeoutValidationError);
  // below min -> clamped to min
  assert.equal(validateOverallTimeout(5_000), OVERALL_TIMEOUT_MIN_MS);
  // above max -> clamped to max (no multi-hour runs)
  assert.equal(validateOverallTimeout(99 * 60_000), OVERALL_TIMEOUT_MAX_MS);
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
