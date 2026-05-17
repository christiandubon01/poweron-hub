import React, { useCallback, useState } from 'react'
import {
  BatteryCharging,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Home,
  MapPin,
  PlugZap,
  SunMedium,
} from 'lucide-react'
import {
  DEFAULT_ESTIMATE_DATA,
  ESTIMATE_STEPS,
  type EstimateStep,
  type SolarEstimateData,
} from '@/services/solarTraining/SolarEstimateTypes'

// ============================================================================
// STEP METADATA — visual labels and icons, ordered to match ESTIMATE_STEPS
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
    description:
      'Homeowner address input. Google Places autocomplete (already in app) will be wired in Phase 4.',
    Icon: MapPin,
  },
  {
    id: 'home_details',
    label: 'Home Details',
    description: 'Roof shading, ownership status, and property type.',
    Icon: Home,
  },
  {
    id: 'energy_use',
    label: 'Energy Use',
    description: 'Utility provider, rate plan, and monthly consumption.',
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
    label: 'Estimate Summary',
    description: 'Homeowner-facing summary. NEM 3.0 calculations wired in Phase 5.',
    Icon: ClipboardList,
  },
]

// ============================================================================
// COMPONENT
// ============================================================================

export default function SolarEstimateTab() {
  const [data, setData] = useState<SolarEstimateData>(DEFAULT_ESTIMATE_DATA)

  const currentStepIndex = ESTIMATE_STEPS.indexOf(data.currentStep)

  /**
   * Generic field updater — Phase 4 form screens wire their inputs to this.
   * Keeps all interview state in one place for easy handoff to Phase 5 summary.
   */
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

  const activeMeta = STEP_META[currentStepIndex]

  return (
    <section className="relative overflow-hidden rounded-lg border border-cyan-900/50 bg-slate-950/80 shadow-[0_0_40px_rgba(8,145,178,0.08)]">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/70 to-transparent" />
      <div className="absolute -right-24 -top-24 h-56 w-56 rounded-full bg-emerald-500/10 blur-3xl" />
      <div className="absolute -left-16 bottom-0 h-44 w-44 rounded-full bg-yellow-400/10 blur-3xl" />

      <div className="relative p-5 sm:p-6">
        {/* Header */}
        <div className="flex flex-col gap-4 border-b border-slate-800/90 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
              <SunMedium className="h-4 w-4 text-yellow-300" />
              Solar Estimate
            </div>
            <h2 className="text-xl font-semibold text-white">Homeowner Estimate Interview</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Walk through each step to build a solar estimate. Form inputs and the summary
              calculation engine are added in Phases 4 and 5.
            </p>
          </div>
          <div className="shrink-0 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-200">
            Phase 3 — Architecture ready
          </div>
        </div>

        {/* Progress bar */}
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

        {/* Step navigator cards */}
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

        {/* Active step placeholder — Phase 4 replaces this with form UI per step */}
        <div className="mt-5 rounded-lg border border-slate-700/50 bg-slate-900/50 p-5">
          <div className="flex items-center gap-2">
            {activeMeta && <activeMeta.Icon className="h-4 w-4 text-cyan-400" />}
            <p className="text-xs font-semibold uppercase tracking-widest text-cyan-400">
              {activeMeta?.label ?? '—'}
            </p>
          </div>
          <p className="mt-2 text-sm text-slate-400">
            Phase 4 will replace this area with form inputs for each interview step.
            State model and handlers are ready.
          </p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span className="text-slate-600">
              step:{' '}
              <span className="font-mono text-slate-400">{data.currentStep}</span>
            </span>
            <span className="text-slate-600">
              utility:{' '}
              <span className="font-mono text-slate-400">{data.utilityProvider ?? '—'}</span>
            </span>
            <span className="text-slate-600">
              system:{' '}
              <span className="font-mono text-slate-400">{data.systemMode}</span>
            </span>
            <span className="text-slate-600">
              bill:{' '}
              <span className="font-mono text-slate-400">
                {data.averageMonthlyBill != null ? `$${data.averageMonthlyBill}` : '—'}
              </span>
            </span>
          </div>
        </div>

        {/* Step navigation buttons */}
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

// ============================================================================
// PHASE 4 HANDOFF NOTES
// ============================================================================
//
// updateField(key, value) — generic updater, wire to every form input
// goNext() / goBack() / goToStep(step) — step navigation, already in component scope
// data — full SolarEstimateData, passed as prop to each step screen
//
// Google Maps / Places:
//   - @react-google-maps/api is already installed
//   - VITE_GOOGLE_MAPS_BROWSER_KEY is already configured
//   - 'places' library is already loaded via googleMapsLoader.ts
//   - Pattern to follow: MileageProjectAddress.tsx (autocomplete + dark GoogleMap)
//   - Wire on 'address' step: update addressText, selectedAddressLabel, placeId, latitude, longitude
//
// Rate plans:
//   - RATE_PLANS_BY_UTILITY in SolarEstimateTypes.ts covers SCE + IID
//   - Aligned with SolarNEM3Calculator RatePlan IDs for Phase 5 integration
