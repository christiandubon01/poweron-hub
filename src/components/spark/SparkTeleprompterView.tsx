/**
 * SPARK Teleprompter View Component
 * Full-screen display for cold call scripts with 2-3 sentence visibility
 * Optimized for phone glancing during calls
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  TeleprompterState,
  DisplaySentences,
  SpeechRateTracker,
  ScriptType,
  initTeleprompterSession,
  getScript,
  getDisplaySentences,
  advanceToNextSentence,
  goToPreviousSentence,
  classifyLeadResponse,
  moveToNextNode,
  updateTranscript,
  initSpeechRateTracker,
  getScrollSpeed,
  shouldAutoAdvance,
  calculateProgress,
  getCurrentNode,
  getNodeIds,
  getAllScripts,
  LeadResponse
} from '../../services/sparkLiveCall/SparkTeleprompter';

interface SparkTeleprompterViewProps {
  /** Called when session ends */
  onSessionEnd?: (endedState: TeleprompterState) => void;
  /** Auto-advance on keyword match */
  autoAdvance?: boolean;
  /** Font size override (px) */
  fontSize?: number;
}

/**
 * SPARK Teleprompter Display Component
 * Shows current + next + following sentences with full-screen mobile optimization
 */
export const SparkTeleprompterView: React.FC<SparkTeleprompterViewProps> = ({
  onSessionEnd,
  autoAdvance = true,
  fontSize = 24
}) => {
  // Script and navigation state
  const [state, setState] = useState<TeleprompterState>(
    initTeleprompterSession('vendor')
  );
  const [displaySentences, setDisplaySentences] = useState<DisplaySentences>(
    getDisplaySentences(state)
  );

  // Speech tracking
  const [tracker] = useState<SpeechRateTracker>(initSpeechRateTracker());
  const [scrollSpeed, setScrollSpeed] = useState(getScrollSpeed(state.wpm));

  // UI state
  const [showResponseMode, setShowResponseMode] = useState(false);
  const [selectedResponse, setSelectedResponse] = useState<LeadResponse | null>(null);

  // Update display when state changes
  useEffect(() => {
    setDisplaySentences(getDisplaySentences(state));
    setScrollSpeed(getScrollSpeed(state.wpm));
  }, [state]);

  // Auto-advance on keyword match if enabled
  useEffect(() => {
    if (!autoAdvance || !state.transcript || showResponseMode) {
      return;
    }

    if (shouldAutoAdvance(state, state.transcript)) {
      const timer = setTimeout(() => {
        setState(advanceToNextSentence);
      }, scrollSpeed);

      return () => clearTimeout(timer);
    }
  }, [state.transcript, autoAdvance, showResponseMode, scrollSpeed]);

  // Handlers
  const handleNextSentence = useCallback(() => {
    const currentNode = getCurrentNode(state);
    const isLastSentence = state.displayIndex >= currentNode.sentences.length - 1;

    if (isLastSentence && currentNode.branches) {
      setShowResponseMode(true);
    } else {
      setState(advanceToNextSentence);
    }
  }, [state]);

  const handlePreviousSentence = useCallback(() => {
    setState(goToPreviousSentence);
  }, []);

  const handleTranscriptUpdate = useCallback((transcript: string) => {
    setState(prev => updateTranscript(prev, transcript, tracker));
  }, [tracker]);

  const handleResponseSelect = useCallback((response: LeadResponse) => {
    setSelectedResponse(response);
    setState(prev => moveToNextNode(prev, response));
    setShowResponseMode(false);
  }, []);

  const handleScriptChange = useCallback((scriptType: ScriptType) => {
    setState(initTeleprompterSession(scriptType));
    setShowResponseMode(false);
    setSelectedResponse(null);
  }, []);

  const handleEndSession = useCallback(() => {
    if (onSessionEnd) {
      onSessionEnd(state);
    }
  }, [state, onSessionEnd]);

  const currentNode = getCurrentNode(state);
  const nodeIds = getNodeIds(getScript(state.scriptType));
  const progress = calculateProgress(state);

  return (
    <div className="fixed inset-0 bg-black text-white flex flex-col justify-between p-4 md:p-8 overflow-hidden font-sans">
      {/* HEADER: Script selector + WPM indicator */}
      <div className="flex justify-between items-center mb-6 border-b border-gray-700 pb-4">
        <div>
          <label className="text-xs text-gray-400 uppercase tracking-wide block mb-1">
            Script
          </label>
          <select
            value={state.scriptType}
            onChange={e => handleScriptChange(e.target.value as ScriptType)}
            className="bg-gray-900 border border-gray-700 text-white px-3 py-1 rounded text-sm"
          >
            <option value="vendor">Vendor / Property Manager</option>
            <option value="sub">GC / Contractor</option>
            <option value="homeowner">Homeowner</option>
            <option value="solar">Solar Company</option>
          </select>
        </div>

        <div className="text-right">
          <div className="text-2xl font-bold text-blue-400">{state.wpm} WPM</div>
          <div className="text-xs text-gray-500">Matched to your speech</div>
        </div>
      </div>

      {/* MAIN: Teleprompter sentences display */}
      <div className="flex-1 flex flex-col justify-center items-center text-center px-4">
        {!showResponseMode ? (
          <>
            {/* Current sentence - Large, bold, centered */}
            <div
              className="mb-8 leading-relaxed"
              style={{ fontSize: `${fontSize}px` }}
            >
              <p className="font-bold text-white">
                {displaySentences.current}
              </p>
            </div>

            {/* Next sentence - Smaller, 70% opacity */}
            {displaySentences.next && (
              <div
                className="mb-6 leading-relaxed opacity-70"
                style={{ fontSize: `${fontSize * 0.75}px` }}
              >
                <p className="text-gray-300">
                  {displaySentences.next}
                </p>
              </div>
            )}

            {/* Following sentence - Smallest, 40% opacity */}
            {displaySentences.following && (
              <div
                className="leading-relaxed opacity-40"
                style={{ fontSize: `${fontSize * 0.6}px` }}
              >
                <p className="text-gray-400">
                  {displaySentences.following}
                </p>
              </div>
            )}
          </>
        ) : (
          /* Response mode - showing classification options */
          <div className="w-full max-w-xl">
            <h3 className="text-xl font-bold mb-6 text-gray-300">
              How did they respond?
            </h3>
            <div className="space-y-3">
              <button
                onClick={() => handleResponseSelect('NOT_INTERESTED')}
                className="w-full bg-red-900 hover:bg-red-800 text-white py-3 px-4 rounded text-sm font-medium transition"
              >
                Not Interested
              </button>
              <button
                onClick={() => handleResponseSelect('WORKABLE')}
                className="w-full bg-yellow-900 hover:bg-yellow-800 text-white py-3 px-4 rounded text-sm font-medium transition"
              >
                Workable
              </button>
              <button
                onClick={() => handleResponseSelect('INTERESTED')}
                className="w-full bg-blue-900 hover:bg-blue-800 text-white py-3 px-4 rounded text-sm font-medium transition"
              >
                Interested
              </button>
              <button
                onClick={() => handleResponseSelect('CONVINCED')}
                className="w-full bg-green-900 hover:bg-green-800 text-white py-3 px-4 rounded text-sm font-medium transition"
              >
                Convinced
              </button>
            </div>
          </div>
        )}
      </div>

      {/* CONTROLS: Navigation + transcript input */}
      <div className="border-t border-gray-700 pt-4 space-y-3">
        {/* Progress bar */}
        <div className="w-full bg-gray-800 rounded-full h-1">
          <div
            className="bg-blue-500 h-1 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Current node info */}
        <div className="text-xs text-gray-500 text-center">
          {currentNode.isTerminal
            ? 'Session complete'
            : `Node ${nodeIds.indexOf(state.currentNodeId) + 1} of ${nodeIds.length}`}
        </div>

        {/* Manual controls (swipe equivalent) */}
        {!showResponseMode && (
          <div className="flex gap-2 justify-center">
            <button
              onClick={handlePreviousSentence}
              disabled={state.displayIndex === 0}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm transition"
            >
              ← Back
            </button>
            <button
              onClick={handleNextSentence}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm transition"
            >
              Next →
            </button>
          </div>
        )}

        {/* Transcript input (for manual testing) */}
        <input
          type="text"
          placeholder="Paste transcript here or use speech-to-text..."
          value={state.transcript}
          onChange={e => handleTranscriptUpdate(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 text-white px-3 py-2 rounded text-xs placeholder-gray-600 focus:outline-none focus:border-blue-500"
        />

        {/* End session button */}
        <button
          onClick={handleEndSession}
          className="w-full bg-gray-800 hover:bg-gray-700 text-white py-2 px-4 rounded text-sm transition"
        >
          End Call
        </button>
      </div>
    </div>
  );
};

export default SparkTeleprompterView;
