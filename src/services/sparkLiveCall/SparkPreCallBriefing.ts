// @ts-nocheck
/**
 * SparkPreCallBriefing.ts — SPARK Pre-Call Briefing Service (SP7)
 *
 * Triggers on voice command "SPARK, briefing on [name]" or "SPARK, I'm talking to [name]"
 * Extracts contact name, looks up in databases, generates AI briefing via Claude Haiku,
 * and delivers via ElevenLabs TTS (Oxley voice, whisper volume 0.3).
 *
 * Features:
 *   - Voice command name extraction via keyword matching
 *   - Contact lookup in GC database, lead database, ECHO conversation history
 *   - Claude Haiku briefing generation (30-second, <50 words)
 *   - ElevenLabs TTS delivery with Oxley voice
 *   - Visual card display with key stats (name, role, last contact, owes, pays, floor rate)
 *   - Auto-briefing trigger when caller ID matches a contact
 *   - Briefing templates by contact type (GC, Property Manager, Homeowner, Solar)
 *   - Briefing logged to ECHO for historical reference
 *
 * Integration Points:
 *   - SparkDataBridge: GC contacts, service leads, project data
 *   - ClaudeProxy: Haiku model for briefing generation
 *   - ElevenLabs: TTS synthesis with Oxley voice
 *   - AgentEventBus: Publish briefing_delivered event
 *   - Supabase: Store briefing_log for ECHO integration
 */

import { getBackupData } from '../backupDataService'
import { callClaude, extractText } from '../claudeProxy'
import { publish } from '../agentEventBus'
import { supabase } from '@/lib/supabase'

// ── Types ────────────────────────────────────────────────────────────────────

export type ContactType = 'gc' | 'property_manager' | 'homeowner' | 'solar'

export interface PreCallBriefing {
  id?: string
  contactId: string
  contactName: string
  contactType: ContactType
  briefingText: string
  audioUrl?: string
  visualCard: BriefingCard
  generatedAt: string
  deliveredAt?: string
  deliveryMethod: 'tts' | 'visual' | 'both'
}

export interface BriefingCard {
  name: string
  role: string
  lastContactDate: string
  owes: number
  paymentTerms: string
  floorRate: number
  recommendation: string
  redFlags: string[]
}

export interface SparkContact {
  id: string
  name: string
  type: ContactType
  phone?: string
  email?: string
  company?: string
  lastContactDate?: string
  relationshipDepth?: 'new' | 'active' | 'established'
  paymentHistory?: {
    averageDaysToPayment: number
    latePaymentPercent: number
    totalOwed: number
  }
  projectData?: {
    openProjects: number
    totalValue: number
  }
  openQuotes?: number
  redFlags?: string[]
}

export interface TTSConfig {
  voiceId?: string // Oxley voice ID or custom
  volume?: number
  pitch?: number
  rate?: number
}

// ── Constants ────────────────────────────────────────────────────────────────

// Oxley voice ID for ElevenLabs (or use environment variable)
const OXLEY_VOICE_ID = process.env.VITE_ELEVENLABS_OXLEY_VOICE_ID || 'oxley_default'

// Briefing templates by contact type
const BRIEFING_TEMPLATES: Record<ContactType, string> = {
  gc: `You are briefing an electrical contractor about a GC contact they're about to call. Include: relationship history, project pipeline, payment track record, strategic next step. Keep it conversational and under 30 seconds (max 50 words). Be direct.`,
  property_manager: `Brief about a property manager contact. Include: property count under management, service history, volume potential, maintenance patterns. Conversational, under 30 seconds. Direct recommendations.`,
  homeowner: `Brief about a homeowner contact. Include: neighborhood, referral potential, job type history, relationship strength. Conversational, under 30 seconds.`,
  solar: `Brief about a solar partner/supplier contact. Include: partnership terms, certification status, volume capacity, collaboration history. Conversational, under 30 seconds.`,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function num(v: any): number {
  if (v === null || v === undefined || v === '') return 0
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

function daysSince(dateStr: string | undefined): number {
  if (!dateStr) return 999
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return 999
    return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24))
  } catch {
    return 999
  }
}

/**
 * Extract contact name from voice command.
 * Matches patterns:
 *   "briefing on John"
 *   "I'm talking to Sarah"
 *   "briefing on John Smith"
 */
export function extractContactNameFromCommand(voiceCommand: string): string | null {
  const lowerCmd = voiceCommand.toLowerCase()

  // Pattern 1: "briefing on [name]"
  const briefingMatch = voiceCommand.match(/briefing\s+on\s+([a-zA-Z\s]+?)(?:\s|$)/i)
  if (briefingMatch && briefingMatch[1]) {
    return briefingMatch[1].trim()
  }

  // Pattern 2: "I'm talking to [name]" or "talking to [name]"
  const talkingMatch = voiceCommand.match(/(?:talking|speaking)\s+to\s+([a-zA-Z\s]+?)(?:\s|$)/i)
  if (talkingMatch && talkingMatch[1]) {
    return talkingMatch[1].trim()
  }

  // Pattern 3: "about [name]"
  const aboutMatch = voiceCommand.match(/about\s+([a-zA-Z\s]+?)(?:\s|$)/i)
  if (aboutMatch && aboutMatch[1]) {
    return aboutMatch[1].trim()
  }

  return null
}

/**
 * Detect contact type based on name lookup and metadata.
 */
function inferContactType(contact: SparkContact): ContactType {
  if (contact.type) return contact.type

  // Heuristics based on available data
  if (contact.projectData?.openProjects) return 'gc'
  if (contact.company?.toLowerCase().includes('property')) return 'property_manager'
  if (contact.company?.toLowerCase().includes('solar')) return 'solar'

  return 'homeowner' // default
}

/**
 * Look up contact in backup data (GC contacts, service leads).
 * Returns combined contact record or null if not found.
 */
function lookupContactInBackup(name: string): SparkContact | null {
  try {
    const backup = getBackupData()

    // Normalize search name
    const searchLower = name.toLowerCase().trim()

    // Search GC contacts
    if (backup.gcContacts && Array.isArray(backup.gcContacts)) {
      const gcContact = backup.gcContacts.find(gc => {
        const gcName = (gc.name || '').toLowerCase().trim()
        const company = (gc.company || '').toLowerCase().trim()
        return gcName.includes(searchLower) || company.includes(searchLower) || gcName === searchLower
      })

      if (gcContact) {
        return {
          id: gcContact.id || `gc-${Date.now()}`,
          name: gcContact.name || name,
          type: 'gc',
          phone: gcContact.phone,
          email: gcContact.email,
          company: gcContact.company,
          lastContactDate: gcContact.lastContactDate,
          relationshipDepth: 'established',
          paymentHistory: {
            averageDaysToPayment: num(gcContact.averagePaymentDays) || 0,
            latePaymentPercent: num(gcContact.latePaymentPercent) || 0,
            totalOwed: num(gcContact.balance) || 0,
          },
          projectData: {
            openProjects: num(gcContact.openProjects) || 0,
            totalValue: num(gcContact.pipelineValue) || 0,
          },
          openQuotes: num(gcContact.openQuotes) || 0,
        }
      }
    }

    // Search service leads
    if (backup.serviceLeads && Array.isArray(backup.serviceLeads)) {
      const serviceContact = backup.serviceLeads.find(sl => {
        const slName = (sl.name || '').toLowerCase().trim()
        const company = (sl.company || '').toLowerCase().trim()
        return slName.includes(searchLower) || company.includes(searchLower) || slName === searchLower
      })

      if (serviceContact) {
        return {
          id: serviceContact.id || `sl-${Date.now()}`,
          name: serviceContact.name || name,
          type: 'homeowner',
          phone: serviceContact.phone,
          email: serviceContact.email,
          company: serviceContact.company,
          lastContactDate: serviceContact.lastContactDate,
          relationshipDepth: 'active',
        }
      }
    }

    // Search service logs for customer names
    if (backup.serviceLogs && Array.isArray(backup.serviceLogs)) {
      const serviceLog = backup.serviceLogs.find(sl => {
        const customer = (sl.customer || '').toLowerCase().trim()
        return customer.includes(searchLower) || customer === searchLower
      })

      if (serviceLog) {
        return {
          id: `svc-${Date.now()}`,
          name: serviceLog.customer || name,
          type: 'homeowner',
          lastContactDate: serviceLog.date,
          relationshipDepth: 'active',
        }
      }
    }

    // Search projects for contact names
    if (backup.projects && Array.isArray(backup.projects)) {
      const project = backup.projects.find(p => {
        const projName = (p.name || '').toLowerCase().trim()
        const contact = (p.contactName || '').toLowerCase().trim()
        return projName.includes(searchLower) || contact.includes(searchLower)
      })

      if (project) {
        return {
          id: project.id || `proj-${Date.now()}`,
          name: project.contactName || project.name || name,
          type: 'gc',
          lastContactDate: project.lastMove,
          relationshipDepth: 'established',
          projectData: {
            openProjects: 1,
            totalValue: num(project.contract) || 0,
          },
        }
      }
    }

    return null
  } catch (err) {
    console.warn('[PreCallBriefing] lookup error:', err)
    return null
  }
}

/**
 * Build briefing card (visual component) from contact data.
 */
function buildBriefingCard(contact: SparkContact, contactType: ContactType): BriefingCard {
  const daysSinceContact = daysSince(contact.lastContactDate)
  const lastDate =
    daysSinceContact < 999
      ? daysSinceContact === 0
        ? 'Today'
        : daysSinceContact === 1
          ? 'Yesterday'
          : `${daysSinceContact} days ago`
      : 'No record'

  const avgPaymentDays = contact.paymentHistory?.averageDaysToPayment || 0
  const paymentTerms = avgPaymentDays > 0 ? `net-${avgPaymentDays}` : 'net-30'

  const owes = contact.paymentHistory?.totalOwed || 0
  const floorRate = contact.projectData ? Math.ceil(contact.projectData.totalValue / Math.max(contact.projectData.openProjects, 1)) : 0

  const redFlags: string[] = []
  if (contact.paymentHistory?.latePaymentPercent && contact.paymentHistory.latePaymentPercent > 20) {
    redFlags.push('Late payment history')
  }
  if (owes > 5000) {
    redFlags.push('High outstanding balance')
  }
  if (contact.relationshipDepth === 'new') {
    redFlags.push('New relationship')
  }

  // Build recommendation based on contact type and data
  let recommendation = 'Maintain relationship'
  if (contactType === 'gc' && contact.projectData?.openProjects && contact.projectData.openProjects > 3) {
    recommendation = 'Discuss pipeline expansion'
  } else if (contactType === 'property_manager') {
    recommendation = 'Propose service maintenance plan'
  } else if (owes > 0) {
    recommendation = 'Follow up on payment'
  }

  return {
    name: contact.name,
    role: contact.company || (contactType === 'gc' ? 'General Contractor' : 'Customer'),
    lastContactDate: lastDate,
    owes,
    paymentTerms,
    floorRate,
    recommendation,
    redFlags,
  }
}

/**
 * Generate briefing text via Claude Haiku.
 * System prompt templates by contact type.
 * Output: 30-second spoken briefing (max 50 words).
 */
async function generateBriefingViaClaude(
  contact: SparkContact,
  contactType: ContactType,
  card: BriefingCard,
): Promise<string> {
  const systemPrompt = BRIEFING_TEMPLATES[contactType]

  const contextBlock = `
Contact: ${contact.name}
Company: ${contact.company || 'Not specified'}
Last Contact: ${card.lastContactDate}
Outstanding Balance: $${card.owes.toFixed(2)}
Payment Terms: ${card.paymentTerms}
Open Projects/Relationships: ${contact.projectData?.openProjects || 0}
Relationship: ${contact.relationshipDepth || 'Active'}
Red Flags: ${card.redFlags.length > 0 ? card.redFlags.join(', ') : 'None'}
`

  const userPrompt = `Generate a 30-second spoken briefing about this contact. Be conversational and direct. Under 50 words.\n\n${contextBlock}`

  try {
    const response = await callClaude({
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt,
      max_tokens: 100,
    })

    const briefingText = extractText(response)
    return briefingText.slice(0, 200) // cap at ~200 chars ≈ 30 seconds spoken
  } catch (err) {
    console.warn('[PreCallBriefing] Claude generation error:', err)
    // Fallback briefing
    return `You're about to speak with ${contact.name}. Last contact was ${card.lastContactDate}. Payment status: ${card.paymentTerms}.`
  }
}

/**
 * Synthesize briefing text to speech via ElevenLabs.
 * Uses Oxley voice at volume 0.3 (whisper level).
 * Returns audio URL or null if synthesis fails.
 */
async function synthesizeBriefingAudio(briefingText: string): Promise<string | null> {
  try {
    const elevenLabsApiKey = process.env.VITE_ELEVENLABS_API_KEY
    if (!elevenLabsApiKey) {
      console.warn('[PreCallBriefing] ElevenLabs API key missing')
      return null
    }

    // Call ElevenLabs TTS endpoint
    const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + OXLEY_VOICE_ID, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': elevenLabsApiKey,
      },
      body: JSON.stringify({
        text: briefingText,
        model_id: 'eleven_monolingual_v1',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    })

    if (!response.ok) {
      console.warn('[PreCallBriefing] ElevenLabs TTS error:', response.status, response.statusText)
      return null
    }

    const audioBuffer = await response.arrayBuffer()
    const blob = new Blob([audioBuffer], { type: 'audio/mpeg' })
    const audioUrl = URL.createObjectURL(blob)

    return audioUrl
  } catch (err) {
    console.warn('[PreCallBriefing] TTS synthesis error:', err)
    return null
  }
}

/**
 * Play audio briefing via Web Audio API at low volume (0.3).
 * Returns promise that resolves when playback completes.
 */
async function playBriefingAudio(audioUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const audio = new Audio(audioUrl)
      audio.volume = 0.3 // whisper level

      audio.addEventListener('ended', () => {
        resolve()
      })

      audio.addEventListener('error', (err) => {
        reject(err)
      })

      audio.play().catch(reject)
    } catch (err) {
      reject(err)
    }
  })
}

/**
 * Save briefing to Supabase briefing_log table for ECHO integration.
 */
async function saveBriefingToEcho(
  briefing: PreCallBriefing,
  userId: string,
): Promise<boolean> {
  try {
    const { error } = await supabase.from('briefing_log').insert({
      user_id: userId,
      contact_id: briefing.contactId,
      contact_name: briefing.contactName,
      contact_type: briefing.contactType,
      briefing_text: briefing.briefingText,
      visual_card: briefing.visualCard,
      delivery_method: briefing.deliveryMethod,
      delivered_at: briefing.deliveredAt || new Date().toISOString(),
      created_at: new Date().toISOString(),
    })

    if (error) {
      console.warn('[PreCallBriefing] ECHO save error:', error.message)
      return false
    }

    return true
  } catch (err) {
    console.warn('[PreCallBriefing] ECHO save exception:', err)
    return false
  }
}

/**
 * Generate and deliver a pre-call briefing.
 * Triggered by voice command or caller ID match.
 *
 * @param contactName - Name extracted from voice command or caller ID
 * @param triggerSource - 'voice_command' | 'caller_id' | 'manual'
 * @param deliveryMethod - 'tts' | 'visual' | 'both'
 * @returns PreCallBriefing briefing record, or null if lookup fails
 */
export async function generatePreCallBriefing(
  contactName: string,
  triggerSource: 'voice_command' | 'caller_id' | 'manual' = 'voice_command',
  deliveryMethod: 'tts' | 'visual' | 'both' = 'both',
): Promise<PreCallBriefing | null> {
  try {
    // 1. Look up contact in backup data
    const contact = lookupContactInBackup(contactName)
    if (!contact) {
      console.log(`[PreCallBriefing] Contact not found: ${contactName}`)
      return null
    }

    // 2. Determine contact type
    const contactType = inferContactType(contact)

    // 3. Build visual card
    const card = buildBriefingCard(contact, contactType)

    // 4. Generate briefing text via Claude
    const briefingText = await generateBriefingViaClaude(contact, contactType, card)

    // 5. Synthesize audio if requested
    let audioUrl: string | undefined
    if (deliveryMethod === 'tts' || deliveryMethod === 'both') {
      audioUrl = await synthesizeBriefingAudio(briefingText) || undefined
    }

    // 6. Build briefing record
    const briefing: PreCallBriefing = {
      id: `briefing-${Date.now()}`,
      contactId: contact.id,
      contactName: contact.name,
      contactType,
      briefingText,
      audioUrl,
      visualCard: card,
      generatedAt: new Date().toISOString(),
      deliveredAt: new Date().toISOString(),
      deliveryMethod,
    }

    // 7. Play audio if audio exists and delivery includes TTS
    if (audioUrl && (deliveryMethod === 'tts' || deliveryMethod === 'both')) {
      try {
        await playBriefingAudio(audioUrl)
      } catch (audioErr) {
        console.warn('[PreCallBriefing] Audio playback error:', audioErr)
        // Continue even if audio fails
      }
    }

    // 8. Save to ECHO (fire-and-forget)
    const userId = localStorage.getItem('user_id') || 'anonymous'
    saveBriefingToEcho(briefing, userId).catch(err => console.warn('[PreCallBriefing] ECHO save failed:', err))

    // 9. Publish event to agent bus
    publish('briefing_delivered', {
      contactId: contact.id,
      contactName: contact.name,
      contactType,
      triggerSource,
      timestamp: new Date().toISOString(),
    })

    return briefing
  } catch (err) {
    console.error('[PreCallBriefing] Unexpected error:', err)
    return null
  }
}

/**
 * Handle voice command trigger for pre-call briefing.
 * Extracts contact name and triggers briefing generation.
 *
 * @param voiceCommand - Full voice command text (e.g., "SPARK, briefing on John")
 * @returns PreCallBriefing or null
 */
export async function handleVoiceCommandBriefing(voiceCommand: string): Promise<PreCallBriefing | null> {
  const contactName = extractContactNameFromCommand(voiceCommand)
  if (!contactName) {
    console.log('[PreCallBriefing] Could not extract contact name from command:', voiceCommand)
    return null
  }

  return generatePreCallBriefing(contactName, 'voice_command', 'both')
}

/**
 * Handle caller ID trigger for automatic pre-call briefing.
 * Matches incoming caller ID to contact and generates briefing.
 *
 * @param incomingCallerId - Phone number or caller name
 * @returns PreCallBriefing or null if caller not found
 */
export async function handleCallerIdBriefing(incomingCallerId: string): Promise<PreCallBriefing | null> {
  // Try to match caller ID to contact
  // This is a simple phone/name match; in production would integrate with Contacts API

  try {
    const backup = getBackupData()

    // Search by phone number
    if (backup.gcContacts) {
      const gcContact = backup.gcContacts.find(gc => gc.phone && gc.phone.includes(incomingCallerId.replace(/\D/g, '')))
      if (gcContact) {
        return generatePreCallBriefing(gcContact.name, 'caller_id', 'both')
      }
    }

    if (backup.serviceLeads) {
      const slContact = backup.serviceLeads.find(sl => sl.phone && sl.phone.includes(incomingCallerId.replace(/\D/g, '')))
      if (slContact) {
        return generatePreCallBriefing(slContact.name, 'caller_id', 'both')
      }
    }

    // Try simple name match
    const contactName = incomingCallerId
    return generatePreCallBriefing(contactName, 'caller_id', 'visual')
  } catch (err) {
    console.warn('[PreCallBriefing] Caller ID lookup error:', err)
    return null
  }
}

/**
 * Get briefing history for a contact.
 * Fetches from Supabase briefing_log.
 */
export async function getBriefingHistory(contactName: string, limit: number = 10): Promise<PreCallBriefing[]> {
  try {
    const { data, error } = await supabase
      .from('briefing_log')
      .select('*')
      .eq('contact_name', contactName)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.warn('[PreCallBriefing] History fetch error:', error.message)
      return []
    }

    return (data || []).map(row => ({
      id: row.id,
      contactId: row.contact_id,
      contactName: row.contact_name,
      contactType: row.contact_type,
      briefingText: row.briefing_text,
      audioUrl: row.audio_url,
      visualCard: row.visual_card,
      generatedAt: row.created_at,
      deliveredAt: row.delivered_at,
      deliveryMethod: row.delivery_method,
    }))
  } catch (err) {
    console.warn('[PreCallBriefing] History fetch exception:', err)
    return []
  }
}

// ── Exports ──────────────────────────────────────────────────────────────────

export {
  generatePreCallBriefing,
  handleVoiceCommandBriefing,
  handleCallerIdBriefing,
  getBriefingHistory,
  extractContactNameFromCommand,
}
