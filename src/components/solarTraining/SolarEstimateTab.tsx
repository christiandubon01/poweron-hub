import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GoogleMap, MarkerF } from '@react-google-maps/api'
import {
  AirVent,
  BarChart3,
  BatteryCharging,
  Car,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  DollarSign,
  Flame,
  Gauge,
  Home,
  MapPin,
  Microwave,
  PlugZap,
  Search,
  ShieldCheck,
  Shirt,
  SlidersHorizontal,
  SunMedium,
  Utensils,
  WashingMachine,
  Waves,
  X,
  Zap,
} from 'lucide-react'
import { GOOGLE_MAPS_BROWSER_KEY, useV15rGoogleMapsLoader } from '@/utils/googleMapsLoader'
import {
  calculateNEM3Savings,
  TOU_RATE_SCHEDULES,
  type RatePlan,
  type Utility,
} from '@/services/solarTraining/SolarNEM3Calculator'
import {
  APPLIANCE_OPTIONS,
  CONSUMPTION_METHODS,
  DEFAULT_ESTIMATE_DATA,
  ESTIMATE_STEPS,
  MAIN_BREAKER_SIZE_OPTIONS,
  OWNERSHIP_OPTIONS,
  PROPERTY_TYPES,
  RATE_PLANS_BY_UTILITY,
  SHADING_OPTIONS,
  SYSTEM_MODES,
  UTILITY_PROVIDERS,
  type ConsumptionMethod,
  type EstimateStep,
  type MainBreakerSize,
  type PropertyType,
  type ShadingLevel,
  type SolarEstimateAppliance,
  type SolarEstimateData,
  type SolarEstimateRatePlan,
  type SolarEstimateSelectedAppliance,
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
    label: 'Summary',
    description: 'Conservative planning estimate with editable system controls.',
    Icon: ClipboardList,
  },
]

const SOLAR_ROOF_TARGET_ZOOM = 20
const SOLAR_ROOF_FALLBACK_ZOOM = 19

const baseMapOptions: google.maps.MapOptions = {
  disableDefaultUI: true,
  zoomControl: true,
  fullscreenControl: true,
  streetViewControl: false,
  mapTypeControl: true,
  clickableIcons: false,
  gestureHandling: 'greedy',
  tilt: 0,
  heading: 0,
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function roundTo(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function formatMoney(value: number, maximumFractionDigits = 0): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits,
  })
}

function formatNumber(value: number, maximumFractionDigits = 0): string {
  return value.toLocaleString('en-US', { maximumFractionDigits })
}

// ============================================================================
// CHART MODULE TYPES AND HELPERS
// ============================================================================

type ChartTab =
  | 'monthly_bill'
  | 'energy_flow_24h'
  | 'yr25_savings'
  | 'cost_electricity'
  | 'cumulative_savings'
  | 'payment_comparison'

const CHART_TABS: Array<{ id: ChartTab; label: string }> = [
  { id: 'monthly_bill', label: 'Monthly Bill' },
  { id: 'energy_flow_24h', label: '24H Flow' },
  { id: 'yr25_savings', label: '25 Yr Savings' },
  { id: 'cost_electricity', label: 'Elec. Cost' },
  { id: 'cumulative_savings', label: 'Cumulative' },
  { id: 'payment_comparison', label: 'Payments' },
]

type SavedEstimateSnapshot = {
  savedAt: Date
  solarSizeKw: number
  batterySizeKwh: number
  systemCost: number
  avgMonthlyBefore: number
  avgMonthlyAfter: number
  utility: string
  ratePlan: string | null
  address: string
}

// ============================================================================
// SAVED ESTIMATES — localStorage persistence
// ============================================================================

const STORAGE_KEY_ESTIMATES = 'poweron.solarTraining.solarEstimates'
const STORAGE_KEY_DRAFT = 'poweron.solarTraining.activeDraft'

type LocalSolarEstimate = {
  id: string
  createdAt: string
  updatedAt: string
  name: string
  addressLabel: string
  interviewData: SolarEstimateData
  solarSizeKw: number
  batterySizeKwh: number
}

type ActiveDraft = {
  estimateId: string | null
  data: SolarEstimateData
  solarSizeKw: number
  batterySizeKwh: number
}

function normalizeSelectedAppliances(value: unknown): SolarEstimateSelectedAppliance[] {
  if (!Array.isArray(value)) return []

  return value
    .map(appliance => {
      if (typeof appliance === 'string') {
        return APPLIANCE_OPTIONS.some(option => option.id === appliance)
          ? { id: appliance as SolarEstimateAppliance }
          : null
      }

      if (!appliance || typeof appliance !== 'object' || !('id' in appliance)) return null

      const candidate = appliance as { id: unknown; amps?: unknown }
      if (typeof candidate.id !== 'string') return null
      if (!APPLIANCE_OPTIONS.some(option => option.id === candidate.id)) return null

      const amps =
        typeof candidate.amps === 'number' && Number.isFinite(candidate.amps) && candidate.amps > 0
          ? candidate.amps
          : undefined

      return { id: candidate.id as SolarEstimateAppliance, ...(amps == null ? {} : { amps }) }
    })
    .filter((appliance): appliance is SolarEstimateSelectedAppliance => Boolean(appliance))
}

function normalizeEstimateData(data: Partial<SolarEstimateData> | null | undefined): SolarEstimateData {
  const raw = data ?? {}
  return {
    ...DEFAULT_ESTIMATE_DATA,
    ...raw,
    mainBreakerSize: raw.mainBreakerSize ?? DEFAULT_ESTIMATE_DATA.mainBreakerSize,
    selectedAppliances: normalizeSelectedAppliances(raw.selectedAppliances),
  }
}

function loadEstimates(): LocalSolarEstimate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ESTIMATES)
    if (!raw) return []
    const estimates = JSON.parse(raw) as LocalSolarEstimate[]
    return estimates.map(estimate => ({
      ...estimate,
      interviewData: normalizeEstimateData(estimate.interviewData),
    }))
  } catch {
    return []
  }
}

function saveEstimates(list: LocalSolarEstimate[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_ESTIMATES, JSON.stringify(list))
  } catch {}
}

function loadActiveDraft(): ActiveDraft | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DRAFT)
    if (!raw) return null
    const draft = JSON.parse(raw) as ActiveDraft
    return {
      ...draft,
      data: normalizeEstimateData(draft.data),
    }
  } catch {
    return null
  }
}

function saveActiveDraft(draft: ActiveDraft): void {
  try {
    localStorage.setItem(STORAGE_KEY_DRAFT, JSON.stringify(draft))
  } catch {}
}

const ESCALATION_RATE = 0.04

function generate25YearData(
  annualBefore: number,
  annualAfter: number,
): Array<{ year: number; withoutSolar: number; withSolar: number; savings: number; cumulative: number }> {
  let cumulative = 0
  return Array.from({ length: 25 }, (_, i) => {
    const year = i + 1
    const withoutSolar = annualBefore * Math.pow(1 + ESCALATION_RATE, i)
    const withSolar = annualAfter * Math.pow(1 + ESCALATION_RATE * 0.35, i)
    const savings = Math.max(0, withoutSolar - withSolar)
    cumulative += savings
    return { year, withoutSolar, withSolar, savings, cumulative }
  })
}

function generate24hProfile(
  monthlyKwh: number,
  solarSizeKw: number,
): Array<{ hour: number; load: number; solar: number; netExport: number; netImport: number }> {
  const hourlyAvg = (monthlyKwh / 30) / 24
  return Array.from({ length: 24 }, (_, h) => {
    const lf = h < 6 ? 0.62 : h < 9 ? 1.05 : h < 14 ? 0.88 : h < 20 ? 1.18 : h < 23 ? 0.90 : 0.65
    const load = hourlyAvg * lf
    const solar =
      h >= 6 && h <= 19
        ? solarSizeKw * Math.max(0, Math.exp(-Math.pow((h - 12.5) / 3.3, 2))) * 0.85
        : 0
    return { hour: h, load, solar, netExport: Math.max(0, solar - load), netImport: Math.max(0, load - solar) }
  })
}

function getMonthlyLoanPayment(principal: number, termYears = 25, annualRate = 0.0699): number {
  const r = annualRate / 12
  const n = termYears * 12
  return (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)
}

function getAverageImportRate(ratePlan: SolarEstimateRatePlan | null): number {
  if (!ratePlan) return 0.28
  const schedule = TOU_RATE_SCHEDULES[ratePlan as RatePlan]
  if (!schedule) return 0.28
  const hourlyAverage =
    schedule.hours.reduce((total, block) => total + block.import_rate, 0) / schedule.hours.length
  return Math.max(0.12, hourlyAverage)
}

function estimateMonthlyKwh(data: SolarEstimateData): number {
  if (data.estimatedMonthlyKwh && data.estimatedMonthlyKwh > 0) {
    return data.estimatedMonthlyKwh
  }

  if (data.consumptionMethod === 'average_bill' && data.averageMonthlyBill && data.averageMonthlyBill > 0) {
    const rate = getAverageImportRate(data.ratePlan)
    const fixedCharge = data.ratePlan ? TOU_RATE_SCHEDULES[data.ratePlan as RatePlan]?.monthly_fixed_charge ?? 0 : 0
    return clamp(Math.round(((data.averageMonthlyBill - fixedCharge) / rate) * 0.9), 250, 2500)
  }

  if (data.consumptionMethod === 'home_size' && data.homeSizeSqft && data.homeSizeSqft > 0) {
    const propertyFactor = data.propertyType === 'commercial' ? 0.75 : 0.42
    return clamp(Math.round(data.homeSizeSqft * propertyFactor), 250, 3000)
  }

  return 900
}

function estimateSuggestedSystemSize(data: SolarEstimateData): number {
  const utility = data.utilityProvider ?? 'SCE'
  const monthlyKwh = estimateMonthlyKwh(data)
  const annualKwh = monthlyKwh * 12
  const targetOffset = clamp(data.targetOffset || 100, 50, 125) / 100
  const peakSunHours = utility === 'IID' ? 6.2 : 5.5
  const derate = utility === 'IID' ? 0.77 : 0.8
  const shadingFactor = data.shading === 'heavy' ? 0.82 : data.shading === 'some' ? 0.92 : 1
  return roundTo(clamp((annualKwh * targetOffset) / (peakSunHours * 365 * derate * shadingFactor), 3, 18), 1)
}

function estimateSystemCost(systemSizeKw: number, batterySizeKwh: number, hasBattery: boolean): number {
  const solarCost = systemSizeKw * 3100
  const batteryCost = hasBattery ? batterySizeKwh * 900 : 0
  return Math.round((solarCost + batteryCost) / 500) * 500
}

function getRateRecommendation(data: SolarEstimateData): string {
  if (data.utilityProvider === 'SCE') {
    return data.systemMode === 'solar_plus_battery'
      ? 'SCE TOU-D-PRIME is the preferred estimate path because the battery can shift midday solar into 4-9 PM peak hours.'
      : 'SCE TOU-D-PRIME is modeled conservatively; add a battery option when the customer wants stronger NEM 3.0 self-consumption.'
  }

  if (data.utilityProvider === 'IID') {
    return 'IID rates are generally lower than SCE, so this summary keeps savings expectations conservative and focuses on bill reduction.'
  }

  return 'Select a utility and rate plan to tighten the recommendation. This draft uses conservative Southern California assumptions.'
}

function findLabel<T extends string>(options: Array<{ id: T; label: string }>, id: T | null): string {
  if (!id) return 'Not selected'
  return options.find(option => option.id === id)?.label ?? id
}

const APPLIANCE_ICON_MAP: Record<SolarEstimateAppliance, React.ComponentType<{ className?: string }>> = {
  ac_unit: AirVent,
  microwave: Microwave,
  hot_tub: Waves,
  ev_charger: Car,
  electric_stove: Utensils,
  dryer: Shirt,
  washer: WashingMachine,
  furnace: Flame,
  pool_equipment: Waves,
  extra_heavy_load: PlugZap,
}

function getApplianceLabel(id: SolarEstimateAppliance): string {
  return APPLIANCE_OPTIONS.find(option => option.id === id)?.label ?? id
}

function getSelectedApplianceSummaries(selectedAppliances: SolarEstimateSelectedAppliance[]): string[] {
  return selectedAppliances
    .map(appliance => {
      const label = getApplianceLabel(appliance.id)
      return appliance.amps == null ? label : `${label} — ${appliance.amps}A`
    })
    .filter((label): label is string => Boolean(label))
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
  const zoomRequestRef = useRef(0)
  const [roofMapZoom, setRoofMapZoom] = useState(SOLAR_ROOF_FALLBACK_ZOOM)
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

  const roofMapOptions = useMemo<google.maps.MapOptions>(() => {
    const mapsApi = typeof window !== 'undefined' ? window.google?.maps : undefined

    return {
      ...baseMapOptions,
      mapTypeId: mapsApi?.MapTypeId?.HYBRID ?? 'hybrid',
    }
  }, [isLoaded])

  useEffect(() => {
    if (!center) {
      setRoofMapZoom(SOLAR_ROOF_FALLBACK_ZOOM)
      return
    }

    const mapsApi = typeof window !== 'undefined' ? window.google?.maps : undefined
    const mapTypeId = mapsApi?.MapTypeId?.HYBRID ?? 'hybrid'

    if (mapRef.current) {
      mapRef.current.panTo(center)
      mapRef.current.setMapTypeId(mapTypeId)
      mapRef.current.setTilt(0)
      mapRef.current.setHeading(0)
      mapRef.current.setZoom(SOLAR_ROOF_FALLBACK_ZOOM)
    }

    if (!isLoaded || !mapsApi?.MaxZoomService) {
      setRoofMapZoom(SOLAR_ROOF_FALLBACK_ZOOM)
      return
    }

    const requestId = ++zoomRequestRef.current
    const maxZoomService = new mapsApi.MaxZoomService()

    maxZoomService.getMaxZoomAtLatLng(center, (result) => {
      if (requestId !== zoomRequestRef.current) return

      const maxZoom =
        result.status === mapsApi.MaxZoomStatus.OK && typeof result.zoom === 'number' ? result.zoom : null
      const bestZoom = maxZoom == null ? SOLAR_ROOF_FALLBACK_ZOOM : Math.min(SOLAR_ROOF_TARGET_ZOOM, maxZoom)

      setRoofMapZoom(bestZoom)
      if (mapRef.current) {
        mapRef.current.panTo(center)
        mapRef.current.setMapTypeId(mapTypeId)
        mapRef.current.setTilt(0)
        mapRef.current.setHeading(0)
        mapRef.current.setZoom(bestZoom)
      }
    })
  }, [center, isLoaded])

  if (!GOOGLE_MAPS_BROWSER_KEY || loadError) {
    const addressLabel = data.selectedAddressLabel || data.addressText
    const hasAddr = Boolean(addressLabel?.trim())
    return (
      <div className="flex min-h-[360px] w-full min-w-0 flex-col gap-4 rounded-lg border border-slate-700/60 bg-slate-950/70 p-4">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-cyan-500/60" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Map preview unavailable
          </span>
        </div>
        {hasAddr ? (
          <>
            <p className="text-sm font-medium leading-5 text-slate-200">{addressLabel}</p>
            <div className="mt-auto grid grid-cols-2 gap-2">
              <div className="rounded-md border border-slate-800 bg-slate-900/60 p-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">Latitude</p>
                <p className="mt-1 text-xs font-medium text-slate-300">
                  {hasCoordinates ? (data.latitude as number).toFixed(5) : 'Pending'}
                </p>
              </div>
              <div className="rounded-md border border-slate-800 bg-slate-900/60 p-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">Longitude</p>
                <p className="mt-1 text-xs font-medium text-slate-300">
                  {hasCoordinates ? (data.longitude as number).toFixed(5) : 'Pending'}
                </p>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-xs text-slate-600">Enter an address above to see details here</p>
          </div>
        )}
      </div>
    )
  }

  if (!isLoaded) {
    return (
      <div className="flex min-h-[360px] w-full min-w-0 items-center justify-center rounded-lg border border-slate-800 bg-slate-950/55 p-4 text-center text-xs text-slate-500">
        Loading map tools...
      </div>
    )
  }

  if (!center) {
    const addressLabel = data.selectedAddressLabel || data.addressText
    const hasAddr = Boolean(addressLabel?.trim())
    return (
      <div className="flex min-h-[360px] w-full min-w-0 flex-col gap-4 rounded-lg border border-dashed border-slate-700/60 bg-slate-950/55 p-4">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-slate-600" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">Awaiting pin</span>
        </div>
        {hasAddr ? (
          <>
            <p className="text-sm leading-5 text-slate-400">{addressLabel}</p>
            <p className="text-xs text-slate-600">
              Select a Places suggestion above to capture coordinates and enable the map preview.
            </p>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-center text-xs text-slate-600">
              Enter an address and select a suggestion to capture coordinates and preview a map pin.
            </p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="w-full min-w-0 overflow-hidden rounded-lg border border-cyan-900/50 bg-slate-950 shadow-[0_18px_42px_rgba(2,6,23,0.32)]">
      <div className="flex items-center justify-between gap-3 border-b border-cyan-950/70 bg-slate-950/95 px-4 py-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-400/80">
            Satellite roof preview
          </p>
          <p className="mt-1 max-w-full truncate text-xs text-slate-400">
            {data.selectedAddressLabel || data.addressText || 'Selected address'}
          </p>
        </div>
        <div className="shrink-0 rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-200">
          ~500 ft view
        </div>
      </div>
      <div
        className="relative h-[360px] min-h-[360px] w-full min-w-0 overflow-hidden bg-slate-900 sm:h-[420px]"
        style={{ minHeight: 360 }}
      >
        <GoogleMap
          mapContainerStyle={{ width: '100%', height: '100%' }}
          mapContainerClassName="absolute inset-0 h-full w-full"
          center={center}
          zoom={roofMapZoom}
          options={roofMapOptions}
          onLoad={(map) => {
            const mapsApi = window.google?.maps
            mapRef.current = map
            map.setMapTypeId(mapsApi?.MapTypeId?.HYBRID ?? 'hybrid')
            map.setTilt(0)
            map.setHeading(0)
            map.setZoom(roofMapZoom)
          }}
          onUnmount={() => {
            mapRef.current = null
          }}
        >
          <MarkerF
            position={center}
            title="Solar estimate address"
            zIndex={1000}
            options={{ clickable: false, optimized: false, zIndex: 1000 }}
          />
        </GoogleMap>
      </div>
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
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 items-start">
      <div className="min-w-0">
        <SectionIntro icon={MapPin} eyebrow="Step 01" title="Start with the project address">
          Enter the homeowner address. If the existing Google Places loader is configured, suggestions
          can capture a place ID and coordinates for a local map preview.
        </SectionIntro>

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

          <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
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
      </div>

      <div className="min-w-0">
      <AddressMapPreview data={data} />
    </div>
    </div>
  )
}

function HomeDetailsStep({ data, updateField }: { data: SolarEstimateData; updateField: UpdateField }) {
  const [showApplianceSelector, setShowApplianceSelector] = useState(false)
  const selectedApplianceSummaries = getSelectedApplianceSummaries(data.selectedAppliances)
  const selectedApplianceSummary =
    selectedApplianceSummaries.length > 0
      ? selectedApplianceSummaries.join(', ')
      : 'No heavy-load appliances selected'

  const toggleAppliance = (appliance: SolarEstimateAppliance) => {
    const nextAppliances = data.selectedAppliances.some(item => item.id === appliance)
      ? data.selectedAppliances.filter(item => item.id !== appliance)
      : [...data.selectedAppliances, { id: appliance }]

    updateField('selectedAppliances', nextAppliances)
  }

  const updateApplianceAmps = (appliance: SolarEstimateAppliance, value: string) => {
    const amps = parsePositiveNumber(value)
    updateField(
      'selectedAppliances',
      data.selectedAppliances.map(item =>
        item.id === appliance ? { ...item, ...(amps == null ? { amps: undefined } : { amps }) } : item
      )
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 items-start">
      <div className="min-w-0 space-y-5">
        <SectionIntro icon={Home} eyebrow="Step 02" title="Qualify the home details">
          Capture the roof and property basics that will shape assumptions in the later estimate phase.
        </SectionIntro>

        <div className="space-y-5">
          <div>
            <FieldLabel>Roof shading</FieldLabel>
            <div className="mt-2 grid gap-3 xl:grid-cols-3">
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

      <div className="min-w-0">
        <div className="rounded-xl border border-slate-800 bg-slate-950/45 p-4 shadow-[0_18px_60px_rgba(8,47,73,0.12)]">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <FieldLabel>Home Configuration</FieldLabel>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Add the main breaker and major electrical loads so the review captures upgrade-relevant details.
              </p>
            </div>
            <div className="rounded-full border border-cyan-500/25 bg-cyan-950/25 px-3 py-1 text-xs font-semibold text-cyan-200">
              {selectedApplianceSummaries.length} selected
            </div>
          </div>

          <div>
            <FieldLabel>Current main breaker size</FieldLabel>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {MAIN_BREAKER_SIZE_OPTIONS.map(option => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => updateField('mainBreakerSize', option.id as MainBreakerSize)}
                  className={optionCardClass(data.mainBreakerSize === option.id)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-cyan-300" />
                      <p className="text-sm font-semibold text-slate-100">{option.label}</p>
                    </div>
                    {data.mainBreakerSize === option.id && (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-cyan-300" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="relative mt-5">
            <button
              type="button"
              onClick={() => setShowApplianceSelector(open => !open)}
              className="flex w-full flex-col gap-3 rounded-lg border border-cyan-500/30 bg-gradient-to-br from-slate-950 via-slate-950 to-cyan-950/30 p-4 text-left transition-colors hover:border-cyan-400/60 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-start gap-3">
                <div className="rounded-md border border-cyan-500/30 bg-cyan-950/35 p-2 text-cyan-200">
                  <PlugZap className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-100">Select appliances / heavy loads</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{selectedApplianceSummary}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">
                {selectedApplianceSummaries.length} selected
                <ChevronRight
                  className={`h-4 w-4 transition-transform ${showApplianceSelector ? 'rotate-90' : ''}`}
                />
              </div>
            </button>

            {showApplianceSelector && (
              <div className="mt-3 max-h-[520px] overflow-y-auto overflow-x-hidden rounded-xl border border-cyan-500/25 bg-slate-950/95 p-4 shadow-[0_24px_80px_rgba(8,47,73,0.28)] backdrop-blur">
                <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm font-semibold text-slate-100">Appliances and heavy loads</p>
                  <p className="text-xs text-slate-500">Select all that apply, then add estimated amps.</p>
                </div>
                <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {APPLIANCE_OPTIONS.map(option => {
                    const Icon = APPLIANCE_ICON_MAP[option.id]
                    const selectedAppliance = data.selectedAppliances.find(item => item.id === option.id)
                    const isSelected = Boolean(selectedAppliance)

                    return (
                      <div
                        key={option.id}
                        className={`min-w-0 rounded-lg border p-3 text-left transition-colors ${
                          isSelected
                            ? 'border-cyan-400/70 bg-cyan-950/55 ring-1 ring-cyan-400/20'
                            : 'border-slate-800 bg-slate-900/60 hover:border-cyan-700/60 hover:bg-slate-900'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => toggleAppliance(option.id)}
                          className="flex w-full min-w-0 items-start justify-between gap-3 text-left"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="rounded-md border border-slate-700 bg-slate-950/70 p-2 text-cyan-200">
                              <Icon className="h-4 w-4" />
                            </div>
                            <p className="min-w-0 text-sm font-semibold text-slate-100">{option.label}</p>
                          </div>
                          {isSelected && <CheckCircle2 className="h-4 w-4 shrink-0 text-cyan-300" />}
                        </button>

                        {isSelected && (
                          <label className="mt-3 block">
                            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                              Amps
                            </span>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              inputMode="numeric"
                              value={selectedAppliance?.amps ?? ''}
                              onChange={event => updateApplianceAmps(option.id, event.target.value)}
                              className="mt-1 w-full rounded-md border border-slate-700/80 bg-slate-950/75 px-3 py-2 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-cyan-500/70 focus:ring-1 focus:ring-cyan-500/30"
                              placeholder="30"
                            />
                          </label>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
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
        Select the utility, rate plan, and consumption method. The estimate summary will use these
        inputs to model monthly usage and bill comparisons.
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
        Select solar-only or solar plus battery, then set a target offset. The estimate summary will
        model bill impact and system size from these inputs.
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
        <FieldLabel hint="Carried into the estimate summary">Target solar offset</FieldLabel>
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

function MetricCard({
  label,
  value,
  detail,
  Icon,
  tone = 'cyan',
}: {
  label: string
  value: string
  detail: string
  Icon: React.ComponentType<{ className?: string }>
  tone?: 'cyan' | 'emerald' | 'amber' | 'blue'
}) {
  const toneClass = {
    cyan: 'border-cyan-700/50 bg-cyan-950/20 text-cyan-200',
    emerald: 'border-emerald-700/50 bg-emerald-950/20 text-emerald-200',
    amber: 'border-amber-700/50 bg-amber-950/20 text-amber-200',
    blue: 'border-blue-700/50 bg-blue-950/20 text-blue-200',
  }[tone]

  return (
    <div className={`rounded-lg border p-4 ${toneClass}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-2xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
    </div>
  )
}

function BillComparisonChart({
  monthlyBreakdown,
  hasBattery,
}: {
  monthlyBreakdown: ReturnType<typeof calculateNEM3Savings>['monthly_breakdown']
  hasBattery: boolean
}) {
  const [tooltip, setTooltip] = useState<ChartTooltip | null>(null)
  const maxBill = Math.max(1, ...monthlyBreakdown.map(m => m.bill_before_solar))
  const shortLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const fullLabels = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

  const W = 575
  const H = 170
  const padL = 30
  const padR = 20
  const padT = 7
  const padB = 16
  const chartW = W - padL - padR
  const chartH = H - padT - padB
  const monthW = chartW / 12
  const barW = Math.floor(monthW * 0.32)
  const afterFill = hasBattery ? 'rgba(52,211,153,0.82)' : 'rgba(251,191,36,0.82)'
  const afterSwatch = hasBattery ? 'rgba(52,211,153,0.90)' : 'rgba(251,191,36,0.90)'

  const yScale = (v: number) => padT + chartH - (v / maxBill) * chartH
  const baseY = yScale(0)

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xl font-semibold text-slate-100">Monthly bill comparison</p>
          <p className="text-lg text-slate-400">Before solar vs modeled post-solar</p>
        </div>
        <div className="flex gap-4 text-sm text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'rgba(100,116,139,0.75)' }} />
            Before
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: afterSwatch }} />
            After solar
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ minWidth: 320 }}
          aria-label="Monthly bill comparison chart"
        >
          {[0.25, 0.5, 0.75, 1].map((pct) => {
            const y = yScale(maxBill * pct)
            return (
              <g key={pct}>
                <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} />
                <text x={padL - 4} y={y + 3.5} textAnchor="end" fontSize={7} fill="#475569">
                  ${Math.round(maxBill * pct)}
                </text>
              </g>
            )
          })}
          <line x1={padL} y1={baseY} x2={W - padR} y2={baseY} stroke="rgba(255,255,255,0.09)" strokeWidth={0.5} />

          {monthlyBreakdown.map((month, i) => {
            const afterBill = hasBattery ? month.bill_after_solar_with_battery : month.bill_after_solar_no_battery
            const savings = month.bill_before_solar - afterBill
            const xBase = padL + i * monthW + monthW * 0.08
            const beforeH = Math.max(1, baseY - yScale(month.bill_before_solar))
            const afterH = Math.max(1, baseY - yScale(afterBill))
            const showTooltip = (event: React.MouseEvent) => {
              const position = getTooltipPosition(event)
              setTooltip({
                ...position,
                eyebrow: 'Monthly bill',
                title: fullLabels[i],
                rows: [
                  { label: 'Current monthly cost', value: formatMoney(month.bill_before_solar) },
                  { label: 'New projected cost', value: formatMoney(afterBill), tone: hasBattery ? 'emerald' : 'amber' },
                  { label: 'Monthly savings', value: formatMoney(savings), tone: 'cyan' },
                ],
              })
            }
            return (
              <g key={month.month}>
                <rect x={xBase} y={baseY - beforeH} width={barW} height={beforeH} fill="rgba(100,116,139,0.72)" rx={1} />
                <rect x={xBase + barW + 1} y={baseY - afterH} width={barW} height={afterH} fill={afterFill} rx={1} />
                <rect
                  x={xBase - 3}
                  y={padT}
                  width={barW * 2 + 7}
                  height={chartH}
                  fill="transparent"
                  onMouseEnter={showTooltip}
                  onMouseMove={showTooltip}
                  onMouseLeave={() => setTooltip(null)}
                />
                <text x={xBase + barW} y={H - 5} textAnchor="middle" fontSize={7.5} fill="#475569">
                  {shortLabels[i]}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
      <ChartHoverCard tooltip={tooltip} />
    </div>
  )
}

function ConsumptionProfileChart({
  monthlyKwh,
  annualProductionKwh,
}: {
  monthlyKwh: number
  annualProductionKwh: number
}) {
  const annualConsumptionKwh = monthlyKwh * 12
  const maxValue = Math.max(annualConsumptionKwh, annualProductionKwh, 1)
  const consumptionPct = (annualConsumptionKwh / maxValue) * 100
  const productionPct = (annualProductionKwh / maxValue) * 100
  const offset = annualConsumptionKwh > 0 ? Math.min(125, (annualProductionKwh / annualConsumptionKwh) * 100) : 0

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/45 p-4">
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-100">Consumption profile</p>
          <p className="text-xs text-slate-500">Estimated annual load compared with modeled production</p>
        </div>
        <p className="text-xs font-semibold text-cyan-200">{Math.round(offset)}% modeled offset</p>
      </div>

      <div className="space-y-4">
        <div>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-slate-400">Annual consumption</span>
            <span className="font-medium text-slate-200">{formatNumber(annualConsumptionKwh)} kWh</span>
          </div>
          <div className="h-3 rounded-full bg-slate-800">
            <div className="h-3 rounded-full bg-blue-400/75" style={{ width: `${consumptionPct}%` }} />
          </div>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-slate-400">Annual solar production</span>
            <span className="font-medium text-yellow-200">{formatNumber(annualProductionKwh)} kWh</span>
          </div>
          <div className="h-3 rounded-full bg-slate-800">
            <div className="h-3 rounded-full bg-yellow-300/80" style={{ width: `${productionPct}%` }} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// SUMMARY CHART MODULE — 6 subtabs
// ============================================================================

function ChartNote({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-[10px] leading-4 text-slate-600">{children}</p>
}

type ChartTooltipTone = 'cyan' | 'emerald' | 'amber'

type ChartTooltipRow = {
  label: string
  value: string
  tone?: ChartTooltipTone
}

type ChartTooltip = {
  x: number
  y: number
  title: string
  rows: ChartTooltipRow[]
  eyebrow?: string
}

function getTooltipPosition(event: React.MouseEvent): { x: number; y: number } {
  const width = 260
  const height = 190
  const viewportWidth = window.innerWidth || 1024
  const viewportHeight = window.innerHeight || 768
  return {
    x: Math.max(12, Math.min(event.clientX + 14, viewportWidth - width - 12)),
    y: Math.max(12, Math.min(event.clientY + 14, viewportHeight - height - 12)),
  }
}

function ChartHoverCard({ tooltip }: { tooltip: ChartTooltip | null }) {
  if (!tooltip) return null

  const toneClass: Record<ChartTooltipTone, string> = {
    cyan: 'text-cyan-200',
    emerald: 'text-emerald-200',
    amber: 'text-amber-200',
  }

  return (
    <div
      className="pointer-events-none fixed z-[80] w-[260px] rounded-lg border border-cyan-700/35 bg-slate-950/95 p-3 text-xs shadow-xl shadow-black/30 backdrop-blur"
      style={{ left: tooltip.x, top: tooltip.y }}
    >
      {tooltip.eyebrow && (
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-300/80">
          {tooltip.eyebrow}
        </p>
      )}
      <p className="mb-2 font-semibold text-slate-100">{tooltip.title}</p>
      <div className="space-y-1.5">
        {tooltip.rows.map(row => (
          <div key={row.label} className="flex items-start justify-between gap-3">
            <span className="text-slate-500">{row.label}</span>
            <span className={`text-right font-semibold ${row.tone ? toneClass[row.tone] : 'text-slate-200'}`}>
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function EnergyFlow24hChart({
  monthlyKwh,
  solarSizeKw,
  hasBattery,
  ratePlan,
}: {
  monthlyKwh: number
  solarSizeKw: number
  hasBattery: boolean
  ratePlan: RatePlan
}) {
  const [tooltip, setTooltip] = useState<ChartTooltip | null>(null)
  const hours = generate24hProfile(monthlyKwh, solarSizeKw)
  const touSchedule = TOU_RATE_SCHEDULES[ratePlan]
  const rawMax = Math.max(1, ...hours.map(h => Math.max(h.load, h.solar)))
  const maxVal = rawMax * 1.15

  const W = 575; const H = 170; const pL = 42; const pR = 32; const pT = 7; const pB = 16
  const cW = W - pL - pR; const cH = H - pT - pB
  const xOf = (h: number) => pL + (h / 23) * cW
  const yOf = (v: number) => pT + cH - (v / maxVal) * cH
  const baseY = pT + cH

  const solarFill = [
    `M${xOf(0)},${baseY}`,
    ...hours.map(h => `L${xOf(h.hour).toFixed(1)},${yOf(h.solar).toFixed(1)}`),
    `L${xOf(23)},${baseY}`,
    'Z',
  ].join(' ')

  const loadPath = hours
    .map((h, i) => `${i === 0 ? 'M' : 'L'}${xOf(h.hour).toFixed(1)},${yOf(h.load).toFixed(1)}`)
    .join(' ')

  const hourLabels = [0, 6, 12, 18, 23]
  const hourText = (h: number) =>
    h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`
  const periodText = (period: string) => period.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase())

  const peakSolar = Math.max(...hours.map(h => h.solar))
  const peakLoad = Math.max(...hours.map(h => h.load))

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xl font-semibold text-slate-100">24-Hour Energy Flow</p>
          <p className="text-lg text-slate-400">Solar production vs. modeled load profile</p>
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-7 rounded-sm" style={{ background: 'rgba(251,191,36,0.45)' }} />
            Solar
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-1 w-6 rounded-full bg-blue-400/80" />
            Load
          </span>
          {hasBattery && (
            <span className="flex items-center gap-1 text-sm text-emerald-400/70">
              <BatteryCharging className="h-3 w-3" /> Battery mode
            </span>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 300 }}>
          {[0.25, 0.5, 0.75, 1].map(p => (
            <line
              key={p}
              x1={pL} y1={yOf(maxVal * p)}
              x2={W - pR} y2={yOf(maxVal * p)}
              stroke="rgba(255,255,255,0.05)"
              strokeWidth={0.5}
            />
          ))}
          <line x1={xOf(12)} y1={pT} x2={xOf(12)} y2={baseY} stroke="rgba(251,191,36,0.10)" strokeWidth={1} strokeDasharray="2,4" />
          <path d={solarFill} fill="rgba(251,191,36,0.30)" />
          <path d={loadPath} fill="none" stroke="rgba(96,165,250,0.85)" strokeWidth={1.5} strokeLinejoin="round" />
          {hourLabels.map(h => (
            <text key={h} x={xOf(h)} y={H - 5} textAnchor="middle" fontSize={7.5} fill="#475569">
              {hourText(h)}
            </text>
          ))}
          <text x={pL - 4} y={yOf(maxVal * 0.75) + 3} textAnchor="end" fontSize={6.5} fill="#475569">kWh</text>
          {peakSolar > 0 && (
            <text x={xOf(14)} y={yOf(peakSolar * 0.55)} textAnchor="start" fontSize={6.5} fill="rgba(52,211,153,0.65)">↑ export</text>
          )}
          {peakLoad > 0 && (
            <text x={xOf(6)} y={yOf(peakLoad * 0.4)} textAnchor="start" fontSize={6.5} fill="rgba(248,113,113,0.65)">↓ import</text>
          )}
          {hours.map(hour => {
            const touBlock = touSchedule?.hours[hour.hour]
            const showTooltip = (event: React.MouseEvent) => {
              const position = getTooltipPosition(event)
              const netLabel =
                hour.netExport > 0
                  ? `Export ${hour.netExport.toFixed(2)} kWh`
                  : `Import ${hour.netImport.toFixed(2)} kWh`
              setTooltip({
                ...position,
                eyebrow: '24H flow',
                title: hourText(hour.hour),
                rows: [
                  { label: 'Home load', value: `${hour.load.toFixed(2)} kWh` },
                  { label: 'Solar production', value: `${hour.solar.toFixed(2)} kWh`, tone: 'amber' },
                  { label: hasBattery ? 'Grid / battery context' : 'Grid import/export', value: hasBattery ? `${netLabel}; battery enabled` : netLabel, tone: hour.netExport > 0 ? 'emerald' : 'cyan' },
                  ...(touBlock
                    ? [
                        { label: 'TOU period', value: periodText(touBlock.period) },
                        { label: 'Import rate', value: `$${touBlock.import_rate.toFixed(2)}/kWh` },
                      ]
                    : []),
                ],
              })
            }
            return (
              <rect
                key={hour.hour}
                x={xOf(hour.hour) - cW / 48}
                y={pT}
                width={cW / 24}
                height={cH}
                fill="transparent"
                onMouseEnter={showTooltip}
                onMouseMove={showTooltip}
                onMouseLeave={() => setTooltip(null)}
              />
            )
          })}
        </svg>
      </div>
      <ChartHoverCard tooltip={tooltip} />
      <ChartNote>
        Modeled estimates. Daily load shape based on typical CA residential pattern. Solar uses simplified Gaussian production curve.
        {hasBattery ? ' Battery shifts self-consumption; dispatch not modeled here.' : ''}
      </ChartNote>
    </div>
  )
}

function TwentyFiveYearSavingsChart({
  annualBillBefore,
  annualBillAfter,
}: {
  annualBillBefore: number
  annualBillAfter: number
}) {
  const [tooltip, setTooltip] = useState<ChartTooltip | null>(null)
  const yearData = generate25YearData(annualBillBefore, annualBillAfter)
  const maxBill = Math.max(1, ...yearData.map(d => d.withoutSolar))

  const W = 575; const H = 170; const pL = 40; const pR = 20; const pT = 7; const pB = 16
  const cW = W - pL - pR; const cH = H - pT - pB
  const colW = cW / 25
  const barW = Math.max(3, Math.floor(colW * 0.35))
  const yOf = (v: number) => pT + cH - (v / maxBill) * cH
  const baseY = pT + cH

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xl font-semibold text-slate-100">25-Year Bill Savings</p>
          <p className="text-lg text-slate-400">Annual electric bill without solar vs. with solar</p>
        </div>
        <div className="flex gap-4 text-sm text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'rgba(100,116,139,0.70)' }} />
            Without solar
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'rgba(52,211,153,0.78)' }} />
            With solar
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 320 }}>
          {[0.25, 0.5, 0.75, 1].map(p => {
            const y = yOf(maxBill * p)
            return (
              <g key={p}>
                <line x1={pL} y1={y} x2={W - pR} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth={0.5} />
                <text x={pL - 4} y={y + 3.5} textAnchor="end" fontSize={7} fill="#475569">
                  ${Math.round(maxBill * p / 1000)}k
                </text>
              </g>
            )
          })}
          {yearData.map((d, i) => {
            const xBase = pL + i * colW + colW * 0.07
            const beforeH = Math.max(1, baseY - yOf(d.withoutSolar))
            const afterH = Math.max(1, baseY - yOf(d.withSolar))
            const showTooltip = (event: React.MouseEvent) => {
              const position = getTooltipPosition(event)
              setTooltip({
                ...position,
                eyebrow: '25 year savings',
                title: `Year ${d.year}`,
                rows: [
                  { label: 'Current projected cost', value: formatMoney(d.withoutSolar) },
                  { label: 'New projected cost', value: formatMoney(d.withSolar), tone: 'emerald' },
                  { label: 'Annual savings', value: formatMoney(d.savings), tone: 'cyan' },
                  { label: 'Cumulative savings', value: formatMoney(d.cumulative), tone: 'emerald' },
                ],
              })
            }
            return (
              <g key={d.year}>
                <rect x={xBase} y={baseY - beforeH} width={barW} height={beforeH} fill="rgba(100,116,139,0.62)" rx={1} />
                <rect x={xBase + barW + 1} y={baseY - afterH} width={barW} height={afterH} fill="rgba(52,211,153,0.75)" rx={1} />
                <rect
                  x={pL + i * colW}
                  y={pT}
                  width={colW}
                  height={cH}
                  fill="transparent"
                  onMouseEnter={showTooltip}
                  onMouseMove={showTooltip}
                  onMouseLeave={() => setTooltip(null)}
                />
                {d.year % 5 === 0 && (
                  <text x={xBase + barW} y={H - 5} textAnchor="middle" fontSize={7} fill="#475569">
                    Yr{d.year}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
      <ChartHoverCard tooltip={tooltip} />
      <ChartNote>
        Assumes {ESCALATION_RATE * 100}%/yr utility escalation; solar remainder escalates ~35% as fast (minimal fixed charges). Modeled estimate — not a financial projection.
      </ChartNote>
    </div>
  )
}

function CostOfElectricityChart({
  baseImportRate,
  systemCost,
  solarSizeKw,
  utility,
}: {
  baseImportRate: number
  systemCost: number
  solarSizeKw: number
  utility: Utility
}) {
  const [tooltip, setTooltip] = useState<ChartTooltip | null>(null)
  const peakSunHours = utility === 'IID' ? 6.2 : 5.5
  const annualProductionKwh = solarSizeKw * peakSunHours * 365 * 0.78
  const lcoe =
    systemCost > 0 && annualProductionKwh > 0
      ? systemCost / (annualProductionKwh * 25)
      : baseImportRate * 0.45

  const years = Array.from({ length: 20 }, (_, i) => ({
    year: i + 1,
    utilityRate: baseImportRate * Math.pow(1 + ESCALATION_RATE, i),
    solarRate: lcoe,
  }))

  const maxRate = Math.max(0.01, ...years.map(y => y.utilityRate)) * 1.15

  const W = 575; const H = 170; const pL = 40; const pR = 20; const pT = 7; const pB = 16
  const cW = W - pL - pR; const cH = H - pT - pB
  const xOf = (year: number) => pL + ((year - 1) / 19) * cW
  const yOf = (v: number) => pT + cH - (v / maxRate) * cH

  const utilityPath = years
    .map((y, i) => `${i === 0 ? 'M' : 'L'}${xOf(y.year).toFixed(1)},${yOf(y.utilityRate).toFixed(1)}`)
    .join(' ')
  const solarY = yOf(lcoe)

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xl font-semibold text-slate-100">Cost of Electricity — 20 Year View</p>
          <p className="text-lg text-slate-400">{utility} rate path vs. modeled solar LCOE</p>
        </div>
        <div className="flex gap-4 text-sm text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-1 w-6 rounded-full bg-slate-500/80" />
            Utility rate
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-1 w-6 rounded-full" style={{ background: 'rgba(251,191,36,0.85)' }} />
            Solar LCOE
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 300 }}>
          {[0.25, 0.5, 0.75, 1].map(p => {
            const y = yOf(maxRate * p)
            return (
              <g key={p}>
                <line x1={pL} y1={y} x2={W - pR} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth={0.5} />
                <text x={pL - 4} y={y + 3.5} textAnchor="end" fontSize={7} fill="#475569">
                  ${(maxRate * p).toFixed(2)}
                </text>
              </g>
            )
          })}
          <line
            x1={pL} y1={solarY}
            x2={W - pR} y2={solarY}
            stroke="rgba(251,191,36,0.72)"
            strokeWidth={1.5}
            strokeDasharray="5,3"
          />
          <text x={W - pR - 2} y={solarY - 4} textAnchor="end" fontSize={7} fill="rgba(251,191,36,0.85)">
            ~${lcoe.toFixed(3)}/kWh
          </text>
          <path d={utilityPath} fill="none" stroke="rgba(100,116,139,0.80)" strokeWidth={1.5} strokeLinejoin="round" />
          {years.map(year => {
            const showTooltip = (event: React.MouseEvent) => {
              const position = getTooltipPosition(event)
              const difference = year.utilityRate - year.solarRate
              setTooltip({
                ...position,
                eyebrow: 'Electric cost',
                title: `Year ${year.year}`,
                rows: [
                  { label: `${utility} utility path`, value: `$${year.utilityRate.toFixed(3)}/kWh` },
                  { label: 'Projected system path', value: `$${year.solarRate.toFixed(3)}/kWh`, tone: 'amber' },
                  { label: 'Difference', value: `$${difference.toFixed(3)}/kWh`, tone: difference >= 0 ? 'cyan' : undefined },
                  { label: 'Provider context', value: utility },
                ],
              })
            }
            return (
              <circle
                key={year.year}
                cx={xOf(year.year)}
                cy={yOf(year.utilityRate)}
                r={6}
                fill="transparent"
                onMouseEnter={showTooltip}
                onMouseMove={showTooltip}
                onMouseLeave={() => setTooltip(null)}
              />
            )
          })}
          {[1, 5, 10, 15, 20].map(y => (
            <text key={y} x={xOf(y)} y={H - 5} textAnchor="middle" fontSize={7} fill="#475569">
              Yr{y}
            </text>
          ))}
        </svg>
      </div>
      <ChartHoverCard tooltip={tooltip} />
      <ChartNote>
        LCOE = system cost ÷ (25-yr production in kWh). {utility} rate escalation: {ESCALATION_RATE * 100}%/yr modeled. Assumes flat module degradation of ~0.5%/yr.
      </ChartNote>
    </div>
  )
}

function CumulativeSavingsChart({
  annualBillBefore,
  annualBillAfter,
  systemCost,
}: {
  annualBillBefore: number
  annualBillAfter: number
  systemCost: number
}) {
  const [tooltip, setTooltip] = useState<ChartTooltip | null>(null)
  const yearData = generate25YearData(annualBillBefore, annualBillAfter)
  const maxCumulative = Math.max(1, yearData[24].cumulative) * 1.12
  const paybackIdx = yearData.findIndex(d => d.cumulative >= systemCost)
  const paybackYear = paybackIdx >= 0 ? yearData[paybackIdx].year : null

  const W = 575; const H = 170; const pL = 40; const pR = 20; const pT = 7; const pB = 16
  const cW = W - pL - pR; const cH = H - pT - pB
  const xOf = (year: number) => pL + ((year - 1) / 24) * cW
  const yOf = (v: number) => pT + cH - (v / maxCumulative) * cH
  const baseY = pT + cH

  const cumulativePath = yearData
    .map((d, i) => `${i === 0 ? 'M' : 'L'}${xOf(d.year).toFixed(1)},${yOf(d.cumulative).toFixed(1)}`)
    .join(' ')
  const cumulativeFill = [
    `M${xOf(1)},${baseY}`,
    ...yearData.map(d => `L${xOf(d.year).toFixed(1)},${yOf(d.cumulative).toFixed(1)}`),
    `L${xOf(25)},${baseY}`,
    'Z',
  ].join(' ')

  const costY = systemCost > 0 && systemCost < maxCumulative ? yOf(systemCost) : null

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xl font-semibold text-slate-100">Cumulative Savings — 25 Years</p>
          <p className="text-lg text-slate-400">Total modeled bill savings accumulated year by year</p>
        </div>
        {paybackYear !== null && (
          <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 px-3 py-1.5 text-sm font-semibold text-cyan-200">
            ~Yr {paybackYear} modeled payback
          </div>
        )}
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 300 }}>
          {[0.25, 0.5, 0.75, 1].map(p => {
            const y = yOf(maxCumulative * p)
            return (
              <g key={p}>
                <line x1={pL} y1={y} x2={W - pR} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth={0.5} />
                <text x={pL - 4} y={y + 3.5} textAnchor="end" fontSize={7} fill="#475569">
                  ${Math.round(maxCumulative * p / 1000)}k
                </text>
              </g>
            )
          })}
          {costY !== null && (
            <>
              <line x1={pL} y1={costY} x2={W - pR} y2={costY} stroke="rgba(248,113,113,0.45)" strokeWidth={1} strokeDasharray="3,3" />
              <text x={W - pR - 2} y={costY - 3} textAnchor="end" fontSize={6.5} fill="rgba(248,113,113,0.70)">
                System cost
              </text>
            </>
          )}
          <path d={cumulativeFill} fill="rgba(52,211,153,0.10)" />
          <path d={cumulativePath} fill="none" stroke="rgba(52,211,153,0.82)" strokeWidth={1.5} strokeLinejoin="round" />
          {paybackYear !== null && costY !== null && (
            <circle cx={xOf(paybackYear)} cy={costY} r={3} fill="rgba(52,211,153,0.85)" />
          )}
          {yearData.map(d => {
            const showTooltip = (event: React.MouseEvent) => {
              const position = getTooltipPosition(event)
              const hasReachedPayback = paybackYear !== null && d.year >= paybackYear
              setTooltip({
                ...position,
                eyebrow: 'Cumulative',
                title: `Year ${d.year}`,
                rows: [
                  { label: 'Annual savings', value: formatMoney(d.savings), tone: 'cyan' },
                  { label: 'Cumulative savings', value: formatMoney(d.cumulative), tone: 'emerald' },
                  { label: 'Payback note', value: hasReachedPayback ? `At/after modeled payback year ${paybackYear}` : paybackYear ? `Before modeled payback year ${paybackYear}` : 'Modeled payback not reached' },
                ],
              })
            }
            return (
              <circle
                key={d.year}
                cx={xOf(d.year)}
                cy={yOf(d.cumulative)}
                r={6}
                fill="transparent"
                onMouseEnter={showTooltip}
                onMouseMove={showTooltip}
                onMouseLeave={() => setTooltip(null)}
              />
            )
          })}
          {[1, 5, 10, 15, 20, 25].map(y => (
            <text key={y} x={xOf(y)} y={H - 5} textAnchor="middle" fontSize={7} fill="#475569">
              Yr{y}
            </text>
          ))}
        </svg>
      </div>
      <ChartHoverCard tooltip={tooltip} />
      <ChartNote>
        Cumulative bill savings vs. no-solar baseline. System cost line shown as rough payback reference. Not a financial guarantee or projection.
      </ChartNote>
    </div>
  )
}

function PaymentComparisonChart({
  avgBeforeBill,
  avgAfterBill,
  systemCost,
  hasBattery,
}: {
  avgBeforeBill: number
  avgAfterBill: number
  systemCost: number
  hasBattery: boolean
}) {
  const loanPayment = getMonthlyLoanPayment(systemCost)
  const netMonthly = avgAfterBill + loanPayment
  const maxVal = Math.max(1, avgBeforeBill, netMonthly) * 1.15

  const bars: Array<{ label: string; sublabel: string; value: number; color: string; textColor: string }> = [
    {
      label: 'No Solar',
      sublabel: 'Current avg monthly bill',
      value: avgBeforeBill,
      color: 'rgba(100,116,139,0.75)',
      textColor: 'text-slate-400',
    },
    {
      label: 'New Electric Bill',
      sublabel: 'After solar applied',
      value: avgAfterBill,
      color: hasBattery ? 'rgba(52,211,153,0.80)' : 'rgba(251,191,36,0.80)',
      textColor: hasBattery ? 'text-emerald-300' : 'text-amber-300',
    },
    {
      label: 'Loan Payment',
      sublabel: '25 yr @ 6.99% APR',
      value: loanPayment,
      color: 'rgba(96,165,250,0.75)',
      textColor: 'text-blue-300',
    },
    {
      label: 'Total w/ Solar',
      sublabel: 'Electric bill + loan',
      value: netMonthly,
      color: 'rgba(167,139,250,0.75)',
      textColor: 'text-violet-300',
    },
  ]

  return (
    <div className="min-h-[240px] rounded-lg border border-slate-800 bg-slate-950/60 p-4">
      <div className="mb-4">
        <p className="text-xl font-semibold text-slate-100">Payment Comparison</p>
        <p className="text-lg text-slate-400">Modeled monthly cost breakdown — not a financing offer</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {bars.map(bar => {
          const pct = Math.min(100, (bar.value / maxVal) * 100)
          return (
            <div key={bar.label} className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                {bar.label}
              </p>
              <p className="mt-3 text-xl font-semibold text-white">
                {formatMoney(bar.value)}
                <span className="text-xs font-normal text-slate-500">/mo</span>
              </p>
              <div className="mt-8 h-2 rounded-full bg-slate-800">
                <div
                  className="h-2 rounded-full transition-all"
                  style={{ width: `${pct}%`, background: bar.color }}
                />
              </div>
              <p className={`mt-2 text-xs ${bar.textColor}`}>{bar.sublabel}</p>
            </div>
          )
        })}
      </div>
      <p className="mt-3 text-[10px] leading-4 text-slate-600">
        Loan modeled at 25-year term, 6.99% APR, full financed system cost. Actual financing terms, rates, and down payment will vary. This is not a financing offer or disclosure.
      </p>
    </div>
  )
}

function SummaryChartModule({
  nemResult,
  hasBattery,
  monthlyKwh,
  solarSizeKw,
  avgBeforeBill,
  avgAfterBill,
  systemCost,
  utility,
  ratePlan,
}: {
  nemResult: ReturnType<typeof calculateNEM3Savings>
  hasBattery: boolean
  monthlyKwh: number
  solarSizeKw: number
  avgBeforeBill: number
  avgAfterBill: number
  systemCost: number
  utility: Utility
  ratePlan: RatePlan
}) {
  const [activeChart, setActiveChart] = useState<ChartTab>('monthly_bill')

  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-slate-800 bg-slate-950/60">
      <div className="flex flex-wrap border-b border-slate-800 bg-slate-900/40">
        {CHART_TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveChart(tab.id)}
            className={`whitespace-nowrap px-5 py-3 text-sm font-semibold transition-colors ${
              activeChart === tab.id
                ? 'border-b-2 border-cyan-400 bg-cyan-950/20 text-cyan-200'
                : 'text-slate-500 hover:bg-slate-900/60 hover:text-slate-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="p-4">
        {activeChart === 'monthly_bill' && (
          <BillComparisonChart monthlyBreakdown={nemResult.monthly_breakdown} hasBattery={hasBattery} />
        )}
        {activeChart === 'energy_flow_24h' && (
          <EnergyFlow24hChart monthlyKwh={monthlyKwh} solarSizeKw={solarSizeKw} hasBattery={hasBattery} ratePlan={ratePlan} />
        )}
        {activeChart === 'yr25_savings' && (
          <TwentyFiveYearSavingsChart
            annualBillBefore={avgBeforeBill * 12}
            annualBillAfter={avgAfterBill * 12}
          />
        )}
        {activeChart === 'cost_electricity' && (
          <CostOfElectricityChart
            baseImportRate={getAverageImportRate(ratePlan)}
            systemCost={systemCost}
            solarSizeKw={solarSizeKw}
            utility={utility}
          />
        )}
        {activeChart === 'cumulative_savings' && (
          <CumulativeSavingsChart
            annualBillBefore={avgBeforeBill * 12}
            annualBillAfter={avgAfterBill * 12}
            systemCost={systemCost}
          />
        )}
        {activeChart === 'payment_comparison' && (
          <PaymentComparisonChart
            avgBeforeBill={avgBeforeBill}
            avgAfterBill={avgAfterBill}
            systemCost={systemCost}
            hasBattery={hasBattery}
          />
        )}
      </div>
    </div>
  )
}

function SolarEstimatesLibrary({
  estimates,
  activeEstimateId,
  onOpen,
  onDelete,
  onRename,
  onClose,
}: {
  estimates: LocalSolarEstimate[]
  activeEstimateId: string | null
  onOpen: (estimate: LocalSolarEstimate) => void
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
  onClose: () => void
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const startRename = (estimate: LocalSolarEstimate) => {
    setRenamingId(estimate.id)
    setRenameValue(estimate.name)
  }

  const commitRename = (id: string) => {
    const trimmed = renameValue.trim()
    if (trimmed) onRename(id, trimmed)
    setRenamingId(null)
  }

  const sorted = [...estimates].reverse()

  return (
    <div className="mt-5 rounded-lg border border-cyan-800/50 bg-slate-900/80 p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-300">
          <ClipboardList className="h-3.5 w-3.5" />
          Solar Estimates
          {estimates.length > 0 && (
            <span className="rounded-full bg-cyan-900/60 px-2 py-0.5 text-[10px] text-cyan-400">
              {estimates.length}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200"
        >
          <X className="h-3 w-3" />
          Close
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700/60 bg-slate-950/40 py-8 text-center">
          <p className="text-sm text-slate-500">No saved estimates yet.</p>
          <p className="mt-1 text-xs text-slate-600">
            Complete the interview and click &ldquo;Save project estimate&rdquo; to save here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map(estimate => {
            const isActive = estimate.id === activeEstimateId
            const updatedDate = new Date(estimate.updatedAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })
            return (
              <div
                key={estimate.id}
                className={`flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between ${
                  isActive
                    ? 'border-cyan-700/50 bg-cyan-950/20'
                    : 'border-slate-800 bg-slate-950/40'
                }`}
              >
                <div className="min-w-0 flex-1">
                  {renamingId === estimate.id ? (
                    <input
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => commitRename(estimate.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(estimate.id)
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                      autoFocus
                      className={`${FIELD_CLASS} text-sm`}
                    />
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        {isActive && (
                          <span className="shrink-0 rounded-full bg-cyan-900/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-cyan-400">
                            Open
                          </span>
                        )}
                        <p className="truncate text-sm font-semibold text-slate-100">{estimate.name}</p>
                      </div>
                      {estimate.addressLabel && (
                        <p className="mt-0.5 truncate text-xs text-slate-500">{estimate.addressLabel}</p>
                      )}
                      <p className="mt-0.5 text-[10px] text-slate-600">Updated {updatedDate}</p>
                    </>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onOpen(estimate)}
                    className="rounded-md border border-cyan-700/50 bg-cyan-900/20 px-2.5 py-1.5 text-xs font-semibold text-cyan-200 transition-colors hover:border-cyan-600 hover:bg-cyan-900/40"
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    onClick={() => startRename(estimate)}
                    className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(estimate.id)}
                    className="rounded-md border border-red-800/40 bg-red-950/20 px-2.5 py-1.5 text-xs font-semibold text-red-400 transition-colors hover:border-red-700/60 hover:bg-red-950/40"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function EstimateSummaryStep({
  data,
  updateField,
  goToStep,
  solarSizeKw,
  batterySizeKwh,
  setSolarSizeKw,
  setBatterySizeKwh,
  onSave,
  activeEstimateId,
  saveStatus,
}: {
  data: SolarEstimateData
  updateField: UpdateField
  goToStep: (step: EstimateStep) => void
  solarSizeKw: number
  batterySizeKwh: number
  setSolarSizeKw: React.Dispatch<React.SetStateAction<number>>
  setBatterySizeKwh: React.Dispatch<React.SetStateAction<number>>
  onSave: () => void
  activeEstimateId: string | null
  saveStatus: 'idle' | 'saved'
}) {
  const ratePlanLabel = data.utilityProvider
    ? findLabel(RATE_PLANS_BY_UTILITY[data.utilityProvider], data.ratePlan)
    : 'Not selected'
  const utility = (data.utilityProvider ?? 'SCE') as Utility
  const ratePlan = (data.ratePlan ?? (utility === 'IID' ? 'IID_STANDARD' : 'SCE_TOU_D_PRIME')) as RatePlan
  const hasBattery = data.systemMode === 'solar_plus_battery'
  const monthlyKwh = estimateMonthlyKwh(data)
  const systemCost = estimateSystemCost(solarSizeKw, batterySizeKwh, hasBattery)
  const nemResult = calculateNEM3Savings({
    monthly_kwh: monthlyKwh,
    utility,
    rate_plan: ratePlan,
    system_size_kw: solarSizeKw,
    battery_kwh: hasBattery ? batterySizeKwh : 0,
    panel_wattage: 420,
    monthly_bill: data.averageMonthlyBill ?? undefined,
    system_cost: systemCost,
  })
  const savings = hasBattery ? nemResult.with_battery : nemResult.without_battery
  const avgBeforeBill =
    nemResult.monthly_breakdown.reduce((total, month) => total + month.bill_before_solar, 0) /
    nemResult.monthly_breakdown.length
  const avgAfterBill =
    nemResult.monthly_breakdown.reduce(
      (total, month) =>
        total + (hasBattery ? month.bill_after_solar_with_battery : month.bill_after_solar_no_battery),
      0
    ) / nemResult.monthly_breakdown.length
  const monthlySavings = Math.max(0, avgBeforeBill - avgAfterBill)
  const independence = Math.round(clamp(savings.self_consumption_ratio * 100, 0, 100))
  const breakerSizeLabel = findLabel(MAIN_BREAKER_SIZE_OPTIONS, data.mainBreakerSize)
  const selectedApplianceLabels = getSelectedApplianceSummaries(data.selectedAppliances)
  const applianceSummary =
    selectedApplianceLabels.length > 0 ? selectedApplianceLabels.join(', ') : 'None selected'

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
      <SectionIntro icon={BarChart3} eyebrow="Step 05" title="Estimate summary">
        This is a conservative planning estimate from the interview inputs. It is not a final quote,
        interconnection study, financing disclosure, or guaranteed utility bill outcome.
      </SectionIntro>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        {saveStatus === 'saved' ? (
          <div className="flex items-center gap-2 rounded-md border border-emerald-700/50 bg-emerald-950/20 px-3 py-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-xs font-medium text-emerald-300">Saved in Solar Estimates</span>
          </div>
        ) : (
          <div />
        )}
        <button
          type="button"
          onClick={onSave}
          className="rounded-md border border-cyan-700/50 bg-cyan-900/20 px-3 py-2 text-xs font-semibold text-cyan-200 transition-colors hover:border-cyan-600 hover:bg-cyan-900/40"
        >
          {activeEstimateId ? 'Update estimate' : 'Save project estimate'}
        </button>
      </div>

      <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="System size"
          value={`${solarSizeKw.toFixed(1)} kW`}
          detail={`420 W panels, about ${nemResult.system_info.panel_count} modules`}
          Icon={SunMedium}
          tone="amber"
        />
        <MetricCard
          label="Estimated cost"
          value={formatMoney(systemCost)}
          detail="Rough installed cost before site-specific adjustments"
          Icon={DollarSign}
          tone="cyan"
        />
        <MetricCard
          label="Monthly savings"
          value={formatMoney(monthlySavings)}
          detail={`${formatMoney(avgBeforeBill)} to ${formatMoney(avgAfterBill)} modeled average bill`}
          Icon={Zap}
          tone="emerald"
        />
        <MetricCard
          label="Energy independence"
          value={`${independence}%`}
          detail="Modeled self-consumption ratio under NEM 3.0"
          Icon={Gauge}
          tone="blue"
        />
      </div>

      <div className="mb-5 rounded-lg border border-cyan-700/40 bg-cyan-950/20 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-cyan-100">Rate recommendation</p>
            <p className="mt-1 text-sm leading-6 text-slate-400">{getRateRecommendation(data)}</p>
          </div>
          <div className="shrink-0 rounded-md border border-cyan-500/30 bg-slate-950/50 px-3 py-2 text-xs font-semibold text-cyan-200">
            {ratePlanLabel}
          </div>
        </div>
      </div>

      <SummaryChartModule
        nemResult={nemResult}
        hasBattery={hasBattery}
        monthlyKwh={monthlyKwh}
        solarSizeKw={solarSizeKw}
        avgBeforeBill={avgBeforeBill}
        avgAfterBill={avgAfterBill}
        systemCost={systemCost}
        utility={utility}
        ratePlan={ratePlan}
      />

      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
        <ClipboardList className="h-3.5 w-3.5" />
        Interview inputs
      </div>
      <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ReviewRow label="Address" value={data.selectedAddressLabel || data.addressText || 'Not entered'} />
        <ReviewRow label="Roof shading" value={findLabel(SHADING_OPTIONS, data.shading)} />
        <ReviewRow label="Ownership" value={findLabel(OWNERSHIP_OPTIONS, data.ownership)} />
        <ReviewRow label="Property type" value={findLabel(PROPERTY_TYPES, data.propertyType)} />
        <ReviewRow label="Main breaker size" value={breakerSizeLabel} />
        <ReviewRow label="Appliances / heavy loads" value={applianceSummary} />
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
        <ReviewRow label="Estimated usage" value={`${formatNumber(monthlyKwh)} kWh / month`} />
        <ReviewRow label="Target offset" value={`${data.targetOffset}%`} />
        <ReviewRow label="Suggested size" value={`${estimateSuggestedSystemSize(data).toFixed(1)} kW`} />
      </div>

      {hasBattery && (
        <div className="mb-5 rounded-lg border border-emerald-700/40 bg-emerald-950/15 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-300">
                <BatteryCharging className="h-4 w-4" />
                Battery backup estimate
              </div>
              <p className="text-sm leading-6 text-slate-300">
                {batterySizeKwh.toFixed(1)} kWh modeled storage, about{' '}
                {formatNumber(batterySizeKwh * 0.8, 1)} kWh usable after reserve and efficiency assumptions.
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Backup duration depends on selected circuits, HVAC use, weather, battery reserve settings, and
                final equipment design.
              </p>
            </div>
            <div className="rounded-md border border-emerald-500/30 bg-slate-950/50 px-3 py-2 text-sm font-semibold text-emerald-200">
              {formatMoney(nemResult.with_battery.tou_arbitrage_savings)} / yr TOU benefit
            </div>
          </div>
        </div>
      )}

      <div className="mb-5 rounded-lg border border-slate-800 bg-slate-950/45 p-4">
        <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
          <SlidersHorizontal className="h-4 w-4 text-cyan-300" />
          Editable system controls
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <FieldLabel>Solar size</FieldLabel>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                type="range"
                min="3"
                max="18"
                step="0.5"
                value={solarSizeKw}
                onChange={(event) => setSolarSizeKw(Number(event.target.value))}
                className="h-2 flex-1 accent-yellow-300"
              />
              <input
                type="number"
                min="0"
                step="0.1"
                value={solarSizeKw}
                onChange={(event) => setSolarSizeKw(clamp(Number(event.target.value) || 0, 0, 30))}
                className="w-28 rounded-md border border-slate-700/80 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500/70"
              />
              <span className="text-sm font-semibold text-yellow-200">kW</span>
            </div>
          </div>

          <div>
            <FieldLabel>Battery size</FieldLabel>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                type="range"
                min="0"
                max="40"
                step="1"
                value={hasBattery ? batterySizeKwh : 0}
                onChange={(event) => setBatterySizeKwh(Number(event.target.value))}
                disabled={!hasBattery}
                className="h-2 flex-1 accent-emerald-400 disabled:opacity-30"
              />
              <input
                type="number"
                min="0"
                step="0.5"
                value={hasBattery ? batterySizeKwh : 0}
                onChange={(event) => setBatterySizeKwh(clamp(Number(event.target.value) || 0, 0, 60))}
                disabled={!hasBattery}
                className="w-28 rounded-md border border-slate-700/80 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500/70 disabled:opacity-30"
              />
              <span className="text-sm font-semibold text-emerald-200">kWh</span>
            </div>
            {!hasBattery && (
              <p className="mt-2 text-xs text-slate-600">Select Solar Plus Battery above to enable battery sizing.</p>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {SYSTEM_MODES.map(option => (
            <button
              key={option.id}
              type="button"
              onClick={() => updateField('systemMode', option.id as SystemMode)}
              className={optionCardClass(data.systemMode === option.id)}
            >
              <p className="text-sm font-semibold text-slate-100">{option.label}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{option.detail}</p>
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSolarSizeKw(estimateSuggestedSystemSize(data))}
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-300 transition-colors hover:border-cyan-700 hover:text-cyan-200"
          >
            Reset to suggested size
          </button>
          <button
            type="button"
            onClick={() => goToStep('system_config')}
            className="rounded-md border border-cyan-700/50 bg-cyan-900/30 px-3 py-2 text-xs font-semibold text-cyan-200 transition-colors hover:border-cyan-600 hover:bg-cyan-900/50"
          >
            Edit system inputs
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-amber-700/40 bg-amber-950/10 p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
          <div>
            <p className="text-sm font-semibold text-amber-100">Assumptions and disclaimer</p>
            <p className="mt-1 text-sm leading-6 text-slate-400">
              Estimates use local interview inputs, the existing NEM 3.0 training calculator, 420 W panel
              assumptions, rough installed cost bands, average usage conversion, and simplified production
              modeling. Final design requires utility bill review, roof measurements, shade analysis,
              equipment selection, permitting, interconnection review, and finance terms.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function ActiveStepPanel({
  data,
  updateField,
  goToStep,
  solarSizeKw,
  batterySizeKwh,
  setSolarSizeKw,
  setBatterySizeKwh,
  onSave,
  activeEstimateId,
  saveStatus,
}: {
  data: SolarEstimateData
  updateField: UpdateField
  goToStep: (step: EstimateStep) => void
  solarSizeKw: number
  batterySizeKwh: number
  setSolarSizeKw: React.Dispatch<React.SetStateAction<number>>
  setBatterySizeKwh: React.Dispatch<React.SetStateAction<number>>
  onSave: () => void
  activeEstimateId: string | null
  saveStatus: 'idle' | 'saved'
}) {
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
      return (
        <EstimateSummaryStep
          data={data}
          updateField={updateField}
          goToStep={goToStep}
          solarSizeKw={solarSizeKw}
          batterySizeKwh={batterySizeKwh}
          setSolarSizeKw={setSolarSizeKw}
          setBatterySizeKwh={setBatterySizeKwh}
          onSave={onSave}
          activeEstimateId={activeEstimateId}
          saveStatus={saveStatus}
        />
      )
    default:
      return null
  }
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function SolarEstimateTab() {
  const [data, setData] = useState<SolarEstimateData>(() => {
    const draft = loadActiveDraft()
    return draft?.data ?? DEFAULT_ESTIMATE_DATA
  })
  const suggestedSystemSize = useMemo(() => estimateSuggestedSystemSize(data), [data])
  const [solarSizeKw, setSolarSizeKw] = useState<number>(() => {
    const draft = loadActiveDraft()
    return draft?.solarSizeKw ?? estimateSuggestedSystemSize(DEFAULT_ESTIMATE_DATA)
  })
  const [batterySizeKwh, setBatterySizeKwh] = useState<number>(() => {
    const draft = loadActiveDraft()
    return draft?.batterySizeKwh ?? 13.5
  })
  const [savedEstimates, setSavedEstimates] = useState<LocalSolarEstimate[]>(() => loadEstimates())
  const [activeEstimateId, setActiveEstimateId] = useState<string | null>(() => {
    const draft = loadActiveDraft()
    return draft?.estimateId ?? null
  })
  const [showLibrary, setShowLibrary] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle')
  const draftSaveTimer = useRef<number | null>(null)

  const currentStepIndex = ESTIMATE_STEPS.indexOf(data.currentStep)

  useEffect(() => {
    if (data.currentStep !== 'estimate_summary') {
      setSolarSizeKw(suggestedSystemSize)
    }
  }, [data.currentStep, suggestedSystemSize])

  useEffect(() => {
    if (draftSaveTimer.current) window.clearTimeout(draftSaveTimer.current)
    draftSaveTimer.current = window.setTimeout(() => {
      saveActiveDraft({ estimateId: activeEstimateId, data, solarSizeKw, batterySizeKwh })
    }, 500)
    return () => {
      if (draftSaveTimer.current) window.clearTimeout(draftSaveTimer.current)
    }
  }, [data, solarSizeKw, batterySizeKwh, activeEstimateId])

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

  const resetEstimate = useCallback(() => {
    setData(DEFAULT_ESTIMATE_DATA)
    setSolarSizeKw(estimateSuggestedSystemSize(DEFAULT_ESTIMATE_DATA))
    setBatterySizeKwh(13.5)
    setActiveEstimateId(null)
    setSaveStatus('idle')
  }, [])

  const handleSave = useCallback(() => {
    const now = new Date().toISOString()
    const addressLabel = data.selectedAddressLabel || data.addressText || ''
    if (activeEstimateId) {
      setSavedEstimates(prev => {
        const updated = prev.map(e =>
          e.id === activeEstimateId
            ? { ...e, updatedAt: now, addressLabel, interviewData: data, solarSizeKw, batterySizeKwh }
            : e
        )
        saveEstimates(updated)
        return updated
      })
    } else {
      const name = addressLabel
        ? addressLabel.split(',')[0].trim() || 'Solar Estimate'
        : `Solar Estimate ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      const newId = `se_${Date.now()}`
      const newEstimate: LocalSolarEstimate = {
        id: newId,
        createdAt: now,
        updatedAt: now,
        name,
        addressLabel,
        interviewData: data,
        solarSizeKw,
        batterySizeKwh,
      }
      setSavedEstimates(prev => {
        const updated = [...prev, newEstimate]
        saveEstimates(updated)
        return updated
      })
      setActiveEstimateId(newId)
    }
    setSaveStatus('saved')
    window.setTimeout(() => setSaveStatus('idle'), 3000)
  }, [data, solarSizeKw, batterySizeKwh, activeEstimateId])

  const handleOpenEstimate = useCallback((estimate: LocalSolarEstimate) => {
    setData({ ...estimate.interviewData, currentStep: 'estimate_summary' })
    setSolarSizeKw(estimate.solarSizeKw)
    setBatterySizeKwh(estimate.batterySizeKwh)
    setActiveEstimateId(estimate.id)
    setShowLibrary(false)
    setSaveStatus('idle')
  }, [])

  const handleDeleteEstimate = useCallback((id: string) => {
    setSavedEstimates(prev => {
      const updated = prev.filter(e => e.id !== id)
      saveEstimates(updated)
      return updated
    })
    if (activeEstimateId === id) setActiveEstimateId(null)
  }, [activeEstimateId])

  const handleRenameEstimate = useCallback((id: string, name: string) => {
    setSavedEstimates(prev => {
      const updated = prev.map(e =>
        e.id === id ? { ...e, name, updatedAt: new Date().toISOString() } : e
      )
      saveEstimates(updated)
      return updated
    })
  }, [])

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
              Walk through each step to collect the local interview inputs, then review a conservative
              estimate summary with editable system controls.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowLibrary(v => !v)}
              className={`rounded-md border px-3 py-2 text-xs font-semibold transition-colors ${
                showLibrary
                  ? 'border-cyan-600 bg-cyan-900/40 text-cyan-200'
                  : 'border-cyan-700/50 bg-cyan-900/20 text-cyan-300 hover:border-cyan-600 hover:bg-cyan-900/40'
              }`}
            >
              Solar Estimates{savedEstimates.length > 0 ? ` (${savedEstimates.length})` : ''}
            </button>
            <button
              type="button"
              onClick={resetEstimate}
              className="rounded-md border border-slate-700 bg-slate-900/50 px-3 py-2 text-xs font-semibold text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200"
            >
              Start new estimate
            </button>
          </div>
        </div>

        {showLibrary ? (
          <SolarEstimatesLibrary
            estimates={savedEstimates}
            activeEstimateId={activeEstimateId}
            onOpen={handleOpenEstimate}
            onDelete={handleDeleteEstimate}
            onRename={handleRenameEstimate}
            onClose={() => setShowLibrary(false)}
          />
        ) : (
          <>
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

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
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
              <ActiveStepPanel
                data={data}
                updateField={updateField}
                goToStep={goToStep}
                solarSizeKw={solarSizeKw}
                batterySizeKwh={batterySizeKwh}
                setSolarSizeKw={setSolarSizeKw}
                setBatterySizeKwh={setBatterySizeKwh}
                onSave={handleSave}
                activeEstimateId={activeEstimateId}
                saveStatus={saveStatus}
              />
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
          </>
        )}
      </div>
    </section>
  )
}
