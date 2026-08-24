/**
 * ORCH-3B: Provider-neutral execution contract.
 *
 * This module defines ONLY the execution-layer types that future provider
 * adapters (Claude, Codex, Ollama, ...) will implement. It deliberately does
 * NOT contain any concrete adapter, any Architect/DAG/verifier concept, or any
 * routing ladder. Those live elsewhere.
 *
 * Three success layers are intentionally separated:
 *
 *   PROCESS COMPLETED  !=  PROVIDER COMPLETED  !=  TASK VERIFIED
 *
 *   - The ProcessRunner records process facts only (exit code, signal, bytes).
 *   - A provider adapter later decides whether the PROVIDER turn completed.
 *   - A verifier (later phase) decides whether the TASK was accepted.
 *
 * ORCH-3B does NOT decide task success. There is no `taskPassed` field here.
 */

import type { HarnessKind } from '../types.ts';

/* -------------------------------------------------------------------------- */
/* Provider identity                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Reserved provider identifiers. Future adapters register under one of these.
 * `cursor-agent` is reserved as a type but must NOT be exposed as available by
 * default; availability is always the result of a runtime probe, never a
 * hardcoded default.
 */
export type ProviderId = 'claude' | 'codex' | 'ollama' | 'cursor-agent';

/* -------------------------------------------------------------------------- */
/* Permission profile                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A small provider-neutral permission domain. Concrete adapters translate
 * these into their own CLI flags later (Claude/Codex/etc.). Dangerous or
 * bypass profiles are intentionally excluded.
 */
export type PermissionProfile = 'read-only-reviewer' | 'task-implementer' | 'verifier';

/* -------------------------------------------------------------------------- */
/* Error codes                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Explicit, small generic error-code union shared by every adapter. Adapters
 * map provider-specific failures onto these; ORCH-3B never invents new codes
 * at the runner layer.
 */
export type ProviderErrorCode =
  | 'PROVIDER_NOT_INSTALLED'
  | 'PROVIDER_UNAVAILABLE'
  | 'MODEL_UNAVAILABLE'
  | 'PROCESS_SPAWN_FAILED'
  | 'PROCESS_EXIT_NONZERO'
  | 'PROTOCOL_ERROR'
  | 'PROVIDER_ERROR'
  | 'EXECUTION_TIMEOUT'
  | 'EXECUTION_CANCELLED'
  | 'OUTPUT_LIMIT_EXCEEDED'
  | 'WORKING_DIRECTORY_INVALID';

/* -------------------------------------------------------------------------- */
/* Execution request                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Execution-layer concerns only. No Architect fields, no DAG fields, no
 * verifier fields, no routing ladder. By ORCH-3B convention `executionId` and
 * `attemptId` may be equal; this layer does not enforce that relationship.
 *
 * Provider-specific model strings are NOT validated here. Adapters own model
 * string interpretation.
 */
export interface ExecutionRequest {
  executionId: string;
  attemptId: string;
  taskId: string;
  runId: string;
  /** Directory the provider process runs in. Must equal the canonical allowed repo dir. */
  workingDirectory: string;
  /** Prompt text. Transported via stdin, never as an argv value. */
  prompt: string;
  requestedModel?: string;
  reasoningEffort?: string;
  permissionProfile: PermissionProfile;
  /** Overall wall-clock timeout in milliseconds. Validated + clamped by the runner. */
  timeoutMs: number;
}

/* -------------------------------------------------------------------------- */
/* Low-level process result (runner output)                                  */
/* -------------------------------------------------------------------------- */

/**
 * Why a process run ended. The runner records this; an adapter later maps it
 * onto a {@link ProviderErrorCode} when building the final
 * {@link ExecutionResult}.
 */
export type ProcessTerminationReason =
  | 'exited'
  | 'timeout-overall'
  | 'timeout-startup'
  | 'timeout-idle'
  | 'cancelled'
  | 'output-limit'
  | 'spawn-failed'
  | 'callback-error';

/**
 * Pure process facts returned by the ProcessRunner. This is deliberately kept
 * separate from {@link ExecutionResult}: a provider adapter combines this with
 * protocol state (parsed JSONL, terminal event) to form the final result. The
 * two MUST NOT be conflated.
 */
export interface ProcessExecutionResult {
  pid: number | null;
  exitCode: number | null;
  signal: string | null;
  /** A child process was successfully created (had a PID). */
  spawned: boolean;
  timedOut: boolean;
  cancelled: boolean;
  outputLimitExceeded: boolean;
  terminationReason: ProcessTerminationReason;
  /** Present only when terminationReason === 'callback-error'. */
  callbackErrorMessage?: string;
  startedAt: string | null;
  endedAt: string | null;
  /** Total processed stdout bytes (not retained — only counted). */
  stdoutBytes: number;
  /** Total processed stderr bytes (not retained — only counted). */
  stderrBytes: number;
  /** Bounded retained stdout tail (last N bytes). */
  stdoutTail: string;
  /** Bounded retained stderr tail (last N bytes). */
  stderrTail: string;
}

/* -------------------------------------------------------------------------- */
/* Terminal execution result (adapter output)                                */
/* -------------------------------------------------------------------------- */

export type ProviderTerminalState = 'completed' | 'failed' | 'unknown';

export type ReportedModelSource = 'stdout-metadata' | 'stderr-metadata' | 'protocol-message' | 'none';
export type UsageSource = 'protocol-message' | 'stderr-metadata' | 'none';

/**
 * The generic terminal result a provider adapter produces. The `process`
 * block carries only the four process facts required at this layer; the richer
 * {@link ProcessExecutionResult} stays internal to the runner/adapter boundary.
 *
 * IMPORTANT: `reportedModel` MAY be null. Do NOT automatically copy
 * `requestedModel` into `reportedModel`. If the provider never reports a model,
 * `reportedModel` stays null and `reportedModelSource` is `'none'`.
 */
export interface ExecutionResult {
  executionId: string;
  process: {
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    cancelled: boolean;
  };
  provider: {
    terminalState: ProviderTerminalState;
    /** Provider-turn success, NOT task success. */
    success: boolean;
    errorCode?: ProviderErrorCode;
    errorMessage?: string;
  };
  model: {
    requestedModel: string | null;
    reportedModel: string | null;
    reportedModelSource: ReportedModelSource;
  };
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    reasoningTokens?: number;
    totalTokens?: number;
    source: UsageSource;
  };
  session: {
    sessionId?: string;
  };
  output: {
    finalText?: string;
  };
  /** Optional bounded diagnostic tails for error reporting. Never env. */
  diagnostics?: {
    stdoutTail?: string;
    stderrTail?: string;
  };
}

/* -------------------------------------------------------------------------- */
/* Streaming callbacks                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Incremental stream callbacks. A callback throwing is handled fail-safe by the
 * ProcessRunner (see processRunner.ts): the child is terminated and the run
 * ends with terminationReason `'callback-error'`. A throwing callback never
 * orphans a child process.
 */
export interface ExecutionStreamCallbacks {
  onStdoutChunk?: (chunk: Buffer) => void;
  onStderrChunk?: (chunk: Buffer) => void;
}

/* -------------------------------------------------------------------------- */
/* Probe result                                                               */
/* -------------------------------------------------------------------------- */

export interface ProviderProbeError {
  code: ProviderErrorCode;
  message: string;
}

/**
 * Result of probing whether a provider is installed and usable. `available`
 * is never defaulted to true for any provider id, including `cursor-agent`.
 */
export interface ProviderProbeResult {
  available: boolean;
  resolvedPath?: string;
  harnessKind?: HarnessKind;
  cliVersion?: string;
  error?: ProviderProbeError;
}

/* -------------------------------------------------------------------------- */
/* Provider adapter contract                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The provider-neutral adapter contract. Concrete adapters (Claude, Codex,
 * Ollama) implement this in later phases. ORCH-3B defines the contract only.
 */
export interface ProviderAdapter {
  readonly id: ProviderId;
  /** Determine whether this provider is installed and usable. */
  probe(): Promise<ProviderProbeResult>;
  /** Execute one provider turn and return a terminal {@link ExecutionResult}. */
  execute(request: ExecutionRequest, callbacks?: ExecutionStreamCallbacks): Promise<ExecutionResult>;
  /** Idempotently request cancellation of an in-flight execution. */
  cancel(executionId: string): void;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Build a provider-error fragment for an adapter. `success` is derived from
 * `terminalState` unless explicitly overridden.
 */
export function providerErrorFragment(state: ProviderTerminalState, errorCode?: ProviderErrorCode, errorMessage?: string): {
  terminalState: ProviderTerminalState;
  success: boolean;
  errorCode?: ProviderErrorCode;
  errorMessage?: string;
} {
  return {
    terminalState: state,
    success: state === 'completed',
    errorCode,
    errorMessage,
  };
}