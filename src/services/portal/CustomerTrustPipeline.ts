// @ts-nocheck
/**
 * CustomerTrustPipeline — Customer-facing job transparency service
 *
 * Manages the full booking-to-completion pipeline that customers can
 * track in real time via a unique, no-login status URL.
 *
 * URL pattern: poweronsolutionsllc.com/status/[booking-id]
 *
 * Pipeline stages (7):
 *   BOOKED → EN_ROUTE → ARRIVING → ON_SITE → IN_PROGRESS → WRAPPING_UP → COMPLETE
 *
 * Each stage transition:
 *   • Updates booking record in Supabase (customer_bookings table)
 *   • Sends SMS via Twilio (or placeholder until configured)
 *   • Logs the event to the communication_log table
 *   • Notifies all connected clients through polling / realtime
 *
 * Tech actions (from PowerOn Hub internal view):
 *   markEnRoute()  → triggers SMS + map update
 *   markArrived()  → triggers SMS + stage change
 *   markComplete() → triggers completion SMS + review request
 *   flagIssue()    → sends delay notice to customer
 *   sendUpdate()   → free-text SMS to customer
 *
 * Communication log:
 *   • All outbound messages stored in communication_log
 *   • Inbound customer SMS replies stored and surfaced in Hub
 *   • Full trail visible to owner for quality assurance
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type PipelineStage =
  | 'BOOKED'
  | 'EN_ROUTE'
  | 'ARRIVING'
  | 'ON_SITE'
  | 'IN_PROGRESS'
  | 'WRAPPING_UP'
  | 'COMPLETE'

export type MessageDirection = 'outbound' | 'inbound'
export type MessageChannel = 'sms' | 'system' | 'flag'

export interface PipelineStageInfo {
  stage: PipelineStage
  label: string
  description: string
  icon: string
  index: number
}

export interface BookingRecord {
  id: string
  bookingId: string
  customerId?: string
  customerName: string
  customerPhone: string
  customerEmail?: string
  address: string
  scheduledDate: string
  scheduledTime: string
  techName: string
  techPhoto?: string
  techLicense?: string
  currentStage: PipelineStage
  stageHistory: StageHistoryEntry[]
  communicationLog: CommunicationEntry[]
  etaMinutes?: number
  etaTimestamp?: string
  approximateLocation?: ApproximateLocation
  locationSharingEnabled: boolean
  createdAt: string
  updatedAt: string
}

export interface StageHistoryEntry {
  stage: PipelineStage
  timestamp: string
  note?: string
  triggeredBy: 'tech' | 'system'
}

export interface CommunicationEntry {
  id: string
  bookingId: string
  direction: MessageDirection
  channel: MessageChannel
  body: string
  timestamp: string
  smsStatus?: 'queued' | 'sent' | 'delivered' | 'failed'
  isIssueFlag?: boolean
  flagDetails?: IssueFlag
}

export interface IssueFlag {
  delayMinutes?: number
  updatedEta?: string
  reason: string
  resolvedAt?: string
}

export interface ApproximateLocation {
  neighborhood: string
  city: string
  state: string
  // Neighborhood-level only — never exact GPS coordinates
  // This protects tech privacy while keeping customer informed
}

export interface TechActionPayload {
  bookingId: string
  techId: string
  action: TechAction
  note?: string
  etaMinutes?: number
  issueFlag?: IssueFlag
  locationEnabled?: boolean
}

export type TechAction =
  | 'MARK_EN_ROUTE'
  | 'MARK_ARRIVED'
  | 'MARK_IN_PROGRESS'
  | 'MARK_WRAPPING_UP'
  | 'MARK_COMPLETE'
  | 'FLAG_ISSUE'
  | 'SEND_UPDATE'
  | 'TOGGLE_LOCATION'

export interface StatusUpdateResult {
  success: boolean
  booking?: BookingRecord
  smsSent?: boolean
  smsError?: string
  error?: string
}

export interface CustomerReply {
  bookingId: string
  customerPhone: string
  body: string
  receivedAt: string
}

// ── Pipeline stage definitions ─────────────────────────────────────────────────

export const PIPELINE_STAGES: PipelineStageInfo[] = [
  {
    stage: 'BOOKED',
    label: 'Booked',
    description: 'Appointment confirmed. Your technician is assigned.',
    icon: '📋',
    index: 0,
  },
  {
    stage: 'EN_ROUTE',
    label: 'En Route',
    description: 'Your technician has departed and is on the way.',
    icon: '🚗',
    index: 1,
  },
  {
    stage: 'ARRIVING',
    label: 'Arriving Soon',
    description: 'Your technician is less than 5 minutes away.',
    icon: '📍',
    index: 2,
  },
  {
    stage: 'ON_SITE',
    label: 'On Site',
    description: 'Your technician has arrived and checked in.',
    icon: '🏠',
    index: 3,
  },
  {
    stage: 'IN_PROGRESS',
    label: 'In Progress',
    description: 'Work is actively being performed.',
    icon: '⚡',
    index: 4,
  },
  {
    stage: 'WRAPPING_UP',
    label: 'Wrapping Up',
    description: 'Work is completing. Final checks in progress.',
    icon: '✅',
    index: 5,
  },
  {
    stage: 'COMPLETE',
    label: 'Complete',
    description: 'Job complete. Invoice sent. Thank you!',
    icon: '🎉',
    index: 6,
  },
]

// ── Action → Stage mapping ─────────────────────────────────────────────────────

export const ACTION_STAGE_MAP: Partial<Record<TechAction, PipelineStage>> = {
  MARK_EN_ROUTE: 'EN_ROUTE',
  MARK_ARRIVED: 'ON_SITE',
  MARK_IN_PROGRESS: 'IN_PROGRESS',
  MARK_WRAPPING_UP: 'WRAPPING_UP',
  MARK_COMPLETE: 'COMPLETE',
}

// ── SMS template builders ──────────────────────────────────────────────────────

/**
 * Builds the SMS body for each pipeline stage transition.
 * Placeholders are replaced with booking data before sending.
 */
export function buildSmsBody(
  stage: PipelineStage,
  booking: Pick<BookingRecord, 'techName' | 'customerName' | 'etaMinutes'>,
  extra?: { message?: string; issueFlag?: IssueFlag }
): string {
  const { techName, customerName, etaMinutes } = booking

  switch (stage) {
    case 'BOOKED':
      return `Hi ${customerName}, your appointment with Power On Solutions is confirmed. Technician ${techName} will be at your location as scheduled. Track your job status: poweronsolutionsllc.com/status/[booking-id]`

    case 'EN_ROUTE':
      return etaMinutes
        ? `Hi ${customerName}, your technician ${techName} is on the way! Estimated arrival: ${etaMinutes} minutes. Track live: poweronsolutionsllc.com/status/[booking-id]`
        : `Hi ${customerName}, your technician ${techName} has departed and is en route to your location. We'll notify you when they arrive.`

    case 'ARRIVING':
      return `Your technician ${techName} is arriving in the next 5 minutes. Please be ready to receive them.`

    case 'ON_SITE':
      return `${techName} has arrived at your location and is ready to begin work. Power On Solutions — License #C10.`

    case 'IN_PROGRESS':
      return `Work is underway at your location. ${techName} is on the job. We'll notify you when wrapping up.`

    case 'WRAPPING_UP':
      return `Almost done! ${techName} is completing final checks at your location. Invoice will follow shortly.`

    case 'COMPLETE':
      return `Job complete! Thank you for choosing Power On Solutions. Your invoice has been sent. We'd love your feedback — please take a moment to leave a review. poweronsolutionsllc.com/review`
  }

  if (extra?.issueFlag) {
    const f = extra.issueFlag
    return f.updatedEta
      ? `Hi ${customerName}, ${techName} is running approximately ${f.delayMinutes ?? '15'} minutes behind due to a previous job. Updated ETA: ${f.updatedEta}. We apologize for the inconvenience.`
      : `Hi ${customerName}, quick update from ${techName}: ${f.reason}`
  }

  if (extra?.message) {
    return `Power On Solutions — ${techName}: ${extra.message}`
  }

  return `Update from Power On Solutions regarding your appointment with ${techName}.`
}

// ── Stage utilities ─────────────────────────────────────────────────────────────

export function getStageInfo(stage: PipelineStage): PipelineStageInfo {
  return (
    PIPELINE_STAGES.find((s) => s.stage === stage) ?? PIPELINE_STAGES[0]
  )
}

export function getStageIndex(stage: PipelineStage): number {
  return getStageInfo(stage).index
}

export function isStageComplete(
  currentStage: PipelineStage,
  checkStage: PipelineStage
): boolean {
  return getStageIndex(currentStage) > getStageIndex(checkStage)
}

export function isStageActive(
  currentStage: PipelineStage,
  checkStage: PipelineStage
): boolean {
  return currentStage === checkStage
}

export function canAdvanceToStage(
  currentStage: PipelineStage,
  targetStage: PipelineStage
): boolean {
  const current = getStageIndex(currentStage)
  const target = getStageIndex(targetStage)
  // Allow advancing only one step at a time (or skipping ARRIVING if auto-triggered)
  return target > current && target <= current + 2
}

// ── Booking status URL builder ──────────────────────────────────────────────────

export function buildStatusUrl(bookingId: string): string {
  return `https://poweronsolutionsllc.com/status/${bookingId}`
}

// ── ETA formatting ──────────────────────────────────────────────────────────────

export function formatEta(etaMinutes: number): string {
  if (etaMinutes <= 0) return 'Arriving now'
  if (etaMinutes < 60) return `${etaMinutes} minute${etaMinutes === 1 ? '' : 's'}`
  const hrs = Math.floor(etaMinutes / 60)
  const mins = etaMinutes % 60
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs} hour${hrs === 1 ? '' : 's'}`
}

export function etaToClockTime(etaMinutes: number): string {
  const arrival = new Date(Date.now() + etaMinutes * 60 * 1000)
  return arrival.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

// ── Communication log builder ───────────────────────────────────────────────────

export function buildOutboundEntry(
  bookingId: string,
  body: string,
  channel: MessageChannel = 'sms',
  isIssueFlag = false,
  flagDetails?: IssueFlag
): CommunicationEntry {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    bookingId,
    direction: 'outbound',
    channel,
    body,
    timestamp: new Date().toISOString(),
    smsStatus: 'queued',
    isIssueFlag,
    flagDetails,
  }
}

export function buildInboundEntry(
  reply: CustomerReply
): CommunicationEntry {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    bookingId: reply.bookingId,
    direction: 'inbound',
    channel: 'sms',
    body: reply.body,
    timestamp: reply.receivedAt,
  }
}

// ── Stage transition builder ────────────────────────────────────────────────────

export function buildStageHistoryEntry(
  stage: PipelineStage,
  triggeredBy: 'tech' | 'system' = 'tech',
  note?: string
): StageHistoryEntry {
  return {
    stage,
    timestamp: new Date().toISOString(),
    note,
    triggeredBy,
  }
}

// ── Supabase integration stubs ──────────────────────────────────────────────────
// These stubs wire to Supabase once environment is configured.
// The real implementation is handled by the Netlify function portal-status-update.ts

/**
 * Fetches a booking record from Supabase by bookingId.
 * Public endpoint — no auth required (used by customer status page).
 */
export async function fetchBookingByToken(bookingId: string): Promise<BookingRecord | null> {
  try {
    // Placeholder: wire to Supabase `customer_bookings` table
    // Using anon key read-only — customer can see their own booking via unique token
    const supabaseUrl = typeof window !== 'undefined'
      ? (window as any).__POWERON_SUPABASE_URL
      : null
    const supabaseAnonKey = typeof window !== 'undefined'
      ? (window as any).__POWERON_SUPABASE_ANON_KEY
      : null

    if (!supabaseUrl || !supabaseAnonKey) {
      console.warn('[CustomerTrustPipeline] Supabase not configured — returning null')
      return null
    }

    const res = await fetch(
      `${supabaseUrl}/rest/v1/customer_bookings?booking_token=eq.${bookingId}&select=*`,
      {
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!res.ok) return null
    const rows = await res.json()
    if (!rows || rows.length === 0) return null
    return normalizeBookingRow(rows[0])
  } catch (err) {
    console.error('[CustomerTrustPipeline] fetchBookingByToken error', err)
    return null
  }
}

/**
 * Polls for booking updates every N seconds.
 * Returns a cleanup function to stop polling.
 */
export function pollBookingUpdates(
  bookingId: string,
  onUpdate: (booking: BookingRecord) => void,
  intervalMs = 10000
): () => void {
  let active = true

  const poll = async () => {
    if (!active) return
    const booking = await fetchBookingByToken(bookingId)
    if (booking) onUpdate(booking)
    if (active) setTimeout(poll, intervalMs)
  }

  poll()
  return () => { active = false }
}

// ── Row normalizer ──────────────────────────────────────────────────────────────

function normalizeBookingRow(row: Record<string, unknown>): BookingRecord {
  return {
    id: String(row.id ?? ''),
    bookingId: String(row.booking_token ?? row.id ?? ''),
    customerId: row.customer_id ? String(row.customer_id) : undefined,
    customerName: String(row.customer_name ?? 'Customer'),
    customerPhone: String(row.customer_phone ?? ''),
    customerEmail: row.customer_email ? String(row.customer_email) : undefined,
    address: String(row.address ?? ''),
    scheduledDate: String(row.scheduled_date ?? ''),
    scheduledTime: String(row.scheduled_time ?? ''),
    techName: String(row.tech_name ?? 'Christian'),
    techPhoto: row.tech_photo ? String(row.tech_photo) : undefined,
    techLicense: row.tech_license ? String(row.tech_license) : 'C10-1234567',
    currentStage: (row.current_stage as PipelineStage) ?? 'BOOKED',
    stageHistory: Array.isArray(row.stage_history) ? (row.stage_history as StageHistoryEntry[]) : [],
    communicationLog: Array.isArray(row.communication_log) ? (row.communication_log as CommunicationEntry[]) : [],
    etaMinutes: row.eta_minutes != null ? Number(row.eta_minutes) : undefined,
    etaTimestamp: row.eta_timestamp ? String(row.eta_timestamp) : undefined,
    approximateLocation: row.approximate_location
      ? (row.approximate_location as ApproximateLocation)
      : undefined,
    locationSharingEnabled: Boolean(row.location_sharing_enabled ?? true),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  }
}

// ── Mock data for dev / demo ────────────────────────────────────────────────────

export function buildMockBooking(bookingId = 'demo-001'): BookingRecord {
  const now = new Date()
  return {
    id: bookingId,
    bookingId,
    customerName: 'Maria Gonzalez',
    customerPhone: '+15551234567',
    customerEmail: 'maria@example.com',
    address: '1234 Oak Street, San Jose, CA 95110',
    scheduledDate: now.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }),
    scheduledTime: '10:00 AM – 12:00 PM',
    techName: 'Christian',
    techLicense: 'C10-1234567',
    currentStage: 'EN_ROUTE',
    stageHistory: [
      buildStageHistoryEntry('BOOKED', 'system', 'Booking confirmed'),
      buildStageHistoryEntry('EN_ROUTE', 'tech', 'Tech departed from yard'),
    ],
    communicationLog: [
      {
        id: 'msg-001',
        bookingId,
        direction: 'outbound',
        channel: 'sms',
        body: 'Hi Maria, your appointment with Power On Solutions is confirmed. Technician Christian will be at your location as scheduled.',
        timestamp: new Date(now.getTime() - 86400000).toISOString(),
        smsStatus: 'delivered',
      },
      {
        id: 'msg-002',
        bookingId,
        direction: 'outbound',
        channel: 'sms',
        body: 'Hi Maria, your technician Christian is on the way! Estimated arrival: 25 minutes.',
        timestamp: new Date(now.getTime() - 1800000).toISOString(),
        smsStatus: 'delivered',
      },
    ],
    etaMinutes: 18,
    etaTimestamp: new Date(now.getTime() + 18 * 60 * 1000).toISOString(),
    approximateLocation: {
      neighborhood: 'Willow Glen',
      city: 'San Jose',
      state: 'CA',
    },
    locationSharingEnabled: true,
    createdAt: new Date(now.getTime() - 86400000).toISOString(),
    updatedAt: now.toISOString(),
  }
}

// ── Exports ─────────────────────────────────────────────────────────────────────

export default {
  PIPELINE_STAGES,
  ACTION_STAGE_MAP,
  buildSmsBody,
  buildStatusUrl,
  buildMockBooking,
  buildOutboundEntry,
  buildInboundEntry,
  buildStageHistoryEntry,
  fetchBookingByToken,
  pollBookingUpdates,
  formatEta,
  etaToClockTime,
  getStageInfo,
  getStageIndex,
  isStageComplete,
  isStageActive,
  canAdvanceToStage,
}
