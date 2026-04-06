/**
 * src/services/sessionConclusionService.ts
 * V3-31 — Session Conclusion Extraction Service
 *
 * After any NEXUS voice session, conclusions are saved to Supabase and
 * surfaced at the start of the next relevant session so NEXUS never
 * opens cold on a resolved topic.
 *
 * Supabase table: session_conclusions
 *   id            uuid PK
 *   user_id       uuid NOT NULL
 *   org_id        uuid
 *   session_id    text          — unique identifier for the voice session
 *   conclusion_text text NOT NULL — the summarized conclusion / action item
 *   block         text nullable  — which block this relates to
 *   project_id    uuid nullable  — linked project if applicable
 *   agent_refs    text[]         — which agents were involved
 *   status        text           — 'active' | 'completed' | 'superseded'
 *   created_at    timestamptz
 *   completed_at  timestamptz nullable
 *   cross_ref_ids uuid[]         — links to related conclusions
 *
 * All Supabase calls use the stub from supabaseService.ts.
 * Wire to real Supabase client during V2 integration.
 */

import { syncToSupabase, fetchFromSupabase } from './supabaseService';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConclusionStatus = 'active' | 'completed' | 'superseded';

export interface ConclusionItem {
  text: string;
  block?: string;
  projectId?: string;
  agentRefs: string[];
}

export interface SessionConclusion {
  id: string;
  user_id: string;
  org_id?: string;
  session_id: string;
  conclusion_text: string;
  block?: string;
  project_id?: string;
  agent_refs: string[];
  status: ConclusionStatus;
  created_at: string;
  completed_at?: string;
  cross_ref_ids: string[];
}

export interface ConclusionFilters {
  projectId?: string;
  block?: string;
  agent?: string;
  fromDate?: string;  // ISO timestamp
  toDate?: string;    // ISO timestamp
}

// ─── saveConclusions ──────────────────────────────────────────────────────────

/**
 * saveConclusions
 *
 * Batch-inserts an array of ConclusionItem records for a given user + session.
 * Each item becomes one row in session_conclusions with status='active'.
 */
export async function saveConclusions(
  userId: string,
  sessionId: string,
  conclusions: ConclusionItem[],
): Promise<void> {
  if (!conclusions.length) return;

  const now = new Date().toISOString();

  const inserts = conclusions.map((c) => ({
    id: crypto.randomUUID(),
    user_id: userId,
    session_id: sessionId,
    conclusion_text: c.text,
    block: c.block ?? null,
    project_id: c.projectId ?? null,
    agent_refs: c.agentRefs,
    status: 'active' as ConclusionStatus,
    created_at: now,
    completed_at: null,
    cross_ref_ids: [],
  }));

  // Batch insert via stub — wire to Supabase batch insert on integration
  await Promise.all(
    inserts.map((row) =>
      syncToSupabase({
        table: 'session_conclusions',
        data: row as unknown as Record<string, unknown>,
        operation: 'insert',
      }),
    ),
  );
}

// ─── getActiveConclusions ─────────────────────────────────────────────────────

/**
 * getActiveConclusions
 *
 * Returns all conclusions with status='active' for a given user,
 * optionally filtered by project, block, agent, or date range.
 * Sorted: most recent first.
 */
export async function getActiveConclusions(
  userId: string,
  filters?: ConclusionFilters,
): Promise<SessionConclusion[]> {
  const rows = await fetchFromSupabase<SessionConclusion>('session_conclusions', {
    user_id: userId,
    status: 'active',
  });

  let filtered = rows;

  if (filters?.projectId) {
    filtered = filtered.filter((r) => r.project_id === filters.projectId);
  }
  if (filters?.block) {
    filtered = filtered.filter((r) => r.block === filters.block);
  }
  if (filters?.agent) {
    filtered = filtered.filter((r) =>
      r.agent_refs.some((a) => a.toLowerCase() === filters.agent!.toLowerCase()),
    );
  }
  if (filters?.fromDate) {
    filtered = filtered.filter(
      (r) => new Date(r.created_at) >= new Date(filters.fromDate!),
    );
  }
  if (filters?.toDate) {
    filtered = filtered.filter(
      (r) => new Date(r.created_at) <= new Date(filters.toDate!),
    );
  }

  // Sort: most recent first
  return filtered.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

// ─── getRelevantConclusions ───────────────────────────────────────────────────

/**
 * getRelevantConclusions
 *
 * Returns up to 5 conclusions most relevant to what the user is about to discuss.
 * Matching strategy (in order of signal strength):
 *   1. Project name keyword match in query
 *   2. Agent keyword match in query
 *   3. Block keyword match in query
 *   4. Fall back to most recent active conclusions
 *
 * This is the primary hook NEXUS uses to avoid cold opens.
 */
export async function getRelevantConclusions(
  userId: string,
  currentQuery: string,
): Promise<SessionConclusion[]> {
  const active = await getActiveConclusions(userId);
  if (!active.length) return [];

  const lowerQuery = currentQuery.toLowerCase();

  function scoreConclusion(c: SessionConclusion): number {
    let score = 0;

    // Agent keyword match
    if (c.agent_refs.some((a) => lowerQuery.includes(a.toLowerCase()))) {
      score += 3;
    }

    // Block match
    if (c.block && lowerQuery.includes(c.block.toLowerCase())) {
      score += 2;
    }

    // Keyword overlap between query and conclusion text (Jaccard-lite)
    const queryWords = new Set(
      lowerQuery.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2),
    );
    const conclusionWords = new Set(
      c.conclusion_text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );
    const overlap = [...queryWords].filter((w) => conclusionWords.has(w)).length;
    score += Math.min(overlap, 4);  // cap overlap contribution at 4

    return score;
  }

  // Score + sort; tie-break by recency (already sorted most-recent-first)
  const scored = active
    .map((c) => ({ conclusion: c, score: scoreConclusion(c) }))
    .sort((a, b) => b.score - a.score || 0);  // stable: preserves recency order on ties

  return scored.slice(0, 5).map((s) => s.conclusion);
}

// ─── markConclusionCompleted ──────────────────────────────────────────────────

/**
 * markConclusionCompleted
 *
 * Sets status='completed' and completed_at=now() for a given conclusion.
 */
export async function markConclusionCompleted(conclusionId: string): Promise<void> {
  await syncToSupabase({
    table: 'session_conclusions',
    data: {
      id: conclusionId,
      status: 'completed',
      completed_at: new Date().toISOString(),
    },
    operation: 'update',
  });
}

// ─── extractConclusions ───────────────────────────────────────────────────────

/**
 * extractConclusions
 *
 * B11 — Derives ConclusionItem[] from a completed NEXUS conversation.
 * Called after 5+ message exchanges so ECHO memory carries forward results.
 *
 * Extraction strategy:
 *  1. Scan assistant messages for decision language and action-item signals.
 *  2. Scan user messages for confirmed decisions and explicit next steps.
 *  3. Deduplicate and cap at 6 conclusions per session.
 *
 * No Claude API call — purely heuristic, intentionally fast and offline-safe.
 * For higher-quality extraction, this can be replaced with a Claude call later.
 */
export function extractConclusions(
  messages: Array<{ role: 'user' | 'assistant'; content: string; agentId?: string }>,
): ConclusionItem[] {
  const conclusions: ConclusionItem[] = [];

  // Patterns that signal a conclusion / action item in assistant responses
  const ASSISTANT_CONCLUSION_PATTERNS = [
    /\bI(?:'ll| will)\s+(?:add|create|log|save|update|schedule|set|send|flag|remind)\b/i,
    /\byou\s+(?:should|need to|want to|plan to)\b/i,
    /\baction\s+(?:item|required|needed)\b/i,
    /\bfollow\s*[- ]?up\b/i,
    /\bnext\s+step\b/i,
    /\bworth\s+a\b.*\bcall\b/i,
    /\brecommend\b/i,
    /\bcritical\b.*\b(to|that)\b/i,
  ];

  // Patterns that signal a user decision
  const USER_DECISION_PATTERNS = [
    /\b(let's|let me|i('ll| will)|going to|decided|confirmed|approved|do it|proceed)\b/i,
    /\b(i need to|i should|i want to|i'm going to|planning to)\b/i,
  ];

  const seenTexts = new Set<string>();

  for (const msg of messages) {
    if (msg.role === 'assistant') {
      // Split assistant message into sentences and check each one
      const sentences = msg.content
        .split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(s => s.length > 20 && s.length < 300);

      for (const sentence of sentences) {
        if (ASSISTANT_CONCLUSION_PATTERNS.some(re => re.test(sentence))) {
          const key = sentence.toLowerCase().slice(0, 60);
          if (!seenTexts.has(key)) {
            seenTexts.add(key);
            conclusions.push({
              text: sentence,
              agentRefs: msg.agentId ? [msg.agentId] : ['nexus'],
            });
          }
        }
      }
    } else if (msg.role === 'user') {
      const trimmed = msg.content.trim();
      if (trimmed.length > 15 && USER_DECISION_PATTERNS.some(re => re.test(trimmed))) {
        const key = trimmed.toLowerCase().slice(0, 60);
        if (!seenTexts.has(key)) {
          seenTexts.add(key);
          conclusions.push({
            text: trimmed.slice(0, 200),
            agentRefs: ['user'],
          });
        }
      }
    }

    // Cap at 6 conclusions
    if (conclusions.length >= 6) break;
  }

  return conclusions;
}

// ─── supersededConclusion ─────────────────────────────────────────────────────

/**
 * supersededConclusion
 *
 * Sets status='superseded' on the old conclusion and records the new conclusion ID
 * in its cross_ref_ids array for traceability.
 *
 * Note: full cross_ref merge requires reading existing cross_ref_ids first.
 * Stub implementation overwrites cross_ref_ids with [newConclusionId].
 * Wire to Supabase array-append on integration.
 */
export async function supersededConclusion(
  conclusionId: string,
  newConclusionId: string,
): Promise<void> {
  await syncToSupabase({
    table: 'session_conclusions',
    data: {
      id: conclusionId,
      status: 'superseded',
      cross_ref_ids: [newConclusionId],
    },
    operation: 'update',
  });
}
