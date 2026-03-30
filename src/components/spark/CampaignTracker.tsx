// @ts-nocheck
'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Plus, Loader2, AlertCircle } from 'lucide-react'
import clsx from 'clsx'

interface Campaign {
  id: string
  org_id: string
  name: string
  campaign_type: 'social_media' | 'email_blast' | 'referral_program' | 'trade_show' | 'other'
  start_date: string
  end_date: string
  budget: number
  status: 'planned' | 'active' | 'completed'
  recipients?: number
  opens?: number
  clicks?: number
  conversions?: number
  revenue_attributed?: number
  created_at: string
}

const CAMPAIGN_TYPES = {
  social_media: { label: 'Social Media', color: 'bg-blue-400/10 text-blue-400' },
  email_blast: { label: 'Email Blast', color: 'bg-purple-400/10 text-purple-400' },
  referral_program: { label: 'Referral Program', color: 'bg-emerald-400/10 text-emerald-400' },
  trade_show: { label: 'Trade Show', color: 'bg-yellow-400/10 text-yellow-400' },
  other: { label: 'Other', color: 'bg-gray-400/10 text-gray-400' },
}

const STATUS_COLORS = {
  planned: 'bg-cyan-400/10 text-cyan-400',
  active: 'bg-emerald-400/10 text-emerald-400',
  completed: 'bg-gray-400/10 text-gray-400',
}

export function CampaignTracker() {
  const { user, profile } = useAuth()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    campaign_type: 'social_media' as Campaign['campaign_type'],
    start_date: '',
    budget: '',
  })

  const orgId = profile?.org_id

  useEffect(() => {
    if (!orgId) return
    fetchCampaigns()
  }, [orgId])

  const fetchCampaigns = async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const { data, error: fetchError } = await supabase
        .from('campaigns' as never)
        .select('*')
        .eq('org_id', orgId)
        .order('start_date', { ascending: false })

      if (fetchError) throw fetchError
      setCampaigns(data as Campaign[] || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch campaigns')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!orgId || !user?.id) return

    try {
      const { error: insertError } = await supabase
        .from('campaigns' as never)
        .insert([
          {
            org_id: orgId,
            name: formData.name,
            campaign_type: formData.campaign_type,
            start_date: formData.start_date,
            end_date: null,
            budget: formData.budget ? parseFloat(formData.budget) : 0,
            status: 'planned',
            created_at: new Date().toISOString(),
          },
        ])

      if (insertError) throw insertError

      setFormData({ name: '', campaign_type: 'social_media', start_date: '', budget: '' })
      setShowForm(false)
      await fetchCampaigns()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create campaign')
    }
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString()
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h3 className="text-gray-100 font-semibold">Campaigns</h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 rounded-md text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create Campaign
        </button>
      </div>

      {/* Create Campaign Form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="p-4 bg-gray-800/50 border border-gray-700 rounded-lg space-y-3"
        >
          <input
            type="text"
            placeholder="Campaign Name *"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-gray-100 placeholder-gray-500 focus:outline-none focus:border-pink-500"
          />
          <select
            value={formData.campaign_type}
            onChange={(e) => setFormData({ ...formData, campaign_type: e.target.value as Campaign['campaign_type'] })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-gray-100 focus:outline-none focus:border-pink-500"
          >
            {Object.entries(CAMPAIGN_TYPES).map(([key, value]) => (
              <option key={key} value={key}>
                {value.label}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={formData.start_date}
            onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
            required
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-gray-100 focus:outline-none focus:border-pink-500"
          />
          <input
            type="number"
            placeholder="Budget"
            value={formData.budget}
            onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-gray-100 placeholder-gray-500 focus:outline-none focus:border-pink-500"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 rounded-md font-medium transition-colors"
            >
              Create Campaign
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="flex-1 px-4 py-2 bg-gray-700/50 text-gray-300 hover:bg-gray-700 rounded-md font-medium transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex justify-center items-center py-8">
          <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400">
          <AlertCircle className="w-5 h-5" />
          <span>{error}</span>
        </div>
      )}

      {/* Empty State */}
      {!loading && campaigns.length === 0 && (
        <div className="py-12 text-center">
          <div className="text-gray-500 text-sm">No campaigns found</div>
        </div>
      )}

      {/* Campaign Cards */}
      <div className="space-y-3">
        {campaigns.map((campaign) => (
          <div
            key={campaign.id}
            className="p-4 bg-gray-800/50 border border-gray-700 rounded-lg hover:border-gray-600 transition-colors"
          >
            <div className="flex justify-between items-start mb-3">
              <div>
                <h4 className="text-gray-100 font-semibold">{campaign.name}</h4>
              </div>
              <div className="flex gap-2">
                <span className={clsx('px-3 py-1 rounded-full text-xs font-medium', CAMPAIGN_TYPES[campaign.campaign_type].color)}>
                  {CAMPAIGN_TYPES[campaign.campaign_type].label}
                </span>
                <span className={clsx('px-3 py-1 rounded-full text-xs font-medium', STATUS_COLORS[campaign.status])}>
                  {campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-gray-500">Start Date</span>
                <p className="text-gray-300">{campaign.start_date ? formatDate(campaign.start_date) : '-'}</p>
              </div>
              <div>
                <span className="text-gray-500">Budget</span>
                <p className="text-gray-300">{formatCurrency(campaign.budget)}</p>
              </div>
            </div>

            {/* ROI Metrics */}
            {(campaign.recipients || campaign.opens || campaign.clicks || campaign.conversions) ? (
              <div className="mt-3 pt-3 border-t border-gray-700">
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div>
                    <div className="text-xs text-gray-500">Sent</div>
                    <div className="text-sm font-semibold text-gray-200">{campaign.recipients ?? 0}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Opens</div>
                    <div className="text-sm font-semibold text-cyan-400">
                      {campaign.opens ?? 0}
                      {campaign.recipients ? (
                        <span className="text-[10px] text-gray-500 ml-1">
                          ({Math.round(((campaign.opens ?? 0) / campaign.recipients) * 100)}%)
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Clicks</div>
                    <div className="text-sm font-semibold text-blue-400">{campaign.clicks ?? 0}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Converts</div>
                    <div className="text-sm font-semibold text-emerald-400">{campaign.conversions ?? 0}</div>
                  </div>
                </div>

                {/* ROI Bar */}
                {campaign.revenue_attributed != null && campaign.budget > 0 && (
                  <div className="mt-3">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-500">ROI</span>
                      <span className={clsx(
                        'font-semibold',
                        campaign.revenue_attributed > campaign.budget ? 'text-emerald-400' : 'text-red-400'
                      )}>
                        {formatCurrency(campaign.revenue_attributed)} / {formatCurrency(campaign.budget)}
                        <span className="ml-1 text-[10px]">
                          ({Math.round(((campaign.revenue_attributed - campaign.budget) / campaign.budget) * 100)}%)
                        </span>
                      </span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={clsx(
                          'h-full rounded-full transition-all',
                          campaign.revenue_attributed >= campaign.budget ? 'bg-emerald-500' : 'bg-red-500'
                        )}
                        style={{ width: `${Math.min((campaign.revenue_attributed / campaign.budget) * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {campaign.end_date && (
              <div className="mt-3 text-xs text-gray-500">
                End Date: {formatDate(campaign.end_date)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
