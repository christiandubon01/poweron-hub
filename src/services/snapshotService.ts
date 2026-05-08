// @ts-nocheck
/**
 * snapshotService.ts — PowerOn Hub V2 Snapshot System
 *
 * Matches current Supabase `public.snapshots` schema:
 * id, org_id, user_id, snapshot_data, label, created_at
 */

import { supabase } from '@/lib/supabase'

export interface Snapshot {
  id: string
  org_id?: string | null
  user_id: string | null
  label: string | null
  snapshot_data: Record<string, unknown> | null
  created_at: string | null
}

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

export function shortTimestamp(date: Date = new Date()): string {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function buildSnapshotLabel(label: string, description?: string): string {
  if (!description) return label.slice(0, 255)
  return `${label} — ${description}`.slice(0, 255)
}

export async function createSnapshot(
  label: string,
  data: Record<string, unknown>,
  description?: string
): Promise<Snapshot | null> {
  try {
    const userId = await getCurrentUserId()

    if (!userId) {
      console.warn('[snapshotService] createSnapshot skipped — no authenticated user')
      return null
    }

    const { data: inserted, error } = await supabase
      .from('snapshots')
      .insert({
        user_id: userId,
        label: buildSnapshotLabel(label, description),
        snapshot_data: data,
      })
      .select('id, org_id, user_id, label, snapshot_data, created_at')
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

export async function listSnapshots(): Promise<Omit<Snapshot, 'snapshot_data'>[]> {
  try {
    const userId = await getCurrentUserId()
    if (!userId) return []

    const { data, error } = await supabase
      .from('snapshots')
      .select('id, org_id, user_id, label, created_at')
      .eq('user_id', userId)
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

export async function getSnapshot(id: string): Promise<Snapshot | null> {
  try {
    const userId = await getCurrentUserId()
    if (!userId) return null

    const { data, error } = await supabase
      .from('snapshots')
      .select('id, org_id, user_id, label, snapshot_data, created_at')
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

export async function deleteSnapshot(id: string): Promise<boolean> {
  try {
    const userId = await getCurrentUserId()
    if (!userId) return false

    const { error } = await supabase
      .from('snapshots')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)

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

export async function pinSnapshot(_id: string, _pinned: boolean): Promise<boolean> {
  console.warn('[snapshotService] pinSnapshot skipped — current snapshots table has no is_pinned column')
  return false
}

export function autoSnapshot(
  agentName: string,
  action: string,
  data: Record<string, unknown>
): void {
  const label = `${agentName} — ${action} — ${shortTimestamp()}`

  createSnapshot(label, data).catch(() => {
    /* silent */
  })
}