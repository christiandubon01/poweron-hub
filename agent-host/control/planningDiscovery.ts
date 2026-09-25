/**
 * CT-LIVE-0B Fast Planning: a small local repo orientation and a bounded
 * filename search. This is not a semantic index and it does not cache
 * execution results.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { CANONICAL_PROTECTED_REPO_PATHS } from '../policy/repoPolicy.ts';

const execFileAsync = promisify(execFile);

export const FAST_CANDIDATE_BUDGET = 24;
export const FAST_INSPECT_BUDGET = 8;
export const FAST_AREA_BUDGET = 4;
export const FAST_DIRECTORY_VISIT_BUDGET = 120;

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.netlify', 'coverage']);
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'your', 'repo',
  'file', 'files', 'only', 'does', 'not', 'plan', 'task', 'create', 'make',
  'should', 'must', 'when', 'then', 'than', 'have', 'will', 'keep', 'using',
]);

const NOTABLE_AREAS: ReadonlyArray<{ path: string; note: string }> = [
  { path: 'src/features/control-tower', note: 'Control Tower feature' },
  { path: 'src/components/v15r/app-brain/control-tower', note: 'Control Tower UI' },
  { path: 'agent-host/control', note: 'Agent Host control plane' },
  { path: 'agent-host/providers', note: 'Provider adapters' },
  { path: 'supabase/migrations', note: 'Local SQL migrations' },
  { path: 'src', note: 'Application source' },
];

const TEST_LOCATIONS = [
  'src/components/v15r/__tests__',
  'src/features/control-tower/__tests__',
  'agent-host/control',
];

export interface RepoOrientation {
  schemaVersion: 1;
  headSha: string;
  workTreeFingerprint: string;
  generatedAt: string;
  topLevelDirectories: string[];
  notableAreas: Array<{ path: string; note: string }>;
  protectedPaths: string[];
  testLocations: string[];
}

export interface PlanningDiscovery {
  mode: 'fast' | 'deep';
  available: boolean;
  usedCache: boolean;
  candidateFiles: string[];
  inspectedFiles: string[];
  areas: string[];
  appendix: string;
}

export type PlanningDiscoveryOutcome =
  | { ok: true; discovery: PlanningDiscovery }
  | { ok: false; code: 'PLANNING_BUDGET_EXCEEDED' | 'PLANNING_TARGETS_MISSING'; message: string };

export function planningSearchTerms(scope: string): string[] {
  const tokens = scope.toLowerCase().match(/[a-z0-9_./-]{3,}/g) ?? [];
  const terms: string[] = [];
  for (const token of tokens) {
    if (STOP_WORDS.has(token) || /^\d+$/.test(token)) continue;
    if (!terms.includes(token)) terms.push(token);
    if (terms.length >= 12) break;
  }
  return terms;
}

export function orientationIsCurrent(cached: RepoOrientation, headSha: string, workTreeFingerprint: string): boolean {
  return cached.schemaVersion === 1
    && cached.headSha === headSha
    && cached.workTreeFingerprint === workTreeFingerprint
    && cached.headSha !== 'unknown';
}

export async function preparePlanningDiscovery(options: {
  root: string;
  scope: string;
  mode: 'fast' | 'deep';
  cachePath?: string;
  now?: string;
}): Promise<PlanningDiscoveryOutcome> {
  const rootStat = await stat(options.root).catch(() => null);
  if (!rootStat?.isDirectory()) {
    return { ok: true, discovery: emptyDiscovery(options.mode) };
  }

  const identity = await readRepoIdentity(options.root);
  const now = options.now ?? new Date().toISOString();
  const loaded = await readOrientation(options.cachePath);
  const usedCache = loaded !== null && identity.headSha !== 'unknown' && orientationIsCurrent(loaded, identity.headSha, identity.workTreeFingerprint);
  const orientation = usedCache ? loaded : await buildOrientation(options.root, identity, now);
  if (!usedCache && options.cachePath && identity.headSha !== 'unknown') {
    await writeOrientation(options.cachePath, orientation);
  }

  if (identity.headSha === 'unknown' && orientation.notableAreas.length === 0) {
    return { ok: true, discovery: emptyDiscovery(options.mode) };
  }

  const terms = planningSearchTerms(options.scope);
  const matches = await findCandidateFiles(options.root, terms, orientation);
  const areas = [...new Set(matches.files.map(topArea))];
  if (options.mode === 'fast' && matches.stoppedEarly && matches.files.length > 0) {
    return {
      ok: false,
      code: 'PLANNING_BUDGET_EXCEEDED',
      message: `PLANNING_BUDGET_EXCEEDED: Fast Planning stopped inside its file budget after finding ${matches.files.length} candidate files. Choose Deep / Reconcile instead of a wider crawl.`,
    };
  }
  if (options.mode === 'fast' && matches.stoppedEarly) {
    return {
      ok: false,
      code: 'PLANNING_TARGETS_MISSING',
      message: 'PLANNING_TARGETS_MISSING: Fast Planning stopped at its file budget before a matching file was found. Name the area or file, or choose Deep / Reconcile.',
    };
  }
  if (options.mode === 'fast' && matches.files.length === 0) {
    return {
      ok: false,
      code: 'PLANNING_TARGETS_MISSING',
      message: matches.stoppedEarly
        ? 'PLANNING_TARGETS_MISSING: Fast Planning stopped at its file budget before a matching file was found. Name the area or file, or choose Deep / Reconcile.'
        : 'PLANNING_TARGETS_MISSING: Fast Planning found no files matching this request. Name the area or file, or choose Deep / Reconcile.',
    };
  }
  if (options.mode === 'fast' && (matches.files.length > FAST_CANDIDATE_BUDGET || areas.length > FAST_AREA_BUDGET)) {
    const shown = areas.slice(0, FAST_AREA_BUDGET).join(', ');
    return {
      ok: false,
      code: 'PLANNING_BUDGET_EXCEEDED',
      message: `PLANNING_BUDGET_EXCEEDED: Fast Planning found ${matches.files.length} candidate files across ${areas.length} areas (${shown}). That is wider than the targeted budget. Choose Deep / Reconcile instead of a full crawl.`,
    };
  }

  const listed = options.mode === 'deep' ? matches.files.slice(0, FAST_INSPECT_BUDGET) : matches.files.slice(0, FAST_CANDIDATE_BUDGET);
  const inspected = await inspectFiles(options.root, listed.slice(0, FAST_INSPECT_BUDGET));
  return {
    ok: true,
    discovery: {
      mode: options.mode,
      available: true,
      usedCache,
      candidateFiles: listed,
      inspectedFiles: inspected,
      areas: [...new Set(listed.map(topArea))],
      appendix: formatDiscoveryAppendix({
        mode: options.mode,
        usedCache,
        orientation,
        candidateFiles: listed,
        inspectedFiles: inspected,
      }),
    },
  };
}

function emptyDiscovery(mode: 'fast' | 'deep'): PlanningDiscovery {
  return {
    mode,
    available: false,
    usedCache: false,
    candidateFiles: [],
    inspectedFiles: [],
    areas: [],
    appendix: '',
  };
}

async function buildOrientation(root: string, identity: { headSha: string; workTreeFingerprint: string }, generatedAt: string): Promise<RepoOrientation> {
  const topLevelDirectories: string[] = [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    topLevelDirectories.push(entry.name);
    if (topLevelDirectories.length >= 24) break;
  }
  const notableAreas: Array<{ path: string; note: string }> = [];
  for (const area of NOTABLE_AREAS) {
    const info = await stat(path.join(root, area.path)).catch(() => null);
    if (info?.isDirectory()) notableAreas.push(area);
  }
  const testLocations: string[] = [];
  for (const location of TEST_LOCATIONS) {
    const info = await stat(path.join(root, location)).catch(() => null);
    if (info?.isDirectory()) testLocations.push(location);
  }
  return {
    schemaVersion: 1,
    headSha: identity.headSha,
    workTreeFingerprint: identity.workTreeFingerprint,
    generatedAt,
    topLevelDirectories,
    notableAreas,
    protectedPaths: [...CANONICAL_PROTECTED_REPO_PATHS],
    testLocations,
  };
}

async function findCandidateFiles(root: string, terms: string[], orientation: RepoOrientation): Promise<{ files: string[]; stoppedEarly: boolean }> {
  if (terms.length === 0) return { files: [], stoppedEarly: false };
  const explicit = await explicitPathTargets(root, terms);
  if (explicit.length > 0) return { files: explicit, stoppedEarly: false };

  const preferred = orientation.notableAreas
    .map((area) => area.path)
    .filter((area) => area !== 'src');
  const collected = await scanAreas(root, preferred, terms);
  if (collected.files.length > 0) return collected;

  const named = await namedChildAreas(root, orientation.topLevelDirectories, terms);
  if (named.length > 0) {
    const fromNames = await scanAreas(root, named, terms);
    if (fromNames.files.length > 0 || fromNames.stoppedEarly) return fromNames;
  }

  if (orientation.notableAreas.some((area) => area.path === 'src')) {
    return scanAreas(root, ['src'], terms);
  }
  return { files: [], stoppedEarly: false };
}

async function explicitPathTargets(root: string, terms: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const term of terms) {
    if (!term.includes('/') && !term.includes('.')) continue;
    const relative = term.replace(/^\.?\//, '');
    const info = await stat(path.join(root, relative)).catch(() => null);
    if (info?.isFile()) files.push(relative);
    else if (info?.isDirectory()) files.push(...(await listFilesBounded(root, path.join(root, relative), 2, FAST_INSPECT_BUDGET)));
  }
  return [...new Set(files)].sort();
}

async function namedChildAreas(root: string, topLevel: string[], terms: string[]): Promise<string[]> {
  const areas: string[] = [];
  for (const name of topLevel.slice(0, 24)) {
    if (terms.some((term) => name.toLowerCase().includes(term))) {
      areas.push(name);
      if (areas.length > FAST_AREA_BUDGET) return areas;
      continue;
    }
    const children = await readdir(path.join(root, name), { withFileTypes: true }).catch(() => []);
    for (const child of children) {
      if (!child.isDirectory() || SKIP_DIRS.has(child.name) || child.name.startsWith('.')) continue;
      if (terms.some((term) => child.name.toLowerCase().includes(term))) areas.push(`${name}/${child.name}`);
      if (areas.length > FAST_AREA_BUDGET) return areas;
    }
  }
  return areas;
}

async function scanAreas(root: string, areas: string[], terms: string[]): Promise<{ files: string[]; stoppedEarly: boolean }> {
  const files: string[] = [];
  let stoppedEarly = false;
  let visited = 0;
  for (const area of areas) {
    const scanned = await scanArea(root, path.join(root, area), terms, FAST_CANDIDATE_BUDGET + 1 - files.length, FAST_DIRECTORY_VISIT_BUDGET - visited);
    visited += scanned.visited;
    for (const file of scanned.files) {
      if (!files.includes(file)) files.push(file);
    }
    if (scanned.stoppedEarly) stoppedEarly = true;
    if (files.length > FAST_CANDIDATE_BUDGET || visited >= FAST_DIRECTORY_VISIT_BUDGET) break;
  }
  files.sort();
  return { files, stoppedEarly };
}

async function scanArea(root: string, dir: string, terms: string[], fileLimit: number, visitLimit: number): Promise<{ files: string[]; visited: number; stoppedEarly: boolean }> {
  const files: string[] = [];
  const queue = [dir];
  let visited = 0;
  let stoppedEarly = false;
  while (queue.length > 0 && visited < visitLimit && files.length < fileLimit) {
    const current = queue.shift();
    if (!current) break;
    visited += 1;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute).replaceAll('\\', '/');
      if (entry.isFile()) {
        if (terms.some((term) => relative.toLowerCase().includes(term))) files.push(relative);
      } else if (entry.isDirectory() && relative.split('/').length <= 6) {
        queue.push(absolute);
      }
      if (files.length >= fileLimit) break;
    }
  }
  if (queue.length > 0 && (visited >= visitLimit || files.length >= fileLimit)) stoppedEarly = true;
  return { files, visited, stoppedEarly };
}

async function listFilesBounded(root: string, dir: string, depth: number, limit: number): Promise<string[]> {
  if (depth < 0 || limit <= 0) return [];
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (files.length >= limit || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isFile()) files.push(path.relative(root, absolute).replaceAll('\\', '/'));
    else if (entry.isDirectory()) files.push(...await listFilesBounded(root, absolute, depth - 1, limit - files.length));
  }
  return files;
}

async function inspectFiles(root: string, files: string[]): Promise<string[]> {
  const inspected: string[] = [];
  for (const file of files.slice(0, FAST_INSPECT_BUDGET)) {
    const info = await stat(path.join(root, file)).catch(() => null);
    if (info?.isFile()) inspected.push(file);
  }
  return inspected;
}

function formatDiscoveryAppendix(options: {
  mode: 'fast' | 'deep';
  usedCache: boolean;
  orientation: RepoOrientation;
  candidateFiles: string[];
  inspectedFiles: string[];
}): string {
  const lines = [
    '',
    `PLANNING MODE: ${options.mode === 'fast' ? 'FAST' : 'DEEP'}`,
    `Repo orientation ${options.usedCache ? 'reused a valid cache' : 'was built for this request'} at head ${options.orientation.headSha}.`,
    `Top-level directories: ${options.orientation.topLevelDirectories.join(', ') || 'none'}.`,
    `Notable areas: ${options.orientation.notableAreas.map((area) => `${area.path} (${area.note})`).join('; ') || 'none'}.`,
    `Protected paths: ${options.orientation.protectedPaths.join(', ')}.`,
    `Test locations: ${options.orientation.testLocations.join(', ') || 'none'}.`,
    `Candidate files (${options.candidateFiles.length}): ${options.candidateFiles.join(', ') || 'none'}.`,
    `Inspected files (${options.inspectedFiles.length}): ${options.inspectedFiles.join(', ') || 'none'}.`,
  ];
  if (options.mode === 'fast') {
    lines.push('Fast Planning: inspect only the candidate files above. Do not audit or crawl the rest of the repository.');
  } else {
    lines.push('Deep / Reconcile: the orientation is a starting map. Broader inspection is allowed for this request. Still return the same typed plan.');
  }
  return lines.join('\n');
}

function topArea(file: string): string {
  return file.split('/')[0] ?? file;
}

async function readRepoIdentity(root: string): Promise<{ headSha: string; workTreeFingerprint: string }> {
  try {
    const head = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root, windowsHide: true, timeout: 8_000 });
    const status = await execFileAsync('git', ['status', '--porcelain=v1'], { cwd: root, windowsHide: true, timeout: 8_000 });
    const headSha = head.stdout.trim();
    const workTreeFingerprint = createHash('sha256').update(status.stdout).digest('hex').slice(0, 16);
    if (!headSha) return { headSha: 'unknown', workTreeFingerprint: 'unknown' };
    return { headSha, workTreeFingerprint };
  } catch {
    return { headSha: 'unknown', workTreeFingerprint: 'unknown' };
  }
}

async function readOrientation(cachePath: string | undefined): Promise<RepoOrientation | null> {
  if (!cachePath) return null;
  try {
    const parsed = JSON.parse(await readFile(cachePath, 'utf8')) as RepoOrientation;
    if (parsed.schemaVersion !== 1 || typeof parsed.headSha !== 'string' || typeof parsed.workTreeFingerprint !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeOrientation(cachePath: string, orientation: RepoOrientation): Promise<void> {
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(orientation), 'utf8');
}
