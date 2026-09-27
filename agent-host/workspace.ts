import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, cp, lstat, mkdir, readdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { createTaskPolicyContext, normalizeRepoRelativePath, toRepoPathKey } from './policy/pathPolicy.ts';
import { adjudicateRepoPolicy } from './policy/policy.ts';
import { isSensitiveRepoPath } from './policy/repoPolicy.ts';
import type { PolicyAdjudication, PolicyBaselineCapture, RepoPathFingerprint, RepoSnapshot, RepoStatusEntryFingerprint } from './policy/types.ts';
import type { JsonValue, OrchestrationEventRecord, TaskRecord } from './lib/orchestrationTypes.ts';
import type { PermissionProfile } from './providers/types.ts';

const execFileAsync = promisify(execFile);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export function resolveWorkspaceTarExecutable(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  if (platform !== 'win32') {
    return 'tar';
  }
  const windowsRoot = environment.SystemRoot ?? environment.WINDIR ?? 'C:\\Windows';
  return path.join(windowsRoot, 'System32', 'tar.exe');
}

export interface AttemptWorkspaceIdentity {
  repoKey: string;
  runId: string;
  attemptId: string;
}

export interface AttemptWorkspace {
  workspaceId: string;
  workspaceRoot: string;
  workspacePath: string;
  baselineHeadSha: string;
  materializationMode: 'git-archive-tar' | 'candidate-copy';
  /** Verifier copies are read-only views of an implementer candidate. */
  readOnly?: boolean;
  sourceWorkspacePath?: string;
  baselineTree: WorkspaceTree;
}

export interface WorkspaceTree {
  readonly files: ReadonlyMap<string, WorkspaceFileFingerprint>;
}

export interface WorkspaceFileFingerprint {
  path: string;
  sha256: string;
  sizeBytes: number;
}

export interface WorkspaceChangeSet {
  workspaceId: string;
  baselineHeadSha: string;
  changes: readonly { kind: 'add' | 'modify' | 'delete'; path: string; sha256: string | null; sizeBytes: number | null }[];
}

export class WorkspacePreparationError extends Error {}

export function resolveAttemptWorkspacePath(options: { workspaceRoot: string; identity: AttemptWorkspaceIdentity }): string {
  for (const value of [options.identity.repoKey, options.identity.runId, options.identity.attemptId]) {
    if (!SAFE_ID.test(value)) {
      throw new WorkspacePreparationError('Workspace identity contains an unsafe path segment.');
    }
  }
  const root = path.resolve(options.workspaceRoot);
  const candidate = path.resolve(root, options.identity.repoKey, options.identity.runId, options.identity.attemptId);
  if (!isPathInside(root, candidate)) {
    throw new WorkspacePreparationError('Workspace path escaped the Host workspace root.');
  }
  return candidate;
}

export async function materializeAttemptWorkspace(options: {
  canonicalRepoPath: string;
  workspaceRoot: string;
  identity: AttemptWorkspaceIdentity;
  baselineHeadSha?: string;
}): Promise<AttemptWorkspace> {
  const workspacePath = resolveAttemptWorkspacePath({ workspaceRoot: options.workspaceRoot, identity: options.identity });
  const baselineHeadSha = await resolvePinnedHead(options.canonicalRepoPath, options.baselineHeadSha);
  await rejectTrackedSensitivePaths(options.canonicalRepoPath, baselineHeadSha);

  const workspaceRoot = path.resolve(options.workspaceRoot);
  await mkdir(workspaceRoot, { recursive: true });
  if (await pathExists(workspacePath)) {
    throw new WorkspacePreparationError('Attempt workspace already exists and will not be reused.');
  }
  await mkdir(workspacePath, { recursive: true });

  const archivePath = path.join(workspaceRoot, `.materialize-${options.identity.attemptId}.tar`);
  try {
    const archive = await execFileAsync('git', ['archive', '--format=tar', baselineHeadSha], {
      cwd: options.canonicalRepoPath,
      windowsHide: true,
      maxBuffer: 512 * 1024 * 1024,
      encoding: 'buffer',
    });
    await writeFile(archivePath, archive.stdout);
    await execFileAsync(resolveWorkspaceTarExecutable(), ['-xf', archivePath, '-C', workspacePath], {
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    // The archive is committed HEAD. Overlay the eligible canonical working
    // tree before the baseline fingerprint so inherited owner work is the
    // pre-provider baseline, not a later candidate delta.
    await overlayEligibleWorkingTree(options.canonicalRepoPath, workspacePath);
  } catch (error) {
    await rm(workspacePath, { recursive: true, force: true });
    throw new WorkspacePreparationError(`Failed to materialize isolated workspace: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await unlink(archivePath).catch(() => undefined);
  }

  if (await pathExists(path.join(workspacePath, '.git'))) {
    await rm(workspacePath, { recursive: true, force: true });
    throw new WorkspacePreparationError('Materialized workspace unexpectedly contains .git.');
  }

  const baselineTree = await captureWorkspaceTree(workspacePath);
  try {
    await writeCapturedBaseline({
      workspaceRoot,
      identity: options.identity,
      baselineHeadSha,
      tree: baselineTree,
    });
  } catch (error) {
    await rm(workspacePath, { recursive: true, force: true });
    throw new WorkspacePreparationError(`Failed to persist captured baseline: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    workspaceId: `${options.identity.repoKey}/${options.identity.runId}/${options.identity.attemptId}`,
    workspaceRoot,
    workspacePath,
    baselineHeadSha,
    materializationMode: 'git-archive-tar',
    readOnly: false,
    baselineTree,
  };
}

/**
 * Read-only copy of an accepted implementer workspace.
 * The copy is the verifier's tree. Canonical is not modified.
 */
export async function materializeVerifierWorkspace(options: {
  sourceWorkspacePath: string;
  workspaceRoot: string;
  identity: AttemptWorkspaceIdentity;
  baselineHeadSha: string;
}): Promise<AttemptWorkspace> {
  const sourceWorkspacePath = path.resolve(options.sourceWorkspacePath);
  const workspaceRoot = path.resolve(options.workspaceRoot);
  if (!isPathInside(workspaceRoot, sourceWorkspacePath)) {
    throw new WorkspacePreparationError('Verifier candidate escaped the Host workspace root.');
  }
  if (!(await pathExists(sourceWorkspacePath))) {
    throw new WorkspacePreparationError('Implementer candidate workspace is not available.');
  }
  const workspacePath = resolveAttemptWorkspacePath({ workspaceRoot, identity: options.identity });
  if (path.resolve(workspacePath) === sourceWorkspacePath) {
    throw new WorkspacePreparationError('Verifier workspace cannot reuse the implementer workspace path.');
  }
  if (await pathExists(workspacePath)) {
    throw new WorkspacePreparationError('Attempt workspace already exists and will not be reused.');
  }
  await mkdir(workspaceRoot, { recursive: true });
  try {
    await cp(sourceWorkspacePath, workspacePath, { recursive: true, errorOnExist: true });
    await markTreeReadOnly(workspacePath);
  } catch (error) {
    await rm(workspacePath, { recursive: true, force: true });
    throw new WorkspacePreparationError(`Failed to materialize verifier workspace: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    workspaceId: `${options.identity.repoKey}/${options.identity.runId}/${options.identity.attemptId}`,
    workspaceRoot,
    workspacePath,
    baselineHeadSha: options.baselineHeadSha,
    materializationMode: 'candidate-copy',
    readOnly: true,
    sourceWorkspacePath,
    baselineTree: await captureWorkspaceTree(workspacePath),
  };
}

export interface ImplementerCandidateWorkspace {
  workspacePath: string;
  baselineHeadSha: string;
  sourceAttemptId: string;
}

/** Latest passed implementer workspace among the verifier's dependencies. */
export function resolveImplementerCandidateWorkspace(options: {
  workspaceRoot: string;
  repoKey: string;
  runId: string;
  dependencyTaskIds: readonly string[];
  events: readonly Pick<OrchestrationEventRecord, 'seq' | 'taskId' | 'attemptId' | 'type' | 'payload'>[];
  isPassedAttempt: (attemptId: string, taskId: string) => boolean;
}): ImplementerCandidateWorkspace | null {
  const dependencies = new Set(options.dependencyTaskIds);
  const relevant = options.events
    .filter((event) => event.taskId !== null && event.attemptId !== null && dependencies.has(event.taskId) && options.isPassedAttempt(event.attemptId, event.taskId))
    .slice()
    .sort((left, right) => left.seq - right.seq);
  const ready = relevant.filter((event) => event.type === 'workspace.changeset.ready');
  const accepted = relevant.filter((event) => event.type === 'workspace.adjudication.completed' && payloadBoolean(event.payload, 'policyAccepted') === true);
  const chosen = ready.at(-1) ?? accepted.at(-1);
  if (!chosen?.attemptId) {
    return null;
  }
  const prepared = relevant.find((event) => event.type === 'workspace.prepared' && event.attemptId === chosen.attemptId);
  const baselineHeadSha = payloadString(chosen.payload, 'baselineHeadSha') ?? payloadString(prepared?.payload ?? null, 'baselineHeadSha');
  if (!baselineHeadSha) {
    return null;
  }
  return {
    workspacePath: resolveAttemptWorkspacePath({
      workspaceRoot: options.workspaceRoot,
      identity: { repoKey: options.repoKey, runId: options.runId, attemptId: chosen.attemptId },
    }),
    baselineHeadSha,
    sourceAttemptId: chosen.attemptId,
  };
}

export async function captureWorkspaceTree(workspacePath: string): Promise<WorkspaceTree> {
  const files = new Map<string, WorkspaceFileFingerprint>();
  async function walk(directory: string, prefix: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(directory, entry.name), relativePath);
      } else if (entry.isFile()) {
        const normalized = normalizeRepoRelativePath(relativePath);
        const content = await readFile(path.join(directory, entry.name));
        files.set(normalized, { path: normalized, sha256: sha256(content), sizeBytes: content.byteLength });
      }
    }
  }
  await walk(workspacePath, '');
  return { files };
}

export async function adjudicateAttemptWorkspace(options: {
  workspace: AttemptWorkspace;
  runId: string;
  task: TaskRecord;
  attemptId: string;
  permissionProfile: PermissionProfile;
}): Promise<{ policy: PolicyAdjudication; changeSet: WorkspaceChangeSet | null; changedFileCount: number }> {
  const finalTree = await captureWorkspaceTree(options.workspace.workspacePath);
  const finalSnapshot = buildWorkspaceSnapshot(options.workspace.baselineHeadSha, options.workspace.baselineTree, finalTree);
  const baseline = createWorkspacePolicyBaseline(options);
  const policy = adjudicateRepoPolicy({ baseline, finalSnapshot });
  return {
    policy,
    changedFileCount: finalSnapshot.entries.length,
    changeSet: policy.accepted ? buildWorkspaceChangeSet(options.workspace, finalTree) : null,
  };
}

export function createWorkspacePolicyBaseline(options: {
  workspace: AttemptWorkspace;
  runId: string;
  task: TaskRecord;
  attemptId: string;
  permissionProfile: PermissionProfile;
}): PolicyBaselineCapture {
  return {
    runId: options.runId,
    taskId: options.task.taskId,
    attemptId: options.attemptId,
    repoPath: options.workspace.workspacePath,
    taskPolicy: createTaskPolicyContext({ taskSpec: options.task.spec, permissionProfile: options.permissionProfile }),
    snapshot: { headSha: options.workspace.baselineHeadSha, entries: [] },
  };
}

function buildWorkspaceSnapshot(headSha: string, baseline: WorkspaceTree, finalTree: WorkspaceTree): RepoSnapshot {
  const entries: RepoStatusEntryFingerprint[] = [];
  const paths = new Set([...baseline.files.keys(), ...finalTree.files.keys()]);
  for (const repoPath of [...paths].sort()) {
    const before = baseline.files.get(repoPath);
    const after = finalTree.files.get(repoPath);
    if (before?.sha256 === after?.sha256 && before?.sizeBytes === after?.sizeBytes) {
      continue;
    }
    const kind = before && !after ? 'deleted' : before ? 'tracked' : 'untracked';
    const indexStatus = kind === 'untracked' ? '?' : ' ';
    const worktreeStatus = kind === 'untracked' ? '?' : kind === 'deleted' ? 'D' : 'M';
    const fingerprint = toRepoFingerprint(repoPath, after ?? null);
    entries.push({
      path: repoPath,
      pathKey: toRepoPathKey(repoPath),
      indexStatus,
      worktreeStatus,
      kind,
      pathFingerprint: fingerprint,
      entryFingerprintSha256: sha256(JSON.stringify({ repoPath, indexStatus, worktreeStatus, fingerprint })),
    });
  }
  return { headSha, entries };
}

export function describeWorkspaceDelta(
  baselineHeadSha: string,
  baseline: WorkspaceTree,
  finalTree: WorkspaceTree,
): Array<{ kind: 'add' | 'modify' | 'delete'; path: string }> {
  return buildWorkspaceSnapshot(baselineHeadSha, baseline, finalTree).entries.map((entry) => ({
    kind: entry.kind === 'untracked' ? 'add' as const : entry.kind === 'deleted' ? 'delete' as const : 'modify' as const,
    path: entry.path,
  }));
}

function buildWorkspaceChangeSet(workspace: AttemptWorkspace, finalTree: WorkspaceTree): WorkspaceChangeSet {
  const changes: WorkspaceChangeSet['changes'][number][] = buildWorkspaceSnapshot(workspace.baselineHeadSha, workspace.baselineTree, finalTree).entries.map((entry) => ({
    kind: entry.kind === 'untracked' ? 'add' : entry.kind === 'deleted' ? 'delete' : 'modify',
    path: entry.path,
    sha256: entry.pathFingerprint.workingTreeSha256,
    sizeBytes: entry.pathFingerprint.sizeBytes,
  }));
  return { workspaceId: workspace.workspaceId, baselineHeadSha: workspace.baselineHeadSha, changes };
}

function toRepoFingerprint(repoPath: string, file: WorkspaceFileFingerprint | null): RepoPathFingerprint {
  return {
    path: repoPath,
    pathKey: toRepoPathKey(repoPath),
    exists: file !== null,
    nodeKind: file ? 'file' : 'missing',
    workingTreeSha256: file?.sha256 ?? null,
    sizeBytes: file?.sizeBytes ?? null,
    indexObjectId: null,
  };
}

const UNTRACKED_JUNK_SEGMENTS = new Set(['.temp', 'temp', 'tmp', 'node_modules', 'dist', '.netlify']);
const UNTRACKED_JUNK_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp',
  '.exe', '.dll', '.zip', '.gz', '.tgz', '.7z', '.mp4', '.mov', '.pdf', '.sqlite', '.db', '.log',
]);

interface PorcelainRecord {
  path: string;
  originalPath: string | null;
  indexStatus: string;
  worktreeStatus: string;
}

/**
 * Eligible canonical working-tree files copied onto the committed archive.
 * Ignored paths never appear in `git status`. Sensitive paths and untracked
 * temp/binary junk stay out. Tracked modifications and deletions are the
 * owner's real tree, including files the provider may later edit further.
 */
async function overlayEligibleWorkingTree(canonicalRepoPath: string, workspacePath: string): Promise<void> {
  const result = await execFileAsync('git', ['status', '--porcelain=v1', '-z', '-uall'], {
    cwd: canonicalRepoPath,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    encoding: 'buffer',
  });
  for (const record of parsePorcelainZ(result.stdout)) {
    let repoPath: string;
    try {
      repoPath = normalizeRepoRelativePath(record.path);
    } catch {
      continue;
    }
    if (isSensitiveRepoPath(repoPath) || repoPath === '.git' || repoPath.startsWith('.git/')) {
      continue;
    }
    const deleted = record.worktreeStatus === 'D' || (record.indexStatus === 'D' && record.worktreeStatus === ' ');
    const untracked = record.indexStatus === '?' && record.worktreeStatus === '?';
    if (untracked && !isEligibleUntrackedSource(repoPath)) {
      continue;
    }
    if (!deleted && !untracked && record.indexStatus === ' ' && record.worktreeStatus === ' ') {
      continue;
    }
    if (record.originalPath) {
      await removeWorkspacePath(workspacePath, record.originalPath);
    }
    if (deleted) {
      await removeWorkspacePath(workspacePath, repoPath);
      continue;
    }
    await copyWorkspaceFile(canonicalRepoPath, workspacePath, repoPath);
  }
}

function isEligibleUntrackedSource(repoPath: string): boolean {
  if (isSensitiveRepoPath(repoPath)) {
    return false;
  }
  const parts = repoPath.split('/');
  if (parts.some((part) => part === '.git' || UNTRACKED_JUNK_SEGMENTS.has(part.toLowerCase()))) {
    return false;
  }
  const baseName = parts.at(-1) ?? '';
  const dot = baseName.lastIndexOf('.');
  const extension = dot >= 0 ? baseName.slice(dot).toLowerCase() : '';
  return extension.length === 0 || !UNTRACKED_JUNK_EXTENSIONS.has(extension);
}

function parsePorcelainZ(stdout: Buffer | string): PorcelainRecord[] {
  const text = typeof stdout === 'string' ? stdout : Buffer.from(stdout).toString('utf8');
  const tokens = text.split('\0');
  if (tokens.at(-1) === '') {
    tokens.pop();
  }
  const records: PorcelainRecord[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? '';
    if (token.length < 4) {
      continue;
    }
    const indexStatus = token[0] ?? ' ';
    const worktreeStatus = token[1] ?? ' ';
    const entryPath = token.slice(3);
    const renamed = indexStatus === 'R' || indexStatus === 'C' || worktreeStatus === 'R' || worktreeStatus === 'C';
    if (renamed) {
      index += 1;
      const nextPath = tokens[index];
      if (!nextPath) {
        continue;
      }
      records.push({ path: nextPath, originalPath: entryPath, indexStatus, worktreeStatus });
      continue;
    }
    records.push({ path: entryPath, originalPath: null, indexStatus, worktreeStatus });
  }
  return records;
}

async function copyWorkspaceFile(canonicalRepoPath: string, workspacePath: string, repoPath: string): Promise<void> {
  const source = path.resolve(canonicalRepoPath, ...repoPath.split('/'));
  const destination = path.resolve(workspacePath, ...repoPath.split('/'));
  if (!isPathInside(path.resolve(canonicalRepoPath), source) || !isPathInside(path.resolve(workspacePath), destination)) {
    return;
  }
  const info = await lstat(source).catch(() => null);
  if (!info?.isFile()) {
    return;
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination);
}

async function removeWorkspacePath(workspacePath: string, rawPath: string): Promise<void> {
  let repoPath: string;
  try {
    repoPath = normalizeRepoRelativePath(rawPath);
  } catch {
    return;
  }
  const destination = path.resolve(workspacePath, ...repoPath.split('/'));
  if (!isPathInside(path.resolve(workspacePath), destination)) {
    return;
  }
  await rm(destination, { force: true });
}

async function resolvePinnedHead(repoPath: string, expected: string | undefined): Promise<string> {
  const result = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoPath, windowsHide: true });
  const head = result.stdout.trim();
  if (!/^[0-9a-f]{40}$/iu.test(head) || (expected && head !== expected)) {
    throw new WorkspacePreparationError('Canonical baseline HEAD did not match the requested pinned revision.');
  }
  return head;
}

async function rejectTrackedSensitivePaths(repoPath: string, headSha: string): Promise<void> {
  const result = await execFileAsync('git', ['ls-tree', '-r', '--name-only', headSha], { cwd: repoPath, windowsHide: true });
  const sensitivePath = result.stdout.split(/\r?\n/u).find((entry) => entry.length > 0 && isSensitiveRepoPath(entry));
  if (sensitivePath) {
    throw new WorkspacePreparationError('Committed baseline contains a sensitive file and cannot be materialized for a provider.');
  }
}

export interface CapturedBaselineFile {
  path: string;
  sha256: string;
  sizeBytes: number;
}

export interface CandidateChangeIndexEntry {
  path: string;
  kind: 'add' | 'modify' | 'delete';
}

const CAPTURED_BASELINE_SCHEMA = 1;

export function capturedBaselineSidecarPath(options: { workspaceRoot: string; identity: AttemptWorkspaceIdentity }): string {
  return `${resolveAttemptWorkspacePath(options)}.baseline.json`;
}

export function candidateChangeIndexPath(options: { workspaceRoot: string; identity: AttemptWorkspaceIdentity }): string {
  return `${resolveAttemptWorkspacePath(options)}.changes.json`;
}

export async function writeCapturedBaseline(options: {
  workspaceRoot: string;
  identity: AttemptWorkspaceIdentity;
  baselineHeadSha: string;
  tree: WorkspaceTree;
}): Promise<void> {
  const destination = capturedBaselineSidecarPath(options);
  const files = [...options.tree.files.values()]
    .map((file) => ({ path: file.path, sha256: file.sha256, sizeBytes: file.sizeBytes }))
    .sort((left, right) => left.path.localeCompare(right.path));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify({
    schemaVersion: CAPTURED_BASELINE_SCHEMA,
    baselineHeadSha: options.baselineHeadSha,
    files,
  }));
}

export async function readCapturedBaseline(options: {
  workspaceRoot: string;
  identity: AttemptWorkspaceIdentity;
}): Promise<{ baselineHeadSha: string; files: Map<string, CapturedBaselineFile> } | null> {
  const source = capturedBaselineSidecarPath(options);
  let raw: string;
  try {
    raw = await readFile(source, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (record.schemaVersion !== CAPTURED_BASELINE_SCHEMA || typeof record.baselineHeadSha !== 'string') return null;
  if (!Array.isArray(record.files)) return null;
  const files = new Map<string, CapturedBaselineFile>();
  for (const entry of record.files) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
    const file = entry as Record<string, unknown>;
    if (typeof file.path !== 'string' || typeof file.sha256 !== 'string' || typeof file.sizeBytes !== 'number') return null;
    try {
      const normalized = normalizeRepoRelativePath(file.path);
      files.set(normalized, { path: normalized, sha256: file.sha256, sizeBytes: file.sizeBytes });
    } catch {
      return null;
    }
  }
  return { baselineHeadSha: record.baselineHeadSha, files };
}

export async function writeCandidateChangeIndex(options: {
  workspaceRoot: string;
  identity: AttemptWorkspaceIdentity;
  changes: readonly CandidateChangeIndexEntry[];
}): Promise<void> {
  const destination = candidateChangeIndexPath(options);
  const changes = [...options.changes].sort((left, right) => left.path.localeCompare(right.path));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify({ schemaVersion: CAPTURED_BASELINE_SCHEMA, changes }));
}

export async function readCandidateChangeIndex(options: {
  workspaceRoot: string;
  identity: AttemptWorkspaceIdentity;
}): Promise<CandidateChangeIndexEntry[] | null> {
  const source = candidateChangeIndexPath(options);
  let raw: string;
  try {
    raw = await readFile(source, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (record.schemaVersion !== CAPTURED_BASELINE_SCHEMA || !Array.isArray(record.changes)) return null;
  const changes: CandidateChangeIndexEntry[] = [];
  for (const entry of record.changes) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
    const change = entry as Record<string, unknown>;
    if (change.kind !== 'add' && change.kind !== 'modify' && change.kind !== 'delete') return null;
    if (typeof change.path !== 'string') return null;
    try {
      changes.push({ path: normalizeRepoRelativePath(change.path), kind: change.kind });
    } catch {
      return null;
    }
  }
  return changes;
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function pathExists(candidate: string): Promise<boolean> {
  return await stat(candidate).then(() => true, () => false);
}

async function markTreeReadOnly(workspacePath: string): Promise<void> {
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(child);
      } else if (entry.isFile()) {
        await chmod(child, 0o444);
      }
    }
  }
  await walk(workspacePath);
}

function payloadRecord(payload: JsonValue | null | undefined): Record<string, JsonValue> | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return null;
  }
  return payload as Record<string, JsonValue>;
}

function payloadString(payload: JsonValue | null | undefined, key: string): string | null {
  const value = payloadRecord(payload)?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function payloadBoolean(payload: JsonValue | null | undefined, key: string): boolean | null {
  const value = payloadRecord(payload)?.[key];
  return typeof value === 'boolean' ? value : null;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
