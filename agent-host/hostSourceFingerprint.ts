/**
 * Stable fingerprint of the Agent Host source the process loaded.
 *
 * Computed once at Host startup and rechecked periodically (CT-REL-2). A
 * difference vs the startup fingerprint means the connected Host is still
 * running older code; the Host publishes restartRequired and refuses new
 * create_plan / approve_plan requests. Nothing here restarts or kills the Host.
 *
 * Line endings are normalized (CRLF → LF) before hashing, so a line-ending-only
 * change NEVER changes the fingerprint.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SOURCE_DIR = 'agent-host';

/**
 * Runtime modules the Host imports from OUTSIDE agent-host/. The complete set
 * today is exactly one file: agent-host/control/capacity.ts imports
 * src/features/control-tower/capacity.ts (a leaf module with no transitive
 * imports). A change to any of these files changes what the Host loaded, so
 * they belong in the fingerprint. Paths are repo-root-relative.
 */
const EXTERNAL_SOURCE_FILES: readonly string[] = [
  'src/features/control-tower/capacity.ts',
];

/** CRLF→LF before hashing: line-ending-only churn must not flip restartRequired. */
function normalizedSourceHash(bytes: Buffer): Buffer {
  return createHash('sha256').update(bytes.toString('utf8').replaceAll('\r\n', '\n'), 'utf8').digest();
}

export function computeAgentHostSourceFingerprint(repoRoot: string): string {
  const root = path.resolve(repoRoot, SOURCE_DIR);
  const files: string[] = [];
  collectSourceFiles(root, root, files);
  files.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const hash = createHash('sha256');
  for (const relative of files) {
    const bytes = readFileSync(path.join(root, relative));
    hash.update(relative);
    hash.update('\0');
    hash.update(normalizedSourceHash(bytes));
    hash.update('\0');
  }
  for (const external of EXTERNAL_SOURCE_FILES) {
    hash.update(external);
    hash.update('\0');
    let bytes: Buffer | null = null;
    try {
      bytes = readFileSync(path.resolve(repoRoot, external));
    } catch {
      // A missing external file is part of the honest identity (its presence or
      // absence changes what the Host can load) — it must not crash the Host.
      hash.update('missing');
      hash.update('\0');
      continue;
    }
    hash.update(normalizedSourceHash(bytes));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function collectSourceFiles(dir: string, root: string, files: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
      continue;
    }
    // CT-REL-2.1 goal 4: never follow symlinks or directory junctions (same
    // rule as captureWorkspaceTree) — a linked tree is not Host source.
    if (entry.isSymbolicLink()) {
      continue;
    }
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(absolute, root, files);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) {
      continue;
    }
    files.push(path.relative(root, absolute).split(path.sep).join('/'));
  }
}
