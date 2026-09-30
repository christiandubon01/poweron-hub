import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, cp, lstat, mkdir, readFile, readdir, readlink, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SAFE_KEY = /^[a-zA-Z0-9._-]{1,128}$/u;

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative.length > 0 && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function assertHostCheckRootOutsideCanonical(canonicalRepoPath: string, hostRoot: string): Promise<void> {
  const canonical = await realpath(canonicalRepoPath);
  const resolved = await realpath(hostRoot);
  if (canonical === resolved || inside(canonical, resolved) || inside(resolved, canonical)) throw new Error('Host check isolation path overlaps canonical project.');
}

async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function hashTree(root: string, excluded = new Set<string>()): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  async function walk(dir: string, prefix: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!prefix && excluded.has(entry.name.toLowerCase())) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        files.set(relative, `LINK:${await readlink(full)}`); // Never traverse a junction or symlink.
      } else if (entry.isDirectory()) {
        await walk(full, relative);
      } else if (entry.isFile()) {
        files.set(relative, await hashFile(full));
      }
    }
  }
  await walk(root, '');
  return files;
}

async function rejectLinks(root: string): Promise<void> {
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Dependency snapshot contains a link and cannot be isolated.');
      if (entry.isDirectory()) await walk(path.join(dir, entry.name));
    }
  }
  await walk(root);
}

type DependencyManifest = Record<string, { size: number; mtimeMs: number }>;

async function dependencyManifest(root: string): Promise<DependencyManifest> {
  const entries: DependencyManifest = {};
  async function walk(dir: string, prefix: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Dependency snapshot contains a link.');
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, relative);
      else if (entry.isFile()) {
        const info = await lstat(full);
        entries[relative] = { size: info.size, mtimeMs: info.mtimeMs };
      } else throw new Error('Dependency snapshot contains an unsupported entry.');
    }
  }
  await walk(root, '');
  return entries;
}

async function lockSnapshotFiles(root: string): Promise<void> {
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) await chmod(full, 0o444);
    }
  }
  await walk(root);
}

/** Copy dependencies once per lockfile hash; the source is only ever read. */
export async function ensureHostDependencySnapshot(options: {
  canonicalRepoPath: string; repoKey: string; localAppData?: string;
}): Promise<{ path: string; lockHash: string; reused: boolean }> {
  if (!SAFE_KEY.test(options.repoKey)) throw new Error('Invalid repository key.');
  const localAppData = options.localAppData ?? process.env.LOCALAPPDATA;
  if (!localAppData) throw new Error('LOCALAPPDATA is unavailable for Host dependencies.');
  const root = path.resolve(localAppData, 'PowerOn', 'AgentHost', 'deps', options.repoKey);
  if (inside(options.canonicalRepoPath, root) || inside(root, options.canonicalRepoPath)) throw new Error('Dependency snapshot root overlaps the canonical repository.');
  const lockHash = await hashFile(path.join(options.canonicalRepoPath, 'package-lock.json'));
  const destination = path.join(root, lockHash);
  const manifestPath = path.join(root, `${lockHash}.manifest.json`);
  await mkdir(root, { recursive: true });
  await assertHostCheckRootOutsideCanonical(options.canonicalRepoPath, root);
  const existing = await lstat(destination).catch(() => null);
  if (existing?.isDirectory() && !existing.isSymbolicLink()) {
    await rejectLinks(destination);
    const saved = await readFile(manifestPath, 'utf8').catch(() => null);
    const current = await dependencyManifest(destination);
    if (saved !== null && saved === JSON.stringify(current)) return { path: destination, lockHash, reused: true };
    const resolved = await realpath(destination);
    if (!inside(await realpath(root), resolved)) throw new Error('Unsafe dependency snapshot; rebuild refused.');
    await rm(destination, { recursive: true, force: true });
    await rm(manifestPath, { force: true });
  }
  else if (existing) throw new Error('Dependency snapshot path is not a directory.');
  const source = path.join(options.canonicalRepoPath, 'node_modules');
  const sourceInfo = await lstat(source);
  if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) throw new Error('Canonical dependencies are not a plain directory.');
  await rejectLinks(source);
  const staging = path.join(root, `.staging-${randomUUID()}`);
  try {
    await cp(source, staging, { recursive: true, errorOnExist: true, force: false });
    await rejectLinks(staging);
    await lockSnapshotFiles(staging);
    const manifest = JSON.stringify(await dependencyManifest(staging));
    await rename(staging, destination);
    await writeFile(manifestPath, manifest);
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw new Error(`Host dependency snapshot unavailable: ${error instanceof Error ? error.message : 'copy failed'}`);
  }
  const versions = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory() && /^[0-9a-f]{64}$/u.test(entry.name));
  const dated = await Promise.all(versions.map(async (entry) => ({ name: entry.name, modified: (await lstat(path.join(root, entry.name))).mtimeMs })));
  dated.sort((a, b) => b.modified - a.modified);
  const realRoot = await realpath(root);
  for (const old of dated.slice(2)) {
    const oldPath = path.join(root, old.name);
    const info = await lstat(oldPath);
    const resolved = await realpath(oldPath);
    if (!info.isDirectory() || info.isSymbolicLink() || !inside(realRoot, resolved)) throw new Error('Unsafe old dependency snapshot; pruning refused.');
    await rm(oldPath, { recursive: true, force: true });
    await rm(path.join(root, `${old.name}.manifest.json`), { force: true });
  }
  return { path: destination, lockHash, reused: false };
}

/** Throwaway check trees contain no link to the canonical repo or dependencies. */
export async function makeHostCheckCopy(options: { canonicalRepoPath: string; sourcePath: string; workspaceRoot: string; attemptId: string; label: string; snapshotPath?: string }): Promise<string> {
  if (!SAFE_KEY.test(options.attemptId) || !SAFE_KEY.test(options.label)) throw new Error('Unsafe check workspace identity.');
  const destination = path.resolve(options.workspaceRoot, `.host-check-${options.attemptId}-${options.label}-${randomUUID()}`);
  if (!inside(options.workspaceRoot, destination) || inside(options.sourcePath, destination) || inside(destination, options.sourcePath)) throw new Error('Host check workspace overlaps its source.');
  await assertHostCheckRootOutsideCanonical(options.canonicalRepoPath, options.workspaceRoot);
  const canonicalReal = await realpath(options.canonicalRepoPath);
  const sourceReal = await realpath(options.sourcePath);
  if (canonicalReal === sourceReal || inside(canonicalReal, sourceReal) || inside(sourceReal, canonicalReal)) throw new Error('Host check source overlaps canonical project.');
  if (options.snapshotPath) {
    const snapshotReal = await realpath(options.snapshotPath);
    if (canonicalReal === snapshotReal || inside(canonicalReal, snapshotReal) || inside(snapshotReal, canonicalReal)) throw new Error('Dependency snapshot overlaps canonical project.');
  }
  await rejectLinks(options.sourcePath);
  await cp(options.sourcePath, destination, { recursive: true, errorOnExist: true, force: false });
  try {
    await rejectLinks(destination);
    async function makeWritable(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await makeWritable(full);
        else if (entry.isFile()) await chmod(full, 0o666);
      }
    }
    await makeWritable(destination);
    await mkdir(path.join(destination, '.host-check-tmp'), { recursive: true });
    await mkdir(path.join(destination, '.host-check-cache'), { recursive: true });
    await writeFile(path.join(destination, '.host-check-cache', 'user.npmrc'), '', { flag: 'wx' });
    await writeFile(path.join(destination, '.host-check-cache', 'global.npmrc'), '', { flag: 'wx' });
    if (options.snapshotPath) {
      const target = path.resolve(options.snapshotPath);
      if (inside(options.sourcePath, target) || inside(target, options.sourcePath)) throw new Error('Dependency junction would reach source.');
      await symlink(target, path.join(destination, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    }
    return destination;
  } catch (error) {
    await removeHostCheckCopy(destination, options.workspaceRoot, options.canonicalRepoPath);
    throw error;
  }
}

export async function removeHostCheckCopy(destination: string, workspaceRoot: string, canonicalRepoPath: string): Promise<void> {
  if (!inside(workspaceRoot, destination) || !path.basename(destination).startsWith('.host-check-')) throw new Error('Unsafe Host check cleanup path.');
  await assertHostCheckRootOutsideCanonical(canonicalRepoPath, workspaceRoot);
  const destinationInfo = await lstat(destination).catch(() => null);
  if (!destinationInfo) return;
  if (!destinationInfo.isDirectory() || destinationInfo.isSymbolicLink()) throw new Error('Host check copy root was replaced; refusing recursive cleanup.');
  const realRoot = await realpath(workspaceRoot);
  const realDestination = await realpath(destination);
  if (!inside(realRoot, realDestination)) throw new Error('Host check cleanup escaped its root.');
  const junction = path.join(destination, 'node_modules');
  const info = await lstat(junction).catch(() => null);
  if (info) {
    if (!info.isSymbolicLink()) throw new Error('Host check dependency junction was replaced; refusing recursive cleanup.');
    await rm(junction, { recursive: false, force: true });
  }
  await rm(destination, { recursive: true, force: true });
}

export interface CanonicalTripwire { head: string; porcelainSha256: string; packageLockSha256: string | null; nodeModulesTop: string[]; files: Map<string, string>; }

/**
 * Checks run as the owner's Windows account. The Host detects writes to the
 * project; it cannot prevent arbitrary AI-authored test code from making them.
 * No Host-created cwd, environment value, or junction points to the project.
 */
export async function fingerprintCanonicalRepo(canonicalRepoPath: string, gitProbe?: () => Promise<{ head: string; status: Buffer }>): Promise<CanonicalTripwire> {
  const git = gitProbe ? await gitProbe() : await (async () => {
    const head = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: canonicalRepoPath, windowsHide: true, encoding: 'buffer' });
    const status = await execFileAsync('git', ['status', '--porcelain=v1', '-z', '-uall'], { cwd: canonicalRepoPath, windowsHide: true, encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 });
    return { head: String(head.stdout).trim(), status: Buffer.from(status.stdout) };
  })();
  const nodeModules = path.join(canonicalRepoPath, 'node_modules');
  const top = await readdir(nodeModules).catch(() => []);
  const files = await hashTree(canonicalRepoPath, new Set(['.git']));
  const lock = await hashFile(path.join(nodeModules, '.package-lock.json')).catch(() => null);
  return {
    head: git.head,
    porcelainSha256: createHash('sha256').update(git.status).digest('hex'),
    packageLockSha256: lock,
    nodeModulesTop: top.sort(),
    files,
  };
}

export function compareCanonicalTripwire(before: CanonicalTripwire, after: CanonicalTripwire): { modified: boolean; paths: string[]; count: number } {
  const paths = new Set<string>();
  if (before.head !== after.head) paths.add('.git/HEAD');
  if (before.porcelainSha256 !== after.porcelainSha256) paths.add('(git status changed)');
  if (before.packageLockSha256 !== after.packageLockSha256) paths.add('node_modules/.package-lock.json');
  if (before.nodeModulesTop.join('\0') !== after.nodeModulesTop.join('\0')) paths.add('node_modules/(top-level listing)');
  for (const key of new Set([...before.files.keys(), ...after.files.keys()])) {
    if (before.files.get(key) !== after.files.get(key)) paths.add(key);
  }
  return { modified: paths.size > 0, paths: [...paths].sort().slice(0, 32), count: paths.size };
}
