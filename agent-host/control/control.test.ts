/**
 * CT-CORE-1: Control-plane module tests (fakes only — NO live model calls).
 *
 * Covers: env parsing, create_plan payload validation, Architect plan parsing
 * + §17 validation rules, plan hash exactness (approve references the EXACT
 * plan), verifier verdict parsing, task spec contract, production ExecutionPort
 * delegation through AttemptExecutor, safe snapshot whitelist (§29 — prompts
 * never published), and plan idempotency helpers.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { openOrchestrationStore, type OrchestrationStore } from '../lib/store.ts';
import {
  validatePlan,
  computePlanHash,
  canonicalJsonStringify,
  normalizeSafeRepoRelativePath,
  ROLE_TO_PERMISSION_PROFILE,
  type ControlPlan,
  type PlanTask,
} from './types.ts';
import {
  parseCreatePlanPayload,
  extractPlanJsonObject,
  parseArchitectPlan,
  parseVerifierVerdict,
  parseVerifierResult,
  VERIFIER_SUMMARY_MAX_CHARS,
  CONTROL_TOWER_UI_SMOKE_LINE,
  CONTROL_TOWER_UI_SMOKE_PATH,
  evaluateControlTowerUiSmokeAcceptance,
  buildTaskPrompt,
  buildArchitectPrompt,
  EXECUTABLE_ROLE_PROFILE_PAIRS,
} from './planning.ts';
import { parseTaskControlSpec, ProductionExecutionPort, VERIFIER_VERDICT_EVENT, TaskSpecContractError } from './supervisorPort.ts';
import { buildRunSnapshot, extractTaskPlanMeta } from './snapshots.ts';
import { handleApprovePlan, handleCreatePlan, parseEnvFile, resumeResumableRuns, RESUMABLE_RUN_STATUSES_SET, type ApprovePlanOutcome } from './worker.ts';
import type { ClaimedControlRequest, ControlPlane } from './supabaseControl.ts';
import type { ExecutionRequest, ExecutionResult } from '../providers/types.ts';
import { recoverInterruptedAttempts } from '../providers/executor.ts';
import type { AttemptExecutionContext } from '../supervisor/supervisor.ts';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const PLAN_ID = 'plan-0001';

function validPlanTask(overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    clientTaskKey: 'create-file',
    title: 'Create the file',
    goal: 'Create agent-host/smoke/example.txt with exact contents.',
    role: 'implementer',
    dependencies: [],
    permissionProfile: 'task-implementer',
    authorizedWritePaths: ['agent-host/smoke/example.txt'],
    plannedAreas: ['agent-host/smoke'],
    validationRequirements: ['File exists with exact contents.'],
    provider: 'claude',
    requestedModel: null,
    ...overrides,
  };
}

function validPlanInput(tasks: PlanTask[] = [validPlanTask(), validPlanTask({
  clientTaskKey: 'verify-file',
  title: 'Verify the file',
  goal: 'Verify the file exists with exact contents.',
  role: 'verifier',
  dependencies: ['create-file'],
  permissionProfile: 'verifier',
  authorizedWritePaths: [],
  provider: 'claude',
})]): Record<string, unknown> {
  return {
    planId: PLAN_ID,
    objective: 'Create and verify a smoke file.',
    constraints: ['Do not modify any other file.'],
    riskSummary: null,
    tasks,
  };
}

function buildExecutionResult(overrides: {
  success?: boolean;
  finalText?: string;
  reportedModel?: string | null;
}): ExecutionResult {
  return {
    executionId: 'exec-1',
    process: { exitCode: 0, signal: null, timedOut: false, cancelled: false },
    provider: overrides.success === false
      ? { terminalState: 'failed', success: false, errorCode: 'PROVIDER_ERROR', errorMessage: 'provider failed' }
      : { terminalState: 'completed', success: true },
    model: {
      requestedModel: null,
      reportedModel: overrides.reportedModel === undefined ? null : overrides.reportedModel,
      reportedModelSource: overrides.reportedModel ? 'protocol-message' : 'none',
    },
    usage: { source: 'none' },
    session: {},
    output: overrides.finalText !== undefined ? { finalText: overrides.finalText } : {},
  };
}

async function withStore(work: (store: OrchestrationStore) => Promise<void>): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'orch-control-'));
  const dbPath = path.join(tempDir, 'orchestration.sqlite');
  let eventCounter = 0;
  const store = openOrchestrationStore({
    dbPath,
    repoKey: 'repo-key-1',
    hostId: 'host-1',
    hostVersion: '0.1.0',
    idGenerator: () => `evt-${++eventCounter}`,
  });
  try {
    await work(store);
  } finally {
    store.close();
    await rm(tempDir, { recursive: true, force: true });
  }
}

/* -------------------------------------------------------------------------- */
/* .env.local parsing                                                          */
/* -------------------------------------------------------------------------- */

test('parseEnvFile parses assignments, comments, and quoted values', () => {
  const parsed = parseEnvFile([
    '# comment line',
    'SUPABASE_URL=https://example.supabase.co',
    "QUOTED='single quoted'",
    'DOUBLE="double quoted"',
    'MALFORMED LINE',
    'EMPTY=',
  ].join('\r\n'));
  assert.equal(parsed.SUPABASE_URL, 'https://example.supabase.co');
  assert.equal(parsed.QUOTED, 'single quoted');
  assert.equal(parsed.DOUBLE, 'double quoted');
  assert.equal(parsed.EMPTY, '');
  assert.equal(parsed.MALFORMED, undefined);
});

/* -------------------------------------------------------------------------- */
/* create_plan payload validation                                              */
/* -------------------------------------------------------------------------- */

test('parseCreatePlanPayload accepts a valid payload and trims scope', () => {
  const parsed = parseCreatePlanPayload({
    scope: '  Create a smoke file.  ',
    constraints: ['No other files.'],
    requestedRouting: { provider: 'claude', requestedModel: 'claude-sonnet-5' },
  });
  assert.ok(parsed.ok);
  assert.equal(parsed.payload.scope, 'Create a smoke file.');
  assert.deepEqual(parsed.payload.constraints, ['No other files.']);
  assert.equal(parsed.payload.requestedRouting?.provider, 'claude');
});

test('parseCreatePlanPayload rejects missing scope, oversized scope, and bad routing', () => {
  assert.ok(!parseCreatePlanPayload({}).ok);
  assert.ok(!parseCreatePlanPayload({ scope: '' }).ok);
  assert.ok(!parseCreatePlanPayload({ scope: 'x'.repeat(8_001) }).ok);
  assert.ok(!parseCreatePlanPayload({ scope: 'ok', constraints: 'not-an-array' }).ok);
  assert.ok(!parseCreatePlanPayload({ scope: 'ok', requestedRouting: { provider: 'bash' } }).ok);
  assert.ok(!parseCreatePlanPayload({ scope: 'ok', requestedRouting: { requestedModel: '' } }).ok);
});

/* -------------------------------------------------------------------------- */
/* Architect plan parsing + §17 validation                                     */
/* -------------------------------------------------------------------------- */

test('extractPlanJsonObject accepts fenced, bare, and embedded JSON', () => {
  const plan = { objective: 'x', tasks: [] };
  const fenced = extractPlanJsonObject(`Some prose.\n\`\`\`json\n${JSON.stringify(plan)}\n\`\`\`\ndone`);
  assert.deepEqual(fenced, plan);
  const bare = extractPlanJsonObject(JSON.stringify(plan));
  assert.deepEqual(bare, plan);
  const embedded = extractPlanJsonObject(`leading words ${JSON.stringify(plan)} trailing words`);
  assert.deepEqual(embedded, plan);
  assert.equal(extractPlanJsonObject('no json here'), null);
  assert.equal(extractPlanJsonObject('[1,2,3]'), null);
});

test('validatePlan accepts a valid plan and returns the normalized plan', () => {
  const input = validPlanInput();
  const result = validatePlan(input);
  assert.ok(result.ok, `errors: ${JSON.stringify(result.errors)}`);
  assert.ok(result.plan);
  assert.equal(result.plan.planId, PLAN_ID);
  assert.equal(result.plan.tasks.length, 2);
  assert.equal(result.plan.tasks[1].dependencies[0], 'create-file');
});

test('validatePlan rejects duplicate clientTaskKeys', () => {
  const tasks = [
    validPlanTask(),
    validPlanTask({ clientTaskKey: 'create-file', role: 'verifier', permissionProfile: 'verifier', dependencies: ['create-file'] }),
  ];
  const result = validatePlan({ ...validPlanInput(tasks), tasks });
  assert.ok(!result.ok);
  assert.ok(result.errors.includes('CLIENT_TASK_KEY_DUPLICATE'));
});

test('validatePlan rejects unknown, self, and cyclic dependencies', () => {
  const unknown = validatePlan({ ...validPlanInput(), tasks: [validPlanTask(), validPlanTask({ clientTaskKey: 'v', role: 'verifier', permissionProfile: 'verifier', dependencies: ['missing-key'] })] });
  assert.ok(unknown.errors.includes('DEPENDENCY_UNKNOWN'));

  const self = validatePlan({ ...validPlanInput(), tasks: [validPlanTask({ clientTaskKey: 'a', dependencies: ['a'] })] });
  assert.ok(self.errors.includes('DEPENDENCY_SELF'));

  const cyclic = validatePlan({
    ...validPlanInput(),
    tasks: [
      validPlanTask({ clientTaskKey: 'a', dependencies: ['b'] }),
      validPlanTask({ clientTaskKey: 'b', dependencies: ['a'] }),
      validPlanTask({ clientTaskKey: 'v', role: 'verifier', permissionProfile: 'verifier', dependencies: ['a'] }),
    ],
  });
  assert.ok(cyclic.errors.includes('DEPENDENCY_CYCLE'));
});

test('validatePlan rejects unknown roles and mismatched permission profiles', () => {
  const badRole = validatePlan({ ...validPlanInput(), tasks: [validPlanTask({ role: 'admin' as PlanTask['role'] })] });
  assert.ok(badRole.errors.includes('ROLE_UNKNOWN'));

  const badProfile = validatePlan({ ...validPlanInput(), tasks: [validPlanTask({ permissionProfile: 'verifier' })] });
  assert.ok(badProfile.errors.includes('PROFILE_MISMATCH'));
});

test('validatePlan rejects traversal, absolute, and backslash write paths', () => {
  const traversal = validatePlan({ ...validPlanInput(), tasks: [validPlanTask({ authorizedWritePaths: ['../outside.txt'] })] });
  assert.ok(traversal.errors.includes('WRITE_PATH_INVALID'));

  const absolute = validatePlan({ ...validPlanInput(), tasks: [validPlanTask({ authorizedWritePaths: ['C:/evil.txt'] })] });
  assert.ok(absolute.errors.includes('WRITE_PATH_INVALID'));

  const backslash = validatePlan({ ...validPlanInput(), tasks: [validPlanTask({ authorizedWritePaths: ['src\\evil.txt'] })] });
  assert.ok(backslash.errors.includes('WRITE_PATH_INVALID'));
});

test('validatePlan rejects write paths on verifier tasks', () => {
  const result = validatePlan({
    ...validPlanInput(),
    tasks: [
      validPlanTask(),
      validPlanTask({ clientTaskKey: 'v', role: 'verifier', permissionProfile: 'verifier', dependencies: ['create-file'], authorizedWritePaths: ['agent-host/smoke/other.txt'] }),
    ],
  });
  assert.ok(result.errors.includes('WRITE_PATHS_FOR_REVIEWER'));
});

test('validatePlan requires an implementer, a verifier, and a verifier→implementer dependency', () => {
  const noImplementer = validatePlan({ ...validPlanInput(), tasks: [validPlanTask({ clientTaskKey: 'v', role: 'verifier', permissionProfile: 'verifier' })] });
  assert.ok(noImplementer.errors.includes('IMPLEMENTER_MISSING'));

  const noVerifier = validatePlan({ ...validPlanInput(), tasks: [validPlanTask()] });
  assert.ok(noVerifier.errors.includes('VERIFIER_MISSING'));

  const disconnected = validatePlan({ ...validPlanInput(), tasks: [validPlanTask(), validPlanTask({ clientTaskKey: 'v', role: 'verifier', permissionProfile: 'verifier' })] });
  assert.ok(disconnected.errors.includes('VERIFIER_DEPENDENCY_MISSING'));
});

test('normalizeSafeRepoRelativePath fails closed on unsafe paths', () => {
  assert.equal(normalizeSafeRepoRelativePath('src/lib/file.ts'), 'src/lib/file.ts');
  assert.equal(normalizeSafeRepoRelativePath('/absolute.txt'), null);
  assert.equal(normalizeSafeRepoRelativePath('../up.txt'), null);
  assert.equal(normalizeSafeRepoRelativePath('C:/drive.txt'), null);
  assert.equal(normalizeSafeRepoRelativePath('back\\slash.txt'), null);
  assert.equal(normalizeSafeRepoRelativePath(''), null);
  assert.equal(normalizeSafeRepoRelativePath('a//b'), null);
  assert.equal(normalizeSafeRepoRelativePath('x'.repeat(257)), null);
});

/* -------------------------------------------------------------------------- */
/* Canonical role→profile contract (PROFILE_MISMATCH regression)                */
/* -------------------------------------------------------------------------- */

test('canonical role→profile contract is implementer→task-implementer, verifier→verifier', () => {
  assert.equal(ROLE_TO_PERMISSION_PROFILE.implementer, 'task-implementer');
  assert.equal(ROLE_TO_PERMISSION_PROFILE.verifier, 'verifier');
  assert.equal(ROLE_TO_PERMISSION_PROFILE.architect, 'read-only-reviewer');
});

test('a verifier with a non-canonical permissionProfile fails PROFILE_MISMATCH (no coercion)', () => {
  for (const badProfile of ['task-implementer', 'read-only-reviewer', 'verifier-profile', 'admin']) {
    const result = validatePlan({
      ...validPlanInput(),
      tasks: [
        validPlanTask(),
        validPlanTask({ clientTaskKey: 'verify-file', role: 'verifier', permissionProfile: badProfile as PlanTask['permissionProfile'], dependencies: ['create-file'], authorizedWritePaths: [] }),
      ],
    });
    assert.ok(!result.ok, `verifier profile "${badProfile}" must be rejected`);
    assert.ok(result.errors.includes('PROFILE_MISMATCH'), `verifier profile "${badProfile}" must fail PROFILE_MISMATCH`);
    assert.equal(result.plan, null, 'validator must stay strict — never coerce or repair the profile');
  }

  // The canonical profiles still validate cleanly — the validator was not weakened.
  const canonical = validatePlan(validPlanInput());
  assert.ok(canonical.ok && canonical.plan, `canonical plan must still pass: ${JSON.stringify(canonical.errors)}`);
  assert.equal(canonical.plan.tasks[0].permissionProfile, ROLE_TO_PERMISSION_PROFILE.implementer);
  assert.equal(canonical.plan.tasks[1].permissionProfile, ROLE_TO_PERMISSION_PROFILE.verifier);
});

test('a validated verifier task is read-only and depends on the implementer', () => {
  const result = validatePlan(validPlanInput());
  assert.ok(result.ok && result.plan);
  const verifier = result.plan.tasks.find((task) => task.role === 'verifier');
  const implementer = result.plan.tasks.find((task) => task.role === 'implementer');
  assert.ok(verifier && implementer);
  assert.deepEqual(verifier.authorizedWritePaths, [], 'verifier must be read-only');
  assert.deepEqual(verifier.dependencies, [implementer.clientTaskKey], 'verifier must depend on the implementer task');
});

test('buildArchitectPrompt states BOTH canonical mappings so prompt and validator cannot drift', () => {
  const prompt = buildArchitectPrompt({ scope: 'Create a smoke file.', constraints: [], requestedRouting: null });
  for (const { role, profile } of EXECUTABLE_ROLE_PROFILE_PAIRS) {
    assert.ok(prompt.includes(`role "${role}"`), `prompt must name the "${role}" role`);
    assert.ok(
      prompt.includes(`permissionProfile "${profile}"`),
      `prompt must state the canonical ${role} → ${profile} mapping`,
    );
  }
  assert.match(prompt, /at least one implementer task and at least one verifier task/);
  assert.match(prompt, /The verifier must depend on the implementer task/);
  assert.match(prompt, /authorizedWritePaths to \[\]/);
  assert.match(prompt, /Writes outside those areas are drift and require owner approval/);

  // The JSON example itself must demonstrate BOTH executable roles correctly.
  const example = extractPlanJsonObject(prompt);
  assert.ok(example, 'prompt must embed a parseable ```json example');
  const tasks = example.tasks as Array<Record<string, unknown>>;
  const roles = tasks.map((task) => task.role);
  assert.deepEqual([...new Set(roles)].sort(), ['implementer', 'verifier'], 'example shows exactly both executable roles');
  assert.ok(!roles.includes('architect'), 'the example must never contain an executable architect task');
  assert.ok(!prompt.includes(ROLE_TO_PERMISSION_PROFILE.architect), 'the architect profile must not appear as a task profile');

  const exampleImplementer = tasks.find((task) => task.role === 'implementer');
  const exampleVerifier = tasks.find((task) => task.role === 'verifier');
  assert.ok(exampleImplementer && exampleVerifier);
  assert.equal(exampleImplementer.permissionProfile, ROLE_TO_PERMISSION_PROFILE.implementer);
  assert.equal(exampleVerifier.permissionProfile, ROLE_TO_PERMISSION_PROFILE.verifier);
  assert.deepEqual(exampleVerifier.authorizedWritePaths, []);
  assert.deepEqual(exampleVerifier.dependencies, [exampleImplementer.clientTaskKey], 'example verifier depends on the example implementer');
});

/* -------------------------------------------------------------------------- */
/* Plan hash exactness (§22 — approve references the EXACT plan)                 */
/* -------------------------------------------------------------------------- */

test('computePlanHash is deterministic, key-order independent, and change sensitive', () => {
  const plan = validatePlan(validPlanInput());
  assert.ok(plan.ok && plan.plan);
  const controlPlan: ControlPlan = plan.plan;

  const hashA = computePlanHash(controlPlan);
  const hashB = computePlanHash({
    ...controlPlan,
    constraints: [...controlPlan.constraints],
    tasks: controlPlan.tasks.map((task) => ({ ...task, dependencies: [...task.dependencies] })),
  });
  assert.equal(hashA, hashB);

  const reorderedTasks = { ...controlPlan, tasks: [controlPlan.tasks[1], controlPlan.tasks[0]] };
  assert.equal(canonicalJsonStringify(reorderedTasks.tasks[0]), canonicalJsonStringify(controlPlan.tasks[1]));
  assert.equal(computePlanHash({ ...controlPlan, tasks: [...controlPlan.tasks] }), hashA);

  const modified = { ...controlPlan, objective: 'different objective' };
  assert.notEqual(computePlanHash(modified), hashA);
});

/* -------------------------------------------------------------------------- */
/* Architect turn → plan                                                       */
/* -------------------------------------------------------------------------- */

test('parseArchitectPlan succeeds on a valid architect output and records model truth', () => {
  const planObject = {
    objective: 'Create and verify a smoke file.',
    constraints: ['Do not modify any other file.'],
    riskSummary: null,
    tasks: [
      {
        clientTaskKey: 'create-file',
        title: 'Create the file',
        goal: 'Create agent-host/smoke/example.txt.',
        role: 'implementer',
        dependencies: [],
        permissionProfile: 'task-implementer',
        authorizedWritePaths: ['agent-host/smoke/example.txt'],
        plannedAreas: ['agent-host/smoke'],
        validationRequirements: ['Exact contents.'],
        provider: 'claude',
        requestedModel: null,
      },
      {
        clientTaskKey: 'verify-file',
        title: 'Verify the file',
        goal: 'Verify the file.',
        role: 'verifier',
        dependencies: ['create-file'],
        permissionProfile: 'verifier',
        authorizedWritePaths: [],
        plannedAreas: ['agent-host/smoke'],
        validationRequirements: ['Exact contents.'],
        provider: 'claude',
        requestedModel: null,
      },
    ],
  };
  const result = parseArchitectPlan({
    scope: 'scope',
    constraints: [],
    provider: 'claude',
    result: buildExecutionResult({
      finalText: `Plan:\n\`\`\`json\n${JSON.stringify(planObject)}\n\`\`\``,
      reportedModel: 'claude-architect-model',
    }),
  });
  assert.ok(result.ok);
  assert.equal(result.result.architect.provider, 'claude');
  assert.equal(result.result.architect.reportedModel, 'claude-architect-model');
  assert.equal(result.result.plan.planId.startsWith('plan-'), true);
  assert.equal(result.result.planHash.length, 64);
});

test('parseArchitectPlan fails closed on provider failure, empty output, and invalid plans', () => {
  const failedTurn = parseArchitectPlan({ scope: 's', constraints: [], provider: 'claude', result: buildExecutionResult({ success: false }) });
  assert.ok(!failedTurn.ok && failedTurn.failure.code === 'ARCHITECT_TURN_FAILED');

  const empty = parseArchitectPlan({ scope: 's', constraints: [], provider: 'claude', result: buildExecutionResult({ finalText: '' }) });
  assert.ok(!empty.ok && empty.failure.code === 'PLAN_OUTPUT_MISSING');

  const invalid = parseArchitectPlan({
    scope: 's',
    constraints: [],
    provider: 'claude',
    result: buildExecutionResult({ finalText: JSON.stringify({ objective: 'x', tasks: [{ clientTaskKey: 'only-architect' }] }) }),
  });
  assert.ok(!invalid.ok && invalid.failure.code === 'PLAN_VALIDATION_FAILED');
});

/* -------------------------------------------------------------------------- */
/* Verifier verdict                                                            */
/* -------------------------------------------------------------------------- */

test('parseVerifierVerdict parses explicit verdicts and fails closed otherwise', () => {
  assert.equal(parseVerifierVerdict('checks ok\nVERDICT: PASS'), 'pass');
  assert.equal(parseVerifierVerdict('wrong contents\nverdict: fail'), 'fail');
  assert.equal(parseVerifierVerdict('no verdict line'), 'unknown');
  assert.equal(parseVerifierVerdict(undefined), 'unknown');
  assert.equal(parseVerifierVerdict('VERDICT: PASS then VERDICT: FAIL'), 'unknown');
});

test('ATB-7B2: verifier result keeps a bounded summary and drops unlabeled prose', () => {
  const reasoning = 'Hidden chain of thought that must never be stored. '.repeat(20);
  const pass = parseVerifierResult(`${reasoning}\nSUMMARY: Marker file matches the acceptance token.\nEVIDENCE: ${CONTROL_TOWER_UI_SMOKE_PATH}\nVERDICT: PASS`);
  assert.equal(pass.verdict, 'pass');
  assert.equal(pass.summary, 'Marker file matches the acceptance token.');
  assert.deepEqual(pass.evidenceRefs, [CONTROL_TOWER_UI_SMOKE_PATH]);
  assert.equal(JSON.stringify(pass).includes('Hidden chain of thought'), false);

  const fail = parseVerifierResult('SUMMARY: Smoke file contents did not match the acceptance token.\nFAILED_CHECK: content-mismatch\nVERDICT: FAIL');
  assert.equal(fail.verdict, 'fail');
  assert.equal(fail.summary, 'Smoke file contents did not match the acceptance token.');
  assert.deepEqual(fail.failedChecks, ['content-mismatch']);

  const legacy = parseVerifierResult('the file has wrong contents\nVERDICT: FAIL');
  assert.equal(legacy.verdict, 'fail');
  assert.equal(legacy.summary, null);

  const malformed = parseVerifierResult(`${reasoning}\nSUMMARY: ambiguous\nVERDICT: PASS\nVERDICT: FAIL`);
  assert.equal(malformed.verdict, 'unknown');
  assert.equal(malformed.summary, null);
  assert.equal(JSON.stringify(malformed).includes('Hidden chain of thought'), false);

  const longSummary = `SUMMARY: ${'x'.repeat(VERIFIER_SUMMARY_MAX_CHARS + 40)}\nVERDICT: FAIL`;
  const bounded = parseVerifierResult(longSummary);
  assert.equal(bounded.summary?.length, VERIFIER_SUMMARY_MAX_CHARS);

  const manyRefs = parseVerifierResult(['VERDICT: FAIL', ...Array.from({ length: 9 }, (_, index) => `EVIDENCE: path-${index}.txt`)].join('\n'));
  assert.equal(manyRefs.evidenceRefs.length, 8);
});

test('ATB-7B2: control-tower smoke acceptance owns the single trailing newline', () => {
  const exact = Buffer.from(`${CONTROL_TOWER_UI_SMOKE_LINE}\n`, 'utf8');
  const crlf = Buffer.from(`${CONTROL_TOWER_UI_SMOKE_LINE}\r\n`, 'utf8');
  assert.deepEqual(evaluateControlTowerUiSmokeAcceptance({ fileBytes: exact, changedPaths: [CONTROL_TOWER_UI_SMOKE_PATH] }), { passed: true, failedChecks: [] });
  assert.equal(evaluateControlTowerUiSmokeAcceptance({ fileBytes: crlf, changedPaths: [CONTROL_TOWER_UI_SMOKE_PATH] }).passed, true);
  assert.ok(evaluateControlTowerUiSmokeAcceptance({ fileBytes: null, changedPaths: [CONTROL_TOWER_UI_SMOKE_PATH] }).failedChecks.includes('file-missing'));
  assert.ok(evaluateControlTowerUiSmokeAcceptance({ fileBytes: Buffer.from(CONTROL_TOWER_UI_SMOKE_LINE, 'utf8'), changedPaths: [CONTROL_TOWER_UI_SMOKE_PATH] }).failedChecks.includes('content-mismatch'));
  assert.ok(evaluateControlTowerUiSmokeAcceptance({ fileBytes: Buffer.from(`${CONTROL_TOWER_UI_SMOKE_LINE}\n\n`, 'utf8'), changedPaths: [CONTROL_TOWER_UI_SMOKE_PATH] }).failedChecks.includes('content-mismatch'));
  assert.ok(evaluateControlTowerUiSmokeAcceptance({ fileBytes: Buffer.from(` ${CONTROL_TOWER_UI_SMOKE_LINE}\n`, 'utf8'), changedPaths: [CONTROL_TOWER_UI_SMOKE_PATH] }).failedChecks.includes('content-mismatch'));
  const extra = evaluateControlTowerUiSmokeAcceptance({ fileBytes: exact, changedPaths: [CONTROL_TOWER_UI_SMOKE_PATH, 'README.md'] });
  assert.equal(extra.passed, false);
  assert.ok(extra.failedChecks.includes('unauthorized-change'));
});

/* -------------------------------------------------------------------------- */
/* Task spec contract + ProductionExecutionPort delegation                     */
/* -------------------------------------------------------------------------- */

function taskControlSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    control: {
      provider: 'claude',
      requestedModel: null,
      permissionProfile: 'task-implementer',
      prompt: 'Do the work.',
      timeoutMs: 600_000,
    },
    policy: { authorizedWritePaths: ['agent-host/smoke/example.txt'] },
    workingDirectory: 'C:\\repo',
    plan: { clientTaskKey: 'create-file', role: 'implementer', plannedAreas: ['agent-host/smoke'] },
    ...overrides,
  };
}

test('parseTaskControlSpec validates the durable spec contract', () => {
  const spec = parseTaskControlSpec(taskControlSpec());
  assert.equal(spec.control.provider, 'claude');
  assert.equal(spec.control.permissionProfile, 'task-implementer');
  assert.equal(spec.workingDirectory, 'C:\\repo');

  assert.throws(() => parseTaskControlSpec(null), TaskSpecContractError);
  assert.throws(() => parseTaskControlSpec({ policy: {} }), TaskSpecContractError);
  assert.throws(() => parseTaskControlSpec({ control: {} }), TaskSpecContractError);
  assert.throws(() => parseTaskControlSpec({ ...taskControlSpec(), workingDirectory: '' }), TaskSpecContractError);
  assert.throws(
    () => parseTaskControlSpec(taskControlSpec({ control: { provider: 'claude', prompt: 'x', permissionProfile: 'admin' } })),
    TaskSpecContractError,
  );
});

test('ProductionExecutionPort delegates through AttemptExecutor with the spec fields', async () => {
  await withStore(async (store) => {
    store.createRun({ runId: 'run-1', title: 'run' });
    const spec = taskControlSpec();
    store.createTask({ taskId: 'task-1', runId: 'run-1', title: 'task', goal: 'goal', spec: spec as never });

    const executions: Array<{ input: Record<string, unknown>; context: Record<string, unknown> }> = [];
    const fakeExecutor = {
      execute: async (input: Record<string, unknown>) => {
        executions.push({ input, context: {} });
        return {
          executionId: 'exec-1',
          attempt: { attemptId: input.attemptId, status: 'passed' },
          result: buildExecutionResult({ finalText: 'checked\nVERDICT: PASS', reportedModel: 'verifier-model' }),
          startedEvent: null,
          terminalEvent: null,
          terminalAttemptStatus: 'passed' as const,
          policy: { accepted: true },
        };
      },
      cancel: () => false,
      shutdown: async () => ({}),
    };

    const port = new ProductionExecutionPort({ store, executor: fakeExecutor as never });
    await port.execute({
      runId: 'run-1',
      taskId: 'task-1',
      attemptId: 'att-1',
      attemptOrdinal: 1,
      hostInstanceId: 'host-1',
      task: store.getTask('task-1') as never,
    });

    assert.equal(executions.length, 1);
    assert.equal(executions[0].input.provider, 'claude');
    assert.equal(executions[0].input.permissionProfile, 'task-implementer');
    assert.equal(executions[0].input.prompt, 'Do the work.');
    assert.equal(executions[0].input.workingDirectory, 'C:\\repo');

    const verdict = port.getVerifierVerdict('run-1');
    assert.equal(verdict, null, 'implementer tasks record no verifier verdict');
  });
});

test('ProductionExecutionPort records verifier verdicts as durable safe events', async () => {
  await withStore(async (store) => {
    store.createRun({ runId: 'run-1', title: 'run' });
    store.createTask({
      taskId: 'task-1',
      runId: 'run-1',
      title: 'verify',
      goal: 'verify',
      spec: taskControlSpec({
        control: { provider: 'claude', requestedModel: null, permissionProfile: 'verifier', prompt: 'Verify.', timeoutMs: 600_000 },
        policy: { authorizedWritePaths: [] },
        plan: { clientTaskKey: 'verify-file', role: 'verifier', plannedAreas: ['agent-host/smoke'] },
      }) as never,
    });
    // The durable verdict event references the attempt row, which the real
    // AttemptExecutor would have created before the port runs.
    store.createAttempt({ attemptId: 'att-1', taskId: 'task-1', hostInstanceId: 'host-1' });

    const fakeExecutor = {
      execute: async () => ({
        executionId: 'exec-1',
        attempt: { attemptId: 'att-1', status: 'passed' },
        result: buildExecutionResult({ finalText: 'the file has wrong contents\nVERDICT: FAIL', reportedModel: 'verifier-model' }),
        startedEvent: null,
        terminalEvent: null,
        terminalAttemptStatus: 'passed' as const,
        policy: { accepted: true },
      }),
      cancel: () => false,
      shutdown: async () => ({}),
    };

    const port = new ProductionExecutionPort({ store, executor: fakeExecutor as never });
    await port.execute({
      runId: 'run-1',
      taskId: 'task-1',
      attemptId: 'att-1',
      attemptOrdinal: 1,
      hostInstanceId: 'host-1',
      task: store.getTask('task-1') as never,
    });

    const verdictEvent = store.listEvents().find((event) => event.type === VERIFIER_VERDICT_EVENT);
    assert.ok(verdictEvent, 'verdict event must be durable');
    const payload = verdictEvent.payload as Record<string, unknown>;
    assert.equal(payload.verdict, 'fail');
    assert.equal(payload.attemptStatus, 'passed');
    assert.equal(payload.summary, 'VERDICT: FAIL');
    assert.equal(JSON.stringify(payload).includes('wrong contents'), false);
    assert.equal(port.getVerifierVerdict('run-1')?.verdict, 'fail');
    assert.equal(port.getVerifierVerdict('run-1')?.summary, 'VERDICT: FAIL');
  });
});

test('ATB-4B: invalid launch contract does not call the executor and fail-closes the Attempt', async () => {
  await withStore(async (store) => {
    store.createRun({ runId: 'run-1', title: 'run' });
    store.createTask({
      taskId: 'task-1',
      runId: 'run-1',
      title: 'verify',
      spec: taskControlSpec({
        control: { provider: 'claude', requestedModel: null, permissionProfile: 'verifier', prompt: 'Verify.', timeoutMs: 600_000 },
        policy: { authorizedWritePaths: ['src/secret.ts'] },
        plan: { clientTaskKey: 'verify-file', role: 'verifier', plannedAreas: [] },
      }) as never,
    });
    store.createAttempt({ attemptId: 'att-1', taskId: 'task-1', hostInstanceId: 'host-1' });

    let launches = 0;
    const port = new ProductionExecutionPort({
      store,
      executor: { execute: async () => { launches += 1; throw new Error('provider must not launch'); } } as never,
      availableProviders: new Set(['claude']),
    });

    const result = await port.execute({
      runId: 'run-1',
      taskId: 'task-1',
      attemptId: 'att-1',
      attemptOrdinal: 1,
      hostInstanceId: 'host-1',
      task: store.getTask('task-1') as never,
    });

    assert.equal(launches, 0);
    assert.equal(result?.failure?.cause, 'policy-rejection');
    assert.equal(store.getAttempt('att-1')?.status, 'failed');
    assert.ok(store.listEvents().some((event) => event.type === 'policy.evaluated'));
    assert.ok(store.listEvents().some((event) => event.type === 'execution.failed'));
  });
});

test('ATB-4B: unavailable provider and unsupported effort never launch', async () => {
  await withStore(async (store) => {
    store.createRun({ runId: 'run-1', title: 'run' });
    store.createTask({
      taskId: 'task-1',
      runId: 'run-1',
      title: 'impl',
      spec: taskControlSpec() as never,
    });
    store.createAttempt({ attemptId: 'att-1', taskId: 'task-1', hostInstanceId: 'host-1' });

    let launches = 0;
    const unavailable = new ProductionExecutionPort({
      store,
      executor: { execute: async () => { launches += 1; } } as never,
      availableProviders: new Set(['codex']),
    });
    await unavailable.execute({
      runId: 'run-1',
      taskId: 'task-1',
      attemptId: 'att-1',
      attemptOrdinal: 1,
      hostInstanceId: 'host-1',
      task: store.getTask('task-1') as never,
    });
    assert.equal(launches, 0);
    assert.equal(store.getAttempt('att-1')?.status, 'failed');

    store.createTask({
      taskId: 'task-2',
      runId: 'run-1',
      title: 'ollama-effort',
      spec: taskControlSpec({
        control: { provider: 'ollama', requestedModel: 'llama3', permissionProfile: 'task-implementer', prompt: 'Do.', timeoutMs: 600_000, reasoningEffort: 'high' },
      }) as never,
    });
    store.createAttempt({ attemptId: 'att-2', taskId: 'task-2', hostInstanceId: 'host-1' });
    const effortPort = new ProductionExecutionPort({
      store,
      executor: { execute: async () => { launches += 1; } } as never,
      availableProviders: new Set(['ollama']),
    });
    await effortPort.execute({
      runId: 'run-1',
      taskId: 'task-2',
      attemptId: 'att-2',
      attemptOrdinal: 1,
      hostInstanceId: 'host-1',
      task: store.getTask('task-2') as never,
    });
    assert.equal(launches, 0);
    assert.equal(store.getAttempt('att-2')?.status, 'failed');
  });
});

test('ATB-4B: valid implementer contract still launches exactly once', async () => {
  await withStore(async (store) => {
    store.createRun({ runId: 'run-1', title: 'run' });
    store.createTask({ taskId: 'task-1', runId: 'run-1', title: 'impl', spec: taskControlSpec() as never });
    store.createAttempt({ attemptId: 'att-1', taskId: 'task-1', hostInstanceId: 'host-1' });
    let launches = 0;
    const port = new ProductionExecutionPort({
      store,
      executor: {
        execute: async () => {
          launches += 1;
          return { executionId: 'e', attempt: { attemptId: 'att-1', status: 'passed' }, result: buildExecutionResult({}), startedEvent: null, terminalEvent: null, terminalAttemptStatus: 'passed', policy: { accepted: true } };
        },
      } as never,
      availableProviders: new Set(['claude']),
    });
    await port.execute({
      runId: 'run-1',
      taskId: 'task-1',
      attemptId: 'att-1',
      attemptOrdinal: 1,
      hostInstanceId: 'host-1',
      task: store.getTask('task-1') as never,
    });
    assert.equal(launches, 1);
  });
});

/* -------------------------------------------------------------------------- */
/* Safe snapshot whitelist (§29)                                                */
/* -------------------------------------------------------------------------- */

test('buildRunSnapshot publishes the whitelist and NEVER the prompt or transcript', async () => {
  await withStore(async (store) => {
    store.createRun({ runId: 'run-1', title: 'Smoke run', goal: 'objective text' });
    store.createTask({
      taskId: 'task-1',
      runId: 'run-1',
      title: 'Create the file',
      goal: 'goal text',
      spec: taskControlSpec() as never,
    });
    store.createTask({
      taskId: 'task-2',
      runId: 'run-1',
      title: 'Verify the file',
      goal: 'verify goal',
      position: 1,
      spec: taskControlSpec({
        control: { provider: 'claude', requestedModel: null, permissionProfile: 'verifier', prompt: 'SECRET PROMPT TEXT NEVER PUBLISH', timeoutMs: 600_000 },
        policy: { authorizedWritePaths: [] },
        plan: { clientTaskKey: 'verify-file', role: 'verifier', plannedAreas: [] },
      }) as never,
    });
    store.addDependency('task-2', 'task-1');

    store.createAttempt({ attemptId: 'att-1', taskId: 'task-1', hostInstanceId: 'host-1' });
    store.appendEvent({
      eventId: 'evt-exec-1',
      runId: 'run-1',
      taskId: 'task-1',
      attemptId: 'att-1',
      type: 'execution.completed',
      payload: { requestedModel: 'req-m', reportedModel: 'rep-m', reportedModelSource: 'protocol-message' },
    });
    store.transitionAttempt('att-1', 'passed');
    store.appendEvent({
      eventId: 'evt-cs-1',
      runId: 'run-1',
      taskId: 'task-1',
      attemptId: 'att-1',
      type: 'workspace.changeset.ready',
      payload: { workspaceId: 'ws-1', baselineHeadSha: 'abc', changeCount: 1, workspaceState: 'cleanup-eligible' },
    });
    store.appendEvent({
      eventId: 'evt-pol-1',
      runId: 'run-1',
      taskId: 'task-1',
      attemptId: 'att-1',
      type: 'policy.evaluated',
      payload: { accepted: true, changes: [{ category: 'NEW', path: 'agent-host/smoke/example.txt', decision: 'allow' }] },
    });

    const snapshot = buildRunSnapshot({ store, runId: 'run-1', verification: { verdict: 'pass', summary: 'VERDICT: PASS' } });
    assert.ok(snapshot);
    assert.equal(snapshot.run.runId, 'run-1');
    assert.equal(snapshot.run.objective, 'objective text');
    assert.equal(snapshot.tasks.length, 2);
    assert.equal(snapshot.tasks[0].clientTaskKey, 'create-file');
    assert.deepEqual(snapshot.tasks[1].dependencies, ['create-file']);
    assert.equal(snapshot.attempts.length, 1);
    assert.equal(snapshot.attempts[0].reportedModel, 'rep-m');
    assert.ok(snapshot.changeset?.ready);
    assert.deepEqual(snapshot.changeset?.safePaths, ['agent-host/smoke/example.txt']);
    assert.equal(snapshot.verification?.verdict, 'pass');
    // ATB-3: the per-task provider/effort display truth projects from spec.control.
    assert.equal(snapshot.tasks[1].provider, 'claude');
    assert.equal(snapshot.tasks[1].reasoningEffort, null, 'unset spec effort stays null, never fabricated');

    const serialized = JSON.stringify(snapshot);
    assert.ok(!serialized.includes('SECRET PROMPT TEXT'), 'prompt must never appear in the snapshot');
    assert.ok(!serialized.includes('Do the work.'), 'prompt must never appear in the snapshot');
  });
});

test('snapshot tasks project the real provider and normalized effort from spec.control (ATB-3)', async () => {
  await withStore(async (store) => {
    store.createRun({ runId: 'run-1', title: 'run' });
    store.createTask({
      taskId: 'task-1', runId: 'run-1', title: 'task', goal: 'goal',
      spec: taskControlSpec({
        control: { provider: 'codex', requestedModel: 'gpt-5.6-sol', reasoningEffort: 'extra-high', permissionProfile: 'task-implementer', prompt: 'SECRET PROMPT', timeoutMs: 600_000 },
        policy: { authorizedWritePaths: [] },
        plan: { clientTaskKey: 'impl', role: 'implementer', plannedAreas: [] },
      }) as never,
    });
    const snapshot = buildRunSnapshot({ store, runId: 'run-1', verification: null });
    assert.ok(snapshot);
    assert.equal(snapshot.tasks[0].provider, 'codex');
    assert.equal(snapshot.tasks[0].reasoningEffort, 'extra-high');
  });
});

test('extractTaskPlanMeta falls back to safe defaults on missing plan metadata', async () => {
  await withStore(async (store) => {
    store.createRun({ runId: 'run-1', title: 'run' });
    store.createTask({ taskId: 'task-1', runId: 'run-1', title: 'task', goal: 'goal', spec: null });
    const meta = extractTaskPlanMeta(store.getTask('task-1') as never);
    assert.equal(meta.clientTaskKey, 'task-1');
    assert.equal(meta.role, 'implementer');
    assert.equal(meta.provider, null);
    assert.equal(meta.reasoningEffort, null);
  });
});

/* -------------------------------------------------------------------------- */
/* Task prompt synthesis                                                       */
/* -------------------------------------------------------------------------- */

test('buildTaskPrompt synthesizes role-specific prompts from validated fields', () => {
  const plan = validatePlan(validPlanInput());
  assert.ok(plan.ok && plan.plan);
  const implementerPrompt = buildTaskPrompt(plan.plan.tasks[0], plan.plan);
  assert.match(implementerPrompt, /You are the Implementer/);
  assert.match(implementerPrompt, /agent-host\/smoke\/example\.txt/);
  assert.ok(!implementerPrompt.includes('VERDICT'));

  const verifierPrompt = buildTaskPrompt(plan.plan.tasks[1], plan.plan);
  assert.match(verifierPrompt, /You are the Verifier/);
  assert.match(verifierPrompt, /VERDICT: PASS/);
  assert.ok(!verifierPrompt.includes('You may create or modify'));
});

/* -------------------------------------------------------------------------- */
/* create_plan / approve_plan handlers (fake ControlPlane + fake adapter)      */
/* -------------------------------------------------------------------------- */

interface RecordedRequestCompletion {
  id: string;
  result?: Record<string, unknown> | null;
  error?: string | null;
}

class FakeControlPlane {
  readonly completions: RecordedRequestCompletion[] = [];
  readonly storedPlans = new Map<string, Record<string, unknown>>();

  async completeRequest(id: string, result: Record<string, unknown>): Promise<void> {
    this.completions.push({ id, result });
    const planId = typeof result.planId === 'string' ? result.planId : null;
    if (planId) {
      this.storedPlans.set(planId, result);
    }
  }

  async failRequest(id: string, safeError: string): Promise<void> {
    this.completions.push({ id, error: safeError });
  }

  async findPlanByPlanId(planId: string): Promise<{ result: Record<string, unknown> } | null> {
    const stored = this.storedPlans.get(planId);
    return stored ? { result: stored } : null;
  }

  asControlPlane(): ControlPlane {
    return this as unknown as ControlPlane;
  }
}

function claimedRequest(payload: Record<string, unknown>, requestType: ClaimedControlRequest['request_type'] = 'create_plan'): ClaimedControlRequest {
  return {
    id: 'req-1',
    repo_key: 'repo-key-1',
    request_type: requestType,
    client_request_id: 'client-req-1',
    payload,
    status: 'claimed',
    created_at: '2026-09-16T00:00:00.000Z',
  };
}

function architectPlanObject(): Record<string, unknown> {
  return {
    objective: 'Create and verify a smoke file.',
    constraints: ['Do not modify any other file.'],
    riskSummary: null,
    tasks: [
      {
        clientTaskKey: 'create-file',
        title: 'Create the file',
        goal: 'Create agent-host/smoke/example.txt with exact contents.',
        role: 'implementer',
        dependencies: [],
        permissionProfile: 'task-implementer',
        authorizedWritePaths: ['agent-host/smoke/example.txt'],
        plannedAreas: ['agent-host/smoke'],
        validationRequirements: ['File exists with exact contents.'],
        provider: 'claude',
        requestedModel: null,
      },
      {
        clientTaskKey: 'verify-file',
        title: 'Verify the file',
        goal: 'Verify the file exists with exact contents.',
        role: 'verifier',
        dependencies: ['create-file'],
        permissionProfile: 'verifier',
        authorizedWritePaths: [],
        plannedAreas: ['agent-host/smoke'],
        validationRequirements: ['File exists with exact contents.'],
        provider: 'claude',
        requestedModel: null,
      },
    ],
  };
}

test('handleCreatePlan completes with planId+planHash and never publishes the prompt', async () => {
  const controlPlane = new FakeControlPlane();
  const adapter = {
    execute: async (request: ExecutionRequest) => {
      assert.equal(request.permissionProfile, 'read-only-reviewer', 'Architect must run read-only');
      assert.ok(request.prompt.includes('OWNER SCOPE'));
      assert.ok(request.workingDirectory.length > 0);
      return buildExecutionResult({
        finalText: `\`\`\`json\n${JSON.stringify(architectPlanObject())}\n\`\`\``,
        reportedModel: 'claude-architect-model',
      });
    },
  };
  const registry = new Map([['claude', adapter as never]]);

  await handleCreatePlan({
    store: null as never,
    registry: registry as never,
    controlPlane: controlPlane.asControlPlane(),
    request: claimedRequest({ scope: 'Create a smoke file.', constraints: [] }),
    canonicalRepoPath: 'C:\\repo',
  });

  assert.equal(controlPlane.completions.length, 1);
  const completion = controlPlane.completions[0];
  assert.ok(!completion.error, `unexpected failure: ${completion.error}`);
  const result = completion.result ?? {};
  assert.match(String(result.planId), /^plan-/u);
  assert.match(String(result.planHash), /^[0-9a-f]{64}$/u);
  assert.equal((result.plan as Record<string, unknown>).tasks !== undefined, true);
  assert.equal((result.architect as Record<string, unknown>).reportedModel, 'claude-architect-model');
  // The owner prompt is never published back to the control plane.
  assert.ok(!JSON.stringify(result).includes('OWNER SCOPE'));
});

test('handleCreatePlan fails the request safely on a bad payload and a bad plan', async () => {
  const controlPlane = new FakeControlPlane();
  const registry = new Map();

  await handleCreatePlan({
    store: null as never,
    registry: registry as never,
    controlPlane: controlPlane.asControlPlane(),
    request: claimedRequest({ scope: '' }),
    canonicalRepoPath: 'C:\\repo',
  });
  assert.match(String(controlPlane.completions[0].error), /^SCOPE_MISSING/u);

  const badPlanAdapter = {
    execute: async () => buildExecutionResult({ finalText: '```json\n{"objective":"x","tasks":[{"clientTaskKey":"only-architect"}]}\n```' }),
  };
  const badPlanControlPlane = new FakeControlPlane();
  await handleCreatePlan({
    store: null as never,
    registry: new Map([['claude', badPlanAdapter as never]]) as never,
    controlPlane: badPlanControlPlane.asControlPlane(),
    request: claimedRequest({ scope: 'Create a smoke file.', constraints: [] }),
    canonicalRepoPath: 'C:\\repo',
  });
  assert.match(String(badPlanControlPlane.completions[0].error), /^PLAN_VALIDATION_FAILED/u);
});

test('handleApprovePlan creates the REAL run/tasks/deps only for the EXACT approved plan', async () => {
  await withStore(async (store) => {
    const controlPlane = new FakeControlPlane();
    const adapter = {
      execute: async () => buildExecutionResult({
        finalText: `\`\`\`json\n${JSON.stringify(architectPlanObject())}\n\`\`\``,
        reportedModel: 'architect-model',
      }),
    };
    const registry = new Map([['claude', adapter as never]]);
    await handleCreatePlan({
      store,
      registry: registry as never,
      controlPlane: controlPlane.asControlPlane(),
      request: claimedRequest({ scope: 'Create a smoke file.', constraints: [] }),
      canonicalRepoPath: 'C:\\repo',
    });
    const created = controlPlane.completions[0].result as Record<string, unknown>;
    const planId = created.planId as string;
    const planHash = created.planHash as string;

    // A stale/edited plan hash must be rejected with NO run created.
    const mismatch = await handleApprovePlan({
      store,
      controlPlane: controlPlane.asControlPlane(),
      request: claimedRequest({ planId, planHash: `${planHash.slice(0, 63)}0` }, 'approve_plan'),
      canonicalRepoPath: 'C:\\repo',
    });
    assert.ok(!mismatch.ok);
    assert.equal(mismatch.safeError, 'PLAN_HASH_MISMATCH');
    assert.equal(store.listRuns().length, 0);

    // The exact hash creates the run, tasks, and dependency edges.
    const outcome: ApprovePlanOutcome = await handleApprovePlan({
      store,
      controlPlane: controlPlane.asControlPlane(),
      request: claimedRequest({ planId, planHash }, 'approve_plan'),
      canonicalRepoPath: 'C:\\repo',
    });
    assert.ok(outcome.ok && outcome.runId);
    const run = store.getRun(outcome.runId!);
    assert.ok(run);
    assert.equal(run.status, 'pending');

    const tasks = store.listTasks(outcome.runId!);
    assert.equal(tasks.length, 2);
    const implementer = tasks.find((task) => task.taskId.endsWith('create-file'));
    const verifier = tasks.find((task) => task.taskId.endsWith('verify-file'));
    assert.ok(implementer && verifier);

    const spec = (implementer.spec as Record<string, unknown>);
    const control = spec.control as Record<string, unknown>;
    assert.equal(control.provider, 'claude');
    assert.equal(control.permissionProfile, 'task-implementer');
    assert.equal(typeof control.prompt, 'string');
    assert.equal(spec.workingDirectory, 'C:\\repo');
    const policy = spec.policy as Record<string, unknown>;
    assert.deepEqual(policy.authorizedWritePaths, ['agent-host/smoke/example.txt']);

    const deps = store.listDependencies(outcome.runId!);
    assert.equal(deps.length, 1);
    assert.equal(deps[0].taskId, verifier.taskId);
    assert.equal(deps[0].dependsOnTaskId, implementer.taskId);

    const completion = controlPlane.completions[controlPlane.completions.length - 1];
    assert.equal((completion.result as Record<string, unknown>).runId, outcome.runId);
  });
});

/* -------------------------------------------------------------------------- */
/* Startup restart/resume (§28) — resumeResumableRuns drives interrupted Runs    */
/* -------------------------------------------------------------------------- */

const OLD_HOST = 'host-instance-OLD';
const NEW_HOST = 'host-instance-NEW';

function verifierSpecWithBudget(maxAttempts: number): Record<string, unknown> {
  return taskControlSpec({
    control: {
      provider: 'claude',
      requestedModel: null,
      permissionProfile: 'verifier',
      prompt: 'SECRET VERIFIER PROMPT — NEVER PUBLISH. VERDICT: PASS or VERDICT: FAIL.',
      timeoutMs: 600_000,
    },
    policy: { authorizedWritePaths: [] },
    plan: { clientTaskKey: 'verify-file', role: 'verifier', plannedAreas: ['agent-host/smoke'] },
    supervisor: { maxAttempts },
  });
}

/**
 * Reconstruct the exact pre-restart durable state of the canonical run:
 *   run = running, implementer = passed, verifier = running, verifier Attempt 1 =
 *   running and owned by the OLD (previous) Host instance.
 */
function seedInterruptedVerifierRun(
  store: OrchestrationStore,
  runId: string,
  verifierMaxAttempts = 3,
): { runId: string; implTaskId: string; verifierTaskId: string; verifierAttempt1Id: string } {
  const implTaskId = `${runId}:create-file`;
  const verifierTaskId = `${runId}:verify-file`;
  const implAttemptId = `${runId}:create-file:att-1`;
  const verifierAttempt1Id = `${runId}:verify-file:att-1`;

  store.createRun({ runId, title: 'Create and verify a smoke file.', goal: 'objective text' });
  store.createTask({ taskId: implTaskId, runId, title: 'Create the file', goal: 'goal', position: 0, spec: taskControlSpec() as never });
  store.createTask({ taskId: verifierTaskId, runId, title: 'Verify the file', goal: 'verify', position: 1, spec: verifierSpecWithBudget(verifierMaxAttempts) as never });
  store.addDependency(verifierTaskId, implTaskId);

  // Run is in-flight.
  store.transitionRun(runId, 'running');

  // Implementer already PASSED (its Attempt is terminal — recovery must not touch it).
  store.createAttempt({ attemptId: implAttemptId, taskId: implTaskId, hostInstanceId: OLD_HOST });
  store.transitionAttempt(implAttemptId, 'passed');
  store.transitionTask(implTaskId, 'passed');

  // Verifier RUNNING with a still-running Attempt owned by the OLD Host — this is the
  // Attempt the previous Host was mid-executing when it died.
  store.createAttempt({ attemptId: verifierAttempt1Id, taskId: verifierTaskId, hostInstanceId: OLD_HOST });

  return { runId, implTaskId, verifierTaskId, verifierAttempt1Id };
}

/** A fake ExecutionPort that records each invocation and terminalizes the Attempt. */
function recordingPort(store: OrchestrationStore, terminal: 'passed' | 'failed' = 'passed') {
  const executions: Array<{ taskId: string; attemptId: string; ordinal: number; hostInstanceId: string }> = [];
  const port = {
    execute: async (ctx: AttemptExecutionContext) => {
      executions.push({ taskId: ctx.taskId, attemptId: ctx.attemptId, ordinal: ctx.attemptOrdinal, hostInstanceId: ctx.hostInstanceId });
      store.transitionAttempt(ctx.attemptId, terminal);
    },
  };
  return { executions, port: port as unknown as ProductionExecutionPort };
}

/**
 * driveRunToCompletion never invokes the control plane directly — SAFE snapshots go
 * through the injected publishSnapshot — so a bare stub is sufficient here.
 */
function stubControlPlane(): ControlPlane {
  return {} as unknown as ControlPlane;
}

/** Capture the SAFE snapshots (run status only) that resume would publish. */
function capturingPublisher(store: OrchestrationStore) {
  const published: Array<{ runId: string; status: string }> = [];
  const rawSnapshots: string[] = [];
  const publishSnapshot = async (runId: string): Promise<void> => {
    const snapshot = buildRunSnapshot({ store, runId, verification: null });
    if (snapshot) {
      published.push({ runId: snapshot.run.runId, status: snapshot.run.status });
      rawSnapshots.push(JSON.stringify(snapshot));
    }
  };
  return { published, rawSnapshots, publishSnapshot };
}

test('RESUMABLE_RUN_STATUSES_SET resumes only pending and running (never paused/terminal)', () => {
  assert.ok(RESUMABLE_RUN_STATUSES_SET.has('pending'));
  assert.ok(RESUMABLE_RUN_STATUSES_SET.has('running'));
  for (const status of ['paused', 'completed', 'failed', 'cancelled']) {
    assert.ok(!RESUMABLE_RUN_STATUSES_SET.has(status), `${status} must never be auto-resumed`);
  }
});

test('restart resume: interrupted verifier Run is recovered, driven, retried by the Supervisor alone, and re-snapshotted', async () => {
  await withStore(async (store) => {
    const runId = 'run-restart-A';
    const seeded = seedInterruptedVerifierRun(store, runId, 3);

    // (1) Startup stale-Attempt recovery — mirrors worker.ts recoverInterruptedAttempts.
    recoverInterruptedAttempts(store, NEW_HOST);

    // Pre-fix bug reproduction: recovery interrupted the Attempt, but nothing has yet
    // driven the Run — the verifier Task is abandoned (running Task, terminal latest
    // Attempt, no reconciliation, no fresh snapshot).
    assert.equal(store.getAttempt(seeded.verifierAttempt1Id)?.status, 'interrupted', 'Attempt 1 interrupted via existing recovery');
    assert.equal(store.getRun(runId)?.status, 'running', 'Run not yet driven');
    assert.equal(store.getTask(seeded.verifierTaskId)?.status, 'running', 'verifier abandoned before resume');
    assert.equal(store.listAttempts(seeded.verifierTaskId).length, 1, 'no next Attempt yet — nobody drove the Run');

    // (2) The fix: hand every still-resumable Run back to the EXISTING Supervisor loop.
    const { executions, port } = recordingPort(store, 'passed');
    const { published, rawSnapshots, publishSnapshot } = capturingPublisher(store);

    const result = await resumeResumableRuns({
      store,
      controlPlane: stubControlPlane(),
      executionPort: port,
      hostInstanceId: NEW_HOST,
      publishSnapshot,
      tickIntervalMs: 0,
    });

    // The EXISTING Run was actually driven — no new/duplicate Run was created.
    assert.deepEqual(result.resumedRunIds, [runId]);
    assert.equal(store.listRuns().length, 1, 'no duplicate Run');
    assert.equal(store.getRun(runId)?.status, 'completed', 'Run driven to completion');

    // The verifier Task was NOT abandoned — reconciled, retried, and passed.
    assert.equal(store.getTask(seeded.verifierTaskId)?.status, 'passed');

    // Existing retry budget honored + the Supervisor ALONE created the next Attempt.
    const verifierAttempts = store.listAttempts(seeded.verifierTaskId);
    assert.deepEqual(verifierAttempts.map((a) => a.ordinal), [1, 2], 'exactly one next Attempt — no duplicate same-ordinal Attempt');
    assert.equal(verifierAttempts[0].status, 'interrupted');
    assert.equal(verifierAttempts[1].status, 'passed');
    assert.equal(verifierAttempts[1].hostInstanceId, NEW_HOST, 'the retry Attempt is owned by the NEW live Host');

    // The execution port ran exactly once — for the Supervisor-created retry Attempt
    // (ordinal 2) under the new Host. resumeResumableRuns creates nothing itself.
    assert.equal(executions.length, 1);
    assert.equal(executions[0].ordinal, 2);
    assert.equal(executions[0].taskId, seeded.verifierTaskId);
    assert.equal(executions[0].hostInstanceId, NEW_HOST);

    // A FRESH safe snapshot was published and the LAST one shows the new terminal
    // state — the browser can no longer be stuck on the pre-restart snapshot.
    assert.ok(published.length >= 1, 'fresh snapshot published on resume');
    assert.equal(published[published.length - 1].status, 'completed');
    assert.ok(published.some((p) => p.status === 'completed'));
    // The safe snapshot never leaks the verifier prompt.
    assert.ok(!rawSnapshots.some((s) => s.includes('SECRET VERIFIER PROMPT')), 'snapshot must never publish the prompt');
  });
});

test('restart resume: budget-exhausted interrupted verifier fails cleanly (no infinite retry)', async () => {
  await withStore(async (store) => {
    const runId = 'run-restart-A2';
    // maxAttempts = 1: the single Attempt was interrupted, so the retry budget is spent.
    const seeded = seedInterruptedVerifierRun(store, runId, 1);
    recoverInterruptedAttempts(store, NEW_HOST);

    const { executions, port } = recordingPort(store, 'passed');
    const { published, publishSnapshot } = capturingPublisher(store);

    const result = await resumeResumableRuns({
      store,
      controlPlane: stubControlPlane(),
      executionPort: port,
      hostInstanceId: NEW_HOST,
      publishSnapshot,
      tickIntervalMs: 0,
    });

    assert.deepEqual(result.resumedRunIds, [runId]);
    // Budget spent → verifier fails → Run fails cleanly. No retry Attempt is created,
    // the port is never invoked, and there is no duplicate same-ordinal Attempt.
    assert.equal(store.getTask(seeded.verifierTaskId)?.status, 'failed');
    assert.equal(store.getRun(runId)?.status, 'failed');
    assert.deepEqual(store.listAttempts(seeded.verifierTaskId).map((a) => a.ordinal), [1]);
    assert.equal(executions.length, 0, 'no re-execution when the retry budget is exhausted');
    assert.equal(published[published.length - 1].status, 'failed', 'fresh terminal snapshot published');
  });
});

test('restart resume: a paused Run is never executed or auto-resumed', async () => {
  await withStore(async (store) => {
    const runId = 'run-paused-B';
    const taskId = `${runId}:t`;
    store.createRun({ runId, title: 'Paused run', goal: 'g' });
    store.createTask({ taskId, runId, title: 'A ready task', goal: 'g', spec: taskControlSpec() as never });
    // Drive to a human-gated paused state (pending -> running -> paused).
    store.transitionRun(runId, 'running');
    store.transitionRun(runId, 'paused');

    const { executions, port } = recordingPort(store, 'passed');
    const { published, publishSnapshot } = capturingPublisher(store);

    const result = await resumeResumableRuns({
      store,
      controlPlane: stubControlPlane(),
      executionPort: port,
      hostInstanceId: NEW_HOST,
      publishSnapshot,
      tickIntervalMs: 0,
    });

    assert.deepEqual(result.resumedRunIds, [], 'paused Run is not resumed');
    assert.equal(store.getRun(runId)?.status, 'paused', 'paused Run stays paused');
    assert.equal(store.listAttempts(taskId).length, 0, 'no Attempt created for a paused Run');
    assert.equal(executions.length, 0, 'the execution port is never invoked for a paused Run');
    assert.equal(published.length, 0, 'no snapshot churn for a Run that is not resumed');
  });
});

test('restart resume: terminal Runs (completed/failed/cancelled) are never executed', async () => {
  await withStore(async (store) => {
    // completed
    store.createRun({ runId: 'run-done', title: 'done', goal: 'g' });
    store.createTask({ taskId: 'run-done:t', runId: 'run-done', title: 'task', goal: 'g', spec: taskControlSpec() as never });
    store.transitionRun('run-done', 'running');
    store.transitionRun('run-done', 'completed');
    // failed
    store.createRun({ runId: 'run-fail', title: 'fail', goal: 'g' });
    store.createTask({ taskId: 'run-fail:t', runId: 'run-fail', title: 'task', goal: 'g', spec: taskControlSpec() as never });
    store.transitionRun('run-fail', 'running');
    store.transitionRun('run-fail', 'failed');
    // cancelled
    store.createRun({ runId: 'run-cancel', title: 'cancel', goal: 'g' });
    store.createTask({ taskId: 'run-cancel:t', runId: 'run-cancel', title: 'task', goal: 'g', spec: taskControlSpec() as never });
    store.transitionRun('run-cancel', 'cancelled');

    const { executions, port } = recordingPort(store, 'passed');
    const { published, publishSnapshot } = capturingPublisher(store);

    const result = await resumeResumableRuns({
      store,
      controlPlane: stubControlPlane(),
      executionPort: port,
      hostInstanceId: NEW_HOST,
      publishSnapshot,
      tickIntervalMs: 0,
    });

    assert.deepEqual(result.resumedRunIds, [], 'no terminal Run is resumed');
    assert.equal(executions.length, 0, 'no terminal Run is executed');
    assert.equal(published.length, 0);
    assert.equal(store.getRun('run-done')?.status, 'completed');
    assert.equal(store.getRun('run-fail')?.status, 'failed');
    assert.equal(store.getRun('run-cancel')?.status, 'cancelled');
    for (const taskId of ['run-done:t', 'run-fail:t', 'run-cancel:t']) {
      assert.equal(store.listAttempts(taskId).length, 0, `${taskId} must not have been executed`);
    }
  });
});

test('restart resume: repeated startup recovery is idempotent (no duplicate execution)', async () => {
  await withStore(async (store) => {
    const runId = 'run-idem-D';
    const seeded = seedInterruptedVerifierRun(store, runId, 3);
    recoverInterruptedAttempts(store, NEW_HOST);

    const { executions, port } = recordingPort(store, 'passed');
    const { published, publishSnapshot } = capturingPublisher(store);

    // First startup recovery drives the Run to completion (one retry execution).
    const first = await resumeResumableRuns({
      store, controlPlane: stubControlPlane(), executionPort: port,
      hostInstanceId: NEW_HOST, publishSnapshot, tickIntervalMs: 0,
    });
    assert.deepEqual(first.resumedRunIds, [runId]);
    assert.equal(store.getRun(runId)?.status, 'completed');
    assert.equal(executions.length, 1);
    assert.deepEqual(store.listAttempts(seeded.verifierTaskId).map((a) => a.ordinal), [1, 2]);
    const publishedAfterFirst = published.length;

    // A second startup recovery (host restarts again) must NOT re-drive the now-terminal
    // Run: no new execution, no new Attempt, no snapshot churn.
    const second = await resumeResumableRuns({
      store, controlPlane: stubControlPlane(), executionPort: port,
      hostInstanceId: NEW_HOST, publishSnapshot, tickIntervalMs: 0,
    });
    assert.deepEqual(second.resumedRunIds, [], 'terminal Run is not resumed a second time');
    assert.equal(executions.length, 1, 'no duplicate execution on repeated recovery');
    assert.deepEqual(store.listAttempts(seeded.verifierTaskId).map((a) => a.ordinal), [1, 2], 'no duplicate Attempt on repeated recovery');
    assert.equal(store.getRun(runId)?.status, 'completed');
    assert.equal(published.length, publishedAfterFirst, 'no snapshot churn on a no-op second recovery');
  });
});

/* -------------------------------------------------------------------------- */
/* Startup snapshot refresh (§ live-presence) — recovery republishes a snapshot  */
/* -------------------------------------------------------------------------- */

test('restart resume: startup recovery publishes a FRESH snapshot for an existing running Run (browser leaves the pre-restart snapshot)', async () => {
  await withStore(async (store) => {
    const runId = 'run-snap-refresh';
    const seeded = seedInterruptedVerifierRun(store, runId, 3);
    recoverInterruptedAttempts(store, NEW_HOST);

    const { port } = recordingPort(store, 'passed');
    const { published, publishSnapshot } = capturingPublisher(store);

    // Before recovery drives the Run, THIS host has published nothing: the browser
    // would still be showing the previous Host's pre-restart snapshot.
    assert.equal(published.length, 0);

    await resumeResumableRuns({
      store,
      controlPlane: stubControlPlane(),
      executionPort: port,
      hostInstanceId: NEW_HOST,
      publishSnapshot,
      tickIntervalMs: 0,
    });

    // Startup recovery republished a FRESH snapshot for the SAME existing Run — first
    // while it was still running (reconciling the interrupted verifier Attempt), then
    // as its state advanced. The browser can no longer be stuck on the old snapshot.
    assert.ok(published.length >= 1, 'startup recovery must publish a fresh snapshot for the existing Run');
    assert.ok(published.every((snap) => snap.runId === runId), 'only the recovered Run is (re)published');
    assert.equal(published[0].status, 'running', 'the first fresh snapshot is published while the Run is still running');
    assert.equal(published[published.length - 1].status, 'completed', 'the final fresh snapshot reflects the advanced state');
  });
});
