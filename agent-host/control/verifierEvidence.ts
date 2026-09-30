/**
 * CT-VERIFY-1 Part A: Host evidence for the Verifier.
 *
 * Before a Verifier attempt is launched, the Host builds an authoritative
 * changed-file list and a bounded unified diff from the implementer candidate,
 * using the pinned baselineHeadSha as the baseline byte source (`git show`).
 * The full bounded diff is written to a sidecar file BESIDE the attempt
 * workspace (under the Host workspace root, never in the canonical repo). The
 * durable `workspace.diff.ready` event carries only metadata — never diff
 * content — so it stays well under the 8192-byte event payload limit.
 *
 * The Verifier working tree is read-only with no node_modules and no .git, so
 * it cannot run git/vitest/tsc itself. The Host computes this evidence FOR it.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { normalizeRepoRelativePath } from '../policy/pathPolicy.ts';
import {
  captureWorkspaceTree,
  classifyLineEndings,
  describeWorkspaceDelta,
  isExcludedWorkspacePath,
  readCapturedBaseline,
  resolveAttemptWorkspacePath,
  stripCRLF,
  type CapturedBaselineFile,
  type FileLineEnding,
  type WorkspaceTree,
} from '../workspace.ts';

const execFileAsync = promisify(execFile);

/** Total diff output cap in bytes. The bounded diff never exceeds this. */
export const VERIFIER_DIFF_TOTAL_CAP_BYTES = 64 * 1024;
/** Per-file hunk line cap. A single file's diff is truncated past this many lines. */
export const VERIFIER_DIFF_PER_FILE_LINE_CAP = 400;
/** Per-side input line cap for the LCS. Bounds LCS cost on very large files. */
export const VERIFIER_DIFF_INPUT_LINE_CAP = 2000;
/** Unified-diff context lines around each change group. */
const VERIFIER_DIFF_CONTEXT_LINES = 3;

export interface VerifierChangedFile {
  kind: 'add' | 'modify' | 'delete';
  path: string;
}

/**
 * Overall status of the Host evidence build.
 * - `full`: the changed-file list is complete AND every file's diff was emitted.
 * - `partial`: the changed-file list is complete but one or more per-file diffs
 *   were omitted (baseline drift vs HEAD, or file too large for the bounded LCS).
 * - `unavailable`: the changed-file list itself could not be computed (baseline
 *   or candidate tree unreadable, or the builder threw). The Verifier prompt must
 *   NEVER present an empty list as a complete `full` result in this state.
 */
export type VerifierHostEvidenceStatus = 'full' | 'partial' | 'unavailable';

export interface VerifierHostEvidence {
  readonly status: VerifierHostEvidenceStatus;
  /** Safe, content-free reason for a `partial`/`unavailable` status; null on `full`. */
  readonly reason: string | null;
  readonly changedFiles: readonly VerifierChangedFile[];
  readonly changedFileCount: number;
  /** Bounded unified diff text (may be truncated, and may contain per-file omission markers). */
  readonly diffText: string;
  /** Absolute path of the sidecar .diff.txt file under the Host workspace root. */
  readonly diffFilePath: string;
  /** SHA-256 of the bounded diff bytes. */
  readonly diffSha256: string;
  /** Byte length of the bounded diff. */
  readonly diffSizeBytes: number;
  /** True when the diff was truncated at the per-file or total cap. */
  readonly truncated: boolean;
  /** Paths whose individual diff was omitted (baseline drift or too large). Drives `partial`. */
  readonly omittedPaths: readonly string[];
}

export interface BuildVerifierHostEvidenceOptions {
  canonicalRepoPath: string;
  workspaceRoot: string;
  repoKey: string;
  runId: string;
  verifierAttemptId: string;
  /** Implementer (source) attempt id — where the captured baseline lives. */
  sourceAttemptId: string;
  baselineHeadSha: string;
  /** Read-only candidate workspace path (the verifier's tree). */
  candidateWorkspacePath: string;
  /** Test seam for `git show <sha>:<path>`. Returns null when the path is absent at the sha. */
  gitShow?: (repoPath: string, sha: string, filePath: string) => Promise<Buffer | null>;
  /** Test seam for writing the sidecar diff file. */
  writeFileImpl?: (filePath: string, data: Buffer) => Promise<void>;
  /** Test seam for capturing the candidate tree (defaults to the real walker). */
  captureTree?: (workspacePath: string) => Promise<WorkspaceTree>;
  totalCapBytes?: number;
  perFileLineCap?: number;
}

/**
 * Sidecar path for the bounded diff: `<attemptWorkspacePath>.diff.txt`, mirroring
 * the `.baseline.json` / `.changes.json` sidecars. Lives under the Host workspace
 * root, never inside the canonical repo.
 */
export function verifierDiffSidecarPath(options: {
  workspaceRoot: string;
  identity: { repoKey: string; runId: string; attemptId: string };
}): string {
  return `${resolveAttemptWorkspacePath(options)}.diff.txt`;
}

/**
 * Build the Host evidence for a Verifier attempt. Reads the implementer's
 * captured baseline tree + the candidate tree to derive the changed-file list,
 * then computes a bounded unified diff per changed path using baselineHeadSha
 * bytes vs candidate bytes. Writes the bounded diff to the sidecar file.
 *
 * Failures are SOFT: any I/O or git error yields an evidence object with the
 * changed-file list it could compute and a diff text that explains what was
 * unavailable, so the Verifier still launches and judges from the files.
 */
export async function buildVerifierHostEvidence(options: BuildVerifierHostEvidenceOptions): Promise<VerifierHostEvidence> {
  const totalCap = options.totalCapBytes ?? VERIFIER_DIFF_TOTAL_CAP_BYTES;
  const gitShow = options.gitShow ?? defaultGitShow;
  const writeImpl = options.writeFileImpl ?? ((filePath, data) => writeFile(filePath, data));
  const captureTree = options.captureTree ?? ((workspacePath) => captureWorkspaceTree(workspacePath));

  const diffFilePath = verifierDiffSidecarPath({
    workspaceRoot: options.workspaceRoot,
    identity: { repoKey: options.repoKey, runId: options.runId, attemptId: options.verifierAttemptId },
  });
  const relativeToRepo = path.relative(path.resolve(options.canonicalRepoPath), diffFilePath);
  if (!relativeToRepo.startsWith('..') && !path.isAbsolute(relativeToRepo)) {
    throw new Error('Verifier diff sidecar must be outside the canonical repository.');
  }

  // Source the changed-file list from the implementer's captured baseline vs the
  // candidate tree. This is the same delta adjudication used to accept the
  // implementer, so the Verifier sees the authoritative scope.
  const baseline = await readCapturedBaseline({
    workspaceRoot: options.workspaceRoot,
    identity: { repoKey: options.repoKey, runId: options.runId, attemptId: options.sourceAttemptId },
  }).catch(() => null);

  if (!baseline) {
    return unavailableEvidence(diffFilePath, 'captured baseline for the source attempt could not be read', writeImpl);
  }

  let candidateTree: WorkspaceTree;
  try {
    candidateTree = await captureTree(options.candidateWorkspacePath);
  } catch {
    return unavailableEvidence(diffFilePath, 'candidate workspace tree could not be captured', writeImpl);
  }

  if (baseline.baselineHeadSha !== options.baselineHeadSha) {
    return unavailableEvidence(diffFilePath, 'captured baseline revision does not match the verifier revision', writeImpl);
  }
  const changedFiles = describeWorkspaceDelta(baseline.baselineHeadSha, { files: baseline.files }, candidateTree);

  const segments: string[] = [];
  let usedBytes = 0;
  let truncated = false;
  const omittedPaths: string[] = [];

  for (const [index, change] of changedFiles.entries()) {
    const fileDiff = await buildFileDiff(change, options, gitShow, baseline.files);
    if (fileDiff.omitted) omittedPaths.push(change.path);
    const fileText = fileDiff.text;
    if (fileText.length === 0) continue;
    const fileBytes = Buffer.byteLength(fileText, 'utf8');
    if (usedBytes + fileBytes <= totalCap) {
      segments.push(fileText);
      usedBytes += fileBytes;
    } else {
      // Reserve the marker inside the cap; never split a UTF-8 character.
      const remaining = Math.max(0, totalCap - usedBytes);
      segments.push(sliceToBytes(fileText, remaining));
      truncated = true;
      omittedPaths.push(...changedFiles.slice(index + 1).map((entry) => entry.path));
      break;
    }
    if (fileDiff.truncated) truncated = true;
  }

  let diffText = segments.join('');
  if (changedFiles.length === 0) {
    // Genuinely no changes — a complete `full` result with an empty list.
    diffText = '(no changed files)\n';
  }
  if (truncated) {
    const marker = `\n...diff truncated at ${totalCap} bytes...\n`;
    const markerBytes = Buffer.byteLength(marker, 'utf8');
    diffText = totalCap >= markerBytes
      ? `${sliceToBytes(diffText, totalCap - markerBytes)}${marker}`
      : sliceToBytes(marker, totalCap);
  }

  const diffBytes = Buffer.from(diffText, 'utf8');
  await mkdir(path.dirname(diffFilePath), { recursive: true });
  await writeImpl(diffFilePath, diffBytes);

  const status: VerifierHostEvidenceStatus = omittedPaths.length > 0 || truncated ? 'partial' : 'full';
  const reason = status === 'partial'
    ? `diff omitted or truncated for ${omittedPaths.length} file(s): baseline differs from HEAD, file exceeds the ${VERIFIER_DIFF_INPUT_LINE_CAP}-line cap, or a diff output cap was reached`
    : null;

  return {
    status,
    reason,
    changedFiles,
    changedFileCount: changedFiles.length,
    diffText,
    diffFilePath,
    diffSha256: sha256(diffBytes),
    diffSizeBytes: diffBytes.byteLength,
    truncated,
    omittedPaths,
  };
}

async function unavailableEvidence(
  diffFilePath: string,
  reason: string,
  writeImpl: (filePath: string, data: Buffer) => Promise<void>,
): Promise<VerifierHostEvidence> {
  const diffText = `(HOST EVIDENCE UNAVAILABLE: ${reason})\n`;
  const diffBytes = Buffer.from(diffText, 'utf8');
  await mkdir(path.dirname(diffFilePath), { recursive: true });
  await writeImpl(diffFilePath, diffBytes);
  return {
    status: 'unavailable', reason, changedFiles: [], changedFileCount: 0,
    diffText, diffFilePath, diffSha256: sha256(diffBytes),
    diffSizeBytes: diffBytes.byteLength, truncated: false, omittedPaths: [],
  };
}

interface FileDiffResult {
  text: string;
  truncated: boolean;
  /** True when the per-file diff was intentionally omitted (drift or too large). */
  omitted: boolean;
  reason: 'drift' | 'too-large' | 'unreadable' | null;
}

async function buildFileDiff(
  change: VerifierChangedFile,
  options: BuildVerifierHostEvidenceOptions,
  gitShow: (repoPath: string, sha: string, filePath: string) => Promise<Buffer | null>,
  baselineFiles: ReadonlyMap<string, CapturedBaselineFile>,
): Promise<FileDiffResult> {
  const perFileLineCap = options.perFileLineCap ?? VERIFIER_DIFF_PER_FILE_LINE_CAP;
  let repoPath: string;
  try {
    repoPath = normalizeRepoRelativePath(change.path);
  } catch {
    return { text: 'diff omitted: invalid changed-file path\n', truncated: false, omitted: true, reason: 'unreadable' };
  }
  if (isExcludedWorkspacePath(repoPath)) {
    return { text: 'diff omitted: excluded changed-file path\n', truncated: false, omitted: true, reason: 'unreadable' };
  }

  const header = diffHeader(change.kind, repoPath);

  const candidateAbs = path.resolve(options.candidateWorkspacePath, ...repoPath.split('/'));
  const candidateInfo = await lstat(candidateAbs).catch(() => null);
  // Never follow a symlink or read a directory out of the candidate.
  if (candidateInfo && (!candidateInfo.isFile() || candidateInfo.isSymbolicLink())) {
    return { text: `${header}diff omitted: candidate is not a regular file\n`, truncated: false, omitted: true, reason: 'unreadable' };
  }

  const candidateBytes = change.kind === 'delete' || !candidateInfo
    ? null
    : await readFile(candidateAbs).catch(() => null);
  if (change.kind !== 'delete' && candidateBytes === null) {
    return { text: `${header}diff omitted: candidate file could not be read\n`, truncated: false, omitted: true, reason: 'unreadable' };
  }

  // A6: the captured baseline is canonical ON-DISK bytes (including any uncommitted
  // owner work at run start), but the diff reads baseline bytes via
  // `git show <baselineHeadSha>:<path>` (the committed blob). For modify/delete we
  // must confirm the committed blob — line-ending normalized the SAME way the
  // baseline was fingerprinted — matches the captured baseline fingerprint. If it
  // does not, the owner had uncommitted edits to this file at run start, so the
  // git-show baseline does NOT represent the run's real starting point: omit the
  // diff with an explicit note and keep the file in the changed-file list. ADDs
  // have no baseline to check.
  let baselineBytes: Buffer | null = null;
  if (change.kind !== 'add') {
    baselineBytes = await gitShow(options.canonicalRepoPath, options.baselineHeadSha, repoPath).catch(() => null);
    if (baselineBytes === null) {
      // HEAD does not contain this path, yet the on-disk baseline did — uncommitted
      // (untracked-then-edited) work at run start. Omit.
      return {
        text: `${header}diff omitted: baseline differs from HEAD (uncommitted work at run start)\n`,
        truncated: false,
        omitted: true,
        reason: 'drift',
      };
    }
    const baselineFile = baselineFiles.get(repoPath);
    const gitNormalized = classifyLineEndings(baselineBytes) === 'crlf' ? stripCRLF(baselineBytes) : baselineBytes;
    const gitNormSha = sha256(gitNormalized);
    const expectedSha = baselineFile?.sha256Normalized ?? baselineFile?.sha256;
    if (!expectedSha || gitNormSha !== expectedSha) {
      return {
        text: `${header}diff omitted: baseline differs from HEAD (uncommitted work at run start)\n`,
        truncated: false,
        omitted: true,
        reason: 'drift',
      };
    }
  }

  const beforeEnding = baselineBytes ? classifyLineEndings(baselineBytes) : 'lf' as FileLineEnding;
  const afterEnding = candidateBytes ? classifyLineEndings(candidateBytes) : 'lf' as FileLineEnding;
  const binary = beforeEnding === 'binary' || afterEnding === 'binary';

  if (binary) {
    return { text: `${header}Binary file ${repoPath} changed (kind: ${change.kind}).\n`, truncated: false, omitted: false, reason: null };
  }

  const beforeText = baselineBytes ? stripCRLF(baselineBytes).toString('utf8') : '';
  const afterText = candidateBytes ? stripCRLF(candidateBytes).toString('utf8') : '';
  const beforeLines = beforeText.length > 0 ? beforeText.split('\n') : [];
  const afterLines = afterText.length > 0 ? afterText.split('\n') : [];
  // Drop a trailing empty line produced by a final newline so the diff doesn't
  // show a phantom extra line; keep it consistent with `git diff` line counts.
  if (beforeLines.length > 0 && beforeLines.at(-1) === '') beforeLines.pop();
  if (afterLines.length > 0 && afterLines.at(-1) === '') afterLines.pop();

  // LCS input cap: when either side exceeds the cap, emit an explicit "diff too
  // large — omitted" marker rather than silently slicing (which would produce an
  // incorrect, partial diff that hides changes past the cap). The file stays in
  // the changed-file list; this omission drives the `partial` status.
  if (beforeLines.length > VERIFIER_DIFF_INPUT_LINE_CAP || afterLines.length > VERIFIER_DIFF_INPUT_LINE_CAP) {
    return {
      text: `${header}diff too large — omitted (file exceeds ${VERIFIER_DIFF_INPUT_LINE_CAP} lines per side)\n`,
      truncated: false,
      omitted: true,
      reason: 'too-large',
    };
  }

  const ops = lcsOps(beforeLines, afterLines);
  const hunks = buildHunkRanges(ops, VERIFIER_DIFF_CONTEXT_LINES);
  if (hunks.length === 0) {
    // No textual change after normalization (e.g. line-ending-only edit).
    return { text: `${header}(no textual change after line-ending normalization)\n`, truncated: false, omitted: false, reason: null };
  }

  const lines: string[] = [header];
  let emittedLines = 0;
  let fileTruncated = false;
  const oldAt: number[] = new Array(ops.length);
  const newAt: number[] = new Array(ops.length);
  {
    let oldL = 1;
    let newL = 1;
    for (let i = 0; i < ops.length; i += 1) {
      oldAt[i] = oldL;
      newAt[i] = newL;
      if (ops[i].type === 'ctx') { oldL += 1; newL += 1; }
      else if (ops[i].type === 'del') { oldL += 1; }
      else { newL += 1; }
    }
  }

  for (const hunk of hunks) {
    if (emittedLines >= perFileLineCap) {
      fileTruncated = true;
      break;
    }
    let oldCount = 0;
    let newCount = 0;
    for (let i = hunk.startIdx; i < hunk.endIdx; i += 1) {
      if (ops[i].type === 'ctx' || ops[i].type === 'del') oldCount += 1;
      if (ops[i].type === 'ctx' || ops[i].type === 'add') newCount += 1;
    }
    const oldStart = oldCount === 0 ? Math.max(0, oldAt[hunk.startIdx] - 1) : oldAt[hunk.startIdx];
    const newStart = newCount === 0 ? Math.max(0, newAt[hunk.startIdx] - 1) : newAt[hunk.startIdx];
    lines.push(`@@ -${oldStart}${oldCount === 1 ? '' : `,${oldCount}`} +${newStart}${newCount === 1 ? '' : `,${newCount}`} @@\n`);
    for (let i = hunk.startIdx; i < hunk.endIdx; i += 1) {
      if (emittedLines >= perFileLineCap) {
        fileTruncated = true;
        break;
      }
      const op = ops[i];
      const prefix = op.type === 'ctx' ? ' ' : op.type === 'del' ? '-' : '+';
      lines.push(`${prefix}${op.text}\n`);
      emittedLines += 1;
    }
  }
  if (fileTruncated) {
    lines.push(`...truncated: per-file diff line cap (${perFileLineCap}) reached...\n`);
  }

  return { text: lines.join(''), truncated: fileTruncated, omitted: false, reason: null };
}

function diffHeader(kind: 'add' | 'modify' | 'delete', repoPath: string): string {
  if (kind === 'add') {
    return `diff --git a/${repoPath} b/${repoPath}\nnew file mode 100644\n--- /dev/null\n+++ b/${repoPath}\n`;
  }
  if (kind === 'delete') {
    return `diff --git a/${repoPath} b/${repoPath}\ndeleted file mode 100644\n--- a/${repoPath}\n+++ /dev/null\n`;
  }
  return `diff --git a/${repoPath} b/${repoPath}\n--- a/${repoPath}\n+++ b/${repoPath}\n`;
}

interface DiffOp {
  type: 'ctx' | 'add' | 'del';
  text: string;
}

/**
 * LCS-based line diff. The caller guarantees each side is already within the
 * {@link VERIFIER_DIFF_INPUT_LINE_CAP}; oversize files are omitted earlier with
 * an explicit "diff too large — omitted" marker rather than silently sliced
 * (slicing would hide changes past the cap and produce an incorrect diff).
 */
function lcsOps(before: string[], after: string[]): DiffOp[] {
  const a = before;
  const b = after;
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const dp = new Array<number>((n + 1) * width).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i * width + j] = a[i] === b[j]
        ? dp[(i + 1) * width + (j + 1)] + 1
        : Math.max(dp[(i + 1) * width + j], dp[i * width + (j + 1)]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'ctx', text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) {
      ops.push({ type: 'del', text: a[i] });
      i += 1;
    } else {
      ops.push({ type: 'add', text: b[j] });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ type: 'del', text: a[i] });
    i += 1;
  }
  while (j < m) {
    ops.push({ type: 'add', text: b[j] });
    j += 1;
  }
  return ops;
}

/**
 * Group change indices into hunks separated by at most `2*context` context
 * lines, returning [startIdx, endIdx) ranges (inclusive of context).
 */
function buildHunkRanges(ops: DiffOp[], context: number): Array<{ startIdx: number; endIdx: number }> {
  const changes: number[] = [];
  for (let i = 0; i < ops.length; i += 1) {
    if (ops[i].type !== 'ctx') changes.push(i);
  }
  if (changes.length === 0) return [];
  const groups: Array<{ s: number; e: number }> = [];
  let cur = { s: changes[0], e: changes[0] };
  for (let i = 1; i < changes.length; i += 1) {
    if (changes[i] - cur.e <= 2 * context) {
      cur.e = changes[i];
    } else {
      groups.push(cur);
      cur = { s: changes[i], e: changes[i] };
    }
  }
  groups.push(cur);
  return groups.map((group) => ({
    startIdx: Math.max(0, group.s - context),
    endIdx: Math.min(ops.length, group.e + context + 1),
  }));
}

/** Slice a string to at most `maxBytes` UTF-8 bytes without splitting a character. */
function sliceToBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (Buffer.byteLength(text.slice(0, mid), 'utf8') <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo);
}

async function defaultGitShow(repoPath: string, sha: string, filePath: string): Promise<Buffer | null> {
  try {
    const result = await execFileAsync('git', ['show', `${sha}:${filePath}`], {
      cwd: repoPath,
      windowsHide: true,
      encoding: 'buffer',
      maxBuffer: 32 * 1024 * 1024,
    });
    return result.stdout;
  } catch {
    return null;
  }
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
