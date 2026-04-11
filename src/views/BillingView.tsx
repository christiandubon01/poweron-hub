// @ts-nocheck
/**
 * BillingView.tsx
 * INT-1 — Stripe Billing & Subscription management panel.
 *
 * Wraps BillingPanel as a standalone view.
 * Accessible from Settings or sidebar.
 */

import React from 'react'
import { BillingPanel } from '@/components/stripe/BillingPanel'

export default function BillingView() {
  return <BillingPanel />
}
