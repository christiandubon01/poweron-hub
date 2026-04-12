/**
 * Stripe Services Index
 * Exports all usage tracking and seat enforcement services
 */

// Usage Tracking exports
export {
  initUsageTracking,
  trackApiCall,
  trackVoiceCapture,
  trackVoiceSession,
  getUsageStats,
  checkUsageLimit,
  resetDailyCounters,
  getUsageMetric,
  type UsageMetric,
  type UsageStats,
  type UsageLimitCheck,
  type TierLimits,
} from './UsageTracker';

// Seat Enforcement exports
export {
  initSeatEnforcement,
  checkSeatLimit,
  getSeatUsage,
  onInviteTeamMember,
  canInviteTeamMember,
  getUpgradePrompt,
  addTeamMember,
  removeTeamMember,
  updateTeamMemberRole,
  getTeamMembers,
  getTierConfig,
  getAllTierConfigs,
  canDowngradeTier,
  getEnforcementMessage,
  type SeatUsageInfo,
  type UpgradePrompt,
} from './SeatEnforcement';
