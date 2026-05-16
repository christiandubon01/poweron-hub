// @ts-nocheck
/**
 * Job site address for Estimate mileage: Places suggestions + project map preview.
 * Uses VITE_GOOGLE_MAPS_BROWSER_KEY via @react-google-maps/api (same pattern as V15rLeadsPanel).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { GoogleMap, MarkerF, useJsApiLoader } from '@react-google-maps/api'

export type MileageAddressCommitPatch = {
  address: string
  addressLat?: number | null
  addressLng?: number | null
  placeId?: string | null
}

/** Persist coords from Geocoder — same save path as address (caller uses saveBackupDataAndSync). */
export type PersistProjectAddressGeometryPayload = {
  addressLat: number
  addressLng: number
  /** Optional: geocoder place_id — only consumed when caller wants to refine an empty Places id */
  placeId?: string
}

export const GOOGLE_MAPS_BROWSER_KEY = (import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY as string) ?? ''

const PROJECT_MARKER_Z_INDEX = 1000

const darkMapStyles: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#1f2937' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#111827' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#d1d5db' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#374151' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#1f2937' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#243044' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#9ca3af' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#374151' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#111827' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#e5e7eb' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#4b5563' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#172033' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f172a' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#64748b' }] },
]

const mapOptions: google.maps.MapOptions = {
  disableDefaultUI: true,
  zoomControl: true,
  clickableIcons: false,
  gestureHandling: 'greedy',
  styles: darkMapStyles,
}

function coordsClose(a?: number | null, b?: number | null, eps = 1e-5): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  return Math.abs((a as number) - (b as number)) < eps
}

function centerMapOnProject(map: google.maps.Map | null, center: google.maps.LatLngLiteral): void {
  if (!map || typeof window === 'undefined') return
  const g = window.google
  if (!g?.maps) return

  map.panTo(center)
  map.setZoom(15)
}

/**
 * Shown on the right side of the mileage card above the address input.
 */
export function MileageProjectMapPreview({
  addressProp,
  addressLatProp,
  addressLngProp,
  placeIdProp,
  onPersistGeometry,
  geoRetryNonce = 0,
}: {
  addressProp: string
  addressLatProp?: number | null
  addressLngProp?: number | null
  /** Optional — only forwarded to geocode persist when Places didn't supply one yet */
  placeIdProp?: string | null
  onPersistGeometry?: (payload: PersistProjectAddressGeometryPayload) => void
  /** Increment from parent (e.g. Save address) to re-run geocode when coordinates are missing */
  geoRetryNonce?: number
}) {
  const persistRef = useRef<typeof onPersistGeometry | undefined>(onPersistGeometry)
  persistRef.current = onPersistGeometry
  const mapRef = useRef<google.maps.Map | null>(null)

  const { isLoaded } = useJsApiLoader({
    id: 'v15r-estimate-mileage-places',
    googleMapsApiKey: GOOGLE_MAPS_BROWSER_KEY,
    libraries: ['places'],
  })

  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'missing'>('idle')
  const [resolvedCoords, setResolvedCoords] = useState<google.maps.LatLngLiteral | null>(null)

  const addrTrim = String(addressProp || '').trim()
  const hasAddress = addrTrim.length >= 4

  useEffect(() => {
    let alive = true

    if (!GOOGLE_MAPS_BROWSER_KEY || !hasAddress) {
      setResolvedCoords(null)
      setPhase('idle')
      return
    }

    if (!isLoaded || typeof window === 'undefined') {
      if (alive) setPhase(addrTrim.length ? 'loading' : 'idle')
      return () => { alive = false }
    }

    const g = window.google
    setPhase('loading')

    const hasPropCoords =
      typeof addressLatProp === 'number' &&
      typeof addressLngProp === 'number' &&
      Number.isFinite(addressLatProp) &&
      Number.isFinite(addressLngProp)

    const EPS_COORD = 1e-6

    function maybePersistFromGeocoder(
      plat: number,
      plng: number,
      geocoderPlaceId: string | null | undefined,
    ): void {
      const persist = persistRef.current
      if (!persist) return

      const gcPid = geocoderPlaceId ? String(geocoderPlaceId).trim() : ''
      const existingPid = String(placeIdProp || '').trim()

      const coordsMatchStored =
        hasPropCoords &&
        coordsClose(plat, addressLatProp as number, EPS_COORD) &&
        coordsClose(plng, addressLngProp as number, EPS_COORD)

      if (coordsMatchStored && !gcPid) return

      if (coordsMatchStored && gcPid && !existingPid) {
        persist({ addressLat: plat, addressLng: plng, placeId: gcPid })
        return
      }

      if (coordsMatchStored) return

      const payload: PersistProjectAddressGeometryPayload = { addressLat: plat, addressLng: plng }
      if (!existingPid && gcPid) payload.placeId = gcPid
      persist(payload)
    }

    /** Geocode the typed address → coords + placeId. */
    function geocodeAddress(): Promise<{ lat: number; lng: number; placeId: string | null } | null> {
      return new Promise((resolve) => {
        const geo = new g.maps.Geocoder()
        geo.geocode({ address: addrTrim }, (results, status) => {
          if (!alive) { resolve(null); return }
          if (status !== g.maps.GeocoderStatus.OK || !results?.length) { resolve(null); return }
          const r0 = results[0]
          const loc = r0?.geometry?.location
          const plat = typeof loc.lat === 'function' ? loc.lat() : NaN
          const plng = typeof loc.lng === 'function' ? loc.lng() : NaN
          const pid = typeof r0?.place_id === 'string' ? r0.place_id : null
          if (!Number.isFinite(plat) || !Number.isFinite(plng)) { resolve(null); return }
          resolve({ lat: plat, lng: plng, placeId: pid })
        })
      })
    }

    async function run(): Promise<void> {
      let lat: number
      let lng: number
      let resolvedPlaceId: string | null = String(placeIdProp || '').trim() || null

      if (hasPropCoords) {
        lat = addressLatProp as number
        lng = addressLngProp as number

        if (!resolvedPlaceId) {
          const geo = await geocodeAddress()
          if (!alive) return
          if (geo?.placeId) {
            resolvedPlaceId = geo.placeId
            const persist = persistRef.current
            const existingPid = String(placeIdProp || '').trim()
            if (persist && !existingPid) {
              persist({ addressLat: lat, addressLng: lng, placeId: geo.placeId })
            }
          }
        }
      } else {
        const geo = await geocodeAddress()
        if (!alive) return
        if (!geo) { setResolvedCoords(null); setPhase('missing'); return }
        lat = geo.lat
        lng = geo.lng
        if (!resolvedPlaceId) resolvedPlaceId = geo.placeId
        maybePersistFromGeocoder(lat, lng, resolvedPlaceId)
      }

      setResolvedCoords({ lat, lng })
      setPhase('ready')
    }

    void run()

    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed for map load + coords + retries
  }, [
    addrTrim,
    hasAddress,
    isLoaded,
    addressLatProp,
    addressLngProp,
    geoRetryNonce,
    placeIdProp,
  ])

  useEffect(() => {
    if (phase === 'ready' && resolvedCoords) centerMapOnProject(mapRef.current, resolvedCoords)
  }, [phase, resolvedCoords])

  const placeholderText = hasAddress && phase === 'missing'
    ? 'Coordinates missing — save address to load map'
    : 'Save a job site address to load map'

  const placeholderEl = (
    <div
      style={{
        marginTop: '10px',
        width: '100%',
        minHeight: '240px',
        padding: '14px',
        borderRadius: '8px',
        border: '1px dashed rgba(255,255,255,0.12)',
        backgroundColor: 'rgba(15,23,42,0.55)',
        color: '#9ca3af',
        fontSize: '12px',
        maxWidth: '560px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
      }}
    >
      {placeholderText}
    </div>
  )

  if (!GOOGLE_MAPS_BROWSER_KEY) return placeholderEl

  if (hasAddress) {
    if (phase === 'ready' && resolvedCoords) {
      return (
        <div
          style={{
            marginTop: '10px',
            width: '100%',
            maxWidth: '560px',
            height: '240px',
            borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.08)',
            overflow: 'hidden',
            backgroundColor: '#111827',
          }}
        >
          <GoogleMap
            mapContainerStyle={{ width: '100%', height: '100%' }}
            center={resolvedCoords}
            zoom={10}
            options={mapOptions}
            onLoad={(map) => {
              mapRef.current = map
              centerMapOnProject(map, resolvedCoords)
            }}
            onUnmount={() => {
              mapRef.current = null
            }}
          >
            <MarkerF
              position={resolvedCoords}
              title="Project / job site address"
              zIndex={PROJECT_MARKER_Z_INDEX}
              options={{
                clickable: false,
                optimized: false,
                zIndex: PROJECT_MARKER_Z_INDEX,
              }}
            />
          </GoogleMap>
        </div>
      )
    }

    if (phase === 'missing') return placeholderEl

    if (phase === 'loading' || phase === 'idle' || !isLoaded) {
      return (
        <div style={{ marginTop: '8px', fontSize: '10px', color: '#64748b' }}>
          Loading project map…
        </div>
      )
    }
  }

  return placeholderEl
}

export default function MileageProjectAddress({
  addressProp,
  addressLatProp,
  addressLngProp,
  placeIdProp,
  onCommit,
  onRequestMapRetry,
}: {
  addressProp: string
  addressLatProp?: number | null
  addressLngProp?: number | null
  placeIdProp?: string | null
  onCommit: (patch: MileageAddressCommitPatch) => void
  onRequestMapRetry?: () => void
}) {
  const [draft, setDraft] = useState(addressProp || '')
  const predictionSnapshotRef = useRef<string | null>(null)

  useEffect(() => {
    setDraft(addressProp || '')
    predictionSnapshotRef.current = null
  }, [addressProp])

  const { isLoaded } = useJsApiLoader({
    id: 'v15r-estimate-mileage-places',
    googleMapsApiKey: GOOGLE_MAPS_BROWSER_KEY,
    libraries: ['places'],
  })

  const [suggestions, setSuggestions] = useState([])
  const [showList, setShowList] = useState(false)
  const autocompleteServiceRef = useRef(null)
  const sessionTokenRef = useRef(null)
  const predictDebounceRef = useRef(null)

  useEffect(() => {
    if (!isLoaded || !GOOGLE_MAPS_BROWSER_KEY || typeof window === 'undefined') return
    const g = window.google
    if (!g?.maps?.places) return
    autocompleteServiceRef.current = new g.maps.places.AutocompleteService()
    sessionTokenRef.current = new g.maps.places.AutocompleteSessionToken()
  }, [isLoaded])

  const runPredictions = useCallback((query: string) => {
    if (!query || query.trim().length < 3 || !autocompleteServiceRef.current) {
      setSuggestions([])
      setShowList(false)
      return
    }
    autocompleteServiceRef.current.getPlacePredictions(
      {
        input: query.trim(),
        componentRestrictions: { country: 'us' },
        sessionToken: sessionTokenRef.current || undefined,
      },
      (results, status) => {
        const g = window.google
        if (status !== g.maps.places.PlacesServiceStatus.OK || !results?.length) {
          setSuggestions([])
          setShowList(false)
          return
        }
        setSuggestions(results)
        setShowList(true)
      },
    )
  }, [])

  const handleDraftChange = (val: string) => {
    predictionSnapshotRef.current = null
    setDraft(val)
    clearTimeout(predictDebounceRef.current)
    if (!GOOGLE_MAPS_BROWSER_KEY || !isLoaded || !autocompleteServiceRef.current) return
    predictDebounceRef.current = window.setTimeout(() => runPredictions(val), 200)
  }

  const selectPrediction = (prediction: google.maps.places.AutocompletePrediction) => {
    if (!prediction?.place_id || typeof window === 'undefined') return
    const g = window.google
    const svc = new g.maps.places.PlacesService(document.createElement('div'))
    svc.getDetails(
      {
        placeId: prediction.place_id,
        fields: ['formatted_address', 'geometry', 'place_id'],
        sessionToken: sessionTokenRef.current || undefined,
      },
      (place: google.maps.places.PlaceResult | null, status: string) => {
        sessionTokenRef.current = new g.maps.places.AutocompleteSessionToken()

        setSuggestions([])
        setShowList(false)

        if (status !== g.maps.places.PlacesServiceStatus.OK || !place) return

        const formatted = place.formatted_address?.trim() || prediction.description?.trim() || ''
        predictionSnapshotRef.current = formatted.trim()

        const loc = place.geometry?.location
        const lat = loc ? loc.lat() : null
        const lng = loc ? loc.lng() : null

        setDraft(formatted)

        const patch: MileageAddressCommitPatch = {
          address: formatted,
          placeId: place.place_id ?? prediction.place_id,
          addressLat: lat,
          addressLng: lng,
        }
        if (patch.addressLat == null || patch.addressLng == null || !Number.isFinite(patch.addressLat) || !Number.isFinite(patch.addressLng)) {
          patch.addressLat = null
          patch.addressLng = null
        }

        onCommit(patch)
      },
    )
  }

  const commitFromBlurOrExplicit = (): boolean => {
    const trimmed = draft.trim()
    const prev = String(addressProp || '').trim()
    if (trimmed === prev) return false

    const patch: MileageAddressCommitPatch = { address: trimmed }

    if (predictionSnapshotRef.current != null && trimmed === predictionSnapshotRef.current.trim()) {
      patch.addressLat = addressLatProp ?? null
      patch.addressLng = addressLngProp ?? null
      patch.placeId = placeIdProp ?? null
    } else {
      patch.addressLat = null
      patch.addressLng = null
      patch.placeId = null
    }

    onCommit(patch)
    return true
  }

  const mapsDisabledReason = !GOOGLE_MAPS_BROWSER_KEY ? 'Maps features need VITE_GOOGLE_MAPS_BROWSER_KEY in environment.' : null

  return (
    <div style={{ marginBottom: '10px', position: 'relative', width: '100%' }}>
      <label style={{ display: 'block', fontSize: '11px', color: 'var(--t3)', marginBottom: '4px' }}>Project / job site address</label>
      {mapsDisabledReason && <div style={{ fontSize: '10px', color: '#9ca3af', marginBottom: '6px' }}>{mapsDisabledReason}</div>}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ position: 'relative', flex: '1', minWidth: '200px' }}>
          <input
            type="text"
            value={draft}
            onChange={(e) => handleDraftChange(e.target.value)}
            onBlur={() => {
              window.setTimeout(() => setShowList(false), 220)
              const committed = commitFromBlurOrExplicit()
              if (committed) onRequestMapRetry?.()
            }}
            onFocus={() => suggestions.length > 0 && GOOGLE_MAPS_BROWSER_KEY && isLoaded && setShowList(true)}
            placeholder="Street, city — suggestions when Maps is configured"
            autoComplete="off"
            style={{
              width: '100%',
              padding: '8px',
              backgroundColor: '#1e2130',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '4px',
              color: 'var(--t1)',
              fontSize: '13px',
            }}
          />
          {showList && suggestions.length > 0 && (
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: '100%',
                marginTop: '2px',
                zIndex: 40,
                backgroundColor: '#111827',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '6px',
                maxHeight: '200px',
                overflowY: 'auto',
                boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
              }}
            >
              {suggestions.map((s: google.maps.places.AutocompletePrediction) => (
                <button
                  type="button"
                  key={s.place_id}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectPrediction(s)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 10px',
                    border: 'none',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    background: '#111827',
                    color: '#e5e7eb',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  <div>{s.description}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            commitFromBlurOrExplicit()
            onRequestMapRetry?.()
          }}
          style={{
            padding: '8px 12px',
            backgroundColor: 'rgba(16,185,129,0.15)',
            color: '#34d399',
            border: '1px solid rgba(16,185,129,0.35)',
            borderRadius: '4px',
            fontSize: '11px',
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Save address
        </button>
      </div>
      <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '4px' }}>
        Saves with your project backup — same field as Edit Project. Pick a suggestion to capture coordinates for the project map.
      </div>
    </div>
  )
}
