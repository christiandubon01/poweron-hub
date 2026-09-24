/**
 * CT-CORE-1: The local Agent Host control worker.
 *
 * ONE worker entrypoint (npm: `agent-host:control`) that:
 *   - acquires the same single-host lock as the normal Host,
 *   - writes the local heartbeat file AND publishes the Supabase presence row,
 *   - polls and atomically claims typed control requests (create_plan,
 *     approve_plan, cancel_run) for THIS org + THIS repo only,
 *   - handles create_plan by running the REAL Architect provider turn
 *     (read-only-reviewer profile — it cannot write anything),
 *   - handles approve_plan by creating the REAL Run/Tasks/dependencies through
 *     the existing durable store APIs (never direct table edits) and then
 *     driving the EXISTING supervisorTick loop with the production
 *     ExecutionPort binding over the EXISTING AttemptExecutor,
 *   - publishes a SAFE run snapshot after every tick (§29 whitelist).
 *
 * NO browser→shell path exists: the only request types are the three above.
 * NO auto-apply: generated workspace changes are never applied to canonical
 * main. NO service-credential exposure: the service role key stays in this
 * Node process and is never passed to provider child processes.
 */

import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { composeHostIdentity, createInstanceIdentity, readOrCreateHostId } from '../lib/identity.ts';
import { createEventWriter } from '../lib/events.ts';
import { writeHeartbeat } from '../lib/heartbeat.ts';
import { discoverTools } from '../lib/discovery.ts';
import { acquireLock, LockAcquisitionError, releaseLockIfOwned } from '../lib/lock.ts';
import { readRepoStatus, resolveCanonicalRepo } from '../lib/repo.ts';
import { resolveStatePaths } from '../lib/statePaths.ts';
import { openOrchestrationStore, type OrchestrationStore } from '../lib/store.ts';
import type { JsonValue } from '../lib/orchestrationTypes.ts';
import {
  AttemptExecutor,
  createProviderRegistry,
  recoverInterruptedAttempts,
} from '../providers/executor.ts';
import type { ExecutionRequest, ExecutionResult, ProviderAdapter, ProviderId } from '../providers/types.ts';
import {
  buildProviderCapabilityRegistry,
  parseCodexModelCatalog,
  parseOllamaModelList,
  toSafeProviderFleet,
} from '../providers/capabilityRegistry.ts';
import { buildCmdWrapperCommandLine } from '../providers/processRunner.ts';
import { supervisorTick } from '../supervisor/supervisor.ts';
import { shutdownHostRuntime } from '../index.ts';

import { ControlPlane, type ClaimedControlRequest, type ControlPlaneConfig, resolveControlPlaneConfigFromEnv } from './supabaseControl.ts';
import {
  ARCHITECT_TIMEOUT_MS,
  DEFAULT_TASK_TIMEOUT_MS,
  buildArchitectPrompt,
  buildTaskPrompt,
  extractPlanJsonObject,
  parseArchitectPlan,
  parseCreatePlanPayload,
} from './planning.ts';
import { ProductionExecutionPort } from './supervisorPort.ts';
import { buildRunSnapshot } from './snapshots.ts';
import type { ControlPlan, PlanRole, TaskControlSpec } from './types.ts';
import {
  applyReconciliation,
  buildScopePackApprovalGate,
  buildScopePackArchitectPrompt,
  buildScopePackSignal,
  extractDoNotTouchPaths,
  inheritScopePackConstraints,
  inspectHistoricalCheckpoint,
  isAuditLikeIntent,
  mapArchitectVerdict,
  materializeImportedPack,
  parseClaimReconciliations,
  parseImportScopePackPayload,
  resolveScopePackForPlan,
  type FoundationReconciler,
  type ScopePackContract,
  type ScopePackStore,
} from './scopePack.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
import type { EffortLevel } from '../providers/effort.ts';
import {
  HEARTBEAT_INTERVAL_MS,
  REPO_STATUS_REFRESH_MS,
  SCHEMA_VERSION,
  type HeartbeatDocument,
  type ProviderDiscoveryRecord,
  type RepoStatus,
} from '../types.ts';

export const CLAIM_POLL_INTERVAL_MS = 2_000;
export const SUPERVISOR_TICK_INTERVAL_MS = 1_000;
/**
 * ATB-1B: cadence for the active-run SAFE snapshot heartbeat. While a provider
 * Attempt is awaiting completion inside supervisorTick, this timer republishes
 * the current safe snapshot so the owner keeps seeing fresh state (elapsed time,
 * current role, latest verdict/handoff/signal) instead of waiting for the whole
 * Attempt to return. Observability only — it never drives orchestration.
 */
export const ACTIVE_SNAPSHOT_HEARTBEAT_MS = 4_000;
const PRESENCE_PUBLISH_INTERVAL_MS = HEARTBEAT_INTERVAL_MS;
const ARCHITECT_EXECUTION_PREFIX = 'control-plan';
const REQUEST_ERROR_LIMIT = 1_000;

/* -------------------------------------------------------------------------- */
/* .env.local loader (server-side keys only; never logged, never bundled)      */
/* -------------------------------------------------------------------------- */

export function parseEnvFile(contents: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const equals = line.indexOf('=');
    if (equals <= 0) {
      continue;
    }
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

export async function loadEnvFile(envPath: string): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(envPath, 'utf8');
  } catch {
    return;
  }
  for (const [key, value] of Object.entries(parseEnvFile(raw))) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* ATB-2/ATB-2B: best-effort local model enumeration (Ollama + Codex)          */
/* -------------------------------------------------------------------------- */

const execFileAsync = promisify(execFile);
const OLLAMA_LIST_TIMEOUT_MS = 5_000;
const CODEX_CATALOG_TIMEOUT_MS = 15_000;
const CODEX_CATALOG_MAX_BUFFER = 4 * 1024 * 1024;

export interface CatalogProbeLaunch {
  file: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

/**
 * How a catalog probe is spawned. Codex on Windows is a `.cmd` shim
 * (`codex.cmd`). Node's execFile cannot spawn `.cmd` directly (EINVAL) and
 * that failure used to publish an empty Codex catalog. cmd-wrapper records
 * go through `%COMSPEC% /d /s /c`, the same route discovery uses for
 * `--version`. Native executables (Ollama `.exe`) stay on execFile.
 * shell is never enabled.
 */
export function catalogProbeLaunch(record: ProviderDiscoveryRecord, args: readonly string[]): CatalogProbeLaunch {
  if (!record.resolvedPath) {
    throw new Error('catalog probe requires a resolved path');
  }
  if (record.harnessKind === 'cmd-wrapper') {
    const commandProcessor = process.env.COMSPEC ?? 'cmd.exe';
    const commandLine = buildCmdWrapperCommandLine({
      kind: 'cmd-wrapper',
      executable: record.resolvedPath,
      argv: [...args],
    });
    return {
      file: commandProcessor,
      args: ['/d', '/s', '/c', commandLine],
      windowsVerbatimArguments: true,
    };
  }
  return {
    file: record.resolvedPath,
    args: [...args],
  };
}

export type CatalogProbe = (
  record: ProviderDiscoveryRecord,
  args: readonly string[],
) => Promise<{ stdout: string }>;

async function defaultCatalogProbe(record: ProviderDiscoveryRecord, args: readonly string[]): Promise<{ stdout: string }> {
  const launch = catalogProbeLaunch(record, args);
  const timeout = record.toolId === 'codex-cli' ? CODEX_CATALOG_TIMEOUT_MS : OLLAMA_LIST_TIMEOUT_MS;
  const maxBuffer = record.toolId === 'codex-cli' ? CODEX_CATALOG_MAX_BUFFER : 256 * 1024;
  const { stdout } = await execFileAsync(launch.file, launch.args, {
    windowsHide: true,
    timeout,
    maxBuffer,
    ...(launch.windowsVerbatimArguments ? { windowsVerbatimArguments: true as const } : {}),
  });
  return { stdout };
}

/**
 * Enumerate locally enumerable models, best effort:
 *   - Ollama via `ollama list` (local runtime models);
 *   - Codex via `codex debug models` (ATB-2B: the installed CLI 0.153.4 renders
 *     its raw model catalog as machine-readable JSON — a read-only inspection
 *     command, no inference, no auth mutation).
 * Claude has no enumeration command and is never given invented model names.
 * Any failure (not installed, timeout, unexpected output) yields no models for
 * that provider rather than a startup failure. Resolved paths stay host-side
 * and are never published. Returns model ids by providerId for the capability
 * registry.
 */
export async function enumerateLocalModels(
  discovery: readonly ProviderDiscoveryRecord[],
  runProbe: CatalogProbe = defaultCatalogProbe,
): Promise<Partial<Record<ProviderId, string[]>>> {
  const enumerated: Partial<Record<ProviderId, string[]>> = {};

  const ollama = discovery.find((record) => record.toolId === 'ollama-cli');
  if (ollama?.installed && ollama.resolvedPath) {
    try {
      const { stdout } = await runProbe(ollama, ['list']);
      const models = parseOllamaModelList(stdout);
      if (models.length > 0) {
        enumerated.ollama = models;
      }
    } catch {
      // Best effort only — no enumerated models for Ollama.
    }
  }

  const codex = discovery.find((record) => record.toolId === 'codex-cli');
  if (codex?.installed && codex.resolvedPath) {
    try {
      const { stdout } = await runProbe(codex, ['debug', 'models']);
      const models = parseCodexModelCatalog(stdout);
      if (models.length > 0) {
        enumerated.codex = models;
      }
    } catch {
      // Best effort only — no enumerated models for Codex.
    }
  }

  return enumerated;
}

/* -------------------------------------------------------------------------- */
/* create_plan handler (§13-§17)                                              */
/* -------------------------------------------------------------------------- */

export async function handleImportScopePack(options: {
  controlPlane: ControlPlane & Partial<ScopePackStore>;
  request: ClaimedControlRequest;
  organizationId: string;
  now?: string;
}): Promise<void> {
  const { request, controlPlane } = options;
  const parsed = parseImportScopePackPayload(request.payload);
  if (!parsed.ok) {
    await controlPlane.failRequest(request.id, `${parsed.code}: ${parsed.message}`);
    return;
  }
  const store = controlPlane as ScopePackStore;
  if (!store.findScopePackBySourceRequestId || !store.insertScopePack) {
    await controlPlane.failRequest(request.id, 'SCOPE_PACK_STORE_UNAVAILABLE: Host cannot persist Scope Packs.');
    return;
  }
  const existingByRequest = await store.findScopePackBySourceRequestId(request.client_request_id);
  if (existingByRequest) {
    await controlPlane.completeRequest(request.id, {
      packId: existingByRequest.packId,
      version: existingByRequest.version,
      duplicate: false,
      idempotent: true,
      pack: existingByRequest,
    });
    return;
  }
  const existingByHash = await store.findScopePackBySourceHash(parsed.draft.sourceHash);
  if (existingByHash && !parsed.draft.forceNewVersion) {
    await controlPlane.completeRequest(request.id, {
      packId: existingByHash.packId,
      version: existingByHash.version,
      duplicate: true,
      existingPackId: existingByHash.packId,
      warning: 'This handoff was already imported. A new pack was not created.',
      pack: existingByHash,
    });
    return;
  }
  const now = options.now ?? new Date().toISOString();
  const created = materializeImportedPack({
    draft: parsed.draft,
    orgId: options.organizationId,
    repoKey: request.repo_key,
    sourceRequestId: request.client_request_id,
    now,
  });
  const persisted = await store.insertScopePack(created, request.client_request_id);
  await controlPlane.completeRequest(request.id, {
    packId: persisted.packId,
    version: persisted.version,
    duplicate: false,
    pack: persisted,
  });
}

export async function handleCreatePlan(options: {
  store: OrchestrationStore;
  registry: ReadonlyMap<ProviderId, ProviderAdapter>;
  controlPlane: ControlPlane;
  request: ClaimedControlRequest;
  canonicalRepoPath: string;
  organizationId?: string;
  reconcileFoundation?: FoundationReconciler;
  inspectCheckpoint?: (checkpoint: string) => Promise<{ exists: boolean; summary: string }>;
  now?: string;
}): Promise<void> {
  const { request, controlPlane } = options;

  const parsedPayload = parseCreatePlanPayload(request.payload);
  if (!parsedPayload.ok) {
    await controlPlane.failRequest(request.id, `${parsedPayload.code}: ${parsedPayload.message}`);
    return;
  }
  const payload = parsedPayload.payload;

  let boundPack: ScopePackContract | null = null;
  let inherited: ReturnType<typeof inheritScopePackConstraints> | null = null;
  let architectVerdict: ReturnType<typeof mapArchitectVerdict> | null = null;
  let approvalGate: ReturnType<typeof buildScopePackApprovalGate> | null = null;
  let scopePackSignal: ReturnType<typeof buildScopePackSignal> | null = null;
  const now = options.now ?? new Date().toISOString();

  if (payload.scopePackId && payload.scopePackVersion && payload.scopePackPhaseId) {
    const packStore = controlPlane as ControlPlane & Partial<ScopePackStore>;
    if (!packStore.findScopePackById) {
      await controlPlane.failRequest(request.id, 'SCOPE_PACK_STORE_UNAVAILABLE: Host cannot load Scope Packs.');
      return;
    }
    const loaded = await packStore.findScopePackById(payload.scopePackId);
    if (!loaded) {
      await controlPlane.failRequest(request.id, 'SCOPE_PACK_MISSING: The selected Scope Pack was not found.');
      return;
    }
    const resolved = resolveScopePackForPlan({
      pack: loaded,
      orgId: options.organizationId ?? loaded.orgId,
      repoKey: request.repo_key,
      version: payload.scopePackVersion,
      phaseId: payload.scopePackPhaseId,
    });
    if (!resolved.ok) {
      await controlPlane.failRequest(request.id, `${resolved.code}: ${resolved.message}`);
      return;
    }
    let checkpointNote: string | null = null;
    if (loaded.historicalCheckpoint) {
      if (options.inspectCheckpoint) {
        const inspected = await options.inspectCheckpoint(loaded.historicalCheckpoint);
        checkpointNote = inspected.summary;
      } else {
        const inspected = await inspectHistoricalCheckpoint({
          checkpoint: loaded.historicalCheckpoint,
          runGit: async (args) => {
            const { stdout } = await execFileAsync('git', [...args], {
              cwd: options.canonicalRepoPath,
              windowsHide: true,
              timeout: 8_000,
            });
            return stdout;
          },
        });
        checkpointNote = inspected.summary;
      }
    }
    let claimResults;
    if (options.reconcileFoundation) {
      claimResults = await options.reconcileFoundation({ pack: loaded, phase: resolved.phase, repoPath: options.canonicalRepoPath });
    } else {
      const reconProvider: ProviderId = (payload.requestedRouting?.provider ?? 'claude') as ProviderId;
      const reconAdapter = options.registry.get(reconProvider);
      if (!reconAdapter) {
        await controlPlane.failRequest(request.id, `Provider ${reconProvider} is not installed on this host. Install it and retry.`);
        return;
      }
      const reconResult = await reconAdapter.execute({
        executionId: `${ARCHITECT_EXECUTION_PREFIX}:recon:${request.client_request_id}`,
        attemptId: `${ARCHITECT_EXECUTION_PREFIX}:recon:${request.client_request_id}`,
        taskId: `reconcile:${request.client_request_id}`,
        runId: ARCHITECT_EXECUTION_PREFIX,
        workingDirectory: options.canonicalRepoPath,
        prompt: buildScopePackArchitectPrompt({
          pack: loaded,
          phase: resolved.phase,
          ownerScope: payload.scope,
          ownerConstraints: payload.constraints,
          checkpointNote,
        }),
        requestedModel: payload.requestedRouting?.requestedModel ?? undefined,
        permissionProfile: 'read-only-reviewer',
        timeoutMs: ARCHITECT_TIMEOUT_MS,
      });
      claimResults = parseClaimReconciliations(extractPlanJsonObject(reconResult.output.finalText ?? '') ?? {}, loaded);
    }
    boundPack = applyReconciliation(loaded, claimResults, now);
    boundPack = { ...boundPack, currentPhaseId: resolved.phase.id };
    if (packStore.updateScopePackReconciliation) {
      await packStore.updateScopePackReconciliation(boundPack);
    }
    if (packStore.updateScopePackCurrentPhase) {
      await packStore.updateScopePackCurrentPhase(boundPack.packId, resolved.phase.id);
    }
    inherited = inheritScopePackConstraints({
      ownerConstraints: payload.constraints,
      pack: boundPack,
      phase: resolved.phase,
    });
    architectVerdict = mapArchitectVerdict(boundPack.reconciliationState);
    approvalGate = buildScopePackApprovalGate(boundPack.reconciliationState, resolved.phase.executionIntent, {
      staleAcknowledged: payload.staleAcknowledged === true,
      ownerReviewedConflict: payload.ownerReviewedConflict === true,
    });
    const signal = buildScopePackSignal(boundPack);
    if (signal) {
      signal.firstSeen = now;
      signal.lastSeen = now;
      scopePackSignal = signal;
    }

    if (isAuditLikeIntent(resolved.phase.executionIntent)) {
      await controlPlane.completeRequest(request.id, {
        planId: `plan-audit-${request.client_request_id}`,
        planHash: 'audit',
        plan: {
          planId: `plan-audit-${request.client_request_id}`,
          objective: resolved.phase.goal,
          constraints: inherited.constraints,
          riskSummary: architectVerdict.summary,
          tasks: [],
          executionIntent: resolved.phase.executionIntent,
          scopePack: {
            packId: boundPack.packId,
            version: boundPack.version,
            phaseId: resolved.phase.id,
            reconciliationState: boundPack.reconciliationState,
          },
        },
        architect: { provider: payload.requestedRouting?.provider ?? 'claude', requestedModel: payload.requestedRouting?.requestedModel ?? null, reportedModel: null, reportedModelSource: 'none' },
        reconciliation: {
          state: boundPack.reconciliationState,
          summary: boundPack.reconciliationSummary,
          claims: boundPack.foundationClaims,
          lastReconciledAt: boundPack.lastReconciledAt,
        },
        architectVerdict,
        approval: approvalGate,
        scopePackSignal,
        historicalCheckpoint: boundPack.historicalCheckpoint,
        checkpointNote,
      });
      return;
    }
  }

  const provider: ProviderId = (payload.requestedRouting?.provider ?? 'claude') as ProviderId;
  const requestedModel = payload.requestedRouting?.requestedModel ?? null;
  const adapter = options.registry.get(provider);
  if (!adapter) {
    await controlPlane.failRequest(
      request.id,
      `Provider ${provider} is not installed on this host. Install it and retry.`,
    );
    return;
  }

  const executionId = `${ARCHITECT_EXECUTION_PREFIX}:${request.client_request_id}`;
  const executionRequest: ExecutionRequest = {
    executionId,
    attemptId: executionId,
    taskId: `create-plan:${request.client_request_id}`,
    runId: ARCHITECT_EXECUTION_PREFIX,
    workingDirectory: options.canonicalRepoPath,
    prompt: boundPack && inherited
      ? `${buildArchitectPrompt({ ...payload, constraints: inherited.constraints })}\n\nSCOPE PACK PHASE: ${payload.scopePackPhaseId}\nLocked rules and do-not-touch boundaries are already included as constraints. Do not invent additional protected files from prose.`
      : buildArchitectPrompt(payload),
    requestedModel: requestedModel ?? undefined,
    permissionProfile: 'read-only-reviewer',
    timeoutMs: ARCHITECT_TIMEOUT_MS,
  };

  let result: ExecutionResult;
  try {
    result = await adapter.execute(executionRequest);
  } catch (error) {
    await controlPlane.failRequest(
      request.id,
      `Architect provider execution failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, REQUEST_ERROR_LIMIT),
    );
    return;
  }

  const parsed = parseArchitectPlan({
    scope: payload.scope,
    constraints: inherited?.constraints ?? payload.constraints,
    provider,
    result,
    executionIntent: boundPack?.roadmapPhases.find((phase) => phase.id === payload.scopePackPhaseId)?.executionIntent,
  });
  if (!parsed.ok) {
    await controlPlane.failRequest(
      request.id,
      `${parsed.failure.code}: ${parsed.failure.message}`.slice(0, REQUEST_ERROR_LIMIT),
    );
    return;
  }

  if (boundPack && inherited) {
    parsed.result.plan.constraints = inherited.constraints;
    parsed.result.plan.scopePack = {
      packId: inherited.scopePackRef.packId,
      version: inherited.scopePackRef.version,
      phaseId: inherited.scopePackRef.phaseId,
      reconciliationState: boundPack.reconciliationState,
    };
    for (const task of parsed.result.plan.tasks) {
      const extra = inherited.validationRequirements.filter((item) => !task.validationRequirements.includes(item));
      task.validationRequirements = [...task.validationRequirements, ...extra].slice(0, 16);
    }
  }

  await controlPlane.completeRequest(request.id, {
    planId: parsed.result.plan.planId,
    planHash: parsed.result.planHash,
    plan: planForPublish(parsed.result.plan),
    architect: parsed.result.architect,
    ...(boundPack && architectVerdict && approvalGate
      ? {
          reconciliation: {
            state: boundPack.reconciliationState,
            summary: boundPack.reconciliationSummary,
            claims: boundPack.foundationClaims,
            lastReconciledAt: boundPack.lastReconciledAt,
          },
          architectVerdict,
          approval: approvalGate,
          scopePackSignal,
        }
      : {}),
  });
}

/**
 * The plan published to the request row: everything the owner must review
 * (§21). Prompt text is NOT included — prompts are synthesized host-side at
 * approve time from these structured fields.
 */
function planForPublish(plan: ControlPlan): unknown {
  return {
    planId: plan.planId,
    objective: plan.objective,
    constraints: plan.constraints,
    riskSummary: plan.riskSummary,
    executionIntent: plan.executionIntent,
    scopePack: plan.scopePack,
    tasks: plan.tasks.map((task) => ({
      clientTaskKey: task.clientTaskKey,
      title: task.title,
      goal: task.goal,
      role: task.role,
      dependencies: task.dependencies,
      permissionProfile: task.permissionProfile,
      authorizedWritePaths: task.authorizedWritePaths,
      plannedAreas: task.plannedAreas,
      validationRequirements: task.validationRequirements,
      provider: task.provider,
      requestedModel: task.requestedModel,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* approve_plan handler (§22-§27)                                              */
/* -------------------------------------------------------------------------- */

export interface ApprovePlanOutcome {
  ok: boolean;
  runId: string | null;
  safeError: string | null;
}

export async function handleApprovePlan(options: {
  store: OrchestrationStore;
  controlPlane: ControlPlane;
  request: ClaimedControlRequest;
  canonicalRepoPath: string;
  /**
   * ATB-2: normalized effort per role, resolved from role routing. Applied to
   * each task's control spec at creation time (affects future Attempts only).
   * Absent → null (provider/adapter default). Only validated levels arrive here.
   */
  roleEffort?: Partial<Record<PlanRole, EffortLevel | null>> | undefined;
}): Promise<ApprovePlanOutcome> {
  const { request, controlPlane, store } = options;
  const payload = request.payload as Record<string, unknown>;
  const planId = typeof payload.planId === 'string' ? payload.planId : null;
  const planHash = typeof payload.planHash === 'string' ? payload.planHash : null;

  if (!planId || !planHash) {
    await controlPlane.failRequest(request.id, 'APPROVE_PAYLOAD_INVALID: approve_plan requires planId and planHash.');
    return { ok: false, runId: null, safeError: 'APPROVE_PAYLOAD_INVALID' };
  }

  const planRow = await controlPlane.findPlanByPlanId(planId);
  if (!planRow) {
    await controlPlane.failRequest(request.id, `PLAN_NOT_FOUND: No completed create_plan request produced plan ${planId}.`);
    return { ok: false, runId: null, safeError: 'PLAN_NOT_FOUND' };
  }

  const storedPlanHash = typeof planRow.result.planHash === 'string' ? planRow.result.planHash : null;
  if (!storedPlanHash || storedPlanHash !== planHash) {
    await controlPlane.failRequest(
      request.id,
      'PLAN_HASH_MISMATCH: The plan hash does not match the approved plan. The plan may have changed — review and approve again.',
    );
    return { ok: false, runId: null, safeError: 'PLAN_HASH_MISMATCH' };
  }

  const plan = planRow.result.plan as ControlPlan | null;
  if (!plan || !Array.isArray(plan.tasks)) {
    await controlPlane.failRequest(request.id, 'PLAN_CORRUPT: The stored plan is unreadable. Create a new plan.');
    return { ok: false, runId: null, safeError: 'PLAN_CORRUPT' };
  }

  const approval = isRecord(planRow.result.approval) ? planRow.result.approval : null;
  if (approval && approval.requiresOwnerReview === true && payload.ownerReviewedConflict !== true) {
    await controlPlane.failRequest(request.id, 'SCOPE_PACK_CONFLICT: Owner review is required before implementation approval.');
    return { ok: false, runId: null, safeError: 'SCOPE_PACK_CONFLICT' };
  }
  if (approval && approval.requiresStaleAcknowledgment === true && payload.staleAcknowledged !== true) {
    await controlPlane.failRequest(request.id, 'SCOPE_PACK_STALE: Acknowledge the stale Scope Pack before implementation approval.');
    return { ok: false, runId: null, safeError: 'SCOPE_PACK_STALE' };
  }
  if (plan.executionIntent === 'audit' || plan.executionIntent === 'research' || plan.tasks.length === 0) {
    await controlPlane.completeRequest(request.id, {
      runId: null,
      planId,
      planHash,
      phaseResult: 'audit-accepted',
      executionIntent: plan.executionIntent ?? 'audit',
    });
    return { ok: true, runId: null, safeError: null };
  }

  // Durable creation through the EXISTING store APIs — never direct table edits.
  const runId = `run-${randomUUID()}`;
  store.createRun({ runId, title: plan.objective.slice(0, 512), goal: plan.objective });
  const taskIdByClientKey = new Map<string, string>();
  for (const [index, task] of plan.tasks.entries()) {
    const taskId = `${plan.planId}:${task.clientTaskKey}`;
    const spec: TaskControlSpec & { workingDirectory: string; plan: Record<string, unknown> } = {
      control: {
        provider: task.provider,
        requestedModel: task.requestedModel,
        reasoningEffort: options.roleEffort?.[task.role] ?? null,
        permissionProfile: task.permissionProfile,
        prompt: buildTaskPrompt(task, plan),
        timeoutMs: DEFAULT_TASK_TIMEOUT_MS,
      },
      policy: {
        authorizedWritePaths: task.authorizedWritePaths,
        doNotTouchPaths: extractDoNotTouchPaths(
          plan.constraints
            .filter((constraint) => constraint.startsWith('DO_NOT_TOUCH: '))
            .map((constraint) => constraint.slice('DO_NOT_TOUCH: '.length)),
        ),
      },
      workingDirectory: options.canonicalRepoPath,
      plan: {
        clientTaskKey: task.clientTaskKey,
        role: task.role,
        plannedAreas: task.plannedAreas,
      },
      ...(plan.scopePack
        ? {
            scopePack: {
              packId: plan.scopePack.packId,
              version: plan.scopePack.version,
              phaseId: plan.scopePack.phaseId,
              reconciliationState: plan.scopePack.reconciliationState ?? 'unverified',
            },
          }
        : {}),
    };
    store.createTask({
      taskId,
      runId,
      title: task.title.slice(0, 512),
      goal: task.goal,
      position: index,
      spec: spec as unknown as JsonValue,
    });
    taskIdByClientKey.set(task.clientTaskKey, taskId);
  }
  for (const task of plan.tasks) {
    const taskId = taskIdByClientKey.get(task.clientTaskKey) as string;
    for (const dependencyKey of task.dependencies) {
      const dependsOnTaskId = taskIdByClientKey.get(dependencyKey);
      if (dependsOnTaskId) {
        store.addDependency(taskId, dependsOnTaskId);
      }
    }
  }

  await controlPlane.completeRequest(request.id, { runId, planId, planHash });
  return { ok: true, runId, safeError: null };
}

/* -------------------------------------------------------------------------- */
/* cancel_run handler (§7 — trivial path only)                                 */
/* -------------------------------------------------------------------------- */

export async function handleCancelRun(options: {
  store: OrchestrationStore;
  controlPlane: ControlPlane;
  request: ClaimedControlRequest;
}): Promise<void> {
  const { request, controlPlane, store } = options;
  const payload = request.payload as Record<string, unknown>;
  const runId = typeof payload.runId === 'string' ? payload.runId : null;
  if (!runId) {
    await controlPlane.failRequest(request.id, 'CANCEL_PAYLOAD_INVALID: cancel_run requires runId.');
    return;
  }
  const run = store.getRun(runId);
  if (!run) {
    await controlPlane.failRequest(request.id, `RUN_NOT_FOUND: ${runId}`);
    return;
  }
  if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
    await controlPlane.failRequest(request.id, `RUN_ALREADY_TERMINAL: ${runId} is ${run.status}.`);
    return;
  }
  store.transitionRun(runId, 'cancelled');
  await controlPlane.completeRequest(request.id, { runId, status: 'cancelled' });
}

/* -------------------------------------------------------------------------- */
/* Supervisor loop (§26-§27) — existing supervisorTick, max one execution/tick  */
/* -------------------------------------------------------------------------- */

export const ACTIVE_RUN_STATUSES_SET = new Set(['pending', 'running', 'paused']);

export async function driveRunToCompletion(options: {
  store: OrchestrationStore;
  controlPlane: ControlPlane;
  executionPort: ProductionExecutionPort;
  runId: string;
  hostInstanceId: string;
  publishSnapshot: (runId: string) => Promise<void>;
  tickIntervalMs?: number | undefined;
  /** ATB-1B active-run snapshot heartbeat cadence. Defaults to ACTIVE_SNAPSHOT_HEARTBEAT_MS. */
  snapshotHeartbeatMs?: number | undefined;
  /** Bounded, best-effort report of a heartbeat publish failure. Never affects the run. */
  onSnapshotError?: ((runId: string, error: unknown) => void | Promise<void>) | undefined;
}): Promise<void> {
  const { store, executionPort, runId } = options;
  const tickIntervalMs = options.tickIntervalMs ?? SUPERVISOR_TICK_INTERVAL_MS;
  const heartbeatMs = options.snapshotHeartbeatMs ?? ACTIVE_SNAPSHOT_HEARTBEAT_MS;

  // Single coalescing publisher shared by the authoritative (pre/post-tick)
  // publishes and the observability heartbeat, so the two never overlap into a
  // publish storm. At most one publishSnapshot call is ever in flight.
  let inFlight: Promise<void> | null = null;
  let disposed = false;

  const startPublish = (): Promise<void> => {
    // Self-guarding: never run two publishes at once — a concurrent caller gets
    // the in-flight promise. Only one publish is ever active, so clearing
    // inFlight in finally is always correct.
    if (inFlight) {
      return inFlight;
    }
    const pending = (async () => {
      try {
        await options.publishSnapshot(runId);
      } finally {
        inFlight = null;
      }
    })();
    inFlight = pending;
    return pending;
  };

  // Authoritative publish (before the loop + after every tick). Waits for any
  // in-flight heartbeat first so publishes serialize, and preserves the existing
  // contract that a pre/post-tick publish failure surfaces to the caller.
  const authoritativePublish = async (): Promise<void> => {
    const current = inFlight;
    if (current) {
      try {
        await current;
      } catch {
        // A heartbeat publish failure is reported via onSnapshotError below; it
        // must not abort the authoritative publish that follows.
      }
    }
    await startPublish();
  };

  // Observability heartbeat: fire-and-forget, coalesced (skips if a publish is
  // already running or the drive has been disposed), fully error-isolated so a
  // failed publish can never abort provider execution or the run lifecycle.
  const heartbeatTick = (): void => {
    if (disposed || inFlight) {
      return;
    }
    void startPublish().catch(async (error) => {
      try {
        await options.onSnapshotError?.(runId, error);
      } catch {
        // The error reporter itself is best-effort.
      }
    });
  };

  const heartbeat = setInterval(heartbeatTick, heartbeatMs);
  if (typeof heartbeat.unref === 'function') {
    heartbeat.unref();
  }

  try {
    await authoritativePublish();

    for (;;) {
      const run = store.getRun(runId);
      if (!run || !ACTIVE_RUN_STATUSES_SET.has(run.status)) {
        await authoritativePublish();
        return;
      }

      await supervisorTick({
        store,
        runId,
        hostInstanceId: options.hostInstanceId,
        executionPort,
      });

      await authoritativePublish();

      // Stop on completed/failed/paused/cancelled. A paused run awaits the human
      // gate — this worker never auto-resumes (§28).
      const after = store.getRun(runId);
      if (!after || !ACTIVE_RUN_STATUSES_SET.has(after.status)) {
        return;
      }
      await sleep(tickIntervalMs);
    }
  } finally {
    disposed = true;
    clearInterval(heartbeat);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/* -------------------------------------------------------------------------- */
/* Startup resume (§28) — hand still-active durable Runs back to the Supervisor  */
/* -------------------------------------------------------------------------- */

/**
 * Runs that still require orchestration after a Host restart. ONLY `pending` and
 * `running` Runs are resumable: `paused` awaits the human gate and is NEVER
 * auto-resumed (§28), and `completed`/`failed`/`cancelled` are terminal and must
 * never be resurrected.
 */
export const RESUMABLE_RUN_STATUSES_SET = new Set(['pending', 'running']);

export interface ResumeResumableRunsResult {
  /** Run ids handed to driveRunToCompletion this pass, in execution order. */
  resumedRunIds: string[];
}

/**
 * Restart recovery (§28). {@link recoverInterruptedAttempts} only turns the previous
 * Host's stale in-flight Attempts into `interrupted`; it does NOT hand the owning Run
 * back to the Supervisor. Without this pass a Run whose Host restarted mid-flight is
 * never reconciled/retried/failed and the browser keeps showing the pre-restart
 * snapshot forever.
 *
 * This discovers every still-resumable Run and drives each one through the EXISTING
 * {@link driveRunToCompletion} -> supervisorTick loop — the same machinery an
 * approve_plan uses. The Supervisor alone recovers the interrupted Attempt, reconciles
 * the running Task, schedules a retry within the existing budget (or fails cleanly when
 * it is spent), and creates any next Attempt on a later tick. This function never
 * creates Runs/Tasks/Attempts and never mutates lifecycle state directly.
 *
 * Determinism/safety: Runs are processed sequentially (no concurrency) in the store's
 * deterministic `(createdAt, runId)` order. The resumable set is snapshotted up front
 * and each Run is re-checked immediately before driving, so a Run that has since
 * terminalized or paused is skipped — repeated startup recovery is idempotent and never
 * double-executes. Fresh SAFE snapshots are published by driveRunToCompletion as each
 * Run's state changes (§29 whitelist — never prompts/transcripts/secrets).
 */
export async function resumeResumableRuns(options: {
  store: OrchestrationStore;
  controlPlane: ControlPlane;
  executionPort: ProductionExecutionPort;
  hostInstanceId: string;
  publishSnapshot: (runId: string) => Promise<void>;
  tickIntervalMs?: number | undefined;
  snapshotHeartbeatMs?: number | undefined;
  onSnapshotError?: ((runId: string, error: unknown) => void | Promise<void>) | undefined;
  shouldContinue?: (() => boolean) | undefined;
  onRunError?: ((runId: string, error: unknown) => Promise<void> | void) | undefined;
}): Promise<ResumeResumableRunsResult> {
  const { store } = options;
  const shouldContinue = options.shouldContinue ?? (() => true);

  const resumableRunIds = store
    .listRuns()
    .filter((run) => RESUMABLE_RUN_STATUSES_SET.has(run.status))
    .map((run) => run.runId);

  const resumedRunIds: string[] = [];
  for (const runId of resumableRunIds) {
    if (!shouldContinue()) {
      break;
    }
    // Re-read: only drive a Run that is STILL resumable. Never resurrect a Run that has
    // terminalized or paused since discovery (idempotency + §28 no-auto-resume).
    const current = store.getRun(runId);
    if (!current || !RESUMABLE_RUN_STATUSES_SET.has(current.status)) {
      continue;
    }

    try {
      await driveRunToCompletion({
        store,
        controlPlane: options.controlPlane,
        executionPort: options.executionPort,
        runId,
        hostInstanceId: options.hostInstanceId,
        publishSnapshot: options.publishSnapshot,
        tickIntervalMs: options.tickIntervalMs,
        snapshotHeartbeatMs: options.snapshotHeartbeatMs,
        onSnapshotError: options.onSnapshotError,
      });
    } catch (error) {
      if (options.onRunError) {
        await options.onRunError(runId, error);
      }
      try {
        await options.publishSnapshot(runId);
      } catch {
        // Best effort — the run already has a durable record; nothing else is
        // publishable here.
      }
    }
    resumedRunIds.push(runId);
  }

  return { resumedRunIds };
}

/* -------------------------------------------------------------------------- */
/* Worker main                                                                 */
/* -------------------------------------------------------------------------- */

export interface ControlWorkerOptions {
  startDir?: string | undefined;
  localAppData?: string | undefined;
}

async function readHostVersion(canonicalRepoPath: string): Promise<string> {
  const packageJsonPath = new URL('../../package.json', import.meta.url);
  const raw = await readFile(packageJsonPath, 'utf8');
  const parsed = JSON.parse(raw) as { version?: unknown };
  if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
    throw new Error(`package.json version is missing for repo ${canonicalRepoPath}`);
  }
  return parsed.version;
}

function createHeartbeatDocument(options: {
  hostId: string;
  hostVersion: string;
  canonicalRepoPath: string;
  repoKey: string;
  instanceId: string;
  pid: number;
  startedAt: string;
  repoStatus: RepoStatus;
  state: HeartbeatDocument['state'];
  providers: ProviderDiscoveryRecord[];
  stoppedAt?: string | undefined;
}): HeartbeatDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    hostId: options.hostId,
    hostVersion: options.hostVersion,
    canonicalRepoPath: options.canonicalRepoPath,
    repoKey: options.repoKey,
    instanceId: options.instanceId,
    pid: options.pid,
    startedAt: options.startedAt,
    lastHeartbeatAt: new Date().toISOString(),
    state: options.state,
    stoppedAt: options.stoppedAt,
    branch: options.repoStatus.branch,
    headSha: options.repoStatus.headSha,
    dirty: options.repoStatus.dirty,
    providers: options.providers,
  };
}

export async function runControlWorker(options: ControlWorkerOptions = {}): Promise<number> {
  const canonicalRepoPath = await resolveCanonicalRepo(options.startDir);
  await loadEnvFile(path.join(canonicalRepoPath, '.env.local'));

  const statePaths = resolveStatePaths({ canonicalRepoPath, localAppData: options.localAppData });
  await Promise.all([
    mkdir(statePaths.baseDir, { recursive: true }),
    mkdir(statePaths.repoStateDir, { recursive: true }),
  ]);

  const hostVersion = await readHostVersion(canonicalRepoPath);
  const hostId = await readOrCreateHostId(statePaths.hostIdPath);
  const instanceIdentity = createInstanceIdentity();
  const hostIdentity = composeHostIdentity({
    hostId,
    hostVersion,
    canonicalRepoPath,
    repoKey: statePaths.repoKey,
  });

  let config: ControlPlaneConfig;
  try {
    config = resolveControlPlaneConfigFromEnv({
      repoKey: statePaths.repoKey,
      hostInstanceId: instanceIdentity.instanceId,
      hostVersion,
    });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  const lockDocument = {
    schemaVersion: SCHEMA_VERSION,
    ...hostIdentity,
    ...instanceIdentity,
  } as const;

  await acquireLock({ statePaths, lock: lockDocument });

  const eventWriter = createEventWriter({
    eventsPath: statePaths.eventsPath,
    hostId,
    instanceId: instanceIdentity.instanceId,
    repoKey: statePaths.repoKey,
  });

  const store = openOrchestrationStore({
    dbPath: statePaths.orchestrationDbPath,
    repoKey: statePaths.repoKey,
    hostId,
    hostVersion,
  });

  const controlPlane = new ControlPlane(config);

  // Created after discovery below, with the REAL provider registry — the same
  // construction path dispatch.ts uses (adapter dispatch, isolated workspace
  // config, policy adjudication).
  let executor: AttemptExecutor;

  const publishSnapshot = async (runId: string): Promise<void> => {
    const snapshot = buildRunSnapshot({
      store,
      runId,
      verification: executionPort.getVerifierVerdict(runId),
    });
    if (!snapshot) {
      return;
    }
    await controlPlane.publishRunSnapshot({
      runId,
      objective: snapshot.run.objective,
      status: snapshot.run.status,
      snapshot: snapshot as unknown as Record<string, unknown>,
    });
  };

  // Bounded, best-effort reporter for active-run snapshot heartbeat publish
  // failures. Observability only — never affects provider execution or the run.
  const onSnapshotError = (failedRunId: string, error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Active-run snapshot heartbeat publish failed for ${failedRunId}: ${message.slice(0, 256)}\n`);
  };

  let repoStatus = await readRepoStatus(canonicalRepoPath);
  let lastRepoRefreshAt = Date.now();
  let providers: ProviderDiscoveryRecord[] = [];

  const writeCurrentHeartbeat = async (
    state: HeartbeatDocument['state'],
    stoppedAt?: string,
  ): Promise<void> => {
    await writeHeartbeat(
      statePaths.heartbeatPath,
      createHeartbeatDocument({
        ...hostIdentity,
        ...instanceIdentity,
        repoStatus,
        state,
        providers,
        stoppedAt,
      }),
    );
  };

  const refreshRepoStatusIfNeeded = async (force: boolean = false): Promise<void> => {
    if (!force && Date.now() - lastRepoRefreshAt < REPO_STATUS_REFRESH_MS) {
      return;
    }
    repoStatus = await readRepoStatus(canonicalRepoPath);
    lastRepoRefreshAt = Date.now();
  };

  recoverInterruptedAttempts(store, instanceIdentity.instanceId);
  providers = await discoverTools();
  const registry = createProviderRegistry(providers);
  executor = new AttemptExecutor({
    store,
    registry,
    workspaceConfig: {
      canonicalRepoPath,
      workspaceRoot: path.join(statePaths.baseDir, 'workspaces'),
      repoKey: statePaths.repoKey,
    },
  });
  const executionPort = new ProductionExecutionPort({
    store,
    executor,
    availableProviders: new Set(registry.keys()),
  });

  await writeCurrentHeartbeat('running');
  await eventWriter.append('host.started', { pid: instanceIdentity.pid, mode: 'control' });
  await eventWriter.append('host.discovery.completed', {
    installedTools: providers.filter((provider) => provider.installed).map((provider) => provider.toolId),
    mode: 'control',
  });

  // ATB-2/ATB-2B: build the SAFE provider/model capability fleet once after
  // discovery and publish it through the presence providers jsonb. Enumerated
  // models come best-effort from `ollama list` (local) and `codex debug models`
  // (provider catalog) — guarded; any failure just yields no enumerated models,
  // never a startup failure. No paths/tokens/env published.
  const enumeratedModels = await enumerateLocalModels(providers);
  const providerFleet = toSafeProviderFleet(
    buildProviderCapabilityRegistry({ discovery: providers, enumeratedModels }),
  );

  let shutdownStarted = false;
  let running = true;
  let presenceInFlight = false;
  let heartbeatInFlight = false;

  const presenceTimer = setInterval(() => {
    if (presenceInFlight || shutdownStarted) {
      return;
    }
    presenceInFlight = true;
    void (async () => {
      try {
        await controlPlane.publishPresence({ providers: providerFleet });
      } catch {
        // Best effort — the local heartbeat file remains the host truth.
      } finally {
        presenceInFlight = false;
      }
    })();
  }, PRESENCE_PUBLISH_INTERVAL_MS);

  const heartbeatTimer = setInterval(() => {
    if (heartbeatInFlight || shutdownStarted) {
      return;
    }
    heartbeatInFlight = true;
    void (async () => {
      try {
        await refreshRepoStatusIfNeeded();
        await writeCurrentHeartbeat('running');
      } catch {
        // Best effort heartbeat only.
      } finally {
        heartbeatInFlight = false;
      }
    })();
  }, HEARTBEAT_INTERVAL_MS);

  const shutdown = async (signal: string): Promise<void> => {
    if (shutdownStarted) {
      return;
    }
    shutdownStarted = true;
    running = false;
    clearInterval(presenceTimer);
    clearInterval(heartbeatTimer);
    try {
      await shutdownHostRuntime({
        refreshRepoStatusIfNeeded,
        writeCurrentHeartbeat,
        appendLifecycleEvent: (type, data) => eventWriter.append(type, data).then(() => undefined),
        executorShutdown: () => executor.shutdown(),
        closeOrchestrationStore: () => {
          store.close();
        },
        releaseLock: () => releaseLockIfOwned(statePaths.lockPath, instanceIdentity.instanceId).then(() => undefined),
        finishProcess: async () => {
          running = false;
        },
        signal,
      });
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('uncaughtException', (error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    void shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    void shutdown('unhandledRejection');
  });

  await controlPlane.publishPresence({ providers: providerFleet });

  // Restart recovery (§28): recoverInterruptedAttempts above only interrupted the
  // previous Host's stale Attempts. Hand every still-resumable Run back to the
  // EXISTING Supervisor loop BEFORE ordinary polling, so an interrupted Run is
  // reconciled/retried/failed and a FRESH safe snapshot replaces the pre-restart
  // one. Paused Runs stay paused; terminal Runs are never touched. Sequential and
  // deterministic — no concurrency.
  try {
    await resumeResumableRuns({
      store,
      controlPlane,
      executionPort,
      hostInstanceId: instanceIdentity.instanceId,
      publishSnapshot,
      onSnapshotError,
      shouldContinue: () => running,
      onRunError: async (runId, error) => {
        await eventWriter.append('control.run.error', {
          runId,
          phase: 'startup-resume',
          message: error instanceof Error ? error.message : String(error),
        });
      },
    });
  } catch (error) {
    process.stderr.write(
      `Startup resume failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }

  // Claim/handle loop. Requests are handled sequentially; a run drives to
  // completion (or pause) before the next request is claimed.
  while (running) {
    let claimed: ClaimedControlRequest[] = [];
    try {
      claimed = await controlPlane.claimPendingRequests();
    } catch (error) {
      process.stderr.write(`Control-plane claim failed: ${error instanceof Error ? error.message : String(error)}\n`);
      await sleep(CLAIM_POLL_INTERVAL_MS);
      continue;
    }

    if (claimed.length === 0) {
      await sleep(CLAIM_POLL_INTERVAL_MS);
      continue;
    }

    for (const request of claimed) {
      if (!running) {
        break;
      }
      try {
        if (request.request_type === 'import_scope_pack') {
          await handleImportScopePack({
            controlPlane,
            request,
            organizationId: config.organizationId,
          });
        } else if (request.request_type === 'create_plan') {
          await handleCreatePlan({
            store,
            registry,
            controlPlane,
            request,
            canonicalRepoPath,
            organizationId: config.organizationId,
          });
        } else if (request.request_type === 'approve_plan') {
          const outcome = await handleApprovePlan({ store, controlPlane, request, canonicalRepoPath });
          if (outcome.ok && outcome.runId) {
            try {
              await driveRunToCompletion({
                store,
                controlPlane,
                executionPort,
                runId: outcome.runId,
                hostInstanceId: instanceIdentity.instanceId,
                publishSnapshot,
                onSnapshotError,
              });
            } catch (error) {
              await eventWriter.append('control.run.error', {
                runId: outcome.runId,
                message: error instanceof Error ? error.message : String(error),
              });
              try {
                await publishSnapshot(outcome.runId);
              } catch {
                // Snapshot already attempted; nothing else is publishable here.
              }
            }
          }
        } else if (request.request_type === 'cancel_run') {
          await handleCancelRun({ store, controlPlane, request });
          if (typeof (request.payload as Record<string, unknown>).runId === 'string') {
            try {
              await publishSnapshot((request.payload as Record<string, unknown>).runId as string);
            } catch {
              // Cancel snapshot is best effort.
            }
          }
        } else {
          await controlPlane.failRequest(request.id, `UNKNOWN_REQUEST_TYPE: ${String(request.request_type)}`);
        }
      } catch (error) {
        try {
          await controlPlane.failRequest(
            request.id,
            `REQUEST_HANDLER_FAILED: ${error instanceof Error ? error.message : String(error)}`.slice(0, REQUEST_ERROR_LIMIT),
          );
        } catch {
          // The request stays claimed; the owner can retry with a new request.
        }
      }
    }
  }

  return typeof process.exitCode === 'number' ? process.exitCode : 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await runControlWorker();
  } catch (error) {
    if (error instanceof LockAcquisitionError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    }
    process.exitCode = 1;
  }
}