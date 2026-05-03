/**
 * PortalInbox.tsx
 * Portal submission inbox rendered above HUNTER lead list.
 *
 * Features:
 *   - Collapsible amber banner with submission count
 *   - Each row shows summary — click opens full detail modal
 *   - Modal: full contact info, address, service details, preferred times,
 *     description, uploaded files/images preview, map pin
 *   - Convert to Lead button → fires Accepted milestone on tracking page
 *   - Dismiss button → closes request
 *   - Auto-refreshes every 60 seconds
 */

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { ChevronDown, ChevronUp, Loader2, Globe, X, ArrowRight, MapPin, Phone, Mail, Calendar, Clock, FileText, Image, ExternalLink } from 'lucide-react'
import clsx from 'clsx'
import {
  fetchNewPortalRequests,
  convertToLead,
  dismissPortalRequest,
  type PortalRequest,
} from '@/services/portal/portalService'

interface PortalInboxProps {
  onLeadConverted?: () => void
}

const CATEGORY_LABELS: Record<string, string> = {
  residential:   'Residential',
  commercial:    'Commercial',
  solar:         'Solar / PV',
  maintenance:   'Maintenance',
  panel_upgrade: 'Panel Upgrade',
  ev_charger:    'EV Charger',
  other:         'Other',
}

const TYPE_LABELS: Record<string, string> = {
  homeowner: 'Homeowner',
  gc:        'GC / Sub',
}

const MAPS_API_KEY = (import.meta as any).env?.VITE_GOOGLE_MAPS_BROWSER_KEY ?? ''

// Parse file URLs from notes field
function parseFileUrls(notes: string | null): string[] {
  if (!notes) return []
  const match = notes.match(/Files:\s*(.+)/)
  if (!match) return []
  return match[1].split(',').map(u => u.trim()).filter(Boolean)
}

function isImageUrl(url: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(url)
}

function isPdfUrl(url: string): boolean {
  return /\.pdf$/i.test(url)
}

function getFileName(url: string): string {
  return decodeURIComponent(url.split('/').pop() ?? url).replace(/^\d+-/, '')
}

// ── Mini map component ────────────────────────────────────────────────────────
let mapsLoaded = false
let mapsLoading = false
const mapsCallbacks: (() => void)[] = []

function loadGoogleMaps(cb: () => void) {
  if (mapsLoaded) { cb(); return }
  mapsCallbacks.push(cb)
  if (mapsLoading) return
  mapsLoading = true
  const existing = document.querySelector(`script[src*="maps.googleapis.com"]`)
  if (existing) {
    existing.addEventListener('load', () => {
      mapsLoaded = true; mapsLoading = false
      mapsCallbacks.forEach(fn => fn()); mapsCallbacks.length = 0
    })
    return
  }
  const script = document.createElement('script')
  script.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_API_KEY}&libraries=places`
  script.async = true
  script.onload = () => {
    mapsLoaded = true; mapsLoading = false
    mapsCallbacks.forEach(fn => fn()); mapsCallbacks.length = 0
  }
  document.head.appendChild(script)
}

function MiniMap({ address, city }: { address: string | null; city: string | null }) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<any>(null)

  useEffect(() => {
    if (!MAPS_API_KEY || (!address && !city)) return

    const init = () => {
      if (!mapRef.current || mapInstance.current) return
      const google = (window as any).google
      if (!google?.maps) return

      mapInstance.current = new google.maps.Map(mapRef.current, {
        center: { lat: 33.7225, lng: -116.3736 },
        zoom: 12,
        disableDefaultUI: true,
        zoomControl: false,
        styles: [
          { elementType: 'geometry', stylers: [{ color: '#0a1208' }] },
          { elementType: 'labels.text.fill', stylers: [{ color: '#6ccb3f' }] },
          { elementType: 'labels.text.stroke', stylers: [{ color: '#0a1208' }] },
          { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1a2e1a' }] },
          { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#041208' }] },
          { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        ],
      })

      const query = [address, city, 'CA'].filter(Boolean).join(', ')
      const geocoder = new google.maps.Geocoder()
      geocoder.geocode({ address: query }, (results: any, status: any) => {
        if (status !== 'OK' || !results[0]) return
        const pos = results[0].geometry.location
        mapInstance.current.setCenter(pos)
        new google.maps.Marker({
          position: pos,
          map: mapInstance.current,
          icon: {
            url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
              '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">' +
              '<path d="M14 0C6.268 0 0 6.268 0 14c0 8.75 14 22 14 22s14-13.25 14-22C28 6.268 21.732 0 14 0z" fill="#ffd222" stroke="#0a1208" stroke-width="1.5"/>' +
              '<circle cx="14" cy="14" r="5" fill="#0a1208"/>' +
              '</svg>'
            )}`,
            scaledSize: new google.maps.Size(28, 36),
            anchor: new google.maps.Point(14, 36),
          },
        })
      })
    }

    if ((window as any).google?.maps) {
      init()
    } else {
      loadGoogleMaps(() => setTimeout(init, 100))
    }
  }, [address, city])

  if (!MAPS_API_KEY || (!address && !city)) return null

  return (
    <div
      ref={mapRef}
      style={{ height: 180, width: '100%', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,.1)' }}
    />
  )
}

// ── Detail Modal ──────────────────────────────────────────────────────────────
function DetailModal({
  req,
  onClose,
  onConvert,
  onDismiss,
  converting,
  dismissing,
}: {
  req: PortalRequest
  onClose: () => void
  onConvert: () => void
  onDismiss: () => void
  converting: boolean
  dismissing: boolean
}) {
  const fileUrls = parseFileUrls(req.notes)
  const imageUrls = fileUrls.filter(isImageUrl)
  const docUrls = fileUrls.filter(u => !isImageUrl(u))

  // Parse notes for company / ideal date
  const notesText = req.notes ?? ''
  const companyMatch = notesText.match(/Company:\s*([^|]+)/)
  const idealDateMatch = notesText.match(/Ideal date:\s*([^|]+)/)
  const company = companyMatch?.[1]?.trim()
  const idealDate = idealDateMatch?.[1]?.trim()

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,.75)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-amber-700/40 bg-gray-950"
        style={{ boxShadow: '0 40px 100px rgba(0,0,0,.6)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-800 sticky top-0 bg-gray-950 z-10">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-lg font-bold text-white">{req.name}</span>
              <span className="px-2 py-0.5 rounded bg-amber-800/60 text-amber-300 text-[10px] font-bold uppercase">
                {TYPE_LABELS[req.request_type] ?? req.request_type}
              </span>
              {req.service_category && (
                <span className="px-2 py-0.5 rounded bg-gray-800 text-gray-400 text-[10px]">
                  {CATEGORY_LABELS[req.service_category] ?? req.service_category}
                </span>
              )}
              <span className="px-2 py-0.5 rounded bg-yellow-900/40 text-yellow-300 text-[10px] font-bold">
                ⚡ INBOUND
              </span>
            </div>
            <div className="text-sm text-gray-500 mt-1">
              Submitted {new Date(req.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors ml-4 flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-4 space-y-5">
          {/* Contact */}
          <div>
            <div className="text-[10px] font-bold text-amber-400 uppercase tracking-widest mb-2">Contact</div>
            <div className="space-y-1.5">
              {req.phone && (
                <div className="flex items-center gap-2 text-base text-gray-300">
                  <Phone size={13} className="text-gray-500 flex-shrink-0" />
                  <a href={`tel:${req.phone.replace(/\D/g, '')}`} className="hover:text-white">{req.phone}</a>
                </div>
              )}
              {req.email && (
                <div className="flex items-center gap-2 text-base text-gray-300">
                  <Mail size={13} className="text-gray-500 flex-shrink-0" />
                  <a href={`mailto:${req.email}`} className="hover:text-white">{req.email}</a>
                </div>
              )}
              {company && (
                <div className="flex items-center gap-2 text-base text-gray-300">
                  <span className="text-gray-500 text-xs flex-shrink-0">🏢</span>
                  <span>{company}</span>
                </div>
              )}
            </div>
          </div>

          {/* Location + Mini Map */}
          {(req.address || req.city) && (
            <div>
              <div className="text-[10px] font-bold text-amber-400 uppercase tracking-widest mb-2">Service Location</div>
              <div className="flex items-start gap-2 text-base text-gray-300 mb-3">
                <MapPin size={13} className="text-gray-500 flex-shrink-0 mt-0.5" />
                <div>
                  {req.address && <div>{req.address}</div>}
                  {req.city && <div>{req.city}, CA</div>}
                </div>
                <a
                  href={`https://maps.google.com/?q=${encodeURIComponent([req.address, req.city, 'CA'].filter(Boolean).join(', '))}`}
                  target="_blank" rel="noopener noreferrer"
                  className="ml-auto flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300"
                >
                  <ExternalLink size={11} /> Open Maps
                </a>
              </div>
              <MiniMap address={req.address} city={req.city} />
            </div>
          )}

          {/* Service Details */}
          <div>
            <div className="text-[10px] font-bold text-amber-400 uppercase tracking-widest mb-2">Service Details</div>
            <div className="space-y-1.5">
              {req.preferred_date && (
                <div className="flex items-center gap-2 text-base text-gray-300">
                  <Calendar size={13} className="text-gray-500 flex-shrink-0" />
                  <span>{req.preferred_date}</span>
                  {idealDate && idealDate !== req.preferred_date && (
                    <span className="text-gray-500 text-xs">· Ideal: {idealDate}</span>
                  )}
                </div>
              )}
              {idealDate && !req.preferred_date && (
                <div className="flex items-center gap-2 text-base text-gray-300">
                  <Calendar size={13} className="text-gray-500 flex-shrink-0" />
                  <span>Ideal date: {idealDate}</span>
                </div>
              )}
              {req.preferred_time && (
                <div className="flex items-center gap-2 text-base text-gray-300">
                  <Clock size={13} className="text-gray-500 flex-shrink-0" />
                  <span>{req.preferred_time}</span>
                </div>
              )}
            </div>
          </div>

          {/* Description */}
          {req.description && (
            <div>
              <div className="text-[10px] font-bold text-amber-400 uppercase tracking-widest mb-2">Description</div>
              <p className="text-base text-gray-300 leading-relaxed whitespace-pre-wrap">{req.description}</p>
            </div>
          )}

          {/* Images */}
          {imageUrls.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-amber-400 uppercase tracking-widest mb-2">
                Photos / Videos ({imageUrls.length})
              </div>
              <div className="grid grid-cols-3 gap-2">
                {imageUrls.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block rounded-lg overflow-hidden border border-gray-800 hover:border-amber-700/50 transition-colors">
                    <img src={url} alt={`Upload ${i + 1}`} className="w-full h-24 object-cover" loading="lazy" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Documents */}
          {docUrls.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-amber-400 uppercase tracking-widest mb-2">
                Documents ({docUrls.length})
              </div>
              <div className="space-y-1.5">
                {docUrls.map((url, i) => (
                  <a
                    key={i} href={url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 hover:border-amber-700/40 transition-colors text-base text-gray-300 hover:text-white"
                  >
                    {isPdfUrl(url) ? <FileText size={13} className="text-red-400 flex-shrink-0" /> : <Image size={13} className="text-blue-400 flex-shrink-0" />}
                    <span className="truncate flex-1">{getFileName(url)}</span>
                    <ExternalLink size={11} className="text-gray-600 flex-shrink-0" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-gray-800 flex items-center gap-3 sticky bottom-0 bg-gray-950">
          <button
            type="button"
            onClick={onConvert}
            disabled={converting || dismissing}
            className={clsx(
              'flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-colors flex-1 justify-center',
              converting
                ? 'bg-emerald-900 text-emerald-400 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            )}
          >
            {converting ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
            {converting ? 'Converting…' : 'Convert to Lead'}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            disabled={converting || dismissing}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-base text-gray-400 hover:text-white hover:bg-gray-800 transition-colors border border-gray-700"
          >
            {dismissing ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function PortalInbox({ onLeadConverted }: PortalInboxProps) {
  const [requests, setRequests] = useState<PortalRequest[]>([])
  const [expanded, setExpanded] = useState(true)
  const [converting, setConverting] = useState<string | null>(null)
  const [dismissing, setDismissing] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedReq, setSelectedReq] = useState<PortalRequest | null>(null)

  const load = useCallback(async () => {
    const rows = await fetchNewPortalRequests()
    setRequests(rows)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 60_000)
    return () => clearInterval(interval)
  }, [load])

  const handleConvert = async (req: PortalRequest) => {
    if (converting) return  // block any second click
    setConverting(req.id)
    setSelectedReq(null)   // close modal immediately
    try {
      const leadId = await convertToLead(req)
      if (leadId) {
        setRequests(prev => prev.filter(r => r.id !== req.id))
        onLeadConverted?.()
      } else {
        alert('Conversion failed — check console for details.')
        setRequests(prev => prev)  // re-show on failure
      }
    } finally {
      setConverting(null)
    }
  }

  const handleDismiss = async (req: PortalRequest) => {
    setDismissing(req.id)
    try {
      await dismissPortalRequest(req.id)
      setRequests(prev => prev.filter(r => r.id !== req.id))
      setSelectedReq(null)
    } finally {
      setDismissing(null)
    }
  }

  if (!loading && requests.length === 0) return null

  return (
    <>
      <div className="border border-amber-700/50 rounded-lg overflow-hidden bg-amber-950/30 mb-4">
        {/* Header */}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between px-4 py-2.5 bg-amber-900/40 hover:bg-amber-900/60 transition-colors text-left"
        >
          <div className="flex items-center gap-2">
            <Globe size={13} className="text-amber-400" />
            <span className="text-xs font-bold text-amber-200 uppercase tracking-wide">Portal Inbox</span>
            {loading ? (
              <Loader2 size={11} className="animate-spin text-amber-400" />
            ) : (
              <span className="px-1.5 py-0.5 rounded-full bg-amber-500 text-black text-[10px] font-bold">
                {requests.length}
              </span>
            )}
          </div>
          {expanded ? <ChevronUp size={13} className="text-amber-400" /> : <ChevronDown size={13} className="text-amber-400" />}
        </button>

        {/* Rows */}
        {expanded && !loading && (
          <div className="divide-y divide-amber-900/40">
            {requests.map((req) => (
              <button
                key={req.id}
                type="button"
                onClick={() => setSelectedReq(req)}
                className="w-full px-4 py-3 text-left hover:bg-amber-900/20 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-base font-semibold text-white">{req.name}</span>
                      <span className="px-1.5 py-0.5 rounded bg-amber-800/60 text-amber-300 text-[10px] font-bold uppercase">
                        {TYPE_LABELS[req.request_type] ?? req.request_type}
                      </span>
                      {req.service_category && (
                        <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 text-[10px]">
                          {CATEGORY_LABELS[req.service_category] ?? req.service_category}
                        </span>
                      )}
                      {parseFileUrls(req.notes).length > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-300 text-[10px]">
                          📎 {parseFileUrls(req.notes).length} file{parseFileUrls(req.notes).length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {req.phone && <span className="text-sm text-gray-400">{req.phone}</span>}
                      {req.city && <span className="text-sm text-gray-500">{req.city}</span>}
                      {req.preferred_date && <span className="text-sm text-gray-500">📅 {req.preferred_date}</span>}
                    </div>
                    {req.description && (
                      <p className="text-sm text-gray-400 mt-1 line-clamp-1">{req.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[10px] text-gray-600">
                      {new Date(req.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                    <span className="text-xs text-amber-400">View →</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedReq && (
        <DetailModal
          req={selectedReq}
          onClose={() => setSelectedReq(null)}
          onConvert={() => handleConvert(selectedReq)}
          onDismiss={() => handleDismiss(selectedReq)}
          converting={converting === selectedReq.id}
          dismissing={dismissing === selectedReq.id}
        />
      )}
    </>
  )
}

export default PortalInbox
