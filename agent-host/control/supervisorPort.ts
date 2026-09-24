/**
 * CT-CORE-1: PRODUCTION Supervisor ExecutionPort binding.
 *
 * This is the missing production seam between the ORCH-5 Supervisor and the
 * real execution machinery. It ADAPTS the EXISTING AttemptExecutor (provider
 * dispatch, isolated workspace materialization, policy adjudication) to the
 * Supervisor's ExecutionPort.execute(context) contract. It does NOT duplicate
 * any attempt execution code.
 *
 * The task's durable spec (created from the approved plan) carries the
 * execution contract:
 *   { control: { provider, requestedModel, permissionProfile, prompt, timeoutMs },
 *     policy: { authorizedWritePaths: [...] } }
 *
 * Verifier verdict: for verifier tasks the provider turn's explicit verdict is
 * parsed and recorded as a durable `control.verifier.verdict` event + returned
 * so the worker can publish it as safe snapshot metadata. It NEVER fabricates a
 * pass: an unparseable verdict reports 'unknown'.
 */

import type { AttemptExecutionContext, ExecutionPort, AttemptExecutionResult } from '../supervisor/supervisor.ts';
import type { AttemptExecutor, AttemptExecutionOutcome } from '../providers/executor.ts';
import type { ProviderId } from '../providers/types.ts';
import type { OrchestrationStore } from '../lib/store.ts';
import { PLAN_PROVIDER_IDS, type TaskControlSpec } from './types.ts';
import { isEffortLevel } from '../providers/effort.ts';
import { parseVerifierResult, verifierResultSummary } from './planning.ts';
import { evaluateLaunchContract } from './launchContract.ts';
import type { JsonValue } from '../lib/orchestrationTypes.ts';

export const VERIFIER_VERDICT_EVENT = 'control.verifier.verdict';

export class TaskSpecContractError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'TaskSpecContractError';
    this.code = code;
  }
}

export interface ProductionExecutionPortOptions {
  store: OrchestrationStore;
  executor: AttemptExecutor;
  /** Registered provider ids on this Host. Absent → skip availability deny. */
  availableProviders?: ReadonlySet<string> | undefined;
  /** Optional per-provider model allowlist. Absent/null → Host cannot prove unavailability. */
  supportedModelsByProvider?: Partial<Record<string, ReadonlySet<string>>> | undefined;
}

export class ProductionExecutionPort implements ExecutionPort {
  private readonly store: OrchestrationStore;
  private readonly executor: AttemptExecutor;
  private readonly availableProviders: ReadonlySet<string> | undefined;
  private readonly supportedModelsByProvider: ProductionExecutionPortOptions['supportedModelsByProvider'];
  /** Latest verifier verdict observed per run (safe metadata only). */
  private readonly verdictsByRun = new Map<string, { verdict: 'pass' | 'fail' | 'unknown'; summary: string | null }>();

  constructor(options: ProductionExecutionPortOptions) {
    this.store = options.store;
    this.executor = options.executor;
    this.availableProviders = options.availableProviders;
    this.supportedModelsByProvider = options.supportedModelsByProvider;
  }

  /** Safe verifier verdict observed for a run, or null when none ran yet. */
  getVerifierVerdict(runId: string): { verdict: 'pass' | 'fail' | 'unknown'; summary: string | null } | null {
    return this.verdictsByRun.get(runId) ?? null;
  }

  async execute(context: AttemptExecutionContext): Promise<AttemptExecutionResult | void> {
    let spec: TaskControlSpec & { workingDirectory: string };
    try {
      spec = parseTaskControlSpec(context.task.spec);
    } catch (error) {
      failClosedLaunch(this.store, context, error instanceof TaskSpecContractError ? error.code : 'SPEC_INVALID', error instanceof Error ? error.message : 'Task spec is invalid.');
      return { failure: { cause: 'policy-rejection' } };
    }

    const contract = evaluateLaunchContract({
      parsed: spec,
      rawSpec: context.task.spec,
      availableProviders: this.availableProviders,
      supportedModels: this.supportedModelsByProvider?.[spec.control.provider] ?? null,
    });
    if (!contract.ok) {
      failClosedLaunch(this.store, context, contract.code, contract.message);
      return { failure: { cause: 'policy-rejection' } };
    }

    const outcome: AttemptExecutionOutcome = await this.executor.execute({
      runId: context.runId,
      taskId: context.taskId,
      attemptId: context.attemptId,
      provider: spec.control.provider,
      prompt: spec.control.prompt,
      requestedModel: spec.control.requestedModel ?? undefined,
      reasoningEffort: spec.control.reasoningEffort ?? undefined,
      permissionProfile: spec.control.permissionProfile,
      timeoutMs: spec.control.timeoutMs,
      workingDirectory: spec.workingDirectory,
      hostInstanceId: context.hostInstanceId,
    });

    if (spec.control.permissionProfile === 'verifier') {
      recordVerifierVerdict(this.store, this.verdictsByRun, context, outcome);
    }

    return;
  }
}

/** Read the run's canonical repo path via the store's run record when present. */
export function parseTaskControlSpec(spec: unknown): TaskControlSpec & { workingDirectory: string } {
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
    throw new TaskSpecContractError('SPEC_MISSING', 'Task spec is missing; cannot execute.');
  }
  const record = spec as Record<string, unknown>;
  const control = record.control;
  const policy = record.policy;

  if (typeof control !== 'object' || control === null || Array.isArray(control)) {
    throw new TaskSpecContractError('SPEC_CONTROL_MISSING', "Task spec is missing the 'control' block.");
  }
  const controlRecord = control as Record<string, unknown>;
  if (typeof controlRecord.provider !== 'string' || controlRecord.provider.length === 0) {
    throw new TaskSpecContractError('SPEC_PROVIDER_MISSING', "Task spec 'control.provider' is missing.");
  }
  if (!(PLAN_PROVIDER_IDS as readonly string[]).includes(controlRecord.provider)) {
    throw new TaskSpecContractError('SPEC_PROVIDER_UNKNOWN', "Task spec 'control.provider' is not a control-plane provider.");
  }
  if (typeof controlRecord.prompt !== 'string' || controlRecord.prompt.length === 0) {
    throw new TaskSpecContractError('SPEC_PROMPT_MISSING', "Task spec 'control.prompt' is missing.");
  }
  if (
    controlRecord.permissionProfile !== 'task-implementer' &&
    controlRecord.permissionProfile !== 'verifier' &&
    controlRecord.permissionProfile !== 'read-only-reviewer'
  ) {
    throw new TaskSpecContractError('SPEC_PROFILE_INVALID', "Task spec 'control.permissionProfile' is invalid.");
  }
  if (controlRecord.requestedModel !== undefined && controlModelInvalid(controlRecord.requestedModel)) {
    throw new TaskSpecContractError('SPEC_MODEL_INVALID', "Task spec 'control.requestedModel' must be a string or null.");
  }
  if (
    controlRecord.reasoningEffort !== undefined &&
    controlRecord.reasoningEffort !== null &&
    !isEffortLevel(controlRecord.reasoningEffort)
  ) {
    throw new TaskSpecContractError('SPEC_EFFORT_INVALID', "Task spec 'control.reasoningEffort' must be a normalized effort level or null.");
  }

  if (typeof policy !== 'object' || policy === null || Array.isArray(policy)) {
    throw new TaskSpecContractError('SPEC_POLICY_MISSING', "Task spec is missing the 'policy' block.");
  }
  const policyRecord = policy as Record<string, unknown>;
  if (
    policyRecord.authorizedWritePaths !== undefined &&
    !isSafeStringArray(policyRecord.authorizedWritePaths)
  ) {
    throw new TaskSpecContractError('SPEC_WRITE_PATHS_INVALID', "Task spec 'policy.authorizedWritePaths' must be an array of strings.");
  }

  return {
    control: {
      provider: controlRecord.provider as ProviderId,
      requestedModel:
        typeof controlRecord.requestedModel === 'string' && controlRecord.requestedModel.length > 0
          ? controlRecord.requestedModel
          : null,
      reasoningEffort: isEffortLevel(controlRecord.reasoningEffort) ? controlRecord.reasoningEffort : null,
      permissionProfile: controlRecord.permissionProfile,
      prompt: controlRecord.prompt,
      timeoutMs: typeof controlRecord.timeoutMs === 'number' && controlRecord.timeoutMs > 0 ? controlRecord.timeoutMs : 10 * 60_000,
    },
    policy: {
      authorizedWritePaths: isSafeStringArray(policyRecord.authorizedWritePaths)
        ? (policyRecord.authorizedWritePaths as string[])
        : [],
    },
    workingDirectory: requireWorkingDirectory(record.workingDirectory),
  };
}

function requireWorkingDirectory(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TaskSpecContractError('SPEC_WORKING_DIRECTORY_MISSING', "Task spec 'workingDirectory' is missing.");
  }
  return value;
}

function controlModelInvalid(value: unknown): boolean {
  return !(typeof value === 'string' || value === null);
}

function isSafeStringArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string' && entry.length > 0 && entry.length <= 256 && !entry.includes('\\') && !entry.includes('..'))
  );
}

/**
 * ATB-4B: fail closed BEFORE provider launch. Events are best-effort; the
 * Attempt terminal transition is attempted even if persistence fails so the
 * Supervisor does not observe a fake still-running Attempt.
 */
function failClosedLaunch(
  store: OrchestrationStore,
  context: AttemptExecutionContext,
  code: string,
  message: string,
): void {
  const safeCode = sliceSafe(code, 80);
  const safeMessage = sliceSafe(message, 240);
  try {
    store.appendEvent({
      eventId: `execution.failed:launch-contract:${context.attemptId}`,
      runId: context.runId,
      taskId: context.taskId,
      attemptId: context.attemptId,
      type: 'execution.failed',
      payload: {
        errorCode: safeCode,
        errorMessage: safeMessage,
        providerLaunched: false,
      } as JsonValue,
    });
  } catch {
    // Evidence is best-effort.
  }
  try {
    store.appendEvent({
      eventId: `policy.evaluated:launch-contract:${context.attemptId}`,
      runId: context.runId,
      taskId: context.taskId,
      attemptId: context.attemptId,
      type: 'policy.evaluated',
      payload: {
        accepted: false,
        decision: 'deny',
        reasonCodes: ['launch-contract'],
        reason: safeMessage,
        changeCount: 1,
        changes: [{
          path: 'task.spec',
          decision: 'deny',
          reasonCode: 'launch-contract',
          category: 'OUT_OF_SCOPE_CHANGE',
        }],
      } as JsonValue,
    });
  } catch {
    // Evidence is best-effort.
  }
  try {
    const attempt = store.getAttempt(context.attemptId);
    if (attempt && attempt.status === 'running') {
      store.transitionAttempt(context.attemptId, 'failed');
    }
  } catch {
    // Restart reconciliation owns a still-running Attempt if this write fails.
  }
}

function recordVerifierVerdict(
  store: OrchestrationStore,
  verdictsByRun: Map<string, { verdict: 'pass' | 'fail' | 'unknown'; summary: string | null }>,
  context: AttemptExecutionContext,
  outcome: AttemptExecutionOutcome,
): void {
  const parsed = outcome.result.provider.success
    ? parseVerifierResult(outcome.result.output.finalText)
    : { verdict: 'unknown' as const, summary: null, evidenceRefs: [], failedChecks: [] };
  const summary = verifierResultSummary(parsed) ?? (outcome.result.provider.success ? null : outcome.result.provider.errorMessage ? sliceSafe(outcome.result.provider.errorMessage, 240) : null);

  try {
    store.appendEvent({
      eventId: `${VERIFIER_VERDICT_EVENT}:${context.attemptId}`,
      runId: context.runId,
      taskId: context.taskId,
      attemptId: context.attemptId,
      type: VERIFIER_VERDICT_EVENT,
      payload: {
        verdict: parsed.verdict,
        attemptStatus: outcome.attempt.status,
        summary,
        evidenceRefs: parsed.evidenceRefs,
        failedChecks: parsed.failedChecks,
      },
    });
  } catch {
    // The verdict map below still records it for the snapshot; the durable
    // event is best-effort redundancy and must never fail execution.
  }

  verdictsByRun.set(context.runId, { verdict: parsed.verdict, summary });
}

function sliceSafe(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : value.slice(0, maxChars);
}