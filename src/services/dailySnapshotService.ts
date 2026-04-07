// @ts-nocheck
/**
 * Daily Snapshot Service — Feature F6 (B42)
 *
 * Captures a daily platform state snapshot and stores it in Supabase.
 * Checks localStorage to avoid duplicate snapshots on the same calendar day.
 * Designed to be called on app load (e.g., in AdminCommandCenter mount).
 */

import { supabase } from '@/lib/supabase'

const LAST_SNAPSHOT_KEY = 'poweron_last_daily_snapshot'
const GOAL_STORAGE_KEY = 'poweron_goal_paths'
const IMPROVEMENT_LOG_KEY = 'poweron_improvement_log'

export interface DailySnapshotMetrics {
  /** ISO date string YYYY-MM-DD */
  snapshot_date: string
  /** Raw metrics blob captured from platform state */
  metrics_json: {
    agentActivityCount: number
    betaUserCount: number
    improvementLogCount: number
    goalPathStates: Array<{
      name: string
      color: string
      active: boolean
      stepCount: number
    }>
    capturedAt: string
  }
}

/** Return today as YYYY-MM-DD in local time */
function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Gather current platform state from available sources */
async function captureMetrics(): Promise<DailySnapshotMetrics['metrics_json']> {
  // Goal path states from localStorage
  let goalPathStates: DailySnapshotMetrics['metrics_json']['goalPathStates'] = []
  try {
    const raw = localStorage.getItem(GOAL_STORAGE_KEY)
    if (raw) {
      const profiles = JSON.parse(raw) as Array<{
        name?: string
        color?: string
        active?: boolean
        steps?: unknown[]
      }>
      goalPathStates = profiles.map((p) => ({
        name: p.name ?? 'Unnamed',
        color: p.color ?? '#888',
        active: !!p.active,
        stepCount: Array.isArray(p.steps) ? p.steps.length : 0,
      }))
    }
  } catch {}

  // Improvement log count from localStorage
  let improvementLogCount = 0
  try {
    const raw = localStorage.getItem(IMPROVEMENT_LOG_KEY)
    if (raw) {
      const entries = JSON.parse(raw)
      improvementLogCount = Array.isArray(entries) ? entries.length : 0
    }
  } catch {}

  // Agent activity count from Supabase activity_log
  let agentActivityCount = 0
  try {
    const { count } = await supabase
      .from('activity_log')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    agentActivityCount = count ?? 0
  } catch {}

  // Beta user count from Supabase beta_invites or profiles
  let betaUserCount = 0
  try {
    const { count } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('tier', 'beta')
    betaUserCount = count ?? 0
  } catch {}

  return {
    agentActivityCount,
    betaUserCount,
    improvementLogCount,
    goalPathStates,
    capturedAt: new Date().toISOString(),
  }
}

/**
 * Take a daily snapshot if one hasn't been taken today.
 * Safe to call multiple times — idempotent per calendar day.
 * Returns the inserted snapshot row, or null if already taken today / on error.
 */
export async function takeDailySnapshotIfNeeded(): Promise<DailySnapshotMetrics | null> {
  try {
    const today = todayStr()
    const lastSnapshot = localStorage.getItem(LAST_SNAPSHOT_KEY)

    // Already snapped today
    if (lastSnapshot === today) return null

    const metrics_json = await captureMetrics()

    const { data, error } = await supabase
      .from('daily_snapshots')
      .insert({ snapshot_date: today, metrics_json })
      .select()
      .single()

    if (error) {
      // Unique constraint violation means another tab/session already inserted today — mark done
      if (error.code === '23505') {
        localStorage.setItem(LAST_SNAPSHOT_KEY, today)
      }
      console.warn('[dailySnapshot] insert error', error.message)
      return null
    }

    localStorage.setItem(LAST_SNAPSHOT_KEY, today)
    return { snapshot_date: today, metrics_json }
  } catch (err) {
    console.warn('[dailySnapshot] unexpected error', err)
    return null
  }
}

/**
 * Fetch the last N daily snapshots (newest first).
 * Used by the Daily Progress section in Tab 1 of AdminCommandCenter.
 */
export async function fetchRecentSnapshots(limit = 30): Promise<
  Array<{ id: string; snapshot_date: string; metrics_json: DailySnapshotMetrics['metrics_json']; created_at: string }>
> {
  try {
    const { data, error } = await supabase
      .from('daily_snapshots')
      .select('id, snapshot_date, metrics_json, created_at')
      .order('snapshot_date', { ascending: false })
      .limit(limit)

    if (error) {
      console.warn('[dailySnapshot] fetch error', error.message)
      return []
    }
    return data ?? []
  } catch {
    return []
  }
}
