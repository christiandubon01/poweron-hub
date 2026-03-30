// @ts-nocheck
/**
 * SPARK AgentBus Subscriptions — Phase E Wiring
 *
 * Handles cross-agent communication:
 *
 * INBOUND:
 *   - CHRONO → SPARK  data_updated  (event: idle_slots_detected)
 *     → Populates follow_up_opportunities on leads whose follow_up_date falls
 *       within the idle slot window. Surfaces as follow-up suggestions.
 *
 * OUTBOUND (published by sparkService.ts and sparkIndex.ts):
 *   - SPARK → PULSE   LEAD_CONVERTED   (won/lost status change)
 *   - SPARK → NEXUS   REVIEW_RECEIVED  (new unanswered review alert)
 *
 * This module is initialized once on app mount via initSparkSubscriptions().
 * Call it from the main App.tsx or SparkPanel on mount.
 */

import { subscribe, publish } from '@/services/agentBus'
import type { AgentMessage } from '@/services/agentBus'
import { publish as eventPublish } from '@/services/agentEventBus'
import { getLeads } from '@/services/sparkService'

let _unsubscribe: (() => void) | null = null

// ── In-memory follow-up opportunity store ────────────────────────────────────

export interface FollowUpOpportunity {
  leadId:    string
  leadName:  string
  slotDate:  string
  slotHours: number
  suggestedAt: string
}

let _followUpOpportunities: FollowUpOpportunity[] = []

export function getFollowUpOpportunities(): FollowUpOpportunity[] {
  return [..._followUpOpportunities]
}

// ── Subscription init ────────────────────────────────────────────────────────

/**
 * Initialize SPARK's subscriptions on the AgentBus.
 * Safe to call multiple times — deduplicates.
 */
export function initSparkSubscriptions(): () => void {
  // Teardown any existing subscription first
  if (_unsubscribe) {
    _unsubscribe()
    _unsubscribe = null
  }

  const unsub = subscribe('SPARK', handleSparkMessage)
  _unsubscribe = unsub

  console.log('[SPARK] AgentBus subscriptions initialized')
  return unsub
}

// ── Message handler ──────────────────────────────────────────────────────────

async function handleSparkMessage(msg: AgentMessage): Promise<void> {
  const { from, type, payload } = msg

  // ── CHRONO → SPARK: idle_slots_detected ─────────────────────────────────
  if (from === 'CHRONO' && type === 'data_updated' && payload.event === 'idle_slots_detected') {
    await handleIdleSlotsDetected(payload)
    return
  }

  // Unknown message — log and ignore
  console.log('[SPARK] Received unhandled AgentBus message:', { from, type, payload })
}

// ── Handler: idle slots from CHRONO ─────────────────────────────────────────

interface IdleSlot {
  date:      string
  freeHours: number
  dayLabel:  string
}

async function handleIdleSlotsDetected(payload: Record<string, unknown>): Promise<void> {
  const idleSlots = (payload.idleSlots as IdleSlot[]) || []
  if (idleSlots.length === 0) return

  console.log(`[SPARK] Received ${idleSlots.length} idle slot(s) from CHRONO`)

  try {
    // Fetch all leads that are 'new' or 'contacted' (i.e., still active)
    const [newLeads, contactedLeads] = await Promise.all([
      getLeads('new'),
      getLeads('contacted'),
    ])

    const activeLeads = [...newLeads, ...contactedLeads]

    // Build follow-up opportunities: cross-reference leads without follow_up_date
    // with available idle slots from CHRONO
    const newOpportunities: FollowUpOpportunity[] = []

    // Get dates of idle slots
    const slotDates = idleSlots.map(s => ({ date: s.date, hours: s.freeHours }))

    // For each active lead without a follow-up date, suggest the first available idle slot
    for (const lead of activeLeads) {
      if (lead.follow_up_date) continue  // Already scheduled — skip

      // Find earliest idle slot with enough time (at least 1 hour)
      const availableSlot = slotDates.find(s => s.hours >= 1)
      if (!availableSlot) continue

      newOpportunities.push({
        leadId:      lead.id!,
        leadName:    lead.name,
        slotDate:    availableSlot.date,
        slotHours:   availableSlot.hours,
        suggestedAt: new Date().toISOString(),
      })
    }

    if (newOpportunities.length > 0) {
      // Merge into in-memory store (dedup by leadId)
      const existingIds = new Set(_followUpOpportunities.map(o => o.leadId))
      const fresh = newOpportunities.filter(o => !existingIds.has(o.leadId))
      _followUpOpportunities = [...fresh, ..._followUpOpportunities].slice(0, 50)

      console.log(`[SPARK] Populated ${fresh.length} follow-up opportunities from idle slots`)

      // Notify NEXUS via agentEventBus (for morning briefing context)
      eventPublish(
        'IDLE_SLOTS_DETECTED' as any,
        'spark',
        {
          opportunities:     fresh.length,
          leadNames:         fresh.map(o => o.leadName),
          slots:             idleSlots.map(s => s.date),
        },
        `SPARK: ${fresh.length} follow-up opportunity(-ies) found from CHRONO idle slots`
      )

      // Reply to PULSE about potential revenue opportunities
      await publish(
        'SPARK',
        'PULSE',
        'data_updated',
        {
          event:             'follow_up_opportunities',
          count:             fresh.length,
          opportunities:     fresh,
          source:            'chrono_idle_slots',
        }
      )
    }
  } catch (err) {
    console.error('[SPARK] handleIdleSlotsDetected error:', err)
  }
}

// ── Teardown ─────────────────────────────────────────────────────────────────

export function teardownSparkSubscriptions(): void {
  if (_unsubscribe) {
    _unsubscribe()
    _unsubscribe = null
    console.log('[SPARK] AgentBus subscriptions torn down')
  }
}
