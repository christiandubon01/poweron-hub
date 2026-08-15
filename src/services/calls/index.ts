export {
  normalizePhone,
  dialerDigits,
  openTelDialer,
} from './phoneNormalize'

export {
  matchEntitiesByNormalizedPhone,
  linksFromMatchResult,
  type CallEntityCandidate,
  type CallEntityMatch,
  type CallEntityMatchResult,
  type CallEntityKind,
} from './matchCallEntities'

export {
  CALL_DIRECTIONS,
  CALL_OUTCOMES,
  CALL_CLASSIFICATIONS,
  CallLogAuthorityError,
  createCallLog,
  updateCallLogClassification,
  fetchRecentCallLogs,
  fetchCallLogsForHunterLead,
  matchPhoneAgainstOrgEntities,
  collectPhoneMatchCandidates,
  initiateHunterOutboundCall,
  type CallDirection,
  type CallOutcome,
  type CallClassification,
  type CallLog,
  type CreateCallLogInput,
} from './callLogService'
