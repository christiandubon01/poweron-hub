export const ORCHESTRATION_SCHEMA_VERSION = 1 as const;
export const TITLE_MAX_LENGTH = 512;
export const TEXT_FIELD_MAX_BYTES = 8_192;
export const SQLITE_TIMEOUT_MS = 5_000;
export const SQLITE_READONLY_TIMEOUT_MS = 250;

export const RUN_STATUSES = ['pending', 'running', 'paused', 'completed', 'failed', 'cancelled'] as const;
export const TASK_STATUSES = ['pending', 'running', 'passed', 'failed', 'blocked', 'cancelled'] as const;
export const ATTEMPT_STATUSES = ['running', 'passed', 'failed', 'interrupted', 'cancelled'] as const;
export const ACTIVE_RUN_STATUSES = ['pending', 'running', 'paused'] as const;
export const TERMINAL_RUN_STATUSES = ['completed', 'failed', 'cancelled'] as const;
export const TERMINAL_TASK_STATUSES = ['passed', 'failed', 'cancelled'] as const;
export const TERMINAL_ATTEMPT_STATUSES = ['passed', 'failed', 'interrupted', 'cancelled'] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];
export type ActiveRunStatus = (typeof ACTIVE_RUN_STATUSES)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface RunRecord {
  runId: string;
  title: string;
  goal: string | null;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface TaskRecord {
  taskId: string;
  runId: string;
  title: string;
  goal: string | null;
  status: TaskStatus;
  position: number;
  spec: JsonValue | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface TaskDependencyRecord {
  taskId: string;
  dependsOnTaskId: string;
  createdAt: string;
}

export interface AttemptRecord {
  attemptId: string;
  taskId: string;
  ordinal: number;
  status: AttemptStatus;
  hostInstanceId: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface OrchestrationEventRecord {
  seq: number;
  eventId: string;
  runId: string;
  taskId: string | null;
  attemptId: string | null;
  type: string;
  createdAt: string;
  payload: JsonValue | null;
}

export interface OrchestrationMetaRecord {
  schemaVersion: number;
  repoKey: string;
  createdAt: string;
  createdByHostId: string;
  createdByHostVersion: string;
}

export interface CreateRunInput {
  runId: string;
  title: string;
  goal?: string | null;
}

export interface CreateTaskInput {
  taskId: string;
  runId: string;
  title: string;
  goal?: string | null;
  position?: number | null;
  spec?: JsonValue | null;
}

export interface CreateAttemptInput {
  attemptId: string;
  taskId: string;
  hostInstanceId: string;
}

export interface AppendEventInput {
  eventId: string;
  runId: string;
  taskId?: string | null;
  attemptId?: string | null;
  type: string;
  payload?: JsonValue | null;
}

export type OrchestrationErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'IDEMPOTENCY_CONFLICT'
  | 'DEPENDENCY_CYCLE'
  | 'CROSS_RUN_DEPENDENCY'
  | 'RELATIONSHIP_MISMATCH'
  | 'PAYLOAD_TOO_LARGE'
  | 'SCHEMA_NEWER'
  | 'SCHEMA_CORRUPT';

export class OrchestrationError extends Error {
  code: OrchestrationErrorCode;
  cause?: unknown;

  constructor(code: OrchestrationErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'OrchestrationError';
    this.code = code;
    this.cause = options?.cause;
  }
}

export function isOrchestrationError(error: unknown): error is OrchestrationError {
  return error instanceof OrchestrationError;
}
