/**
 * EmployeeInviteModal.tsx — Admin "Invite Employee" modal (TIME-2D)
 *
 * Sends a time-tracking portal invite via employeeInviteService.
 * Separate from the Beta Invite (DemoInvite) flow — blue/teal accent so the
 * two are visually distinct. UI only sends the invite; it never writes to
 * employee_profiles directly.
 *
 * Fields: display name, email, role (employee | foreman),
 *         employment type (full_time | part_time | subcontractor | helper).
 */

import React, { useState, useEffect, useRef } from 'react'
import { X, Send, CheckCircle, AlertCircle, UserPlus } from 'lucide-react'
import {
  sendEmployeeInvite,
  type EmployeeInviteRole,
  type EmployeeEmploymentType,
} from '@/services/employeeInviteService'
import { getOwnerOrgId } from '@/services/crewPortalService'
import { getOrgMembers } from '@/services/roleService'

interface EmployeeInviteModalProps {
  /** Called when the modal should close */
  onClose: () => void
  /** Pre-fill the display name field (e.g. from a Cost Model entry) */
  initialName?: string
  /**
   * If set, UPDATE this existing employee_profiles row instead of inserting a new one.
   * Used when inviting a "prepared" employee who already has a profile but no invite token.
   * The name field is locked to the profile's display name when this is provided.
   */
  profileId?: string
  /**
   * Cost Model employee id. When inviting a Cost-Model-only employee (no portal
   * profile yet), pass this so the server reuses/links the profile via
   * backup_employee_id instead of creating a duplicate portal account (ROLE-2.4).
   */
  backupEmployeeId?: string
}

type ModalState = 'idle' | 'loading' | 'success' | 'error'

// Basic email shape check — trimmed/lowercased before submit.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const ROLE_OPTIONS: { value: EmployeeInviteRole; label: string }[] = [
  { value: 'employee', label: 'Employee' },
  { value: 'foreman', label: 'Foreman' },
]

const EMPLOYMENT_OPTIONS: { value: EmployeeEmploymentType; label: string }[] = [
  { value: 'full_time', label: 'Full time' },
  { value: 'part_time', label: 'Part time' },
  { value: 'subcontractor', label: 'Subcontractor' },
  { value: 'helper', label: 'Helper' },
]

export default function EmployeeInviteModal({ onClose, initialName, profileId, backupEmployeeId }: EmployeeInviteModalProps) {
  const [displayName, setDisplayName]       = useState(initialName ?? '')
  const [email, setEmail]                   = useState('')
  const [role, setRole]                     = useState<EmployeeInviteRole>('employee')
  const [employmentType, setEmploymentType] = useState<EmployeeEmploymentType>('full_time')
  const [state, setState]                   = useState<ModalState>('idle')
  const [errorMsg, setErrorMsg]             = useState('')
  const [sentEmail, setSentEmail]           = useState('')
  const [emailDupError, setEmailDupError]   = useState('')

  // Existing org emails loaded on mount for client-side duplicate check.
  const existingEmails = useRef<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const orgRes = await getOwnerOrgId()
      if (cancelled || !orgRes.success) return
      const membersRes = await getOrgMembers(orgRes.data)
      if (cancelled || !membersRes.success) return
      const set = new Set<string>()
      for (const m of membersRes.data ?? []) {
        if (m.email) set.add(m.email.trim().toLowerCase())
      }
      existingEmails.current = set
    })()
    return () => { cancelled = true }
  }, [])

  function checkEmailDuplicate(raw: string) {
    const clean = raw.trim().toLowerCase()
    if (clean && existingEmails.current.has(clean)) {
      setEmailDupError(
        'An employee with this email already exists. View their profile in the Crew Directory.',
      )
    } else {
      setEmailDupError('')
    }
  }

  // ── Validation ─────────────────────────────────────────────────────────────
  const nameValid  = displayName.trim().length > 0
  const emailValid = EMAIL_RE.test(email.trim().toLowerCase())
  const formValid  = nameValid && emailValid && !emailDupError
  const isLoading  = state === 'loading'

  // ── Submit handler ─────────────────────────────────────────────────────────
  const handleSend = async () => {
    // Re-check duplicate synchronously on submit (guard against paste without blur)
    const cleanEmail = email.trim().toLowerCase()
    if (existingEmails.current.has(cleanEmail)) {
      setEmailDupError(
        'An employee with this email already exists. View their profile in the Crew Directory.',
      )
      return
    }
    if (!formValid || isLoading) return

    setState('loading')
    setErrorMsg('')

    const result = await sendEmployeeInvite({
      displayName:    displayName.trim(),
      email:          cleanEmail,
      role,
      employmentType,
      ...(profileId ? { profileId } : {}),
      ...(backupEmployeeId ? { backupEmployeeId } : {}),
    })

    if (result.success) {
      setSentEmail(result.email || cleanEmail)
      setState('success')
    } else {
      setErrorMsg(result.error || 'Could not send the invite. Please try again.')
      setState('error')
    }
  }

  // ── Reset for "Invite Another" ─────────────────────────────────────────────
  const handleReset = () => {
    setDisplayName('')
    setEmail('')
    setRole('employee')
    setEmploymentType('full_time')
    setState('idle')
    setErrorMsg('')
    setSentEmail('')
  }

  const inputCls =
    'w-full bg-[var(--bg-input,#11141c)] border border-gray-600 rounded-xl px-4 text-gray-100 placeholder-gray-600 focus:outline-none focus:border-teal-500 transition disabled:opacity-60'

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative w-full max-w-md bg-[var(--bg-card,#1e2433)] border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-700/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-teal-500/20 flex items-center justify-center">
              <UserPlus className="w-5 h-5 text-teal-400" />
            </div>
            <h2 className="text-xl font-bold text-gray-100">Invite Employee</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Body ────────────────────────────────────────────────────── */}
        <div className="px-6 py-5 space-y-5">

          {/* SUCCESS STATE */}
          {state === 'success' && (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <CheckCircle className="w-14 h-14 text-teal-400" />
              <p className="text-lg font-semibold text-gray-100">
                Employee invite sent to {sentEmail}.
              </p>
              <p className="text-sm text-gray-400">
                They'll use the employee portal for clock in/out after accepting.
              </p>
              <div className="flex gap-3 mt-2">
                <button
                  onClick={handleReset}
                  className="px-4 py-2 rounded-lg bg-gray-700 text-gray-200 text-sm hover:bg-gray-600 transition"
                >
                  Invite Another
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm hover:bg-teal-500 transition"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {/* FORM STATE (idle / loading / error) */}
          {state !== 'success' && (
            <>
              {/* Subtitle */}
              <p className="text-sm text-gray-400 -mt-1">
                Send a time-tracking portal invite. They'll receive an email to
                create an account and accept.
              </p>

              {/* Display name */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Display name <span className="text-red-400">*</span>
                  {profileId && (
                    <span className="ml-2 text-xs text-teal-500 font-normal">Sending to existing profile</span>
                  )}
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={e => { if (!profileId) setDisplayName(e.target.value) }}
                  disabled={isLoading || !!profileId}
                  readOnly={!!profileId}
                  placeholder="Alex Rivera"
                  className={inputCls}
                  style={{ minHeight: '44px', fontSize: '16px', opacity: profileId ? 0.7 : undefined }}
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Email address <span className="text-red-400">*</span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => {
                    setEmail(e.target.value)
                    if (emailDupError) setEmailDupError('')
                  }}
                  onBlur={e => checkEmailDuplicate(e.target.value)}
                  disabled={isLoading}
                  placeholder="employee@example.com"
                  inputMode="email"
                  autoComplete="email"
                  className={inputCls}
                  style={{
                    minHeight: '44px',
                    fontSize: '16px',
                    borderColor: emailDupError ? '#ef4444' : undefined,
                  }}
                />
                {emailDupError && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-xs text-red-400">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    {emailDupError}
                  </p>
                )}
              </div>

              {/* Role */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Role
                </label>
                <select
                  value={role}
                  onChange={e => setRole(e.target.value as EmployeeInviteRole)}
                  disabled={isLoading}
                  className={inputCls}
                  style={{ minHeight: '44px', fontSize: '16px' }}
                >
                  {ROLE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {/* Employment type */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Employment type
                </label>
                <select
                  value={employmentType}
                  onChange={e => setEmploymentType(e.target.value as EmployeeEmploymentType)}
                  disabled={isLoading}
                  className={inputCls}
                  style={{ minHeight: '44px', fontSize: '16px' }}
                >
                  {EMPLOYMENT_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {/* Error message */}
              {state === 'error' && errorMsg && (
                <div className="flex items-start gap-2 bg-red-900/20 border border-red-700/50 rounded-xl px-4 py-3">
                  <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-red-300">{errorMsg}</p>
                </div>
              )}

              {/* Send button */}
              <button
                onClick={handleSend}
                disabled={!formValid || isLoading}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-teal-600 hover:bg-teal-500 active:bg-teal-700 text-white font-bold text-base transition disabled:opacity-60 disabled:cursor-not-allowed"
                style={{ minHeight: '52px' }}
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin w-4 h-4 text-white" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Sending…
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Send Employee Invite
                  </>
                )}
              </button>

              {/* Helper text */}
              <p className="text-xs text-gray-600 text-center -mt-2">
                They'll use the employee portal for clock in/out after accepting.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
