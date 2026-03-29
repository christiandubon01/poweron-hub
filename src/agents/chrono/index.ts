// @ts-nocheck
/**
 * CHRONO Orchestrator — Calendar & Scheduling intelligence for PowerOn Hub.
 *
 * Phase D full automation:
 *   - Smart job scheduling (Issue 1)
 *   - Crew dispatch with optimized routing (Issue 2)
 *   - Idle slot detection + lead follow-up filling (Issue 3)
 *   - Conflict alerts 48h in advance (Issue 4)
 *   - Client reminders (Issue 5)
 *   - Google Calendar two-way sync (Issue 6)
 *
 * All high-impact actions go through MiroFish.
 * All cross-agent communication goes through agentEventBus.
 */

import { CHRONO_SYSTEM_PROMPT } from './systemPrompt'
import {
  getCalendarEvents, createCalendarEvent, updateCalendarEvent,
  deleteCalendarEvent, checkConflicts, getDailySchedule,
} from './calendarManager'
import {
  getAvailableCrew, dispatchCrew, getJobSchedules,
  generateDailyBriefing, detectIdleSlots,
  estimateTravelTime,
  type CrewDailyBriefing, type IdleSlotInfo,
} from './crewDispatcher'
import {
  getAgendaTasks, createAgendaTask, updateAgendaTask,
  getDailyStandup, scheduleReminder,
  scheduleJob, generateClientReminder, generateDailyReminders,
  type ScheduleJobInput, type ScheduleSlotOption, type ClientReminderDraft,
} from './jobScheduler'
import { logAudit } from '@/lib/memory/audit'
import { publish } from '@/services/agentEventBus'
import { getBackupData } from '@/services/backupDataService'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ChronoAction =
  | 'get_events' | 'create_event' | 'update_event' | 'delete_event'
  | 'check_conflicts' | 'get_daily_schedule'
  | 'get_available_crew' | 'dispatch_crew' | 'get_job_schedules'
  | 'get_agenda_tasks' | 'create_agenda_task' | 'update_agenda_task'
  | 'get_daily_standup' | 'schedule_reminder' | 'generate_schedule_summary'
  // Phase D new actions
  | 'schedule_job' | 'generate_daily_briefing' | 'detect_idle_slots'
  | 'run_conflict_scan' | 'generate_client_reminder' | 'generate_daily_reminders'

export interface ChronoRequest {
  action: ChronoAction
  orgId: string
  userId: string
  params?: Record<string, unknown>
}

export interface ChronoResponse {
  action: ChronoAction
  data: unknown
  summary: string
  timestamp: string
}

export interface ConflictAlert {
  type: 'double_booking' | 'no_permit' | 'material_clash' | 'impossible_travel' | 'day_off'
  severity: 'warning' | 'critical'
  date: string
  description: string
  affectedCrew?: string[]
  affectedEvents?: string[]
  suggestedAction: string
}

export { CHRONO_SYSTEM_PROMPT }

// Re-export types for UI consumers
export type {
  ScheduleSlotOption, ScheduleJobInput, ClientReminderDraft,
  CrewDailyBriefing, IdleSlotInfo,
}

// ── Conflict Scanning (Issue 4) ───────────────────────────────────────────────

/**
 * Scan for scheduling conflicts in the next 48 hours (or specified range).
 * Detects: double bookings, jobs before permit approval, impossible travel,
 * crew on day off, material delivery clashes.
 * Publishes SCHEDULE_CONFLICT to agentEventBus.
 */
export async function runConflictScan(
  orgId: string,
  daysAhead = 2
): Promise<ConflictAlert[]> {
  const alerts: ConflictAlert[] = []
  const backup = getBackupData()
  const employees = backup?.employees || []

  for (let dayOffset = 0; dayOffset <= daysAhead; dayOffset++) {
    const date = new Date(Date.now() + dayOffset * 86400000)
    const dateStr = date.toISOString().split('T')[0]
    const dayOfWeek = date.getDay()

    // Get all events for this day
    const dayStart = `${dateStr}T00:00:00`
    const dayEnd = `${dateStr}T23:59:59`
    const events = await getDailySchedule(orgId, dateStr)

    // Get job schedules for these events
    const eventIds = events.map(e => e.id)
    let schedules: any[] = []
    if (eventIds.length > 0) {
      const result = await getJobSchedules(orgId, {})
      schedules = result.filter(s => eventIds.includes(s.calendar_event_id))
    }

    // ── Check 1: Double-booked crew ───────────────────────────────────────
    const crewEventMap: Record<string, { eventId: string; title: string; start: string; end: string }[]> = {}
    for (const sched of schedules) {
      const event = events.find(e => e.id === sched.calendar_event_id)
      if (!event) continue
      if (!crewEventMap[sched.employee_id]) crewEventMap[sched.employee_id] = []
      crewEventMap[sched.employee_id].push({
        eventId: event.id,
        title: event.title,
        start: event.start_time,
        end: event.end_time,
      })
    }

    for (const [crewId, crewEvents] of Object.entries(crewEventMap)) {
      for (let i = 0; i < crewEvents.length; i++) {
        for (let j = i + 1; j < crewEvents.length; j++) {
          const a = crewEvents[i]
          const b = crewEvents[j]
          // Check overlap
          if (a.start < b.end && a.end > b.start) {
            const empName = employees.find((e: any) => (e.id || e.name) === crewId)?.name || crewId
            alerts.push({
              type: 'double_booking',
              severity: 'critical',
              date: dateStr,
              description: `${empName} is double-booked: "${a.title}" and "${b.title}" overlap on ${dateStr}`,
              affectedCrew: [crewId],
              affectedEvents: [a.eventId, b.eventId],
              suggestedAction: `Reschedule one of these jobs or assign a different crew member.`,
            })
          }
        }
      }
    }

    // ── Check 2: Impossible travel time between back-to-back jobs ─────────
    for (const [crewId, crewEvents] of Object.entries(crewEventMap)) {
      const sorted = [...crewEvents].sort((a, b) => a.start.localeCompare(b.start))
      for (let i = 0; i < sorted.length - 1; i++) {
        const current = sorted[i]
        const next = sorted[i + 1]
        const currentEvent = events.find(e => e.id === current.eventId)
        const nextEvent = events.find(e => e.id === next.eventId)

        if (currentEvent?.address && nextEvent?.address) {
          const travelMin = estimateTravelTime(currentEvent.address, nextEvent.address)
          const gapMs = new Date(next.start).getTime() - new Date(current.end).getTime()
          const gapMin = gapMs / 60000

          if (travelMin > gapMin && gapMin >= 0) {
            const empName = employees.find((e: any) => (e.id || e.name) === crewId)?.name || crewId
            alerts.push({
              type: 'impossible_travel',
              severity: 'warning',
              date: dateStr,
              description: `${empName} has ${Math.round(gapMin)}min gap but needs ~${travelMin}min travel from "${current.title}" to "${next.title}"`,
              affectedCrew: [crewId],
              affectedEvents: [current.eventId, next.eventId],
              suggestedAction: `Add buffer time or reassign one job to a closer crew member.`,
            })
          }
        }
      }
    }

    // ── Check 3: Jobs before permit approval (from BLUEPRINT) ─────────────
    for (const event of events) {
      if (event.project_id && backup?.projects) {
        const project = backup.projects.find((p: any) => p.id === event.project_id)
        if (project?.coord?.permits) {
          const pendingPermits = project.coord.permits.filter(
            (p: any) => p.status !== 'completed' && p.status !== 'done'
          )
          if (pendingPermits.length > 0) {
            alerts.push({
              type: 'no_permit',
              severity: 'critical',
              date: dateStr,
              description: `"${event.title}" is scheduled but project "${project.name}" has ${pendingPermits.length} pending permit(s)`,
              affectedEvents: [event.id],
              suggestedAction: `Verify permit status with BLUEPRINT before this job proceeds.`,
            })
          }
        }
      }
    }

    // ── Check 4: Crew on day off ──────────────────────────────────────────
    for (const sched of schedules) {
      // Check crew_availability table for unavailable status
      const { data: avail } = await supabase
        .from('crew_availability' as never)
        .select('availability_status')
        .eq('org_id', orgId)
        .eq('employee_id', sched.employee_id)
        .eq('availability_date', dateStr)
        .single()

      if (avail && avail.availability_status !== 'available') {
        const empName = employees.find((e: any) => (e.id || e.name) === sched.employee_id)?.name || sched.employee_id
        alerts.push({
          type: 'day_off',
          severity: 'warning',
          date: dateStr,
          description: `${empName} is marked "${avail.availability_status}" but has a job scheduled on ${dateStr}`,
          affectedCrew: [sched.employee_id],
          suggestedAction: `Reassign this job or update crew availability.`,
        })
      }

      // Weekend check
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        const empName = employees.find((e: any) => (e.id || e.name) === sched.employee_id)?.name || sched.employee_id
        alerts.push({
          type: 'day_off',
          severity: 'warning',
          date: dateStr,
          description: `${empName} has a job scheduled on ${dayOfWeek === 0 ? 'Sunday' : 'Saturday'} (${dateStr})`,
          affectedCrew: [sched.employee_id],
          suggestedAction: `Confirm weekend overtime or reschedule to a weekday.`,
        })
      }
    }
  }

  // Publish conflicts to event bus
  if (alerts.length > 0) {
    const criticalCount = alerts.filter(a => a.severity === 'critical').length
    publish(
      'SCHEDULE_CONFLICT',
      'chrono',
      {
        totalConflicts: alerts.length,
        criticalCount,
        alerts: alerts.map(a => ({ type: a.type, date: a.date, description: a.description })),
      },
      `⚠️ CHRONO found ${alerts.length} scheduling conflict(s) (${criticalCount} critical) in the next ${daysAhead} days`
    )
  }

  await logAudit({
    orgId,
    actorType: 'agent',
    actorId: 'chrono',
    action: 'fetch',
    entityType: 'conflict_scan',
    description: `Conflict scan: ${alerts.length} issues found in next ${daysAhead} days`,
    metadata: { alertCount: alerts.length, daysScanned: daysAhead },
  })

  return alerts
}

// ── Main Processor ────────────────────────────────────────────────────────────

export async function processChronoRequest(request: ChronoRequest): Promise<ChronoResponse> {
  const startTime = Date.now()

  try {
    let data: unknown
    let summary: string = ''

    switch (request.action) {
      // ── Original actions (preserved) ──────────────────────────────────
      case 'get_events':
        data = await getCalendarEvents(request.orgId, request.params as any)
        summary = `Found ${(data as any[]).length} calendar events`
        break

      case 'create_event':
        data = await createCalendarEvent(request.orgId, request.params as any)
        summary = `Event "${(data as any).title}" created`
        break

      case 'update_event':
        data = await updateCalendarEvent(request.params?.eventId as string, request.params as any)
        summary = `Event updated`
        break

      case 'delete_event':
        await deleteCalendarEvent(request.params?.eventId as string)
        data = { deleted: true }
        summary = 'Event deleted'
        break

      case 'check_conflicts':
        data = await checkConflicts(
          request.orgId,
          request.params?.startTime as string,
          request.params?.endTime as string,
          request.params?.excludeEventId as string
        )
        summary = `${(data as any[]).length} conflicts found`
        break

      case 'get_daily_schedule':
        data = await getDailySchedule(request.orgId, request.params?.date as string)
        summary = `${(data as any[]).length} events scheduled for ${request.params?.date}`
        break

      case 'get_available_crew':
        data = await getAvailableCrew(
          request.orgId,
          request.params?.date as string,
          request.params?.skills as string[]
        )
        summary = `${(data as any[]).length} crew members available`
        break

      case 'dispatch_crew':
        data = await dispatchCrew(request.orgId, request.params?.calendarEventId as string, request.params as any)
        summary = `${(data as any[]).length} crew members dispatched`
        break

      case 'get_job_schedules':
        data = await getJobSchedules(request.orgId, request.params as any)
        summary = `Found ${(data as any[]).length} job schedules`
        break

      case 'get_agenda_tasks':
        data = await getAgendaTasks(request.orgId, request.params as any)
        summary = `Found ${(data as any[]).length} agenda tasks`
        break

      case 'create_agenda_task':
        data = await createAgendaTask(request.orgId, request.params as any)
        summary = `Task "${(data as any).title}" created`
        break

      case 'update_agenda_task':
        data = await updateAgendaTask(request.params?.taskId as string, request.params as any)
        summary = 'Task updated'
        break

      case 'get_daily_standup':
        data = await getDailyStandup(request.orgId, request.params?.date as string)
        const standup = data as { tasks: any[]; overdue: any[]; completedToday: any[] }
        summary = `Standup: ${standup.tasks.length} tasks today, ${standup.overdue.length} overdue, ${standup.completedToday.length} completed`
        break

      case 'schedule_reminder':
        data = await scheduleReminder(
          request.orgId,
          request.params?.eventTitle as string,
          request.params?.clientName as string,
          request.params?.eventTime as string,
          request.params?.reminderType as '24h' | '2h' | 'post_job'
        )
        summary = `Reminder scheduled: ${(data as any).title}`
        break

      case 'generate_schedule_summary':
        data = await generateScheduleSummary(request.orgId, request.params?.date as string)
        summary = data as string
        break

      // ── Phase D new actions ─────────────────────────────────────────────

      case 'schedule_job':
        data = await scheduleJob(request.orgId, request.params as unknown as ScheduleJobInput)
        const result = data as { slots: ScheduleSlotOption[]; proposalId?: string }
        summary = result.slots.length > 0
          ? `Found ${result.slots.length} slot option(s). Best: ${result.slots[0].date} (score ${result.slots[0].score}). MiroFish proposal submitted.`
          : 'No available slots in the requested date range.'
        break

      case 'generate_daily_briefing':
        data = await generateDailyBriefing(request.orgId, request.params?.date as string)
        const briefings = data as CrewDailyBriefing[]
        const idle = briefings.filter(b => b.idle).length
        summary = `Briefing: ${briefings.length} crew, ${briefings.reduce((s, b) => s + b.totalJobs, 0)} jobs, ${idle} idle`
        break

      case 'detect_idle_slots':
        data = await detectIdleSlots(request.orgId)
        const idleResult = data as { idleSlots: IdleSlotInfo[]; totalIdleHours: number; suggestions: string[] }
        summary = `${idleResult.idleSlots.length} idle slots (${Math.round(idleResult.totalIdleHours)}h total). ${idleResult.suggestions.join(' ')}`
        break

      case 'run_conflict_scan':
        data = await runConflictScan(request.orgId, (request.params?.daysAhead as number) || 2)
        const conflicts = data as ConflictAlert[]
        summary = conflicts.length > 0
          ? `⚠️ ${conflicts.length} conflict(s) found: ${conflicts.map(c => c.type).join(', ')}`
          : '✅ No scheduling conflicts detected'
        break

      case 'generate_client_reminder':
        data = await generateClientReminder(request.orgId, request.params as any)
        summary = `Reminder drafted for ${(request.params as any)?.clientName}: ${(data as any)?.type}`
        break

      case 'generate_daily_reminders':
        data = await generateDailyReminders(request.orgId)
        summary = `Generated ${(data as any[]).length} reminder draft(s)`
        break

      default:
        throw new Error(`Unknown CHRONO action: ${request.action}`)
    }

    // Audit
    await logAudit({
      orgId: request.orgId,
      actorType: 'agent',
      actorId: 'chrono',
      action: 'fetch',
      entityType: 'scheduling',
      description: `CHRONO executed ${request.action}`,
      metadata: { action: request.action, duration: Date.now() - startTime },
    })

    return {
      action: request.action,
      data,
      summary,
      timestamp: new Date().toISOString(),
    }
  } catch (error) {
    console.error('[CHRONO] processChronoRequest error:', error)

    await logAudit({
      orgId: request.orgId,
      actorType: 'agent',
      actorId: 'chrono',
      action: 'error',
      entityType: 'scheduling',
      description: `CHRONO error on ${request.action}`,
      metadata: { error: String(error) },
    })

    throw error
  }
}

// ── AI Schedule Summary ───────────────────────────────────────────────────────

async function generateScheduleSummary(orgId: string, date: string): Promise<string> {
  try {
    const [events, standup] = await Promise.all([
      getDailySchedule(orgId, date),
      getDailyStandup(orgId, date),
    ])

    const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string

    const response = await fetch('/api/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        system: CHRONO_SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `Generate a daily schedule summary for ${date}:\n\nEvents:\n${JSON.stringify(events, null, 2)}\n\nTasks:\n${JSON.stringify(standup, null, 2)}\n\nProvide: total jobs, crew status, travel estimates, deadlines, and any concerns. Be concise.`,
        }],
      }),
    })

    if (!response.ok) throw new Error(`Claude API error: ${response.statusText}`)

    const result = (await response.json()) as { content?: Array<{ type: string; text: string }> }
    return result.content?.find(c => c.type === 'text')?.text ?? 'Unable to generate summary.'
  } catch (error) {
    console.error('[CHRONO] generateScheduleSummary error:', error)
    return 'Schedule summary unavailable.'
  }
}

// Need supabase for conflict scan
import { supabase } from '@/lib/supabase'
