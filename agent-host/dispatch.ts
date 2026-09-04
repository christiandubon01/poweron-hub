import { mkdir, readFile } from 'node:fs/promises';
import type { Readable } from 'node:stream';

import { createEventWriter } from './lib/events.ts';
import { writeHeartbeat } from './lib/heartbeat.ts';
import { composeHostIdentity, readOrCreateHostId } from './lib/identity.ts';
import { acquireLock, LockAcquisitionError, releaseLockIfOwned } from './lib/lock.ts';
import { isOrchestrationError, OrchestrationError, type AttemptRecord, type TaskRecord } from './lib/orchestrationTypes.ts';
import { readRepoStatus, resolveCanonicalRepo } from './lib/repo.ts';
import { inspectOrchestrationDatabase } from './lib/schema.ts';
import { resolveStatePaths } from './lib/statePaths.ts';
import { openOrchestrationStore, type OrchestrationStore } from './lib/store.ts';
import { shutdownHostRuntime } from './index.ts';
import { discoverTools } from './lib/discovery.ts';
import {
  AttemptExecutor,
  createProviderRegistry,
  recoverInterruptedAttempts,
  type AttemptExecutionInput,
  type AttemptExecutionOutcome,
} from './providers/executor.ts';
import type { PermissionProfile, ProviderAdapter, ProviderId } from './providers/types.ts';
import {
  HEARTBEAT_INTERVAL_MS,
  REPO_STATUS_REFRESH_MS,
  SCHEMA_VERSION,
  type HeartbeatDocument,
  type InstanceIdentity,
  type ProviderDiscoveryRecord,
  type RepoStatus,
} from './types.ts';

const PROVIDER_IDS = ['claude', 'codex', 'ollama'] as const satisfies readonly ProviderId[];
const PERMISSION_PROFILES = ['read-only-reviewer', 'task-implementer', 'verifier'] as const satisfies readonly PermissionProfile[];
const EXIT_SUCCESS = 0;
const EXIT_FAILURE = 1;
const MESSAGE_LIMIT = 256;

export interface DispatchCliOptions {
  runId: string;
  taskId: string;
  attemptId: string;
  provider: ProviderId;
  requestedModel?: string;
  reasoningEffort?: string;
  permissionProfile: PermissionProfile;
  timeoutMs?: number;
  json: boolean;
}

export interface DispatchCommandOptions extends DispatchCliOptions {
  prompt: string;
  startDir?: string;
  localAppData?: string;
}

export interface DispatchSummary {
  runId: string;
  taskId: string;
  attemptId: string;
  executionId: string | null;
  provider: ProviderId;
  requestedModel: string | null;
  reportedModel: string | null;
  reportedModelSource: string | null;
  permissionProfile: PermissionProfile;
  providerSuccess: boolean;
  providerTerminalState: string | null;
  errorCode: string | null;
  message: string | null;
  attemptStatus: string | null;
  taskStatus: string | null;
  usage: Record<string, number | string> | null;
  sessionId: string | null;
}

export interface DispatchCommandResult {
  exitCode: number;
  summary: DispatchSummary;
}

export interface DispatchExecutor {
  execute(input: AttemptExecutionInput): Promise<AttemptExecutionOutcome>;
  cancel(attemptId: string): boolean;
  shutdown(timeoutMs?: number): Promise<unknown>;
}

export interface DispatchStoreReader {
  getRun(runId: string): { runId: string } | null;
  getTask(taskId: string): TaskRecord | null;
  getAttempt(attemptId: string): AttemptRecord | null;
}

export interface DispatchCommandDependencies {
  now?: (() => Date) | undefined;
  pid?: number | undefined;
  resolveCanonicalRepo?: ((startDir?: string) => Promise<string>) | undefined;
  readHostVersion?: ((canonicalRepoPath: string) => Promise<string>) | undefined;
  readOrCreateHostId?: ((hostIdPath: string) => Promise<string>) | undefined;
  readRepoStatus?: ((canonicalRepoPath: string) => Promise<RepoStatus>) | undefined;
  inspectOrchestrationDatabase?: typeof inspectOrchestrationDatabase | undefined;
  openOrchestrationStore?: typeof openOrchestrationStore | undefined;
  acquireLock?: typeof acquireLock | undefined;
  releaseLockIfOwned?: typeof releaseLockIfOwned | undefined;
  discoverTools?: (() => Promise<ProviderDiscoveryRecord[]>) | undefined;
  createProviderRegistry?: ((records: readonly ProviderDiscoveryRecord[]) => ReadonlyMap<ProviderId, ProviderAdapter>) | undefined;
  createAttemptExecutor?:
    | ((dependencies: { store: OrchestrationStore; registry: ReadonlyMap<ProviderId, ProviderAdapter>; now: () => Date }) => DispatchExecutor)
    | undefined;
  subscribeToTermination?: ((handler: (signal: string) => void) => (() => void)) | undefined;
}

class DispatchCliError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DispatchCliError';
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

function parseProviderId(raw: string): ProviderId {
  if ((PROVIDER_IDS as readonly string[]).includes(raw)) {
    return raw as ProviderId;
  }
  throw new DispatchCliError('ARGUMENT_INVALID', `Unknown provider "${raw}". Expected one of: ${PROVIDER_IDS.join(', ')}.`);
}

function parsePermissionProfile(raw: string): PermissionProfile {
  if ((PERMISSION_PROFILES as readonly string[]).includes(raw)) {
    return raw as PermissionProfile;
  }
  throw new DispatchCliError(
    'ARGUMENT_INVALID',
    `Unknown permission profile "${raw}". Expected one of: ${PERMISSION_PROFILES.join(', ')}.`,
  );
}

function parsePositiveInteger(raw: string, fieldName: string): number {
  if (!/^\d+$/u.test(raw)) {
    throw new DispatchCliError('ARGUMENT_INVALID', `${fieldName} must be a positive integer.`);
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new DispatchCliError('ARGUMENT_INVALID', `${fieldName} must be a positive integer.`);
  }

  return parsed;
}

function requireOption(options: Partial<Record<keyof DispatchCliOptions, unknown>>, key: keyof DispatchCliOptions): string {
  const value = options[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new DispatchCliError('ARGUMENT_INVALID', `Missing required option --${key.replace(/[A-Z]/gu, (char) => `-${char.toLowerCase()}`)}.`);
  }
  return value;
}

export function parseDispatchArgs(argv: readonly string[]): DispatchCliOptions {
  const parsed: Partial<DispatchCliOptions> = {
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const nextValue = (): string => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new DispatchCliError('ARGUMENT_INVALID', `Missing value for ${token}.`);
      }
      index += 1;
      return value;
    };

    switch (token) {
      case '--run':
      case '--run-id':
        parsed.runId = nextValue();
        break;
      case '--task':
      case '--task-id':
        parsed.taskId = nextValue();
        break;
      case '--attempt':
      case '--attempt-id':
        parsed.attemptId = nextValue();
        break;
      case '--provider':
        parsed.provider = parseProviderId(nextValue());
        break;
      case '--model':
        parsed.requestedModel = nextValue();
        break;
      case '--reasoning-effort':
        parsed.reasoningEffort = nextValue();
        break;
      case '--permission-profile':
        parsed.permissionProfile = parsePermissionProfile(nextValue());
        break;
      case '--timeout-ms':
        parsed.timeoutMs = parsePositiveInteger(nextValue(), '--timeout-ms');
        break;
      case '--json':
        parsed.json = true;
        break;
      default:
        throw new DispatchCliError('ARGUMENT_INVALID', `Unknown option ${token}.`);
    }
  }

  return {
    runId: requireOption(parsed, 'runId'),
    taskId: requireOption(parsed, 'taskId'),
    attemptId: requireOption(parsed, 'attemptId'),
    provider: parseProviderId(requireOption(parsed, 'provider')),
    requestedModel: parsed.requestedModel,
    reasoningEffort: parsed.reasoningEffort,
    permissionProfile: parsePermissionProfile(requireOption(parsed, 'permissionProfile')),
    timeoutMs: parsed.timeoutMs,
    json: Boolean(parsed.json),
  };
}

export async function readPromptFromStdin(
  stdin: Pick<Readable, 'on' | 'resume'> & { isTTY?: boolean; setEncoding?: (encoding: BufferEncoding) => void },
): Promise<string> {
  if (stdin.isTTY) {
    throw new DispatchCliError('PROMPT_STDIN_REQUIRED', 'Prompt text must be provided through stdin.');
  }

  stdin.setEncoding?.('utf8');
  const chunks: string[] = [];

  return await new Promise<string>((resolve, reject) => {
    stdin.on('data', (chunk: string | Buffer) => {
      chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    });
    stdin.on('end', () => {
      if (chunks.length === 0) {
        reject(new DispatchCliError('PROMPT_STDIN_REQUIRED', 'Prompt text must be provided through stdin.'));
        return;
      }
      resolve(chunks.join(''));
    });
    stdin.on('error', (error) => {
      reject(error);
    });
    stdin.resume();
  });
}

function createDispatchInstanceIdentity(hostInstanceId: string, now: Date, pid: number): InstanceIdentity {
  if (hostInstanceId.length === 0) {
    throw new DispatchCliError('INVALID_ATTEMPT_OWNER', 'Attempt hostInstanceId is missing.');
  }

  return {
    instanceId: hostInstanceId,
    pid,
    startedAt: now.toISOString(),
  };
}

function createHeartbeatDocument(options: {
  hostId: string;
  hostVersion: string;
  canonicalRepoPath: string;
  repoKey: string;
  instanceId: string;
  pid: number;
  startedAt: string;
  repoStatus: RepoStatus;
  state: HeartbeatDocument['state'];
  providers: ProviderDiscoveryRecord[];
  stoppedAt?: string;
}): HeartbeatDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    hostId: options.hostId,
    hostVersion: options.hostVersion,
    canonicalRepoPath: options.canonicalRepoPath,
    repoKey: options.repoKey,
    instanceId: options.instanceId,
    pid: options.pid,
    startedAt: options.startedAt,
    lastHeartbeatAt: new Date().toISOString(),
    state: options.state,
    stoppedAt: options.stoppedAt,
    branch: options.repoStatus.branch,
    headSha: options.repoStatus.headSha,
    dirty: options.repoStatus.dirty,
    providers: options.providers,
  };
}

function assertDispatchIdentifiers(store: DispatchStoreReader, options: {
  runId: string;
  taskId: string;
  attemptId: string;
}): { task: TaskRecord; attempt: AttemptRecord } {
  const run = store.getRun(options.runId);
  if (!run) {
    throw new OrchestrationError('NOT_FOUND', `Run ${options.runId} was not found.`);
  }

  const task = store.getTask(options.taskId);
  if (!task) {
    throw new OrchestrationError('NOT_FOUND', `Task ${options.taskId} was not found.`);
  }

  const attempt = store.getAttempt(options.attemptId);
  if (!attempt) {
    throw new OrchestrationError('NOT_FOUND', `Attempt ${options.attemptId} was not found.`);
  }

  if (task.runId !== run.runId) {
    throw new OrchestrationError(
      'RELATIONSHIP_MISMATCH',
      `Task ${options.taskId} does not belong to run ${options.runId}.`,
    );
  }

  if (attempt.taskId !== task.taskId) {
    throw new OrchestrationError(
      'RELATIONSHIP_MISMATCH',
      `Attempt ${options.attemptId} does not belong to task ${options.taskId}.`,
    );
  }

  return { task, attempt };
}

function summarizeUsage(value: AttemptExecutionOutcome['result']['usage'] | undefined): Record<string, number | string> | null {
  if (!value) {
    return null;
  }

  const usage: Record<string, number | string> = {
    source: value.source,
  };

  if (typeof value.inputTokens === 'number') {
    usage.inputTokens = value.inputTokens;
  }
  if (typeof value.outputTokens === 'number') {
    usage.outputTokens = value.outputTokens;
  }
  if (typeof value.cachedInputTokens === 'number') {
    usage.cachedInputTokens = value.cachedInputTokens;
  }
  if (typeof value.reasoningTokens === 'number') {
    usage.reasoningTokens = value.reasoningTokens;
  }
  if (typeof value.totalTokens === 'number') {
    usage.totalTokens = value.totalTokens;
  }

  return Object.keys(usage).length > 0 ? usage : null;
}

function getSafeErrorCode(error: unknown): string {
  if (error instanceof DispatchCliError) {
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
  return 'DISPATCH_FAILED';
}

function getSafeMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.length > 0) {
    return sanitizeMessage(error.message);
  }
  return null;
}

export function buildDispatchSummary(options: {
  input: Pick<DispatchCommandOptions, 'runId' | 'taskId' | 'attemptId' | 'provider' | 'requestedModel' | 'permissionProfile'>;
  outcome?: AttemptExecutionOutcome | undefined;
  attempt?: AttemptRecord | null | undefined;
  task?: TaskRecord | null | undefined;
  error?: unknown;
}): DispatchSummary {
  return {
    runId: options.input.runId,
    taskId: options.input.taskId,
    attemptId: options.input.attemptId,
    executionId: options.outcome?.executionId ?? null,
    provider: options.input.provider,
    requestedModel: options.outcome?.result.model.requestedModel ?? options.input.requestedModel ?? null,
    reportedModel: options.outcome?.result.model.reportedModel ?? null,
    reportedModelSource: options.outcome?.result.model.reportedModelSource ?? null,
    permissionProfile: options.input.permissionProfile,
    providerSuccess: options.outcome?.result.provider.success ?? false,
    providerTerminalState: options.outcome?.result.provider.terminalState ?? null,
    errorCode: options.error ? getSafeErrorCode(options.error) : options.outcome?.result.provider.errorCode ?? null,
    message: options.error ? getSafeMessage(options.error) : null,
    attemptStatus: options.attempt?.status ?? options.outcome?.attempt.status ?? null,
    taskStatus: options.task?.status ?? null,
    usage: summarizeUsage(options.outcome?.result.usage),
    sessionId: options.outcome?.result.session.sessionId ?? null,
  };
}

export async function dispatchAttempt(options: {
  input: DispatchCommandOptions;
  executor: DispatchExecutor;
  store: Pick<DispatchStoreReader, 'getTask' | 'getAttempt'>;
  hostInstanceId: string;
  workingDirectory: string;
}): Promise<DispatchCommandResult> {
  try {
    const outcome = await options.executor.execute({
      runId: options.input.runId,
      taskId: options.input.taskId,
      attemptId: options.input.attemptId,
      provider: options.input.provider,
      prompt: options.input.prompt,
      requestedModel: options.input.requestedModel,
      reasoningEffort: options.input.reasoningEffort,
      permissionProfile: options.input.permissionProfile,
      timeoutMs: options.input.timeoutMs,
      workingDirectory: options.workingDirectory,
      hostInstanceId: options.hostInstanceId,
    });

    const attempt = options.store.getAttempt(options.input.attemptId);
    const task = options.store.getTask(options.input.taskId);
    const accepted = outcome.terminalAttemptStatus === 'passed';
    return {
      exitCode: accepted ? EXIT_SUCCESS : EXIT_FAILURE,
      summary: buildDispatchSummary({
        input: options.input,
        outcome,
        attempt,
        task,
      }),
    };
  } catch (error) {
    const attempt = options.store.getAttempt(options.input.attemptId);
    const task = options.store.getTask(options.input.taskId);
    return {
      exitCode: EXIT_FAILURE,
      summary: buildDispatchSummary({
        input: options.input,
        attempt,
        task,
        error,
      }),
    };
  }
}

function subscribeProcessTermination(handler: (signal: string) => void): () => void {
  const sigintHandler = (): void => {
    handler('SIGINT');
  };
  const sigtermHandler = (): void => {
    handler('SIGTERM');
  };

  process.on('SIGINT', sigintHandler);
  process.on('SIGTERM', sigtermHandler);

  return () => {
    process.off('SIGINT', sigintHandler);
    process.off('SIGTERM', sigtermHandler);
  };
}

function createDefaultExecutor(dependencies: {
  store: OrchestrationStore;
  registry: ReadonlyMap<ProviderId, ProviderAdapter>;
  now: () => Date;
}): DispatchExecutor {
  return new AttemptExecutor({
    store: dependencies.store,
    registry: dependencies.registry,
    now: dependencies.now,
  });
}

export async function runDispatchCommand(
  options: DispatchCommandOptions,
  dependencies: DispatchCommandDependencies = {},
): Promise<DispatchCommandResult> {
  const now = dependencies.now ?? (() => new Date());
  const pid = dependencies.pid ?? process.pid;
  const resolveRepo = dependencies.resolveCanonicalRepo ?? resolveCanonicalRepo;
  const readVersion = dependencies.readHostVersion ?? readHostVersion;
  const ensureHostId = dependencies.readOrCreateHostId ?? readOrCreateHostId;
  const getRepoStatus = dependencies.readRepoStatus ?? readRepoStatus;
  const inspectDatabase = dependencies.inspectOrchestrationDatabase ?? inspectOrchestrationDatabase;
  const openStore = dependencies.openOrchestrationStore ?? openOrchestrationStore;
  const acquireHostLock = dependencies.acquireLock ?? acquireLock;
  const releaseHostLock = dependencies.releaseLockIfOwned ?? releaseLockIfOwned;
  const discoverProviders = dependencies.discoverTools ?? discoverTools;
  const buildRegistry = dependencies.createProviderRegistry ?? createProviderRegistry;
  const createExecutor = dependencies.createAttemptExecutor ?? createDefaultExecutor;
  const subscribeToTermination = dependencies.subscribeToTermination ?? subscribeProcessTermination;

  let store: OrchestrationStore | null = null;
  let unsubscribeFromTermination: (() => void) | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let statePaths: ReturnType<typeof resolveStatePaths> | null = null;
  let instanceIdentity: InstanceIdentity | null = null;
  let runtimeShutdown: (() => Promise<void>) | null = null;
  let shutdownPromise: Promise<void> | null = null;
  let finalExitCode = EXIT_FAILURE;
  let activeSignal: string | undefined;
  let executor: DispatchExecutor | null = null;

  const runShutdown = async (): Promise<void> => {
    if (shutdownPromise) {
      return await shutdownPromise;
    }

    shutdownPromise = (async () => {
      unsubscribeFromTermination?.();
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }

      if (runtimeShutdown) {
        await runtimeShutdown();
        return;
      }

      store?.close();
      if (statePaths && instanceIdentity) {
        await releaseHostLock(statePaths.lockPath, instanceIdentity.instanceId);
      }
    })();

    await shutdownPromise;
  };

  try {
    const canonicalRepoPath = await resolveRepo(options.startDir);
    statePaths = resolveStatePaths({
      canonicalRepoPath,
      localAppData: options.localAppData,
    });

    const inspection = inspectDatabase({
      dbPath: statePaths.orchestrationDbPath,
      repoKey: statePaths.repoKey,
    });

    if (inspection.database === 'absent') {
      throw new DispatchCliError('DB_ABSENT', `Orchestration database is absent at ${statePaths.orchestrationDbPath}.`);
    }
    if (inspection.database === 'schema-newer') {
      throw new OrchestrationError('SCHEMA_NEWER', 'Orchestration database schema is newer than this host supports.');
    }
    if (inspection.database !== 'ready') {
      throw new OrchestrationError('SCHEMA_CORRUPT', 'Orchestration database is corrupt or unreadable.');
    }

    await Promise.all([
      mkdir(statePaths.baseDir, { recursive: true }),
      mkdir(statePaths.repoStateDir, { recursive: true }),
    ]);

    const hostVersion = await readVersion(canonicalRepoPath);
    const hostId = await ensureHostId(statePaths.hostIdPath);

    store = openStore({
      dbPath: statePaths.orchestrationDbPath,
      repoKey: statePaths.repoKey,
      hostId,
      hostVersion,
    });

    const validated = assertDispatchIdentifiers(store, {
      runId: options.runId,
      taskId: options.taskId,
      attemptId: options.attemptId,
    });

    instanceIdentity = createDispatchInstanceIdentity(validated.attempt.hostInstanceId, now(), pid);
    const hostIdentity = composeHostIdentity({
      hostId,
      hostVersion,
      canonicalRepoPath,
      repoKey: statePaths.repoKey,
    });

    let repoStatus = await getRepoStatus(canonicalRepoPath);
    let providers: ProviderDiscoveryRecord[] = [];
    let lastRepoRefreshAt = Date.now();

    await acquireHostLock({
      statePaths,
      lock: {
        schemaVersion: SCHEMA_VERSION,
        ...hostIdentity,
        ...instanceIdentity,
      },
    });

    const eventWriter = createEventWriter({
      eventsPath: statePaths.eventsPath,
      hostId,
      instanceId: instanceIdentity.instanceId,
      repoKey: statePaths.repoKey,
    });
    const activeStatePaths = statePaths;
    const activeInstanceIdentity = instanceIdentity;

    const writeCurrentHeartbeat = async (
      state: HeartbeatDocument['state'],
      stoppedAt?: string,
    ): Promise<void> => {
      await writeHeartbeat(
        activeStatePaths.heartbeatPath,
        createHeartbeatDocument({
          ...hostIdentity,
          ...activeInstanceIdentity,
          repoStatus,
          state,
          providers,
          stoppedAt,
        }),
      );
    };

    const refreshRepoStatusIfNeeded = async (force: boolean = false): Promise<void> => {
      if (!force && Date.now() - lastRepoRefreshAt < REPO_STATUS_REFRESH_MS) {
        return;
      }
      repoStatus = await getRepoStatus(canonicalRepoPath);
      lastRepoRefreshAt = Date.now();
    };

    executor = createExecutor({
      store,
      registry: buildRegistry([]),
      now,
    });

    runtimeShutdown = async () => {
      await shutdownHostRuntime({
        refreshRepoStatusIfNeeded,
        writeCurrentHeartbeat,
        appendLifecycleEvent: (type, data) => eventWriter.append(type, data).then(() => undefined),
        executorShutdown: async () => {
          await executor?.shutdown();
        },
        releaseLock: () => releaseHostLock(activeStatePaths.lockPath, activeInstanceIdentity.instanceId).then(() => undefined),
        closeOrchestrationStore: () => {
          store?.close();
          store = null;
        },
        finishProcess: async (exitCode) => {
          finalExitCode = finalExitCode === EXIT_SUCCESS ? EXIT_SUCCESS : exitCode;
        },
        signal: activeSignal,
        now,
      });
    };

    recoverInterruptedAttempts(store, instanceIdentity.instanceId);
    await writeCurrentHeartbeat('running');
    await eventWriter.append('host.started', { pid: instanceIdentity.pid, mode: 'dispatch' });
    providers = await discoverProviders();
    executor = createExecutor({
      store,
      registry: buildRegistry(providers),
      now,
    });
    await writeCurrentHeartbeat('running');
    await eventWriter.append('host.discovery.completed', {
      installedTools: providers.filter((provider) => provider.installed).map((provider) => provider.toolId),
      mode: 'dispatch',
    });

    heartbeatTimer = setInterval(() => {
      void (async () => {
        try {
          await refreshRepoStatusIfNeeded();
          await writeCurrentHeartbeat('running');
        } catch {
          // Best effort heartbeat updates only; durable execution state remains canonical.
        }
      })();
    }, HEARTBEAT_INTERVAL_MS);

    unsubscribeFromTermination = subscribeToTermination((signal) => {
      activeSignal = signal;
      finalExitCode = EXIT_FAILURE;
      executor?.cancel(options.attemptId);
      void executor?.shutdown();
    });

    const result = await dispatchAttempt({
      input: options,
      executor,
      store,
      hostInstanceId: instanceIdentity.instanceId,
      workingDirectory: canonicalRepoPath,
    });

    finalExitCode = result.exitCode;
    return {
      exitCode: result.exitCode,
      summary: result.summary,
    };
  } catch (error) {
    const attempt = store?.getAttempt(options.attemptId) ?? null;
    const task = store?.getTask(options.taskId) ?? null;
    finalExitCode = EXIT_FAILURE;

    return {
      exitCode: EXIT_FAILURE,
      summary: buildDispatchSummary({
        input: options,
        attempt,
        task,
        error,
      }),
    };
  } finally {
    await runShutdown();
  }
}

export function getDispatchCliArgs(argv: readonly string[] = process.argv): readonly string[] {
  return argv.slice(2);
}

export async function main(argv: readonly string[] = getDispatchCliArgs()): Promise<number> {
  const parsed = parseDispatchArgs(argv);
  const prompt = await readPromptFromStdin(process.stdin);
  const result = await runDispatchCommand({
    ...parsed,
    prompt,
  });

  process.stdout.write(`${JSON.stringify(result.summary, null, 2)}\n`);
  return result.exitCode;
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    const safeError = buildDispatchSummary({
      input: {
        runId: '',
        taskId: '',
        attemptId: '',
        provider: 'codex',
        requestedModel: undefined,
        permissionProfile: 'read-only-reviewer',
      },
      error,
    });
    process.stdout.write(`${JSON.stringify(safeError, null, 2)}\n`);
    process.exitCode = EXIT_FAILURE;
  }
}
