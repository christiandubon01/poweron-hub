import React from 'react'
import { PracticeTab as PracticeTabImpl } from '@/components/salesIntel/practice/PracticeTab'
import { SalesSessionContextBar } from '@/components/salesIntel/SalesSessionContextBar'

export const PracticeTab: React.FC = () => {
  return (
    <div className="space-y-4">
      <SalesSessionContextBar />
      <PracticeTabImpl />
    </div>
  )
}
