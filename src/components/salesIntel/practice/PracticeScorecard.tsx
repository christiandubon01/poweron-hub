// @ts-nocheck
import React, { useState } from 'react';
import { ScoreRoundResult, ScoringCategory } from '../../../services/salesIntel/PracticeScoringEngine';
import { PracticeRound, getTrendByDifficulty } from '../../../services/salesIntel/PracticeProgressTracker';
import SideBySideCard from './SideBySideCard';

interface PracticeScorecardProps {
  result: ScoreRoundResult;
  scenario: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  onRetry?: () => void;
  onHarder?: () => void;
  onNewScenario?: () => void;
  previousRounds?: PracticeRound[];
}

const scoreColor = (score: number): string => {
  if (score >= 7) return 'text-green-600 dark:text-green-400';
  if (score >= 5) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
};

const scoreBgColor = (score: number): string => {
  if (score >= 7) return 'bg-green-100 dark:bg-green-900/30';
  if (score >= 5) return 'bg-amber-100 dark:bg-amber-900/30';
  return 'bg-red-100 dark:bg-red-900/30';
};

const scoreRingColor = (score: number): string => {
  if (score >= 7) return 'border-green-500';
  if (score >= 5) return 'border-amber-500';
  return 'border-red-500';
};

export const PracticeScorecard: React.FC<PracticeScorecardProps> = ({
  result,
  scenario,
  difficulty,
  onRetry,
  onHarder,
  onNewScenario,
  previousRounds = [],
}) => {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const trend = getTrendByDifficulty(difficulty);

  // Extract category names for mapping
  const categoryMap: { [key: string]: string } = {
    'OPENING': 'opening',
    'OBJECTION HANDLING': 'objectionHandling',
    'TECHNICAL DEPTH': 'technicalDepth',
    'CLOSING': 'closing',
    'PACE': 'pace',
    'EMOTIONAL CONTROL': 'emotionalControl',
    'FILLER WORDS': 'fillerWords',
  };

  return (
    <div className="max-w-6xl mx-auto p-6 bg-gradient-to-br from-gray-50 to-white dark:from-gray-900 dark:to-gray-800">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          Practice Round Scorecard
        </h1>
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            <p className="mb-1">
              <span className="font-semibold">Scenario:</span> {scenario}
            </p>
            <p>
              <span className="font-semibold">Difficulty:</span>{' '}
              <span className="capitalize">{difficulty}</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
              Progress at {difficulty}
            </p>
            <p className="text-lg font-semibold text-gray-700 dark:text-gray-300">
              {trend.lastFiveAverage.toFixed(1)}/10 avg
              {trend.improvementRate > 0 ? (
                <span className="text-green-600 dark:text-green-400 ml-2">
                  ↑ {trend.improvementRate.toFixed(0)}%
                </span>
              ) : trend.improvementRate < 0 ? (
                <span className="text-red-600 dark:text-red-400 ml-2">
                  ↓ {Math.abs(trend.improvementRate).toFixed(0)}%
                </span>
              ) : null}
            </p>
          </div>
        </div>
      </div>

      {/* Overall Score (Large Circle) */}
      <div className="flex justify-center mb-8">
        <div
          className={`relative w-48 h-48 rounded-full flex items-center justify-center border-8 ${scoreRingColor(
            result.overall
          )} ${scoreBgColor(result.overall)}`}
        >
          <div className="text-center">
            <div className={`text-6xl font-bold ${scoreColor(result.overall)}`}>
              {result.overall}
            </div>
            <div className="text-sm font-medium text-gray-600 dark:text-gray-400 mt-2">
              {result.overall >= 7
                ? '🟢 Strong'
                : result.overall >= 5
                  ? '🟡 Good'
                  : '🔴 Needs Work'}
            </div>
          </div>
        </div>
      </div>

      {/* Key Insights */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
          <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase mb-1">
            Top Strength
          </p>
          <p className="text-sm text-gray-800 dark:text-gray-200">
            {result.topStrength}
          </p>
        </div>
        <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700 rounded-lg p-4">
          <p className="text-xs font-semibold text-orange-700 dark:text-orange-300 uppercase mb-1">
            Top Weakness
          </p>
          <p className="text-sm text-gray-800 dark:text-gray-200">
            {result.topWeakness}
          </p>
        </div>
      </div>

      {/* Filler Words Badge */}
      <div className="mb-8 flex justify-center">
        <div className="inline-block bg-purple-100 dark:bg-purple-900/30 border border-purple-300 dark:border-purple-700 rounded-full px-4 py-2">
          <span className="text-sm font-semibold text-purple-700 dark:text-purple-300">
            Filler Words: {result.fillerCount}
          </span>
          {result.fillerCount > 10 && (
            <span className="ml-2 text-xs text-purple-600 dark:text-purple-400">
              (Try pausing instead of saying "um")
            </span>
          )}
        </div>
      </div>

      {/* Category Breakdown */}
      <div className="mb-8">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
          Category Breakdown
        </h2>
        <div className="space-y-3">
          {result.categories.map((category: ScoringCategory, index: number) => (
            <div
              key={index}
              className={`border rounded-lg p-4 cursor-pointer transition-all ${
                expandedCategory === category.name
                  ? 'bg-white dark:bg-gray-700 border-gray-400'
                  : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600'
              }`}
              onClick={() =>
                setExpandedCategory(
                  expandedCategory === category.name ? null : category.name
                )
              }
            >
              {/* Score bar header */}
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                  {category.name}
                </h3>
                <div className="flex items-center gap-2">
                  <div className={`text-2xl font-bold ${scoreColor(category.score)}`}>
                    {category.score}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">/10</div>
                </div>
              </div>

              {/* Score bar */}
              <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2 mb-3">
                <div
                  className={`h-2 rounded-full transition-all ${
                    category.score >= 7
                      ? 'bg-green-500'
                      : category.score >= 5
                        ? 'bg-amber-500'
                        : 'bg-red-500'
                  }`}
                  style={{ width: `${Math.max((category.score / 10) * 100, 5)}%` }}
                />
              </div>

              {/* Category note */}
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                {category.note}
              </p>

              {/* Expanded weak moment */}
              {expandedCategory === category.name && (
                <div className="mt-4 pt-4 border-t border-gray-300 dark:border-gray-600">
                  <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2 uppercase">
                    Weak Moment at {category.weakMoment.timestamp}
                  </p>
                  <SideBySideCard
                    whatYouSaid={category.weakMoment.said}
                    strongerAlternative={category.weakMoment.shouldHaveSaid}
                    explanation={`In the "${category.name}" category, this moment cost ${Math.max(2, 10 - category.score)} points. The alternative is stronger because it demonstrates confidence, clarity, and professional positioning.`}
                    category={category.name}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ONE THING TO FIX - Prominent */}
      <div className="mb-8 bg-gradient-to-r from-red-500 to-orange-500 rounded-lg p-6 text-white shadow-lg">
        <h2 className="text-lg font-bold mb-2">🎯 ONE THING TO FIX</h2>
        <p className="text-base leading-relaxed">{result.oneThingToFix}</p>
      </div>

      {/* Progress Tracker */}
      {previousRounds && previousRounds.length > 0 && (
        <div className="mb-8 bg-gray-100 dark:bg-gray-700 rounded-lg p-6">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
            Last 5 Attempts at {difficulty}
          </h2>
          <div className="flex items-end justify-center gap-2 h-32">
            {previousRounds.slice(0, 5).map((round, index) => (
              <div key={index} className="flex flex-col items-center">
                <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">
                  {round.overall}
                </div>
                <div
                  className={`w-10 rounded-t-lg transition-all ${
                    round.overall >= 7
                      ? 'bg-green-500'
                      : round.overall >= 5
                        ? 'bg-amber-500'
                        : 'bg-red-500'
                  }`}
                  style={{
                    height: `${Math.max((round.overall / 10) * 100, 10)}px`,
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {onRetry && (
          <button
            onClick={onRetry}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white font-semibold rounded-lg transition-colors"
          >
            🔄 AGAIN
          </button>
        )}
        {onHarder && (
          <button
            onClick={onHarder}
            className="px-6 py-3 bg-orange-600 hover:bg-orange-700 dark:bg-orange-700 dark:hover:bg-orange-600 text-white font-semibold rounded-lg transition-colors"
          >
            ⬆️ HARDER
          </button>
        )}
        {onNewScenario && (
          <button
            onClick={onNewScenario}
            className="px-6 py-3 bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 text-white font-semibold rounded-lg transition-colors"
          >
            🆕 NEW SCENARIO
          </button>
        )}
      </div>
    </div>
  );
};

export default PracticeScorecard;
