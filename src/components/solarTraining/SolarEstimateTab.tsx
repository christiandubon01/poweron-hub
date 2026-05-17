import React from 'react'
import {
  BatteryCharging,
  ClipboardList,
  Home,
  MapPin,
  PlugZap,
  SunMedium,
} from 'lucide-react'

type WizardStep = {
  label: string
  description: string
  Icon: React.ComponentType<{ className?: string }>
}

const WIZARD_STEPS: WizardStep[] = [
  {
    label: 'Address',
    description: 'Location intake placeholder for the future estimate interview.',
    Icon: MapPin,
  },
  {
    label: 'Home Details',
    description: 'Roof, ownership, and property profile will live here later.',
    Icon: Home,
  },
  {
    label: 'Energy Use',
    description: 'Utility, rate, and consumption interview step planned next.',
    Icon: PlugZap,
  },
  {
    label: 'System Config',
    description: 'Solar-only and solar-plus-battery options will be staged here.',
    Icon: BatteryCharging,
  },
  {
    label: 'Estimate Summary',
    description: 'Final homeowner-facing summary shell for a later phase.',
    Icon: ClipboardList,
  },
]

export default function SolarEstimateTab() {
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
            <h2 className="text-xl font-semibold text-white">Estimate interview shell</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              A polished placeholder for the upcoming homeowner estimate flow. No maps, autocomplete,
              calculations, rates, persistence, or external requests are wired in this phase.
            </p>
          </div>

          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200">
            Phase 2 shell only
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-5">
          {WIZARD_STEPS.map((step, index) => (
            <div
              key={step.label}
              className="rounded-lg border border-slate-800 bg-slate-900/70 p-4 transition-colors hover:border-cyan-700/70 hover:bg-slate-900"
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md border border-cyan-500/30 bg-cyan-500/10">
                  <step.Icon className="h-4 w-4 text-cyan-200" />
                </div>
                <span className="text-xs font-semibold text-slate-500">
                  {String(index + 1).padStart(2, '0')}
                </span>
              </div>
              <h3 className="text-sm font-semibold text-slate-100">{step.label}</h3>
              <p className="mt-2 text-xs leading-5 text-slate-500">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
