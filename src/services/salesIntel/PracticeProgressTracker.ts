export interface PracticeRound {
  date: string;
  scenario: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  scores: {
    opening: number;
    objectionHandling: number;
    technicalDepth: number;
    closing: number;
    pace: number;
    emotionalControl: number;
    fillerWords: number;
  };
  overall: number;
  fillerCount: number;
  topStrength: string;
  topWeakness: string;
  oneThingToFix: string;
}

const STORAGE_KEY = 'poweron_practice_rounds';

/**
 * Save a practice round to localStorage
 */
export function savePracticeRound(round: PracticeRound): void {
  const rounds = getPracticeRounds();
  rounds.push({
    ...round,
    date: round.date || new Date().toISOString(),
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rounds));
}

/**
 * Get all practice rounds
 */
export function getPracticeRounds(): PracticeRound[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/**
 * Get progress by difficulty level (last 10 rounds)
 */
export function getProgressByDifficulty(
  level: 'beginner' | 'intermediate' | 'advanced' | 'expert'
): PracticeRound[] {
  const rounds = getPracticeRounds();
  return rounds
    .filter((r) => r.difficulty === level)
    .sort(
      (a, b) =>
        new Date(b.date).getTime() - new Date(a.date).getTime()
    )
    .slice(0, 10);
}

/**
 * Get trend for a difficulty level
 */
export function getTrendByDifficulty(
  level: 'beginner' | 'intermediate' | 'advanced' | 'expert'
): {
  averageScore: number;
  improvementRate: number;
  lastFiveAverage: number;
} {
  const rounds = getProgressByDifficulty(level);
  if (rounds.length === 0) {
    return { averageScore: 0, improvementRate: 0, lastFiveAverage: 0 };
  }

  const allScores = rounds.map((r) => r.overall);
  const lastFive = rounds.slice(0, 5).map((r) => r.overall);

  const averageScore = allScores.reduce((a, b) => a + b, 0) / allScores.length;
  const lastFiveAverage =
    lastFive.length > 0 ? lastFive.reduce((a, b) => a + b, 0) / lastFive.length : 0;

  // Improvement rate: compare last 5 to all
  const improvementRate =
    lastFiveAverage > 0 && averageScore > 0
      ? ((lastFiveAverage - averageScore) / averageScore) * 100
      : 0;

  return {
    averageScore,
    improvementRate,
    lastFiveAverage,
  };
}

/**
 * Categories that consistently score below 5
 */
export function getWeakCategories(): string[] {
  const rounds = getPracticeRounds();
  if (rounds.length === 0) return [];

  const categoryScores: { [key: string]: number[] } = {
    opening: [],
    objectionHandling: [],
    technicalDepth: [],
    closing: [],
    pace: [],
    emotionalControl: [],
    fillerWords: [],
  };

  rounds.forEach((round) => {
    Object.entries(round.scores).forEach(([category, score]) => {
      categoryScores[category].push(score);
    });
  });

  const weak: string[] = [];
  Object.entries(categoryScores).forEach(([category, scores]) => {
    if (scores.length > 0) {
      const average = scores.reduce((a, b) => a + b, 0) / scores.length;
      if (average < 5) {
        weak.push(category);
      }
    }
  });

  return weak;
}

/**
 * Scenarios where score > 8 for 3 consecutive rounds
 */
export function getMasteredScenarios(): string[] {
  const rounds = getPracticeRounds();
  if (rounds.length < 3) return [];

  const scenarioRounds: { [scenario: string]: PracticeRound[] } = {};
  rounds.forEach((round) => {
    if (!scenarioRounds[round.scenario]) {
      scenarioRounds[round.scenario] = [];
    }
    scenarioRounds[round.scenario].push(round);
  });

  const mastered: string[] = [];
  Object.entries(scenarioRounds).forEach(([scenario, scenarioRounds]) => {
    const sorted = scenarioRounds.sort(
      (a, b) =>
        new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    const lastThree = sorted.slice(0, 3);
    if (
      lastThree.length === 3 &&
      lastThree.every((r) => r.overall > 8)
    ) {
      mastered.push(scenario);
    }
  });

  return mastered;
}

/**
 * Detect milestone achievements
 */
export function detectMilestones(round: PracticeRound): string[] {
  const milestones: string[] = [];
  const allRounds = getPracticeRounds();

  // First Level 4 round without discounting
  if (round.difficulty === 'expert' && round.overall > 8) {
    const previousExpert = allRounds.filter(
      (r) => r.difficulty === 'expert'
    ).length;
    if (previousExpert === 1) {
      milestones.push('🎯 First Expert round without discounting!');
    }
  }

  // Reached average > 8 at a difficulty
  const progress = getTrendByDifficulty(round.difficulty);
  if (progress.lastFiveAverage > 8) {
    milestones.push(`⭐ Mastering ${round.difficulty}!`);
  }

  // All categories > 7
  const allCategoriesHigh = Object.values(round.scores).every(
    (score) => score > 7
  );
  if (allCategoriesHigh) {
    milestones.push('🚀 All categories above 7!');
  }

  return milestones;
}

/**
 * Clear all practice history (for testing)
 */
export function clearPracticeHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export default {
  savePracticeRound,
  getPracticeRounds,
  getProgressByDifficulty,
  getTrendByDifficulty,
  getWeakCategories,
  getMasteredScenarios,
  detectMilestones,
  clearPracticeHistory,
};
