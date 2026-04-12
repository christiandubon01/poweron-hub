/**
 * PlanComparisonTable — 5-column side-by-side plan comparison
 *
 * Features:
 * - All 5 tiers: Free, Growth, Pro, Pro+, Enterprise
 * - Feature rows with checkmark indicators
 * - Current plan highlighted with green border
 * - Upgrade/downgrade buttons per tier
 * - Responsive scrolling on mobile
 */

import { useState } from 'react'
import { Check, X, Zap } from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '@/lib/supabase'

// ── Types & Data ──────────────────────────────────────────────────────────────

interface PlanTier {
  slug: string
  name: string
  monthlyPrice: number
  color: string
  badge?: string
  isCurrent?: boolean
}

interface FeatureRow {
  label: string
  category: string
  free: boolean | number | string
  growth: boolean | number | string
  pro: boolean | number | string
  proPlus: boolean | number | string
  enterprise: boolean | number | string
}

const TIERS: PlanTier[] = [
  { slug: 'free', name: 'Free', monthlyPrice: 0, color: 'gray' },
  { slug: 'growth', name: 'Growth', monthlyPrice: 29, color: 'blue' },
  { slug: 'pro', name: 'Pro', monthlyPrice: 79, color: 'emerald' },
  { slug: 'pro-plus', name: 'Pro+', monthlyPrice: 129, color: 'cyan' },
  { slug: 'enterprise', name: 'Enterprise', monthlyPrice: 299, color: 'purple', badge: 'Custom' },
]

const FEATURES: FeatureRow[] = [
  {
    label: 'Price',
    category: 'pricing',
    free: 'Free',
    growth: '$29/mo',
    pro: '$79/mo',
    proPlus: '$129/mo',
    enterprise: 'Custom',
  },
  {
    label: 'Users',
    category: 'team',
    free: 1,
    growth: 2,
    pro: 5,
    proPlus: 10,
    enterprise: 'Unlimited',
  },
  {
    label: 'Active Projects',
    category: 'team',
    free: 3,
    growth: 10,
    pro: 25,
    proPlus: 50,
    enterprise: 'Unlimited',
  },
  {
    label: 'Voice Captures/Month',
    category: 'team',
    free: 25,
    growth: 100,
    pro: 500,
    proPlus: 1000,
    enterprise: 'Unlimited',
  },
  {
    label: 'Crew Portal',
    category: 'features',
    free: false,
    growth: true,
    pro: true,
    proPlus: true,
    enterprise: true,
  },
  {
    label: 'GUARDIAN',
    category: 'features',
    free: false,
    growth: true,
    pro: true,
    proPlus: true,
    enterprise: true,
  },
  {
    label: 'Lead Scan',
    category: 'features',
    free: false,
    growth: false,
    pro: true,
    proPlus: true,
    enterprise: true,
  },
  {
    label: 'Sales Dashboard',
    category: 'features',
    free: false,
    growth: false,
    pro: true,
    proPlus: true,
    enterprise: true,
  },
  {
    label: 'AI Receptionist',
    category: 'features',
    free: false,
    growth: false,
    pro: false,
    proPlus: true,
    enterprise: true,
  },
  {
    label: 'Blueprint AI',
    category: 'features',
    free: true,
    growth: true,
    pro: true,
    proPlus: true,
    enterprise: true,
  },
  {
    label: 'Priority Support',
    category: 'support',
    free: 'Community',
    growth: 'Email',
    pro: 'Email + Chat',
    proPlus: '24/7 Phone',
    enterprise: 'Dedicated',
  },
  {
    label: 'API Access',
    category: 'support',
    free: false,
    growth: false,
    pro: true,
    proPlus: true,
    enterprise: true,
  },
  {
    label: 'Custom Integrations',
    category: 'support',
    free: false,
    growth: false,
    pro: false,
    proPlus: true,
    enterprise: true,
  },
]

// ── Component ─────────────────────────────────────────────────────────────────

interface PlanComparisonTableProps {
  currentPlan?: string
}

export function PlanComparisonTable({ currentPlan }: PlanComparisonTableProps) {
  const [loadingTier, setLoadingTier] = useState<string | null>(null)

  const handleChoosePlan = async (tierSlug: string) => {
    if (tierSlug === currentPlan?.toLowerCase()) return

    setLoadingTier(tierSlug)
    try {
      const stripeKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
      if (!stripeKey || stripeKey === 'pk_test_...') {
        alert('Stripe is not configured.')
        return
      }

      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: { tierSlug, billingCycle: 'monthly' },
      })

      if (error) throw error
      if (data?.checkoutUrl) {
        window.location.href = data.checkoutUrl
      }
    } catch (err) {
      console.error('[plan-comparison] Checkout failed:', err)
      alert('Failed to initiate checkout. Please try again.')
    } finally {
      setLoadingTier(null)
    }
  }

  const renderFeatureValue = (value: boolean | number | string) => {
    if (typeof value === 'boolean') {
      return value ? (
        <Check className="w-5 h-5 text-emerald-400 mx-auto" />
      ) : (
        <X className="w-5 h-5 text-text-4 mx-auto" />
      )
    }
    return <span className="text-text-2 text-sm font-medium">{value}</span>
  }

  const groupedFeatures = {
    pricing: FEATURES.filter(f => f.category === 'pricing'),
    team: FEATURES.filter(f => f.category === 'team'),
    features: FEATURES.filter(f => f.category === 'features'),
    support: FEATURES.filter(f => f.category === 'support'),
  }

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse">
        {/* Header with Tier Names */}
        <thead>
          <tr>
            <th className="w-32 px-4 py-4 text-left bg-bg-1 border-b border-bg-4" />
            {TIERS.map(tier => {
              const isCurrent = tier.name.toLowerCase() === currentPlan?.toLowerCase()
              return (
                <th
                  key={tier.slug}
                  className={clsx(
                    'px-4 py-4 text-center bg-bg-1 border-b',
                    isCurrent ? 'border-b-2 border-emerald-500' : 'border-b-2 border-bg-4',
                  )}
                >
                  <div className={clsx('relative')}>
                    {tier.badge && (
                      <div className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-xs font-bold bg-cyan-500/20 text-cyan-400 whitespace-nowrap">
                        {tier.badge}
                      </div>
                    )}
                    <h3 className="font-bold text-text-1">{tier.name}</h3>
                  </div>
                </th>
              )
            })}
          </tr>
        </thead>

        {/* Body with Features */}
        <tbody>
          {/* Pricing Section */}
          {groupedFeatures.pricing.map(feature => (
            <tr key={`${feature.category}-${feature.label}`} className="border-b border-bg-4 hover:bg-bg-1/30 transition-colors">
              <td className="px-4 py-3 text-sm font-medium text-text-2 bg-bg-1/20">{feature.label}</td>
              <td className="px-4 py-3 text-center">{renderFeatureValue(feature.free)}</td>
              <td className="px-4 py-3 text-center">{renderFeatureValue(feature.growth)}</td>
              <td className="px-4 py-3 text-center">{renderFeatureValue(feature.pro)}</td>
              <td className="px-4 py-3 text-center">{renderFeatureValue(feature.proPlus)}</td>
              <td className="px-4 py-3 text-center">{renderFeatureValue(feature.enterprise)}</td>
            </tr>
          ))}

          {/* Team Section */}
          <tr className="bg-bg-1/20">
            <td colSpan={6} className="px-4 py-2 text-xs font-bold text-text-4 uppercase tracking-wider">
              Team & Projects
            </td>
          </tr>
          {groupedFeatures.team.map(feature => (
            <tr key={`${feature.category}-${feature.label}`} className="border-b border-bg-4 hover:bg-bg-1/30 transition-colors">
              <td className="px-4 py-3 text-sm font-medium text-text-2 bg-bg-1/20">{feature.label}</td>
              <td className="px-4 py-3 text-center">{renderFeatureValue(feature.free)}</td>
              <td className="px-4 py-3 text-center">{renderFeatureValue(feature.growth)}</td>
              <td className="px-4 py-3 text-center">{renderFeatureValue(feature.pro)}</td>
              <td className="px-4 py-3 text-center">{renderFeatureValue(feature.proPlus)}</td>
              <td className="px-4 py-3 text-center">{renderFeatureValue(feature.enterprise)}</td>
            </tr>
          ))}

          {/* Features Section */}
          <tr className="bg-bg-1/20">
            <td colSpan={6} className="px-4 py-2 text-xs font-bold text-text-4 uppercase tracking-wider">
              Features
            </td>
          </tr>
          {groupedFeatures.features.map(feature => (
            <tr key={`${feature.category}-${feature.label}`} className="border-b border-bg-4 hover:bg-bg-1/30 transition-colors">
              <td className="px-4 py-3 text-sm font-medium text-text-2 bg-bg-1/20">{feature.label}</td>
              <td className="px-4 py-3 text-center">{renderFeatureValue(feature.free)}</td>
              <td className="px-4 py-3 text-center">{renderFeatureValue(feature.growth)}</td>
              <td className="px-4 py-3 text-center">{renderFeatureValue(feature.pro)}</td>
              <td className="px-4 py-3 text-center">{renderFeatureValue(feature.proPlus)}</td>
              <td className="px-4 py-3 text-center">{renderFeatureValue(feature.enterprise)}</td>
            </tr>
          ))}

          {/* Support Section */}
          <tr className="bg-bg-1/20">
            <td colSpan={6} className="px-4 py-2 text-xs font-bold text-text-4 uppercase tracking-wider">
              Support & Developer
            </td>
          </tr>
          {groupedFeatures.support.map(feature => (
            <tr key={`${feature.category}-${feature.label}`} className="border-b border-bg-4 hover:bg-bg-1/30 transition-colors">
              <td className="px-4 py-3 text-sm font-medium text-text-2 bg-bg-1/20">{feature.label}</td>
              <td className="px-4 py-3 text-center">{renderFeatureValue(feature.free)}</td>
              <td className="px-4 py-3 text-center">{renderFeatureValue(feature.growth)}</td>
              <td className="px-4 py-3 text-center">{renderFeatureValue(feature.pro)}</td>
              <td className="px-4 py-3 text-center">{renderFeatureValue(feature.proPlus)}</td>
              <td className="px-4 py-3 text-center">{renderFeatureValue(feature.enterprise)}</td>
            </tr>
          ))}

          {/* CTA Row */}
          <tr className="bg-bg-1/40">
            <td className="px-4 py-4" />
            {TIERS.map(tier => {
              const isCurrent = tier.name.toLowerCase() === currentPlan?.toLowerCase()
              return (
                <td key={tier.slug} className="px-4 py-4 text-center">
                  <button
                    onClick={() => handleChoosePlan(tier.slug)}
                    disabled={isCurrent || loadingTier === tier.slug}
                    className={clsx(
                      'w-full px-3 py-2 rounded-lg font-medium text-sm transition-all whitespace-nowrap',
                      isCurrent
                        ? 'bg-emerald-600/20 text-emerald-400 cursor-default border border-emerald-600/30'
                        : 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-600/20',
                      loadingTier === tier.slug && 'opacity-50 cursor-not-allowed',
                    )}
                  >
                    {isCurrent ? (
                      <span className="flex items-center justify-center gap-1">
                        <Check className="w-4 h-4" />
                        Current
                      </span>
                    ) : loadingTier === tier.slug ? (
                      'Processing...'
                    ) : (
                      'Choose Plan'
                    )}
                  </button>
                </td>
              )
            })}
          </tr>
        </tbody>
      </table>

      {/* Mobile Note */}
      <div className="mt-4 text-center text-text-4 text-xs">
        💡 Scroll right on mobile to see all plans
      </div>
    </div>
  )
}

export default PlanComparisonTable
