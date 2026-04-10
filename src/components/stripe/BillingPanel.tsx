/**
 * BillingPanel — Comprehensive billing and subscription management
 *
 * Features:
 * - Current plan card with tier name, price, next billing date, status badge
 * - Usage summary: API calls, projects, seats, voice captures
 * - Plan comparison table (5 tiers side by side)
 * - Upgrade/downgrade buttons with Stripe Checkout integration
 * - Manage Payment Method → Stripe Customer Portal
 * - Invoice history with download links
 * - Dark theme with glassmorphic cards
 */

import { useState, useEffect } from 'react'
import { CreditCard, ArrowUpRight, ArrowDownLeft, Settings, FileText, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import { useSubscription } from '@/hooks/useSubscription'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { checkQuotaUsage } from '@/services/stripe'
import { PlanComparisonTable } from './PlanComparisonTable'
import { InvoiceHistory } from './InvoiceHistory'

// ── Types ─────────────────────────────────────────────────────────────────────

interface UsageMetric {
  label: string
  used: number
  limit: number
  color: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BillingPanel() {
  const { subscription, loading, isActive, tierName, refresh } = useSubscription()
  const { profile } = useAuth()
  const [usageMetrics, setUsageMetrics] = useState<UsageMetric[]>([])
  const [loadingUsage, setLoadingUsage] = useState(true)
  const [showComparison, setShowComparison] = useState(false)
  const [showInvoices, setShowInvoices] = useState(false)
  const [processingAction, setProcessingAction] = useState<string | null>(null)

  const orgId = profile?.org_id

  // ── Fetch usage metrics ────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchUsage = async () => {
      if (!orgId) {
        setLoadingUsage(false)
        return
      }

      try {
        setLoadingUsage(true)
        const [apiCalls, projects, users] = await Promise.all([
          checkQuotaUsage(orgId, 'apiCalls'),
          checkQuotaUsage(orgId, 'projects'),
          checkQuotaUsage(orgId, 'users'),
        ])

        // Mock voice captures for now — would come from actual usage table
        const voiceCaptures = {
          used: Math.floor(Math.random() * 45),
          limit: 100,
          remaining: 55,
          percentUsed: 45,
        }

        setUsageMetrics([
          {
            label: 'API Calls',
            used: apiCalls.used,
            limit: apiCalls.limit,
            color: 'emerald',
          },
          {
            label: 'Projects',
            used: projects.used,
            limit: projects.limit,
            color: 'cyan',
          },
          {
            label: 'Team Seats',
            used: users.used,
            limit: users.limit,
            color: 'blue',
          },
          {
            label: 'Voice Captures',
            used: voiceCaptures.used,
            limit: voiceCaptures.limit,
            color: 'purple',
          },
        ])
      } catch (err) {
        console.error('[billing] Failed to fetch usage:', err)
      } finally {
        setLoadingUsage(false)
      }
    }

    fetchUsage()
  }, [orgId])

  // ── Upgrade/Downgrade handlers ────────────────────────────────────────────────
  const handleUpgrade = async () => {
    if (!orgId) return

    setProcessingAction('upgrade')
    try {
      const stripeKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
      if (!stripeKey || stripeKey === 'pk_test_...') {
        alert('Stripe is not configured. Please add VITE_STRIPE_PUBLISHABLE_KEY to your environment.')
        return
      }

      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: { tierSlug: 'pro', billingCycle: 'monthly' },
      })

      if (error) throw error
      if (data?.checkoutUrl) {
        window.location.href = data.checkoutUrl
      }
    } catch (err) {
      console.error('[billing] Upgrade failed:', err)
      alert('Failed to initiate upgrade. Please try again.')
    } finally {
      setProcessingAction(null)
    }
  }

  const handleDowngrade = async () => {
    if (!confirm('Are you sure you want to downgrade? Your features will be reduced.')) {
      return
    }

    if (!orgId) return

    setProcessingAction('downgrade')
    try {
      const { error } = await supabase.functions.invoke('downgrade-subscription', {
        body: { orgId, targetTier: 'solo' },
      })

      if (error) throw error
      await refresh()
      alert('Subscription downgraded successfully.')
    } catch (err) {
      console.error('[billing] Downgrade failed:', err)
      alert('Failed to downgrade subscription. Please try again.')
    } finally {
      setProcessingAction(null)
    }
  }

  const handleManagePayment = async () => {
    if (!orgId) return

    setProcessingAction('payment')
    try {
      const { data, error } = await supabase.functions.invoke('get-customer-portal', {
        body: { orgId },
      })

      if (error) throw error
      if (data?.portalUrl) {
        window.location.href = data.portalUrl
      }
    } catch (err) {
      console.error('[billing] Payment management failed:', err)
      alert('Failed to open payment settings. Please try again.')
    } finally {
      setProcessingAction(null)
    }
  }

  // ── Format next billing date ──────────────────────────────────────────────────
  const nextBillingDate = subscription?.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'N/A'

  const statusBadgeColor =
    subscription?.status === 'active'
      ? 'emerald'
      : subscription?.status === 'trialing'
        ? 'cyan'
        : subscription?.status === 'past_due'
          ? 'orange'
          : 'red'

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96 bg-bg-1">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-cyan animate-spin" />
          <p className="text-text-2">Loading billing information...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-bg-1 p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-text-1 mb-2">Billing & Subscription</h1>
        <p className="text-text-3">Manage your plan, usage, and payment methods</p>
      </div>

      {/* Current Plan Card */}
      <div className="bg-gradient-to-br from-bg-2 to-bg-3 border border-bg-4 rounded-2xl p-8 shadow-lg">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-text-1 mb-1">{tierName} Plan</h2>
            <p className="text-text-3 text-sm">
              Next billing date: <span className="text-text-2 font-medium">{nextBillingDate}</span>
            </p>
          </div>
          <div
            className={clsx(
              'px-3 py-1 rounded-full text-xs font-bold',
              statusBadgeColor === 'emerald' && 'bg-emerald-500/20 text-emerald-400',
              statusBadgeColor === 'cyan' && 'bg-cyan-500/20 text-cyan-400',
              statusBadgeColor === 'orange' && 'bg-orange-500/20 text-orange-400',
              statusBadgeColor === 'red' && 'bg-red-500/20 text-red-400',
            )}
          >
            {subscription?.status.toUpperCase()}
          </div>
        </div>

        {/* Plan Details Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 p-4 bg-bg-1/40 rounded-lg">
          {subscription?.tier ? (
            <>
              <div>
                <p className="text-text-4 text-xs uppercase tracking-wide mb-1">Monthly Price</p>
                <p className="text-2xl font-bold text-emerald-400">
                  ${subscription.tier.monthlyPrice}
                  <span className="text-sm text-text-3 font-normal">/mo</span>
                </p>
              </div>
              <div>
                <p className="text-text-4 text-xs uppercase tracking-wide mb-1">Users Included</p>
                <p className="text-2xl font-bold text-cyan-400">
                  {subscription.features.users === -1 ? 'Unlimited' : subscription.features.users}
                </p>
              </div>
              <div>
                <p className="text-text-4 text-xs uppercase tracking-wide mb-1">Projects Allowed</p>
                <p className="text-2xl font-bold text-blue-400">
                  {subscription.features.projects === -1 ? 'Unlimited' : subscription.features.projects}
                </p>
              </div>
            </>
          ) : (
            <p className="text-text-3">Subscription information unavailable</p>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleUpgrade}
            disabled={processingAction === 'upgrade' || tierName === 'Enterprise'}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-bg-3 disabled:text-text-4 text-white rounded-lg font-medium transition-colors"
          >
            {processingAction === 'upgrade' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <ArrowUpRight className="w-4 h-4" />
                Upgrade Plan
              </>
            )}
          </button>

          {isActive && (
            <button
              onClick={handleDowngrade}
              disabled={processingAction === 'downgrade' || tierName === 'Free'}
              className="flex items-center gap-2 px-4 py-2.5 bg-bg-3 hover:bg-bg-4 disabled:text-text-4 text-text-2 rounded-lg font-medium transition-colors"
            >
              {processingAction === 'downgrade' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <ArrowDownLeft className="w-4 h-4" />
                  Downgrade Plan
                </>
              )}
            </button>
          )}

          <button
            onClick={handleManagePayment}
            disabled={processingAction === 'payment'}
            className="flex items-center gap-2 px-4 py-2.5 bg-bg-3 hover:bg-bg-4 disabled:text-text-4 text-text-2 rounded-lg font-medium transition-colors"
          >
            {processingAction === 'payment' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Opening...
              </>
            ) : (
              <>
                <CreditCard className="w-4 h-4" />
                Manage Payment Method
              </>
            )}
          </button>
        </div>
      </div>

      {/* Usage Summary */}
      <div>
        <h3 className="text-lg font-bold text-text-1 mb-4">Usage Summary</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {loadingUsage ? (
            <div className="col-span-full flex items-center justify-center py-8 text-text-3">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Loading usage data...
            </div>
          ) : (
            usageMetrics.map(metric => {
              const percent = metric.limit > 0 ? Math.round((metric.used / metric.limit) * 100) : 0
              const isWarning = percent >= 80
              const isCritical = percent >= 95

              return (
                <div
                  key={metric.label}
                  className="bg-gradient-to-br from-bg-2 to-bg-3 border border-bg-4 rounded-xl p-4 hover:border-cyan-500/30 transition-colors"
                >
                  <p className="text-text-3 text-sm mb-2">{metric.label}</p>
                  <div className="flex items-baseline gap-2 mb-3">
                    <p className="text-2xl font-bold text-text-1">{metric.used}</p>
                    <p className="text-text-4 text-sm">/ {metric.limit === -1 ? '∞' : metric.limit}</p>
                  </div>
                  <div className="w-full h-2 bg-bg-1 rounded-full overflow-hidden">
                    <div
                      className={clsx(
                        'h-full transition-all',
                        isCritical && 'bg-red-500',
                        isWarning && !isCritical && 'bg-orange-500',
                        !isWarning &&
                          (metric.color === 'emerald' && 'bg-emerald-500',
                          metric.color === 'cyan' && 'bg-cyan-500',
                          metric.color === 'blue' && 'bg-blue-500',
                          metric.color === 'purple' && 'bg-purple-500'),
                      )}
                      style={{ width: `${Math.min(percent, 100)}%` }}
                    />
                  </div>
                  <p className={clsx('text-xs mt-2', isCritical ? 'text-red-400' : isWarning ? 'text-orange-400' : 'text-text-4')}>
                    {percent}% used
                  </p>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Plan Comparison & Invoice History Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Toggles */}
        <div className="flex gap-3">
          <button
            onClick={() => setShowComparison(!showComparison)}
            className={clsx(
              'flex-1 px-4 py-2.5 rounded-lg font-medium transition-colors',
              showComparison
                ? 'bg-cyan-600 text-white'
                : 'bg-bg-3 hover:bg-bg-4 text-text-2'
            )}
          >
            View All Plans
          </button>
          <button
            onClick={() => setShowInvoices(!showInvoices)}
            className={clsx(
              'flex-1 px-4 py-2.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-2',
              showInvoices
                ? 'bg-cyan-600 text-white'
                : 'bg-bg-3 hover:bg-bg-4 text-text-2'
            )}
          >
            <FileText className="w-4 h-4" />
            Invoices
          </button>
        </div>
      </div>

      {/* Plan Comparison Table */}
      {showComparison && (
        <div className="bg-gradient-to-br from-bg-2 to-bg-3 border border-bg-4 rounded-2xl p-6 overflow-auto">
          <PlanComparisonTable currentPlan={tierName} />
        </div>
      )}

      {/* Invoice History */}
      {showInvoices && <InvoiceHistory />}
    </div>
  )
}

export default BillingPanel
