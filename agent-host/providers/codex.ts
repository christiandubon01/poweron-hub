import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { JsonlDecoder, type JsonlEvent } from './jsonl.ts';
import { buildCmdWrapperCommandLine, ProcessRunner, type LaunchDescriptor, type ProcessHandle, type RunProcessOptions } from './processRunner.ts';
import {
  type ExecutionRequest,
  type ExecutionResult,
  type ExecutionStreamCallbacks,
  type PermissionProfile,
  type ProcessExecutionResult,
  type ProviderAdapter,
  type ProviderErrorCode,
  type ProviderProbeResult,
} from './types.ts';

const execFileAsync = promisify(execFile);

const VERSION_TIMEOUT_MS = 5_000;
const FINAL_TEXT_LIMIT_BYTES = 32 * 1024;
const STREAM_MAX_LINE_BYTES = 4 * 1024 * 1024;

export type CodexSandboxMode = 'read-only' | 'workspace-write';

export interface CodexLaunchTarget {
  providerId: 'codex';
  executable: string;
}

export interface VersionProbeOutput {
  stdout: string;
  stderr: string;
}

export interface CodexAdapterDependencies {
  runner?: Pick<ProcessRunner, 'run'>;
  runVersionProbe?: (launch: LaunchDescriptor, timeoutMs: number) => Promise<VersionProbeOutput>;
}

export class CodexLaunchConfigurationError extends Error {
  readonly errorCode: ProviderErrorCode;

  constructor(message: string, errorCode: ProviderErrorCode = 'PROVIDER_ERROR') {
    super(message);
    this.name = 'CodexLaunchConfigurationError';
    this.errorCode = errorCode;
  }
}

interface CodexUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  source: 'protocol-message' | 'none';
}

interface CodexTerminalFailure {
  kind: 'turn-failed' | 'provider-error';
  message?: string;
}

interface CodexStreamState {
  readonly decoder: JsonlDecoder;
  readonly finalText: BoundedTextTail;
  sawTurnCompleted: boolean;
  failure?: CodexTerminalFailure;
  sessionId?: string;
  protocolIssue?: string;
  usage: CodexUsage;
}

export class CodexProviderAdapter implements ProviderAdapter {
  readonly id: CodexLaunchTarget['providerId'];

  private readonly target: CodexLaunchTarget;
  private readonly runner: Pick<ProcessRunner, 'run'>;
  private readonly runVersionProbe: (launch: LaunchDescriptor, timeoutMs: number) => Promise<VersionProbeOutput>;
  private readonly activeExecutions = new Map<string, ProcessHandle>();

  constructor(target: CodexLaunchTarget, dependencies: CodexAdapterDependencies = {}) {
    this.id = target.providerId;
    this.target = target;
    this.runner = dependencies.runner ?? new ProcessRunner();
    this.runVersionProbe = dependencies.runVersionProbe ?? defaultRunVersionProbe;
  }

  async probe(): Promise<ProviderProbeResult> {
    if (!this.target.executable || this.target.executable.trim().length === 0) {
      return {
        available: false,
        harnessKind: 'missing',
        error: {
          code: 'PROVIDER_NOT_INSTALLED',
          message: 'Provider executable path is not configured.',
        },
      };
    }

    const launch: LaunchDescriptor = {
      kind: determineLaunchKind(this.target.executable),
      executable: this.target.executable,
      argv: ['--version'],
    };

    try {
      const output = await this.runVersionProbe(launch, VERSION_TIMEOUT_MS);
      const cliVersion = sanitizeVersionOutput(output.stdout) ?? sanitizeVersionOutput(output.stderr);
      return {
        available: true,
        resolvedPath: this.target.executable,
        harnessKind: launch.kind === 'cmd-wrapper' ? 'cmd-wrapper' : 'native-executable',
        cliVersion,
      };
    } catch (error) {
      return {
        available: false,
        resolvedPath: this.target.executable,
        harnessKind: launch.kind === 'cmd-wrapper' ? 'cmd-wrapper' : 'native-executable',
        error: {
          code: 'PROVIDER_UNAVAILABLE',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  async execute(request: ExecutionRequest, callbacks?: ExecutionStreamCallbacks): Promise<ExecutionResult> {
    let launch: LaunchDescriptor;
    try {
      launch = buildCodexLaunchDescriptor(this.target, request);
    } catch (error) {
      const failure =
        error instanceof CodexLaunchConfigurationError
          ? error
          : new CodexLaunchConfigurationError(error instanceof Error ? error.message : String(error));
      return buildImmediateFailureResult(request, failure.errorCode, failure.message);
    }

    const streamState = createStreamState();
    const handle = this.runner.run({
      executionId: request.executionId,
      launch,
      workingDirectory: request.workingDirectory,
      allowedWorkingDirectory: request.workingDirectory,
      prompt: request.prompt,
      timeouts: {
        overallTimeoutMs: request.timeoutMs,
      },
      callbacks: {
        onStdoutChunk: (chunk) => {
          for (const event of streamState.decoder.push(chunk)) {
            handleJsonlEvent(streamState, event);
          }
          callbacks?.onStdoutChunk?.(chunk);
        },
        onStderrChunk: (chunk) => {
          callbacks?.onStderrChunk?.(chunk);
        },
      },
    });

    this.activeExecutions.set(request.executionId, handle);

    let processResult: ProcessExecutionResult;
    try {
      processResult = await handle.done;
    } finally {
      if (this.activeExecutions.get(request.executionId) === handle) {
        this.activeExecutions.delete(request.executionId);
      }
    }

    try {
      for (const event of streamState.decoder.flush()) {
        handleJsonlEvent(streamState, event);
      }
    } catch (error) {
      if (!streamState.protocolIssue) {
        streamState.protocolIssue = error instanceof Error ? error.message : String(error);
      }
    }

    return buildExecutionResult(request, processResult, streamState);
  }

  cancel(executionId: string): void {
    this.activeExecutions.get(executionId)?.cancel();
  }
}

export function mapPermissionProfileToCodexSandbox(profile: PermissionProfile): CodexSandboxMode {
  if (profile === 'task-implementer') {
    return 'workspace-write';
  }
  return 'read-only';
}

export function buildCodexLaunchDescriptor(target: CodexLaunchTarget, request: ExecutionRequest): LaunchDescriptor {
  if (!target.executable || target.executable.trim().length === 0) {
    throw new CodexLaunchConfigurationError('Provider executable path is not configured.', 'PROVIDER_NOT_INSTALLED');
  }

  const sandbox = mapPermissionProfileToCodexSandbox(request.permissionProfile);
  const argv = [
    'exec',
    '--json',
    '--ephemeral',
    '--sandbox',
    sandbox,
    '-C',
    request.workingDirectory,
  ];

  if (typeof request.requestedModel === 'string' && request.requestedModel.trim().length > 0) {
    argv.push('-m', request.requestedModel);
  }

  return {
    kind: determineLaunchKind(target.executable),
    executable: target.executable,
    argv,
  };
}

function createStreamState(): CodexStreamState {
  return {
    decoder: new JsonlDecoder({ maxLineBytes: STREAM_MAX_LINE_BYTES }),
    finalText: new BoundedTextTail(FINAL_TEXT_LIMIT_BYTES),
    sawTurnCompleted: false,
    usage: { source: 'none' },
  };
}

function handleJsonlEvent(state: CodexStreamState, event: JsonlEvent): void {
  if (event.type !== 'json' || !isRecord(event.value)) {
    return;
  }

  const eventType = readString(event.value.type);
  if (!eventType) {
    return;
  }

  if (eventType === 'thread.started') {
    recordSessionId(state, readThreadId(event.value));
    return;
  }

  if (eventType === 'turn.started') {
    return;
  }

  if (eventType === 'item.completed') {
    const item = isRecord(event.value.item) ? event.value.item : undefined;
    if (item && readString(item.type) === 'agent_message') {
      const text = extractAgentMessageText(item);
      if (text) {
        state.finalText.replace(text);
      }
    }
    return;
  }

  if (eventType === 'turn.completed') {
    state.sawTurnCompleted = true;
    const usage = extractTurnUsage(event.value);
    if (usage.source === 'protocol-message') {
      state.usage = usage;
    }
    return;
  }

  if (eventType === 'turn.failed') {
    state.failure = {
      kind: 'turn-failed',
      message: extractErrorMessage(event.value),
    };
    return;
  }

  if (eventType === 'error') {
    state.failure = {
      kind: 'provider-error',
      message: extractErrorMessage(event.value),
    };
  }
}

function buildExecutionResult(
  request: ExecutionRequest,
  processResult: ProcessExecutionResult,
  state: CodexStreamState,
): ExecutionResult {
  let provider = mapProcessFailure(processResult);

  if (state.protocolIssue) {
    provider = {
      terminalState: 'failed',
      success: false,
      errorCode: 'PROTOCOL_ERROR',
      errorMessage: `Codex protocol inconsistency: ${state.protocolIssue}`,
    };
  } else if (state.failure) {
    provider = {
      terminalState: 'failed',
      success: false,
      errorCode: 'PROVIDER_ERROR',
      errorMessage:
        state.failure.message ??
        (state.failure.kind === 'turn-failed'
          ? 'Codex reported turn.failed.'
          : 'Codex reported a terminal provider error event.'),
    };
  } else if (state.sawTurnCompleted) {
    provider = {
      terminalState: 'completed',
      success: true,
    };
  }

  const finalText = state.finalText.toString();

  return {
    executionId: request.executionId,
    process: {
      exitCode: processResult.exitCode,
      signal: processResult.signal,
      timedOut: processResult.timedOut,
      cancelled: processResult.cancelled,
    },
    provider,
    model: {
      requestedModel: request.requestedModel ?? null,
      reportedModel: null,
      reportedModelSource: 'none',
    },
    usage: state.usage,
    session: state.sessionId ? { sessionId: state.sessionId } : {},
    output: finalText ? { finalText } : {},
    diagnostics: buildDiagnostics(processResult),
  };
}

function buildImmediateFailureResult(
  request: ExecutionRequest,
  errorCode: ProviderErrorCode,
  errorMessage: string,
): ExecutionResult {
  return {
    executionId: request.executionId,
    process: {
      exitCode: null,
      signal: null,
      timedOut: false,
      cancelled: false,
    },
    provider: {
      terminalState: 'failed',
      success: false,
      errorCode,
      errorMessage,
    },
    model: {
      requestedModel: request.requestedModel ?? null,
      reportedModel: null,
      reportedModelSource: 'none',
    },
    usage: {
      source: 'none',
    },
    session: {},
    output: {},
  };
}

function mapProcessFailure(processResult: ProcessExecutionResult): ExecutionResult['provider'] {
  switch (processResult.terminationReason) {
    case 'timeout-overall':
    case 'timeout-startup':
    case 'timeout-idle':
      return {
        terminalState: 'failed',
        success: false,
        errorCode: 'EXECUTION_TIMEOUT',
        errorMessage: 'Provider process timed out before Codex emitted turn.completed.',
      };
    case 'cancelled':
      return {
        terminalState: 'failed',
        success: false,
        errorCode: 'EXECUTION_CANCELLED',
        errorMessage: 'Provider execution was cancelled before Codex emitted turn.completed.',
      };
    case 'output-limit':
      return {
        terminalState: 'failed',
        success: false,
        errorCode: 'OUTPUT_LIMIT_EXCEEDED',
        errorMessage: 'Provider output exceeded the configured safety limit before Codex emitted turn.completed.',
      };
    case 'spawn-failed':
      return {
        terminalState: 'failed',
        success: false,
        errorCode: 'PROCESS_SPAWN_FAILED',
        errorMessage: 'Provider process could not be started.',
      };
    case 'callback-error':
      return {
        terminalState: 'failed',
        success: false,
        errorCode: 'PROTOCOL_ERROR',
        errorMessage: processResult.callbackErrorMessage ?? 'Provider callback processing failed.',
      };
    case 'exited':
    default:
      return {
        terminalState: 'failed',
        success: false,
        errorCode: 'PROTOCOL_ERROR',
        errorMessage: 'Provider process exited without a terminal Codex turn.completed event.',
      };
  }
}

function buildDiagnostics(processResult: ProcessExecutionResult): ExecutionResult['diagnostics'] | undefined {
  const diagnostics: ExecutionResult['diagnostics'] = {};
  if (processResult.stdoutTail.length > 0) {
    diagnostics.stdoutTail = processResult.stdoutTail;
  }
  if (processResult.stderrTail.length > 0) {
    diagnostics.stderrTail = processResult.stderrTail;
  }
  return Object.keys(diagnostics).length > 0 ? diagnostics : undefined;
}

function recordSessionId(state: CodexStreamState, sessionId: string | undefined): void {
  if (!sessionId) {
    return;
  }
  if (state.sessionId && state.sessionId !== sessionId) {
    state.protocolIssue = `conflicting thread_id values: ${state.sessionId} vs ${sessionId}`;
    return;
  }
  state.sessionId = sessionId;
}

function readThreadId(event: Record<string, unknown>): string | undefined {
  return firstString(
    event.thread_id,
    isRecord(event.thread) ? event.thread.id : undefined,
  );
}

function extractAgentMessageText(item: Record<string, unknown>): string | undefined {
  return firstString(
    item.text,
    isRecord(item.message) ? item.message.text : undefined,
    collectTextValue(item.content),
  );
}

function collectTextValue(value: unknown): string | undefined {
  const parts: string[] = [];
  collectTextParts(value, parts);
  const text = parts.join('');
  return text.length > 0 ? text : undefined;
}

function collectTextParts(value: unknown, parts: string[]): void {
  if (typeof value === 'string') {
    parts.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectTextParts(entry, parts);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  const type = readString(value.type);
  if (type !== undefined && type !== 'text') {
    if (value.content !== undefined) {
      collectTextParts(value.content, parts);
    }
    return;
  }
  const text = readString(value.text);
  if (text) {
    parts.push(text);
  }
  if (value.content !== undefined) {
    collectTextParts(value.content, parts);
  }
}

function extractTurnUsage(event: Record<string, unknown>): CodexUsage {
  const usageSource = isRecord(event.usage) ? event.usage : undefined;
  if (!usageSource) {
    return { source: 'none' };
  }

  const inputTokens = readNumber(usageSource.input_tokens);
  const cachedInputTokens = readNumber(usageSource.cached_input_tokens);
  const outputTokens = readNumber(usageSource.output_tokens);
  const reasoningTokens = readNumber(usageSource.reasoning_output_tokens);
  const totalTokens = readNumber(usageSource.total_tokens);

  if (
    inputTokens === undefined &&
    cachedInputTokens === undefined &&
    outputTokens === undefined &&
    reasoningTokens === undefined &&
    totalTokens === undefined
  ) {
    return { source: 'none' };
  }

  const usage: CodexUsage = { source: 'protocol-message' };
  if (inputTokens !== undefined) {
    usage.inputTokens = inputTokens;
  }
  if (cachedInputTokens !== undefined) {
    usage.cachedInputTokens = cachedInputTokens;
  }
  if (outputTokens !== undefined) {
    usage.outputTokens = outputTokens;
  }
  if (reasoningTokens !== undefined) {
    usage.reasoningTokens = reasoningTokens;
  }
  if (totalTokens !== undefined) {
    usage.totalTokens = totalTokens;
  }
  return usage;
}

function extractErrorMessage(event: Record<string, unknown>): string | undefined {
  const direct = firstString(
    event.message,
    event.error,
    event.reason,
    event.detail,
  );
  if (direct) {
    return direct;
  }

  if (isRecord(event.error)) {
    return firstString(event.error.message, event.error.detail, event.error.code);
  }

  return undefined;
}

function determineLaunchKind(executable: string): LaunchDescriptor['kind'] {
  const extension = path.extname(executable).toLowerCase();
  return extension === '.cmd' || extension === '.bat' ? 'cmd-wrapper' : 'native';
}

async function defaultRunVersionProbe(launch: LaunchDescriptor, timeoutMs: number): Promise<VersionProbeOutput> {
  if (launch.kind === 'native') {
    const result = await execFileAsync(launch.executable, launch.argv, {
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 256 * 1024,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr ?? '',
    };
  }

  const commandProcessor = process.env.COMSPEC ?? 'cmd.exe';
  const result = await execFileAsync(
    commandProcessor,
    ['/d', '/s', '/c', buildCmdWrapperCommandLine(launch)],
    {
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 256 * 1024,
      windowsVerbatimArguments: true,
    },
  );
  return {
    stdout: result.stdout,
    stderr: result.stderr ?? '',
  };
}

function sanitizeVersionOutput(output: string): string | undefined {
  const firstLine = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) {
    return undefined;
  }

  return firstLine.slice(0, 200);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = readString(value);
    if (text) {
      return text;
    }
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}

class BoundedTextTail {
  private chunks: Buffer[] = [];
  private totalBytes = 0;
  private readonly maxBytes: number;

  constructor(maxBytes: number) {
    this.maxBytes = maxBytes;
  }

  replace(text: string): void {
    this.chunks = [];
    this.totalBytes = 0;
    this.append(text);
  }

  private append(text: string): void {
    if (text.length === 0) {
      return;
    }
    const chunk = Buffer.from(text, 'utf8');
    this.chunks.push(chunk);
    this.totalBytes += chunk.length;

    while (this.totalBytes > this.maxBytes && this.chunks.length > 0) {
      const first = this.chunks[0];
      const overflow = this.totalBytes - this.maxBytes;
      if (first.length <= overflow) {
        this.totalBytes -= first.length;
        this.chunks.shift();
      } else {
        this.chunks[0] = first.subarray(overflow);
        this.totalBytes -= overflow;
      }
    }
  }

  toString(): string {
    if (this.chunks.length === 0) {
      return '';
    }
    return Buffer.concat(this.chunks).toString('utf8');
  }
}
