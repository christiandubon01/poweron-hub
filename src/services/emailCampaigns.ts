// @ts-nocheck
/**
 * Email Campaign Service — SPARK automation
 *
 * Generates and manages email campaigns for Power On Solutions LLC.
 * All customer-facing emails go through MiroFish before sending.
 */

import { callClaude, extractText } from './claudeProxy'
import { publish } from './agentEventBus'
import { getBackupData, saveBackupData } from './backupDataService'

// ── Types ──────────────────────────────────────────────────────────────────

export type CampaignEmailType = 'ANNUAL_INSPECTION' | 'SEASONAL' | 'COMMERCIAL_MAINTENANCE' | 'PAST_CLIENT_FOLLOWUP'

export interface EmailCampaign {
  id: string
  type: CampaignEmailType
  name: string
  subject: string
  body: string
  clientList: string[]
  status: 'draft' | 'approved' | 'sent'
  sentCount: number
  openCount: number
  clickCount: number
  createdAt: string
  sentAt?: string
  approvedBy?: string
}

// ── Constants ──────────────────────────────────────────────────────────────

const EMAIL_SYSTEM = `You write professional email campaigns for Power On Solutions LLC, a C-10 electrical contractor in the Coachella Valley, CA.
Tone: professional, helpful, not pushy. Include a clear call to action. Keep emails concise (under 200 words).
Company: Power On Solutions LLC | C-10 #1151468 | Desert Hot Springs, CA | (760) 555-XXXX`

const CAMPAIGN_TYPE_PROMPTS: Record<CampaignEmailType, string> = {
  ANNUAL_INSPECTION: `Write an email offering annual electrical inspection services. Emphasize safety, code compliance, and insurance benefits. Offer a seasonal discount.`,
  SEASONAL: `Write a seasonal email about electrical preparedness. For summer: AC circuits, pool equipment. For winter: heating, holiday lighting safety. Include a helpful tip and service offer.`,
  COMMERCIAL_MAINTENANCE: `Write an email targeting commercial property managers about electrical maintenance programs. Emphasize uptime, code compliance, and preventive maintenance savings.`,
  PAST_CLIENT_FOLLOWUP: `Write a friendly follow-up email to a past client. Thank them for their business, ask how the work is holding up, and mention we're available for any future electrical needs. Include a referral incentive.`,
}

// ── Implementation ─────────────────────────────────────────────────────────

/**
 * Generate a campaign email using Claude AI.
 */
export async function generateCampaign(
  type: CampaignEmailType,
  clientList: string[]
): Promise<{ subject: string; body: string }> {
  const typePrompt = CAMPAIGN_TYPE_PROMPTS[type]

  try {
    const result = await callClaude({
      system: EMAIL_SYSTEM,
      messages: [{
        role: 'user',
        content: `${typePrompt}\n\nGenerate both a subject line and email body. Format:\nSUBJECT: [subject]\nBODY:\n[email body]\n\nTarget audience size: ${clientList.length} clients.`,
      }],
      max_tokens: 500,
    })
    const text = extractText(result)

    // Parse subject and body
    const subjectMatch = text.match(/SUBJECT:\s*(.+)/i)
    const bodyMatch = text.match(/BODY:\s*([\s\S]+)/i)

    return {
      subject: subjectMatch?.[1]?.trim() || `Power On Solutions — ${type.replace(/_/g, ' ')}`,
      body: bodyMatch?.[1]?.trim() || text,
    }
  } catch (err) {
    console.error('[EmailCampaigns] Generation error:', err)
    return { subject: '', body: '' }
  }
}

/**
 * Create and store a campaign.
 */
export function createCampaign(
  type: CampaignEmailType,
  name: string,
  subject: string,
  body: string,
  clientList: string[]
): EmailCampaign {
  const campaign: EmailCampaign = {
    id: `camp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    name,
    subject,
    body,
    clientList,
    status: 'draft',
    sentCount: 0,
    openCount: 0,
    clickCount: 0,
    createdAt: new Date().toISOString(),
  }

  const backup = getBackupData()
  if (backup) {
    const campaigns: EmailCampaign[] = (backup as any).emailCampaigns || []
    campaigns.push(campaign)
    ;(backup as any).emailCampaigns = campaigns
    saveBackupData(backup)
  }

  console.log(`[EmailCampaigns] Campaign "${name}" created (${clientList.length} recipients)`)
  return campaign
}

/**
 * Get all email campaigns.
 */
export function getCampaigns(status?: EmailCampaign['status']): EmailCampaign[] {
  const backup = getBackupData()
  if (!backup) return []

  const campaigns: EmailCampaign[] = (backup as any).emailCampaigns || []
  if (status) return campaigns.filter(c => c.status === status)
  return campaigns.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

/**
 * Send a campaign (after MiroFish approval).
 * In practice this would integrate with an email service.
 * For now, it updates status and publishes event.
 */
export function sendCampaign(campaignId: string): EmailCampaign | null {
  const backup = getBackupData()
  if (!backup) return null

  const campaigns: EmailCampaign[] = (backup as any).emailCampaigns || []
  const idx = campaigns.findIndex(c => c.id === campaignId)
  if (idx === -1) return null

  campaigns[idx] = {
    ...campaigns[idx],
    status: 'sent',
    sentAt: new Date().toISOString(),
    sentCount: campaigns[idx].clientList.length,
  }

  ;(backup as any).emailCampaigns = campaigns
  saveBackupData(backup)

  // Publish campaign result event
  publish(
    'CAMPAIGN_RESULT' as any,
    'spark',
    {
      campaignId,
      channel: 'email',
      type: campaigns[idx].type,
      recipients: campaigns[idx].clientList.length,
      leadsGenerated: 0,
      revenueAttributed: 0,
    },
    `Email campaign "${campaigns[idx].name}" sent to ${campaigns[idx].clientList.length} clients`
  )

  return campaigns[idx]
}
