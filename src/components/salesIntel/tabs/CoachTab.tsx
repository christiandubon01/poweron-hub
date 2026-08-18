import React from 'react'
import { SalesSessionContextBar } from '@/components/salesIntel/SalesSessionContextBar'
import { useSalesIntelStore } from '@/components/salesIntel/SalesIntelStore'

/**
 * COACH tab — sales coaching / call review surface.
 * PERF-1: Source Performance moved to the Performance tab.
 * COACH-LINK-2: shared sales-session context only — no AI coaching yet.
 */
export const CoachTab: React.FC = () => {
  const salesSession = useSalesIntelStore((s) => s.salesSession)

  return (
    <div className="p-4 space-y-4 text-gray-300">
      <SalesSessionContextBar />
      {!salesSession ? (
        <div
          data-testid="coach-no-session"
          className="rounded-lg border border-dashed border-white/15 bg-slate-900/50 px-4 py-8 text-center"
        >
          <h3 className="text-lg font-semibold text-white mb-2">Coach</h3>
          <p className="text-sm text-gray-400 max-w-md mx-auto">
            No active sales session. Start from a lead, Practice, or Live Call to
            bring context into Coach.
          </p>
        </div>
      ) : (
        <div data-testid="coach-with-session">
          <h3 className="text-lg font-semibold text-white mb-2">Coach</h3>
          <p className="text-sm text-gray-400">
            Sales coaching and call review
          </p>
        </div>
      )}
    </div>
  )
}

export default CoachTab
