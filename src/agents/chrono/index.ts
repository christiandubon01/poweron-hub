// @ts-nocheck
/**
 * CHRONO Orchestrator — Calendar & Scheduling intelligence for PowerOn Hub
 *
 * Actions:
 * - get_events: List calendar events with filters
 * - create_event: Create a calendar event with conflict check
 * - update_event: Update a calendar event
 * - delete_event: Delete a calendar event
 * - check_conflicts: Check for scheduling conflicts
 * - get_daily_schedule: Get all events for a specific day
 * - get_available_crew: Get available crew for a date/skills
 * - dispatch_crew: Run crew dispatch algorithm
 * - get_job_schedules: Get job schedules
 * - get_agenda_tasks: Get agenda tasks
 * - create_agenda_task: Create a task
 * - update_agenda_task: Update a task
 * - get_daily_standup: Get daily standup summary
 * - schedule_reminder: Schedule a client reminder
 * - generate_schedule_summary: AI-generated schedule summary
 */

import { CHRONO_SYSTEM_PROMPT } from './systemPrompt'
import {
  getCalendarEvents, createCalendarEvent, updateCalendarEvent,
  deleteCalendarEvent, checkConflicts, getDailySchedule,
} from './calendarManager'
import { getAvailableCrew, dispatchCrew, getJobSchedules } from './crewDispatcher'
import {
  getAgendaTasks, createAgendaTask, updateAgendaTask,
  getDailyStandup, scheduleReminder,
} from './jobScheduler'
import { logAudit } from '@/lib/memory/audit'

// Types
export type ChronoAction =
  | 'get_events' | 'create_event' | 'update_event' | 'delete_event'
  | 'check_conflicts' | 'get_daily_schedule'
  | 'get_available_crew' | 'dispatch_crew' | 'get_job_schedules'
  | 'get_agenda_tasks' | 'create_agenda_task' | 'update_agenda_task'
  | 'get_daily_standup' | 'schedule_reminder' | 'generate_schedule_summary'

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

export { CHRONO_SYSTEM_PROMPT }

// Main processor
export async function processChronoRequest(request: ChronoRequest): Promise<ChronoResponse> {
  const startTime = Date.now()

  try {
    let data: unknown
    let summary: string = ''

    switch (request.action) {
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

// AI schedule summary generator
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
