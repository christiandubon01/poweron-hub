/**
 * employeeInviteService.ts — Employee time-tracking invite workflow (TIME-2A)
 *
 * Public API:
 *   sendEmployeeInvite(input)         — calls sendEmployeeInvite Netlify function
 *   validateEmployeeInviteToken(token) — RPC validate_employee_invite
 *   acceptEmployeeInvite(token)        — RPC accept_employee_invite
 */

import { supabase } from '@/lib/supabase'

// Migration 082 RPCs — cast until generated db types include these functions.
const rpc = supabase.rpc as any

// ── Types ─────────────────────────────────────────────────────────────────────

export type EmployeeInviteRole = 'employee' | 'foreman'

export type EmployeeEmploymentType =
  | 'full_time'
  | 'part_time'
  | 'subcontractor'
  | 'helper'

export interface SendEmployeeInviteInput {
  displayName: string
  email: string
  employmentType?: EmployeeEmploymentType
  role?: EmployeeInviteRole
}

export interface SendEmployeeInviteResult {
  success: boolean
  inviteId?: string
  email?: string
  error?: string
}

export type EmployeeInviteValidationReason =
  | 'missing_token'
  | 'not_found'
  | 'already_accepted'
  | 'inactive'

export interface EmployeeInviteValidationResult {
  valid: boolean
  reason?: EmployeeInviteValidationReason | string
  display_name?: string
  email?: string | null
  org_name?: string
  role?: EmployeeInviteRole
  employment_type?: EmployeeEmploymentType
}

export type EmployeeInviteAcceptReason =
  | 'not_authenticated'
  | 'not_found'
  | 'already_accepted'
  | 'inactive'
  | 'email_mismatch'

export interface EmployeeInviteAcceptResult {
  success: boolean
  reason?: EmployeeInviteAcceptReason | string
  employee_profile_id?: string
  org_id?: string
  role?: EmployeeInviteRole
  portal_access?: Record<string, unknown>
}

// ── sendEmployeeInvite ──────────────────────────────────────────────────────────

/**
 * Creates an employee_profiles invite and sends the invite email.
 * Requires an authenticated owner/admin session (Bearer token).
 */
export async function sendEmployeeInvite(
  input: SendEmployeeInviteInput,
): Promise<SendEmployeeInviteResult> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      return { success: false, error: 'Not authenticated' }
    }

    const res = await fetch('/.netlify/functions/sendEmployeeInvite', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        Authorization:   `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        displayName:    input.displayName,
        email:          input.email,
        employmentType: input.employmentType ?? 'full_time',
        role:           input.role ?? 'employee',
      }),
    })

    const data = await res.json()
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || `HTTP ${res.status}` }
    }

    return {
      success:  true,
      inviteId: data.inviteId,
      email:    data.email,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[employeeInviteService.sendEmployeeInvite] Error:', err)
    return { success: false, error: message }
  }
}

// ── validateEmployeeInviteToken ─────────────────────────────────────────────────

/**
 * Pre-auth validation for /employee/invite/:token.
 * Returns minimal public fields when valid.
 */
export async function validateEmployeeInviteToken(
  token: string,
): Promise<EmployeeInviteValidationResult> {
  const { data, error } = await rpc('validate_employee_invite', {
    p_token: token,
  })

  if (error) {
    console.error('[employeeInviteService.validateEmployeeInviteToken] Error:', error)
    return { valid: false, reason: 'not_found' }
  }

  return (data ?? { valid: false, reason: 'not_found' }) as EmployeeInviteValidationResult
}

// ── acceptEmployeeInvite ────────────────────────────────────────────────────────

/**
 * Claims a pending employee invite for the current authenticated user.
 */
export async function acceptEmployeeInvite(
  token: string,
): Promise<EmployeeInviteAcceptResult> {
  const { data, error } = await rpc('accept_employee_invite', {
    p_token: token,
  })

  if (error) {
    console.error('[employeeInviteService.acceptEmployeeInvite] Error:', error)
    return { success: false, reason: 'not_found' }
  }

  return (data ?? { success: false, reason: 'not_found' }) as EmployeeInviteAcceptResult
}

// ── resendEmployeeInvite ────────────────────────────────────────────────────────

export interface ResendEmployeeInviteResult {
  success: boolean
  email?: string
  error?: string
}

/**
 * Generates a new invite token for a pending employee and re-sends the email.
 * The existing employee_profiles row is updated in-place — no new row is created.
 * Requires an authenticated owner/admin session.
 */
export async function resendEmployeeInvite(
  profileId: string,
): Promise<ResendEmployeeInviteResult> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      return { success: false, error: 'Not authenticated' }
    }

    const res = await fetch('/.netlify/functions/resendEmployeeInvite', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ profileId }),
    })

    const data = await res.json()
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || `HTTP ${res.status}` }
    }

    return { success: true, email: data.email }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error'
    console.error('[employeeInviteService.resendEmployeeInvite] Error:', err)
    return { success: false, error: message }
  }
}
