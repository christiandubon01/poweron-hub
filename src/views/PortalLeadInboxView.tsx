// @ts-nocheck
/**
 * PortalLeadInboxView.tsx
 * INT-1 — Portal Lead Inbox (owner-side view of customer portal submissions).
 *
 * Shows all portal_leads: name, service, city, urgency, status.
 * Allows status flow, convert-to-project, and SPARK pipeline integration.
 */

import React from 'react'
import { PortalLeadInbox } from '@/components/portal/PortalLeadInbox'

export default function PortalLeadInboxView() {
  return <PortalLeadInbox />
}
