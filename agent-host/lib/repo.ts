import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import type { RepoStatus } from '../types.ts';

const execFileAsync = promisify(execFile);

export type GitRunner = (args: string[], cwd: string) => Promise<string>;

export async function runGit(args: string[], cwd: string): Promise<string> {
  const result = await execFileAsync('git', args, {
    cwd,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return result.stdout.trim();
}

export async function resolveCanonicalRepo(startDir: string = process.cwd(), gitRunner: GitRunner = runGit): Promise<string> {
  let canonicalRepoPath: string;
  try {
    canonicalRepoPath = await gitRunner(['rev-parse', '--show-toplevel'], startDir);
  } catch {
    throw new Error('Not inside a git repository. Run Agent Host from the repo root or one of its child directories.');
  }

  await assertCanonicalWorktree(canonicalRepoPath);
  return path.resolve(canonicalRepoPath);
}

export async function detectGitMetadataKind(canonicalRepoPath: string): Promise<'directory' | 'file' | 'missing' | 'other'> {
  const gitMetadataPath = path.join(canonicalRepoPath, '.git');

  try {
    const stats = await lstat(gitMetadataPath);
    if (stats.isDirectory()) {
      return 'directory';
    }
    if (stats.isFile()) {
      return 'file';
    }
    return 'other';
  } catch (error) {
    const statError = error as NodeJS.ErrnoException;
    if (statError.code === 'ENOENT') {
      return 'missing';
    }
    throw error;
  }
}

export async function assertCanonicalWorktree(canonicalRepoPath: string): Promise<void> {
  const metadataKind = await detectGitMetadataKind(canonicalRepoPath);

  if (metadataKind === 'file') {
    throw new Error('Linked git worktrees are not supported. Run Agent Host from the canonical main working tree.');
  }
  if (metadataKind !== 'directory') {
    throw new Error(`Git metadata at ${path.join(canonicalRepoPath, '.git')} is not a standard working-tree directory.`);
  }
}

export async function readRepoStatus(canonicalRepoPath: string, gitRunner: GitRunner = runGit): Promise<RepoStatus> {
  const [branch, headSha, dirtyOutput] = await Promise.all([
    gitRunner(['branch', '--show-current'], canonicalRepoPath),
    gitRunner(['rev-parse', 'HEAD'], canonicalRepoPath),
    gitRunner(['status', '--porcelain', '--untracked-files=normal'], canonicalRepoPath),
  ]);

  return {
    branch: branch || '(detached)',
    headSha,
    dirty: dirtyOutput.length > 0,
  };
}
