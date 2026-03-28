// @ts-nocheck
'use client'

import { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Plus, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import clsx from 'clsx'

interface CalendarEvent {
  id: string
  title: string
  event_type: 'job_schedule' | 'meeting' | 'appointment' | 'deadline' | 'vacation' | 'maintenance'
  start_time: string
  end_time: string
  location?: string
  address?: string
  org_id: string
}

const eventTypeColors = {
  job_schedule: 'bg-emerald-400/10 text-emerald-400 border border-emerald-400/20',
  meeting: 'bg-blue-400/10 text-blue-400 border border-blue-400/20',
  appointment: 'bg-cyan-400/10 text-cyan-400 border border-cyan-400/20',
  deadline: 'bg-red-400/10 text-red-400 border border-red-400/20',
  vacation: 'bg-yellow-400/10 text-yellow-400 border border-yellow-400/20',
  maintenance: 'bg-orange-400/10 text-orange-400 border border-orange-400/20',
}

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function CalendarView() {
  const { profile } = useAuth()
  const [weekOffset, setWeekOffset] = useState(0)
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [formData, setFormData] = useState({
    title: '',
    event_type: 'meeting' as const,
    start_time: '',
    end_time: '',
    location: '',
    address: '',
  })

  const orgId = profile?.org_id

  // Calculate week dates
  const today = new Date()
  const weekStart = new Date(today)
  weekStart.setDate(today.getDate() - today.getDay() + 1 + weekOffset * 7)
  weekStart.setHours(0, 0, 0, 0)

  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)
  weekEnd.setHours(23, 59, 59, 999)

  const weekLabel = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

  const weekStartISO = weekStart.toISOString()
  const weekEndISO = weekEnd.toISOString()

  useEffect(() => {
    if (!orgId) {
      setLoading(false)
      return
    }

    const fetchEvents = async () => {
      setLoading(true)
      setError(null)
      try {
        const { data, error: err } = await supabase
          .from('calendar_events' as never)
          .select('*')
          .eq('org_id', orgId)
          .gte('start_time', weekStartISO)
          .lte('start_time', weekEndISO)
          .order('start_time', { ascending: true })

        if (err) throw err
        setEvents(data || [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load events')
      } finally {
        setLoading(false)
      }
    }

    fetchEvents()
  }, [orgId, weekStartISO, weekEndISO])

  const getEventsForDay = (dayIndex: number) => {
    const dayStart = new Date(weekStart)
    dayStart.setDate(weekStart.getDate() + dayIndex)
    const dayEnd = new Date(dayStart)
    dayEnd.setHours(23, 59, 59, 999)

    return events.filter((e) => {
      const eventDate = new Date(e.start_time)
      return eventDate >= dayStart && eventDate <= dayEnd
    })
  }

  const formatTime = (isoString: string) => {
    const date = new Date(isoString)
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
  }

  const handleAddEvent = async () => {
    if (!orgId || !formData.title || !formData.start_time || !formData.end_time) return

    try {
      const { error: err } = await supabase.from('calendar_events' as never).insert([
        {
          org_id: orgId,
          title: formData.title,
          event_type: formData.event_type,
          start_time: new Date(formData.start_time).toISOString(),
          end_time: new Date(formData.end_time).toISOString(),
          location: formData.location || null,
          address: formData.address || null,
        },
      ])

      if (err) throw err

      setFormData({
        title: '',
        event_type: 'meeting',
        start_time: '',
        end_time: '',
        location: '',
        address: '',
      })
      setShowAddForm(false)

      // Refetch events
      const { data } = await supabase
        .from('calendar_events' as never)
        .select('*')
        .eq('org_id', orgId)
        .gte('start_time', weekStart.toISOString())
        .lte('start_time', weekEnd.toISOString())
        .order('start_time', { ascending: true })

      setEvents(data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add event')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setWeekOffset(weekOffset - 1)}
          className="p-2 hover:bg-gray-700/50 rounded text-gray-300 hover:text-gray-100"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <span className="text-gray-100 font-semibold">{weekLabel}</span>
        <button
          onClick={() => setWeekOffset(weekOffset + 1)}
          className="p-2 hover:bg-gray-700/50 rounded text-gray-300 hover:text-gray-100"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Add Event Button */}
      <button
        onClick={() => setShowAddForm(!showAddForm)}
        className="flex items-center gap-2 px-3 py-2 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 rounded text-sm"
      >
        <Plus className="w-4 h-4" />
        Add Event
      </button>

      {/* Add Event Form */}
      {showAddForm && (
        <div className="bg-gray-800/50 border border-gray-700 rounded p-4 space-y-3">
          <input
            type="text"
            placeholder="Event title"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            className="w-full bg-gray-700/50 border border-gray-600 text-gray-100 placeholder-gray-500 rounded px-3 py-2 text-sm"
          />
          <select
            value={formData.event_type}
            onChange={(e) => setFormData({ ...formData, event_type: e.target.value as any })}
            className="w-full bg-gray-700/50 border border-gray-600 text-gray-100 rounded px-3 py-2 text-sm"
          >
            <option value="job_schedule">Job Schedule</option>
            <option value="meeting">Meeting</option>
            <option value="appointment">Appointment</option>
            <option value="deadline">Deadline</option>
            <option value="vacation">Vacation</option>
            <option value="maintenance">Maintenance</option>
          </select>
          <input
            type="datetime-local"
            value={formData.start_time}
            onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
            className="w-full bg-gray-700/50 border border-gray-600 text-gray-100 rounded px-3 py-2 text-sm"
          />
          <input
            type="datetime-local"
            value={formData.end_time}
            onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
            className="w-full bg-gray-700/50 border border-gray-600 text-gray-100 rounded px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="Location (optional)"
            value={formData.location}
            onChange={(e) => setFormData({ ...formData, location: e.target.value })}
            className="w-full bg-gray-700/50 border border-gray-600 text-gray-100 placeholder-gray-500 rounded px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="Address (optional)"
            value={formData.address}
            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            className="w-full bg-gray-700/50 border border-gray-600 text-gray-100 placeholder-gray-500 rounded px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={handleAddEvent}
              className="flex-1 px-3 py-2 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 rounded text-sm font-medium"
            >
              Save Event
            </button>
            <button
              onClick={() => setShowAddForm(false)}
              className="flex-1 px-3 py-2 bg-gray-700/50 text-gray-300 hover:bg-gray-700 rounded text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <div className="bg-red-400/10 border border-red-400/20 text-red-400 rounded p-3 text-sm">{error}</div>}

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-2">
        {days.map((day, idx) => {
          const dayDate = new Date(weekStart)
          dayDate.setDate(weekStart.getDate() + idx)
          const dayEvents = getEventsForDay(idx)

          return (
            <div key={day} className="bg-gray-800/50 border border-gray-700 rounded p-3 min-h-96">
              <div className="text-sm font-semibold text-gray-100 mb-2">
                {day}
                <div className="text-xs text-gray-500 font-normal">
                  {dayDate.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
                </div>
              </div>

              <div className="space-y-2">
                {dayEvents.length === 0 ? (
                  <div className="text-xs text-gray-500 text-center py-4">No events</div>
                ) : (
                  dayEvents.map((event) => (
                    <div key={event.id}>
                      <button
                        onClick={() => setExpandedEvent(expandedEvent === event.id ? null : event.id)}
                        className={clsx(
                          'w-full text-left p-2 rounded text-xs cursor-pointer transition-all',
                          eventTypeColors[event.event_type]
                        )}
                      >
                        <div className="font-semibold truncate">{event.title}</div>
                        <div className="text-xs opacity-80">
                          {formatTime(event.start_time)} - {formatTime(event.end_time)}
                        </div>
                        {event.location && <div className="text-xs opacity-70 truncate">{event.location}</div>}
                      </button>
                      {expandedEvent === event.id && (
                        <div className={clsx('mt-2 p-2 rounded text-xs space-y-1', eventTypeColors[event.event_type])}>
                          <div>
                            <span className="opacity-70">Type:</span> {event.event_type}
                          </div>
                          <div>
                            <span className="opacity-70">Time:</span> {formatTime(event.start_time)} -{' '}
                            {formatTime(event.end_time)}
                          </div>
                          {event.location && (
                            <div>
                              <span className="opacity-70">Location:</span> {event.location}
                            </div>
                          )}
                          {event.address && (
                            <div>
                              <span className="opacity-70">Address:</span> {event.address}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
