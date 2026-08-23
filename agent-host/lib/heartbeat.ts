import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { HEARTBEAT_STALE_MS, parseHeartbeatDocument, type HeartbeatDocument } from '../types.ts';

export async function writeJsonAtomic(targetPath: string, value: unknown, tempToken: string): Promise<void> {
  const directoryPath = path.dirname(targetPath);
  await mkdir(directoryPath, { recursive: true });

  const temporaryPath = path.join(directoryPath, `${path.basename(targetPath)}.${tempToken}.tmp`);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;

  await writeFile(temporaryPath, serialized, 'utf8');
  await rename(temporaryPath, targetPath);
}

export async function writeHeartbeat(heartbeatPath: string, heartbeat: HeartbeatDocument): Promise<void> {
  await writeJsonAtomic(heartbeatPath, heartbeat, heartbeat.instanceId);
}

export async function readHeartbeat(heartbeatPath: string): Promise<HeartbeatDocument | null> {
  try {
    const raw = await readFile(heartbeatPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    const validation = parseHeartbeatDocument(parsed);
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

export function isHeartbeatFresh(
  heartbeat: HeartbeatDocument,
  referenceTime: Date = new Date(),
  staleThresholdMs: number = HEARTBEAT_STALE_MS,
): boolean {
  const lastHeartbeatTime = Date.parse(heartbeat.lastHeartbeatAt);
  if (Number.isNaN(lastHeartbeatTime)) {
    return false;
  }
  return referenceTime.getTime() - lastHeartbeatTime <= staleThresholdMs;
}
