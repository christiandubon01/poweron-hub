// @ts-nocheck
/**
 * SparkOutreach — Cold Email Generator, Follow-Up Sequencer, Lead Temperature Tracking
 *
 * Generates personalized cold outreach emails from Christian Dubon (Power On Solutions LLC)
 * to leads by type (GC, PM, Homeowner, Solar). Schedules follow-up sequences with due-date
 * notifications and tracks lead temperature (HOT/WARM/COLD/DEAD).
 *
 * Public API:
 *   generateColdEmail(contact)                    — Claude-generated cold email
 *   scheduleFollowUpSequence(contactId, context)  — Create day-3/7/14/30 follow-up chain
 *   getPendingFollowUps()                         — List of due/upcoming follow-ups
 *   updateLeadTemperature(contactId, temp)        — Set HOT/WARM/COLD/DEAD + schedule next touch
 *   markFollowUpSent(followUpId)                  — Acknowledge a follow-up was sent
 *   getLeadOutreachState(contactId)               — Full outreach history for a contact
 *   getDueFollowUps()                             — Follow-ups that are due right now
 */

import { callClaude, extractText } from '../claudeProxy'

// ── Constants ──────────────────────────────────────────────────────────────

const STORAGE_KEY = 'poweron_spark_outreach_v1'

const SENDER = {
  name: 'Christian Dubon',
  company: 'Power On Solutions LLC',
  license: 'C-10 #1151468',
  location: 'Desert Hot Springs, CA',
} as const

// ── Types ──────────────────────────────────────────────────────────────────

export type LeadType = 'GC' | 'PM' | 'homeowner' | 'solar'

export type LeadTemperature = 'HOT' | 'WARM' | 'COLD' | 'DEAD'

export type FollowUpStage = 'day3' | 'day7' | 'day14' | 'day30'

export interface OutreachContact {
  id: string
  name: string
  company: string
  role: string
  leadType: LeadType
  email?: string
  phone?: string
  notes?: string
}

export interface GeneratedEmail {
  subject: string
  body: string
  generatedAt: string
  contactId: string
  leadType: LeadType
}

export interface FollowUp {
  id: string
  contactId: string
  contactName: string
  company: string
  stage: FollowUpStage
  dueDate: string          // ISO date string
  subject: string
  body: string
  sent: boolean
  sentAt?: string
  conversationContext?: string
  createdAt: string
}

export interface LeadOutreachState {
  contactId: string
  temperature: LeadTemperature
  lastContactedAt?: string
  nextFollowUpDate?: string
  initialEmail?: GeneratedEmail
  followUps: FollowUp[]
  reEngageAfter?: string   // ISO date — for DEAD leads re-engage at 90 days
  createdAt: string
  updatedAt: string
}

// ── Temperature-to-follow-up-interval map ─────────────────────────────────

const TEMPERATURE_INTERVALS: Record<LeadTemperature, number> = {
  HOT: 1,    // 24 hours → 1 day
  WARM: 3,   // 3 days
  COLD: 7,   // 7 days
  DEAD: 90,  // 90-day re-engage
}

// ── Follow-up stage offsets (days from initial contact) ───────────────────

const FOLLOW_UP_OFFSETS: Record<FollowUpStage, number> = {
  day3: 3,
  day7: 7,
  day14: 14,
  day30: 30,
}

// ── Lead-type system prompts ───────────────────────────────────────────────

const LEAD_TYPE_CONTEXT: Record<LeadType, string> = {
  GC: `This is a General Contractor (GC). Lead with a partnership angle — emphasize reliability, quality rough-in work, 24/7 availability, and the ability to show up consistently on their projects. GCs value subcontractors who don't create problems.`,
  PM: `This is a Property Manager (PM). Lead with maintenance expertise, fast emergency service response, and the ability to handle multiple properties. Property managers value vendors who reduce their headaches and can offer volume-based service agreements.`,
  homeowner: `This is a homeowner. Lead with safety, code compliance, and the value of having a licensed local electrician. Homeowners respond to trust, proximity, and straightforward honest communication.`,
  solar: `This is a solar industry contact. Lead with our C-10 electrical certification, solar installation experience, and a partnership model. Solar companies need reliable electrical subcontractors for interconnections, battery systems, and panel upgrades.`,
}

// ── Core prompt builder ────────────────────────────────────────────────────

function buildColdEmailPrompt(contact: OutreachContact): string {
  const typeContext = LEAD_TYPE_CONTEXT[contact.leadType]

  return `Write a cold email from ${SENDER.name}, ${SENDER.license} licensed electrical contractor at ${SENDER.company}, to ${contact.name} at ${contact.company}.

${contact.role ? `Their role is: ${contact.role}.` : ''}

${typeContext}

Tone: professional but warm, not salesy. Short — under 100 words.

Requirements:
- Include ONE specific value proposition tailored to their business type (${contact.leadType})
- Include ONE social proof element (license number ${SENDER.license}, experience, or a past project result)
- Include ONE clear call to action (phone call or site visit)
- Do NOT mention pricing
- Do NOT offer free work
- Sign off as ${SENDER.name}, ${SENDER.company}

Return a JSON object with exactly this shape:
{
  "subject": "Email subject line",
  "body": "Full email body text"
}`
}

function buildFollowUpPrompt(
  contact: OutreachContact,
  stage: FollowUpStage,
  conversationContext?: string,
): string {
  const stageInstructions: Record<FollowUpStage, string> = {
    day3: `This is a Day 3 follow-up after the initial cold email. Start with "Following up on my previous message..." Keep it brief (under 80 words). Reinforce the main value prop. Ask if they have 10 minutes for a call.`,
    day7: `This is a Day 7 value-add follow-up. Don't pitch directly. Share one genuinely useful tip or observation relevant to their business type (${contact.leadType}). Position yourself as a knowledgeable resource. Soft close — mention you're available if they have any electrical needs.`,
    day14: `This is a Day 14 direct ask. Be straightforward. You've reached out twice. Ask directly for a 15-minute meeting or site visit to show what you bring to the table. Acknowledge their time is valuable.`,
    day30: `This is the Day 30 final reach. Acknowledge this is your last outreach for now. Keep it gracious, not desperate. Leave the door open. Short — under 60 words.`,
  }

  const contextSection = conversationContext
    ? `\nConversation context / notes:\n${conversationContext}\n`
    : ''

  return `Write a follow-up email from ${SENDER.name} at ${SENDER.company} to ${contact.name} at ${contact.company}.

${stageInstructions[stage]}
${contextSection}
Tone: professional but warm. Never repeat the exact same message from before.

Return a JSON object with exactly this shape:
{
  "subject": "Email subject line",
  "body": "Full email body text"
}`
}

// ── Local storage helpers ──────────────────────────────────────────────────

function loadOutreachStore(): Record<string, LeadOutreachState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveOutreachStore(store: Record<string, LeadOutreachState>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch (e) {
    console.error('[SparkOutreach] Failed to save outreach store:', e)
  }
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function addDays(date: Date, days: number): string {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

// ── Claude helper ──────────────────────────────────────────────────────────

async function generateEmailFromClaude(
  prompt: string,
): Promise<{ subject: string; body: string }> {
  try {
    const raw = await callClaude(prompt, 'SPARK')
    const text = extractText(raw)

    // Try JSON parse from the response text
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      if (parsed.subject && parsed.body) {
        return { subject: parsed.subject, body: parsed.body }
      }
    }

    // Fallback: treat entire response as body
    return {
      subject: `Following up — Power On Solutions LLC`,
      body: text.trim(),
    }
  } catch (e) {
    console.error('[SparkOutreach] Claude generation error:', e)
    return {
      subject: `Power On Solutions LLC — C-10 Licensed Electrician`,
      body: `Hi,\n\nI wanted to reach out to introduce myself. I'm Christian Dubon, owner of Power On Solutions LLC, a licensed C-10 electrical contractor based in Desert Hot Springs, CA.\n\nI'd love to connect and see if there's a fit. Would you be available for a quick call this week?\n\nBest,\nChristian Dubon\nPower On Solutions LLC | C-10 #1151468`,
    }
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Generate a Claude-personalized cold email for a contact.
 * Saves the generated email to the outreach store.
 */
export async function generateColdEmail(contact: OutreachContact): Promise<GeneratedEmail> {
  const prompt = buildColdEmailPrompt(contact)
  const { subject, body } = await generateEmailFromClaude(prompt)

  const email: GeneratedEmail = {
    subject,
    body,
    generatedAt: new Date().toISOString(),
    contactId: contact.id,
    leadType: contact.leadType,
  }

  // Persist to outreach store
  const store = loadOutreachStore()
  if (!store[contact.id]) {
    store[contact.id] = {
      contactId: contact.id,
      temperature: 'COLD',
      followUps: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }
  store[contact.id].initialEmail = email
  store[contact.id].updatedAt = new Date().toISOString()
  saveOutreachStore(store)

  return email
}

/**
 * Schedule the full day-3 / day-7 / day-14 / day-30 follow-up sequence.
 * Generates Claude drafts for each stage using conversation context.
 */
export async function scheduleFollowUpSequence(
  contact: OutreachContact,
  conversationContext?: string,
): Promise<FollowUp[]> {
  const stages: FollowUpStage[] = ['day3', 'day7', 'day14', 'day30']
  const baseDate = new Date()
  const followUps: FollowUp[] = []

  for (const stage of stages) {
    const prompt = buildFollowUpPrompt(contact, stage, conversationContext)
    const { subject, body } = await generateEmailFromClaude(prompt)

    const followUp: FollowUp = {
      id: uid(),
      contactId: contact.id,
      contactName: contact.name,
      company: contact.company,
      stage,
      dueDate: addDays(baseDate, FOLLOW_UP_OFFSETS[stage]),
      subject,
      body,
      sent: false,
      conversationContext,
      createdAt: new Date().toISOString(),
    }
    followUps.push(followUp)
  }

  // Persist
  const store = loadOutreachStore()
  if (!store[contact.id]) {
    store[contact.id] = {
      contactId: contact.id,
      temperature: 'COLD',
      followUps: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }

  // Merge: keep existing sent follow-ups, replace unsent ones for same stage
  const existingFollowUps = store[contact.id].followUps.filter(f => f.sent)
  store[contact.id].followUps = [...existingFollowUps, ...followUps]
  store[contact.id].lastContactedAt = new Date().toISOString()
  store[contact.id].nextFollowUpDate = followUps[0]?.dueDate
  store[contact.id].updatedAt = new Date().toISOString()
  saveOutreachStore(store)

  return followUps
}

/**
 * Returns all pending (unsent) follow-ups across all contacts, sorted by due date.
 */
export function getPendingFollowUps(): FollowUp[] {
  const store = loadOutreachStore()
  const pending: FollowUp[] = []

  for (const state of Object.values(store)) {
    for (const fu of state.followUps) {
      if (!fu.sent) {
        pending.push(fu)
      }
    }
  }

  return pending.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}

/**
 * Returns follow-ups whose due date is today or in the past and not yet sent.
 */
export function getDueFollowUps(): FollowUp[] {
  const today = new Date().toISOString().split('T')[0]
  return getPendingFollowUps().filter(fu => fu.dueDate <= today)
}

/**
 * Update lead temperature and auto-schedule next touch based on interval.
 */
export function updateLeadTemperature(
  contactId: string,
  temperature: LeadTemperature,
): LeadOutreachState | null {
  const store = loadOutreachStore()
  if (!store[contactId]) return null

  const state = store[contactId]
  state.temperature = temperature
  state.updatedAt = new Date().toISOString()

  const daysUntilNext = TEMPERATURE_INTERVALS[temperature]

  if (temperature === 'DEAD') {
    state.reEngageAfter = addDays(new Date(), 90)
    state.nextFollowUpDate = state.reEngageAfter
  } else {
    state.nextFollowUpDate = addDays(new Date(), daysUntilNext)
  }

  store[contactId] = state
  saveOutreachStore(store)
  return state
}

/**
 * Mark a follow-up as sent.
 */
export function markFollowUpSent(followUpId: string): boolean {
  const store = loadOutreachStore()
  let found = false

  for (const state of Object.values(store)) {
    const fu = state.followUps.find(f => f.id === followUpId)
    if (fu) {
      fu.sent = true
      fu.sentAt = new Date().toISOString()
      state.lastContactedAt = fu.sentAt
      state.updatedAt = fu.sentAt
      found = true
      break
    }
  }

  if (found) saveOutreachStore(store)
  return found
}

/**
 * Get full outreach history for a contact.
 */
export function getLeadOutreachState(contactId: string): LeadOutreachState | null {
  const store = loadOutreachStore()
  return store[contactId] ?? null
}

/**
 * Get all lead outreach states.
 */
export function getAllLeadOutreachStates(): LeadOutreachState[] {
  const store = loadOutreachStore()
  return Object.values(store).sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  )
}

/**
 * Check for due follow-ups and return notification-ready list.
 * Intended to be called on app load or on a timer.
 */
export function checkFollowUpNotifications(): {
  dueCount: number
  dueFollowUps: FollowUp[]
  message: string
} {
  const dueFollowUps = getDueFollowUps()
  const dueCount = dueFollowUps.length

  const message =
    dueCount === 0
      ? 'No follow-ups due today.'
      : dueCount === 1
      ? `1 follow-up is due: ${dueFollowUps[0].contactName} at ${dueFollowUps[0].company}`
      : `${dueCount} follow-ups are due today.`

  return { dueCount, dueFollowUps, message }
}

/**
 * Get the mailto: href string to open the native email client pre-filled.
 */
export function buildMailtoLink(email: GeneratedEmail | FollowUp, toEmail: string): string {
  const subject = encodeURIComponent(
    'subject' in email ? email.subject : (email as FollowUp).subject,
  )
  const body = encodeURIComponent(
    'body' in email ? (email as GeneratedEmail).body : (email as FollowUp).body,
  )
  return `mailto:${encodeURIComponent(toEmail)}?subject=${subject}&body=${body}`
}
