// @ts-nocheck
/**
 * PlanComparisonTable — 5-tier side-by-side comparison
 *
 * Features:
 * - All 5 tiers: Solo, Growth, Pro, Pro+, Enterprise
 * - Feature rows with checkmarks
 * - Current plan highlighted with green border
 * - Upgrade/downgrade buttons with smart logic
 * - Responsive: scrollable on mobile
 */

import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'

// ── Types & Constants ────────────────────────────────────────────────────────

interface Tier {
  slug: string
  name: string
  price: number
  description: string
  users: number
  projects: number
  voiceCaptures: number
  features: Feature[]
}

interface Feature {
  name: string
  tiers: Record<string, boolean | string>
}

const TIERS: Tier[] = [
  {
    slug: 'solo',
    name: 'Solo',
    price: 29,
    description: 'Freelance operators',
    users: 1,
    projects: 10,
    voiceCaptures: 500,
    features: [
      { name: 'Team Members', tiers: { solo: '1', growth: '3', pro: '5', 'pro+': '10', enterprise: 'Unlimited' } },
      { name: 'Active Projects', tiers: { solo: '10', growth: '25', pro: '50', 'pro+': '100', enterprise: 'Unlimited' } },
      { name: 'API Calls/Month', tiers: { solo: '10k', growth: '50k', pro: '250k', 'pro+': '1M', enterprise: 'Custom' } },
      { name: 'Voice Captures/Month', tiers: { solo: '500', growth: '2k', pro: '5k', 'pro+': '10k', enterprise: 'Unlimited' } },
      { name: 'Storage', tiers: { solo: '5 GB', growth: '50 GB', pro: '500 GB', 'pro+': '2 TB', enterprise: 'Unlimited' } },
      { name: 'CREW Portal', tiers: { solo: false, growth: true, pro: true, 'pro+': true, enterprise: true } },
      { name: 'GUARDIAN', tiers: { solo: false, growth: true, pro: true, 'pro+': true, enterprise: true } },
      { name: 'Lead Scan', tiers: { solo: false, growth: true, pro: true, 'pro+': true, enterprise: true } },
      { name: 'Sales Dashboard', tiers: { solo: false, growth: false, pro: true, 'pro+': true, enterprise: true } },
      { name: 'AI Receptionist', tiers: { solo: false, growth: false, pro: false, 'pro+': true, enterprise: true } },
      { name: 'Blueprint AI', tiers: { solo: true, growth: true, pro: true, 'pro+': true, enterprise: true } },
      { name: 'Support', tiers: { solo: 'Email', growth: 'Priority Email', pro: 'Priority + Phone', 'pro+': '24/7 Phone', enterprise: 'Dedicated' } },
    ],
  },
  {
    slug: 'growth',
    name: 'Growth',
    price: 79,
    description: 'Small teams & crews',
    users: 3,
    projects: 25,
    voiceCaptures: 2000,
    features: [],
  },
  {
    slug: 'pro',
    name: 'Pro',
    price: 199,
    description: 'Growing businesses',
    users: 5,
    projects: 50,
    voiceCaptures: 5000,
    features: [],
  },
  {
    slug: 'pro+',
    name: 'Pro+',
    price: 299,
    description: 'Advanced operations',
    users: 10,
    projects: 100,
    voiceCaptures: 10000,
    features: [],
  },
  {
    slug: 'enterprise',
    name: 'Enterprise',
    price: 0,
    description: 'Custom solutions',
    users: 999,
    projects: 999,
    voiceCaptures: 999999,
    features: [],
  },
]

export function PlanComparisonTable({ currentTier }: { currentTier?: string }) {
  const [loadingTier, setLoadingTier] = useState<string | null>(null)

  async function handlePlanChange(tier: Tier) {
    if (tier.slug === currentTier) return
    if (tier.slug === 'enterprise') {
      // Direct to sales
      window.location.href = 'mailto:sales@poweronsolutions.com?subject=Enterprise Plan Inquiry'
      return
    }

    setLoadingTier(tier.slug)
    try {
      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: { tierSlug: tier.slug, billingCycle: 'monthly' }
      })

      if (error) throw error
      if (data?.checkoutUrl) {
        window.location.href = data.checkoutUrl
      }
    } catch (err) {
      console.error('[plan comparison] Error:', err)
      alert('Failed to process plan change. Please try again.')
    } finally {
      setLoadingTier(null)
    }
  }

  const features = TIERS[0].features

  return (
    <div className="w-full">
      {/* Mobile Card View */}
      <div className="md:hidden space-y-6">
        {TIERS.map(tier => (
          <PlanCard key={tier.slug} tier={tier} isCurrent={tier.slug === currentTier} onSelect={handlePlanChange} />
        ))}
      </div>

      {/* Desktop Table View */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="text-left p-4 border-b border-gray-700 bg-gray-800/50">
                <div className="text-xs font-bold text-gray-500 uppercase">Features</div>
              </th>
              {TIERS.map(tier => (
                <th key={tier.slug} className="p-4 border-b border-gray-700 bg-gray-800/50 min-w-[200px]">
                  <div className="text-center">
                    <h3 className="font-bold text-white text-lg mb-1">{tier.name}</h3>
                    <p className="text-xs text-gray-400 mb-3">{tier.description}</p>
                    {tier.slug === 'enterprise' ? (
                      <div className="text-sm font-semibold text-cyan-400 mb-4">Custom</div>
                    ) : (
                      <div className="mb-4">
                        <div className="text-2xl font-bold text-emerald-400">${tier.price}</div>
                        <div className="text-xs text-gray-500">/month</div>
                      </div>
                    )}

                    <button
                      onClick={() => handlePlanChange(tier)}
                      disabled={tier.slug === currentTier || loadingTier === tier.slug}
                      className={`w-full py-2 px-3 rounded-lg font-medium text-sm transition-all ${
                        tier.slug === currentTier
                          ? 'bg-gray-700 text-gray-400 cursor-default border border-emerald-500'
                          : tier.slug === 'enterprise'
                            ? 'bg-cyan-600 hover:bg-cyan-500 text-white'
                            : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                      }`}
                    >
                      {loadingTier === tier.slug ? (
                        <span className="flex items-center justify-center gap-1">
                          <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Processing...
                        </span>
                      ) : tier.slug === currentTier ? (
                        'Current Plan'
                      ) : tier.slug === 'enterprise' ? (
                        'Contact Sales'
                      ) : tier.slug !== currentTier && TIERS.findIndex(t => t.slug === currentTier) > TIERS.findIndex(t => t.slug === tier.slug) ? (
                        'Downgrade'
                      ) : (
                        'Upgrade'
                      )}
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Quick Stats Row */}
            <tr className="border-b border-gray-700 hover:bg-gray-800/30 transition-colors">
              <td className="p-4 font-semibold text-white bg-gray-800/20">Team Members</td>
              {TIERS.map(tier => (
                <td key={tier.slug} className="p-4 text-center text-gray-300">
                  <div className="font-semibold">{tier.users === 999 ? 'Unlimited' : tier.users}</div>
                </td>
              ))}
            </tr>
            <tr className="border-b border-gray-700 hover:bg-gray-800/30 transition-colors">
              <td className="p-4 font-semibold text-white bg-gray-800/20">Active Projects</td>
              {TIERS.map(tier => (
                <td key={tier.slug} className="p-4 text-center text-gray-300">
                  <div className="font-semibold">{tier.projects === 999 ? 'Unlimited' : tier.projects}</div>
                </td>
              ))}
            </tr>

            {/* Feature Rows */}
            {features.map((feature, idx) => (
              <tr
                key={feature.name}
                className={`border-b border-gray-700 hover:bg-gray-800/30 transition-colors ${
                  idx % 2 === 0 ? 'bg-gray-800/10' : ''
                }`}
              >
                <td className="p-4 font-medium text-gray-300 bg-gray-800/20">{feature.name}</td>
                {TIERS.map(tier => (
                  <td key={tier.slug} className="p-4 text-center">
                    <FeatureCell value={feature.tiers[tier.slug]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Feature Cell ─────────────────────────────────────────────────────────────

function FeatureCell({ value }: { value?: boolean | string }) {
  if (value === true) {
    return <Check className="w-5 h-5 text-emerald-400 mx-auto" />
  }
  if (value === false) {
    return <X className="w-5 h-5 text-gray-600 mx-auto" />
  }
  return <div className="text-sm font-semibold text-cyan-400">{value}</div>
}

// ── Mobile Plan Card ─────────────────────────────────────────────────────────

function PlanCard({
  tier,
  isCurrent,
  onSelect,
}: {
  tier: Tier
  isCurrent: boolean
  onSelect: (tier: Tier) => void
}) {
  return (
    <div
      className={`rounded-2xl p-6 backdrop-blur-md border transition-all ${
        isCurrent
          ? 'bg-gradient-to-br from-gray-800 to-gray-800/50 border-emerald-500 shadow-lg shadow-emerald-500/10'
          : 'bg-gradient-to-br from-gray-800/50 to-gray-800/20 border-gray-700/50'
      }`}
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-xl font-bold text-white">{tier.name}</h3>
          <p className="text-xs text-gray-500 mt-1">{tier.description}</p>
        </div>
        {isCurrent && (
          <div className="text-xs font-bold px-2 py-1 rounded-full bg-emerald-500 text-white">
            Current
          </div>
        )}
      </div>

      {tier.slug === 'enterprise' ? (
        <div className="text-3xl font-bold text-cyan-400 mb-4">Custom</div>
      ) : (
        <div className="mb-4">
          <div className="text-3xl font-bold text-emerald-400">${tier.price}</div>
          <div className="text-xs text-gray-500">/month</div>
        </div>
      )}

      <div className="space-y-2 mb-6 text-sm">
        <div className="flex justify-between text-gray-300">
          <span>Team Members:</span>
          <span className="font-semibold">{tier.users === 999 ? 'Unlimited' : tier.users}</span>
        </div>
        <div className="flex justify-between text-gray-300">
          <span>Projects:</span>
          <span className="font-semibold">{tier.projects === 999 ? 'Unlimited' : tier.projects}</span>
        </div>
        <div className="flex justify-between text-gray-300">
          <span>Voice Captures:</span>
          <span className="font-semibold">{tier.voiceCaptures === 999999 ? 'Unlimited' : tier.voiceCaptures.toLocaleString()}</span>
        </div>
      </div>

      <button
        onClick={() => onSelect(tier)}
        disabled={isCurrent}
        className={`w-full py-2.5 rounded-lg font-medium text-sm transition-all ${
          isCurrent
            ? 'bg-gray-700 text-gray-400 cursor-default'
            : tier.slug === 'enterprise'
              ? 'bg-cyan-600 hover:bg-cyan-500 text-white'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white'
        }`}
      >
        {isCurrent ? 'Current Plan' : tier.slug === 'enterprise' ? 'Contact Sales' : 'Choose Plan'}
      </button>
    </div>
  )
}

export default PlanComparisonTable
