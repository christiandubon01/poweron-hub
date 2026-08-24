import { type DatabaseSync } from 'node:sqlite';

import { openOrchestrationWriterDatabase } from './schema.ts';
import { assertAttemptTransition, assertRunTransition, assertTaskTransition } from './transitions.ts';
import {
  ATTEMPT_STATUSES,
  RUN_STATUSES,
  TASK_STATUSES,
  TEXT_FIELD_MAX_BYTES,
  TITLE_MAX_LENGTH,
  OrchestrationError,
  type AppendEventInput,
  type AttemptRecord,
  type AttemptStatus,
  type CreateAttemptInput,
  type CreateRunInput,
  type CreateTaskInput,
  type JsonValue,
  type OrchestrationEventRecord,
  type RunRecord,
  type RunStatus,
  type TaskDependencyRecord,
  type TaskRecord,
  type TaskStatus,
} from './orchestrationTypes.ts';

export interface OpenOrchestrationStoreOptions {
  dbPath: string;
  repoKey: string;
  hostId: string;
  hostVersion: string;
  now?: (() => Date) | undefined;
  idGenerator?: (() => string) | undefined;
  testHooks?: {
    beforeEventInsert?: ((event: {
      eventId: string;
      runId: string;
      taskId: string | null;
      attemptId: string | null;
      type: string;
      createdAt: string;
      payloadText: string | null;
    }) => void) | undefined;
  } | undefined;
}

export interface OrchestrationStore {
  close(): void;
  createRun(input: CreateRunInput): RunRecord;
  getRun(runId: string): RunRecord | null;
  listRuns(): RunRecord[];
  transitionRun(runId: string, status: RunStatus): RunRecord;
  createTask(input: CreateTaskInput): TaskRecord;
  getTask(taskId: string): TaskRecord | null;
  listTasks(runId: string): TaskRecord[];
  transitionTask(taskId: string, status: TaskStatus): TaskRecord;
  addDependency(taskId: string, dependsOnTaskId: string): TaskDependencyRecord;
  listDependencies(runId: string): TaskDependencyRecord[];
  getReadyTasks(runId: string): TaskRecord[];
  createAttempt(input: CreateAttemptInput): AttemptRecord;
  getAttempt(attemptId: string): AttemptRecord | null;
  listAttempts(taskId: string): AttemptRecord[];
  transitionAttempt(attemptId: string, status: AttemptStatus): AttemptRecord;
  appendEvent(input: AppendEventInput): OrchestrationEventRecord;
  listEvents(options?: { sinceSeq?: number | undefined }): OrchestrationEventRecord[];
  findInterruptedAttempts(liveHostInstanceId: string): AttemptRecord[];
}

interface PersistedTaskRow {
  taskId: string;
  runId: string;
  title: string;
  goal: string | null;
  status: TaskStatus;
  position: number;
  spec: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

interface PersistedEventRow {
  seq: number;
  eventId: string;
  runId: string;
  taskId: string | null;
  attemptId: string | null;
  type: string;
  createdAt: string;
  payload: string | null;
}

interface TaskAttemptContext {
  task: PersistedTaskRow;
  run: RunRecord;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

function toCanonicalJsonValue(value: unknown, fieldName: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new OrchestrationError('PAYLOAD_TOO_LARGE', `${fieldName} must contain only finite JSON numbers.`);
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toCanonicalJsonValue(entry, fieldName));
  }

  if (isPlainObject(value)) {
    const sortedEntries = Object.keys(value)
      .sort()
      .map((key) => {
        const nextValue = value[key];
        if (nextValue === undefined) {
          throw new OrchestrationError('PAYLOAD_TOO_LARGE', `${fieldName} contains undefined values.`);
        }
        return [key, toCanonicalJsonValue(nextValue, fieldName)] as const;
      });

    return Object.fromEntries(sortedEntries);
  }

  throw new OrchestrationError('PAYLOAD_TOO_LARGE', `${fieldName} must be JSON-serializable.`);
}

function stableStringify(value: JsonValue): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function ensureNonEmptyString(value: string, fieldName: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new OrchestrationError('NOT_FOUND', `${fieldName} must be a non-empty string.`);
  }
  return value;
}

function assertTitle(title: string): void {
  if (title.length === 0 || title.length > TITLE_MAX_LENGTH) {
    throw new OrchestrationError('PAYLOAD_TOO_LARGE', `title must be between 1 and ${TITLE_MAX_LENGTH} characters.`);
  }
}

function assertOptionalTextBytes(value: string | null | undefined, fieldName: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (Buffer.byteLength(value, 'utf8') > TEXT_FIELD_MAX_BYTES) {
    throw new OrchestrationError(
      'PAYLOAD_TOO_LARGE',
      `${fieldName} exceeds ${TEXT_FIELD_MAX_BYTES} UTF-8 bytes.`,
    );
  }

  return value;
}

function serializeOptionalJson(value: JsonValue | null | undefined, fieldName: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const canonicalValue = toCanonicalJsonValue(value, fieldName);
  const serialized = stableStringify(canonicalValue);
  if (Buffer.byteLength(serialized, 'utf8') > TEXT_FIELD_MAX_BYTES) {
    throw new OrchestrationError(
      'PAYLOAD_TOO_LARGE',
      `${fieldName} exceeds ${TEXT_FIELD_MAX_BYTES} UTF-8 bytes.`,
    );
  }
  return serialized;
}

function parseJsonText(value: string | null): JsonValue | null {
  if (value === null) {
    return null;
  }

  return JSON.parse(value) as JsonValue;
}

function mapRunRow(row: unknown): RunRecord | null {
  if (!row || typeof row !== 'object') {
    return null;
  }

  const run = row as RunRecord;
  return { ...run };
}

function mapTaskRow(row: unknown): TaskRecord | null {
  if (!row || typeof row !== 'object') {
    return null;
  }

  const task = row as PersistedTaskRow;
  return {
    taskId: task.taskId,
    runId: task.runId,
    title: task.title,
    goal: task.goal,
    status: task.status,
    position: task.position,
    spec: parseJsonText(task.spec),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
  };
}

function mapAttemptRow(row: unknown): AttemptRecord | null {
  if (!row || typeof row !== 'object') {
    return null;
  }

  const attempt = row as AttemptRecord;
  return { ...attempt };
}

function mapEventRow(row: unknown): OrchestrationEventRecord | null {
  if (!row || typeof row !== 'object') {
    return null;
  }

  const event = row as PersistedEventRow;
  return {
    seq: event.seq,
    eventId: event.eventId,
    runId: event.runId,
    taskId: event.taskId,
    attemptId: event.attemptId,
    type: event.type,
    createdAt: event.createdAt,
    payload: parseJsonText(event.payload),
  };
}

function getCountValue(row: unknown): number {
  if (!row || typeof row !== 'object') {
    throw new OrchestrationError('SCHEMA_CORRUPT', 'Expected count row.');
  }

  const value = Object.values(row as Record<string, unknown>)[0];
  if (typeof value !== 'number') {
    throw new OrchestrationError('SCHEMA_CORRUPT', 'Expected numeric count value.');
  }

  return value;
}

export function openOrchestrationStore(options: OpenOrchestrationStoreOptions): OrchestrationStore {
  const now = options.now ?? (() => new Date());
  const idGenerator = options.idGenerator ?? globalThis.crypto.randomUUID.bind(globalThis.crypto);
  const { db } = openOrchestrationWriterDatabase({
    dbPath: options.dbPath,
    repoKey: options.repoKey,
    hostId: options.hostId,
    hostVersion: options.hostVersion,
    now: () => now().toISOString(),
  });

  let closed = false;
  let transactionActive = false;

  const getNowIso = (): string => now().toISOString();

  const ensureOpen = (): void => {
    if (closed) {
      throw new OrchestrationError('SCHEMA_CORRUPT', 'Orchestration store is closed.');
    }
  };

  const runInTransaction = <T>(work: () => T): T => {
    ensureOpen();
    if (transactionActive) {
      throw new OrchestrationError('SCHEMA_CORRUPT', 'Nested orchestration transactions are not supported.');
    }

    transactionActive = true;
    db.exec('BEGIN IMMEDIATE');

    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    } finally {
      transactionActive = false;
    }
  };

  const getRunOrThrow = (runId: string): RunRecord => {
    const run = mapRunRow(
      db.prepare(
        `
          SELECT runId, title, goal, status, createdAt, updatedAt, startedAt, completedAt
          FROM runs
          WHERE runId = ?
        `,
      ).get(runId),
    );

    if (!run) {
      throw new OrchestrationError('NOT_FOUND', `Run ${runId} was not found.`);
    }

    return run;
  };

  const getTaskRowOrThrow = (taskId: string): PersistedTaskRow => {
    const task = db.prepare(
      `
        SELECT taskId, runId, title, goal, status, position, spec, createdAt, updatedAt, startedAt, completedAt
        FROM tasks
        WHERE taskId = ?
      `,
    ).get(taskId) as PersistedTaskRow | undefined;

    if (!task) {
      throw new OrchestrationError('NOT_FOUND', `Task ${taskId} was not found.`);
    }

    return task;
  };

  const getTaskOrThrow = (taskId: string): TaskRecord => {
    const task = mapTaskRow(getTaskRowOrThrow(taskId));
    if (!task) {
      throw new OrchestrationError('SCHEMA_CORRUPT', `Task ${taskId} could not be read.`);
    }
    return task;
  };

  const getAttemptOrThrow = (attemptId: string): AttemptRecord => {
    const attempt = mapAttemptRow(
      db.prepare(
        `
          SELECT attemptId, taskId, ordinal, status, hostInstanceId, createdAt, startedAt, endedAt
          FROM attempts
          WHERE attemptId = ?
        `,
      ).get(attemptId),
    );

    if (!attempt) {
      throw new OrchestrationError('NOT_FOUND', `Attempt ${attemptId} was not found.`);
    }

    return attempt;
  };

  const resolveTaskAttemptContext = (taskId: string): TaskAttemptContext => {
    const task = getTaskRowOrThrow(taskId);
    return {
      task,
      run: getRunOrThrow(task.runId),
    };
  };

  const appendEventInTransaction = (
    input: AppendEventInput,
    createdAt: string,
  ): OrchestrationEventRecord => {
    const eventId = ensureNonEmptyString(input.eventId, 'eventId');
    const runId = ensureNonEmptyString(input.runId, 'runId');
    const type = ensureNonEmptyString(input.type, 'type');
    const taskId = input.taskId ?? null;
    const attemptId = input.attemptId ?? null;
    const payloadText = serializeOptionalJson(input.payload, 'payload');

    const existing = mapEventRow(
      db.prepare(
        `
          SELECT seq, eventId, runId, taskId, attemptId, type, createdAt, payload
          FROM events
          WHERE eventId = ?
        `,
      ).get(eventId),
    );

    if (existing) {
      const existingPayloadText = serializeOptionalJson(existing.payload, 'payload');
      if (
        existing.runId === runId &&
        existing.taskId === taskId &&
        existing.attemptId === attemptId &&
        existing.type === type &&
        existingPayloadText === payloadText
      ) {
        return existing;
      }

      throw new OrchestrationError(
        'IDEMPOTENCY_CONFLICT',
        `Event ${eventId} already exists with different immutable data.`,
      );
    }

    getRunOrThrow(runId);

    if (taskId !== null) {
      const task = getTaskOrThrow(taskId);
      if (task.runId !== runId) {
        throw new OrchestrationError(
          'RELATIONSHIP_MISMATCH',
          `Task ${taskId} does not belong to run ${runId}.`,
        );
      }
    }

    if (attemptId !== null) {
      const row = db.prepare(
        `
          SELECT attempts.taskId, tasks.runId
          FROM attempts
          INNER JOIN tasks ON tasks.taskId = attempts.taskId
          WHERE attempts.attemptId = ?
        `,
      ).get(attemptId) as { taskId: string; runId: string } | undefined;

      if (!row) {
        throw new OrchestrationError('NOT_FOUND', `Attempt ${attemptId} was not found.`);
      }

      if (row.runId !== runId) {
        throw new OrchestrationError(
          'RELATIONSHIP_MISMATCH',
          `Attempt ${attemptId} does not belong to run ${runId}.`,
        );
      }

      if (taskId !== null && row.taskId !== taskId) {
        throw new OrchestrationError(
          'RELATIONSHIP_MISMATCH',
          `Attempt ${attemptId} does not belong to task ${taskId}.`,
        );
      }
    }

    options.testHooks?.beforeEventInsert?.({
      eventId,
      runId,
      taskId,
      attemptId,
      type,
      createdAt,
      payloadText,
    });

    db.prepare(
      `
        INSERT INTO events (eventId, runId, taskId, attemptId, type, createdAt, payload)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(eventId, runId, taskId, attemptId, type, createdAt, payloadText);

    return mapEventRow(
      db.prepare(
        `
          SELECT seq, eventId, runId, taskId, attemptId, type, createdAt, payload
          FROM events
          WHERE eventId = ?
        `,
      ).get(eventId),
    ) as OrchestrationEventRecord;
  };

  const updateTaskStatusInTransaction = (
    task: PersistedTaskRow,
    nextStatus: TaskStatus,
    updatedAt: string,
  ): TaskRecord => {
    const startedAt = nextStatus === 'running' ? task.startedAt ?? updatedAt : task.startedAt;
    const completedAt = nextStatus === 'passed' || nextStatus === 'failed' || nextStatus === 'cancelled' ? updatedAt : null;

    db.prepare(
      `
        UPDATE tasks
        SET status = ?, updatedAt = ?, startedAt = ?, completedAt = ?
        WHERE taskId = ?
      `,
    ).run(nextStatus, updatedAt, startedAt, completedAt, task.taskId);

    return getTaskOrThrow(task.taskId);
  };

  const detectCycle = (taskId: string, dependsOnTaskId: string): boolean => {
    const seen = new Set<string>();
    const stack = [dependsOnTaskId];

    while (stack.length > 0) {
      const currentTaskId = stack.pop() as string;
      if (currentTaskId === taskId) {
        return true;
      }

      if (seen.has(currentTaskId)) {
        continue;
      }
      seen.add(currentTaskId);

      const rows = db.prepare(
        `
          SELECT dependsOnTaskId
          FROM task_dependencies
          WHERE taskId = ?
        `,
      ).all(currentTaskId) as Array<{ dependsOnTaskId: string }>;

      for (const row of rows) {
        stack.push(row.dependsOnTaskId);
      }
    }

    return false;
  };

  return {
    close(): void {
      if (!closed) {
        db.close();
        closed = true;
      }
    },

    createRun(input: CreateRunInput): RunRecord {
      ensureOpen();
      const runId = ensureNonEmptyString(input.runId, 'runId');
      const title = ensureNonEmptyString(input.title, 'title');
      const goal = assertOptionalTextBytes(input.goal, 'goal');
      assertTitle(title);

      const existing = this.getRun(runId);
      if (existing) {
        if (existing.title === title && existing.goal === goal) {
          return existing;
        }
        throw new OrchestrationError('IDEMPOTENCY_CONFLICT', `Run ${runId} already exists with different input.`);
      }

      return runInTransaction(() => {
        const timestamp = getNowIso();
        db.prepare(
          `
            INSERT INTO runs (
              runId,
              title,
              goal,
              status,
              createdAt,
              updatedAt,
              startedAt,
              completedAt
            ) VALUES (?, ?, ?, 'pending', ?, ?, NULL, NULL)
          `,
        ).run(runId, title, goal, timestamp, timestamp);

        appendEventInTransaction(
          {
            eventId: idGenerator(),
            runId,
            type: 'run.created',
            payload: { status: 'pending' },
          },
          timestamp,
        );

        return getRunOrThrow(runId);
      });
    },

    getRun(runId: string): RunRecord | null {
      ensureOpen();
      return mapRunRow(
        db.prepare(
          `
            SELECT runId, title, goal, status, createdAt, updatedAt, startedAt, completedAt
            FROM runs
            WHERE runId = ?
          `,
        ).get(runId),
      );
    },

    listRuns(): RunRecord[] {
      ensureOpen();
      const rows = db.prepare(
        `
          SELECT runId, title, goal, status, createdAt, updatedAt, startedAt, completedAt
          FROM runs
          ORDER BY createdAt, runId
        `,
      ).all();
      return rows.map((row) => mapRunRow(row) as RunRecord);
    },

    transitionRun(runId: string, status: RunStatus): RunRecord {
      ensureOpen();
      if (!RUN_STATUSES.includes(status)) {
        throw new OrchestrationError('INVALID_TRANSITION', `Invalid run status ${status}.`);
      }

      return runInTransaction(() => {
        const run = getRunOrThrow(runId);
        if (run.status === status) {
          return run;
        }

        assertRunTransition(run.status, status);
        const timestamp = getNowIso();
        const startedAt = status === 'running' ? run.startedAt ?? timestamp : run.startedAt;
        const completedAt =
          status === 'completed' || status === 'failed' || status === 'cancelled' ? timestamp : null;

        db.prepare(
          `
            UPDATE runs
            SET status = ?, updatedAt = ?, startedAt = ?, completedAt = ?
            WHERE runId = ?
          `,
        ).run(status, timestamp, startedAt, completedAt, runId);

        appendEventInTransaction(
          {
            eventId: idGenerator(),
            runId,
            type: 'run.status.changed',
            payload: {
              previousStatus: run.status,
              nextStatus: status,
            },
          },
          timestamp,
        );

        return getRunOrThrow(runId);
      });
    },

    createTask(input: CreateTaskInput): TaskRecord {
      ensureOpen();
      const taskId = ensureNonEmptyString(input.taskId, 'taskId');
      const runId = ensureNonEmptyString(input.runId, 'runId');
      const title = ensureNonEmptyString(input.title, 'title');
      const goal = assertOptionalTextBytes(input.goal, 'goal');
      const specText = serializeOptionalJson(input.spec, 'spec');
      assertTitle(title);

      const existing = this.getTask(taskId);
      if (existing) {
        const samePosition = input.position == null ? true : existing.position === input.position;
        const existingSpecText = serializeOptionalJson(existing.spec, 'spec');
        if (
          existing.runId === runId &&
          existing.title === title &&
          existing.goal === goal &&
          samePosition &&
          existingSpecText === specText
        ) {
          return existing;
        }
        throw new OrchestrationError('IDEMPOTENCY_CONFLICT', `Task ${taskId} already exists with different input.`);
      }

      return runInTransaction(() => {
        getRunOrThrow(runId);
        const timestamp = getNowIso();
        if (input.position != null && !Number.isInteger(input.position)) {
          throw new OrchestrationError('INVALID_TRANSITION', 'Task position must be an integer.');
        }
        const position =
          input.position == null
            ? getCountValue(
                db.prepare(
                  `
                    SELECT COALESCE(MAX(position), -1) + 1
                    FROM tasks
                    WHERE runId = ?
                  `,
                ).get(runId),
              )
            : input.position;

        db.prepare(
          `
            INSERT INTO tasks (
              taskId,
              runId,
              title,
              goal,
              status,
              position,
              spec,
              createdAt,
              updatedAt,
              startedAt,
              completedAt
            ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, NULL, NULL)
          `,
        ).run(taskId, runId, title, goal, position, specText, timestamp, timestamp);

        appendEventInTransaction(
          {
            eventId: idGenerator(),
            runId,
            taskId,
            type: 'task.created',
            payload: {
              status: 'pending',
              position,
            },
          },
          timestamp,
        );

        return getTaskOrThrow(taskId);
      });
    },

    getTask(taskId: string): TaskRecord | null {
      ensureOpen();
      return mapTaskRow(
        db.prepare(
          `
            SELECT taskId, runId, title, goal, status, position, spec, createdAt, updatedAt, startedAt, completedAt
            FROM tasks
            WHERE taskId = ?
          `,
        ).get(taskId),
      );
    },

    listTasks(runId: string): TaskRecord[] {
      ensureOpen();
      const rows = db.prepare(
        `
          SELECT taskId, runId, title, goal, status, position, spec, createdAt, updatedAt, startedAt, completedAt
          FROM tasks
          WHERE runId = ?
          ORDER BY position, createdAt, taskId
        `,
      ).all(runId);
      return rows.map((row) => mapTaskRow(row) as TaskRecord);
    },

    transitionTask(taskId: string, status: TaskStatus): TaskRecord {
      ensureOpen();
      if (!TASK_STATUSES.includes(status)) {
        throw new OrchestrationError('INVALID_TRANSITION', `Invalid task status ${status}.`);
      }

      return runInTransaction(() => {
        const task = getTaskRowOrThrow(taskId);
        if (task.status === status) {
          return getTaskOrThrow(taskId);
        }

        assertTaskTransition(task.status, status);
        const timestamp = getNowIso();
        const nextTask = updateTaskStatusInTransaction(task, status, timestamp);

        appendEventInTransaction(
          {
            eventId: idGenerator(),
            runId: task.runId,
            taskId,
            type: 'task.status.changed',
            payload: {
              previousStatus: task.status,
              nextStatus: status,
            },
          },
          timestamp,
        );

        return nextTask;
      });
    },

    addDependency(taskId: string, dependsOnTaskId: string): TaskDependencyRecord {
      ensureOpen();
      return runInTransaction(() => {
        if (taskId === dependsOnTaskId) {
          throw new OrchestrationError('INVALID_TRANSITION', 'Task cannot depend on itself.');
        }

        const task = getTaskOrThrow(taskId);
        const dependency = getTaskOrThrow(dependsOnTaskId);
        if (task.runId !== dependency.runId) {
          throw new OrchestrationError(
            'CROSS_RUN_DEPENDENCY',
            `Task ${taskId} and dependency ${dependsOnTaskId} must belong to the same run.`,
          );
        }

        const existing = db.prepare(
          `
            SELECT taskId, dependsOnTaskId, createdAt
            FROM task_dependencies
            WHERE taskId = ? AND dependsOnTaskId = ?
          `,
        ).get(taskId, dependsOnTaskId) as TaskDependencyRecord | undefined;

        if (existing) {
          throw new OrchestrationError(
            'INVALID_TRANSITION',
            `Dependency ${taskId} -> ${dependsOnTaskId} already exists.`,
          );
        }

        if (detectCycle(taskId, dependsOnTaskId)) {
          throw new OrchestrationError(
            'DEPENDENCY_CYCLE',
            `Adding dependency ${taskId} -> ${dependsOnTaskId} would create a cycle.`,
          );
        }

        const timestamp = getNowIso();
        db.prepare(
          `
            INSERT INTO task_dependencies (taskId, dependsOnTaskId, createdAt)
            VALUES (?, ?, ?)
          `,
        ).run(taskId, dependsOnTaskId, timestamp);

        appendEventInTransaction(
          {
            eventId: idGenerator(),
            runId: task.runId,
            taskId,
            type: 'dependency.added',
            payload: {
              dependsOnTaskId,
            },
          },
          timestamp,
        );

        return {
          taskId,
          dependsOnTaskId,
          createdAt: timestamp,
        };
      });
    },

    listDependencies(runId: string): TaskDependencyRecord[] {
      ensureOpen();
      return (db.prepare(
        `
          SELECT task_dependencies.taskId, task_dependencies.dependsOnTaskId, task_dependencies.createdAt
          FROM task_dependencies
          INNER JOIN tasks ON tasks.taskId = task_dependencies.taskId
          WHERE tasks.runId = ?
          ORDER BY task_dependencies.taskId, task_dependencies.dependsOnTaskId
        `,
      ).all(runId) as unknown as TaskDependencyRecord[]);
    },

    getReadyTasks(runId: string): TaskRecord[] {
      ensureOpen();
      const rows = db.prepare(
        `
          SELECT tasks.taskId, tasks.runId, tasks.title, tasks.goal, tasks.status, tasks.position, tasks.spec,
                 tasks.createdAt, tasks.updatedAt, tasks.startedAt, tasks.completedAt
          FROM tasks
          WHERE tasks.runId = ?
            AND tasks.status = 'pending'
            AND NOT EXISTS (
              SELECT 1
              FROM task_dependencies
              INNER JOIN tasks AS dependency_tasks ON dependency_tasks.taskId = task_dependencies.dependsOnTaskId
              WHERE task_dependencies.taskId = tasks.taskId
                AND dependency_tasks.status <> 'passed'
            )
          ORDER BY tasks.position, tasks.createdAt, tasks.taskId
        `,
      ).all(runId);
      return rows.map((row) => mapTaskRow(row) as TaskRecord);
    },

    createAttempt(input: CreateAttemptInput): AttemptRecord {
      ensureOpen();
      const attemptId = ensureNonEmptyString(input.attemptId, 'attemptId');
      const taskId = ensureNonEmptyString(input.taskId, 'taskId');
      const hostInstanceId = ensureNonEmptyString(input.hostInstanceId, 'hostInstanceId');

      const existing = this.getAttempt(attemptId);
      if (existing) {
        if (existing.taskId === taskId && existing.hostInstanceId === hostInstanceId) {
          return existing;
        }
        throw new OrchestrationError(
          'IDEMPOTENCY_CONFLICT',
          `Attempt ${attemptId} already exists with different input.`,
        );
      }

      return runInTransaction(() => {
        const { task, run } = resolveTaskAttemptContext(taskId);
        if (task.status !== 'pending' && task.status !== 'failed') {
          throw new OrchestrationError(
            'INVALID_TRANSITION',
            `Attempt cannot start while task ${taskId} is ${task.status}.`,
          );
        }

        const timestamp = getNowIso();
        const ordinal =
          getCountValue(
            db.prepare(
              `
                SELECT COALESCE(MAX(ordinal), 0) + 1
                FROM attempts
                WHERE taskId = ?
              `,
            ).get(taskId),
          );

        db.prepare(
          `
            INSERT INTO attempts (
              attemptId,
              taskId,
              ordinal,
              status,
              hostInstanceId,
              createdAt,
              startedAt,
              endedAt
            ) VALUES (?, ?, ?, 'running', ?, ?, ?, NULL)
          `,
        ).run(attemptId, taskId, ordinal, hostInstanceId, timestamp, timestamp);

        db.prepare(
          `
            UPDATE tasks
            SET status = 'running',
                updatedAt = ?,
                startedAt = COALESCE(startedAt, ?),
                completedAt = NULL
            WHERE taskId = ?
          `,
        ).run(timestamp, timestamp, taskId);

        appendEventInTransaction(
          {
            eventId: idGenerator(),
            runId: run.runId,
            taskId,
            type: 'task.status.changed',
            payload: {
              previousStatus: task.status,
              nextStatus: 'running',
            },
          },
          timestamp,
        );

        appendEventInTransaction(
          {
            eventId: idGenerator(),
            runId: run.runId,
            taskId,
            attemptId,
            type: 'attempt.created',
            payload: {
              ordinal,
              status: 'running',
              hostInstanceId,
            },
          },
          timestamp,
        );

        return getAttemptOrThrow(attemptId);
      });
    },

    getAttempt(attemptId: string): AttemptRecord | null {
      ensureOpen();
      return mapAttemptRow(
        db.prepare(
          `
            SELECT attemptId, taskId, ordinal, status, hostInstanceId, createdAt, startedAt, endedAt
            FROM attempts
            WHERE attemptId = ?
          `,
        ).get(attemptId),
      );
    },

    listAttempts(taskId: string): AttemptRecord[] {
      ensureOpen();
      const rows = db.prepare(
        `
          SELECT attemptId, taskId, ordinal, status, hostInstanceId, createdAt, startedAt, endedAt
          FROM attempts
          WHERE taskId = ?
          ORDER BY ordinal, attemptId
        `,
      ).all(taskId);
      return rows.map((row) => mapAttemptRow(row) as AttemptRecord);
    },

    transitionAttempt(attemptId: string, status: AttemptStatus): AttemptRecord {
      ensureOpen();
      if (!ATTEMPT_STATUSES.includes(status)) {
        throw new OrchestrationError('INVALID_TRANSITION', `Invalid attempt status ${status}.`);
      }

      return runInTransaction(() => {
        const attempt = getAttemptOrThrow(attemptId);
        if (attempt.status === status) {
          return attempt;
        }

        assertAttemptTransition(attempt.status, status);
        const timestamp = getNowIso();
        db.prepare(
          `
            UPDATE attempts
            SET status = ?, endedAt = ?
            WHERE attemptId = ?
          `,
        ).run(status, timestamp, attemptId);

        const task = getTaskOrThrow(attempt.taskId);
        appendEventInTransaction(
          {
            eventId: idGenerator(),
            runId: task.runId,
            taskId: task.taskId,
            attemptId,
            type: 'attempt.status.changed',
            payload: {
              previousStatus: attempt.status,
              nextStatus: status,
            },
          },
          timestamp,
        );

        return getAttemptOrThrow(attemptId);
      });
    },

    appendEvent(input: AppendEventInput): OrchestrationEventRecord {
      ensureOpen();
      return runInTransaction(() => appendEventInTransaction(input, getNowIso()));
    },

    listEvents(options?: { sinceSeq?: number | undefined }): OrchestrationEventRecord[] {
      ensureOpen();
      const sinceSeq = options?.sinceSeq ?? 0;
      const rows = db.prepare(
        `
          SELECT seq, eventId, runId, taskId, attemptId, type, createdAt, payload
          FROM events
          WHERE seq > ?
          ORDER BY seq
        `,
      ).all(sinceSeq);
      return rows.map((row) => mapEventRow(row) as OrchestrationEventRecord);
    },

    findInterruptedAttempts(liveHostInstanceId: string): AttemptRecord[] {
      ensureOpen();
      const rows = db.prepare(
        `
          SELECT attemptId, taskId, ordinal, status, hostInstanceId, createdAt, startedAt, endedAt
          FROM attempts
          WHERE status = 'running' AND hostInstanceId <> ?
          ORDER BY createdAt, attemptId
        `,
      ).all(liveHostInstanceId);
      return rows.map((row) => mapAttemptRow(row) as AttemptRecord);
    },
  };
}
