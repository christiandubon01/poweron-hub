/**
 * src/services/katsuroHandoffService.ts
 * V3-33 — Katsuro Handoff Table Service
 *
 * One-directional bridge between DaSparkyHub (Christian's private system) and
 * PowerOn Hub. DaSparkyHub's AI writes to `katsuro_handoff`. NEXUS reads from it.
 * The flow is strictly: DaSparkyHub WRITES → NEXUS READS. Never the reverse.
 *
 * SECURITY RULES (non-negotiable):
 *   1. Only the org owner with DaSparkyHub integration enabled can access this data.
 *   2. All non-owner calls return empty arrays / no-ops silently.
 *   3. The name "Katsuro", "Raijin", or "DaSparkyHub" must NEVER appear in any
 *      customer-facing UI, console.log, error message, or user-visible string.
 *      This file is internal infrastructure only.
 *   4. These functions must only be called from NEXUS — not from any UI component.
 *
 * Supabase table: katsuro_handoff
 *   id             uuid PK
 *   entry_type     text NOT NULL  — 'insight' | 'action_item' | 'alert' | 'reminder' | 'context_update'
 *   content        text NOT NULL  — the actual message / insight to surface
 *   block          text nullable  — which block this originated from in DaSparkyHub
 *   agent_target   text nullable  — which Hub agent should handle this ('VAULT', 'LEDGER', etc.)
 *   priority       text           — 'low' | 'medium' | 'high'
 *   created_at     timestamptz
 *   read_at        timestamptz nullable  — when NEXUS first read this entry
 *   actioned_at    timestamptz nullable  — when the user acted on it
 *   dismissed_at   timestamptz nullable  — when the user dismissed it
 *
 * Wire all syncToSupabase / fetchFromSupabase calls to the real Supabase client
 * during V2 integration. All calls are stubs in V3 external.
 */

import { syncToSupabase, fetchFromSupabase } from './supabaseService';

// ─── Owner Configuration ──────────────────────────────────────────────────────

/**
 * OWNER_USER_ID — Christian's Supabase auth.users UUID.
 * TODO (V2 integration): replace this placeholder with the real UUID, or
 * wire to a lookup from user_preferences.dasparkyHub_enabled = true.
 *
 * This is an internal constant only. Never surfaced to UI or logs.
 */
const OWNER_USER_ID = 'REPLACE_WITH_CHRISTIAN_SUPABASE_UUID';

// ─── Types ────────────────────────────────────────────────────────────────────

export type HandoffEntryType =
  | 'insight'
  | 'action_item'
  | 'alert'
  | 'reminder'
  | 'context_update';

export type HandoffPriority = 'low' | 'medium' | 'high';

export interface HandoffEntry {
  id: string;
  entry_type: HandoffEntryType;
  content: string;
  block: string | null;
  agent_target: string | null;
  priority: HandoffPriority;
  created_at: string;
  read_at: string | null;
  actioned_at: string | null;
  dismissed_at: string | null;
}

// ─── Security Gate ────────────────────────────────────────────────────────────

/**
 * isOwnerWithDaSparkyHub
 *
 * Returns true ONLY when the given userId matches the org owner AND the owner
 * has the DaSparkyHub integration active.
 *
 * Currently: compares against the hardcoded OWNER_USER_ID constant.
 * V2 integration: additionally check user_preferences.dasparkyHub_enabled = true
 * via a Supabase lookup.
 *
 * This is the single security gate for all handoff reads. Non-owner callers
 * receive false with no error — the table's existence is not acknowledged.
 */
export function isOwnerWithDaSparkyHub(userId: string): boolean {
  if (!userId) return false;
  return userId === OWNER_USER_ID;
}

// ─── Priority Sort Helper ─────────────────────────────────────────────────────

const PRIORITY_ORDER: Record<HandoffPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function sortByPriorityThenCreatedAt(a: HandoffEntry, b: HandoffEntry): number {
  const priorityDiff =
    PRIORITY_ORDER[a.priority as HandoffPriority] -
    PRIORITY_ORDER[b.priority as HandoffPriority];
  if (priorityDiff !== 0) return priorityDiff;
  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
}

// ─── getUnreadHandoffs ────────────────────────────────────────────────────────

/**
 * getUnreadHandoffs
 *
 * Returns all entries where read_at IS NULL and dismissed_at IS NULL,
 * sorted by priority (high → medium → low) then by created_at ascending.
 *
 * Security: returns empty array for any non-owner userId — silently.
 * NEXUS calls this at the start of every session.
 */
export async function getUnreadHandoffs(userId: string): Promise<HandoffEntry[]> {
  if (!isOwnerWithDaSparkyHub(userId)) return [];

  const rows = await fetchFromSupabase<HandoffEntry>('katsuro_handoff', {
    read_at: null,
    dismissed_at: null,
  });

  return rows
    .filter((r) => r.read_at === null && r.dismissed_at === null)
    .sort(sortByPriorityThenCreatedAt);
}

// ─── markHandoffRead ──────────────────────────────────────────────────────────

/**
 * markHandoffRead
 *
 * Sets read_at = now() for the given handoff entry.
 * Called immediately after NEXUS surfaces the handoff to the user.
 * Fire-and-forget safe — errors are caught internally.
 */
export async function markHandoffRead(handoffId: string): Promise<void> {
  if (!handoffId) return;

  await syncToSupabase({
    table: 'katsuro_handoff',
    data: {
      id: handoffId,
      read_at: new Date().toISOString(),
    },
    operation: 'update',
  });
}

// ─── markHandoffActioned ──────────────────────────────────────────────────────

/**
 * markHandoffActioned
 *
 * Sets actioned_at = now() for the given handoff entry.
 * Called when the user explicitly engages with the surfaced handoff —
 * e.g., asks a follow-up question, opens the referenced project, or
 * acknowledges the insight.
 *
 * Callers should use the handoffIds returned in the NexusResponse to
 * identify which entry to mark actioned.
 */
export async function markHandoffActioned(handoffId: string): Promise<void> {
  if (!handoffId) return;

  await syncToSupabase({
    table: 'katsuro_handoff',
    data: {
      id: handoffId,
      actioned_at: new Date().toISOString(),
    },
    operation: 'update',
  });
}

// ─── dismissHandoff ───────────────────────────────────────────────────────────

/**
 * dismissHandoff
 *
 * Sets dismissed_at = now() for the given handoff entry.
 * Called when the user explicitly dismisses the item —
 * e.g., "I already handled that" or "skip that one".
 *
 * Dismissed entries are excluded from future getUnreadHandoffs() calls.
 */
export async function dismissHandoff(handoffId: string): Promise<void> {
  if (!handoffId) return;

  await syncToSupabase({
    table: 'katsuro_handoff',
    data: {
      id: handoffId,
      dismissed_at: new Date().toISOString(),
    },
    operation: 'update',
  });
}

// ─── getHandoffHistory ────────────────────────────────────────────────────────

/**
 * getHandoffHistory
 *
 * Returns the last N handoff entries (all statuses) for audit/review purposes.
 * Sorted: most recent first.
 * Default limit: 50.
 *
 * Security: returns empty array for any non-owner userId — silently.
 */
export async function getHandoffHistory(
  userId: string,
  limit = 50,
): Promise<HandoffEntry[]> {
  if (!isOwnerWithDaSparkyHub(userId)) return [];

  const rows = await fetchFromSupabase<HandoffEntry>('katsuro_handoff', {});

  return rows
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
    .slice(0, limit);
}

// ─── formatHandoffsForNexus (internal) ───────────────────────────────────────

/**
 * formatHandoffsForNexus
 *
 * Converts an array of HandoffEntry objects into a numbered prompt block
 * for injection into the NEXUS system context. Used internally by the
 * NEXUS prompt engine only — never rendered in the UI.
 *
 * Output example:
 *   1. [ALERT] Copper prices spiked 12% — review Beauty Salon estimate (from: money block)
 *   2. [REMINDER] Repricing thought captured for surgery center panel upgrade (from: pipeline block)
 */
export function formatHandoffsForNexus(handoffs: HandoffEntry[]): string {
  return handoffs
    .map((h, i) => {
      const typeLabel = h.entry_type.replace('_', ' ').toUpperCase();
      const blockNote = h.block ? ` (from: ${h.block})` : '';
      const agentNote = h.agent_target ? ` → route to: ${h.agent_target}` : '';
      return `${i + 1}. [${typeLabel}] ${h.content}${blockNote}${agentNote}`;
    })
    .join('\n');
}
