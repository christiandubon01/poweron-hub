/**
 * Follow-Up Queue Component
 *
 * Displays pending follow-ups sorted by due date.
 * Overdue items highlighted at top.
 * Allows: Send Now, Edit Draft, Skip with reason.
 */

import React, { useState } from 'react'
import { Calendar, Mail, Edit2, AlertCircle, CheckCircle, X as SkipIcon } from 'lucide-react'
import type { FollowUpTemplate } from '@/services/salesIntel/FollowUpSequencer'

export interface FollowUpQueueProps {
  followUps: FollowUpTemplate[]
  onSendNow?: (followUp: FollowUpTemplate) => void
  onEditDraft?: (followUp: FollowUpTemplate) => void
  onSkip?: (followUp: FollowUpTemplate, reason: string) => void
  onComplete?: (followUp: FollowUpTemplate) => void
}

/**
 * Get CSS classes for status badge
 */
function getStatusBadgeClass(status: FollowUpTemplate['status']): string {
  switch (status) {
    case 'pending':
      return 'bg-yellow-100 text-yellow-800 border-yellow-300'
    case 'sent':
      return 'bg-blue-100 text-blue-800 border-blue-300'
    case 'completed':
      return 'bg-green-100 text-green-800 border-green-300'
    case 'skipped':
      return 'bg-gray-100 text-gray-700 border-gray-300'
    default:
      return 'bg-gray-100 text-gray-600 border-gray-300'
  }
}

/**
 * Get follow-up type label
 */
function getTypeLabel(type: FollowUpTemplate['type']): string {
  const labels: Record<string, string> = {
    initial_followup: 'Initial Follow-Up',
    value_add: 'Value-Add',
    direct_ask: 'Direct Ask',
    final_reach: 'Final Reach',
  }
  return labels[type] || type
}

/**
 * Format date for display
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Check if a follow-up is overdue
 */
function isOverdue(dueDate: string, status: FollowUpTemplate['status']): boolean {
  if (status !== 'pending') return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dueDate)
  due.setHours(0, 0, 0, 0)
  return due < today
}

/**
 * Sort follow-ups: overdue first, then by due date
 */
function sortFollowUps(followUps: FollowUpTemplate[]): FollowUpTemplate[] {
  return [...followUps].sort((a, b) => {
    const aOverdue = isOverdue(a.dueDate, a.status)
    const bOverdue = isOverdue(b.dueDate, b.status)

    if (aOverdue && !bOverdue) return -1
    if (!aOverdue && bOverdue) return 1

    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
  })
}

/**
 * Follow-Up Queue Item Component
 */
const FollowUpItem: React.FC<{
  followUp: FollowUpTemplate
  isOverdue: boolean
  onSendNow?: (followUp: FollowUpTemplate) => void
  onEditDraft?: (followUp: FollowUpTemplate) => void
  onSkip?: (followUp: FollowUpTemplate, reason: string) => void
}> = ({ followUp, isOverdue, onSendNow, onEditDraft, onSkip }) => {
  const [showSkipReason, setShowSkipReason] = useState(false)
  const [skipReason, setSkipReason] = useState('')

  const handleSkip = () => {
    if (skipReason.trim()) {
      onSkip?.(followUp, skipReason)
      setShowSkipReason(false)
      setSkipReason('')
    }
  }

  return (
    <div
      className={`border-l-4 p-4 rounded-sm transition-all ${
        isOverdue ? 'border-l-red-500 bg-red-50' : 'border-l-blue-400 bg-white hover:bg-gray-50'
      }`}
    >
      {/* Header row: Type, Lead, Due Date, Status */}
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-600">
              {getTypeLabel(followUp.type)}
            </span>
            {isOverdue && (
              <span className="flex items-center gap-1 text-xs font-semibold text-red-600">
                <AlertCircle size={12} />
                OVERDUE
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-gray-900">Lead #{followUp.leadId.slice(-6)}</p>
        </div>

        {/* Due Date */}
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Calendar size={16} />
          <span className="font-medium">{formatDate(followUp.dueDate)}</span>
        </div>

        {/* Status Badge */}
        <div className={`px-2 py-1 rounded text-xs font-semibold border ${getStatusBadgeClass(followUp.status)}`}>
          {followUp.status}
        </div>
      </div>

      {/* Message Preview */}
      <div className="bg-gray-100 rounded p-3 mb-3 max-h-20 overflow-hidden">
        <p className="text-sm text-gray-700 line-clamp-3">{followUp.message}</p>
      </div>

      {/* Action Buttons */}
      {followUp.status === 'pending' && (
        <div className="flex gap-2">
          <button
            onClick={() => onSendNow?.(followUp)}
            className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded transition-colors"
            title="Send this follow-up now via email or SMS"
          >
            <Mail size={14} />
            Send Now
          </button>

          <button
            onClick={() => onEditDraft?.(followUp)}
            className="flex items-center gap-2 px-3 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm font-medium rounded transition-colors"
            title="Edit the message draft before sending"
          >
            <Edit2 size={14} />
            Edit
          </button>

          <button
            onClick={() => setShowSkipReason(!showSkipReason)}
            className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium rounded transition-colors"
            title="Skip this follow-up"
          >
            <SkipIcon size={14} />
            Skip
          </button>
        </div>
      )}

      {/* Skip Reason Input */}
      {showSkipReason && followUp.status === 'pending' && (
        <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded">
          <input
            type="text"
            placeholder="Why are you skipping this? (e.g., 'Lead went cold', 'Customer declined')"
            value={skipReason}
            onChange={e => setSkipReason(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm mb-2 focus:outline-none focus:border-yellow-500"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSkip}
              className="px-3 py-1 bg-yellow-600 hover:bg-yellow-700 text-white text-xs font-semibold rounded transition-colors"
            >
              Confirm Skip
            </button>
            <button
              onClick={() => {
                setShowSkipReason(false)
                setSkipReason('')
              }}
              className="px-3 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs font-semibold rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Completed/Sent Status Display */}
      {followUp.status === 'completed' && followUp.outcome && (
        <div className="mt-3 p-2 bg-green-50 border border-green-200 rounded text-sm">
          <p className="text-green-700">
            <strong>Outcome:</strong> {followUp.outcome}
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * FollowUpQueue: Main queue display component
 */
export const FollowUpQueue: React.FC<FollowUpQueueProps> = ({
  followUps,
  onSendNow,
  onEditDraft,
  onSkip,
  onComplete,
}) => {
  const sortedFollowUps = sortFollowUps(followUps)
  const overduCount = sortedFollowUps.filter(fu => isOverdue(fu.dueDate, fu.status)).length
  const pendingCount = sortedFollowUps.filter(fu => fu.status === 'pending').length
  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <div className="w-full bg-white rounded-lg border border-gray-200">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-bold text-gray-900">Follow-Up Queue</h3>
          <div className="flex items-center gap-4">
            {overduCount > 0 && (
              <div className="flex items-center gap-1 px-3 py-1 bg-red-100 text-red-700 text-sm font-semibold rounded">
                <AlertCircle size={16} />
                {overduCount} Overdue
              </div>
            )}
            <div className="flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-700 text-sm font-semibold rounded">
              <Mail size={16} />
              {pendingCount} Due Today
            </div>
          </div>
        </div>
        <p className="text-sm text-gray-600">Today: {today}</p>
      </div>

      {/* Queue Items */}
      <div className="divide-y">
        {sortedFollowUps.length === 0 ? (
          <div className="px-6 py-8 text-center">
            <CheckCircle size={24} className="mx-auto mb-2 text-green-600" />
            <p className="text-gray-600">No follow-ups scheduled. All caught up!</p>
          </div>
        ) : (
          sortedFollowUps.map(followUp => (
            <FollowUpItem
              key={followUp.id}
              followUp={followUp}
              isOverdue={isOverdue(followUp.dueDate, followUp.status)}
              onSendNow={onSendNow}
              onEditDraft={onEditDraft}
              onSkip={onSkip}
            />
          ))
        )}
      </div>
    </div>
  )
}

export default FollowUpQueue
