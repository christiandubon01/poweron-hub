/**
 * PortalTrackView.tsx
 * Customer-facing job tracking page at /portal/track/:requestId
 * No auth required — public route
 *
 * Fixes:
 *   - Map init separated from geocoding so pin renders after request loads
 *   - activeMilestone only highlights after meaningful progress
 *   - reviewed status = Request Received only (not Accepted)
 */

import React, { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useParams } from 'react-router-dom'

const LOGO_URL = 'https://edxxbtyugohtowvslbfo.supabase.co/storage/v1/object/public/brand-assets/ChatGPT%20Image%20Jan%2030,%202026,%2010_40_53%20AM1.png'
const MAPS_API_KEY = (import.meta as any).env?.VITE_GOOGLE_MAPS_BROWSER_KEY ?? ''

const CV_CITIES = [
  'desert hot springs', 'palm springs', 'cathedral city', 'rancho mirage',
  'palm desert', 'indian wells', 'la quinta', 'indio', 'coachella',
  'thermal', 'mecca', 'thousand palms', 'bermuda dunes', 'sky valley',
  'desert edge', 'north palm springs', 'east hemet',
]

const CV_CENTER = { lat: 33.7225, lng: -116.3736 }
const CV_ZOOM = 10
const CA_CENTER = { lat: 36.7783, lng: -119.4179 }
const CA_ZOOM = 6

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

interface TechLocation {
  latitude: number
  longitude: number
  is_active: boolean
  technician_name: string | null
}

const MILESTONE_ORDER = [
  'request_received', 'accepted', 'scheduling', 'confirmed',
  'on_my_way', 'arrived', 'work_started', 'work_completed',
]

const MILESTONE_LABELS: Record<string, { label: string; icon: string; desc: string }> = {
  request_received: { label: 'Request Received',     icon: '📋', desc: 'We got your request and are reviewing it.' },
  accepted:         { label: 'Accepted',              icon: '✅', desc: 'Your request has been accepted. We\'ll reach out with scheduling options soon.' },
  scheduling:       { label: 'Scheduling',            icon: '📅', desc: 'We\'re coordinating your appointment time.' },
  confirmed:        { label: 'Appointment Confirmed', icon: '🔒', desc: 'Your appointment is locked in.' },
  on_my_way:        { label: 'On My Way',             icon: '🚗', desc: 'Your technician is heading to your location.' },
  arrived:          { label: 'Arrived',               icon: '📍', desc: 'Your technician has arrived.' },
  work_started:     { label: 'Work Started',          icon: '⚡', desc: 'Work is in progress.' },
  work_completed:   { label: 'Work Completed',        icon: '🎉', desc: 'All done! Thank you for choosing Power On Solutions.' },
}

const CATEGORY_LABELS: Record<string, string> = {
  residential: 'Residential Electrical', commercial: 'Commercial Electrical',
  solar: 'Solar / PV', maintenance: 'Maintenance & Service',
  panel_upgrade: 'Panel Upgrade', ev_charger: 'EV Charger Installation', other: 'Electrical Service',
}

// Only explicit job_timeline events drive milestone completion
// Status only drives request_received
const STATUS_TO_MILESTONE: Record<string, string[]> = {
  new:       ['request_received'],
  reviewed:  ['request_received'],
  scheduled: ['request_received', 'accepted', 'scheduling', 'confirmed'],
  closed:    ['request_received', 'accepted', 'scheduling', 'confirmed', 'work_completed'],
}

function isCoachellaValley(city: string | null): boolean {
  if (!city) return false
  return CV_CITIES.includes(city.toLowerCase().trim())
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
    min-height: 100vh;
    background:
      radial-gradient(circle at 20% 0%, rgba(108,203,63,.14), transparent 28%),
      radial-gradient(circle at 85% 12%, rgba(255,210,34,.08), transparent 26%),
      linear-gradient(180deg, #010201 0%, #030604 38%, #061007 100%);
    color: var(--white);
    font-family: "Plus Jakarta Sans", "Manrope", ui-sans-serif, system-ui, sans-serif;
    overflow-x: hidden;
  }
  .pt-grain {
    position: fixed; inset: 0; z-index: 0; pointer-events: none; opacity: .15;
    background-image: linear-gradient(rgba(255,255,255,.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.018) 1px, transparent 1px);
    background-size: 52px 52px;
  }
  .pt-nav {
    position: sticky; top: 0; z-index: 50;
    backdrop-filter: blur(22px); background: rgba(1,3,2,.82);
    border-bottom: 1px solid rgba(255,255,255,.08);
  }
  .pt-nav-inner {
    width: min(1240px, calc(100vw - 40px)); margin: 0 auto;
    height: 72px; display: flex; align-items: center; justify-content: space-between; gap: 24px;
  }
  .pt-logo { height: 44px; width: auto; object-fit: contain; display: block; }
  .pt-phone { font-size: 13px; font-weight: 700; color: #6ccb3f; text-decoration: none; }
  .pt-body { width: min(680px, calc(100vw - 32px)); margin: 0 auto; padding: 44px 0 72px; position: relative; z-index: 2; }
  .pt-eyebrow { display: inline-flex; align-items: center; gap: 10px; color: #6ccb3f; font-weight: 800; font-size: 11px; letter-spacing: .18em; text-transform: uppercase; margin-bottom: 14px; }
  .pt-eyebrow::before { content: "⚡"; color: #ffd222; font-size: 13px; }
  .pt-h1 { font-size: clamp(28px, 5vw, 42px); font-weight: 800; line-height: 1; letter-spacing: -.03em; margin: 0 0 6px; }
  .pt-h1 .gold { color: #ffd222; }
  .pt-id { font-size: 11px; color: #778372; font-family: monospace; letter-spacing: .08em; margin-bottom: 28px; }

  .pt-map-card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; margin-bottom: 20px; box-shadow: var(--shadow); }
  .pt-map-header { padding: 14px 20px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid rgba(255,255,255,.06); }
  .pt-map-title { font-size: 12px; font-weight: 700; color: #b8c3b4; letter-spacing: .06em; text-transform: uppercase; }
  .pt-map-live { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 20px; background: rgba(108,203,63,.12); border: 1px solid rgba(108,203,63,.3); font-size: 11px; font-weight: 700; color: #6ccb3f; margin-left: auto; }
  .pt-map-live-dot { width: 6px; height: 6px; border-radius: 50%; background: #6ccb3f; animation: pt-pulse 1.5s ease-in-out infinite; }
  .pt-map-container { height: 300px; width: 100%; }

  .pt-status-card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 28px; backdrop-filter: blur(16px); box-shadow: var(--shadow); margin-bottom: 20px; position: relative; overflow: hidden; }
  .pt-status-card::before { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, rgba(108,203,63,.4), transparent); }
  .pt-section-label { font-size: 10px; font-weight: 800; letter-spacing: .18em; color: #6ccb3f; text-transform: uppercase; margin: 0 0 20px; display: flex; align-items: center; gap: 10px; }
  .pt-section-label::after { content: ""; flex: 1; height: 1px; background: linear-gradient(90deg, rgba(108,203,63,.3), transparent); }

  .pt-timeline { display: flex; flex-direction: column; gap: 0; }
  .pt-milestone { display: flex; gap: 16px; align-items: flex-start; position: relative; }
  .pt-milestone:not(:last-child)::before { content: ""; position: absolute; left: 17px; top: 36px; width: 2px; height: calc(100% + 4px); background: rgba(255,255,255,.08); z-index: 0; }
  .pt-milestone.done:not(:last-child)::before { background: linear-gradient(180deg, #6ccb3f, rgba(108,203,63,.2)); }
  .pt-milestone-dot { width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0; display: grid; place-items: center; font-size: 16px; background: rgba(255,255,255,.05); border: 2px solid rgba(255,255,255,.1); position: relative; z-index: 1; transition: all .3s; }
  .pt-milestone.done .pt-milestone-dot { background: linear-gradient(135deg, #6ccb3f, #1c7b36); border-color: #6ccb3f; box-shadow: 0 0 16px rgba(108,203,63,.4); }
  .pt-milestone.active .pt-milestone-dot { background: rgba(108,203,63,.15); border-color: #6ccb3f; box-shadow: 0 0 20px rgba(108,203,63,.3); animation: pt-pulse 2s ease-in-out infinite; }
  .pt-milestone-content { padding: 6px 0 24px; flex: 1; }
  .pt-milestone-title { font-size: 14px; font-weight: 700; color: #778372; margin-bottom: 2px; transition: color .3s; }
  .pt-milestone.done .pt-milestone-title, .pt-milestone.active .pt-milestone-title { color: #f7f8ef; }
  .pt-milestone-desc { font-size: 12px; color: #778372; line-height: 1.5; }
  .pt-milestone.active .pt-milestone-desc { color: #b8c3b4; }
  .pt-milestone-time { font-size: 11px; color: #778372; margin-top: 3px; font-family: monospace; }

  .pt-info-card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 24px 28px; backdrop-filter: blur(16px); margin-bottom: 20px; }
  .pt-info-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,.05); }
  .pt-info-row:last-child { border-bottom: none; }
  .pt-info-label { font-size: 11px; font-weight: 700; letter-spacing: .07em; color: #778372; text-transform: uppercase; flex-shrink: 0; }
  .pt-info-value { font-size: 13px; font-weight: 600; color: #f7f8ef; text-align: right; }
  .pt-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 700; }
  .pt-badge.new      { background: rgba(108,203,63,.12); color: #6ccb3f; border: 1px solid rgba(108,203,63,.3); }
  .pt-badge.reviewed { background: rgba(108,203,63,.12); color: #6ccb3f; border: 1px solid rgba(108,203,63,.3); }
  .pt-badge.scheduled { background: rgba(59,130,246,.12); color: #60a5fa; border: 1px solid rgba(59,130,246,.3); }
  .pt-badge.closed   { background: rgba(255,255,255,.06); color: #b8c3b4; border: 1px solid rgba(255,255,255,.1); }

  .pt-not-found { text-align: center; padding: 80px 24px; }
  .pt-not-found-icon { font-size: 48px; margin-bottom: 20px; }
  .pt-not-found-title { font-size: 28px; font-weight: 800; margin-bottom: 12px; }
  .pt-not-found-sub { font-size: 15px; color: #b8c3b4; line-height: 1.6; }
  .pt-loading { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 80px 24px; gap: 16px; }
  .pt-spinner { width: 36px; height: 36px; border: 3px solid rgba(108,203,63,.2); border-top-color: #6ccb3f; border-radius: 50%; animation: pt-spin .8s linear infinite; }
  .pt-cta { text-align: center; padding: 20px 0 0; }
  .pt-cta a { display: inline-flex; align-items: center; gap: 8px; padding: 12px 28px; border-radius: 12px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.12); color: #f7f8ef; font-size: 14px; font-weight: 600; text-decoration: none; transition: all .22s; }
  .pt-cta a:hover { background: rgba(255,255,255,.09); border-color: rgba(108,203,63,.4); }
  .pt-footer { text-align: center; padding: 22px 24px; border-top: 1px solid rgba(255,255,255,.06); font-size: 12px; color: #778372; position: relative; z-index: 2; }
  .pt-footer a { color: #6ccb3f; text-decoration: none; }

  @keyframes pt-spin { to { transform: rotate(360deg); } }
  @keyframes pt-pulse { 0%, 100% { box-shadow: 0 0 20px rgba(108,203,63,.3); } 50% { box-shadow: 0 0 32px rgba(108,203,63,.6); } }
  @media (max-width: 520px) { .pt-status-card, .pt-info-card { padding: 20px 16px; } .pt-map-container { height: 240px; } }
`

function injectStyles() {
  if (document.getElementById('pt-styles')) return
  const s = document.createElement('style')
  s.id = 'pt-styles'
  s.textContent = CSS
  document.head.appendChild(s)
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// ── Maps loader ───────────────────────────────────────────────────────────────
let mapsLoaded = false
let mapsLoading = false
const mapsCallbacks: (() => void)[] = []

function loadGoogleMaps(cb: () => void) {
  if (mapsLoaded) { cb(); return }
  mapsCallbacks.push(cb)
  if (mapsLoading) return
  mapsLoading = true
  const script = document.createElement('script')
  script.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_API_KEY}`
  script.async = true
  script.onload = () => {
    mapsLoaded = true
    mapsLoading = false
    mapsCallbacks.forEach(fn => fn())
    mapsCallbacks.length = 0
  }
  document.head.appendChild(script)
}

// ── Map component ─────────────────────────────────────────────────────────────
function TrackingMap({
  address, city, techLocation, isOnMyWay,
}: {
  address: string | null
  city: string | null
  techLocation: TechLocation | null
  isOnMyWay: boolean
}) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<any>(null)
  const customerMarker = useRef<any>(null)
  const techMarker = useRef<any>(null)
  const geocodedPos = useRef<{ lat: number; lng: number } | null>(null)
  const isLocal = isCoachellaValley(city)

  // Step 1: Init map (runs once on mount)
  useEffect(() => {
    if (!MAPS_API_KEY) return
    loadGoogleMaps(() => {
      if (!mapRef.current || mapInstance.current) return
      const google = (window as any).google
      const center = isLocal ? CV_CENTER : CA_CENTER
      const zoom = isLocal ? CV_ZOOM : CA_ZOOM
      mapInstance.current = new google.maps.Map(mapRef.current, {
        center, zoom,
        styles: [
          { elementType: 'geometry', stylers: [{ color: '#0a1208' }] },
          { elementType: 'labels.text.fill', stylers: [{ color: '#6ccb3f' }] },
          { elementType: 'labels.text.stroke', stylers: [{ color: '#0a1208' }] },
          { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1a2e1a' }] },
          { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#0d1f0d' }] },
          { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#041208' }] },
          { featureType: 'poi', stylers: [{ visibility: 'off' }] },
          { featureType: 'transit', stylers: [{ visibility: 'off' }] },
        ],
        disableDefaultUI: false,
        zoomControl: true,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
      })
    })
  }, []) // eslint-disable-line

  // Step 2: Geocode address whenever address/city become available
  useEffect(() => {
    if (!address && !city) return
    if (!MAPS_API_KEY) return

    const doGeocode = () => {
      const google = (window as any).google
      if (!google || !mapInstance.current) return
      const query = [address, city, 'CA'].filter(Boolean).join(', ')
      const geocoder = new google.maps.Geocoder()
      geocoder.geocode({ address: query }, (results: any, status: any) => {
        if (status !== 'OK' || !results[0]) return
        const loc = results[0].geometry.location
        const pos = { lat: loc.lat(), lng: loc.lng() }
        geocodedPos.current = pos

        // Place customer pin
        if (customerMarker.current) customerMarker.current.setMap(null)
        customerMarker.current = new google.maps.Marker({
          position: pos,
          map: mapInstance.current,
          title: 'Service Location',
          icon: {
            url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
              '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">' +
              '<path d="M16 0C7.163 0 0 7.163 0 16c0 10 16 24 16 24s16-14 16-24C32 7.163 24.837 0 16 0z" fill="#6ccb3f" stroke="#fff" stroke-width="1.5"/>' +
              '<circle cx="16" cy="16" r="5" fill="#fff"/>' +
              '</svg>'
            )}`,
            scaledSize: new google.maps.Size(32, 40),
            anchor: new google.maps.Point(16, 40),
          },
        })

        // Zoom to address if Coachella Valley
        if (isLocal) {
          mapInstance.current.setCenter(pos)
          mapInstance.current.setZoom(14)
        }
      })
    }

    if (mapsLoaded && mapInstance.current) {
      doGeocode()
    } else {
      loadGoogleMaps(() => {
        // Wait a tick for map to be ready
        setTimeout(doGeocode, 200)
      })
    }
  }, [address, city, isLocal])

  // Step 3: Update tech marker when GPS location changes
  useEffect(() => {
    if (!mapInstance.current || !techLocation?.is_active) {
      if (techMarker.current) { techMarker.current.setMap(null); techMarker.current = null }
      return
    }
    const google = (window as any).google
    if (!google) return
    const pos = { lat: techLocation.latitude, lng: techLocation.longitude }
    if (!techMarker.current) {
      techMarker.current = new google.maps.Marker({
        position: pos,
        map: mapInstance.current,
        title: techLocation.technician_name || 'Technician',
        icon: {
          url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">' +
            '<circle cx="18" cy="18" r="16" fill="#ffd222" stroke="#0a1208" stroke-width="2"/>' +
            '<text x="18" y="24" text-anchor="middle" font-size="18">🚗</text>' +
            '</svg>'
          )}`,
          scaledSize: new google.maps.Size(36, 36),
          anchor: new google.maps.Point(18, 18),
        },
      })
    } else {
      techMarker.current.setPosition(pos)
    }

    // Fit both markers in view
    if (geocodedPos.current) {
      const bounds = new google.maps.LatLngBounds()
      bounds.extend(pos)
      bounds.extend(geocodedPos.current)
      mapInstance.current.fitBounds(bounds, { padding: 60 })
    }
  }, [techLocation])

  if (!MAPS_API_KEY) return null

  return (
    <div className="pt-map-card">
      <div className="pt-map-header">
        <span style={{ fontSize: 14 }}>📍</span>
        <span className="pt-map-title">Service Location</span>
        {isOnMyWay && techLocation?.is_active && (
          <div className="pt-map-live">
            <div className="pt-map-live-dot" />
            Live Tracking
          </div>
        )}
      </div>
      <div className="pt-map-container" ref={mapRef} />
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function PortalTrackView() {
  useEffect(() => { injectStyles() }, [])

  const { requestId } = useParams<{ requestId: string }>()
  const [request, setRequest] = useState<PortalRequest | null>(null)
  const [timeline, setTimeline] = useState<JobTimeline[]>([])
  const [techLocation, setTechLocation] = useState<TechLocation | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!requestId) { setNotFound(true); setLoading(false); return }

    async function load() {
      const { data, error } = await (supabase as any)
        .from('portal_requests').select('*').eq('id', requestId).single()
      if (error || !data) { setNotFound(true); setLoading(false); return }
      setRequest(data as PortalRequest)

      const { data: tlData } = await (supabase as any)
        .from('job_timeline').select('*')
        .eq('portal_request_id', requestId).order('event_time', { ascending: true })
      setTimeline((tlData ?? []) as JobTimeline[])

      const { data: techData } = await (supabase as any)
        .from('technician_location').select('*')
        .eq('portal_request_id', requestId).eq('is_active', true)
        .order('updated_at', { ascending: false }).limit(1).maybeSingle()
      if (techData) setTechLocation(techData as TechLocation)

      setLoading(false)
    }

    load()

    const channel = supabase.channel(`pt_${requestId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'job_timeline', filter: `portal_request_id=eq.${requestId}` },
        (p) => setTimeline(prev => [...prev, p.new as JobTimeline]))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'portal_requests', filter: `id=eq.${requestId}` },
        (p) => setRequest(prev => prev ? { ...prev, ...p.new } : prev))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'technician_location', filter: `portal_request_id=eq.${requestId}` },
        (p) => {
          if (p.new && (p.new as any).is_active) setTechLocation(p.new as TechLocation)
          else setTechLocation(null)
        })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [requestId])

  const doneTypes = new Set<string>([
    ...timeline.map(t => t.event_type),
    ...(STATUS_TO_MILESTONE[request?.status ?? 'new'] ?? []),
  ])

  // Only show active state when there's meaningful progress (at least one timeline event)
  const hasProgress = timeline.length > 0 || (request?.status && !['new', 'reviewed'].includes(request.status))
  const activeMilestone = hasProgress
    ? MILESTONE_ORDER.filter(m => !doneTypes.has(m))[0] ?? null
    : null

  const isOnMyWay = doneTypes.has('on_my_way') && !doneTypes.has('arrived')
  const timelineMap = Object.fromEntries(timeline.map(t => [t.event_type, t]))

  return (
    <div className="pt">
      <div className="pt-grain" />
      <nav className="pt-nav">
        <div className="pt-nav-inner">
          <img src={LOGO_URL} alt="Power On Solutions LLC" className="pt-logo" />
          <a href="tel:17606238962" className="pt-phone">(760) 623-8962</a>
        </div>
      </nav>

      <div className="pt-body">
        {loading ? (
          <div className="pt-loading">
            <div className="pt-spinner" />
            <span style={{ color: '#b8c3b4', fontSize: 14 }}>Loading your request…</span>
          </div>
        ) : notFound ? (
          <div className="pt-not-found">
            <div className="pt-not-found-icon">🔍</div>
            <div className="pt-not-found-title">Request Not Found</div>
            <p className="pt-not-found-sub">We couldn't find this request. Please check your link or call us at (760) 623-8962.</p>
          </div>
        ) : request ? (
          <>
            <div className="pt-eyebrow">Job Tracker</div>
            <h1 className="pt-h1">Your <span className="gold">Request</span> Status</h1>
            <div className="pt-id">Request ID: {requestId?.slice(0, 8).toUpperCase()}</div>

            <TrackingMap
              address={request.address}
              city={request.city}
              techLocation={techLocation}
              isOnMyWay={isOnMyWay}
            />

            <div className="pt-status-card">
              <div className="pt-section-label">Progress</div>
              <div className="pt-timeline">
                {MILESTONE_ORDER.map((type) => {
                  const meta = MILESTONE_LABELS[type]
                  const isDone = doneTypes.has(type)
                  const isActive = type === activeMilestone
                  const entry = timelineMap[type]
                  return (
                    <div key={type} className={`pt-milestone${isDone ? ' done' : ''}${isActive ? ' active' : ''}`}>
                      <div className="pt-milestone-dot">{isDone ? '✓' : meta.icon}</div>
                      <div className="pt-milestone-content">
                        <div className="pt-milestone-title">{meta.label}</div>
                        {(isDone || isActive) && <div className="pt-milestone-desc">{entry?.description || meta.desc}</div>}
                        {entry && <div className="pt-milestone-time">{formatTime(entry.event_time)}</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="pt-info-card">
              <div className="pt-section-label">Your Request</div>
              <div className="pt-info-row"><span className="pt-info-label">Name</span><span className="pt-info-value">{request.name}</span></div>
              {request.service_category && (
                <div className="pt-info-row"><span className="pt-info-label">Service</span><span className="pt-info-value">{CATEGORY_LABELS[request.service_category] ?? request.service_category}</span></div>
              )}
              {(request.address || request.city) && (
                <div className="pt-info-row"><span className="pt-info-label">Location</span><span className="pt-info-value">{[request.address, request.city].filter(Boolean).join(', ')}</span></div>
              )}
              {request.preferred_date && (
                <div className="pt-info-row"><span className="pt-info-label">Preferred Date</span><span className="pt-info-value">{request.preferred_date}{request.preferred_time ? ` · ${request.preferred_time}` : ''}</span></div>
              )}
              <div className="pt-info-row"><span className="pt-info-label">Submitted</span><span className="pt-info-value">{formatTime(request.created_at)}</span></div>
              <div className="pt-info-row">
                <span className="pt-info-label">Status</span>
                <span className={`pt-badge ${request.status}`}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
                  {request.status === 'new' ? 'Under Review' :
                   request.status === 'reviewed' ? 'Under Review' :
                   request.status === 'scheduled' ? 'Scheduled' :
                   request.status === 'closed' ? 'Completed' : request.status}
                </span>
              </div>
            </div>

            <div className="pt-cta"><a href="/portal">← Submit Another Request</a></div>
          </>
        ) : null}
      </div>

      <footer className="pt-footer">
        © {new Date().getFullYear()} Power On Solutions LLC &nbsp;·&nbsp; C-10 Electrical License #1151468 &nbsp;·&nbsp;
        <a href="tel:17606238962">(760) 623-8962</a>
      </footer>
    </div>
  )
}
