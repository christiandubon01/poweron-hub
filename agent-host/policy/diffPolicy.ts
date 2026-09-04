import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { normalizeRepoRelativePath, toRepoPathKey } from './pathPolicy.ts';
import type {
  RepoPathFingerprint,
  RepoSnapshot,
  RepoStatusEntry,
  RepoStatusEntryFingerprint,
} from './types.ts';

const execFileAsync = promisify(execFile);

export type GitTextRunner = (args: readonly string[], cwd: string) => Promise<string>;

export async function runGitText(args: readonly string[], cwd: string): Promise<string> {
  const result = await execFileAsync('git', [...args], {
    cwd,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });

  return result.stdout;
}

export function parseStatusPorcelainV1Z(output: string): RepoStatusEntry[] {
  const records = output.split('\0');
  if (records.at(-1) === '') {
    records.pop();
  }

  const entries: RepoStatusEntry[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 4 || record[2] !== ' ') {
      throw new Error(`Unsupported git status porcelain entry: ${JSON.stringify(record)}`);
    }

    const indexStatus = record[0];
    const worktreeStatus = record[1];
    const entryPath = normalizeRepoRelativePath(record.slice(3));
    let originalPath: string | undefined;

    if (indexStatus === 'R' || indexStatus === 'C' || worktreeStatus === 'R' || worktreeStatus === 'C') {
      const originalRecord = records[index + 1];
      if (originalRecord === undefined) {
        throw new Error(`Rename/copy entry for ${entryPath} is missing its source path.`);
      }
      originalPath = normalizeRepoRelativePath(originalRecord);
      index += 1;
    }

    entries.push({
      path: entryPath,
      pathKey: toRepoPathKey(entryPath),
      originalPath,
      originalPathKey: originalPath ? toRepoPathKey(originalPath) : undefined,
      indexStatus,
      worktreeStatus,
      kind: classifyRepoStatusKind(indexStatus, worktreeStatus),
    });
  }

  return entries;
}

export async function captureRepoSnapshot(
  repoPath: string,
  gitRunner: GitTextRunner = runGitText,
): Promise<RepoSnapshot> {
  const [headSha, rawStatus] = await Promise.all([
    gitRunner(['rev-parse', 'HEAD'], repoPath).then((value) => value.trim()),
    gitRunner(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--renames'], repoPath),
  ]);

  const entries = await Promise.all(
    parseStatusPorcelainV1Z(rawStatus).map(async (entry) => await addFingerprints(repoPath, entry, gitRunner)),
  );

  return {
    headSha,
    entries,
  };
}

function classifyRepoStatusKind(indexStatus: string, worktreeStatus: string): RepoStatusEntry['kind'] {
  if (indexStatus === '?' && worktreeStatus === '?') {
    return 'untracked';
  }
  if (indexStatus === 'R' || worktreeStatus === 'R' || indexStatus === 'C' || worktreeStatus === 'C') {
    return 'renamed';
  }
  if (indexStatus === 'D' || worktreeStatus === 'D') {
    return 'deleted';
  }
  return 'tracked';
}

async function addFingerprints(
  repoPath: string,
  entry: RepoStatusEntry,
  gitRunner: GitTextRunner,
): Promise<RepoStatusEntryFingerprint> {
  const pathFingerprint = await readPathFingerprint(repoPath, entry.path, gitRunner);
  const originalPathFingerprint = entry.originalPath
    ? await readPathFingerprint(repoPath, entry.originalPath, gitRunner)
    : undefined;

  return {
    ...entry,
    pathFingerprint,
    originalPathFingerprint,
    entryFingerprintSha256: sha256Hex(JSON.stringify({
      path: entry.path,
      originalPath: entry.originalPath ?? null,
      indexStatus: entry.indexStatus,
      worktreeStatus: entry.worktreeStatus,
      kind: entry.kind,
      pathFingerprint,
      originalPathFingerprint: originalPathFingerprint ?? null,
    })),
  };
}

async function readPathFingerprint(
  repoPath: string,
  repoRelativePath: string,
  gitRunner: GitTextRunner,
): Promise<RepoPathFingerprint> {
  const absolutePath = path.join(repoPath, ...repoRelativePath.split('/'));
  const stats = await lstat(absolutePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  });

  const indexObjectId = await readIndexObjectId(repoPath, repoRelativePath, gitRunner);

  if (!stats) {
    return {
      path: repoRelativePath,
      pathKey: toRepoPathKey(repoRelativePath),
      exists: false,
      nodeKind: 'missing',
      workingTreeSha256: null,
      sizeBytes: null,
      indexObjectId,
    };
  }

  if (stats.isDirectory()) {
    const directoryFingerprint = await hashDirectoryTree(absolutePath);
    return {
      path: repoRelativePath,
      pathKey: toRepoPathKey(repoRelativePath),
      exists: true,
      nodeKind: 'directory',
      workingTreeSha256: directoryFingerprint.sha256,
      sizeBytes: directoryFingerprint.sizeBytes,
      indexObjectId,
    };
  }

  if (stats.isFile()) {
    const content = await readFile(absolutePath);
    return {
      path: repoRelativePath,
      pathKey: toRepoPathKey(repoRelativePath),
      exists: true,
      nodeKind: 'file',
      workingTreeSha256: sha256Hex(content),
      sizeBytes: content.byteLength,
      indexObjectId,
    };
  }

  return {
    path: repoRelativePath,
    pathKey: toRepoPathKey(repoRelativePath),
    exists: true,
    nodeKind: 'other',
    workingTreeSha256: sha256Hex(`${stats.mode}:${stats.size}:${stats.mtimeMs}`),
    sizeBytes: Number.isFinite(stats.size) ? stats.size : null,
    indexObjectId,
  };
}

async function hashDirectoryTree(directoryPath: string): Promise<{ sha256: string; sizeBytes: number }> {
  const hash = createHash('sha256');
  let sizeBytes = 0;

  async function walk(currentPath: string, relativePrefix: string): Promise<void> {
    const children = await readdir(currentPath, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'accent' }));

    for (const child of children) {
      const childRelativePath = relativePrefix.length === 0 ? child.name : `${relativePrefix}/${child.name}`;
      hash.update(childRelativePath);

      const nextPath = path.join(currentPath, child.name);
      if (child.isDirectory()) {
        hash.update('dir');
        await walk(nextPath, childRelativePath);
        continue;
      }

      const content = await readFile(nextPath);
      hash.update(content);
      sizeBytes += content.byteLength;
    }
  }

  await walk(directoryPath, '');
  return {
    sha256: hash.digest('hex'),
    sizeBytes,
  };
}

async function readIndexObjectId(
  repoPath: string,
  repoRelativePath: string,
  gitRunner: GitTextRunner,
): Promise<string | null> {
  const output = await gitRunner(['ls-files', '--stage', '--', repoRelativePath], repoPath);
  const firstLine = output.trim().split(/\r?\n/u)[0];
  if (!firstLine) {
    return null;
  }

  const fields = firstLine.split(/\s+/u);
  return fields[1] ?? null;
}

function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
