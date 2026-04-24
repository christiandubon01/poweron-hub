// HUNTER-E1-NOCHECK-OUTCOMETRACKER-APR23-2026-1: @ts-nocheck removed;
// conservative as-any casts applied at property-access sites where
// Supabase JSON shapes don't match canonical types. Schema alignment
// deferred to post-Sunday soak week.
/**
 * src/services/hunter/HunterOutcomeTracker.ts
 * HUNTER Outcome Tracker — HT6
 *
 * Tracks lead outcomes when closed (won/lost/deferred/archived).
 * Triggers learning cycle via debrief and updates lead scoring model.
 *
 * PUBLIC API:
 *   markLeadWon(leadId, details)           → Promise<void>
 *   markLeadLost(leadId, details)          → Promise<void>
 *   markLeadDeferred(leadId, followUpDate, notes) → Promise<void>
 *   markLeadArchived(leadId)               → Promise<void>
 *   getOutcomeStats()                      → Promise<OutcomeStats>
 *   getOutcomesBySource()                  → Promise<OutcomeBySource[]>
 *
 * Supabase tables consumed:
 *   hunter_leads          — lead records
 *   hunter_debriefs       — outcome debriefs
 *   hunter_debrief_items  — outcome analysis items
 *   hunter_outcome_stats  — cached outcome statistics
 */

import { supabase } from '@/lib/supabase';
import { HunterLead, LeadStatus, DebriefsOutcome, HunterDebrief } from './HunterTypes';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface WonDetails {
  actualRevenue: number;
  jobType: string;
  closeMethod: string; // 'phone', 'email', 'inperson', 'referral', etc.
  notes?: string;
}

export interface LostDetails {
  lossReason: string; // 'price', 'timing', 'competitor', 'ghosted', 'other'
  competitorInfo?: string;
  notes?: string;
}

export interface OutcomeStats {
  totalLeads: number;
  wonCount: number;
  lostCount: number;
  deferredCount: number;
  archivedCount: number;
  winRate: number; // percentage 0-100
  avgRevenuePerWin: number;
  totalRevenueWon: number;
}

export interface OutcomeBySource {
  source: string;
  totalLeads: number;
  wonCount: number;
  lostCount: number;
  deferredCount: number;
  winRate: number;
}

export interface OutcomeByPitchAngle {
  pitchAngle: string;
  totalLeads: number;
  wonCount: number;
  lostCount: number;
  winRate: number;
}

export interface TopLossReasons {
  reason: string;
  count: number;
  percentage: number;
}

export interface OutcomeTrend {
  period: string; // ISO date or week
  winRate: number;
  leadsProcessed: number;
}

// ─── Implementation ────────────────────────────────────────────────────────────

/**
 * Mark a lead as WON.
 * Updates lead status, logs revenue, and triggers debrief prompt.
 */
export async function markLeadWon(
  leadId: string,
  details: WonDetails
): Promise<void> {
  try {
    // 1. Update lead status to 'won'
    const { error: updateError } = await (supabase
      .from('hunter_leads') as any)
      .update({
        status: LeadStatus.WON,
        last_updated: new Date().toISOString(),
      })
      .eq('id', leadId);

    if (updateError) throw updateError;

    // 2. Create outcome record
    const { data: outcomeData, error: outcomeError } = await supabase
      .from('hunter_outcomes')
      .insert({
        lead_id: leadId,
        outcome: 'won',
        details: {
          actualRevenue: details.actualRevenue,
          jobType: details.jobType,
          closeMethod: details.closeMethod,
          notes: details.notes,
        },
        created_at: new Date().toISOString(),
      } as any)
      .select()
      .single();

    if (outcomeError) throw outcomeError;

    // 3. Create debrief prompt (for learning cycle)
    await createDebrief(leadId, 'won', {
      actualRevenue: details.actualRevenue,
      jobType: details.jobType,
      closeMethod: details.closeMethod,
    });

    // 4. Trigger event for learning cycle
    if (typeof window !== 'undefined') {
      const event = new CustomEvent('hunterLeadClosed', {
        detail: {
          leadId,
          outcome: 'won',
          revenue: details.actualRevenue,
          timestamp: new Date().toISOString(),
        },
      });
      window.dispatchEvent(event);
    }
  } catch (error) {
    console.error('[HunterOutcomeTracker] Error marking lead as won:', error);
    throw error;
  }
}

/**
 * Mark a lead as LOST.
 * Updates lead status and triggers debrief to capture loss reason.
 */
export async function markLeadLost(
  leadId: string,
  details: LostDetails
): Promise<void> {
  try {
    // 1. Update lead status to 'lost'
    const { error: updateError } = await (supabase
      .from('hunter_leads') as any)
      .update({
        status: LeadStatus.LOST,
        last_updated: new Date().toISOString(),
      })
      .eq('id', leadId);

    if (updateError) throw updateError;

    // 2. Create outcome record
    const { error: outcomeError } = await supabase
      .from('hunter_outcomes')
      .insert({
        lead_id: leadId,
        outcome: 'lost',
        details: {
          lossReason: details.lossReason,
          competitorInfo: details.competitorInfo,
          notes: details.notes,
        },
        created_at: new Date().toISOString(),
      } as any);

    if (outcomeError) throw outcomeError;

    // 3. Create debrief prompt (for learning cycle)
    await createDebrief(leadId, 'lost', {
      lossReason: details.lossReason,
      competitorInfo: details.competitorInfo,
    });

    // 4. Trigger event for learning cycle
    if (typeof window !== 'undefined') {
      const event = new CustomEvent('hunterLeadClosed', {
        detail: {
          leadId,
          outcome: 'lost',
          lossReason: details.lossReason,
          timestamp: new Date().toISOString(),
        },
      });
      window.dispatchEvent(event);
    }
  } catch (error) {
    console.error('[HunterOutcomeTracker] Error marking lead as lost:', error);
    throw error;
  }
}

/**
 * Mark a lead as DEFERRED.
 * Keeps lead active with a future follow-up date.
 */
export async function markLeadDeferred(
  leadId: string,
  followUpDate: string,
  notes?: string
): Promise<void> {
  try {
    // 1. Update lead status to 'deferred' with follow-up date
    const { error: updateError } = await (supabase
      .from('hunter_leads') as any)
      .update({
        status: LeadStatus.DEFERRED,
        deferred_follow_up: followUpDate,
        deferred_notes: notes,
        last_updated: new Date().toISOString(),
      })
      .eq('id', leadId);

    if (updateError) throw updateError;

    // 2. Create outcome record
    const { error: outcomeError } = await supabase
      .from('hunter_outcomes')
      .insert({
        lead_id: leadId,
        outcome: 'deferred',
        details: {
          followUpDate,
          notes,
        },
        created_at: new Date().toISOString(),
      } as any);

    if (outcomeError) throw outcomeError;

    // 3. Trigger event (no debrief for deferred)
    if (typeof window !== 'undefined') {
      const event = new CustomEvent('hunterLeadDeferred', {
        detail: {
          leadId,
          followUpDate,
          timestamp: new Date().toISOString(),
        },
      });
      window.dispatchEvent(event);
    }
  } catch (error) {
    console.error('[HunterOutcomeTracker] Error deferring lead:', error);
    throw error;
  }
}

/**
 * Mark a lead as ARCHIVED.
 * Moves lead out of active pipeline. No debrief triggered.
 */
export async function markLeadArchived(leadId: string): Promise<void> {
  try {
    const { error } = await (supabase
      .from('hunter_leads') as any)
      .update({
        status: LeadStatus.ARCHIVED,
        last_updated: new Date().toISOString(),
      })
      .eq('id', leadId);

    if (error) throw error;
  } catch (error) {
    console.error('[HunterOutcomeTracker] Error archiving lead:', error);
    throw error;
  }
}

/**
 * Get aggregated outcome statistics.
 * Returns win rate, average revenue per win, counts by status.
 */
export async function getOutcomeStats(): Promise<OutcomeStats> {
  try {
    // 1. Fetch all leads with their outcomes
    const { data: leads, error: leadsError } = await supabase
      .from('hunter_leads')
      .select('id, status');

    if (leadsError) throw leadsError;

    if (!leads || leads.length === 0) {
      return {
        totalLeads: 0,
        wonCount: 0,
        lostCount: 0,
        deferredCount: 0,
        archivedCount: 0,
        winRate: 0,
        avgRevenuePerWin: 0,
        totalRevenueWon: 0,
      };
    }

    // 2. Count outcomes
    const wonCount = (leads as any[]).filter((l) => l.status === LeadStatus.WON).length;
    const lostCount = (leads as any[]).filter((l) => l.status === LeadStatus.LOST).length;
    const deferredCount = (leads as any[]).filter((l) => l.status === LeadStatus.DEFERRED).length;
    const archivedCount = (leads as any[]).filter((l) => l.status === LeadStatus.ARCHIVED).length;

    // 3. Fetch won outcomes with revenue
    const { data: wonOutcomes, error: wonError } = await supabase
      .from('hunter_outcomes')
      .select('details')
      .eq('outcome', 'won');

    if (wonError) throw wonError;

    const totalRevenueWon =
      (wonOutcomes as any[])?.reduce((sum, o) => {
        const revenue = (o as any).details?.actualRevenue || 0;
        return sum + revenue;
      }, 0) || 0;

    const avgRevenuePerWin = wonCount > 0 ? totalRevenueWon / wonCount : 0;

    // 4. Calculate win rate (won / (won + lost))
    const decidedLeads = wonCount + lostCount;
    const winRate = decidedLeads > 0 ? (wonCount / decidedLeads) * 100 : 0;

    return {
      totalLeads: leads.length,
      wonCount,
      lostCount,
      deferredCount,
      archivedCount,
      winRate: Math.round(winRate * 10) / 10,
      avgRevenuePerWin: Math.round(avgRevenuePerWin * 100) / 100,
      totalRevenueWon: Math.round(totalRevenueWon * 100) / 100,
    };
  } catch (error) {
    console.error('[HunterOutcomeTracker] Error fetching outcome stats:', error);
    throw error;
  }
}

/**
 * Get win rate by lead source for scoring model feedback.
 * Shows which sources convert best.
 */
export async function getOutcomesBySource(): Promise<OutcomeBySource[]> {
  try {
    const { data: leads, error } = await supabase
      .from('hunter_leads')
      .select('id, source, status');

    if (error) throw error;
    if (!leads || leads.length === 0) return [];

    // Group by source
    const bySource = new Map<string, OutcomeBySource>();

    (leads as any[]).forEach((lead) => {
      const source = (lead as any).source || 'unknown';
      if (!bySource.has(source)) {
        bySource.set(source, {
          source,
          totalLeads: 0,
          wonCount: 0,
          lostCount: 0,
          deferredCount: 0,
          winRate: 0,
        });
      }

      const stats = bySource.get(source)!;
      stats.totalLeads++;

      if ((lead as any).status === LeadStatus.WON) stats.wonCount++;
      else if ((lead as any).status === LeadStatus.LOST) stats.lostCount++;
      else if ((lead as any).status === LeadStatus.DEFERRED) stats.deferredCount++;
    });

    // Calculate win rates
    bySource.forEach((stats) => {
      const decidedLeads = stats.wonCount + stats.lostCount;
      stats.winRate =
        decidedLeads > 0 ? Math.round((stats.wonCount / decidedLeads) * 100 * 10) / 10 : 0;
    });

    return Array.from(bySource.values()).sort((a, b) => b.winRate - a.winRate);
  } catch (error) {
    console.error('[HunterOutcomeTracker] Error fetching outcomes by source:', error);
    throw error;
  }
}

/**
 * Get win rate by pitch angle for conversion feedback.
 * Shows which angles convert best.
 */
export async function getOutcomesByPitchAngle(): Promise<OutcomeByPitchAngle[]> {
  try {
    const { data: leads, error } = await supabase
      .from('hunter_leads')
      .select('id, pitch_angle, status');

    if (error) throw error;
    if (!leads || leads.length === 0) return [];

    // Group by pitch angle
    const byAngle = new Map<string, OutcomeByPitchAngle>();

    (leads as any[]).forEach((lead) => {
      const angle = (lead as any).pitch_angle || 'none';
      if (!byAngle.has(angle)) {
        byAngle.set(angle, {
          pitchAngle: angle,
          totalLeads: 0,
          wonCount: 0,
          lostCount: 0,
          winRate: 0,
        });
      }

      const stats = byAngle.get(angle)!;
      stats.totalLeads++;

      if ((lead as any).status === LeadStatus.WON) stats.wonCount++;
      else if ((lead as any).status === LeadStatus.LOST) stats.lostCount++;
    });

    // Calculate win rates
    byAngle.forEach((stats) => {
      const decidedLeads = stats.wonCount + stats.lostCount;
      stats.winRate =
        decidedLeads > 0 ? Math.round((stats.wonCount / decidedLeads) * 100 * 10) / 10 : 0;
    });

    return Array.from(byAngle.values()).sort((a, b) => b.winRate - a.winRate);
  } catch (error) {
    console.error('[HunterOutcomeTracker] Error fetching outcomes by pitch angle:', error);
    throw error;
  }
}

/**
 * Get top loss reasons ranked by frequency.
 */
export async function getTopLossReasons(): Promise<TopLossReasons[]> {
  try {
    const { data: lostOutcomes, error } = await supabase
      .from('hunter_outcomes')
      .select('details')
      .eq('outcome', 'lost');

    if (error) throw error;
    if (!lostOutcomes || lostOutcomes.length === 0) return [];

    // Count reasons
    const reasonCounts = new Map<string, number>();
    (lostOutcomes as any[]).forEach((outcome) => {
      const reason = (outcome as any).details?.lossReason || 'unknown';
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    });

    // Convert to array with percentages
    const total = lostOutcomes.length;
    const results = Array.from(reasonCounts.entries()).map(([reason, count]) => ({
      reason,
      count,
      percentage: Math.round((count / total) * 100 * 10) / 10,
    }));

    return results.sort((a, b) => b.count - a.count);
  } catch (error) {
    console.error('[HunterOutcomeTracker] Error fetching top loss reasons:', error);
    throw error;
  }
}

/**
 * Get win rate trend over time (last 30/60/90 days).
 */
export async function getOutcomeTrend(daysBack: number = 30): Promise<OutcomeTrend[]> {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    const { data: outcomes, error } = await supabase
      .from('hunter_outcomes')
      .select('outcome, created_at')
      .gte('created_at', startDate.toISOString());

    if (error) throw error;
    if (!outcomes || outcomes.length === 0) return [];

    // Group by week
    const byWeek = new Map<
      string,
      { won: number; decided: number; period: string }
    >();

    (outcomes as any[]).forEach((outcome) => {
      const date = new Date((outcome as any).created_at);
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      const period = weekStart.toISOString().split('T')[0];

      if (!byWeek.has(period)) {
        byWeek.set(period, { won: 0, decided: 0, period });
      }

      const stats = byWeek.get(period)!;
      if ((outcome as any).outcome === 'won') stats.won++;
      if ((outcome as any).outcome === 'won' || (outcome as any).outcome === 'lost') stats.decided++;
    });

    // Calculate win rates
    const results = Array.from(byWeek.values()).map((stats) => ({
      period: stats.period,
      winRate:
        stats.decided > 0
          ? Math.round((stats.won / stats.decided) * 100 * 10) / 10
          : 0,
      leadsProcessed: stats.decided,
    }));

    return results.sort((a, b) => a.period.localeCompare(b.period));
  } catch (error) {
    console.error('[HunterOutcomeTracker] Error fetching outcome trend:', error);
    throw error;
  }
}

// ─── Internal Helpers ──────────────────────────────────────────────────────────

/**
 * Create a debrief prompt for the learning cycle.
 */
async function createDebrief(
  leadId: string,
  outcome: 'won' | 'lost',
  context: Record<string, any>
): Promise<void> {
  try {
    const { error } = await supabase
      .from('hunter_debriefs')
      .insert({
        lead_id: leadId,
        outcome,
        context,
        created_at: new Date().toISOString(),
      } as any);

    if (error) throw error;
  } catch (error) {
    console.error('[HunterOutcomeTracker] Error creating debrief:', error);
    // Don't throw - debrief creation failure shouldn't block outcome logging
  }
}
