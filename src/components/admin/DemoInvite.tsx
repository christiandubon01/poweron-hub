// @ts-nocheck
/**
 * DemoInvite.tsx — Beta Demo User Invite Modal
 *
 * Triggered from Team panel or Settings > Beta Access.
 * Visible only to owner role.
 *
 * Flow:
 * 1. Collect email, optional first name, optional company
 * 2. Select access duration (14 / 30 / 60 days)
 * 3. Toggle auto-populate sample projects (default ON)
 * 4. On submit: upsert Supabase auth user, set demo_tier profile columns,
 *    optionally call populateDemoData(), send magic link
 */

import React, { useState } from 'react'
import { X, Send, CheckCircle, AlertCircle, UserPlus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { populateDemoData } from '@/services/demoDataService'

// ── Types ──────────────────────────────────────────────────────────────────
type DurationOption = 14 | 30 | 60

interface DemoInviteProps {
  /** Called when the modal should close */
  onClose: () => void
  /** Current authenticated user ID (the inviter) */
  inviterUserId: string
}

type ModalState = 'idle' | 'loading' | 'success' | 'error'

// ── Component ──────────────────────────────────────────────────────────────
export default function DemoInvite({ onClose, inviterUserId }: DemoInviteProps) {
  const [email, setEmail]                 = useState('')
  const [firstName, setFirstName]         = useState('')
  const [company, setCompany]             = useState('')
  const [duration, setDuration]           = useState<DurationOption>(30)
  const [autoPopulate, setAutoPopulate]   = useState(true)
  const [state, setState]                 = useState<ModalState>('idle')
  const [errorMsg, setErrorMsg]           = useState('')

  // ── Compute expiry timestamp from selected duration ──────────────────────
  const computeExpiresAt = (days: DurationOption): string => {
    const d = new Date()
    d.setDate(d.getDate() + days)
    return d.toISOString()
  }

  // ── Submit handler ───────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!email.trim()) {
      setErrorMsg('Email is required.')
      setState('error')
      return
    }

    setState('loading')
    setErrorMsg('')

    try {
      // 1. Invite the user via Supabase Auth magic link (admin invite)
      //    This creates the auth user if not exists and sends the magic link.
      const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
        email.trim(),
        {
          data: {
            full_name:    firstName.trim() || null,
            company_name: company.trim()   || null,
            demo_tier:    true,
          },
          redirectTo: window.location.origin,
        }
      )

      if (inviteError) {
        // If user already exists, try sending a magic link instead
        if (inviteError.message?.includes('already been registered')) {
          const { error: magicLinkError } = await supabase.auth.signInWithOtp({
            email: email.trim(),
            options: {
              shouldCreateUser: false,
              emailRedirectTo: window.location.origin,
            },
          })
          if (magicLinkError) throw magicLinkError
          // User already exists — we still update the profile below
        } else {
          throw inviteError
        }
      }

      // 2. Resolve the user ID from the invite response or look it up
      let userId: string | null = inviteData?.user?.id ?? null

      if (!userId) {
        // User already existed — look up by email via admin API
        const { data: listData } = await supabase.auth.admin.listUsers()
        const match = listData?.users?.find(u => u.email === email.trim())
        userId = match?.id ?? null
      }

      if (!userId) {
        throw new Error('Could not resolve user ID for ' + email.trim())
      }

      // 3. Upsert the profiles row with demo tier fields
      const now          = new Date().toISOString()
      const expiresAt    = computeExpiresAt(duration)

      const { error: profileError } = await supabase
        .from('profiles')
        .upsert(
          {
            id:                   userId,
            org_id:               inviterUserId,   // use inviter's org or a demo org id
            full_name:            firstName.trim() || email.trim().split('@')[0],
            role:                 'viewer',
            is_active:            true,
            demo_tier:            true,
            demo_expires_at:      expiresAt,
            demo_projects_limit:  3,
            demo_invited_by:      inviterUserId,
            demo_invited_at:      now,
          },
          { onConflict: 'id' }
        )

      if (profileError) throw profileError

      // 4. Auto-populate sample projects if toggle is ON
      if (autoPopulate) {
        await populateDemoData(userId)
      }

      setState('success')
    } catch (err: any) {
      console.error('[DemoInvite] Error sending invite:', err)
      setErrorMsg(err?.message || 'Something went wrong. Please try again.')
      setState('error')
    }
  }

  // ── Reset and retry ──────────────────────────────────────────────────────
  const handleReset = () => {
    setEmail('')
    setFirstName('')
    setCompany('')
    setDuration(30)
    setAutoPopulate(true)
    setState('idle')
    setErrorMsg('')
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative w-full max-w-md bg-[var(--bg-card,#1e2433)] border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-700/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-green-500/20 flex items-center justify-center">
              <UserPlus className="w-5 h-5 text-green-400" />
            </div>
            <h2 className="text-xl font-bold text-gray-100">Invite Beta User</h2>
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
              <CheckCircle className="w-14 h-14 text-green-400" />
              <p className="text-lg font-semibold text-gray-100">
                Invite sent to {email}.
              </p>
              <p className="text-sm text-gray-400">They're all set.</p>
              <div className="flex gap-3 mt-2">
                <button
                  onClick={handleReset}
                  className="px-4 py-2 rounded-lg bg-gray-700 text-gray-200 text-sm hover:bg-gray-600 transition"
                >
                  Invite Another
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm hover:bg-green-500 transition"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {/* FORM STATE (idle / loading / error) */}
          {state !== 'success' && (
            <>
              {/* Email */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Email address <span className="text-red-400">*</span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="demo@example.com"
                  inputMode="email"
                  autoComplete="email"
                  className="w-full bg-[var(--bg-input,#11141c)] border border-gray-600 rounded-xl px-4 text-gray-100 placeholder-gray-600 focus:outline-none focus:border-green-500 transition"
                  style={{ minHeight: '44px', fontSize: '16px' }}
                />
              </div>

              {/* First Name */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  First name <span className="text-gray-600">(optional)</span>
                </label>
                <input
                  type="text"
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  placeholder="Alex"
                  className="w-full bg-[var(--bg-input,#11141c)] border border-gray-600 rounded-xl px-4 text-gray-100 placeholder-gray-600 focus:outline-none focus:border-green-500 transition"
                  style={{ minHeight: '44px', fontSize: '16px' }}
                />
              </div>

              {/* Company */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Company name <span className="text-gray-600">(optional)</span>
                </label>
                <input
                  type="text"
                  value={company}
                  onChange={e => setCompany(e.target.value)}
                  placeholder="ABC Electrical"
                  className="w-full bg-[var(--bg-input,#11141c)] border border-gray-600 rounded-xl px-4 text-gray-100 placeholder-gray-600 focus:outline-none focus:border-green-500 transition"
                  style={{ minHeight: '44px', fontSize: '16px' }}
                />
              </div>

              {/* Access Duration */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  Access duration
                </label>
                <div className="flex gap-2">
                  {([14, 30, 60] as DurationOption[]).map(d => (
                    <button
                      key={d}
                      onClick={() => setDuration(d)}
                      className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition ${
                        duration === d
                          ? 'bg-green-600 border-green-500 text-white'
                          : 'bg-[var(--bg-input,#11141c)] border-gray-600 text-gray-400 hover:border-green-600 hover:text-gray-200'
                      }`}
                      style={{ minHeight: '44px' }}
                    >
                      {d} days
                    </button>
                  ))}
                </div>
              </div>

              {/* Auto-populate toggle */}
              <div className="flex items-center justify-between bg-[var(--bg-input,#11141c)] border border-gray-700 rounded-xl px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-200">Auto-populate with sample projects</p>
                  <p className="text-xs text-gray-500 mt-0.5">3 projects + 5 service calls added instantly</p>
                </div>
                <button
                  onClick={() => setAutoPopulate(v => !v)}
                  aria-pressed={autoPopulate}
                  className={`relative inline-flex w-11 h-6 rounded-full transition-colors focus:outline-none ${
                    autoPopulate ? 'bg-green-500' : 'bg-gray-600'
                  }`}
                  style={{ minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center' }}
                >
                  <span
                    className={`inline-block w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
                      autoPopulate ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
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
                disabled={state === 'loading'}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-green-600 hover:bg-green-500 active:bg-green-700 text-white font-bold text-base transition disabled:opacity-60 disabled:cursor-not-allowed"
                style={{ minHeight: '52px' }}
              >
                {state === 'loading' ? (
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
                    Send Invite
                  </>
                )}
              </button>

              {/* Helper text */}
              <p className="text-xs text-gray-600 text-center -mt-2">
                They'll receive a magic link and be set up automatically
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
