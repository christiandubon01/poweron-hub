import { supabase } from '@/lib/supabase'

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
  score: number // 0-100
  skills_matched: string[]
  travel_minutes: number
  available_hours: number
}

// Coachella Valley travel time estimates (minutes)
const TRAVEL_MATRIX: Record<string, Record<string, number>> = {
  'Palm Springs': { 'Indio': 25, 'La Quinta': 30, 'Coachella': 35, 'Palm Desert': 18, 'Cathedral City': 10, 'Rancho Mirage': 12 },
  'Palm Desert': { 'Palm Springs': 18, 'Indio': 15, 'La Quinta': 12, 'Coachella': 25, 'Cathedral City': 10, 'Rancho Mirage': 8 },
  'Indio': { 'Palm Springs': 25, 'Palm Desert': 15, 'La Quinta': 10, 'Coachella': 15, 'Cathedral City': 22, 'Rancho Mirage': 18 },
  'La Quinta': { 'Palm Springs': 30, 'Palm Desert': 12, 'Indio': 10, 'Coachella': 20, 'Cathedral City': 25, 'Rancho Mirage': 15 },
  'Cathedral City': { 'Palm Springs': 10, 'Palm Desert': 10, 'Indio': 22, 'La Quinta': 25, 'Rancho Mirage': 5 },
  'Rancho Mirage': { 'Palm Springs': 12, 'Palm Desert': 8, 'Indio': 18, 'La Quinta': 15, 'Cathedral City': 5 },
}

export function estimateTravelTime(from: string, to: string): number {
  // Try exact city match
  const fromCity = Object.keys(TRAVEL_MATRIX).find(c => from.toLowerCase().includes(c.toLowerCase()))
  const toCity = Object.keys(TRAVEL_MATRIX).find(c => to.toLowerCase().includes(c.toLowerCase()))

  if (fromCity && toCity && TRAVEL_MATRIX[fromCity]?.[toCity]) {
    return TRAVEL_MATRIX[fromCity][toCity]
  }

  // Default estimate for unknown locations
  return 30
}

export async function getAvailableCrew(
  orgId: string,
  date: string,
  requiredSkills?: string[]
): Promise<CrewAvailability[]> {
  let query = supabase
    .from('crew_availability' as never)
    .select('*')
    .eq('org_id', orgId)
    .eq('availability_date', date)
    .eq('availability_status', 'available')

  const { data, error } = await query
  if (error) throw error

  let available = (data ?? []) as unknown as CrewAvailability[]

  // Filter by skills if required
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
  // 1. Get available crew
  const available = await getAvailableCrew(orgId, requirements.date, requirements.skills)

  if (available.length === 0) {
    throw new Error('No crew members available with required skills for this date')
  }

  // 2. Score each crew member
  const scored: CrewMatch[] = available.map(crew => {
    let score = 50 // base score

    // Skill match bonus
    const matchedSkills = requirements.skills.filter(req =>
      crew.skills.some(s => s.toLowerCase().includes(req.toLowerCase()))
    )
    score += matchedSkills.length * 15

    // Hours availability bonus
    const hoursAvail = crew.hours_available ?? 8
    if (hoursAvail >= requirements.hours) score += 10

    // Travel time estimate
    const travelMin = requirements.location
      ? estimateTravelTime('Palm Desert', requirements.location) // default from office
      : 20

    // Lower travel = higher score
    score += Math.max(0, 20 - (travelMin / 3))

    return {
      employee_id: crew.employee_id,
      employee_name: crew.employee_id, // would need join to get name
      score: Math.min(100, Math.round(score)),
      skills_matched: matchedSkills,
      travel_minutes: travelMin,
      available_hours: hoursAvail,
    }
  })

  // 3. Sort by score descending
  scored.sort((a, b) => b.score - a.score)

  // 4. Assign top N crew
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
