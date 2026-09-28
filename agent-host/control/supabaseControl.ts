/**
 * CT-CORE-1: Supabase control-plane client for the local Host worker.
 *
 * Server-side ONLY. This module runs inside the local Node worker process and
 * authenticates with the server-side service role key from the environment
 * (.env.local — no VITE_ prefix, so Vite never bundles it). The key is never
 * passed to provider child processes and never logged.
 *
 * Everything the browser reads/writes goes through the RLS policies from
 * migration 135. Everything here goes through the service role, and this module
 * additionally filters every operation by the Host's own organization_id +
 * repo_key (fail closed for anything else).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { packFromRow, packToRowJson, type ScopePackContract, type ScopePackStore } from './scopePack.ts';
import { withRetry } from './retry.ts';

/**
 * CT-REL-2 Part B (goal 7 + amendment 1): Host-reported control-plane health.
 *   - degraded = DEGRADED_CONSECUTIVE_FAILURES (3) consecutive failed
 *     attempts, OR a retry-budget give-up within DEGRADED_GIVE_UP_WINDOW_MS.
 *   - any success resets the consecutive-failure streak.
 */
export const DEGRADED_CONSECUTIVE_FAILURES = 3;
export const DEGRADED_GIVE_UP_WINDOW_MS = 60_000;

export interface ControlPlaneHealthSnapshot {
  state: 'healthy' | 'degraded';
  consecutiveFailures: number;
  lastFailureAt: string | null;
}

export class ControlPlaneHealthTracker {
  private consecutiveFailures = 0;
  private lastFailureAtMs: number | null = null;
  private lastGiveUpAtMs: number | null = null;

  noteAttemptFailure(now: number = Date.now()): void {
    this.consecutiveFailures += 1;
    this.lastFailureAtMs = now;
  }

  noteSuccess(): void {
    // CT-REL-2.1 goal 2: a success also clears any retry-budget give-up, so
    // health returns to healthy as soon as calls succeed again — not only
    // after the 60s give-up window decays.
    this.consecutiveFailures = 0;
    this.lastGiveUpAtMs = null;
  }

  noteGiveUp(now: number = Date.now()): void {
    this.lastGiveUpAtMs = now;
  }

  getHealth(now: number = Date.now()): ControlPlaneHealthSnapshot {
    const degraded =
      this.consecutiveFailures >= DEGRADED_CONSECUTIVE_FAILURES
      || (this.lastGiveUpAtMs !== null && now - this.lastGiveUpAtMs <= DEGRADED_GIVE_UP_WINDOW_MS);
    return {
      state: degraded ? 'degraded' : 'healthy',
      consecutiveFailures: this.consecutiveFailures,
      lastFailureAt: this.lastFailureAtMs !== null ? new Date(this.lastFailureAtMs).toISOString() : null,
    };
  }
}

export interface ControlPlaneConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  organizationId: string;
  repoKey: string;
  hostInstanceId: string;
  hostVersion: string;
}

export class ControlPlaneConfigError extends Error {
  constructor(missing: string) {
    super(`Control plane requires ${missing} in the environment. The control worker cannot start without it.`);
    this.name = 'ControlPlaneConfigError';
  }
}

export function resolveControlPlaneConfigFromEnv(options: {
  env?: Record<string, string | undefined>;
  repoKey: string;
  hostInstanceId: string;
  hostVersion: string;
}): ControlPlaneConfig {
  const env = options.env ?? process.env;
  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const organizationId = env.POWERON_CONTROL_ORG_ID;

  if (!supabaseUrl) {
    throw new ControlPlaneConfigError('SUPABASE_URL');
  }
  if (!serviceRoleKey) {
    throw new ControlPlaneConfigError('SUPABASE_SERVICE_ROLE_KEY');
  }
  if (!organizationId) {
    throw new ControlPlaneConfigError('POWERON_CONTROL_ORG_ID');
  }

  return {
    supabaseUrl,
    serviceRoleKey,
    organizationId,
    repoKey: options.repoKey,
    hostInstanceId: options.hostInstanceId,
    hostVersion: options.hostVersion,
  };
}

export interface ClaimedControlRequest {
  id: string;
  repo_key: string;
  request_type: 'create_plan' | 'approve_plan' | 'cancel_run' | 'import_scope_pack' | 'apply_candidate';
  client_request_id: string;
  payload: Record<string, unknown>;
  status: string;
  created_at: string;
}

export interface SafePresenceRow {
  repo_key: string;
  host_instance_id: string;
  status: string;
  host_version: string | null;
  providers: string[];
  last_seen_at: string;
}

export class ControlPlane implements ScopePackStore {
  private readonly client: SupabaseClient;
  private readonly config: ControlPlaneConfig;
  private readonly health = new ControlPlaneHealthTracker();
  private readonly retryAbort = new AbortController();

  constructor(config: ControlPlaneConfig, client?: SupabaseClient) {
    this.config = config;
    // The optional client is a TEST seam (fakes only); production always
    // builds its own service-role client.
    this.client = client ?? createClient(config.supabaseUrl, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  /** Stop waiting on in-flight retries immediately (shutdown). */
  abort(): void {
    this.retryAbort.abort();
  }

  getHealth(now: number = Date.now()): ControlPlaneHealthSnapshot {
    return this.health.getHealth(now);
  }

  /**
   * CT-REL-2 Part B (goal 6): every control-plane call runs through bounded
   * exponential backoff with jitter (1s base, 30s per-delay cap, 60s total
   * budget) and reports each failed attempt, each give-up, and each success
   * to the health tracker (a success resets the streak and clears any give-up
   * — CT-REL-2.1 goal 2). EVERY call below is idempotent — an upsert on a
   * conflict key, a status-guarded UPDATE, a unique-constrained INSERT with a
   * 23505 fallback, or a read — so all of them may be retried. The literal
   * `true` argument keeps that classification explicit and testable per call
   * site; a non-idempotent operation would be refused by withRetry before
   * running.
   */
  private async call<T>(idempotent: true, operation: () => Promise<T>): Promise<T> {
    return await withRetry({
      idempotent,
      attempt: operation,
      signal: this.retryAbort.signal,
      onAttemptFailure: (): void => {
        this.health.noteAttemptFailure();
      },
      onGiveUp: (): void => {
        this.health.noteGiveUp();
      },
      onSuccess: (): void => {
        this.health.noteSuccess();
      },
    });
  }

  /**
   * Upsert the Host presence heartbeat. Fresh row = Connected (§6).
   *
   * `providers` is the SAFE provider fleet (ATB-2) — provider/model capability
   * objects with NO executable/filesystem paths, tokens, env, or raw CLI output.
   * Older Hosts published a plain string[] of names; both shapes are tolerated by
   * the browser adapter.
   */
  async publishPresence(options: { providers: unknown[]; status?: 'connected' | 'stale' }): Promise<void> {
    await this.call(true, async () => {
      const { error } = await this.client.from('agent_host_presence').upsert(
        {
          organization_id: this.config.organizationId,
          repo_key: this.config.repoKey,
          host_instance_id: this.config.hostInstanceId,
          status: options.status ?? 'connected',
          host_version: this.config.hostVersion,
          providers: options.providers,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'organization_id,repo_key,host_instance_id' },
      );
      if (error) {
        throw new Error(`Failed to publish presence: ${error.message}`);
      }
    });
  }

  /**
   * Atomically claim pending requests for THIS org + THIS repo only (§9).
   * The RPC uses UPDATE ... WHERE status='pending' with FOR UPDATE SKIP LOCKED,
   * so a request can never be claimed (or executed) twice.
   */
  async claimPendingRequests(limit: number = 10): Promise<ClaimedControlRequest[]> {
    return await this.call(true, async () => {
      const { data, error } = await this.client.rpc('claim_agent_control_requests', {
        p_organization_id: this.config.organizationId,
        p_repo_keys: [this.config.repoKey],
        p_host_instance_id: this.config.hostInstanceId,
        p_limit: limit,
      });
      if (error) {
        throw new Error(`Failed to claim control requests: ${error.message}`);
      }
      return (data ?? []) as ClaimedControlRequest[];
    });
  }

  async completeRequest(requestId: string, result: Record<string, unknown>): Promise<void> {
    await this.call(true, async () => {
      const { error } = await this.client
        .from('agent_control_requests')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          result,
          error: null,
        })
        .eq('id', requestId)
        .eq('organization_id', this.config.organizationId)
        .eq('repo_key', this.config.repoKey)
        .eq('status', 'claimed');
      if (error) {
        throw new Error(`Failed to complete control request ${requestId}: ${error.message}`);
      }
    });
  }

  async notePlanningProgress(requestId: string, progress: Record<string, unknown>): Promise<void> {
    await this.call(true, async () => {
      const { error } = await this.client
        .from('agent_control_requests')
        .update({ result: progress })
        .eq('id', requestId)
        .eq('organization_id', this.config.organizationId)
        .eq('repo_key', this.config.repoKey)
        .eq('status', 'claimed');
      if (error) {
        throw new Error(`Failed to record planning progress for ${requestId}: ${error.message}`);
      }
    });
  }

  async failRequest(requestId: string, safeError: string, result?: Record<string, unknown>): Promise<void> {
    await this.call(true, async () => {
      const { error } = await this.client
        .from('agent_control_requests')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error: safeError.slice(0, 1_000),
          ...(result ? { result } : {}),
        })
        .eq('id', requestId)
        .eq('organization_id', this.config.organizationId)
        .eq('repo_key', this.config.repoKey)
        .eq('status', 'claimed');
      if (error) {
        throw new Error(`Failed to fail control request ${requestId}: ${error.message}`);
      }
    });
  }

  /**
   * CT-REL-2 amendment 3: rows claimed by THIS Host instance that are still in
   * status 'claimed' (the owner of the claim RPC response is lost cases). The
   * lost-claim recovery fails any of these the Host is no longer processing;
   * they are never re-executed. Attribution is by the existing claimed_by_host
   * column — no schema change.
   */
  async listOwnClaimedRequests(): Promise<Array<{ id: string; client_request_id: string; claimed_at: string | null }>> {
    return await this.call(true, async () => {
      const { data, error } = await this.client
        .from('agent_control_requests')
        .select('id,client_request_id,claimed_at')
        .eq('organization_id', this.config.organizationId)
        .eq('repo_key', this.config.repoKey)
        .eq('claimed_by_host', this.config.hostInstanceId)
        .eq('status', 'claimed');
      if (error) {
        throw new Error(`Failed to list own claimed control requests: ${error.message}`);
      }
      return (data ?? []) as Array<{ id: string; client_request_id: string; claimed_at: string | null }>;
    });
  }

  /** Find the completed create_plan request that produced a plan id (same org). */
  async findPlanByPlanId(planId: string): Promise<{ result: Record<string, unknown>; payload: Record<string, unknown> | null } | null> {
    return await this.call(true, async () => {
      const { data, error } = await this.client
        .from('agent_control_requests')
        .select('result, payload')
        .eq('organization_id', this.config.organizationId)
        .eq('repo_key', this.config.repoKey)
        .eq('request_type', 'create_plan')
        .eq('status', 'completed')
        .contains('result', { planId })
        .limit(1);
      if (error) {
        throw new Error(`Failed to look up plan ${planId}: ${error.message}`);
      }
      const first = (data ?? [])[0] as { result: Record<string, unknown>; payload?: Record<string, unknown> | null } | undefined;
      if (!first) return null;
      return { result: first.result, payload: first.payload ?? null };
    });
  }

  /** Upsert the safe run snapshot (§29). Local Host store stays the authority. */
  async publishRunSnapshot(options: {
    runId: string;
    objective: string | null;
    status: string;
    snapshot: Record<string, unknown>;
  }): Promise<void> {
    await this.call(true, async () => {
      const { error } = await this.client.from('agent_run_snapshots').upsert(
        {
          organization_id: this.config.organizationId,
          repo_key: this.config.repoKey,
          run_id: options.runId,
          objective: options.objective,
          status: options.status,
          snapshot: options.snapshot,
          published_at: new Date().toISOString(),
        },
        { onConflict: 'organization_id,repo_key,run_id' },
      );
      if (error) {
        throw new Error(`Failed to publish run snapshot for ${options.runId}: ${error.message}`);
      }
    });
  }

  async findScopePackById(packId: string): Promise<ScopePackContract | null> {
    return await this.call(true, async () => {
      const { data, error } = await this.client
        .from('agent_scope_packs')
        .select('*')
        .eq('id', packId)
        .eq('organization_id', this.config.organizationId)
        .eq('repo_key', this.config.repoKey)
        .limit(1);
      if (error) {
        throw new Error(`Failed to load Scope Pack ${packId}: ${error.message}`);
      }
      const row = (data ?? [])[0] as Parameters<typeof packFromRow>[0] | undefined;
      return row ? packFromRow(row) : null;
    });
  }

  async findScopePackBySourceHash(sourceHash: string): Promise<ScopePackContract | null> {
    return await this.call(true, async () => {
      const { data, error } = await this.client
        .from('agent_scope_packs')
        .select('*')
        .eq('organization_id', this.config.organizationId)
        .eq('repo_key', this.config.repoKey)
        .eq('source_hash', sourceHash)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) {
        throw new Error(`Failed to look up Scope Pack by hash: ${error.message}`);
      }
      const row = (data ?? [])[0] as Parameters<typeof packFromRow>[0] | undefined;
      return row ? packFromRow(row) : null;
    });
  }

  /**
   * ONE raw Scope Pack lookup by source request — no retry of its own. Used
   * both by the public (retried) findScopePackBySourceRequestId and by the
   * insertScopePack 23505 fallback, which must NOT open a second, nested
   * retry budget inside the outer insert operation (CT-REL-2.1 goal 3).
   */
  private async lookupScopePackBySourceRequestIdOnce(sourceRequestId: string): Promise<ScopePackContract | null> {
    const { data, error } = await this.client
      .from('agent_scope_packs')
      .select('*')
      .eq('organization_id', this.config.organizationId)
      .eq('source_request_id', sourceRequestId)
      .limit(1);
    if (error) {
      throw new Error(`Failed to look up Scope Pack by request: ${error.message}`);
    }
    const row = (data ?? [])[0] as Parameters<typeof packFromRow>[0] | undefined;
    return row ? packFromRow(row) : null;
  }

  async findScopePackBySourceRequestId(sourceRequestId: string): Promise<ScopePackContract | null> {
    return await this.call(true, async () => this.lookupScopePackBySourceRequestIdOnce(sourceRequestId));
  }

  async insertScopePack(pack: ScopePackContract, sourceRequestId: string): Promise<ScopePackContract> {
    if (pack.orgId !== this.config.organizationId || pack.repoKey !== this.config.repoKey) {
      throw new Error('Refusing to persist a Scope Pack outside this Host org/repo.');
    }
    return await this.call(true, async () => {
      const { data, error } = await this.client
        .from('agent_scope_packs')
        .insert({
          id: pack.packId,
          organization_id: this.config.organizationId,
          repo_key: this.config.repoKey,
          title: pack.title,
          source_filename: pack.sourceFilename,
          source_hash: pack.sourceHash,
          pack: packToRowJson(pack),
          reconciliation_state: pack.reconciliationState,
          current_phase_id: pack.currentPhaseId,
          version: pack.version,
          source_request_id: sourceRequestId,
          last_reconciled_at: pack.lastReconciledAt,
        })
        .select('*')
        .single();
      if (error) {
        // Idempotency: the unique constraint already persisted this pack for a
        // prior attempt of the same request — return the existing row. The
        // fallback runs ONCE inside this operation's own retry budget and must
        // not start a second, nested one (CT-REL-2.1 goal 3).
        if (error.code === '23505') {
          const existing = await this.lookupScopePackBySourceRequestIdOnce(sourceRequestId);
          if (existing) return existing;
        }
        throw new Error(`Failed to persist Scope Pack: ${error.message}`);
      }
      return packFromRow(data as Parameters<typeof packFromRow>[0]);
    });
  }

  async updateScopePackReconciliation(pack: ScopePackContract): Promise<void> {
    await this.call(true, async () => {
      const { error } = await this.client
        .from('agent_scope_packs')
        .update({
          pack: packToRowJson(pack),
          reconciliation_state: pack.reconciliationState,
          current_phase_id: pack.currentPhaseId,
          last_reconciled_at: pack.lastReconciledAt,
          updated_at: pack.updatedAt,
        })
        .eq('id', pack.packId)
        .eq('organization_id', this.config.organizationId)
        .eq('repo_key', this.config.repoKey);
      if (error) {
        throw new Error(`Failed to update Scope Pack reconciliation: ${error.message}`);
      }
    });
  }

  async updateScopePackCurrentPhase(packId: string, phaseId: string): Promise<void> {
    await this.call(true, async () => {
      const { error } = await this.client
        .from('agent_scope_packs')
        .update({ current_phase_id: phaseId })
        .eq('id', packId)
        .eq('organization_id', this.config.organizationId)
        .eq('repo_key', this.config.repoKey);
      if (error) {
        throw new Error(`Failed to persist selected Scope Pack phase: ${error.message}`);
      }
    });
  }

  /** Read back the Host's own presence rows (used by tests + diagnostics). */
  async readOwnPresence(): Promise<SafePresenceRow[]> {
    return await this.call(true, async () => {
      const { data, error } = await this.client
        .from('agent_host_presence')
        .select('repo_key,host_instance_id,status,host_version,providers,last_seen_at')
        .eq('organization_id', this.config.organizationId)
        .eq('repo_key', this.config.repoKey);
      if (error) {
        throw new Error(`Failed to read presence: ${error.message}`);
      }
      return (data ?? []) as SafePresenceRow[];
    });
  }
}