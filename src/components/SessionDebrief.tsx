/**
 * src/components/SessionDebrief.tsx
 * V3-32 — Session Debrief UI
 *
 * Slide-up panel rendered when NEXUS triggers a debrief at session end.
 * - Not a modal: does not block the dashboard
 * - Shows extracted conclusions as editable cards
 * - Save & Close / Skip action bar
 * - Responsive: full-width on mobile, 60% centered on desktop
 */

import { useState, useEffect, useCallback } from 'react';
import { X, Edit2, Trash2, Plus, Check } from 'lucide-react';
import {
  saveConclusions,
  type ConclusionItem,
} from '../services/sessionConclusionService';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SessionDebriefProps {
  /** Whether the debrief panel is open */
  isOpen: boolean;
  /** Conclusions extracted by NEXUS from the session */
  conclusions: ConclusionItem[];
  /** User ID for saving conclusions */
  userId: string;
  /** Session ID for saving conclusions */
  sessionId: string;
  /** Called after the panel closes (whether saved or skipped) */
  onClose: () => void;
}

// ─── EditableConclusion — local state for each card ───────────────────────────

interface EditableConclusion extends ConclusionItem {
  _localId: string;
  _editing: boolean;
  _draft: string;
}

function makeEditable(item: ConclusionItem, idx: number): EditableConclusion {
  return {
    ...item,
    _localId: `c-${Date.now()}-${idx}`,
    _editing: false,
    _draft: item.text,
  };
}

// ─── ConclusionCard ───────────────────────────────────────────────────────────

function ConclusionCard({
  item,
  onEdit,
  onDelete,
  onSaveDraft,
  onCancelDraft,
  onDraftChange,
}: {
  item: EditableConclusion;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onSaveDraft: (id: string) => void;
  onCancelDraft: (id: string) => void;
  onDraftChange: (id: string, val: string) => void;
}) {
  return (
    <div
      className="rounded-lg border p-4 flex flex-col gap-3"
      style={{
        backgroundColor: '#0d1117',
        borderColor: '#1e2128',
        transition: 'border-color 0.15s',
      }}
    >
      {/* Badges */}
      <div className="flex flex-wrap gap-1.5">
        {item.projectId && (
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full border"
            style={{
              backgroundColor: '#052e1688',
              borderColor: '#16a34a33',
              color: '#4ade80',
            }}
          >
            {item.projectId}
          </span>
        )}
        {item.block && (
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full border"
            style={{
              backgroundColor: '#1e1a2e88',
              borderColor: '#7c3aed44',
              color: '#c4b5fd',
            }}
          >
            {item.block}
          </span>
        )}
        {item.agentRefs.map((agent) => (
          <span
            key={agent}
            className="text-xs font-medium px-2 py-0.5 rounded-full border"
            style={{
              backgroundColor: '#1c1500',
              borderColor: '#92400e44',
              color: '#fbbf24',
            }}
          >
            {agent}
          </span>
        ))}
      </div>

      {/* Text / Edit mode */}
      {item._editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            className="w-full rounded-md border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1"
            style={{
              backgroundColor: '#0a0b0f',
              borderColor: '#2a2d38',
              color: '#e5e7eb',
              minHeight: '72px',
              // @ts-expect-error: CSS custom property
              '--tw-ring-color': '#16a34a',
            }}
            value={item._draft}
            onChange={(e) => onDraftChange(item._localId, e.target.value)}
            autoFocus
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => onCancelDraft(item._localId)}
              className="text-xs px-3 py-1.5 rounded-md border transition-colors hover:bg-gray-800/60"
              style={{ borderColor: '#2a2d38', color: '#6b7280' }}
            >
              Cancel
            </button>
            <button
              onClick={() => onSaveDraft(item._localId)}
              className="text-xs px-3 py-1.5 rounded-md border transition-colors flex items-center gap-1"
              style={{
                backgroundColor: '#052e16',
                borderColor: '#16a34a44',
                color: '#4ade80',
              }}
            >
              <Check size={11} />
              Save
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-200 leading-relaxed">{item.text}</p>
      )}

      {/* Actions */}
      {!item._editing && (
        <div className="flex gap-2 justify-end">
          <button
            onClick={() => onEdit(item._localId)}
            className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border transition-colors hover:bg-gray-800/60"
            style={{ borderColor: '#2a2d38', color: '#9ca3af' }}
            title="Edit conclusion"
          >
            <Edit2 size={11} />
            Edit
          </button>
          <button
            onClick={() => onDelete(item._localId)}
            className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border transition-colors"
            style={{ borderColor: '#7f1d1d44', color: '#f87171' }}
            onMouseOver={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.backgroundColor = '#7f1d1d22')
            }
            onMouseOut={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent')
            }
            title="Remove conclusion"
          >
            <Trash2 size={11} />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

// ─── SessionDebrief ───────────────────────────────────────────────────────────

export default function SessionDebrief({
  isOpen,
  conclusions: initialConclusions,
  userId,
  sessionId,
  onClose,
}: SessionDebriefProps) {
  const [items, setItems] = useState<EditableConclusion[]>([]);
  const [visible, setVisible] = useState(false);
  const [skipConfirm, setSkipConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  // Sync items when opened
  useEffect(() => {
    if (isOpen) {
      setItems(initialConclusions.map(makeEditable));
      setSkipConfirm(false);
      // Slight delay so CSS transition plays on mount
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [isOpen, initialConclusions]);

  // ── Card mutations ──────────────────────────────────────────────────────────

  const handleEdit = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((it) =>
        it._localId === id ? { ...it, _editing: true, _draft: it.text } : it,
      ),
    );
  }, []);

  const handleDraftChange = useCallback((id: string, val: string) => {
    setItems((prev) =>
      prev.map((it) => (it._localId === id ? { ...it, _draft: val } : it)),
    );
  }, []);

  const handleSaveDraft = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((it) =>
        it._localId === id
          ? { ...it, text: it._draft.trim() || it.text, _editing: false }
          : it,
      ),
    );
  }, []);

  const handleCancelDraft = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((it) => (it._localId === id ? { ...it, _editing: false, _draft: it.text } : it)),
    );
  }, []);

  const handleDelete = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it._localId !== id));
  }, []);

  const handleAddNew = useCallback(() => {
    const newItem: EditableConclusion = {
      text: '',
      agentRefs: [],
      _localId: `c-new-${Date.now()}`,
      _editing: true,
      _draft: '',
    };
    setItems((prev) => [...prev, newItem]);
  }, []);

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function handleSaveAndClose() {
    setSaving(true);
    try {
      const finalItems: ConclusionItem[] = items
        .filter((it) => it.text.trim())
        .map(({ text, block, projectId, agentRefs }) => ({
          text,
          block,
          projectId,
          agentRefs,
        }));
      if (finalItems.length) {
        await saveConclusions(userId, sessionId, finalItems);
      }
    } catch (err) {
      console.error('[SessionDebrief] saveConclusions error:', err);
    } finally {
      setSaving(false);
      doClose();
    }
  }

  function handleSkip() {
    if (!skipConfirm) {
      setSkipConfirm(true);
      return;
    }
    doClose();
  }

  function doClose() {
    setVisible(false);
    // Wait for slide-down animation before unmounting
    setTimeout(onClose, 300);
  }

  // ── Nothing to render ───────────────────────────────────────────────────────
  if (!isOpen) return null;

  const hasConclusions = initialConclusions.length > 0;

  return (
    <>
      {/* ── Dim overlay ───────────────────────────────────────────────────── */}
      <div
        className="fixed inset-0 z-40"
        style={{
          backgroundColor: 'rgba(0,0,0,0.45)',
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.3s ease',
          pointerEvents: visible ? 'auto' : 'none',
        }}
        onClick={handleSkip}
        aria-hidden="true"
      />

      {/* ── Slide-up panel ────────────────────────────────────────────────── */}
      <div
        role="dialog"
        aria-modal="false"
        aria-label="Session debrief"
        className="fixed bottom-0 left-0 right-0 z-50 flex justify-center"
        style={{ pointerEvents: 'none' }}
      >
        <div
          className="w-full flex flex-col rounded-t-2xl border-t border-x shadow-2xl overflow-hidden"
          style={{
            // Mobile: full-width; Desktop: 60% centered
            maxWidth: 'min(100vw, 720px)',
            maxHeight: '80vh',
            backgroundColor: '#0d0e14',
            borderColor: '#1e2128',
            transform: visible ? 'translateY(0)' : 'translateY(100%)',
            transition: 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
            pointerEvents: 'auto',
          }}
        >
          {/* ── Header ──────────────────────────────────────────────────── */}
          <div
            className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0"
            style={{ borderColor: '#1e2128' }}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: '#4ade80' }}
              />
              <h2 className="text-sm font-semibold text-gray-100">
                Before you go — here's what we landed on:
              </h2>
            </div>
            <button
              onClick={doClose}
              className="text-gray-600 hover:text-gray-400 transition-colors"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          {/* ── Body ────────────────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {!hasConclusions ? (
              /* Empty state */
              <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: '#052e16' }}
                >
                  <Check size={18} style={{ color: '#4ade80' }} />
                </div>
                <p className="text-sm font-medium text-gray-300">
                  Clean session — nothing to save. See you next time.
                </p>
                <button
                  onClick={doClose}
                  className="mt-2 text-xs px-4 py-2 rounded-lg border transition-colors hover:bg-gray-800/60"
                  style={{ borderColor: '#2a2d38', color: '#9ca3af' }}
                >
                  Close
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {items.map((item) => (
                  <ConclusionCard
                    key={item._localId}
                    item={item}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onSaveDraft={handleSaveDraft}
                    onCancelDraft={handleCancelDraft}
                    onDraftChange={handleDraftChange}
                  />
                ))}

                {/* Add button */}
                <button
                  onClick={handleAddNew}
                  className="flex items-center gap-2 px-4 py-3 rounded-lg border border-dashed text-sm transition-colors hover:bg-gray-800/30"
                  style={{ borderColor: '#2a2d38', color: '#6b7280' }}
                >
                  <Plus size={14} />
                  Add a conclusion the AI missed
                </button>
              </div>
            )}
          </div>

          {/* ── Action bar ──────────────────────────────────────────────── */}
          {hasConclusions && (
            <div
              className="flex items-center justify-between px-5 py-4 border-t flex-shrink-0"
              style={{ borderColor: '#1e2128', backgroundColor: '#0a0b0f' }}
            >
              {/* Skip flow */}
              <div className="flex items-center gap-3">
                {skipConfirm ? (
                  <div className="flex items-center gap-3">
                    <p className="text-xs text-gray-500">
                      Are you sure? These help me remember next time.
                    </p>
                    <button
                      onClick={doClose}
                      className="text-xs px-3 py-1.5 rounded-md border transition-colors"
                      style={{ borderColor: '#7f1d1d44', color: '#f87171' }}
                    >
                      Yes, skip
                    </button>
                    <button
                      onClick={() => setSkipConfirm(false)}
                      className="text-xs px-3 py-1.5 rounded-md border transition-colors hover:bg-gray-800/60"
                      style={{ borderColor: '#2a2d38', color: '#9ca3af' }}
                    >
                      Go back
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleSkip}
                    className="text-xs px-3 py-1.5 rounded-md border transition-colors hover:bg-gray-800/60"
                    style={{ borderColor: '#2a2d38', color: '#6b7280' }}
                  >
                    Skip
                  </button>
                )}
              </div>

              {/* Save & Close */}
              {!skipConfirm && (
                <button
                  onClick={handleSaveAndClose}
                  disabled={saving}
                  className="flex items-center gap-2 text-sm font-medium px-5 py-2 rounded-lg border transition-colors disabled:opacity-50"
                  style={{
                    backgroundColor: '#052e16',
                    borderColor: '#16a34a44',
                    color: '#4ade80',
                  }}
                >
                  {saving ? (
                    <>
                      <span
                        className="w-3 h-3 rounded-full border-2 border-t-transparent animate-spin"
                        style={{ borderColor: '#4ade8088', borderTopColor: 'transparent' }}
                      />
                      Saving…
                    </>
                  ) : (
                    <>
                      <Check size={14} />
                      Save &amp; Close
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
