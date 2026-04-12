/**
 * UpgradePromptCard Component
 *
 * Reusable upgrade prompt card that shows:
 *   - Feature locked icon
 *   - Current tier vs required tier
 *   - Price difference
 *   - "Upgrade Now" button → Stripe checkout
 *
 * Styled in PowerOn Hub dark theme with glassmorphic effects.
 * Used by TierGateWrapper and inline upgrade prompts.
 */

import React from 'react'
import { Lock, ArrowRight, Zap } from 'lucide-react'

export interface UpgradePromptCardProps {
  /** Feature name to display */
  featureName: string
  /** Feature description */
  description: string
  /** Current tier name */
  currentTierName: string
  /** Required tier name */
  requiredTierName: string
  /** Current monthly price */
  currentPrice: number
  /** Required tier monthly price */
  upgradePrice: number
  /** Price difference */
  priceDifference: number
  /** Callback for upgrade button click */
  onUpgradeClick: () => void
  /** Optional CSS class */
  className?: string
  /** Show full or compact layout */
  compact?: boolean
}

export const UpgradePromptCard: React.FC<UpgradePromptCardProps> = ({
  featureName,
  description,
  currentTierName,
  requiredTierName,
  currentPrice,
  upgradePrice,
  priceDifference,
  onUpgradeClick,
  className = '',
  compact = false,
}) => {
  return (
    <div
      className={`
        relative overflow-hidden rounded-xl border border-purple-500/30 bg-gradient-to-br from-slate-900/80 to-slate-950/90 backdrop-blur-md p-5 shadow-lg transition-all hover:border-purple-500/50 hover:shadow-xl hover:shadow-purple-500/10
        ${compact ? 'flex items-center gap-4' : 'space-y-4'}
        ${className}
      `}
    >
      {/* Glassmorphic blur accent */}
      <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

      {/* Content */}
      <div className={compact ? 'flex-1' : ''}>
        {/* Header */}
        <div className="flex items-start gap-3 mb-2">
          <div className="p-2 rounded-lg bg-purple-500/20 border border-purple-500/30">
            <Lock className="w-5 h-5 text-purple-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-white text-base">{featureName}</h3>
            <p className="text-sm text-slate-300 leading-relaxed">{description}</p>
          </div>
        </div>

        {/* Tier Comparison */}
        <div className={`grid grid-cols-2 gap-3 my-4 ${compact ? 'hidden sm:grid' : ''}`}>
          {/* Current Tier */}
          <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700">
            <p className="text-xs font-medium text-slate-400 mb-1">Your Plan</p>
            <p className="text-lg font-semibold text-slate-200">{currentTierName}</p>
            <p className="text-xs text-slate-400 mt-1">${currentPrice}/month</p>
          </div>

          {/* Required Tier */}
          <div className="p-3 rounded-lg bg-purple-900/40 border border-purple-500/30">
            <p className="text-xs font-medium text-purple-300 mb-1">Required Tier</p>
            <p className="text-lg font-semibold text-purple-200">{requiredTierName}</p>
            <p className="text-xs text-purple-300 mt-1">${upgradePrice}/month</p>
          </div>
        </div>

        {/* Price Difference (if any) */}
        {priceDifference > 0 && (
          <div className="flex items-center justify-between p-3 rounded-lg bg-blue-900/20 border border-blue-500/30 mb-4">
            <span className="text-sm text-blue-300 font-medium">Upgrade Cost</span>
            <span className="text-lg font-semibold text-blue-200">
              +${priceDifference}
              <span className="text-sm text-blue-300 ml-1">/month</span>
            </span>
          </div>
        )}
      </div>

      {/* Action Button */}
      <button
        onClick={onUpgradeClick}
        className={`
          relative inline-flex items-center justify-center gap-2 font-semibold rounded-lg transition-all whitespace-nowrap
          bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 text-white shadow-lg hover:shadow-purple-500/30
          focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-950
          ${compact ? 'px-4 py-2 text-sm' : 'w-full px-5 py-3 text-base'}
        `}
      >
        <Zap className={compact ? 'w-4 h-4' : 'w-5 h-5'} />
        <span>Upgrade Now</span>
        <ArrowRight className={compact ? 'w-4 h-4' : 'w-5 h-5'} />
      </button>
    </div>
  )
}

export default UpgradePromptCard
