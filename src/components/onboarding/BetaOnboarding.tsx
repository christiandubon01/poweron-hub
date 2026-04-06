// @ts-nocheck
/**
 * BetaOnboarding — 5-step new-org setup flow.
 *
 * Fires ONCE after NDA is signed, before main app loads.
 * Checks orgs.onboarding_complete — never shows again after completion.
 *
 * Steps:
 *   1. Welcome          — headline + Get Started CTA
 *   2. Industry         — 6 industry cards, single-select, required
 *   3. Business Basics  — business name, your name, license #, city/state
 *   4. Name Your AI     — custom AI name (default: NEXUS)
 *   5. Done             — confirmation screen, Open Dashboard CTA
 *
 * On complete:
 *   - Writes orgs.onboarding_complete = true
 *   - Writes orgs.industry, orgs.business_name, orgs.owner_name,
 *     orgs.license_number, orgs.city_state, orgs.ai_name
 *   - Sets ai_name in NEXUS system prompt via window event
 *   - Loads industry template seed via window event
 */

import { useState } from 'react'
import {
  Zap, Wrench, Building2, Stethoscope, Package, HardHat,
  ChevronRight, ChevronLeft, CheckCircle2, Sparkles, Bot,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { getTemplate } from '@/config/templates/index'

// ── Industry definitions ──────────────────────────────────────────────────────

interface Industry {
  key: string
  templateKey: string
  label: string
  description: string
  Icon: typeof Zap
  accent: string
}

const INDUSTRIES: Industry[] = [
  {
    key: 'electrical',
    templateKey: 'gc',
    label: 'Electrical Contractor',
    description: 'Residential & commercial electrical',
    Icon: Zap,
    accent: 'text-yellow-400 border-yellow-500/40 bg-yellow-500/10',
  },
  {
    key: 'plumbing',
    templateKey: 'plumbing',
    label: 'Plumbing',
    description: 'Service, repair & new construction',
    Icon: Wrench,
    accent: 'text-blue-400 border-blue-500/40 bg-blue-500/10',
  },
  {
    key: 'gc',
    templateKey: 'gc',
    label: 'General Contractor',
    description: 'Multi-trade & ground-up builds',
    Icon: HardHat,
    accent: 'text-orange-400 border-orange-500/40 bg-orange-500/10',
  },
  {
    key: 'mechanic',
    templateKey: 'mechanic',
    label: 'HVAC / Mechanical',
    description: 'Heating, cooling & ventilation',
    Icon: Building2,
    accent: 'text-cyan-400 border-cyan-500/40 bg-cyan-500/10',
  },
  {
    key: 'medical-billing',
    templateKey: 'medical-billing',
    label: 'Medical / Healthcare',
    description: 'Billing, admin & patient services',
    Icon: Stethoscope,
    accent: 'text-pink-400 border-pink-500/40 bg-pink-500/10',
  },
  {
    key: 'electrical-supplier',
    templateKey: 'electrical-supplier',
    label: 'Electrical Supply',
    description: 'Distribution & supply house ops',
    Icon: Package,
    accent: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10',
  },
]

// ── Step indicator ────────────────────────────────────────────────────────────

const TOTAL_STEPS = 5

function StepDots({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2 justify-center mb-6">
      {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
        <div
          key={i}
          className={`rounded-full transition-all duration-300 ${
            i < current
              ? 'w-2 h-2 bg-emerald-500'
              : i === current
              ? 'w-6 h-2 bg-emerald-400'
              : 'w-2 h-2 bg-gray-700'
          }`}
        />
      ))}
    </div>
  )
}

// ── Input helper ──────────────────────────────────────────────────────────────

function Field({
  label,
  value,
  onChange,
  placeholder,
  optional,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  optional?: boolean
  type?: string
}) {
  return (
    <div>
      <label className="flex items-center gap-1 text-sm text-gray-300 mb-1">
        {label}
        {optional && <span className="text-gray-600 text-xs">(optional)</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2.5 text-white placeholder-gray-600 focus:border-emerald-500 focus:outline-none transition-colors"
      />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface BetaOnboardingProps {
  onComplete: () => void
}

export default function BetaOnboarding({ onComplete }: BetaOnboardingProps) {
  const { profile } = useAuth()

  const [step, setStep]               = useState(0)
  const [saving, setSaving]           = useState(false)

  // Step 2
  const [industry, setIndustry]       = useState<Industry | null>(null)

  // Step 3
  const [businessName, setBusinessName] = useState('')
  const [ownerName, setOwnerName]       = useState(profile?.full_name || '')
  const [licenseNumber, setLicenseNumber] = useState('')
  const [cityState, setCityState]       = useState('')

  // Step 4
  const [aiName, setAiName]           = useState('NEXUS')

  // ── Navigation ─────────────────────────────────────────────────────────────

  function canAdvance(): boolean {
    if (step === 1) return industry !== null
    return true
  }

  function handleNext() {
    if (!canAdvance()) return
    setStep(s => Math.min(s + 1, TOTAL_STEPS - 1))
  }

  function handleBack() {
    setStep(s => Math.max(s - 1, 0))
  }

  // ── Completion ─────────────────────────────────────────────────────────────

  async function handleComplete() {
    setSaving(true)
    try {
      const orgId = profile?.org_id
      if (!orgId) throw new Error('No org_id on profile')

      const resolvedAiName = aiName.trim() || 'NEXUS'

      // Persist to orgs table
      const { error } = await supabase
        .from('orgs' as never)
        .update({
          onboarding_complete: true,
          industry: industry?.key ?? null,
          business_name: businessName.trim() || null,
          owner_name: ownerName.trim() || null,
          license_number: licenseNumber.trim() || null,
          city_state: cityState.trim() || null,
          ai_name: resolvedAiName,
        })
        .eq('id', orgId)

      if (error) {
        console.error('[BetaOnboarding] Supabase update error:', error)
        // Don't block the user — fall through and complete
      }

      // Broadcast ai_name so NEXUS prompt engine can pick it up
      window.dispatchEvent(
        new CustomEvent('poweron:ai-name-set', { detail: { aiName: resolvedAiName } })
      )

      // Load industry template as default data seed
      if (industry) {
        const template = getTemplate(industry.templateKey)
        if (template) {
          window.dispatchEvent(
            new CustomEvent('poweron:template-loaded', { detail: { template, industry: industry.key } })
          )
        }
      }

      // B8 — Notification 1: New beta user active
      // Fire-and-forget — does not block onboarding completion
      fetch('/.netlify/functions/notifyNewBetaUser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId:           orgId,
          businessName:    businessName.trim() || '',
          industry:        industry?.key ?? '',
          ownerName:       ownerName.trim() || profile?.full_name || '',
          signupTimestamp: profile?.created_at ?? new Date().toISOString(),
        }),
      }).catch((err) => console.warn('[BetaOnboarding] notifyNewBetaUser failed:', err))

      onComplete()
    } catch (err) {
      console.error('[BetaOnboarding] Complete failed:', err)
      // Still call onComplete so user isn't blocked
      onComplete()
    } finally {
      setSaving(false)
    }
  }

  // ── Step content ──────────────────────────────────────────────────────────

  function renderStep() {
    switch (step) {

      // ── Step 1: Welcome ───────────────────────────────────────────────────
      case 0:
        return (
          <div className="text-center space-y-5">
            <div className="w-20 h-20 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 mx-auto flex items-center justify-center">
              <Zap className="text-emerald-400" size={42} />
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-bold text-white tracking-tight">
                Welcome to PowerOn Hub
              </h1>
              <p className="text-gray-400 text-base max-w-sm mx-auto leading-relaxed">
                Let us set up your workspace. This takes 2 minutes.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 text-sm text-emerald-400">
              <Sparkles size={15} />
              <span>AI-powered ops, built for your trade</span>
            </div>
          </div>
        )

      // ── Step 2: Industry ──────────────────────────────────────────────────
      case 1:
        return (
          <div className="space-y-5">
            <div className="text-center">
              <h2 className="text-xl font-bold text-white">What type of business do you run?</h2>
              <p className="text-gray-500 text-sm mt-1">Select your industry to configure your workspace.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {INDUSTRIES.map(ind => {
                const selected = industry?.key === ind.key
                return (
                  <button
                    key={ind.key}
                    onClick={() => setIndustry(ind)}
                    className={`flex flex-col items-start gap-1.5 p-3.5 rounded-xl border transition-all text-left ${
                      selected
                        ? `${ind.accent} border-opacity-100`
                        : 'bg-gray-800/60 border-gray-700 hover:border-gray-500'
                    }`}
                  >
                    <ind.Icon
                      size={20}
                      className={selected ? ind.accent.split(' ')[0] : 'text-gray-500'}
                    />
                    <div>
                      <div className={`text-sm font-semibold ${selected ? ind.accent.split(' ')[0] : 'text-gray-200'}`}>
                        {ind.label}
                      </div>
                      <div className="text-xs text-gray-500 leading-tight mt-0.5">
                        {ind.description}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
            {!industry && (
              <p className="text-center text-xs text-gray-600">Select an industry to continue</p>
            )}
          </div>
        )

      // ── Step 3: Business Basics ───────────────────────────────────────────
      case 2:
        return (
          <div className="space-y-5">
            <div className="text-center">
              <h2 className="text-xl font-bold text-white">Tell us about your business</h2>
              <p className="text-gray-500 text-sm mt-1">This info appears across your workspace.</p>
            </div>
            <div className="space-y-3 max-w-sm mx-auto">
              <Field
                label="Business Name"
                value={businessName}
                onChange={setBusinessName}
                placeholder="Power On Solutions LLC"
              />
              <Field
                label="Your Name"
                value={ownerName}
                onChange={setOwnerName}
                placeholder="Christian Dubon"
              />
              <Field
                label="License Number"
                value={licenseNumber}
                onChange={setLicenseNumber}
                placeholder="C-10 #1151468"
                optional
              />
              <Field
                label="City / State"
                value={cityState}
                onChange={setCityState}
                placeholder="Desert Hot Springs, CA"
              />
            </div>
          </div>
        )

      // ── Step 4: Name Your AI ──────────────────────────────────────────────
      case 3:
        return (
          <div className="space-y-5 text-center">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 mx-auto flex items-center justify-center">
              <Bot className="text-emerald-400" size={32} />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-xl font-bold text-white">What do you want to call your AI?</h2>
              <p className="text-gray-400 text-sm max-w-xs mx-auto leading-relaxed">
                This is your personal AI operations assistant. Give it a name.
              </p>
            </div>
            <div className="max-w-xs mx-auto">
              <input
                type="text"
                value={aiName}
                onChange={e => setAiName(e.target.value)}
                placeholder="e.g. NEXUS, MAX, ARIA"
                maxLength={24}
                className="w-full text-center text-lg font-semibold bg-gray-800 border border-gray-600 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:border-emerald-500 focus:outline-none tracking-wide transition-colors"
              />
              <p className="text-gray-600 text-xs mt-2">Default: NEXUS</p>
            </div>
          </div>
        )

      // ── Step 5: Done ──────────────────────────────────────────────────────
      case 4: {
        const displayAiName = aiName.trim() || 'NEXUS'
        const displayIndustry = industry?.label ?? 'your'
        return (
          <div className="text-center space-y-5">
            <div className="w-20 h-20 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 mx-auto flex items-center justify-center">
              <CheckCircle2 className="text-emerald-400" size={42} />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-white tracking-tight">
                {displayAiName} is ready.
              </h1>
              <p className="text-gray-400 text-sm max-w-sm mx-auto leading-relaxed">
                Your {displayIndustry} workspace is configured. Let us know if you need anything.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 text-xs text-emerald-500">
              <Sparkles size={13} />
              <span>Workspace initialised · Industry template loaded</span>
            </div>
          </div>
        )
      }

      default:
        return null
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const isFirst = step === 0
  const isLast  = step === TOTAL_STEPS - 1

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-gray-950 rounded-2xl border border-gray-800 shadow-2xl overflow-hidden mx-4">

        {/* Step indicator */}
        <div className="pt-6 px-6">
          <StepDots current={step} />
        </div>

        {/* Step content */}
        <div className="px-6 pb-4 min-h-[340px] flex flex-col justify-center">
          {renderStep()}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-800/80">
          {/* Back */}
          <button
            onClick={handleBack}
            disabled={isFirst}
            className={`flex items-center gap-1 text-sm px-3 py-2 rounded-lg transition-colors ${
              isFirst
                ? 'text-gray-700 cursor-not-allowed'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            <ChevronLeft size={16} />
            Back
          </button>

          {/* Step counter */}
          <span className="text-gray-700 text-xs tabular-nums">
            {step + 1} / {TOTAL_STEPS}
          </span>

          {/* Next / Open Dashboard */}
          {isLast ? (
            <button
              onClick={handleComplete}
              disabled={saving}
              className="flex items-center gap-2 text-sm px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : (
                <>
                  <CheckCircle2 size={15} />
                  Open Dashboard
                </>
              )}
            </button>
          ) : (
            <button
              onClick={handleNext}
              disabled={!canAdvance()}
              className={`flex items-center gap-1 text-sm px-4 py-2.5 rounded-xl font-semibold transition-colors ${
                canAdvance()
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : 'bg-gray-800 text-gray-600 cursor-not-allowed'
              }`}
            >
              {step === 0 ? 'Get Started' : 'Next'}
              <ChevronRight size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
