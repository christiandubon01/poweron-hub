import { mkdir, readFile } from 'node:fs/promises';

import { createInstanceIdentity, composeHostIdentity, readOrCreateHostId } from './lib/identity.ts';
import { acquireLock, LockAcquisitionError, releaseLockIfOwned } from './lib/lock.ts';
import { createEventWriter } from './lib/events.ts';
import { writeHeartbeat } from './lib/heartbeat.ts';
import { discoverTools } from './lib/discovery.ts';
import { readRepoStatus, resolveCanonicalRepo } from './lib/repo.ts';
import { resolveStatePaths } from './lib/statePaths.ts';
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
      await refreshRepoStatusIfNeeded(true);
      await writeCurrentHeartbeat('stopping');
      await eventWriter.append('host.stopping', { signal: 'SIGINT' });
      const stoppedAt = new Date().toISOString();
      await eventWriter.append('host.stopped', { stoppedAt });
      await writeCurrentHeartbeat('stopped', stoppedAt);
      await releaseLockIfOwned(statePaths.lockPath, instanceIdentity.instanceId);
      await finishProcess(0);
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
