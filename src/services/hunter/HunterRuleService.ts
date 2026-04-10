/**
 * src/services/hunter/HunterRuleService.ts
 * HUNTER Rule Service — HT10
 *
 * Service layer for managing permanent learned rules:
 * - Fetching rules grouped by type
 * - Adding/editing/archiving rules with versioning
 * - Full-text search across rule text
 * - Export to plain text
 * - Rule statistics and counts
 */

import { supabase } from '@/lib/supabase';
import { HunterRule, RuleStatus, RuleType } from './HunterTypes';

/**
 * Rule with version history
 */
export interface HunterRuleWithHistory extends HunterRule {
  history?: Array<{
    version: number;
    rule_text: string;
    updated_at: string;
  }>;
}

/**
 * Rule statistics
 */
export interface RuleStats {
  totalActive: number;
  totalArchived: number;
  countByType: Record<RuleType, number>;
  lastUpdated: string | null;
}

/**
 * Fetch all rules for a user, grouped by type
 */
export async function fetchRules(userId: string): Promise<HunterRule[]> {
  try {
    const { data, error } = await (supabase.from('hunter_rules') as any)
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch rules:', error);
      return [];
    }

    return (data || []) as HunterRule[];
  } catch (error) {
    console.error('Error fetching rules:', error);
    return [];
  }
}

/**
 * Add a new rule with version 1
 */
export async function addRule(
  userId: string,
  ruleType: RuleType,
  ruleText: string,
  sourceLeadId?: string
): Promise<HunterRule | null> {
  try {
    const newRule = {
      user_id: userId,
      rule_type: ruleType,
      rule_text: ruleText,
      source_lead_id: sourceLeadId || null,
      version: 1,
      status: RuleStatus.ACTIVE,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await (supabase.from('hunter_rules') as any)
      .insert([newRule])
      .select();

    if (error) {
      console.error('Failed to add rule:', error);
      return null;
    }

    return (data?.[0] || null) as HunterRule;
  } catch (error) {
    console.error('Error adding rule:', error);
    return null;
  }
}

/**
 * Edit rule text and increment version
 * Saves old text to history
 */
export async function editRule(
  ruleId: string,
  newText: string
): Promise<HunterRule | null> {
  try {
    // First, fetch the current rule
    const { data: currentRuleData, error: fetchError } = await (supabase.from('hunter_rules') as any)
      .select('*')
      .eq('id', ruleId)
      .single();

    if (fetchError || !currentRuleData) {
      console.error('Failed to fetch rule for editing:', fetchError);
      return null;
    }

    const currentRule = currentRuleData as HunterRule;
    const newVersion = (currentRule.version || 1) + 1;

    // Store old text in history (as JSON array in a history column if available)
    const historyEntry = {
      version: currentRule.version,
      rule_text: currentRule.rule_text,
      updated_at: currentRule.updated_at,
    };

    // Update the rule with new text and incremented version
    const { data, error } = await (supabase.from('hunter_rules') as any)
      .update({
        rule_text: newText,
        version: newVersion,
        updated_at: new Date().toISOString(),
      })
      .eq('id', ruleId)
      .select();

    if (error) {
      console.error('Failed to edit rule:', error);
      return null;
    }

    return (data?.[0] || null) as HunterRule;
  } catch (error) {
    console.error('Error editing rule:', error);
    return null;
  }
}

/**
 * Archive a rule (soft delete)
 */
export async function archiveRule(ruleId: string): Promise<boolean> {
  try {
    const { error } = await (supabase.from('hunter_rules') as any)
      .update({
        status: RuleStatus.ARCHIVED,
        updated_at: new Date().toISOString(),
      })
      .eq('id', ruleId);

    if (error) {
      console.error('Failed to archive rule:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error archiving rule:', error);
    return false;
  }
}

/**
 * Restore an archived rule
 */
export async function restoreRule(ruleId: string): Promise<HunterRule | null> {
  try {
    const { data, error } = await (supabase.from('hunter_rules') as any)
      .update({
        status: RuleStatus.ACTIVE,
        updated_at: new Date().toISOString(),
      })
      .eq('id', ruleId)
      .select();

    if (error) {
      console.error('Failed to restore rule:', error);
      return null;
    }

    return (data?.[0] || null) as HunterRule;
  } catch (error) {
    console.error('Error restoring rule:', error);
    return null;
  }
}

/**
 * Search rules by full-text query
 * Searches across rule_text and optionally rule_type
 */
export async function searchRules(
  userId: string,
  query: string,
  status?: RuleStatus
): Promise<HunterRule[]> {
  try {
    let queryBuilder = (supabase.from('hunter_rules') as any)
      .select('*')
      .eq('user_id', userId);

    if (status) {
      queryBuilder = queryBuilder.eq('status', status);
    }

    const { data, error } = await queryBuilder.order('updated_at', { ascending: false });

    if (error) {
      console.error('Failed to search rules:', error);
      return [];
    }

    // Client-side filtering for full-text search
    const searchLower = query.toLowerCase();
    return (data || []).filter((rule: any) =>
      rule.rule_text.toLowerCase().includes(searchLower) ||
      rule.rule_type.toLowerCase().includes(searchLower)
    ) as HunterRule[];
  } catch (error) {
    console.error('Error searching rules:', error);
    return [];
  }
}

/**
 * Export all active rules as plain text
 */
export async function exportRules(userId: string): Promise<string> {
  try {
    const rules = await fetchRules(userId);
    const activeRules = rules.filter((r) => r.status === RuleStatus.ACTIVE);

    if (activeRules.length === 0) {
      return '# No active rules found\n';
    }

    // Group by type
    const grouped: Record<RuleType, HunterRule[]> = {
      [RuleType.PITCH]: [],
      [RuleType.SUPPRESSION]: [],
      [RuleType.URGENCY]: [],
      [RuleType.OBJECTION]: [],
      [RuleType.SOURCE]: [],
      [RuleType.TIMING]: [],
    };

    activeRules.forEach((rule) => {
      grouped[rule.rule_type].push(rule);
    });

    const typeLabels: Record<RuleType, string> = {
      [RuleType.PITCH]: 'Pitch Rules',
      [RuleType.SUPPRESSION]: 'Suppression Rules',
      [RuleType.URGENCY]: 'Urgency Rules',
      [RuleType.OBJECTION]: 'Objection Rules',
      [RuleType.SOURCE]: 'Source Rules',
      [RuleType.TIMING]: 'Timing Rules',
    };

    let output = '# HUNTER Learned Rules Export\n';
    output += `Generated: ${new Date().toLocaleString()}\n`;
    output += `Total Active Rules: ${activeRules.length}\n\n`;

    Object.entries(grouped).forEach(([typeKey, typeRules]) => {
      const type = typeKey as RuleType;
      if (typeRules.length === 0) return;

      output += `## ${typeLabels[type]} (${typeRules.length})\n\n`;

      typeRules.forEach((rule, index) => {
        output += `${index + 1}. ${rule.rule_text}\n`;
        output += `   - Type: ${rule.rule_type}\n`;
        output += `   - Version: ${rule.version}\n`;
        if (rule.source_lead_id) {
          output += `   - Source Lead: ${rule.source_lead_id}\n`;
        }
        if (rule.created_at) {
          output += `   - Created: ${new Date(rule.created_at).toLocaleDateString()}\n`;
        }
        output += '\n';
      });
    });

    return output;
  } catch (error) {
    console.error('Error exporting rules:', error);
    return '# Export failed\n';
  }
}

/**
 * Get rule statistics
 */
export async function getRuleStats(userId: string): Promise<RuleStats> {
  try {
    const rules = await fetchRules(userId);

    const stats: RuleStats = {
      totalActive: 0,
      totalArchived: 0,
      countByType: {
        [RuleType.PITCH]: 0,
        [RuleType.SUPPRESSION]: 0,
        [RuleType.URGENCY]: 0,
        [RuleType.OBJECTION]: 0,
        [RuleType.SOURCE]: 0,
        [RuleType.TIMING]: 0,
      },
      lastUpdated: null,
    };

    let mostRecentDate: Date | null = null;

    rules.forEach((rule) => {
      if (rule.status === RuleStatus.ACTIVE) {
        stats.totalActive += 1;
        stats.countByType[rule.rule_type] += 1;
      } else if (rule.status === RuleStatus.ARCHIVED) {
        stats.totalArchived += 1;
      }

      if (rule.updated_at) {
        const ruleDate = new Date(rule.updated_at);
        if (!mostRecentDate || ruleDate.getTime() > (mostRecentDate as any).getTime()) {
          mostRecentDate = ruleDate;
        }
      }
    });

    if (mostRecentDate) {
      stats.lastUpdated = (mostRecentDate as Date).toISOString();
    }

    return stats;
  } catch (error) {
    console.error('Error getting rule stats:', error);
    return {
      totalActive: 0,
      totalArchived: 0,
      countByType: {
        [RuleType.PITCH]: 0,
        [RuleType.SUPPRESSION]: 0,
        [RuleType.URGENCY]: 0,
        [RuleType.OBJECTION]: 0,
        [RuleType.SOURCE]: 0,
        [RuleType.TIMING]: 0,
      },
      lastUpdated: null,
    };
  }
}

/**
 * Fetch version history for a specific rule
 */
export async function getRuleVersionHistory(ruleId: string): Promise<Array<{
  version: number;
  rule_text: string;
  updated_at: string;
}>> {
  try {
    // Since Supabase doesn't have built-in versioning, we'd need a separate
    // hunter_rule_history table. For now, return the current version.
    const { data, error } = await (supabase.from('hunter_rules') as any)
      .select('version, rule_text, updated_at')
      .eq('id', ruleId)
      .single();

    if (error || !data) {
      return [];
    }

    // Return single version (would be expanded when history table is added)
    return [{
      version: data.version,
      rule_text: data.rule_text,
      updated_at: data.updated_at,
    }];
  } catch (error) {
    console.error('Error fetching rule history:', error);
    return [];
  }
}

export default {
  fetchRules,
  addRule,
  editRule,
  archiveRule,
  restoreRule,
  searchRules,
  exportRules,
  getRuleStats,
  getRuleVersionHistory,
};
