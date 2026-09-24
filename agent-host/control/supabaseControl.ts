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
  request_type: 'create_plan' | 'approve_plan' | 'cancel_run' | 'import_scope_pack';
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

  constructor(config: ControlPlaneConfig) {
    this.config = config;
    this.client = createClient(config.supabaseUrl, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
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
  }

  /**
   * Atomically claim pending requests for THIS org + THIS repo only (§9).
   * The RPC uses UPDATE ... WHERE status='pending' with FOR UPDATE SKIP LOCKED,
   * so a request can never be claimed (or executed) twice.
   */
  async claimPendingRequests(limit: number = 10): Promise<ClaimedControlRequest[]> {
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
  }

  async completeRequest(requestId: string, result: Record<string, unknown>): Promise<void> {
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
  }

  async failRequest(requestId: string, safeError: string): Promise<void> {
    const { error } = await this.client
      .from('agent_control_requests')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error: safeError.slice(0, 1_000),
      })
      .eq('id', requestId)
      .eq('organization_id', this.config.organizationId)
      .eq('repo_key', this.config.repoKey)
      .eq('status', 'claimed');
    if (error) {
      throw new Error(`Failed to fail control request ${requestId}: ${error.message}`);
    }
  }

  /** Find the completed create_plan request that produced a plan id (same org). */
  async findPlanByPlanId(planId: string): Promise<{ result: Record<string, unknown> } | null> {
    const { data, error } = await this.client
      .from('agent_control_requests')
      .select('result')
      .eq('organization_id', this.config.organizationId)
      .eq('repo_key', this.config.repoKey)
      .eq('request_type', 'create_plan')
      .eq('status', 'completed')
      .contains('result', { planId })
      .limit(1);
    if (error) {
      throw new Error(`Failed to look up plan ${planId}: ${error.message}`);
    }
    const first = (data ?? [])[0] as { result: Record<string, unknown> } | undefined;
    return first ?? null;
  }

  /** Upsert the safe run snapshot (§29). Local Host store stays the authority. */
  async publishRunSnapshot(options: {
    runId: string;
    objective: string | null;
    status: string;
    snapshot: Record<string, unknown>;
  }): Promise<void> {
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
  }

  async findScopePackById(packId: string): Promise<ScopePackContract | null> {
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
  }

  async findScopePackBySourceHash(sourceHash: string): Promise<ScopePackContract | null> {
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
  }

  async findScopePackBySourceRequestId(sourceRequestId: string): Promise<ScopePackContract | null> {
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

  async insertScopePack(pack: ScopePackContract, sourceRequestId: string): Promise<ScopePackContract> {
    if (pack.orgId !== this.config.organizationId || pack.repoKey !== this.config.repoKey) {
      throw new Error('Refusing to persist a Scope Pack outside this Host org/repo.');
    }
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
      if (error.code === '23505') {
        const existing = await this.findScopePackBySourceRequestId(sourceRequestId);
        if (existing) return existing;
      }
      throw new Error(`Failed to persist Scope Pack: ${error.message}`);
    }
    return packFromRow(data as Parameters<typeof packFromRow>[0]);
  }

  async updateScopePackReconciliation(pack: ScopePackContract): Promise<void> {
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
  }

  async updateScopePackCurrentPhase(packId: string, phaseId: string): Promise<void> {
    const { error } = await this.client
      .from('agent_scope_packs')
      .update({ current_phase_id: phaseId })
      .eq('id', packId)
      .eq('organization_id', this.config.organizationId)
      .eq('repo_key', this.config.repoKey);
    if (error) {
      throw new Error(`Failed to persist selected Scope Pack phase: ${error.message}`);
    }
  }

  /** Read back the Host's own presence rows (used by tests + diagnostics). */
  async readOwnPresence(): Promise<SafePresenceRow[]> {
    const { data, error } = await this.client
      .from('agent_host_presence')
      .select('repo_key,host_instance_id,status,host_version,providers,last_seen_at')
      .eq('organization_id', this.config.organizationId)
      .eq('repo_key', this.config.repoKey);
    if (error) {
      throw new Error(`Failed to read presence: ${error.message}`);
    }
    return (data ?? []) as SafePresenceRow[];
  }
}