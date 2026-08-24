import { mkdir, readFile, stat } from 'node:fs/promises';

import { createInstanceIdentity, composeHostIdentity, readOrCreateHostId } from './lib/identity.ts';
import { acquireLock, LockAcquisitionError, releaseLockIfOwned } from './lib/lock.ts';
import { createEventWriter } from './lib/events.ts';
import { writeHeartbeat } from './lib/heartbeat.ts';
import { discoverTools } from './lib/discovery.ts';
import { openOrchestrationStore } from './lib/store.ts';
import { readRepoStatus, resolveCanonicalRepo } from './lib/repo.ts';
import { resolveStatePaths } from './lib/statePaths.ts';
import { recoverInterruptedAttempts } from './providers/executor.ts';
import {
  HEARTBEAT_INTERVAL_MS,
  REPO_STATUS_REFRESH_MS,
  SCHEMA_VERSION,
  type HeartbeatDocument,
  type ProviderDiscoveryRecord,
  type RepoStatus,
} from './types.ts';

async function readHostVersion(canonicalRepoPath: string): Promise<string> {
  const packageJsonPath = new URL('../package.json', import.meta.url);
  const raw = await readFile(packageJsonPath, 'utf8');
  const parsed = JSON.parse(raw) as { version?: unknown };

  if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
    throw new Error(`package.json version is missing for repo ${canonicalRepoPath}`);
  }

  return parsed.version;
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
  stoppedAt?: string | undefined;
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

function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export interface HostShutdownDependencies {
  refreshRepoStatusIfNeeded(force?: boolean): Promise<void>;
  writeCurrentHeartbeat(state: HeartbeatDocument['state'], stoppedAt?: string): Promise<void>;
  appendLifecycleEvent(type: 'host.stopping' | 'host.stopped', data: Record<string, unknown>): Promise<void>;
  releaseLock(): Promise<void>;
  finishProcess(exitCode: number): Promise<void>;
  executorShutdown?: (() => Promise<unknown>) | undefined;
  closeOrchestrationStore?: (() => void) | undefined;
  signal?: string | undefined;
  now?: (() => Date) | undefined;
}

export async function shutdownHostRuntime(dependencies: HostShutdownDependencies): Promise<void> {
  const now = dependencies.now ?? (() => new Date());
  const signal = dependencies.signal ?? 'SIGINT';

  await dependencies.refreshRepoStatusIfNeeded(true);
  await dependencies.writeCurrentHeartbeat('stopping');
  await dependencies.appendLifecycleEvent('host.stopping', { signal });
  await dependencies.executorShutdown?.();
  const stoppedAt = now().toISOString();
  await dependencies.appendLifecycleEvent('host.stopped', { stoppedAt });
  await dependencies.writeCurrentHeartbeat('stopped', stoppedAt);
  dependencies.closeOrchestrationStore?.();
  await dependencies.releaseLock();
  await dependencies.finishProcess(0);
}

export async function recoverInterruptedAttemptsIfPresent(options: {
  dbPath: string;
  repoKey: string;
  hostId: string;
  hostVersion: string;
  liveHostInstanceId: string;
}): Promise<string[]> {
  if (!(await fileExists(options.dbPath))) {
    return [];
  }

  const store = openOrchestrationStore({
    dbPath: options.dbPath,
    repoKey: options.repoKey,
    hostId: options.hostId,
    hostVersion: options.hostVersion,
  });

  try {
    return recoverInterruptedAttempts(store, options.liveHostInstanceId).map((attempt) => attempt.attemptId);
  } finally {
    store.close();
  }
}

async function main(): Promise<void> {
  const canonicalRepoPath = await resolveCanonicalRepo();
  const statePaths = resolveStatePaths({ canonicalRepoPath });
  await Promise.all([
    mkdir(statePaths.baseDir, { recursive: true }),
    mkdir(statePaths.repoStateDir, { recursive: true }),
  ]);

  const hostVersion = await readHostVersion(canonicalRepoPath);
  const hostId = await readOrCreateHostId(statePaths.hostIdPath);
  const instanceIdentity = createInstanceIdentity();
  const hostIdentity = composeHostIdentity({
    hostId,
    hostVersion,
    canonicalRepoPath,
    repoKey: statePaths.repoKey,
  });

  let repoStatus = await readRepoStatus(canonicalRepoPath);
  let lastRepoRefreshAt = Date.now();
  let providers: ProviderDiscoveryRecord[] = [];
  let shutdownStarted = false;
  let shutdownResolver: (() => void) | null = null;
  let heartbeatInFlight = false;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let errorHandled = false;

  const lockDocument = {
    schemaVersion: SCHEMA_VERSION,
    ...hostIdentity,
    ...instanceIdentity,
  } as const;

  await acquireLock({
    statePaths,
    lock: lockDocument,
  });

  const eventWriter = createEventWriter({
    eventsPath: statePaths.eventsPath,
    hostId,
    instanceId: instanceIdentity.instanceId,
    repoKey: statePaths.repoKey,
  });

  const writeCurrentHeartbeat = async (
    state: HeartbeatDocument['state'],
    stoppedAt?: string,
  ): Promise<void> => {
    const heartbeat = createHeartbeatDocument({
      ...hostIdentity,
      ...instanceIdentity,
      repoStatus,
      state,
      providers,
      stoppedAt,
    });
    await writeHeartbeat(statePaths.heartbeatPath, heartbeat);
  };

  const refreshRepoStatusIfNeeded = async (force: boolean = false): Promise<void> => {
    if (!force && Date.now() - lastRepoRefreshAt < REPO_STATUS_REFRESH_MS) {
      return;
    }

    repoStatus = await readRepoStatus(canonicalRepoPath);
    lastRepoRefreshAt = Date.now();
  };

  const finishProcess = async (exitCode: number): Promise<void> => {
    if (shutdownResolver) {
      shutdownResolver();
    }
    process.exitCode = exitCode;
  };

  const handleFatalError = async (error: unknown): Promise<void> => {
    if (errorHandled || shutdownStarted) {
      return;
    }

    errorHandled = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }

    try {
      await refreshRepoStatusIfNeeded(true);
    } catch {
      // Keep the last known repo status if git refresh fails during fatal shutdown.
    }

    try {
      await writeCurrentHeartbeat('error');
    } catch {
      // Best effort only.
    }

    try {
      await eventWriter.append('host.error', {
        message: sanitizeErrorMessage(error),
      });
    } catch {
      // Best effort only.
    }

    process.stderr.write(`${sanitizeErrorMessage(error)}\n`);
    await finishProcess(1);
  };

  const shutdown = async (): Promise<void> => {
    if (shutdownStarted) {
      return;
    }

    shutdownStarted = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }

    try {
      await shutdownHostRuntime({
        refreshRepoStatusIfNeeded,
        writeCurrentHeartbeat,
        appendLifecycleEvent: (type, data) => eventWriter.append(type, data).then(() => undefined),
        releaseLock: () => releaseLockIfOwned(statePaths.lockPath, instanceIdentity.instanceId).then(() => undefined),
        finishProcess,
      });
    } catch (error) {
      await handleFatalError(error);
    }
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('uncaughtException', (error) => {
    void handleFatalError(error);
  });
  process.on('unhandledRejection', (error) => {
    void handleFatalError(error);
  });

  try {
    await recoverInterruptedAttemptsIfPresent({
      dbPath: statePaths.orchestrationDbPath,
      repoKey: statePaths.repoKey,
      hostId,
      hostVersion,
      liveHostInstanceId: instanceIdentity.instanceId,
    });
    await writeCurrentHeartbeat('running');
    await eventWriter.append('host.started', { pid: instanceIdentity.pid });
    providers = await discoverTools();
    await writeCurrentHeartbeat('running');
    await eventWriter.append('host.discovery.completed', {
      installedTools: providers.filter((provider) => provider.installed).map((provider) => provider.toolId),
    });
  } catch (error) {
    await handleFatalError(error);
    return;
  }

  heartbeatTimer = setInterval(() => {
    if (heartbeatInFlight || shutdownStarted) {
      return;
    }

    heartbeatInFlight = true;
    void (async () => {
      try {
        await refreshRepoStatusIfNeeded();
        await writeCurrentHeartbeat('running');
      } catch (error) {
        await handleFatalError(error);
      } finally {
        heartbeatInFlight = false;
      }
    })();
  }, HEARTBEAT_INTERVAL_MS);

  await new Promise<void>((resolve) => {
    shutdownResolver = resolve;
  });
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    if (error instanceof LockAcquisitionError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    } else {
      process.stderr.write(`${sanitizeErrorMessage(error)}\n`);
      process.exitCode = 1;
    }
  }
}
