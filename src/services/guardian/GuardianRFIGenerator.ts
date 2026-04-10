/**
 * GuardianRFIGenerator.ts
 *
 * Auto-generates and manages professional RFI emails when NEC code conflicts
 * are detected on a project.  Uses Claude (via claudeProxy) to compose the
 * email body, Resend API to deliver it, and Supabase to persist the record.
 *
 * Public API
 * ----------
 *  generateRFI(projectId, conflictData)         → Promise<GuardianRFI>
 *  sendRFI(rfiId, recipientEmail)               → Promise<void>
 *  checkRFIFollowUp()                           → Promise<void>   (run daily)
 *  markRFIResponse(rfiId, responseText)         → Promise<void>
 */

import { supabase } from '@/lib/supabase'
import { callClaude, extractText } from '@/services/claudeProxy'

// ── Types ─────────────────────────────────────────────────────────────────────

export type RFIStatus = 'draft' | 'sent' | 'awaiting_response' | 'responded' | 'overdue'

export interface GuardianRFIConflictData {
  /** Full civic address of the project */
  projectAddress: string
  /** Permit number */
  permitNumber: string
  /** Plain-English description of the conflict */
  conflictDescription: string
  /** NEC article and section, e.g. "NEC 210.52(A)" */
  necReference: string
  /** What must be corrected */
  requiredCorrectiveAction: string
  /** Name / company of the recipient */
  recipientName?: string
  /** Optional: which GC / inspector this is directed to */
  directedTo?: string
}

export interface GuardianRFI {
  id: string
  project_id: string
  project_address: string
  permit_number: string
  conflict_description: string
  nec_reference: string
  required_corrective_action: string
  email_body: string
  recipient_email: string | null
  directed_to: string | null
  status: RFIStatus
  sent_at: string | null
  response_deadline: string | null
  responded_at: string | null
  response_text: string | null
  follow_up_sent_at: string | null
  created_at: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RESEND_API_URL = 'https://api.resend.com/emails'
const FROM_ADDRESS = 'Power On Solutions <noreply@poweronsolutionsllc.com>'
const FOLLOW_UP_HOURS = 48

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid(): string {
  return `rfi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function isoNow(): string {
  return new Date().toISOString()
}

/** Returns an ISO timestamp FOLLOW_UP_HOURS from now */
function deadlineFromNow(): string {
  const d = new Date()
  d.setHours(d.getHours() + FOLLOW_UP_HOURS)
  return d.toISOString()
}

/** Returns the Resend API key from Vite env */
function resendKey(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (import.meta as any).env?.VITE_RESEND_API_KEY ?? ''
}

// ── Core: Generate RFI email via Claude ───────────────────────────────────────

/**
 * generateRFI
 *
 * Calls Claude to compose a professional RFI email, then persists the record
 * (status = 'draft') in the `guardian_rfis` Supabase table.
 */
export async function generateRFI(
  projectId: string,
  conflictData: GuardianRFIConflictData
): Promise<GuardianRFI> {
  const {
    projectAddress,
    permitNumber,
    conflictDescription,
    necReference,
    requiredCorrectiveAction,
    recipientName = '',
    directedTo = '',
  } = conflictData

  const systemPrompt = `Generate a professional RFI email from Christian Dubon, C-10 #1151468, Power On Solutions LLC.
Project: ${projectAddress}. Permit: ${permitNumber}. Conflict: ${conflictDescription}.
NEC reference: ${necReference}. Required corrective action: ${requiredCorrectiveAction}.
Tone: professional, firm, protective. Not aggressive.
Include: date identified, specific code reference, required correction, deadline for response (48 hours), signature block.
Format as plain text email ready to send.`

  const userMessage = recipientName
    ? `Please address this RFI to ${recipientName}${directedTo ? ` at ${directedTo}` : ''}.`
    : `Generate the RFI email now.`

  let emailBody: string
  try {
    const response = await callClaude({
      messages: [{ role: 'user', content: userMessage }],
      system: systemPrompt,
      max_tokens: 1024,
    })
    emailBody = extractText(response)
  } catch (err) {
    // Fallback: compose a minimal template so the record can still be created
    const today = new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    })
    emailBody = [
      `Date: ${today}`,
      '',
      `RE: RFI — Code Conflict at ${projectAddress}`,
      `Permit: ${permitNumber}`,
      '',
      `Description: ${conflictDescription}`,
      `NEC Reference: ${necReference}`,
      `Required Corrective Action: ${requiredCorrectiveAction}`,
      '',
      `Please respond within 48 hours of receipt.`,
      '',
      `Christian Dubon`,
      `C-10 License #1151468`,
      `Power On Solutions LLC`,
    ].join('\n')
  }

  const now = isoNow()
  const rfi: GuardianRFI = {
    id: uid(),
    project_id: projectId,
    project_address: projectAddress,
    permit_number: permitNumber,
    conflict_description: conflictDescription,
    nec_reference: necReference,
    required_corrective_action: requiredCorrectiveAction,
    email_body: emailBody,
    recipient_email: null,
    directed_to: directedTo || null,
    status: 'draft',
    sent_at: null,
    response_deadline: null,
    responded_at: null,
    response_text: null,
    follow_up_sent_at: null,
    created_at: now,
  }

  // Persist to Supabase (non-blocking — don't crash the UI if Supabase is unavailable)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('guardian_rfis') as any).insert(rfi)
    if (error) {
      console.warn('[GuardianRFIGenerator] Supabase insert error:', error.message)
    }
  } catch (err) {
    console.warn('[GuardianRFIGenerator] Supabase unavailable, continuing in local mode')
  }

  return rfi
}

// ── Core: Send RFI via Resend ─────────────────────────────────────────────────

/**
 * sendRFI
 *
 * Delivers the RFI email via Resend, then updates the `guardian_rfis` record
 * with status 'sent', sent_at timestamp, and 48-hour response deadline.
 */
export async function sendRFI(rfiId: string, recipientEmail: string): Promise<void> {
  // Load the RFI record
  let rfi: GuardianRFI | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('guardian_rfis') as any)
      .select('*')
      .eq('id', rfiId)
      .single()
    if (error) throw error
    rfi = data as GuardianRFI
  } catch (err) {
    throw new Error(`[GuardianRFIGenerator] Could not load RFI ${rfiId}: ${String(err)}`)
  }

  if (!rfi) throw new Error(`[GuardianRFIGenerator] RFI ${rfiId} not found`)

  const key = resendKey()
  if (!key) {
    console.warn('[GuardianRFIGenerator] RESEND_API_KEY not configured — skipping email send')
  } else {
    // Send via Resend
    const subject = `RFI — Code Conflict at ${rfi.project_address} (Permit ${rfi.permit_number})`
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [recipientEmail],
        subject,
        text: rfi.email_body,
      }),
    })

    if (!res.ok) {
      const detail = await res.text()
      throw new Error(`[GuardianRFIGenerator] Resend error ${res.status}: ${detail}`)
    }
  }

  const now = isoNow()
  const deadline = deadlineFromNow()

  // Update Supabase record
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('guardian_rfis') as any)
      .update({
        recipient_email: recipientEmail,
        status: 'sent' as RFIStatus,
        sent_at: now,
        response_deadline: deadline,
      })
      .eq('id', rfiId)
  } catch (err) {
    console.warn('[GuardianRFIGenerator] Could not update RFI status after send:', String(err))
  }
}

// ── Core: 48-Hour Follow-Up Check ─────────────────────────────────────────────

/**
 * checkRFIFollowUp
 *
 * Designed to run once per day (cron / scheduled function).
 * Scans all sent / awaiting_response RFIs whose deadline has passed and no
 * response has been recorded.  For each, generates a follow-up email via
 * Claude and sends it via Resend, then marks status 'overdue'.
 */
export async function checkRFIFollowUp(): Promise<void> {
  const now = new Date()

  let overdueRFIs: GuardianRFI[] = []
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('guardian_rfis') as any)
      .select('*')
      .in('status', ['sent', 'awaiting_response'])
      .is('responded_at', null)
      .lt('response_deadline', now.toISOString())
    if (error) throw error
    overdueRFIs = (data ?? []) as GuardianRFI[]
  } catch (err) {
    console.warn('[GuardianRFIGenerator] checkRFIFollowUp — could not query Supabase:', String(err))
    return
  }

  for (const rfi of overdueRFIs) {
    // Generate follow-up email body via Claude
    const systemPrompt = `Generate a professional follow-up RFI email from Christian Dubon, C-10 #1151468, Power On Solutions LLC.
This is a follow-up to an unanswered RFI.
Project: ${rfi.project_address}. Permit: ${rfi.permit_number}. 
Original conflict: ${rfi.conflict_description}.
NEC reference: ${rfi.nec_reference}.
Required corrective action: ${rfi.required_corrective_action}.
The original RFI was sent and no response has been received within 48 hours.
Tone: firm, professional, urgent. Reference the original RFI. Request immediate response.
Format as plain text email ready to send.`

    let followUpBody: string
    try {
      const response = await callClaude({
        messages: [{ role: 'user', content: 'Generate the follow-up RFI email now.' }],
        system: systemPrompt,
        max_tokens: 800,
      })
      followUpBody = extractText(response)
    } catch {
      followUpBody = [
        `FOLLOW-UP — ${new Date().toLocaleDateString()}`,
        '',
        `RE: Unanswered RFI — ${rfi.project_address} (Permit ${rfi.permit_number})`,
        '',
        `This is a follow-up to our previous RFI regarding: ${rfi.conflict_description}`,
        `NEC Reference: ${rfi.nec_reference}`,
        '',
        `No response has been received.  Immediate corrective action is required before work proceeds.`,
        '',
        `Christian Dubon`,
        `C-10 License #1151468`,
        `Power On Solutions LLC`,
      ].join('\n')
    }

    // Send via Resend
    const key = resendKey()
    if (key && rfi.recipient_email) {
      try {
        await fetch(RESEND_API_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: FROM_ADDRESS,
            to: [rfi.recipient_email],
            subject: `FOLLOW-UP RFI — ${rfi.project_address} (Permit ${rfi.permit_number})`,
            text: followUpBody,
          }),
        })
      } catch (err) {
        console.warn('[GuardianRFIGenerator] Follow-up send failed:', String(err))
      }
    }

    // Update status to overdue + record follow-up timestamp
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('guardian_rfis') as any)
        .update({
          status: 'overdue' as RFIStatus,
          follow_up_sent_at: new Date().toISOString(),
        })
        .eq('id', rfi.id)
    } catch (err) {
      console.warn('[GuardianRFIGenerator] Could not update RFI to overdue:', String(err))
    }
  }
}

// ── Core: Mark Response ───────────────────────────────────────────────────────

/**
 * markRFIResponse
 *
 * Records the GC / inspector response on the RFI and updates status to 'responded'.
 */
export async function markRFIResponse(rfiId: string, responseText: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('guardian_rfis') as any)
      .update({
        status: 'responded' as RFIStatus,
        responded_at: new Date().toISOString(),
        response_text: responseText,
      })
      .eq('id', rfiId)
    if (error) throw error
  } catch (err) {
    throw new Error(`[GuardianRFIGenerator] markRFIResponse failed: ${String(err)}`)
  }
}
