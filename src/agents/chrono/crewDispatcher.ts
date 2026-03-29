// @ts-nocheck
/**
 * CHRONO Crew Dispatcher — Daily crew briefing, optimized routing, idle detection.
 *
 * Issue 2: Daily crew briefing generator with geography-sorted jobs
 * Issue 3: Idle slot detection + lead follow-up filling
 *
 * Reads backup.employees for working hours, calendar_events + job_schedules
 * for daily assignments. Publishes CREW_DISPATCHED and IDLE_SLOTS_DETECTED
 * to agentEventBus. All booking actions go through MiroFish.
 */

import { supabase } from '@/lib/supabase'
import { getBackupData } from '@/services/backupDataService'
import { publish } from '@/services/agentEventBus'
import { submitProposal, runAutomatedReview } from '@/services/miroFish'
import { logAudit } from '@/lib/memory/audit'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CrewAvailability {
  id: string
  org_id: string
  employee_id: string
  availability_date: string
  availability_status: 'available' | 'unavailable' | 'vacation' | 'sick' | 'pto' | 'training'
  hours_available?: number
  skills: string[]
  certifications: string[]
  created_at: string
}

export interface JobSchedule {
  id: string
  org_id: string
  calendar_event_id: string
  employee_id: string
  lead_role: 'lead_tech' | 'tech_2' | 'helper' | 'supervisor'
  job_status: 'scheduled' | 'confirmed' | 'in_progress' | 'completed' | 'no_show' | 'cancelled'
  estimated_hours?: number
  travel_time_to_job?: number
  travel_distance?: number
  created_at: string
}

export interface CrewMatch {
  employee_id: string
  employee_name: string
  score: number
  skills_matched: string[]
  travel_minutes: number
  available_hours: number
}

export interface CrewDailyBriefing {
  employeeId: string
  employeeName: string
  totalJobs: number
  totalHours: number
  totalDriveMinutes: number
  idle: boolean
  jobs: {
    order: number
    title: string
    address: string
    startTime: string
    endTime: string
    hours: number
    travelMinutesFromPrevious: number
  }[]
  briefingText: string
}

export interface IdleSlotInfo {
  date: string
  employeeId: string
  employeeName: string
  gapStartHour: number
  gapEndHour: number
  gapHours: number
}

// ── Coachella Valley Travel Matrix ────────────────────────────────────────────

const TRAVEL_MATRIX: Record<string, Record<string, number>> = {
  'Palm Springs':    { 'Indio': 25, 'La Quinta': 30, 'Coachella': 35, 'Palm Desert': 18, 'Cathedral City': 10, 'Rancho Mirage': 12, 'Desert Hot Springs': 15, 'Thousand Palms': 20, 'Bermuda Dunes': 22 },
  'Palm Desert':     { 'Palm Springs': 18, 'Indio': 15, 'La Quinta': 12, 'Coachella': 25, 'Cathedral City': 10, 'Rancho Mirage': 8, 'Desert Hot Springs': 22, 'Thousand Palms': 12, 'Bermuda Dunes': 8 },
  'Indio':           { 'Palm Springs': 25, 'Palm Desert': 15, 'La Quinta': 10, 'Coachella': 15, 'Cathedral City': 22, 'Rancho Mirage': 18, 'Desert Hot Springs': 30, 'Thousand Palms': 20, 'Bermuda Dunes': 10 },
  'La Quinta':       { 'Palm Springs': 30, 'Palm Desert': 12, 'Indio': 10, 'Coachella': 20, 'Cathedral City': 25, 'Rancho Mirage': 15, 'Desert Hot Springs': 35, 'Thousand Palms': 18, 'Bermuda Dunes': 8 },
  'Cathedral City':  { 'Palm Springs': 10, 'Palm Desert': 10, 'Indio': 22, 'La Quinta': 25, 'Rancho Mirage': 5, 'Desert Hot Springs': 12, 'Thousand Palms': 15, 'Bermuda Dunes': 15 },
  'Rancho Mirage':   { 'Palm Springs': 12, 'Palm Desert': 8, 'Indio': 18, 'La Quinta': 15, 'Cathedral City': 5, 'Desert Hot Springs': 18, 'Thousand Palms': 10, 'Bermuda Dunes': 10 },
  'Desert Hot Springs': { 'Palm Springs': 15, 'Palm Desert': 22, 'Indio': 30, 'La Quinta': 35, 'Cathedral City': 12, 'Rancho Mirage': 18, 'Thousand Palms': 20, 'Bermuda Dunes': 25 },
  'Thousand Palms':  { 'Palm Springs': 20, 'Palm Desert': 12, 'Indio': 20, 'Cathedral City': 15, 'Rancho Mirage': 10, 'Desert Hot Springs': 20, 'Bermuda Dunes': 10 },
  'Bermuda Dunes':   { 'Palm Desert': 8, 'Indio': 10, 'La Quinta': 8, 'Cathedral City': 15, 'Rancho Mirage': 10, 'Thousand Palms': 10 },
}

/**
 * Estimate travel time between two locations using the Coachella Valley matrix.
 * Falls back to straight-line distance estimation for unknown locations.
 */
export function estimateTravelTime(from: string, to: string): number {
  if (!from || !to) return 20

  const fromCity = Object.keys(TRAVEL_MATRIX).find(c =>
    from.toLowerCase().includes(c.toLowerCase())
  )
  const toCity = Object.keys(TRAVEL_MATRIX).find(c =>
    to.toLowerCase().includes(c.toLowerCase())
  )

  if (fromCity && toCity && TRAVEL_MATRIX[fromCity]?.[toCity]) {
    return TRAVEL_MATRIX[fromCity][toCity]
  }

  // Same city
  if (fromCity && toCity && fromCity === toCity) return 10

  // Default estimate for unknown locations in the valley
  return 30
}

/**
 * Cluster jobs by geographic proximity (sorts jobs to minimize total travel).
 * Simple nearest-neighbor heuristic starting from office (Desert Hot Springs).
 */
function clusterByGeography(
  jobs: { address: string; title: string; startTime: string; endTime: string; hours: number }[]
): typeof jobs {
  if (jobs.length <= 1) return jobs

  const remaining = [...jobs]
  const ordered: typeof jobs = []
  let currentLocation = 'Desert Hot Springs' // Office location

  while (remaining.length > 0) {
    let nearestIdx = 0
    let nearestDist = Infinity

    for (let i = 0; i < remaining.length; i++) {
      const dist = estimateTravelTime(currentLocation, remaining[i].address)
      if (dist < nearestDist) {
        nearestDist = dist
        nearestIdx = i
      }
    }

    const next = remaining.splice(nearestIdx, 1)[0]
    ordered.push(next)
    currentLocation = next.address || currentLocation
  }

  return ordered
}

// ── Daily Crew Briefing (Issue 2) ─────────────────────────────────────────────

/**
 * Generate per-crew daily briefings with geography-optimized routing.
 * Publishes CREW_DISPATCHED event. Flags idle crew members.
 */
export async function generateDailyBriefing(
  orgId: string,
  date?: string
): Promise<CrewDailyBriefing[]> {
  const targetDate = date || new Date().toISOString().split('T')[0]
  const backup = getBackupData()
  const employees = backup?.employees || []

  // Get all events for the day
  const dayStart = `${targetDate}T00:00:00`
  const dayEnd = `${targetDate}T23:59:59`

  const { data: events } = await supabase
    .from('calendar_events' as never)
    .select('*')
    .eq('org_id', orgId)
    .gte('start_time', dayStart)
    .lte('start_time', dayEnd)
    .order('start_time', { ascending: true })

  const dayEvents = (events || []) as any[]

  // Get all job schedules for these events
  const eventIds = dayEvents.map((e: any) => e.id)
  let jobSchedules: any[] = []

  if (eventIds.length > 0) {
    const { data: schedules } = await supabase
      .from('job_schedules' as never)
      .select('*')
      .eq('org_id', orgId)
      .in('calendar_event_id', eventIds)

    jobSchedules = (schedules || []) as any[]
  }

  // Build per-employee briefings
  const briefings: CrewDailyBriefing[] = []

  // Get unique employee IDs from schedules + backup employees
  const employeeIds = new Set<string>()
  jobSchedules.forEach((js: any) => employeeIds.add(js.employee_id))
  employees.forEach((emp: any) => {
    if (emp.status === 'active' || !emp.status) {
      employeeIds.add(emp.id || emp.name)
    }
  })

  for (const empId of employeeIds) {
    const empData = employees.find((e: any) => (e.id || e.name) === empId)
    const empName = empData?.name || empId
    const workHours = empData?.hoursPerDay || 8

    // Get this employee's assigned events
    const empSchedules = jobSchedules.filter((js: any) => js.employee_id === empId)
    const empEvents = empSchedules
      .map((js: any) => {
        const event = dayEvents.find((e: any) => e.id === js.calendar_event_id)
        if (!event) return null
        const startDate = new Date(event.start_time)
        const endDate = new Date(event.end_time)
        const hours = (endDate.getTime() - startDate.getTime()) / 3600000
        return {
          title: event.title,
          address: event.address || event.location || '',
          startTime: event.start_time,
          endTime: event.end_time,
          hours: Math.round(hours * 10) / 10,
        }
      })
      .filter(Boolean)

    // Sort by geography (cluster nearby jobs)
    const clustered = clusterByGeography(empEvents)

    // Calculate travel times between jobs
    let totalDrive = 0
    const jobsWithTravel = clustered.map((job: any, idx: number) => {
      const prevAddress = idx === 0 ? 'Desert Hot Springs' : clustered[idx - 1].address
      const travelMin = estimateTravelTime(prevAddress, job.address)
      totalDrive += travelMin
      return {
        order: idx + 1,
        ...job,
        travelMinutesFromPrevious: travelMin,
      }
    })

    const totalHours = jobsWithTravel.reduce((sum: number, j: any) => sum + j.hours, 0)
    const idle = jobsWithTravel.length === 0

    // Generate briefing text
    let briefingText = ''
    if (idle) {
      briefingText = `${empName}: No jobs scheduled today.`
    } else {
      const jobLines = jobsWithTravel.map((j: any) => {
        const start = new Date(j.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        return `Job ${j.order} at ${j.address || 'TBD'} (${start}, ${j.hours}hrs)`
      })
      briefingText = `Today: ${jobLines.join(' → ')}. Total drive: ~${totalDrive}min.`
    }

    briefings.push({
      employeeId: empId,
      employeeName: empName,
      totalJobs: jobsWithTravel.length,
      totalHours,
      totalDriveMinutes: totalDrive,
      idle,
      jobs: jobsWithTravel,
      briefingText,
    })
  }

  // Flag idle crew members
  const idleCrew = briefings.filter(b => b.idle)
  if (idleCrew.length > 0) {
    console.log(`[CHRONO] ${idleCrew.length} crew member(s) with 0 jobs today`)
  }

  // Publish CREW_DISPATCHED event
  publish(
    'CREW_DISPATCHED',
    'chrono',
    {
      date: targetDate,
      totalCrew: briefings.length,
      idleCrew: idleCrew.length,
      totalJobs: dayEvents.length,
      briefings: briefings.map(b => ({
        name: b.employeeName,
        jobs: b.totalJobs,
        idle: b.idle,
      })),
    },
    `CHRONO morning briefing: ${briefings.length} crew, ${dayEvents.length} jobs, ${idleCrew.length} idle`
  )

  await logAudit({
    orgId,
    actorType: 'agent',
    actorId: 'chrono',
    action: 'fetch',
    entityType: 'crew_dispatch',
    description: `Daily briefing generated for ${targetDate}: ${briefings.length} crew, ${dayEvents.length} jobs`,
    metadata: { date: targetDate, crewCount: briefings.length, idleCount: idleCrew.length },
  })

  return briefings
}

// ── Idle Slot Detection (Issue 3) ─────────────────────────────────────────────

/**
 * Scan next 14 days for unbooked windows (gaps of 2+ hours).
 * Cross-references SPARK lead pipeline and LEDGER follow-up queue.
 * Returns suggestions and submits to MiroFish.
 */
export async function detectIdleSlots(
  orgId: string
): Promise<{
  idleSlots: IdleSlotInfo[]
  totalIdleHours: number
  suggestions: string[]
  proposalId?: string
}> {
  const backup = getBackupData()
  const employees = (backup?.employees || []).filter((e: any) => e.status === 'active' || !e.status)
  const idleSlots: IdleSlotInfo[] = []
  const WORK_START = 8  // 8 AM
  const WORK_END = 17   // 5 PM

  // Scan next 14 days
  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const date = new Date(Date.now() + dayOffset * 86400000)
    if (date.getDay() === 0 || date.getDay() === 6) continue // Skip weekends
    const dateStr = date.toISOString().split('T')[0]

    // Get events for this day
    const { data: dayEvents } = await supabase
      .from('calendar_events' as never)
      .select('id, start_time, end_time')
      .eq('org_id', orgId)
      .gte('start_time', `${dateStr}T00:00:00`)
      .lte('start_time', `${dateStr}T23:59:59`)
      .order('start_time', { ascending: true })

    // Get job schedules for those events
    const eventIds = (dayEvents || []).map((e: any) => e.id)
    let schedules: any[] = []
    if (eventIds.length > 0) {
      const { data } = await supabase
        .from('job_schedules' as never)
        .select('employee_id, calendar_event_id, estimated_hours')
        .eq('org_id', orgId)
        .in('calendar_event_id', eventIds)
      schedules = data || []
    }

    for (const emp of employees) {
      const empId = emp.id || emp.name
      const empSchedules = schedules.filter((s: any) => s.employee_id === empId)

      // Build busy blocks
      const busyBlocks: { start: number; end: number }[] = []
      for (const sched of empSchedules) {
        const event = (dayEvents || []).find((e: any) => e.id === sched.calendar_event_id)
        if (!event) continue
        const startH = new Date(event.start_time).getHours()
        const endH = new Date(event.end_time).getHours() || startH + (sched.estimated_hours || 2)
        busyBlocks.push({ start: startH, end: endH })
      }

      // Sort busy blocks
      busyBlocks.sort((a, b) => a.start - b.start)

      // Find gaps of 2+ hours
      let lastEnd = WORK_START
      for (const block of busyBlocks) {
        const gap = block.start - lastEnd
        if (gap >= 2) {
          idleSlots.push({
            date: dateStr,
            employeeId: empId,
            employeeName: emp.name || empId,
            gapStartHour: lastEnd,
            gapEndHour: block.start,
            gapHours: gap,
          })
        }
        lastEnd = Math.max(lastEnd, block.end)
      }

      // Check gap at end of day
      if (WORK_END - lastEnd >= 2) {
        idleSlots.push({
          date: dateStr,
          employeeId: empId,
          employeeName: emp.name || empId,
          gapStartHour: lastEnd,
          gapEndHour: WORK_END,
          gapHours: WORK_END - lastEnd,
        })
      }
    }
  }

  const totalIdleHours = idleSlots.reduce((sum, s) => sum + s.gapHours, 0)

  // Cross-reference with SPARK leads (leads with no site visit)
  const leads = backup?.serviceLeads || []
  const leadsReady = leads.filter((l: any) =>
    l.status === 'new' || l.status === 'contacted' || !l.status
  )

  // Cross-reference with LEDGER follow-up queue (overdue AR)
  const serviceLogs = backup?.serviceLogs || []
  const overdueAR = serviceLogs.filter((sl: any) => {
    const totalBillable = (sl.quoted || 0) + (
      (sl.adjustments || [])
        .filter((a: any) => a.type === 'income')
        .reduce((sum: number, a: any) => sum + (a.amount || 0), 0)
    )
    return (sl.collected || 0) < totalBillable && totalBillable > 0
  })

  // Generate suggestions
  const suggestions: string[] = []
  if (totalIdleHours > 0) {
    suggestions.push(
      `CHRONO found ${Math.round(totalIdleHours)} idle hours in the next 14 days.`
    )
  }
  if (leadsReady.length > 0) {
    suggestions.push(
      `SPARK has ${leadsReady.length} lead(s) ready for site visits. Book them?`
    )
  }
  if (overdueAR.length > 0) {
    suggestions.push(
      `LEDGER has ${overdueAR.length} overdue AR follow-up(s) that could fill idle time.`
    )
  }

  // Publish event
  if (totalIdleHours > 0) {
    publish(
      'IDLE_SLOTS_DETECTED',
      'chrono',
      {
        totalIdleHours,
        slotCount: idleSlots.length,
        leadsReady: leadsReady.length,
        overdueAR: overdueAR.length,
      },
      suggestions.join(' ')
    )
  }

  // Submit to MiroFish if there are actionable suggestions
  let proposalId: string | undefined
  if (leadsReady.length > 0 && totalIdleHours >= 4) {
    try {
      const proposal = await submitProposal({
        orgId,
        proposingAgent: 'chrono',
        title: `Fill ${Math.round(totalIdleHours)} idle hours with ${leadsReady.length} lead site visits`,
        description: suggestions.join(' '),
        category: 'scheduling',
        impactLevel: 'low',
        actionType: 'book_job',
        actionPayload: {
          idleSlots: idleSlots.slice(0, 5),
          suggestedLeads: leadsReady.slice(0, 3).map((l: any) => ({
            name: l.name || l.customer,
            address: l.address,
          })),
        },
      })
      proposalId = proposal.id
      await runAutomatedReview(proposal.id!)
    } catch (err) {
      console.error('[CHRONO] Idle slot MiroFish error:', err)
    }
  }

  return { idleSlots, totalIdleHours, suggestions, proposalId }
}

// ── Preserved Original Functions ──────────────────────────────────────────────

export async function getAvailableCrew(
  orgId: string,
  date: string,
  requiredSkills?: string[]
): Promise<CrewAvailability[]> {
  const { data, error } = await supabase
    .from('crew_availability' as never)
    .select('*')
    .eq('org_id', orgId)
    .eq('availability_date', date)
    .eq('availability_status', 'available')

  if (error) throw error

  let available = (data ?? []) as unknown as CrewAvailability[]

  if (requiredSkills && requiredSkills.length > 0) {
    available = available.filter(crew =>
      requiredSkills.some(skill =>
        crew.skills.some(s => s.toLowerCase().includes(skill.toLowerCase()))
      )
    )
  }

  return available
}

export async function dispatchCrew(
  orgId: string,
  calendarEventId: string,
  requirements: {
    date: string
    location?: string
    skills: string[]
    crewCount: number
    hours: number
  }
): Promise<JobSchedule[]> {
  const available = await getAvailableCrew(orgId, requirements.date, requirements.skills)

  if (available.length === 0) {
    throw new Error('No crew members available with required skills for this date')
  }

  const scored: CrewMatch[] = available.map(crew => {
    let score = 50

    const matchedSkills = requirements.skills.filter(req =>
      crew.skills.some(s => s.toLowerCase().includes(req.toLowerCase()))
    )
    score += matchedSkills.length * 15

    const hoursAvail = crew.hours_available ?? 8
    if (hoursAvail >= requirements.hours) score += 10

    const travelMin = requirements.location
      ? estimateTravelTime('Desert Hot Springs', requirements.location)
      : 20

    score += Math.max(0, 20 - (travelMin / 3))

    return {
      employee_id: crew.employee_id,
      employee_name: crew.employee_id,
      score: Math.min(100, Math.round(score)),
      skills_matched: matchedSkills,
      travel_minutes: travelMin,
      available_hours: hoursAvail,
    }
  })

  scored.sort((a, b) => b.score - a.score)

  const assigned = scored.slice(0, requirements.crewCount)
  const schedules: JobSchedule[] = []

  for (let i = 0; i < assigned.length; i++) {
    const crew = assigned[i]
    const role = i === 0 ? 'lead_tech' : i === 1 ? 'tech_2' : 'helper'

    const { data, error } = await supabase
      .from('job_schedules' as never)
      .insert({
        org_id: orgId,
        calendar_event_id: calendarEventId,
        employee_id: crew.employee_id,
        lead_role: role,
        job_status: 'scheduled',
        estimated_hours: requirements.hours,
        travel_time_to_job: crew.travel_minutes,
      } as never)
      .select()
      .single()

    if (error) throw error
    schedules.push(data as unknown as JobSchedule)
  }

  return schedules
}

export async function getJobSchedules(
  orgId: string,
  filters?: { eventId?: string; employeeId?: string; status?: string }
): Promise<JobSchedule[]> {
  let query = supabase
    .from('job_schedules' as never)
    .select('*')
    .eq('org_id', orgId)

  if (filters?.eventId) query = query.eq('calendar_event_id', filters.eventId)
  if (filters?.employeeId) query = query.eq('employee_id', filters.employeeId)
  if (filters?.status) query = query.eq('job_status', filters.status)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as unknown as JobSchedule[]
}
