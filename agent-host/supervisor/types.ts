import type {
  AttemptRecord,
  JsonValue,
  RunRecord,
  RunStatus,
  TaskRecord,
  TaskStatus,
} from '../lib/orchestrationTypes.ts';

export const DEFAULT_MAX_ATTEMPTS = 1;
export const MAX_SUPERVISOR_ATTEMPTS = 10;

export type RetryCause =
  | 'provider-process-failure'
  | 'execution-timeout'
  | 'host-interrupted'
  | 'policy-rejection'
  | 'cancelled'
  | 'human-gate'
  | 'unknown';

export type RetryDecisionReason =
  | 'retry-permitted'
  | 'budget-exhausted'
  | 'non-retryable-cause'
  | 'invalid-attempt-ordinal';

export interface RetryBudgetInput {
  attemptOrdinal: number;
  maxAttempts: number;
  cause: RetryCause;
}

export interface RetryBudgetDecision {
  retryAllowed: boolean;
  attemptOrdinal: number;
  maxAttempts: number;
  nextAttemptOrdinal: number | null;
  reason: RetryDecisionReason;
}

export interface HumanGateMetadata {
  taskId: string;
  gateKind: string;
  reason: string;
}

export interface AttemptFailureSummary {
  cause: RetryCause;
  gate?: HumanGateMetadata;
}

export interface AttemptTaskDecisionInput {
  task: Pick<TaskRecord, 'taskId' | 'status' | 'spec'>;
  attempt: Pick<AttemptRecord, 'taskId' | 'ordinal' | 'status'>;
  failure?: AttemptFailureSummary;
}

export interface RunTaskSnapshot {
  taskId: string;
  status: TaskStatus;
  retryAvailable?: boolean;
}

export interface RunLifecycleInput {
  run: Pick<RunRecord, 'runId' | 'status'>;
  tasks: readonly RunTaskSnapshot[];
  cancellationRequested?: boolean;
  blockedByHumanGate?: HumanGateMetadata;
}

export type SupervisorAction =
  | { type: 'NO_ACTION'; scope: 'task' | 'run'; reason: string }
  | { type: 'MARK_TASK_PASSED'; taskId: string }
  | { type: 'MARK_TASK_FAILED'; taskId: string; reason: RetryDecisionReason }
  | { type: 'MARK_TASK_CANCELLED'; taskId: string }
  | {
      type: 'SCHEDULE_RETRY';
      taskId: string;
      completedAttemptOrdinal: number;
      nextAttemptOrdinal: number;
      maxAttempts: number;
      transitionPath: readonly TaskStatus[];
      requiresDependencyReevaluation: true;
    }
  | { type: 'MARK_RUN_RUNNING'; runId: string; transitionPath: readonly RunStatus[] }
  | { type: 'MARK_RUN_COMPLETED'; runId: string; transitionPath: readonly RunStatus[] }
  | { type: 'MARK_RUN_FAILED'; runId: string; transitionPath: readonly RunStatus[]; taskId: string }
  | { type: 'MARK_RUN_CANCELLED'; runId: string; transitionPath: readonly RunStatus[] }
  | {
      type: 'PAUSE_FOR_GATE';
      scope: 'task' | 'run';
      runId?: string;
      taskId: string;
      gateKind: string;
      reason: string;
      transitionPath: readonly RunStatus[];
    };

export type TaskSpec = JsonValue | null;
