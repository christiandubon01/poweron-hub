import test from 'node:test';
import assert from 'node:assert/strict';

import { ClaudeCompatibleProviderAdapter, buildClaudeLaunchDescriptor, mapPermissionProfileToClaudeMode } from './claude.ts';
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

function createRequest(overrides: Partial<ExecutionRequest> = {}): ExecutionRequest {
  return {
    executionId: 'exec-1',
    attemptId: 'attempt-1',
    taskId: 'task-1',
    runId: 'run-1',
    workingDirectory: 'C:\\Repo\\PowerOn',
    prompt: 'Implement the task safely.',
    requestedModel: 'requested-model-A',
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

function createRunnerDouble(simulations: SimulatedRun[] = []): { runner: { run(options: RunProcessOptions): { executionId: string; pid: number | null; done: Promise<ProcessExecutionResult>; cancel(): void } }; runs: RecordedRun[] } {
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

test('claude adapter: 1) system/init captures session + reported model', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [
        jsonLine({ type: 'system', subtype: 'init', session_id: 'sess-123', model: 'claude-reported-B' }),
        jsonLine({ type: 'result', subtype: 'success', is_error: false }),
      ],
    },
  ]);
  const adapter = new ClaudeCompatibleProviderAdapter(
    { providerId: 'claude', executable: 'C:\\Tools\\claude.exe' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  assert.equal(result.session.sessionId, 'sess-123');
  assert.equal(result.model.reportedModel, 'claude-reported-B');
  assert.equal(result.model.reportedModelSource, 'protocol-message');
});

test('claude adapter: 2) successful result is_error=false => provider.success=true', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [jsonLine({ type: 'result', subtype: 'success', is_error: false })],
    },
  ]);
  const adapter = new ClaudeCompatibleProviderAdapter(
    { providerId: 'claude', executable: 'C:\\Tools\\claude.exe' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  assert.equal(result.provider.success, true);
  assert.equal(result.provider.terminalState, 'completed');
});

test('claude adapter: 3) is_error=true + subtype=success => provider.success=false', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [jsonLine({ type: 'result', subtype: 'success', is_error: true, result: 'provider rejected the turn' })],
    },
  ]);
  const adapter = new ClaudeCompatibleProviderAdapter(
    { providerId: 'claude', executable: 'C:\\Tools\\claude.exe' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  assert.equal(result.provider.success, false);
  assert.equal(result.provider.errorCode, 'PROVIDER_ERROR');
});

test('claude adapter: 4) exit 0 + is_error=true => provider failure', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [jsonLine({ type: 'result', subtype: 'success', is_error: true, result: 'turn failed' })],
      processResult: createProcessResult({ exitCode: 0 }),
    },
  ]);
  const adapter = new ClaudeCompatibleProviderAdapter(
    { providerId: 'claude', executable: 'C:\\Tools\\claude.exe' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  assert.equal(result.process.exitCode, 0);
  assert.equal(result.provider.success, false);
});

test('claude adapter: 5) exit nonzero + valid result is_error=false keeps process fact separate from provider success', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [jsonLine({ type: 'result', subtype: 'success', is_error: false })],
      processResult: createProcessResult({ exitCode: 17 }),
    },
  ]);
  const adapter = new ClaudeCompatibleProviderAdapter(
    { providerId: 'claude', executable: 'C:\\Tools\\claude.exe' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  assert.equal(result.process.exitCode, 17);
  assert.equal(result.provider.success, true);
});

test('claude adapter: 6) exit 0 + no result event => PROTOCOL_ERROR', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [jsonLine({ type: 'assistant', message: { content: [{ type: 'text', text: 'partial only' }] } })],
      processResult: createProcessResult({ exitCode: 0 }),
    },
  ]);
  const adapter = new ClaudeCompatibleProviderAdapter(
    { providerId: 'claude', executable: 'C:\\Tools\\claude.exe' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  assert.equal(result.provider.success, false);
  assert.equal(result.provider.errorCode, 'PROTOCOL_ERROR');
});

test('claude adapter: 7) malformed/non-JSON diagnostics before valid result can still succeed', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [
        'NOTICE\n',
        '{"type":"assistant","message":{"content":[{"type":"text","text":"hello"}]}}\n{"type":}\n',
        jsonLine({ type: 'result', subtype: 'success', is_error: false }),
      ],
    },
  ]);
  const adapter = new ClaudeCompatibleProviderAdapter(
    { providerId: 'claude', executable: 'C:\\Tools\\claude.exe' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  assert.equal(result.provider.success, true);
  assert.equal(result.output.finalText, 'hello');
});

test('claude adapter: 8) requested model A and reported model B remain separate', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [
        jsonLine({ type: 'system', subtype: 'init', model: 'reported-model-B' }),
        jsonLine({ type: 'result', subtype: 'success', is_error: false }),
      ],
    },
  ]);
  const adapter = new ClaudeCompatibleProviderAdapter(
    { providerId: 'claude', executable: 'C:\\Tools\\claude.exe' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest({ requestedModel: 'requested-model-A' }));
  assert.equal(result.model.requestedModel, 'requested-model-A');
  assert.equal(result.model.reportedModel, 'reported-model-B');
});

test('claude adapter: 9) no reported model => null', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [jsonLine({ type: 'result', subtype: 'success', is_error: false })],
    },
  ]);
  const adapter = new ClaudeCompatibleProviderAdapter(
    { providerId: 'claude', executable: 'C:\\Tools\\claude.exe' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  assert.equal(result.model.reportedModel, null);
  assert.equal(result.model.reportedModelSource, 'none');
});

test('claude adapter: 10) session ID captured from terminal result when needed', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [jsonLine({ type: 'result', subtype: 'success', is_error: false, session_id: 'sess-terminal' })],
    },
  ]);
  const adapter = new ClaudeCompatibleProviderAdapter(
    { providerId: 'claude', executable: 'C:\\Tools\\claude.exe' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  assert.equal(result.session.sessionId, 'sess-terminal');
});

test('claude adapter: 11) usage extraction maps provider-reported totals', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [
        jsonLine({
          type: 'result',
          subtype: 'success',
          is_error: false,
          usage: {
            input_tokens: 101,
            output_tokens: 202,
            total_tokens: 303,
          },
        }),
      ],
    },
  ]);
  const adapter = new ClaudeCompatibleProviderAdapter(
    { providerId: 'claude', executable: 'C:\\Tools\\claude.exe' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  assert.deepEqual(result.usage, {
    inputTokens: 101,
    outputTokens: 202,
    totalTokens: 303,
    source: 'protocol-message',
  });
});

test('claude adapter: 12) cached and reasoning fields stay provenance-correct', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [
        jsonLine({
          type: 'result',
          subtype: 'success',
          is_error: false,
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            cache_read_input_tokens: 3,
            cache_creation_input_tokens: 4,
            thinking_tokens: 5,
          },
        }),
      ],
    },
  ]);
  const adapter = new ClaudeCompatibleProviderAdapter(
    { providerId: 'claude', executable: 'C:\\Tools\\claude.exe' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  assert.equal(result.usage.cachedInputTokens, 7);
  assert.equal(result.usage.reasoningTokens, 5);
  assert.equal(result.usage.totalTokens, undefined);
  assert.equal(result.usage.source, 'protocol-message');
});

test('claude adapter: 13) final text is bounded to approximately 32 KiB', async () => {
  const longText = 'x'.repeat(40 * 1024);
  const runner = createRunnerDouble([
    {
      stdoutChunks: [
        jsonLine({ type: 'assistant', message: { content: [{ type: 'text', text: longText }] } }),
        jsonLine({ type: 'result', subtype: 'success', is_error: false }),
      ],
    },
  ]);
  const adapter = new ClaudeCompatibleProviderAdapter(
    { providerId: 'claude', executable: 'C:\\Tools\\claude.exe' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  const finalText = result.output.finalText ?? '';
  assert.ok(Buffer.byteLength(finalText, 'utf8') <= 32 * 1024);
  assert.ok(finalText.endsWith('x'.repeat(256)));
});

test('claude adapter: 14) unknown JSON events are ignored safely', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [
        jsonLine({ type: 'tool_use', name: 'bash', input: { command: 'echo hi' } }),
        jsonLine({ type: 'result', subtype: 'success', is_error: false }),
      ],
    },
  ]);
  const adapter = new ClaudeCompatibleProviderAdapter(
    { providerId: 'claude', executable: 'C:\\Tools\\claude.exe' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest());
  assert.equal(result.provider.success, true);
});

test('claude adapter: 15) prompt travels through stdin, not argv', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [jsonLine({ type: 'result', subtype: 'success', is_error: false })],
    },
  ]);
  const prompt = 'sensitive prompt text should stay off argv';
  const adapter = new ClaudeCompatibleProviderAdapter(
    { providerId: 'claude', executable: 'C:\\Tools\\claude.exe' },
    { runner: runner.runner },
  );

  await adapter.execute(createRequest({ prompt }));
  const launch = runner.runs[0].options.launch;
  assert.equal(runner.runs[0].options.prompt, prompt);
  assert.equal(runner.runs[0].options.environmentProfile, 'claude');
  assert.equal(launch.argv.some((arg) => arg.includes(prompt)), false);
});

test('claude adapter: 16) native permission mode maps reviewer/verifier to plan and implementer to acceptEdits', () => {
  const reviewerArgs = buildClaudeLaunchDescriptor(
    { providerId: 'claude', executable: 'C:\\Tools\\claude.exe' },
    createRequest({ permissionProfile: 'read-only-reviewer' }),
  ).argv;
  const verifierArgs = buildClaudeLaunchDescriptor(
    { providerId: 'claude', executable: 'C:\\Tools\\claude.exe' },
    createRequest({ permissionProfile: 'verifier' }),
  ).argv;
  const implementerArgs = buildClaudeLaunchDescriptor(
    { providerId: 'claude', executable: 'C:\\Tools\\claude.exe' },
    createRequest({ permissionProfile: 'task-implementer' }),
  ).argv;

  assert.equal(mapPermissionProfileToClaudeMode('read-only-reviewer'), 'plan');
  assert.equal(mapPermissionProfileToClaudeMode('verifier'), 'plan');
  assert.equal(mapPermissionProfileToClaudeMode('task-implementer'), 'acceptEdits');
  assert.deepEqual(reviewerArgs.slice(4, 6), ['--permission-mode', 'plan']);
  assert.deepEqual(verifierArgs.slice(4, 6), ['--permission-mode', 'plan']);
  assert.deepEqual(implementerArgs.slice(4, 6), ['--permission-mode', 'acceptEdits']);
});

test('claude adapter: 17) no dangerous bypass flag appears in launches', () => {
  const launch = buildClaudeLaunchDescriptor(
    { providerId: 'claude', executable: 'C:\\Tools\\claude.exe' },
    createRequest(),
  );
  assert.equal(launch.argv.includes('--dangerously-skip-permissions'), false);
  const deniedTools = launch.argv[launch.argv.indexOf('--disallowedTools') + 1];
  assert.ok(deniedTools.includes('WebFetch'));
  assert.ok(deniedTools.includes('WebSearch'));
  assert.ok(deniedTools.includes('Bash(git push *)'));
  assert.ok(deniedTools.includes('Bash(netlify *)'));
  assert.ok(deniedTools.includes('Bash(supabase *)'));
});

test('claude adapter: 18) Ollama harness argv is correct', () => {
  const launch = buildClaudeLaunchDescriptor(
    { providerId: 'ollama', executable: 'C:\\Tools\\ollama.exe', harness: 'claude' },
    createRequest({ requestedModel: 'glm-4.5-air' }),
  );
  assert.deepEqual(launch.argv, [
    'launch',
    'claude',
    '--model',
    'glm-4.5-air',
    '--yes',
    '--',
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    'acceptEdits',
    '--disallowedTools',
    'WebFetch,WebSearch,Bash(git push *),Bash(git reset --hard *),Bash(git clean *),Bash(netlify *),Bash(supabase *)',
  ]);
});

test('claude adapter: 19) Ollama requested model is passed literally through the native ollama executable path', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [jsonLine({ type: 'result', subtype: 'success', is_error: false })],
    },
  ]);
  const adapter = new ClaudeCompatibleProviderAdapter(
    { providerId: 'ollama', executable: 'C:\\Tools\\ollama.exe', harness: 'claude' },
    { runner: runner.runner },
  );

  await adapter.execute(createRequest({ requestedModel: 'owner/special-model:beta' }));
  assert.equal(runner.runs[0].options.launch.executable, 'C:\\Tools\\ollama.exe');
  assert.equal(runner.runs[0].options.launch.argv[3], 'owner/special-model:beta');
});

test('claude adapter: 20) cancellation delegates only to the active execution', async () => {
  const runner = createRunnerDouble([
    { autoResolve: false },
    { autoResolve: false },
  ]);
  const adapter = new ClaudeCompatibleProviderAdapter(
    { providerId: 'claude', executable: 'C:\\Tools\\claude.exe' },
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

test('claude adapter: 21) completed execution is removed from the active map', async () => {
  const runner = createRunnerDouble([
    {
      stdoutChunks: [jsonLine({ type: 'result', subtype: 'success', is_error: false })],
    },
  ]);
  const adapter = new ClaudeCompatibleProviderAdapter(
    { providerId: 'claude', executable: 'C:\\Tools\\claude.exe' },
    { runner: runner.runner },
  );

  await adapter.execute(createRequest({ executionId: 'exec-finished' }));
  adapter.cancel('exec-finished');
  assert.equal(runner.runs[0].cancelCalls, 0);
});

test('claude adapter: 22) authentication error classification does not rely on exit code', async () => {
  for (const exitCode of [0, 23]) {
    const runner = createRunnerDouble([
      {
        stdoutChunks: [
          jsonLine({
            type: 'result',
            subtype: 'success',
            is_error: true,
            result: 'Authentication expired. Please log in again.',
          }),
        ],
        processResult: createProcessResult({ exitCode }),
      },
    ]);
    const adapter = new ClaudeCompatibleProviderAdapter(
      { providerId: 'claude', executable: 'C:\\Tools\\claude.exe' },
      { runner: runner.runner },
    );

    const result = await adapter.execute(createRequest());
    assert.equal(result.process.exitCode, exitCode);
    assert.equal(result.provider.errorCode, 'PROVIDER_UNAVAILABLE');
  }
});

test('claude adapter: probe is conservative for native Claude', async () => {
  const seen: Array<{ executable: string; argv: string[] }> = [];
  const adapter = new ClaudeCompatibleProviderAdapter(
    { providerId: 'claude', executable: 'C:\\Tools\\claude.exe' },
    {
      runVersionProbe: async (launch) => {
        seen.push({ executable: launch.executable, argv: launch.argv });
        return { stdout: 'claude 1.2.3\n', stderr: '' };
      },
    },
  );

  const probe = await adapter.probe();
  assert.deepEqual(seen, [{ executable: 'C:\\Tools\\claude.exe', argv: ['--version'] }]);
  assert.equal(probe.available, true);
  assert.equal(probe.resolvedPath, 'C:\\Tools\\claude.exe');
  assert.equal(probe.harnessKind, 'native-executable');
  assert.equal(probe.cliVersion, 'claude 1.2.3');
});

test('claude adapter: probe is conservative for Ollama Claude harness', async () => {
  const adapter = new ClaudeCompatibleProviderAdapter(
    { providerId: 'ollama', executable: 'C:\\Tools\\ollama.cmd', harness: 'claude' },
    {
      runVersionProbe: async () => ({ stdout: '', stderr: 'ollama 0.6.0\n' }),
    },
  );

  const probe = await adapter.probe();
  assert.equal(probe.available, true);
  assert.equal(probe.harnessKind, 'cmd-wrapper');
  assert.equal(probe.cliVersion, 'ollama 0.6.0');
});

test('claude adapter: missing Ollama requested model fails before launch', async () => {
  const runner = createRunnerDouble();
  const adapter = new ClaudeCompatibleProviderAdapter(
    { providerId: 'ollama', executable: 'C:\\Tools\\ollama.exe', harness: 'claude' },
    { runner: runner.runner },
  );

  const result = await adapter.execute(createRequest({ requestedModel: undefined }));
  assert.equal(result.provider.success, false);
  assert.equal(result.provider.errorCode, 'MODEL_UNAVAILABLE');
  assert.equal(runner.runs.length, 0);
});
