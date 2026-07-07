// @ts-nocheck
/**
 * EmployeePortal — Minimal shell for time-tracking employees.
 *
 * Separate from owner AppShell and CrewPortal. No sidebar, no admin panels.
 * Clock in/out UI deferred to TIME-3.
 */

import React, { useEffect, useState } from 'react'
import { Zap, LogOut, Clock, LayoutDashboard, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

interface EmployeeProfileSummary {
  display_name: string
  role: string
  org_name: string | null
}

export function EmployeePortal() {
  const { user, signOut, employeeProfileId, employerOrgId } = useAuth()
  const [profileSummary, setProfileSummary] = useState<EmployeeProfileSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    async function loadProfile() {
      if (!user?.id) {
        if (mounted) setLoading(false)
        return
      }

      try {
        let query = supabase
          .from('employee_profiles')
          .select('display_name, role, org_id')
          .eq('user_id', user.id)
          .eq('active', true)
          .limit(1)

        if (employeeProfileId) {
          query = supabase
            .from('employee_profiles')
            .select('display_name, role, org_id')
            .eq('id', employeeProfileId)
            .limit(1)
        }

        const { data, error } = await query.maybeSingle()
        if (error || !data) {
          if (mounted) setLoading(false)
          return
        }

        let orgName: string | null = null
        const orgId = employerOrgId || data.org_id
        if (orgId) {
          const { data: orgData } = await supabase
            .from('organizations')
            .select('name')
            .eq('id', orgId)
            .maybeSingle()
          orgName = orgData?.name ?? null
        }

        if (mounted) {
          setProfileSummary({
            display_name: data.display_name,
            role: data.role,
            org_name: orgName,
          })
        }
      } catch {
        // Non-blocking — shell still renders with email fallback
      } finally {
        if (mounted) setLoading(false)
      }
    }

    loadProfile()
    return () => {
      mounted = false
    }
  }, [user?.id, employeeProfileId, employerOrgId])

  const displayName = profileSummary?.display_name || user?.email || 'Employee'

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-green-100 border border-green-200 flex items-center justify-center flex-shrink-0">
            <Zap className="w-4 h-4 text-green-600" fill="currentColor" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-900 leading-tight truncate">Power On Solutions</p>
            <p className="text-[10px] text-gray-400 uppercase tracking-wider font-mono">Employee Portal</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => signOut()}
          className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800 px-2 py-1.5 rounded-lg"
        >
          <LogOut size={14} />
          Sign out
        </button>
      </header>

      <main className="flex-1 px-4 py-6 max-w-lg mx-auto w-full space-y-5">
        {/* Signed-in status */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 size={16} className="animate-spin text-green-600" />
              Loading your profile…
            </div>
          ) : (
            <>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Signed in as</p>
              <p className="text-lg font-bold text-gray-900 mt-1">{displayName}</p>
              {profileSummary?.org_name && (
                <p className="text-sm text-gray-600 mt-0.5">{profileSummary.org_name}</p>
              )}
              {profileSummary?.role && (
                <p className="text-xs text-green-700 font-medium mt-2 capitalize">{profileSummary.role}</p>
              )}
            </>
          )}
        </div>

        {/* Nav placeholder */}
        <nav className="grid grid-cols-2 gap-3">
          <div className="bg-green-600 text-white rounded-2xl p-4 shadow-sm">
            <Clock className="w-5 h-5 mb-2 opacity-90" />
            <p className="text-sm font-bold">Time Tracking</p>
            <p className="text-xs opacity-80 mt-0.5">Coming next</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl p-4 text-gray-400">
            <LayoutDashboard className="w-5 h-5 mb-2" />
            <p className="text-sm font-semibold text-gray-500">Dashboard</p>
            <p className="text-xs mt-0.5">Coming soon</p>
          </div>
        </nav>

        {/* Placeholder card */}
        <div className="bg-white border border-green-200 rounded-2xl p-5 shadow-sm">
          <h2 className="text-base font-bold text-gray-900 mb-2">Time Tracking setup is ready</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            Your employee invite is linked. Clock in/out interface comes next.
          </p>
        </div>
      </main>
    </div>
  )
}

export default EmployeePortal
