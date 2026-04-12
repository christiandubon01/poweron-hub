/**
 * src/components/hunter/HunterRuleSetPanel.tsx
 * HUNTER Rule Set Management Panel — HT10
 *
 * Displays all permanent learned rules grouped by type.
 * Shows rule text, source lead, approval date, and version.
 * Owner can edit/archive any rule, add manual rules, search, and export.
 * Features:
 * - Rules grouped by type tabs with counts
 * - Full-text search across all rules
 * - Add manual rules with type selector
 * - Edit inline with version incrementing
 * - Archive/restore functionality
 * - Version history viewing
 * - Export to plain text
 */

import React, { useState, useEffect } from 'react';
import { HunterRule, RuleType, RuleStatus } from '@/services/hunter/HunterTypes';
import {
  fetchRules,
  addRule,
  editRule,
  archiveRule,
  restoreRule,
  searchRules,
  exportRules,
  getRuleStats,
  getRuleVersionHistory,
} from '@/services/hunter/HunterRuleService';
import { supabase } from '@/lib/supabase';

interface RuleSetUIState extends HunterRule {
  isEditing: boolean;
  editText: string;
  showHistory?: boolean;
}

interface RuleStats {
  totalActive: number;
  totalArchived: number;
  countByType: Record<RuleType, number>;
  lastUpdated: string | null;
}

export interface HunterRuleSetPanelProps {
  userId: string;
}

type RuleTypeFilter = 'all' | 'pitch' | 'suppression' | 'urgency' | 'objection' | 'source' | 'timing';
type SortBy = 'date_added' | 'type' | 'source_lead';

export const HunterRuleSetPanel: React.FC<HunterRuleSetPanelProps> = ({ userId }) => {
  const [rules, setRules] = useState<RuleSetUIState[]>([]);
  const [archivedRules, setArchivedRules] = useState<RuleSetUIState[]>([]);
  const [filteredRules, setFilteredRules] = useState<RuleSetUIState[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<RuleTypeFilter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('date_added');
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [stats, setStats] = useState<RuleStats | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRuleType, setNewRuleType] = useState<RuleType>(RuleType.PITCH);
  const [newRuleText, setNewRuleText] = useState('');
  const [isAddingRule, setIsAddingRule] = useState(false);

  // Load rules on mount
  useEffect(() => {
    const loadRules = async () => {
      setIsLoading(true);
      try {
        const allRules = await fetchRules(userId);

        const active: RuleSetUIState[] = allRules
          .filter((rule) => rule.status === RuleStatus.ACTIVE)
          .map((rule) => ({
            ...(rule as HunterRule),
            isEditing: false,
            editText: rule.rule_text,
            showHistory: false,
          }));

        const archived: RuleSetUIState[] = allRules
          .filter((rule) => rule.status === RuleStatus.ARCHIVED)
          .map((rule) => ({
            ...(rule as HunterRule),
            isEditing: false,
            editText: rule.rule_text,
            showHistory: false,
          }));

        setRules(active);
        setArchivedRules(archived);
        setLastUpdated(new Date().toISOString());

        // Load stats
        const ruleStats = await getRuleStats(userId);
        setStats(ruleStats);
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

  // Apply filters, search, and sorting
  useEffect(() => {
    let filtered = showArchived ? archivedRules : rules;

    // Filter by type
    if (filterType !== 'all') {
      filtered = filtered.filter((rule) => rule.rule_type === filterType);
    }

    // Filter by search term
    if (searchTerm) {
      filtered = filtered.filter((rule) =>
        rule.rule_text.toLowerCase().includes(searchTerm.toLowerCase()) ||
        rule.rule_type.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Sort
    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === 'date_added') {
        const dateA = new Date(a.created_at || a.updated_at || 0).getTime();
        const dateB = new Date(b.created_at || b.updated_at || 0).getTime();
        return dateB - dateA;
      } else if (sortBy === 'type') {
        return a.rule_type.localeCompare(b.rule_type);
      } else if (sortBy === 'source_lead') {
        return (a.source_lead_id || '').localeCompare(b.source_lead_id || '');
      }
      return 0;
    });

    setFilteredRules(sorted);
  }, [rules, archivedRules, filterType, searchTerm, sortBy, showArchived]);

  const handleEditRule = (ruleId: string) => {
    setRules((prev) =>
      prev.map((r) => (r.id === ruleId ? { ...r, isEditing: true } : r))
    );
  };

  const handleSaveEdit = async (ruleId: string) => {
    const rule = rules.find((r) => r.id === ruleId);
    if (!rule || rule.editText === rule.rule_text) return;

    try {
      const updated = await editRule(ruleId, rule.editText);
      if (!updated) {
        console.error('Failed to update rule');
        return;
      }

      // Update local state
      setRules((prev) =>
        prev.map((r) =>
          r.id === ruleId
            ? {
                ...r,
                rule_text: r.editText,
                isEditing: false,
                version: updated.version,
                updated_at: updated.updated_at,
              }
            : r
        )
      );
      setLastUpdated(new Date().toISOString());

      // Refresh stats
      const ruleStats = await getRuleStats(userId);
      setStats(ruleStats);
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
    if (!confirm('Archive this rule? It will no longer be active but can be restored.')) {
      return;
    }

    try {
      const success = await archiveRule(ruleId);
      if (!success) {
        console.error('Failed to archive rule');
        return;
      }

      // Move from active to archived
      const ruleToArchive = rules.find((r) => r.id === ruleId);
      if (ruleToArchive) {
        setRules((prev) => prev.filter((r) => r.id !== ruleId));
        setArchivedRules((prev) => [
          ...prev,
          { ...ruleToArchive, status: RuleStatus.ARCHIVED },
        ]);
      }

      setLastUpdated(new Date().toISOString());

      // Refresh stats
      const ruleStats = await getRuleStats(userId);
      setStats(ruleStats);
    } catch (error) {
      console.error('Error archiving rule:', error);
    }
  };

  const handleRestoreRule = async (ruleId: string) => {
    if (!confirm('Restore this rule to active status?')) {
      return;
    }

    try {
      const restored = await restoreRule(ruleId);
      if (!restored) {
        console.error('Failed to restore rule');
        return;
      }

      // Move from archived to active
      const ruleToRestore = archivedRules.find((r) => r.id === ruleId);
      if (ruleToRestore) {
        setArchivedRules((prev) => prev.filter((r) => r.id !== ruleId));
        setRules((prev) => [
          ...prev,
          { ...ruleToRestore, status: RuleStatus.ACTIVE },
        ]);
      }

      setLastUpdated(new Date().toISOString());

      // Refresh stats
      const ruleStats = await getRuleStats(userId);
      setStats(ruleStats);
    } catch (error) {
      console.error('Error restoring rule:', error);
    }
  };

  const handleAddRule = async () => {
    if (!newRuleText.trim()) {
      alert('Please enter rule text');
      return;
    }

    setIsAddingRule(true);
    try {
      const newRule = await addRule(userId, newRuleType, newRuleText.trim());
      if (!newRule) {
        console.error('Failed to add rule');
        setIsAddingRule(false);
        return;
      }

      // Add to local state
      setRules((prev) => [
        {
          ...newRule,
          isEditing: false,
          editText: newRule.rule_text,
          showHistory: false,
        },
        ...prev,
      ]);

      // Reset form
      setNewRuleText('');
      setNewRuleType(RuleType.PITCH);
      setShowAddForm(false);
      setLastUpdated(new Date().toISOString());

      // Refresh stats
      const ruleStats = await getRuleStats(userId);
      setStats(ruleStats);
    } catch (error) {
      console.error('Error adding rule:', error);
    } finally {
      setIsAddingRule(false);
    }
  };

  const handleExportRules = async () => {
    try {
      const text = await exportRules(userId);
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `hunter-rules-${new Date().toISOString().split('T')[0]}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting rules:', error);
      alert('Failed to export rules');
    }
  };

  const handleToggleHistory = async (ruleId: string) => {
    setRules((prev) =>
      prev.map((r) =>
        r.id === ruleId ? { ...r, showHistory: !r.showHistory } : r
      )
    );
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

  const sortOptions: Array<{ value: SortBy; label: string }> = [
    { value: 'date_added', label: 'Date Added (Newest)' },
    { value: 'type', label: 'Rule Type' },
    { value: 'source_lead', label: 'Source Lead' },
  ];

  const groupedRules = groupRulesByType(filteredRules);

  const getTypeCount = (type: RuleType): number => {
    return (stats?.countByType[type] || 0);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              Learned Rules
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {stats?.totalActive || 0} active • {stats?.totalArchived || 0} archived
              {lastUpdated && ` • Last updated ${formatTime(lastUpdated)}`}
            </p>
          </div>
          <button
            onClick={handleExportRules}
            className="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700 transition-colors"
            title="Export all active rules as plain text"
          >
            📥 Export Rules
          </button>
        </div>
      </div>

      {/* Tabs for Active/Archived */}
      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setShowArchived(false)}
          className={`px-4 py-2 font-medium text-sm transition-colors ${
            !showArchived
              ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
          }`}
        >
          Active Rules ({stats?.totalActive || 0})
        </button>
        <button
          onClick={() => setShowArchived(true)}
          className={`px-4 py-2 font-medium text-sm transition-colors ${
            showArchived
              ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
          }`}
        >
          Archived Rules ({stats?.totalArchived || 0})
        </button>
      </div>

      {/* Add Rule Button (only show on Active tab) */}
      {!showArchived && (
        <div>
          {!showAddForm ? (
            <button
              onClick={() => setShowAddForm(true)}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
            >
              ➕ Add Manual Rule
            </button>
          ) : (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 space-y-3">
              <h3 className="font-semibold text-gray-900 dark:text-white">Add New Rule</h3>

              <select
                value={newRuleType}
                onChange={(e) => setNewRuleType(e.target.value as RuleType)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {ruleTypeOptions.slice(1).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <textarea
                value={newRuleText}
                onChange={(e) => setNewRuleText(e.target.value)}
                placeholder="Enter rule text..."
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
              />

              <div className="flex gap-2">
                <button
                  onClick={handleAddRule}
                  disabled={isAddingRule}
                  className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {isAddingRule ? '⏳ Saving...' : '✓ Save Rule'}
                </button>
                <button
                  onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 bg-gray-300 dark:bg-gray-600 text-gray-900 dark:text-white text-sm rounded hover:bg-gray-400 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Search and Filter Controls */}
      <div className="space-y-3">
        {/* Search */}
        <input
          type="text"
          placeholder="Search rules by text or type..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {/* Filter and Sort Dropdowns */}
        <div className="grid grid-cols-2 gap-3">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as RuleTypeFilter)}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          >
            {ruleTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
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
          <p>{showArchived ? 'No archived rules.' : 'No active rules. Add one to get started!'}</p>
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
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className={`inline-block px-2 py-1 text-xs font-semibold rounded ${getRuleTypeBadgeColor(rule.rule_type)}`}>
                          {rule.rule_type.toUpperCase()}
                        </span>
                        <button
                          onClick={() => handleToggleHistory(rule.id)}
                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                          title="View version history"
                        >
                          v{rule.version} {rule.showHistory ? '▾' : '▸'}
                        </button>
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
                        {rule.source_lead_id && (
                          <p>Source: <span className="font-medium">{rule.source_lead_id}</span></p>
                        )}
                        {rule.created_at && (
                          <p>Approved: {new Date(rule.created_at).toLocaleDateString()}</p>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap text-right">
                      Updated {formatTime(rule.updated_at || rule.created_at || '')}
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

                  {/* Version History (if shown) */}
                  {rule.showHistory && (
                    <div className="bg-gray-50 dark:bg-gray-700/50 rounded p-3 text-xs space-y-1">
                      <p className="font-semibold text-gray-700 dark:text-gray-300">Version History:</p>
                      <p className="text-gray-600 dark:text-gray-400">v{rule.version}: {new Date(rule.updated_at || '').toLocaleDateString()}</p>
                      <p className="text-gray-500 dark:text-gray-500 italic">(Full version history table would require hunter_rule_history table)</p>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-2 flex-wrap">
                    {rule.isEditing ? (
                      <>
                        <button
                          onClick={() => handleSaveEdit(rule.id)}
                          className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
                        >
                          ✓ Save
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
                        {!showArchived && (
                          <>
                            <button
                              onClick={() => handleEditRule(rule.id)}
                              className="px-3 py-1 bg-yellow-600 text-white text-sm rounded hover:bg-yellow-700 transition-colors"
                            >
                              ✎ Edit
                            </button>
                            <button
                              onClick={() => handleArchiveRule(rule.id)}
                              className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700 transition-colors"
                            >
                              📦 Archive
                            </button>
                          </>
                        )}
                        {showArchived && (
                          <button
                            onClick={() => handleRestoreRule(rule.id)}
                            className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 transition-colors"
                          >
                            ↩️ Restore
                          </button>
                        )}
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
