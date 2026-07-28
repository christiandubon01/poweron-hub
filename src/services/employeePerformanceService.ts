// @ts-nocheck
/**
 * employeePerformanceService.ts — Owner-only performance data pipeline (EMS Phase 6)
 *
 * All reads and writes are scoped to owner/admin via RLS on the three
 * performance tables (employee_performance_snapshots, employee_quality_ratings,
 * employee_compensation_events). No employee-facing RPCs in this phase.
 */

import { supabase } from '@/lib/supabase'

const from = supabase.from as any
const rpc  = supabase.rpc  as any

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PerformanceSnapshot {
  id: string
  org_id: string
  employee_profile_id: string
  period_start: string
  period_end: string
  paid_minutes: number
  tasks_assigned: number
  tasks_completed: number
  tasks_completed_on_time: number
  tasks_late: number
  scheduled_days: number
  days_worked: number
  avg_daily_hours: number | null
  on_time_rate: number | null
  completion_rate: number | null
  metrics: Record<string, unknown>
  generated_at: string
  generated_by: string | null
}

export interface QualityRating {
  id: string
  org_id: string
  employee_profile_id: string
  assignment_id: string | null
  rated_by: string
  score: number
  notes: string | null
  rated_at: string
}

export type CompensationEventType = 'raise' | 'bonus' | 'adjustment' | 'note'

export interface CompensationEvent {
  id: string
  org_id: string
  employee_profile_id: string
  event_type: CompensationEventType
  amount: number | null
  effective_date: string
  reason: string | null
  based_on_snapshot_id: string | null
  created_by: string
  created_at: string
}

type Result<T> = { success: true; data: T } | { success: false; error: string }

// ── 1. generateSnapshot ───────────────────────────────────────────────────────

export async function generateSnapshot(
  profileId: string,
  periodStart: string,
  periodEnd: string,
): Promise<Result<PerformanceSnapshot>> {
  try {
    const { data, error } = await rpc('generate_employee_performance_snapshot', {
      p_employee_profile_id: profileId,
      p_period_start: periodStart,
      p_period_end: periodEnd,
    })
    if (error) return { success: false, error: error.message }
    return { success: true, data: data as PerformanceSnapshot }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message ?? 'Unknown error' }
  }
}

// ── 2. getSnapshots ───────────────────────────────────────────────────────────

export async function getSnapshots(profileId: string): Promise<Result<PerformanceSnapshot[]>> {
  try {
    const { data, error } = await from('employee_performance_snapshots')
      .select('*')
      .eq('employee_profile_id', profileId)
      .order('period_start', { ascending: false })
    if (error) return { success: false, error: error.message }
    return { success: true, data: (data ?? []) as PerformanceSnapshot[] }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message ?? 'Unknown error' }
  }
}

// ── 3. getLatestSnapshot ──────────────────────────────────────────────────────

export async function getLatestSnapshot(profileId: string): Promise<Result<PerformanceSnapshot | null>> {
  try {
    const { data, error } = await from('employee_performance_snapshots')
      .select('*')
      .eq('employee_profile_id', profileId)
      .order('period_start', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) return { success: false, error: error.message }
    return { success: true, data: data as PerformanceSnapshot | null }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message ?? 'Unknown error' }
  }
}

// ── 4. addQualityRating ───────────────────────────────────────────────────────

export async function addQualityRating(
  profileId: string,
  assignmentId: string | null,
  score: number,
  notes: string | null,
): Promise<Result<QualityRating>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return { success: false, error: 'Not authenticated' }

    // Resolve org_id from the employee profile
    const { data: prof, error: profErr } = await from('employee_profiles')
      .select('org_id')
      .eq('id', profileId)
      .single()
    if (profErr) return { success: false, error: profErr.message }

    const { data, error } = await from('employee_quality_ratings')
      .insert({
        org_id: prof.org_id,
        employee_profile_id: profileId,
        assignment_id: assignmentId ?? null,
        rated_by: user.id,
        score,
        notes: notes ?? null,
      })
      .select()
      .single()
    if (error) return { success: false, error: error.message }
    return { success: true, data: data as QualityRating }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message ?? 'Unknown error' }
  }
}

// ── 5. getQualityRatings ──────────────────────────────────────────────────────

export async function getQualityRatings(profileId: string): Promise<Result<QualityRating[]>> {
  try {
    const { data, error } = await from('employee_quality_ratings')
      .select('*')
      .eq('employee_profile_id', profileId)
      .order('rated_at', { ascending: false })
    if (error) return { success: false, error: error.message }
    return { success: true, data: (data ?? []) as QualityRating[] }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message ?? 'Unknown error' }
  }
}

// ── 6. addCompensationEvent ───────────────────────────────────────────────────

export async function addCompensationEvent(
  profileId: string,
  eventType: CompensationEventType,
  amount: number | null,
  effectiveDate: string,
  reason: string | null,
  snapshotId?: string | null,
): Promise<Result<CompensationEvent>> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return { success: false, error: 'Not authenticated' }

    const { data: prof, error: profErr } = await from('employee_profiles')
      .select('org_id')
      .eq('id', profileId)
      .single()
    if (profErr) return { success: false, error: profErr.message }

    const { data, error } = await from('employee_compensation_events')
      .insert({
        org_id: prof.org_id,
        employee_profile_id: profileId,
        event_type: eventType,
        amount: amount ?? null,
        effective_date: effectiveDate,
        reason: reason ?? null,
        based_on_snapshot_id: snapshotId ?? null,
        created_by: user.id,
      })
      .select()
      .single()
    if (error) return { success: false, error: error.message }
    return { success: true, data: data as CompensationEvent }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message ?? 'Unknown error' }
  }
}

// ── 7. getCompensationHistory ─────────────────────────────────────────────────

export async function getCompensationHistory(profileId: string): Promise<Result<CompensationEvent[]>> {
  try {
    const { data, error } = await from('employee_compensation_events')
      .select('*')
      .eq('employee_profile_id', profileId)
      .order('effective_date', { ascending: false })
    if (error) return { success: false, error: error.message }
    return { success: true, data: (data ?? []) as CompensationEvent[] }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message ?? 'Unknown error' }
  }
}
