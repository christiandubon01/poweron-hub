import React from 'react'
import { SourcePerformancePanel } from '@/features/sales-intelligence/source-performance'

/**
 * COACH tab — Sales Intelligence analytics home.
 * LEAD-SRC-6: Source Performance is the owner-facing acquisition payoff.
 */
export const CoachTab: React.FC = () => {
  return (
    <div className="p-4 space-y-4">
      <SourcePerformancePanel />
    </div>
  )
}

export default CoachTab
