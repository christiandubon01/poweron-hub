// @ts-nocheck
/**
 * HunterOutcomeModal.tsx
 * Modal for capturing lead outcomes (Won/Lost/Deferred)
 *
 * Triggered when user taps Won/Lost/Defer button on a lead card.
 * 
 * Won flow:
 *   - Revenue input (number)
 *   - Job type confirmation (select)
 *   - "What worked?" textarea
 *   - Close method dropdown (phone, email, inperson, referral)
 * 
 * Lost flow:
 *   - Loss reason dropdown (price, timing, competitor, ghosted, other)
 *   - Competitor name optional text
 *   - "What happened?" textarea
 * 
 * Defer flow:
 *   - Follow-up date picker
 *   - Notes field
 * 
 * Submit triggers Supabase write + debrief prompt.
 * Glassmorphic dark theme modal matching Hub style.
 */

import React, { useState } from 'react'
import { X, Check, AlertCircle } from 'lucide-react'
import clsx from 'clsx'
import {
  markLeadWon,
  markLeadLost,
  markLeadDeferred,
  type WonDetails,
  type LostDetails,
} from '@/services/hunter/HunterOutcomeTracker'

export interface HunterOutcomeModalProps {
  leadId: string
  leadName: string
  currentStatus: 'new' | 'contacted' | 'quoted' | 'won' | 'lost' | 'deferred'
  isOpen: boolean
  outcomeType: 'won' | 'lost' | 'deferred' // which flow to show
  onClose: () => void
  onSuccess?: () => void
}

const LOSS_REASONS = ['price', 'timing', 'competitor', 'ghosted', 'other'] as const
const CLOSE_METHODS = ['phone', 'email', 'inperson', 'referral'] as const
const JOB_TYPES = ['electrical', 'hvac', 'plumbing', 'solar', 'reno', 'maintenance'] as const

export function HunterOutcomeModal({
  leadId,
  leadName,
  currentStatus,
  isOpen,
  outcomeType,
  onClose,
  onSuccess,
}: HunterOutcomeModalProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // WON flow state
  const [wonRevenue, setWonRevenue] = useState('')
  const [wonJobType, setWonJobType] = useState('electrical')
  const [wonCloseMethod, setWonCloseMethod] = useState('phone')
  const [wonNotes, setWonNotes] = useState('')

  // LOST flow state
  const [lostReason, setLostReason] = useState('price')
  const [lostCompetitor, setLostCompetitor] = useState('')
  const [lostNotes, setLostNotes] = useState('')

  // DEFERRED flow state
  const [deferredDate, setDeferredDate] = useState('')
  const [deferredNotes, setDeferredNotes] = useState('')

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleSubmitWon = async () => {
    setError(null)

    if (!wonRevenue || parseFloat(wonRevenue) <= 0) {
      setError('Please enter a valid revenue amount')
      return
    }

    setLoading(true)
    try {
      const details: WonDetails = {
        actualRevenue: parseFloat(wonRevenue),
        jobType: wonJobType,
        closeMethod: wonCloseMethod,
        notes: wonNotes || undefined,
      }
      await markLeadWon(leadId, details)
      onSuccess?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark lead as won')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmitLost = async () => {
    setError(null)
    setLoading(true)

    try {
      const details: LostDetails = {
        lossReason,
        competitorInfo: lostCompetitor || undefined,
        notes: lostNotes || undefined,
      }
      await markLeadLost(leadId, details)
      onSuccess?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark lead as lost')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmitDeferred = async () => {
    setError(null)

    if (!deferredDate) {
      setError('Please select a follow-up date')
      return
    }

    setLoading(true)
    try {
      await markLeadDeferred(leadId, deferredDate, deferredNotes || undefined)
      onSuccess?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to defer lead')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div className="relative w-full max-w-md mx-4 bg-gray-900/95 border border-gray-700/50 rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700/30">
          <div>
            <h2 className="text-lg font-bold text-white">
              {outcomeType === 'won' && '🎉 Lead Won'}
              {outcomeType === 'lost' && '❌ Lead Lost'}
              {outcomeType === 'deferred' && '⏰ Defer Lead'}
            </h2>
            <p className="text-sm text-gray-400 mt-1">{leadName}</p>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
          {error && (
            <div className="flex gap-2 p-3 bg-red-900/30 border border-red-700/50 rounded-lg">
              <AlertCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-200">{error}</p>
            </div>
          )}

          {outcomeType === 'won' && (
            <>
              {/* Revenue Input */}
              <div>
                <label className="block text-sm font-medium text-gray-200 mb-2">
                  Actual Revenue ($)
                </label>
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={wonRevenue}
                  onChange={(e) => setWonRevenue(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
                />
              </div>

              {/* Job Type */}
              <div>
                <label className="block text-sm font-medium text-gray-200 mb-2">
                  Job Type
                </label>
                <select
                  value={wonJobType}
                  onChange={(e) => setWonJobType(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
                >
                  {JOB_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Close Method */}
              <div>
                <label className="block text-sm font-medium text-gray-200 mb-2">
                  How did you close it?
                </label>
                <select
                  value={wonCloseMethod}
                  onChange={(e) => setWonCloseMethod(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
                >
                  {CLOSE_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {method.charAt(0).toUpperCase() + method.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              {/* What Worked */}
              <div>
                <label className="block text-sm font-medium text-gray-200 mb-2">
                  What worked? (optional)
                </label>
                <textarea
                  value={wonNotes}
                  onChange={(e) => setWonNotes(e.target.value)}
                  placeholder="What pitch angle, objection handle, or timing made this work?"
                  rows={3}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 resize-none"
                />
              </div>
            </>
          )}

          {outcomeType === 'lost' && (
            <>
              {/* Loss Reason */}
              <div>
                <label className="block text-sm font-medium text-gray-200 mb-2">
                  Why did you lose it?
                </label>
                <select
                  value={lostReason}
                  onChange={(e) => setLostReason(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
                >
                  {LOSS_REASONS.map((reason) => (
                    <option key={reason} value={reason}>
                      {reason === 'price' && 'Price too high'}
                      {reason === 'timing' && 'Wrong timing'}
                      {reason === 'competitor' && 'Lost to competitor'}
                      {reason === 'ghosted' && 'Client ghosted'}
                      {reason === 'other' && 'Other reason'}
                    </option>
                  ))}
                </select>
              </div>

              {/* Competitor Info */}
              {lostReason === 'competitor' && (
                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-2">
                    Competitor name (optional)
                  </label>
                  <input
                    type="text"
                    value={lostCompetitor}
                    onChange={(e) => setLostCompetitor(e.target.value)}
                    placeholder="e.g., Company name"
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
                  />
                </div>
              )}

              {/* What Happened */}
              <div>
                <label className="block text-sm font-medium text-gray-200 mb-2">
                  What happened? (optional)
                </label>
                <textarea
                  value={lostNotes}
                  onChange={(e) => setLostNotes(e.target.value)}
                  placeholder="Any insights or feedback for future pitches?"
                  rows={3}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 resize-none"
                />
              </div>
            </>
          )}

          {outcomeType === 'deferred' && (
            <>
              {/* Follow-up Date */}
              <div>
                <label className="block text-sm font-medium text-gray-200 mb-2">
                  Follow-up Date
                </label>
                <input
                  type="date"
                  value={deferredDate}
                  onChange={(e) => setDeferredDate(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-200 mb-2">
                  Notes (optional)
                </label>
                <textarea
                  value={deferredNotes}
                  onChange={(e) => setDeferredNotes(e.target.value)}
                  placeholder="Why deferring? What needs to change?"
                  rows={3}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 resize-none"
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-4 border-t border-gray-700/30">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            Cancel
          </button>
          <button
            onClick={
              outcomeType === 'won'
                ? handleSubmitWon
                : outcomeType === 'lost'
                  ? handleSubmitLost
                  : handleSubmitDeferred
            }
            disabled={loading}
            className={clsx(
              'flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium',
              outcomeType === 'won'
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : outcomeType === 'lost'
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
            )}
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Check size={18} />
                <span>
                  {outcomeType === 'won' && 'Mark Won'}
                  {outcomeType === 'lost' && 'Mark Lost'}
                  {outcomeType === 'deferred' && 'Defer'}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
