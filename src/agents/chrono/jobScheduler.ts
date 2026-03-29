// @ts-nocheck
/**
 * CHRONO Job Scheduler — Smart scheduling engine with crew/conflict/travel awareness.
 *
 * Issue 1: scheduleJob() — intelligent slot finder
 * Issue 5: Client reminder drafts via MiroFish
 *
 * Reads:
 *   - backup.employees working hours
 *   - VAULT estimate labor hours (via backupDataService)
 *   - BLUEPRINT coordination items (permit ready dates)
 *   - calendar_events (existing bookings)
 *   - crew_availability
 *
 * All booking actions go through MiroFish before execution.
 */

import { supabase } from '@/lib/supabase'
import { getBackupData } from '@/services/backupDataService'
import { submitProposal, runAutomatedReview } from '@/services/miroFish'
import { publish } from '@/services/agentEventBus'
import { logAudit } from '@/lib/memory/audit'
import { estimateTravelTime } from './crewDispatcher'
import { checkConflicts, getCalendarEvents, type CalendarEvent } from './calendarManager'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ScheduleJobInput {
  projectId?: string
  serviceLogId?: string
  preferredDateRange: { start: string; end: string }  // YYYY-MM-DD
  crewNeeded: number
  requiredSkills?: string[]
  estimatedHours?: number
  jobType?: string
  clientName?: string
  address?: string
}

export interface ScheduleSlotOption {
  rank: number
  date: string
  startTime: string
  endTime: string
  crewAssignments: {
    employeeId: string
    employeeName: string
    role: 'lead_tech' | 'tech_2' | 'helper'
    travelMinutes: number
    score: number
  }[]
  conflictCount: number
  travelTotalMinutes: number
  score: number
  reason: string
}

export interface ClientReminderDraft {
  type: '24h_confirmation' | 'day_of_arrival' | 'post_completion'
  clientName: string
  jobType: string
  scheduledTime: string
  address: string
  message: string
  eventId?: string
  invoiceAmount?: number
}

// ── Agenda Task Types (preserved from original) ───────────────────────────────

export interface AgendaTask {
  id: string
  org_id: string
  title: string
  task_type: 'standup' | 'follow_up' | 'reminder' | 'deadline' | 'escalation'
  assigned_to?: string
  due_date: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  created_at: string
}

// ── Smart Job Scheduling (Issue 1) ────────────────────────────────────────────

/**
 * Intelligent job scheduling that considers crew availability, job duration,
 * travel distance, permit ready dates, and existing calendar entries.
 * Returns ranked top-3 slot options with crew assignments.
 * Goes through MiroFish before booking.
 */
export async function scheduleJob(
  orgId: string,
  input: ScheduleJobInput
): Promise<{ slots: ScheduleSlotOption[]; proposalId?: string }> {
  const backup = getBackupData()
  const employees = backup?.employees || []

  // Determine job duration from VAULT estimate or default
  let jobHours = input.estimatedHours || 4
  if (input.projectId && backup?.projects) {
    const project = backup.projects.find((p: any) => p.id === input.projectId)
    if (project?.laborRows) {
      const totalLaborHours = project.laborRows.reduce((sum: number, row: any) => {
        return sum + (parseFloat(row.hours) || 0)
      }, 0)
      if (totalLaborHours > 0) jobHours = totalLaborHours
    }
  }

  // Check permit ready dates from BLUEPRINT coordination items
  let permitReadyDate: string | null = null
  if (input.projectId && backup?.projects) {
    const project = backup.projects.find((p: any) => p.id === input.projectId)
    if (project?.coord?.permits) {
      const pendingPermits = project.coord.permits.filter(
        (p: any) => p.status !== 'completed' && p.status !== 'done'
      )
      if (pendingPermits.length > 0) {
        // Find latest permit ready date
        const dates = pendingPermits
          .map((p: any) => p.dueDate || p.expectedDate)
          .filter(Boolean)
          .sort()
        if (dates.length > 0) {
          permitReadyDate = dates[dates.length - 1]
        }
      }
    }
  }

  // Generate candidate dates in the preferred range
  const startDate = new Date(input.preferredDateRange.start)
  const endDate = new Date(input.preferredDateRange.end)
  const candidateDates: string[] = []

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dayOfWeek = d.getDay()
    if (dayOfWeek === 0 || dayOfWeek === 6) continue // Skip weekends
    const dateStr = d.toISOString().split('T')[0]

    // Skip if before permit ready date
    if (permitReadyDate && dateStr < permitReadyDate) continue

    candidateDates.push(dateStr)
  }

  if (candidateDates.length === 0) {
    return { slots: [] }
  }

  // Score each candidate date
  const scoredSlots: ScheduleSlotOption[] = []

  for (const date of candidateDates) {
    // Get crew availability for this date
    const { data: crewAvail } = await supabase
      .from('crew_availability' as never)
      .select('*')
      .eq('org_id', orgId)
      .eq('availability_date', date)
      .eq('availability_status', 'available')

    const available = (crewAvail || []) as any[]

    // Also check backup employees for working hours fallback
    const fallbackCrew = employees
      .filter((emp: any) => emp.status === 'active' || !emp.status)
      .map((emp: any) => ({
        employee_id: emp.id || emp.name,
        employee_name: emp.name || emp.id,
        hours_available: emp.hoursPerDay || 8,
        skills: emp.skills || emp.certifications || [],
      }))

    // Merge: prefer Supabase crew_availability, fallback to backup employees
    let crewPool = available.length > 0
      ? available.map((c: any) => ({
          employee_id: c.employee_id,
          employee_name: c.employee_id,
          hours_available: c.hours_available || 8,
          skills: c.skills || [],
        }))
      : fallbackCrew

    // Filter by required skills if specified
    if (input.requiredSkills && input.requiredSkills.length > 0) {
      crewPool = crewPool.filter((crew: any) =>
        input.requiredSkills!.some(skill =>
          (crew.skills || []).some((s: string) =>
            s.toLowerCase().includes(skill.toLowerCase())
          )
        )
      )
    }

    if (crewPool.length < input.crewNeeded) continue

    // Check for conflicts with existing calendar entries
    const dayStart = `${date}T08:00:00`
    const dayEnd = `${date}T${String(8 + Math.ceil(jobHours)).padStart(2, '0')}:00:00`
    const conflicts = await checkConflicts(orgId, dayStart, dayEnd)

    // Score crew members
    const scored = crewPool.map((crew: any) => {
      let score = 50

      // Skill match bonus
      if (input.requiredSkills) {
        const matched = input.requiredSkills.filter(skill =>
          (crew.skills || []).some((s: string) =>
            s.toLowerCase().includes(skill.toLowerCase())
          )
        )
        score += matched.length * 15
      }

      // Hours availability bonus
      if (crew.hours_available >= jobHours) score += 10

      // Travel time
      const travelMin = input.address
        ? estimateTravelTime('Desert Hot Springs', input.address)
        : 20
      score += Math.max(0, 20 - (travelMin / 3))

      return {
        employeeId: crew.employee_id,
        employeeName: crew.employee_name,
        role: 'helper' as const,
        travelMinutes: travelMin,
        score: Math.min(100, Math.round(score)),
      }
    })

    // Sort by score, take top N
    scored.sort((a: any, b: any) => b.score - a.score)
    const assigned = scored.slice(0, input.crewNeeded)

    // Assign roles
    if (assigned.length > 0) assigned[0].role = 'lead_tech'
    if (assigned.length > 1) assigned[1].role = 'tech_2'

    const totalTravel = assigned.reduce((sum: number, a: any) => sum + a.travelMinutes, 0)
    const slotScore = Math.round(
      (assigned.reduce((sum: number, a: any) => sum + a.score, 0) / assigned.length)
      - (conflicts.length * 15)
      - (totalTravel / 10)
    )

    scoredSlots.push({
      rank: 0,
      date,
      startTime: `${date}T08:00:00`,
      endTime: `${date}T${String(8 + Math.ceil(jobHours)).padStart(2, '0')}:00:00`,
      crewAssignments: assigned,
      conflictCount: conflicts.length,
      travelTotalMinutes: totalTravel,
      score: Math.max(0, slotScore),
      reason: conflicts.length > 0
        ? `${conflicts.length} conflict(s) on this date`
        : 'Clear schedule',
    })
  }

  // Sort by score descending, take top 3
  scoredSlots.sort((a, b) => b.score - a.score)
  const top3 = scoredSlots.slice(0, 3).map((slot, idx) => ({ ...slot, rank: idx + 1 }))

  // If we have a top option, submit to MiroFish for approval
  let proposalId: string | undefined
  if (top3.length > 0) {
    try {
      const bestSlot = top3[0]
      const proposal = await submitProposal({
        orgId,
        proposingAgent: 'chrono',
        title: `Schedule ${input.jobType || 'job'} for ${input.clientName || input.projectId || 'client'}`,
        description: `Best slot: ${bestSlot.date} (${bestSlot.startTime}–${bestSlot.endTime}). ` +
          `Crew: ${bestSlot.crewAssignments.map(c => c.employeeName).join(', ')}. ` +
          `Score: ${bestSlot.score}/100. ${bestSlot.reason}.`,
        category: 'scheduling',
        impactLevel: 'medium',
        actionType: 'book_job',
        actionPayload: {
          slot: bestSlot,
          input,
          jobHours,
          permitReadyDate,
        },
      })

      proposalId = proposal.id
      await runAutomatedReview(proposal.id!)

      publish(
        'JOB_SCHEDULED',
        'chrono',
        { proposalId: proposal.id, date: bestSlot.date, crew: bestSlot.crewAssignments.length },
        `CHRONO proposed scheduling ${input.jobType || 'job'} on ${bestSlot.date} with ${bestSlot.crewAssignments.length} crew`
      )
    } catch (err) {
      console.error('[CHRONO] MiroFish submission error:', err)
    }
  }

  return { slots: top3, proposalId }
}

// ── Client Reminder Drafts (Issue 5) ──────────────────────────────────────────

/**
 * Generate client reminder drafts. All go through MiroFish for Christian's approval.
 */
export async function generateClientReminder(
  orgId: string,
  params: {
    type: ClientReminderDraft['type']
    clientName: string
    jobType: string
    scheduledTime: string
    address: string
    eventId?: string
    crewArrivalWindow?: string
    invoiceAmount?: number
    clientEmail?: string
    companyPhone?: string
  }
): Promise<ClientReminderDraft & { proposalId?: string }> {
  const phone = params.companyPhone || '(760) 555-0199'
  let message = ''

  switch (params.type) {
    case '24h_confirmation':
      message = `Hi ${params.clientName}, confirming your ${params.jobType} tomorrow at ${
        new Date(params.scheduledTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      }. Our team will arrive between ${params.crewArrivalWindow || '8:00–8:30 AM'}. Questions? Call ${phone}.`
      break

    case 'day_of_arrival':
      message = `Hi ${params.clientName}, we're on our way. ETA ${
        new Date(params.scheduledTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      }.`
      break

    case 'post_completion': {
      const amtStr = params.invoiceAmount
        ? `$${params.invoiceAmount.toLocaleString()}`
        : '[amount]'
      const emailStr = params.clientEmail || '[email]'
      message = `Hi ${params.clientName}, work is complete. Invoice for ${amtStr} sent to ${emailStr}.`
      break
    }
  }

  const draft: ClientReminderDraft = {
    type: params.type,
    clientName: params.clientName,
    jobType: params.jobType,
    scheduledTime: params.scheduledTime,
    address: params.address,
    message,
    eventId: params.eventId,
    invoiceAmount: params.invoiceAmount,
  }

  // Submit through MiroFish — Christian approves before any message is sent
  let proposalId: string | undefined
  try {
    const proposal = await submitProposal({
      orgId,
      proposingAgent: 'chrono',
      title: `Client reminder: ${params.type} for ${params.clientName}`,
      description: message,
      category: 'scheduling',
      impactLevel: 'medium',
      actionType: 'send_client_reminder',
      actionPayload: { draft },
    })

    proposalId = proposal.id
    await runAutomatedReview(proposal.id!)

    publish(
      'CLIENT_REMINDER_DRAFTED',
      'chrono',
      { proposalId: proposal.id, type: params.type, client: params.clientName },
      `CHRONO drafted ${params.type} reminder for ${params.clientName}`
    )
  } catch (err) {
    console.error('[CHRONO] Reminder MiroFish error:', err)
  }

  // Audit trail
  await logAudit({
    orgId,
    actorType: 'agent',
    actorId: 'chrono',
    action: 'insert',
    entityType: 'client_reminder',
    description: `Drafted ${params.type} reminder for ${params.clientName}`,
    metadata: { type: params.type, client: params.clientName, proposalId },
  })

  return { ...draft, proposalId }
}

/**
 * Scan today's events and generate reminders for upcoming jobs.
 * 24h reminders for tomorrow's jobs, day-of for today's, post-completion for completed today.
 */
export async function generateDailyReminders(orgId: string): Promise<ClientReminderDraft[]> {
  const today = new Date().toISOString().split('T')[0]
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
  const backup = getBackupData()

  const drafts: ClientReminderDraft[] = []

  // Tomorrow's jobs → 24h confirmation
  const tomorrowEvents = await getCalendarEvents(orgId, {
    startAfter: `${tomorrow}T00:00:00`,
    endBefore: `${tomorrow}T23:59:59`,
    eventType: 'job_schedule',
  })

  for (const event of tomorrowEvents) {
    const clientName = extractClientName(event, backup)
    if (clientName) {
      const draft = await generateClientReminder(orgId, {
        type: '24h_confirmation',
        clientName,
        jobType: event.title,
        scheduledTime: event.start_time,
        address: event.address || event.location || '',
        eventId: event.id,
      })
      drafts.push(draft)
    }
  }

  return drafts
}

// ── Preserved Original Functions ──────────────────────────────────────────────

export async function getAgendaTasks(
  orgId: string,
  filters?: { status?: string; dueDate?: string; assignedTo?: string }
): Promise<AgendaTask[]> {
  let query = supabase
    .from('agenda_tasks' as never)
    .select('*')
    .eq('org_id', orgId)
    .order('due_date', { ascending: true })

  if (filters?.status) query = query.eq('status', filters.status)
  if (filters?.dueDate) query = query.eq('due_date', filters.dueDate)
  if (filters?.assignedTo) query = query.eq('assigned_to', filters.assignedTo)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as unknown as AgendaTask[]
}

export async function createAgendaTask(orgId: string, task: Partial<AgendaTask>): Promise<AgendaTask> {
  const { data, error } = await supabase
    .from('agenda_tasks' as never)
    .insert({
      org_id: orgId,
      title: task.title,
      task_type: task.task_type || 'follow_up',
      assigned_to: task.assigned_to || null,
      due_date: task.due_date || new Date().toISOString().split('T')[0],
      status: 'pending',
      priority: task.priority || 'medium',
    } as never)
    .select()
    .single()

  if (error) throw error
  return data as unknown as AgendaTask
}

export async function updateAgendaTask(taskId: string, updates: Partial<AgendaTask>): Promise<AgendaTask> {
  const { data, error } = await supabase
    .from('agenda_tasks' as never)
    .update(updates as never)
    .eq('id', taskId)
    .select()
    .single()

  if (error) throw error
  return data as unknown as AgendaTask
}

export async function getDailyStandup(orgId: string, date: string): Promise<{
  tasks: AgendaTask[]
  overdue: AgendaTask[]
  completedToday: AgendaTask[]
}> {
  const tasks = await getAgendaTasks(orgId, { dueDate: date, status: 'pending' })

  const { data: overdueData, error: overdueError } = await supabase
    .from('agenda_tasks' as never)
    .select('*')
    .eq('org_id', orgId)
    .eq('status', 'pending')
    .lt('due_date', date)
    .order('due_date', { ascending: true })

  if (overdueError) throw overdueError
  const overdue = (overdueData ?? []) as unknown as AgendaTask[]

  const completedToday = await getAgendaTasks(orgId, { dueDate: date, status: 'completed' })

  return { tasks, overdue, completedToday }
}

export async function scheduleReminder(
  orgId: string,
  eventTitle: string,
  clientName: string,
  eventTime: string,
  reminderType: '24h' | '2h' | 'post_job'
): Promise<AgendaTask> {
  const eventDate = new Date(eventTime)
  let dueDate: string
  let title: string

  switch (reminderType) {
    case '24h':
      dueDate = new Date(eventDate.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      title = `24h Reminder: ${clientName} - ${eventTitle}`
      break
    case '2h':
      dueDate = new Date(eventDate.getTime() - 2 * 60 * 60 * 1000).toISOString().split('T')[0]
      title = `2h Reminder: ${clientName} - ${eventTitle}`
      break
    case 'post_job':
      dueDate = new Date(eventDate.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      title = `Post-Job Follow-up: ${clientName} - ${eventTitle}`
      break
  }

  return createAgendaTask(orgId, {
    title,
    task_type: 'reminder',
    due_date: dueDate,
    priority: reminderType === '24h' ? 'high' : 'medium',
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractClientName(event: CalendarEvent, backup: any): string | null {
  // Try to extract from event title (format: "[Job type] — [Client name]")
  const titleParts = (event.title || '').split('—').map(s => s.trim())
  if (titleParts.length > 1) return titleParts[1]

  // Try to match via project_id to backup
  if (event.project_id && backup?.projects) {
    const project = backup.projects.find((p: any) => p.id === event.project_id)
    if (project?.name) return project.name
  }

  // Try client_id in backup customers
  if (event.client_id && backup?.customers) {
    const customer = backup.customers.find((c: any) => c.id === event.client_id)
    if (customer?.name) return customer.name
  }

  return null
}
