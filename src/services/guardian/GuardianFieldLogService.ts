/**
 * GuardianFieldLogService — Pre-job checklists and daily field logs
 *
 * Core responsibilities:
 * - Save pre-job checklists and daily field logs to Supabase
 * - Detect scope changes and RFI-triggering language
 * - Retrieve log history for projects
 * - Find incomplete field logs
 */

import { supabase } from '@/lib/supabase'
import { callClaude, extractText } from '@/services/claudeProxy'
import type { ClaudeRequest } from '@/services/claudeProxy'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ChecklistType = 'pre_job' | 'daily_field_log'

export interface ChecklistItem {
  id: string
  label: string
  completed: boolean
  photos?: string[] // URLs to uploaded photos
  notes?: string
}

export interface PreJobChecklistData {
  projectId: string
  projectName: string
  checklistType: 'pre_job'
  items: ChecklistItem[]
  completedAt?: string
  createdAt: string
  updatedAt: string
}

export interface DailyFieldLogData {
  projectId: string
  projectName: string
  checklistType: 'daily_field_log'
  workCompletedToday: string
  workRemaining: string
  deviationsFromPlan: string
  verbalConversations: string
  photos?: string[] // Upload URLs
  hoursOnSite: number
  createdAt: string
  updatedAt: string
  scopeChangeDetected?: boolean
  scopeChangeText?: string
  rfiDetected?: boolean
  rfiText?: string
}

export interface ScopeChangeDetection {
  detected: boolean
  confidence: number
  scopeChangeText?: string
  suggestedAction?: string
}

export interface RFIDetection {
  detected: boolean
  confidence: number
  rfiText?: string
  suggestedAction?: string
}

// ── Scope Change Keywords ────────────────────────────────────────────────────

const SCOPE_CHANGE_KEYWORDS = [
  'they want to add',
  'changed to',
  'instead of',
  'also needs',
  'while we\'re here',
  'customer asked for',
  'added',
  'extra work',
  'additional items',
  'scope creep',
  'not included',
  'new requirement',
]

// ── RFI KEYWORDS ─────────────────────────────────────────────────────────────

const RFI_KEYWORDS = [
  'doesn\'t meet code',
  'conflict with',
  'can\'t install because',
  'inspector said',
  'code violation',
  'nec requirement',
  'won\'t fit',
  'not compatible',
  'incompatible',
  'code issue',
  'permit issue',
  'rejected',
]

// ── Save Field Log ───────────────────────────────────────────────────────────

/**
 * Saves a field log (pre-job checklist or daily field log) to Supabase
 */
export async function saveFieldLog(
  projectId: string,
  logData: PreJobChecklistData | DailyFieldLogData
): Promise<string> {
  try {
    // Get the current user
    const { data } = await supabase.auth.getSession()
    const userId = data?.session?.user?.id
    if (!userId) {
      throw new Error('No authenticated user')
    }

    const payload = {
      project_id: projectId,
      project_name: logData.projectName,
      checklist_type: logData.checklistType,
      data: logData,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      user_id: userId,
    } as any

    const { data: result, error } = await supabase
      .from('guardian_checklists' as any)
      .insert([payload] as any)
      .select('id')
      .single()

    if (error) throw error
    return (result as any).id
  } catch (err) {
    console.error('Error saving field log:', err)
    throw err
  }
}

// ── Detect Scope Change Language ──────────────────────────────────────────────

/**
 * Detects scope change language via Claude Haiku classification.
 * Keywords: "they want to add", "changed to", "instead of", etc.
 */
export async function detectScopeChangeLanguage(
  text: string
): Promise<ScopeChangeDetection> {
  if (!text || text.length < 10) {
    return { detected: false, confidence: 0 }
  }

  // Quick keyword check first
  const hasKeywords = SCOPE_CHANGE_KEYWORDS.some(kw =>
    text.toLowerCase().includes(kw.toLowerCase())
  )

  if (!hasKeywords) {
    return { detected: false, confidence: 0 }
  }

  // If keywords detected, use Claude Haiku for confirmation
  try {
    const request: ClaudeRequest = {
      messages: [
        {
          role: 'user',
          content: `You are a construction project analysis AI. Determine if the following text indicates a scope change request or addition.

Text: "${text}"

Respond with ONLY valid JSON (no markdown, no extra text):
{
  "scopeChangeDetected": boolean,
  "confidence": number between 0 and 1,
  "summary": "brief description of the scope change if detected"
}`,
        },
      ],
      max_tokens: 256,
      model: 'claude-3-5-haiku-20241022',
    }

    const response = await callClaude(request)
    const responseText = extractText(response)
    
    // Parse response
    let parsed
    try {
      parsed = JSON.parse(responseText)
    } catch {
      // Fallback: if Claude can't parse, check keywords again
      return {
        detected: hasKeywords,
        confidence: 0.6,
        scopeChangeText: text,
      }
    }

    return {
      detected: parsed.scopeChangeDetected || false,
      confidence: parsed.confidence || 0,
      scopeChangeText: text,
      suggestedAction: parsed.summary,
    }
  } catch (err) {
    console.warn('Error calling Claude for scope change detection:', err)
    // Fallback to keyword detection
    return {
      detected: hasKeywords,
      confidence: 0.6,
      scopeChangeText: text,
    }
  }
}

// ── Detect RFI Language ───────────────────────────────────────────────────────

/**
 * Detects RFI (Request For Information) language via Claude Haiku.
 * Keywords: "doesn't meet code", "conflict with", "inspector said", etc.
 */
export async function detectRFILanguage(
  text: string
): Promise<RFIDetection> {
  if (!text || text.length < 10) {
    return { detected: false, confidence: 0 }
  }

  // Quick keyword check first
  const hasKeywords = RFI_KEYWORDS.some(kw =>
    text.toLowerCase().includes(kw.toLowerCase())
  )

  if (!hasKeywords) {
    return { detected: false, confidence: 0 }
  }

  // If keywords detected, use Claude Haiku for confirmation
  try {
    const request: ClaudeRequest = {
      messages: [
        {
          role: 'user',
          content: `You are a construction RFI (Request For Information) analyzer. Determine if the following text indicates a code conflict, inspection issue, or other RFI trigger.

Text: "${text}"

Respond with ONLY valid JSON (no markdown, no extra text):
{
  "rfiDetected": boolean,
  "confidence": number between 0 and 1,
  "issueType": "code_conflict|inspection|permit|material|other",
  "summary": "brief description of the issue"
}`,
        },
      ],
      max_tokens: 256,
      model: 'claude-3-5-haiku-20241022',
    }

    const response = await callClaude(request)
    const responseText = extractText(response)
    
    // Parse response
    let parsed
    try {
      parsed = JSON.parse(responseText)
    } catch {
      // Fallback to keyword detection
      return {
        detected: hasKeywords,
        confidence: 0.6,
        rfiText: text,
      }
    }

    return {
      detected: parsed.rfiDetected || false,
      confidence: parsed.confidence || 0,
      rfiText: text,
      suggestedAction: parsed.summary,
    }
  } catch (err) {
    console.warn('Error calling Claude for RFI detection:', err)
    // Fallback to keyword detection
    return {
      detected: hasKeywords,
      confidence: 0.6,
      rfiText: text,
    }
  }
}

// ── Get Field Log History ────────────────────────────────────────────────────

/**
 * Retrieves all field logs for a project
 */
export async function getFieldLogHistory(projectId: string) {
  try {
    const { data, error } = await supabase
      .from('guardian_checklists')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return data || []
  } catch (err) {
    console.error('Error fetching field log history:', err)
    return []
  }
}

// ── Get Incomplete Field Logs ────────────────────────────────────────────────

/**
 * Returns projects that were visited today but don't have a completed daily field log
 */
export async function getIncompleteFieldLogs() {
  try {
    const today = new Date().toISOString().split('T')[0]
    
    const { data, error } = await supabase
      .from('guardian_checklists')
      .select('*')
      .eq('checklist_type', 'daily_field_log')
      .gte('created_at', `${today}T00:00:00`)
      .lt('created_at', `${today}T23:59:59`)
      .order('created_at', { ascending: false })

    if (error) throw error
    return data || []
  } catch (err) {
    console.error('Error fetching incomplete field logs:', err)
    return []
  }
}

// ── Verify Checklist Completion ──────────────────────────────────────────────

/**
 * Checks if all items in a pre-job checklist are completed
 */
export function isChecklistComplete(items: ChecklistItem[]): boolean {
  return items.length > 0 && items.every(item => item.completed)
}

// ── Generate Change Order Prompt ─────────────────────────────────────────────

/**
 * Returns a formatted prompt for the user to generate a change order
 */
export function generateChangeOrderPrompt(scopeChangeText: string): string {
  return `You mentioned "${scopeChangeText}" — this sounds like a scope change. Generate a change order? [YES] [NO]`
}

// ── Generate RFI Prompt ──────────────────────────────────────────────────────

/**
 * Returns a formatted prompt for the user to generate an RFI
 */
export function generateRFIPrompt(rfiText: string): string {
  return `You mentioned "${rfiText}" — this sounds like an RFI issue. Generate a Request for Information? [YES] [NO]`
}
