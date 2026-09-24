import { type ProviderDiscoveryRecord } from '../types.ts';
import { type OrchestrationStore } from '../lib/store.ts';
import { OrchestrationError, type AttemptRecord, type AttemptStatus, type JsonValue, type OrchestrationEventRecord, type RunRecord, type TaskRecord } from '../lib/orchestrationTypes.ts';
import type { ProviderId, ExecutionResult, ExecutionRequest, PermissionProfile, ProviderAdapter, ProviderErrorCode } from './types.ts';
import { ClaudeCompatibleProviderAdapter } from './claude.ts';
import { CodexProviderAdapter } from './codex.ts';
import {
  buildPolicyBaselineEventPayload,
  buildPolicyEvaluationEventPayload,
  createAttemptPolicyController,
  type AttemptPolicyController,
} from '../policy/policy.ts';
import type { PolicyAdjudication, PolicyBaselineCapture } from '../policy/types.ts';
import { adjudicateAttemptWorkspace, createWorkspacePolicyBaseline, materializeAttemptWorkspace, materializeVerifierWorkspace, resolveImplementerCandidateWorkspace, type AttemptWorkspace } from '../workspace.ts';

const DEFAULT_EXECUTION_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 15_000;
/**
 * Executor-owned hard-timeout grace (ms). The provider adapter/ProcessRunner
 * enforce their own startup/idle/overall timers, but the orchestration boundary
 * must NOT trust that layer to always settle: a Windows grandchild that inherited
 * a stdout handle can suppress the child `close` event, a stream/decoder promise
 * can stay open, or a future adapter may lack robust timers. Any of those would
 * otherwise leave `await adapter.execute(...)` pending forever, so the Attempt
 * stays `running` and the Supervisor never regains control.
 *
 * This grace is added to the request timeout to form an INDEPENDENT hard upper
 * bound on provider execution. It must exceed the runner's own cancel-grace plus
 * post-kill settlement window (see processRunner.ts) so that in the normal case a
 * clean runner-level timeout result still flows through first and this backstop
 * only fires on a genuine hang.
 */
const DEFAULT_EXECUTION_HARD_GRACE_MS = 30_000;
const STRING_FIELD_LIMIT = 512;
export const DURABLE_STDERR_TAIL_MAX_CHARS = 4096;
/**
 * Durable evidence event appended when execution finalization fails AFTER the
 * provider phase (policy adjudication, policy event persistence, terminal
 * event persistence, or the Attempt terminal transition wrapper). Its payload
 * is small by construction so the evidence write itself can never hit the store
 * payload limit.
 */
export const EXECUTION_PERSISTENCE_FAILED_EVENT = 'execution.persistence.failed';

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
  startedEvent: OrchestrationEventRecord | null;
  /**
   * The terminal execution event record when the normal path persisted one. On
   * the fail-closed path this is the best durable evidence that exists: the
   * terminal event, else the `execution.persistence.failed` event — null only
   * when no event write succeeded at all.
   */
  terminalEvent: OrchestrationEventRecord | null;
  terminalAttemptStatus: AttemptStatus;
  policy: PolicyAdjudication;
}

export type AttemptExecutorErrorCode =
  | 'EXECUTOR_SHUTTING_DOWN'
  | 'ATTEMPT_ALREADY_ACTIVE'
  | 'EVENT_PERSIST_FAILED'
  | 'ATTEMPT_TRANSITION_FAILED'
  | 'POLICY_CAPTURE_FAILED'
  | 'POLICY_ADJUDICATION_FAILED';

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
  setProviderCancel(cancel: () => void): void;
  isCancellationRequested(): boolean;
  completion: Promise<void>;
}

export interface AttemptExecutorDependencies {
  store: OrchestrationStore;
  registry: ReadonlyMap<ProviderId, ProviderAdapter>;
  now?: (() => Date) | undefined;
  idGenerator?: (() => string) | undefined;
  defaultTimeoutMs?: number | undefined;
  /**
   * Extra grace added to the request timeout to form the executor-owned hard
   * upper bound on provider execution. Test seam only; production uses
   * {@link DEFAULT_EXECUTION_HARD_GRACE_MS}.
   */
  executionHardGraceMs?: number | undefined;
  shutdownTimeoutMs?: number | undefined;
  policyController?: AttemptPolicyController | undefined;
  workspaceConfig?: { canonicalRepoPath: string; workspaceRoot: string; repoKey: string } | undefined;
  workspacePreparer?: ((options: Parameters<typeof materializeAttemptWorkspace>[0]) => Promise<AttemptWorkspace>) | undefined;
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
  private readonly executionHardGraceMs: number;
  private readonly shutdownTimeoutMs: number;
  private readonly policyController: AttemptPolicyController;
  private readonly workspaceConfig: AttemptExecutorDependencies['workspaceConfig'];
  private readonly workspacePreparer: NonNullable<AttemptExecutorDependencies['workspacePreparer']>;
  private readonly activeExecutions = new Map<string, ActiveExecutionEntry>();
  private acceptingExecutions = true;
  private shutdownPromise: Promise<AttemptExecutorShutdownResult> | null = null;

  constructor(dependencies: AttemptExecutorDependencies) {
    this.store = dependencies.store;
    this.registry = dependencies.registry;
    this.now = dependencies.now ?? (() => new Date());
    this.idGenerator = dependencies.idGenerator ?? globalThis.crypto.randomUUID.bind(globalThis.crypto);
    this.defaultTimeoutMs = dependencies.defaultTimeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS;
    this.executionHardGraceMs = dependencies.executionHardGraceMs ?? DEFAULT_EXECUTION_HARD_GRACE_MS;
    this.shutdownTimeoutMs = dependencies.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    this.policyController = dependencies.policyController ?? createAttemptPolicyController();
    this.workspaceConfig = dependencies.workspaceConfig;
    this.workspacePreparer = dependencies.workspacePreparer ?? materializeAttemptWorkspace;
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

    const activeEntry = createActiveExecutionEntry();
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

    // Hoisted so the fail-closed catch below can preserve as much durable
    // evidence as exists when a downstream step throws.
    let request: ExecutionRequest | null = null;
    let startedEvent: OrchestrationEventRecord | null = null;
    let terminalEvent: OrchestrationEventRecord | null = null;
    let providerResult: ExecutionResult | undefined;
    let policyBaseline: PolicyBaselineCapture | undefined;

    try {
      let workspace: AttemptWorkspace | undefined;
      let executionInput = input;
      if (input.permissionProfile === 'task-implementer') {
        if (!this.workspaceConfig) {
          return await this.finishWorkspacePreparationFailure(input, context, startedAt, 'workspace-unconfigured');
        }
        this.persistWorkspaceEvent(input, 'workspace.preparation.started', { workspaceId: workspaceIdentity(this.workspaceConfig.repoKey, input) });
        try {
          workspace = await this.workspacePreparer({
            canonicalRepoPath: this.workspaceConfig.canonicalRepoPath,
            workspaceRoot: this.workspaceConfig.workspaceRoot,
            identity: { repoKey: this.workspaceConfig.repoKey, runId: input.runId, attemptId: input.attemptId },
          });
          executionInput = { ...input, workingDirectory: workspace.workspacePath };
          policyBaseline = createWorkspacePolicyBaseline({ workspace, runId: input.runId, task: context.task, attemptId: input.attemptId, permissionProfile: input.permissionProfile });
          this.persistWorkspaceEvent(input, 'workspace.prepared', { workspaceId: workspace.workspaceId, baselineHeadSha: workspace.baselineHeadSha, materializationMode: workspace.materializationMode, workspaceState: 'ready' });
        } catch {
          return await this.finishWorkspacePreparationFailure(input, context, startedAt, workspaceIdentity(this.workspaceConfig.repoKey, input));
        }
      } else if (input.permissionProfile === 'verifier') {
        if (!this.workspaceConfig) {
          return await this.finishWorkspacePreparationFailure(input, context, startedAt, 'workspace-unconfigured');
        }
        const workspaceId = workspaceIdentity(this.workspaceConfig.repoKey, input);
        this.persistWorkspaceEvent(input, 'workspace.preparation.started', { workspaceId });
        try {
          const candidate = resolveImplementerCandidateWorkspace({
            workspaceRoot: this.workspaceConfig.workspaceRoot,
            repoKey: this.workspaceConfig.repoKey,
            runId: input.runId,
            dependencyTaskIds: this.store.listDependencies(input.runId)
              .filter((dependency) => dependency.taskId === input.taskId)
              .map((dependency) => dependency.dependsOnTaskId),
            events: this.store.listEvents().filter((event) => event.runId === input.runId),
          });
          if (!candidate) {
            return await this.finishWorkspacePreparationFailure(input, context, startedAt, workspaceId);
          }
          workspace = await materializeVerifierWorkspace({
            sourceWorkspacePath: candidate.workspacePath,
            workspaceRoot: this.workspaceConfig.workspaceRoot,
            identity: { repoKey: this.workspaceConfig.repoKey, runId: input.runId, attemptId: input.attemptId },
            baselineHeadSha: candidate.baselineHeadSha,
          });
          executionInput = { ...input, workingDirectory: workspace.workspacePath };
          policyBaseline = createWorkspacePolicyBaseline({ workspace, runId: input.runId, task: context.task, attemptId: input.attemptId, permissionProfile: input.permissionProfile });
          this.persistWorkspaceEvent(input, 'workspace.prepared', {
            workspaceId: workspace.workspaceId,
            baselineHeadSha: workspace.baselineHeadSha,
            materializationMode: workspace.materializationMode,
            sourceAttemptId: candidate.sourceAttemptId,
            readOnly: true,
            workspaceState: 'ready',
          });
        } catch {
          return await this.finishWorkspacePreparationFailure(input, context, startedAt, workspaceId);
        }
      } else {
        policyBaseline = await this.capturePolicyBaseline(input, context);
      }
      this.persistPolicyBaselineEvent(input, policyBaseline);
      request = buildExecutionRequest(executionInput, this.defaultTimeoutMs, workspace?.workspacePath);
      const adapter = this.registry.get(input.provider);

      if (activeEntry.isCancellationRequested()) {
        providerResult = buildCancelledBeforeLaunchResult(request);
      } else {
        startedEvent = this.persistStartedEvent(executionInput);
        if (adapter) {
          activeEntry.setProviderCancel(() => adapter.cancel(input.attemptId));
        }
        providerResult = await this.executeProviderWithHardTimeout(adapter, request, executionInput);
      }

      const terminalEventType = mapTerminalEventType(providerResult);
      const durationMs = Math.max(0, this.now().getTime() - startedAt.getTime());
      terminalEvent = this.persistTerminalEvent(executionInput, providerResult, terminalEventType, durationMs);
      const workspaceAdjudication = workspace
        ? await adjudicateAttemptWorkspace({ workspace, runId: input.runId, task: context.task, attemptId: input.attemptId, permissionProfile: input.permissionProfile })
        : undefined;
      const policy = workspaceAdjudication?.policy ?? await this.adjudicatePolicy(input, policyBaseline);
      this.persistPolicyEvent(input, policy);
      const terminalAttemptStatus = resolveEffectiveAttemptStatus(providerResult, policy);
      if (workspace) {
        this.persistWorkspaceEvent(input, 'workspace.adjudication.completed', { workspaceId: workspace.workspaceId, policyAccepted: policy.accepted, workspaceState: policy.accepted ? 'accepted' : 'rejected' });
        if (
          providerResult.provider.success &&
          terminalAttemptStatus === 'passed' &&
          policy.accepted &&
          workspaceAdjudication?.changeSet &&
          workspaceAdjudication.changeSet.changes.length > 0
        ) {
          this.persistWorkspaceEvent(input, 'workspace.changeset.ready', { workspaceId: workspace.workspaceId, baselineHeadSha: workspace.baselineHeadSha, changeCount: workspaceAdjudication.changeSet.changes.length, workspaceState: 'cleanup-eligible' });
        }
      }
      const attempt = this.transitionAttemptTerminal(context.attempt.attemptId, terminalAttemptStatus);

      return {
        executionId: request.executionId,
        attempt,
        result: providerResult,
        startedEvent,
        terminalEvent,
        terminalAttemptStatus,
        policy,
      };
    } catch (error) {
      // The terminal transition itself is the existing recovery contract's
      // domain: if the store cannot perform it, retrying it here cannot help and
      // the restart-time reconciliation (recoverInterruptedAttempts +
      // resumeResumableRuns) owns the Attempt. No second state machine.
      if (error instanceof AttemptExecutorError && error.code === 'ATTEMPT_TRANSITION_FAILED') {
        throw error;
      }
      return this.finishExecutionAttemptFailure(input, context, request, startedEvent, terminalEvent, providerResult, policyBaseline, error);
    } finally {
      this.activeExecutions.delete(input.attemptId);
    }
  }

  /**
   * Run the provider adapter under an INDEPENDENT executor-owned hard timeout.
   *
   * The adapter/ProcessRunner enforce their own startup/idle/overall timers, but
   * the orchestration boundary must guarantee that provider execution has a hard
   * upper bound regardless of that layer: if `adapter.execute(...)` never settles
   * (a Windows grandchild suppressing `close`, a stream/decoder promise that
   * stays open, or any adapter lacking robust timers), the Attempt would remain
   * `running` forever and the Supervisor would never regain control.
   *
   * When the hard deadline expires this method:
   *   1. terminates the spawned provider process AND its tree through the EXISTING
   *      adapter/runner abstraction (`adapter.cancel` → ProcessRunner
   *      `terminate` → Windows `taskkill /T /F`) — best effort, and
   *   2. resolves with a deterministic timeout {@link ExecutionResult} so the
   *      caller terminalizes the Attempt as a retryable `execution-timeout`.
   *
   * The provider promise's own later settlement (including a post-cancel result)
   * is ignored once the deadline has fired: the timeout classification always
   * wins, which keeps the Supervisor's existing retry policy (timeouts are
   * retryable) intact instead of misclassifying the run as a cancellation.
   */
  private async executeProviderWithHardTimeout(
    adapter: ProviderAdapter | undefined,
    request: ExecutionRequest,
    input: AttemptExecutionInput,
  ): Promise<ExecutionResult> {
    const providerPromise = executeViaAdapter(adapter, request, input);

    // With no adapter, executeViaAdapter resolves immediately (provider
    // unavailable); there is nothing to bound and nothing to terminate.
    if (!adapter) {
      return await providerPromise;
    }

    const hardDeadlineMs = resolveHardDeadlineMs(request.timeoutMs, this.defaultTimeoutMs, this.executionHardGraceMs);

    return await new Promise<ExecutionResult>((resolve) => {
      let settled = false;
      let timer: NodeJS.Timeout | undefined;

      const finish = (result: ExecutionResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
          timer = undefined;
        }
        resolve(result);
      };

      timer = setTimeout(() => {
        try {
          adapter.cancel(request.attemptId);
        } catch {
          // Best-effort process-tree termination; the hard timeout result stands
          // even if the adapter cannot be signalled.
        }
        finish(buildProviderTimeoutResult(request));
      }, hardDeadlineMs);

      providerPromise.then(
        (result) => finish(result),
        (error) =>
          finish(
            buildProviderUnavailableResult(
              request,
              sanitizeString(error instanceof Error ? error.message : String(error), STRING_FIELD_LIMIT),
              'PROVIDER_ERROR',
            ),
          ),
      );
    });
  }

  private async capturePolicyBaseline(input: AttemptExecutionInput, context: AttemptContext): Promise<PolicyBaselineCapture> {
    try {
      return await this.policyController.captureBaseline({
        runId: input.runId,
        task: context.task,
        attemptId: input.attemptId,
        permissionProfile: input.permissionProfile,
        workingDirectory: input.workingDirectory,
      });
    } catch (error) {
      throw new AttemptExecutorError(
        'POLICY_CAPTURE_FAILED',
        `Failed to capture policy baseline for attempt ${input.attemptId}.`,
        { cause: error },
      );
    }
  }

  /**
   * Fail-closed terminalization for a failure the normal path did not already
   * convert into an outcome (workspace preparation has its own fail-closed
   * return). This covers EVERY step between Attempt start and the terminal
   * transition: baseline capture/persistence, the started event, provider
   * execution, policy adjudication, policy event persistence, the terminal
   * event, and the workspace adjudication events.
   *
   * INVARIANT: once AttemptExecutor has accepted an execution it must hand back
   * a TERMINALIZED Attempt. A throw out of execute() aborts supervisorTick
   * before it can reconcile the Task, and the control worker only re-drives
   * Runs at startup, so an un-terminalized `running` Attempt would strand the
   * Run forever.
   *
   * This handler:
   *   - uses the REAL provider result when the provider returned (never
   *     fabricating PASS — a provider success still terminalizes as `failed`
   *     because the outcome policy below is a fail-closed deny);
   *   - preserves bounded durable evidence via one
   *     {@link EXECUTION_PERSISTENCE_FAILED_EVENT} event (best effort — the
   *     Attempt transition is the critical write);
   *   - transitions the Attempt to `failed` through the same store transition
   *     the normal path uses, then RETURNS so supervisorTick regains control
   *     and the existing retry/failure policy stays authoritative. If the store
   *     genuinely cannot perform the transition, that error propagates and the
   *     existing restart recovery contract reconciles — no second state
   *     machine is invented here.
   */
  private finishExecutionAttemptFailure(
    input: AttemptExecutionInput,
    context: AttemptContext,
    request: ExecutionRequest | null,
    startedEvent: OrchestrationEventRecord | null,
    terminalEvent: OrchestrationEventRecord | null,
    providerResult: ExecutionResult | undefined,
    policyBaseline: PolicyBaselineCapture | undefined,
    error: unknown,
  ): AttemptExecutionOutcome {
    const effectiveRequest = request ?? buildExecutionRequest(input, this.defaultTimeoutMs);
    const result = providerResult ?? buildProviderUnavailableResult(
      effectiveRequest,
      sanitizeString(error instanceof Error ? error.message : String(error), STRING_FIELD_LIMIT),
      'PROCESS_SPAWN_FAILED',
    );

    // Bounded durable evidence. The payload is small by construction so this
    // write can never fail for size — the failure mode it reports.
    let failureEvidenceEvent: OrchestrationEventRecord | null = null;
    try {
      failureEvidenceEvent = this.store.appendEvent({
        eventId: this.idGenerator(),
        runId: input.runId,
        taskId: input.taskId,
        attemptId: input.attemptId,
        type: EXECUTION_PERSISTENCE_FAILED_EVENT,
        payload: {
          errorCode:
            error instanceof AttemptExecutorError
              ? error.code
              : error instanceof OrchestrationError
                ? error.code
                : 'EXECUTION_PERSISTENCE_FAILED',
          errorMessage: sanitizeString(
            redactCredentialShapes(error instanceof Error ? error.message : String(error)),
            STRING_FIELD_LIMIT,
          ),
        },
      });
    } catch {
      // Evidence is best effort only; the Attempt transition below is the
      // critical durable write.
    }

    // The critical write: terminalize the Attempt as failed (fail closed).
    const attempt = this.transitionAttemptTerminal(context.attempt.attemptId, 'failed');

    const policy: PolicyAdjudication = {
      decision: 'deny',
      accepted: false,
      reasonCodes: [],
      reason: 'Fail closed: execution finalization failed; the provider result was captured but could not be durably adjudicated.',
      baselineHeadSha: policyBaseline?.snapshot.headSha ?? 'policy-baseline-unavailable',
      finalHeadSha: policyBaseline?.snapshot.headSha ?? 'policy-baseline-unavailable',
      headMoved: false,
      changes: [],
    };

    return {
      executionId: effectiveRequest.executionId,
      attempt,
      result,
      startedEvent,
      terminalEvent: terminalEvent ?? failureEvidenceEvent,
      terminalAttemptStatus: 'failed',
      policy,
    };
  }

  private async finishWorkspacePreparationFailure(input: AttemptExecutionInput, context: AttemptContext, startedAt: Date, workspaceId: string): Promise<AttemptExecutionOutcome> {
    const request = buildExecutionRequest(input, this.defaultTimeoutMs);
    const result = buildProviderUnavailableResult(request, 'Isolated workspace preparation failed; provider was not launched.', 'PROCESS_SPAWN_FAILED');
    const terminalEvent = this.persistTerminalEvent(input, result, 'execution.failed', Math.max(0, this.now().getTime() - startedAt.getTime()));
    const policy: PolicyAdjudication = { decision: 'deny', accepted: false, reasonCodes: ['out-of-scope-write'], reason: 'Workspace preparation failed closed.', baselineHeadSha: 'workspace-unavailable', finalHeadSha: 'workspace-unavailable', headMoved: false, changes: [] };
    this.persistWorkspaceEvent(input, 'workspace.preparation.failed', { workspaceId, workspaceState: 'rejected' });
    this.persistPolicyEvent(input, policy);
    const attempt = this.transitionAttemptTerminal(context.attempt.attemptId, 'failed');
    return { executionId: request.executionId, attempt, result, startedEvent: null, terminalEvent, terminalAttemptStatus: 'failed', policy };
  }

  private persistWorkspaceEvent(input: AttemptExecutionInput, type: string, payload: JsonValue): void {
    this.store.appendEvent({ eventId: this.idGenerator(), runId: input.runId, taskId: input.taskId, attemptId: input.attemptId, type, payload });
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

  private persistPolicyBaselineEvent(input: AttemptExecutionInput, baseline: PolicyBaselineCapture): OrchestrationEventRecord {
    try {
      return this.store.appendEvent({
        eventId: this.idGenerator(),
        runId: input.runId,
        taskId: input.taskId,
        attemptId: input.attemptId,
        type: 'policy.baseline.captured',
        payload: buildPolicyBaselineEventPayload(baseline),
      });
    } catch (error) {
      throw new AttemptExecutorError(
        'EVENT_PERSIST_FAILED',
        `Failed to persist policy.baseline.captured for attempt ${input.attemptId}.`,
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

  private async adjudicatePolicy(
    input: AttemptExecutionInput,
    baseline: PolicyBaselineCapture,
  ): Promise<PolicyAdjudication> {
    try {
      return await this.policyController.adjudicate({
        baseline,
        workingDirectory: input.workingDirectory,
      });
    } catch (error) {
      throw new AttemptExecutorError(
        'POLICY_ADJUDICATION_FAILED',
        `Failed to adjudicate repo policy for attempt ${input.attemptId}.`,
        { cause: error },
      );
    }
  }

  private persistPolicyEvent(input: AttemptExecutionInput, policy: PolicyAdjudication): void {
    try {
      this.store.appendEvent({
        eventId: this.idGenerator(),
        runId: input.runId,
        taskId: input.taskId,
        attemptId: input.attemptId,
        type: 'policy.evaluated',
        payload: buildPolicyEvaluationEventPayload(policy),
      });

      if (!policy.accepted) {
        this.store.appendEvent({
          eventId: this.idGenerator(),
          runId: input.runId,
          taskId: input.taskId,
          attemptId: input.attemptId,
          type: 'policy.violation',
          payload: buildPolicyEvaluationEventPayload(policy),
        });
      }
    } catch (error) {
      throw new AttemptExecutorError(
        'EVENT_PERSIST_FAILED',
        `Failed to persist policy events for attempt ${input.attemptId}.`,
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

function createActiveExecutionEntry(): ActiveExecutionEntry {
  let cancellationRequested = false;
  let providerCancel: (() => void) | null = null;
  let providerCancelForwarded = false;

  const forwardProviderCancel = (): void => {
    if (!cancellationRequested || !providerCancel || providerCancelForwarded) {
      return;
    }
    providerCancelForwarded = true;
    providerCancel();
  };

  return {
    cancel(): void {
      cancellationRequested = true;
      forwardProviderCancel();
    },
    setProviderCancel(cancel: () => void): void {
      providerCancel = cancel;
      forwardProviderCancel();
    },
    isCancellationRequested(): boolean {
      return cancellationRequested;
    },
    completion: Promise.resolve(),
  };
}

function buildExecutionRequest(input: AttemptExecutionInput, defaultTimeoutMs: number, authorizedWorkingDirectory?: string): ExecutionRequest {
  return {
    executionId: input.attemptId,
    attemptId: input.attemptId,
    taskId: input.taskId,
    runId: input.runId,
    workingDirectory: input.workingDirectory,
    authorizedWorkingDirectory,
    prompt: input.prompt,
    requestedModel: input.requestedModel,
    reasoningEffort: input.reasoningEffort,
    permissionProfile: input.permissionProfile,
    timeoutMs: input.timeoutMs ?? defaultTimeoutMs,
  };
}

function workspaceIdentity(repoKey: string, input: AttemptExecutionInput): string {
  return `${repoKey}/${input.runId}/${input.attemptId}`;
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

function resolveEffectiveAttemptStatus(result: ExecutionResult, policy: PolicyAdjudication): AttemptStatus {
  if (result.provider.success && !policy.accepted) {
    return 'failed';
  }
  return mapAttemptStatus(result);
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
    errorMessage: sanitizeFailureMessage(result.provider.errorMessage),
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
    diagnostics: result.provider.success ? undefined : buildFailureDiagnostics(result),
    durationMs,
  });
}

function buildFailureDiagnostics(result: ExecutionResult): JsonValue | undefined {
  const stderrTail = sanitizeDiagnosticTail(result.diagnostics?.stderrTail);
  return stderrTail ? { stderrTail } : undefined;
}

function sanitizeDiagnosticTail(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return redactCredentialShapes(value).slice(-DURABLE_STDERR_TAIL_MAX_CHARS);
}

function sanitizeFailureMessage(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return sanitizeString(redactCredentialShapes(value), STRING_FIELD_LIMIT);
}

function redactCredentialShapes(value: string): string {
  return value
    .replace(/((?:authorization|proxy-authorization|cookie|set-cookie)\s*:\s*)[^\r\n]*/giu, '$1[REDACTED]')
    .replace(
      /(\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|token|secret|password)\b\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}\r\n]+)/giu,
      '$1[REDACTED]',
    )
    .replace(/\bsk-[A-Za-z0-9_-]+\b/gu, '[REDACTED]');
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

/**
 * Compute the executor-owned hard deadline: the request timeout plus the grace.
 * A non-finite or non-positive request timeout falls back to the executor
 * default so the backstop can never be armed with an immediate or invalid delay.
 */
function resolveHardDeadlineMs(timeoutMs: number, defaultTimeoutMs: number, graceMs: number): number {
  const base = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : defaultTimeoutMs;
  return base + graceMs;
}

/**
 * Deterministic timeout result synthesized when the executor's hard deadline
 * expires before the provider adapter settles. `process.timedOut` drives the
 * terminal event to `execution.timed_out` and the durable classification to the
 * retryable `execution-timeout` cause; `reportedModel` is never fabricated.
 */
function buildProviderTimeoutResult(request: ExecutionRequest): ExecutionResult {
  return {
    executionId: request.executionId,
    process: {
      exitCode: null,
      signal: null,
      timedOut: true,
      cancelled: false,
    },
    provider: {
      terminalState: 'failed',
      success: false,
      errorCode: 'EXECUTION_TIMEOUT',
      errorMessage: 'Provider execution exceeded the hard timeout bound before returning a terminal result.',
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

function buildCancelledBeforeLaunchResult(request: ExecutionRequest): ExecutionResult {
  return {
    executionId: request.executionId,
    process: {
      exitCode: null,
      signal: null,
      timedOut: false,
      cancelled: true,
    },
    provider: {
      terminalState: 'failed',
      success: false,
      errorCode: 'EXECUTION_CANCELLED',
      errorMessage: 'Provider execution was cancelled before launch.',
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
