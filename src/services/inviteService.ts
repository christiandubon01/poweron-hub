// @ts-nocheck
/**
 * inviteService.ts — Beta Invite System (B7)
 *
 * Public API:
 *   sendInvite(email, industry?)  — calls the sendInvite Netlify function
 *   getInvites()                  — queries beta_invites ordered by invited_at DESC
 *   revokeInvite(id)              — sets status to 'revoked' (pending only)
 *   deleteInvite(id)              — hard-deletes pending/expired/revoked invite
 *   validateInviteToken(token)    — checks token exists + not expired + status=pending
 */

import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BetaInvite {
  id: string
  email: string
  invited_by: string | null
  invite_token?: string
  industry: string | null
  status: 'pending' | 'accepted' | 'expired' | 'revoked'
  invited_at: string
  accepted_at: string | null
  expires_at: string
}

export interface SendInviteResult {
  success: boolean
  inviteId?: string
  inviteToken?: string
  error?: string
}

export interface ValidateTokenResult {
  valid: boolean
  invite?: BetaInvite
  reason?: string
}

// ── sendInvite ────────────────────────────────────────────────────────────────

/**
 * Sends a beta invite email via the sendInvite Netlify function.
 * Inserts a row into beta_invites and dispatches email to invitee + owner.
 */
export async function sendInvite(
  email: string,
  industry?: string,
  invitedBy?: string,
): Promise<SendInviteResult> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) return { success: false, error: 'Not authenticated' }
    const res = await fetch('/.netlify/functions/sendInvite', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body:    JSON.stringify({ email, industry: industry || null, invitedBy: invitedBy || null }),
    })

    const data = await res.json()
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || `HTTP ${res.status}` }
    }

    return { success: true, inviteId: data.inviteId, inviteToken: data.inviteToken }
  } catch (err: any) {
    console.error('[inviteService.sendInvite] Error:', err)
    return { success: false, error: err.message || 'Network error' }
  }
}

// ── getInvites ────────────────────────────────────────────────────────────────

/**
 * Returns all beta_invites rows ordered by invited_at DESC.
 * Accessible to authenticated owners (via RLS owner_read policy).
 */
export async function getInvites(): Promise<BetaInvite[]> {
  const { data, error } = await supabase
    .from('beta_invites')
    .select('*')
    .order('invited_at', { ascending: false })

  if (error) {
    console.error('[inviteService.getInvites] Error:', error)
    return []
  }

  return (data ?? []) as BetaInvite[]
}

// ── revokeInvite ──────────────────────────────────────────────────────────────

/** Sets status to 'revoked'. Server only succeeds when current status is 'pending'. */
export async function revokeInvite(id: string): Promise<{ success: boolean; error?: string }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return { success: false, error: 'Not authenticated' }
  const response = await fetch('/.netlify/functions/pilot-telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ action: 'founder_revoke_beta_invite', inviteId: id }),
  })
  if (!response.ok) {
    try {
      const body = await response.json()
      return { success: false, error: body?.error || `HTTP ${response.status}` }
    } catch {
      return { success: false, error: `HTTP ${response.status}` }
    }
  }
  return { success: true }
}

// ── deleteInvite ──────────────────────────────────────────────────────────────

/** Hard-deletes a pending, expired, or revoked invite. Server refuses accepted invites. */
export async function deleteInvite(id: string): Promise<{ success: boolean; error?: string }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return { success: false, error: 'Not authenticated' }
  const response = await fetch('/.netlify/functions/pilot-telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ action: 'founder_delete_beta_invite', inviteId: id }),
  })
  if (!response.ok) {
    try {
      const body = await response.json()
      return { success: false, error: body?.error || `HTTP ${response.status}` }
    } catch {
      return { success: false, error: `HTTP ${response.status}` }
    }
  }
  return { success: true }
}

// ── validateInviteToken ───────────────────────────────────────────────────────

/**
 * Validates an invite token from the URL query string.
 * Returns valid=true only if:
 *   - token exists in beta_invites
 *   - status === 'pending'
 *   - expires_at > now()
 *
 * Called on app mount when ?invite=[token] is present in URL.
 */
export async function validateInviteToken(token: string): Promise<ValidateTokenResult> {
  if (!token || typeof token !== 'string' || token.length < 10) {
    return { valid: false, reason: 'Invalid token format' }
  }

  const { data, error } = await (supabase.rpc as any)('validate_beta_invite', { p_token: token })

  if (error || !data) {
    return { valid: false, reason: 'Token not found' }
  }
  const result = data as { valid: boolean; reason?: string; invite?: BetaInvite }
  return result.valid
    ? { valid: true, invite: result.invite }
    : { valid: false, reason: result.reason, invite: result.invite }
}

// ── markInviteAccepted ────────────────────────────────────────────────────────

/**
 * Called after the user signs the NDA to mark the invite as accepted.
 * Stores accepted_at timestamp.
 */
export async function markInviteAccepted(token: string): Promise<void> {
  const { data, error } = await (supabase.rpc as any)('accept_beta_invite', { p_token: token })
  if (error) throw error
  if (!data?.success) throw new Error(data?.reason || 'Beta invitation could not be accepted')
}
