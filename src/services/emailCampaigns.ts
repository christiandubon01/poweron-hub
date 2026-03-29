// @ts-nocheck
/**
 * Email Campaign Engine — Powered by Resend API
 *
 * Campaign types:
 * - ANNUAL_INSPECTION: "Time for your annual panel inspection..."
 * - SEASONAL_HVAC: Spring/Fall HVAC prep outreach
 * - COMMERCIAL_MAINTENANCE: Commercial client maintenance contracts
 * - PAST_CLIENT_FOLLOWUP: Check-in with clients from 6+ months ago
 *
 * SPARK generates personalized email content using Claude.
 * All campaigns go through MiroFish before sending.
 * Tracks: sent, opened, clicked, converted.
 * Stores campaign records in backup.campaigns.
 * Uses existing RESEND environment variable if available.
 */

import { publish } from './agentEventBus'
import { submitProposal, runAutomatedReview } from './miroFish'

// ── Types ───────────────────────────────────────────────────────────────────

export type EmailCampaignType =
  | 'annual_inspection'
  | 'seasonal_hvac'
  | 'commercial_maintenance'
  | 'past_client_followup'

export interface EmailRecipient {
  email: string
  name: string
  clientId?: string
  lastServiceDate?: string
  metadata?: Record<string, unknown>
}

export interface EmailCampaign {
  id: string
  name: string
  campaignType: EmailCampaignType
  subject: string
  body: string            // HTML email body
  recipients: EmailRecipient[]
  status: 'draft' | 'pending_approval' | 'approved' | 'sending' | 'sent' | 'failed'
  mirofishProposalId?: string
  metrics: EmailCampaignMetrics
  createdAt: string
  sentAt?: string
}

export interface EmailCampaignMetrics {
  sent: number
  opened: number
  clicked: number
  converted: number
  bounced: number
  openRate: number
  clickRate: number
}

// ── State ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'poweron_email_campaigns'

function loadCampaigns(): EmailCampaign[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveCampaigns(campaigns: EmailCampaign[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(campaigns))
  } catch {
    // silently continue
  }
}

// ── Resend API ──────────────────────────────────────────────────────────────

function getResendApiKey(): string {
  // Check multiple env variable names
  return (
    (import.meta.env.VITE_RESEND_API_KEY as string) ||
    (import.meta.env.RESEND as string) ||
    ''
  )
}

/**
 * Check if Resend is configured
 */
export function isResendConfigured(): boolean {
  return !!getResendApiKey()
}

/**
 * Send an email via Resend API
 */
async function sendViaResend(to: string, subject: string, html: string): Promise<{
  success: boolean
  messageId?: string
  error?: string
}> {
  const apiKey = getResendApiKey()
  if (!apiKey) {
    return { success: false, error: 'Resend API key not configured' }
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Power On Solutions <noreply@poweronsolutions.com>',
        to,
        subject,
        html,
      }),
    })

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}))
      return { success: false, error: errData.message || `HTTP ${response.status}` }
    }

    const data = await response.json()
    return { success: true, messageId: data.id }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// ── Campaign Content Generation ─────────────────────────────────────────────

const EMAIL_SYSTEM_PROMPT = `You are SPARK, the marketing agent for Power On Solutions LLC — a C-10 licensed electrical contractor in Desert Hot Springs, CA serving the Coachella Valley.

Generate professional HTML email content with these rules:
- Warm, professional tone — not salesy
- Include a clear call-to-action (schedule inspection, call us, reply)
- Personalize with the recipient's name when provided
- Keep email body concise (under 200 words)
- Use inline CSS for basic formatting (no external stylesheets)
- Include Power On Solutions branding naturally
- Never include placeholder text — use real content`

const CAMPAIGN_TEMPLATES: Record<EmailCampaignType, { subject: string; prompt: string }> = {
  annual_inspection: {
    subject: 'Time for Your Annual Electrical Panel Inspection',
    prompt: `Write an email reminding a past client that it's time for their annual electrical panel inspection. Mention safety benefits, code compliance, and that Power On Solutions offers a comprehensive inspection. Include a scheduling CTA.`,
  },
  seasonal_hvac: {
    subject: 'Prepare Your Electrical Systems for the Season',
    prompt: `Write a seasonal HVAC prep outreach email. It's {season} — remind clients to check their electrical systems, breakers, and HVAC connections. Mention energy savings and safety. Include a scheduling CTA.`,
  },
  commercial_maintenance: {
    subject: 'Commercial Electrical Maintenance — Protect Your Business',
    prompt: `Write an email about commercial electrical maintenance contracts. Highlight preventive maintenance benefits, reduced downtime, code compliance, and priority service. Target commercial property managers and business owners.`,
  },
  past_client_followup: {
    subject: 'Checking In — How Is Everything Running?',
    prompt: `Write a friendly check-in email to a past client from 6+ months ago. Ask how their electrical systems are performing, mention any new services Power On Solutions offers, and invite them to reach out for any needs.`,
  },
}

/**
 * Generate email content for a campaign using Claude.
 */
export async function generateEmailContent(
  campaignType: EmailCampaignType,
  recipientName?: string
): Promise<{ subject: string; body: string }> {
  const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string
  const template = CAMPAIGN_TEMPLATES[campaignType]

  const season = getCurrentSeason()
  let prompt = template.prompt.replace('{season}', season)
  if (recipientName) {
    prompt += `\n\nPersonalize for recipient: ${recipientName}`
  }

  const response = await fetch('/api/anthropic/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: EMAIL_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!response.ok) throw new Error(`Claude API error: ${response.statusText}`)

  const result = (await response.json()) as { content?: Array<{ type: string; text: string }> }
  const body = result.content?.find(c => c.type === 'text')?.text ?? ''

  return { subject: template.subject, body }
}

// ── Campaign CRUD ───────────────────────────────────────────────────────────

/**
 * Create a new email campaign.
 */
export async function createEmailCampaign(
  orgId: string,
  name: string,
  campaignType: EmailCampaignType,
  recipients: EmailRecipient[],
  subject: string,
  body: string
): Promise<EmailCampaign> {
  const campaignId = `ec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  const campaign: EmailCampaign = {
    id: campaignId,
    name,
    campaignType,
    subject,
    body,
    recipients,
    status: 'draft',
    metrics: { sent: 0, opened: 0, clicked: 0, converted: 0, bounced: 0, openRate: 0, clickRate: 0 },
    createdAt: new Date().toISOString(),
  }

  const campaigns = loadCampaigns()
  campaigns.push(campaign)
  saveCampaigns(campaigns)

  return campaign
}

/**
 * Submit a campaign for MiroFish approval.
 */
export async function submitCampaignForApproval(
  campaignId: string,
  orgId: string
): Promise<string> {
  const campaigns = loadCampaigns()
  const campaign = campaigns.find(c => c.id === campaignId)
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`)

  // Submit through MiroFish
  const proposal = await submitProposal({
    orgId,
    proposingAgent: 'spark',
    title: `Send email campaign: ${campaign.name}`,
    description: `${campaign.campaignType} campaign to ${campaign.recipients.length} recipients. Subject: "${campaign.subject}"`,
    category: 'operations',
    impactLevel: 'high',
    actionType: 'send_email_campaign',
    actionPayload: {
      campaignId,
      campaignType: campaign.campaignType,
      recipientCount: campaign.recipients.length,
      subject: campaign.subject,
    },
  })

  // Update campaign status
  campaign.status = 'pending_approval'
  campaign.mirofishProposalId = proposal.id
  saveCampaigns(campaigns)

  // Run automated review
  await runAutomatedReview(proposal.id!)

  return proposal.id!
}

/**
 * Send an approved campaign via Resend.
 */
export async function sendCampaign(campaignId: string): Promise<{
  sent: number
  failed: number
}> {
  const campaigns = loadCampaigns()
  const campaign = campaigns.find(c => c.id === campaignId)
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`)

  if (campaign.status !== 'approved') {
    throw new Error(`Campaign must be approved before sending (current: ${campaign.status})`)
  }

  campaign.status = 'sending'
  saveCampaigns(campaigns)

  let sent = 0
  let failed = 0

  for (const recipient of campaign.recipients) {
    // Personalize subject with name
    const personalizedSubject = campaign.subject
    const personalizedBody = campaign.body.replace(/\{name\}/g, recipient.name || 'Valued Customer')

    const result = await sendViaResend(recipient.email, personalizedSubject, personalizedBody)
    if (result.success) {
      sent++
    } else {
      failed++
      console.warn(`[EmailCampaign] Failed to send to ${recipient.email}:`, result.error)
    }
  }

  // Update metrics
  campaign.metrics.sent = sent
  campaign.metrics.bounced = failed
  campaign.status = failed === campaign.recipients.length ? 'failed' : 'sent'
  campaign.sentAt = new Date().toISOString()
  saveCampaigns(campaigns)

  // Publish campaign result event
  publish(
    'CAMPAIGN_RESULT' as any,
    'spark',
    {
      campaignId,
      campaignType: campaign.campaignType,
      channel: 'email',
      sent,
      failed,
      recipientCount: campaign.recipients.length,
    },
    `Email campaign "${campaign.name}" sent to ${sent}/${campaign.recipients.length} recipients`
  )

  return { sent, failed }
}

// ── Campaign Queries ────────────────────────────────────────────────────────

/**
 * Get all email campaigns.
 */
export function getEmailCampaigns(): EmailCampaign[] {
  return loadCampaigns().sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
}

/**
 * Get a single campaign by ID.
 */
export function getEmailCampaign(campaignId: string): EmailCampaign | null {
  return loadCampaigns().find(c => c.id === campaignId) || null
}

/**
 * Update campaign metrics (e.g., after tracking opens/clicks).
 */
export function updateCampaignMetrics(
  campaignId: string,
  updates: Partial<EmailCampaignMetrics>
): void {
  const campaigns = loadCampaigns()
  const campaign = campaigns.find(c => c.id === campaignId)
  if (!campaign) return

  Object.assign(campaign.metrics, updates)

  // Recalculate rates
  if (campaign.metrics.sent > 0) {
    campaign.metrics.openRate = parseFloat(
      ((campaign.metrics.opened / campaign.metrics.sent) * 100).toFixed(1)
    )
    campaign.metrics.clickRate = parseFloat(
      ((campaign.metrics.clicked / campaign.metrics.sent) * 100).toFixed(1)
    )
  }

  saveCampaigns(campaigns)
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getCurrentSeason(): string {
  const month = new Date().getMonth()
  if (month >= 2 && month <= 4) return 'Spring'
  if (month >= 5 && month <= 7) return 'Summer'
  if (month >= 8 && month <= 10) return 'Fall'
  return 'Winter'
}
