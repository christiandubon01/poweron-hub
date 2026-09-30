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

function errorCode(error: unknown, fallback: string): string {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' || typeof code === 'number' ? String(code) : fallback;
}

/** A fingerprint step failed with a stable, content-free reason (step + repo-relative path + error code). */
export class FingerprintError extends Error {
  readonly step: string;
  readonly relPath: string;
  readonly code: string;
  constructor(step: string, relPath: string, code: string, message?: string) {
    super(message ?? `fingerprint step "${step}" failed at ${relPath} (code ${code})`);
    this.name = 'FingerprintError';
    this.step = step;
    this.relPath = relPath;
    this.code = code;
  }
}

const PORCELAIN_STATUS_CHARS = new Set<string>([' ', 'M', 'A', 'D', 'R', 'C', 'U', 'T', '?', '!']);

/**
 * Parse `git status --porcelain=v1 -z --untracked-files=all` into repo-relative
 * paths (forward-slash, git style). Renames/copies contribute both the source
 * and destination path. The porcelain hash already captures the raw status, so
 * these paths only drive the per-file content hashes for in-place edits.
 */
function parsePorcelainPaths(status: Buffer): string[] {
  const tokens: string[] = [];
  let start = 0;
  for (let i = 0; i <= status.length; i += 1) {
    if (i === status.length || status[i] === 0) {
      if (i > start) tokens.push(status.subarray(start, i).toString('utf8'));
      start = i + 1;
    }
  }
  const paths: string[] = [];
  for (let idx = 0; idx < tokens.length; idx += 1) {
    const tok = tokens[idx];
    if (tok.length < 3) continue;
    const x = tok[0], y = tok[1], sep = tok[2];
    if (sep === ' ' && PORCELAIN_STATUS_CHARS.has(x) && PORCELAIN_STATUS_CHARS.has(y)) {
      paths.push(tok.slice(3));
      if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
        if (idx + 1 < tokens.length) { paths.push(tokens[idx + 1] as string); idx += 1; }
      }
    }
  }
  return paths;
}

/**
 * Walk node_modules recording a stable marker per entry — never following links.
 * Files record `F:size:mtimeMs`; directories record `DIR`; links record
 * `LINK:target` (or `LINKERR:code` if readlink fails). A readdir/lstat failure
 * records an `ERR:`/`FERR:` marker for that entry instead of failing the whole
 * walk, so a single locked or broken entry cannot make the fingerprint UNAVAILABLE.
 */
async function walkNodeModules(root: string, prefix: string): Promise<Map<string, string>> {
  const entries = new Map<string, string>();
  async function walk(dir: string, prefix: string): Promise<void> {
    let listed: import('node:fs').Dirent[];
    try {
      listed = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      entries.set(`${prefix}/`, `ERR:${errorCode(error, 'READDIR_FAILED')}`);
      return;
    }
    for (const entry of listed) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        let target: string | null = null;
        try { target = await readlink(full); } catch (error) { entries.set(rel, `LINKERR:${errorCode(error, 'READLINK_FAILED')}`); continue; }
        entries.set(rel, `LINK:${target}`); // Never traverse a junction or symlink.
      } else if (entry.isDirectory()) {
        entries.set(rel, 'DIR');
        await walk(full, rel);
      } else if (entry.isFile()) {
        try { const info = await lstat(full); entries.set(rel, `F:${info.size}:${Math.floor(info.mtimeMs)}`); }
        catch (error) { entries.set(rel, `FERR:${errorCode(error, 'LSTAT_FAILED')}`); }
      } else {
        entries.set(rel, 'OTHER');
      }
    }
  }
  await walk(root, prefix);
  return entries;
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

/**
 * Walk node_modules and classify every link: a link that resolves to a real
 * target OUTSIDE the node_modules tree refuses the snapshot; a dangling or
 * unreadable link (readlink fails, or realpath fails because the target is
 * missing) is skipped and counted; an internal link is allowed (the copy step
 * drops it from the link-free snapshot). Returns the count of skipped links.
 */
async function assertNoEscapingLinks(root: string): Promise<{ skipped: number }> {
  const rootReal = await realpath(root);
  let skipped = 0;
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        let real: string | null = null;
        try { real = await realpath(full); } catch { real = null; }
        if (real === null) { skipped += 1; continue; } // dangling or unreadable link
        if (real !== rootReal && !inside(rootReal, real)) throw new Error('Dependency snapshot contains a link escaping node_modules.');
        // internal link: allowed; the copy filter drops it so the snapshot stays link-free.
      } else if (entry.isDirectory()) {
        await walk(full);
      }
    }
  }
  await walk(root);
  return { skipped };
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
  await assertNoEscapingLinks(source);
  const staging = path.join(root, `.staging-${randomUUID()}`);
  try {
    await cp(source, staging, {
      recursive: true, errorOnExist: true, force: false,
      // Skip every link so the snapshot stays link-free (chmod then protects all
      // bytes). External links were already refused by assertNoEscapingLinks;
      // dangling/internal links are simply absent from the snapshot.
      filter: async (_src, dest) => {
        const info = await lstat(_src).catch(() => null);
        return info === null || !info.isSymbolicLink();
      },
    });
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

export interface CanonicalTripwire {
  head: string;
  porcelainSha256: string;
  /** Repo-relative (git-style) dirty/untracked path → sha256 of its current bytes. */
  dirtyFileSha256: Map<string, string>;
  /** Root `.env*` file name → sha256 of its bytes (gitignored but watched). */
  envSha256: Map<string, string>;
  /** sha256 of node_modules/.package-lock.json (null only if the file is absent AND that is tolerated at build time). */
  packageLockSha256: string;
  /** `node_modules/...` entry → stable marker (`F:size:mtimeMs` / `DIR` / `LINK:target` / `LINKERR:code` / `FERR:code` / `ERR:code`). */
  nodeModulesEntries: Map<string, string>;
}

async function runGitFingerprintStep(canonicalRepoPath: string): Promise<{ head: string; status: Buffer }> {
  try {
    const head = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: canonicalRepoPath, windowsHide: true, encoding: 'buffer' });
    const status = await execFileAsync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: canonicalRepoPath, windowsHide: true, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
    return { head: String(head.stdout).trim(), status: Buffer.from(status.stdout) };
  } catch (error) {
    throw new FingerprintError('git', '(repository)', errorCode(error, 'GIT_FAILED'), `git fingerprint step failed (code ${errorCode(error, 'GIT_FAILED')})`);
  }
}

/**
 * Checks run as the owner's Windows account. The Host detects writes to the
 * project; it cannot prevent arbitrary AI-authored test code from making them.
 * No Host-created cwd, environment value, or junction points to the project.
 *
 * Tiered fingerprint (CT-VERIFY-1C): the full-byte tree walk was replaced so a
 * single locked/junction entry under node_modules (or a nested worktree folder)
 * can no longer make the whole fingerprint UNAVAILABLE. Only a git failure or an
 * unreadable node_modules/.package-lock.json fails the fingerprint; every other
 * tier degrades to a stable marker instead of throwing.
 */
export async function fingerprintCanonicalRepo(canonicalRepoPath: string, gitProbe?: () => Promise<{ head: string; status: Buffer }>): Promise<CanonicalTripwire> {
  let git: { head: string; status: Buffer };
  if (gitProbe) {
    try { git = await gitProbe(); }
    catch (error) { throw new FingerprintError('git', '(repository)', errorCode(error, 'GIT_FAILED'), `git fingerprint step failed (code ${errorCode(error, 'GIT_FAILED')})`); }
  } else {
    git = await runGitFingerprintStep(canonicalRepoPath);
  }

  const dirtyFileSha256 = new Map<string, string>();
  for (const rel of parsePorcelainPaths(git.status)) {
    const full = path.join(canonicalRepoPath, rel);
    let info: import('node:fs').Stats;
    try { info = await lstat(full); } catch { continue; } // deleted entries are captured by the porcelain hash.
    if (!info.isFile()) continue;
    try { dirtyFileSha256.set(rel, await hashFile(full)); }
    catch { /* an unreadable dirty file is still flagged dirty by the porcelain hash; never UNAVAILABLE. */ }
  }

  const envSha256 = new Map<string, string>();
  let rootEntries: import('node:fs').Dirent[] = [];
  try { rootEntries = await readdir(canonicalRepoPath, { withFileTypes: true }); } catch { /* env tier degrades to empty. */ }
  for (const entry of rootEntries) {
    if (!entry.isFile() || !/^\.env/u.test(entry.name)) continue;
    try { envSha256.set(entry.name, await hashFile(path.join(canonicalRepoPath, entry.name))); }
    catch { /* an unreadable env file is skipped, never UNAVAILABLE. */ }
  }

  const nodeModules = path.join(canonicalRepoPath, 'node_modules');
  let packageLockSha256: string;
  try { packageLockSha256 = await hashFile(path.join(nodeModules, '.package-lock.json')); }
  catch (error) {
    throw new FingerprintError('node_modules/.package-lock.json', 'node_modules/.package-lock.json', errorCode(error, 'HASH_FAILED'), `node_modules/.package-lock.json is unreadable (code ${errorCode(error, 'HASH_FAILED')})`);
  }
  const nodeModulesEntries = await walkNodeModules(nodeModules, 'node_modules');

  return {
    head: git.head,
    porcelainSha256: createHash('sha256').update(git.status).digest('hex'),
    dirtyFileSha256,
    envSha256,
    packageLockSha256,
    nodeModulesEntries,
  };
}

export function compareCanonicalTripwire(before: CanonicalTripwire, after: CanonicalTripwire): { modified: boolean; paths: string[]; count: number } {
  const paths = new Set<string>();
  if (before.head !== after.head) paths.add('.git/HEAD');
  if (before.porcelainSha256 !== after.porcelainSha256) paths.add('(git status changed)');
  if (before.packageLockSha256 !== after.packageLockSha256) paths.add('node_modules/.package-lock.json');
  for (const key of new Set([...before.dirtyFileSha256.keys(), ...after.dirtyFileSha256.keys()])) {
    if (before.dirtyFileSha256.get(key) !== after.dirtyFileSha256.get(key)) paths.add(key);
  }
  for (const key of new Set([...before.envSha256.keys(), ...after.envSha256.keys()])) {
    if (before.envSha256.get(key) !== after.envSha256.get(key)) paths.add(key);
  }
  for (const key of new Set([...before.nodeModulesEntries.keys(), ...after.nodeModulesEntries.keys()])) {
    if (before.nodeModulesEntries.get(key) !== after.nodeModulesEntries.get(key)) paths.add(key);
  }
  return { modified: paths.size > 0, paths: [...paths].sort().slice(0, 32), count: paths.size };
}
