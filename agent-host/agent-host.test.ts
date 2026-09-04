import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import './policy/policy.test.ts';

import { classifyStatus } from './status.ts';
import { discoverTools } from './lib/discovery.ts';
import { writeHeartbeat, writeJsonAtomic, isHeartbeatFresh } from './lib/heartbeat.ts';
import { acquireLock, LockAcquisitionError, readLock, releaseLockIfOwned } from './lib/lock.ts';
import { detectGitMetadataKind, resolveCanonicalRepo } from './lib/repo.ts';
import { createRepoKey, normalizeRepoPathForKey, resolveStatePaths } from './lib/statePaths.ts';
import {
  HEARTBEAT_STALE_MS,
  SCHEMA_VERSION,
  isWorkerAvailable,
  type HeartbeatDocument,
  type LockDocument,
  type ProviderDiscoveryRecord,
  type StatePaths,
} from './types.ts';

function createTempStatePaths(repoPath: string, localAppData: string): StatePaths {
  return resolveStatePaths({
    canonicalRepoPath: repoPath,
    localAppData,
  });
}

function createLockFixture(repoPath: string, repoKey: string, instanceId: string = 'instance-1'): LockDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    hostId: 'host-1',
    hostVersion: '0.1.0',
    canonicalRepoPath: repoPath,
    repoKey,
    instanceId,
    pid: 4242,
    startedAt: '2026-08-23T01:00:00.000Z',
  };
}

function createHeartbeatFixture(options: {
  repoPath: string;
  repoKey: string;
  instanceId?: string;
  state?: HeartbeatDocument['state'];
  lastHeartbeatAt?: string;
  stoppedAt?: string;
  providers?: ProviderDiscoveryRecord[];
}): HeartbeatDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    hostId: 'host-1',
    hostVersion: '0.1.0',
    canonicalRepoPath: options.repoPath,
    repoKey: options.repoKey,
    instanceId: options.instanceId ?? 'instance-1',
    pid: 4242,
    startedAt: '2026-08-23T01:00:00.000Z',
    lastHeartbeatAt: options.lastHeartbeatAt ?? '2026-08-23T01:00:05.000Z',
    state: options.state ?? 'running',
    stoppedAt: options.stoppedAt,
    branch: 'main',
    headSha: 'a8260150cd21ac62bbfd15b96f9f063d27773700',
    dirty: false,
    providers: options.providers ?? [],
  };
}

function createDeferred(): { promise: Promise<void>; resolve(): void } {
  let resolve: (() => void) | null = null;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });

  return {
    promise,
    resolve: () => {
      resolve?.();
    },
  };
}

async function waitForLockOwner(lockPath: string, expectedInstanceId: string, attempts: number = 50): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const currentLock = await readLock(lockPath);
    if (currentLock?.instanceId === expectedInstanceId) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  assert.fail(`Timed out waiting for lock owner ${expectedInstanceId}`);
}

test('repo resolution works from repo root and child directory', async () => {
  const repoRoot = process.cwd();
  const childDirectory = path.join(repoRoot, 'src');

  const resolvedFromRoot = await resolveCanonicalRepo(repoRoot);
  const resolvedFromChild = await resolveCanonicalRepo(childDirectory);

  assert.equal(path.resolve(resolvedFromRoot), path.resolve(repoRoot));
  assert.equal(path.resolve(resolvedFromChild), path.resolve(repoRoot));
});

test('worktree detection helper distinguishes .git directory and file', async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'agent-host-git-'));
  const directoryRepo = path.join(sandbox, 'directory-repo');
  const fileRepo = path.join(sandbox, 'file-repo');
  const missingRepo = path.join(sandbox, 'missing-repo');

  await mkdir(path.join(directoryRepo, '.git'), { recursive: true });
  await mkdir(fileRepo, { recursive: true });
  await writeFile(path.join(fileRepo, '.git'), 'gitdir: C:/temp/worktree\n', 'utf8');

  assert.equal(await detectGitMetadataKind(directoryRepo), 'directory');
  assert.equal(await detectGitMetadataKind(fileRepo), 'file');
  assert.equal(await detectGitMetadataKind(missingRepo), 'missing');
});

test('host startup gate rejects linked worktree metadata', async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'agent-host-worktree-'));
  const fakeRepo = path.join(sandbox, 'repo');
  await mkdir(fakeRepo, { recursive: true });
  await writeFile(path.join(fakeRepo, '.git'), 'gitdir: C:/temp/worktree\n', 'utf8');

  await assert.rejects(
    resolveCanonicalRepo(fakeRepo, async () => fakeRepo),
    /Linked git worktrees are not supported/u,
  );
});

test('state paths stay outside the repo and repoKey is deterministic', async () => {
  const repoPath = 'C:\\Repo\\PowerOn';
  const localAppData = 'C:\\Users\\owner\\AppData\\Local';
  const first = createTempStatePaths(repoPath, localAppData);
  const second = createTempStatePaths('c:\\repo\\poweron', localAppData);

  assert.equal(normalizeRepoPathForKey(repoPath), normalizeRepoPathForKey('c:\\repo\\poweron'));
  assert.equal(createRepoKey(repoPath), createRepoKey('c:\\repo\\poweron'));
  assert.equal(first.repoKey, second.repoKey);
  assert.ok(first.baseDir.startsWith(localAppData));
  assert.ok(!first.repoStateDir.startsWith(repoPath));
});

test('lock acquisition is exclusive and can recover a stale dead-pid lock', async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'agent-host-lock-'));
  const repoPath = path.join(sandbox, 'repo');
  const localAppData = path.join(sandbox, 'localappdata');
  const statePaths = createTempStatePaths(repoPath, localAppData);
  await mkdir(statePaths.repoStateDir, { recursive: true });

  const firstLock = createLockFixture(repoPath, statePaths.repoKey, 'instance-1');
  await acquireLock({
    statePaths,
    lock: firstLock,
    pidAliveChecker: () => false,
  });

  const secondLock = createLockFixture(repoPath, statePaths.repoKey, 'instance-2');
  await assert.rejects(
    acquireLock({
      statePaths,
      lock: secondLock,
      pidAliveChecker: () => true,
    }),
    (error: unknown) => error instanceof LockAcquisitionError && error.reason === 'stale',
  );

  const staleHeartbeat = createHeartbeatFixture({
    repoPath,
    repoKey: statePaths.repoKey,
    instanceId: 'instance-1',
    lastHeartbeatAt: '2026-08-23T00:00:00.000Z',
  });
  await writeHeartbeat(statePaths.heartbeatPath, staleHeartbeat);

  const recovered = await acquireLock({
    statePaths,
    lock: secondLock,
    pidAliveChecker: () => false,
    referenceTime: new Date('2026-08-23T01:00:00.000Z'),
  });

  assert.equal(recovered.recoveredStaleLock, true);

  const currentLock = await readLock(statePaths.lockPath);
  assert.equal(currentLock?.instanceId, 'instance-2');
});

test('lock acquisition never steals a live matching instance', async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'agent-host-lock-live-'));
  const repoPath = path.join(sandbox, 'repo');
  const localAppData = path.join(sandbox, 'localappdata');
  const statePaths = createTempStatePaths(repoPath, localAppData);
  await mkdir(statePaths.repoStateDir, { recursive: true });

  const firstLock = createLockFixture(repoPath, statePaths.repoKey, 'instance-live');
  await acquireLock({
    statePaths,
    lock: firstLock,
    pidAliveChecker: () => false,
  });

  const runningHeartbeat = createHeartbeatFixture({
    repoPath,
    repoKey: statePaths.repoKey,
    instanceId: 'instance-live',
    lastHeartbeatAt: '2026-08-23T01:00:00.000Z',
  });
  await writeHeartbeat(statePaths.heartbeatPath, runningHeartbeat);

  await assert.rejects(
    acquireLock({
      statePaths,
      lock: createLockFixture(repoPath, statePaths.repoKey, 'instance-new'),
      pidAliveChecker: () => true,
      referenceTime: new Date('2026-08-23T01:00:10.000Z'),
    }),
    (error: unknown) => error instanceof LockAcquisitionError && error.reason === 'running',
  );
});

test('concurrent stale-lock recovery allows exactly one winning owner', async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'agent-host-lock-race-'));
  const repoPath = path.join(sandbox, 'repo');
  const localAppData = path.join(sandbox, 'localappdata');
  const statePaths = createTempStatePaths(repoPath, localAppData);
  await mkdir(statePaths.repoStateDir, { recursive: true });

  const staleLock = createLockFixture(repoPath, statePaths.repoKey, 'stale-owner');
  await writeFile(statePaths.lockPath, `${JSON.stringify(staleLock, null, 2)}\n`, 'utf8');
  await writeHeartbeat(
    statePaths.heartbeatPath,
    createHeartbeatFixture({
      repoPath,
      repoKey: statePaths.repoKey,
      instanceId: 'stale-owner',
      lastHeartbeatAt: '2026-08-23T00:00:00.000Z',
    }),
  );

  const contenderA = {
    ...createLockFixture(repoPath, statePaths.repoKey, 'instance-a'),
    pid: 5001,
  };
  const contenderB = {
    ...createLockFixture(repoPath, statePaths.repoKey, 'instance-b'),
    pid: 5002,
  };
  const pidAliveChecker = (pid: number): boolean => pid === 5001 || pid === 5002;
  const bothInspectedStaleOwner = createDeferred();
  const contenderBInspectedStaleOwner = createDeferred();
  const staleOwnersSeenByHooks: string[] = [];

  const results = await Promise.allSettled([
    acquireLock({
      statePaths,
      lock: contenderA,
      pidAliveChecker,
      referenceTime: new Date('2026-08-23T01:00:00.000Z'),
      dependencies: {
        beforeStaleRecovery: async (existingLock) => {
          staleOwnersSeenByHooks.push(existingLock.instanceId);
          contenderBInspectedStaleOwner.resolve();
          await bothInspectedStaleOwner.promise;
        },
      },
    }),
    acquireLock({
      statePaths,
      lock: contenderB,
      pidAliveChecker,
      referenceTime: new Date('2026-08-23T01:00:00.000Z'),
      dependencies: {
        beforeStaleRecovery: async (existingLock) => {
          staleOwnersSeenByHooks.push(existingLock.instanceId);
          bothInspectedStaleOwner.resolve();
          await contenderBInspectedStaleOwner.promise;
          await waitForLockOwner(statePaths.lockPath, contenderA.instanceId);
        },
      },
    }),
  ]);

  const winners = results.filter((result) => result.status === 'fulfilled');
  const losers = results.filter((result) => result.status === 'rejected');

  assert.deepEqual(staleOwnersSeenByHooks, ['stale-owner', 'stale-owner']);
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);

  const finalLock = await readLock(statePaths.lockPath);
  assert.ok(finalLock);
  assert.ok(finalLock?.instanceId === 'instance-a' || finalLock?.instanceId === 'instance-b');
  assert.equal(finalLock?.instanceId, contenderA.instanceId);

  const winningInstanceId = finalLock?.instanceId ?? '';
  const losingInstanceId = winningInstanceId === 'instance-a' ? 'instance-b' : 'instance-a';

  assert.equal(await releaseLockIfOwned(statePaths.lockPath, losingInstanceId), false);
  assert.equal(await releaseLockIfOwned(statePaths.lockPath, winningInstanceId), true);
});

test('malformed lock or heartbeat during acquisition causes safe state-corrupt refusal', async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'agent-host-lock-corrupt-'));
  const repoPath = path.join(sandbox, 'repo');
  const localAppData = path.join(sandbox, 'localappdata');
  const statePaths = createTempStatePaths(repoPath, localAppData);
  await mkdir(statePaths.repoStateDir, { recursive: true });

  await writeFile(statePaths.lockPath, '{bad json', 'utf8');
  await assert.rejects(
    acquireLock({
      statePaths,
      lock: createLockFixture(repoPath, statePaths.repoKey, 'instance-clean'),
      pidAliveChecker: () => false,
    }),
    (error: unknown) => error instanceof LockAcquisitionError && error.reason === 'state-corrupt',
  );
  assert.equal(await readFile(statePaths.lockPath, 'utf8'), '{bad json');

  const staleLock = createLockFixture(repoPath, statePaths.repoKey, 'instance-stale');
  await writeFile(statePaths.lockPath, `${JSON.stringify(staleLock, null, 2)}\n`, 'utf8');
  await writeFile(statePaths.heartbeatPath, '{bad heartbeat', 'utf8');
  await assert.rejects(
    acquireLock({
      statePaths,
      lock: createLockFixture(repoPath, statePaths.repoKey, 'instance-next'),
      pidAliveChecker: () => false,
      referenceTime: new Date('2026-08-23T01:00:00.000Z'),
    }),
    (error: unknown) => error instanceof LockAcquisitionError && error.reason === 'state-corrupt',
  );
  assert.equal(await readFile(statePaths.heartbeatPath, 'utf8'), '{bad heartbeat');
});

test('releaseLockIfOwned respects instance ownership', async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'agent-host-lock-release-'));
  const repoPath = path.join(sandbox, 'repo');
  const localAppData = path.join(sandbox, 'localappdata');
  const statePaths = createTempStatePaths(repoPath, localAppData);
  await mkdir(statePaths.repoStateDir, { recursive: true });

  await acquireLock({
    statePaths,
    lock: createLockFixture(repoPath, statePaths.repoKey, 'instance-owner'),
    pidAliveChecker: () => false,
  });

  assert.equal(await releaseLockIfOwned(statePaths.lockPath, 'instance-other'), false);
  assert.equal(await releaseLockIfOwned(statePaths.lockPath, 'instance-owner'), true);
  assert.equal(await readLock(statePaths.lockPath), null);
});

test('heartbeat writing is atomic and freshness detection works', async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'agent-host-heartbeat-'));
  const heartbeatPath = path.join(sandbox, 'heartbeat.json');
  const heartbeat = createHeartbeatFixture({
    repoPath: 'C:\\Repo\\PowerOn',
    repoKey: 'repo-key-1',
  });

  await writeHeartbeat(heartbeatPath, heartbeat);
  const serialized = await readFile(heartbeatPath, 'utf8');
  assert.match(serialized, /"state": "running"/u);

  await writeJsonAtomic(heartbeatPath, { sample: true }, 'instance-x');
  const replaced = JSON.parse(await readFile(heartbeatPath, 'utf8')) as { sample: boolean };
  assert.equal(replaced.sample, true);

  assert.equal(isHeartbeatFresh(heartbeat, new Date('2026-08-23T01:00:20.000Z')), true);
  assert.equal(isHeartbeatFresh(heartbeat, new Date('2026-08-23T01:01:00.000Z')), false);
});

test('status classification handles missing, corrupt, stopped, running, stale, and crashed states', () => {
  const repoPath = 'C:\\Repo\\PowerOn';
  const repoKey = 'repo-key-1';
  const stateDirectory = 'C:\\State\\repo-key-1';
  const lock = createLockFixture(repoPath, repoKey);
  const runningHeartbeat = createHeartbeatFixture({
    repoPath,
    repoKey,
    lastHeartbeatAt: '2026-08-23T01:00:10.000Z',
  });

  assert.equal(
    classifyStatus({
      canonicalRepoPath: repoPath,
      repoKey,
      stateDirectory,
      lock: null,
      heartbeat: null,
    }).status,
    'never-started',
  );

  assert.equal(
    classifyStatus({
      canonicalRepoPath: repoPath,
      repoKey,
      stateDirectory,
      lock: null,
      heartbeat: null,
      lockCorrupt: true,
    }).status,
    'state-corrupt',
  );

  assert.equal(
    classifyStatus({
      canonicalRepoPath: repoPath,
      repoKey,
      stateDirectory,
      lock: null,
      heartbeat: createHeartbeatFixture({
        repoPath,
        repoKey,
        state: 'stopped',
        stoppedAt: '2026-08-23T01:03:00.000Z',
      }),
    }).status,
    'stopped',
  );

  assert.equal(
    classifyStatus({
      canonicalRepoPath: repoPath,
      repoKey,
      stateDirectory,
      lock,
      heartbeat: runningHeartbeat,
      referenceTime: new Date('2026-08-23T01:00:20.000Z'),
      pidAliveChecker: () => true,
    }).status,
    'running',
  );

  assert.equal(
    classifyStatus({
      canonicalRepoPath: repoPath,
      repoKey,
      stateDirectory,
      lock,
      heartbeat: runningHeartbeat,
      referenceTime: new Date('2026-08-23T01:10:00.000Z'),
      pidAliveChecker: () => true,
    }).status,
    'stale',
  );

  assert.equal(
    classifyStatus({
      canonicalRepoPath: repoPath,
      repoKey,
      stateDirectory,
      lock,
      heartbeat: runningHeartbeat,
      referenceTime: new Date('2026-08-23T01:10:00.000Z'),
      pidAliveChecker: () => false,
    }).status,
    'crashed',
  );
});

test('discovery handles installed, missing, timeout, and cursor worker capability semantics', async () => {
  const results = await discoverTools({
    now: () => new Date('2026-08-23T02:00:00.000Z'),
    resolveCommandCandidates: async (command) => {
      switch (command) {
        case 'claude':
          return ['C:\\Tools\\claude.exe'];
        case 'codex':
          return ['C:\\Tools\\codex', 'C:\\Tools\\codex.cmd'];
        case 'ollama':
          return ['C:\\Tools\\ollama.exe'];
        case 'cursor':
          return ['C:\\Tools\\cursor', 'C:\\Tools\\cursor.cmd'];
        case 'cursor-agent':
          return ['C:\\Tools\\cursor-agent.exe'];
        default:
          return [];
      }
    },
    runNativeVersion: async (resolvedPath) => {
      if (resolvedPath.endsWith('cursor-agent.exe')) {
        const error = new Error('Timed out');
        (error as NodeJS.ErrnoException).code = 'ETIMEDOUT';
        throw error;
      }
      return { stdout: `${path.basename(resolvedPath)} 1.2.3\n`, stderr: '' };
    },
    runWrapperVersion: async (resolvedPath) => ({
      stdout: `${path.basename(resolvedPath)} 4.5.6\n`,
      stderr: '',
    }),
  });

  const codex = results.find((result) => result.toolId === 'codex-cli');
  const cursorEditor = results.find((result) => result.toolId === 'cursor-editor');
  const cursorAgent = results.find((result) => result.toolId === 'cursor-agent');

  assert.equal(codex?.installed, true);
  assert.equal(codex?.harnessKind, 'cmd-wrapper');
  assert.equal(cursorEditor?.workerCapable, false);
  assert.equal(isWorkerAvailable(cursorEditor ?? { installed: false, workerCapable: false }), false);
  assert.equal(cursorEditor?.installed, true);
  assert.equal(cursorAgent?.installed, true);
  assert.equal(cursorAgent?.error?.code, 'timeout');
  assert.equal(isWorkerAvailable(codex ?? { installed: false, workerCapable: false }), true);

  const missing = await discoverTools({
    resolveCommandCandidates: async () => [],
  });
  assert.equal(missing.every((result) => result.error?.code === 'missing'), true);

  const resolutionTimeout = await discoverTools({
    resolveCommandCandidates: async (command) => {
      if (command === 'claude') {
        const error = new Error('Timed out');
        (error as NodeJS.ErrnoException).code = 'ETIMEDOUT';
        throw error;
      }
      return [];
    },
  });
  assert.equal(resolutionTimeout.find((result) => result.toolId === 'claude-code')?.error?.code, 'timeout');
});

test('serialized state does not include obvious secret fields or raw process.env values', async () => {
  const repoPath = 'C:\\Repo\\PowerOn';
  const repoKey = 'repo-key-safe';
  const lock = createLockFixture(repoPath, repoKey);
  const heartbeat = createHeartbeatFixture({
    repoPath,
    repoKey,
    providers: [
      {
        toolId: 'claude-code',
        displayName: 'Claude Code',
        kind: 'provider',
        command: 'claude',
        harnessKind: 'native-executable',
        resolvedPath: 'C:\\Tools\\claude.exe',
        installed: true,
        workerCapable: true,
        cliVersion: '1.0.0',
        discoveredAt: '2026-08-23T01:00:00.000Z',
      },
    ],
  });

  const lockJson = JSON.stringify(lock);
  const heartbeatJson = JSON.stringify(heartbeat);
  const combined = `${lockJson}\n${heartbeatJson}`;

  assert.equal(combined.includes('process.env'), false);
  assert.equal(combined.includes('authorization'), false);
  assert.equal(combined.includes('cookie'), false);
  assert.equal(combined.includes('OPENAI_API_KEY'), false);
  assert.equal(combined.includes('ANTHROPIC_API_KEY'), false);
  assert.equal(combined.includes(String(process.env.PATH ?? 'UNSET')), false);
  assert.equal(HEARTBEAT_STALE_MS, 30_000);
});
