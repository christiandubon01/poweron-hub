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
import { supabase } from '@/lib/supabase'
import {
  parseAttachmentPaths,
  fetchAttachmentSignedUrls,
  isImagePath,
  isVideoPath,
  isPdfPath,
  getAttachmentDisplayName,
  type AttachmentEntry,
} from '@/services/portal/portalStorageService'
import { ChevronDown, ChevronUp, Loader2, Globe, X, ArrowRight, MapPin, Phone, Mail, Calendar, Clock, FileText, Image, ExternalLink } from 'lucide-react'
import clsx from 'clsx'
import {
  fetchNewPortalRequests,
  convertToLead,
  dismissPortalRequest,
  type PortalRequest,
} from '@/services/portal/portalService'
import { isHunterTenantAuthorityError } from '@/services/hunter/resolveHunterTenantId'
import {
  fetchReferralClaimForRequest,
  findReferralCandidates,
  resolveReferralClaim,
  unresolveReferralClaim,
  markReferralClaimAmbiguous,
  type ReferralClaim,
  type ReferralCandidate,
} from '@/services/referral/referralService'
import { GOOGLE_MAPS_BROWSER_KEY, loadV15rGoogleMapsScript } from '@/utils/googleMapsLoader'

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

// SEC-0S: Attachment parsing and signed URL display is handled by portalStorageService.
// parseAttachmentPaths, isImagePath, isPdfPath, getAttachmentDisplayName, getSignedReadUrls
// are imported above.  The old parseFileUrls / isImageUrl / isPdfUrl / getFileName helpers
// have been removed — they generated permanent public URLs which no longer work after
// the portal-uploads bucket was made private.

// ── Mini map component ────────────────────────────────────────────────────────
function loadGoogleMaps(cb: () => void) {
  void loadV15rGoogleMapsScript().then(cb).catch(() => {})
}

function MiniMap({ address, city }: { address: string | null; city: string | null }) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<any>(null)

  useEffect(() => {
    if (!GOOGLE_MAPS_BROWSER_KEY || (!address && !city)) return

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

  if (!GOOGLE_MAPS_BROWSER_KEY || (!address && !city)) return null

  return (
    <div
      ref={mapRef}
      style={{ height: 180, width: '100%', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,.1)' }}
    />
  )
}

// ── Referral claim section ────────────────────────────────────────────────────
function ReferralClaimSection({ claim }: { claim: ReferralClaim }) {
  const [reviewOpen, setReviewOpen] = useState(false)
  const [candidates, setCandidates] = useState<ReferralCandidate[]>([])
  const [confidence, setConfidence] = useState<'suggestion' | 'ambiguous' | 'unresolved'>('unresolved')
  const [searching, setSearching] = useState(false)
  const [currentClaim, setCurrentClaim] = useState<ReferralClaim>(claim)
  const [actionError, setActionError] = useState<string | null>(null)

  const statusColor: Record<string, string> = {
    unresolved: 'bg-gray-800 text-gray-400',
    resolved:   'bg-emerald-900/60 text-emerald-400',
    ambiguous:  'bg-yellow-900/40 text-yellow-400',
  }

  const openReview = async () => {
    setReviewOpen(true)
    setSearching(true)
    setActionError(null)
    try {
      const result = await findReferralCandidates(currentClaim.raw_referral_text)
      setCandidates(result.candidates)
      setConfidence(result.confidence)
    } catch {
      setCandidates([])
      setConfidence('unresolved')
    } finally {
      setSearching(false)
    }
  }

  const confirm = async (c: ReferralCandidate) => {
    setActionError(null)
    try {
      await resolveReferralClaim(currentClaim.id, c.type === 'client' ? { client_id: c.id } : { lead_id: c.id })
      setCurrentClaim(prev => ({
        ...prev,
        resolution_status: 'resolved',
        resolved_client_id: c.type === 'client' ? c.id : null,
        resolved_lead_id: c.type === 'lead' ? c.id : null,
      }))
      setReviewOpen(false)
    } catch (e: any) {
      setActionError(e.message ?? 'Failed to resolve')
    }
  }

  const unlink = async () => {
    setActionError(null)
    try {
      await unresolveReferralClaim(currentClaim.id)
      setCurrentClaim(prev => ({
        ...prev,
        resolution_status: 'unresolved',
        resolved_client_id: null,
        resolved_lead_id: null,
      }))
      setReviewOpen(false)
    } catch (e: any) {
      setActionError(e.message ?? 'Failed to unlink')
    }
  }

  const markAmbiguous = async () => {
    setActionError(null)
    try {
      await markReferralClaimAmbiguous(currentClaim.id)
      setCurrentClaim(prev => ({ ...prev, resolution_status: 'ambiguous', resolved_client_id: null, resolved_lead_id: null }))
      setReviewOpen(false)
    } catch (e: any) {
      setActionError(e.message ?? 'Failed')
    }
  }

  const resolvedLabel = currentClaim.resolved_client_id
    ? `Client confirmed`
    : currentClaim.resolved_lead_id
    ? `Lead confirmed`
    : null

  return (
    <div className="rounded-lg bg-gray-900 border border-gray-800 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm text-gray-200 italic flex-1">"{currentClaim.raw_referral_text}"</span>
        <span className={clsx('text-[10px] font-bold uppercase px-1.5 py-0.5 rounded flex-shrink-0', statusColor[currentClaim.resolution_status])}>
          {currentClaim.resolution_status}
        </span>
      </div>

      {currentClaim.resolution_status === 'resolved' && resolvedLabel && (
        <div className="text-xs text-emerald-400">{resolvedLabel}</div>
      )}

      {actionError && <div className="text-xs text-red-400">{actionError}</div>}

      <div className="flex items-center gap-2 pt-1">
        {currentClaim.resolution_status !== 'resolved' && (
          <button
            type="button"
            onClick={reviewOpen ? undefined : openReview}
            className="text-xs px-2.5 py-1 rounded bg-amber-800/50 text-amber-300 hover:bg-amber-700/60 transition-colors"
          >
            Find Match
          </button>
        )}
        {currentClaim.resolution_status === 'resolved' && (
          <button
            type="button"
            onClick={unlink}
            className="text-xs px-2.5 py-1 rounded bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
          >
            Unlink
          </button>
        )}
        {currentClaim.resolution_status === 'unresolved' && (
          <button
            type="button"
            onClick={markAmbiguous}
            className="text-xs px-2.5 py-1 rounded bg-gray-800 text-gray-400 hover:text-yellow-400 hover:bg-gray-700 transition-colors"
          >
            Mark Ambiguous
          </button>
        )}
      </div>

      {reviewOpen && (
        <div className="mt-2 space-y-2 border-t border-gray-800 pt-2">
          {searching ? (
            <div className="text-xs text-gray-500 italic">Searching…</div>
          ) : candidates.length === 0 ? (
            <div className="text-xs text-gray-500">No exact match found in clients or leads.</div>
          ) : (
            <>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">
                {confidence === 'suggestion' ? 'Suggested match' : `${candidates.length} candidates — confirm one`}
              </div>
              {candidates.map((c, i) => (
                <div key={i} className="flex items-center justify-between gap-2 rounded bg-gray-800 px-2.5 py-2">
                  <div className="min-w-0">
                    <div className="text-sm text-gray-200 truncate">{c.display_name}</div>
                    <div className="text-[10px] text-gray-500">
                      {c.type === 'client' ? 'Client' : 'Lead'} · matched by {c.match_reason}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => confirm(c)}
                    className="text-xs px-2.5 py-1 rounded bg-emerald-800/60 text-emerald-300 hover:bg-emerald-700/60 transition-colors flex-shrink-0"
                  >
                    Confirm
                  </button>
                </div>
              ))}
            </>
          )}
          <button
            type="button"
            onClick={() => setReviewOpen(false)}
            className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
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
  // SEC-0S R1: Signed read URLs are generated by the server endpoint (portal-attachment-read)
  // using the owner's authenticated JWT.  The browser never calls Storage signing APIs.
  // Both old "Files: URL" and new "FilePaths: path" note formats are handled server-side.
  const [signedEntries, setSignedEntries] = useState<AttachmentEntry[]>([])
  const [loadingAttachments, setLoadingAttachments] = useState(false)

  // LEAD-SRC-4B: referral claim for this portal request
  const [referralClaim, setReferralClaim] = useState<ReferralClaim | null>(null)
  const [loadingClaim, setLoadingClaim] = useState(true)

  useEffect(() => {
    // Quick client-side check: skip the server call when notes have no attachment markers
    if (!req.notes || (!req.notes.includes('FilePaths:') && !req.notes.includes('Files:'))) {
      setSignedEntries([])
      return
    }
    setLoadingAttachments(true)

    // Get the owner's JWT from the current authenticated session
    supabase.auth.getSession().then(({ data }) => {
      const jwt = data.session?.access_token ?? undefined
      return fetchAttachmentSignedUrls(req.id, jwt)
    }).then(setSignedEntries)
      .catch(() => setSignedEntries([]))
      .finally(() => setLoadingAttachments(false))
  }, [req.id, req.notes])

  useEffect(() => {
    setLoadingClaim(true)
    fetchReferralClaimForRequest(req.id)
      .then(c => setReferralClaim(c))
      .catch(() => setReferralClaim(null))
      .finally(() => setLoadingClaim(false))
  }, [req.id])

  const mediaEntries = signedEntries.filter(({ mimeType }) => mimeType?.startsWith('image/') || mimeType?.startsWith('video/'))
  const docEntries   = signedEntries.filter(({ mimeType }) => !mimeType?.startsWith('image/') && !mimeType?.startsWith('video/'))

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

          {/* Referral — LEAD-SRC-4B */}
          {(loadingClaim || referralClaim) && (
            <div>
              <div className="text-[10px] font-bold text-amber-400 uppercase tracking-widest mb-2">Referred By</div>
              {loadingClaim ? (
                <div className="text-xs text-gray-500 italic">Loading…</div>
              ) : referralClaim ? (
                <ReferralClaimSection claim={referralClaim} />
              ) : null}
            </div>
          )}

          {/* Photos / Videos — signed short-lived URLs from private storage */}
          {(loadingAttachments || mediaEntries.length > 0) && (
            <div>
              <div className="text-[10px] font-bold text-amber-400 uppercase tracking-widest mb-2">
                Photos / Videos {!loadingAttachments && `(${mediaEntries.length})`}
              </div>
              {loadingAttachments ? (
                <div className="text-xs text-gray-500 italic">Loading attachments…</div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {mediaEntries.map(({ displayName, mimeType, signedUrl }, i) =>
                    signedUrl ? (
                      <a key={i} href={signedUrl} target="_blank" rel="noopener noreferrer"
                        className="block rounded-lg overflow-hidden border border-gray-800 hover:border-amber-700/50 transition-colors">
                        {mimeType?.startsWith('video/') ? (
                          <video src={signedUrl} className="w-full h-24 object-cover" preload="metadata" />
                        ) : (
                          <img src={signedUrl} alt={displayName} className="w-full h-24 object-cover" loading="lazy" />
                        )}
                      </a>
                    ) : (
                      <div key={i} className="rounded-lg bg-gray-900 border border-gray-800 h-24 flex items-center justify-center text-gray-600 text-xs">
                        Unavailable
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          )}

          {/* Documents — signed short-lived URLs from private storage */}
          {!loadingAttachments && docEntries.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-amber-400 uppercase tracking-widest mb-2">
                Documents ({docEntries.length})
              </div>
              <div className="space-y-1.5">
                {docEntries.map(({ displayName, mimeType, signedUrl }, i) =>
                  signedUrl ? (
                    <a
                      key={i} href={signedUrl} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 hover:border-amber-700/40 transition-colors text-base text-gray-300 hover:text-white"
                    >
                      {mimeType === 'application/pdf' ? <FileText size={13} className="text-red-400 flex-shrink-0" /> : <Image size={13} className="text-blue-400 flex-shrink-0" />}
                      <span className="truncate flex-1">{displayName}</span>
                      <ExternalLink size={11} className="text-gray-600 flex-shrink-0" />
                    </a>
                  ) : (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-base text-gray-600">
                      {mimeType === 'application/pdf' ? <FileText size={13} className="text-gray-700 flex-shrink-0" /> : <Image size={13} className="text-gray-700 flex-shrink-0" />}
                      <span className="truncate flex-1">{displayName}</span>
                      <span className="text-xs ml-auto">Unavailable</span>
                    </div>
                  )
                )}
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
    } catch (err) {
      if (isHunterTenantAuthorityError(err)) {
        const message =
          err.code === 'hunter_tenant_unmapped'
            ? 'Conversion blocked: this organization has no Hunter tenant mapping. Map organizations.hunter_tenant_id before converting portal requests.'
            : err.code === 'hunter_tenant_membership_missing'
              ? 'Conversion blocked: you do not have Hunter tenant membership for this organization mapped tenant.'
              : err.message
        alert(message)
      } else {
        alert('Conversion failed — check console for details.')
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
                      {parseAttachmentPaths(req.notes).length > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-300 text-[10px]">
                          📎 {parseAttachmentPaths(req.notes).length} file{parseAttachmentPaths(req.notes).length > 1 ? 's' : ''}
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
