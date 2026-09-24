/**
 * CT-CORE-1: REAL Control Tower data source.
 *
 * The ONLY place the Control Tower touches Supabase. Browser-side, authenticated
 * owner/admin only (migration 135 RLS): SELECT presence + requests + snapshots,
 * INSERT control requests. The browser can never UPDATE/DELETE control-plane
 * rows and can never talk to the local Host directly — every mutation is a
 * typed request row (create_plan | approve_plan | cancel_run | import_scope_pack) that the local
 * Host worker atomically claims.
 *
 * Honest-data rules (§30-§35):
 *   - No fixture fallback: a failed query raises; the UI shows the honest
 *     unavailable state, never fake data.
 *   - The browser never sends filesystem paths; repo_key is copied from the
 *     Host's own presence row and echoed back.
 *   - Duplicate submissions reuse the SAME client_request_id: the UNIQUE
 *     (organization_id, client_request_id) constraint makes a retried submit
 *     land on the existing row instead of planning twice.
 */
import { supabase } from '@/lib/supabase'
import { assertPersistableImportScopePackPayload } from './scopePack/importPayload'

export type ControlRequestType = 'create_plan' | 'approve_plan' | 'cancel_run' | 'import_scope_pack'

export const HOST_FRESH_MS = 30_000

export class ControlTowerServiceError extends Error {
  readonly code:
    | 'unauthenticated'
    | 'org_missing'
    | 'insert_failed'
    | 'query_failed'
    | 'repo_key_missing'
    | 'payload_rejected'

  constructor(code: ControlTowerServiceError['code'], message: string) {
    super(message)
    this.name = 'ControlTowerServiceError'
    this.code = code
  }
}

export interface ControlTowerContext {
  userId: string
  organizationId: string
}

/**
 * Resolve the authenticated owner + active organization via the proven
 * user_org_id RPC (same convention as callLogService / invoiceDraftService).
 * Never trusts a client-supplied org id.
 */
export async function resolveControlTowerContext(): Promise<ControlTowerContext> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user?.id) {
    throw new ControlTowerServiceError('unauthenticated', 'Not authenticated; cannot use the Control Tower.')
  }

  const { data: orgIdRaw, error: orgError } = await (supabase as unknown as { rpc: (fn: string) => Promise<{ data: unknown; error: { message: string } | null }> }).rpc('user_org_id')
  const organizationId = typeof orgIdRaw === 'string' && orgIdRaw.trim() ? orgIdRaw.trim() : null
  if (orgError || !organizationId) {
    throw new ControlTowerServiceError('org_missing', 'No active organization; cannot use the Control Tower.')
  }
  return { userId: user.id, organizationId }
}

/* ── Presence ─────────────────────────────────────────────────────────── */

export interface HostPresenceRow {
  repo_key: string
  host_instance_id: string
  status: string
  host_version: string | null
  /**
   * ATB-2: the provider fleet. Newer Hosts publish safe capability OBJECTS;
   * older Hosts published a plain string[] of provider names. The adapter
   * tolerates both shapes.
   */
  providers: unknown[]
  last_seen_at: string
}

export async function fetchHostPresenceRows(organizationId: string): Promise<HostPresenceRow[]> {
  const { data, error } = await (supabase as unknown as { from: (t: string) => { select: (c: string) => { eq: (c: string, v: string) => { order: (c: string, o: object) => { data: unknown[] | null; error: { message: string } | null } } } } })
    .from('agent_host_presence')
    .select('repo_key,host_instance_id,status,host_version,providers,last_seen_at')
    .eq('organization_id', organizationId)
    .order('last_seen_at', { ascending: false })
  if (error) {
    throw new ControlTowerServiceError('query_failed', `Failed to read Host presence: ${error.message}`)
  }
  return (data ?? []) as HostPresenceRow[]
}

/* ── Control requests ─────────────────────────────────────────────────── */

export interface ControlRequestRow {
  id: string
  request_type: ControlRequestType
  client_request_id: string
  repo_key: string
  status: 'pending' | 'claimed' | 'completed' | 'failed' | 'cancelled'
  payload: Record<string, unknown>
  result: Record<string, unknown> | null
  error: string | null
  created_at: string
}

interface Upserter {
  insert: (values: Record<string, unknown>) => { select: (c: string) => { single: () => Promise<{ data: unknown; error: { code: string; message: string } | null }> } }
}

function controlRequestsTable(): Upserter {
  return (supabase as unknown as { from: (t: string) => Upserter }).from('agent_control_requests')
}

/**
 * Insert a typed control request. On a duplicate client_request_id (network
 * retry), the UNIQUE constraint rejects the second INSERT and the EXISTING
 * row is returned — the same request is never executed twice.
 */
export async function insertControlRequest(input: {
  organizationId: string
  repoKey: string
  requestType: ControlRequestType
  clientRequestId: string
  payload: Record<string, unknown>
}): Promise<ControlRequestRow> {
  if (input.requestType === 'import_scope_pack') {
    const verdict = assertPersistableImportScopePackPayload(input.payload)
    if (!verdict.ok) {
      throw new ControlTowerServiceError('payload_rejected', verdict.message)
    }
  }
  const { data, error } = await controlRequestsTable()
    .insert({
      organization_id: input.organizationId,
      repo_key: input.repoKey,
      request_type: input.requestType,
      client_request_id: input.clientRequestId,
      payload: input.payload,
    })
    .select('*')
    .single()
  if (error) {
    if (error.code === '23505') {
      const existing = await fetchControlRequest(input.organizationId, input.clientRequestId)
      if (existing) return existing
    }
    throw new ControlTowerServiceError('insert_failed', `Failed to submit ${input.requestType}: ${error.message}`)
  }
  return data as ControlRequestRow
}

export async function fetchControlRequest(organizationId: string, clientRequestId: string): Promise<ControlRequestRow | null> {
  const { data, error } = await (supabase as unknown as { from: (t: string) => { select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => Promise<{ data: unknown[] | null; error: { message: string } | null }> } } } })
    .from('agent_control_requests')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('client_request_id', clientRequestId)
  if (error) {
    throw new ControlTowerServiceError('query_failed', `Failed to read control request: ${error.message}`)
  }
  return ((data ?? [])[0] as ControlRequestRow | undefined) ?? null
}

/* ── Run snapshots ─────────────────────────────────────────────────────── */

export interface RunSnapshotRow {
  run_id: string
  repo_key: string
  objective: string | null
  status: string
  snapshot: Record<string, unknown>
  published_at: string
  updated_at: string
}

export async function fetchRunSnapshotRows(organizationId: string, limit: number = 5): Promise<RunSnapshotRow[]> {
  const { data, error } = await (supabase as unknown as { from: (t: string) => { select: (c: string) => { eq: (c: string, v: string) => { order: (c: string, o: object) => { limit: (n: number) => { data: unknown[] | null; error: { message: string } | null } } } } } })
    .from('agent_run_snapshots')
    .select('run_id,repo_key,objective,status,snapshot,published_at,updated_at')
    .eq('organization_id', organizationId)
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (error) {
    throw new ControlTowerServiceError('query_failed', `Failed to read run snapshots: ${error.message}`)
  }
  return (data ?? []) as RunSnapshotRow[]
}

/* ── Scope Packs (owner/admin SELECT only; Host writes) ───────────────── */

export interface ScopePackRow {
  id: string
  title: string
  source_filename: string
  source_hash: string
  pack: Record<string, unknown>
  reconciliation_state: 'unverified' | 'current' | 'stale' | 'conflict'
  current_phase_id: string | null
  version: number
  created_at: string
  updated_at: string
  last_reconciled_at: string | null
  repo_key: string
}

export async function fetchScopePackRows(organizationId: string, repoKey: string): Promise<ScopePackRow[]> {
  const { data, error } = await (supabase as unknown as { from: (t: string) => { select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { order: (c: string, o: object) => { data: unknown[] | null; error: { message: string } | null } } } } } })
    .from('agent_scope_packs')
    .select('id,title,source_filename,source_hash,pack,reconciliation_state,current_phase_id,version,created_at,updated_at,last_reconciled_at,repo_key')
    .eq('organization_id', organizationId)
    .eq('repo_key', repoKey)
    .order('updated_at', { ascending: false })
  if (error) {
    throw new ControlTowerServiceError('query_failed', `Failed to read Scope Packs: ${error.message}`)
  }
  return (data ?? []) as ScopePackRow[]
}