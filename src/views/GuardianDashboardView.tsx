// @ts-nocheck
/**
 * GuardianDashboardView.tsx
 * INT-1 — GUARDIAN Compliance Command Center view wrapper.
 *
 * Wraps GuardianDashboard (GRD1-6) as a standalone view.
 * Displays KPI cards, open alerts, activity feed, CSLB protection status.
 */

import React from 'react'
import GuardianDashboard from '@/components/guardian/GuardianDashboard'

export default function GuardianDashboardView() {
  return <GuardianDashboard />
}
