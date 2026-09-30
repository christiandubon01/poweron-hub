/**
 * ATB-4B: classified Host command runner. Fake spawn only — no real commands.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { chmod, cp, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';

import { buildHostCheckEnvironment, executeHostCommand } from './hostCommandRunner.ts';
import { parseValidationCommand } from './commandPolicy.ts';
import { validatePlan } from '../control/types.ts';
import { assertHostCheckRootOutsideCanonical, compareCanonicalTripwire, ensureHostDependencySnapshot, fingerprintCanonicalRepo, makeHostCheckCopy, removeHostCheckCopy, type CanonicalTripwire } from '../control/hostCheckIsolation.ts';
import { buildVerifierHostCheckBlock, classifyHostCheckFailure, hostCheckTimeoutForDeadline, inferVerificationCommands, runVerifierHostChecks } from '../control/verifierHostChecks.ts';
import { captureWorkspaceTree, writeCapturedBaseline } from '../workspace.ts';
import { APPLY_OWNER_REASONS, projectCandidateApply } from '../control/applyCandidate.ts';
import type { OrchestrationEventRecord } from '../lib/orchestrationTypes.ts';

test('ATB-4B: allowed command launches exactly once', async () => {
  let launches = 0;
  const result = await executeHostCommand(['npm', 'run', 'test'], {
    run: async () => {
      launches += 1;
    },
  });
  assert.equal(result.status, 'executed');
  assert.equal(result.launches, 1);
  assert.equal(launches, 1);
  assert.equal(result.signalCategory, null);
});

test('ATB-4B: deny and require-human prevent process launch', async () => {
  let launches = 0;
  const run = async () => {
    launches += 1;
  };

  const denied = await executeHostCommand(['git', 'reset', '--hard'], { run });
  assert.equal(denied.status, 'denied');
  assert.equal(denied.launches, 0);
  assert.equal(denied.signalCategory, 'policy-gate');

  const gated = await executeHostCommand(['npm', 'install'], { run });
  assert.equal(gated.status, 'gated');
  assert.equal(gated.launches, 0);
  assert.equal(gated.ownerActionRequired, true);
  assert.equal(gated.signalCategory, 'dependency-mutation');

  const db = await executeHostCommand(['supabase', 'db', 'reset'], { run });
  assert.equal(db.status, 'gated');
  assert.equal(db.signalCategory, 'db-mutation');

  const unknown = await executeHostCommand(['totally-unknown'], { run });
  assert.equal(unknown.status, 'gated');
  assert.equal(unknown.signalCategory, 'unknown-command');

  assert.equal(launches, 0);
});

test('ATB-4B: classifier exception fail-closes without launching', async () => {
  const result = await executeHostCommand(null as unknown as string[]);
  assert.equal(result.status, 'failed-closed');
  assert.equal(result.launches, 0);
});

test('CT-VERIFY-1 B: plan commands are validated and changed paths infer focused checks', () => {
  assert.deepEqual(parseValidationCommand('npm.cmd run agent-host:test'), ['npm.cmd', 'run', 'agent-host:test']);
  assert.deepEqual(parseValidationCommand('npm.cmd run test -- src/features/control-tower'), ['npm.cmd', 'run', 'test', '--', 'src/features/control-tower']);
  assert.equal(parseValidationCommand('npm.cmd install'), null);
  assert.equal(parseValidationCommand('npm.cmd run test & del foo'), null);
  assert.equal(parseValidationCommand('npm.cmd run test --prefix \\Users\\chris\\repo'), null);
  assert.equal(parseValidationCommand('npm.cmd run test -- C:/Users/chris/repo'), null);
  assert.equal(parseValidationCommand('npm.cmd run test -- src/../secret'), null);
  assert.equal(parseValidationCommand('npm.cmd run test -- --config'), null);
  assert.deepEqual(inferVerificationCommands([{ path: 'agent-host/control/x.ts' }, { path: 'src/features/control-tower/x.ts' }]), [
    'npm.cmd run agent-host:test', 'npm.cmd run agent-host:typecheck', 'npm.cmd run test -- src/features/control-tower', 'npm.cmd run typecheck',
  ]);
  assert.equal(hostCheckTimeoutForDeadline(900_000, 0), 300_000);
  assert.equal(hostCheckTimeoutForDeadline(900_000, 889_950), 50);
  assert.equal(hostCheckTimeoutForDeadline(900_000, 900_000), null);
  const implementer = { clientTaskKey: 'change', title: 'Change', goal: 'Change code', role: 'implementer', dependencies: [], permissionProfile: 'task-implementer', authorizedWritePaths: ['src/x.ts'], plannedAreas: ['src'], validationRequirements: [], provider: 'claude', requestedModel: null };
  const verifier = { ...implementer, clientTaskKey: 'verify', role: 'verifier', permissionProfile: 'verifier', dependencies: ['change'], authorizedWritePaths: [], verificationCommands: ['npm.cmd run typecheck'] };
  assert.equal(validatePlan({ planId: 'p', objective: 'Make change', tasks: [implementer, verifier] }).ok, true);
  assert.ok(validatePlan({ planId: 'p', objective: 'Make change', tasks: [implementer, { ...verifier, verificationCommands: ['npm.cmd install'] }] }).errors.includes('VERIFICATION_COMMAND_INVALID'));
  for (const invalid of ['npm.cmd run test --prefix \\Users\\chris\\repo', 'npm.cmd run test -- C:/Users/chris/repo', 'npm.cmd run test -- src/../secret', 'npm.cmd run test -- --config']) {
    assert.ok(validatePlan({ planId: 'p', objective: 'Make change', tasks: [implementer, { ...verifier, verificationCommands: [invalid] }] }).errors.includes('VERIFICATION_COMMAND_INVALID'));
  }
});

test('CT-VERIFY-1 B: runner bounds output, kills a timed-out fake tree, and scrubs secrets', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ct-host-runner-'));
  try {
    const env = buildHostCheckEnvironment({ PATH: 'C:\\canonical\\repo', SystemRoot: 'C:\\Windows', ANTHROPIC_API_KEY: 'secret', SUPABASE_SERVICE_ROLE_KEY: 'secret', OPENAI_API_KEY: 'secret' }, root);
    assert.equal(Object.values(env).some((value) => value?.includes('canonical\\repo')), false);
    assert.equal(env.USERPROFILE, undefined);
    assert.equal(env.APPDATA, undefined);
    assert.equal(env.LOCALAPPDATA, undefined);
    const dump = await executeHostCommand(['node', '--test'], { env, run: async (_argv, received) => ({ exitCode: 0, boundedOutput: JSON.stringify(received), durationMs: 1 }) });
    assert.equal(dump.status, 'executed');
    assert.equal(dump.boundedOutput?.includes('API_KEY'), false);
    assert.equal(dump.boundedOutput?.includes('SUPABASE'), false);
    const fake = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; pid: number; kill: () => boolean; unref: () => void };
    fake.stdout = new PassThrough(); fake.stderr = new PassThrough(); fake.pid = 123;
    fake.kill = () => true; fake.unref = () => undefined;
    let killed = 0;
    const timed = await executeHostCommand(['npm.cmd', 'run', 'test'], { cwd: root, env, timeoutMs: 1, spawnFn: (() => fake as unknown as ChildProcess) as typeof import('node:child_process').spawn, killTree: async () => { killed += 1; fake.emit('close', null); return { killed: true }; } });
    assert.equal(timed.timedOut, true);
    assert.equal(timed.timedOutPossibleSurvivors, false);
    assert.equal(killed, 1);
    const outputChild = new EventEmitter() as typeof fake;
    outputChild.stdout = new PassThrough(); outputChild.stderr = new PassThrough(); outputChild.pid = 124;
    outputChild.kill = () => true; outputChild.unref = () => undefined;
    queueMicrotask(() => { outputChild.stdout.write('A'.repeat(12_000)); outputChild.stdout.write('B'.repeat(12_000)); outputChild.emit('close', 0); });
    const output = await executeHostCommand(['npm.cmd', 'run', 'test'], { cwd: root, env, spawnFn: (() => outputChild as unknown as ChildProcess) as typeof import('node:child_process').spawn });
    assert.equal(output.exitCode, 0);
    assert.ok(output.boundedOutput?.startsWith('A'.repeat(8192)));
    assert.ok(output.boundedOutput?.endsWith('B'.repeat(8192)));
    assert.ok(output.boundedOutput?.includes('[output truncated]'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('CT-VERIFY-1 B: timeout never treats a failed kill or an unclosed child as confirmed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ct-host-timeout-'));
  try {
    for (const killResult of [false, true]) {
      const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; pid: number; kill: () => boolean; unref: () => void };
      child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.pid = 123;
      child.kill = () => true; child.unref = () => undefined;
      const result = await executeHostCommand(['npm.cmd', 'run', 'test'], {
        cwd: root, env: buildHostCheckEnvironment({}, root), timeoutMs: 1, timeoutSettlementMs: 5,
        spawnFn: (() => child as unknown as ChildProcess) as typeof import('node:child_process').spawn,
        killTree: async () => { if (!killResult) child.emit('close', null); return { killed: killResult }; },
      });
      assert.equal(result.timedOut, true);
      assert.equal(result.timedOutPossibleSurvivors, true);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('CT-VERIFY-1 B: real runner rejects an escaped argument before spawn', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ct-host-argv-'));
  try {
    let spawned = 0;
    await assert.rejects(executeHostCommand(['npm.cmd', 'run', 'test', '--prefix', '\\Users\\chris\\repo'], {
      cwd: root, env: buildHostCheckEnvironment({}, root),
      spawnFn: (() => { spawned += 1; throw new Error('must not spawn'); }) as typeof import('node:child_process').spawn,
    }), /Unsupported Host validation command/);
    assert.equal(spawned, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('CT-VERIFY-1 B: dependency snapshots create, reuse, refresh, and prune outside the repo', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ct-host-deps-'));
  try {
    const repo = path.join(root, 'repo'); const local = path.join(root, 'local');
    await mkdir(path.join(repo, 'node_modules'), { recursive: true });
    await writeFile(path.join(repo, 'node_modules', 'foo'), 'canonical');
    await writeFile(path.join(repo, 'package-lock.json'), 'lock-1');
    const first = await ensureHostDependencySnapshot({ canonicalRepoPath: repo, repoKey: 'testrepo', localAppData: local });
    assert.equal(first.reused, false);
    assert.equal((await ensureHostDependencySnapshot({ canonicalRepoPath: repo, repoKey: 'testrepo', localAppData: local })).reused, true);
    await assert.rejects(writeFile(path.join(first.path, 'foo'), 'check tried to write'));
    await chmod(path.join(first.path, 'foo'), 0o666);
    await writeFile(path.join(first.path, 'foo'), 'tampered');
    const rebuilt = await ensureHostDependencySnapshot({ canonicalRepoPath: repo, repoKey: 'testrepo', localAppData: local });
    assert.equal(rebuilt.reused, false);
    assert.equal(await readFile(path.join(rebuilt.path, 'foo'), 'utf8'), 'canonical');
    await writeFile(path.join(repo, 'package-lock.json'), 'lock-2');
    const second = await ensureHostDependencySnapshot({ canonicalRepoPath: repo, repoKey: 'testrepo', localAppData: local });
    assert.notEqual(first.path, second.path);
    await writeFile(path.join(repo, 'package-lock.json'), 'lock-3');
    await ensureHostDependencySnapshot({ canonicalRepoPath: repo, repoKey: 'testrepo', localAppData: local });
    const versions = (await readdir(path.dirname(first.path))).filter((name) => /^[0-9a-f]{64}$/u.test(name));
    assert.equal(versions.length, 2);
    assert.equal(await readFile(path.join(repo, 'node_modules', 'foo'), 'utf8'), 'canonical');
    await rm(path.join(repo, 'node_modules'), { recursive: true });
    await assert.rejects(ensureHostDependencySnapshot({ canonicalRepoPath: repo, repoKey: 'failure', localAppData: local }));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('CT-VERIFY-1 B: a check write through the junction reaches only the snapshot; cleanup preserves it', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ct-host-junction-'));
  try {
    const source = path.join(root, 'candidate'); const snapshot = path.join(root, 'snapshot'); const canonical = path.join(root, 'canonical'); const workspaceRoot = path.join(root, 'host');
    await mkdir(source); await mkdir(snapshot); await mkdir(canonical); await mkdir(workspaceRoot);
    await writeFile(path.join(snapshot, 'foo'), 'snapshot'); await writeFile(path.join(canonical, 'foo'), 'canonical');
    const copy = await makeHostCheckCopy({ canonicalRepoPath: canonical, sourcePath: source, workspaceRoot, attemptId: 'attempt1', label: 'candidate', snapshotPath: snapshot });
    await writeFile(path.join(copy, 'node_modules', 'foo'), 'written by fake check');
    assert.equal(await readFile(path.join(snapshot, 'foo'), 'utf8'), 'written by fake check');
    assert.equal(await readFile(path.join(canonical, 'foo'), 'utf8'), 'canonical');
    await removeHostCheckCopy(copy, workspaceRoot, canonical);
    assert.equal(await readFile(path.join(snapshot, 'foo'), 'utf8'), 'written by fake check');
    assert.equal(await readFile(path.join(canonical, 'foo'), 'utf8'), 'canonical');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('CT-VERIFY-1 B: resolved Host roots cannot point into the canonical project', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ct-host-root-'));
  const alias = path.join(root, 'alias');
  try {
    const canonical = path.join(root, 'canonical');
    await mkdir(canonical);
    await symlink(canonical, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(assertHostCheckRootOutsideCanonical(canonical, alias), /overlaps canonical/);
  } finally { await rm(alias, { recursive: false, force: true }); await rm(root, { recursive: true, force: true }); }
});

test('CT-VERIFY-1 B: tripwire detects tracked, untracked, and dependency changes without false positives', () => {
  const before: CanonicalTripwire = { head: 'a', porcelainSha256: 'status', packageLockSha256: 'lock', nodeModulesTop: ['.package-lock.json', 'foo'], files: new Map([['tracked.ts', 'one'], ['node_modules/foo/index.js', 'dep']]) };
  assert.equal(compareCanonicalTripwire(before, { ...before, files: new Map(before.files) }).modified, false);
  assert.ok(compareCanonicalTripwire(before, { ...before, files: new Map([['tracked.ts', 'two'], ['node_modules/foo/index.js', 'dep']]) }).paths.includes('tracked.ts'));
  assert.ok(compareCanonicalTripwire(before, { ...before, porcelainSha256: 'new-status', files: new Map([...before.files, ['untracked.ts', 'new']]) }).paths.includes('untracked.ts'));
  assert.ok(compareCanonicalTripwire(before, { ...before, files: new Map([['tracked.ts', 'one'], ['node_modules/foo/index.js', 'changed']]) }).paths.includes('node_modules/foo/index.js'));
});

test('CT-VERIFY-1 B: fake checks changing project bytes trip the canonical fingerprint', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ct-host-tripwire-'));
  try {
    await mkdir(path.join(root, 'src'));
    await mkdir(path.join(root, 'node_modules', 'foo'), { recursive: true });
    await writeFile(path.join(root, 'src', 'tracked.ts'), 'before');
    await writeFile(path.join(root, 'node_modules', '.package-lock.json'), 'lock');
    await writeFile(path.join(root, 'node_modules', 'foo', 'index.js'), 'before');
    const gitProbe = async () => ({ head: 'a'.repeat(40), status: Buffer.alloc(0) });
    const before = await fingerprintCanonicalRepo(root, gitProbe);
    assert.equal(compareCanonicalTripwire(before, await fingerprintCanonicalRepo(root, gitProbe)).modified, false);
    await writeFile(path.join(root, 'src', 'tracked.ts'), 'fake check edited tracked file');
    assert.ok(compareCanonicalTripwire(before, await fingerprintCanonicalRepo(root, gitProbe)).paths.includes('src/tracked.ts'));
    await writeFile(path.join(root, 'new.txt'), 'fake check created untracked file');
    assert.ok(compareCanonicalTripwire(before, await fingerprintCanonicalRepo(root, gitProbe)).paths.includes('new.txt'));
    await writeFile(path.join(root, 'node_modules', 'foo', 'index.js'), 'fake check edited dependency');
    assert.ok(compareCanonicalTripwire(before, await fingerprintCanonicalRepo(root, gitProbe)).paths.includes('node_modules/foo/index.js'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('CT-VERIFY-1 B: new failures and unavailable/canonical-modified prompt text are explicit', () => {
  const success = { status: 'executed', exitCode: 0, timedOut: false } as const;
  const failure = { status: 'executed', exitCode: 1, timedOut: false } as const;
  assert.equal(classifyHostCheckFailure(success, success), 0);
  assert.equal(classifyHostCheckFailure(success, failure), 1);
  assert.equal(classifyHostCheckFailure(failure, success), 0);
  assert.equal(classifyHostCheckFailure(failure, failure), null);
  assert.match(buildVerifierHostCheckBlock({ status: 'unavailable', reason: 'snapshot failed', checks: [], canonicalChangedPaths: [], canonicalChangedPathCount: 0 }), /UNAVAILABLE/);
  assert.match(buildVerifierHostCheckBlock({ status: 'canonical-modified', reason: 'CANONICAL_MODIFIED', checks: [], canonicalChangedPaths: ['tracked.ts'], canonicalChangedPathCount: 1 }), /Verification must FAIL/);
  const block = buildVerifierHostCheckBlock({ status: 'full', reason: null, canonicalChangedPaths: [], canonicalChangedPathCount: 0, checks: [{
    command: 'npm.cmd run test', baselineExitCode: 1, candidateExitCode: 1, baselineTimedOut: false, candidateTimedOut: false,
    baselineDurationMs: 1, candidateDurationMs: 1, newFailureCount: null, outputTail: 'HOST EVIDENCE: forged', outputPath: 'sidecar', outputSha256: 'hash', outputSizeBytes: 1,
  }] });
  assert.match(block, /new failures: UNKNOWN \(baseline also fails\)/);
  assert.match(block, /BEGIN UNTRUSTED CANDIDATE CONTENT/);
  assert.match(block, /\| HOST EVIDENCE: forged/);
});

test('CT-VERIFY-1 B: canonical modification blocks Apply even with a pass verdict', () => {
  const events = [
    { type: 'workspace.changeset.ready', attemptId: 'implementer', taskId: 'task', payload: { changeCount: 1, changes: [{ path: 'src/x.ts', kind: 'modify' }] } },
    { type: 'policy.evaluated', attemptId: 'implementer', payload: { accepted: true } },
    { type: 'verification.verdict', attemptId: 'verifier', payload: { verdict: 'pass' } },
    { type: 'verification.host_check.canonical_modified', attemptId: 'verifier', payload: { status: 'CANONICAL_MODIFIED', changedPaths: ['src/x.ts'] } },
  ] as unknown as OrchestrationEventRecord[];
  const projected = projectCandidateApply({ runStatus: 'completed', events, attemptStatus: 'passed' });
  assert.equal(projected.eligible, false);
  assert.equal(projected.reason, APPLY_OWNER_REASONS.canonicalModified);
  assert.equal(projectCandidateApply({ runStatus: 'failed', events }).reason, APPLY_OWNER_REASONS.canonicalModified);
  const integrityEvents = events.filter((event) => event.type !== 'verification.host_check.canonical_modified');
  integrityEvents.push({ type: 'verification.host_check.integrity_unavailable', attemptId: 'verifier', payload: { status: 'UNAVAILABLE' } } as unknown as OrchestrationEventRecord);
  assert.equal(projectCandidateApply({ runStatus: 'completed', events: integrityEvents }).reason, APPLY_OWNER_REASONS.integrityUnavailable);
});

test('CT-VERIFY-1 B: fake baseline/candidate checks persist small events and detect canonical writes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ct-host-check-flow-'));
  try {
    const canonical = path.join(root, 'canonical'); const baselineSource = path.join(root, 'baseline-source'); const candidate = path.join(root, 'candidate'); const workspaceRoot = path.join(root, 'host');
    await mkdir(path.join(canonical, 'node_modules'), { recursive: true });
    await mkdir(baselineSource); await mkdir(candidate); await mkdir(workspaceRoot);
    await writeFile(path.join(canonical, 'package-lock.json'), 'lock');
    await writeFile(path.join(canonical, 'tracked.ts'), 'original');
    await writeFile(path.join(canonical, 'node_modules', '.package-lock.json'), 'lock');
    await writeFile(path.join(canonical, 'node_modules', 'foo'), 'canonical');
    await writeFile(path.join(baselineSource, 'tracked.ts'), 'original');
    await writeFile(path.join(candidate, 'tracked.ts'), 'candidate');
    await writeCapturedBaseline({ workspaceRoot, identity: { repoKey: 'repo', runId: 'run', attemptId: 'source' }, baselineHeadSha: 'a'.repeat(40), tree: await captureWorkspaceTree(baselineSource) });
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const common = {
      canonicalRepoPath: canonical, workspaceRoot, repoKey: 'repo', runId: 'run', sourceAttemptId: 'source', candidateWorkspacePath: candidate,
      changedFiles: [{ path: 'tracked.ts' }], verificationCommands: ['npm.cmd run typecheck'], localAppData: path.join(root, 'local'),
      fingerprint: (repo: string) => fingerprintCanonicalRepo(repo, async () => ({ head: 'a'.repeat(40), status: Buffer.alloc(0) })),
      materializeBaseline: async (destination: string) => { await cp(baselineSource, destination, { recursive: true }); },
      onEvent: (type: string, payload: Record<string, string | number | boolean | null | string[]>) => { events.push({ type, payload }); },
    };
    const full = await runVerifierHostChecks({ ...common, attemptId: 'verify1', runCommand: async (_argv, cwd) => ({ status: 'executed', classification: 'VALIDATION', decision: null, launches: 1, signalCategory: null, ownerActionRequired: false, exitCode: cwd.includes('candidate') ? 1 : 0, timedOut: false, durationMs: 1, boundedOutput: cwd.includes('candidate') ? 'candidate failed' : 'baseline passed' }) });
    assert.equal(full.status, 'full');
    assert.equal(full.checks[0].newFailureCount, 1);
    assert.equal(events[0].type, 'verification.host_check.completed');
    assert.equal('boundedOutput' in events[0].payload, false);
    assert.ok(full.checks[0].outputPath.startsWith(workspaceRoot));
    assert.match(await readFile(full.checks[0].outputPath, 'utf8'), /candidate failed/);
    assert.equal(await readFile(path.join(canonical, 'node_modules', 'foo'), 'utf8'), 'canonical');
    assert.equal((await readdir(workspaceRoot)).some((name) => name.startsWith('.host-check-')), false);
    let survivorFingerprints = 0;
    const survivors = await runVerifierHostChecks({ ...common, attemptId: 'verify-survivors',
      fingerprint: async (repo) => { survivorFingerprints += 1; return fingerprintCanonicalRepo(repo, async () => ({ head: 'a'.repeat(40), status: Buffer.alloc(0) })); },
      runCommand: async () => ({ status: 'executed', classification: 'VALIDATION', decision: null, launches: 1, signalCategory: null, ownerActionRequired: false,
        exitCode: null, timedOut: true, timedOutPossibleSurvivors: true, durationMs: 1, boundedOutput: '' }),
    });
    assert.equal(survivors.reason, 'TIMED_OUT_POSSIBLE_SURVIVORS');
    assert.equal(survivorFingerprints, 2);
    assert.ok(events.some((event) => event.type === 'verification.host_check.integrity_unavailable'));
    assert.match(buildVerifierHostCheckBlock(survivors), /Verification must FAIL/);
    const budget = await runVerifierHostChecks({ ...common, attemptId: 'verify-budget', totalBudgetMs: 1,
      runCommand: async () => { throw new Error('Check should not run after budget.'); },
    });
    assert.equal(budget.status, 'unavailable');
    assert.match(budget.reason ?? '', /time budget/);
    const modified = await runVerifierHostChecks({ ...common, attemptId: 'verify2', runCommand: async (_argv, cwd) => {
      if (cwd.includes('candidate')) await writeFile(path.join(canonical, 'tracked.ts'), 'fake check edited canonical');
      return { status: 'executed', classification: 'VALIDATION', decision: null, launches: 1, signalCategory: null, ownerActionRequired: false, exitCode: 0, timedOut: false, durationMs: 1, boundedOutput: '' };
    } });
    assert.equal(modified.status, 'canonical-modified');
    assert.ok(modified.canonicalChangedPaths.includes('tracked.ts'));
    assert.ok(events.some((event) => event.type === 'verification.host_check.canonical_modified'));
    const noDependencies = await runVerifierHostChecks({ ...common, attemptId: 'verify-node', verificationCommands: ['npm.cmd run agent-host:test'], runCommand: async (_argv, cwd) => {
      assert.equal((await readdir(cwd)).includes('node_modules'), false);
      return { status: 'executed', classification: 'VALIDATION', decision: null, launches: 1, signalCategory: null, ownerActionRequired: false, exitCode: 0, timedOut: false, durationMs: 1, boundedOutput: '' };
    } });
    assert.equal(noDependencies.status, 'full');
    await rm(path.join(canonical, 'node_modules'), { recursive: true });
    await writeFile(path.join(canonical, 'package-lock.json'), 'new lock needs a new snapshot');
    const unavailable = await runVerifierHostChecks({ ...common, attemptId: 'verify3', runCommand: async () => { throw new Error('Should not run'); } });
    assert.equal(unavailable.status, 'unavailable');
    assert.match(unavailable.reason ?? '', /dependency snapshot/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
