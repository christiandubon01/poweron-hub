/**
 * src/components/hunter/HunterRuleSetPanel.tsx
 * HUNTER Rule Set Management Panel — HT7
 *
 * Displays all permanent learned rules grouped by type.
 * Shows rule text, source lead, approval date, and version.
 * Owner can edit or archive any rule.
 */

import React, { useState, useEffect } from 'react';
import { HunterRule, RuleType, RuleStatus } from '@/services/hunter/HunterTypes';
import { supabase } from '@/lib/supabase';

interface RuleSetUIState extends HunterRule {
  isEditing: boolean;
  editText: string;
}

export interface HunterRuleSetPanelProps {
  userId: string;
}

type RuleTypeFilter = 'all' | 'pitch' | 'suppression' | 'urgency' | 'objection' | 'source' | 'timing';

export const HunterRuleSetPanel: React.FC<HunterRuleSetPanelProps> = ({ userId }) => {
  const [rules, setRules] = useState<RuleSetUIState[]>([]);
  const [filteredRules, setFilteredRules] = useState<RuleSetUIState[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<RuleTypeFilter>('all');
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // Load rules on mount
  useEffect(() => {
    const loadRules = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await (supabase.from('hunter_rules') as any)
          .select('*')
          .eq('user_id', userId)
          .eq('status', RuleStatus.ACTIVE)
          .order('updated_at', { ascending: false });

        if (error) {
          console.error('Failed to fetch rules:', error);
          return;
        }

        const rulesWithUI: RuleSetUIState[] = (data || []).map((rule: any) => ({
          ...(rule as HunterRule),
          isEditing: false,
          editText: rule.rule_text,
        }));

        setRules(rulesWithUI);
        setLastUpdated(new Date().toISOString());
      } catch (error) {
        console.error('Error loading rules:', error);
      } finally {
        setIsLoading(false);
      }
    };

    if (userId) {
      loadRules();
    }
  }, [userId]);

  // Apply filters and search
  useEffect(() => {
    let filtered = rules;

    // Filter by type
    if (filterType !== 'all') {
      filtered = filtered.filter((rule) => rule.rule_type === filterType);
    }

    // Filter by search term
    if (searchTerm) {
      filtered = filtered.filter((rule) =>
        rule.rule_text.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    setFilteredRules(filtered);
  }, [rules, filterType, searchTerm]);

  const handleEditRule = (ruleId: string) => {
    setRules((prev) =>
      prev.map((r) => (r.id === ruleId ? { ...r, isEditing: true } : r))
    );
  };

  const handleSaveEdit = async (ruleId: string) => {
    const rule = rules.find((r) => r.id === ruleId);
    if (!rule) return;

    try {
      const { error } = await (supabase.from('hunter_rules') as any)
        .update({
          rule_text: rule.editText,
          updated_at: new Date().toISOString(),
        })
        .eq('id', ruleId);

      if (error) {
        console.error('Failed to update rule:', error);
        return;
      }

      // Update local state
      setRules((prev) =>
        prev.map((r) =>
          r.id === ruleId
            ? { ...r, rule_text: r.editText, isEditing: false }
            : r
        )
      );
      setLastUpdated(new Date().toISOString());
    } catch (error) {
      console.error('Error saving rule:', error);
    }
  };

  const handleCancelEdit = (ruleId: string) => {
    setRules((prev) =>
      prev.map((r) =>
        r.id === ruleId
          ? { ...r, isEditing: false, editText: r.rule_text }
          : r
      )
    );
  };

  const handleArchiveRule = async (ruleId: string) => {
    if (!confirm('Archive this rule? It will no longer be active.')) {
      return;
    }

    try {
      const { error } = await (supabase.from('hunter_rules') as any)
        .update({
          status: RuleStatus.ARCHIVED,
          updated_at: new Date().toISOString(),
        })
        .eq('id', ruleId);

      if (error) {
        console.error('Failed to archive rule:', error);
        return;
      }

      // Remove from local state
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
      setLastUpdated(new Date().toISOString());
    } catch (error) {
      console.error('Error archiving rule:', error);
    }
  };

  const ruleTypeOptions: Array<{ value: RuleTypeFilter; label: string }> = [
    { value: 'all', label: 'All Types' },
    { value: RuleType.PITCH, label: 'Pitch' },
    { value: RuleType.SUPPRESSION, label: 'Suppression' },
    { value: RuleType.URGENCY, label: 'Urgency' },
    { value: RuleType.OBJECTION, label: 'Objection' },
    { value: RuleType.SOURCE, label: 'Source' },
    { value: RuleType.TIMING, label: 'Timing' },
  ];

  const groupedRules = groupRulesByType(filteredRules);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 pb-4">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          Learned Rules
        </h2>
        <div className="flex items-center justify-between mt-2">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {filteredRules.length} active {filteredRules.length === 1 ? 'rule' : 'rules'}
            {lastUpdated && ` • Last updated ${formatTime(lastUpdated)}`}
          </p>
        </div>
      </div>

      {/* Search and Filter Controls */}
      <div className="space-y-3">
        {/* Search */}
        <input
          type="text"
          placeholder="Search rules..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {/* Filter Dropdown */}
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as RuleTypeFilter)}
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {ruleTypeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="text-center py-8 text-gray-600 dark:text-gray-400">
          <div className="inline-block animate-spin">⚙️</div> Loading rules...
        </div>
      )}

      {/* Rules by Type */}
      {!isLoading && filteredRules.length === 0 ? (
        <div className="text-center py-8 text-gray-600 dark:text-gray-400">
          <p>No rules match your search.</p>
        </div>
      ) : (
        Object.entries(groupedRules).map(([typeLabel, typeRules]) => (
          <div key={typeLabel}>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
              {typeLabel} ({typeRules.length})
            </h3>

            <div className="space-y-3">
              {typeRules.map((rule) => (
                <div
                  key={rule.id}
                  className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3"
                >
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`inline-block px-2 py-1 text-xs font-semibold rounded ${getRuleTypeBadgeColor(rule.rule_type)}`}>
                          {rule.rule_type.toUpperCase()}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          v{rule.version}
                        </span>
                      </div>
                      {rule.source_lead_id && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Source: {rule.source_lead_id}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {new Date(rule.created_at || '').toLocaleDateString()}
                    </span>
                  </div>

                  {/* Rule Text */}
                  {rule.isEditing ? (
                    <textarea
                      value={rule.editText}
                      onChange={(e) =>
                        setRules((prev) =>
                          prev.map((r) =>
                            r.id === rule.id ? { ...r, editText: e.target.value } : r
                          )
                        )
                      }
                      className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded text-sm"
                      rows={3}
                    />
                  ) : (
                    <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                      {rule.rule_text}
                    </p>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-2 flex-wrap">
                    {rule.isEditing ? (
                      <>
                        <button
                          onClick={() => handleSaveEdit(rule.id)}
                          className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => handleCancelEdit(rule.id)}
                          className="px-3 py-1 bg-gray-300 dark:bg-gray-600 text-gray-900 dark:text-white text-sm rounded hover:bg-gray-400 dark:hover:bg-gray-700 transition-colors"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleEditRule(rule.id)}
                          className="px-3 py-1 bg-yellow-600 text-white text-sm rounded hover:bg-yellow-700 transition-colors"
                        >
                          ✎ Edit
                        </button>
                        <button
                          onClick={() => handleArchiveRule(rule.id)}
                          className="px-3 py-1 bg-gray-600 text-white text-sm rounded hover:bg-gray-700 transition-colors"
                        >
                          Archive
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
};

/**
 * Group rules by type with proper labels
 */
function groupRulesByType(rules: RuleSetUIState[]): Record<string, RuleSetUIState[]> {
  const typeLabels: Record<RuleType, string> = {
    pitch: 'Pitch Rules',
    suppression: 'Suppression Rules',
    urgency: 'Urgency Rules',
    objection: 'Objection Rules',
    source: 'Source Rules',
    timing: 'Timing Rules',
  };

  const grouped: Record<string, RuleSetUIState[]> = {};

  rules.forEach((rule) => {
    const label = typeLabels[rule.rule_type];
    if (!grouped[label]) {
      grouped[label] = [];
    }
    grouped[label].push(rule);
  });

  return grouped;
}

/**
 * Helper: Get badge color by rule type
 */
function getRuleTypeBadgeColor(ruleType: RuleType): string {
  const colorMap: Record<RuleType, string> = {
    pitch: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    suppression: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    urgency: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
    objection: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    source: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200',
    timing: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
  };
  return colorMap[ruleType] || 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
}

/**
 * Helper: Format timestamp for display
 */
function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

export default HunterRuleSetPanel;
