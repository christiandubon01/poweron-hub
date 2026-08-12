// @ts-nocheck
/**
 * BillingView.tsx
 * INT-1 — Stripe Billing & Subscription management panel.
 *
 * Wraps BillingPanel as a standalone view.
 * Accessible from Settings or sidebar.
 */

import React, { useEffect, useState } from 'react'
import { BillingPanel } from '@/components/stripe/BillingPanel'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { getPilotOrganizationClassification } from '@/services/pilotTelemetryShared'

export default function BillingView() {
  const { profile } = useAuth()
  const [billingBlocked, setBillingBlocked] = useState(false)
  const [checkedClassification, setCheckedClassification] = useState(false)

  useEffect(() => {
    let mounted = true

    async function loadClassification() {
      const orgId = String(profile?.org_id || '').trim()
      if (!orgId) {
        if (mounted) setCheckedClassification(true)
        return
      }

      const { data } = await supabase
        .from('organizations')
        .select('settings')
        .eq('id', orgId)
        .maybeSingle()

      const classification = getPilotOrganizationClassification(data?.settings)
      if (mounted) {
        setBillingBlocked(classification === 'design_partner' || classification === 'customer_zero')
        setCheckedClassification(true)
      }
    }

    void loadClassification()
    return () => {
      mounted = false
    }
  }, [profile?.org_id])

  if (checkedClassification && billingBlocked) {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6 text-amber-50">
        <h1 className="text-lg font-semibold">Billing is manually managed during the pilot</h1>
        <p className="mt-2 text-sm text-amber-100/90">
          Design-partner access stays on the founder-managed beta path for now. Subscription checkout and payment changes are disabled for pilot organizations.
        </p>
      </div>
    )
  }

  return <BillingPanel />
}
