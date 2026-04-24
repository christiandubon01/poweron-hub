import React, { useState } from 'react';
import type { HunterLead } from '@/services/hunter/HunterTypes';
import { LeadStatus } from '@/services/hunter/HunterTypes';
import { useHunterStore } from '@/store/hunterStore';

export interface LostDebriefModalProps {
  lead: HunterLead;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

/**
 * Text-mode debrief capture shown when operator marks a lead as Lost.
 * Writes full-shape row to hunter_debriefs (canonical per D0 decision)
 * then updates lead status to 'lost'. Modal closes on success.
 * Nexus voice integration comes in Track D later; this is text-only.
 */
export function LostDebriefModal({ lead, isOpen, onClose, onSaved }: LostDebriefModalProps) {
  const [whatHappened, setWhatHappened] = useState('');
  const [lessonInput, setLessonInput] = useState('');
  const [lessons, setLessons] = useState<string[]>([]);
  const [wentWithCompetitor, setWentWithCompetitor] = useState(false);
  const [competitorName, setCompetitorName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveDebrief = useHunterStore((s) => s.saveDebrief);
  const updateLeadStatus = useHunterStore((s) => s.updateLeadStatus);

  if (!isOpen) return null;

  const addLesson = () => {
    const trimmed = lessonInput.trim();
    if (!trimmed) return;
    setLessons([...lessons, trimmed]);
    setLessonInput('');
  };

  const removeLesson = (idx: number) => {
    setLessons(lessons.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveDebrief(lead.id, 'lost', {
        transcript: whatHappened,
        lessons: lessons.length > 0 ? lessons : undefined,
        wentWithCompetitor,
        competitorName: wentWithCompetitor ? competitorName : undefined,
        factor_scores: (lead as any).score_factors || undefined,
        final_score: typeof lead.score === 'number' ? lead.score : undefined,
      });

      await updateLeadStatus(lead.id, LeadStatus.LOST);

      setSaving(false);
      onSaved?.();
      onClose();

      // Clear state for next open
      setWhatHappened('');
      setLessonInput('');
      setLessons([]);
      setWentWithCompetitor(false);
      setCompetitorName('');
    } catch (err: any) {
      setSaving(false);
      setError(err?.message || 'Failed to save debrief.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg max-w-xl w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <div>
            <h3 className="text-white font-bold text-lg">Mark as Lost</h3>
            <p className="text-gray-400 text-xs mt-1">Capture what happened so scoring improves next time</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="text-xs text-gray-500">
            Lead: <span className="text-gray-300">{(lead as any).contactName || (lead as any).contact_name || 'Unknown'}</span>
            {(lead as any).company_name && (
              <span className="text-gray-400"> &middot; {(lead as any).company_name}</span>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              What happened?
            </label>
            <textarea
              value={whatHappened}
              onChange={(e) => setWhatHappened(e.target.value)}
              placeholder="Quick notes on the call, why it didn't close..."
              rows={4}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Lessons learned <span className="text-gray-500 font-normal">(optional, press Enter to add)</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={lessonInput}
                onChange={(e) => setLessonInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addLesson();
                  }
                }}
                placeholder="e.g. 'Lead wanted 24/7 emergency — we don't offer it'"
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-emerald-500"
              />
              <button
                onClick={addLesson}
                type="button"
                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-sm"
              >
                Add
              </button>
            </div>
            {lessons.length > 0 && (
              <ul className="mt-2 space-y-1">
                {lessons.map((l, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs text-gray-300 bg-gray-800 px-2 py-1 rounded">
                    <span className="flex-1">&bull; {l}</span>
                    <button
                      onClick={() => removeLesson(i)}
                      type="button"
                      className="text-gray-500 hover:text-red-400"
                      aria-label="Remove lesson"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="pt-2 border-t border-gray-800">
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={wentWithCompetitor}
                onChange={(e) => setWentWithCompetitor(e.target.checked)}
                className="accent-emerald-500"
              />
              Went with a competitor
            </label>
            {wentWithCompetitor && (
              <input
                type="text"
                value={competitorName}
                onChange={(e) => setCompetitorName(e.target.value)}
                placeholder="Competitor name (optional)"
                className="mt-2 w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-emerald-500"
              />
            )}
          </div>

          {error && (
            <div className="bg-red-900/50 border border-red-700 rounded px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-700">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm text-gray-300 hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save & Mark Lost'}
          </button>
        </div>
      </div>
    </div>
  );
}
