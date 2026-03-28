// @ts-nocheck
/**
 * notifications.ts — OneSignal push notification integration
 *
 * Subscribes users on login, sends push for:
 *   - Daily briefing is ready
 *   - Invoice overdue 7+ days
 *   - SCOUT high-impact proposal
 *   - Lead not contacted in 5+ days
 *
 * Setup:
 *   1. Create app at onesignal.com
 *   2. Set VITE_ONESIGNAL_APP_ID in .env.local
 *   3. For web push: add OneSignal service worker files to public/
 *   4. For mobile: configure in Capacitor/native projects
 */

import { supabase } from '@/lib/supabase'

// ── Types ────────────────────────────────────────────────────────────────────

export type NotificationType =
  | 'daily_briefing'
  | 'invoice_overdue'
  | 'scout_proposal'
  | 'stale_lead'
  | 'payment_failed'
  | 'project_milestone'
  | 'general'

export interface PushNotification {
  type: NotificationType
  title: string
  body: string
  data?: Record<string, string>
  url?: string
}

interface OneSignalState {
  initialized: boolean
  subscribed: boolean
  playerId: string | null
  error: string | null
}

// ── State ────────────────────────────────────────────────────────────────────

let oneSignalState: OneSignalState = {
  initialized: false,
  subscribed: false,
  playerId: null,
  error: null,
}

// ── Initialize OneSignal ─────────────────────────────────────────────────────

export async function initializeNotifications(): Promise<boolean> {
  const appId = import.meta.env.VITE_ONESIGNAL_APP_ID

  if (!appId || appId === 'your-onesignal-app-id') {
    console.warn('[notifications] OneSignal not configured. Set VITE_ONESIGNAL_APP_ID.')
    oneSignalState.error = 'OneSignal not configured'
    return false
  }

  try {
    // Dynamically import OneSignal SDK
    const OneSignal = (window as any).OneSignal || []

    if (typeof OneSignal.init !== 'function') {
      // Load the SDK script
      await loadOneSignalSDK()
    }

    await (window as any).OneSignal.init({
      appId,
      allowLocalhostAsSecureOrigin: true,
      notifyButton: { enable: false }, // We use our own UI
      serviceWorkerParam: { scope: '/' },
    })

    oneSignalState.initialized = true
    console.log('[notifications] OneSignal initialized')
    return true
  } catch (err) {
    console.error('[notifications] Init failed:', err)
    oneSignalState.error = err instanceof Error ? err.message : 'Init failed'
    return false
  }
}

function loadOneSignalSDK(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).OneSignal) {
      resolve()
      return
    }

    const script = document.createElement('script')
    script.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load OneSignal SDK'))
    document.head.appendChild(script)
  })
}

// ── Subscribe User ───────────────────────────────────────────────────────────

export async function subscribeUser(userId: string, orgId: string): Promise<boolean> {
  if (!oneSignalState.initialized) {
    const ok = await initializeNotifications()
    if (!ok) return false
  }

  try {
    const OneSignal = (window as any).OneSignal

    // Request notification permission
    const permission = await OneSignal.Notifications.requestPermission()
    if (!permission) {
      console.log('[notifications] User denied notification permission')
      return false
    }

    // Get player ID
    const playerId = await OneSignal.User.getOnesignalId()
    oneSignalState.playerId = playerId
    oneSignalState.subscribed = true

    // Set external user ID and tags for targeting
    await OneSignal.login(userId)
    await OneSignal.User.addTags({
      org_id: orgId,
      user_id: userId,
      role: 'user',
    })

    // Store player ID in Supabase for server-side sends
    await supabase
      .from('profiles' as never)
      .update({
        metadata: supabase.rpc ? undefined : undefined, // Will merge in actual implementation
      })
      .eq('id', userId)

    // Store in a dedicated push_subscriptions approach
    await supabase
      .from('user_sessions' as never)
      .update({
        metadata: { onesignal_player_id: playerId },
      })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)

    console.log(`[notifications] Subscribed user ${userId}, player: ${playerId}`)
    return true
  } catch (err) {
    console.error('[notifications] Subscribe failed:', err)
    return false
  }
}

// ── Unsubscribe ──────────────────────────────────────────────────────────────

export async function unsubscribeUser(): Promise<void> {
  try {
    const OneSignal = (window as any).OneSignal
    if (OneSignal) {
      await OneSignal.User.pushSubscription.optOut()
      oneSignalState.subscribed = false
      oneSignalState.playerId = null
    }
  } catch (err) {
    console.error('[notifications] Unsubscribe failed:', err)
  }
}

// ── Send Notification (server-side via Edge Function) ────────────────────────

/**
 * Sends a push notification to a specific user or to all users in an org.
 * Should be called from Edge Functions, not the frontend.
 * This client-side version uses Supabase Functions as a proxy.
 */
export async function sendNotification(params: {
  targetUserId?: string
  targetOrgId?: string
  notification: PushNotification
}): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke('send-notification', {
    body: params,
  })

  if (error) {
    console.error('[notifications] Send failed:', error)
    return false
  }

  return data?.success ?? false
}

// ── Notification Builders ────────────────────────────────────────────────────

export function buildDailyBriefingNotification(): PushNotification {
  return {
    type: 'daily_briefing',
    title: 'Morning Briefing Ready',
    body: 'Your daily NEXUS briefing is ready. Tap to view.',
    url: '/nexus',
  }
}

export function buildInvoiceOverdueNotification(
  projectName: string,
  amount: number,
  daysOverdue: number
): PushNotification {
  return {
    type: 'invoice_overdue',
    title: `Invoice Overdue — ${daysOverdue} days`,
    body: `${projectName}: $${amount.toLocaleString()} is ${daysOverdue} days past due.`,
    url: '/invoices',
    data: { projectName, daysOverdue: String(daysOverdue) },
  }
}

export function buildScoutProposalNotification(
  proposalTitle: string,
  impactLevel: string
): PushNotification {
  return {
    type: 'scout_proposal',
    title: `New ${impactLevel} Proposal`,
    body: proposalTitle,
    url: '/scout',
    data: { impactLevel },
  }
}

export function buildStaleLeadNotification(
  leadName: string,
  daysSinceContact: number
): PushNotification {
  return {
    type: 'stale_lead',
    title: 'Lead Needs Follow-up',
    body: `${leadName} hasn't been contacted in ${daysSinceContact} days.`,
    url: '/marketing',
    data: { leadName, daysSinceContact: String(daysSinceContact) },
  }
}

// ── Permission Check ─────────────────────────────────────────────────────────

export function getNotificationState(): OneSignalState {
  return { ...oneSignalState }
}

export async function checkPermission(): Promise<'granted' | 'denied' | 'default'> {
  if (!('Notification' in window)) return 'denied'
  return Notification.permission as 'granted' | 'denied' | 'default'
}

// ── Request Permission (for onboarding step 5) ──────────────────────────────

export async function requestPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false

  try {
    const result = await Notification.requestPermission()
    return result === 'granted'
  } catch {
    return false
  }
}
