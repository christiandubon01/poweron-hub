/**
 * ATB-5: Scope Pack contract, import, reconciliation, create_plan binding,
 * audit phase, and inheritance. Fakes only — no live model calls.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { openOrchestrationStore } from '../lib/store.ts';
import { parseCreatePlanPayload, buildVerifierPrompt } from './planning.ts';
import { validatePlan as validatePlanDirect, ROLE_TO_PERMISSION_PROFILE } from './types.ts';
import {
  applyReconciliation,
  assertNoRawSource,
  buildScopePackApprovalGate,
  buildScopePackSignal,
  deriveReconciliationState,
  extractDoNotTouchPaths,
  extractPathLikeBoundary,
  inheritScopePackConstraints,
  inspectHistoricalCheckpoint,
  mapArchitectVerdict,
  IMPORT_SCOPE_PACK_MAX_PAYLOAD_BYTES,
  materializeImportedPack,
  parseCreatePlanScopePackFields,
  parseImportScopePackPayload,
  resolveScopePackForPlan,
  type ClaimReconciliation,
  type ScopePackContract,
  type ScopePackStore,
} from './scopePack.ts';
import { handleApprovePlan, handleCreatePlan, handleImportScopePack } from './worker.ts';
import type { ClaimedControlRequest, ControlPlane } from './supabaseControl.ts';

const ORG = '11111111-1111-1111-1111-111111111111';
const REPO = '0123456789abcdef';
const HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function draft(overrides: Record<string, unknown> = {}) {
  return {
    title: 'PowerOn QuickBooks Online',
    sourceFilename: 'qbo-handoff.md',
    sourceHash: HASH,
    historicalCheckpoint: '9f3c2ab',
    intent: 'PowerOn remains the operational and financial source of truth.',
    foundationClaims: [
      'PowerOn is the operational/financial source of truth',
      'QuickBooks is the accounting destination only',
      'No silent QuickBooks create/update',
    ],
    lockedRules: [
      'No silent QuickBooks create/update',
      'No automatic customer creation/linking',
      'AI cannot silently alter financial fields',
    ],
    doNotTouch: ['Historical Payments', 'src/store/authStore.ts', "Don't change authentication"],
    roadmapPhases: [
      { id: 'QBO-4B0', title: 'QBO-4B0 — Open Estimates Truth Audit', goal: 'NO IMPLEMENTATION. Read-only audit.', executionIntent: 'audit' },
      { id: 'QBO-4B1', title: 'QBO-4B1 — Mapping review', goal: 'Review mappings.', executionIntent: 'implementation' },
    ],
    currentPhaseId: 'QBO-4B0',
    acceptanceCriteria: ['Owner-visible runtime verification required'],
    runtimeAcceptanceRequired: true,
    ownerDecisions: ['Phased roadmap begins with a READ-ONLY truth audit'],
    supersededDecisions: [],
    knownRisks: ['Historical claims may have drifted'],
    relatedAppAreas: [],
    ...overrides,
  };
}

function packFromDraft(): ScopePackContract {
  const parsed = parseImportScopePackPayload(draft());
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  return materializeImportedPack({
    draft: parsed.draft,
    orgId: ORG,
    repoKey: REPO,
    sourceRequestId: 'req-import-1',
    now: '2026-09-22T00:00:00.000Z',
  });
}

class FakePackPlane {
  readonly completions: Array<{ id: string; result?: Record<string, unknown>; error?: string }> = [];
  readonly packs = new Map<string, ScopePackContract>();
  readonly byHash = new Map<string, string>();
  readonly byRequest = new Map<string, string>();
  checkoutInvoked = false;

  async completeRequest(id: string, result: Record<string, unknown>): Promise<void> {
    this.completions.push({ id, result });
  }
  async failRequest(id: string, safeError: string): Promise<void> {
    this.completions.push({ id, error: safeError });
  }
  async findPlanByPlanId(planId: string): Promise<{ result: Record<string, unknown> } | null> {
    const created = this.completions.find((item) => item.result && item.result.planId === planId);
    return created?.result ? { result: created.result } : null;
  }
  async findScopePackById(packId: string): Promise<ScopePackContract | null> {
    return this.packs.get(packId) ?? null;
  }
  async findScopePackBySourceHash(sourceHash: string): Promise<ScopePackContract | null> {
    const id = this.byHash.get(sourceHash);
    return id ? this.packs.get(id) ?? null : null;
  }
  async findScopePackBySourceRequestId(sourceRequestId: string): Promise<ScopePackContract | null> {
    const id = this.byRequest.get(sourceRequestId);
    return id ? this.packs.get(id) ?? null : null;
  }
  async insertScopePack(pack: ScopePackContract, sourceRequestId: string): Promise<ScopePackContract> {
    const existing = this.byRequest.get(sourceRequestId);
    if (existing) return this.packs.get(existing)!;
    this.packs.set(pack.packId, pack);
    this.byHash.set(pack.sourceHash, pack.packId);
    this.byRequest.set(sourceRequestId, pack.packId);
    return pack;
  }
  async updateScopePackReconciliation(pack: ScopePackContract): Promise<void> {
    this.packs.set(pack.packId, pack);
  }
  async updateScopePackCurrentPhase(packId: string, phaseId: string): Promise<void> {
    const pack = this.packs.get(packId);
    if (pack) this.packs.set(packId, { ...pack, currentPhaseId: phaseId });
  }
  asControlPlane(): ControlPlane & ScopePackStore {
    return this as unknown as ControlPlane & ScopePackStore;
  }
}

function claimed(payload: Record<string, unknown>, type: ClaimedControlRequest['request_type'] = 'create_plan'): ClaimedControlRequest {
  return {
    id: 'req-1',
    repo_key: REPO,
    request_type: type,
    client_request_id: 'client-req-1',
    payload,
    status: 'claimed',
    created_at: '2026-09-22T00:00:00.000Z',
  };
}

test('ATB-5 import payload rejects raw source, paths, and oversized lists', () => {
  assert.ok(!parseImportScopePackPayload({ ...draft(), rawText: 'SECRET' }).ok);
  assert.ok(!parseImportScopePackPayload({ ...draft(), sourceFilename: 'C:\\\\Users\\\\chris\\\\handoff.md' }).ok);
  assert.ok(!parseImportScopePackPayload({ ...draft(), sourceFilename: '/tmp/handoff.md' }).ok);
  assert.ok(!parseImportScopePackPayload({ ...draft(), sourceHash: 'abc' }).ok);
  assert.ok(!parseImportScopePackPayload({ ...draft(), lockedRules: Array.from({ length: 40 }, () => 'rule') }).ok);
  assert.ok(!parseImportScopePackPayload({ ...draft(), title: 'x'.repeat(200) }).ok);
  const parsed = parseImportScopePackPayload(draft());
  assert.ok(parsed.ok);
  assert.equal(assertNoRawSource(parsed.draft).length, 0);
  assert.equal(parsed.ok && parsed.draft.ownerDecisions[0], 'Phased roadmap begins with a READ-ONLY truth audit');
});

test('ATB-7A1 import payload rejects unknown, raw, nested, and oversized fields', () => {
  assert.equal(parseImportScopePackPayload({ ...draft(), rawText: 'SECRET' }).ok, false);
  assert.equal(parseImportScopePackPayload({ ...draft(), contents: 'SECRET' }).ok, false);
  assert.equal(parseImportScopePackPayload({ ...draft(), localPath: 'C:\\\\handoff.md' }).ok, false);
  assert.equal(parseImportScopePackPayload({ ...draft(), filePath: 'C:\\\\handoff.md' }).ok, false);
  assert.equal(parseImportScopePackPayload({ ...draft(), rawSource: 'SECRET' }).ok, false);
  assert.equal(parseImportScopePackPayload({ ...draft(), content: 'SECRET' }).ok, false);
  assert.equal(parseImportScopePackPayload({ ...draft(), fileContents: 'SECRET' }).ok, false);
  assert.equal(parseImportScopePackPayload({ ...draft(), absolutePath: 'C:\\\\handoff.md' }).ok, false);
  assert.equal(parseImportScopePackPayload({ ...draft(), extraNote: 'nope' }).ok, false);
  assert.equal(parseImportScopePackPayload({ ...draft(), draft: { title: 'nested' } }).ok, false);
  assert.equal(parseImportScopePackPayload({ ...draft(), contract: { title: 'nested' } }).ok, false);
  assert.equal(parseImportScopePackPayload({ ...draft(), pack: { raw: true } }).ok, false);
  const phase = draft().roadmapPhases[0] as Record<string, unknown>;
  assert.equal(parseImportScopePackPayload({
    ...draft(),
    roadmapPhases: [{ ...phase, contents: 'nested dump' }],
  }).ok, false);
  const oversized = parseImportScopePackPayload({ ...draft(), intent: 'x'.repeat(IMPORT_SCOPE_PACK_MAX_PAYLOAD_BYTES) });
  assert.equal(oversized.ok, false);
  assert.equal(oversized.ok ? '' : oversized.code, 'PAYLOAD_TOO_LARGE');
  assert.ok(IMPORT_SCOPE_PACK_MAX_PAYLOAD_BYTES < 256 * 1024);
});

test('ATB-5 path-like do-not-touch extraction does not guess prose', () => {
  assert.equal(extractPathLikeBoundary('src/store/authStore.ts'), 'src/store/authStore.ts');
  assert.equal(extractPathLikeBoundary("Don't change authentication"), null);
  assert.equal(extractPathLikeBoundary('Historical Payments'), null);
  assert.deepEqual(extractDoNotTouchPaths(['src/store/authStore.ts', "Don't change authentication"]), ['src/store/authStore.ts']);
});

test('ATB-5 reconciliation aggregation and Architect verdicts', () => {
  const claims = (states: Array<ClaimReconciliation['state']>) => states.map((state, index) => ({
    claimId: `claim-${index + 1}`,
    claim: 'x',
    state,
    evidenceRefs: ['src/a.ts'],
    reconciliationSummary: state,
  }));
  assert.equal(deriveReconciliationState(claims(['CURRENT', 'CURRENT'])), 'current');
  assert.equal(deriveReconciliationState(claims(['CURRENT', 'STALE'])), 'stale');
  assert.equal(deriveReconciliationState(claims(['STALE', 'CONFLICT'])), 'conflict');
  assert.equal(deriveReconciliationState(claims(['CURRENT', 'UNVERIFIED'])), 'unverified');
  assert.equal(mapArchitectVerdict('current').state, 'CONTINUE');
  assert.equal(mapArchitectVerdict('stale').state, 'WATCH');
  assert.equal(mapArchitectVerdict('conflict').state, 'NEEDS_OWNER');
  assert.equal(mapArchitectVerdict('unverified').state, 'WATCH');
  const stale = buildScopePackSignal({ packId: 'p1', reconciliationState: 'stale', title: 'QBO' });
  assert.ok(stale);
  assert.equal(stale.category, 'scope-pack-stale');
  assert.equal(stale.severity, 'warning');
  assert.equal(stale.ownerActionRequired, false);
  const conflict = buildScopePackSignal({ packId: 'p1', reconciliationState: 'conflict', title: 'QBO' });
  assert.ok(conflict);
  assert.equal(conflict.ownerActionRequired, true);
  assert.equal(conflict.severity, 'critical');
});

test('ATB-5 historical checkpoint inspection never mutates checkout', async () => {
  const invoked: string[][] = [];
  const result = await inspectHistoricalCheckpoint({
    checkpoint: '9f3c2ab',
    runGit: async (args) => {
      invoked.push([...args]);
      if (args[0] === 'rev-parse') return '9f3c2abeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\n';
      return '9f3c2ab checkpoint message\n';
    },
  });
  assert.equal(result.exists, true);
  assert.match(result.summary, /context only/);
  assert.ok(invoked.every((args) => !args.includes('checkout') && !args.includes('reset') && !args.includes('switch')));
});

test('ATB-5 create_plan without Scope Pack is unchanged', () => {
  const parsed = parseCreatePlanPayload({ scope: 'Create a smoke file.', constraints: [] });
  assert.ok(parsed.ok);
  assert.equal(parsed.payload.scopePackId, undefined);
  assert.equal(parseCreatePlanScopePackFields({}).ok, true);
});

test('ATB-5 create_plan Scope Pack fields reject incomplete / mismatched bindings', () => {
  assert.ok(!parseCreatePlanPayload({ scope: 'x', scopePackId: 'p1' }).ok);
  assert.ok(!parseCreatePlanPayload({ scope: 'x', scopePackId: 'p1', scopePackVersion: 1 }).ok);
  const ok = parseCreatePlanPayload({ scope: 'x', scopePackId: 'p1', scopePackVersion: 1, scopePackPhaseId: 'QBO-4B0' });
  assert.ok(ok.ok);
  const pack = packFromDraft();
  assert.equal(resolveScopePackForPlan({ pack, orgId: 'other', repoKey: REPO, version: 1, phaseId: 'QBO-4B0' }).ok, false);
  assert.equal(resolveScopePackForPlan({ pack, orgId: ORG, repoKey: 'ffffffffffffffff', version: 1, phaseId: 'QBO-4B0' }).ok, false);
  assert.equal(resolveScopePackForPlan({ pack, orgId: ORG, repoKey: REPO, version: 2, phaseId: 'QBO-4B0' }).ok, false);
  assert.equal(resolveScopePackForPlan({ pack, orgId: ORG, repoKey: REPO, version: 1, phaseId: 'missing' }).ok, false);
  assert.ok(resolveScopePackForPlan({ pack, orgId: ORG, repoKey: REPO, version: 1, phaseId: 'QBO-4B0' }).ok);
});

test('ATB-5 import is idempotent and warns on duplicate hash', async () => {
  const plane = new FakePackPlane();
  await handleImportScopePack({
    controlPlane: plane.asControlPlane(),
    request: claimed(draft(), 'import_scope_pack'),
    organizationId: ORG,
    now: '2026-09-22T00:00:00.000Z',
  });
  await handleImportScopePack({
    controlPlane: plane.asControlPlane(),
    request: claimed(draft(), 'import_scope_pack'),
    organizationId: ORG,
  });
  assert.equal(plane.packs.size, 1);
  assert.equal(plane.completions[1].result?.idempotent, true);

  const second = new FakePackPlane();
  const firstPack = packFromDraft();
  await second.insertScopePack(firstPack, 'other-req');
  second.byHash.set(HASH, firstPack.packId);
  await handleImportScopePack({
    controlPlane: second.asControlPlane(),
    request: claimed(draft(), 'import_scope_pack'),
    organizationId: ORG,
  });
  assert.equal(second.completions[0].result?.duplicate, true);
  assert.equal(second.packs.size, 1);
});

test('ATB-5 QBO-4B0 audit phase completes without Implementer or write profile', async () => {
  const plane = new FakePackPlane();
  const created = packFromDraft();
  await plane.insertScopePack(created, 'seed');
  const storeDir = await mkdtemp(path.join(os.tmpdir(), 'atb5-audit-'));
  try {
    const store = openOrchestrationStore({
      dbPath: path.join(storeDir, 'orch.sqlite'),
      repoKey: REPO,
      hostId: 'host-1',
      hostVersion: '0.1.0',
    });
    await handleCreatePlan({
      store,
      registry: new Map() as never,
      controlPlane: plane.asControlPlane(),
      request: claimed({
        scope: 'Reconcile the QBO handoff against the current repo.',
        constraints: [],
        scopePackId: created.packId,
        scopePackVersion: 1,
        scopePackPhaseId: 'QBO-4B0',
      }),
      canonicalRepoPath: storeDir,
      organizationId: ORG,
      reconcileFoundation: async ({ pack }) => pack.foundationClaims.map((claim) => ({
        claimId: claim.claimId,
        state: 'CURRENT',
        reconciliationSummary: 'Current repo supports the claim.',
        evidenceRefs: ['src/features/control-tower'],
      })),
      inspectCheckpoint: async () => ({ exists: true, summary: 'Historical commit exists as context only.' }),
    });
    const result = plane.completions[0].result ?? {};
    assert.equal((result.plan as Record<string, unknown>).executionIntent, 'audit');
    assert.deepEqual((result.plan as Record<string, unknown>).tasks, []);
    assert.equal((result.architectVerdict as Record<string, unknown>).state, 'CONTINUE');
    const approval = await handleApprovePlan({
      store,
      controlPlane: plane.asControlPlane(),
      request: claimed({ planId: result.planId, planHash: result.planHash }, 'approve_plan'),
      canonicalRepoPath: storeDir,
    });
    assert.equal(approval.ok, true);
    assert.equal(approval.runId, null);
    assert.equal(store.listRuns().length, 0);
    store.close();
  } finally {
    await rm(storeDir, { recursive: true, force: true });
  }
});

test('ATB-5 create_plan inherits locked rules and blocks conflict approval', async () => {
  const plane = new FakePackPlane();
  const created = packFromDraft();
  await plane.insertScopePack(created, 'seed');
  const storeDir = await mkdtemp(path.join(os.tmpdir(), 'atb5-plan-'));
  try {
    const store = openOrchestrationStore({
      dbPath: path.join(storeDir, 'orch.sqlite'),
      repoKey: REPO,
      hostId: 'host-1',
      hostVersion: '0.1.0',
    });
    const architect = {
      execute: async () => ({
        executionId: 'exec-1',
        process: { exitCode: 0, signal: null, timedOut: false, cancelled: false },
        provider: { terminalState: 'completed', success: true },
        output: { finalText: JSON.stringify({
          objective: 'Implement mapping review.',
          constraints: [],
          riskSummary: null,
          tasks: [
            {
              clientTaskKey: 'implement-mapping',
              title: 'Mapping',
              goal: 'Review mappings only.',
              role: 'implementer',
              dependencies: [],
              permissionProfile: ROLE_TO_PERMISSION_PROFILE.implementer,
              authorizedWritePaths: ['src/features/control-tower/scopePack.ts'],
              plannedAreas: ['src/features/control-tower'],
              validationRequirements: ['Keep QuickBooks destination-only'],
              provider: 'claude',
              requestedModel: null,
            },
            {
              clientTaskKey: 'verify-mapping',
              title: 'Verify',
              goal: 'Verify locked rules.',
              role: 'verifier',
              dependencies: ['implement-mapping'],
              permissionProfile: ROLE_TO_PERMISSION_PROFILE.verifier,
              authorizedWritePaths: [],
              plannedAreas: ['src/features/control-tower'],
              validationRequirements: ['Owner-visible runtime verification required'],
              provider: 'claude',
              requestedModel: null,
            },
          ],
        }) },
        model: { requestedModel: null, reportedModel: 'fake', reportedModelSource: 'test' },
        usage: { source: 'none' },
        session: {},
      }),
    };
    await handleCreatePlan({
      store,
      registry: new Map([['claude', architect as never]]) as never,
      controlPlane: plane.asControlPlane(),
      request: claimed({
        scope: 'Continue QBO-4B1.',
        constraints: ['Do not commit.'],
        scopePackId: created.packId,
        scopePackVersion: 1,
        scopePackPhaseId: 'QBO-4B1',
      }),
      canonicalRepoPath: storeDir,
      organizationId: ORG,
      reconcileFoundation: async ({ pack }) => pack.foundationClaims.map((claim) => ({
        claimId: claim.claimId,
        state: 'CONFLICT',
        reconciliationSummary: 'Current repo contradicts this claim.',
        evidenceRefs: ['src/lib/supabase.ts'],
      })),
    });
    const result = plane.completions[0].result ?? {};
    const plan = result.plan as { constraints: string[]; tasks: Array<{ validationRequirements: string[] }>; scopePack: { phaseId: string } };
    assert.ok(plan.constraints.some((item) => item.includes('LOCKED:')));
    assert.ok(plan.constraints.some((item) => item.includes('DO_NOT_TOUCH:')));
    assert.ok(plan.tasks[1].validationRequirements.some((item) => /runtime verification/i.test(item)));
    assert.equal(plan.scopePack.phaseId, 'QBO-4B1');
    assert.equal((result.approval as { requiresOwnerReview: boolean }).requiresOwnerReview, true);
    assert.equal((result.scopePackSignal as { ownerActionRequired: boolean }).ownerActionRequired, true);
    const blocked = await handleApprovePlan({
      store,
      controlPlane: plane.asControlPlane(),
      request: claimed({ planId: result.planId, planHash: result.planHash }, 'approve_plan'),
      canonicalRepoPath: storeDir,
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.safeError, 'SCOPE_PACK_CONFLICT');
    assert.equal(store.listRuns().length, 0);
    store.close();
  } finally {
    await rm(storeDir, { recursive: true, force: true });
  }
});

test('ATB-5 stale requires acknowledgment; version is not incremented by reconciliation', () => {
  const created = packFromDraft();
  const reconciled = applyReconciliation(created, created.foundationClaims.map((claim) => ({
    claimId: claim.claimId,
    state: 'STALE',
    reconciliationSummary: 'Moved on.',
    evidenceRefs: ['src/a.ts'],
  })), '2026-09-22T01:00:00.000Z');
  assert.equal(reconciled.version, created.version);
  assert.equal(reconciled.reconciliationState, 'stale');
  assert.equal(reconciled.lastReconciledAt, '2026-09-22T01:00:00.000Z');
  const gate = buildScopePackApprovalGate('stale', 'implementation');
  assert.equal(gate.requiresStaleAcknowledgment, true);
  assert.equal(buildScopePackApprovalGate('stale', 'implementation', { staleAcknowledged: true }).canApproveImplementation, true);
});

test('ATB-5 verifier prompt inherits Scope Pack reference', () => {
  const pack = packFromDraft();
  const inherited = inheritScopePackConstraints({
    ownerConstraints: [],
    pack,
    phase: pack.roadmapPhases[0],
  });
  const plan = {
    planId: 'plan-1',
    objective: 'audit',
    constraints: inherited.constraints,
    tasks: [{
      clientTaskKey: 'verify',
      title: 'Verify',
      goal: 'Check locked rules',
      role: 'verifier' as const,
      dependencies: [],
      permissionProfile: ROLE_TO_PERMISSION_PROFILE.verifier,
      authorizedWritePaths: [],
      plannedAreas: [],
      validationRequirements: inherited.validationRequirements,
      provider: 'claude' as const,
      requestedModel: null,
    }],
    riskSummary: null,
    scopePack: { ...inherited.scopePackRef, reconciliationState: 'current' },
  };
  const prompt = buildVerifierPrompt(plan.tasks[0], plan);
  assert.match(prompt, /SCOPE PACK/);
  assert.match(prompt, /cannot PASS if an applicable locked Scope Pack rule/);
});

test('ATB-5 audit-like validatePlan allows empty tasks and rejects implementer writes', () => {
  const empty = validatePlanDirect({
    planId: 'plan-audit',
    objective: 'Read-only truth audit',
    constraints: [],
    tasks: [],
  }, { executionIntent: 'audit' });
  assert.ok(empty.ok);
  const withImplementer = validatePlanDirect({
    planId: 'plan-audit',
    objective: 'Read-only truth audit',
    constraints: [],
    tasks: [{
      clientTaskKey: 'write',
      title: 'Write',
      goal: 'Write',
      role: 'implementer',
      dependencies: [],
      permissionProfile: ROLE_TO_PERMISSION_PROFILE.implementer,
      authorizedWritePaths: ['src/a.ts'],
      plannedAreas: [],
      validationRequirements: [],
      provider: 'claude',
      requestedModel: null,
    }],
  }, { executionIntent: 'audit' });
  assert.ok(!withImplementer.ok);
  assert.ok(withImplementer.errors.includes('AUDIT_WRITE_FORBIDDEN'));
});
