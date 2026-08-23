import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { HostIdentity, InstanceIdentity } from '../types.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createInstanceIdentity(now: Date = new Date()): InstanceIdentity {
  return {
    instanceId: randomUUID(),
    pid: process.pid,
    startedAt: now.toISOString(),
  };
}

export async function readOrCreateHostId(hostIdPath: string): Promise<string> {
  await mkdir(path.dirname(hostIdPath), { recursive: true });

  try {
    const currentHostId = (await readFile(hostIdPath, 'utf8')).trim();
    if (!UUID_PATTERN.test(currentHostId)) {
      throw new Error(`Existing host-id is invalid: ${hostIdPath}`);
    }
    return currentHostId;
  } catch (error) {
    const readError = error as NodeJS.ErrnoException;
    if (readError.code !== 'ENOENT') {
      throw error;
    }
  }

  const nextHostId = randomUUID();

  try {
    const handle = await open(hostIdPath, 'wx');
    try {
      await handle.writeFile(`${nextHostId}\n`, 'utf8');
    } finally {
      await handle.close();
    }
    return nextHostId;
  } catch (error) {
    const writeError = error as NodeJS.ErrnoException;
    if (writeError.code !== 'EEXIST') {
      throw error;
    }
    const currentHostId = (await readFile(hostIdPath, 'utf8')).trim();
    if (!UUID_PATTERN.test(currentHostId)) {
      throw new Error(`Existing host-id is invalid after concurrent create: ${hostIdPath}`);
    }
    return currentHostId;
  }
}

export function composeHostIdentity(options: {
  hostId: string;
  hostVersion: string;
  canonicalRepoPath: string;
  repoKey: string;
}): HostIdentity {
  return {
    hostId: options.hostId,
    hostVersion: options.hostVersion,
    canonicalRepoPath: options.canonicalRepoPath,
    repoKey: options.repoKey,
  };
}
