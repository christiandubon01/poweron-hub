// @ts-nocheck
/**
 * snapshotService.ts — PowerOn Hub V2 Snapshot System
 *
 * Rolling point-in-time saves of app state to Supabase `snapshots` table.
 * All writes are fire-and-forget background operations — they never interrupt UI.
 *
 * Rules (per spec):
 * - No auto-deploy, no auto-overwrite
 * - User must browse history, preview, and explicitly confirm before any restore
 * - Max 50 snapshots returned in list (oldest auto-pruned by query limit)
 * - Pinned snapshots always appear first
 */

import { supabase } from '@/lib/supabase'

// ── Types ────────────────────────────────────────────────────────────────────

export interface Snapshot {
  id: string
  user_id: string
  label: string
  description: string | null
  snapshot_data: Record<string, unknown>
  created_at: string
  is_pinned: boolean
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Get current authenticated user ID.
 * Returns null if not authenticated (graceful degradation — snapshot silently skipped).
 */
async function getCurrentUserId(): Promise<string | null> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    return user?.id ?? null
  } catch {
    return null
  }
}

/**
 * Format a short timestamp label fragment: "Mar 29 2:14pm"
 */
export function shortTimestamp(date: Date = new Date()): string {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

// ── Core Functions ───────────────────────────────────────────────────────────

/**
 * createSnapshot — saves a named point-in-time snapshot to Supabase.
 *
 * @param label       Human-readable label, e.g. "VAULT — estimate saved — Mar 29 2:14pm"
 * @param data        The state data to snapshot (any serialisable object)
 * @param description Optional extra description
 * @returns The created snapshot record, or null on failure
 */
export async function createSnapshot(
  label: string,
  data: Record<string, unknown>,
  description?: string
): Promise<Snapshot | null> {
  try {
    const userId = await getCurrentUserId()
    if (!userId) {
      // Not authenticated — skip silently, app works offline
      console.warn('[snapshotService] createSnapshot skipped — no authenticated user')
      return null
    }

    const { data: inserted, error } = await supabase
      .from('snapshots')
      .insert({
        user_id: userId,
        label: label.slice(0, 255),
        description: description ? description.slice(0, 1000) : null,
        snapshot_data: data,
        is_pinned: false,
      })
      .select('id, user_id, label, description, snapshot_data, created_at, is_pinned')
      .single()

    if (error) {
      console.error('[snapshotService] createSnapshot error:', error.message)
      return null
    }

    return inserted as Snapshot
  } catch (err) {
    console.error('[snapshotService] createSnapshot exception:', err)
    return null
  }
}

/**
 * listSnapshots — returns up to 50 snapshots for the current user,
 * sorted by: pinned first, then created_at DESC.
 * snapshot_data is excluded from the list for performance (use getSnapshot for full data).
 */
export async function listSnapshots(): Promise<Omit<Snapshot, 'snapshot_data'>[]> {
  try {
    const userId = await getCurrentUserId()
    if (!userId) return []

    const { data, error } = await supabase
      .from('snapshots')
      .select('id, user_id, label, description, created_at, is_pinned')
      .eq('user_id', userId)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      console.error('[snapshotService] listSnapshots error:', error.message)
      return []
    }

    return (data ?? []) as Omit<Snapshot, 'snapshot_data'>[]
  } catch (err) {
    console.error('[snapshotService] listSnapshots exception:', err)
    return []
  }
}

/**
 * getSnapshot — returns full snapshot record including snapshot_data.
 * Used for the Preview modal.
 */
export async function getSnapshot(id: string): Promise<Snapshot | null> {
  try {
    const userId = await getCurrentUserId()
    if (!userId) return null

    const { data, error } = await supabase
      .from('snapshots')
      .select('id, user_id, label, description, snapshot_data, created_at, is_pinned')
      .eq('id', id)
      .eq('user_id', userId)
      .single()

    if (error) {
      console.error('[snapshotService] getSnapshot error:', error.message)
      return null
    }

    return data as Snapshot
  } catch (err) {
    console.error('[snapshotService] getSnapshot exception:', err)
    return null
  }
}

/**
 * deleteSnapshot — hard deletes a snapshot by id.
 * RLS ensures users can only delete their own records.
 */
export async function deleteSnapshot(id: string): Promise<boolean> {
  try {
    const { error } = await supabase.from('snapshots').delete().eq('id', id)

    if (error) {
      console.error('[snapshotService] deleteSnapshot error:', error.message)
      return false
    }

    return true
  } catch (err) {
    console.error('[snapshotService] deleteSnapshot exception:', err)
    return false
  }
}

/**
 * pinSnapshot — toggle the pinned status of a snapshot.
 * Pinned snapshots float to the top of the list.
 */
export async function pinSnapshot(id: string, pinned: boolean): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('snapshots')
      .update({ is_pinned: pinned })
      .eq('id', id)

    if (error) {
      console.error('[snapshotService] pinSnapshot error:', error.message)
      return false
    }

    return true
  } catch (err) {
    console.error('[snapshotService] pinSnapshot exception:', err)
    return false
  }
}

// ── Auto-snapshot helpers ────────────────────────────────────────────────────

/**
 * autoSnapshot — fires a background snapshot with no UI interrupt.
 * Swallows all errors — the app continues normally regardless.
 *
 * @param agentName   e.g. "VAULT", "BLUEPRINT", "LEDGER"
 * @param action      e.g. "estimate saved", "project updated", "payment recorded"
 * @param data        Current app state / relevant data object to snapshot
 */
export function autoSnapshot(
  agentName: string,
  action: string,
  data: Record<string, unknown>
): void {
  // Fire and forget — intentionally no await
  const label = `${agentName} — ${action} — ${shortTimestamp()}`
  createSnapshot(label, data).catch(() => {
    // Silent — offline or auth failure is expected
  })
}
