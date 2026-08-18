import React from 'react'

/**
 * COACH tab — sales coaching / call review surface.
 * PERF-1: Source Performance moved to the Performance tab.
 * COACH-LINK phases will fill live assistance + post-call review here.
 */
export const CoachTab: React.FC = () => {
  return (
    <div className="p-6 text-gray-300">
      <h3 className="text-lg font-semibold text-white mb-2">Coach</h3>
      <p className="text-sm text-gray-400">
        Sales coaching and call review
      </p>
    </div>
  )
}

export default CoachTab
