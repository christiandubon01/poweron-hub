/**
 * src/components/ConclusionCards.tsx
 * V3-32 — Active Conclusions Surface
 *
 * Horizontal scrollable row of conclusion cards shown at the top of the Home
 * dashboard and at the start of any voice session view.
 *
 * Behaviour:
 * - Renders nothing if no active conclusions exist
 * - Auto-collapses after 5 minutes of user activity; accessible via pill
 * - Each card: conclusion text (2-line truncate), relative date, project badge,
 *   completion checkbox, tap-to-expand full text
 * - "Clear all" marks all conclusions completed (with confirmation)
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronRight, CheckCircle2, Circle, Clock } from 'lucide-react';
import {
  markConclusionCompleted,
  type SessionConclusion,
} from '../services/sessionConclusionService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a relative human-readable date like "2 days ago" or "Last Friday". */
function relativeDate(isoTimestamp: string): string {
  const then = new Date(isoTimestamp);
  const now = new Date();
  const diffMs = now.getTime() - then.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHrs = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHrs / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHrs < 24) return `${diffHrs}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return `Last ${dayNames[then.getDay()]}`;
  }
  if (diffDays < 30) return `${diffDays} days ago`;
  return then.toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

// ─── ConclusionCard (single card) ─────────────────────────────────────────────

function ConclusionCard({
  conclusion,
  onToggleComplete,
}: {
  conclusion: SessionConclusion;
  onToggleComplete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [completing, setCompleting] = useState(false);

  async function handleComplete(e: React.MouseEvent) {
    e.stopPropagation();
    if (completing) return;
    setCompleting(true);
    try {
      await markConclusionCompleted(conclusion.id);
      onToggleComplete(conclusion.id);
    } catch (err) {
      console.error('[ConclusionCards] markConclusionCompleted error:', err);
      setCompleting(false);
    }
  }

  return (
    <div
      className="flex-shrink-0 rounded-xl border flex flex-col gap-2 cursor-pointer select-none"
      style={{
        width: '220px',
        backgroundColor: '#0d0e14',
        borderColor: '#1e2128',
        padding: '12px 14px',
        transition: 'border-color 0.15s, background-color 0.15s',
      }}
      onClick={() => setExpanded((v) => !v)}
      onMouseOver={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = '#2a2d38';
        (e.currentTarget as HTMLDivElement).style.backgroundColor = '#111318';
      }}
      onMouseOut={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = '#1e2128';
        (e.currentTarget as HTMLDivElement).style.backgroundColor = '#0d0e14';
      }}
      role="button"
      aria-expanded={expanded}
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && setExpanded((v) => !v)}
    >
      {/* Project badge */}
      {conclusion.project_id && (
        <span
          className="text-xs font-medium px-1.5 py-0.5 rounded border self-start"
          style={{
            backgroundColor: '#052e1688',
            borderColor: '#16a34a33',
            color: '#4ade80',
          }}
        >
          {conclusion.project_id}
        </span>
      )}

      {/* Conclusion text */}
      <p
        className="text-xs text-gray-300 leading-relaxed"
        style={
          expanded
            ? {}
            : {
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }
        }
      >
        {conclusion.conclusion_text}
      </p>

      {/* Footer: date + complete */}
      <div className="flex items-center justify-between mt-auto pt-1">
        <span className="flex items-center gap-1 text-xs" style={{ color: '#4b5563' }}>
          <Clock size={10} />
          {relativeDate(conclusion.created_at)}
        </span>

        <button
          className="flex items-center gap-1 text-xs transition-colors"
          style={{ color: completing ? '#4ade80' : '#4b5563' }}
          onClick={handleComplete}
          title="Mark as completed"
          aria-label="Mark conclusion as completed"
        >
          {completing ? (
            <CheckCircle2 size={14} style={{ color: '#4ade80' }} />
          ) : (
            <Circle size={14} />
          )}
        </button>
      </div>
    </div>
  );
}

// ─── ConclusionCards ──────────────────────────────────────────────────────────

export interface ConclusionCardsProps {
  /** Active conclusions to display (max 5 will be shown) */
  conclusions: SessionConclusion[];
  /** Called when a conclusion is marked completed, to refresh parent state */
  onConclusionCompleted: (id: string) => void;
}

const AUTO_COLLAPSE_MS = 5 * 60 * 1000; // 5 minutes

export default function ConclusionCards({
  conclusions,
  onConclusionCompleted,
}: ConclusionCardsProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const autoCollapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Only show up to 5 conclusions
  const visible = conclusions.slice(0, 5);

  // Don't render if no active conclusions
  if (!visible.length) return null;

  // ── Auto-collapse after 5 minutes of activity ───────────────────────────

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const resetTimer = useCallback(() => {
    if (autoCollapseTimer.current) clearTimeout(autoCollapseTimer.current);
    autoCollapseTimer.current = setTimeout(() => setCollapsed(true), AUTO_COLLAPSE_MS);
  }, []);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    resetTimer();
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((evt) => window.addEventListener(evt, resetTimer, { passive: true }));
    return () => {
      if (autoCollapseTimer.current) clearTimeout(autoCollapseTimer.current);
      events.forEach((evt) => window.removeEventListener(evt, resetTimer));
    };
  }, [resetTimer]);

  // ── Clear all ───────────────────────────────────────────────────────────

  async function handleClearAll() {
    if (!clearConfirm) {
      setClearConfirm(true);
      return;
    }
    setClearing(true);
    try {
      await Promise.all(visible.map((c) => markConclusionCompleted(c.id)));
      visible.forEach((c) => onConclusionCompleted(c.id));
    } catch (err) {
      console.error('[ConclusionCards] clearAll error:', err);
    } finally {
      setClearing(false);
      setClearConfirm(false);
    }
  }

  // ── Collapsed: show pill button ─────────────────────────────────────────

  if (collapsed) {
    return (
      <div className="px-6 py-2 flex-shrink-0">
        <button
          onClick={() => setCollapsed(false)}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors hover:bg-gray-800/60"
          style={{ borderColor: '#1e2128', color: '#6b7280' }}
        >
          <Clock size={11} />
          Previous conclusions
          <span
            className="ml-1 text-xs font-bold px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: '#052e16', color: '#4ade80' }}
          >
            {visible.length}
          </span>
          <ChevronRight size={11} />
        </button>
      </div>
    );
  }

  // ── Expanded: full cards row ────────────────────────────────────────────

  return (
    <div
      className="flex-shrink-0 border-b"
      style={{ borderColor: '#1a1c23', backgroundColor: '#0a0b0f' }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between px-6 pt-3 pb-1">
        <div className="flex items-center gap-2">
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: '#4ade80' }}
          />
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#4b5563' }}>
            Where we left off:
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Clear all */}
          {clearConfirm ? (
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: '#6b7280' }}>Clear all?</span>
              <button
                onClick={handleClearAll}
                disabled={clearing}
                className="text-xs px-2 py-0.5 rounded border disabled:opacity-50"
                style={{ borderColor: '#7f1d1d44', color: '#f87171' }}
              >
                {clearing ? '…' : 'Yes'}
              </button>
              <button
                onClick={() => setClearConfirm(false)}
                className="text-xs px-2 py-0.5 rounded border"
                style={{ borderColor: '#2a2d38', color: '#6b7280' }}
              >
                No
              </button>
            </div>
          ) : (
            <button
              onClick={handleClearAll}
              className="text-xs transition-colors hover:text-gray-400"
              style={{ color: '#4b5563' }}
            >
              Clear all
            </button>
          )}

          {/* Collapse */}
          <button
            onClick={() => setCollapsed(true)}
            className="text-xs transition-colors hover:text-gray-400"
            style={{ color: '#4b5563' }}
            title="Collapse"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Scrollable card row */}
      <div
        className="flex gap-3 px-6 pb-3 overflow-x-auto"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#1e2128 transparent' }}
      >
        {visible.map((c) => (
          <ConclusionCard
            key={c.id}
            conclusion={c}
            onToggleComplete={onConclusionCompleted}
          />
        ))}
      </div>
    </div>
  );
}
