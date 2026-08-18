import React from 'react'
import { SourcePerformancePanel } from '@/features/sales-intelligence/source-performance'

/**
 * PERF-1 — PERFORMANCE tab host for Source Performance.
 * Renders the existing LEAD-SRC-6 panel; does not fork calculations.
 */
export const PerformanceTab: React.FC = () => {
  return (
    <div className="p-4 space-y-4">
      <SourcePerformancePanel />
    </div>
  )
}

export default PerformanceTab
