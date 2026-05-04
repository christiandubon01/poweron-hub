// @ts-nocheck
/**
 * YelpAdPanel.tsx
 * Yelp Ad spend tracker + ROI dashboard for HUNTER
 * Manual entry workflow — ready to wire to Yelp API when available
 */
import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useHunterStore } from '@/store/hunterStore'
import clsx from 'clsx'

const CURRENT_MONTH = new Date().toISOString().slice(0, 7)

function formatMonth(m) {
  const [y, mo] = m.split('-')
  return new Date(parseInt(y), parseInt(mo) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export function YelpAdPanel() {
  const leads = useHunterStore((s) => s.leads)
  const [month, setMonth] = useState(CURRENT_MONTH)
  const [dailyBudget, setDailyBudget] = useState('10')
  const [monthlySpend, setMonthlySpend] = useState('')
  const [notes, setNotes] = useState('')
  const [totalLeadsManual, setTotalLeadsManual] = useState('')
  const [convertedManual, setConvertedManual] = useState('')
  const [revenueManual, setRevenueManual] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [userId, setUserId] = useState(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data?.user?.id ?? null))
  }, [])

  const loadSpend = useCallback(async () => {
    if (!userId) return
    const { data } = await supabase.from('yelp_spend_log').select('*').eq('user_id', userId).eq('month', month).maybeSingle()
    if (data) {
      setDailyBudget(String(data.daily_budget ?? '10'))
      setMonthlySpend(String(data.monthly_spend ?? ''))
      setNotes(data.notes ?? '')
      setTotalLeadsManual(data.total_leads_manual != null ? String(data.total_leads_manual) : '')
      setConvertedManual(data.converted_manual != null ? String(data.converted_manual) : '')
      setRevenueManual(data.revenue_manual != null ? String(data.revenue_manual) : '')
    } else {
      setDailyBudget('10')
      setMonthlySpend('')
      setNotes('')
      setTotalLeadsManual('')
      setConvertedManual('')
      setRevenueManual('')
    }
  }, [userId, month])

  useEffect(() => { loadSpend() }, [loadSpend])

  const handleSave = async () => {
    if (!userId) return
    setSaving(true)
    await supabase.from('yelp_spend_log').upsert({
      user_id: userId, month,
      daily_budget: parseFloat(dailyBudget) || 0,
      monthly_spend: parseFloat(monthlySpend) || 0,
      notes,
      total_leads_manual: parseInt(totalLeadsManual) || null,
      converted_manual: parseInt(convertedManual) || null,
      revenue_manual: parseFloat(revenueManual) || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,month' })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const yelpLeads = leads.filter((l) =>
    (l.source_tag === 'yelp_ad' || l.sourceTag === 'yelp_ad' || l.source === 'yelp_ad') &&
    (l.discovered_at || l.created_at || '').startsWith(month)
  )
  const wonYelpLeads = yelpLeads.filter((l) => l.status === 'won' || l.status === 'estimated' || l.disposition === 'won_archived')
  const hunterRevenue = wonYelpLeads.reduce((sum, l) => sum + (typeof (l.estimated_value || l.estimatedValue) === 'number' ? (l.estimated_value || l.estimatedValue || 0) : 0), 0)
  const totalRevenue = parseFloat(revenueManual) || hunterRevenue
  const totalLeads = parseInt(totalLeadsManual) || yelpLeads.length
  const totalConverted = parseInt(convertedManual) || wonYelpLeads.length
  const spend = parseFloat(monthlySpend) || (parseFloat(dailyBudget) || 0) * 30
  const roi = spend > 0 ? ((totalRevenue - spend) / spend) * 100 : null
  const costPerLead = totalLeads > 0 && spend > 0 ? spend / totalLeads : null
  const conversionRate = totalLeads > 0 ? (totalConverted / totalLeads) * 100 : null

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-lg font-bold text-white">
          <span style={{color:'#d32323'}}>★</span> Yelp Ads
        </span>
        <span className="text-xs text-gray-500">Manual tracking</span>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-400">Month</label>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
          className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 focus:outline-none focus:border-red-500" />
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
        <div className="text-xs font-bold text-gray-400 uppercase tracking-widest">Ad Spend — {formatMonth(month)}</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Daily Budget ($)</label>
            <input type="number" value={dailyBudget} onChange={(e) => setDailyBudget(e.target.value)}
              className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 focus:outline-none focus:border-red-500" placeholder="10" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Actual Monthly Spend ($)</label>
            <input type="number" value={monthlySpend} onChange={(e) => setMonthlySpend(e.target.value)}
              className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 focus:outline-none focus:border-red-500"
              placeholder={String((parseFloat(dailyBudget) || 0) * 30)} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Total Leads Received</label>
            <input type="number" value={totalLeadsManual} onChange={(e) => setTotalLeadsManual(e.target.value)}
              className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 focus:outline-none focus:border-red-500"
              placeholder="0" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Converted</label>
            <input type="number" value={convertedManual} onChange={(e) => setConvertedManual(e.target.value)}
              className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 focus:outline-none focus:border-red-500"
              placeholder="0" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Actual Revenue ($)</label>
            <input type="number" value={revenueManual} onChange={(e) => setRevenueManual(e.target.value)}
              className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 focus:outline-none focus:border-red-500"
              placeholder="0" />
          </div>
        </div>
        <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
          className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 focus:outline-none focus:border-red-500"
          placeholder="Notes (e.g. paused mid-month...)" />
        <button onClick={handleSave} disabled={saving}
          className="px-4 py-1.5 bg-red-700 hover:bg-red-600 text-white text-xs font-bold rounded transition-colors">
          {saving ? 'Saving...' : saved ? 'Saved' : 'Save Spend'}
        </button>
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
        <div className="text-xs font-bold text-gray-400 uppercase tracking-widest">Performance — {formatMonth(month)}</div>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gray-800 rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">Yelp Leads</div>
            <div className="text-2xl font-bold text-white">{totalLeads}</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">Converted</div>
            <div className="text-2xl font-bold text-emerald-400">{totalConverted}</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">Ad Spend</div>
            <div className="text-2xl font-bold text-red-400">${spend.toLocaleString()}</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">Est. Revenue</div>
            <div className="text-2xl font-bold text-emerald-400">${totalRevenue.toLocaleString()}</div>
          </div>
          {costPerLead !== null && (
            <div className="bg-gray-800 rounded-lg p-3">
              <div className="text-xs text-gray-500 mb-1">Cost / Lead</div>
              <div className="text-2xl font-bold text-amber-400">${costPerLead.toFixed(0)}</div>
            </div>
          )}
          {conversionRate !== null && (
            <div className="bg-gray-800 rounded-lg p-3">
              <div className="text-xs text-gray-500 mb-1">Conversion Rate</div>
              <div className="text-2xl font-bold text-blue-400">{conversionRate.toFixed(0)}%</div>
            </div>
          )}
        </div>
        {roi !== null && (
          <div className={clsx('rounded-lg p-3 text-center', roi >= 0 ? 'bg-emerald-900/30 border border-emerald-700/40' : 'bg-red-900/30 border border-red-700/40')}>
            <div className="text-xs text-gray-400 mb-1">Return on Ad Spend</div>
            <div className={clsx('text-3xl font-bold', roi >= 0 ? 'text-emerald-400' : 'text-red-400')}>
              {roi >= 0 ? '+' : ''}{roi.toFixed(0)}%
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {roi >= 0 ? `$${(totalRevenue - spend).toLocaleString()} net gain` : `$${(spend - totalRevenue).toLocaleString()} net loss`}
            </div>
          </div>
        )}
        {yelpLeads.length === 0 && (
          <div className="text-center text-gray-600 text-xs py-4">
            No Yelp leads for {formatMonth(month)}. Add leads with source "Yelp Ad" to track ROI.
          </div>
        )}
      </div>
      {yelpLeads.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Leads This Month</div>
          <div className="space-y-2">
            {yelpLeads.map((lead) => (
              <div key={lead.id} className="flex items-center justify-between px-3 py-2 bg-gray-800 rounded text-sm">
                <div>
                  <div className="text-white font-medium">{lead.contactName || lead.contact_name || 'Unknown'}</div>
                  <div className="text-xs text-gray-500">{lead.city || '-'}</div>
                </div>
                <div className="text-right">
                  <div className={clsx('text-xs font-bold px-2 py-0.5 rounded-full',
                    lead.status === 'won' || lead.status === 'estimated' ? 'bg-emerald-900/50 text-emerald-300' :
                    lead.status === 'lost' ? 'bg-red-900/50 text-red-300' : 'bg-gray-700 text-gray-400')}>
                    {lead.status || 'new'}
                  </div>
                  {(lead.estimated_value || lead.estimatedValue) > 0 && (
                    <div className="text-xs text-gray-400 mt-0.5">${(lead.estimated_value || lead.estimatedValue || 0).toLocaleString()}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default YelpAdPanel