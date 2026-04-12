/**
 * HUNTER Agent Services
 * 
 * Lead hunting and pipeline intelligence services
 */

// Digital Signals (HT13)
export {
  SignalProcessor,
  SignalSource,
  SignalIntent,
  type RawSignal,
  type ProcessedSignal,
  type SignalIntentResult,
} from './HunterDigitalSignals'

// Outcome Tracker (HT6)
export {
  markLeadWon,
  markLeadLost,
  markLeadDeferred,
  markLeadArchived,
  getOutcomeStats,
  getOutcomesBySource,
  getOutcomesByPitchAngle,
  getTopLossReasons,
  getOutcomeTrend,
  type WonDetails,
  type LostDetails,
  type OutcomeStats,
  type OutcomeBySource,
  type OutcomeByPitchAngle,
  type TopLossReasons,
  type OutcomeTrend,
} from './HunterOutcomeTracker'

// Study Service (HT9)
export {
  fetchStudyQueue,
  deferLesson,
  completeStudyTopic,
  bundleStudySession,
  getStudyStats,
  getPendingCount,
  getStudyTopicWithContext,
  getStudyTopicsFiltered,
  StudyPriority,
  type StudyTopicDetail,
  type StudyBundle,
  type StudyStats,
} from './HunterStudyService'

// Scoring Engine
export * from './HunterScoringEngine'

// Cost Calculator
export * from './HunterCostCalculator'

// Pitch Generator
export * from './HunterPitchGenerator'

// Objection Bank
export * from './HunterObjectionBank'

// Source Analytics (HT14)
export {
  hunterSourceAnalytics,
  type SourceMetrics,
  type SourceAnalysis,
  type PitchAnglePerformance,
  type TimePattern,
  type HeatmapEntry,
} from './HunterSourceAnalytics'

// Types
export {
  LeadStatus,
  LeadType,
  ScoreTier as LeadScoreTier,
  PitchAngle,
  DebriefsOutcome,
  StudyQueueStatus,
  type HunterLead,
  type HunterDebrief,
  type HunterRule,
  type LeadFilter,
  type StudyTopic,
} from './HunterTypes'
