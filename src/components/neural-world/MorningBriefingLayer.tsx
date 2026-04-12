/**
 * MorningBriefingLayer.tsx — NW74: Personal Daily Briefing Overlay for Neural World
 *
 * Trigger:
 *   • First load between 05:00–10:00 local time (unless already shown today).
 *   • Custom event: window.dispatchEvent(new CustomEvent('nw:morning-briefing'))
 *
 * Content:
 *   1. Good morning greeting + current date/time
 *   2. TODAY'S SCHEDULE  — calendar events (CHRONO / localStorage mock)
 *   3. ACTIVE PROJECTS   — top 3 by urgency (deadline / hours needed)
 *   4. FINANCIAL SNAPSHOT — cash position, invoices due today, AR aging
 *   5. NEXUS RECOMMENDATION — one AI-generated priority suggestion
 *   6. WEATHER           — current conditions for Desert Hot Springs, CA
 *
 * "START DAY" button dismisses the overlay and dispatches nw:fly-to-priority
 * so the world camera can optionally fly to the highest-priority project node.
 *
 * Auto-dismiss: 30 s countdown if user does not interact.
 * Once-per-day: keyed in localStorage as 'nw_morning_briefing_v1'.
 * NEXUS TTS: reads briefing summary aloud if voice synthesis is available.
 *
 * Export: named export MorningBriefingLayer (VIDEO GAME UX LAW applied)
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  Sun,
  Calendar,
  Briefcase,
  DollarSign,
  Zap,
  CloudSun,
  Cloud,
  CloudRain,
  CloudSnow,
  Wind,
  Thermometer,
  X,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react'
import { getWorldData } from './DataBridge'
import type { NWProject, NWInvoice } from './DataBridge'
import { callNexus } from '@/services/claudeProxy'
import { synthesizeWithElevenLabs, DEFAULT_VOICE_ID } from '@/api/voice/elevenLabs'
import type { NexusRequest } from '@/agents/nexusPromptEngine'

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY   = 'nw_morning_briefing_v1'
const AUTO_DISMISS  = 30           // seconds
const MORNING_START = 5            // 5 AM
const MORNING_END   = 10           // 10 AM

/** Desert Hot Springs, CA coordinates (Open-Meteo, no API key required) */
const WEATHER_LAT  = 33.9611
const WEATHER_LON  = -116.5017
const WEATHER_URL  =
  `https://api.open-meteo.com/v1/forecast?latitude=${WEATHER_LAT}&longitude=${WEATHER_LON}` +
  `&current=temperature_2m,weathercode,windspeed_10m,relative_humidity_2m` +
  `&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=America%2FLos_Angeles`

// ── Types ─────────────────────────────────────────────────────────────────────

interface CalendarEvent {
  id: string
  title: string
  startTime: string   // e.g. "8:00 AM"
  endTime:   string
  location?: string
  type:      'job' | 'permit' | 'meeting' | 'personal' | 'other'
}

interface WeatherData {
  tempF:      number
  code:       number
  windMph:    number
  humidity:   number
  description: string
}

interface BriefingState {
  calendarEvents: CalendarEvent[]
  topProjects:    NWProject[]
  invoicesToday:  NWInvoice[]
  arOver30:       NWInvoice[]
  cashPosition:   number
  totalAR:        number
  nexusRec:       string
  weather:        WeatherData | null
  loading:        boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function alreadyShownToday(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return false
    const data = JSON.parse(raw) as { date: string }
    return data.date === todayKey()
  } catch {
    return false
  }
}

function markShownToday(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: todayKey() }))
  } catch { /* non-blocking */ }
}

function isMorningWindow(): boolean {
  const h = new Date().getHours()
  return h >= MORNING_START && h < MORNING_END
}

function formatCurrency(v: number): string {
  return new Intl.NumberFormat('en-US', {
    style:                 'currency',
    currency:              'USD',
    maximumFractionDigits: 0,
  }).format(v)
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day:   'numeric',
    })
  } catch {
    return dateStr
  }
}

function fullDateLabel(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month:   'long',
    day:     'numeric',
    year:    'numeric',
  })
}

function timeLabel(): string {
  return new Date().toLocaleTimeString('en-US', {
    hour:   'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

/** Map WMO weather code → human label */
function weatherCodeLabel(code: number): string {
  if (code === 0)             return 'Clear sky'
  if (code <= 2)              return 'Partly cloudy'
  if (code === 3)             return 'Overcast'
  if (code >= 51 && code <= 57) return 'Drizzle'
  if (code >= 61 && code <= 67) return 'Rain'
  if (code >= 71 && code <= 77) return 'Snow'
  if (code >= 80 && code <= 82) return 'Rain showers'
  if (code >= 95)             return 'Thunderstorm'
  return 'Partly cloudy'
}

/** Urgency score for projects (lower = more urgent) */
function urgencyScore(p: NWProject): number {
  const statusWeight =
    p.status === 'in_progress' ? 0 :
    p.status === 'approved'    ? 1 :
    p.status === 'pending'     ? 2 : 3
  const healthPenalty = (100 - (p.health_score ?? 50)) / 10
  return statusWeight + healthPenalty
}

// ── Mock calendar data (CHRONO / localStorage or built-in fallback) ───────────

function loadCalendarEvents(): CalendarEvent[] {
  // Try CHRONO localStorage cache first
  const CHRONO_CACHE_KEYS = ['chrono_schedule_cache', 'nw_calendar_today', 'gcalCache']
  for (const key of CHRONO_CACHE_KEYS) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].title) {
        // Filter to today's events
        const today = todayKey()
        return (parsed as CalendarEvent[]).filter(e =>
          !e.startTime || e.startTime.startsWith(today)
        )
      }
    } catch { /* try next */ }
  }

  // Fallback: mock schedule for demo day
  return [
    {
      id:        'ev1',
      title:     'Site walk — Palm Springs rough-in',
      startTime: '7:30 AM',
      endTime:   '9:00 AM',
      location:  'Palm Springs',
      type:      'job',
    },
    {
      id:        'ev2',
      title:     'Permit pickup — Coachella permit office',
      startTime: '10:00 AM',
      endTime:   '10:45 AM',
      location:  'Coachella, CA',
      type:      'permit',
    },
    {
      id:        'ev3',
      title:     'Estimate review — La Quinta panel upgrade',
      startTime: '2:00 PM',
      endTime:   '3:00 PM',
      type:      'meeting',
    },
  ]
}

// ── Weather fetch ─────────────────────────────────────────────────────────────

async function fetchWeather(): Promise<WeatherData | null> {
  try {
    const res  = await fetch(WEATHER_URL)
    if (!res.ok) return null
    const json = await res.json() as {
      current: {
        temperature_2m: number
        weathercode:    number
        windspeed_10m:  number
        relative_humidity_2m: number
      }
    }
    const c = json.current
    return {
      tempF:       Math.round(c.temperature_2m),
      code:        c.weathercode,
      windMph:     Math.round(c.windspeed_10m),
      humidity:    c.relative_humidity_2m,
      description: weatherCodeLabel(c.weathercode),
    }
  } catch {
    return null
  }
}

// ── NEXUS recommendation ──────────────────────────────────────────────────────

async function fetchNexusRecommendation(
  projects: NWProject[],
  invoicesToday: NWInvoice[],
  totalAR: number,
): Promise<string> {
  try {
    const urgentProject = projects[0]
    const context =
      `Active projects: ${projects.length}. ` +
      `Highest-priority: ${urgentProject?.name ?? 'none'} (health ${urgentProject?.health_score ?? 'N/A'}). ` +
      `Invoices due today: ${invoicesToday.length}. Total AR: $${Math.round(totalAR)}. ` +
      `Time: ${timeLabel()}. Location: Desert Hot Springs, CA.`

    const req: NexusRequest = {
      query:     `Based on this morning snapshot, give me ONE concise priority action for today: ${context}`,
      agentMode: 'executive',
    }
    const resp = await callNexus(req)
    const text = resp.speak ?? (resp as { response?: string }).response ?? ''
    return text.trim() || 'Focus on the highest-health project today and follow up on outstanding invoices.'
  } catch {
    return 'Review your top project status and collect on any open invoices today.'
  }
}

// ── Voice readout ─────────────────────────────────────────────────────────────

async function speakBriefingSummary(
  data: BriefingState,
): Promise<void> {
  try {
    const lines: string[] = [
      `Good morning, Christian. Today is ${fullDateLabel()}.`,
    ]
    if (data.calendarEvents.length > 0) {
      lines.push(`You have ${data.calendarEvents.length} events on your calendar.`)
    }
    if (data.topProjects.length > 0) {
      lines.push(`Top project: ${data.topProjects[0].name}.`)
    }
    if (data.invoicesToday.length > 0) {
      lines.push(`${data.invoicesToday.length} invoice${data.invoicesToday.length !== 1 ? 's' : ''} due today.`)
    }
    if (data.nexusRec) {
      lines.push(data.nexusRec)
    }
    const summary = lines.join(' ')
    await synthesizeWithElevenLabs({ text: summary, voice_id: DEFAULT_VOICE_ID })
  } catch {
    // Non-blocking — voice is optional
  }
}

// ── Sub-components ─────────────────────────────────────────────────────────────

// Weather icon selector
function WeatherIcon({ code, size = 18 }: { code: number; size?: number }) {
  const s = size
  if (code >= 61 && code <= 82)  return <CloudRain  size={s} style={{ color: '#60a5fa' }} />
  if (code >= 71 && code <= 77)  return <CloudSnow  size={s} style={{ color: '#bfdbfe' }} />
  if (code === 0)                return <Sun        size={s} style={{ color: '#fbbf24' }} />
  if (code <= 2)                 return <CloudSun   size={s} style={{ color: '#fcd34d' }} />
  return                                <Cloud      size={s} style={{ color: '#94a3b8' }} />
}

// Event type badge
function EventBadge({ type }: { type: CalendarEvent['type'] }) {
  const colours: Record<CalendarEvent['type'], string> = {
    job:      '#10b981',
    permit:   '#f59e0b',
    meeting:  '#6366f1',
    personal: '#ec4899',
    other:    '#6b7280',
  }
  return (
    <span
      style={{
        background:    colours[type] + '22',
        color:         colours[type],
        border:        `1px solid ${colours[type]}44`,
        borderRadius:  4,
        padding:       '1px 5px',
        fontSize:      10,
        fontFamily:    'monospace',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}
    >
      {type}
    </span>
  )
}

// Project status dot
function StatusDot({ status }: { status: NWProject['status'] }) {
  const c =
    status === 'in_progress' ? '#10b981' :
    status === 'approved'    ? '#3b82f6' :
    status === 'pending'     ? '#f59e0b' : '#6b7280'
  return (
    <span
      style={{
        display:         'inline-block',
        width:           8,
        height:          8,
        borderRadius:    '50%',
        background:      c,
        flexShrink:      0,
        marginTop:       5,
        boxShadow:       `0 0 6px ${c}88`,
      }}
    />
  )
}

// ── Countdown bar ─────────────────────────────────────────────────────────────

function CountdownBar({ total, remaining }: { total: number; remaining: number }) {
  const pct = (remaining / total) * 100
  return (
    <div
      style={{
        width:        '100%',
        height:       2,
        background:   'rgba(255,255,255,0.08)',
        borderRadius: 2,
        overflow:     'hidden',
      }}
    >
      <div
        style={{
          height:           '100%',
          width:            `${pct}%`,
          background:       'linear-gradient(90deg, #00e5cc, #7c3aed)',
          borderRadius:     2,
          transition:       'width 1s linear',
        }}
      />
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function MorningBriefingLayer() {
  const [visible,   setVisible]   = useState(false)
  const [fadeIn,    setFadeIn]    = useState(false)
  const [countdown, setCountdown] = useState(AUTO_DISMISS)
  const [interacted, setInteracted] = useState(false)
  const [state, setState] = useState<BriefingState>({
    calendarEvents: [],
    topProjects:    [],
    invoicesToday:  [],
    arOver30:       [],
    cashPosition:   0,
    totalAR:        0,
    nexusRec:       '',
    weather:        null,
    loading:        true,
  })

  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const voiceFired  = useRef(false)

  // ── Load briefing data ─────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setState(s => ({ ...s, loading: true }))

    // Calendar
    const calendarEvents = loadCalendarEvents()

    // Projects from DataBridge
    const world    = getWorldData()
    const allProjs = world.projects ?? []
    const active   = allProjs.filter(p =>
      p.status === 'in_progress' || p.status === 'approved' || p.status === 'pending'
    )
    const topProjects = [...active].sort(
      (a, b) => urgencyScore(a) - urgencyScore(b)
    ).slice(0, 3)

    // Financial
    const today         = todayKey()
    const invoicesToday = (world.invoices ?? []).filter(
      inv => inv.due_date?.startsWith(today) && inv.status !== 'paid'
    )
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const arOver30 = (world.invoices ?? []).filter(inv => {
      if (inv.status === 'paid') return false
      if (!inv.due_date) return false
      return new Date(inv.due_date) < thirtyDaysAgo
    })
    const totalAR = (world.invoices ?? [])
      .filter(inv => inv.status !== 'paid')
      .reduce((sum, inv) => sum + inv.amount, 0)

    // Cash position: paid invoices in last 30 days (proxy)
    const cashPosition = (world.invoices ?? [])
      .filter(inv => inv.status === 'paid')
      .reduce((sum, inv) => sum + inv.amount, 0)

    // Weather (parallel with NEXUS)
    const [weather, nexusRec] = await Promise.all([
      fetchWeather(),
      fetchNexusRecommendation(topProjects, invoicesToday, totalAR),
    ])

    const nextState: BriefingState = {
      calendarEvents,
      topProjects,
      invoicesToday,
      arOver30,
      cashPosition,
      totalAR,
      nexusRec,
      weather,
      loading: false,
    }

    setState(nextState)

    // TTS readout once
    if (!voiceFired.current) {
      voiceFired.current = true
      speakBriefingSummary(nextState)
    }
  }, [])

  // ── Show / hide logic ──────────────────────────────────────────────────────

  const show = useCallback(() => {
    setVisible(true)
    setCountdown(AUTO_DISMISS)
    setInteracted(false)
    voiceFired.current = false
    requestAnimationFrame(() => setFadeIn(true))
    loadData()
  }, [loadData])

  const dismiss = useCallback((flyToPriority = false) => {
    setFadeIn(false)
    setTimeout(() => setVisible(false), 400)
    markShownToday()
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (flyToPriority) {
      const world   = getWorldData()
      const proj    = (world.projects ?? []).find(
        p => p.status === 'in_progress' || p.status === 'approved'
      )
      if (proj) {
        window.dispatchEvent(
          new CustomEvent('nw:fly-to-priority', { detail: { projectId: proj.id } })
        )
      }
    }
  }, [])

  // ── Auto-dismiss countdown ─────────────────────────────────────────────────

  useEffect(() => {
    if (!visible || interacted) return
    timerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          dismiss(false)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [visible, interacted, dismiss])

  // ── Event listeners ────────────────────────────────────────────────────────

  useEffect(() => {
    // Manual trigger
    const onManualTrigger = () => show()
    window.addEventListener('nw:morning-briefing', onManualTrigger)

    // Auto-trigger on morning load
    if (!alreadyShownToday() && isMorningWindow()) {
      // Small delay so Neural World canvas finishes mounting
      const t = setTimeout(show, 1800)
      return () => {
        clearTimeout(t)
        window.removeEventListener('nw:morning-briefing', onManualTrigger)
      }
    }

    return () => window.removeEventListener('nw:morning-briefing', onManualTrigger)
  }, [show])

  const handleInteraction = () => {
    if (!interacted) {
      setInteracted(true)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }

  if (!visible) return null

  // ── Render ─────────────────────────────────────────────────────────────────

  const { calendarEvents, topProjects, invoicesToday, arOver30, cashPosition, totalAR, nexusRec, weather, loading } = state

  return (
    <div
      onClick={handleInteraction}
      style={{
        position:       'fixed',
        inset:          0,
        zIndex:         9000,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        background:     `rgba(2, 4, 10, ${fadeIn ? 0.82 : 0})`,
        transition:     'background 0.4s ease',
        pointerEvents:  'all',
      }}
    >
      {/* Card */}
      <div
        style={{
          width:           '100%',
          maxWidth:        600,
          maxHeight:       '90vh',
          overflowY:       'auto',
          margin:          '0 16px',
          background:      'rgba(6, 12, 24, 0.92)',
          backdropFilter:  'blur(24px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(24px) saturate(1.4)',
          border:          '1px solid rgba(0, 229, 204, 0.18)',
          borderRadius:    16,
          boxShadow:       '0 24px 80px rgba(0,0,0,0.7), 0 0 40px rgba(0,229,204,0.06)',
          opacity:         fadeIn ? 1 : 0,
          transform:       fadeIn ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.97)',
          transition:      'opacity 0.4s ease, transform 0.4s ease',
          fontFamily:      "'Inter', system-ui, sans-serif",
        }}
      >
        {/* Countdown bar at top */}
        {!interacted && (
          <div style={{ padding: '0 0 0 0' }}>
            <CountdownBar total={AUTO_DISMISS} remaining={countdown} />
          </div>
        )}

        {/* Header */}
        <div
          style={{
            padding:         '22px 24px 16px',
            borderBottom:    '1px solid rgba(0,229,204,0.10)',
            display:         'flex',
            alignItems:      'flex-start',
            justifyContent:  'space-between',
            gap:             16,
          }}
        >
          <div>
            <div
              style={{
                display:    'flex',
                alignItems: 'center',
                gap:        8,
                marginBottom: 4,
              }}
            >
              <Sun size={20} style={{ color: '#fbbf24' }} />
              <span
                style={{
                  fontSize:   22,
                  fontWeight: 700,
                  color:      '#f1f5f9',
                  letterSpacing: '-0.02em',
                }}
              >
                Good morning, Christian
              </span>
            </div>
            <div
              style={{
                fontSize:  13,
                color:     '#64748b',
                fontFamily: 'monospace',
              }}
            >
              {fullDateLabel()} · {timeLabel()}
            </div>
          </div>

          {/* Close button */}
          <button
            onClick={(e) => { e.stopPropagation(); dismiss(false) }}
            style={{
              background:   'rgba(255,255,255,0.05)',
              border:       '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8,
              color:        '#64748b',
              cursor:       'pointer',
              padding:      '6px 8px',
              lineHeight:   1,
              flexShrink:   0,
              transition:   'background 0.2s',
            }}
            title="Dismiss briefing"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '0 24px 20px' }}>

          {/* ── TODAY'S SCHEDULE ─────────────────────────────────────────── */}
          <Section icon={<Calendar size={14} />} title="TODAY'S SCHEDULE" color="#6366f1">
            {loading ? (
              <Skeleton lines={3} />
            ) : calendarEvents.length === 0 ? (
              <EmptyNote>No events scheduled for today.</EmptyNote>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {calendarEvents.map(ev => (
                  <div
                    key={ev.id}
                    style={{
                      display:       'flex',
                      alignItems:    'flex-start',
                      gap:           8,
                      padding:       '6px 10px',
                      background:    'rgba(99,102,241,0.06)',
                      borderRadius:  6,
                      borderLeft:    '2px solid rgba(99,102,241,0.4)',
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontSize:   13,
                          color:      '#e2e8f0',
                          fontWeight: 500,
                          marginBottom: 2,
                        }}
                      >
                        {ev.title}
                      </div>
                      <div
                        style={{
                          fontSize:   11,
                          color:      '#64748b',
                          display:    'flex',
                          gap:        8,
                          flexWrap:   'wrap',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ fontFamily: 'monospace' }}>
                          {ev.startTime}{ev.endTime ? ` – ${ev.endTime}` : ''}
                        </span>
                        {ev.location && <span>📍 {ev.location}</span>}
                        <EventBadge type={ev.type} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* ── ACTIVE PROJECTS ──────────────────────────────────────────── */}
          <Section icon={<Briefcase size={14} />} title="ACTIVE PROJECTS" color="#10b981">
            {loading ? (
              <Skeleton lines={3} />
            ) : topProjects.length === 0 ? (
              <EmptyNote>No active projects found.</EmptyNote>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {topProjects.map((p, idx) => (
                  <div
                    key={p.id}
                    style={{
                      display:       'flex',
                      alignItems:    'flex-start',
                      gap:           8,
                      padding:       '6px 10px',
                      background:    idx === 0
                        ? 'rgba(16,185,129,0.08)'
                        : 'rgba(255,255,255,0.03)',
                      borderRadius:  6,
                      borderLeft:    idx === 0
                        ? '2px solid rgba(16,185,129,0.5)'
                        : '2px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    <StatusDot status={p.status} />
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontSize:   13,
                          color:      '#e2e8f0',
                          fontWeight: idx === 0 ? 600 : 400,
                          marginBottom: 2,
                        }}
                      >
                        {p.name}
                        {idx === 0 && (
                          <span
                            style={{
                              marginLeft:    6,
                              fontSize:      10,
                              color:         '#10b981',
                              background:    'rgba(16,185,129,0.12)',
                              padding:       '1px 5px',
                              borderRadius:  3,
                              fontFamily:    'monospace',
                            }}
                          >
                            TOP PRIORITY
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize:   11,
                          color:      '#64748b',
                          display:    'flex',
                          gap:        10,
                          flexWrap:   'wrap',
                        }}
                      >
                        <span style={{ textTransform: 'capitalize' }}>
                          {p.status.replace('_', ' ')}
                        </span>
                        <span>
                          Health:{' '}
                          <span
                            style={{
                              color: p.health_score >= 70 ? '#10b981' :
                                     p.health_score >= 50 ? '#f59e0b' : '#ef4444',
                            }}
                          >
                            {p.health_score}
                          </span>
                        </span>
                        {p.contract_value > 0 && (
                          <span>{formatCurrency(p.contract_value)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* ── FINANCIAL SNAPSHOT ───────────────────────────────────────── */}
          <Section icon={<DollarSign size={14} />} title="FINANCIAL SNAPSHOT" color="#f59e0b">
            {loading ? (
              <Skeleton lines={2} />
            ) : (
              <div
                style={{
                  display:             'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap:                 8,
                }}
              >
                <FinCard
                  label="Cash Position"
                  value={formatCurrency(cashPosition)}
                  sub="received (30d)"
                  color="#10b981"
                />
                <FinCard
                  label="AR Due Today"
                  value={invoicesToday.length === 0 ? 'None' : `${invoicesToday.length} inv`}
                  sub={invoicesToday.length > 0
                    ? formatCurrency(invoicesToday.reduce((s, i) => s + i.amount, 0))
                    : 'all clear'}
                  color={invoicesToday.length > 0 ? '#f59e0b' : '#10b981'}
                  alert={invoicesToday.length > 0}
                />
                <FinCard
                  label="AR Aging 30+"
                  value={arOver30.length === 0 ? 'None' : `${arOver30.length} inv`}
                  sub={arOver30.length > 0
                    ? formatCurrency(arOver30.reduce((s, i) => s + i.amount, 0))
                    : 'all current'}
                  color={arOver30.length > 0 ? '#ef4444' : '#10b981'}
                  alert={arOver30.length > 0}
                />
              </div>
            )}
            {!loading && totalAR > 0 && (
              <div
                style={{
                  marginTop:   6,
                  padding:     '5px 10px',
                  background:  'rgba(245,158,11,0.06)',
                  borderRadius: 6,
                  fontSize:    11,
                  color:       '#94a3b8',
                }}
              >
                Total outstanding AR:{' '}
                <span style={{ color: '#fbbf24', fontWeight: 600 }}>
                  {formatCurrency(totalAR)}
                </span>
              </div>
            )}
          </Section>

          {/* ── NEXUS RECOMMENDATION ─────────────────────────────────────── */}
          <Section icon={<Zap size={14} />} title="NEXUS RECOMMENDATION" color="#a855f7">
            {loading ? (
              <Skeleton lines={2} />
            ) : (
              <div
                style={{
                  padding:      '10px 12px',
                  background:   'rgba(168,85,247,0.07)',
                  borderRadius: 8,
                  border:       '1px solid rgba(168,85,247,0.18)',
                  fontSize:     13,
                  color:        '#e2e8f0',
                  lineHeight:   1.6,
                  fontStyle:    'italic',
                }}
              >
                <span style={{ color: '#a855f7', fontWeight: 700, fontStyle: 'normal' }}>
                  NEXUS:{' '}
                </span>
                {nexusRec || 'Analyzing your business data…'}
              </div>
            )}
          </Section>

          {/* ── WEATHER ──────────────────────────────────────────────────── */}
          <Section icon={<CloudSun size={14} />} title="WEATHER — DESERT HOT SPRINGS" color="#38bdf8">
            {loading ? (
              <Skeleton lines={1} />
            ) : weather === null ? (
              <EmptyNote>Weather data unavailable.</EmptyNote>
            ) : (
              <div
                style={{
                  display:     'flex',
                  alignItems:  'center',
                  gap:         16,
                  padding:     '8px 12px',
                  background:  'rgba(56,189,248,0.06)',
                  borderRadius: 8,
                  border:      '1px solid rgba(56,189,248,0.14)',
                }}
              >
                <WeatherIcon code={weather.code} size={32} />
                <div>
                  <div
                    style={{
                      fontSize:   20,
                      fontWeight: 700,
                      color:      '#f1f5f9',
                    }}
                  >
                    {weather.tempF}°F
                    <span
                      style={{
                        fontSize:   13,
                        fontWeight: 400,
                        color:      '#94a3b8',
                        marginLeft: 8,
                      }}
                    >
                      {weather.description}
                    </span>
                  </div>
                  <div
                    style={{
                      display:    'flex',
                      gap:        14,
                      fontSize:   11,
                      color:      '#64748b',
                      marginTop:  2,
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <Wind size={11} /> {weather.windMph} mph
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <Thermometer size={11} /> {weather.humidity}% humidity
                    </span>
                  </div>
                </div>
              </div>
            )}
          </Section>

        </div>

        {/* Footer */}
        <div
          style={{
            padding:        '14px 24px',
            borderTop:      '1px solid rgba(255,255,255,0.06)',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'space-between',
            gap:            12,
          }}
        >
          {/* Auto-dismiss label */}
          {!interacted && (
            <div style={{ fontSize: 11, color: '#374151', fontFamily: 'monospace' }}>
              Auto-dismiss in {countdown}s
            </div>
          )}
          {interacted && (
            <div style={{ fontSize: 11, color: '#374151' }}>
              PowerOn Hub · Daily Briefing
            </div>
          )}

          {/* START DAY */}
          <button
            onClick={(e) => { e.stopPropagation(); dismiss(true) }}
            style={{
              background:    'linear-gradient(135deg, #00e5cc 0%, #7c3aed 100%)',
              border:        'none',
              borderRadius:  10,
              color:         '#fff',
              cursor:        'pointer',
              fontSize:      13,
              fontWeight:    700,
              letterSpacing: '0.04em',
              padding:       '10px 22px',
              display:       'flex',
              alignItems:    'center',
              gap:           6,
              boxShadow:     '0 4px 20px rgba(0,229,204,0.25)',
              transition:    'opacity 0.2s, transform 0.15s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.opacity = '0.9'
              ;(e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.02)'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.opacity = '1'
              ;(e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'
            }}
          >
            START DAY <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Shared small components ────────────────────────────────────────────────────

function Section({
  icon,
  title,
  color,
  children,
}: {
  icon:     React.ReactNode
  title:    string
  color:    string
  children: React.ReactNode
}) {
  return (
    <div style={{ marginTop: 18 }}>
      <div
        style={{
          display:      'flex',
          alignItems:   'center',
          gap:          6,
          marginBottom: 8,
          color,
          fontSize:     11,
          fontWeight:   700,
          fontFamily:   'monospace',
          letterSpacing:'0.08em',
          textTransform:'uppercase',
        }}
      >
        {icon}
        {title}
      </div>
      {children}
    </div>
  )
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize:   12,
        color:      '#374151',
        fontStyle:  'italic',
        padding:    '6px 10px',
      }}
    >
      {children}
    </div>
  )
}

function Skeleton({ lines }: { lines: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          style={{
            height:       14,
            background:   'rgba(255,255,255,0.05)',
            borderRadius: 4,
            width:        i === lines - 1 ? '60%' : '100%',
            animation:    'pulse 1.5s ease-in-out infinite',
          }}
        />
      ))}
    </div>
  )
}

function FinCard({
  label,
  value,
  sub,
  color,
  alert = false,
}: {
  label: string
  value: string
  sub:   string
  color: string
  alert?: boolean
}) {
  return (
    <div
      style={{
        padding:      '8px 10px',
        background:   alert ? `${color}0d` : 'rgba(255,255,255,0.03)',
        border:       `1px solid ${alert ? color + '30' : 'rgba(255,255,255,0.06)'}`,
        borderRadius: 8,
      }}
    >
      <div
        style={{
          display:     'flex',
          alignItems:  'center',
          gap:         4,
          marginBottom: 3,
        }}
      >
        {alert
          ? <AlertCircle size={10} style={{ color }} />
          : <CheckCircle2 size={10} style={{ color }} />
        }
        <span style={{ fontSize: 9, color: '#475569', fontFamily: 'monospace', textTransform: 'uppercase' }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>
        {sub}
      </div>
    </div>
  )
}

export default MorningBriefingLayer
