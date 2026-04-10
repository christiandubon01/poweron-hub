/**
 * SparkDebrief.ts — Post-conversation analysis and action item generation
 *
 * Triggers:
 *   1. 90 seconds of silence detected during call
 *   2. User says "OK SPARK talk to me" keyword
 *
 * Flow:
 *   - Compile full transcript + analysis from SparkStore
 *   - Send to Claude (Sonnet) with debrief system prompt
 *   - Parse structured response: SUMMARY, FLAGS, ACTION ITEMS, DRAFT MESSAGE, ECHO LOG
 *   - Deliver via ElevenLabs TTS (Oxley voice) on AirPods
 *   - Present approval UI on phone/Watch
 *   - Save approved items to Supabase spark_conversations table
 */

import { callClaude, extractText } from '@/services/claudeProxy'
import { supabase } from '@/lib/supabase'
import { synthesizeWithElevenLabs } from '@/api/voice/elevenLabs'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ActionItem {
  number: number
  description: string
  status: 'pending' | 'approved' | 'rejected' | 'edited'
  createdAt: string
  rejectionReason?: string
  editedText?: string
}

export interface DebrieFlag {
  type: 'red' | 'amber'
  title: string
  description: string
}

export interface SparkDebrief {
  id?: string
  contactName: string
  date: string
  durationSeconds: number
  transcript: string
  analysisSummary: string
  summary: string
  flags: DebrieFlag[]
  actionItems: ActionItem[]
  draftMessage: string
  echoLog: string
  createdAt?: string
  updatedAt?: string
}

export interface DebrieResponse {
  summary: string
  flags: DebrieFlag[]
  actionItems: Omit<ActionItem, 'status' | 'createdAt' | 'rejectionReason' | 'editedText'>[]
  draftMessage: string
  echoLog: string
}

// ── System Prompt for SPARK ──────────────────────────────────────────────────

const SPARK_DEBRIEF_SYSTEM = `You are SPARK delivering a post-conversation debrief to Christian, a C-10 electrical contractor in the Coachella Valley, CA.

Context: Christian has just finished a sales call or business conversation. Your job is to analyze the transcript and provide:
1. A crisp 2-3 sentence summary of what happened
2. Any red flags or concerns (if present)
3. Numbered action items — each specific, measurable, and ready to execute
4. A draft follow-up message (text or email) ready to send
5. A one-paragraph ECHO summary for permanent memory

Style:
- Be DIRECT. No filler, no corporate speak.
- Lead with what matters most: money, commitments, red flags.
- Action items must be specific. "Call them back" is weak; "Call John at 760-555-1212 to confirm the $15k Solar proposal deadline" is strong.
- If there are no action items, say "No immediate action required — monitor for follow-up."
- If there are no red flags, say "No red flags detected."

Format your response as raw JSON (no code fence) with this exact shape:
{
  "summary": "2-3 sentence summary of the call",
  "flags": [
    { "type": "red" | "amber", "title": "Flag title", "description": "What and why" }
  ],
  "actionItems": [
    { "number": 1, "description": "Specific action item text" },
    { "number": 2, "description": "..." }
  ],
  "draftMessage": "Ready-to-send follow-up text or email",
  "echoLog": "One paragraph summary for memory storage"
}

If any section is empty, use [] or "". Never omit any key.`

// ── Core Debrief Generation ──────────────────────────────────────────────────

/**
 * Generate a debrief from a call transcript + analysis.
 * Sends to Claude with Spark debrief system prompt.
 * Returns structured debrief response.
 */
export async function generateSparkDebrief(
  transcript: string,
  analysisSummary: string,
  contactName: string
): Promise<DebrieResponse | null> {
  try {
    const userPrompt = `Call transcript and analysis:

Contact: ${contactName}
Transcript:
${transcript}

Your analysis so far:
${analysisSummary}

Generate the post-call debrief.`

    const response = await callClaude({
      messages: [{ role: 'user', content: userPrompt }],
      system: SPARK_DEBRIEF_SYSTEM,
      max_tokens: 1500,
      model: 'claude-3-5-sonnet-20241022', // Sonnet 4.6 for quality
    })

    const text = extractText(response)

    // Parse JSON response
    let debrief: DebrieResponse
    try {
      debrief = JSON.parse(text)
    } catch {
      // Fallback: try to extract JSON from markdown code fence
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
      if (jsonMatch) {
        debrief = JSON.parse(jsonMatch[1])
      } else {
        throw new Error('Could not parse debrief JSON from Claude response')
      }
    }

    // Normalize action items to include numbers
    const actionItems = (debrief.actionItems || []).map((item, idx) => ({
      number: item.number || idx + 1,
      description: item.description || '',
    }))

    return {
      summary: debrief.summary || '',
      flags: debrief.flags || [],
      actionItems,
      draftMessage: debrief.draftMessage || '',
      echoLog: debrief.echoLog || '',
    }
  } catch (err) {
    console.error('[SparkDebrief] generateSparkDebrief error:', err)
    return null
  }
}

// ── TTS Delivery ─────────────────────────────────────────────────────────────

/**
 * Deliver debrief summary + action items via ElevenLabs TTS.
 * Plays on AirPods (speaker) with 1-second pause between action items.
 * Returns audio URLs for replay/debugging.
 */
export async function deliverDebrieefViaTTS(debrief: DebrieResponse): Promise<{ audioUrls: string[] } | null> {
  try {
    const audioUrls: string[] = []

    // 1. Speak SUMMARY
    const summaryResponse = await synthesizeWithElevenLabs({
      text: `Here's your debrief. ${debrief.summary}`,
      voice_id: 'gOkFV1JMCt0G0n9xmBwV', // Oxley voice
    })
    audioUrls.push(summaryResponse.audioUrl)
    await playAudio(summaryResponse.audioUrl)
    await sleep(1000)

    // 2. Speak each ACTION ITEM with pause
    if (debrief.actionItems.length > 0) {
      for (const item of debrief.actionItems) {
        const itemText = `Action item ${item.number}: ${item.description}`
        const itemResponse = await synthesizeWithElevenLabs({
          text: itemText,
          voice_id: 'gOkFV1JMCt0G0n9xmBwV',
        })
        audioUrls.push(itemResponse.audioUrl)
        await playAudio(itemResponse.audioUrl)
        await sleep(1000) // 1 second pause between items
      }
    }

    return { audioUrls }
  } catch (err) {
    console.error('[SparkDebrief] deliverDebrieefViaTTS error:', err)
    return null
  }
}

// ── Helper: Play audio on client ─────────────────────────────────────────────

function playAudio(audioUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const audio = new Audio(audioUrl)
      audio.onended = () => resolve()
      audio.onerror = () => reject(new Error('Audio playback failed'))
      audio.play().catch(reject)
    } catch (err) {
      reject(err)
    }
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ── Supabase Persistence ─────────────────────────────────────────────────────

/**
 * Save debrief to Supabase spark_conversations table.
 * Includes action items array and ECHO log for permanent memory.
 * Fallback to localStorage if Supabase unavailable.
 */
export async function saveDebrieefToSupabase(
  debrief: SparkDebrief
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      throw new Error('Not authenticated')
    }

    // Prepare row
    const row: any = {
      user_id: user.id,
      contact_name: debrief.contactName,
      date: debrief.date,
      duration_seconds: debrief.durationSeconds,
      transcript: debrief.transcript,
      analysis_summary: debrief.analysisSummary,
      summary: debrief.summary,
      flags_raised: debrief.flags,
      action_items: debrief.actionItems.map(item => ({
        text: item.description,
        status: item.status,
        created_at: item.createdAt,
        rejection_reason: item.rejectionReason,
        edited_text: item.editedText,
      })),
      echo_log: debrief.echoLog,
      created_at: debrief.createdAt || new Date().toISOString(),
    }

    // Insert or update
    const { data, error } = await (supabase
      .from('spark_conversations') as any)
      .insert([row])
      .select('id')
      .single()

    if (error) {
      console.error('[SparkDebrief] Supabase error:', error)
      // Fallback to localStorage
      saveDebrieefToLocalStorage(debrief)
      return { success: true, id: 'local', error: `Saved to localStorage: ${error.message}` }
    }

    return { success: true, id: (data as any).id }
  } catch (err) {
    console.error('[SparkDebrief] saveDebrieefToSupabase error:', err)
    // Fallback to localStorage
    saveDebrieefToLocalStorage(debrief)
    return {
      success: true,
      id: 'local',
      error: `Saved to localStorage: ${err instanceof Error ? err.message : 'Unknown error'}`,
    }
  }
}

/**
 * Fallback: save to localStorage if Supabase unavailable.
 */
function saveDebrieefToLocalStorage(debrief: SparkDebrief): void {
  try {
    const key = `spark_debrief_${Date.now()}`
    localStorage.setItem(key, JSON.stringify(debrief))
    console.log('[SparkDebrief] Saved to localStorage:', key)
  } catch (err) {
    console.error('[SparkDebrief] localStorage error:', err)
  }
}

// ── Action Item Approval ─────────────────────────────────────────────────────

/**
 * Update action item status (approve/reject/edit).
 * Called from SparkDebriefPanel approval UI.
 */
export function updateActionItemStatus(
  items: ActionItem[],
  itemNumber: number,
  status: 'approved' | 'rejected' | 'edited',
  rejectionReason?: string,
  editedText?: string
): ActionItem[] {
  return items.map(item =>
    item.number === itemNumber
      ? { ...item, status, rejectionReason, editedText }
      : item
  )
}

/**
 * Get count of approved items (for task creation).
 */
export function countApprovedItems(items: ActionItem[]): number {
  return items.filter(item => item.status === 'approved').length
}
