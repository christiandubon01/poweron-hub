/**
 * SolarQuizCard.tsx
 * 
 * Interactive quiz question display component
 * - Shows scenario context and question
 * - Renders 4 tappable answer options
 * - Provides immediate feedback with visual flash
 * - Shows explanation and alternative approach if wrong
 * - Optional 30-second speed drill timer
 * - Displays streak counter for consecutive correct answers
 */

import React, { useState, useEffect } from 'react';
import { QuizQuestion } from '../../services/solarTraining/SolarQuizEngine';

export interface SolarQuizCardProps {
  question: QuizQuestion;
  mode?: 'learning' | 'speed_drill';
  onAnswered?: (correct: boolean, attempt: number) => void;
  onNext?: () => void;
  streak?: number;
}

type FeedbackState = 'idle' | 'correct' | 'wrong';

export const SolarQuizCard: React.FC<SolarQuizCardProps> = ({
  question,
  mode = 'learning',
  onAnswered,
  onNext,
  streak = 0,
}) => {
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>('idle');
  const [attempts, setAttempts] = useState(1);
  const [timeRemaining, setTimeRemaining] = useState(30);
  const [showTimer, setShowTimer] = useState(mode === 'speed_drill');

  // Speed drill timer
  useEffect(() => {
    if (!showTimer || feedback !== 'idle') return;

    const timer = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          // Time's up - mark as unanswered wrong
          handleTimeout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [showTimer, feedback]);

  const handleTimeout = () => {
    setFeedback('wrong');
    if (onAnswered) onAnswered(false, attempts);
  };

  const handleOptionClick = (index: number) => {
    if (feedback !== 'idle') return; // Already answered
    
    setSelectedOption(index);
    const isCorrect = question.options[index].correct;
    
    if (isCorrect) {
      setFeedback('correct');
      if (onAnswered) onAnswered(true, attempts);
    } else {
      setFeedback('wrong');
      if (onAnswered) onAnswered(false, attempts);
    }
  };

  const handleRetry = () => {
    setSelectedOption(null);
    setFeedback('idle');
    setAttempts(attempts + 1);
    setTimeRemaining(30);
  };

  const timerColor = timeRemaining <= 10 ? '#ef4444' : timeRemaining <= 20 ? '#f59e0b' : '#10b981';

  return (
    <div className="w-full max-w-2xl mx-auto p-6 bg-white dark:bg-slate-900 rounded-lg shadow-lg">
      {/* Streak Counter */}
      {streak > 0 && (
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-300">
            🔥 Streak: {streak}
          </h3>
          {showTimer && (
            <div 
              className="text-lg font-bold"
              style={{ color: timerColor }}
            >
              ⏱️ {timeRemaining}s
            </div>
          )}
        </div>
      )}

      {/* Topic & Difficulty */}
      <div className="mb-4 flex items-center gap-3">
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">
          {question.topic}
        </span>
        <span className={`text-xs font-semibold px-2 py-1 rounded ${
          question.level === 'beginner' 
            ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200'
            : question.level === 'intermediate'
            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200'
            : 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200'
        }`}>
          {question.level}
        </span>
      </div>

      {/* Scenario Context */}
      <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-900/20 border-l-4 border-amber-400 rounded">
        <p className="text-sm text-amber-900 dark:text-amber-100 font-medium mb-2">
          📍 Scenario
        </p>
        <p className="text-sm text-amber-800 dark:text-amber-50">
          {question.scenario_context}
        </p>
      </div>

      {/* Question */}
      <div className="mb-6">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">
          {question.question}
        </h2>
      </div>

      {/* Options */}
      <div className="grid gap-3 mb-6">
        {question.options.map((option, index) => {
          const isSelected = selectedOption === index;
          const optionIsCorrect = option.correct;
          
          let optionClasses = 'p-4 border-2 rounded-lg cursor-pointer transition-all text-left';
          
          if (feedback === 'idle') {
            optionClasses += ' border-slate-300 dark:border-slate-600 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20';
          } else if (isSelected) {
            if (optionIsCorrect) {
              optionClasses += ' border-green-500 dark:border-green-400 bg-green-50 dark:bg-green-900/20 animate-pulse';
            } else {
              optionClasses += ' border-red-500 dark:border-red-400 bg-red-50 dark:bg-red-900/20 animate-pulse';
            }
          } else if ((feedback === 'correct' || feedback === 'wrong') && optionIsCorrect) {
            optionClasses += ' border-green-500 dark:border-green-400 bg-green-50 dark:bg-green-900/20';
          } else {
            optionClasses += ' border-slate-300 dark:border-slate-600 opacity-50';
          }

          return (
            <button
              key={index}
              onClick={() => handleOptionClick(index)}
              disabled={feedback !== 'idle'}
              className={optionClasses}
            >
              <div className="flex items-start gap-3">
                <div className={`text-lg font-bold mt-0.5 w-6 h-6 flex items-center justify-center rounded ${
                  isSelected
                    ? optionIsCorrect
                      ? 'bg-green-500 text-white'
                      : 'bg-red-500 text-white'
                    : (feedback === 'correct' || feedback === 'wrong') && optionIsCorrect
                    ? 'bg-green-500 text-white'
                    : 'bg-slate-300 dark:bg-slate-600 text-slate-600 dark:text-slate-400'
                }`}>
                  {isSelected ? (optionIsCorrect ? '✓' : '✗') : String.fromCharCode(65 + index)}
                </div>
                <span className="text-sm text-slate-800 dark:text-slate-100 flex-1">
                  {option.text}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Feedback Section */}
      {feedback !== 'idle' && (
        <div className={`mb-6 p-4 rounded-lg ${
          feedback === 'correct'
            ? 'bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-700'
            : 'bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700'
        }`}>
          {feedback === 'correct' ? (
            <div>
              <h3 className="text-sm font-bold text-green-700 dark:text-green-200 mb-2">
                ✓ Correct! Great work.
              </h3>
              <p className="text-sm text-green-700 dark:text-green-100 mb-3">
                {question.explanation}
              </p>
              <button
                onClick={onNext}
                className="w-full bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 text-white font-semibold py-2 rounded-lg transition-colors"
              >
                Next Question →
              </button>
            </div>
          ) : (
            <div>
              <h3 className="text-sm font-bold text-red-700 dark:text-red-200 mb-2">
                ✗ Not quite right yet.
              </h3>
              <p className="text-sm text-red-700 dark:text-red-100 mb-3">
                <strong>The correct approach is:</strong> {question.follow_up_if_wrong}
              </p>
              <div className="text-xs text-red-600 dark:text-red-300 mb-3 italic">
                {attempts === 1 ? '1st attempt' : `${attempts} attempts`}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleRetry}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white font-semibold py-2 rounded-lg transition-colors"
                >
                  Try Again
                </button>
                <button
                  onClick={onNext}
                  className="flex-1 bg-slate-500 hover:bg-slate-600 dark:bg-slate-600 dark:hover:bg-slate-700 text-white font-semibold py-2 rounded-lg transition-colors"
                >
                  Skip
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Idle State Helper */}
      {feedback === 'idle' && (
        <div className="text-center text-xs text-slate-400 dark:text-slate-500">
          Select an answer to continue
        </div>
      )}
    </div>
  );
};

export default SolarQuizCard;
