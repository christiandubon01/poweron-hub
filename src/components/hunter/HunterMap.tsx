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

import React, { useEffect, useMemo, useState } from 'react'
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
    path: 'M 0,0 C -2,-20 -10,-22 -10,-30 A 10,10 0 1,1 10,-30 C 10,-22 2,-20 0,0 z',
    fillColor: color,
    fillOpacity: 1,
    strokeColor: '#0f1117',
    strokeWeight: 1.5,
    scale: 1,
    anchor: new google.maps.Point(0, 0),
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

  const geocodedLeads = useMemo(
    () => leads.filter((l: any) => typeof l.latitude === 'number' && typeof l.longitude === 'number'),
    [leads]
  )

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
    <GoogleMap
      mapContainerStyle={containerStyle}
      center={center}
      zoom={10}
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
          position={{ lat: lead.latitude, lng: lead.longitude }}
          title={lead.contactName ?? lead.contact_name ?? 'Lead'}
          icon={pinSymbol(pinColorForScore(lead.score ?? 0))}
          onClick={() => setSelectedLeadId(lead.id)}
        />
      ))}

      {selectedLead && (
        <InfoWindowF
          position={{ lat: (selectedLead as any).latitude, lng: (selectedLead as any).longitude }}
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
            <button
              onClick={() => {
                onLeadSelect((selectedLead as any).id)
                setSelectedLeadId(null)
              }}
              style={{
                background: '#10b981',
                color: 'white',
                padding: '4px 10px',
                fontSize: 12,
                borderRadius: 4,
                border: 'none',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              Open lead
            </button>
          </div>
        </InfoWindowF>
      )}
    </GoogleMap>
  )
}

export default HunterMap