// @ts-nocheck
/**
 * EmployeePortal — Minimal shell for time-tracking employees.
 *
 * Separate from owner AppShell and CrewPortal. No sidebar, no admin panels.
 * Clock in/out UI deferred to TIME-3.
 */

import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, Clock, CalendarRange, ClipboardList, ListChecks, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import EmployeeTimeClock from '@/components/employee/EmployeeTimeClock'
import EmployeeMyTimePanel from '@/components/employee/EmployeeMyTimePanel'
import EmployeePortalBrandHeader from '@/components/employee/EmployeePortalBrandHeader'

interface EmployeeProfileSummary {
  display_name: string
  role: string
  org_name: string | null
}

type EmployeePortalSection = 'clock' | 'my-time' | 'assignments' | 'schedule'

const SECTIONS: { key: EmployeePortalSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'clock',       label: 'Clock',       icon: Clock },
  { key: 'my-time',     label: 'My Time',     icon: ListChecks },
  { key: 'assignments', label: 'Assignments', icon: ClipboardList },
  { key: 'schedule',    label: 'Schedule',    icon: CalendarRange },
]

// Read-only placeholder for sections whose data model isn't ready yet (TIME-5).
function ComingSoonCard({ title, message }: { title: string; message: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm text-center">
      <p className="text-base font-bold text-gray-900">{title}</p>
      <p className="text-sm text-gray-500 mt-2 leading-relaxed">{message}</p>
      <span className="inline-block mt-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
        Coming soon
      </span>
    </div>
  )
}

export function EmployeePortal() {
  const { user, signOut, employeeProfileId, employerOrgId } = useAuth()
  const navigate = useNavigate()
  const [profileSummary, setProfileSummary] = useState<EmployeeProfileSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeSection, setActiveSection] = useState<EmployeePortalSection>('clock')

  // Employee logout returns to the dedicated employee login page — not the
  // contractor/admin LoginFlow landing page. signOut() clears auth but does not
  // navigate, so without this the app would fall back to the owner landing at '/'.
  const handleSignOut = async () => {
    await signOut()
    navigate('/employee/login', { replace: true })
  }

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
        <EmployeePortalBrandHeader />
        <button
          type="button"
          onClick={handleSignOut}
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

        {/* Section switcher */}
        <nav className="grid grid-cols-4 gap-2">
          {SECTIONS.map(({ key, label, icon: Icon }) => {
            const active = activeSection === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveSection(key)}
                aria-pressed={active}
                className={`flex flex-col items-center gap-1 rounded-2xl px-2 py-3 border transition ${
                  active
                    ? 'bg-green-600 border-green-600 text-white shadow-sm'
                    : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[11px] font-semibold leading-tight">{label}</span>
              </button>
            )
          })}
        </nav>

        {/* Active section */}
        {activeSection === 'clock' && <EmployeeTimeClock />}
        {activeSection === 'my-time' && <EmployeeMyTimePanel />}
        {activeSection === 'assignments' && (
          <ComingSoonCard
            title="Assignments"
            message="Assignments are coming soon. Project/task assignment needs a dedicated employee assignment model."
          />
        )}
        {activeSection === 'schedule' && (
          <ComingSoonCard
            title="Schedule"
            message="Schedule is coming soon. Current schedule tables are not safely mapped to employee portal profiles yet."
          />
        )}
      </main>
    </div>
  )
}

export default EmployeePortal
