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

export const GOOGLE_MAPS_BROWSER_KEY = (import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY as string) ?? ''

export function streetViewThumbnailUrl(opts: {
  lat?: number | null
  lng?: number | null
  address: string
  apiKey: string
}): string | null {
  const { lat, lng, address, apiKey } = opts
  if (!apiKey) return null
  const size = '640x280'
  if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
    return `https://maps.googleapis.com/maps/api/streetview?size=${size}&location=${lat},${lng}&fov=80&pitch=0&key=${encodeURIComponent(apiKey)}`
  }
  const a = address.trim()
  if (a.length >= 3) {
    return `https://maps.googleapis.com/maps/api/streetview?size=${size}&location=${encodeURIComponent(a)}&fov=80&pitch=0&key=${encodeURIComponent(apiKey)}`
  }
  return null
}

/** Shown directly under mileage total (+ grid): only updates preview when coords/address props change — not while typing */
export function MileageStreetViewPreview({
  addressProp,
  addressLatProp,
  addressLngProp,
}: {
  addressProp: string
  addressLatProp?: number | null
  addressLngProp?: number | null
}) {
  const previewKey = useMemo(
    () => `${addressLatProp ?? ''}_${addressLngProp ?? ''}_${String(addressProp || '').trim()}`,
    [addressProp, addressLatProp, addressLngProp],
  )

  const streetViewUrl = useMemo(
    () =>
      streetViewThumbnailUrl({
        lat: addressLatProp,
        lng: addressLngProp,
        address: String(addressProp || '').trim(),
        apiKey: GOOGLE_MAPS_BROWSER_KEY,
      }),
    [addressProp, addressLatProp, addressLngProp],
  )

  const [streetViewBroken, setStreetViewBroken] = useState(false)
  useEffect(() => {
    setStreetViewBroken(false)
  }, [previewKey])

  const hasAddress = String(addressProp || '').trim().length >= 3

  if (!GOOGLE_MAPS_BROWSER_KEY) return null

  if (streetViewUrl && !streetViewBroken) {
    return (
      <div style={{ marginTop: '10px', width: '100%' }}>
        <img
          key={previewKey}
          src={streetViewUrl}
          alt="Street preview"
          onError={() => setStreetViewBroken(true)}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer-when-downgrade"
          style={{
            width: '100%',
            maxWidth: '560px',
            height: 'auto',
            aspectRatio: '640 / 280',
            borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.08)',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      </div>
    )
  }

  if (hasAddress && streetViewBroken) {
    return (
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
  }

  return null
}

export default function MileageProjectAddress({
  addressProp,
  addressLatProp,
  addressLngProp,
  placeIdProp,
  onCommit,
}: {
  addressProp: string
  addressLatProp?: number | null
  addressLngProp?: number | null
  placeIdProp?: string | null
  onCommit: (patch: MileageAddressCommitPatch) => void
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

  const commitFromBlurOrExplicit = () => {
    const trimmed = draft.trim()
    const prev = String(addressProp || '').trim()
    if (trimmed === prev) return

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
              commitFromBlurOrExplicit()
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
          onClick={() => commitFromBlurOrExplicit()}
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
