// @ts-nocheck
/**
 * PortalSchedulingAgent — AI scheduling agent for the customer portal
 *
 * Handles:
 *  - Reading available time slots from CHRONO calendar data (job_schedule table)
 *  - Creating tentative bookings in portal_bookings table
 *  - Notifying Christian for approval via agentBus
 *  - Approval flow: approve → confirm email, suggest → send alternatives, decline → polite message
 *  - Confirmation system: email via Resend, SMS reminders (logged for future integration)
 *
 * Integrates with:
 *  - Supabase: job_schedule (read availability), portal_bookings (write bookings)
 *  - agentBus: CHRONO ↔ portal bridge for owner notifications
 *  - agentEventBus: domain events for cross-agent awareness
 *  - Claude (via /.netlify/functions/claude): AI chat responses (claude-haiku-4-5 for speed)
 *
 * DATA FIREWALL:
 *  - Reads CHRONO schedule data (job_schedule) read-only
 *  - Writes only to portal_bookings — never to operational tables
 *  - No portal user credentials reach operational tables
 */

import { supabase } from '@/lib/supabase'
import { send as busSend } from '@/services/agentBus'
import { publish as eventPublish } from '@/services/agentEventBus'

// ── Constants ─────────────────────────────────────────────────────────────────

export const SCHEDULING_AGENT_VERSION = '1.0.0'

export const BOOKING_STATUS = {
  TENTATIVE: 'tentative',
  APPROVED:  'approved',
  DECLINED:  'declined',
  SUGGESTED: 'suggested', // Christian suggested a different time
} as const

export type BookingStatus = typeof BOOKING_STATUS[keyof typeof BOOKING_STATUS]

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AvailableSlot {
  date: string         // YYYY-MM-DD
  dayLabel: string     // e.g. "Thursday, June 12"
  startTime: string    // e.g. "10:00"
  endTime: string      // e.g. "14:00"
  displayLabel: string // e.g. "Thursday between 10 AM–2 PM"
}

export interface BookingContactInfo {
  name: string
  email: string
  phone: string
  address: string
}

export interface PortalBooking {
  id: string
  confirmation_number: string
  customer_name: string
  customer_email: string
  customer_phone: string
  customer_address: string
  service_type: string
  urgency: 'low' | 'medium' | 'high' | 'emergency'
  preferred_date: string
  preferred_time_start: string
  preferred_time_end: string
  notes?: string
  status: BookingStatus
  owner_notified_at?: string
  approved_at?: string
  declined_at?: string
  suggested_times?: AvailableSlot[]
  technician_name?: string
  created_at: string
  updated_at: string
}

export interface CreateBookingInput {
  serviceType: string
  urgency: 'low' | 'medium' | 'high' | 'emergency'
  selectedSlot: AvailableSlot
  contact: BookingContactInfo
  notes?: string
}

export interface ApprovalActionInput {
  bookingId: string
  action: 'approve' | 'decline' | 'suggest'
  suggestedSlots?: AvailableSlot[]
  technicianName?: string
  declineReason?: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface SchedulingSession {
  messages: ChatMessage[]
  collectedData: {
    serviceType?: string
    urgency?: string
    preferredDates?: string
    address?: string
    name?: string
    email?: string
    phone?: string
    selectedSlot?: AvailableSlot
  }
  phase: 'greeting' | 'collecting' | 'proposing' | 'confirming' | 'complete'
  availableSlots?: AvailableSlot[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function generateConfirmationNumber(): string {
  const segment = generateUUID().replace(/-/g, '').slice(0, 8).toUpperCase()
  return `PSB-${segment}` // Portal Scheduling Booking
}

function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00') // noon to avoid TZ shift
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

function formatTimeDisplay(time24: string): string {
  const [h, m] = time24.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return m === 0 ? `${h12} ${period}` : `${h12}:${m.toString().padStart(2, '0')} ${period}`
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

// ── getOwnerUserId ────────────────────────────────────────────────────────────

/**
 * Returns the authenticated owner's user ID.
 * The portal scheduling agent runs in owner context for reading schedule data.
 */
async function getOwnerUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser()
  return data?.user?.id ?? null
}

// ── getAvailableSlots ─────────────────────────────────────────────────────────

/**
 * Reads the CHRONO job_schedule table to find open days in the next 14 days.
 * A day is "available" if it has fewer than 2 jobs scheduled.
 * Returns up to 6 available slots with human-readable labels.
 *
 * Falls back to mock slots if Supabase is unavailable (graceful degradation).
 */
export async function getAvailableSlots(): Promise<AvailableSlot[]> {
  const userId = await getOwnerUserId()

  const today = new Date()
  const lookAheadDays = 14
  const slots: AvailableSlot[] = []

  // Build date range to check
  const dateRange: string[] = []
  for (let i = 1; i <= lookAheadDays; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    const dayOfWeek = d.getDay()
    // Skip Sundays (0) — Power On Solutions works Mon–Sat
    if (dayOfWeek !== 0) {
      dateRange.push(toDateStr(d))
    }
  }

  if (userId && dateRange.length > 0) {
    try {
      const { data: scheduledJobs, error } = await supabase
        .from('job_schedule')
        .select('scheduled_date, status')
        .eq('user_id', userId)
        .in('scheduled_date', dateRange)
        .not('status', 'eq', 'cancelled')

      if (!error && scheduledJobs) {
        // Count jobs per date
        const jobCountByDate: Record<string, number> = {}
        for (const job of scheduledJobs) {
          const d = job.scheduled_date
          jobCountByDate[d] = (jobCountByDate[d] || 0) + 1
        }

        // Dates with fewer than 2 jobs are available for new bookings
        for (const date of dateRange) {
          const count = jobCountByDate[date] || 0
          if (count < 2 && slots.length < 6) {
            const dayLabel = formatDateLabel(date)
            // Alternate AM/PM slots to offer variety
            const isAM = slots.length % 2 === 0
            const startTime = isAM ? '08:00' : '12:00'
            const endTime = isAM ? '12:00' : '16:00'
            const displayLabel = `${dayLabel} ${isAM ? 'morning (8 AM–12 PM)' : 'afternoon (12–4 PM)'}`

            slots.push({
              date,
              dayLabel,
              startTime,
              endTime,
              displayLabel,
            })
          }
        }
      }
    } catch (err) {
      console.error('[PortalSchedulingAgent] getAvailableSlots: Supabase error', err)
    }
  }

  // Graceful fallback: build 4 mock slots if we got nothing from Supabase
  if (slots.length === 0) {
    const mockOffsets = [2, 3, 5, 6] // days from today
    for (const offset of mockOffsets) {
      const d = new Date(today)
      d.setDate(today.getDate() + offset)
      if (d.getDay() === 0) continue // skip Sunday
      const date = toDateStr(d)
      const dayLabel = formatDateLabel(date)
      const isAM = slots.length % 2 === 0
      const startTime = isAM ? '08:00' : '12:00'
      const endTime = isAM ? '12:00' : '16:00'
      slots.push({
        date,
        dayLabel,
        startTime,
        endTime,
        displayLabel: `${dayLabel} ${isAM ? 'morning (8 AM–12 PM)' : 'afternoon (12–4 PM)'}`,
      })
      if (slots.length >= 4) break
    }
  }

  return slots
}

// ── createTentativeBooking ────────────────────────────────────────────────────

/**
 * Creates a tentative booking in the portal_bookings table.
 * Triggers owner notification via agentBus → CHRONO channel.
 * Publishes domain event to agentEventBus.
 *
 * @returns Created booking or null on error
 */
export async function createTentativeBooking(
  input: CreateBookingInput
): Promise<PortalBooking | null> {
  const confirmationNumber = generateConfirmationNumber()

  const bookingPayload: Record<string, unknown> = {
    id: generateUUID(),
    confirmation_number: confirmationNumber,
    customer_name: input.contact.name,
    customer_email: input.contact.email,
    customer_phone: input.contact.phone,
    customer_address: input.contact.address,
    service_type: input.serviceType,
    urgency: input.urgency,
    preferred_date: input.selectedSlot.date,
    preferred_time_start: input.selectedSlot.startTime,
    preferred_time_end: input.selectedSlot.endTime,
    notes: input.notes || null,
    status: BOOKING_STATUS.TENTATIVE,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  let createdBooking: PortalBooking | null = null

  // Attempt Supabase write (portal_bookings table)
  try {
    const { data, error } = await supabase
      .from('portal_bookings')
      .insert([bookingPayload])
      .select()
      .single()

    if (error) {
      console.error('[PortalSchedulingAgent] createTentativeBooking: Supabase error', error)
      // Fall through: construct local object so notification still fires
      createdBooking = bookingPayload as unknown as PortalBooking
    } else {
      createdBooking = data as PortalBooking
    }
  } catch (err) {
    console.error('[PortalSchedulingAgent] createTentativeBooking: Exception', err)
    createdBooking = bookingPayload as unknown as PortalBooking
  }

  if (!createdBooking) return null

  // Notify Christian via agentBus (CHRONO channel)
  try {
    await busSend({
      from: 'CHRONO',
      to: 'NEXUS',
      type: 'alert',
      payload: {
        alertType: 'new_booking_request',
        bookingId: createdBooking.id,
        confirmationNumber,
        customerName: input.contact.name,
        serviceType: input.serviceType,
        urgency: input.urgency,
        preferredDate: input.selectedSlot.date,
        preferredTimeStart: input.selectedSlot.startTime,
        preferredTimeEnd: input.selectedSlot.endTime,
        customerPhone: input.contact.phone,
        customerEmail: input.contact.email,
        address: input.contact.address,
        notes: input.notes || '',
        message: `📅 New booking request: ${input.contact.name} — ${input.serviceType} — ${input.selectedSlot.displayLabel}`,
        actions: ['approve', 'suggest_different_time', 'decline'],
        timestamp: new Date().toISOString(),
      },
    })
  } catch (err) {
    console.error('[PortalSchedulingAgent] createTentativeBooking: agentBus notify error', err)
  }

  // Publish domain event
  try {
    eventPublish({
      type: 'JOB_SCHEDULED',
      source: 'portal-scheduling-agent',
      payload: {
        bookingId: createdBooking.id,
        confirmationNumber,
        customerName: input.contact.name,
        serviceType: input.serviceType,
        preferredDate: input.selectedSlot.date,
        status: BOOKING_STATUS.TENTATIVE,
      },
    })
  } catch (err) {
    console.error('[PortalSchedulingAgent] createTentativeBooking: eventPublish error', err)
  }

  console.log('[PortalSchedulingAgent] Tentative booking created:', confirmationNumber)
  return createdBooking
}

// ── processApprovalAction ─────────────────────────────────────────────────────

/**
 * Processes Christian's approval decision.
 *
 * approve   → updates booking status to 'approved', sends confirmation email to customer
 * suggest   → updates booking status to 'suggested', returns alternative slots to customer
 * decline   → updates booking status to 'declined', sends polite decline message
 *
 * @returns Updated booking or null on error
 */
export async function processApprovalAction(
  input: ApprovalActionInput
): Promise<{ booking: PortalBooking | null; message: string }> {
  const updateData: Record<string, unknown> = {
    status: input.action === 'approve'
      ? BOOKING_STATUS.APPROVED
      : input.action === 'decline'
        ? BOOKING_STATUS.DECLINED
        : BOOKING_STATUS.SUGGESTED,
    updated_at: new Date().toISOString(),
  }

  if (input.action === 'approve') {
    updateData.approved_at = new Date().toISOString()
    if (input.technicianName) updateData.technician_name = input.technicianName
  } else if (input.action === 'decline') {
    updateData.declined_at = new Date().toISOString()
  } else if (input.action === 'suggest' && input.suggestedSlots) {
    updateData.suggested_times = input.suggestedSlots
  }

  let updatedBooking: PortalBooking | null = null

  try {
    const { data, error } = await supabase
      .from('portal_bookings')
      .update(updateData)
      .eq('id', input.bookingId)
      .select()
      .single()

    if (error) {
      console.error('[PortalSchedulingAgent] processApprovalAction: Supabase error', error)
    } else {
      updatedBooking = data as PortalBooking
    }
  } catch (err) {
    console.error('[PortalSchedulingAgent] processApprovalAction: Exception', err)
  }

  // Publish domain event for approval action
  try {
    eventPublish({
      type: input.action === 'approve' ? 'PROPOSAL_APPROVED' : 'PROPOSAL_REJECTED',
      source: 'portal-scheduling-agent',
      payload: {
        bookingId: input.bookingId,
        action: input.action,
        technicianName: input.technicianName || null,
        timestamp: new Date().toISOString(),
      },
    })
  } catch (err) {
    console.error('[PortalSchedulingAgent] processApprovalAction: eventPublish error', err)
  }

  // Build customer-facing message based on action
  let message = ''
  if (input.action === 'approve') {
    const tech = input.technicianName || 'our technician'
    message = `Great news! Your booking has been confirmed. ${tech} will be at your location on the scheduled date. You'll receive a confirmation email shortly with all the details.`
  } else if (input.action === 'decline') {
    message = `We appreciate your interest in Power On Solutions. Unfortunately, we're unable to accommodate that time slot. Please call us directly at (760) 555-0100 or visit our website to discuss alternative options.`
  } else if (input.action === 'suggest') {
    const slots = input.suggestedSlots || []
    const slotList = slots.map((s, i) => `${i + 1}. ${s.displayLabel}`).join('\n')
    message = `Our technician has a scheduling conflict for that time. Here are some alternative openings:\n\n${slotList}\n\nWould any of these work for you?`
  }

  return { booking: updatedBooking, message }
}

// ── sendBookingConfirmationEmail ──────────────────────────────────────────────

/**
 * Sends a booking confirmation email to the customer via Resend
 * (through the portal-schedule Netlify function).
 *
 * Called after Christian approves the booking.
 */
export async function sendBookingConfirmationEmail(booking: PortalBooking): Promise<boolean> {
  try {
    const response = await fetch('/.netlify/functions/portal-schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'send_confirmation_email',
        bookingId: booking.id,
        customerEmail: booking.customer_email,
        customerName: booking.customer_name,
        confirmationNumber: booking.confirmation_number,
        serviceType: booking.service_type,
        preferredDate: booking.preferred_date,
        preferredTimeStart: booking.preferred_time_start,
        preferredTimeEnd: booking.preferred_time_end,
        technicianName: booking.technician_name || 'Christian D., C-10 Licensed Electrician',
        address: booking.customer_address,
      }),
    })
    return response.ok
  } catch (err) {
    console.error('[PortalSchedulingAgent] sendBookingConfirmationEmail: Error', err)
    return false
  }
}

// ── getAIChatResponse ─────────────────────────────────────────────────────────

/**
 * Sends the current conversation to Claude (claude-haiku-4-5 for speed)
 * and returns the AI scheduling assistant's response.
 *
 * System prompt positions AI as Power On Solutions scheduling assistant.
 * AI collects: service type, urgency, preferred times, address, contact info.
 * AI never discusses pricing.
 *
 * @param session  - current scheduling session with message history
 * @param slots    - available time slots (injected into system context)
 * @returns AI response text
 */
export async function getAIChatResponse(
  session: SchedulingSession,
  slots: AvailableSlot[]
): Promise<string> {
  const slotsText = slots.length > 0
    ? slots.map(s => `• ${s.displayLabel}`).join('\n')
    : 'Please call us directly at (760) 555-0100 for scheduling.'

  const systemPrompt = `You are the scheduling assistant for Power On Solutions LLC, a licensed C-10 electrical contractor in Desert Hot Springs, CA. Be professional, warm, and efficient.

Your goal: collect all required information to book an estimate or service call.

Information to collect (in natural conversation order):
1. Service type (what electrical work is needed)
2. Urgency (emergency, high, medium, or low priority)
3. Preferred dates/times
4. Property address
5. Contact info: full name, email, phone number

AVAILABLE TIME SLOTS:
${slotsText}

RULES:
- Never discuss pricing — if asked, say: "Our technician will provide a detailed estimate during the visit at no charge for the estimate."
- Once you have all 5 pieces of information, confirm the slot selection and say you are ready to submit the booking request.
- When all info is confirmed, end your message with: [READY_TO_BOOK]
- Be concise — keep responses under 4 sentences.
- If user is vague about urgency, ask: "Is this an urgent/emergency situation, or can we schedule at your convenience?"
- Format time proposals naturally: "I have Thursday morning (8 AM–12 PM) or Friday afternoon (12–4 PM) available."
- Company: Power On Solutions LLC | License: C-10 #1151468 | Area: Coachella Valley, CA`

  // Build messages array for Claude
  const messages = session.messages.map(m => ({
    role: m.role,
    content: m.content,
  }))

  try {
    const response = await fetch('/.netlify/functions/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        system: systemPrompt,
        messages,
        max_tokens: 300,
      }),
    })

    if (!response.ok) {
      console.error('[PortalSchedulingAgent] getAIChatResponse: Claude API error', response.status)
      return "I'm having a brief connection issue. Please try again in a moment, or call us directly at (760) 555-0100."
    }

    const result = await response.json()

    // Handle both direct content and nested content block format
    if (result.content && Array.isArray(result.content)) {
      const textBlock = result.content.find((b: any) => b.type === 'text')
      return textBlock?.text || result.content[0]?.text || ''
    }
    if (typeof result.content === 'string') return result.content
    if (result.text) return result.text

    return "I'm here to help you schedule! What type of electrical work do you need?"
  } catch (err) {
    console.error('[PortalSchedulingAgent] getAIChatResponse: Exception', err)
    return "I'm experiencing a brief interruption. You can also reach us at (760) 555-0100."
  }
}

// ── createNewSession ──────────────────────────────────────────────────────────

/**
 * Creates a fresh scheduling session with the opening greeting.
 */
export function createNewSession(): SchedulingSession {
  return {
    messages: [
      {
        role: 'assistant',
        content: "Hi! I'm the scheduling assistant for Power On Solutions. I can help you book an estimate or service call. What type of electrical work do you need?",
        timestamp: Date.now(),
      },
    ],
    collectedData: {},
    phase: 'greeting',
    availableSlots: [],
  }
}

// ── checkBookingReady ─────────────────────────────────────────────────────────

/**
 * Checks if the AI response signals all info has been collected.
 * Looks for the [READY_TO_BOOK] sentinel in the AI response.
 */
export function checkBookingReady(aiResponse: string): boolean {
  return aiResponse.includes('[READY_TO_BOOK]')
}

/**
 * Strips the [READY_TO_BOOK] sentinel from the display text.
 */
export function cleanAIResponse(aiResponse: string): string {
  return aiResponse.replace('[READY_TO_BOOK]', '').trim()
}

// ── getBookingById ────────────────────────────────────────────────────────────

/**
 * Fetches a portal booking by ID.
 */
export async function getBookingById(bookingId: string): Promise<PortalBooking | null> {
  try {
    const { data, error } = await supabase
      .from('portal_bookings')
      .select('*')
      .eq('id', bookingId)
      .single()

    if (error) {
      console.error('[PortalSchedulingAgent] getBookingById: error', error)
      return null
    }
    return data as PortalBooking
  } catch (err) {
    console.error('[PortalSchedulingAgent] getBookingById: exception', err)
    return null
  }
}

// ── getPendingBookings ────────────────────────────────────────────────────────

/**
 * Returns all tentative bookings awaiting Christian's approval.
 * Used by the admin panel to show pending requests.
 */
export async function getPendingBookings(): Promise<PortalBooking[]> {
  const userId = await getOwnerUserId()
  if (!userId) return []

  try {
    const { data, error } = await supabase
      .from('portal_bookings')
      .select('*')
      .eq('status', BOOKING_STATUS.TENTATIVE)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[PortalSchedulingAgent] getPendingBookings: error', error)
      return []
    }
    return (data as PortalBooking[]) ?? []
  } catch (err) {
    console.error('[PortalSchedulingAgent] getPendingBookings: exception', err)
    return []
  }
}

// ── formatSlotsForDisplay ─────────────────────────────────────────────────────

/**
 * Formats available slots into a human-readable list for the chat widget.
 */
export function formatSlotsForDisplay(slots: AvailableSlot[]): string {
  if (slots.length === 0) return 'Please call (760) 555-0100 to check availability.'
  return slots.map((s, i) => `${i + 1}. ${s.displayLabel}`).join('\n')
}

// Export all as named exports
export default {
  getAvailableSlots,
  createTentativeBooking,
  processApprovalAction,
  sendBookingConfirmationEmail,
  getAIChatResponse,
  createNewSession,
  checkBookingReady,
  cleanAIResponse,
  getBookingById,
  getPendingBookings,
  formatSlotsForDisplay,
}
