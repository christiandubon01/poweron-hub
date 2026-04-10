/**
 * SPARK Training Analytics
 * Aggregates training data across all rounds
 * Tracks improvement patterns, mastery achievements, and coaching effectiveness
 */

export interface RoundResult {
  roundId: string;
  difficulty: 'easy' | 'medium' | 'hard';
  scenario: string;
  score: number;
  date: number;
  duration: number; // seconds
  turnCount: number;
  discountCount: number;
  fillerWordCount: number;
  hedgeLanguageCount: number;
  technicalDepthScore: number; // 0-100
  hasNecReference: boolean;
  hasProjectReference: boolean;
  licensingMentioned: boolean;
  coachingAlertCount: number;
  coachingAlertTypes: string[];
}

export interface TrainingSession {
  sessionId: string;
  startTime: number;
  endTime?: number;
  rounds: RoundResult[];
  totalScore: number;
  averageScore: number;
  improvementTrend: number; // percentage change
  focusAreas: string[];
}

export interface WeeklyReport {
  weekStartDate: number;
  weekEndDate: number;
  sessionsCount: number;
  totalRounds: number;
  timeSpent: number; // seconds
  averageScore: number;
  bestScore: number;
  worstScore: number;
  discountFrequency: number; // percentage
  fillerWordTrend: number; // change from previous week
  technicalStrengthTrend: number; // change from previous week
  masteredScenarios: string[];
  improvementVelocity: number; // score improvement per 10 rounds
  recommendations: string[];
}

export interface MasteryLevel {
  scenario: string;
  difficulty: 'easy' | 'medium' | 'hard';
  lastPracticed: number;
  consecutiveHighScores: number;
  isMastered: boolean;
  averageScore: number;
  roundCount: number;
}

/**
 * Create a round result from raw practice data
 */
export function createRoundResult(
  roundId: string,
  difficulty: 'easy' | 'medium' | 'hard',
  scenario: string,
  analysisData: {
    score: number;
    duration: number;
    turnCount: number;
    discountCount: number;
    fillerWordCount: number;
    hedgeLanguageCount: number;
    technicalDepthScore: number;
    hasNecReference: boolean;
    hasProjectReference: boolean;
    licensingMentioned: boolean;
    coachingAlertCount: number;
    coachingAlertTypes: string[];
  }
): RoundResult {
  return {
    roundId,
    difficulty,
    scenario,
    score: analysisData.score,
    date: Date.now(),
    duration: analysisData.duration,
    turnCount: analysisData.turnCount,
    discountCount: analysisData.discountCount,
    fillerWordCount: analysisData.fillerWordCount,
    hedgeLanguageCount: analysisData.hedgeLanguageCount,
    technicalDepthScore: analysisData.technicalDepthScore,
    hasNecReference: analysisData.hasNecReference,
    hasProjectReference: analysisData.hasProjectReference,
    licensingMentioned: analysisData.licensingMentioned,
    coachingAlertCount: analysisData.coachingAlertCount,
    coachingAlertTypes: analysisData.coachingAlertTypes,
  };
}

/**
 * Calculate discount frequency across rounds
 */
export function getDiscountFrequency(rounds: RoundResult[]): number {
  if (rounds.length === 0) return 0;
  const roundsWithDiscount = rounds.filter(r => r.discountCount > 0).length;
  return Math.round((roundsWithDiscount / rounds.length) * 100);
}

/**
 * Get filler word count trend across rounds
 * Negative trend = improving (fewer fillers)
 */
export function getFillerWordTrend(rounds: RoundResult[]): number {
  if (rounds.length < 2) return 0;
  
  const first5Avg = rounds
    .slice(0, Math.min(5, rounds.length))
    .reduce((sum, r) => sum + r.fillerWordCount, 0) / Math.min(5, rounds.length);
  
  const last5 = rounds.slice(Math.max(0, rounds.length - 5));
  const last5Avg = last5.reduce((sum, r) => sum + r.fillerWordCount, 0) / last5.length;
  
  return Math.round(((last5Avg - first5Avg) / first5Avg) * 100);
}

/**
 * Get technical strength trend
 * Positive trend = improving
 */
export function getTechnicalStrengthTrend(rounds: RoundResult[]): number {
  if (rounds.length < 2) return 0;
  
  const first5 = rounds.slice(0, Math.min(5, rounds.length));
  const first5Avg = first5.reduce((sum, r) => sum + r.technicalDepthScore, 0) / first5.length;
  
  const last5 = rounds.slice(Math.max(0, rounds.length - 5));
  const last5Avg = last5.reduce((sum, r) => sum + r.technicalDepthScore, 0) / last5.length;
  
  return Math.round(((last5Avg - first5Avg) / first5Avg) * 100);
}

/**
 * Get average score trend over last 10 rounds
 */
export function getScoreImprovementVelocity(rounds: RoundResult[]): number {
  if (rounds.length < 10) return 0;
  
  const first10 = rounds.slice(0, 10);
  const first10Avg = first10.reduce((sum, r) => sum + r.score, 0) / first10.length;
  
  const last10 = rounds.slice(Math.max(0, rounds.length - 10));
  const last10Avg = last10.reduce((sum, r) => sum + r.score, 0) / last10.length;
  
  return Math.round(((last10Avg - first10Avg) / first10Avg) * 100);
}

/**
 * Identify which scenarios are mastered
 * Mastery: >=8 score for 3+ consecutive rounds
 */
export function getMasteredScenarios(rounds: RoundResult[]): string[] {
  const scenarioRounds: { [key: string]: RoundResult[] } = {};
  
  rounds.forEach(r => {
    if (!scenarioRounds[r.scenario]) {
      scenarioRounds[r.scenario] = [];
    }
    scenarioRounds[r.scenario].push(r);
  });

  const mastered: string[] = [];
  
  Object.entries(scenarioRounds).forEach(([scenario, sRounds]) => {
    // Check last 3 rounds of this scenario
    const recent = sRounds.slice(-3);
    if (recent.length >= 3) {
      const allHighScore = recent.every(r => r.score >= 8);
      if (allHighScore) {
        mastered.push(scenario);
      }
    }
  });

  return mastered;
}

/**
 * Get mastery progression for a specific scenario
 */
export function getScenarioMastery(
  scenario: string,
  rounds: RoundResult[]
): MasteryLevel {
  const scenarioRounds = rounds.filter(r => r.scenario === scenario);
  
  if (scenarioRounds.length === 0) {
    return {
      scenario,
      difficulty: 'easy',
      lastPracticed: 0,
      consecutiveHighScores: 0,
      isMastered: false,
      averageScore: 0,
      roundCount: 0,
    };
  }

  const recent = scenarioRounds.slice(-3);
  const consecutiveHigh = recent.filter(r => r.score >= 8).length;
  const isMastered = consecutiveHigh >= 3;
  const avgScore = Math.round(
    scenarioRounds.reduce((sum, r) => sum + r.score, 0) / scenarioRounds.length
  );

  return {
    scenario,
    difficulty: scenarioRounds[scenarioRounds.length - 1]?.difficulty || 'easy',
    lastPracticed: scenarioRounds[scenarioRounds.length - 1]?.date || 0,
    consecutiveHighScores: consecutiveHigh,
    isMastered,
    averageScore: avgScore,
    roundCount: scenarioRounds.length,
  };
}

/**
 * Generate focus areas based on performance gaps
 */
export function generateFocusAreas(rounds: RoundResult[]): string[] {
  if (rounds.length === 0) return [];

  const focusAreas: string[] = [];

  // Discount frequency
  const discountFreq = getDiscountFrequency(rounds);
  if (discountFreq > 25) {
    focusAreas.push('Price defense - Stop offering discounts');
  }

  // Filler words
  const avgFillers = rounds.reduce((sum, r) => sum + r.fillerWordCount, 0) / rounds.length;
  if (avgFillers > 2) {
    focusAreas.push('Speech delivery - Reduce filler words');
  }

  // Hedge language
  const avgHedge = rounds.reduce((sum, r) => sum + r.hedgeLanguageCount, 0) / rounds.length;
  if (avgHedge > 1) {
    focusAreas.push('Assertiveness - Speak with confidence');
  }

  // Technical depth
  const avgTech = rounds.reduce((sum, r) => sum + r.technicalDepthScore, 0) / rounds.length;
  if (avgTech < 50) {
    focusAreas.push('Technical credibility - Reference projects and codes');
  }

  // NEC references
  const necRefs = rounds.filter(r => r.hasNecReference).length;
  if (necRefs < rounds.length * 0.3) {
    focusAreas.push('Code knowledge - Cite NEC requirements');
  }

  return focusAreas.slice(0, 3);
}

/**
 * Create a weekly training report
 */
export function generateWeeklyReport(
  sessions: TrainingSession[],
  weekStartDate: number
): WeeklyReport {
  const weekEndDate = weekStartDate + 7 * 24 * 60 * 60 * 1000;
  
  const weekSessions = sessions.filter(
    s => s.startTime >= weekStartDate && s.startTime < weekEndDate
  );

  if (weekSessions.length === 0) {
    return {
      weekStartDate,
      weekEndDate,
      sessionsCount: 0,
      totalRounds: 0,
      timeSpent: 0,
      averageScore: 0,
      bestScore: 0,
      worstScore: 0,
      discountFrequency: 0,
      fillerWordTrend: 0,
      technicalStrengthTrend: 0,
      masteredScenarios: [],
      improvementVelocity: 0,
      recommendations: ['Start practicing to see progress'],
    };
  }

  const allRounds = weekSessions.flatMap(s => s.rounds);
  const totalTime = weekSessions.reduce((sum, s) => sum + (s.endTime ? s.endTime - s.startTime : 0), 0);
  
  const scores = allRounds.map(r => r.score);
  const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const bestScore = Math.max(...scores);
  const worstScore = Math.min(...scores);

  const discountFreq = getDiscountFrequency(allRounds);
  const fillerTrend = getFillerWordTrend(allRounds);
  const techTrend = getTechnicalStrengthTrend(allRounds);
  const improvementVel = getScoreImprovementVelocity(allRounds);
  const mastered = getMasteredScenarios(allRounds);
  const focusAreas = generateFocusAreas(allRounds);

  const recommendations: string[] = [];
  
  if (improvementVel > 5) {
    recommendations.push('🎯 Excellent progress! Keep up the practice.');
  }
  if (discountFreq > 25) {
    recommendations.push('⚠️ Focus on price defense. Stop discounting.');
  }
  if (fillerTrend < -10) {
    recommendations.push('✅ Great improvement on speech clarity!');
  }
  if (mastered.length > 0) {
    recommendations.push(`🏆 Mastered: ${mastered.join(', ')}`);
  }
  if (focusAreas.length > 0) {
    recommendations.push(`📚 Next focus: ${focusAreas[0]}`);
  }

  return {
    weekStartDate,
    weekEndDate,
    sessionsCount: weekSessions.length,
    totalRounds: allRounds.length,
    timeSpent: Math.round(totalTime / 1000), // seconds
    averageScore: avgScore,
    bestScore,
    worstScore,
    discountFrequency: discountFreq,
    fillerWordTrend: fillerTrend,
    technicalStrengthTrend: techTrend,
    masteredScenarios: mastered,
    improvementVelocity: improvementVel,
    recommendations,
  };
}

/**
 * Format weekly report for display
 */
export function formatWeeklyReport(report: WeeklyReport): string {
  const weekStart = new Date(report.weekStartDate).toLocaleDateString();
  
  return `
SPARK Training Report — Week of ${weekStart}

📊 Summary
  Sessions: ${report.sessionsCount}
  Rounds: ${report.totalRounds}
  Time: ${Math.round(report.timeSpent / 60)} minutes
  Average Score: ${report.averageScore}/10

📈 Trends
  Score Improvement: ${report.improvementVelocity > 0 ? '+' : ''}${report.improvementVelocity}%
  Filler Words: ${report.fillerWordTrend < 0 ? '✅' : '⚠️'} ${report.fillerWordTrend > 0 ? '+' : ''}${report.fillerWordTrend}%
  Technical Strength: ${report.technicalStrengthTrend > 0 ? '✅' : '⚠️'} ${report.technicalStrengthTrend > 0 ? '+' : ''}${report.technicalStrengthTrend}%
  Discount Frequency: ${report.discountFrequency}%

🏆 Mastered Scenarios
  ${report.masteredScenarios.length > 0 ? report.masteredScenarios.join(', ') : 'None yet'}

💡 Recommendations
  ${report.recommendations.map(r => `• ${r}`).join('\n  ')}
  `.trim();
}

/**
 * Calculate session improvement trend
 */
export function getSessionImprovementTrend(rounds: RoundResult[]): number {
  if (rounds.length < 2) return 0;
  
  const firstScore = rounds[0].score;
  const lastScore = rounds[rounds.length - 1].score;
  
  return Math.round(((lastScore - firstScore) / firstScore) * 100);
}

/**
 * Export training analytics as JSON
 */
export function exportTrainingAnalytics(sessions: TrainingSession[]): string {
  const allRounds = sessions.flatMap(s => s.rounds);
  
  const stats = {
    totalSessions: sessions.length,
    totalRounds: allRounds.length,
    averageScore: Math.round(allRounds.reduce((sum, r) => sum + r.score, 0) / allRounds.length),
    bestScore: Math.max(...allRounds.map(r => r.score)),
    discountFrequency: getDiscountFrequency(allRounds),
    fillerWordTrend: getFillerWordTrend(allRounds),
    technicalStrengthTrend: getTechnicalStrengthTrend(allRounds),
    masteredScenarios: getMasteredScenarios(allRounds),
    sessions: sessions.map(s => ({
      sessionId: s.sessionId,
      startTime: s.startTime,
      endTime: s.endTime,
      rounds: s.rounds.length,
      score: s.averageScore,
    })),
  };

  return JSON.stringify(stats, null, 2);
}
