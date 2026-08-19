import React from 'react'
import { PracticeTab as PracticeTabImpl } from '@/components/salesIntel/practice/PracticeTab'
import { SalesSessionContextBar } from '@/components/salesIntel/SalesSessionContextBar'

/**
 * COACH-LINK-3C — Practice shell keeps SalesSessionContextBar outside the
 * interaction scroll region so SI session nav stays reachable.
 */
export const PracticeTab: React.FC = () => {
  return (
    <div
      data-testid="practice-tab-shell"
      className="flex flex-col gap-3 min-h-0 w-full"
    >
      <div className="shrink-0">
        <SalesSessionContextBar />
      </div>
      <div className="min-h-0 flex-1 w-full">
        <PracticeTabImpl />
      </div>
    </div>
  )
}
