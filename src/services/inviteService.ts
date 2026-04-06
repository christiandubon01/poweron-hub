// @ts-nocheck
/**
 * inviteService.ts — Beta Invite System (B7)
 *
 * Client-side service for the beta invite workflow.
 *
 * Public API:
 *   sendInvite(email, industry?)  — calls the sendInvite Netlify function
 *   getInvites()                  — queries beta_invites ordered by invited_at DESC
 *   revokeInvite(id)              — sets status to 'expired'
 *   validateInviteToken(token)    — checks token exists + not expired + status=pending
 */

import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BetaInvite {
  id: string
  email: string
  invited_by: string | null
  invite_token: string
  industry: string | null
  status: 'pending' | 'accepted' | 'expired'
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
    const res = await fetch('/.netlify/functions/sendInvite', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
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

/**
 * Marks the invite as expired, preventing future use.
 * Does not delete the row — preserves audit trail.
 */
export async function revokeInvite(id: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('beta_invites')
    .update({ status: 'expired' })
    .eq('id', id)

  if (error) {
    console.error('[inviteService.revokeInvite] Error:', error)
    return { success: false, error: error.message }
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

  const { data, error } = await supabase
    .from('beta_invites')
    .select('*')
    .eq('invite_token', token)
    .single()

  if (error || !data) {
    return { valid: false, reason: 'Token not found' }
  }

  const invite = data as BetaInvite

  if (invite.status !== 'pending') {
    return {
      valid:  false,
      reason: invite.status === 'accepted' ? 'Invite already accepted' : 'Invite has expired or been revoked',
      invite,
    }
  }

  const now = new Date()
  const exp = new Date(invite.expires_at)
  if (now > exp) {
    // Auto-mark as expired
    await supabase
      .from('beta_invites')
      .update({ status: 'expired' })
      .eq('id', invite.id)
    return { valid: false, reason: 'Invite link has expired', invite }
  }

  return { valid: true, invite }
}

// ── markInviteAccepted ────────────────────────────────────────────────────────

/**
 * Called after the user signs the NDA to mark the invite as accepted.
 * Stores accepted_at timestamp.
 */
export async function markInviteAccepted(token: string): Promise<void> {
  const { error } = await supabase
    .from('beta_invites')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('invite_token', token)

  if (error) {
    console.error('[inviteService.markInviteAccepted] Error:', error)
  }
}
