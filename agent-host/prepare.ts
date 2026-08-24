import { mkdir, readFile } from 'node:fs/promises';

import { composeHostIdentity, createInstanceIdentity, readOrCreateHostId } from './lib/identity.ts';
import { acquireLock, LockAcquisitionError, releaseLockIfOwned } from './lib/lock.ts';
import { isOrchestrationError, type AttemptRecord, type RunRecord, type TaskRecord } from './lib/orchestrationTypes.ts';
import { resolveCanonicalRepo } from './lib/repo.ts';
import { resolveStatePaths } from './lib/statePaths.ts';
import { openOrchestrationStore, type OrchestrationStore } from './lib/store.ts';
import { SCHEMA_VERSION, type InstanceIdentity } from './types.ts';

const EXIT_SUCCESS = 0;
const EXIT_FAILURE = 1;
const MESSAGE_LIMIT = 256;

export interface PrepareCliOptions {
  title: string;
  goal?: string;
  taskTitle: string;
  taskGoal?: string;
  json: boolean;
}

export interface PrepareCommandOptions extends PrepareCliOptions {
  startDir?: string;
  localAppData?: string;
}

export interface PrepareSummary {
  runId: string | null;
  taskId: string | null;
  attemptId: string | null;
  hostInstanceId: string | null;
  runStatus: string | null;
  taskStatus: string | null;
  attemptStatus: string | null;
  runCreatedAt: string | null;
  taskCreatedAt: string | null;
  attemptCreatedAt: string | null;
  partialCreation: boolean;
  errorCode: string | null;
  message: string | null;
}

export interface PrepareCommandResult {
  exitCode: number;
  summary: PrepareSummary;
}

export interface PreparedDurableRecords {
  run: RunRecord;
  task: TaskRecord;
  attempt: AttemptRecord;
}

export interface PrepareCommandDependencies {
  now?: (() => Date) | undefined;
  idGenerator?: (() => string) | undefined;
  resolveCanonicalRepo?: ((startDir?: string) => Promise<string>) | undefined;
  readHostVersion?: ((canonicalRepoPath: string) => Promise<string>) | undefined;
  readOrCreateHostId?: ((hostIdPath: string) => Promise<string>) | undefined;
  createInstanceIdentity?: ((now?: Date) => InstanceIdentity) | undefined;
  acquireLock?: typeof acquireLock | undefined;
  releaseLockIfOwned?: typeof releaseLockIfOwned | undefined;
  openOrchestrationStore?: typeof openOrchestrationStore | undefined;
}

class PrepareCliError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PrepareCliError';
    this.code = code;
  }
}

function sanitizeMessage(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().slice(0, MESSAGE_LIMIT);
}

async function readHostVersion(_canonicalRepoPath: string): Promise<string> {
  const packageJsonPath = new URL('../package.json', import.meta.url);
  const raw = await readFile(packageJsonPath, 'utf8');
  const parsed = JSON.parse(raw) as { version?: unknown };

  if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
    throw new Error('package.json version is missing.');
  }

  return parsed.version;
}

function nextOptionValue(argv: readonly string[], index: number, token: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new PrepareCliError('ARGUMENT_INVALID', `Missing value for ${token}.`);
  }
  return value;
}

function requireNonEmptyValue(value: string | undefined, optionName: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PrepareCliError('ARGUMENT_INVALID', `Missing required option ${optionName}.`);
  }
  return value;
}

export function parsePrepareArgs(argv: readonly string[]): PrepareCliOptions {
  let title: string | undefined;
  let goal: string | undefined;
  let taskTitle: string | undefined;
  let taskGoal: string | undefined;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    switch (token) {
      case '--title':
        title = nextOptionValue(argv, index, token);
        index += 1;
        break;
      case '--goal':
        goal = nextOptionValue(argv, index, token);
        index += 1;
        break;
      case '--task-title':
        taskTitle = nextOptionValue(argv, index, token);
        index += 1;
        break;
      case '--task-goal':
        taskGoal = nextOptionValue(argv, index, token);
        index += 1;
        break;
      case '--json':
        json = true;
        break;
      default:
        throw new PrepareCliError('ARGUMENT_INVALID', `Unknown option ${token}.`);
    }
  }

  return {
    title: requireNonEmptyValue(title, '--title'),
    goal,
    taskTitle: requireNonEmptyValue(taskTitle, '--task-title'),
    taskGoal,
    json,
  };
}

function buildRecordId(prefix: 'run' | 'task' | 'attempt', idGenerator: () => string): string {
  return `${prefix}-${idGenerator()}`;
}

function getSafeErrorCode(error: unknown): string {
  if (error instanceof PrepareCliError) {
    return error.code;
  }
  if (error instanceof LockAcquisitionError) {
    if (error.reason === 'running') {
      return 'HOST_RUNNING';
    }
    if (error.reason === 'state-corrupt') {
      return 'HOST_STATE_CORRUPT';
    }
    return 'HOST_LOCK_UNAVAILABLE';
  }
  if (isOrchestrationError(error)) {
    return error.code;
  }
  return 'PREPARE_FAILED';
}

function getSafeMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.length > 0) {
    return sanitizeMessage(error.message);
  }
  return null;
}

function collectPartialState(
  store: Pick<OrchestrationStore, 'getRun' | 'getTask' | 'getAttempt'> | null,
  generatedIds: Partial<{ runId: string; taskId: string; attemptId: string }> | undefined,
): {
  run: RunRecord | null;
  task: TaskRecord | null;
  attempt: AttemptRecord | null;
} {
  if (!store || !generatedIds) {
    return { run: null, task: null, attempt: null };
  }

  const run = generatedIds.runId ? store.getRun(generatedIds.runId) : null;
  const taskCandidate = generatedIds.taskId ? store.getTask(generatedIds.taskId) : null;
  const task = run && taskCandidate?.runId === run.runId ? taskCandidate : null;
  const attemptCandidate = generatedIds.attemptId ? store.getAttempt(generatedIds.attemptId) : null;
  const attempt = task && attemptCandidate?.taskId === task.taskId ? attemptCandidate : null;

  return { run, task, attempt };
}

export function prepareDurableRecords(options: {
  store: Pick<OrchestrationStore, 'createRun' | 'createTask' | 'createAttempt'>;
  runId: string;
  title: string;
  goal?: string;
  taskId: string;
  taskTitle: string;
  taskGoal?: string;
  attemptId: string;
  hostInstanceId: string;
}): PreparedDurableRecords {
  const run = options.store.createRun({
    runId: options.runId,
    title: options.title,
    goal: options.goal,
  });

  const task = options.store.createTask({
    taskId: options.taskId,
    runId: run.runId,
    title: options.taskTitle,
    goal: options.taskGoal,
  });

  const attempt = options.store.createAttempt({
    attemptId: options.attemptId,
    taskId: task.taskId,
    hostInstanceId: options.hostInstanceId,
  });

  return { run, task, attempt };
}

export function buildPrepareSummary(options: {
  generatedIds?: Partial<{ runId: string; taskId: string; attemptId: string }> | undefined;
  hostInstanceId?: string | undefined;
  run?: RunRecord | null | undefined;
  task?: TaskRecord | null | undefined;
  attempt?: AttemptRecord | null | undefined;
  error?: unknown;
}): PrepareSummary {
  const partialCreation = Boolean(options.run || options.task || options.attempt);

  return {
    runId: options.run?.runId ?? options.generatedIds?.runId ?? null,
    taskId: options.task?.taskId ?? options.generatedIds?.taskId ?? null,
    attemptId: options.attempt?.attemptId ?? options.generatedIds?.attemptId ?? null,
    hostInstanceId: options.attempt?.hostInstanceId ?? options.hostInstanceId ?? null,
    runStatus: options.run?.status ?? null,
    taskStatus: options.task?.status ?? null,
    attemptStatus: options.attempt?.status ?? null,
    runCreatedAt: options.run?.createdAt ?? null,
    taskCreatedAt: options.task?.createdAt ?? null,
    attemptCreatedAt: options.attempt?.createdAt ?? null,
    partialCreation,
    errorCode: options.error ? getSafeErrorCode(options.error) : null,
    message: options.error ? getSafeMessage(options.error) : null,
  };
}

export async function runPrepareCommand(
  options: PrepareCommandOptions,
  dependencies: PrepareCommandDependencies = {},
): Promise<PrepareCommandResult> {
  const now = dependencies.now ?? (() => new Date());
  const idGenerator = dependencies.idGenerator ?? globalThis.crypto.randomUUID.bind(globalThis.crypto);
  const resolveRepo = dependencies.resolveCanonicalRepo ?? resolveCanonicalRepo;
  const readVersion = dependencies.readHostVersion ?? readHostVersion;
  const ensureHostId = dependencies.readOrCreateHostId ?? readOrCreateHostId;
  const createIdentity = dependencies.createInstanceIdentity ?? createInstanceIdentity;
  const acquireHostLock = dependencies.acquireLock ?? acquireLock;
  const releaseHostLock = dependencies.releaseLockIfOwned ?? releaseLockIfOwned;
  const openStore = dependencies.openOrchestrationStore ?? openOrchestrationStore;

  let store: OrchestrationStore | null = null;
  let statePaths: ReturnType<typeof resolveStatePaths> | null = null;
  let instanceIdentity: InstanceIdentity | null = null;
  let generatedIds: Partial<{ runId: string; taskId: string; attemptId: string }> | undefined;

  try {
    const canonicalRepoPath = await resolveRepo(options.startDir);
    statePaths = resolveStatePaths({
      canonicalRepoPath,
      localAppData: options.localAppData,
    });

    await Promise.all([
      mkdir(statePaths.baseDir, { recursive: true }),
      mkdir(statePaths.repoStateDir, { recursive: true }),
    ]);

    const hostVersion = await readVersion(canonicalRepoPath);
    const hostId = await ensureHostId(statePaths.hostIdPath);
    instanceIdentity = createIdentity(now());
    const hostIdentity = composeHostIdentity({
      hostId,
      hostVersion,
      canonicalRepoPath,
      repoKey: statePaths.repoKey,
    });

    await acquireHostLock({
      statePaths,
      lock: {
        schemaVersion: SCHEMA_VERSION,
        ...hostIdentity,
        ...instanceIdentity,
      },
    });

    store = openStore({
      dbPath: statePaths.orchestrationDbPath,
      repoKey: statePaths.repoKey,
      hostId,
      hostVersion,
    });

    const runId = buildRecordId('run', idGenerator);
    const taskId = buildRecordId('task', idGenerator);
    const attemptId = buildRecordId('attempt', idGenerator);
    generatedIds = { runId, taskId, attemptId };

    const prepared = prepareDurableRecords({
      store,
      runId,
      title: options.title,
      goal: options.goal,
      taskId,
      taskTitle: options.taskTitle,
      taskGoal: options.taskGoal,
      attemptId,
      hostInstanceId: instanceIdentity.instanceId,
    });

    return {
      exitCode: EXIT_SUCCESS,
      summary: buildPrepareSummary({
        generatedIds,
        hostInstanceId: instanceIdentity.instanceId,
        run: prepared.run,
        task: store.getTask(prepared.task.taskId),
        attempt: store.getAttempt(prepared.attempt.attemptId),
      }),
    };
  } catch (error) {
    const { run, task, attempt } = collectPartialState(store, generatedIds);

    return {
      exitCode: EXIT_FAILURE,
      summary: buildPrepareSummary({
        generatedIds,
        hostInstanceId: instanceIdentity?.instanceId,
        run,
        task,
        attempt,
        error,
      }),
    };
  } finally {
    store?.close();
    if (statePaths && instanceIdentity) {
      await releaseHostLock(statePaths.lockPath, instanceIdentity.instanceId);
    }
  }
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  dependencies: PrepareCommandDependencies = {},
  output: Pick<NodeJS.WriteStream, 'write'> = process.stdout,
): Promise<number> {
  try {
    const parsed = parsePrepareArgs(argv);
    const result = await runPrepareCommand(parsed, dependencies);
    output.write(`${JSON.stringify(result.summary, null, 2)}\n`);
    return result.exitCode;
  } catch (error) {
    output.write(`${JSON.stringify(buildPrepareSummary({ error }), null, 2)}\n`);
    return EXIT_FAILURE;
  }
}

if (import.meta.main) {
  process.exitCode = await main();
}
