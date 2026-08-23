import { createHash } from 'node:crypto';
import path from 'node:path';

import type { StatePaths } from '../types.ts';

export function normalizeRepoPathForKey(canonicalRepoPath: string): string {
  const resolvedPath = path.resolve(canonicalRepoPath);
  const normalizedPath = path.win32.normalize(resolvedPath).replaceAll('/', '\\');
  return process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath;
}

export function createRepoKey(canonicalRepoPath: string): string {
  return createHash('sha256').update(normalizeRepoPathForKey(canonicalRepoPath)).digest('hex').slice(0, 16);
}

export function resolveStatePaths(options: {
  canonicalRepoPath: string;
  localAppData?: string | undefined;
}): StatePaths {
  const localAppData = options.localAppData ?? process.env.LOCALAPPDATA;
  if (!localAppData) {
    throw new Error('LOCALAPPDATA is not set. Agent Host state requires %LOCALAPPDATA%\\PowerOn\\AgentHost.');
  }

  const baseDir = path.join(localAppData, 'PowerOn', 'AgentHost');
  const reposDir = path.join(baseDir, 'repos');
  const repoKey = createRepoKey(options.canonicalRepoPath);
  const repoStateDir = path.join(reposDir, repoKey);

  return {
    baseDir,
    hostIdPath: path.join(baseDir, 'host-id'),
    reposDir,
    repoStateDir,
    lockPath: path.join(repoStateDir, 'lock.json'),
    recoveryPath: path.join(repoStateDir, 'lock-recovery.json'),
    heartbeatPath: path.join(repoStateDir, 'heartbeat.json'),
    eventsPath: path.join(repoStateDir, 'events.jsonl'),
    repoKey,
  };
}
