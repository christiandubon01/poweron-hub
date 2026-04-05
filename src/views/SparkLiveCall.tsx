// @ts-nocheck
/**
 * src/views/SparkLiveCall.tsx — SPARK Live Call Mode (E6/E7)
 *
 * Shell UI for guided call scripts. Supports Vendor, Sub, and GC call flows.
 * Decision tree navigation is powered by the SPARK call engine (E7).
 *
 * Layout:
 *   [Call Type Selector] — top
 *   [Stage Display]      — center-left
 *   [Call History]       — right sidebar
 *   [Controls + Timer]   — bottom
 *
 * E7 additions:
 *   - spark.advance()    drives stage transitions
 *   - Escalation banner  (yellow) when detectEscalation() returns true
 *   - Outcome modal      shown on End Call; includes Copy Summary button
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { CallType, CallStage, CallOption, CallSession } from '../types';
import * as spark from '../agents/spark';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function makeSession(callType: CallType): CallSession {
  const script = spark.loadScript(callType);
  return {
    id:             `session-${Date.now()}`,
    callType,
    currentStageId: script[0]?.id ?? '',
    history:        [],
    startedAt:      new Date().toISOString(),
  };
}

// ─── Types for local display state ────────────────────────────────────────────

interface HistoryEntry {
  stageId:     string;
  stageLabel:  string;
  optionLabel: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SparkLiveCall() {
  // ── Call / engine state ──────────────────────────────────────────────────
  const [callType, setCallType]       = useState<CallType | null>(null);
  const [session,  setSession]        = useState<CallSession | null>(null);
  const [script,   setScript]         = useState<CallStage[]>([]);
  const [currentStage, setCurrentStage] = useState<CallStage | null>(null);

  // ── Display state ────────────────────────────────────────────────────────
  const [history,      setHistory]      = useState<HistoryEntry[]>([]);
  const [elapsed,      setElapsed]      = useState<number>(0);
  const [timerActive,  setTimerActive]  = useState<boolean>(false);

  // ── Escalation state ─────────────────────────────────────────────────────
  const [escalationReason, setEscalationReason] = useState<string | null>(null);

  // ── Outcome modal state ──────────────────────────────────────────────────
  const [showModal,      setShowModal]      = useState<boolean>(false);
  const [outcomeSummary, setOutcomeSummary] = useState<string>('');
  const [copied,         setCopied]         = useState<boolean>(false);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const historyEndRef = useRef<HTMLDivElement | null>(null);

  // ── Timer ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (timerActive) {
      timerRef.current = setInterval(() => {
        setElapsed(prev => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [timerActive]);

  // Scroll history to bottom whenever it updates
  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  // ── Call type selection ──────────────────────────────────────────────────

  const handleSelectCallType = useCallback((type: CallType) => {
    // Replace with real Supabase query during integration — fetch call scripts from db
    const newScript  = spark.loadScript(type);
    const newSession = makeSession(type);

    setCallType(type);
    setScript(newScript);
    setSession(newSession);
    setCurrentStage(newScript[0] ?? null);
    setHistory([]);
    setElapsed(0);
    setTimerActive(true);
    setEscalationReason(null);
    setShowModal(false);
    setOutcomeSummary('');
    setCopied(false);
  }, []);

  // ── Option selection → spark.advance() ───────────────────────────────────

  const handleOptionSelect = useCallback(
    (option: CallOption) => {
      if (!session || !currentStage) return;

      // Advance via engine (returns new session + next stage)
      const { nextStage, updatedSession } = spark.advance(session, option.id);

      // Record display history entry
      setHistory(prev => [
        ...prev,
        {
          stageId:     currentStage.id,
          stageLabel:  currentStage.label,
          optionLabel: option.label,
        },
      ]);

      // Update session state
      setSession(updatedSession);

      // Check escalation on updated session
      const esc = spark.detectEscalation(updatedSession);
      setEscalationReason(esc.escalated ? (esc.reason ?? null) : null);

      if (nextStage === null) {
        // Terminal — stop timer, keep currentStage as-is for display
        setTimerActive(false);
      } else {
        setCurrentStage(nextStage);
      }
    },
    [session, currentStage],
  );

  // ── Back ──────────────────────────────────────────────────────────────────

  const handleBack = useCallback(() => {
    if (history.length === 0 || !session) return;

    // Pop last entry from display history
    const prevDisplayHistory = history.slice(0, -1);

    // Pop last entry from session history
    const prevSessionHistory = session.history.slice(0, -1);

    // Re-derive the current stage from the truncated history
    // (go back to the stage that was active before the last option)
    const prevStageId =
      prevDisplayHistory.length > 0
        ? prevDisplayHistory[prevDisplayHistory.length - 1].stageId
        : script[0]?.id ?? '';

    // If popped back to before all steps, restore to first stage of the
    // previous-to-last entry (the stage the user was on before choosing)
    const restoredStageId = prevDisplayHistory.length === 0
      ? (script[0]?.id ?? '')
      : prevStageId;

    const restoredStage = script.find(s => s.id === restoredStageId) ?? script[0] ?? null;

    const updatedSession: CallSession = {
      ...session,
      currentStageId: restoredStageId,
      history:        prevSessionHistory,
    };

    setHistory(prevDisplayHistory);
    setSession(updatedSession);
    setCurrentStage(restoredStage);
    setTimerActive(true); // Resume if was paused at terminal

    // Re-evaluate escalation after rollback
    const esc = spark.detectEscalation(updatedSession);
    setEscalationReason(esc.escalated ? (esc.reason ?? null) : null);
  }, [history, session, script]);

  // ── End Call → outcome modal ───────────────────────────────────────────────

  const handleEndCall = useCallback(() => {
    if (!session) return;

    setTimerActive(false);

    // Get outcome summary from engine
    const summary = spark.getOutcomeSummary(session);
    setOutcomeSummary(summary);
    setShowModal(true);
  }, [session]);

  // ── Modal close / reset ────────────────────────────────────────────────────

  const handleModalClose = useCallback(() => {
    setShowModal(false);
    setOutcomeSummary('');
    setCopied(false);

    // Reset call state
    setCurrentStage(null);
    setHistory([]);
    setElapsed(0);
    setEscalationReason(null);
    if (callType) {
      const newScript  = spark.loadScript(callType);
      const newSession = makeSession(callType);
      setScript(newScript);
      setSession(newSession);
      setCurrentStage(newScript[0] ?? null);
    }
  }, [callType]);

  // ── Copy summary ───────────────────────────────────────────────────────────

  const handleCopySummary = useCallback(() => {
    navigator.clipboard.writeText(outcomeSummary).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [outcomeSummary]);

  // ── Derived state ──────────────────────────────────────────────────────────

  const totalStages  = script.length;
  const stepNumber   = currentStage
    ? (script.findIndex(s => s.id === currentStage.id) + 1)
    : 0;
  const callActive   = callType !== null;

  // ── Call type button config ────────────────────────────────────────────────

  const callTypeButtons: { type: CallType; label: string }[] = [
    { type: 'vendor', label: 'Vendor Call' },
    { type: 'sub',    label: 'Sub Call' },
    { type: 'gc',     label: 'GC Call' },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">

      {/* ── Outcome Modal ──────────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg mx-4 shadow-2xl flex flex-col">

            {/* Modal header */}
            <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
              <span className="text-green-400 font-semibold text-sm tracking-wide uppercase">
                Call Outcome
              </span>
              <button
                onClick={handleModalClose}
                className="text-gray-500 hover:text-white transition-colors text-lg leading-none"
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            {/* Summary text */}
            <div className="px-6 py-5 flex-1 overflow-y-auto max-h-96">
              <pre className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap font-mono">
                {outcomeSummary}
              </pre>
            </div>

            {/* Modal footer */}
            <div className="px-6 py-4 border-t border-gray-800 flex gap-3 justify-end">
              <button
                onClick={handleCopySummary}
                className="
                  px-5 py-2 rounded-lg text-sm font-medium border transition-all duration-150
                  border-green-700 text-green-400 hover:bg-green-900/40 hover:text-green-300
                "
              >
                {copied ? '✓ Copied!' : 'Copy Summary'}
              </button>
              <button
                onClick={handleModalClose}
                className="
                  px-5 py-2 rounded-lg text-sm font-medium border transition-all duration-150
                  border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white
                "
              >
                Close & Reset
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-green-400 font-bold text-lg tracking-wide">⚡ SPARK</span>
          <span className="text-gray-400 text-sm">Live Call Mode</span>
        </div>
        {callActive && (
          <div className="flex items-center gap-2 text-sm">
            <span
              className={`inline-block w-2 h-2 rounded-full ${timerActive ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`}
            />
            <span className={`font-mono ${timerActive ? 'text-green-400' : 'text-gray-400'}`}>
              {formatTime(elapsed)}
            </span>
          </div>
        )}
      </header>

      {/* ── Call Type Selector ─────────────────────────────────────────────── */}
      <div className="px-6 py-4 border-b border-gray-800">
        <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">Select Call Type</p>
        <div className="flex gap-3">
          {callTypeButtons.map(({ type, label }) => (
            <button
              key={type}
              onClick={() => handleSelectCallType(type)}
              className={`
                px-5 py-2 rounded-lg text-sm font-medium border transition-all duration-150
                ${callType === type
                  ? 'bg-green-500 border-green-500 text-black font-semibold shadow-lg shadow-green-500/20'
                  : 'bg-gray-900 border-gray-700 text-gray-300 hover:border-green-600 hover:text-green-400'
                }
              `}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Main Body ─────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Stage Display (center) ──────────────────────────────────────── */}
        <main className="flex-1 flex flex-col px-8 py-6 overflow-y-auto">

          {!callActive ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center space-y-3">
                <div className="text-5xl">📞</div>
                <p className="text-gray-400 text-lg">Select a call type above to begin.</p>
                <p className="text-gray-600 text-sm">SPARK will guide you through the call step by step.</p>
              </div>
            </div>
          ) : currentStage === null ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center space-y-3">
                <div className="text-5xl">✅</div>
                <p className="text-green-400 text-xl font-semibold">Call Complete</p>
                <p className="text-gray-400 text-sm">Duration: {formatTime(elapsed)}</p>
                <p className="text-gray-600 text-xs">Press "End Call" to view the outcome summary.</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-6 max-w-2xl">

              {/* ── Escalation Banner ──────────────────────────────────── */}
              {escalationReason !== null && (
                <div className="flex items-start gap-3 px-5 py-3 rounded-xl bg-yellow-900/40 border border-yellow-600/60">
                  <span className="text-yellow-400 text-lg leading-snug">⚠</span>
                  <p className="text-yellow-300 text-sm leading-snug">
                    <span className="font-semibold">Escalation detected</span>
                    {' — '}
                    {escalationReason}
                  </p>
                </div>
              )}

              {/* Step indicator */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 uppercase tracking-widest">
                  Step {stepNumber} of {totalStages}
                </span>
                <div className="flex-1 h-px bg-gray-800">
                  <div
                    className="h-px bg-green-500 transition-all duration-300"
                    style={{ width: `${(stepNumber / totalStages) * 100}%` }}
                  />
                </div>
              </div>

              {/* Stage label */}
              <div>
                <span className="text-xs font-semibold text-green-500 uppercase tracking-widest">
                  {currentStage.label}
                </span>
              </div>

              {/* Prompt */}
              <div className="bg-gray-900 border border-gray-700 rounded-xl p-6">
                <p className="text-white text-lg leading-relaxed">
                  {currentStage.prompt}
                </p>
              </div>

              {/* Options */}
              <div className="space-y-3">
                <p className="text-xs text-gray-500 uppercase tracking-widest">Choose your response</p>
                {currentStage.options.map(option => (
                  <button
                    key={option.id}
                    onClick={() => handleOptionSelect(option)}
                    className="
                      w-full text-left px-5 py-4 rounded-xl border border-gray-700
                      bg-gray-900 hover:bg-gray-800 hover:border-green-600
                      text-gray-200 hover:text-white
                      transition-all duration-150
                      group
                    "
                  >
                    <div className="flex items-center justify-between">
                      <span>{option.label}</span>
                      <span className="text-gray-600 group-hover:text-green-400 text-lg transition-colors">→</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </main>

        {/* ── Call History Sidebar (right) ─────────────────────────────────── */}
        <aside className="w-72 border-l border-gray-800 flex flex-col bg-gray-900/50">
          <div className="px-5 py-4 border-b border-gray-800">
            <p className="text-xs text-gray-500 uppercase tracking-widest">Call History</p>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {history.length === 0 ? (
              <p className="text-gray-600 text-sm italic">No steps taken yet.</p>
            ) : (
              history.map((entry, idx) => (
                <div
                  key={`${entry.stageId}-${idx}`}
                  className="border border-gray-800 rounded-lg p-3 bg-gray-900"
                >
                  <p className="text-xs text-green-500 font-semibold uppercase tracking-wide mb-1">
                    {entry.stageLabel}
                  </p>
                  <p className="text-gray-300 text-sm leading-snug">{entry.optionLabel}</p>
                </div>
              ))
            )}
            <div ref={historyEndRef} />
          </div>
        </aside>
      </div>

      {/* ── Controls (bottom) ─────────────────────────────────────────────── */}
      <footer className="border-t border-gray-800 px-6 py-4 flex items-center gap-4">
        <button
          onClick={handleEndCall}
          disabled={!callActive}
          className="
            px-5 py-2 rounded-lg text-sm font-medium border transition-all duration-150
            border-red-700 text-red-400 hover:bg-red-900/40 hover:text-red-300
            disabled:opacity-30 disabled:cursor-not-allowed
          "
        >
          End Call
        </button>

        <button
          onClick={handleBack}
          disabled={!callActive || history.length === 0}
          className="
            px-5 py-2 rounded-lg text-sm font-medium border transition-all duration-150
            border-gray-700 text-gray-400 hover:bg-gray-800 hover:text-gray-200
            disabled:opacity-30 disabled:cursor-not-allowed
          "
        >
          ← Back
        </button>

        <div className="flex-1" />

        {callActive && (
          <div className="text-xs text-gray-600">
            {callType === 'vendor' && 'Vendor Call'}
            {callType === 'sub'    && 'Sub Call'}
            {callType === 'gc'     && 'GC Call'}
            {' · '}
            {history.length} step{history.length !== 1 ? 's' : ''} logged
          </div>
        )}
      </footer>

    </div>
  );
}
