import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { isHeartbeatFresh, readHeartbeat } from './heartbeat.ts';
import { HEARTBEAT_STALE_MS, parseLockDocument, type HeartbeatDocument, type LockDocument, type StatePaths } from '../types.ts';

export interface AcquireLockResult {
  recoveredStaleLock: boolean;
}

interface RecoveryDocument {
  instanceId: string;
  hostId: string;
  repoKey: string;
  pid: number;
  startedAt: string;
}

interface RecoveryRelease {
  release(): Promise<void>;
}

export type PidAliveChecker = (pid: number) => boolean;

export interface AcquireLockDependencies {
  beforeStaleRecovery?: ((existingLock: LockDocument) => Promise<void>) | undefined;
}

export class LockAcquisitionError extends Error {
  reason: 'running' | 'stale' | 'state-corrupt';

  constructor(reason: 'running' | 'stale' | 'state-corrupt', message: string) {
    super(message);
    this.name = 'LockAcquisitionError';
    this.reason = reason;
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const processError = error as NodeJS.ErrnoException;
    if (processError.code === 'ESRCH') {
      return false;
    }
    return true;
  }
}

export async function readLock(lockPath: string): Promise<LockDocument | null> {
  try {
    const raw = await readFile(lockPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    const validation = parseLockDocument(parsed);
    if (!validation.ok) {
      throw new Error(validation.error);
    }
    return validation.value ?? null;
  } catch (error) {
    const readError = error as NodeJS.ErrnoException;
    if (readError.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeLock(lockPath: string, lock: LockDocument): Promise<void> {
  await mkdir(path.dirname(lockPath), { recursive: true });
  const handle = await open(lockPath, 'wx');
  try {
    await handle.writeFile(`${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  } finally {
    await handle.close();
  }
}

async function writeRecoveryDocument(recoveryPath: string, recovery: RecoveryDocument): Promise<void> {
  await mkdir(path.dirname(recoveryPath), { recursive: true });
  const handle = await open(recoveryPath, 'wx');
  try {
    await handle.writeFile(`${JSON.stringify(recovery, null, 2)}\n`, 'utf8');
  } finally {
    await handle.close();
  }
}

async function removeLockIfPresent(lockPath: string): Promise<void> {
  try {
    await unlink(lockPath);
  } catch (error) {
    const unlinkError = error as NodeJS.ErrnoException;
    if (unlinkError.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function readRecoveryDocument(recoveryPath: string): Promise<RecoveryDocument | null> {
  try {
    const raw = await readFile(recoveryPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    const record = parsed as Record<string, unknown>;

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof record.instanceId !== 'string' ||
      typeof record.hostId !== 'string' ||
      typeof record.repoKey !== 'string' ||
      typeof record.pid !== 'number' ||
      typeof record.startedAt !== 'string'
    ) {
      throw new Error('lock-recovery.json is malformed');
    }

    return parsed as RecoveryDocument;
  } catch (error) {
    const readError = error as NodeJS.ErrnoException;
    if (readError.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function matchesLockIdentity(left: LockDocument, right: LockDocument): boolean {
  return (
    left.instanceId === right.instanceId &&
    left.hostId === right.hostId &&
    left.repoKey === right.repoKey &&
    left.pid === right.pid &&
    left.startedAt === right.startedAt
  );
}

async function verifyLockOwnership(lockPath: string, expectedLock: LockDocument): Promise<boolean> {
  const currentLock = await readLock(lockPath);
  if (!currentLock) {
    return false;
  }

  return (
    currentLock.instanceId === expectedLock.instanceId &&
    currentLock.hostId === expectedLock.hostId &&
    currentLock.repoKey === expectedLock.repoKey
  );
}

async function releaseRecoveryIfOwned(recoveryPath: string, instanceId: string): Promise<void> {
  let recoveryDocument: RecoveryDocument | null = null;
  try {
    recoveryDocument = await readRecoveryDocument(recoveryPath);
  } catch {
    return;
  }

  if (!recoveryDocument || recoveryDocument.instanceId !== instanceId) {
    return;
  }

  try {
    await unlink(recoveryPath);
  } catch (error) {
    const unlinkError = error as NodeJS.ErrnoException;
    if (unlinkError.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function ensureNoActiveRecovery(options: {
  recoveryPath: string;
  selfLock: LockDocument;
  pidAliveChecker: PidAliveChecker;
}): Promise<void> {
  let recoveryDocument: RecoveryDocument | null = null;
  try {
    recoveryDocument = await readRecoveryDocument(options.recoveryPath);
  } catch (error) {
    throw new LockAcquisitionError(
      'state-corrupt',
      `Existing lock-recovery.json is malformed and was not modified automatically: ${(error as Error).message}`,
    );
  }

  if (!recoveryDocument || recoveryDocument.instanceId === options.selfLock.instanceId) {
    return;
  }

  if (options.pidAliveChecker(recoveryDocument.pid)) {
    throw new LockAcquisitionError(
      'stale',
      `Another stale-lock recovery is already in progress for this repository (pid ${recoveryDocument.pid}).`,
    );
  }

  await releaseRecoveryIfOwned(options.recoveryPath, recoveryDocument.instanceId);
}

async function acquireRecoveryGuard(options: {
  recoveryPath: string;
  selfLock: LockDocument;
  pidAliveChecker: PidAliveChecker;
}): Promise<RecoveryRelease> {
  const recoveryDocument: RecoveryDocument = {
    instanceId: options.selfLock.instanceId,
    hostId: options.selfLock.hostId,
    repoKey: options.selfLock.repoKey,
    pid: options.selfLock.pid,
    startedAt: options.selfLock.startedAt,
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await writeRecoveryDocument(options.recoveryPath, recoveryDocument);
      return {
        release: async () => {
          await releaseRecoveryIfOwned(options.recoveryPath, recoveryDocument.instanceId);
        },
      };
    } catch (error) {
      const writeError = error as NodeJS.ErrnoException;
      if (writeError.code !== 'EEXIST') {
        throw error;
      }
    }

    await ensureNoActiveRecovery(options);
  }

  throw new LockAcquisitionError(
    'stale',
    'Another stale-lock recovery is already in progress for this repository.',
  );
}

function canRecoverStaleLock(heartbeat: HeartbeatDocument | null, referenceTime: Date, staleThresholdMs: number): boolean {
  if (!heartbeat) {
    return true;
  }
  if (heartbeat.state !== 'running') {
    return true;
  }
  return !isHeartbeatFresh(heartbeat, referenceTime, staleThresholdMs);
}

export async function acquireLock(options: {
  statePaths: StatePaths;
  lock: LockDocument;
  staleThresholdMs?: number | undefined;
  referenceTime?: Date | undefined;
  pidAliveChecker?: PidAliveChecker | undefined;
  dependencies?: AcquireLockDependencies | undefined;
}): Promise<AcquireLockResult> {
  const staleThresholdMs = options.staleThresholdMs ?? HEARTBEAT_STALE_MS;
  const referenceTime = options.referenceTime ?? new Date();
  const pidAliveChecker = options.pidAliveChecker ?? isPidAlive;
  const dependencies = options.dependencies ?? {};
  let recoveredStaleLock = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await ensureNoActiveRecovery({
      recoveryPath: options.statePaths.recoveryPath,
      selfLock: options.lock,
      pidAliveChecker,
    });

    try {
      await writeLock(options.statePaths.lockPath, options.lock);
      const ownsLock = await verifyLockOwnership(options.statePaths.lockPath, options.lock);
      if (ownsLock) {
        return { recoveredStaleLock };
      }
      throw new LockAcquisitionError(
        'stale',
        'Lock creation succeeded, but ownership verification failed before success could be returned.',
      );
    } catch (error) {
      if (error instanceof LockAcquisitionError) {
        throw error;
      }
      const writeError = error as NodeJS.ErrnoException;
      if (writeError.code !== 'EEXIST') {
        throw error;
      }
    }

    let existingLock: LockDocument | null = null;
    try {
      existingLock = await readLock(options.statePaths.lockPath);
    } catch (error) {
      throw new LockAcquisitionError(
        'state-corrupt',
        `Existing lock.json is malformed and was not modified automatically: ${(error as Error).message}`,
      );
    }

    if (!existingLock) {
      continue;
    }

    let existingHeartbeat: HeartbeatDocument | null = null;
    try {
      existingHeartbeat = await readHeartbeat(options.statePaths.heartbeatPath);
    } catch (error) {
      throw new LockAcquisitionError(
        'state-corrupt',
        `Existing heartbeat.json is malformed and was not modified automatically: ${(error as Error).message}`,
      );
    }

    const lockOwnerAlive = pidAliveChecker(existingLock.pid);
    const instanceMatchesHeartbeat = existingHeartbeat?.instanceId === existingLock.instanceId;
    const heartbeatFresh = existingHeartbeat
      ? isHeartbeatFresh(existingHeartbeat, referenceTime, staleThresholdMs)
      : false;

    if (lockOwnerAlive) {
      if (existingHeartbeat && instanceMatchesHeartbeat && existingHeartbeat.state === 'running' && heartbeatFresh) {
        throw new LockAcquisitionError(
          'running',
          `Another Agent Host instance is already running for this repository (pid ${existingLock.pid}).`,
        );
      }

      throw new LockAcquisitionError(
        'stale',
        `Existing Agent Host process pid ${existingLock.pid} is still alive, but heartbeat is stale or inconsistent. Lock was not stolen automatically.`,
      );
    }

    if (!canRecoverStaleLock(existingHeartbeat, referenceTime, staleThresholdMs)) {
      throw new LockAcquisitionError(
        'stale',
        'Lock owner pid is no longer running, but heartbeat still appears active. Retry after the stale threshold or inspect the state directory.',
      );
    }

    await dependencies.beforeStaleRecovery?.(existingLock);

    const recoveryGuard = await acquireRecoveryGuard({
      recoveryPath: options.statePaths.recoveryPath,
      selfLock: options.lock,
      pidAliveChecker,
    });

    try {
      const recheckedLock = await readLock(options.statePaths.lockPath);
      if (!recheckedLock) {
        continue;
      }

      if (!matchesLockIdentity(recheckedLock, existingLock)) {
        continue;
      }

      let recheckedHeartbeat: HeartbeatDocument | null = null;
      try {
        recheckedHeartbeat = await readHeartbeat(options.statePaths.heartbeatPath);
      } catch (error) {
        throw new LockAcquisitionError(
          'state-corrupt',
          `Existing heartbeat.json is malformed and was not modified automatically: ${(error as Error).message}`,
        );
      }

      if (pidAliveChecker(recheckedLock.pid) || !canRecoverStaleLock(recheckedHeartbeat, referenceTime, staleThresholdMs)) {
        throw new LockAcquisitionError(
          'stale',
          'Stale-lock recovery lost the race to a newer or ambiguous owner. Lock was not modified automatically.',
        );
      }

      await removeLockIfPresent(options.statePaths.lockPath);
      recoveredStaleLock = true;
    } finally {
      await recoveryGuard.release();
    }
  }

  throw new LockAcquisitionError(
    'stale',
    'Could not safely acquire the Agent Host lock after stale-lock recovery attempts.',
  );
}

export async function releaseLockIfOwned(lockPath: string, instanceId: string): Promise<boolean> {
  let currentLock: LockDocument | null = null;
  try {
    currentLock = await readLock(lockPath);
  } catch {
    return false;
  }

  if (!currentLock || currentLock.instanceId !== instanceId) {
    return false;
  }

  await removeLockIfPresent(lockPath);
  return true;
}
