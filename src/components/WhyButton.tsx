/**
 * src/components/WhyButton.tsx
 * AI Decision Transparency — V3-24
 *
 * Renders a small "Why?" button next to any AI recommendation card.
 * On click, expands an inline panel showing:
 *   - Reasoning chain / speak text
 *   - Routing agent + confidence bar
 *   - Data sources (display components)
 *   - Timestamp
 *   - User action buttons (Accept / Dismiss / Flag)
 *
 * Never auto-expands — always user-initiated.
 * Calls updateUserAction() when the user takes an action.
 */

import { useState } from 'react';
import {
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Bot,
  Clock,
  BarChart2,
  CheckCircle2,
  XCircle,
  BookmarkCheck,
  Flag,
} from 'lucide-react';
import type { AIDecisionLog, UserAction } from '../services/auditTrailService';
import { updateUserAction } from '../services/auditTrailService';

// ─── Confidence Bar ───────────────────────────────────────────────────────────

function ConfidenceBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);

  const color =
    pct >= 80
      ? '#4ade80'   // green
      : pct >= 55
      ? '#facc15'   // yellow
      : '#f87171';  // red

  return (
    <div className="flex items-center gap-2 w-full">
      <span className="text-xs text-gray-500 w-16 flex-shrink-0">Confidence</span>
      <div
        className="flex-1 h-1.5 rounded-full overflow-hidden"
        style={{ backgroundColor: '#1e2128' }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs font-mono flex-shrink-0" style={{ color }}>
        {pct}%
      </span>
    </div>
  );
}

// ─── Agent Badge ──────────────────────────────────────────────────────────────

const AGENT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  VAULT:     { bg: '#422006', text: '#fb923c', border: '#7c2d12' },
  OHM:       { bg: '#0c1a3a', text: '#60a5fa', border: '#1e3a5f' },
  LEDGER:    { bg: '#0a2a1a', text: '#34d399', border: '#065f46' },
  BLUEPRINT: { bg: '#1a0a2e', text: '#c084fc', border: '#4c1d95' },
  CHRONO:    { bg: '#1a1800', text: '#fde047', border: '#713f12' },
  SPARK:     { bg: '#2a0a0a', text: '#f87171', border: '#7f1d1d' },
  ATLAS:     { bg: '#0a1a2a', text: '#38bdf8', border: '#075985' },
  NEXUS:     { bg: '#1a1a1a', text: '#e2e8f0', border: '#374151' },
  MULTI:     { bg: '#1a0a1a', text: '#e879f9', border: '#6b21a8' },
};

function AgentBadge({ agent }: { agent: string }) {
  const style = AGENT_COLORS[agent] ?? AGENT_COLORS['NEXUS'];
  return (
    <span
      className="text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wider"
      style={{
        backgroundColor: style.bg,
        color: style.text,
        border: `1px solid ${style.border}`,
      }}
    >
      {agent}
    </span>
  );
}

// ─── User Action Buttons ──────────────────────────────────────────────────────

interface ActionButtonsProps {
  currentAction?: UserAction;
  onAction: (action: UserAction) => void;
}

function ActionButtons({ currentAction, onAction }: ActionButtonsProps) {
  const actions: { action: UserAction; label: string; icon: React.ReactNode; color: string }[] = [
    {
      action: 'accepted',
      label: 'Accept',
      icon: <CheckCircle2 size={12} />,
      color: '#4ade80',
    },
    {
      action: 'dismissed',
      label: 'Dismiss',
      icon: <XCircle size={12} />,
      color: '#9ca3af',
    },
    {
      action: 'followed_up',
      label: 'Follow Up',
      icon: <BookmarkCheck size={12} />,
      color: '#60a5fa',
    },
    {
      action: 'flagged',
      label: 'Flag',
      icon: <Flag size={12} />,
      color: '#f87171',
    },
  ];

  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {actions.map(({ action, label, icon, color }) => {
        const isActive = currentAction === action;
        return (
          <button
            key={action}
            onClick={() => onAction(action)}
            className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg transition-all"
            style={{
              backgroundColor: isActive ? `${color}22` : '#1a1d27',
              color: isActive ? color : '#6b7280',
              border: `1px solid ${isActive ? `${color}55` : '#2a3040'}`,
            }}
          >
            {icon}
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Why Panel (expanded content) ────────────────────────────────────────────

interface WhyPanelProps {
  decision: AIDecisionLog;
  onActionUpdate: (updated: AIDecisionLog) => void;
}

function WhyPanel({ decision, onActionUpdate }: WhyPanelProps) {
  const [currentAction, setCurrentAction] = useState<UserAction | undefined>(
    decision.user_action,
  );
  const [saving, setSaving] = useState(false);

  async function handleAction(action: UserAction) {
    if (saving) return;
    setSaving(true);
    try {
      const updated = await updateUserAction(decision.id, action);
      setCurrentAction(action);
      if (updated) onActionUpdate(updated);
    } catch (err) {
      console.error('[WhyButton] updateUserAction failed:', err);
    } finally {
      setSaving(false);
    }
  }

  // Parse display items from reasoning payload
  const displayItems = Array.isArray(
    (decision.reasoning as { display?: unknown }).display,
  )
    ? ((decision.reasoning as { display: { type: string; title?: string; value?: string; label?: string }[] }).display)
    : [];

  const formattedTime = new Date(decision.timestamp).toLocaleString('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      className="mt-2 rounded-xl border p-3 flex flex-col gap-3"
      style={{ backgroundColor: '#0a0b14', borderColor: '#1e2128' }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Bot size={13} className="text-green-500 flex-shrink-0" />
          <span className="text-xs font-semibold text-gray-300">AI Reasoning</span>
          <AgentBadge agent={decision.agent_name} />
        </div>
        <div className="flex items-center gap-1.5 text-xs text-gray-600">
          <Clock size={11} />
          {formattedTime}
        </div>
      </div>

      {/* Confidence */}
      <ConfidenceBar score={decision.confidence_score} />

      {/* Query */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Query</p>
        <p className="text-xs text-gray-400 leading-relaxed">{decision.query}</p>
      </div>

      {/* Recommendation / speak */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          Recommendation
        </p>
        <p className="text-xs text-gray-200 leading-relaxed">{decision.recommendation}</p>
      </div>

      {/* Data Sources (display components) */}
      {displayItems.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <BarChart2 size={11} className="text-gray-600" />
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Data Sources
            </p>
          </div>
          <ul className="flex flex-col gap-1">
            {displayItems.slice(0, 5).map((item, idx) => (
              <li
                key={idx}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs"
                style={{ backgroundColor: '#11121a', border: '1px solid #1e2128' }}
              >
                <span
                  className="px-1.5 py-0.5 rounded text-gray-600 font-mono text-[10px] uppercase"
                  style={{ backgroundColor: '#0d0e14' }}
                >
                  {item.type}
                </span>
                <span className="text-gray-400 truncate">
                  {item.title ?? item.label ?? item.value ?? '—'}
                </span>
                {item.value != null && item.title && (
                  <span className="ml-auto text-gray-500 font-mono">{String(item.value)}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* User Action */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Your Response
        </p>
        <ActionButtons currentAction={currentAction} onAction={handleAction} />
        {saving && (
          <p className="text-xs text-gray-600 mt-1.5 animate-pulse">Saving…</p>
        )}
      </div>
    </div>
  );
}

// ─── WhyButton (public export) ────────────────────────────────────────────────

export interface WhyButtonProps {
  /** The AI decision record to display. Pass the full record from auditTrailService. */
  decision: AIDecisionLog;
  /** Optional callback when the decision record is updated (user action recorded). */
  onUpdate?: (updated: AIDecisionLog) => void;
  /** Visual variant — 'inline' floats next to text; 'standalone' is a pill button */
  variant?: 'inline' | 'standalone';
}

/**
 * WhyButton
 *
 * Small "Why?" button that expands an inline reasoning panel.
 * Place next to any AI recommendation card or speak text.
 * Never auto-expands — always requires explicit user click.
 *
 * @example
 * <WhyButton
 *   decision={decisionRecord}
 *   onUpdate={(updated) => setDecision(updated)}
 * />
 */
export default function WhyButton({ decision, onUpdate, variant = 'inline' }: WhyButtonProps) {
  const [open, setOpen] = useState(false);
  const [localDecision, setLocalDecision] = useState<AIDecisionLog>(decision);

  function handleActionUpdate(updated: AIDecisionLog) {
    setLocalDecision(updated);
    onUpdate?.(updated);
  }

  const hasAction = !!localDecision.user_action;

  if (variant === 'standalone') {
    return (
      <div className="w-full">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg w-full justify-between transition-colors"
          style={{
            backgroundColor: open ? '#0f1a0f' : '#11121a',
            color: open ? '#4ade80' : '#6b7280',
            border: `1px solid ${open ? '#16a34a44' : '#1e2128'}`,
          }}
          aria-expanded={open}
          aria-label="Show AI reasoning"
        >
          <div className="flex items-center gap-1.5">
            <HelpCircle size={12} />
            <span>Why this recommendation?</span>
            {hasAction && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-900/30 text-green-500 border border-green-800/40 uppercase tracking-wide">
                {localDecision.user_action}
              </span>
            )}
          </div>
          {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        {open && (
          <WhyPanel decision={localDecision} onActionUpdate={handleActionUpdate} />
        )}
      </div>
    );
  }

  // inline variant
  return (
    <span className="inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md transition-colors"
        style={{
          backgroundColor: open ? '#0f1a0f' : '#11121a',
          color: open ? '#4ade80' : '#6b7280',
          border: `1px solid ${open ? '#16a34a44' : '#1e2128'}`,
        }}
        aria-expanded={open}
        aria-label="Show AI reasoning"
        title="Show AI reasoning"
      >
        <HelpCircle size={10} />
        Why?
        {hasAction && (
          <span
            className="w-1.5 h-1.5 rounded-full ml-0.5"
            style={{ backgroundColor: '#4ade80' }}
            title={`Action taken: ${localDecision.user_action}`}
          />
        )}
      </button>
      {open && (
        <WhyPanel decision={localDecision} onActionUpdate={handleActionUpdate} />
      )}
    </span>
  );
}
