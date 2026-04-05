/**
 * src/services/auditTrailService.ts
 * AI Decision Audit Trail Service — V3-24
 *
 * Provides full CRUD for the `ai_decision_log` Supabase table.
 * Stubs use supabaseService under the hood; replace with direct
 * @supabase/supabase-js client calls during V2 integration.
 *
 * Supabase table: ai_decision_log
 *   id                uuid          PK default gen_random_uuid()
 *   user_id           uuid          FK → auth.users.id
 *   org_id            uuid          nullable FK → organizations.id
 *   agent_name        text          NEXUS agent route (VAULT, OHM, LEDGER…)
 *   query             text          original user query
 *   recommendation    text          the "speak" text from NexusResponse
 *   reasoning         jsonb         full NexusResponse (display + captures + builtPrompt)
 *   confidence_score  numeric(4,3)  0.000–1.000
 *   timestamp         timestamptz   default now()
 *   user_action       text          nullable — 'accepted'|'dismissed'|'followed_up'|'flagged'
 */

import { syncToSupabase, fetchFromSupabase } from './supabaseService';

// ─── Types ────────────────────────────────────────────────────────────────────

export type UserAction = 'accepted' | 'dismissed' | 'followed_up' | 'flagged';

export interface AIDecisionLog {
  id: string;
  user_id: string;
  org_id?: string;
  agent_name: string;
  query: string;
  recommendation: string;
  reasoning: Record<string, unknown>;  // stores full NexusResponse payload
  confidence_score: number;
  timestamp: string;                   // ISO 8601
  user_action?: UserAction;
}

export interface LogAIDecisionParams {
  user_id: string;
  org_id?: string;
  agent_name: string;
  query: string;
  recommendation: string;
  reasoning: Record<string, unknown>;
  confidence_score: number;
}

export interface DecisionLogFilters {
  agent_name?: string;
  date_from?: string;   // ISO string
  date_to?: string;     // ISO string
  min_confidence?: number;
  max_confidence?: number;
  user_action?: UserAction | 'none';   // 'none' = no action taken yet
  page?: number;        // 1-based
  page_size?: number;   // default 25
}

export interface PaginatedDecisionLog {
  entries: AIDecisionLog[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// ─── In-memory store (stub) ───────────────────────────────────────────────────
// Replaces Supabase in the external prototype.
// In V2 integration, remove this and wire directly to Supabase.

const _memoryStore: AIDecisionLog[] = [];

function generateId(): string {
  return `adl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ─── logAIDecision ────────────────────────────────────────────────────────────

/**
 * logAIDecision
 *
 * Writes a new AI decision record to the `ai_decision_log` table.
 * Returns the persisted record including its generated id and timestamp.
 *
 * @example
 * const record = await logAIDecision({
 *   user_id: 'user-123',
 *   agent_name: 'OHM',
 *   query: 'What is the NEC requirement for kitchen receptacles?',
 *   recommendation: 'Kitchen requires GFCI on all countertop circuits per NEC 210.8(A)(6).',
 *   reasoning: nexusResponse,
 *   confidence_score: 0.95,
 * });
 */
export async function logAIDecision(
  params: LogAIDecisionParams,
): Promise<AIDecisionLog> {
  const record: AIDecisionLog = {
    id: generateId(),
    user_id: params.user_id,
    org_id: params.org_id,
    agent_name: params.agent_name,
    query: params.query,
    recommendation: params.recommendation,
    reasoning: params.reasoning,
    confidence_score: Math.min(1, Math.max(0, params.confidence_score)),
    timestamp: new Date().toISOString(),
    user_action: undefined,
  };

  // Persist to in-memory store (stub)
  _memoryStore.unshift(record);

  // Fire-and-forget sync to Supabase (stub — no-op in prototype)
  syncToSupabase({
    table: 'ai_decision_log',
    data: record as unknown as Record<string, unknown>,
    operation: 'insert',
  }).catch((err) => {
    console.error('[auditTrailService] Supabase sync failed:', err);
  });

  return record;
}

// ─── getDecisionLog ───────────────────────────────────────────────────────────

/**
 * getDecisionLog
 *
 * Returns a paginated list of AI decision log entries for a user.
 * Owners (no userId restriction) see all; employees see their own.
 * Supports filtering by agent, date range, confidence, and user_action.
 *
 * @param userId   - The requesting user's ID (used for row-level visibility)
 * @param filters  - Optional filter/pagination parameters
 * @param isOwner  - If true, returns all org entries; otherwise scoped to userId
 */
export async function getDecisionLog(
  userId: string,
  filters: DecisionLogFilters = {},
  isOwner = false,
): Promise<PaginatedDecisionLog> {
  // In V2 integration, replace with Supabase .select().eq().range() chain.
  // The stub uses _memoryStore and optionally falls back to fetchFromSupabase.
  const supabaseRows = await fetchFromSupabase<AIDecisionLog>('ai_decision_log', {
    ...(isOwner ? {} : { user_id: userId }),
  });

  // Merge Supabase rows with in-memory (prototype scenario)
  const all = [..._memoryStore, ...supabaseRows];

  // De-duplicate by id
  const seen = new Set<string>();
  let filtered = all.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  // Scope to user unless owner
  if (!isOwner) {
    filtered = filtered.filter((e) => e.user_id === userId);
  }

  // Apply filters
  if (filters.agent_name) {
    filtered = filtered.filter((e) => e.agent_name === filters.agent_name);
  }
  if (filters.date_from) {
    const from = new Date(filters.date_from).getTime();
    filtered = filtered.filter((e) => new Date(e.timestamp).getTime() >= from);
  }
  if (filters.date_to) {
    const to = new Date(filters.date_to).getTime();
    filtered = filtered.filter((e) => new Date(e.timestamp).getTime() <= to);
  }
  if (filters.min_confidence !== undefined) {
    filtered = filtered.filter((e) => e.confidence_score >= filters.min_confidence!);
  }
  if (filters.max_confidence !== undefined) {
    filtered = filtered.filter((e) => e.confidence_score <= filters.max_confidence!);
  }
  if (filters.user_action === 'none') {
    filtered = filtered.filter((e) => !e.user_action);
  } else if (filters.user_action) {
    filtered = filtered.filter((e) => e.user_action === filters.user_action);
  }

  // Sort newest first
  filtered.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  const page = filters.page ?? 1;
  const page_size = filters.page_size ?? 25;
  const total = filtered.length;
  const total_pages = Math.max(1, Math.ceil(total / page_size));
  const start = (page - 1) * page_size;
  const entries = filtered.slice(start, start + page_size);

  return { entries, total, page, page_size, total_pages };
}

// ─── getDecisionById ──────────────────────────────────────────────────────────

/**
 * getDecisionById
 *
 * Returns a single AI decision record including full reasoning payload.
 * Returns null if not found.
 */
export async function getDecisionById(
  decisionId: string,
): Promise<AIDecisionLog | null> {
  // Check in-memory first
  const local = _memoryStore.find((e) => e.id === decisionId);
  if (local) return local;

  // Fall through to Supabase (stub returns empty array)
  const rows = await fetchFromSupabase<AIDecisionLog>('ai_decision_log', {
    id: decisionId,
  });
  return rows[0] ?? null;
}

// ─── updateUserAction ─────────────────────────────────────────────────────────

/**
 * updateUserAction
 *
 * Records the user's response to an AI recommendation.
 * Allowed actions: 'accepted' | 'dismissed' | 'followed_up' | 'flagged'
 *
 * @returns The updated record, or null if decisionId not found.
 */
export async function updateUserAction(
  decisionId: string,
  action: UserAction,
): Promise<AIDecisionLog | null> {
  // Update in-memory
  const idx = _memoryStore.findIndex((e) => e.id === decisionId);
  if (idx !== -1) {
    _memoryStore[idx] = { ..._memoryStore[idx], user_action: action };

    // Sync update to Supabase (stub)
    syncToSupabase({
      table: 'ai_decision_log',
      data: { id: decisionId, user_action: action },
      operation: 'update',
    }).catch((err) => {
      console.error('[auditTrailService] Supabase update failed:', err);
    });

    return _memoryStore[idx];
  }
  return null;
}

// ─── exportToCSV ─────────────────────────────────────────────────────────────

/**
 * exportToCSV
 *
 * Serializes a list of AIDecisionLog entries to a CSV string.
 * Called by the GUARDIAN AI Decisions panel export button.
 */
export function exportToCSV(entries: AIDecisionLog[]): string {
  const headers = [
    'id',
    'timestamp',
    'agent_name',
    'query',
    'recommendation',
    'confidence_score',
    'user_action',
    'user_id',
    'org_id',
  ];

  const escape = (val: unknown): string => {
    const s = val == null ? '' : String(val);
    // Wrap in quotes if value contains comma, quote, or newline
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const rows = entries.map((e) =>
    [
      e.id,
      e.timestamp,
      e.agent_name,
      e.query,
      e.recommendation,
      e.confidence_score.toFixed(3),
      e.user_action ?? '',
      e.user_id,
      e.org_id ?? '',
    ]
      .map(escape)
      .join(','),
  );

  return [headers.join(','), ...rows].join('\n');
}
