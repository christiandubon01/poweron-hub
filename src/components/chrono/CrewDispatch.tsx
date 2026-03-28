'use client'

import { useState, useEffect } from 'react'
import { Calendar, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import clsx from 'clsx'

interface CrewAvailability {
  id: string
  employee_id: string
  availability_date: string
  availability_status: 'available' | 'unavailable' | 'vacation' | 'sick' | 'pto' | 'training'
  hours_available: number
  skills: string[]
  certifications: string[]
  org_id: string
}

interface JobSchedule {
  id: string
  calendar_event_id: string
  employee_id: string
  org_id: string
}

interface CalendarEvent {
  id: string
  title: string
  start_time: string
  end_time: string
}

const statusColors = {
  available: 'bg-emerald-400/10 text-emerald-400 border border-emerald-400/20',
  unavailable: 'bg-red-400/10 text-red-400 border border-red-400/20',
  vacation: 'bg-yellow-400/10 text-yellow-400 border border-yellow-400/20',
  sick: 'bg-orange-400/10 text-orange-400 border border-orange-400/20',
  pto: 'bg-purple-400/10 text-purple-400 border border-purple-400/20',
  training: 'bg-blue-400/10 text-blue-400 border border-blue-400/20',
}

const statusBgColors = {
  available: 'bg-emerald-400/10',
  unavailable: 'bg-red-400/10',
  vacation: 'bg-yellow-400/10',
  sick: 'bg-orange-400/10',
  pto: 'bg-purple-400/10',
  training: 'bg-blue-400/10',
}

export function CrewDispatch() {
  const { profile } = useAuth()
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [crews, setCrews] = useState<CrewAvailability[]>([])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [schedules, setSchedules] = useState<JobSchedule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const orgId = profile?.org_id

  useEffect(() => {
    if (!orgId) return

    const fetchData = async () => {
      setLoading(true)
      setError(null)
      try {
        // Fetch crew availability
        const { data: crewData, error: crewErr } = await supabase
          .from('crew_availability' as never)
          .select('*')
          .eq('org_id', orgId)
          .eq('availability_date', selectedDate)
          .order('availability_status', { ascending: true })

        if (crewErr) throw crewErr

        // Fetch calendar events for the date
        const dayStart = `${selectedDate}T00:00:00`
        const dayEnd = `${selectedDate}T23:59:59`

        const { data: eventData, error: eventErr } = await supabase
          .from('calendar_events' as never)
          .select('id, title, start_time, end_time')
          .eq('org_id', orgId)
          .gte('start_time', dayStart)
          .lte('start_time', dayEnd)

        if (eventErr) throw eventErr

        // Fetch job schedules for the events
        const eventIds = (eventData ?? []).map((e: any) => e.id)
        let scheduleData: JobSchedule[] = []

        if (eventIds.length > 0) {
          const { data: scheduleResult, error: scheduleErr } = await supabase
            .from('job_schedules' as never)
            .select('*')
            .eq('org_id', orgId)
            .in('calendar_event_id', eventIds)

          if (scheduleErr) throw scheduleErr
          scheduleData = scheduleResult || []
        }

        setCrews(crewData || [])
        setEvents(eventData || [])
        setSchedules(scheduleData)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load crew availability')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [orgId, selectedDate])

  const getAssignedJobs = (employeeId: string) => {
    return schedules
      .filter((s) => s.employee_id === employeeId)
      .map((s) => events.find((e) => e.id === s.calendar_event_id))
      .filter(Boolean) as CalendarEvent[]
  }

  const formatTime = (isoString: string) => {
    const date = new Date(isoString)
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
  }

  const groupedCrews = crews.reduce(
    (acc, crew) => {
      if (crew.availability_status === 'available') {
        acc.available.push(crew)
      } else {
        acc.unavailable.push(crew)
      }
      return acc
    },
    { available: [] as CrewAvailability[], unavailable: [] as CrewAvailability[] }
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Date Picker */}
      <div className="flex items-center gap-2">
        <Calendar className="w-4 h-4 text-gray-400" />
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="bg-gray-700/50 border border-gray-600 text-gray-100 rounded px-3 py-2 text-sm"
        />
      </div>

      {error && <div className="bg-red-400/10 border border-red-400/20 text-red-400 rounded p-3 text-sm">{error}</div>}

      {crews.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <Calendar className="w-12 h-12 text-gray-500 mb-3" />
          <p className="text-gray-400">No crew availability records for this date</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Available Crew */}
          {groupedCrews.available.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-emerald-400 mb-3 uppercase tracking-wide">Available</h3>
              <div className="grid gap-3">
                {groupedCrews.available.map((crew) => {
                  const assignedJobs = getAssignedJobs(crew.employee_id)
                  return (
                    <div
                      key={crew.id}
                      className={clsx('bg-gray-800/50 border border-gray-700 rounded p-4', statusBgColors[crew.availability_status])}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="text-sm font-semibold text-gray-100">
                            {crew.employee_id.slice(0, 8)}
                          </div>
                          <div className="text-xs text-gray-400">
                            {crew.hours_available} hours available
                          </div>
                        </div>
                        <span className={clsx('px-2 py-1 rounded text-xs font-medium', statusColors[crew.availability_status])}>
                          {crew.availability_status}
                        </span>
                      </div>

                      {crew.skills && crew.skills.length > 0 && (
                        <div className="mb-2">
                          <div className="text-xs text-gray-500 mb-1">Skills</div>
                          <div className="flex flex-wrap gap-1">
                            {crew.skills.map((skill, idx) => (
                              <span
                                key={idx}
                                className="px-2 py-1 bg-cyan-400/10 text-cyan-400 rounded text-xs"
                              >
                                {skill}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {crew.certifications && crew.certifications.length > 0 && (
                        <div className="mb-2">
                          <div className="text-xs text-gray-500 mb-1">Certifications</div>
                          <div className="flex flex-wrap gap-1">
                            {crew.certifications.map((cert, idx) => (
                              <span
                                key={idx}
                                className="px-1.5 py-0.5 bg-gray-700/50 text-gray-400 rounded text-xs"
                              >
                                {cert}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {assignedJobs.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-gray-700">
                          <div className="text-xs text-gray-500 mb-2">Assigned Jobs</div>
                          <div className="space-y-1">
                            {assignedJobs.map((job) => (
                              <div key={job.id} className="text-xs text-gray-300 bg-gray-700/30 rounded p-2">
                                <div className="font-medium">{job.title}</div>
                                <div className="text-gray-500">
                                  {formatTime(job.start_time)} - {formatTime(job.end_time)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Unavailable Crew */}
          {groupedCrews.unavailable.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-500 mb-3 uppercase tracking-wide">Unavailable</h3>
              <div className="grid gap-3">
                {groupedCrews.unavailable.map((crew) => (
                  <div
                    key={crew.id}
                    className={clsx('bg-gray-800/50 border border-gray-700 rounded p-4', statusBgColors[crew.availability_status])}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-sm font-semibold text-gray-100">
                          {crew.employee_id.slice(0, 8)}
                        </div>
                        <div className="text-xs text-gray-400">
                          {crew.hours_available} hours available
                        </div>
                      </div>
                      <span className={clsx('px-2 py-1 rounded text-xs font-medium', statusColors[crew.availability_status])}>
                        {crew.availability_status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
