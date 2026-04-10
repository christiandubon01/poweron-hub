/**
 * TierGateWrapper Component
 *
 * React component that wraps any feature panel and gates access based on subscription tier.
 *
 * Props:
 *   - requiredTier: minimum tier slug required ('solo' | 'team' | 'enterprise')
 *   - requiredFeature: optional specific feature gate (for more fine-grained control)
 *   - children: component to render if access granted
 *   - fallback: optional custom fallback UI (default: upgrade prompt)
 *   - showTeaser: whether to show blurred content as teaser (default: true)
 *   - onUpgradeClick: optional callback when upgrade button clicked
 *
 * Behavior:
 *   - If user has access: renders children normally
 *   - If user lacks access: renders upgrade prompt + blurred overlay on children
 */

import React, { useEffect, useState } from 'react'
import { useSubscription } from '@/hooks/useSubscription'
import { getUpgradePrompt } from '@/services/stripe/TierGateService'
import type { GatedFeature } from '@/services/stripe/TierGateService'
import UpgradePromptCard from './UpgradePromptCard'
import { SUBSCRIPTION_TIERS } from '@/config/subscriptionTiers'

export interface TierGateWrapperProps {
  /** Minimum tier required: 'free' | 'solo' | 'team' | 'enterprise' */
  requiredTier?: string
  /** Specific feature gate (alternative to requiredTier) */
  requiredFeature?: GatedFeature
  /** Component to render if access granted */
  children: React.ReactNode
  /** Custom fallback UI (default: UpgradePromptCard) */
  fallback?: React.ReactNode
  /** Show blurred content as teaser when locked (default: true) */
  showTeaser?: boolean
  /** Callback when upgrade button clicked */
  onUpgradeClick?: (upgradeTo: string) => void
  /** Organization ID (auto-detected from auth if not provided) */
  orgId?: string
  /** CSS class */
  className?: string
}

export const TierGateWrapper: React.FC<TierGateWrapperProps> = ({
  requiredTier = 'solo',
  requiredFeature,
  children,
  fallback,
  showTeaser = true,
  onUpgradeClick,
  orgId,
  className = '',
}) => {
  const { tier, isLoading } = useSubscription(orgId)
  const [hasAccess, setHasAccess] = useState(false)

  // Determine if user has access
  useEffect(() => {
    if (isLoading) {
      setHasAccess(false)
      return
    }

    // Check feature gate if specified
    if (requiredFeature) {
      const tierSlug = tier || 'free'
      const prompt = getUpgradePrompt(requiredFeature, tierSlug)
      const currentAllowedTiers = getTierHierarchy(tierSlug)
      const requiredAllowedTiers = getTierHierarchy(prompt.requiredTierSlug)
      setHasAccess(currentAllowedTiers >= requiredAllowedTiers)
    } else {
      // Check tier gate
      const currentTierHierarchy = getTierHierarchy(tier || 'free')
      const requiredTierHierarchy = getTierHierarchy(requiredTier)
      setHasAccess(currentTierHierarchy >= requiredTierHierarchy)
    }
  }, [tier, isLoading, requiredTier, requiredFeature])

  // If loading, show skeleton
  if (isLoading) {
    return (
      <div className={`animate-pulse rounded-lg bg-slate-800 p-8 ${className}`}>
        <div className="h-4 bg-slate-700 rounded w-1/3 mb-4" />
        <div className="h-4 bg-slate-700 rounded w-2/3" />
      </div>
    )
  }

  // If user has access, render children normally
  if (hasAccess) {
    return <div className={className}>{children}</div>
  }

  // User lacks access — show upgrade prompt + teaser
  const currentTierSlug = tier || 'free'
  const upgradePrompt = requiredFeature
    ? getUpgradePrompt(requiredFeature, currentTierSlug)
    : {
        featureName: `${requiredTier.charAt(0).toUpperCase() + requiredTier.slice(1)} Features`,
        description: `Unlock all ${requiredTier} tier features`,
        requiredTierSlug: requiredTier,
        requiredTierName: SUBSCRIPTION_TIERS[requiredTier]?.name || 'Premium',
        currentTierName: SUBSCRIPTION_TIERS[currentTierSlug]?.name || 'Free',
        currentPrice: SUBSCRIPTION_TIERS[currentTierSlug]?.monthlyPrice || 0,
        upgradePrice: SUBSCRIPTION_TIERS[requiredTier]?.monthlyPrice || 0,
        priceDifference: Math.max(0, (SUBSCRIPTION_TIERS[requiredTier]?.monthlyPrice || 0) - (SUBSCRIPTION_TIERS[currentTierSlug]?.monthlyPrice || 0)),
        message: '',
      }

  return (
    <div className={className}>
      {/* Teaser: blurred content + overlay */}
      {showTeaser && (
        <div className="relative mb-6 rounded-lg overflow-hidden">
          {/* Blurred content */}
          <div className="blur-sm opacity-50 pointer-events-none select-none">
            {children}
          </div>

          {/* Glassmorphic overlay */}
          <div className="absolute inset-0 bg-gradient-to-b from-slate-950/40 via-slate-950/60 to-slate-950/80 backdrop-blur-sm flex items-center justify-center">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <p className="text-sm font-medium text-slate-300">Feature Locked</p>
              <p className="text-xs text-slate-400 mt-1">Scroll down to upgrade</p>
            </div>
          </div>
        </div>
      )}

      {/* Upgrade prompt */}
      {fallback || (
        <UpgradePromptCard
          featureName={upgradePrompt.featureName}
          description={upgradePrompt.description}
          currentTierName={upgradePrompt.currentTierName}
          requiredTierName={upgradePrompt.requiredTierName}
          currentPrice={upgradePrompt.currentPrice}
          upgradePrice={upgradePrompt.upgradePrice}
          priceDifference={upgradePrompt.priceDifference}
          onUpgradeClick={() => {
            if (onUpgradeClick) {
              onUpgradeClick(upgradePrompt.requiredTierSlug)
            } else {
              // Default: navigate to billing page
              try {
                window.location.href = `/billing?upgrade_to=${upgradePrompt.requiredTierSlug}`
              } catch (err) {
                console.error('[TierGateWrapper] upgrade navigation failed:', err)
              }
            }
          }}
        />
      )}
    </div>
  )
}

// ── Tier hierarchy helper ─────────────────────────────────────────────────────

function getTierHierarchy(tier: string): number {
  const hierarchy: Record<string, number> = {
    free: 0,
    solo: 1,
    team: 2,
    enterprise: 3,
  }
  return hierarchy[tier] ?? 0
}

export default TierGateWrapper
