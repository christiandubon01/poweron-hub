/**
 * Lead Temperature Indicator Component
 *
 * Visual temperature indicator for leads based on engagement signals.
 * HOT (red) → WARM (amber) → COLD (blue) → DEAD (gray)
 */

import React from 'react'
import { Flame, Calendar } from 'lucide-react'

export type TemperatureLevel = 'hot' | 'warm' | 'cold' | 'dead'

export interface LeadTemperatureData {
  daysSinceLastResponse?: number
  engagementSignals?: string[] // opened_email, replied, viewed_proposal, etc.
  outcomeHistory?: ('positive' | 'neutral' | 'negative' | 'no_response')[]
  lastResponseDate?: string
  isExplicitNo?: boolean
}

export interface LeadTemperatureProps {
  leadId: string
  data: LeadTemperatureData
  size?: 'small' | 'medium' | 'large'
  showLabel?: boolean
}

/**
 * Calculate temperature level based on engagement signals
 */
export function calculateTemperature(data: LeadTemperatureData): {
  level: TemperatureLevel
  description: string
  daysUntilNextFollowUp: number
} {
  // DEAD: explicit no or ghosted for 90+ days
  if (data.isExplicitNo) {
    return {
      level: 'dead',
      description: 'Explicit no or ghosted 90+ days',
      daysUntilNextFollowUp: 90,
    }
  }

  const daysSinceLastResponse = data.daysSinceLastResponse ?? 999

  // HOT: responded recently (last 24 hours) with interest signals
  if (daysSinceLastResponse <= 1) {
    const hasPositiveSignal = (data.outcomeHistory || []).some(o => o === 'positive' || o === 'neutral')
    if (hasPositiveSignal || (data.engagementSignals && data.engagementSignals.length > 0)) {
      return {
        level: 'hot',
        description: 'Active conversation, follow up in 24 hours',
        daysUntilNextFollowUp: 1,
      }
    }
  }

  // WARM: partial engagement or response in last 3 days
  if (daysSinceLastResponse <= 3) {
    const hasEngagement =
      (data.engagementSignals && data.engagementSignals.length > 0) ||
      (data.outcomeHistory && data.outcomeHistory.length > 0)
    if (hasEngagement) {
      return {
        level: 'warm',
        description: 'Opened email or partial engagement, follow up in 3 days',
        daysUntilNextFollowUp: 3,
      }
    }
  }

  // COLD: no engagement for 7+ days or explicit negative signal
  if (daysSinceLastResponse >= 7) {
    const hasNegativeSignal = (data.outcomeHistory || []).some(o => o === 'negative')
    if (hasNegativeSignal) {
      return {
        level: 'dead',
        description: 'Negative signal, 90-day re-engage list',
        daysUntilNextFollowUp: 90,
      }
    }

    return {
      level: 'cold',
      description: 'No engagement, follow up in 7 days',
      daysUntilNextFollowUp: 7,
    }
  }

  // WARM: default for 1-7 day range
  return {
    level: 'warm',
    description: 'Partial engagement, follow up in 3 days',
    daysUntilNextFollowUp: 3,
  }
}

/**
 * LeadTemperature: Visual indicator component
 */
export const LeadTemperature: React.FC<LeadTemperatureProps> = ({ leadId, data, size = 'medium', showLabel = false }) => {
  const { level, description, daysUntilNextFollowUp } = calculateTemperature(data)

  // Color and icon configuration by temperature level
  const config: Record<TemperatureLevel, { bgColor: string; textColor: string; borderColor: string }> = {
    hot: {
      bgColor: 'bg-red-100',
      textColor: 'text-red-700',
      borderColor: 'border-red-300',
    },
    warm: {
      bgColor: 'bg-amber-100',
      textColor: 'text-amber-700',
      borderColor: 'border-amber-300',
    },
    cold: {
      bgColor: 'bg-blue-100',
      textColor: 'text-blue-700',
      borderColor: 'border-blue-300',
    },
    dead: {
      bgColor: 'bg-gray-100',
      textColor: 'text-gray-600',
      borderColor: 'border-gray-300',
    },
  }

  const sizeClass: Record<'small' | 'medium' | 'large', string> = {
    small: 'w-6 h-6',
    medium: 'w-8 h-8',
    large: 'w-10 h-10',
  }

  const colors = config[level]
  const iconSize: Record<'small' | 'medium' | 'large', number> = {
    small: 16,
    medium: 20,
    large: 24,
  }

  return (
    <div
      className={`flex items-center gap-2 p-1.5 rounded border ${colors.bgColor} ${colors.borderColor}`}
      title={`${level.toUpperCase()}: ${description}`}
    >
      {/* Temperature indicator icon */}
      <div className={`flex items-center justify-center ${sizeClass[size]}`}>
        {level === 'hot' && <Flame size={iconSize[size]} className={`${colors.textColor} fill-current`} />}
        {level === 'warm' && <Flame size={iconSize[size]} className={`${colors.textColor} fill-current opacity-60`} />}
        {level === 'cold' && <Calendar size={iconSize[size]} className={colors.textColor} />}
        {level === 'dead' && <div className={`w-2 h-2 rounded-full ${colors.textColor} bg-current`} />}
      </div>

      {/* Label (optional) */}
      {showLabel && (
        <div className="flex flex-col">
          <span className={`text-xs font-semibold ${colors.textColor} uppercase tracking-wider`}>{level}</span>
          <span className={`text-xs ${colors.textColor} opacity-75`}>Next: {daysUntilNextFollowUp}d</span>
        </div>
      )}
    </div>
  )
}

export default LeadTemperature
