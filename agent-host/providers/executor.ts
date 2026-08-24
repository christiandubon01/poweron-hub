import { type ProviderDiscoveryRecord } from '../types.ts';
import { type OrchestrationStore } from '../lib/store.ts';
import { OrchestrationError, type AttemptRecord, type AttemptStatus, type JsonValue, type OrchestrationEventRecord, type RunRecord, type TaskRecord } from '../lib/orchestrationTypes.ts';
import type { ProviderId, ExecutionResult, ExecutionRequest, PermissionProfile, ProviderAdapter, ProviderErrorCode } from './types.ts';
import { ClaudeCompatibleProviderAdapter } from './claude.ts';
import { CodexProviderAdapter } from './codex.ts';

const DEFAULT_EXECUTION_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 15_000;
const STRING_FIELD_LIMIT = 512;

export interface AttemptExecutionInput {
  runId: string;
  taskId: string;
  attemptId: string;
  provider: ProviderId;
  harness?: string;
  prompt: string;
  requestedModel?: string;
  reasoningEffort?: string;
  permissionProfile: PermissionProfile;
  timeoutMs?: number;
  workingDirectory: string;
  hostInstanceId: string;
}

export interface AttemptExecutionOutcome {
  executionId: string;
  attempt: AttemptRecord;
  result: ExecutionResult;
  startedEvent: OrchestrationEventRecord;
  terminalEvent: OrchestrationEventRecord;
  terminalAttemptStatus: AttemptStatus;
}

export type AttemptExecutorErrorCode =
  | 'EXECUTOR_SHUTTING_DOWN'
  | 'ATTEMPT_ALREADY_ACTIVE'
  | 'EVENT_PERSIST_FAILED'
  | 'ATTEMPT_TRANSITION_FAILED';

export class AttemptExecutorError extends Error {
  readonly code: AttemptExecutorErrorCode;
  readonly cause?: unknown;

  constructor(code: AttemptExecutorErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'AttemptExecutorError';
    this.code = code;
    this.cause = options?.cause;
  }
}

interface AttemptContext {
  run: RunRecord;
  task: TaskRecord;
  attempt: AttemptRecord;
}

interface ActiveExecutionEntry {
  cancel(): void;
  completion: Promise<void>;
}

export interface AttemptExecutorDependencies {
  store: OrchestrationStore;
  registry: ReadonlyMap<ProviderId, ProviderAdapter>;
  now?: (() => Date) | undefined;
  idGenerator?: (() => string) | undefined;
  defaultTimeoutMs?: number | undefined;
  shutdownTimeoutMs?: number | undefined;
}

export interface AttemptExecutorShutdownResult {
  timedOut: boolean;
  remainingActiveAttempts: number;
}

export class AttemptExecutor {
  private readonly store: OrchestrationStore;
  private readonly registry: ReadonlyMap<ProviderId, ProviderAdapter>;
  private readonly now: () => Date;
  private readonly idGenerator: () => string;
  private readonly defaultTimeoutMs: number;
  private readonly shutdownTimeoutMs: number;
  private readonly activeExecutions = new Map<string, ActiveExecutionEntry>();
  private acceptingExecutions = true;
  private shutdownPromise: Promise<AttemptExecutorShutdownResult> | null = null;

  constructor(dependencies: AttemptExecutorDependencies) {
    this.store = dependencies.store;
    this.registry = dependencies.registry;
    this.now = dependencies.now ?? (() => new Date());
    this.idGenerator = dependencies.idGenerator ?? globalThis.crypto.randomUUID.bind(globalThis.crypto);
    this.defaultTimeoutMs = dependencies.defaultTimeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS;
    this.shutdownTimeoutMs = dependencies.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  }

  execute(input: AttemptExecutionInput): Promise<AttemptExecutionOutcome> {
    if (!this.acceptingExecutions) {
      throw new AttemptExecutorError('EXECUTOR_SHUTTING_DOWN', 'Attempt executor is shutting down.');
    }

    const context = validateAttemptExecution(this.store, input);
    if (this.activeExecutions.has(input.attemptId)) {
      throw new AttemptExecutorError(
        'ATTEMPT_ALREADY_ACTIVE',
        `Attempt ${input.attemptId} is already executing on this host.`,
      );
    }

    const activeEntry: ActiveExecutionEntry = {
      cancel: () => undefined,
      completion: Promise.resolve(),
    };
    this.activeExecutions.set(input.attemptId, activeEntry);

    const executionPromise = this.runExecution(input, context, activeEntry);
    activeEntry.completion = executionPromise.then(() => undefined, () => undefined);
    return executionPromise;
  }

  cancel(attemptId: string): boolean {
    const active = this.activeExecutions.get(attemptId);
    if (!active) {
      return false;
    }
    active.cancel();
    return true;
  }

  async shutdown(timeoutMs: number = this.shutdownTimeoutMs): Promise<AttemptExecutorShutdownResult> {
    if (this.shutdownPromise) {
      return await this.shutdownPromise;
    }

    this.acceptingExecutions = false;
    const entries = [...this.activeExecutions.values()];
    for (const entry of entries) {
      entry.cancel();
    }

    this.shutdownPromise = (async () => {
      if (entries.length === 0) {
        return {
          timedOut: false,
          remainingActiveAttempts: 0,
        };
      }

      const completed = await Promise.race([
        Promise.allSettled(entries.map((entry) => entry.completion)).then(() => true),
        waitForTimeout(timeoutMs).then(() => false),
      ]);

      return {
        timedOut: !completed,
        remainingActiveAttempts: this.activeExecutions.size,
      };
    })();

    return await this.shutdownPromise;
  }

  getActiveAttemptIds(): string[] {
    return [...this.activeExecutions.keys()].sort();
  }

  private async runExecution(
    input: AttemptExecutionInput,
    context: AttemptContext,
    activeEntry: ActiveExecutionEntry,
  ): Promise<AttemptExecutionOutcome> {
    const startedAt = this.now();

    try {
      const startedEvent = this.persistStartedEvent(input);
      const adapter = this.registry.get(input.provider);

      if (adapter) {
        activeEntry.cancel = () => adapter.cancel(input.attemptId);
      }

      const request = buildExecutionRequest(input, this.defaultTimeoutMs);
      const result = await executeViaAdapter(adapter, request, input);
      const terminalEventType = mapTerminalEventType(result);
      const terminalAttemptStatus = mapAttemptStatus(result);
      const durationMs = Math.max(0, this.now().getTime() - startedAt.getTime());
      const terminalEvent = this.persistTerminalEvent(input, result, terminalEventType, durationMs);
      const attempt = this.transitionAttemptTerminal(context.attempt.attemptId, terminalAttemptStatus);

      return {
        executionId: request.executionId,
        attempt,
        result,
        startedEvent,
        terminalEvent,
        terminalAttemptStatus,
      };
    } finally {
      this.activeExecutions.delete(input.attemptId);
    }
  }

  private persistStartedEvent(input: AttemptExecutionInput): OrchestrationEventRecord {
    try {
      return this.store.appendEvent({
        eventId: this.idGenerator(),
        runId: input.runId,
        taskId: input.taskId,
        attemptId: input.attemptId,
        type: 'execution.started',
        payload: buildStartedEventPayload(input, this.defaultTimeoutMs),
      });
    } catch (error) {
      throw new AttemptExecutorError(
        'EVENT_PERSIST_FAILED',
        `Failed to persist execution.started for attempt ${input.attemptId}.`,
        { cause: error },
      );
    }
  }

  private persistTerminalEvent(
    input: AttemptExecutionInput,
    result: ExecutionResult,
    terminalEventType: string,
    durationMs: number,
  ): OrchestrationEventRecord {
    try {
      return this.store.appendEvent({
        eventId: this.idGenerator(),
        runId: input.runId,
        taskId: input.taskId,
        attemptId: input.attemptId,
        type: terminalEventType,
        payload: buildTerminalEventPayload(input, result, durationMs),
      });
    } catch (error) {
      throw new AttemptExecutorError(
        'EVENT_PERSIST_FAILED',
        `Failed to persist ${terminalEventType} for attempt ${input.attemptId}.`,
        { cause: error },
      );
    }
  }

  private transitionAttemptTerminal(attemptId: string, status: AttemptStatus): AttemptRecord {
    try {
      return this.store.transitionAttempt(attemptId, status);
    } catch (error) {
      throw new AttemptExecutorError(
        'ATTEMPT_TRANSITION_FAILED',
        `Failed to transition attempt ${attemptId} to ${status}.`,
        { cause: error },
      );
    }
  }
}

export function recoverInterruptedAttempts(store: OrchestrationStore, liveHostInstanceId: string): AttemptRecord[] {
  return store.findInterruptedAttempts(liveHostInstanceId).map((attempt) => {
    return store.transitionAttempt(attempt.attemptId, 'interrupted');
  });
}

export function createProviderRegistry(records: readonly ProviderDiscoveryRecord[]): Map<ProviderId, ProviderAdapter> {
  const registry = new Map<ProviderId, ProviderAdapter>();

  for (const record of records) {
    if (!record.resolvedPath) {
      continue;
    }

    if (record.toolId === 'claude-code') {
      registry.set('claude', new ClaudeCompatibleProviderAdapter({
        providerId: 'claude',
        executable: record.resolvedPath,
      }));
      continue;
    }

    if (record.toolId === 'codex-cli') {
      registry.set('codex', new CodexProviderAdapter({
        providerId: 'codex',
        executable: record.resolvedPath,
      }));
      continue;
    }

    if (record.toolId === 'ollama-cli') {
      registry.set('ollama', new ClaudeCompatibleProviderAdapter({
        providerId: 'ollama',
        executable: record.resolvedPath,
        harness: 'claude',
      }));
    }
  }

  return registry;
}

function validateAttemptExecution(store: OrchestrationStore, input: AttemptExecutionInput): AttemptContext {
  const run = store.getRun(input.runId);
  if (!run) {
    throw new OrchestrationError('NOT_FOUND', `Run ${input.runId} was not found.`);
  }

  const task = store.getTask(input.taskId);
  if (!task) {
    throw new OrchestrationError('NOT_FOUND', `Task ${input.taskId} was not found.`);
  }

  const attempt = store.getAttempt(input.attemptId);
  if (!attempt) {
    throw new OrchestrationError('NOT_FOUND', `Attempt ${input.attemptId} was not found.`);
  }

  if (task.runId !== run.runId) {
    throw new OrchestrationError(
      'RELATIONSHIP_MISMATCH',
      `Task ${input.taskId} does not belong to run ${input.runId}.`,
    );
  }

  if (attempt.taskId !== task.taskId) {
    throw new OrchestrationError(
      'RELATIONSHIP_MISMATCH',
      `Attempt ${input.attemptId} does not belong to task ${input.taskId}.`,
    );
  }

  if (attempt.hostInstanceId !== input.hostInstanceId) {
    throw new OrchestrationError(
      'INVALID_TRANSITION',
      `Attempt ${input.attemptId} is owned by host instance ${attempt.hostInstanceId}, not ${input.hostInstanceId}.`,
    );
  }

  if (task.status !== 'running') {
    throw new OrchestrationError(
      'INVALID_TRANSITION',
      `Task ${input.taskId} must be running before execution, found ${task.status}.`,
    );
  }

  if (attempt.status !== 'running') {
    throw new OrchestrationError(
      'INVALID_TRANSITION',
      `Attempt ${input.attemptId} is terminal and cannot be executed again.`,
    );
  }

  return { run, task, attempt };
}

function buildExecutionRequest(input: AttemptExecutionInput, defaultTimeoutMs: number): ExecutionRequest {
  return {
    executionId: input.attemptId,
    attemptId: input.attemptId,
    taskId: input.taskId,
    runId: input.runId,
    workingDirectory: input.workingDirectory,
    prompt: input.prompt,
    requestedModel: input.requestedModel,
    reasoningEffort: input.reasoningEffort,
    permissionProfile: input.permissionProfile,
    timeoutMs: input.timeoutMs ?? defaultTimeoutMs,
  };
}

async function executeViaAdapter(
  adapter: ProviderAdapter | undefined,
  request: ExecutionRequest,
  input: AttemptExecutionInput,
): Promise<ExecutionResult> {
  if (!adapter) {
    return buildProviderUnavailableResult(
      request,
      `Provider ${input.provider} is not registered on this host.`,
      'PROVIDER_UNAVAILABLE',
    );
  }

  try {
    return await adapter.execute(request);
  } catch (error) {
    return buildProviderUnavailableResult(
      request,
      sanitizeString(error instanceof Error ? error.message : String(error), STRING_FIELD_LIMIT),
      'PROVIDER_ERROR',
    );
  }
}

function mapTerminalEventType(result: ExecutionResult): 'execution.completed' | 'execution.failed' | 'execution.timed_out' | 'execution.cancelled' {
  if (result.provider.success) {
    return 'execution.completed';
  }
  if (result.process.cancelled || result.provider.errorCode === 'EXECUTION_CANCELLED') {
    return 'execution.cancelled';
  }
  if (result.process.timedOut || result.provider.errorCode === 'EXECUTION_TIMEOUT') {
    return 'execution.timed_out';
  }
  return 'execution.failed';
}

function mapAttemptStatus(result: ExecutionResult): AttemptStatus {
  if (result.provider.success) {
    return 'passed';
  }
  if (result.process.cancelled || result.provider.errorCode === 'EXECUTION_CANCELLED') {
    return 'cancelled';
  }
  return 'failed';
}

function buildStartedEventPayload(input: AttemptExecutionInput, defaultTimeoutMs: number): JsonValue {
  return compactJsonObject({
    executionId: input.attemptId,
    provider: input.provider,
    harness: sanitizeOptional(input.harness, 128),
    requestedModel: sanitizeOptional(input.requestedModel, 256),
    reasoningEffort: sanitizeOptional(input.reasoningEffort, 128),
    permissionProfile: input.permissionProfile,
    timeoutMs: input.timeoutMs ?? defaultTimeoutMs,
  });
}

function buildTerminalEventPayload(input: AttemptExecutionInput, result: ExecutionResult, durationMs: number): JsonValue {
  return compactJsonObject({
    executionId: result.executionId,
    provider: input.provider,
    harness: sanitizeOptional(input.harness, 128),
    requestedModel: sanitizeOptional(result.model.requestedModel, 256),
    reportedModel: sanitizeOptional(result.model.reportedModel, 256),
    reportedModelSource: result.model.reportedModelSource,
    providerTerminalState: result.provider.terminalState,
    providerSuccess: result.provider.success,
    errorCode: result.provider.errorCode,
    errorMessage: sanitizeOptional(result.provider.errorMessage, STRING_FIELD_LIMIT),
    process: compactJsonObject({
      exitCode: result.process.exitCode,
      signal: sanitizeOptional(result.process.signal, 128),
      timedOut: result.process.timedOut,
      cancelled: result.process.cancelled,
    }),
    usage: compactJsonObject({
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cachedInputTokens: result.usage.cachedInputTokens,
      reasoningTokens: result.usage.reasoningTokens,
      totalTokens: result.usage.totalTokens,
      source: result.usage.source,
    }),
    sessionId: sanitizeOptional(result.session.sessionId, 256),
    durationMs,
  });
}

function buildProviderUnavailableResult(
  request: ExecutionRequest,
  errorMessage: string,
  errorCode: ProviderErrorCode,
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

function sanitizeOptional(value: string | null | undefined, maxChars: number): string | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  return sanitizeString(value, maxChars);
}

function sanitizeString(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return value.slice(0, maxChars);
}

function compactJsonObject(value: Record<string, JsonValue | undefined>): JsonValue {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as JsonValue;
}

function waitForTimeout(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}
