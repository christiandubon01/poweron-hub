import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GoogleMap, MarkerF } from '@react-google-maps/api'
import {
  BatteryCharging,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Home,
  MapPin,
  PlugZap,
  Search,
  ShieldCheck,
  SunMedium,
} from 'lucide-react'
import { GOOGLE_MAPS_BROWSER_KEY, useV15rGoogleMapsLoader } from '@/utils/googleMapsLoader'
import {
  CONSUMPTION_METHODS,
  DEFAULT_ESTIMATE_DATA,
  ESTIMATE_STEPS,
  OWNERSHIP_OPTIONS,
  PROPERTY_TYPES,
  RATE_PLANS_BY_UTILITY,
  SHADING_OPTIONS,
  SYSTEM_MODES,
  UTILITY_PROVIDERS,
  type ConsumptionMethod,
  type EstimateStep,
  type PropertyType,
  type ShadingLevel,
  type SolarEstimateData,
  type SolarEstimateRatePlan,
  type SolarEstimateUtility,
  type SystemMode,
} from '@/services/solarTraining/SolarEstimateTypes'

// ============================================================================
// STEP METADATA - visual labels and icons, ordered to match ESTIMATE_STEPS
// ============================================================================

type StepMeta = {
  id: EstimateStep
  label: string
  description: string
  Icon: React.ComponentType<{ className?: string }>
}

const STEP_META: StepMeta[] = [
  {
    id: 'address',
    label: 'Address',
    description: 'Capture the home address and optional map pin.',
    Icon: MapPin,
  },
  {
    id: 'home_details',
    label: 'Home Details',
    description: 'Roof shade, ownership status, and property type.',
    Icon: Home,
  },
  {
    id: 'energy_use',
    label: 'Energy Use',
    description: 'Utility provider, rate plan, and consumption input.',
    Icon: PlugZap,
  },
  {
    id: 'system_config',
    label: 'System Config',
    description: 'Solar only or solar plus battery.',
    Icon: BatteryCharging,
  },
  {
    id: 'estimate_summary',
    label: 'Review',
    description: 'Confirm inputs before Phase 5 estimate output.',
    Icon: ClipboardList,
  },
]

const darkMapStyles: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#1f2937' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#111827' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#d1d5db' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#374151' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#1f2937' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#243044' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#374151' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#111827' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#e5e7eb' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f172a' }] },
]

const mapOptions: google.maps.MapOptions = {
  disableDefaultUI: true,
  zoomControl: true,
  clickableIcons: false,
  gestureHandling: 'greedy',
  styles: darkMapStyles,
}

const FIELD_CLASS =
  'w-full rounded-md border border-slate-700/80 bg-slate-950/70 px-3 py-2.5 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-cyan-500/70 focus:ring-1 focus:ring-cyan-500/30'

type UpdateField = <K extends keyof SolarEstimateData>(key: K, value: SolarEstimateData[K]) => void

function numberInputValue(value: number | null): string {
  return value == null ? '' : String(value)
}

function parsePositiveNumber(value: string): number | null {
  if (value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function findLabel<T extends string>(options: Array<{ id: T; label: string }>, id: T | null): string {
  if (!id) return 'Not selected'
  return options.find(option => option.id === id)?.label ?? id
}

function optionCardClass(isSelected: boolean): string {
  return `rounded-lg border p-4 text-left transition-colors ${
    isSelected
      ? 'border-cyan-400/70 bg-cyan-950/55 ring-1 ring-cyan-400/20'
      : 'border-slate-800 bg-slate-950/45 hover:border-cyan-700/60 hover:bg-slate-900/75'
  }`
}

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
      {children}
      {hint && <span className="ml-2 normal-case tracking-normal text-slate-600">{hint}</span>}
    </label>
  )
}

function SectionIntro({
  icon: Icon,
  eyebrow,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  eyebrow: string
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">
          <Icon className="h-4 w-4" />
          {eyebrow}
        </div>
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{children}</p>
      </div>
    </div>
  )
}

function AddressMapPreview({ data }: { data: SolarEstimateData }) {
  const mapRef = useRef<google.maps.Map | null>(null)
  const { isLoaded, loadError } = useV15rGoogleMapsLoader()

  const hasCoordinates =
    typeof data.latitude === 'number' &&
    typeof data.longitude === 'number' &&
    Number.isFinite(data.latitude) &&
    Number.isFinite(data.longitude)

  const center = useMemo<google.maps.LatLngLiteral | null>(() => {
    if (!hasCoordinates) return null
    return { lat: data.latitude as number, lng: data.longitude as number }
  }, [data.latitude, data.longitude, hasCoordinates])

  useEffect(() => {
    if (mapRef.current && center) {
      mapRef.current.panTo(center)
      mapRef.current.setZoom(15)
    }
  }, [center])

  if (!GOOGLE_MAPS_BROWSER_KEY) {
    return (
      <div className="flex min-h-[220px] items-center justify-center rounded-lg border border-dashed border-slate-700 bg-slate-950/55 p-4 text-center text-xs text-slate-500">
        Maps suggestions need the existing VITE_GOOGLE_MAPS_BROWSER_KEY runtime setting.
        Address entry still works as plain text.
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex min-h-[220px] items-center justify-center rounded-lg border border-dashed border-amber-700/50 bg-amber-950/10 p-4 text-center text-xs text-amber-200">
        Map preview could not load. The address text remains local in this interview state.
      </div>
    )
  }

  if (!isLoaded) {
    return (
      <div className="flex min-h-[220px] items-center justify-center rounded-lg border border-slate-800 bg-slate-950/55 p-4 text-center text-xs text-slate-500">
        Loading map tools...
      </div>
    )
  }

  if (!center) {
    return (
      <div className="flex min-h-[220px] items-center justify-center rounded-lg border border-dashed border-slate-700 bg-slate-950/55 p-4 text-center text-xs text-slate-500">
        Select a Places suggestion to capture coordinates and preview a pin.
      </div>
    )
  }

  return (
    <div className="h-[220px] overflow-hidden rounded-lg border border-cyan-900/50 bg-slate-950">
      <GoogleMap
        mapContainerStyle={{ width: '100%', height: '100%' }}
        center={center}
        zoom={15}
        options={mapOptions}
        onLoad={(map) => {
          mapRef.current = map
        }}
        onUnmount={() => {
          mapRef.current = null
        }}
      >
        <MarkerF
          position={center}
          title="Solar estimate address"
          options={{ clickable: false, optimized: false }}
        />
      </GoogleMap>
    </div>
  )
}

function AddressStep({ data, updateField }: { data: SolarEstimateData; updateField: UpdateField }) {
  const { isLoaded } = useV15rGoogleMapsLoader()
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompletePrediction[]>([])
  const [showList, setShowList] = useState(false)
  const autocompleteServiceRef = useRef<google.maps.places.AutocompleteService | null>(null)
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null)
  const predictDebounceRef = useRef<number | null>(null)

  useEffect(() => {
    if (!isLoaded || !GOOGLE_MAPS_BROWSER_KEY || typeof window === 'undefined') return
    const g = window.google
    if (!g?.maps?.places) return
    autocompleteServiceRef.current = new g.maps.places.AutocompleteService()
    sessionTokenRef.current = new g.maps.places.AutocompleteSessionToken()
  }, [isLoaded])

  useEffect(() => {
    return () => {
      if (predictDebounceRef.current) window.clearTimeout(predictDebounceRef.current)
    }
  }, [])

  const runPredictions = useCallback((query: string) => {
    if (!query.trim() || query.trim().length < 3 || !autocompleteServiceRef.current) {
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
      }
    )
  }, [])

  const handleAddressChange = (value: string) => {
    updateField('addressText', value)
    updateField('selectedAddressLabel', value.trim())
    updateField('placeId', null)
    updateField('latitude', null)
    updateField('longitude', null)

    if (predictDebounceRef.current) window.clearTimeout(predictDebounceRef.current)
    if (!GOOGLE_MAPS_BROWSER_KEY || !isLoaded || !autocompleteServiceRef.current) return
    predictDebounceRef.current = window.setTimeout(() => runPredictions(value), 200)
  }

  const selectPrediction = (prediction: google.maps.places.AutocompletePrediction) => {
    if (!prediction?.place_id || typeof window === 'undefined') return
    const g = window.google
    const service = new g.maps.places.PlacesService(document.createElement('div'))

    service.getDetails(
      {
        placeId: prediction.place_id,
        fields: ['formatted_address', 'geometry', 'place_id'],
        sessionToken: sessionTokenRef.current || undefined,
      },
      (place, status) => {
        sessionTokenRef.current = new g.maps.places.AutocompleteSessionToken()
        setSuggestions([])
        setShowList(false)

        if (status !== g.maps.places.PlacesServiceStatus.OK || !place) return

        const formatted = place.formatted_address?.trim() || prediction.description?.trim() || ''
        const location = place.geometry?.location
        const lat = location ? location.lat() : null
        const lng = location ? location.lng() : null

        updateField('addressText', formatted)
        updateField('selectedAddressLabel', formatted)
        updateField('placeId', place.place_id ?? prediction.place_id)
        updateField('latitude', Number.isFinite(lat) ? lat : null)
        updateField('longitude', Number.isFinite(lng) ? lng : null)
      }
    )
  }

  const mapsReady = Boolean(GOOGLE_MAPS_BROWSER_KEY && isLoaded && autocompleteServiceRef.current)

  return (
    <div>
      <SectionIntro icon={MapPin} eyebrow="Step 01" title="Start with the project address">
        Enter the homeowner address. If the existing Google Places loader is configured, suggestions
        can capture a place ID and coordinates for a local map preview.
      </SectionIntro>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-lg border border-slate-800 bg-slate-950/45 p-4">
          <FieldLabel hint={mapsReady ? 'Suggestions enabled' : 'Plain text available'}>
            Homeowner address
          </FieldLabel>
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-500" />
            <input
              type="text"
              value={data.addressText}
              onChange={(event) => handleAddressChange(event.target.value)}
              onBlur={() => window.setTimeout(() => setShowList(false), 180)}
              onFocus={() => suggestions.length > 0 && mapsReady && setShowList(true)}
              placeholder="Street, city, state"
              autoComplete="off"
              className={`${FIELD_CLASS} pl-9`}
            />

            {showList && suggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-30 mt-2 max-h-56 overflow-y-auto rounded-lg border border-slate-700 bg-slate-950 shadow-2xl shadow-black/40">
                {suggestions.map(suggestion => (
                  <button
                    key={suggestion.place_id}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectPrediction(suggestion)}
                    className="block w-full border-b border-slate-800 px-3 py-2.5 text-left text-sm text-slate-200 transition-colors last:border-b-0 hover:bg-cyan-950/50"
                  >
                    {suggestion.description}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-slate-800 bg-slate-900/45 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Place ID
              </p>
              <p className="mt-1 truncate text-xs text-slate-300">{data.placeId ?? 'Not selected'}</p>
            </div>
            <div className="rounded-md border border-slate-800 bg-slate-900/45 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Latitude
              </p>
              <p className="mt-1 text-xs text-slate-300">{data.latitude ?? 'Pending'}</p>
            </div>
            <div className="rounded-md border border-slate-800 bg-slate-900/45 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Longitude
              </p>
              <p className="mt-1 text-xs text-slate-300">{data.longitude ?? 'Pending'}</p>
            </div>
          </div>
        </div>

        <AddressMapPreview data={data} />
      </div>
    </div>
  )
}

function HomeDetailsStep({ data, updateField }: { data: SolarEstimateData; updateField: UpdateField }) {
  return (
    <div>
      <SectionIntro icon={Home} eyebrow="Step 02" title="Qualify the home details">
        Capture the roof and property basics that will shape assumptions in the later estimate phase.
      </SectionIntro>

      <div className="space-y-5">
        <div>
          <FieldLabel>Roof shading</FieldLabel>
          <div className="mt-2 grid gap-3 md:grid-cols-3">
            {SHADING_OPTIONS.map(option => (
              <button
                key={option.id}
                type="button"
                onClick={() => updateField('shading', option.id as ShadingLevel)}
                className={optionCardClass(data.shading === option.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-100">{option.label}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{option.detail}</p>
                  </div>
                  {data.shading === option.id && <CheckCircle2 className="h-4 w-4 shrink-0 text-cyan-300" />}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <FieldLabel>Ownership</FieldLabel>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {OWNERSHIP_OPTIONS.map(option => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => updateField('ownership', option.id)}
                  className={optionCardClass(data.ownership === option.id)}
                >
                  <p className="text-sm font-semibold text-slate-100">{option.label}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <FieldLabel>Property type</FieldLabel>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {PROPERTY_TYPES.map(option => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => updateField('propertyType', option.id as PropertyType)}
                  className={optionCardClass(data.propertyType === option.id)}
                >
                  <p className="text-sm font-semibold text-slate-100">{option.label}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function EnergyUseStep({ data, updateField }: { data: SolarEstimateData; updateField: UpdateField }) {
  const availableRatePlans = data.utilityProvider
    ? RATE_PLANS_BY_UTILITY[data.utilityProvider]
    : []

  const selectUtility = (utility: SolarEstimateUtility) => {
    updateField('utilityProvider', utility)
    const utilityRatePlans = RATE_PLANS_BY_UTILITY[utility]
    const currentRateStillValid = utilityRatePlans.some(plan => plan.id === data.ratePlan)
    updateField('ratePlan', currentRateStillValid ? data.ratePlan : utilityRatePlans[0]?.id ?? null)
  }

  const selectConsumptionMethod = (method: ConsumptionMethod) => {
    updateField('consumptionMethod', method)
    updateField('estimatedMonthlyKwh', null)
  }

  return (
    <div>
      <SectionIntro icon={PlugZap} eyebrow="Step 03" title="Capture energy use">
        Select the utility and rate plan, then choose the simplest intake method for usage. Phase 5
        can translate these inputs into estimate assumptions.
      </SectionIntro>

      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <FieldLabel>Utility provider</FieldLabel>
          <div className="mt-2 grid gap-3">
            {UTILITY_PROVIDERS.map(option => (
              <button
                key={option.id}
                type="button"
                onClick={() => selectUtility(option.id)}
                className={optionCardClass(data.utilityProvider === option.id)}
              >
                <p className="text-sm font-semibold text-slate-100">{option.label}</p>
              </button>
            ))}
          </div>
        </div>

        <div>
          <FieldLabel>Rate plan</FieldLabel>
          <div className="mt-2 grid gap-3">
            {availableRatePlans.length > 0 ? (
              availableRatePlans.map(option => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => updateField('ratePlan', option.id as SolarEstimateRatePlan)}
                  className={optionCardClass(data.ratePlan === option.id)}
                >
                  <p className="text-sm font-semibold text-slate-100">{option.label}</p>
                </button>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-slate-700 bg-slate-950/45 p-4 text-sm text-slate-500">
                Select a utility provider to show local rate plan options.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-lg border border-slate-800 bg-slate-950/45 p-4">
        <FieldLabel>Consumption method</FieldLabel>
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          {CONSUMPTION_METHODS.map(option => (
            <button
              key={option.id}
              type="button"
              onClick={() => selectConsumptionMethod(option.id)}
              className={optionCardClass(data.consumptionMethod === option.id)}
            >
              <p className="text-sm font-semibold text-slate-100">{option.label}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{option.detail}</p>
            </button>
          ))}
        </div>

        <div className="mt-4 max-w-md">
          {data.consumptionMethod === 'average_bill' ? (
            <>
              <FieldLabel hint="Monthly dollars">Average electric bill</FieldLabel>
              <div className="relative mt-2">
                <span className="pointer-events-none absolute left-3 top-2.5 text-sm text-slate-500">$</span>
                <input
                  type="number"
                  min="0"
                  inputMode="decimal"
                  value={numberInputValue(data.averageMonthlyBill)}
                  onChange={(event) =>
                    updateField('averageMonthlyBill', parsePositiveNumber(event.target.value))
                  }
                  placeholder="285"
                  className={`${FIELD_CLASS} pl-7`}
                />
              </div>
            </>
          ) : (
            <>
              <FieldLabel hint="Square feet">Home size</FieldLabel>
              <input
                type="number"
                min="0"
                inputMode="numeric"
                value={numberInputValue(data.homeSizeSqft)}
                onChange={(event) => updateField('homeSizeSqft', parsePositiveNumber(event.target.value))}
                placeholder="2200"
                className={`${FIELD_CLASS} mt-2`}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function SystemConfigStep({ data, updateField }: { data: SolarEstimateData; updateField: UpdateField }) {
  return (
    <div>
      <SectionIntro icon={BatteryCharging} eyebrow="Step 04" title="Choose the system direction">
        Select the estimate track and target offset. No product catalog or estimate math is attached in
        this phase.
      </SectionIntro>

      <div className="grid gap-4 md:grid-cols-2">
        {SYSTEM_MODES.map(option => (
          <button
            key={option.id}
            type="button"
            onClick={() => updateField('systemMode', option.id as SystemMode)}
            className={optionCardClass(data.systemMode === option.id)}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-slate-100">{option.label}</p>
                <p className="mt-2 text-sm leading-6 text-slate-500">{option.detail}</p>
              </div>
              {data.systemMode === option.id && <CheckCircle2 className="h-5 w-5 shrink-0 text-cyan-300" />}
            </div>
          </button>
        ))}
      </div>

      <div className="mt-5 rounded-lg border border-slate-800 bg-slate-950/45 p-4">
        <FieldLabel hint="Phase 5 can use this as a summary control">Target solar offset</FieldLabel>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="range"
            min="50"
            max="125"
            step="5"
            value={data.targetOffset}
            onChange={(event) => updateField('targetOffset', Number(event.target.value))}
            className="h-2 flex-1 accent-cyan-400"
          />
          <input
            type="number"
            min="0"
            max="200"
            value={data.targetOffset}
            onChange={(event) => updateField('targetOffset', parsePositiveNumber(event.target.value) ?? 0)}
            className="w-24 rounded-md border border-slate-700/80 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500/70"
          />
          <span className="text-sm font-semibold text-cyan-200">%</span>
        </div>
      </div>
    </div>
  )
}

function ReviewRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/45 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <div className="mt-1 text-sm font-medium text-slate-100">{value}</div>
    </div>
  )
}

function ReviewStep({ data }: { data: SolarEstimateData }) {
  const ratePlanLabel = data.utilityProvider
    ? findLabel(RATE_PLANS_BY_UTILITY[data.utilityProvider], data.ratePlan)
    : 'Not selected'

  const consumptionValue =
    data.consumptionMethod === 'average_bill'
      ? data.averageMonthlyBill == null
        ? 'Not entered'
        : `$${data.averageMonthlyBill.toLocaleString()} / month`
      : data.homeSizeSqft == null
      ? 'Not entered'
      : `${data.homeSizeSqft.toLocaleString()} sq ft`

  return (
    <div>
      <SectionIntro icon={ClipboardList} eyebrow="Step 05" title="Review before estimate summary">
        Confirm the interview data. The final estimate summary, calculations, and editable output cards
        are intentionally reserved for Phase 5.
      </SectionIntro>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <ReviewRow label="Address" value={data.selectedAddressLabel || data.addressText || 'Not entered'} />
        <ReviewRow
          label="Coordinates"
          value={
            data.latitude != null && data.longitude != null
              ? `${data.latitude.toFixed(5)}, ${data.longitude.toFixed(5)}`
              : 'No map pin'
          }
        />
        <ReviewRow
          label="Roof shading"
          value={findLabel(SHADING_OPTIONS, data.shading)}
        />
        <ReviewRow
          label="Ownership"
          value={findLabel(OWNERSHIP_OPTIONS, data.ownership)}
        />
        <ReviewRow
          label="Property type"
          value={findLabel(PROPERTY_TYPES, data.propertyType)}
        />
        <ReviewRow
          label="Utility"
          value={findLabel(UTILITY_PROVIDERS, data.utilityProvider)}
        />
        <ReviewRow label="Rate plan" value={ratePlanLabel} />
        <ReviewRow
          label="Consumption method"
          value={findLabel(CONSUMPTION_METHODS, data.consumptionMethod)}
        />
        <ReviewRow label="Consumption input" value={consumptionValue} />
        <ReviewRow
          label="System configuration"
          value={findLabel(SYSTEM_MODES, data.systemMode)}
        />
        <ReviewRow label="Target offset" value={`${data.targetOffset}%`} />
      </div>

      <div className="mt-5 rounded-lg border border-cyan-900/50 bg-cyan-950/20 p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" />
          <div>
            <p className="text-sm font-semibold text-cyan-100">Ready for Phase 5 summary build</p>
            <p className="mt-1 text-sm leading-6 text-slate-400">
              This screen only prepares and displays local interview inputs. No estimate math,
              savings claims, persistence, proposal engine, or Supabase writes happen here.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function ActiveStepPanel({ data, updateField }: { data: SolarEstimateData; updateField: UpdateField }) {
  switch (data.currentStep) {
    case 'address':
      return <AddressStep data={data} updateField={updateField} />
    case 'home_details':
      return <HomeDetailsStep data={data} updateField={updateField} />
    case 'energy_use':
      return <EnergyUseStep data={data} updateField={updateField} />
    case 'system_config':
      return <SystemConfigStep data={data} updateField={updateField} />
    case 'estimate_summary':
      return <ReviewStep data={data} />
    default:
      return null
  }
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function SolarEstimateTab() {
  const [data, setData] = useState<SolarEstimateData>(DEFAULT_ESTIMATE_DATA)

  const currentStepIndex = ESTIMATE_STEPS.indexOf(data.currentStep)

  const updateField = useCallback(
    <K extends keyof SolarEstimateData>(key: K, value: SolarEstimateData[K]) => {
      setData(d => ({ ...d, [key]: value }))
    },
    []
  )

  const goToStep = useCallback((step: EstimateStep) => {
    setData(d => ({ ...d, currentStep: step }))
  }, [])

  const goNext = useCallback(() => {
    const nextStep = ESTIMATE_STEPS[currentStepIndex + 1]
    if (nextStep) setData(d => ({ ...d, currentStep: nextStep }))
  }, [currentStepIndex])

  const goBack = useCallback(() => {
    const prevStep = ESTIMATE_STEPS[currentStepIndex - 1]
    if (prevStep) setData(d => ({ ...d, currentStep: prevStep }))
  }, [currentStepIndex])

  const isFirst = currentStepIndex === 0
  const isLast = currentStepIndex === ESTIMATE_STEPS.length - 1

  return (
    <section className="relative overflow-hidden rounded-lg border border-cyan-900/50 bg-slate-950/80 shadow-[0_0_40px_rgba(8,145,178,0.08)]">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/70 to-transparent" />
      <div className="absolute -right-24 -top-24 h-56 w-56 rounded-full bg-emerald-500/10 blur-3xl" />
      <div className="absolute -left-16 bottom-0 h-44 w-44 rounded-full bg-yellow-400/10 blur-3xl" />

      <div className="relative p-5 sm:p-6">
        <div className="flex flex-col gap-4 border-b border-slate-800/90 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
              <SunMedium className="h-4 w-4 text-yellow-300" />
              Solar Estimate
            </div>
            <h2 className="text-xl font-semibold text-white">Homeowner Estimate Interview</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Walk through each step to collect the local interview inputs needed for a future solar
              estimate summary.
            </p>
          </div>
          <div className="shrink-0 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-200">
            Phase 4 - Interview UI
          </div>
        </div>

        <div className="mt-5 flex items-center gap-1.5">
          {ESTIMATE_STEPS.map((step, i) => (
            <div
              key={step}
              className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                i < currentStepIndex
                  ? 'bg-emerald-500'
                  : i === currentStepIndex
                  ? 'bg-cyan-400'
                  : 'bg-slate-800'
              }`}
            />
          ))}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-5">
          {STEP_META.map((step, index) => {
            const isActive = step.id === data.currentStep
            const isCompleted = index < currentStepIndex
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => goToStep(step.id)}
                className={`rounded-lg border p-4 text-left transition-colors ${
                  isActive
                    ? 'border-cyan-500/60 bg-cyan-950/60 ring-1 ring-cyan-500/30'
                    : isCompleted
                    ? 'border-emerald-800/40 bg-emerald-950/20 hover:border-emerald-700/60'
                    : 'border-slate-800 bg-slate-900/70 hover:border-cyan-700/50 hover:bg-slate-900'
                }`}
              >
                <div className="mb-4 flex items-center justify-between gap-2">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-md border ${
                      isActive
                        ? 'border-cyan-400/50 bg-cyan-500/20'
                        : isCompleted
                        ? 'border-emerald-600/40 bg-emerald-900/30'
                        : 'border-cyan-500/30 bg-cyan-500/10'
                    }`}
                  >
                    <step.Icon
                      className={`h-4 w-4 ${
                        isActive
                          ? 'text-cyan-300'
                          : isCompleted
                          ? 'text-emerald-400'
                          : 'text-cyan-200'
                      }`}
                    />
                  </div>
                  <span className="text-xs font-semibold text-slate-600">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-slate-100">{step.label}</h3>
                <p className="mt-1.5 text-xs leading-5 text-slate-500">{step.description}</p>
              </button>
            )
          })}
        </div>

        <div className="mt-5 rounded-lg border border-slate-700/50 bg-slate-900/50 p-5">
          <ActiveStepPanel data={data} updateField={updateField} />
        </div>

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={goBack}
            disabled={isFirst}
            className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:border-slate-600 hover:text-white disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
          <span className="text-xs text-slate-600">
            {currentStepIndex + 1} / {ESTIMATE_STEPS.length}
          </span>
          <button
            type="button"
            onClick={goNext}
            disabled={isLast}
            className="flex items-center gap-1.5 rounded-md border border-cyan-700/50 bg-cyan-900/30 px-4 py-2 text-sm font-medium text-cyan-200 transition-colors hover:border-cyan-600 hover:bg-cyan-900/50 disabled:pointer-events-none disabled:opacity-30"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  )
}
