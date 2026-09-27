/**
 * Stable fingerprint of the Agent Host source the process loaded.
 *
 * Computed once at Host startup and published on presence. The browser
 * compares it with the canonical tree. A mismatch means the connected Host
 * is still running older code. Nothing here restarts or kills the Host.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SOURCE_DIR = 'agent-host';

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
    hash.update(createHash('sha256').update(bytes).digest());
    hash.update('\0');
  }
  return hash.digest('hex');
}

function collectSourceFiles(dir: string, root: string, files: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
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
