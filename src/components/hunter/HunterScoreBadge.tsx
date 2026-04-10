// @ts-nocheck
/**
 * HunterScoreBadge — Circular lead score display component
 * 
 * Displays a circular score badge with:
 * - Score number in center
 * - Tier label below
 * - Color ring based on tier (gold/green/blue/amber)
 * - Hover tooltip showing top 3 scoring factors
 */

import React, { useState } from 'react'
import clsx from 'clsx'

export interface ScoreFactor {
  label: string
  value: number
}

export interface HunterScoreBadgeProps {
  score: number
  factors?: ScoreFactor[]
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

// Score tier configuration
const SCORE_TIERS = {
  gold: { min: 90, max: 100, label: 'Hot', color: '#fbbf24', darkColor: '#78350f' },
  green: { min: 75, max: 89, label: 'Warm', color: '#4ade80', darkColor: '#166534' },
  blue: { min: 60, max: 74, label: 'Cool', color: '#60a5fa', darkColor: '#1e40af' },
  amber: { min: 40, max: 59, label: 'Warm', color: '#f97316', darkColor: '#7c2d12' },
}

function getTierForScore(score: number): keyof typeof SCORE_TIERS {
  if (score >= SCORE_TIERS.gold.min) return 'gold'
  if (score >= SCORE_TIERS.green.min) return 'green'
  if (score >= SCORE_TIERS.blue.min) return 'blue'
  return 'amber'
}

function getScoreTierLabel(score: number): string {
  const tier = getTierForScore(score)
  return SCORE_TIERS[tier].label
}

const SIZE_CONFIG = {
  sm: { container: 'w-12 h-12', text: 'text-xs', number: 'text-lg', stroke: 4 },
  md: { container: 'w-16 h-16', text: 'text-sm', number: 'text-2xl', stroke: 5 },
  lg: { container: 'w-20 h-20', text: 'text-base', number: 'text-3xl', stroke: 6 },
}

export function HunterScoreBadge({
  score,
  factors = [],
  className,
  size = 'md',
}: HunterScoreBadgeProps) {
  const [showTooltip, setShowTooltip] = useState(false)
  const tier = getTierForScore(score)
  const tierConfig = SCORE_TIERS[tier]
  const tierLabel = getScoreTierLabel(score)
  const sizeConfig = SIZE_CONFIG[size]
  
  // Get top 3 factors for tooltip
  const topFactors = factors.slice(0, 3)
  const tooltipContent = topFactors.length > 0 
    ? topFactors.map(f => `${f.label}: +${f.value}`).join('\n')
    : 'No factors available'

  const containerSize = {
    sm: 48,
    md: 64,
    lg: 80,
  }[size]

  const radius = containerSize / 2 - sizeConfig.stroke / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference

  return (
    <div
      className={clsx(
        'relative inline-flex items-center justify-center',
        sizeConfig.container,
        className
      )}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* SVG circular score ring */}
      <svg
        width={containerSize}
        height={containerSize}
        className="absolute inset-0 transform -rotate-90"
        viewBox={`0 0 ${containerSize} ${containerSize}`}
      >
        {/* Background circle */}
        <circle
          cx={containerSize / 2}
          cy={containerSize / 2}
          r={radius}
          fill="none"
          stroke="#1f2937"
          strokeWidth={sizeConfig.stroke}
        />
        
        {/* Progress ring */}
        <circle
          cx={containerSize / 2}
          cy={containerSize / 2}
          r={radius}
          fill="none"
          stroke={tierConfig.color}
          strokeWidth={sizeConfig.stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.3s ease' }}
        />
      </svg>

      {/* Score content */}
      <div className="relative flex flex-col items-center justify-center z-10">
        <div className={clsx(sizeConfig.number, 'font-bold text-white')}>
          {Math.round(score)}
        </div>
        <div
          className={clsx(sizeConfig.text, 'font-medium text-gray-400')}
          style={{ color: tierConfig.color }}
        >
          {tierLabel}
        </div>
      </div>

      {/* Tooltip */}
      {showTooltip && topFactors.length > 0 && (
        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 whitespace-nowrap z-50 pointer-events-none">
          <div className="text-gray-300 font-medium mb-0.5">Top factors:</div>
          {topFactors.map((factor, i) => (
            <div key={i} className="text-gray-400">
              {factor.label}: +{factor.value}
            </div>
          ))}
          {/* Tooltip arrow */}
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
        </div>
      )}
    </div>
  )
}

export default HunterScoreBadge
