/**
 * useDemoLimits.ts — Demo User Limit & Status Hook
 *
 * Session B7: Demo User Invite Flow
 *
 * Reads the current user's demo_tier profile columns from Supabase and
 * returns derived state for enforcing project limits and access expiry.
 *
 * Returns:
 *   isDemoUser:        boolean — true if user has demo_tier = true
 *   projectsUsed:      number  — how many projects the demo user has created
 *   projectsLimit:     number  — max projects allowed (from profile column)
 *   projectsRemaining: number  — projectsLimit - projectsUsed (min 0)
 *   daysRemaining:     number  — calendar days until demo_expires_at
 *   isExpired:         boolean — true if demo_expires_at is in the past
 *   isLoading:         boolean — true while fetching profile data
 *
 * Usage:
 *   const { isDemoUser, projectsRemaining, isExpired, daysRemaining } = useDemoLimits()
 */

import { useState, useEffect } from 'react'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/lib/supabase'

// ── Types ──────────────────────────────────────────────────────────────────

export interface DemoLimits {
  isDemoUser:        boolean
  projectsUsed:      number
  projectsLimit:     number
  projectsRemaining: number
  daysRemaining:     number
  isExpired:         boolean
  isLoading:         boolean
}

// ── Constants ──────────────────────────────────────────────────────────────

/** 3 auto-populated + 3 user-created = 6 total project slots for demo users */
const AUTO_POPULATE_COUNT = 3
const MAX_CUSTOM_PROJECTS  = 3
const DEFAULT_DEMO_LIMIT   = AUTO_POPULATE_COUNT + MAX_CUSTOM_PROJECTS  // 6

// ── Hook ───────────────────────────────────────────────────────────────────

export function useDemoLimits(): DemoLimits {
  const user    = useAuthStore(s => s.user)
  const profile = useAuthStore(s => s.profile)

  const [projectsUsed, setProjectsUsed] = useState(0)
  const [isLoading,    setIsLoading]    = useState(false)

  // ── Derive demo fields from profile ─────────────────────────────────────
  // The profile object comes from authStore which reads the `profiles` table.
  // demo_tier, demo_expires_at, demo_projects_limit are added in migration 031.

  const isDemoUser   = Boolean((profile as any)?.demo_tier)
  const expiresAt    = (profile as any)?.demo_expires_at as string | null | undefined
  const projectsLimit: number =
    (profile as any)?.demo_projects_limit ?? DEFAULT_DEMO_LIMIT

  // ── Compute expiry ───────────────────────────────────────────────────────
  let daysRemaining = Infinity
  let isExpired     = false

  if (isDemoUser && expiresAt) {
    const expiryMs   = new Date(expiresAt).getTime()
    const nowMs      = Date.now()
    const diffMs     = expiryMs - nowMs
    daysRemaining    = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
    isExpired        = diffMs <= 0
  }

  // ── Fetch project count for this demo user ────────────────────────────────
  useEffect(() => {
    if (!isDemoUser || !user?.id) {
      setProjectsUsed(0)
      return
    }

    let cancelled = false
    setIsLoading(true)

    supabase
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', user.id)
      .then(({ count, error }) => {
        if (cancelled) return
        if (!error) {
          setProjectsUsed(count ?? 0)
        } else {
          console.warn('[useDemoLimits] Failed to fetch project count:', error.message)
        }
        setIsLoading(false)
      })

    return () => { cancelled = true }
  }, [isDemoUser, user?.id])

  // ── Derived ───────────────────────────────────────────────────────────────
  const projectsRemaining = Math.max(0, projectsLimit - projectsUsed)

  return {
    isDemoUser,
    projectsUsed,
    projectsLimit,
    projectsRemaining,
    daysRemaining: daysRemaining === Infinity ? 999 : daysRemaining,
    isExpired,
    isLoading,
  }
}
