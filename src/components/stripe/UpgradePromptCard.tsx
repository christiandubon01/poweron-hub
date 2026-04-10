/**
 * Upgrade Prompt Card
 *
 * Reusable component that displays an upgrade offer for a locked feature.
 * Shows feature details, tier comparison, pricing, and CTA button.
 *
 * Matches PowerOn Hub dark theme with glassmorphic styling.
 */

import React from 'react'
import { Lock, ArrowRight, Zap } from 'lucide-react'
import type { SubscriptionTier } from '@/config/subscriptionTiers'

export interface UpgradePromptCardProps {
  /** Name of the locked feature */
  featureName: string

  /** Brief description of what the feature does */
  description?: string

  /** Current tier name (e.g., 'Free', 'Solo') */
  currentTierName: string

  /** Required tier object */
  requiredTier: SubscriptionTier

  /** Price difference per month */
  priceDifference: number

  /** URL to navigate to when upgrade button is clicked */
  onUpgradeClick?: () => void

  /** Optional CSS classes */
  className?: string

  /** Show a teaser glassmorphic blur on background */
  showBackgroundTease?: boolean
}

export function UpgradePromptCard({
  featureName,
  description,
  currentTierName,
  requiredTier,
  priceDifference,
  onUpgradeClick,
  className = '',
  showBackgroundTease = false,
}: UpgradePromptCardProps) {
  const handleUpgradeClick = () => {
    if (onUpgradeClick) {
      onUpgradeClick()
    } else {
      // Default navigation to billing page
      window.location.href = `/billing/upgrade?target=${requiredTier.slug}`
    }
  }

  return (
    <div
      className={`relative rounded-xl border border-slate-700/50 bg-gradient-to-br from-slate-800/80 via-slate-900/80 to-slate-900/60 backdrop-blur-md p-6 shadow-2xl ${className}`}
    >
      {/* Background tease effect */}
      {showBackgroundTease && (
        <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-purple-500/5 via-transparent to-blue-500/5 backdrop-blur-[2px] pointer-events-none" />
      )}

      <div className="relative z-10 space-y-4">
        {/* Header with lock icon */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <Lock className="w-5 h-5 text-amber-400" />
          </div>
          <h3 className="text-lg font-semibold text-white">{featureName}</h3>
        </div>

        {/* Description */}
        {description && (
          <p className="text-sm text-slate-300 leading-relaxed">{description}</p>
        )}

        {/* Tier comparison */}
        <div className="py-3 px-4 rounded-lg bg-slate-800/40 border border-slate-700/30 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">Your plan:</span>
            <span className="font-medium text-slate-200">{currentTierName}</span>
          </div>
          <div className="h-px bg-slate-700/50" />
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">Required plan:</span>
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <span className="font-medium text-amber-300">{requiredTier.name}</span>
            </div>
          </div>
        </div>

        {/* Pricing */}
        <div className="py-3 px-4 rounded-lg bg-gradient-to-r from-blue-500/5 to-purple-500/5 border border-blue-500/20">
          <div className="text-center">
            <p className="text-xs text-slate-400 mb-1">Upgrade cost</p>
            <div className="flex items-baseline justify-center gap-2">
              <span className="text-2xl font-bold text-white">${priceDifference}</span>
              <span className="text-sm text-slate-400">/month</span>
            </div>
          </div>
        </div>

        {/* CTA Button */}
        <button
          onClick={handleUpgradeClick}
          className="w-full py-2.5 px-4 rounded-lg bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-medium text-sm transition-all duration-200 flex items-center justify-center gap-2 shadow-lg hover:shadow-blue-500/30"
        >
          Upgrade Now
          <ArrowRight className="w-4 h-4" />
        </button>

        {/* Small disclaimer */}
        <p className="text-xs text-slate-500 text-center">
          Upgrade anytime. Cancel at any time, no questions asked.
        </p>
      </div>
    </div>
  )
}

export default UpgradePromptCard
