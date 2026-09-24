/**
 * ATB-5: conservative Scope Pack bounds.
 *
 * A handoff document is parsed locally. Only the structured contract is
 * persisted. These limits keep one jsonb row from becoming an unbounded
 * document store.
 */

/** Maximum source file size accepted for local parse. Rejected before parse. */
export const SCOPE_PACK_MAX_SOURCE_BYTES = 256 * 1024

/**
 * Maximum UTF-8 size of a persisted `import_scope_pack` request payload
 * (compact JSON). Every Scope Pack field filled to its character maximum
 * serializes to 182241 bytes; Postgres jsonb text adds a few hundred bytes
 * of separator spacing. 192 KiB accepts that contract and rejects a 256 KiB
 * raw handoff document (262144 bytes) before it can be stored.
 */
export const IMPORT_SCOPE_PACK_MAX_PAYLOAD_BYTES = 192 * 1024

export const SCOPE_PACK_ALLOWED_EXTENSIONS = ['.md', '.txt'] as const

export const SCOPE_PACK_BOUNDS = {
  titleMaxChars: 160,
  intentMaxChars: 4_000,
  checkpointMaxChars: 200,
  filenameMaxChars: 260,
  sourceHashChars: 64,
  claimMaxChars: 800,
  ruleMaxChars: 800,
  phaseTitleMaxChars: 160,
  phaseGoalMaxChars: 800,
  acceptanceMaxChars: 800,
  decisionMaxChars: 800,
  riskMaxChars: 800,
  areaMaxChars: 200,
  summaryMaxChars: 480,
  evidenceRefMaxChars: 256,
  evidenceRefsMax: 8,
  unmappedSectionNameMaxChars: 120,

  maxFoundationClaims: 32,
  maxLockedRules: 32,
  maxDoNotTouch: 32,
  maxRoadmapPhases: 24,
  maxAcceptanceCriteria: 24,
  maxOwnerDecisions: 24,
  maxSupersededDecisions: 24,
  maxKnownRisks: 16,
  maxRelatedAppAreas: 16,
  maxUnmappedSectionNames: 24,
} as const

export type ScopePackBounds = typeof SCOPE_PACK_BOUNDS
