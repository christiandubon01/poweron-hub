import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildCodexLaunchDescriptor, CodexProviderAdapter, mapPermissionProfileToCodexSandbox } from './codex.ts';
import type { RunProcessOptions } from './processRunner.ts';
import type { ExecutionRequest, ProcessExecutionResult } from './types.ts';

interface SimulatedRun {
  stdoutChunks?: Array<string | Buffer>;
  stderrChunks?: Array<string | Buffer>;
  processResult?: ProcessExecutionResult;
  autoResolve?: boolean;
}

interface RecordedRun {
  options: RunProcessOptions;
  cancelCalls: number;
  resolve: (result: ProcessExecutionResult) => void;
}

let tmpDir: string;

before(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'orch3d-codex-'));
});

function createRequest(overrides: Partial<ExecutionRequest> = {}): ExecutionRequest {
  return {
    executionId: 'exec-1',
    attemptId: 'attempt-1',
    taskId: 'task-1',
    runId: 'run-1',
    workingDirectory: 'C:\\Repo\\PowerOn',
    prompt: 'Implement the task safely.',
    requestedModel: 'gpt-5.6',
    reasoningEffort: 'medium',
    permissionProfile: 'task-implementer',
    timeoutMs: 120_000,
    ...overrides,
  };
}

function createProcessResult(overrides: Partial<ProcessExecutionResult> = {}): ProcessExecutionResult {
  return {
    pid: 4242,
    exitCode: 0,
    signal: null,
    spawned: true,
    timedOut: false,
    cancelled: false,
    outputLimitExceeded: false,
    terminationReason: 'exited',
    startedAt: '2026-08-24T00:00:00.000Z',
    endedAt: '2026-08-24T00:00:01.000Z',
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutTail: '',
    stderrTail: '',
    ...overrides,
  };
}

function jsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function createRunnerDouble(simulations: SimulatedRun[] = []): {
  runner: {
    run(options: RunProcessOptions): {
      executionId: string;
      pid: number | null;
      done: Promise<ProcessExecutionResult>;
      cancel(): void;
    };
  };
  runs: RecordedRun[];
} {
  const runs: RecordedRun[] = [];
  const queue = simulations.slice();

  return {
    runs,
    runner: {
      run(options: RunProcessOptions) {
        const simulation = queue.shift() ?? {};
        let resolveDone!: (result: ProcessExecutionResult) => void;
        const done = new Promise<ProcessExecutionResult>((resolve) => {
          resolveDone = resolve;
        });

        const record: RecordedRun = {
          options,
          cancelCalls: 0,
          resolve: resolveDone,
        };
        runs.push(record);

        const emit = (): void => {
          for (const chunk of simulation.stdoutChunks ?? []) {
            options.callbacks?.onStdoutChunk?.(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
          }
          for (const chunk of simulation.stderrChunks ?? []) {
            options.callbacks?.onStderrChunk?.(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
          }
          if (simulation.autoResolve !== false) {
            resolveDone(simulation.processResult ?? createProcessResult());
          }
        };

        queueMicrotask(emit);

        return {
          executionId: options.executionId,
          pid: 4242,
          done,
          cancel() {
            record.cancelCalls += 1;
          },
        };
      },
    },
  };
}

async function nextTick(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
}

test('codex adapter: 1) thread.started captures thread_id as sessionId', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [
        jsonLine({ type: 'thread.started', thread_id: 'thread-123' }),
        jsonLine({ type: 'turn.completed' }),
      ],
    },
  ]);
  const adapter = new CodexProviderAdapter(
    { providerId: 'codex', executable: 'C:\\Tools\\codex.cmd' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  assert.equal(result.session.sessionId, 'thread-123');
});

test('codex adapter: 2) turn.completed is required for provider success', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [
        jsonLine({ type: 'thread.started', thread_id: 'thread-123' }),
        jsonLine({ type: 'turn.started' }),
        jsonLine({ type: 'turn.completed' }),
      ],
    },
  ]);
  const adapter = new CodexProviderAdapter(
    { providerId: 'codex', executable: 'C:\\Tools\\codex.cmd' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  assert.equal(result.provider.success, true);
  assert.equal(result.provider.terminalState, 'completed');
});

test('codex adapter: 3) exit 0 without turn.completed is PROTOCOL_ERROR', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [jsonLine({ type: 'turn.started' })],
      processResult: createProcessResult({ exitCode: 0 }),
    },
  ]);
  const adapter = new CodexProviderAdapter(
    { providerId: 'codex', executable: 'C:\\Tools\\codex.cmd' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  assert.equal(result.provider.success, false);
  assert.equal(result.provider.errorCode, 'PROTOCOL_ERROR');
});

test('codex adapter: 4) nonzero exit is preserved separately from provider success', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [jsonLine({ type: 'turn.completed' })],
      processResult: createProcessResult({ exitCode: 17 }),
    },
  ]);
  const adapter = new CodexProviderAdapter(
    { providerId: 'codex', executable: 'C:\\Tools\\codex.cmd' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  assert.equal(result.process.exitCode, 17);
  assert.equal(result.provider.success, true);
});

test('codex adapter: 5) turn.failed maps to PROVIDER_ERROR', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [jsonLine({ type: 'turn.failed', message: 'provider rejected the turn' })],
    },
  ]);
  const adapter = new CodexProviderAdapter(
    { providerId: 'codex', executable: 'C:\\Tools\\codex.cmd' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  assert.equal(result.provider.success, false);
  assert.equal(result.provider.errorCode, 'PROVIDER_ERROR');
  assert.match(result.provider.errorMessage ?? '', /provider rejected the turn/u);
});

test('codex adapter: 6) structured top-level error is a provider failure', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [jsonLine({ type: 'error', message: 'provider exploded' })],
    },
  ]);
  const adapter = new CodexProviderAdapter(
    { providerId: 'codex', executable: 'C:\\Tools\\codex.cmd' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  assert.equal(result.provider.success, false);
  assert.equal(result.provider.errorCode, 'PROVIDER_ERROR');
  assert.match(result.provider.errorMessage ?? '', /provider exploded/u);
});

test('codex adapter: 7) authoritative failure is not overwritten by later turn.completed', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [
        jsonLine({ type: 'error', message: 'still failed' }),
        jsonLine({ type: 'turn.completed' }),
      ],
    },
  ]);
  const adapter = new CodexProviderAdapter(
    { providerId: 'codex', executable: 'C:\\Tools\\codex.cmd' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  assert.equal(result.provider.success, false);
  assert.equal(result.provider.errorCode, 'PROVIDER_ERROR');
});

test('codex adapter: 8) stderr diagnostics containing ERROR do not imply provider failure', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [jsonLine({ type: 'turn.completed' })],
      stderrChunks: ['ERROR but benign\n'],
      processResult: createProcessResult({ stderrTail: 'ERROR but benign\n', stderrBytes: 17 }),
    },
  ]);
  const adapter = new CodexProviderAdapter(
    { providerId: 'codex', executable: 'C:\\Tools\\codex.cmd' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  assert.equal(result.provider.success, true);
  assert.equal(result.diagnostics?.stderrTail, 'ERROR but benign\n');
});

test('codex adapter: 9) non-JSON stdout before a valid terminal event is tolerated', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [
        'SUCCESS: completed stream setup\n',
        jsonLine({ type: 'turn.completed' }),
      ],
    },
  ]);
  const adapter = new CodexProviderAdapter(
    { providerId: 'codex', executable: 'C:\\Tools\\codex.cmd' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  assert.equal(result.provider.success, true);
});

test('codex adapter: 10) malformed JSON diagnostic before valid terminal is tolerated', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [
        '{"type":}\n',
        jsonLine({ type: 'turn.completed' }),
      ],
    },
  ]);
  const adapter = new CodexProviderAdapter(
    { providerId: 'codex', executable: 'C:\\Tools\\codex.cmd' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  assert.equal(result.provider.success, true);
});

test('codex adapter: 11) requestedModel is preserved but reportedModel remains null', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [
        jsonLine({ type: 'turn.completed', model: 'provider-did-not-really-report-this' }),
      ],
    },
  ]);
  const adapter = new CodexProviderAdapter(
    { providerId: 'codex', executable: 'C:\\Tools\\codex.cmd' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest({ requestedModel: 'gpt-5.6' }));
  assert.equal(result.model.requestedModel, 'gpt-5.6');
  assert.equal(result.model.reportedModel, null);
  assert.equal(result.model.reportedModelSource, 'none');
  assert.notEqual(result.model.requestedModel, result.model.reportedModel);
});

test('codex adapter: 12) conflicting thread IDs are a PROTOCOL_ERROR', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [
        jsonLine({ type: 'thread.started', thread_id: 'thread-1' }),
        jsonLine({ type: 'thread.started', thread_id: 'thread-2' }),
        jsonLine({ type: 'turn.completed' }),
      ],
    },
  ]);
  const adapter = new CodexProviderAdapter(
    { providerId: 'codex', executable: 'C:\\Tools\\codex.cmd' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  assert.equal(result.provider.success, false);
  assert.equal(result.provider.errorCode, 'PROTOCOL_ERROR');
});

test('codex adapter: 13) turn.completed usage maps input/cached/output/reasoning fields', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [
        jsonLine({
          type: 'turn.completed',
          usage: {
            input_tokens: 11,
            cached_input_tokens: 7,
            output_tokens: 22,
            reasoning_output_tokens: 5,
          },
        }),
      ],
    },
  ]);
  const adapter = new CodexProviderAdapter(
    { providerId: 'codex', executable: 'C:\\Tools\\codex.cmd' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  assert.deepEqual(result.usage, {
    inputTokens: 11,
    cachedInputTokens: 7,
    outputTokens: 22,
    reasoningTokens: 5,
    source: 'protocol-message',
  });
});

test('codex adapter: 14) totalTokens only appears when explicitly reported and no quota is inferred', async () => {
  const withTotalRunner = createRunnerDouble([
    {
      stdoutChunks: [
        jsonLine({
          type: 'turn.completed',
          usage: {
            total_tokens: 99,
          },
        }),
      ],
    },
  ]);
  const withoutTotalRunner = createRunnerDouble([
    {
      stdoutChunks: [
        jsonLine({
          type: 'turn.completed',
          usage: {
            input_tokens: 10,
          },
        }),
      ],
    },
  ]);

  const withTotal = new CodexProviderAdapter(
    { providerId: 'codex', executable: 'C:\\Tools\\codex.cmd' },
    { runner: withTotalRunner.runner },
  );
  const withoutTotal = new CodexProviderAdapter(
    { providerId: 'codex', executable: 'C:\\Tools\\codex.cmd' },
    { runner: withoutTotalRunner.runner },
  );

  const [withTotalResult, withoutTotalResult] = await Promise.all([
    withTotal.execute(createRequest({ executionId: 'with-total' })),
    withoutTotal.execute(createRequest({ executionId: 'without-total' })),
  ]);

  assert.equal(withTotalResult.usage.totalTokens, 99);
  assert.equal(withoutTotalResult.usage.totalTokens, undefined);
  assert.equal('quotaRemaining' in withoutTotalResult.usage, false);
});

test('codex adapter: 15) final agent_message text is captured from item.completed', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [
        jsonLine({
          type: 'item.completed',
          item: {
            type: 'agent_message',
            text: 'Final answer text',
          },
        }),
        jsonLine({ type: 'turn.completed' }),
      ],
    },
  ]);
  const adapter = new CodexProviderAdapter(
    { providerId: 'codex', executable: 'C:\\Tools\\codex.cmd' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  assert.equal(result.output.finalText, 'Final answer text');
});

test('codex adapter: 16) latest agent_message wins and final text is bounded to about 32 KiB', async () => {
  const longText = 'x'.repeat(40 * 1024);
  const runner = createRunnerDouble([
    {
      stdoutChunks: [
        jsonLine({
          type: 'item.completed',
          item: {
            type: 'agent_message',
            text: 'Earlier answer',
          },
        }),
        jsonLine({
          type: 'item.completed',
          item: {
            type: 'agent_message',
            text: longText,
          },
        }),
        jsonLine({ type: 'turn.completed' }),
      ],
    },
  ]);
  const adapter = new CodexProviderAdapter(
    { providerId: 'codex', executable: 'C:\\Tools\\codex.cmd' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  const finalText = result.output.finalText ?? '';
  assert.ok(Buffer.byteLength(finalText, 'utf8') <= 32 * 1024);
  assert.equal(finalText.includes('Earlier answer'), false);
  assert.ok(finalText.endsWith('x'.repeat(256)));
});

test('codex adapter: 17) unknown JSON events are ignored safely', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [
        jsonLine({ type: 'tool.started', tool: 'bash' }),
        jsonLine({ type: 'turn.completed' }),
      ],
    },
  ]);
  const adapter = new CodexProviderAdapter(
    { providerId: 'codex', executable: 'C:\\Tools\\codex.cmd' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  assert.equal(result.provider.success, true);
});

test('codex adapter: 18) prompt travels through stdin and never through argv', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [jsonLine({ type: 'turn.completed' })],
    },
  ]);
  const prompt = 'sensitive prompt text should stay off argv';
  const adapter = new CodexProviderAdapter(
    { providerId: 'codex', executable: 'C:\\Tools\\codex.cmd' },
    { runner: runner.runner },
  );

  await adapter.execute(createRequest({ prompt }));
  const launch = runner.runs[0].options.launch;
  assert.equal(runner.runs[0].options.prompt, prompt);
  assert.equal(runner.runs[0].options.environmentProfile, 'codex');
  assert.equal(launch.argv.some((arg) => arg.includes(prompt)), false);
});

test('codex adapter: 19) sandbox mapping is conservative and danger-full-access is absent', () => {
  const reviewerLaunch = buildCodexLaunchDescriptor(
    { providerId: 'codex', executable: 'C:\\Tools\\codex.cmd' },
    createRequest({ permissionProfile: 'read-only-reviewer' }),
  );
  const verifierLaunch = buildCodexLaunchDescriptor(
    { providerId: 'codex', executable: 'C:\\Tools\\codex.cmd' },
    createRequest({ permissionProfile: 'verifier' }),
  );
  const implementerLaunch = buildCodexLaunchDescriptor(
    { providerId: 'codex', executable: 'C:\\Tools\\codex.cmd' },
    createRequest({ permissionProfile: 'task-implementer' }),
  );

  assert.equal(mapPermissionProfileToCodexSandbox('read-only-reviewer'), 'read-only');
  assert.equal(mapPermissionProfileToCodexSandbox('verifier'), 'read-only');
  assert.equal(mapPermissionProfileToCodexSandbox('task-implementer'), 'workspace-write');
  assert.deepEqual(reviewerLaunch.argv.slice(0, 8), ['exec', '--json', '--ephemeral', '-c', 'shell_environment_policy.inherit=core', '--sandbox', 'read-only', '-C']);
  assert.deepEqual(verifierLaunch.argv.slice(0, 8), ['exec', '--json', '--ephemeral', '-c', 'shell_environment_policy.inherit=core', '--sandbox', 'read-only', '-C']);
  assert.deepEqual(implementerLaunch.argv.slice(0, 8), ['exec', '--json', '--ephemeral', '-c', 'shell_environment_policy.inherit=core', '--sandbox', 'workspace-write', '-C']);
  assert.ok(implementerLaunch.argv.includes('sandbox_workspace_write.network_access=false'));
  assert.equal(reviewerLaunch.argv.includes('sandbox_workspace_write.network_access=false'), false);
  assert.equal(implementerLaunch.argv.includes('danger-full-access'), false);
});

test('codex adapter: 20) launch argv includes exact Codex exec shape and requested model passthrough', () => {
  const repoPath = 'C:\\Repo Path\\PowerOn';
  const launch = buildCodexLaunchDescriptor(
    { providerId: 'codex', executable: 'C:\\Tools\\codex.cmd' },
    createRequest({ workingDirectory: repoPath, requestedModel: 'gpt-5.6' }),
  );

  assert.deepEqual(launch.argv, [
    'exec',
    '--json',
    '--ephemeral',
    '-c',
    'shell_environment_policy.inherit=core',
    '--sandbox',
    'workspace-write',
    '-C',
    repoPath,
    '-c',
    'sandbox_workspace_write.network_access=false',
    '-m',
    'gpt-5.6',
  ]);
});

test('codex adapter: 21) -m is omitted when requestedModel is absent', () => {
  const launch = buildCodexLaunchDescriptor(
    { providerId: 'codex', executable: 'C:\\Tools\\codex.cmd' },
    createRequest({ requestedModel: undefined }),
  );

  assert.equal(launch.argv.includes('-m'), false);
});

test('codex adapter: 22) unsafe cmd-wrapper model is rejected by the shared ProcessRunner boundary', async () => {
  const adapter = new CodexProviderAdapter({ providerId: 'codex', executable: path.join(tmpDir, 'codex.cmd') });

  const result = await adapter.execute(
    createRequest({
      workingDirectory: tmpDir,
      requestedModel: 'x&echo PWNED',
    }),
  );

  assert.equal(result.provider.success, false);
  assert.equal(result.provider.errorCode, 'PROCESS_SPAWN_FAILED');
});

test('codex adapter: 23) cancel only affects the active execution', async () => {
  const runner = createRunnerDouble([
    { autoResolve: false },
    { autoResolve: false },
  ]);
  const adapter = new CodexProviderAdapter(
    { providerId: 'codex', executable: 'C:\\Tools\\codex.cmd' },
    { runner: runner.runner },
  );

  const first = adapter.execute(createRequest({ executionId: 'exec-1' }));
  const second = adapter.execute(createRequest({ executionId: 'exec-2' }));
  await nextTick();

  adapter.cancel('exec-2');
  assert.equal(runner.runs[0].cancelCalls, 0);
  assert.equal(runner.runs[1].cancelCalls, 1);

  runner.runs[0].resolve(createProcessResult({ terminationReason: 'cancelled', cancelled: true }));
  runner.runs[1].resolve(createProcessResult({ terminationReason: 'cancelled', cancelled: true }));
  await Promise.all([first, second]);
});

test('codex adapter: 24) completed execution is removed from the active map', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [jsonLine({ type: 'turn.completed' })],
    },
  ]);
  const adapter = new CodexProviderAdapter(
    { providerId: 'codex', executable: 'C:\\Tools\\codex.cmd' },
    { runner: runner.runner },
  );

  await adapter.execute(createRequest({ executionId: 'exec-finished' }));
  adapter.cancel('exec-finished');
  assert.equal(runner.runs[0].cancelCalls, 0);
});

test('codex adapter: 25) spawn failure maps to PROCESS_SPAWN_FAILED', async () => {
  const runner = createRunnerDouble([
    {
      processResult: createProcessResult({
        pid: null,
        spawned: false,
        terminationReason: 'spawn-failed',
      }),
    },
  ]);
  const adapter = new CodexProviderAdapter(
    { providerId: 'codex', executable: 'C:\\Tools\\codex.cmd' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  assert.equal(result.provider.errorCode, 'PROCESS_SPAWN_FAILED');
});

test('codex adapter: 26) timeout maps to EXECUTION_TIMEOUT', async () => {
  const runner = createRunnerDouble([
    {
      processResult: createProcessResult({
        timedOut: true,
        terminationReason: 'timeout-overall',
      }),
    },
  ]);
  const adapter = new CodexProviderAdapter(
    { providerId: 'codex', executable: 'C:\\Tools\\codex.cmd' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  assert.equal(result.provider.errorCode, 'EXECUTION_TIMEOUT');
});

test('codex adapter: 27) manual cancel maps to EXECUTION_CANCELLED', async () => {
  const runner = createRunnerDouble([
    {
      processResult: createProcessResult({
        cancelled: true,
        terminationReason: 'cancelled',
      }),
    },
  ]);
  const adapter = new CodexProviderAdapter(
    { providerId: 'codex', executable: 'C:\\Tools\\codex.cmd' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  assert.equal(result.provider.errorCode, 'EXECUTION_CANCELLED');
});

test('codex adapter: 28) output-limit maps to OUTPUT_LIMIT_EXCEEDED', async () => {
  const runner = createRunnerDouble([
    {
      processResult: createProcessResult({
        outputLimitExceeded: true,
        terminationReason: 'output-limit',
      }),
    },
  ]);
  const adapter = new CodexProviderAdapter(
    { providerId: 'codex', executable: 'C:\\Tools\\codex.cmd' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  assert.equal(result.provider.errorCode, 'OUTPUT_LIMIT_EXCEEDED');
});

test('codex adapter: 29) probe is conservative for the current cmd-wrapper installation route', async () => {
  const seen: Array<{ executable: string; argv: string[] }> = [];
  const adapter = new CodexProviderAdapter(
    { providerId: 'codex', executable: 'C:\\Tools\\codex.cmd' },
    {
      runVersionProbe: async (launch) => {
        seen.push({ executable: launch.executable, argv: launch.argv });
        return { stdout: 'codex-cli 0.130.0\n', stderr: '' };
      },
    },
  );

  const probe = await adapter.probe();
  assert.deepEqual(seen, [{ executable: 'C:\\Tools\\codex.cmd', argv: ['--version'] }]);
  assert.equal(probe.available, true);
  assert.equal(probe.resolvedPath, 'C:\\Tools\\codex.cmd');
  assert.equal(probe.harnessKind, 'cmd-wrapper');
  assert.equal(probe.cliVersion, 'codex-cli 0.130.0');
});
