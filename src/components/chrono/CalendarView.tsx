// @ts-nocheck
'use client'

import { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Plus, Loader2, AlertTriangle, Eye } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import clsx from 'clsx'
import type { ConflictAlert } from '@/agents/chrono'

interface CalendarEvent {
  id: string
  title: string
  event_type: 'job_schedule' | 'meeting' | 'appointment' | 'deadline' | 'vacation' | 'maintenance'
  start_time: string
  end_time: string
  location?: string
  address?: string
  org_id: string
  project_id?: string
}

// Color coding per spec: blue=project, green=service call, yellow=estimate/site visit
const eventTypeColors: Record<string, string> = {
  job_schedule:  'bg-blue-400/10 text-blue-400 border border-blue-400/20',
  meeting:       'bg-purple-400/10 text-purple-400 border border-purple-400/20',
  appointment:   'bg-yellow-400/10 text-yellow-400 border border-yellow-400/20',
  deadline:      'bg-red-400/10 text-red-400 border border-red-400/20',
  vacation:      'bg-gray-400/10 text-gray-400 border border-gray-400/20',
  maintenance:   'bg-orange-400/10 text-orange-400 border border-orange-400/20',
}

const eventTypeDots: Record<string, string> = {
  job_schedule:  'bg-blue-400',
  meeting:       'bg-purple-400',
  appointment:   'bg-yellow-400',
  deadline:      'bg-red-400',
  vacation:      'bg-gray-400',
  maintenance:   'bg-orange-400',
}

type ViewMode = 'week' | 'month'
const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface Props {
  conflicts?: ConflictAlert[]
}

export function CalendarView({ conflicts = [] }: Props) {
  const { profile } = useAuth()
  const [viewMode, setViewMode] = useState<ViewMode>('week')
  const [weekOffset, setWeekOffset] = useState(0)
  const [monthOffset, setMonthOffset] = useState(0)
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [formData, setFormData] = useState({
    title: '',
    event_type: 'job_schedule' as CalendarEvent['event_type'],
    start_time: '',
    end_time: '',
    location: '',
    address: '',
  })

  const orgId = profile?.org_id

  // Calculate date range based on view mode
  const today = new Date()
  let rangeStart: Date, rangeEnd: Date, rangeLabel: string

  if (viewMode === 'week') {
    rangeStart = new Date(today)
    rangeStart.setDate(today.getDate() - today.getDay() + 1 + weekOffset * 7)
    rangeStart.setHours(0, 0, 0, 0)
    rangeEnd = new Date(rangeStart)
    rangeEnd.setDate(rangeStart.getDate() + 6)
    rangeEnd.setHours(23, 59, 59, 999)
    rangeLabel = `${rangeStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${rangeEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
  } else {
    rangeStart = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1)
    rangeEnd = new Date(today.getFullYear(), today.getMonth() + monthOffset + 1, 0, 23, 59, 59)
    rangeLabel = rangeStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }

  useEffect(() => {
    if (!orgId) { setLoading(false); return }

    const fetchEvents = async () => {
      setLoading(true)
      setError(null)
      try {
        const { data, error: err } = await supabase
          .from('calendar_events' as never)
          .select('*')
          .eq('org_id', orgId)
          .gte('start_time', rangeStart.toISOString())
          .lte('start_time', rangeEnd.toISOString())
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
  }, [orgId, rangeStart.toISOString(), rangeEnd.toISOString()])

  const getEventsForDate = (dateStr: string) => {
    return events.filter(e => {
      const eventDate = new Date(e.start_time).toISOString().split('T')[0]
      return eventDate === dateStr
    })
  }

  const hasConflictOnDate = (dateStr: string) => {
    return conflicts.some(c => c.date === dateStr)
  }

  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
  }

  const handleAddEvent = async () => {
    if (!orgId || !formData.title || !formData.start_time || !formData.end_time) return

    try {
      const { error: err } = await supabase.from('calendar_events' as never).insert([{
        org_id: orgId,
        title: formData.title,
        event_type: formData.event_type,
        start_time: new Date(formData.start_time).toISOString(),
        end_time: new Date(formData.end_time).toISOString(),
        location: formData.location || null,
        address: formData.address || null,
      }])

      if (err) throw err
      setFormData({ title: '', event_type: 'job_schedule', start_time: '', end_time: '', location: '', address: '' })
      setShowAddForm(false)

      // Refetch
      const { data } = await supabase
        .from('calendar_events' as never)
        .select('*')
        .eq('org_id', orgId)
        .gte('start_time', rangeStart.toISOString())
        .lte('start_time', rangeEnd.toISOString())
        .order('start_time', { ascending: true })
      setEvents(data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add event')
    }
  }

  const handlePrev = () => viewMode === 'week' ? setWeekOffset(weekOffset - 1) : setMonthOffset(monthOffset - 1)
  const handleNext = () => viewMode === 'week' ? setWeekOffset(weekOffset + 1) : setMonthOffset(monthOffset + 1)

  // Build month grid
  const buildMonthDays = () => {
    const firstDay = new Date(rangeStart)
    const lastDay = new Date(rangeEnd)
    // Offset to Monday start
    let startOffset = firstDay.getDay() - 1
    if (startOffset < 0) startOffset = 6

    const cells: { date: Date; inMonth: boolean }[] = []
    const gridStart = new Date(firstDay)
    gridStart.setDate(gridStart.getDate() - startOffset)

    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart)
      d.setDate(gridStart.getDate() + i)
      cells.push({ date: d, inMonth: d.getMonth() === firstDay.getMonth() })
    }
    return cells
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
      {/* Header: View toggle + Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={handlePrev} className="p-2 hover:bg-gray-700/50 rounded text-gray-300">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-gray-100 font-semibold min-w-[200px] text-center">{rangeLabel}</span>
          <button onClick={handleNext} className="p-2 hover:bg-gray-700/50 rounded text-gray-300">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex bg-gray-800/50 rounded-lg p-0.5 border border-gray-700">
            <button
              onClick={() => setViewMode('week')}
              className={clsx('px-3 py-1 text-xs rounded-md transition-colors', viewMode === 'week' ? 'bg-orange-500/20 text-orange-400' : 'text-gray-400')}
            >Week</button>
            <button
              onClick={() => setViewMode('month')}
              className={clsx('px-3 py-1 text-xs rounded-md transition-colors', viewMode === 'month' ? 'bg-orange-500/20 text-orange-400' : 'text-gray-400')}
            >Month</button>
          </div>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 rounded text-xs font-medium"
          >
            <Plus className="w-3.5 h-3.5" /> Book a Job
          </button>
        </div>
      </div>

      {/* Add Event Form */}
      {showAddForm && (
        <div className="bg-gray-800/50 border border-gray-700 rounded p-4 space-y-3">
          <input type="text" placeholder="Event title" value={formData.title}
            onChange={e => setFormData({ ...formData, title: e.target.value })}
            className="w-full bg-gray-700/50 border border-gray-600 text-gray-100 placeholder-gray-500 rounded px-3 py-2 text-sm" />
          <select value={formData.event_type}
            onChange={e => setFormData({ ...formData, event_type: e.target.value as any })}
            className="w-full bg-gray-700/50 border border-gray-600 text-gray-100 rounded px-3 py-2 text-sm">
            <option value="job_schedule">Job Schedule (blue)</option>
            <option value="appointment">Site Visit / Estimate (yellow)</option>
            <option value="meeting">Meeting (purple)</option>
            <option value="deadline">Deadline (red)</option>
            <option value="vacation">Vacation</option>
            <option value="maintenance">Maintenance (orange)</option>
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input type="datetime-local" value={formData.start_time}
              onChange={e => setFormData({ ...formData, start_time: e.target.value })}
              className="bg-gray-700/50 border border-gray-600 text-gray-100 rounded px-3 py-2 text-sm" />
            <input type="datetime-local" value={formData.end_time}
              onChange={e => setFormData({ ...formData, end_time: e.target.value })}
              className="bg-gray-700/50 border border-gray-600 text-gray-100 rounded px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input type="text" placeholder="Location" value={formData.location}
              onChange={e => setFormData({ ...formData, location: e.target.value })}
              className="bg-gray-700/50 border border-gray-600 text-gray-100 placeholder-gray-500 rounded px-3 py-2 text-sm" />
            <input type="text" placeholder="Address" value={formData.address}
              onChange={e => setFormData({ ...formData, address: e.target.value })}
              className="bg-gray-700/50 border border-gray-600 text-gray-100 placeholder-gray-500 rounded px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleAddEvent}
              className="flex-1 px-3 py-2 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 rounded text-sm font-medium">
              Save Event
            </button>
            <button onClick={() => setShowAddForm(false)}
              className="flex-1 px-3 py-2 bg-gray-700/50 text-gray-300 hover:bg-gray-700 rounded text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <div className="bg-red-400/10 border border-red-400/20 text-red-400 rounded p-3 text-sm">{error}</div>}

      {/* Color Legend */}
      <div className="flex flex-wrap gap-3 text-[10px] text-gray-400">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400" /> Project</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400" /> Estimate/Visit</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-400" /> Meeting</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" /> Deadline</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400" /> Maintenance</span>
      </div>

      {/* WEEK VIEW */}
      {viewMode === 'week' && (
        <div className="grid grid-cols-7 gap-2">
          {days.map((day, idx) => {
            const dayDate = new Date(rangeStart)
            dayDate.setDate(rangeStart.getDate() + idx)
            const dateStr = dayDate.toISOString().split('T')[0]
            const dayEvents = getEventsForDate(dateStr)
            const hasConflict = hasConflictOnDate(dateStr)
            const isToday = dateStr === new Date().toISOString().split('T')[0]

            return (
              <div key={day} className={clsx(
                'bg-gray-800/50 border rounded p-3 min-h-[280px] cursor-pointer transition-all hover:border-gray-600',
                hasConflict ? 'border-red-500/40 bg-red-500/5' : 'border-gray-700',
                isToday && 'ring-1 ring-orange-500/30',
                selectedDay === dateStr && 'ring-2 ring-orange-500'
              )} onClick={() => setSelectedDay(selectedDay === dateStr ? null : dateStr)}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className={clsx('text-sm font-semibold', isToday ? 'text-orange-400' : 'text-gray-100')}>{day}</div>
                    <div className="text-xs text-gray-500 font-normal">
                      {dayDate.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
                    </div>
                  </div>
                  {hasConflict && <AlertTriangle className="w-3.5 h-3.5 text-red-400" />}
                </div>

                <div className="space-y-1.5">
                  {dayEvents.length === 0 ? (
                    <div className="text-xs text-gray-500 text-center py-4">No events</div>
                  ) : (
                    dayEvents.map(event => (
                      <div key={event.id}>
                        <button
                          onClick={e => { e.stopPropagation(); setExpandedEvent(expandedEvent === event.id ? null : event.id) }}
                          className={clsx('w-full text-left p-2 rounded text-xs cursor-pointer transition-all', eventTypeColors[event.event_type])}
                        >
                          <div className="flex items-center gap-1">
                            <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', eventTypeDots[event.event_type])} />
                            <span className="font-semibold truncate">{event.title}</span>
                          </div>
                          <div className="text-xs opacity-80 ml-2.5">
                            {formatTime(event.start_time)} - {formatTime(event.end_time)}
                          </div>
                          {event.location && <div className="text-xs opacity-70 truncate ml-2.5">{event.location}</div>}
                        </button>
                        {expandedEvent === event.id && (
                          <div className={clsx('mt-1 p-2 rounded text-xs space-y-1', eventTypeColors[event.event_type])}>
                            <div><span className="opacity-70">Type:</span> {event.event_type}</div>
                            <div><span className="opacity-70">Time:</span> {formatTime(event.start_time)} - {formatTime(event.end_time)}</div>
                            {event.location && <div><span className="opacity-70">Location:</span> {event.location}</div>}
                            {event.address && <div><span className="opacity-70">Address:</span> {event.address}</div>}
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
      )}

      {/* MONTH VIEW */}
      {viewMode === 'month' && (
        <div>
          <div className="grid grid-cols-7 gap-1 mb-1">
            {days.map(d => (
              <div key={d} className="text-center text-xs text-gray-500 font-medium py-1">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {buildMonthDays().map((cell, idx) => {
              const dateStr = cell.date.toISOString().split('T')[0]
              const cellEvents = getEventsForDate(dateStr)
              const hasConflict = hasConflictOnDate(dateStr)
              const isToday = dateStr === new Date().toISOString().split('T')[0]

              return (
                <div
                  key={idx}
                  onClick={() => setSelectedDay(selectedDay === dateStr ? null : dateStr)}
                  className={clsx(
                    'p-1.5 min-h-[80px] rounded border cursor-pointer transition-all hover:border-gray-600',
                    cell.inMonth ? 'bg-gray-800/50' : 'bg-gray-900/30',
                    hasConflict ? 'border-red-500/40' : 'border-gray-700/50',
                    isToday && 'ring-1 ring-orange-500/30',
                    selectedDay === dateStr && 'ring-2 ring-orange-500'
                  )}
                >
                  <div className={clsx('text-xs font-medium mb-1 flex items-center justify-between',
                    cell.inMonth ? (isToday ? 'text-orange-400' : 'text-gray-300') : 'text-gray-600'
                  )}>
                    <span>{cell.date.getDate()}</span>
                    {hasConflict && <AlertTriangle className="w-2.5 h-2.5 text-red-400" />}
                  </div>
                  <div className="flex flex-wrap gap-0.5">
                    {cellEvents.slice(0, 3).map(e => (
                      <span key={e.id} className={clsx('w-1.5 h-1.5 rounded-full', eventTypeDots[e.event_type])} title={e.title} />
                    ))}
                    {cellEvents.length > 3 && (
                      <span className="text-[8px] text-gray-500">+{cellEvents.length - 3}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Day Detail Panel */}
      {selectedDay && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-100">
              {new Date(selectedDay + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </h3>
            <button onClick={() => setSelectedDay(null)} className="text-xs text-gray-500 hover:text-gray-300">Close</button>
          </div>

          {hasConflictOnDate(selectedDay) && (
            <div className="bg-red-500/10 border border-red-500/20 rounded p-2 text-xs text-red-300">
              {conflicts.filter(c => c.date === selectedDay).map((c, i) => (
                <div key={i}>{c.description}</div>
              ))}
            </div>
          )}

          {getEventsForDate(selectedDay).length === 0 ? (
            <p className="text-xs text-gray-500">No events scheduled.</p>
          ) : (
            getEventsForDate(selectedDay).map(event => (
              <div key={event.id} className={clsx('p-3 rounded text-sm', eventTypeColors[event.event_type])}>
                <div className="font-semibold">{event.title}</div>
                <div className="text-xs opacity-80 mt-1">
                  {formatTime(event.start_time)} – {formatTime(event.end_time)}
                </div>
                {event.location && <div className="text-xs opacity-70 mt-0.5">{event.location}</div>}
                {event.address && <div className="text-xs opacity-70">{event.address}</div>}
              </div>
            ))
          )}

          <button
            onClick={() => { setShowAddForm(true); setSelectedDay(null) }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 rounded text-xs"
          >
            <Plus className="w-3 h-3" /> Book new job on this day
          </button>
        </div>
      )}
    </div>
  )
}
