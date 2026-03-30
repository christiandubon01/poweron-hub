// @ts-nocheck
/**
 * PricingPanel — Subscription tier selection with Stripe Checkout integration
 *
 * Three tiers: Free (current), Pro ($49/mo), Enterprise ($149/mo)
 * Each card lists features and a Subscribe button that will call
 * Stripe Checkout when keys are configured.
 */

import { useState } from 'react'
import { useSubscription } from '@/hooks/useSubscription'
import { supabase } from '@/lib/supabase'

// ── Tier Data ─────────────────────────────────────────────────────────────────

interface PricingTier {
  name: string
  slug: string
  monthlyPrice: number
  description: string
  features: string[]
  highlighted: boolean
  badge?: string
  cta: string
  accent: string
}

const TIERS: PricingTier[] = [
  {
    name: 'Free',
    slug: 'free',
    monthlyPrice: 0,
    description: 'Basic access for solo operators getting started',
    features: [
      '3 AI agents (NEXUS, PULSE, BLUEPRINT)',
      'Up to 3 active projects',
      '10 leads per month',
      '1 GB storage',
      'Community support',
    ],
    highlighted: false,
    cta: 'Current Plan',
    accent: 'gray',
  },
  {
    name: 'Pro',
    slug: 'solo',
    monthlyPrice: 49,
    description: 'Unlimited projects, voice commands, all 11 agents',
    features: [
      'All 11 AI agents unlocked',
      'Unlimited projects',
      '100 leads per month',
      'ECHO voice assistant',
      '5 GB storage',
      'Email support',
      'Smart scheduling + invoicing',
    ],
    highlighted: true,
    badge: 'Most Popular',
    cta: 'Upgrade to Pro',
    accent: 'emerald',
  },
  {
    name: 'Enterprise',
    slug: 'team',
    monthlyPrice: 149,
    description: 'Multi-user teams with priority support',
    features: [
      'Everything in Pro',
      'Up to 5 team members',
      '500 leads per month',
      '50 GB storage',
      '24/7 phone support',
      'Advanced analytics & reporting',
      'Custom integrations',
      'Priority agent responses',
    ],
    highlighted: false,
    badge: 'Best Value',
    cta: 'Go Enterprise',
    accent: 'cyan',
  },
]

// ── Component ─────────────────────────────────────────────────────────────────

export default function PricingPanel() {
  const { tierName, isActive } = useSubscription()
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly')
  const [loadingTier, setLoadingTier] = useState<string | null>(null)

  const currentSlug = isActive
    ? tierName.toLowerCase() === 'solo' ? 'solo' : tierName.toLowerCase() === 'team' ? 'team' : 'free'
    : 'free'

  async function handleSubscribe(tier: PricingTier) {
    if (tier.slug === 'free' || tier.slug === currentSlug) return

    setLoadingTier(tier.slug)

    try {
      // Check if Stripe is configured
      const stripeKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
      if (!stripeKey || stripeKey === 'pk_test_...') {
        alert(
          `Stripe is not configured yet.\n\nTo enable billing, add your Stripe keys to .env.local:\n` +
          `VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...\nSTRIPE_SECRET_KEY=sk_live_...`
        )
        return
      }

      // Call Supabase Edge Function to create Stripe Checkout session
      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: { tierSlug: tier.slug, billingCycle }
      })

      if (error) throw error
      if (data?.checkoutUrl) {
        window.location.href = data.checkoutUrl
      } else {
        throw new Error('No checkout URL returned')
      }
    } catch (err) {
      console.error('[pricing] Checkout failed:', err)
    } finally {
      setLoadingTier(null)
    }
  }

  function getAnnualPrice(monthly: number): number {
    return Math.round(monthly * 10) // 2 months free
  }

  function getDisplayPrice(tier: PricingTier): number {
    if (tier.monthlyPrice === 0) return 0
    return billingCycle === 'annual'
      ? Math.round(getAnnualPrice(tier.monthlyPrice) / 12)
      : tier.monthlyPrice
  }

  return (
    <div className="min-h-full bg-gray-900 p-6 md:p-10">
      {/* Header */}
      <div className="text-center mb-10 max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-3">
          Choose Your Plan
        </h1>
        <p className="text-gray-400 text-lg">
          Power up your electrical contracting business with AI-driven operations.
          Upgrade anytime, cancel anytime.
        </p>

        {/* Billing Toggle */}
        <div className="flex items-center justify-center gap-3 mt-6">
          <span className={`text-sm ${billingCycle === 'monthly' ? 'text-white font-medium' : 'text-gray-500'}`}>
            Monthly
          </span>
          <button
            onClick={() => setBillingCycle(c => c === 'monthly' ? 'annual' : 'monthly')}
            className={`relative w-14 h-7 rounded-full transition-colors ${
              billingCycle === 'annual' ? 'bg-emerald-600' : 'bg-gray-600'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${
                billingCycle === 'annual' ? 'translate-x-7' : ''
              }`}
            />
          </button>
          <span className={`text-sm ${billingCycle === 'annual' ? 'text-white font-medium' : 'text-gray-500'}`}>
            Annual
          </span>
          {billingCycle === 'annual' && (
            <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-medium">
              Save 17%
            </span>
          )}
        </div>
      </div>

      {/* Tier Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
        {TIERS.map(tier => {
          const isCurrent = tier.slug === currentSlug
          const price = getDisplayPrice(tier)

          return (
            <div
              key={tier.slug}
              className={`relative rounded-2xl p-6 flex flex-col transition-all ${
                tier.highlighted
                  ? 'bg-gray-800 border-2 border-emerald-500 shadow-lg shadow-emerald-500/10 scale-[1.02]'
                  : 'bg-gray-800/60 border border-gray-700'
              }`}
            >
              {/* Badge */}
              {tier.badge && (
                <div className={`absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-xs font-bold ${
                  tier.highlighted
                    ? 'bg-emerald-500 text-white'
                    : 'bg-cyan-500/20 text-cyan-400'
                }`}>
                  {tier.badge}
                </div>
              )}

              {/* Tier Name */}
              <h2 className={`text-xl font-bold mb-1 ${
                tier.accent === 'emerald' ? 'text-emerald-400' :
                tier.accent === 'cyan' ? 'text-cyan-400' :
                'text-gray-300'
              }`}>
                {tier.name}
              </h2>
              <p className="text-gray-500 text-sm mb-4">{tier.description}</p>

              {/* Price */}
              <div className="mb-6">
                {price === 0 ? (
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-white">Free</span>
                  </div>
                ) : (
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-white">${price}</span>
                    <span className="text-gray-500">/mo</span>
                  </div>
                )}
                {billingCycle === 'annual' && price > 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    ${getAnnualPrice(tier.monthlyPrice)}/year — billed annually
                  </p>
                )}
              </div>

              {/* Features */}
              <ul className="flex-1 space-y-2.5 mb-6">
                {tier.features.map((feat, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                    <svg className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                      tier.accent === 'emerald' ? 'text-emerald-400' :
                      tier.accent === 'cyan' ? 'text-cyan-400' :
                      'text-gray-500'
                    }`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>

              {/* CTA Button */}
              <button
                onClick={() => handleSubscribe(tier)}
                disabled={isCurrent || loadingTier === tier.slug}
                className={`w-full py-2.5 px-4 rounded-lg font-medium text-sm transition-all ${
                  isCurrent
                    ? 'bg-gray-700 text-gray-400 cursor-default'
                    : tier.highlighted
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20'
                      : tier.accent === 'cyan'
                        ? 'bg-cyan-600 hover:bg-cyan-500 text-white'
                        : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                }`}
              >
                {loadingTier === tier.slug ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Processing...
                  </span>
                ) : isCurrent ? (
                  'Current Plan'
                ) : (
                  tier.cta
                )}
              </button>
            </div>
          )
        })}
      </div>

      {/* Footer Note */}
      <div className="text-center mt-8 text-gray-600 text-xs max-w-lg mx-auto">
        All plans include a 14-day free trial. Secured by Stripe.
        Need a custom plan for your organization?{' '}
        <span className="text-emerald-400 cursor-pointer hover:underline">Contact us</span>
      </div>
    </div>
  )
}
