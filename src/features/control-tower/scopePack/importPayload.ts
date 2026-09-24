/**
 * ATB-7A1: fail-closed import_scope_pack payload gate.
 *
 * Called before agent_control_requests insert. The accepted shape is the
 * existing ScopePackImportDraft — flat, allowlisted, and bounded by
 * SCOPE_PACK_BOUNDS. Raw handoff text and filesystem paths are not fields
 * of that type, so they are rejected as unknown keys. Migration 136 repeats
 * this gate in a BEFORE INSERT trigger so a hand-built table write cannot
 * bypass the app.
 */

import { IMPORT_SCOPE_PACK_MAX_PAYLOAD_BYTES, SCOPE_PACK_BOUNDS } from './bounds'

export const IMPORT_SCOPE_PACK_PAYLOAD_KEYS = [
  'title',
  'sourceFilename',
  'sourceHash',
  'historicalCheckpoint',
  'intent',
  'foundationClaims',
  'lockedRules',
  'doNotTouch',
  'roadmapPhases',
  'currentPhaseId',
  'acceptanceCriteria',
  'runtimeAcceptanceRequired',
  'ownerDecisions',
  'supersededDecisions',
  'knownRisks',
  'relatedAppAreas',
  'forceNewVersion',
] as const

export const IMPORT_SCOPE_PACK_PHASE_KEYS = ['id', 'title', 'goal', 'executionIntent'] as const

const PAYLOAD_KEYS = new Set<string>(IMPORT_SCOPE_PACK_PAYLOAD_KEYS)
const PHASE_KEYS = new Set<string>(IMPORT_SCOPE_PACK_PHASE_KEYS)
const PHASE_INTENTS = new Set(['audit', 'implementation', 'verification', 'research'])

const STRING_LISTS: ReadonlyArray<{ key: string; maxItems: number; maxChars: number }> = [
  { key: 'foundationClaims', maxItems: SCOPE_PACK_BOUNDS.maxFoundationClaims, maxChars: SCOPE_PACK_BOUNDS.claimMaxChars },
  { key: 'lockedRules', maxItems: SCOPE_PACK_BOUNDS.maxLockedRules, maxChars: SCOPE_PACK_BOUNDS.ruleMaxChars },
  { key: 'doNotTouch', maxItems: SCOPE_PACK_BOUNDS.maxDoNotTouch, maxChars: SCOPE_PACK_BOUNDS.ruleMaxChars },
  { key: 'acceptanceCriteria', maxItems: SCOPE_PACK_BOUNDS.maxAcceptanceCriteria, maxChars: SCOPE_PACK_BOUNDS.acceptanceMaxChars },
  { key: 'ownerDecisions', maxItems: SCOPE_PACK_BOUNDS.maxOwnerDecisions, maxChars: SCOPE_PACK_BOUNDS.decisionMaxChars },
  { key: 'supersededDecisions', maxItems: SCOPE_PACK_BOUNDS.maxSupersededDecisions, maxChars: SCOPE_PACK_BOUNDS.decisionMaxChars },
  { key: 'knownRisks', maxItems: SCOPE_PACK_BOUNDS.maxKnownRisks, maxChars: SCOPE_PACK_BOUNDS.riskMaxChars },
  { key: 'relatedAppAreas', maxItems: SCOPE_PACK_BOUNDS.maxRelatedAppAreas, maxChars: SCOPE_PACK_BOUNDS.areaMaxChars },
]

export type ImportPayloadVerdict =
  | { ok: true }
  | { ok: false; code: 'not_object' | 'too_large' | 'unknown_field' | 'invalid_payload'; message: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function utf8Bytes(value: unknown): number {
  const encoded = JSON.stringify(value)
  if (typeof encoded !== 'string') return Number.POSITIVE_INFINITY
  return new TextEncoder().encode(encoded).length
}

function reject(code: 'not_object' | 'too_large' | 'unknown_field' | 'invalid_payload', message: string): ImportPayloadVerdict {
  return { ok: false, code, message }
}

function readRequiredString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max) return null
  return trimmed
}

function readOptionalString(value: unknown, max: number): boolean {
  if (value === undefined || value === null || value === '') return true
  return readRequiredString(value, max) !== null
}

function readStringList(value: unknown, maxItems: number, maxChars: number): boolean {
  if (value === undefined || value === null) return true
  if (!Array.isArray(value) || value.length > maxItems) return false
  return value.every((entry) => readRequiredString(entry, maxChars) !== null)
}

/**
 * Accept only a bounded Scope Pack import draft. Unknown top-level keys,
 * unknown phase keys, and oversized JSON are rejected. The message never
 * echoes payload contents.
 */
export function assertPersistableImportScopePackPayload(payload: unknown): ImportPayloadVerdict {
  if (!isRecord(payload)) {
    return reject('not_object', 'import_scope_pack payload must be a JSON object.')
  }
  if (utf8Bytes(payload) > IMPORT_SCOPE_PACK_MAX_PAYLOAD_BYTES) {
    return reject('too_large', 'import_scope_pack payload exceeds the persisted size bound.')
  }
  for (const key of Object.keys(payload)) {
    if (!PAYLOAD_KEYS.has(key)) {
      return reject('unknown_field', 'import_scope_pack payload contains an unknown field.')
    }
  }

  const title = readRequiredString(payload.title, SCOPE_PACK_BOUNDS.titleMaxChars)
  const sourceFilename = readRequiredString(payload.sourceFilename, SCOPE_PACK_BOUNDS.filenameMaxChars)
  const sourceHash = readRequiredString(payload.sourceHash, SCOPE_PACK_BOUNDS.sourceHashChars)
  if (!title || !sourceFilename || !sourceHash) {
    return reject('invalid_payload', 'import_scope_pack payload is missing a required field.')
  }
  if (/[\\/]/.test(sourceFilename) || /^[a-zA-Z]:/u.test(sourceFilename) || !/\.(md|txt)$/iu.test(sourceFilename)) {
    return reject('invalid_payload', 'sourceFilename must be a .md or .txt basename.')
  }
  if (!/^[0-9a-f]{64}$/u.test(sourceHash)) {
    return reject('invalid_payload', 'sourceHash must be a 64-character SHA-256 hex digest.')
  }
  if (!readOptionalString(payload.intent, SCOPE_PACK_BOUNDS.intentMaxChars)) {
    return reject('invalid_payload', 'intent exceeds its bound.')
  }
  if (!readOptionalString(payload.historicalCheckpoint, SCOPE_PACK_BOUNDS.checkpointMaxChars)) {
    return reject('invalid_payload', 'historicalCheckpoint exceeds its bound.')
  }
  for (const list of STRING_LISTS) {
    if (!readStringList(payload[list.key], list.maxItems, list.maxChars)) {
      return reject('invalid_payload', 'import_scope_pack payload has an invalid list.')
    }
  }
  if (!Array.isArray(payload.roadmapPhases) || payload.roadmapPhases.length > SCOPE_PACK_BOUNDS.maxRoadmapPhases) {
    return reject('invalid_payload', 'roadmapPhases must be a bounded array.')
  }

  const seen = new Set<string>()
  for (const phase of payload.roadmapPhases) {
    if (!isRecord(phase)) {
      return reject('invalid_payload', 'Each roadmap phase must be an object.')
    }
    for (const key of Object.keys(phase)) {
      if (!PHASE_KEYS.has(key)) {
        return reject('unknown_field', 'import_scope_pack payload contains an unknown field.')
      }
    }
    const id = readRequiredString(phase.id, 64)
    const phaseTitle = readRequiredString(phase.title, SCOPE_PACK_BOUNDS.phaseTitleMaxChars)
    const goal = readRequiredString(phase.goal, SCOPE_PACK_BOUNDS.phaseGoalMaxChars)
    if (!id || !phaseTitle || !goal || seen.has(id)) {
      return reject('invalid_payload', 'roadmapPhases contains an invalid phase.')
    }
    seen.add(id)
    if (phase.executionIntent !== undefined && phase.executionIntent !== null) {
      if (typeof phase.executionIntent !== 'string' || !PHASE_INTENTS.has(phase.executionIntent)) {
        return reject('invalid_payload', 'phase.executionIntent is not a known intent.')
      }
    }
  }

  if (payload.currentPhaseId !== undefined && payload.currentPhaseId !== null && payload.currentPhaseId !== '') {
    const current = readRequiredString(payload.currentPhaseId, 64)
    if (!current || (seen.size > 0 && !seen.has(current))) {
      return reject('invalid_payload', 'currentPhaseId must match a roadmap phase.')
    }
  }
  if (payload.runtimeAcceptanceRequired !== undefined && typeof payload.runtimeAcceptanceRequired !== 'boolean') {
    return reject('invalid_payload', 'runtimeAcceptanceRequired must be a boolean.')
  }
  if (payload.forceNewVersion !== undefined && typeof payload.forceNewVersion !== 'boolean') {
    return reject('invalid_payload', 'forceNewVersion must be a boolean.')
  }
  return { ok: true }
}
