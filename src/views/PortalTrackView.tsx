/**
 * PortalTrackView.tsx
 * Customer-facing job tracking page at /portal/track/:requestId
 * No auth required — public route
 *
 * Shows:
 *   - Current status timeline (Request Received → Accepted → Scheduling → Confirmed → On My Way → Complete)
 *   - Contact info summary
 *   - Static Google Maps showing service address (once accepted)
 *   - Live GPS marker when technician is "On My Way" (Supabase Realtime)
 */

import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useParams } from 'react-router-dom'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PortalRequest {
  id: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  city: string | null
  service_category: string | null
  description: string | null
  preferred_date: string | null
  preferred_time: string | null
  status: string
  created_at: string
}

interface JobTimeline {
  id: string
  event_type: string
  title: string
  description: string | null
  event_time: string
}

const MILESTONE_ORDER = [
  'request_received',
  'accepted',
  'scheduling',
  'confirmed',
  'on_my_way',
  'arrived',
  'work_started',
  'work_completed',
]

const MILESTONE_LABELS: Record<string, { label: string; icon: string; desc: string }> = {
  request_received: { label: 'Request Received',    icon: '📋', desc: 'We got your request and are reviewing it.' },
  accepted:         { label: 'Accepted',             icon: '✅', desc: 'Your request has been accepted. We\'ll reach out with scheduling options soon.' },
  scheduling:       { label: 'Scheduling',           icon: '📅', desc: 'We\'re coordinating your appointment time.' },
  confirmed:        { label: 'Appointment Confirmed',icon: '🔒', desc: 'Your appointment is locked in.' },
  on_my_way:        { label: 'On My Way',            icon: '🚗', desc: 'Your technician is heading to your location.' },
  arrived:          { label: 'Arrived',              icon: '📍', desc: 'Your technician has arrived.' },
  work_started:     { label: 'Work Started',         icon: '⚡', desc: 'Work is in progress.' },
  work_completed:   { label: 'Work Completed',       icon: '🎉', desc: 'All done! Thank you for choosing Power On Solutions.' },
}

const CATEGORY_LABELS: Record<string, string> = {
  residential:   'Residential Electrical',
  commercial:    'Commercial Electrical',
  solar:         'Solar / PV',
  maintenance:   'Maintenance & Service',
  panel_upgrade: 'Panel Upgrade',
  ev_charger:    'EV Charger Installation',
  other:         'Electrical Service',
}

const STATUS_TO_MILESTONE: Record<string, string[]> = {
  new:       ['request_received'],
  reviewed:  ['request_received', 'accepted'],
  scheduled: ['request_received', 'accepted', 'scheduling', 'confirmed'],
  closed:    ['request_received', 'accepted', 'scheduling', 'confirmed', 'work_completed'],
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Manrope:wght@400;500;600;700;800&display=swap');

  .pt {
    --green:   #6ccb3f;
    --green-2: #1c7b36;
    --gold:    #ffd222;
    --white:   #f7f8ef;
    --muted:   #b8c3b4;
    --muted-2: #778372;
    --panel:   rgba(10, 18, 14, 0.72);
    --line:    rgba(255, 255, 255, 0.11);
    --shadow:  0 28px 80px rgba(0,0,0,.48);
    --radius:  20px;
    --ease:    cubic-bezier(.2,.75,.18,1);

    min-height: 100vh;
    background:
      radial-gradient(circle at 20% 0%, rgba(108,203,63,.14), transparent 28%),
      radial-gradient(circle at 85% 12%, rgba(255,210,34,.08), transparent 26%),
      linear-gradient(180deg, #010201 0%, #030604 38%, #061007 100%);
    color: var(--white);
    font-family: "Plus Jakarta Sans", "Manrope", ui-sans-serif, system-ui, sans-serif;
    overflow-x: hidden;
    position: relative;
  }

  .pt-grain {
    position: fixed; inset: 0; z-index: 0; pointer-events: none; opacity: .15;
    background-image:
      linear-gradient(rgba(255,255,255,.02) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,.018) 1px, transparent 1px);
    background-size: 52px 52px;
  }

  .pt-nav {
    position: sticky; top: 0; z-index: 50;
    backdrop-filter: blur(22px);
    background: rgba(1,3,2,.82);
    border-bottom: 1px solid rgba(255,255,255,.08);
  }
  .pt-nav-inner {
    width: min(1240px, calc(100vw - 40px)); margin: 0 auto;
    height: 72px; display: flex; align-items: center;
    justify-content: space-between; gap: 24px;
  }
  .pt-brand { display: flex; align-items: center; gap: 12px; }
  .pt-brand-mark {
    width: 42px; height: 42px; border-radius: 12px;
    display: grid; place-items: center;
    background: linear-gradient(135deg, rgba(108,203,63,.2), rgba(255,210,34,.06)), rgba(255,255,255,.04);
    border: 1px solid rgba(255,255,255,.12);
    font-size: 20px;
  }
  .pt-brand-name { font-size: 14px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
  .pt-brand-sub  { font-size: 10px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--gold); margin-top: 3px; }
  .pt-phone { font-size: 13px; font-weight: 700; color: var(--green); text-decoration: none; }

  .pt-body {
    width: min(640px, calc(100vw - 32px));
    margin: 0 auto; padding: 44px 0 72px;
    position: relative; z-index: 2;
  }

  .pt-eyebrow {
    display: inline-flex; align-items: center; gap: 10px;
    color: var(--green); font-weight: 800; font-size: 11px;
    letter-spacing: .18em; text-transform: uppercase; margin-bottom: 14px;
  }
  .pt-eyebrow::before { content: "⚡"; color: var(--gold); font-size: 13px; }

  .pt-h1 {
    font-size: clamp(28px, 5vw, 42px); font-weight: 800;
    line-height: 1; letter-spacing: -.03em; margin: 0 0 6px;
  }
  .pt-h1 .gold { color: var(--gold); }

  .pt-id {
    font-size: 11px; color: var(--muted-2); font-family: monospace;
    letter-spacing: .08em; margin-bottom: 32px;
  }

  /* Status card */
  .pt-status-card {
    background: var(--panel); border: 1px solid var(--line);
    border-radius: var(--radius); padding: 28px;
    backdrop-filter: blur(16px); box-shadow: var(--shadow);
    margin-bottom: 20px; position: relative; overflow: hidden;
  }
  .pt-status-card::before {
    content: ""; position: absolute; top: 0; left: 0; right: 0; height: 1px;
    background: linear-gradient(90deg, transparent, rgba(108,203,63,.4), transparent);
  }

  .pt-section-label {
    font-size: 10px; font-weight: 800; letter-spacing: .18em;
    color: var(--green); text-transform: uppercase;
    margin: 0 0 20px;
    display: flex; align-items: center; gap: 10px;
  }
  .pt-section-label::after {
    content: ""; flex: 1; height: 1px;
    background: linear-gradient(90deg, rgba(108,203,63,.3), transparent);
  }

  /* Timeline */
  .pt-timeline { display: flex; flex-direction: column; gap: 0; }
  .pt-milestone {
    display: flex; gap: 16px; align-items: flex-start;
    position: relative;
  }
  .pt-milestone:not(:last-child)::before {
    content: ""; position: absolute;
    left: 17px; top: 36px;
    width: 2px; height: calc(100% + 4px);
    background: rgba(255,255,255,.08);
    z-index: 0;
  }
  .pt-milestone.done:not(:last-child)::before {
    background: linear-gradient(180deg, var(--green), rgba(108,203,63,.2));
  }
  .pt-milestone-dot {
    width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0;
    display: grid; place-items: center; font-size: 16px;
    background: rgba(255,255,255,.05); border: 2px solid rgba(255,255,255,.1);
    position: relative; z-index: 1; transition: all .3s;
  }
  .pt-milestone.done .pt-milestone-dot {
    background: linear-gradient(135deg, var(--green), var(--green-2));
    border-color: var(--green);
    box-shadow: 0 0 16px rgba(108,203,63,.4);
  }
  .pt-milestone.active .pt-milestone-dot {
    background: rgba(108,203,63,.15);
    border-color: var(--green);
    box-shadow: 0 0 20px rgba(108,203,63,.3);
    animation: pt-pulse 2s ease-in-out infinite;
  }
  .pt-milestone-content { padding: 6px 0 24px; flex: 1; }
  .pt-milestone-title {
    font-size: 14px; font-weight: 700;
    color: var(--muted-2); margin-bottom: 2px;
    transition: color .3s;
  }
  .pt-milestone.done .pt-milestone-title,
  .pt-milestone.active .pt-milestone-title { color: var(--white); }
  .pt-milestone-desc { font-size: 12px; color: var(--muted-2); line-height: 1.5; }
  .pt-milestone.active .pt-milestone-desc { color: var(--muted); }
  .pt-milestone-time { font-size: 11px; color: var(--muted-2); margin-top: 3px; font-family: monospace; }

  /* Info card */
  .pt-info-card {
    background: var(--panel); border: 1px solid var(--line);
    border-radius: var(--radius); padding: 24px 28px;
    backdrop-filter: blur(16px); margin-bottom: 20px;
  }
  .pt-info-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,.05); }
  .pt-info-row:last-child { border-bottom: none; }
  .pt-info-label { font-size: 11px; font-weight: 700; letter-spacing: .07em; color: var(--muted-2); text-transform: uppercase; flex-shrink: 0; }
  .pt-info-value { font-size: 13px; font-weight: 600; color: var(--white); text-align: right; }

  /* Status badge */
  .pt-badge {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 700;
  }
  .pt-badge.new      { background: rgba(108,203,63,.12); color: var(--green); border: 1px solid rgba(108,203,63,.3); }
  .pt-badge.reviewed { background: rgba(59,130,246,.12); color: #60a5fa; border: 1px solid rgba(59,130,246,.3); }
  .pt-badge.closed   { background: rgba(255,255,255,.06); color: var(--muted); border: 1px solid rgba(255,255,255,.1); }

  /* Not found */
  .pt-not-found { text-align: center; padding: 80px 24px; }
  .pt-not-found-icon { font-size: 48px; margin-bottom: 20px; }
  .pt-not-found-title { font-size: 28px; font-weight: 800; margin-bottom: 12px; }
  .pt-not-found-sub { font-size: 15px; color: var(--muted); line-height: 1.6; }

  /* Loading */
  .pt-loading { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 80px 24px; gap: 16px; }
  .pt-spinner { width: 36px; height: 36px; border: 3px solid rgba(108,203,63,.2); border-top-color: var(--green); border-radius: 50%; animation: pt-spin .8s linear infinite; }

  .pt-footer {
    text-align: center; padding: 20px 24px;
    border-top: 1px solid rgba(255,255,255,.06);
    font-size: 12px; color: var(--muted-2);
    position: relative; z-index: 2;
  }
  .pt-footer a { color: var(--green); text-decoration: none; }

  .pt-cta {
    text-align: center; padding: 20px 0 0;
  }
  .pt-cta a {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 12px 28px; border-radius: 12px;
    background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.12);
    color: var(--white); font-size: 14px; font-weight: 600; text-decoration: none;
    transition: all .22s;
  }
  .pt-cta a:hover { background: rgba(255,255,255,.09); border-color: rgba(108,203,63,.4); }

  @keyframes pt-spin { to { transform: rotate(360deg); } }
  @keyframes pt-pulse {
    0%, 100% { box-shadow: 0 0 20px rgba(108,203,63,.3); }
    50%       { box-shadow: 0 0 32px rgba(108,203,63,.6); }
  }

  @media (max-width: 520px) {
    .pt-status-card, .pt-info-card { padding: 20px 16px; }
  }
`

function injectStyles() {
  if (document.getElementById('pt-styles')) return
  const s = document.createElement('style')
  s.id = 'pt-styles'
  s.textContent = CSS
  document.head.appendChild(s)
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function PortalTrackView() {
  useEffect(() => { injectStyles() }, [])

  const { requestId } = useParams<{ requestId: string }>()
  const [request, setRequest] = useState<PortalRequest | null>(null)
  const [timeline, setTimeline] = useState<JobTimeline[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!requestId) { setNotFound(true); setLoading(false); return }

    async function load() {
      const { data, error } = await (supabase as any)
        .from('portal_requests')
        .select('*')
        .eq('id', requestId)
        .single()

      if (error || !data) { setNotFound(true); setLoading(false); return }
      setRequest(data as PortalRequest)

      const { data: timelineData } = await (supabase as any)
        .from('job_timeline')
        .select('*')
        .eq('portal_request_id', requestId)
        .order('event_time', { ascending: true })

      setTimeline((timelineData ?? []) as JobTimeline[])
      setLoading(false)
    }

    load()

    // Realtime subscription for timeline updates
    const channel = supabase
      .channel(`portal_track_${requestId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'job_timeline',
        filter: `portal_request_id=eq.${requestId}`,
      }, (payload) => {
        setTimeline(prev => [...prev, payload.new as JobTimeline])
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'portal_requests',
        filter: `id=eq.${requestId}`,
      }, (payload) => {
        setRequest(prev => prev ? { ...prev, ...payload.new } : prev)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [requestId])

  // Compute which milestones are done based on status + timeline events
  const doneTypes = new Set<string>([
    'request_received', // always done once the request exists
    ...timeline.map(t => t.event_type),
    ...(STATUS_TO_MILESTONE[request?.status ?? 'new'] ?? []),
  ])

  const activeMilestone = MILESTONE_ORDER.filter(m => !doneTypes.has(m))[0] ?? null

  const timelineMap = Object.fromEntries(timeline.map(t => [t.event_type, t]))

  return (
    <div className="pt">
      <div className="pt-grain" />

      <nav className="pt-nav">
        <div className="pt-nav-inner">
          <div className="pt-brand">
            <div className="pt-brand-mark">⚡</div>
            <div>
              <div className="pt-brand-name">Power On Solutions</div>
              <div className="pt-brand-sub">C-10 Electrical · Lic #1151468</div>
            </div>
          </div>
          <a href="tel:17603399888" className="pt-phone">(760) 339-9888</a>
        </div>
      </nav>

      <div className="pt-body">
        {loading ? (
          <div className="pt-loading">
            <div className="pt-spinner" />
            <span style={{ color: 'var(--muted)', fontSize: 14 }}>Loading your request…</span>
          </div>
        ) : notFound ? (
          <div className="pt-not-found">
            <div className="pt-not-found-icon">🔍</div>
            <div className="pt-not-found-title">Request Not Found</div>
            <p className="pt-not-found-sub">
              We couldn't find this request. Please check your link or call us at (760) 339-9888.
            </p>
          </div>
        ) : request ? (
          <>
            <div className="pt-eyebrow">Job Tracker</div>
            <h1 className="pt-h1">
              Your <span className="gold">Request</span> Status
            </h1>
            <div className="pt-id">Request ID: {requestId?.slice(0, 8).toUpperCase()}</div>

            {/* Timeline */}
            <div className="pt-status-card">
              <div className="pt-section-label">Progress</div>
              <div className="pt-timeline">
                {MILESTONE_ORDER.map((type) => {
                  const meta = MILESTONE_LABELS[type]
                  const isDone = doneTypes.has(type)
                  const isActive = type === activeMilestone && !isDone
                  const timelineEntry = timelineMap[type]
                  return (
                    <div
                      key={type}
                      className={`pt-milestone${isDone ? ' done' : ''}${isActive ? ' active' : ''}`}
                    >
                      <div className="pt-milestone-dot">
                        {isDone ? '✓' : meta.icon}
                      </div>
                      <div className="pt-milestone-content">
                        <div className="pt-milestone-title">{meta.label}</div>
                        {(isDone || isActive) && (
                          <div className="pt-milestone-desc">{timelineEntry?.description || meta.desc}</div>
                        )}
                        {timelineEntry && (
                          <div className="pt-milestone-time">{formatTime(timelineEntry.event_time)}</div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Request Info */}
            <div className="pt-info-card">
              <div className="pt-section-label">Your Request</div>
              <div className="pt-info-row">
                <span className="pt-info-label">Name</span>
                <span className="pt-info-value">{request.name}</span>
              </div>
              {request.service_category && (
                <div className="pt-info-row">
                  <span className="pt-info-label">Service</span>
                  <span className="pt-info-value">{CATEGORY_LABELS[request.service_category] ?? request.service_category}</span>
                </div>
              )}
              {request.city && (
                <div className="pt-info-row">
                  <span className="pt-info-label">Location</span>
                  <span className="pt-info-value">{[request.address, request.city].filter(Boolean).join(', ')}</span>
                </div>
              )}
              {request.preferred_date && (
                <div className="pt-info-row">
                  <span className="pt-info-label">Preferred Date</span>
                  <span className="pt-info-value">{request.preferred_date}{request.preferred_time ? ` · ${request.preferred_time}` : ''}</span>
                </div>
              )}
              <div className="pt-info-row">
                <span className="pt-info-label">Submitted</span>
                <span className="pt-info-value">{formatTime(request.created_at)}</span>
              </div>
              <div className="pt-info-row">
                <span className="pt-info-label">Status</span>
                <span className={`pt-badge ${request.status}`}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
                  {request.status === 'new' ? 'Under Review' :
                   request.status === 'reviewed' ? 'Accepted' :
                   request.status === 'scheduled' ? 'Scheduled' :
                   request.status === 'closed' ? 'Completed' :
                   request.status}
                </span>
              </div>
            </div>

            <div className="pt-cta">
              <a href="/portal">← Submit Another Request</a>
            </div>
          </>
        ) : null}
      </div>

      <footer className="pt-footer">
        © {new Date().getFullYear()} Power On Solutions LLC &nbsp;·&nbsp;
        C-10 Electrical License #1151468 &nbsp;·&nbsp;
        <a href="tel:17603399888">(760) 339-9888</a>
      </footer>
    </div>
  )
}
