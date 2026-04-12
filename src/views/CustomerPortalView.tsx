// @ts-nocheck
/**
 * CustomerPortalView.tsx
 * INT-1 — Customer-facing portal view.
 *
 * Wraps CustomerPortal for /portal route.
 * Owner view shows PortalLeadInbox (command center).
 */

import React from 'react'
import { CustomerPortal } from '@/components/portal/CustomerPortal'

export default function CustomerPortalView() {
  return <CustomerPortal />
}
