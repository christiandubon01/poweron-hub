/**
 * src/components/hunter/HunterDebriefPanel.tsx
 * HUNTER Debrief UI Panel — HT7
 *
 * Appears after outcome logging.
 * Shows original lead card, outcome details, and Claude-extracted lessons.
 * Each lesson is an approval card with [APPROVE] [REJECT] [EDIT] buttons.
 * Study Queue sub-panel shows deferred lessons with "Review Now" button.
 */

import React, { useState, useEffect } from 'react';
import { HunterLead, DebriefsOutcome } from '@/services/hunter/HunterTypes';
import {
  startDebrief,
  approveRule,
  rejectRule,
  deferStudySession,
  getStudyQueue,
  RuleCandidate,
  StudyItem,
  HunterDebrief,
} from '@/services/hunter/HunterDebriefEngine';

export interface HunterDebriefPanelProps {
  lead: HunterLead;
  outcome: DebriefsOutcome;
  pitchScriptUsed?: string;
  outcomeDetails?: string;
  onDebriefComplete?: () => void;
  userId: string;
}

interface RuleCandidateUIState extends RuleCandidate {
  isEditing: boolean;
  editText: string;
}

export const HunterDebriefPanel: React.FC<HunterDebriefPanelProps> = ({
  lead,
  outcome: initialOutcome,
  pitchScriptUsed,
  outcomeDetails,
  onDebriefComplete,
  userId,
}) => {
  const outcome = initialOutcome;
  const [debrief, setDebrief] = useState<HunterDebrief | null>(null);
  const [ruleCandidates, setRuleCandidates] = useState<RuleCandidateUIState[]>([]);
  const [studyQueue, setStudyQueue] = useState<StudyItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'lessons' | 'queue'>('lessons');
  const [showStudyQueue, setShowStudyQueue] = useState(false);

  // Initialize debrief session on mount
  useEffect(() => {
    const initDebrief = async () => {
      setIsLoading(true);
      try {
        const debriefResult = await startDebrief(
          lead.id,
          outcome,
          pitchScriptUsed,
          outcomeDetails
        );
        setDebrief(debriefResult);

        // Convert rule candidates to UI state
        const uiCandidates: RuleCandidateUIState[] = debriefResult.rule_candidates.map(
          (candidate) => ({
            ...candidate,
            isEditing: false,
            editText: candidate.text,
          })
        );
        setRuleCandidates(uiCandidates);

        // Load study queue
        const queue = await getStudyQueue();
        setStudyQueue(queue);
      } catch (error) {
        console.error('Failed to initialize debrief:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initDebrief();
  }, [lead.id, outcome, pitchScriptUsed, outcomeDetails]);

  const handleApproveRule = async (candidateId: string) => {
    try {
      await approveRule(candidateId, userId);
      // Remove from UI
      setRuleCandidates((prev) => prev.filter((c) => c.id !== candidateId));
    } catch (error) {
      console.error('Failed to approve rule:', error);
    }
  };

  const handleRejectRule = async (candidateId: string) => {
    try {
      await rejectRule(candidateId);
      // Remove from UI
      setRuleCandidates((prev) => prev.filter((c) => c.id !== candidateId));
    } catch (error) {
      console.error('Failed to reject rule:', error);
    }
  };

  const handleEditRule = (candidateId: string) => {
    setRuleCandidates((prev) =>
      prev.map((c) => (c.id === candidateId ? { ...c, isEditing: true } : c))
    );
  };

  const handleSaveEdit = async (candidateId: string) => {
    const candidate = ruleCandidates.find((c) => c.id === candidateId);
    if (!candidate) return;

    try {
      // Approve with edited text
      await approveRule(candidateId, userId);
      setRuleCandidates((prev) => prev.filter((c) => c.id !== candidateId));
    } catch (error) {
      console.error('Failed to save edited rule:', error);
    }
  };

  const handleDeferRule = async (candidateId: string) => {
    try {
      await deferStudySession(candidateId);
      setRuleCandidates((prev) => prev.filter((c) => c.id !== candidateId));
      // Refresh study queue
      const queue = await getStudyQueue();
      setStudyQueue(queue);
    } catch (error) {
      console.error('Failed to defer rule:', error);
    }
  };

  const handleReviewStudyItem = async (studyItemId: string) => {
    // Navigate to study review (this would integrate with main app flow)
    // For now, just show a message
    alert(`Reviewing: ${studyItemId}`);
  };

  if (isLoading) {
    return (
      <div className="p-6 bg-gray-50 dark:bg-gray-900 rounded-lg">
        <div className="text-center text-gray-600 dark:text-gray-400">
          <div className="inline-block animate-spin">⚙️</div> Analyzing lead outcome...
        </div>
      </div>
    );
  }

  if (!debrief) {
    return (
      <div className="p-6 bg-gray-50 dark:bg-gray-900 rounded-lg">
        <p className="text-red-600">Failed to initialize debrief session</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 pb-4">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          Lead Debrief & Learning
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Outcome: <span className={outcome === DebriefsOutcome.WON ? 'text-green-600' : 'text-red-600'}>
            {outcome.toUpperCase()}
          </span>
        </p>
      </div>

      {/* Lead Card (Collapsed) */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">
              {lead.contact_name || 'Unknown Contact'}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {lead.company_name} • {lead.lead_type}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
              Score: {lead.score} ({lead.score_tier}) | Est. Value: ${lead.estimated_value || 0}
            </p>
          </div>
          <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${
            outcome === DebriefsOutcome.WON
              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
              : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
          }`}>
            {outcome === DebriefsOutcome.WON ? '✓ Won' : '✗ Lost'}
          </span>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setActiveTab('lessons')}
          className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
            activeTab === 'lessons'
              ? 'border-blue-500 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          }`}
        >
          Lessons ({ruleCandidates.length})
        </button>
        <button
          onClick={() => setActiveTab('queue')}
          className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
            activeTab === 'queue'
              ? 'border-blue-500 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          }`}
        >
          Study Queue ({studyQueue.length})
        </button>
      </div>

      {/* Lessons Tab */}
      {activeTab === 'lessons' && (
        <div className="space-y-4">
          {ruleCandidates.length === 0 ? (
            <div className="text-center py-8 text-gray-600 dark:text-gray-400">
              <p>No lessons extracted from this debrief.</p>
            </div>
          ) : (
            ruleCandidates.map((candidate) => (
              <div
                key={candidate.id}
                className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3"
              >
                {/* Rule Type Badge */}
                <div className="flex items-start justify-between">
                  <span className={`inline-block px-2 py-1 text-xs font-semibold rounded ${getRuleTypeBadgeColor(candidate.type)}`}>
                    {candidate.type.toUpperCase()}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    Confidence: {(candidate.confidence * 100).toFixed(0)}%
                  </span>
                </div>

                {/* Rule Text */}
                {candidate.isEditing ? (
                  <textarea
                    value={candidate.editText}
                    onChange={(e) =>
                      setRuleCandidates((prev) =>
                        prev.map((c) =>
                          c.id === candidate.id ? { ...c, editText: e.target.value } : c
                        )
                      )
                    }
                    className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded text-sm"
                    rows={3}
                  />
                ) : (
                  <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                    {candidate.text}
                  </p>
                )}

                {/* Action Buttons */}
                <div className="flex gap-2 flex-wrap">
                  {candidate.isEditing ? (
                    <>
                      <button
                        onClick={() => handleSaveEdit(candidate.id)}
                        className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
                      >
                        Save & Approve
                      </button>
                      <button
                        onClick={() =>
                          setRuleCandidates((prev) =>
                            prev.map((c) =>
                              c.id === candidate.id ? { ...c, isEditing: false } : c
                            )
                          )
                        }
                        className="px-3 py-1 bg-gray-300 dark:bg-gray-600 text-gray-900 dark:text-white text-sm rounded hover:bg-gray-400 dark:hover:bg-gray-700 transition-colors"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => handleApproveRule(candidate.id)}
                        className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 transition-colors"
                      >
                        ✓ Approve
                      </button>
                      <button
                        onClick={() => handleRejectRule(candidate.id)}
                        className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700 transition-colors"
                      >
                        ✗ Reject
                      </button>
                      <button
                        onClick={() => handleEditRule(candidate.id)}
                        className="px-3 py-1 bg-yellow-600 text-white text-sm rounded hover:bg-yellow-700 transition-colors"
                      >
                        ✎ Edit
                      </button>
                      <button
                        onClick={() => handleDeferRule(candidate.id)}
                        className="px-3 py-1 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 transition-colors"
                      >
                        ⏱ Study Later
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))
          )}

          {ruleCandidates.length > 0 && (
            <button
              onClick={onDebriefComplete}
              className="w-full py-2 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors font-medium"
            >
              Done Reviewing Lessons
            </button>
          )}
        </div>
      )}

      {/* Study Queue Tab */}
      {activeTab === 'queue' && (
        <div className="space-y-4">
          {studyQueue.length === 0 ? (
            <div className="text-center py-8 text-gray-600 dark:text-gray-400">
              <p>Study queue is empty. No deferred lessons yet.</p>
            </div>
          ) : (
            studyQueue.map((item) => (
              <div
                key={item.id}
                className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3"
              >
                <div className="flex items-start justify-between">
                  <span className={`inline-block px-2 py-1 text-xs font-semibold rounded ${getRuleTypeBadgeColor(item.rule_type)}`}>
                    {item.rule_type.toUpperCase()}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {new Date(item.deferred_at).toLocaleDateString()}
                  </span>
                </div>

                <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                  {item.rule_text}
                </p>

                <button
                  onClick={() => handleReviewStudyItem(item.id)}
                  className="px-3 py-1 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 transition-colors"
                >
                  Review Now
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Helper: Get badge color by rule type
 */
function getRuleTypeBadgeColor(ruleType: string): string {
  const colorMap: Record<string, string> = {
    pitch: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    suppression: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    urgency: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
    objection: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    source: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200',
    timing: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
  };
  return colorMap[ruleType] || 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
}

export default HunterDebriefPanel;
