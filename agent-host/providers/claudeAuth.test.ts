import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import type { ChildProcess, SpawnOptions } from 'node:child_process';

import { ClaudeCompatibleProviderAdapter, buildClaudeLaunchDescriptor } from './claude.ts';
import { runClaudeSubscriptionProbe } from './claudeSubscriptionProbe.ts';
import {
  CLAUDE_API_BILLING_DISABLED_MESSAGE,
  CLAUDE_BILLING_MODE,
  buildProviderEnvironment,
} from './environmentPolicy.ts';
import { ProcessRunner, type LaunchDescriptor } from './processRunner.ts';
import type { ExecutionRequest, ProcessExecutionResult } from './types.ts';

const FIXTURE_SECRET = 'sk-ant-fixture-do-not-log';

function request(overrides: Partial<ExecutionRequest> = {}): ExecutionRequest {
  return {
    executionId: 'exec-auth',
    attemptId: 'attempt-auth',
    taskId: 'task-auth',
    runId: 'run-auth',
    workingDirectory: 'C:\\Repo\\PowerOn',
    prompt: 'Reply with exactly: CLAUDE_SUBSCRIPTION_OK',
    permissionProfile: 'read-only-reviewer',
    timeoutMs: 60_000,
    ...overrides,
  };
}

test('claude subscription-only child inherits Windows user config homes and does not invent an API key', () => {
  assert.equal(CLAUDE_BILLING_MODE, 'SUBSCRIPTION_ONLY');
  const source = {
    SystemRoot: 'C:\\Windows',
    PATH: 'C:\\Tools',
    USERPROFILE: 'C:\\Users\\fixture',
    HOME: 'C:\\Users\\fixture',
    APPDATA: 'C:\\Users\\fixture\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\Users\\fixture\\AppData\\Local',
    CLAUDE_CODE_TEST_VAR: 'claude-only',
    COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
  };
  const child = buildProviderEnvironment('claude', source, undefined);
  assert.equal(child.USERPROFILE, source.USERPROFILE);
  assert.equal(child.HOME, source.HOME);
  assert.equal(child.APPDATA, source.APPDATA);
  assert.equal(child.LOCALAPPDATA, source.LOCALAPPDATA);
  assert.equal(child.PATH, source.PATH);
  assert.equal(child.CLAUDE_CODE_TEST_VAR, 'claude-only');
  assert.equal(child.ANTHROPIC_API_KEY, undefined);
  assert.equal(Object.keys(child).some((name) => name.toUpperCase() === 'ANTHROPIC_API_KEY'), false);
});

test('claude subscription-only mode strips a parent API key and leaves ordinary env intact', () => {
  const source = {
    PATH: 'C:\\Tools',
    USERPROFILE: 'C:\\Users\\fixture',
    HOME: 'C:\\Users\\fixture',
    APPDATA: 'C:\\Users\\fixture\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\Users\\fixture\\AppData\\Local',
    ANTHROPIC_API_KEY: FIXTURE_SECRET,
    ANTHROPIC_BASE_URL: 'https://api.example.invalid',
    CLAUDE_CODE_TEST_VAR: 'kept',
  };
  const child = buildProviderEnvironment('claude', source, {
    CLAUDE_CODE_OVERLAY: 'allowed',
    ANTHROPIC_API_KEY: FIXTURE_SECRET,
  });
  assert.equal(child.USERPROFILE, source.USERPROFILE);
  assert.equal(child.HOME, source.HOME);
  assert.equal(child.APPDATA, source.APPDATA);
  assert.equal(child.LOCALAPPDATA, source.LOCALAPPDATA);
  assert.equal(child.CLAUDE_CODE_TEST_VAR, 'kept');
  assert.equal(child.CLAUDE_CODE_OVERLAY, 'allowed');
  assert.equal(child.ANTHROPIC_API_KEY, undefined);
  assert.equal(child.ANTHROPIC_BASE_URL, undefined);
  assert.equal(JSON.stringify(child).includes(FIXTURE_SECRET), false);
});

test('claude subscription-only mode rejects an explicit API-key billing route', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'claude-auth-'));
  let spawned = 0;
  const runner = new ProcessRunner();
  const launch: LaunchDescriptor = { kind: 'native', executable: 'C:\\Tools\\claude.exe', argv: ['-p'] };
  const handle = runner.run({
    executionId: 'reject-api',
    launch,
    workingDirectory: dir,
    allowedWorkingDirectory: dir,
    prompt: 'Reply with exactly: CLAUDE_SUBSCRIPTION_OK',
    environmentProfile: 'claude',
    environmentSource: { SystemRoot: 'C:\\Windows', PATH: 'C:\\Tools', USERPROFILE: 'C:\\Users\\fixture' },
    envOverlay: { ANTHROPIC_API_KEY: FIXTURE_SECRET },
    timeouts: { overallTimeoutMs: 10_000, startupTimeoutMs: 10_000, idleTimeoutMs: 10_000 },
    spawnFn: () => {
      spawned += 1;
      throw new Error('spawn should not run');
    },
  });
  const result = await handle.done;
  assert.equal(spawned, 0);
  assert.equal(result.spawned, false);
  assert.equal(result.terminationReason, 'spawn-failed');
  assert.equal(result.stderrTail, CLAUDE_API_BILLING_DISABLED_MESSAGE);
  assert.equal(JSON.stringify(result).includes(FIXTURE_SECRET), false);
});

test('claude launch keeps the resolved executable, model override, and effort', () => {
  const executable = 'C:\\Tools\\claude.exe';
  const launch = buildClaudeLaunchDescriptor(
    { providerId: 'claude', executable },
    request({ requestedModel: 'claude-opus-test', reasoningEffort: 'high' }),
  );
  assert.equal(launch.kind, 'native');
  assert.equal(launch.executable, executable);
  assert.equal(launch.argv[0], '-p');
  assert.ok(launch.argv.includes('--model'));
  assert.ok(launch.argv.includes('claude-opus-test'));
  assert.ok(launch.argv.includes('--effort'));
  assert.ok(launch.argv.includes('high'));
  assert.ok(launch.argv.includes('--permission-mode'));
  assert.ok(launch.argv.includes('plan'));
  assert.equal(launch.argv.includes(FIXTURE_SECRET), false);
});

test('claude output parser replaces an API credit failure with the owner message', async () => {
  const line = `${JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: true,
    result: `Credit balance is too low ${FIXTURE_SECRET}`,
  })}\n`;
  let resolveDone!: (result: ProcessExecutionResult) => void;
  const done = new Promise<ProcessExecutionResult>((resolve) => {
    resolveDone = resolve;
  });
  const adapter = new ClaudeCompatibleProviderAdapter(
    { providerId: 'claude', executable: 'C:\\Tools\\claude.exe' },
    {
      runner: {
        run(options) {
          queueMicrotask(() => {
            options.callbacks?.onStdoutChunk?.(Buffer.from(line, 'utf8'));
            resolveDone({
              pid: 1,
              exitCode: 1,
              signal: null,
              spawned: true,
              timedOut: false,
              cancelled: false,
              outputLimitExceeded: false,
              terminationReason: 'exited',
              startedAt: '2026-09-24T00:00:00.000Z',
              endedAt: '2026-09-24T00:00:01.000Z',
              stdoutBytes: line.length,
              stderrBytes: 0,
              stdoutTail: line,
              stderrTail: '',
            });
          });
          return { executionId: options.executionId, pid: 1, done, cancel() {} };
        },
      },
    },
  );
  const result = await adapter.execute(request());
  assert.equal(result.provider.success, false);
  assert.equal(result.provider.errorCode, 'PROVIDER_UNAVAILABLE');
  assert.equal(result.provider.errorMessage, CLAUDE_API_BILLING_DISABLED_MESSAGE);
  assert.equal(JSON.stringify(result).includes(FIXTURE_SECRET), false);
  assert.equal(result.output.finalText, undefined);
});

test('subscription probe uses the host child environment and the headless print prompt', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'claude-probe-'));
  let capturedEnv: SpawnOptions['env'];
  let capturedArgs: readonly string[] | undefined;
  let capturedCwd: string | undefined;
  let capturedCommand: string | undefined;
  const result = await runClaudeSubscriptionProbe({
    executable: 'C:\\Tools\\claude.exe',
    workingDirectory: dir,
    environmentSource: {
      SystemRoot: 'C:\\Windows',
      PATH: 'C:\\Tools',
      USERPROFILE: 'C:\\Users\\fixture',
      HOME: 'C:\\Users\\fixture',
      APPDATA: 'C:\\Users\\fixture\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\fixture\\AppData\\Local',
      ANTHROPIC_API_KEY: FIXTURE_SECRET,
    },
    timeoutMs: 10_000,
    spawnFn: (command, args, options) => {
      capturedCommand = command;
      capturedArgs = args;
      capturedCwd = typeof options.cwd === 'string' ? options.cwd : undefined;
      capturedEnv = options.env;
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const stdin = new PassThrough();
      const child = new EventEmitter() as ChildProcess;
      child.stdout = stdout;
      child.stderr = stderr;
      child.stdin = stdin;
      Object.defineProperty(child, 'pid', { value: 4321 });
      child.kill = () => true;
      setImmediate(() => {
        stdout.write('CLAUDE_SUBSCRIPTION_OK\n');
        stdout.end();
        stderr.end();
        child.emit('exit', 0, null);
        child.emit('close', 0, null);
      });
      return child;
    },
  });
  assert.equal(capturedCommand, 'C:\\Tools\\claude.exe');
  assert.deepEqual(capturedArgs, ['-p']);
  assert.equal(capturedCwd, dir);
  assert.equal(capturedEnv?.USERPROFILE, 'C:\\Users\\fixture');
  assert.equal(capturedEnv?.HOME, 'C:\\Users\\fixture');
  assert.equal(capturedEnv?.APPDATA, 'C:\\Users\\fixture\\AppData\\Roaming');
  assert.equal(capturedEnv?.LOCALAPPDATA, 'C:\\Users\\fixture\\AppData\\Local');
  assert.equal(capturedEnv?.ANTHROPIC_API_KEY, undefined);
  assert.equal(JSON.stringify(capturedEnv).includes(FIXTURE_SECRET), false);
  assert.equal(result.matched, true);
  assert.equal(result.stdout, 'CLAUDE_SUBSCRIPTION_OK');
});
