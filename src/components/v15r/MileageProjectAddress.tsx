// @ts-nocheck
/**
 * Job site address for Estimate mileage: Places suggestions (+ optional Street View preview).
 * Uses VITE_GOOGLE_MAPS_BROWSER_KEY via @react-google-maps/api (same pattern as V15rLeadsPanel).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useJsApiLoader } from '@react-google-maps/api'

export type MileageAddressCommitPatch = {
  address: string
  addressLat?: number | null
  addressLng?: number | null
  placeId?: string | null
}

/** Persist coords from Geocoder — same save path as address (caller uses saveBackupDataAndSync). */
export type PersistStreetViewGeometryPayload = {
  addressLat: number
  addressLng: number
  /** Optional: geocoder place_id — only consumed when caller wants to refine an empty Places id */
  placeId?: string
}

export const GOOGLE_MAPS_BROWSER_KEY = (import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY as string) ?? ''

const STREET_VIEW_IMG_SIZE = '360x180'

export function streetViewThumbnailUrl(opts: {
  lat?: number | null
  lng?: number | null
  panoId?: string | null
  apiKey: string
}): string | null {
  const { lat, lng, panoId, apiKey } = opts
  if (!apiKey) return null

  const baseParams = `size=${STREET_VIEW_IMG_SIZE}&fov=80&pitch=0&key=${encodeURIComponent(apiKey)}`

  const pid = String(panoId || '').trim()
  if (pid.length > 0) {
    return `https://maps.googleapis.com/maps/api/streetview?${baseParams}&pano=${encodeURIComponent(pid)}`
  }

  if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
    return `https://maps.googleapis.com/maps/api/streetview?${baseParams}&location=${lat},${lng}`
  }
  return null
}

function coordsClose(a?: number | null, b?: number | null, eps = 1e-5): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  return Math.abs((a as number) - (b as number)) < eps
}

function tryGetPanorama(
  sv: google.maps.StreetViewService,
  lat: number,
  lng: number,
  radius: number,
  cb: (data: google.maps.StreetViewPanoramaData | null, status: google.maps.StreetViewStatus) => void,
): void {
  sv.getPanorama({ location: { lat, lng }, radius, preference: google.maps.StreetViewPreference.NEAREST }, cb)
}

function findNearestPanorama(
  sv: google.maps.StreetViewService,
  lat: number,
  lng: number,
  radii: number[],
): Promise<{ data: google.maps.StreetViewPanoramaData | null }> {
  return new Promise((resolve) => {
    let idx = 0
    function next(): void {
      if (idx >= radii.length) {
        resolve({ data: null })
        return
      }
      tryGetPanorama(sv, lat, lng, radii[idx++]!, (_data: google.maps.StreetViewPanoramaData | null, status: google.maps.StreetViewStatus) => {
        const g = window.google
        if (status === g.maps.StreetViewStatus.OK && _data?.location?.latLng) {
          resolve({ data: _data })
          return
        }
        next()
      })
    }
    next()
  })
}

/** Shown under mileage total: geocodes when needed, checks Street View before showing unavailable. */
export function MileageStreetViewPreview({
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
  /** Optional — only forwarded to geocode persist when Places didn’t supply one yet */
  placeIdProp?: string | null
  onPersistGeometry?: (payload: PersistStreetViewGeometryPayload) => void
  /** Increment from parent (e.g. Save address) to re-run geocode / panorama probe */
  geoRetryNonce?: number
}) {
  const persistRef = useRef<typeof onPersistGeometry | undefined>(onPersistGeometry)
  persistRef.current = onPersistGeometry

  const { isLoaded } = useJsApiLoader({
    id: 'v15r-estimate-mileage-places',
    googleMapsApiKey: GOOGLE_MAPS_BROWSER_KEY,
    libraries: ['places'],
  })

  /** 'idle' | 'loading' | 'ready' | 'missing' — missing = no panorama or geocode fail */
  const [svPhase, setSvPhase] = useState<'idle' | 'loading' | 'ready' | 'missing'>('idle')
  const [streetViewImgUrl, setStreetViewImgUrl] = useState<string | null>(null)
  const [streetViewBroken, setStreetViewBroken] = useState(false)

  const addrTrim = String(addressProp || '').trim()
  const hasAddress = addrTrim.length >= 4

  useEffect(() => {
    let alive = true

    setStreetViewBroken(false)

    if (!GOOGLE_MAPS_BROWSER_KEY || !hasAddress) {
      setStreetViewImgUrl(null)
      setSvPhase('idle')
      return
    }

    if (!isLoaded || typeof window === 'undefined') {
      if (alive) setSvPhase(addrTrim.length ? 'loading' : 'idle')
      return () => {
        alive = false
      }
    }

    const g = window.google
    const hasPropCoords =
      typeof addressLatProp === 'number' &&
      typeof addressLngProp === 'number' &&
      Number.isFinite(addressLatProp) &&
      Number.isFinite(addressLngProp)

    const EPS_COORD = 1e-6
    function flushPanorama(lat: number, lng: number, panHint?: string | null): void {
      const sv = new g.maps.StreetViewService()
      void findNearestPanorama(sv, lat, lng, [42, 120, 380])
        .then(({ data }) => {
          if (!alive) return

          if (!data?.location?.latLng) {
            setStreetViewImgUrl(null)
            setSvPhase('missing')
            return
          }

          const ll = data.location.latLng
          const plat = typeof ll.lat === 'function' ? ll.lat() : (ll.lat as unknown as number)
          const plng = typeof ll.lng === 'function' ? ll.lng() : (ll.lng as unknown as number)
          const panoFromSvc = String(data.location?.pano || '').trim()
          const pano = panoFromSvc || (panHint ? String(panHint).trim() : '')

          const url =
            streetViewThumbnailUrl({
              lat: plat,
              lng: plng,
              panoId: pano || null,
              apiKey: GOOGLE_MAPS_BROWSER_KEY,
            }) || null

          if (!url) {
            setStreetViewImgUrl(null)
            setSvPhase('missing')
            return
          }

          setStreetViewImgUrl(url)
          setSvPhase('ready')
        })
        .catch(() => {
          if (!alive) return
          setStreetViewImgUrl(null)
          setSvPhase('missing')
        })
    }

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

      const payload = { addressLat: plat, addressLng: plng }

      if (!existingPid && gcPid) payload.placeId = gcPid

      persist(payload)
    }

    const run = (): void => {
      if (!alive) return
      setSvPhase('loading')
      setStreetViewImgUrl(null)

      /** coords already stored */
      if (hasPropCoords) {
        flushPanorama(addressLatProp as number, addressLngProp as number, null)
        return
      }

      /** Geocode typed / modal-only address once per address + retry nonce */
      const geo = new g.maps.Geocoder()
      geo.geocode({ address: addrTrim }, (results, geoStatus) => {
        if (!alive) return
        if (geoStatus !== g.maps.GeocoderStatus.OK || !results?.length) {
          setStreetViewImgUrl(null)
          setSvPhase('missing')
          return
        }
        const r0 = results[0]
        const loc = r0?.geometry?.location
        const plat = typeof loc.lat === 'function' ? loc.lat() : NaN
        const plng = typeof loc.lng === 'function' ? loc.lng() : NaN
        const pid = typeof r0?.place_id === 'string' ? r0.place_id : null

        if (!Number.isFinite(plat) || !Number.isFinite(plng)) {
          setStreetViewImgUrl(null)
          setSvPhase('missing')
          return
        }

        maybePersistFromGeocoder(plat, plng, pid)

        flushPanorama(plat, plng, null)
      })
    }

    run()

    return () => {
      alive = false
    }
    // Omit onPersistGeometry from deps — use persistRef.current
    // geoRetryNonce: parent bumps to re-geocode Street View probe
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

  const previewKey = useMemo(() => `${addrTrim}_${addressLatProp ?? ''}_${addressLngProp ?? ''}_${geoRetryNonce}`, [
    addrTrim,
    addressLatProp,
    addressLngProp,
    geoRetryNonce,
  ])

  const unavailableCls = (
    <div
      style={{
        marginTop: '10px',
        width: '100%',
        padding: '14px',
        borderRadius: '8px',
        border: '1px dashed rgba(255,255,255,0.12)',
        color: '#9ca3af',
        fontSize: '12px',
        maxWidth: '560px',
      }}
    >
      Street view unavailable for this address
    </div>
  )

  if (!GOOGLE_MAPS_BROWSER_KEY) return null

  if (hasAddress) {
    if (streetViewImgUrl && svPhase === 'ready' && !streetViewBroken) {
      return (
        <div style={{ marginTop: '10px', width: '100%' }}>
          <img
            key={previewKey}
            src={streetViewImgUrl}
            alt="Street preview"
            onError={() => setStreetViewBroken(true)}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer-when-downgrade"
            style={{
              width: '100%',
              maxWidth: '560px',
              height: 'auto',
              aspectRatio: '360 / 180',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.08)',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        </div>
      )
    }

    /** No panorama, geocoder miss, Static image FAILED (often REQUEST_DENIED if Street View Static API unset) */
    if (streetViewBroken || svPhase === 'missing') return unavailableCls

    /** idle = first frames before geocode kicks in */
    if (svPhase === 'loading' || svPhase === 'idle' || !isLoaded) {
      return (
        <div style={{ marginTop: '8px', fontSize: '10px', color: '#64748b' }}>
          Loading street preview…
        </div>
      )
    }
  }

  return null
}

export default function MileageProjectAddress({
  addressProp,
  addressLatProp,
  addressLngProp,
  placeIdProp,
  onCommit,
  onRequestStreetViewRetry,
}: {
  addressProp: string
  addressLatProp?: number | null
  addressLngProp?: number | null
  placeIdProp?: string | null
  onCommit: (patch: MileageAddressCommitPatch) => void
  onRequestStreetViewRetry?: () => void
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
              if (committed) onRequestStreetViewRetry?.()
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
            onRequestStreetViewRetry?.()
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
        Saves with your project backup — same field as Edit Project. Pick a suggestion to capture coordinates for Street View.
      </div>
    </div>
  )
}
