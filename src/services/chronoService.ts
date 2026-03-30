// @ts-nocheck
/**
 * chronoService — Data layer for CHRONO Phase D Part 1
 *
 * Wraps Supabase queries for:
 *  - crew_availability table
 *  - job_schedule table
 *
 * Conflict detection is built-in to scheduleJob().
 * AgentBus events are published after each write.
 */

import { supabase } from '@/lib/supabase'
import { publish as busPublish } from '@/services/agentBus'
import { publish as eventPublish } from '@/services/agentEventBus'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CrewAvailability {
  id: string
  user_id: string
  crew_member: string
  date: string
  available_from: string
  available_until: string
  is_available: boolean
  notes: string | null
  created_at: string
}

export interface JobScheduleRow {
  id: string
  user_id: string
  project_id: string | null
  job_title: string
  crew_assigned: string[]
  scheduled_date: string
  start_time: string
  estimated_hours: number
  status: 'scheduled' | 'in_progress' | 'complete' | 'cancelled'
  conflict_flag: boolean
  conflict_reason: string | null
  created_at: string
}

export interface ScheduleJobInput {
  project_id?: string
  job_title: string
  crew_assigned: string[]
  scheduled_date: string   // YYYY-MM-DD
  start_time?: string      // HH:MM  default '08:00'
  estimated_hours?: number // default 8
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

async function getCurrentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser()
  return data?.user?.id ?? null
}

// ── getAvailability ───────────────────────────────────────────────────────────

/**
 * Returns crew_availability rows for a given date range (inclusive).
 */
export async function getAvailability(
  dateRange: { start: Date; end: Date }
): Promise<CrewAvailability[]> {
  const userId = await getCurrentUserId()
  if (!userId) return []

  const startStr = toDateStr(dateRange.start)
  const endStr   = toDateStr(dateRange.end)

  const { data, error } = await supabase
    .from('crew_availability')
    .select('*')
    .eq('user_id', userId)
    .gte('date', startStr)
    .lte('date', endStr)
    .order('date', { ascending: true })

  if (error) {
    console.error('[chronoService] getAvailability error:', error)
    return []
  }
  return (data as CrewAvailability[]) ?? []
}

// ── detectConflicts ───────────────────────────────────────────────────────────

/**
 * Returns all existing job_schedule rows for a crew member on a given date.
 * Used internally by scheduleJob() and also exported for the agent tool.
 */
export async function detectConflicts(
  crewMember: string,
  date: Date
): Promise<JobScheduleRow[]> {
  const userId = await getCurrentUserId()
  if (!userId) return []

  const dateStr = toDateStr(date)

  const { data, error } = await supabase
    .from('job_schedule')
    .select('*')
    .eq('user_id', userId)
    .eq('scheduled_date', dateStr)
    .contains('crew_assigned', [crewMember])
    .neq('status', 'cancelled')

  if (error) {
    console.error('[chronoService] detectConflicts error:', error)
    return []
  }
  return (data as JobScheduleRow[]) ?? []
}

// ── scheduleJob ───────────────────────────────────────────────────────────────

/**
 * Inserts a new job into job_schedule.
 *
 * Before inserting:
 *   1. For each crew member, check if they already have a job on scheduled_date.
 *   2. If any overlap is found → set conflict_flag=true, conflict_reason='Crew [name] already scheduled on [date]'
 *   3. Insert regardless (flag only, no blocking).
 *   4. Publish agentBus events:
 *        - always: CHRONO → NEXUS 'data_updated' (job scheduled)
 *        - on conflict: CHRONO → NEXUS 'alert' (conflict details)
 *        - on idle-filling: CHRONO → SPARK 'data_updated' (for Phase E)
 */
export async function scheduleJob(
  jobData: ScheduleJobInput
): Promise<JobScheduleRow> {
  const userId = await getCurrentUserId()
  if (!userId) throw new Error('[chronoService] Not authenticated')

  const scheduledDate = new Date(jobData.scheduled_date + 'T00:00:00')
  const crewAssigned  = jobData.crew_assigned ?? []
  let conflictFlag   = false
  const conflictReasons: string[] = []

  // ── Conflict detection per crew member ────────────────────────────────────
  for (const member of crewAssigned) {
    const existingJobs = await detectConflicts(member, scheduledDate)
    if (existingJobs.length > 0) {
      conflictFlag = true
      conflictReasons.push(`Crew ${member} already scheduled on ${jobData.scheduled_date}`)
    }
  }

  const conflictReason = conflictReasons.length > 0 ? conflictReasons.join('; ') : null

  // ── Insert job ────────────────────────────────────────────────────────────
  const insertPayload = {
    user_id:         userId,
    project_id:      jobData.project_id ?? null,
    job_title:       jobData.job_title,
    crew_assigned:   crewAssigned,
    scheduled_date:  jobData.scheduled_date,
    start_time:      jobData.start_time ?? '08:00',
    estimated_hours: jobData.estimated_hours ?? 8,
    status:          'scheduled' as const,
    conflict_flag:   conflictFlag,
    conflict_reason: conflictReason,
  }

  const { data, error } = await supabase
    .from('job_schedule')
    .insert(insertPayload)
    .select()
    .single()

  if (error) {
    console.error('[chronoService] scheduleJob insert error:', error)
    throw error
  }

  const newJob = data as JobScheduleRow

  // ── AgentBus: job scheduled → NEXUS data_updated ──────────────────────────
  busPublish(
    'CHRONO',
    'NEXUS',
    'data_updated',
    {
      event:      'job_scheduled',
      jobId:      newJob.id,
      jobTitle:   newJob.job_title,
      date:       newJob.scheduled_date,
      crew:       newJob.crew_assigned,
      hasConflict: conflictFlag,
    }
  )

  // ── agentEventBus: JOB_SCHEDULED ─────────────────────────────────────────
  eventPublish(
    'JOB_SCHEDULED',
    'chrono',
    {
      jobId:    newJob.id,
      jobTitle: newJob.job_title,
      date:     newJob.scheduled_date,
      crew:     newJob.crew_assigned,
    },
    `Job "${newJob.job_title}" scheduled for ${newJob.scheduled_date} (crew: ${crewAssigned.join(', ')})`
  )

  // ── AgentBus: conflict → NEXUS alert ──────────────────────────────────────
  if (conflictFlag) {
    busPublish(
      'CHRONO',
      'NEXUS',
      'alert',
      {
        conflict:  true,
        details:   conflictReason,
        jobId:     newJob.id,
        jobTitle:  newJob.job_title,
        date:      newJob.scheduled_date,
        crew:      newJob.crew_assigned,
      }
    )

    eventPublish(
      'SCHEDULE_CONFLICT',
      'chrono',
      {
        jobId:    newJob.id,
        jobTitle: newJob.job_title,
        details:  conflictReason,
      },
      `⚠️ Scheduling conflict: ${conflictReason}`
    )
  }

  return newJob
}

// ── getIdleSlots ──────────────────────────────────────────────────────────────

/**
 * Scans the next `lookahead` days and returns dates with NO scheduled jobs.
 * Publishes IDLE_SLOTS_DETECTED to SPARK so Phase E can use idle dates
 * for lead follow-up suggestions.
 */
export async function getIdleSlots(
  lookahead: number = 7
): Promise<string[]> {
  const userId = await getCurrentUserId()
  if (!userId) return []

  const today = new Date()
  const endDate = new Date(today)
  endDate.setDate(endDate.getDate() + lookahead - 1)

  const startStr = toDateStr(today)
  const endStr   = toDateStr(endDate)

  const { data, error } = await supabase
    .from('job_schedule')
    .select('scheduled_date')
    .eq('user_id', userId)
    .gte('scheduled_date', startStr)
    .lte('scheduled_date', endStr)
    .neq('status', 'cancelled')

  if (error) {
    console.error('[chronoService] getIdleSlots error:', error)
    return []
  }

  // Build set of busy dates
  const busyDates = new Set<string>(
    ((data as { scheduled_date: string }[]) ?? []).map(r => r.scheduled_date)
  )

  // Collect idle dates (skip weekends — Sat=6, Sun=0)
  const idleDates: string[] = []
  for (let i = 0; i < lookahead; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    const dow = d.getDay()
    if (dow === 0 || dow === 6) continue  // skip weekends
    const ds = toDateStr(d)
    if (!busyDates.has(ds)) {
      idleDates.push(ds)
    }
  }

  // ── AgentBus: idle slots → SPARK data_updated ─────────────────────────────
  if (idleDates.length > 0) {
    busPublish(
      'CHRONO',
      'SPARK',
      'data_updated',
      {
        event:     'idle_slots_detected',
        idleDates,
        lookahead,
      }
    )

    eventPublish(
      'IDLE_SLOTS_DETECTED',
      'chrono',
      { idleDates, lookahead },
      `CHRONO found ${idleDates.length} idle slot(s) in the next ${lookahead} days`
    )
  }

  return idleDates
}

// ── getUpcomingSchedule ───────────────────────────────────────────────────────

/**
 * Returns job_schedule rows for the next `days` days,
 * including conflict_flag and conflict_reason.
 * Sorted ascending by scheduled_date.
 */
export async function getUpcomingSchedule(
  days: number = 14
): Promise<JobScheduleRow[]> {
  const userId = await getCurrentUserId()
  if (!userId) return []

  const today  = new Date()
  const endDate = new Date(today)
  endDate.setDate(endDate.getDate() + days - 1)

  const startStr = toDateStr(today)
  const endStr   = toDateStr(endDate)

  const { data, error } = await supabase
    .from('job_schedule')
    .select('*')
    .eq('user_id', userId)
    .gte('scheduled_date', startStr)
    .lte('scheduled_date', endStr)
    .order('scheduled_date', { ascending: true })
    .order('start_time',     { ascending: true })

  if (error) {
    console.error('[chronoService] getUpcomingSchedule error:', error)
    return []
  }
  return (data as JobScheduleRow[]) ?? []
}
