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
 * NO browser→shell path exists. Canonical writes happen only when the owner
 * submits apply_candidate. That path never commits, pushes, deploys, or runs
 * migrations. NO service-credential exposure: the service role key stays in
 * this Node process and is never passed to provider child processes.
 */

import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { computeAgentHostSourceFingerprint } from '../hostSourceFingerprint.ts';
import { composeHostIdentity, createInstanceIdentity, readOrCreateHostId } from '../lib/identity.ts';
import { createEventWriter } from '../lib/events.ts';
import { writeHeartbeat } from '../lib/heartbeat.ts';
import { discoverTools } from '../lib/discovery.ts';
import { acquireLock, LockAcquisitionError, releaseLockIfOwned } from '../lib/lock.ts';
import { readRepoStatus, resolveCanonicalRepo } from '../lib/repo.ts';
import { resolveStatePaths } from '../lib/statePaths.ts';
import { TASK_SPEC_MAX_BYTES } from './capacity.ts';
import { assertOptionalJsonWithinLimit, openOrchestrationStore, type OrchestrationStore } from '../lib/store.ts';
import type { JsonValue } from '../lib/orchestrationTypes.ts';
import {
  AttemptExecutor,
  createProviderRegistry,
  recoverInterruptedAttempts,
} from '../providers/executor.ts';
import type { ExecutionRequest, ProviderAdapter, ProviderId } from '../providers/types.ts';
import {
  buildProviderCapabilityRegistry,
  parseCodexModelCatalog,
  parseOllamaModelList,
  toSafeProviderFleet,
} from '../providers/capabilityRegistry.ts';
import { buildCmdWrapperCommandLine } from '../providers/processRunner.ts';
import { configureProviderExecutionLimits } from '../providers/executionLimits.ts';
import { supervisorTick } from '../supervisor/supervisor.ts';
import { shutdownHostRuntime } from '../index.ts';

import { ControlPlane, type ClaimedControlRequest, type ControlPlaneConfig, type ControlPlaneHealthSnapshot, resolveControlPlaneConfigFromEnv } from './supabaseControl.ts';
import { jitteredBackoffDelay } from './retry.ts';
import { SOURCE_FINGERPRINT_RECHECK_MS, startSourceFingerprintWatch } from './sourceFingerprintWatch.ts';
import { createLatestWinsPublisher } from './snapshotPublisher.ts';
import {
  HOST_CLAIM_LOST_MESSAGE,
  LOST_CLAIM_CHECK_INTERVAL_MS,
  createHeldRequestTracker,
  recoverLostClaims,
  type HeldRequestTracker,
} from './lostClaims.ts';
import { ControlRequestScheduler } from './requestPump.ts';
import {
  HOST_CLAIM_ORPHAN_MESSAGE,
  ORPHAN_SWEEP_INTERVAL_MS,
  sweepOrphanClaims,
} from './orphanClaims.ts';
import { handleUncaughtException, handleUnhandledRejection } from './processGuards.ts';
import { createHostLog } from '../lib/hostLog.ts';
import {
  ARCHITECT_TIMEOUT_MS,
  DEFAULT_TASK_TIMEOUT_MS,
  buildArchitectPrompt,
  buildTaskPrompt,
  extractPlanJsonObject,
  resolveArchitectPlan,
  parseCreatePlanPayload,
  resolveArchitectRequest,
  applyOwnerRoleModels,
  PLANNING_STATUS_LINES,
  foundCandidatesStatus,
  inspectingFilesStatus,
} from './planning.ts';
import { applyChangeIndexToSnapshot, handleApplyCandidate } from './applyCandidate.ts';
import { preparePlanningDiscovery } from './planningDiscovery.ts';
import { ProductionExecutionPort } from './supervisorPort.ts';
import { buildRunSnapshot } from './snapshots.ts';
import { readCandidateChangeIndex, resolveAttemptWorkspacePath } from '../workspace.ts';
import { computePlanHash, type ControlPlan, type PlanRole, type TaskControlSpec } from './types.ts';
import {
  applyReconciliation,
  buildScopePackApprovalGate,
  buildScopePackArchitectPrompt,
  buildScopePackSignal,
  extractDoNotTouchPaths,
  inheritScopePackConstraints,
  type ScopePackInheritanceResult,
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

/**
 * Validate the Architect identity from a plan result so it can be carried on
 * every task spec.plan. provider must be a non-empty string (≤200 chars);
 * requestedModel and reportedModel are a string or null (each ≤200 chars,
 * otherwise null). requestedModel is NEVER copied into the reported slot — an
 * Architect that reported no model honestly stays null. Returns null when there
 * is no architect wire or no valid provider, so spec.plan simply omits it.
 */
function validatePlanArchitectIdentity(
  result: unknown,
  reasoningEffort: EffortLevel | null,
): { provider: string; requestedModel: string | null; reportedModel: string | null; reasoningEffort: EffortLevel | null } | null {
  const wire = isRecord(result) && isRecord(result.architect) ? result.architect : null;
  if (!wire) return null;
  const cleanString = (input: unknown): string | null => {
    if (typeof input !== 'string' || input.length === 0 || input.length > 200) return null;
    return input;
  };
  const provider = cleanString(wire.provider);
  if (!provider) return null;
  return {
    provider,
    requestedModel: cleanString(wire.requestedModel),
    reportedModel: cleanString(wire.reportedModel),
    reasoningEffort,
  };
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
 * CT-REL-3 A3: upper bound the shutdown waits for the single background job to
 * drain after the executor shutdown aborts its in-flight Attempt. The loop never
 * hangs — if the job somehow does not settle within this bound, shutdown proceeds.
 */
export const SCHEDULER_DRAIN_TIMEOUT_MS = 20_000;
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
/* CT-REL-3: responsive owner cancellation                                     */
/* -------------------------------------------------------------------------- */

/**
 * Safe, owner-facing terminal code + copy for an Attempt the OWNER cancelled via
 * cancel_run (amendment A1). This is distinct from a Host shutdown (which keeps
 * today's interrupted → restart-resume semantics and never writes this code) and
 * from a provider timeout. Recorded as CT-REL-1-style failure evidence on the
 * aborted Attempt so the safe snapshot surfaces "Cancelled by owner".
 */
export const EXECUTION_CANCELLED_BY_OWNER = 'EXECUTION_CANCELLED_BY_OWNER';
export const CANCELLED_BY_OWNER_MESSAGE = 'Cancelled by owner';

/**
 * Durable, immutable owner cancel-intent event (amendment A2). Recorded in the
 * EXISTING local orchestration events table before anything is aborted, so the
 * live cancellation signal and startup restart-resume both read one durable
 * fact. No schema change. Deterministic id per run → idempotent for duplicate
 * cancel_run requests.
 */
export const RUN_CANCEL_REQUESTED_EVENT = 'control.run.cancel_requested';

/** A4: factual queued status published through the existing per-request result channel. */
export const QUEUED_STATUS_MESSAGE = 'Queued — waiting for the current run to finish';

/** Record the durable owner cancel intent for a run (idempotent). */
export function recordRunCancelIntent(store: OrchestrationStore, runId: string): void {
  store.appendEvent({
    eventId: `${RUN_CANCEL_REQUESTED_EVENT}:${runId}`,
    runId,
    type: RUN_CANCEL_REQUESTED_EVENT,
    payload: { reason: CANCELLED_BY_OWNER_MESSAGE },
  });
}

/** True when the run carries a durable owner cancel intent (survives restart). */
export function hasRunCancelIntent(store: OrchestrationStore, runId: string): boolean {
  return store
    .listEvents()
    .some((event) => event.runId === runId && event.type === RUN_CANCEL_REQUESTED_EVENT);
}

/**
 * CT-REL-1 follow-up-event pattern: record owner-cancel failure evidence on an
 * Attempt aborted by cancel_run so the safe snapshot reports the owner code +
 * copy. Best-effort — evidence never blocks cancellation. The Attempt itself is
 * terminalized `cancelled` by the executor's existing cancel path.
 */
export function recordOwnerCancelEvidence(
  store: OrchestrationStore,
  runId: string,
  taskId: string,
  attemptId: string,
): void {
  try {
    store.appendEvent({
      eventId: `execution.failure_evidence:owner-cancel:${attemptId}`,
      runId,
      taskId,
      attemptId,
      type: 'execution.failure_evidence',
      payload: {
        errorCode: EXECUTION_CANCELLED_BY_OWNER,
        errorMessage: CANCELLED_BY_OWNER_MESSAGE,
        elapsedMs: null,
        lastActivityAt: null,
        limitFired: 'none',
        limitMs: null,
        changedFileCount: 0,
        sessionId: null,
      } as JsonValue,
    });
  } catch {
    // Evidence is best-effort; the executor still terminalizes the Attempt.
  }
}

const RUN_TERMINAL_STATUS_SET = new Set(['completed', 'failed', 'cancelled']);
const TASK_NON_TERMINAL_STATUS_SET = new Set(['pending', 'running', 'blocked']);

/**
 * Idempotent, single-authority run cancellation finalizer (CT-REL-3 goal 2/3).
 *
 * Exactly-one-terminal-outcome: this checks the run's terminal status FIRST, so a
 * normal completion/failure that already won is never overwritten. Otherwise it
 * cancels every still-non-terminal Task (so nothing is left to start) and then
 * cancels the Run. Returns true iff the run is `cancelled` after this call.
 *
 * Safe to call more than once and from more than one path (handleCancelRun for a
 * non-driving run; the drive loop after an aborted Attempt returns; startup
 * restart-resume for a run with durable cancel intent).
 */
export function finalizeRunCancellation(store: OrchestrationStore, runId: string): boolean {
  const run = store.getRun(runId);
  if (!run) {
    return false;
  }
  // Exactly-one-terminal-outcome: a NON-cancel terminal (completed / failed) that
  // already won is never overwritten. A run that is already `cancelled` still
  // falls through so the Task sweep below stays idempotent (the run may have been
  // cancelled by the supervisor tick before its unstarted Tasks were swept).
  if (run.status === 'completed' || run.status === 'failed') {
    return false;
  }
  for (const task of store.listTasks(runId)) {
    if (TASK_NON_TERMINAL_STATUS_SET.has(task.status)) {
      try {
        store.transitionTask(task.taskId, 'cancelled');
      } catch {
        // Best-effort per task; the run transition below is the critical write.
      }
    }
  }
  if (run.status !== 'cancelled') {
    store.transitionRun(runId, 'cancelled');
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* CT-REL-2 Part A: restart-required gating + presence host-status marker        */
/* -------------------------------------------------------------------------- */

/**
 * The exact error a NEW create_plan / approve_plan request receives while the
 * Host is running older Agent Host source than what is on disk (goal 3). Plain
 * language so the owner sees the fix right where they submitted the request.
 */
export const HOST_RESTART_REQUIRED_REQUEST_ERROR =
  'HOST_RESTART_REQUIRED: the connected Host is running older Agent Host code. Stop the Host window and run: npm.cmd run agent-host:control';

/**
 * CT-REL-2 amendment 6: the Host status rides the presence `providers` jsonb as
 * a clearly namespaced `{ kind: 'host-status', ... }` object — the browser
 * adapter skips entries without a providerId, so it can never render as a
 * provider. Carries the startup source fingerprint (goal 2 detection),
 * restartRequired + detection time, and the Host-reported control-plane health
 * snapshot (goal 7). NO schema change: everything fits the existing jsonb.
 */
export function buildHostStatusMarker(input: {
  sourceFingerprint: string;
  restartRequired: boolean;
  restartDetectedAt: string | null;
  health: ControlPlaneHealthSnapshot;
}): Record<string, unknown> {
  return {
    kind: 'host-status',
    sourceFingerprint: input.sourceFingerprint,
    restartRequired: input.restartRequired,
    restartDetectedAt: input.restartDetectedAt,
    health: input.health,
  };
}

/**
 * Only NEW plan work is refused while the Host is stale (goal 3): cancel_run,
 * apply_candidate, and import_scope_pack keep working, and in-flight attempts
 * finish normally.
 */
export function isRefusedWhileRestartRequired(requestType: ClaimedControlRequest['request_type']): boolean {
  return requestType === 'create_plan' || requestType === 'approve_plan';
}

/**
 * Fail a request that must be refused because the Host is running older code.
 * Returns true when the request was refused (caller skips dispatch); false when
 * the request may proceed. A failRequest failure leaves the row claimed — the
 * lost-claim recovery eventually reports it.
 */
export async function gateRestartRequiredRequest(options: {
  request: ClaimedControlRequest;
  restartRequired: boolean;
  failRequest: (id: string, error: string) => Promise<void>;
}): Promise<boolean> {
  if (!options.restartRequired || !isRefusedWhileRestartRequired(options.request.request_type)) {
    return false;
  }
  try {
    await options.failRequest(options.request.id, HOST_RESTART_REQUIRED_REQUEST_ERROR);
  } catch {
    // The request stays claimed; the owner can submit a fresh request after restart.
  }
  return true;
}

export interface ClaimedBatchDispatchOptions {
  requests: ClaimedControlRequest[];
  /** Held-request tracker shared with lost-claim recovery (CT-REL-2.1 goal 1). */
  held: HeldRequestTracker;
  isRunning: () => boolean;
  dispatch: (request: ClaimedControlRequest) => Promise<void>;
}

/**
 * CT-REL-2.1 goal 1: dispatch a claimed batch. EVERY row is held the moment
 * the batch is received — BEFORE any dispatch — so a sibling still waiting its
 * turn is just as held as the row being dispatched and lost-claim recovery
 * never mistakes it for a lost claim, no matter how long earlier rows take.
 * Each row is released when its handling finishes (completed / failed /
 * refused), and a row already failed by recovery (poisoned) is skipped without
 * ever being dispatched, even if it appears in a later batch.
 */
export async function dispatchClaimedBatch(options: ClaimedBatchDispatchOptions): Promise<void> {
  for (const request of options.requests) {
    options.held.hold(request.id);
  }
  for (const request of options.requests) {
    if (!options.isRunning()) {
      break;
    }
    if (options.held.isPoisoned(request.id)) {
      // Goal 1c: recovery already failed this row remotely as HOST_CLAIM_LOST —
      // it must never be dispatched again.
      options.held.release(request.id);
      continue;
    }
    try {
      await options.dispatch(request);
    } finally {
      options.held.release(request.id);
    }
  }
}

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
  orientationCachePath?: string;
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
  const architectRequest = resolveArchitectRequest(payload);

  let boundPack: ScopePackContract | null = null;
  let inherited: Extract<ScopePackInheritanceResult, { ok: true }> | null = null;
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
    const inheritanceFit = inheritScopePackConstraints({
      ownerConstraints: payload.constraints,
      pack: loaded,
      phase: resolved.phase,
    });
    if (!inheritanceFit.ok) {
      await controlPlane.failRequest(request.id, `${inheritanceFit.code}: ${inheritanceFit.message}`);
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
      const reconProvider: ProviderId = architectRequest.provider;
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
        requestedModel: architectRequest.requestedModel ?? undefined,
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
    const inheritance = inheritScopePackConstraints({
      ownerConstraints: payload.constraints,
      pack: boundPack,
      phase: resolved.phase,
    });
    if (!inheritance.ok) {
      await controlPlane.failRequest(request.id, `${inheritance.code}: ${inheritance.message}`);
      return;
    }
    inherited = inheritance;
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
        architect: { provider: architectRequest.provider, requestedModel: architectRequest.requestedModel, reportedModel: null, reportedModelSource: 'none' },
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

  const provider: ProviderId = architectRequest.provider;
  const requestedModel = architectRequest.requestedModel;
  const adapter = options.registry.get(provider);
  if (!adapter) {
    await controlPlane.failRequest(
      request.id,
      `Provider ${provider} is not installed on this host. Install it and retry.`,
    );
    return;
  }

  const notePlanning = async (planningStatus: string): Promise<void> => {
    if (controlPlane.notePlanningProgress) {
      await controlPlane.notePlanningProgress(request.id, { planningStatus });
    }
  };
  await notePlanning(PLANNING_STATUS_LINES.architectStarted);
  const discovery = await preparePlanningDiscovery({
    root: options.canonicalRepoPath,
    scope: payload.scope,
    mode: payload.planningMode ?? 'fast',
    ...(options.orientationCachePath ? { cachePath: options.orientationCachePath } : {}),
  });
  if (!discovery.ok) {
    await controlPlane.failRequest(request.id, discovery.message);
    return;
  }
  if (discovery.discovery.available) {
    if (discovery.discovery.usedCache) await notePlanning(PLANNING_STATUS_LINES.usingCache);
    await notePlanning(PLANNING_STATUS_LINES.searching);
    await notePlanning(foundCandidatesStatus(discovery.discovery.candidateFiles.length));
    if (discovery.discovery.inspectedFiles.length > 0) {
      await notePlanning(inspectingFilesStatus(discovery.discovery.inspectedFiles.length));
    }
  }
  await notePlanning(PLANNING_STATUS_LINES.building);

  const executionId = `${ARCHITECT_EXECUTION_PREFIX}:${request.client_request_id}`;
  const discoveryMode = discovery.discovery.available ? { mode: discovery.discovery.mode } : undefined;
  const architectBase = boundPack && inherited
    ? `${buildArchitectPrompt({ ...payload, constraints: inherited.constraints }, discoveryMode)}\n\nSCOPE PACK PHASE: ${payload.scopePackPhaseId}\nLocked rules and do-not-touch boundaries are already included as constraints. Do not invent additional protected files from prose.`
    : buildArchitectPrompt(payload, discoveryMode);
  const architectPrompt = `${architectBase}${discovery.discovery.appendix}`;
  const executionBase: Omit<ExecutionRequest, 'prompt' | 'executionId' | 'attemptId'> = {
    taskId: `create-plan:${request.client_request_id}`,
    runId: ARCHITECT_EXECUTION_PREFIX,
    workingDirectory: options.canonicalRepoPath,
    requestedModel: requestedModel ?? undefined,
    ...(payload.requestedRouting?.reasoningEffort ? { reasoningEffort: payload.requestedRouting.reasoningEffort } : {}),
    permissionProfile: 'read-only-reviewer',
    timeoutMs: ARCHITECT_TIMEOUT_MS,
  };

  let resolved;
  try {
    resolved = await resolveArchitectPlan({
      prompt: architectPrompt,
      scope: payload.scope,
      constraints: inherited?.constraints ?? payload.constraints,
      provider,
      executionIntent: boundPack?.roadmapPhases.find((phase) => phase.id === payload.scopePackPhaseId)?.executionIntent,
      execute: async (turn) => {
        const turnId = `${executionId}:${turn.executionId}`;
        return adapter.execute({
          ...executionBase,
          executionId: turnId,
          attemptId: turnId,
          prompt: turn.prompt,
        });
      },
      onStatus: async (line) => {
        if (controlPlane.notePlanningProgress) {
          await controlPlane.notePlanningProgress(request.id, { planningStatus: line });
        }
      },
    });
  } catch (error) {
    await controlPlane.failRequest(
      request.id,
      `Architect provider execution failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, REQUEST_ERROR_LIMIT),
    );
    return;
  }

  if (!resolved.ok) {
    await controlPlane.failRequest(
      request.id,
      resolved.ownerMessage.slice(0, REQUEST_ERROR_LIMIT),
      { planValidation: resolved.validation },
    );
    return;
  }
  const parsed = resolved;

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
      task.validationRequirements = [...task.validationRequirements, ...extra];
    }
  }

  if (payload.roleRouting) {
    parsed.result.plan = applyOwnerRoleModels(parsed.result.plan, payload.roleRouting);
    parsed.result.planHash = computePlanHash(parsed.result.plan);
  }

  await controlPlane.completeRequest(request.id, {
    planId: parsed.result.plan.planId,
    planHash: parsed.result.planHash,
    plan: planForPublish(parsed.result.plan),
    architect: parsed.result.architect,
    planValidation: resolved.validation,
    planningEvidence: discovery.discovery.available
      ? {
          usedCache: discovery.discovery.usedCache,
          candidateFiles: discovery.discovery.candidateFiles.length,
          inspectedFiles: discovery.discovery.inspectedFiles,
        }
      : null,
    planRevision: {
      version: resolved.validation.repairAttempt + 1,
      changes: resolved.validation.repairAttempt > 0
        ? resolved.validation.issues.slice(0, 8).map((issue) => `${issue.field}: ${issue.code}`)
        : [],
    },
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
      ...(task.verificationCommands ? { verificationCommands: task.verificationCommands } : {}),
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

  const sourcePayload = planRow.payload && typeof planRow.payload === 'object' ? planRow.payload : null;
  const ownerScope = sourcePayload && typeof sourcePayload.scope === 'string' ? sourcePayload.scope : '';
  const ownerConstraints = sourcePayload && Array.isArray(sourcePayload.constraints)
    ? sourcePayload.constraints.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
  const constraints = [...plan.constraints];
  for (const constraint of ownerConstraints) {
    if (!constraints.includes(constraint)) constraints.push(constraint);
  }
  const planForTasks: ControlPlan = { ...plan, constraints, ...(ownerScope ? { ownerScope } : {}) };

  // The Architect identity from the approved plan result is carried on every
  // task spec.plan so the snapshot can publish it as run-level truth (an
  // Architect role node can render provider/model/effort even with no Architect
  // execution tasks). Only added when a valid provider exists; never copies the
  // requested model into the reported slot.
  const architectForRun = validatePlanArchitectIdentity(planRow.result, options.roleEffort?.architect ?? null);

  // Build every task spec first. An oversized spec must fail before any run row exists.
  const prepared = planForTasks.tasks.map((task, index) => {
    const taskId = `${plan.planId}:${task.clientTaskKey}`;
    const spec: TaskControlSpec & { workingDirectory: string; plan: Record<string, unknown> } = {
      control: {
        provider: task.provider,
        requestedModel: task.requestedModel,
        reasoningEffort: options.roleEffort?.[task.role] ?? null,
        permissionProfile: task.permissionProfile,
        prompt: buildTaskPrompt(task, planForTasks),
        timeoutMs: DEFAULT_TASK_TIMEOUT_MS,
      },
      policy: {
        authorizedWritePaths: task.authorizedWritePaths,
        doNotTouchPaths: extractDoNotTouchPaths(
          planForTasks.constraints
            .filter((constraint) => constraint.startsWith('DO_NOT_TOUCH: '))
            .map((constraint) => constraint.slice('DO_NOT_TOUCH: '.length)),
        ),
      },
      workingDirectory: options.canonicalRepoPath,
      plan: {
        clientTaskKey: task.clientTaskKey,
        role: task.role,
        plannedAreas: task.plannedAreas,
        ...(task.verificationCommands ? { verificationCommands: task.verificationCommands } : {}),
        ...(architectForRun ? { architect: architectForRun } : {}),
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
    return { task, index, taskId, spec };
  });
  for (const item of prepared) {
    try {
      assertOptionalJsonWithinLimit(item.spec as unknown as JsonValue, 'spec', TASK_SPEC_MAX_BYTES);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await controlPlane.failRequest(
        request.id,
        `TASK_SPEC_TOO_LARGE: ${detail}`.slice(0, REQUEST_ERROR_LIMIT),
      );
      return { ok: false, runId: null, safeError: 'TASK_SPEC_TOO_LARGE' };
    }
  }

  const existingTasks = prepared.map((item) => store.getTask(item.taskId));
  if (existingTasks.every((task) => task !== null)) {
    const runIds = new Set(existingTasks.map((task) => task!.runId));
    if (runIds.size === 1) {
      const existingRunId = [...runIds][0]!;
      const existingRun = store.getRun(existingRunId);
      if (existingRun && existingRun.status !== 'cancelled' && existingRun.status !== 'failed') {
        await controlPlane.completeRequest(request.id, { runId: existingRunId, planId, planHash });
        return { ok: true, runId: existingRunId, safeError: null };
      }
    }
  }

  if (controlPlane.notePlanningProgress) {
    try {
      await controlPlane.notePlanningProgress(request.id, { approvalStatus: 'Creating run' });
    } catch {
      // Approval progress is observational. Creation still proceeds.
    }
  }

  // Durable creation through the EXISTING store APIs — never direct table edits.
  const runId = `run-${randomUUID()}`;
  try {
    store.createRun({ runId, title: plan.objective.slice(0, 512), goal: plan.objective });
    const taskIdByClientKey = new Map<string, string>();
    for (const item of prepared) {
      store.createTask({
        taskId: item.taskId,
        runId,
        title: item.task.title.slice(0, 512),
        goal: item.task.goal,
        position: item.index,
        spec: item.spec as unknown as JsonValue,
      });
      taskIdByClientKey.set(item.task.clientTaskKey, item.taskId);
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
  } catch (error) {
    const created = store.getRun(runId);
    if (created?.status === 'pending') {
      try {
        store.transitionRun(runId, 'cancelled');
      } catch {
        // The creation error remains the owner-facing failure.
      }
    }
    const detail = error instanceof Error ? error.message : String(error);
    await controlPlane.failRequest(
      request.id,
      `APPROVE_CREATE_FAILED: ${detail}`.slice(0, REQUEST_ERROR_LIMIT),
    );
    return { ok: false, runId: null, safeError: 'APPROVE_CREATE_FAILED' };
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
  /**
   * Mark the live in-memory cancel signal for this run (CT-REL-3). The durable
   * intent is always recorded here regardless; this only speeds the running
   * drive's read. Optional so simple callers/tests need not wire it.
   */
  markCancelRequested?: ((runId: string) => void) | undefined;
  /**
   * Abort the run's currently-running Attempt(s) through the executor's existing
   * cancel path (adapter.cancel → tree kill) and record owner-cancel evidence.
   * Optional; absent → no live Attempt to abort (e.g. a pending or idle run).
   */
  abortRunAttempts?: ((runId: string) => void) | undefined;
  /**
   * True when a background drive is actively driving this run. When true, that
   * drive is the sole authority that finalizes the Run (after the aborted Attempt
   * returns), so this handler does NOT finalize — it only records intent + aborts.
   * When false/absent, this handler finalizes immediately (idempotent).
   */
  isActivelyDriving?: ((runId: string) => boolean) | undefined;
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
  // Exactly-one-terminal-outcome (goal 3): a run that already reached a terminal
  // state — including one that completed a heartbeat before this cancel was
  // claimed — cannot be cancelled. Duplicate cancels are naturally idempotent
  // (the first transitions the run; the rest see it terminal here).
  if (RUN_TERMINAL_STATUS_SET.has(run.status)) {
    await controlPlane.failRequest(request.id, `RUN_ALREADY_TERMINAL: ${runId} is ${run.status}.`);
    return;
  }

  // A2: record the owner's intent DURABLY before aborting anything, so a crash
  // between here and finalization still ends the run cancelled on restart.
  recordRunCancelIntent(store, runId);
  options.markCancelRequested?.(runId);
  // Abort the live provider turn (if any) through the executor's tree kill.
  options.abortRunAttempts?.(runId);

  // A run actively being driven is finalized by that drive once the aborted
  // Attempt returns (single authority). A pending/idle run has no drive to
  // finalize it, so do it here. finalizeRunCancellation is idempotent either way.
  if (!(options.isActivelyDriving?.(runId) ?? false)) {
    finalizeRunCancellation(store, runId);
  }

  await controlPlane.completeRequest(request.id, { runId, status: 'cancelling' });
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
  /**
   * CT-REL-3: live owner-cancellation signal for THIS run. Passed to supervisorTick
   * (read at run-evaluate time so a cancel arriving mid-tick cancels, never fails,
   * the run) and checked by this loop so it exits and finalizes promptly.
   */
  isCancellationRequested?: (() => boolean) | undefined;
}): Promise<void> {
  const { store, executionPort, runId } = options;
  const tickIntervalMs = options.tickIntervalMs ?? SUPERVISOR_TICK_INTERVAL_MS;
  const heartbeatMs = options.snapshotHeartbeatMs ?? ACTIVE_SNAPSHOT_HEARTBEAT_MS;
  const isCancellationRequested = options.isCancellationRequested ?? (() => false);

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
        cancellationRequested: isCancellationRequested,
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
    // CT-REL-3: if an owner cancel is in effect, ensure the run is finalized and
    // every remaining non-terminal Task is swept (idempotent; a normal terminal
    // outcome that already won is preserved by the terminal-first check).
    if (isCancellationRequested()) {
      finalizeRunCancellation(store, runId);
      try {
        await options.publishSnapshot(runId);
      } catch {
        // The run's durable state is authoritative; snapshot retry is best-effort.
      }
    }
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

    // A2: a Run carrying a durable owner cancel intent from a previous session is
    // FINALIZED (tasks cancelled, Run → cancelled), never resumed — nothing is
    // re-executed. The intent survived the crash in the events table.
    if (hasRunCancelIntent(store, runId)) {
      finalizeRunCancellation(store, runId);
      try {
        await options.publishSnapshot(runId);
      } catch {
        // Durable state is authoritative; snapshot retry is best-effort.
      }
      resumedRunIds.push(runId);
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
  const providerLimits = configureProviderExecutionLimits(process.env, (message) => {
    process.stderr.write(`[provider limits] ${message}\n`);
  });
  process.stderr.write(`[provider limits] startup=${providerLimits.startupTimeoutMs}ms inactivity=${providerLimits.idleTimeoutMs}ms ceiling=${providerLimits.overallTimeoutMs}ms\n`);

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

  // CT-REL-2 Part B (goal 8): daily Host log files under
  // %LOCALAPPDATA%\PowerOn\AgentHost\logs — never inside the repo. Errors are
  // rate-limited (amendment 4); only sanitized summaries are ever logged.
  const logger = createHostLog({ dir: path.join(statePaths.baseDir, 'logs') });

  // Created after discovery below, with the REAL provider registry — the same
  // construction path dispatch.ts uses (adapter dispatch, isolated workspace
  // config, policy adjudication).
  let executor: AttemptExecutor;

  /** The actual snapshot read + publish. May throw; only ever run by the publisher below. */
  const publishSnapshotNow = async (runId: string): Promise<void> => {
    const snapshot = buildRunSnapshot({
      store,
      runId,
      verification: executionPort.getVerifierVerdict(runId),
    });
    if (!snapshot) {
      return;
    }
    if (snapshot.candidateApply.attemptId) {
      try {
        const index = await readCandidateChangeIndex({
          workspaceRoot: path.join(statePaths.baseDir, 'workspaces'),
          identity: { repoKey: statePaths.repoKey, runId, attemptId: snapshot.candidateApply.attemptId },
        });
        if (index) applyChangeIndexToSnapshot(snapshot, index);
      } catch {
        // A missing change index leaves the event-derived list. Apply fails closed later.
      }
    }
    for (const attempt of snapshot.attempts) {
      if (!attempt.hostChecks?.length) continue;
      const events = store.listEvents().filter((event) => event.attemptId === attempt.attemptId && event.type === 'verification.host_check.completed').slice(0, 8);
      for (const [index, check] of attempt.hostChecks.entries()) {
        const event = events[index];
        const payload = event?.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) ? event.payload as Record<string, unknown> : null;
        if (!payload || typeof payload.outputSha256 !== 'string' || typeof payload.outputSizeBytes !== 'number') continue;
        try {
          const attemptPath = resolveAttemptWorkspacePath({ workspaceRoot: path.join(statePaths.baseDir, 'workspaces'), identity: { repoKey: statePaths.repoKey, runId, attemptId: attempt.attemptId } });
          const bytes = await readFile(`${attemptPath}.host-check-${index + 1}.txt`);
          if (bytes.length > 40_000 || bytes.length !== payload.outputSizeBytes || createHash('sha256').update(bytes).digest('hex') !== payload.outputSha256) continue;
          check.boundedOutput = bytes.toString('utf8');
        } catch {
          // Metadata stays visible when a sidecar is unavailable.
        }
      }
    }
    await controlPlane.publishRunSnapshot({
      runId,
      objective: snapshot.run.objective,
      status: snapshot.run.status,
      snapshot: snapshot as unknown as Record<string, unknown>,
    });
  };

  // CT-REL-2 amendment 2: latest-wins snapshot publishing keyed by run id. A
  // superseded pending publish is DROPPED, never queued, and publishing never
  // blocks provider execution or the claim loop — publishSnapshot below resolves
  // immediately and the latest job runs at most once per run id at a time.
  // Retries live inside the control-plane call (bounded by the 60s budget).
  const snapshotPublisher = createLatestWinsPublisher({
    onError: (error) => {
      logger.error(`Run snapshot publish failed: ${error instanceof Error ? error.message : String(error)}`);
    },
  });
  const publishSnapshot = async (runId: string): Promise<void> => {
    snapshotPublisher.publish(runId, () => publishSnapshotNow(runId));
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
    hostLog: logger,
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
  // Frozen at process start: later source edits must not look like this process loaded them.
  const hostSourceFingerprint = computeAgentHostSourceFingerprint(canonicalRepoPath);

  // CT-REL-2 Part A (goals 2-3): the Host is the single source of truth for
  // staleness. Every SOURCE_FINGERPRINT_RECHECK_MS (30s) it re-hashes its own
  // source; a difference vs. the startup fingerprint means THIS process is
  // running older code. The flag is sticky — only a restart clears it. While
  // set, presence carries restartRequired + detection time and NEW
  // create_plan / approve_plan requests are refused with HOST_RESTART_REQUIRED.
  let restartRequired = false;
  let restartDetectedAt: string | null = null;
  const buildPresenceProviders = (): unknown[] => [
    ...providerFleet,
    buildHostStatusMarker({
      sourceFingerprint: hostSourceFingerprint,
      restartRequired,
      restartDetectedAt,
      health: controlPlane.getHealth(),
    }),
  ];
  const sourceFingerprintWatch = startSourceFingerprintWatch({
    repoRoot: canonicalRepoPath,
    initialFingerprint: hostSourceFingerprint,
    intervalMs: SOURCE_FINGERPRINT_RECHECK_MS,
    onDrift: (drift) => {
      restartRequired = true;
      restartDetectedAt = drift.detectedAt;
      logger.error(`Agent Host source changed since startup (detected ${drift.detectedAt}) — Host restart required.`);
    },
    onError: (error) => {
      logger.error(`Source fingerprint recheck failed: ${error instanceof Error ? error.message : String(error)}`);
    },
  });

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
        // Built fresh each publish so a drift detected since the last tick is
        // carried immediately (goal 2) and health reflects the newest calls.
        await controlPlane.publishPresence({ providers: buildPresenceProviders() });
      } catch (error) {
        // Best effort — the local heartbeat file remains the host truth. The
        // health tracker already counted this failure; it surfaces through the
        // marker once connectivity returns.
        logger.error(`Presence publish failed: ${error instanceof Error ? error.message : String(error)}`);
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

  // CT-REL-2 amendment 3 + CT-REL-2.1 goal 1: track every request id THIS
  // instance HOLDS (the whole claim batch from receipt, released only when
  // handling finishes), and periodically fail rows claimed by THIS instance
  // that are NOT held and have been claimed for more than
  // LOST_CLAIM_THRESHOLD_MS (120s) — a claim whose RPC response was lost.
  // Never re-executed; failed with the exact HOST_CLAIM_LOST message. A
  // recovered row is poisoned locally so it can never be dispatched later.
  const heldRequestIds = createHeldRequestTracker();
  const lostClaimTimer = setInterval(() => {
    if (shutdownStarted) {
      return;
    }
    void (async () => {
      await recoverLostClaims({
        listOwnClaimed: () => controlPlane.listOwnClaimedRequests(),
        isHeld: heldRequestIds.isHeld,
        failRequest: (id, error) => controlPlane.failRequest(id, error),
        onRecovered: (id) => {
          heldRequestIds.markPoisoned(id);
          logger.error(`Recovered lost control request ${id} — ${HOST_CLAIM_LOST_MESSAGE}`);
        },
        onError: (error) => {
          logger.error(`Lost-claim recovery failed: ${error instanceof Error ? error.message : String(error)}`);
        },
      });
    })();
  }, LOST_CLAIM_CHECK_INTERVAL_MS);
  if (typeof lostClaimTimer.unref === 'function') {
    lostClaimTimer.unref();
  }

  /* ---------------------------------------------------------------------- */
  /* CT-REL-3: responsive cancellation + orphan sweep wiring                 */
  /* ---------------------------------------------------------------------- */

  // Durable owner-cancellation. The in-memory set is the FAST live signal read
  // by an active drive; the durable RUN_CANCEL_REQUESTED event (events table) is
  // the persistent fact, seeded here so a cancel that survived a crash is honored.
  const cancelRequestedRuns = new Set<string>();
  for (const existingRun of store.listRuns()) {
    if (hasRunCancelIntent(store, existingRun.runId)) {
      cancelRequestedRuns.add(existingRun.runId);
    }
  }
  const isRunCancelRequested = (runId: string): boolean => cancelRequestedRuns.has(runId);

  // The run currently owned by the single background drive slot, so cancel_run
  // knows whether that drive (its sole authority) will finalize the run.
  let activeDriveRunId: string | null = null;

  // Abort the run's currently-running Attempt(s) through the executor's existing
  // tree-kill cancel path, recording owner-cancel evidence for the safe snapshot.
  const abortRunAttempts = (runId: string): void => {
    for (const task of store.listTasks(runId)) {
      for (const attempt of store.listAttempts(task.taskId)) {
        if (attempt.status === 'running') {
          recordOwnerCancelEvidence(store, runId, task.taskId, attempt.attemptId);
          try {
            executor.cancel(attempt.attemptId);
          } catch {
            // Best-effort; the durable intent + finalizer still cancel the run.
          }
        }
      }
    }
  };

  const handleCancel = async (request: ClaimedControlRequest): Promise<void> => {
    await handleCancelRun({
      store,
      controlPlane,
      request,
      markCancelRequested: (runId) => cancelRequestedRuns.add(runId),
      abortRunAttempts,
      isActivelyDriving: (runId) => activeDriveRunId === runId,
    });
    const runId = (request.payload as Record<string, unknown>).runId;
    if (typeof runId === 'string') {
      try {
        await publishSnapshot(runId);
      } catch {
        // Cancel snapshot is best effort; the durable run state is authoritative.
      }
    }
  };

  const dispatchNonCancel = async (request: ClaimedControlRequest): Promise<void> => {
    // CT-REL-2 Part A (goal 3) / CT-REL-3: the restart gate is applied at DISPATCH
    // time, so a queued create_plan / approve_plan is refused with
    // HOST_RESTART_REQUIRED if the Host became stale while the row waited.
    if (await gateRestartRequiredRequest({
      request,
      restartRequired,
      failRequest: (id, error) => controlPlane.failRequest(id, error),
    })) {
      return;
    }
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
        orientationCachePath: path.join(statePaths.repoStateDir, 'repo-orientation.json'),
        organizationId: config.organizationId,
      });
    } else if (request.request_type === 'approve_plan') {
      const outcome = await handleApprovePlan({ store, controlPlane, request, canonicalRepoPath });
      if (outcome.ok && outcome.runId) {
        const driveRunId = outcome.runId;
        activeDriveRunId = driveRunId;
        try {
          await driveRunToCompletion({
            store,
            controlPlane,
            executionPort,
            runId: driveRunId,
            hostInstanceId: instanceIdentity.instanceId,
            publishSnapshot,
            onSnapshotError,
            isCancellationRequested: () => isRunCancelRequested(driveRunId),
          });
        } catch (error) {
          await eventWriter.append('control.run.error', {
            runId: driveRunId,
            message: error instanceof Error ? error.message : String(error),
          });
          try {
            await publishSnapshot(driveRunId);
          } catch {
            // Snapshot already attempted; nothing else is publishable here.
          }
        } finally {
          activeDriveRunId = null;
        }
      }
    } else if (request.request_type === 'apply_candidate') {
      await handleApplyCandidate({
        store,
        controlPlane,
        request,
        canonicalRepoPath,
        workspaceRoot: path.join(statePaths.baseDir, 'workspaces'),
        repoKey: statePaths.repoKey,
      });
      const runId = request.payload.runId;
      if (typeof runId === 'string') {
        try {
          await publishSnapshot(runId);
        } catch {
          // Apply result is already durable on the control request.
        }
      }
    } else {
      await controlPlane.failRequest(request.id, `UNKNOWN_REQUEST_TYPE: ${String(request.request_type)}`);
    }
  };

  // A4: factual queued status through the existing per-request result channel.
  const publishQueuedStatus = async (request: ClaimedControlRequest): Promise<void> => {
    if (!controlPlane.notePlanningProgress) {
      return;
    }
    try {
      await controlPlane.notePlanningProgress(request.id, { queuedStatus: QUEUED_STATUS_MESSAGE });
    } catch {
      // Queued-status publishing is observational only.
    }
  };

  // CT-REL-3 goal 1: the single-slot scheduler. cancel_run bypasses the FIFO;
  // every other type runs one-at-a-time in the background so the claim loop is
  // never blocked and a cancel is dispatched within one poll.
  const scheduler = new ControlRequestScheduler({
    held: heldRequestIds,
    isRunning: () => running,
    log: logger,
    handleCancel,
    dispatchNonCancel,
    failRequest: (id, error) => controlPlane.failRequest(id, error),
    onQueued: publishQueuedStatus,
  });

  // CT-REL-3 goal 6: previous-Host orphan-claim sweep — startup + every 60s.
  const runOrphanSweep = async (): Promise<void> => {
    await sweepOrphanClaims({
      listForeignClaimed: () => controlPlane.listForeignClaimedRequests(),
      listPresence: () => controlPlane.listRepoPresence(),
      failRequest: (id, error) => controlPlane.failRequest(id, error),
      onRecovered: (id) => logger.error(`Swept orphaned control request ${id} — ${HOST_CLAIM_ORPHAN_MESSAGE}`),
      onError: (error) => logger.error(`Orphan-claim sweep failed: ${error instanceof Error ? error.message : String(error)}`),
    });
  };
  const orphanSweepTimer = setInterval(() => {
    if (shutdownStarted) {
      return;
    }
    void runOrphanSweep();
  }, ORPHAN_SWEEP_INTERVAL_MS);
  if (typeof orphanSweepTimer.unref === 'function') {
    orphanSweepTimer.unref();
  }

  /**
   * CT-REL-2 Part B (goal 8): `forcedExitCode` exists so an uncaughtException
   * exits NON-ZERO even when graceful shutdown succeeds.
   */
  const shutdown = async (signal: string, forcedExitCode?: number): Promise<void> => {
    if (shutdownStarted) {
      return;
    }
    shutdownStarted = true;
    running = false;
    clearInterval(presenceTimer);
    clearInterval(heartbeatTimer);
    clearInterval(lostClaimTimer);
    clearInterval(orphanSweepTimer);
    sourceFingerprintWatch.stop();
    controlPlane.abort(); // cut in-flight retries short immediately
    try {
      await shutdownHostRuntime({
        refreshRepoStatusIfNeeded,
        writeCurrentHeartbeat,
        appendLifecycleEvent: (type, data) => eventWriter.append(type, data).then(() => undefined),
        // A3: abort the in-flight Attempt through the executor, then drain the
        // single background job slot within a bound so the loop never hangs.
        executorShutdown: async () => {
          await executor.shutdown();
          await scheduler.drain(SCHEDULER_DRAIN_TIMEOUT_MS);
        },
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
      logger.error(`Shutdown failed (${signal}): ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
    if (forcedExitCode !== undefined) {
      process.exitCode = forcedExitCode;
    }
    logger.flush();
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  // CT-REL-2 Part B (goal 8): an unhandledRejection is LOGGED and the Host keeps
  // running; an uncaughtException is logged, then shuts down with a FORCED
  // non-zero exit code.
  process.on('uncaughtException', (error) => {
    void handleUncaughtException({ log: logger, error, shutdown });
  });
  process.on('unhandledRejection', (reason) => {
    handleUnhandledRejection(logger, reason);
  });

  await controlPlane.publishPresence({ providers: buildPresenceProviders() });

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

  // CT-REL-3 goal 6: one orphan sweep at startup, before ordinary polling, so a
  // request stuck 'claimed' by a previous (dead) Host is cleared to a resubmit
  // prompt instead of an endless browser spinner.
  void runOrphanSweep();

  // CT-REL-3 goal 1: the claim loop NEVER blocks on execution. Every poll it
  // claims pending rows and hands them to the scheduler, which handles cancel_run
  // inline and runs every other type one-at-a-time in a single background slot.
  // A cancel_run submitted mid-run is therefore claimed and dispatched within one
  // poll (~seconds), no matter how long the active run takes.
  let claimFailureStreak = 0;
  while (running) {
    let claimed: ClaimedControlRequest[] = [];
    try {
      claimed = await controlPlane.claimPendingRequests();
      claimFailureStreak = 0;
    } catch (error) {
      claimFailureStreak += 1;
      logger.error(`Control-plane claim failed: ${error instanceof Error ? error.message : String(error)}`);
      // CT-REL-2 Part B (goal 6): bounded backoff with jitter so a connectivity
      // outage does not hammer the control plane. Still polls at least at the
      // normal cadence.
      await sleep(Math.max(CLAIM_POLL_INTERVAL_MS, jitteredBackoffDelay(claimFailureStreak - 1)));
      continue;
    }

    if (claimed.length > 0) {
      // offer() holds every row on receipt (lost-claim safety), routes cancel_run
      // inline, enqueues the rest, and pumps the single job slot. Only the fast
      // inline cancel handling is awaited here; background jobs run detached.
      await scheduler.offer(claimed);
    }

    // Always poll at the normal cadence — even while a run executes — so cancels
    // stay responsive. The scheduler keeps the run serial in its background slot.
    await sleep(CLAIM_POLL_INTERVAL_MS);
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
