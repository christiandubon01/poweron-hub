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
const AUTH_OR_UNAVAILABLE_PATTERN =
  /\b(auth|authentication|authenticate|authenticated|login|reauth|expired|unauthori[sz]ed|forbidden|unavailable|not available)\b/iu;

export type ClaudePermissionMode = 'plan' | 'acceptEdits';

export type ClaudeLaunchTarget =
  | {
      providerId: 'claude';
      executable: string;
    }
  | {
      providerId: 'ollama';
      executable: string;
      harness: 'claude';
    };

export interface VersionProbeOutput {
  stdout: string;
  stderr: string;
}

export interface ClaudeAdapterDependencies {
  runner?: Pick<ProcessRunner, 'run'>;
  runVersionProbe?: (launch: LaunchDescriptor, timeoutMs: number) => Promise<VersionProbeOutput>;
}

export class ClaudeLaunchConfigurationError extends Error {
  readonly errorCode: ProviderErrorCode;

  constructor(message: string, errorCode: ProviderErrorCode = 'PROVIDER_ERROR') {
    super(message);
    this.name = 'ClaudeLaunchConfigurationError';
    this.errorCode = errorCode;
  }
}

interface ClaudeUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  source: 'protocol-message' | 'none';
}

interface ClaudeTerminalResult {
  isError: boolean | null;
  subtype?: string;
  text?: string;
  sessionId?: string;
  reportedModel?: string;
  usage?: ClaudeUsage;
}

interface ClaudeStreamState {
  readonly decoder: JsonlDecoder;
  readonly assistantText: BoundedTextTail;
  terminalTextFallback?: string;
  terminalResult?: ClaudeTerminalResult;
  sessionId?: string;
  reportedModel?: string;
  protocolIssue?: string;
  usage: ClaudeUsage;
}

export class ClaudeCompatibleProviderAdapter implements ProviderAdapter {
  readonly id: ClaudeLaunchTarget['providerId'];

  private readonly target: ClaudeLaunchTarget;
  private readonly runner: Pick<ProcessRunner, 'run'>;
  private readonly runVersionProbe: (launch: LaunchDescriptor, timeoutMs: number) => Promise<VersionProbeOutput>;
  private readonly activeExecutions = new Map<string, ProcessHandle>();

  constructor(target: ClaudeLaunchTarget, dependencies: ClaudeAdapterDependencies = {}) {
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
      launch = buildClaudeLaunchDescriptor(this.target, request);
    } catch (error) {
      const failure =
        error instanceof ClaudeLaunchConfigurationError
          ? error
          : new ClaudeLaunchConfigurationError(error instanceof Error ? error.message : String(error));
      return buildImmediateFailureResult(request, failure.errorCode, failure.message);
    }

    const streamState = createStreamState();
    const handle = this.runner.run({
      executionId: request.executionId,
      launch,
      workingDirectory: request.workingDirectory,
      allowedWorkingDirectory: request.workingDirectory,
      prompt: request.prompt,
      environmentProfile: 'claude',
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

export function mapPermissionProfileToClaudeMode(profile: PermissionProfile): ClaudePermissionMode {
  if (profile === 'task-implementer') {
    return 'acceptEdits';
  }
  return 'plan';
}

export function buildClaudeLaunchDescriptor(target: ClaudeLaunchTarget, request: ExecutionRequest): LaunchDescriptor {
  const permissionMode = mapPermissionProfileToClaudeMode(request.permissionProfile);
  const claudeArgs = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', permissionMode];
  claudeArgs.push('--disallowedTools', buildClaudeDisallowedTools(target));

  if (target.providerId === 'claude') {
    return {
      kind: determineLaunchKind(target.executable),
      executable: target.executable,
      argv: claudeArgs,
    };
  }

  const requestedModel = request.requestedModel;
  if (typeof requestedModel !== 'string' || requestedModel.trim().length === 0) {
    throw new ClaudeLaunchConfigurationError(
      'requestedModel is required for the Ollama Claude harness.',
      'MODEL_UNAVAILABLE',
    );
  }

  return {
    kind: determineLaunchKind(target.executable),
    executable: target.executable,
    argv: ['launch', 'claude', '--model', requestedModel, '--yes', '--', ...claudeArgs],
  };
}

function buildClaudeDisallowedTools(target: ClaudeLaunchTarget): string {
  const tools = ['WebFetch', 'WebSearch'];
  // Claude's Bash matcher grammar uses parentheses, which cannot cross the
  // shared .cmd argument boundary safely. Native launches can use it directly.
  if (determineLaunchKind(target.executable) === 'native') {
    tools.push('Bash(git push *)', 'Bash(git reset --hard *)', 'Bash(git clean *)', 'Bash(netlify *)', 'Bash(supabase *)');
  }
  return tools.join(',');
}

function createStreamState(): ClaudeStreamState {
  return {
    decoder: new JsonlDecoder({ maxLineBytes: STREAM_MAX_LINE_BYTES }),
    assistantText: new BoundedTextTail(FINAL_TEXT_LIMIT_BYTES),
    usage: { source: 'none' },
  };
}

function handleJsonlEvent(state: ClaudeStreamState, event: JsonlEvent): void {
  if (event.type !== 'json' || !isRecord(event.value)) {
    return;
  }

  const eventType = readString(event.value.type);
  const subtype = readString(event.value.subtype);

  if (eventType === 'system/init' || (eventType === 'system' && subtype === 'init')) {
    recordSessionId(state, extractSessionId(event.value));
    recordReportedModel(state, extractReportedModel(event.value));
    const usage = extractUsage(event.value);
    if (usage.source === 'protocol-message') {
      state.usage = usage;
    }
    return;
  }

  if (eventType === 'assistant') {
    const text = extractAssistantText(event.value);
    if (text) {
      state.assistantText.append(text);
    }
    return;
  }

  if (eventType === 'result') {
    const terminal: ClaudeTerminalResult = {
      isError: readBoolean(event.value.is_error) ?? readBoolean(event.value.isError) ?? null,
      subtype,
      text: extractTerminalText(event.value),
      sessionId: extractSessionId(event.value),
      reportedModel: extractReportedModel(event.value),
      usage: extractUsage(event.value),
    };
    recordSessionId(state, terminal.sessionId);
    recordReportedModel(state, terminal.reportedModel);
    if (terminal.usage?.source === 'protocol-message') {
      state.usage = terminal.usage;
    }
    if (!state.terminalTextFallback && terminal.text) {
      state.terminalTextFallback = terminal.text;
    }
    state.terminalResult = terminal;
  }
}

function buildExecutionResult(
  request: ExecutionRequest,
  processResult: ProcessExecutionResult,
  state: ClaudeStreamState,
): ExecutionResult {
  const diagnostics = buildDiagnostics(processResult);
  const terminal = state.terminalResult;
  const finalText = state.assistantText.toString() || state.terminalTextFallback;

  let provider = mapProcessFailure(processResult);
  if (state.protocolIssue) {
    provider = {
      terminalState: 'failed',
      success: false,
      errorCode: 'PROTOCOL_ERROR',
      errorMessage: `Claude-compatible protocol inconsistency: ${state.protocolIssue}`,
    };
  } else if (terminal) {
    if (terminal.isError === false) {
      provider = {
        terminalState: 'completed',
        success: true,
      };
    } else if (terminal.isError === true) {
      const errorCode = classifyTerminalFailure(terminal);
      provider = {
        terminalState: 'failed',
        success: false,
        errorCode,
        errorMessage: terminal.text ?? `Claude-compatible provider returned an error result${terminal.subtype ? ` (${terminal.subtype})` : ''}.`,
      };
    } else {
      provider = {
        terminalState: 'failed',
        success: false,
        errorCode: 'PROTOCOL_ERROR',
        errorMessage: 'Claude-compatible terminal result was missing is_error.',
      };
    }
  }

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
      reportedModel: state.reportedModel ?? null,
      reportedModelSource: state.reportedModel ? 'protocol-message' : 'none',
    },
    usage: state.usage,
    session: state.sessionId ? { sessionId: state.sessionId } : {},
    output: finalText ? { finalText } : {},
    diagnostics,
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
        errorMessage: 'Provider process timed out before a terminal result arrived.',
      };
    case 'cancelled':
      return {
        terminalState: 'failed',
        success: false,
        errorCode: 'EXECUTION_CANCELLED',
        errorMessage: 'Provider execution was cancelled before a terminal result arrived.',
      };
    case 'output-limit':
      return {
        terminalState: 'failed',
        success: false,
        errorCode: 'OUTPUT_LIMIT_EXCEEDED',
        errorMessage: 'Provider output exceeded the configured safety limit before a terminal result arrived.',
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
        errorMessage: 'Provider process exited without a terminal Claude-compatible result event.',
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

function recordSessionId(state: ClaudeStreamState, sessionId: string | undefined): void {
  if (!sessionId) {
    return;
  }
  if (state.sessionId && state.sessionId !== sessionId) {
    state.protocolIssue = `conflicting session_id values: ${state.sessionId} vs ${sessionId}`;
    return;
  }
  state.sessionId = sessionId;
}

function recordReportedModel(state: ClaudeStreamState, reportedModel: string | undefined): void {
  if (!reportedModel) {
    return;
  }
  if (state.reportedModel && state.reportedModel !== reportedModel) {
    state.protocolIssue = `conflicting reported model values: ${state.reportedModel} vs ${reportedModel}`;
    return;
  }
  state.reportedModel = reportedModel;
}

function classifyTerminalFailure(terminal: ClaudeTerminalResult): ProviderErrorCode {
  const text = `${terminal.subtype ?? ''}\n${terminal.text ?? ''}`;
  if (AUTH_OR_UNAVAILABLE_PATTERN.test(text)) {
    return 'PROVIDER_UNAVAILABLE';
  }
  return 'PROVIDER_ERROR';
}

function extractAssistantText(event: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  collectTextParts(event.message, parts);
  collectTextParts(event.delta, parts);
  collectTextParts(event.content, parts);
  collectTextParts(event.text, parts);
  const joined = parts.join('');
  return joined.length > 0 ? joined : undefined;
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
    if (type === 'content' || type === 'message_start' || type === 'message_delta') {
      // continue into nested known wrapper records
    } else {
      const nestedDelta = value.delta;
      if (nestedDelta !== undefined) {
        collectTextParts(nestedDelta, parts);
      }
      return;
    }
  }
  const text = readString(value.text);
  if (text) {
    parts.push(text);
  }
  if (value.content !== undefined) {
    collectTextParts(value.content, parts);
  }
  if (value.delta !== undefined) {
    collectTextParts(value.delta, parts);
  }
}

function extractTerminalText(event: Record<string, unknown>): string | undefined {
  return firstString(
    event.result,
    event.error,
    event.message,
    isRecord(event.payload) ? event.payload.result : undefined,
    isRecord(event.payload) ? event.payload.error : undefined,
  );
}

function extractSessionId(event: Record<string, unknown>): string | undefined {
  return firstString(
    event.session_id,
    event.sessionId,
    isRecord(event.payload) ? event.payload.session_id : undefined,
    isRecord(event.payload) ? event.payload.sessionId : undefined,
  );
}

function extractReportedModel(event: Record<string, unknown>): string | undefined {
  return firstString(
    event.model,
    isRecord(event.payload) ? event.payload.model : undefined,
  );
}

function extractUsage(event: Record<string, unknown>): ClaudeUsage {
  const usageSource = isRecord(event.usage)
    ? event.usage
    : isRecord(event.payload) && isRecord(event.payload.usage)
      ? event.payload.usage
      : undefined;

  if (!usageSource) {
    return { source: 'none' };
  }

  const inputTokens = firstNumber(usageSource.input_tokens, usageSource.inputTokens, usageSource.input);
  const outputTokens = firstNumber(usageSource.output_tokens, usageSource.outputTokens, usageSource.output);
  const cacheReadTokens = firstNumber(
    usageSource.cache_read_input_tokens,
    usageSource.cacheReadInputTokens,
    usageSource.cache_read,
    usageSource.cacheRead,
  );
  const cacheCreationTokens = firstNumber(
    usageSource.cache_creation_input_tokens,
    usageSource.cacheCreationInputTokens,
    usageSource.cache_creation,
    usageSource.cacheCreation,
  );
  const reasoningTokens = firstNumber(
    usageSource.reasoning_tokens,
    usageSource.reasoningTokens,
    usageSource.thinking_tokens,
    usageSource.thinkingTokens,
    usageSource.thinking,
  );
  const totalTokens = firstNumber(usageSource.total_tokens, usageSource.totalTokens, usageSource.total);
  const cachedInputTokens =
    cacheReadTokens === undefined && cacheCreationTokens === undefined
      ? undefined
      : (cacheReadTokens ?? 0) + (cacheCreationTokens ?? 0);

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    cachedInputTokens === undefined &&
    reasoningTokens === undefined &&
    totalTokens === undefined
  ) {
    return { source: 'none' };
  }

  const usage: ClaudeUsage = {
    source: 'protocol-message',
  };
  if (inputTokens !== undefined) {
    usage.inputTokens = inputTokens;
  }
  if (outputTokens !== undefined) {
    usage.outputTokens = outputTokens;
  }
  if (cachedInputTokens !== undefined) {
    usage.cachedInputTokens = cachedInputTokens;
  }
  if (reasoningTokens !== undefined) {
    usage.reasoningTokens = reasoningTokens;
  }
  if (totalTokens !== undefined) {
    usage.totalTokens = totalTokens;
  }
  return usage;
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

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const num = readNumber(value);
    if (num !== undefined) {
      return num;
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

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
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

  append(text: string): void {
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
