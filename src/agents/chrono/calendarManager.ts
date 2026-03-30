import { supabase } from '@/lib/supabase'

export type EventType = 'job_schedule' | 'meeting' | 'appointment' | 'deadline' | 'vacation' | 'maintenance'

export interface CalendarEvent {
  id: string
  org_id: string
  title: string
  event_type: EventType
  start_time: string
  end_time: string
  location?: string
  address?: string
  latitude?: number
  longitude?: number
  client_id?: string
  project_id?: string
  created_by?: string
  created_at: string
  updated_at: string
}

export async function getCalendarEvents(
  orgId: string,
  filters?: { startAfter?: string; endBefore?: string; eventType?: EventType }
): Promise<CalendarEvent[]> {
  let query = supabase
    .from('calendar_events' as never)
    .select('*')
    .eq('org_id', orgId)
    .order('start_time', { ascending: true })

  if (filters?.startAfter) query = query.gte('start_time', filters.startAfter)
  if (filters?.endBefore) query = query.lte('end_time', filters.endBefore)
  if (filters?.eventType) query = query.eq('event_type', filters.eventType)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as unknown as CalendarEvent[]
}

export async function createCalendarEvent(orgId: string, event: Partial<CalendarEvent>): Promise<CalendarEvent> {
  // Conflict check
  const conflicts = await checkConflicts(orgId, event.start_time!, event.end_time!)
  if (conflicts.length > 0) {
    console.warn(`[CHRONO] ${conflicts.length} potential conflicts detected for new event`)
  }

  const { data, error } = await supabase
    .from('calendar_events' as never)
    .insert({
      org_id: orgId,
      title: event.title,
      event_type: event.event_type || 'appointment',
      start_time: event.start_time,
      end_time: event.end_time,
      location: event.location || null,
      address: event.address || null,
      latitude: event.latitude || null,
      longitude: event.longitude || null,
      client_id: event.client_id || null,
      project_id: event.project_id || null,
      created_by: event.created_by || null,
    } as never)
    .select()
    .single()

  if (error) throw error
  return data as unknown as CalendarEvent
}

export async function updateCalendarEvent(eventId: string, updates: Partial<CalendarEvent>): Promise<CalendarEvent> {
  const { data, error } = await supabase
    .from('calendar_events' as never)
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', eventId)
    .select()
    .single()

  if (error) throw error
  return data as unknown as CalendarEvent
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  const { error } = await supabase
    .from('calendar_events' as never)
    .delete()
    .eq('id', eventId)

  if (error) throw error
}

export async function checkConflicts(
  orgId: string,
  startTime: string,
  endTime: string,
  excludeEventId?: string
): Promise<CalendarEvent[]> {
  let query = supabase
    .from('calendar_events' as never)
    .select('*')
    .eq('org_id', orgId)
    .lt('start_time', endTime)
    .gt('end_time', startTime)

  if (excludeEventId) query = query.neq('id', excludeEventId)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as unknown as CalendarEvent[]
}

export async function getDailySchedule(orgId: string, date: string): Promise<CalendarEvent[]> {
  const dayStart = `${date}T00:00:00`
  const dayEnd = `${date}T23:59:59`

  return getCalendarEvents(orgId, { startAfter: dayStart, endBefore: dayEnd })
}
