/**
 * HUNTER Panel - Lead hunting and pipeline intelligence components
 * 
 * Exports:
 * - HunterPanel: Main panel component with lead inbox, filters, and metrics
 * - HunterLeadCard: Expandable lead card with full anatomy
 * - HunterScoreBadge: Circular lead score display with tier coloring
 * - HunterOutcomeModal: Modal for capturing lead outcomes (won/lost/deferred)
 * - HunterOutcomeStats: Analytics sub-panel showing outcome statistics
 */

export { HunterPanel, type HunterPanelProps } from './HunterPanel'
export { HunterLeadCard, type HunterLeadCardProps, type HunterLead } from './HunterLeadCard'
export { HunterScoreBadge, type HunterScoreBadgeProps, type ScoreFactor } from './HunterScoreBadge'
export { HunterOutcomeModal, type HunterOutcomeModalProps } from './HunterOutcomeModal'
export { HunterOutcomeStats, type HunterOutcomeStatsProps } from './HunterOutcomeStats'
