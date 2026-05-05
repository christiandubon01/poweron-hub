/**
 * HunterMap — Google Maps view of all geocoded HUNTER leads.
 *
 * Pin color reflects score tier: Hot (red), Warm (amber), Cool (blue),
 * Archived/Cold (gray). Home base shown as a distinct emerald star pin.
 *
 * Click a pin → InfoWindow with name/score/distance/permit#/Open button.
 * Click Open → onLeadSelect callback fires with the lead id (HunterPanel
 * scrolls and highlights the matching card).
 *
 * HUNTER-MAP-VIEW-APR28-2026-1
 */

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { GoogleMap, useJsApiLoader, MarkerF, InfoWindowF } from '@react-google-maps/api'
import { supabase } from '@/lib/supabase'
import type { HunterLead } from './HunterLeadCard'

const GOOGLE_MAPS_API_KEY = (import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY as string) ?? ''

const containerStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
}

// Coachella Valley fallback center if home base isn't set
const FALLBACK_CENTER = { lat: 33.7425, lng: -116.3089 }

interface HunterMapProps {
  leads: HunterLead[]
  onLeadSelect: (leadId: string) => void
}

interface HomeBase {
  lat: number
  lng: number
  formatted_address: string
}

function pinColorForScore(score: number): string {
  if (score >= 85) return '#ef4444'        // Hot - red
  if (score >= 60) return '#f59e0b'        // Warm - amber
  if (score >= 40) return '#3b82f6'        // Cool - blue
  return '#6b7280'                          // Archived/cold - gray
}

function pinSymbol(color: string): google.maps.Symbol {
  return {
    path: 'M 0,-1 C -0.55,-1 -1,-0.55 -1,0 C -1,0.85 0,2 0,2 C 0,2 1,0.85 1,0 C 1,-0.55 0.55,-1 0,-1 Z',
    fillColor: color,
    fillOpacity: 1,
    strokeColor: '#0f1117',
    strokeWeight: 0.2,
    scale: 14,
    anchor: new google.maps.Point(0, 2),
  }
}

function homeBaseSymbol(): google.maps.Symbol {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    fillColor: '#10b981',
    fillOpacity: 1,
    strokeColor: '#ffffff',
    strokeWeight: 2,
    scale: 10,
  }
}

export function HunterMap({ leads, onLeadSelect }: HunterMapProps) {
  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
  })

  const [homeBase, setHomeBase] = useState<HomeBase | null>(null)
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [routeLeadId, setRouteLeadId] = useState<string | null>(null)
  const routeLeadIdRef = useRef<string | null>(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const polylineRef = useRef<google.maps.Polyline[]>([])
  const mapRef = useRef<google.maps.Map | null>(null)

  const clearRoute = useCallback(() => {
    if ((polylineRef as any).cleanupFn) {
      (polylineRef as any).cleanupFn()
      ;(polylineRef as any).cleanupFn = null
    } else {
      polylineRef.current.forEach(p => p.setMap(null))
    }
    polylineRef.current = []
    setRouteLeadId(null)
    routeLeadIdRef.current = null
  }, [])

  const drawRoute = useCallback((leadLat: number, leadLng: number, leadId: string) => {
    if (!homeBase || !mapRef.current) return
    if (routeLeadIdRef.current === leadId) { clearRoute(); return }
    clearRoute()
    setRouteLoading(true)
    const service = new google.maps.DirectionsService()
    service.route({
      origin: { lat: homeBase.lat, lng: homeBase.lng },
      destination: { lat: leadLat, lng: leadLng },
      travelMode: google.maps.TravelMode.DRIVING,
    }, (result, status) => {
      setRouteLoading(false)
      if (status === 'OK' && result) {
        const route = result.routes[0]
        if (!route) return

        // Decode full path from overview_polyline
        const fullPath: google.maps.LatLng[] = []
        for (const leg of route.legs) {
          for (const step of leg.steps) {
            const pts = step.path ?? []
            fullPath.push(...pts)
          }
        }
        if (fullPath.length === 0) return

        // Fit map to show full route with padding
        const bounds = new google.maps.LatLngBounds()
        fullPath.forEach(p => bounds.extend(p))
        mapRef.current!.fitBounds(bounds, { top: 80, right: 60, bottom: 80, left: 60 })

        // Draw glowing base line
        const glowLine = new google.maps.Polyline({
          path: fullPath,
          geodesic: true,
          strokeColor: '#1e40af',
          strokeOpacity: 0.3,
          strokeWeight: 5,
          map: mapRef.current!,
        })

        // Animated dashed line
        const baseLine = new google.maps.Polyline({
          path: fullPath,
          geodesic: true,
          strokeColor: 'transparent',
          strokeOpacity: 0,
          strokeWeight: 0,
          icons: [{
            icon: {
              path: 'M 0,-1 0,1',
              strokeOpacity: 1,
              strokeColor: '#60a5fa',
              strokeWeight: 3,
              scale: 3,
            },
            offset: '0%',
            repeat: '16px',
          }],
          map: mapRef.current!,
        })

        // Truck + Lightning SVG marker
        const makeTruckIcon = (heading: number) => {
          const svg = [
            '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">',
            '<g transform="rotate(' + heading + ', 24, 24)">',
            '<circle cx="24" cy="24" r="22" fill="rgba(96,165,250,0.15)" stroke="#60a5fa" stroke-width="1.5"/>',
            '<rect x="10" y="18" width="28" height="14" rx="3" fill="#1e3a8a" stroke="#60a5fa" stroke-width="1.5"/>',
            '<rect x="26" y="14" width="12" height="10" rx="2" fill="#1e40af" stroke="#93c5fd" stroke-width="1.2"/>',
            '<rect x="27" y="15" width="10" height="6" rx="1" fill="#bfdbfe" opacity="0.6"/>',
            '<circle cx="15" cy="33" r="3.5" fill="#0f172a" stroke="#60a5fa" stroke-width="1.5"/>',
            '<circle cx="33" cy="33" r="3.5" fill="#0f172a" stroke="#60a5fa" stroke-width="1.5"/>',
            '<circle cx="15" cy="33" r="1.5" fill="#60a5fa"/>',
            '<circle cx="33" cy="33" r="1.5" fill="#60a5fa"/>',
            '<text x="19" y="29" text-anchor="middle" font-size="12" fill="#facc15" font-family="Arial" font-weight="bold">&#9889;</text>',
            '<circle cx="38" cy="19" r="2" fill="#fef08a" opacity="0.9"/>',
            '<circle cx="38" cy="27" r="2" fill="#fef08a" opacity="0.9"/>',
            '<line x1="8" y1="21" x2="2" y2="21" stroke="#60a5fa" stroke-width="1.5" opacity="0.6"/>',
            '<line x1="8" y1="24" x2="1" y2="24" stroke="#60a5fa" stroke-width="2" opacity="0.8"/>',
            '<line x1="8" y1="27" x2="2" y2="27" stroke="#60a5fa" stroke-width="1.5" opacity="0.6"/>',
            '</g></svg>',
          ].join('')
          return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg)
        }

        // Pre-cache truck icons at 36 headings (every 10 degrees) to eliminate flicker
        const truckIconCache: Record<number, string> = {}
        const getTruckIcon = (heading: number): string => {
          const snapped = Math.round(heading / 10) * 10
          if (!truckIconCache[snapped]) truckIconCache[snapped] = makeTruckIcon(snapped)
          return truckIconCache[snapped]
        }
        for (let h = 0; h < 360; h += 10) getTruckIcon(h)

        // Calculate heading between two points
        const getHeading = (from: google.maps.LatLng, to: google.maps.LatLng): number => {
          return google.maps.geometry?.spherical?.computeHeading?.(from, to) ?? 0
        }

        // Calculate angle between three points for corner detection
        const getCornerAngle = (p1: google.maps.LatLng, p2: google.maps.LatLng, p3: google.maps.LatLng): number => {
          const h1 = getHeading(p1, p2)
          const h2 = getHeading(p2, p3)
          let diff = Math.abs(h2 - h1)
          if (diff > 180) diff = 360 - diff
          return diff
        }

        // Pre-calculate corner angles for entire path
        const cornerAngles: number[] = new Array(fullPath.length).fill(0)
        for (let ci = 1; ci < fullPath.length - 1; ci++) {
          cornerAngles[ci] = getCornerAngle(fullPath[ci-1], fullPath[ci], fullPath[ci+1])
        }

        // Glow ring behind truck
        const glowRing = new google.maps.Marker({
          position: fullPath[0],
          map: mapRef.current!,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 28,
            fillColor: '#60a5fa',
            fillOpacity: 0,
            strokeColor: '#60a5fa',
            strokeWeight: 3,
            strokeOpacity: 0.4,
          },
          zIndex: 998,
        })

        // Traveling marker
        const dotMarker = new google.maps.Marker({
          position: fullPath[0],
          map: mapRef.current!,
          icon: {
            url: getTruckIcon(0),
            scaledSize: new google.maps.Size(48, 48),
            anchor: new google.maps.Point(24, 24),
          },
          zIndex: 999,
        })

        // Rubber burn effect — smoke puff at sharp corners
        const rubberMarkers: google.maps.Marker[] = []
        const addRubberBurn = (pos: google.maps.LatLng) => {
          const smoke = new google.maps.Marker({
            position: pos,
            map: mapRef.current!,
            icon: {
              url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">' +
                '<circle cx="20" cy="20" r="16" fill="rgba(100,100,100,0.5)"/>' +
                '<circle cx="14" cy="16" r="8" fill="rgba(80,80,80,0.4)"/>' +
                '<circle cx="26" cy="18" r="10" fill="rgba(60,60,60,0.35)"/>' +
                '<text x="20" y="25" text-anchor="middle" font-size="14" opacity="0.8">&#128168;</text>' +
                '</svg>'
              ),
              scaledSize: new google.maps.Size(40, 40),
              anchor: new google.maps.Point(20, 20),
            },
            zIndex: 997,
          })
          rubberMarkers.push(smoke)
          // Fade out after 1.5s
          setTimeout(() => {
            smoke.setMap(null)
            const idx = rubberMarkers.indexOf(smoke)
            if (idx > -1) rubberMarkers.splice(idx, 1)
          }, 1500)
        }

        // Total distance for speed calc
        const totalDistM = route.legs.reduce((s: number, l: any) => s + l.distance.value, 0)
        const metersPerStep = totalDistM / Math.max(1, fullPath.length)

        // Animation state
        let dashOffset = 0
        let step2 = 0
        let animFrame: number
        let lastRubberStep = -30
        let smoothHeading = 0
        let msg25shown = false
        let msg50shown = false
        let msgArrivalShown = false

        const showMilestoneMsg = (text: string, pos: google.maps.LatLng, color: string) => {
          const marker = new google.maps.Marker({
            position: pos,
            map: mapRef.current!,
            icon: {
              url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="36" viewBox="0 0 160 36">' +
                '<rect x="0" y="0" width="160" height="36" rx="8" fill="rgba(4,8,24,0.95)" stroke="' + color + '" stroke-width="2"/>' +
                '<text x="80" y="23" text-anchor="middle" font-size="13" font-weight="bold" fill="' + color + '" font-family="monospace">' + text + '</text>' +
                '</svg>'
              ),
              scaledSize: new google.maps.Size(160, 36),
              anchor: new google.maps.Point(80, 90),
            },
            zIndex: 1001,
          })
          setTimeout(() => marker.setMap(null), 4000)
        }

        const animate = () => {
          // Look ahead 2 steps for stable angle detection

          // Target travel times: 0-20mi=7s, 20-40mi=8s, 40+mi=10s
          const distMiles = totalDistM * 0.000621371
          const targetSeconds = distMiles <= 20 ? 7 : distMiles <= 40 ? 8 : 10
          // Base steps per frame to hit target time at 60fps
          const totalFrames = targetSeconds * 60
          const baseStepsPerFrame = fullPath.length / totalFrames
          // Corner detection — use wider window for stability
          const lookAhead = Math.min(step2 + 5, fullPath.length - 1)
          const lookBehind = Math.max(step2 - 5, 0)
          const angleWindow = getCornerAngle(fullPath[lookBehind], fullPath[step2], fullPath[lookAhead])
          const isSharpCorner = angleWindow > 80
          // Sharp corners slow to 30% of base speed
          const stepsThisFrame = Math.max(1, Math.round(isSharpCorner ? baseStepsPerFrame * 0.3 : baseStepsPerFrame))
          // Current speed in mph for display
          const currentMph = Math.round((stepsThisFrame * metersPerStep * 60) / 0.44704)

          // Milestone messages at 25% and 50%
          const progress = step2 / fullPath.length
          if (progress >= 0.25 && !msg25shown) {
            msg25shown = true
            showMilestoneMsg('⛽ Gas / Red Bull?', fullPath[step2], '#fb923c')
          }
          if (progress >= 0.50 && !msg50shown) {
            msg50shown = true
            showMilestoneMsg('🔧 Material?', fullPath[step2], '#c084fc')
          }
          if (progress >= 0.98 && !msgArrivalShown) {
            msgArrivalShown = true
            showMilestoneMsg('&#9889; Power On &#x1F4B0;', fullPath[step2], '#facc15')
          }
          if (progress >= 0.98 && !msg50shown) {
            showMilestoneMsg('⚡ Power On 💰', fullPath[step2], '#facc15')
          }

          // Rubber burn on sharp corners
          if (isSharpCorner && step2 - lastRubberStep > 25) {
            addRubberBurn(fullPath[step2])
            lastRubberStep = step2
          }

          // Advance position
          step2 = (step2 + stepsThisFrame) % fullPath.length

          // Smooth heading — look 3 steps ahead for stability
          const headingLook = Math.min(step2 + 3, fullPath.length - 1)
          const rawHeading = getHeading(fullPath[step2], fullPath[headingLook])

          // Smooth heading interpolation to prevent zig-zag
          let diff = rawHeading - smoothHeading
          if (diff > 180) diff -= 360
          if (diff < -180) diff += 360
          smoothHeading += diff * 0.3
          if (smoothHeading < 0) smoothHeading += 360
          if (smoothHeading >= 360) smoothHeading -= 360

          // Update truck — always update position, throttle icon to every 8 degrees
          dotMarker.setPosition(fullPath[step2])
          glowRing.setPosition(fullPath[step2])
          const glowPulse = 0.2 + Math.abs(Math.sin(Date.now() / 300)) * 0.4
          glowRing.setIcon({
            path: google.maps.SymbolPath.CIRCLE,
            scale: isSharpCorner ? 20 : 28,
            fillColor: '#60a5fa',
            fillOpacity: 0,
            strokeColor: isSharpCorner ? '#f97316' : '#60a5fa',
            strokeWeight: 3,
            strokeOpacity: glowPulse,
          })
          const lastH = (dotMarker as any)._lastH ?? -999
          if (Math.abs(smoothHeading - lastH) > 8) {
            // Google Maps heading: 0=North(up), 90=East(right)
            // SVG truck faces right by default → add 90 to align North=up
            dotMarker.setIcon({
              url: getTruckIcon(Math.round(smoothHeading + 90) % 360),
              scaledSize: new google.maps.Size(48, 48),
              anchor: new google.maps.Point(24, 24),
            })
            ;(dotMarker as any)._lastH = smoothHeading
          }

          // Constant dash flow — fixed speed independent of truck speed
          dashOffset = (dashOffset - 0.75 + 1000) % 1000
          const icons = baseLine.get('icons')
          icons[0].offset = (dashOffset / 10) + '%'
          baseLine.set('icons', icons)

          // Pulse glow line opacity
          const pulse = 0.08 + Math.abs(Math.sin(Date.now() / 600)) * 0.1
          glowLine.setOptions({ strokeOpacity: pulse })
          speedDivRef.current.innerHTML = (isSharpCorner ? '250' : Math.round(totalDistM * 0.000621371 <= 20 ? 750 : totalDistM * 0.000621371 <= 40 ? 1000 : 2500).toLocaleString()) + ' mph'

          animFrame = requestAnimationFrame(animate)
        }
        // Source pulse rings at home base
        const pulseRings: google.maps.Marker[] = []
        for (let ri = 0; ri < 3; ri++) {
          const ring = new google.maps.Marker({
            position: fullPath[0],
            map: mapRef.current!,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 0,
              fillColor: '#60a5fa',
              fillOpacity: 0,
              strokeColor: '#60a5fa',
              strokeWeight: 2,
              strokeOpacity: 0.8,
            },
            zIndex: 998,
          })
          pulseRings.push(ring)
        }

        // Animate source pulse rings
        let pulseFrame: number
        let pulseStart = Date.now()
        const animatePulse = () => {
          const elapsed = Date.now() - pulseStart
          pulseRings.forEach((ring, i) => {
            const t = ((elapsed / 1200) + i / 3) % 1
            const scale = t * 28
            const opacity = 1 - t
            ring.setIcon({
              path: google.maps.SymbolPath.CIRCLE,
              scale,
              fillColor: '#60a5fa',
              fillOpacity: 0,
              strokeColor: '#60a5fa',
              strokeWeight: 2,
              strokeOpacity: opacity,
            })
          })
          pulseFrame = requestAnimationFrame(animatePulse)
        }
        pulseFrame = requestAnimationFrame(animatePulse)

        // Game-style "On my way" message overlay
        const msgDiv = document.createElement('div')
        msgDiv.style.cssText = 'position:absolute;top:60px;left:50%;transform:translateX(-50%);z-index:200;background:#0a1432;border:2px solid #60a5fa;border-radius:12px;padding:12px 24px;font-family:monospace;font-size:15px;font-weight:900;color:#facc15;letter-spacing:0.08em;text-align:center;white-space:nowrap;pointer-events:none;'
        msgDiv.innerHTML = '&#9889; CHRISTIAN EN LA MAMALONA IS ON HIS WAY &#9889;'
        const mapContainer = mapRef.current!.getDiv()
        mapContainer.style.position = 'relative'
        mapContainer.appendChild(msgDiv)

        // Fade out message after 4 seconds
        setTimeout(() => {
          msgDiv.style.transition = 'opacity 1s ease'
          msgDiv.style.opacity = '0'
          setTimeout(() => { if (msgDiv.parentNode) msgDiv.parentNode.removeChild(msgDiv) }, 1000)
        }, 4000)

        // Speed label
        const speedDiv = document.createElement('div')
        speedDiv.style.cssText = 'position:absolute;bottom:40px;left:16px;z-index:200;background:rgba(4,8,24,0.85);border:1px solid #60a5fa;border-radius:8px;padding:6px 12px;font-family:monospace;font-size:13px;font-weight:900;color:#60a5fa;pointer-events:none;min-width:90px;text-align:center;'
        speedDiv.innerHTML = '0 mph'
        const mapDiv = mapRef.current!.getDiv()
        mapDiv.style.position = 'relative'
        mapDiv.appendChild(speedDiv)
        const speedDivRef = { current: speedDiv }

        animFrame = requestAnimationFrame(animate)

        // Store cleanup
        const cleanup = () => {
          cancelAnimationFrame(animFrame)
          cancelAnimationFrame(pulseFrame)
          dotMarker.setMap(null)
          glowRing.setMap(null)
          baseLine.setMap(null)
          glowLine.setMap(null)
          pulseRings.forEach(r => r.setMap(null))
          rubberMarkers.forEach(r => r.setMap(null))
          if (msgDiv.parentNode) msgDiv.parentNode.removeChild(msgDiv)
          if (speedDivRef.current.parentNode) speedDivRef.current.parentNode.removeChild(speedDivRef.current)
        }

        ;(polylineRef as any).cleanupFn = cleanup
        setRouteLeadId(leadId)
        routeLeadIdRef.current = leadId
      } else {
        console.warn('[HunterMap] directions failed:', status)
      }
    })
  }, [homeBase, clearRoute])

  // Fetch home base once on mount
  useEffect(() => {
    let cancelled = false
    async function loadHomeBase() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: tenants } = await (supabase as any)
        .from('user_tenants')
        .select('tenant_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle()
      if (!tenants?.tenant_id) return
      const { data: setting } = await (supabase as any)
        .from('tenant_settings')
        .select('setting_value')
        .eq('tenant_id', tenants.tenant_id)
        .eq('setting_key', 'home_base_address')
        .maybeSingle()
      if (cancelled) return
      const value = setting?.setting_value
      if (value && typeof value.lat === 'number' && typeof value.lng === 'number') {
        setHomeBase({
          lat: value.lat,
          lng: value.lng,
          formatted_address: value.formatted_address ?? '',
        })
      }
    }
    loadHomeBase()
    return () => { cancelled = true }
  }, [])

  const activeStatuses = ['new', 'contacted', 'follow_up']
  const geocodedLeads = useMemo(
    () => leads.filter((l: any) => {
      const hasCoords = (typeof l.latitude === 'number' && typeof l.longitude === 'number') ||
                        (typeof l.lat === 'number' && typeof l.lng === 'number')
      return hasCoords && activeStatuses.includes((l as any).status ?? 'new')
    }),
    [leads]
  )
  const ungeocodedPortalLeads = useMemo(
    () => leads.filter((l: any) =>
      (l.source === 'customer_portal' || l.sourceTag === 'customer_portal') &&
      (typeof l.latitude !== 'number' || typeof l.longitude !== 'number') &&
      (l.address || l.city) &&
      activeStatuses.includes((l as any).status ?? 'new')
    ),
    [leads]
  )
  const [portalPins, setPortalPins] = useState<{ id: string; lat: number; lng: number; lead: any }[]>([])

  useEffect(() => {
    setPortalPins([])
    if (!isLoaded || ungeocodedPortalLeads.length === 0) return
    const google = (window as any).google
    if (!google?.maps) return
    const geocoder = new google.maps.Geocoder()
    ungeocodedPortalLeads.forEach((lead: any) => {
      const query = [lead.address, lead.city, 'CA'].filter(Boolean).join(', ')
      if (!query) return
      geocoder.geocode({ address: query }, (results: any, status: any) => {
        if (status !== 'OK' || !results[0]) return
        const loc = results[0].geometry.location
        setPortalPins(prev => {
          if (prev.find(p => p.id === lead.id)) return prev
          return [...prev, { id: lead.id, lat: loc.lat(), lng: loc.lng(), lead }]
        })
      })
    })
  }, [isLoaded, ungeocodedPortalLeads])

  const center = homeBase ?? FALLBACK_CENTER

  const selectedLead = useMemo(
    () => geocodedLeads.find((l: any) => l.id === selectedLeadId) ?? null,
    [geocodedLeads, selectedLeadId]
  )

  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-500 bg-gray-900 rounded">
        VITE_GOOGLE_MAPS_BROWSER_KEY not set — add it to .env.local and restart dev server.
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-red-400 bg-gray-900 rounded">
        Map failed to load: {loadError.message}
      </div>
    )
  }

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-500 bg-gray-900 rounded">
        Loading map…
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
    <GoogleMap
        mapContainerStyle={containerStyle}
        center={center}
        zoom={10}
        onLoad={map => { mapRef.current = map }}
        options={{
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
        styles: [
          { elementType: 'geometry', stylers: [{ color: '#1a1d27' }] },
          { elementType: 'labels.text.fill', stylers: [{ color: '#9ca3af' }] },
          { elementType: 'labels.text.stroke', stylers: [{ color: '#0f1117' }] },
          { featureType: 'water', stylers: [{ color: '#0f1117' }] },
          { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#374151' }] },
          { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        ],
      }}
    >
      {homeBase && (
        <MarkerF
          position={{ lat: homeBase.lat, lng: homeBase.lng }}
          title="Home base — your shop"
          icon={homeBaseSymbol()}
          zIndex={1000}
        />
      )}

      {geocodedLeads.map((lead: any) => (
        <MarkerF
          key={lead.id}
          position={{ lat: lead.latitude ?? lead.lat, lng: lead.longitude ?? lead.lng }}
          title={lead.contactName ?? lead.contact_name ?? 'Lead'}
          icon={pinSymbol(pinColorForScore(lead.score ?? 0))}
          options={{ optimized: false }}
          onClick={() => setSelectedLeadId(lead.id)}
        />
      ))}

      {portalPins.map(({ id, lat, lng, lead }) => (
        <MarkerF
          key={`portal-${id}`}
          position={{ lat, lng }}
          title={lead.contactName ?? lead.contact_name ?? 'Portal Lead'}
          icon={pinSymbol(pinColorForScore(lead.score ?? 82))}
          options={{ optimized: false }}
          onClick={() => setSelectedLeadId(id)}
        />
      ))}

      {selectedLead && (
        <InfoWindowF
          position={{ lat: (selectedLead as any).latitude ?? (selectedLead as any).lat, lng: (selectedLead as any).longitude ?? (selectedLead as any).lng }}
          onCloseClick={() => setSelectedLeadId(null)}
        >
          <div style={{ minWidth: 200, color: '#0f1117' }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {(selectedLead as any).contactName ?? (selectedLead as any).contact_name ?? 'Lead'}
            </div>
            {(selectedLead as any).city && (
              <div style={{ fontSize: 12, marginBottom: 2 }}>{(selectedLead as any).city}</div>
            )}
            <div style={{ fontSize: 12, marginBottom: 2 }}>
              Score: <strong>{(selectedLead as any).score ?? 0}</strong>
              {typeof (selectedLead as any).distance === 'number' && (
                <> · {(selectedLead as any).distance.toFixed(1)} mi</>
              )}
            </div>
            {(selectedLead as any).permit_number && (
              <div style={{ fontSize: 11, color: '#4b5563', marginBottom: 6 }}>
                #{(selectedLead as any).permit_number}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <button
                onClick={() => { onLeadSelect((selectedLead as any).id); setSelectedLeadId(null) }}
                style={{ background: '#10b981', color: 'white', padding: '4px 10px', fontSize: 12, borderRadius: 4, border: 'none', cursor: 'pointer', fontWeight: 500 }}
              >
                Open lead
              </button>
              {routeLeadIdRef.current === (selectedLead as any).id ? (
                <button
                  onClick={() => { clearRoute(); }}
                  style={{ background: '#1d4ed8', color: 'white', padding: '4px 10px', fontSize: 12, borderRadius: 4, border: 'none', cursor: 'pointer', fontWeight: 500 }}
                >
                  Clear route
                </button>
              ) : (
                <button
                  onClick={() => {
                    const lat = (selectedLead as any).latitude ?? (selectedLead as any).lat
                    const lng = (selectedLead as any).longitude ?? (selectedLead as any).lng
                    if (lat && lng) {
                      drawRoute(lat, lng, (selectedLead as any).id)
                      setSelectedLeadId(null)
                    }
                  }}
                  style={{ background: '#2563eb', color: 'white', padding: '4px 10px', fontSize: 12, borderRadius: 4, border: 'none', cursor: 'pointer', fontWeight: 500, opacity: routeLoading ? 0.6 : 1 }}
                >
                  {routeLoading ? '...' : 'Take me there'}
                </button>
              )}
            </div>
          </div>
        </InfoWindowF>
      )}
    </GoogleMap>
    {routeLeadId && (
      <button
        onClick={clearRoute}
        style={{
          position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
          zIndex: 50, background: '#1d4ed8', color: 'white',
          padding: '6px 16px', fontSize: 12, borderRadius: 6,
          border: '1px solid #3b82f6', cursor: 'pointer', fontWeight: 600,
          boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
        }}
      >
        ✕ Clear Route
      </button>
    )}
    </div>
  )
}
export default HunterMap