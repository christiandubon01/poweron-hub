'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Loader2, AlertCircle } from 'lucide-react'
import clsx from 'clsx'

interface GCContact {
  id: string
  org_id: string
  name: string
  company?: string
  fit_score: number
  activity_score: number
  historical_win_rate: number
  relationship_health: 'green' | 'yellow' | 'red'
  total_projects: number
  total_revenue: number
}

const HEALTH_FILTERS = ['all', 'green', 'yellow', 'red'] as const

export function GCDashboard() {
  const { profile } = useAuth()
  const [contacts, setContacts] = useState<GCContact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<typeof HEALTH_FILTERS[number]>('all')

  const orgId = profile?.org_id

  useEffect(() => {
    if (!orgId) return
    fetchContacts()
  }, [orgId])

  const fetchContacts = async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const { data, error: fetchError } = await supabase
        .from('gc_contacts' as never)
        .select('*')
        .eq('org_id', orgId)
        .order('fit_score', { ascending: false })

      if (fetchError) throw fetchError
      setContacts(data as GCContact[] || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch GC contacts')
    } finally {
      setLoading(false)
    }
  }

  const filteredContacts = activeFilter === 'all'
    ? contacts
    : contacts.filter(contact => contact.relationship_health === activeFilter)

  const getHealthColor = (health: 'green' | 'yellow' | 'red') => {
    return {
      green: 'bg-emerald-400/10 text-emerald-400',
      yellow: 'bg-yellow-400/10 text-yellow-400',
      red: 'bg-red-400/10 text-red-400',
    }[health]
  }

  const getScoreBarColor = (score: number) => {
    if (score > 70) return 'bg-emerald-500'
    if (score >= 40) return 'bg-yellow-500'
    return 'bg-red-500'
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
  }

  return (
    <div className="space-y-4">
      {/* Filter Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 border-b border-gray-800">
        {HEALTH_FILTERS.map((filter) => (
          <button
            key={filter}
            onClick={() => setActiveFilter(filter)}
            className={clsx(
              'px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors',
              activeFilter === filter
                ? 'bg-pink-500/20 text-pink-400'
                : 'text-gray-400 hover:text-gray-300'
            )}
          >
            {filter === 'all' ? 'All' : filter.charAt(0).toUpperCase() + filter.slice(1)}
          </button>
        ))}
      </div>

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
      {!loading && filteredContacts.length === 0 && (
        <div className="py-12 text-center">
          <div className="text-gray-500 text-sm">No GC contacts found</div>
        </div>
      )}

      {/* GC Contact Cards */}
      <div className="space-y-3">
        {filteredContacts.map((contact) => (
          <div
            key={contact.id}
            className="p-4 bg-gray-800/50 border border-gray-700 rounded-lg hover:border-gray-600 transition-colors space-y-4"
          >
            <div className="flex justify-between items-start">
              <div>
                <h4 className="text-gray-100 font-semibold">{contact.name}</h4>
                <p className="text-gray-400 text-sm">{contact.company || '-'}</p>
              </div>
              <span className={clsx('px-3 py-1 rounded-full text-xs font-medium', getHealthColor(contact.relationship_health))}>
                {contact.relationship_health.charAt(0).toUpperCase() + contact.relationship_health.slice(1)}
              </span>
            </div>

            {/* Score Bars */}
            <div className="space-y-3">
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-gray-400 text-sm">Fit Score</span>
                  <span className="text-gray-300 text-sm font-medium">{contact.fit_score}%</span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
                  <div
                    className={clsx('h-full transition-all', getScoreBarColor(contact.fit_score))}
                    style={{ width: `${contact.fit_score}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-gray-400 text-sm">Activity Score</span>
                  <span className="text-gray-300 text-sm font-medium">{contact.activity_score}</span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full bg-cyan-500 transition-all"
                    style={{ width: `${Math.min(contact.activity_score, 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <span className="text-gray-500 block text-xs">Win Rate</span>
                <p className="text-gray-300 font-medium">{contact.historical_win_rate}%</p>
              </div>
              <div>
                <span className="text-gray-500 block text-xs">Projects</span>
                <p className="text-gray-300 font-medium">{contact.total_projects}</p>
              </div>
              <div>
                <span className="text-gray-500 block text-xs">Revenue</span>
                <p className="text-gray-300 font-medium">{formatCurrency(contact.total_revenue)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
