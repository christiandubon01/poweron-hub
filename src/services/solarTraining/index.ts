/**
 * Solar Training Module Index
 * Exports public API for solar training NEXUS integration
 */

// Morning Brief Integration
export {
  generateMorningBriefAdditions,
  formatMorningBriefContext,
  type MorningBriefAdditions,
} from './SolarNexusIntegration';

// End-of-Day Review
export {
  generateEndOfDayReview,
  formatEODReviewForDisplay,
  type EODReviewContent,
} from './SolarNexusIntegration';

// Streak Tracking
export {
  updateStreak,
  getStreakCount,
  type SolarTrainingStreak,
} from './SolarNexusIntegration';

// Session Recording
export {
  recordQuizSession,
  recordSolarDebrief,
} from './SolarNexusIntegration';

// Types
export type {
  SolarCertification,
  SolarStudyDomain,
  SolarTrainingSession,
  SolarDebrief,
} from './SolarNexusIntegration';

// Daily Scheduling
export {
  getScheduleConfig,
  saveScheduleConfig,
  scheduleMorningBrief,
  markMorningBriefTriggered,
  scheduleMicroQuiz,
  recordMicroQuizCompletion,
  scheduleEODReview,
  markEODReviewCompleted,
  getDailyProgress,
  getNextTrainingSession,
  getTodaysPendingEvents,
  initializeDailySchedule,
  isTrainingDue,
  formatDuration,
  type DailyScheduleConfig,
  type ScheduledEvent,
  type DailyProgress,
} from './SolarDailyScheduler';
