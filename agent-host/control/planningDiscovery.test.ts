import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { openOrchestrationStore } from '../lib/store.ts';
import type { ExecutionRequest, ExecutionResult } from '../providers/types.ts';
import type { ClaimedControlRequest, ControlPlane } from './supabaseControl.ts';
import { PLAN_REQUIREMENT_CONTRACT, buildArchitectPrompt, parseCreatePlanPayload } from './planning.ts';
import { orientationIsCurrent, preparePlanningDiscovery } from './planningDiscovery.ts';
import { handleCreatePlan } from './worker.ts';

const execFileAsync = promisify(execFile);

test('CT-LIVE-0B: omitted planning mode defaults to fast and deep is selectable', () => {
  const omitted = parseCreatePlanPayload({ scope: 'Update capacity.ts', constraints: [] });
  assert.equal(omitted.ok && omitted.payload.planningMode, 'fast');
  const deep = parseCreatePlanPayload({ scope: 'Update capacity.ts', constraints: [], planningMode: 'deep' });
  assert.equal(deep.ok && deep.payload.planningMode, 'deep');
  const invalid = parseCreatePlanPayload({ scope: 'Update capacity.ts', constraints: [], planningMode: 'audit' });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.code, 'PLANNING_MODE_INVALID');
});

test('CT-LIVE-0B: fast planning searches the matching area and does not crawl an unrelated tree', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ct-0b-fast-'));
  try {
    await mkdir(path.join(root, 'agent-host', 'control'), { recursive: true });
    await mkdir(path.join(root, 'src', 'other'), { recursive: true });
    await writeFile(path.join(root, 'agent-host', 'control', 'capacity.ts'), 'export const budget = 1\n');
    await writeFile(path.join(root, 'src', 'other', 'capacity-decoy.ts'), 'export const decoy = 1\n');
    const result = await preparePlanningDiscovery({ root, scope: 'Update the capacity planner', mode: 'fast' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.discovery.mode, 'fast');
    assert.deepEqual(result.discovery.inspectedFiles, ['agent-host/control/capacity.ts']);
    assert.equal(result.discovery.candidateFiles.includes('src/other/capacity-decoy.ts'), false);
    assert.match(result.discovery.appendix, /Do not audit or crawl/);
    assert.match(buildArchitectPrompt({ scope: 'Update the capacity planner', constraints: [], requestedRouting: null, planningMode: 'fast' }, { mode: 'fast' }), new RegExp(PLAN_REQUIREMENT_CONTRACT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CT-LIVE-0B: fast planning fails closed when the match spans too many areas', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ct-0b-budget-'));
  try {
    await mkdir(path.join(root, 'agent-host', 'control'), { recursive: true });
    await writeFile(path.join(root, 'agent-host', 'control', 'index.ts'), 'export const control = 1\n');
    for (const name of ['marker-a', 'marker-b', 'marker-c', 'marker-d', 'marker-e']) {
      await mkdir(path.join(root, name), { recursive: true });
      await writeFile(path.join(root, name, 'note.ts'), 'export const note = 1\n');
    }
    await mkdir(path.join(root, 'unrelated'), { recursive: true });
    await writeFile(path.join(root, 'unrelated', 'secret.ts'), 'export const secret = 1\n');
    const result = await preparePlanningDiscovery({ root, scope: 'Touch every marker area', mode: 'fast' });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'PLANNING_BUDGET_EXCEEDED');
    assert.match(result.message, /Deep \/ Reconcile/);
    assert.equal(result.message.includes('secret.ts'), false);
    const deep = await preparePlanningDiscovery({ root, scope: 'Touch every marker area', mode: 'deep' });
    assert.equal(deep.ok, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CT-LIVE-0B: repo orientation cache is reused only while HEAD and the work tree match', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ct-0b-cache-'));
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'ct-0b-cache-file-'));
  const cachePath = path.join(cacheDir, 'orientation.json');
  try {
    await mkdir(path.join(root, 'agent-host', 'control'), { recursive: true });
    await writeFile(path.join(root, 'agent-host', 'control', 'capacity.ts'), 'export const budget = 1\n');
    await execFileAsync('git', ['init'], { cwd: root, windowsHide: true });
    await execFileAsync('git', ['config', 'user.email', 'ct-0b@example.com'], { cwd: root, windowsHide: true });
    await execFileAsync('git', ['config', 'user.name', 'CT 0B'], { cwd: root, windowsHide: true });
    await execFileAsync('git', ['add', 'agent-host/control/capacity.ts'], { cwd: root, windowsHide: true });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: root, windowsHide: true });
    const first = await preparePlanningDiscovery({ root, scope: 'Update capacity.ts', mode: 'fast', cachePath });
    const second = await preparePlanningDiscovery({ root, scope: 'Update capacity.ts', mode: 'fast', cachePath });
    assert.equal(first.ok && first.discovery.usedCache, false);
    assert.equal(second.ok && second.discovery.usedCache, true);
    await writeFile(path.join(root, 'agent-host', 'control', 'capacity.ts'), 'export const budget = 2\n');
    const third = await preparePlanningDiscovery({ root, scope: 'Update capacity.ts', mode: 'fast', cachePath });
    assert.equal(third.ok && third.discovery.usedCache, false);
    assert.equal(orientationIsCurrent({
      schemaVersion: 1,
      headSha: 'abc',
      workTreeFingerprint: 'one',
      generatedAt: '2026-09-25T00:00:00.000Z',
      topLevelDirectories: [],
      notableAreas: [],
      protectedPaths: [],
      testLocations: [],
    }, 'abc', 'two'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('CT-LIVE-0B: fast planning publishes factual activity and keeps the typed plan', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ct-0b-activity-'));
  const dbDir = await mkdtemp(path.join(os.tmpdir(), 'ct-0b-activity-db-'));
  const store = openOrchestrationStore({
    dbPath: path.join(dbDir, 'orchestration.sqlite'),
    repoKey: 'repo-key-1',
    hostId: 'host-1',
    hostVersion: '0.1.0',
    idGenerator: () => 'evt-1',
  });
  const statuses: string[] = [];
  const completions: Array<Record<string, unknown>> = [];
  const prompts: string[] = [];
  try {
    await mkdir(path.join(root, 'agent-host', 'control'), { recursive: true });
    await writeFile(path.join(root, 'agent-host', 'control', 'capacity.ts'), 'export const budget = 1\n');
    const validPlan = {
      objective: 'Update the capacity planner.',
      constraints: [],
      riskSummary: null,
      tasks: [
        {
          clientTaskKey: 'update-capacity',
          title: 'Update capacity',
          goal: 'Keep the typed plan contract.',
          role: 'implementer',
          dependencies: [],
          permissionProfile: 'task-implementer',
          authorizedWritePaths: ['agent-host/control/capacity.ts'],
          plannedAreas: ['agent-host/control'],
          validationRequirements: ['capacity tests pass'],
          provider: 'claude',
          requestedModel: null,
        },
        {
          clientTaskKey: 'verify-capacity',
          title: 'Verify capacity',
          goal: 'Check the typed plan contract.',
          role: 'verifier',
          dependencies: ['update-capacity'],
          permissionProfile: 'verifier',
          authorizedWritePaths: [],
          plannedAreas: ['agent-host/control'],
          validationRequirements: ['read-only check'],
          provider: 'claude',
          requestedModel: null,
        },
      ],
    };
    const brokenPlan = {
      ...validPlan,
      tasks: [{ ...validPlan.tasks[0], validationRequirements: [{ requirement: 'not a string' }] }, validPlan.tasks[1]],
    };
    let calls = 0;
    await handleCreatePlan({
      store,
      registry: new Map([['claude', {
        id: 'claude',
        async execute(request: ExecutionRequest): Promise<ExecutionResult> {
          calls += 1;
          prompts.push(request.prompt);
          return {
            executionId: request.executionId,
            process: { exitCode: 0, signal: null, timedOut: false, cancelled: false },
            provider: { terminalState: 'completed', success: true },
            model: { requestedModel: null, reportedModel: 'claude-opus-4-8', reportedModelSource: 'protocol-message' },
            usage: { source: 'none' },
            session: {},
            output: { finalText: JSON.stringify(calls === 1 ? brokenPlan : validPlan) },
          };
        },
      }]]) as never,
      controlPlane: {
        async completeRequest(_id: string, result: Record<string, unknown>) { completions.push(result); },
        async failRequest(id: string, message: string) { throw new Error(`unexpected failure ${id}: ${message}`); },
        async notePlanningProgress(_id: string, patch: { planningStatus?: string }) {
          if (patch.planningStatus) statuses.push(patch.planningStatus);
        },
      } as unknown as ControlPlane,
      request: {
        id: 'req-activity',
        repo_key: 'repo-key-1',
        request_type: 'create_plan',
        client_request_id: 'client-activity',
        payload: { scope: 'Update capacity.ts', constraints: [], planningMode: 'fast' },
        status: 'claimed',
        created_at: '2026-09-25T00:00:00.000Z',
      } satisfies ClaimedControlRequest,
      canonicalRepoPath: root,
    });
    assert.equal(calls, 2);
    assert.match(prompts[0] ?? '', /Do not audit or crawl/);
    assert.deepEqual(statuses, [
      'Architect started',
      'Searching relevant areas',
      'Found 1 candidate files',
      'Inspecting 1 relevant files',
      'Building plan',
      'Architect plan received',
      'Validating plan',
      'Plan format needs correction',
      'Architect correcting plan',
      'Validating corrected plan',
      'Validated',
      'Plan ready',
    ]);
    assert.equal(statuses.some((line) => line.includes('%')), false);
    const revision = completions[0]?.planRevision as { version: number; changes: string[] };
    assert.equal(revision.version, 2);
    assert.equal(revision.changes.some((change) => change.includes('VALIDATION_REQUIREMENTS_INVALID')), true);
    const evidence = completions[0]?.planningEvidence as { inspectedFiles: string[] };
    assert.deepEqual(evidence.inspectedFiles, ['agent-host/control/capacity.ts']);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
    await rm(dbDir, { recursive: true, force: true });
  }
});

test('CT-LIVE-0B: a bounded fast miss does not call the architect', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ct-0b-miss-'));
  const dbDir = await mkdtemp(path.join(os.tmpdir(), 'ct-0b-db-'));
  const store = openOrchestrationStore({
    dbPath: path.join(dbDir, 'orchestration.sqlite'),
    repoKey: 'repo-key-1',
    hostId: 'host-1',
    hostVersion: '0.1.0',
    idGenerator: () => 'evt-1',
  });
  const calls: string[] = [];
  const statuses: string[] = [];
  try {
    await mkdir(path.join(root, 'agent-host', 'control'), { recursive: true });
    await writeFile(path.join(root, 'agent-host', 'control', 'readme.ts'), 'export const note = 1\n');
    const plane = {
      async completeRequest() { throw new Error('complete should not run'); },
      async failRequest(_id: string, message: string) { calls.push(message); },
      async notePlanningProgress(_id: string, patch: { planningStatus?: string }) {
        if (patch.planningStatus) statuses.push(patch.planningStatus);
      },
    };
    let executed = 0;
    await handleCreatePlan({
      store,
      registry: new Map([['claude', {
        id: 'claude',
        async execute(_request: ExecutionRequest): Promise<ExecutionResult> {
          executed += 1;
          throw new Error('architect should not run');
        },
      }]]) as never,
      controlPlane: plane as unknown as ControlPlane,
      request: {
        id: 'req-1',
        repo_key: 'repo-key-1',
        request_type: 'create_plan',
        client_request_id: 'client-1',
        payload: { scope: 'Update capacity.ts', constraints: [] },
        status: 'claimed',
        created_at: '2026-09-25T00:00:00.000Z',
      } satisfies ClaimedControlRequest,
      canonicalRepoPath: root,
    });
    assert.equal(executed, 0);
    assert.match(calls[0] ?? '', /PLANNING_TARGETS_MISSING/);
    assert.deepEqual(statuses, ['Architect started']);
    assert.equal(statuses.some(line => line.includes('%')), false);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
    await rm(dbDir, { recursive: true, force: true });
  }
});
