// @ts-nocheck
/**
 * src/services/hunter/HunterSourceAnalytics.ts
 * HUNTER Source Analytics — HT14
 *
 * Analytics dashboard showing which lead sources produce wins, waste time, and ROI.
 * Aggregates hunter_leads by source and calculates performance metrics.
 *
 * PUBLIC API:
 *   analyzeSourcePerformance()        → Promise<SourceAnalysis[]>
 *   getTopSources(limit)              → Promise<SourceAnalysis[]>
 *   getBottomSources(limit)           → Promise<SourceAnalysis[]>
 *   getPitchAnglePerformance()        → Promise<PitchAnglePerformance[]>
 *   getTimePatterns()                 → Promise<TimePattern>
 *   generateSourceRecommendation()    → Promise<string>
 *
 * Supabase tables consumed:
 *   hunter_leads          — lead records with source, status, discovered_at
 *   hunter_debriefs       — outcome data including actual revenue
 */

import { supabase } from '@/lib/supabase';
import { HunterLead, LeadStatus, PitchAngle } from './HunterTypes';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SourceMetrics {
  source: string;
  totalLeads: number;
  contacted: number;
  quoted: number;
  won: number;
  lost: number;
  deferred: number;
  winRate: number; // percentage 0-100
  conversionRate: number; // contacted / total
  avgRevenuePerWon: number;
  totalRevenueFromSource: number;
  avgTimeToClose: number; // days
  costPerLead: number; // estimated
  roi: number; // (totalRevenue - cost) / cost, as percentage
}

export interface SourceAnalysis extends SourceMetrics {
  trend: 'improving' | 'declining' | 'stable';
  recommendation: string;
  confidenceScore: number; // 0-100 based on data volume
}

export interface PitchAnglePerformance {
  pitchAngle: string;
  source: string;
  leadType: string;
  totalLeads: number;
  wonLeads: number;
  winRate: number;
  avgRevenue: number;
  insight: string;
}

export interface TimePattern {
  dayOfWeek: string;
  bestHour: number;
  leadsContacted: number;
  wonLeads: number;
  winRate: number;
  avgTimeToContact: number; // hours from discovery
}

export interface HeatmapEntry {
  day: string; // Monday-Sunday
  hour: number; // 0-23
  leadsContacted: number;
  wonLeads: number;
  effectiveness: number; // 0-100
}

// ─── Service ───────────────────────────────────────────────────────────────────

class HunterSourceAnalyticsService {
  /**
   * Analyze performance across all sources
   * Aggregates leads by source and calculates comprehensive metrics
   */
  async analyzeSourcePerformance(): Promise<SourceAnalysis[]> {
    try {
      // Fetch all leads with their outcomes
      const { data: leads, error } = await supabase
        .from('hunter_leads')
        .select('*')
        .order('discovered_at', { ascending: false });

      if (error) throw error;
      if (!leads || leads.length === 0) return [];

      // Group by source
      const sourceMap = new Map<string, HunterLead[]>();
      leads.forEach((lead: HunterLead) => {
        const source = lead.source || 'unknown';
        if (!sourceMap.has(source)) {
          sourceMap.set(source, []);
        }
        sourceMap.get(source)!.push(lead);
      });

      // Calculate metrics per source
      const analyses: SourceAnalysis[] = [];
      for (const [source, sourceLeads] of sourceMap) {
        const metrics = this.calculateSourceMetrics(source, sourceLeads);
        const trend = this.calculateTrend(sourceLeads);
        const recommendation = this.generateSourceInsight(source, metrics);
        const confidence = Math.min(100, Math.floor((sourceLeads.length / 10) * 100));

        analyses.push({
          ...metrics,
          trend,
          recommendation,
          confidenceScore: confidence,
        });
      }

      return analyses.sort((a, b) => b.roi - a.roi);
    } catch (error) {
      console.error('Failed to analyze source performance:', error);
      return [];
    }
  }

  /**
   * Get top performing sources by win rate and revenue
   */
  async getTopSources(limit: number = 5): Promise<SourceAnalysis[]> {
    const analyses = await this.analyzeSourcePerformance();
    return analyses
      .filter((a) => a.confidenceScore >= 30)
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, limit);
  }

  /**
   * Get bottom performing sources (candidates for cutting)
   */
  async getBottomSources(limit: number = 3): Promise<SourceAnalysis[]> {
    const analyses = await this.analyzeSourcePerformance();
    return analyses
      .filter((a) => a.confidenceScore >= 30 && a.totalLeads >= 5)
      .sort((a, b) => a.winRate - b.winRate)
      .slice(0, limit);
  }

  /**
   * Analyze which pitch angles convert best by source type
   * Example: "Urgency angle converts 45% on permit leads but only 12% on referrals"
   */
  async getPitchAnglePerformance(): Promise<PitchAnglePerformance[]> {
    try {
      const { data: leads, error } = await supabase
        .from('hunter_leads')
        .select('*')
        .not('pitch_angle', 'is', null);

      if (error) throw error;
      if (!leads || leads.length === 0) return [];

      const performanceMap = new Map<string, HunterLead[]>();
      const key = (pa: string, src: string, lt: string) =>
        `${pa}|${src}|${lt}`;

      leads.forEach((lead: HunterLead) => {
        const k = key(
          lead.pitch_angle || 'none',
          lead.source || 'unknown',
          lead.lead_type || 'unknown'
        );
        if (!performanceMap.has(k)) {
          performanceMap.set(k, []);
        }
        performanceMap.get(k)!.push(lead);
      });

      const performances: PitchAnglePerformance[] = [];
      for (const [k, groupLeads] of performanceMap) {
        const [pitchAngle, source, leadType] = k.split('|');
        const wonLeads = groupLeads.filter(
          (l) => l.status === LeadStatus.WON
        ).length;
        const winRate =
          groupLeads.length > 0
            ? Math.round((wonLeads / groupLeads.length) * 100)
            : 0;
        const avgRevenue =
          groupLeads.reduce((sum, l) => sum + (l.estimated_value || 0), 0) /
          groupLeads.length;
        const insight = this.generatePitchInsight(
          pitchAngle,
          source,
          winRate
        );

        performances.push({
          pitchAngle,
          source,
          leadType,
          totalLeads: groupLeads.length,
          wonLeads,
          winRate,
          avgRevenue,
          insight,
        });
      }

      return performances.sort((a, b) => b.winRate - a.winRate);
    } catch (error) {
      console.error('Failed to get pitch angle performance:', error);
      return [];
    }
  }

  /**
   * Analyze best day/time patterns for contacting leads by source
   * Returns optimal contact windows per source
   */
  async getTimePatterns(): Promise<TimePattern[]> {
    try {
      const { data: leads, error } = await supabase
        .from('hunter_leads')
        .select('*')
        .eq('status', LeadStatus.CONTACTED);

      if (error) throw error;
      if (!leads || leads.length === 0) return [];

      const dayMap = new Map<string, HunterLead[]>();
      const days = [
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
      ];

      leads.forEach((lead: HunterLead) => {
        const date = new Date(lead.discovered_at || new Date());
        const day = days[date.getDay()];
        if (!dayMap.has(day)) {
          dayMap.set(day, []);
        }
        dayMap.get(day)!.push(lead);
      });

      const patterns: TimePattern[] = [];
      for (const [day, dayLeads] of dayMap) {
        const wonLeads = dayLeads.filter(
          (l) => l.status === LeadStatus.WON
        ).length;
        const winRate =
          dayLeads.length > 0
            ? Math.round((wonLeads / dayLeads.length) * 100)
            : 0;

        // Calculate average hour of contact
        const hours = dayLeads
          .map((l) => new Date(l.discovered_at || new Date()).getHours())
          .filter((h) => h >= 0);
        const bestHour =
          hours.length > 0 ? Math.round(hours.reduce((a, b) => a + b) / hours.length) : 12;

        // Time to contact from discovery to first interaction
        const timeDiffs = dayLeads
          .map((l) => {
            const discovered = new Date(l.discovered_at || 0).getTime();
            const updated = new Date(l.last_updated || 0).getTime();
            return (updated - discovered) / (1000 * 60 * 60); // hours
          })
          .filter((d) => d >= 0);
        const avgTimeToContact =
          timeDiffs.length > 0
            ? Math.round(timeDiffs.reduce((a, b) => a + b) / timeDiffs.length)
            : 0;

        patterns.push({
          dayOfWeek: day,
          bestHour,
          leadsContacted: dayLeads.length,
          wonLeads,
          winRate,
          avgTimeToContact,
        });
      }

      return patterns.sort((a, b) => b.winRate - a.winRate);
    } catch (error) {
      console.error('Failed to get time patterns:', error);
      return [];
    }
  }

  /**
   * Generate AI-powered recommendation based on source performance
   * Returns actionable insight for scaling, cutting, or optimizing sources
   */
  async generateSourceRecommendation(): Promise<string> {
    try {
      const topSources = await this.getTopSources(3);
      const bottomSources = await this.getBottomSources(2);
      const pitchPerf = await this.getPitchAnglePerformance();
      const timePatterns = await this.getTimePatterns();

      let recommendation = 'Based on your data:\n\n';

      // Top sources
      if (topSources.length > 0) {
        const best = topSources[0];
        recommendation += `📈 **SCALE UP**: ${best.source} (${best.winRate}% win rate). `;
        recommendation += `Your top source has produced ${best.won} wins from ${best.totalLeads} leads. `;
      }

      // Bottom sources
      if (bottomSources.length > 0) {
        const worst = bottomSources[0];
        if (worst.winRate < 10) {
          recommendation += `\n📉 **REDUCE**: ${worst.source} (${worst.winRate}% win rate). `;
          recommendation += `Consider cutting this low-yield source.\n`;
        }
      }

      // Best pitch angle
      if (pitchPerf.length > 0) {
        const bestPitch = pitchPerf[0];
        recommendation += `\n🎯 **BEST ANGLE**: "${bestPitch.pitchAngle}" converts at ${bestPitch.winRate}% `;
        recommendation += `on ${bestPitch.leadType} leads. ${bestPitch.insight}`;
      }

      // Best time to contact
      if (timePatterns.length > 0) {
        const bestDay = timePatterns[0];
        recommendation += `\n🕐 **BEST TIMING**: ${bestDay.dayOfWeek} at ${bestDay.bestHour}:00 `;
        recommendation += `(${bestDay.winRate}% win rate on that day).`;
      }

      return recommendation;
    } catch (error) {
      console.error('Failed to generate recommendation:', error);
      return 'Unable to generate recommendations at this time.';
    }
  }

  // ─── Internal Helpers ────────────────────────────────────────────────────────

  private calculateSourceMetrics(
    source: string,
    leads: HunterLead[]
  ): SourceMetrics {
    const contacted = leads.filter((l) =>
      [LeadStatus.CONTACTED, LeadStatus.QUOTED, LeadStatus.WON, LeadStatus.LOST].includes(l.status)
    ).length;
    const quoted = leads.filter((l) =>
      [LeadStatus.QUOTED, LeadStatus.WON, LeadStatus.LOST].includes(l.status)
    ).length;
    const won = leads.filter((l) => l.status === LeadStatus.WON).length;
    const lost = leads.filter((l) => l.status === LeadStatus.LOST).length;
    const deferred = leads.filter((l) => l.status === LeadStatus.DEFERRED).length;

    const winRate =
      won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 0;
    const conversionRate =
      leads.length > 0 ? Math.round((contacted / leads.length) * 100) : 0;

    const totalRevenue = leads
      .filter((l) => l.status === LeadStatus.WON)
      .reduce((sum, l) => sum + (l.estimated_value || 0), 0);
    const avgRevenuePerWon = won > 0 ? totalRevenue / won : 0;

    // Calculate average time to close (days from discovery to won)
    const closedLeads = leads.filter((l) =>
      [LeadStatus.WON, LeadStatus.LOST].includes(l.status)
    );
    let avgTimeToClose = 0;
    if (closedLeads.length > 0) {
      const totalDays = closedLeads.reduce((sum, l) => {
        const discovered = new Date(l.discovered_at || new Date()).getTime();
        const closed = new Date(l.last_updated || new Date()).getTime();
        return sum + (closed - discovered) / (1000 * 60 * 60 * 24);
      }, 0);
      avgTimeToClose = Math.round(totalDays / closedLeads.length);
    }

    // Estimate cost per lead (example: subscription $200/mo for 40 leads = $5 per lead)
    const costPerLead = Math.max(2, 200 / Math.max(leads.length, 1));
    const totalCost = leads.length * costPerLead;
    const roi =
      totalCost > 0 ? Math.round(((totalRevenue - totalCost) / totalCost) * 100) : 0;

    return {
      source,
      totalLeads: leads.length,
      contacted,
      quoted,
      won,
      lost,
      deferred,
      winRate,
      conversionRate,
      avgRevenuePerWon,
      totalRevenueFromSource: totalRevenue,
      avgTimeToClose,
      costPerLead,
      roi,
    };
  }

  private calculateTrend(
    leads: HunterLead[]
  ): 'improving' | 'declining' | 'stable' {
    if (leads.length < 10) return 'stable';

    const now = new Date();
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);

    const recent = leads.filter(
      (l) => new Date(l.discovered_at || 0) >= twoWeeksAgo
    );
    const older = leads.filter(
      (l) =>
        new Date(l.discovered_at || 0) >= fourWeeksAgo &&
        new Date(l.discovered_at || 0) < twoWeeksAgo
    );

    if (recent.length === 0 || older.length === 0) return 'stable';

    const recentWinRate =
      recent.filter((l) => l.status === LeadStatus.WON).length / recent.length;
    const olderWinRate =
      older.filter((l) => l.status === LeadStatus.WON).length / older.length;

    const diff = recentWinRate - olderWinRate;
    if (diff > 0.1) return 'improving';
    if (diff < -0.1) return 'declining';
    return 'stable';
  }

  private generateSourceInsight(source: string, metrics: SourceMetrics): string {
    if (metrics.winRate >= 40) {
      return `${source} is a high-performing source. Consider scaling investment.`;
    } else if (metrics.winRate >= 20) {
      return `${source} shows moderate performance. Worth optimizing.`;
    } else if (metrics.winRate > 0) {
      return `${source} has low win rate. Consider reviewing approach or cutting.`;
    } else {
      return `${source} has no wins yet. Need more leads or different messaging.`;
    }
  }

  private generatePitchInsight(
    pitchAngle: string,
    source: string,
    winRate: number
  ): string {
    if (winRate >= 40) {
      return `${pitchAngle} angle is highly effective on ${source} sources (${winRate}%).`;
    } else if (winRate >= 20) {
      return `${pitchAngle} performs moderately on ${source} (${winRate}%).`;
    } else {
      return `${pitchAngle} underperforms on ${source}. Try different angle.`;
    }
  }
}

export const hunterSourceAnalytics = new HunterSourceAnalyticsService();
export default hunterSourceAnalytics;
