import { readFile } from 'node:fs/promises';

import { readHeartbeat, isHeartbeatFresh } from './lib/heartbeat.ts';
import { readLock, isPidAlive } from './lib/lock.ts';
import { resolveCanonicalRepo } from './lib/repo.ts';
import { inspectOrchestrationDatabase } from './lib/schema.ts';
import { resolveStatePaths } from './lib/statePaths.ts';
import {
  HEARTBEAT_STALE_MS,
  isWorkerAvailable,
  parseHeartbeatDocument,
  parseLockDocument,
  type HeartbeatDocument,
  type LockDocument,
  type StatusKind,
  type StatusReport,
} from './types.ts';

function summarizeProviderAvailability(heartbeat: HeartbeatDocument | null): string | null {
  if (!heartbeat) {
    return null;
  }

  const availableWorkers = heartbeat.providers.filter(isWorkerAvailable).map((provider) => provider.displayName);
  const diagnosticTools = heartbeat.providers
    .filter((provider) => provider.installed && !isWorkerAvailable(provider))
    .map((provider) => provider.displayName);

  if (availableWorkers.length === 0 && diagnosticTools.length === 0) {
    return 'No provider CLIs were detected.';
  }

  const parts: string[] = [];
  if (availableWorkers.length > 0) {
    parts.push(`Available workers: ${availableWorkers.join(', ')}`);
  }
  if (diagnosticTools.length > 0) {
    parts.push(`Diagnostic tools: ${diagnosticTools.join(', ')}`);
  }

  return parts.join('. ');
}

export function classifyStatus(options: {
  canonicalRepoPath: string;
  repoKey: string;
  stateDirectory: string;
  lock: LockDocument | null;
  heartbeat: HeartbeatDocument | null;
  lockCorrupt?: boolean | undefined;
  heartbeatCorrupt?: boolean | undefined;
  staleThresholdMs?: number | undefined;
  referenceTime?: Date | undefined;
  pidAliveChecker?: ((pid: number) => boolean) | undefined;
}): StatusReport {
  const diagnostics: string[] = [];
  const staleThresholdMs = options.staleThresholdMs ?? HEARTBEAT_STALE_MS;
  const referenceTime = options.referenceTime ?? new Date();
  const pidAliveChecker = options.pidAliveChecker ?? isPidAlive;

  if (options.lockCorrupt || options.heartbeatCorrupt) {
    if (options.lockCorrupt) {
      diagnostics.push('lock.json is malformed or incomplete.');
    }
    if (options.heartbeatCorrupt) {
      diagnostics.push('heartbeat.json is malformed or incomplete.');
    }
    return {
      status: 'state-corrupt',
      canonicalRepoPath: options.canonicalRepoPath,
      repoKey: options.repoKey,
      stateDirectory: options.stateDirectory,
      diagnostics,
      lock: options.lock,
      heartbeat: options.heartbeat,
    };
  }

  if (!options.lock && !options.heartbeat) {
    diagnostics.push('No prior Agent Host state was found for this repository.');
    return {
      status: 'never-started',
      canonicalRepoPath: options.canonicalRepoPath,
      repoKey: options.repoKey,
      stateDirectory: options.stateDirectory,
      diagnostics,
      lock: null,
      heartbeat: null,
    };
  }

  if (!options.lock && options.heartbeat?.state === 'stopped') {
    diagnostics.push(`Last clean stop was recorded at ${options.heartbeat.stoppedAt ?? options.heartbeat.lastHeartbeatAt}.`);
    const providerSummary = summarizeProviderAvailability(options.heartbeat);
    if (providerSummary) {
      diagnostics.push(providerSummary);
    }
    return {
      status: 'stopped',
      canonicalRepoPath: options.canonicalRepoPath,
      repoKey: options.repoKey,
      stateDirectory: options.stateDirectory,
      diagnostics,
      lock: null,
      heartbeat: options.heartbeat,
    };
  }

  if (!options.lock && options.heartbeat) {
    diagnostics.push('Heartbeat exists without an active lock; state is incomplete or stale.');
    return {
      status: 'stale',
      canonicalRepoPath: options.canonicalRepoPath,
      repoKey: options.repoKey,
      stateDirectory: options.stateDirectory,
      diagnostics,
      lock: null,
      heartbeat: options.heartbeat,
    };
  }

  if (!options.lock) {
    diagnostics.push('No active lock was found.');
    return {
      status: 'never-started',
      canonicalRepoPath: options.canonicalRepoPath,
      repoKey: options.repoKey,
      stateDirectory: options.stateDirectory,
      diagnostics,
      lock: null,
      heartbeat: options.heartbeat,
    };
  }

  const lockOwnerAlive = pidAliveChecker(options.lock.pid);
  const heartbeatMatchesLock = options.heartbeat?.instanceId === options.lock.instanceId;
  const heartbeatFresh = options.heartbeat
    ? isHeartbeatFresh(options.heartbeat, referenceTime, staleThresholdMs)
    : false;

  if (lockOwnerAlive && options.heartbeat && heartbeatMatchesLock && heartbeatFresh && options.heartbeat.state === 'running') {
    diagnostics.push(`Agent Host is running as pid ${options.lock.pid}.`);
    const providerSummary = summarizeProviderAvailability(options.heartbeat);
    if (providerSummary) {
      diagnostics.push(providerSummary);
    }
    return {
      status: 'running',
      canonicalRepoPath: options.canonicalRepoPath,
      repoKey: options.repoKey,
      stateDirectory: options.stateDirectory,
      diagnostics,
      lock: options.lock,
      heartbeat: options.heartbeat,
    };
  }

  if (lockOwnerAlive) {
    diagnostics.push(`Lock owner pid ${options.lock.pid} is alive, but heartbeat is stale or inconsistent.`);
    return {
      status: 'stale',
      canonicalRepoPath: options.canonicalRepoPath,
      repoKey: options.repoKey,
      stateDirectory: options.stateDirectory,
      diagnostics,
      lock: options.lock,
      heartbeat: options.heartbeat,
    };
  }

  if (options.heartbeat?.state === 'stopped' && heartbeatMatchesLock) {
    diagnostics.push('Lock owner is gone, and the final heartbeat says the host stopped cleanly. The lock file is stale.');
    return {
      status: 'stale',
      canonicalRepoPath: options.canonicalRepoPath,
      repoKey: options.repoKey,
      stateDirectory: options.stateDirectory,
      diagnostics,
      lock: options.lock,
      heartbeat: options.heartbeat,
    };
  }

  diagnostics.push('Lock owner pid is not running, and no clean stopped heartbeat was recorded.');
  return {
    status: 'crashed',
    canonicalRepoPath: options.canonicalRepoPath,
    repoKey: options.repoKey,
    stateDirectory: options.stateDirectory,
    diagnostics,
    lock: options.lock,
    heartbeat: options.heartbeat,
  };
}

async function safeReadValidated<T>(
  filePath: string,
  parser: (value: unknown) => { ok: boolean; value?: T; error?: string },
): Promise<{ value: T | null; corrupt: boolean }> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    const validation = parser(parsed);
    if (!validation.ok) {
      return { value: null, corrupt: true };
    }
    return { value: validation.value ?? null, corrupt: false };
  } catch (error) {
    const readError = error as NodeJS.ErrnoException;
    if (readError.code === 'ENOENT') {
      return { value: null, corrupt: false };
    }
    return { value: null, corrupt: true };
  }
}

export async function getStatusReport(startDir: string = process.cwd()): Promise<StatusReport> {
  const canonicalRepoPath = await resolveCanonicalRepo(startDir);
  const statePaths = resolveStatePaths({ canonicalRepoPath });

  const [lockResult, heartbeatResult] = await Promise.all([
    safeReadValidated(statePaths.lockPath, parseLockDocument),
    safeReadValidated(statePaths.heartbeatPath, parseHeartbeatDocument),
  ]);

  const orchestration = inspectOrchestrationDatabase({
    dbPath: statePaths.orchestrationDbPath,
    repoKey: statePaths.repoKey,
  });

  return {
    ...classifyStatus({
      canonicalRepoPath,
      repoKey: statePaths.repoKey,
      stateDirectory: statePaths.repoStateDir,
      lock: lockResult.value,
      heartbeat: heartbeatResult.value,
      lockCorrupt: lockResult.corrupt,
      heartbeatCorrupt: heartbeatResult.corrupt,
    }),
    orchestration,
  };
}

async function main(): Promise<void> {
  try {
    const report = await getStatusReport();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
