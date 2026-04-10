/**
 * HUNTER Agent Services
 * 
 * Lead hunting and pipeline intelligence services
 */

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

// Scoring Engine
export * from './HunterScoringEngine'

// Cost Calculator
export * from './HunterCostCalculator'

// Pitch Generator
export * from './HunterPitchGenerator'

// Objection Bank
export * from './HunterObjectionBank'

// Types
export {
  LeadStatus,
  LeadType,
  ScoreTier as LeadScoreTier,
  PitchAngle,
  DebriefsOutcome,
  type HunterLead,
  type HunterDebrief,
  type HunterRule,
  type LeadFilter,
} from './HunterTypes'
