/**
 * ATB-5: Scope Pack contract, import validation, reconciliation, and
 * create_plan inheritance. Host-side only. Raw handoff text is never stored
 * or published.
 */

import { randomUUID } from 'node:crypto';

import { normalizeSafeRepoRelativePath, type VerdictState } from './types.ts';
import type { SnapshotSignal } from './types.ts';

export const SCOPE_PACK_MAX_SOURCE_BYTES = 256 * 1024;

/**
 * Persisted import_scope_pack payload ceiling (compact JSON, UTF-8).
 * The character-maximum Scope Pack contract is 182241 bytes. 192 KiB accepts
 * that contract and rejects a 256 KiB raw handoff document.
 */
export const IMPORT_SCOPE_PACK_MAX_PAYLOAD_BYTES = 192 * 1024;

export const IMPORT_SCOPE_PACK_PAYLOAD_KEYS = new Set([
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
]);

export const IMPORT_SCOPE_PACK_PHASE_KEYS = new Set(['id', 'title', 'goal', 'executionIntent']);

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
  maxFoundationClaims: 32,
  maxLockedRules: 32,
  maxDoNotTouch: 32,
  maxRoadmapPhases: 24,
  maxAcceptanceCriteria: 24,
  maxOwnerDecisions: 24,
  maxSupersededDecisions: 24,
  maxKnownRisks: 16,
  maxRelatedAppAreas: 16,
} as const;

export type ScopePackReconciliationState = 'unverified' | 'current' | 'stale' | 'conflict';
export type FoundationClaimState = 'CURRENT' | 'STALE' | 'CONFLICT' | 'UNVERIFIED';
export type ScopePackPhaseStatus = 'not-started' | 'active' | 'complete' | 'blocked' | 'deferred';
export type ScopePackPhaseIntent = 'audit' | 'implementation' | 'verification' | 'research';

export interface FoundationClaim {
  claimId: string;
  claim: string;
  state: FoundationClaimState;
  evidenceRefs: string[];
  reconciliationSummary: string | null;
}

export interface ScopePackPhase {
  id: string;
  title: string;
  goal: string;
  status: ScopePackPhaseStatus;
  executionIntent: ScopePackPhaseIntent;
}

export interface ScopePackContract {
  packId: string;
  orgId: string;
  repoKey: string;
  title: string;
  sourceFilename: string;
  sourceHash: string;
  importedAt: string;
  updatedAt: string;
  historicalCheckpoint: string | null;
  intent: string;
  foundationClaims: FoundationClaim[];
  lockedRules: string[];
  doNotTouch: string[];
  roadmapPhases: ScopePackPhase[];
  currentPhaseId: string | null;
  acceptanceCriteria: string[];
  runtimeAcceptanceRequired: boolean;
  ownerDecisions: string[];
  supersededDecisions: string[];
  knownRisks: string[];
  relatedAppAreas: string[];
  reconciliationState: ScopePackReconciliationState;
  reconciliationSummary: string | null;
  lastReconciledAt: string | null;
  version: number;
}

export interface ScopePackImportDraft {
  title: string;
  sourceFilename: string;
  sourceHash: string;
  historicalCheckpoint: string | null;
  intent: string;
  foundationClaims: string[];
  lockedRules: string[];
  doNotTouch: string[];
  roadmapPhases: Array<{
    id: string;
    title: string;
    goal: string;
    executionIntent?: ScopePackPhaseIntent;
  }>;
  currentPhaseId: string | null;
  acceptanceCriteria: string[];
  runtimeAcceptanceRequired: boolean;
  ownerDecisions: string[];
  supersededDecisions: string[];
  knownRisks: string[];
  relatedAppAreas: string[];
  forceNewVersion?: boolean;
}

export interface ScopePackRef {
  packId: string;
  version: number;
  phaseId: string;
}

export interface CreatePlanScopePackFields {
  scopePackId: string;
  scopePackVersion: number;
  scopePackPhaseId: string;
  staleAcknowledged: boolean;
  ownerReviewedConflict: boolean;
}

export interface ClaimReconciliation {
  claimId: string;
  state: FoundationClaimState;
  reconciliationSummary: string;
  evidenceRefs: string[];
}

export interface ScopePackArchitectVerdict {
  state: Extract<VerdictState, 'CONTINUE' | 'WATCH' | 'NEEDS_OWNER'>;
  summary: string;
  recommendedAction: 'none' | 'watch' | 'owner-review';
  mayContinue: boolean;
}

export interface ScopePackApprovalGate {
  canApproveImplementation: boolean;
  requiresOwnerReview: boolean;
  requiresStaleAcknowledgment: boolean;
  reason: string | null;
}

const FORBIDDEN_GIT_ARGS = new Set([
  'checkout', 'reset', 'switch', 'restore', 'clean', 'stash', 'rebase', 'merge', 'cherry-pick',
]);

const PATH_LIKE = /^(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+(?:\/\*\*)?$|^[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+$/u;

export function isAuditLikeIntent(intent: ScopePackPhaseIntent | undefined): boolean {
  return intent === 'audit' || intent === 'research';
}

export function inferPhaseExecutionIntent(title: string, goal: string): ScopePackPhaseIntent {
  const haystack = `${title} ${goal}`.toLowerCase();
  if (/\bno implementation\b|\bread-?only\b|\btruth audit\b|\baudit\b/u.test(haystack)) {
    return 'audit';
  }
  if (/\bresearch\b|\binvestigat/u.test(haystack)) {
    return 'research';
  }
  if (/\bverif(?:y|ication|ier)\b/u.test(haystack) && !/\bimplement/u.test(haystack)) {
    return 'verification';
  }
  return 'implementation';
}

export function deriveReconciliationState(claims: readonly FoundationClaim[]): ScopePackReconciliationState {
  if (claims.some((claim) => claim.state === 'CONFLICT')) {
    return 'conflict';
  }
  if (claims.some((claim) => claim.state === 'STALE')) {
    return 'stale';
  }
  const verifiable = claims.filter((claim) => claim.state !== 'UNVERIFIED');
  if (claims.length > 0 && verifiable.length === claims.length && verifiable.every((claim) => claim.state === 'CURRENT')) {
    return 'current';
  }
  return 'unverified';
}

export function mapArchitectVerdict(state: ScopePackReconciliationState): ScopePackArchitectVerdict {
  if (state === 'conflict') {
    return {
      state: 'NEEDS_OWNER',
      summary: 'Scope Pack conflicts with current repository truth.',
      recommendedAction: 'owner-review',
      mayContinue: false,
    };
  }
  if (state === 'stale') {
    return {
      state: 'WATCH',
      summary: 'Historical foundation has changed; review reconciliation before proceeding.',
      recommendedAction: 'watch',
      mayContinue: true,
    };
  }
  if (state === 'current') {
    return {
      state: 'CONTINUE',
      summary: 'Scope Pack foundation matches the current repository.',
      recommendedAction: 'none',
      mayContinue: true,
    };
  }
  return {
    state: 'WATCH',
    summary: 'Some historical foundation claims could not be verified.',
    recommendedAction: 'watch',
    mayContinue: true,
  };
}

export function buildScopePackApprovalGate(
  state: ScopePackReconciliationState,
  intent: ScopePackPhaseIntent,
  options: { staleAcknowledged?: boolean; ownerReviewedConflict?: boolean } = {},
): ScopePackApprovalGate {
  if (state === 'conflict' && !options.ownerReviewedConflict) {
    return {
      canApproveImplementation: false,
      requiresOwnerReview: true,
      requiresStaleAcknowledgment: false,
      reason: 'CONFLICT blocks implementation approval until the owner reviews the pack.',
    };
  }
  if (state === 'stale' && !options.staleAcknowledged && intent === 'implementation') {
    return {
      canApproveImplementation: false,
      requiresOwnerReview: false,
      requiresStaleAcknowledgment: true,
      reason: 'STALE requires explicit owner acknowledgment before implementation.',
    };
  }
  if (isAuditLikeIntent(intent)) {
    return {
      canApproveImplementation: false,
      requiresOwnerReview: state === 'conflict' && !options.ownerReviewedConflict,
      requiresStaleAcknowledgment: false,
      reason: 'Selected phase is read-only — no implementation approval is issued.',
    };
  }
  return {
    canApproveImplementation: true,
    requiresOwnerReview: false,
    requiresStaleAcknowledgment: false,
    reason: null,
  };
}

export function buildScopePackSignal(pack: Pick<ScopePackContract, 'packId' | 'reconciliationState' | 'title'>): SnapshotSignal | null {
  if (pack.reconciliationState !== 'stale' && pack.reconciliationState !== 'conflict') {
    return null;
  }
  const conflict = pack.reconciliationState === 'conflict';
  return {
    signalId: `signal:scope-pack-stale:${pack.packId}`,
    category: 'scope-pack-stale',
    severity: conflict ? 'critical' : 'warning',
    source: 'host',
    taskId: null,
    attemptId: null,
    message: conflict
      ? `Scope Pack "${pack.title}" conflicts with current repository truth.`
      : `Scope Pack "${pack.title}" foundation is stale relative to the current repository.`,
    evidenceCount: 1,
    evidenceRefs: [`pack:${pack.packId}`, `state:${pack.reconciliationState}`],
    firstSeen: new Date(0).toISOString(),
    lastSeen: new Date(0).toISOString(),
    resolvedAt: null,
    ownerActionRequired: conflict,
  };
}

/**
 * Convert a do-not-touch entry into a repo-relative path only when the entry
 * is unambiguously a path/pattern. Prose is never guessed into files.
 */
export function extractPathLikeBoundary(entry: string): string | null {
  const trimmed = entry.trim();
  if (!PATH_LIKE.test(trimmed) || /\s/u.test(trimmed)) {
    return null;
  }
  const withoutGlob = trimmed.endsWith('/**') ? trimmed.slice(0, -3) : trimmed;
  return normalizeSafeRepoRelativePath(withoutGlob);
}

export function extractDoNotTouchPaths(doNotTouch: readonly string[]): string[] {
  const paths: string[] = [];
  for (const entry of doNotTouch) {
    const path = extractPathLikeBoundary(entry);
    if (path && !paths.includes(path)) {
      paths.push(path);
    }
  }
  return paths;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readBoundedString(value: unknown, max: number, field: string): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof value !== 'string') {
    return { ok: false, message: `${field} must be a string.` };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: false, message: `${field} must not be empty.` };
  }
  if (trimmed.length > max) {
    return { ok: false, message: `${field} exceeds ${max} characters.` };
  }
  return { ok: true, value: trimmed };
}

function readOptionalString(value: unknown, max: number, field: string): { ok: true; value: string | null } | { ok: false; message: string } {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null };
  }
  const parsed = readBoundedString(value, max, field);
  if (!parsed.ok) {
    return parsed;
  }
  return { ok: true, value: parsed.value };
}

function readStringList(value: unknown, maxItems: number, maxChars: number, field: string): { ok: true; value: string[] } | { ok: false; message: string } {
  if (value === undefined || value === null) {
    return { ok: true, value: [] };
  }
  if (!Array.isArray(value)) {
    return { ok: false, message: `${field} must be an array of strings.` };
  }
  if (value.length > maxItems) {
    return { ok: false, message: `${field} allows at most ${maxItems} items.` };
  }
  const items: string[] = [];
  for (const entry of value) {
    const parsed = readBoundedString(entry, maxChars, field);
    if (!parsed.ok) {
      return parsed;
    }
    items.push(parsed.value);
  }
  return { ok: true, value: items };
}

const FORBIDDEN_PERSIST_KEYS = new Set([
  'raw', 'rawText', 'sourceText', 'sourceContents', 'filePath', 'localPath', 'absolutePath', 'contents',
]);

export function assertNoRawSource(value: unknown, path = 'pack'): string[] {
  const hits: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => hits.push(...assertNoRawSource(entry, `${path}[${index}]`)));
    return hits;
  }
  if (!isRecord(value)) {
    return hits;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_PERSIST_KEYS.has(key)) {
      hits.push(`${path}.${key}`);
    }
    hits.push(...assertNoRawSource(entry, `${path}.${key}`));
  }
  return hits;
}

function payloadUtf8Bytes(value: unknown): number {
  const encoded = JSON.stringify(value);
  if (typeof encoded !== 'string') {
    return Number.POSITIVE_INFINITY;
  }
  return new TextEncoder().encode(encoded).length;
}

export function parseImportScopePackPayload(raw: unknown):
  { ok: true; draft: ScopePackImportDraft } | { ok: false; code: string; message: string } {
  if (!isRecord(raw)) {
    return { ok: false, code: 'PAYLOAD_NOT_OBJECT', message: 'import_scope_pack payload must be a JSON object.' };
  }
  if (payloadUtf8Bytes(raw) > IMPORT_SCOPE_PACK_MAX_PAYLOAD_BYTES) {
    return { ok: false, code: 'PAYLOAD_TOO_LARGE', message: 'import_scope_pack payload exceeds the persisted size bound.' };
  }
  for (const key of Object.keys(raw)) {
    if (!IMPORT_SCOPE_PACK_PAYLOAD_KEYS.has(key)) {
      return { ok: false, code: 'UNKNOWN_FIELD', message: 'import_scope_pack payload contains an unknown field.' };
    }
  }
  const forbidden = assertNoRawSource(raw, 'payload');
  if (forbidden.length > 0) {
    return { ok: false, code: 'RAW_SOURCE_FORBIDDEN', message: 'import_scope_pack must not include raw source contents or filesystem paths.' };
  }

  const title = readBoundedString(raw.title, SCOPE_PACK_BOUNDS.titleMaxChars, 'title');
  const sourceFilename = readBoundedString(raw.sourceFilename, SCOPE_PACK_BOUNDS.filenameMaxChars, 'sourceFilename');
  const sourceHash = readBoundedString(raw.sourceHash, SCOPE_PACK_BOUNDS.sourceHashChars, 'sourceHash');
  if (!title.ok) return { ok: false, code: 'TITLE_INVALID', message: title.message };
  if (!sourceFilename.ok) return { ok: false, code: 'SOURCE_FILENAME_INVALID', message: sourceFilename.message };
  if (!sourceHash.ok || !/^[0-9a-f]{64}$/u.test(sourceHash.value)) {
    return { ok: false, code: 'SOURCE_HASH_INVALID', message: 'sourceHash must be a 64-character SHA-256 hex digest.' };
  }
  if (/[\\/]/.test(sourceFilename.value) || /^[a-zA-Z]:/u.test(sourceFilename.value)) {
    return { ok: false, code: 'SOURCE_PATH_FORBIDDEN', message: 'sourceFilename must be a basename, never a filesystem path.' };
  }
  if (!/\.(md|txt)$/iu.test(sourceFilename.value)) {
    return { ok: false, code: 'SOURCE_TYPE_INVALID', message: 'sourceFilename must end in .md or .txt.' };
  }

  const intent = readOptionalString(raw.intent, SCOPE_PACK_BOUNDS.intentMaxChars, 'intent');
  const checkpoint = readOptionalString(raw.historicalCheckpoint, SCOPE_PACK_BOUNDS.checkpointMaxChars, 'historicalCheckpoint');
  const foundation = readStringList(raw.foundationClaims, SCOPE_PACK_BOUNDS.maxFoundationClaims, SCOPE_PACK_BOUNDS.claimMaxChars, 'foundationClaims');
  const locked = readStringList(raw.lockedRules, SCOPE_PACK_BOUNDS.maxLockedRules, SCOPE_PACK_BOUNDS.ruleMaxChars, 'lockedRules');
  const doNotTouch = readStringList(raw.doNotTouch, SCOPE_PACK_BOUNDS.maxDoNotTouch, SCOPE_PACK_BOUNDS.ruleMaxChars, 'doNotTouch');
  const acceptance = readStringList(raw.acceptanceCriteria, SCOPE_PACK_BOUNDS.maxAcceptanceCriteria, SCOPE_PACK_BOUNDS.acceptanceMaxChars, 'acceptanceCriteria');
  const decisions = readStringList(raw.ownerDecisions, SCOPE_PACK_BOUNDS.maxOwnerDecisions, SCOPE_PACK_BOUNDS.decisionMaxChars, 'ownerDecisions');
  const superseded = readStringList(raw.supersededDecisions, SCOPE_PACK_BOUNDS.maxSupersededDecisions, SCOPE_PACK_BOUNDS.decisionMaxChars, 'supersededDecisions');
  const risks = readStringList(raw.knownRisks, SCOPE_PACK_BOUNDS.maxKnownRisks, SCOPE_PACK_BOUNDS.riskMaxChars, 'knownRisks');
  const areas = readStringList(raw.relatedAppAreas, SCOPE_PACK_BOUNDS.maxRelatedAppAreas, SCOPE_PACK_BOUNDS.areaMaxChars, 'relatedAppAreas');
  for (const parsed of [intent, checkpoint, foundation, locked, doNotTouch, acceptance, decisions, superseded, risks, areas]) {
    if (!parsed.ok) {
      return { ok: false, code: 'FIELD_INVALID', message: parsed.message };
    }
  }

  if (!Array.isArray(raw.roadmapPhases) || raw.roadmapPhases.length > SCOPE_PACK_BOUNDS.maxRoadmapPhases) {
    return { ok: false, code: 'PHASES_INVALID', message: `roadmapPhases must be an array of at most ${SCOPE_PACK_BOUNDS.maxRoadmapPhases} phases.` };
  }
  const phases: ScopePackImportDraft['roadmapPhases'] = [];
  const seen = new Set<string>();
  for (const rawPhase of raw.roadmapPhases) {
    if (!isRecord(rawPhase)) {
      return { ok: false, code: 'PHASES_INVALID', message: 'Each roadmap phase must be an object.' };
    }
    for (const key of Object.keys(rawPhase)) {
      if (!IMPORT_SCOPE_PACK_PHASE_KEYS.has(key)) {
        return { ok: false, code: 'UNKNOWN_FIELD', message: 'import_scope_pack payload contains an unknown field.' };
      }
    }
    const id = readBoundedString(rawPhase.id, 64, 'phase.id');
    const phaseTitle = readBoundedString(rawPhase.title, SCOPE_PACK_BOUNDS.phaseTitleMaxChars, 'phase.title');
    const goal = readBoundedString(rawPhase.goal, SCOPE_PACK_BOUNDS.phaseGoalMaxChars, 'phase.goal');
    if (!id.ok) {
      return { ok: false, code: 'PHASES_INVALID', message: id.message };
    }
    if (!phaseTitle.ok) {
      return { ok: false, code: 'PHASES_INVALID', message: phaseTitle.message };
    }
    if (!goal.ok) {
      return { ok: false, code: 'PHASES_INVALID', message: goal.message };
    }
    if (seen.has(id.value)) {
      return { ok: false, code: 'PHASES_INVALID', message: 'roadmapPhases ids must be unique.' };
    }
    seen.add(id.value);
    const intentRaw = typeof rawPhase.executionIntent === 'string' ? rawPhase.executionIntent : inferPhaseExecutionIntent(phaseTitle.value, goal.value);
    if (intentRaw !== 'audit' && intentRaw !== 'implementation' && intentRaw !== 'verification' && intentRaw !== 'research') {
      return { ok: false, code: 'PHASES_INVALID', message: 'phase.executionIntent is not a known intent.' };
    }
    phases.push({ id: id.value, title: phaseTitle.value, goal: goal.value, executionIntent: intentRaw });
  }

  let currentPhaseId: string | null = null;
  if (raw.currentPhaseId !== undefined && raw.currentPhaseId !== null && raw.currentPhaseId !== '') {
    const parsed = readBoundedString(raw.currentPhaseId, 64, 'currentPhaseId');
    if (!parsed.ok) {
      return { ok: false, code: 'PHASE_INVALID', message: parsed.message };
    }
    if (!seen.has(parsed.value) && phases.length > 0) {
      return { ok: false, code: 'PHASE_INVALID', message: 'currentPhaseId must match a roadmap phase.' };
    }
    currentPhaseId = parsed.value;
  }

  return {
    ok: true,
    draft: {
      title: title.value,
      sourceFilename: sourceFilename.value,
      sourceHash: sourceHash.value,
      historicalCheckpoint: checkpoint.ok ? checkpoint.value : null,
      intent: intent.ok ? (intent.value ?? '') : '',
      foundationClaims: foundation.ok ? foundation.value : [],
      lockedRules: locked.ok ? locked.value : [],
      doNotTouch: doNotTouch.ok ? doNotTouch.value : [],
      roadmapPhases: phases,
      currentPhaseId,
      acceptanceCriteria: acceptance.ok ? acceptance.value : [],
      runtimeAcceptanceRequired: raw.runtimeAcceptanceRequired === true,
      ownerDecisions: decisions.ok ? decisions.value : [],
      supersededDecisions: superseded.ok ? superseded.value : [],
      knownRisks: risks.ok ? risks.value : [],
      relatedAppAreas: areas.ok ? areas.value : [],
      forceNewVersion: raw.forceNewVersion === true,
    },
  };
}

export function parseCreatePlanScopePackFields(raw: Record<string, unknown>):
  { ok: true; fields: CreatePlanScopePackFields | null } | { ok: false; code: string; message: string } {
  const hasAny = raw.scopePackId !== undefined || raw.scopePackVersion !== undefined || raw.scopePackPhaseId !== undefined;
  if (!hasAny) {
    return { ok: true, fields: null };
  }
  const packId = typeof raw.scopePackId === 'string' ? raw.scopePackId.trim() : '';
  const phaseId = typeof raw.scopePackPhaseId === 'string' ? raw.scopePackPhaseId.trim() : '';
  const version = raw.scopePackVersion;
  if (!packId) {
    return { ok: false, code: 'SCOPE_PACK_ID_INVALID', message: 'scopePackId is required when a Scope Pack is selected.' };
  }
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, code: 'SCOPE_PACK_VERSION_INVALID', message: 'scopePackVersion must be a positive integer.' };
  }
  if (!phaseId) {
    return { ok: false, code: 'SCOPE_PACK_PHASE_INVALID', message: 'scopePackPhaseId is required when a Scope Pack is selected.' };
  }
  return {
    ok: true,
    fields: {
      scopePackId: packId,
      scopePackVersion: version,
      scopePackPhaseId: phaseId,
      staleAcknowledged: raw.staleAcknowledged === true,
      ownerReviewedConflict: raw.ownerReviewedConflict === true,
    },
  };
}

export function materializeImportedPack(options: {
  draft: ScopePackImportDraft;
  orgId: string;
  repoKey: string;
  sourceRequestId: string;
  now: string;
}): ScopePackContract {
  const claims = options.draft.foundationClaims.map((claim, index) => ({
    claimId: `claim-${index + 1}`,
    claim,
    state: 'UNVERIFIED' as const,
    evidenceRefs: [],
    reconciliationSummary: null,
  }));
  return {
    packId: randomUUID(),
    orgId: options.orgId,
    repoKey: options.repoKey,
    title: options.draft.title,
    sourceFilename: options.draft.sourceFilename,
    sourceHash: options.draft.sourceHash,
    importedAt: options.now,
    updatedAt: options.now,
    historicalCheckpoint: options.draft.historicalCheckpoint,
    intent: options.draft.intent,
    foundationClaims: claims,
    lockedRules: options.draft.lockedRules,
    doNotTouch: options.draft.doNotTouch,
    roadmapPhases: options.draft.roadmapPhases.map((phase) => ({
      id: phase.id,
      title: phase.title,
      goal: phase.goal,
      status: 'not-started',
      executionIntent: phase.executionIntent ?? inferPhaseExecutionIntent(phase.title, phase.goal),
    })),
    currentPhaseId: options.draft.currentPhaseId ?? options.draft.roadmapPhases[0]?.id ?? null,
    acceptanceCriteria: options.draft.acceptanceCriteria,
    runtimeAcceptanceRequired: options.draft.runtimeAcceptanceRequired,
    ownerDecisions: options.draft.ownerDecisions,
    supersededDecisions: options.draft.supersededDecisions,
    knownRisks: options.draft.knownRisks,
    relatedAppAreas: options.draft.relatedAppAreas,
    reconciliationState: 'unverified',
    reconciliationSummary: null,
    lastReconciledAt: null,
    version: 1,
  };
}

export function applyReconciliation(
  pack: ScopePackContract,
  results: readonly ClaimReconciliation[],
  now: string,
): ScopePackContract {
  const byId = new Map(results.map((result) => [result.claimId, result]));
  const claims = pack.foundationClaims.map((claim) => {
    const next = byId.get(claim.claimId);
    if (!next) {
      return claim;
    }
    return {
      ...claim,
      state: next.state,
      evidenceRefs: next.evidenceRefs.slice(0, SCOPE_PACK_BOUNDS.evidenceRefsMax).map((ref) => ref.slice(0, SCOPE_PACK_BOUNDS.evidenceRefMaxChars)),
      reconciliationSummary: next.reconciliationSummary.slice(0, SCOPE_PACK_BOUNDS.summaryMaxChars),
    };
  });
  const state = deriveReconciliationState(claims);
  const verdict = mapArchitectVerdict(state);
  return {
    ...pack,
    foundationClaims: claims,
    reconciliationState: state,
    reconciliationSummary: verdict.summary,
    lastReconciledAt: now,
    updatedAt: now,
  };
}

export function resolveScopePackForPlan(options: {
  pack: ScopePackContract;
  orgId: string;
  repoKey: string;
  version: number;
  phaseId: string;
}): { ok: true; phase: ScopePackPhase } | { ok: false; code: string; message: string } {
  if (options.pack.orgId !== options.orgId) {
    return { ok: false, code: 'SCOPE_PACK_ORG_MISMATCH', message: 'Scope Pack does not belong to this organization.' };
  }
  if (options.pack.repoKey !== options.repoKey) {
    return { ok: false, code: 'SCOPE_PACK_REPO_MISMATCH', message: 'Scope Pack does not belong to this repository.' };
  }
  if (options.pack.version !== options.version) {
    return { ok: false, code: 'SCOPE_PACK_VERSION_MISMATCH', message: 'Scope Pack version does not match the selected contract.' };
  }
  const phase = options.pack.roadmapPhases.find((entry) => entry.id === options.phaseId);
  if (!phase) {
    return { ok: false, code: 'SCOPE_PACK_PHASE_INVALID', message: 'Selected phase is not part of this Scope Pack.' };
  }
  return { ok: true, phase };
}

export function inheritScopePackConstraints(options: {
  ownerConstraints: readonly string[];
  pack: ScopePackContract;
  phase: ScopePackPhase;
}): { constraints: string[]; validationRequirements: string[]; doNotTouchPaths: string[]; scopePackRef: ScopePackRef } {
  const constraints: string[] = [];
  const push = (value: string) => {
    if (value && !constraints.includes(value) && constraints.length < 16) {
      constraints.push(value.slice(0, 1_000));
    }
  };
  for (const constraint of options.ownerConstraints) push(constraint);
  for (const rule of options.pack.lockedRules) push(`LOCKED: ${rule}`);
  for (const rule of options.pack.doNotTouch) push(`DO_NOT_TOUCH: ${rule}`);
  const validationRequirements: string[] = [];
  const pushCheck = (value: string) => {
    if (value && !validationRequirements.includes(value) && validationRequirements.length < 16) {
      validationRequirements.push(value.slice(0, 1_000));
    }
  };
  pushCheck(`Selected phase: ${options.phase.title} — ${options.phase.goal}`);
  for (const item of options.pack.acceptanceCriteria) pushCheck(item);
  if (options.pack.runtimeAcceptanceRequired) {
    pushCheck('Owner-visible runtime verification is required.');
  }
  return {
    constraints,
    validationRequirements,
    doNotTouchPaths: extractDoNotTouchPaths(options.pack.doNotTouch),
    scopePackRef: {
      packId: options.pack.packId,
      version: options.pack.version,
      phaseId: options.phase.id,
    },
  };
}

export function buildScopePackArchitectPrompt(options: {
  pack: ScopePackContract;
  phase: ScopePackPhase;
  ownerScope: string;
  ownerConstraints: readonly string[];
  checkpointNote: string | null;
}): string {
  const lines: string[] = [];
  lines.push('You are the Team Architect performing read-only Scope Pack reconciliation.');
  lines.push('Compare the structured historical claims to the CURRENT repository. The historical checkpoint is context, not authority.');
  lines.push('Never ask to checkout, reset, or implement against historical state.');
  lines.push('');
  lines.push(`PACK TITLE:\n${options.pack.title}`);
  lines.push(`INTENT:\n${options.pack.intent}`);
  if (options.pack.historicalCheckpoint) {
    lines.push(`HISTORICAL CHECKPOINT (context only):\n${options.pack.historicalCheckpoint}`);
  }
  if (options.checkpointNote) {
    lines.push(`CHECKPOINT INSPECTION (read-only):\n${options.checkpointNote}`);
  }
  lines.push('');
  lines.push('FOUNDATION CLAIMS:');
  for (const claim of options.pack.foundationClaims) {
    lines.push(`- ${claim.claimId}: ${claim.claim}`);
  }
  lines.push('');
  lines.push('LOCKED RULES:');
  for (const rule of options.pack.lockedRules) lines.push(`- ${rule}`);
  lines.push('DO NOT TOUCH:');
  for (const rule of options.pack.doNotTouch) lines.push(`- ${rule}`);
  lines.push(`SELECTED PHASE:\n${options.phase.id} — ${options.phase.title}\n${options.phase.goal}`);
  lines.push(`PHASE INTENT: ${options.phase.executionIntent}`);
  lines.push(`OWNER SCOPE:\n${options.ownerScope}`);
  if (options.ownerConstraints.length > 0) {
    lines.push(`OWNER CONSTRAINTS:\n${options.ownerConstraints.map((item) => `- ${item}`).join('\n')}`);
  }
  lines.push('');
  lines.push('Return ONLY JSON with claim reconciliations. No chain-of-thought. No source file contents.');
  lines.push('```json');
  lines.push(JSON.stringify({
    claims: options.pack.foundationClaims.map((claim) => ({
      claimId: claim.claimId,
      state: 'UNVERIFIED',
      reconciliationSummary: 'short safe summary',
      evidenceRefs: ['repo-relative/path'],
    })),
  }, null, 2));
  lines.push('```');
  if (isAuditLikeIntent(options.phase.executionIntent)) {
    lines.push('This phase is READ-ONLY. Do not propose implementation tasks, write paths, or a candidate changeset.');
  }
  return lines.join('\n');
}

export function parseClaimReconciliations(raw: unknown, pack: ScopePackContract): ClaimReconciliation[] {
  const record = isRecord(raw) ? raw : {};
  const list = Array.isArray(record.claims) ? record.claims : [];
  const byId = new Map<string, ClaimReconciliation>();
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    const claimId = typeof entry.claimId === 'string' ? entry.claimId : '';
    if (!pack.foundationClaims.some((claim) => claim.claimId === claimId)) continue;
    const stateRaw = typeof entry.state === 'string' ? entry.state.toUpperCase() : '';
    const state: FoundationClaimState =
      stateRaw === 'CURRENT' || stateRaw === 'STALE' || stateRaw === 'CONFLICT' || stateRaw === 'UNVERIFIED'
        ? stateRaw
        : 'UNVERIFIED';
    const summary = typeof entry.reconciliationSummary === 'string' && entry.reconciliationSummary.trim()
      ? entry.reconciliationSummary.trim().slice(0, SCOPE_PACK_BOUNDS.summaryMaxChars)
      : 'Insufficient evidence.';
    const refs = Array.isArray(entry.evidenceRefs)
      ? entry.evidenceRefs.filter((ref): ref is string => typeof ref === 'string' && ref.length > 0).slice(0, SCOPE_PACK_BOUNDS.evidenceRefsMax)
      : [];
    byId.set(claimId, {
      claimId,
      state,
      reconciliationSummary: summary,
      evidenceRefs: refs.map((ref) => ref.slice(0, SCOPE_PACK_BOUNDS.evidenceRefMaxChars)),
    });
  }
  return pack.foundationClaims.map((claim) => byId.get(claim.claimId) ?? {
    claimId: claim.claimId,
    state: 'UNVERIFIED',
    reconciliationSummary: 'Insufficient evidence.',
    evidenceRefs: [],
  });
}

export async function inspectHistoricalCheckpoint(options: {
  checkpoint: string;
  runGit: (args: readonly string[]) => Promise<string>;
}): Promise<{ exists: boolean; summary: string; invoked: string[][] }> {
  const invoked: string[][] = [];
  const run = async (args: readonly string[]): Promise<string> => {
    if (args.some((arg) => FORBIDDEN_GIT_ARGS.has(arg))) {
      throw new Error('Historical checkpoint inspection refuses mutating git commands.');
    }
    invoked.push([...args]);
    return options.runGit(args);
  };
  try {
    const sha = (await run(['rev-parse', '--verify', `${options.checkpoint}^{commit}`])).trim();
    const subject = (await run(['log', '-1', '--format=%h %s', sha])).trim();
    return {
      exists: true,
      summary: `Historical commit exists as context only: ${subject || sha}. Current checkout is unchanged.`,
      invoked,
    };
  } catch {
    return {
      exists: false,
      summary: 'Historical checkpoint could not be resolved in this repository; it remains context only.',
      invoked,
    };
  }
}

export function packToRowJson(pack: ScopePackContract): Record<string, unknown> {
  return {
    packId: pack.packId,
    title: pack.title,
    sourceFilename: pack.sourceFilename,
    sourceHash: pack.sourceHash,
    importedAt: pack.importedAt,
    updatedAt: pack.updatedAt,
    historicalCheckpoint: pack.historicalCheckpoint,
    intent: pack.intent,
    foundationClaims: pack.foundationClaims,
    lockedRules: pack.lockedRules,
    doNotTouch: pack.doNotTouch,
    roadmapPhases: pack.roadmapPhases,
    currentPhaseId: pack.currentPhaseId,
    acceptanceCriteria: pack.acceptanceCriteria,
    runtimeAcceptanceRequired: pack.runtimeAcceptanceRequired,
    ownerDecisions: pack.ownerDecisions,
    supersededDecisions: pack.supersededDecisions,
    knownRisks: pack.knownRisks,
    relatedAppAreas: pack.relatedAppAreas,
    reconciliationState: pack.reconciliationState,
    reconciliationSummary: pack.reconciliationSummary,
    lastReconciledAt: pack.lastReconciledAt,
    version: pack.version,
  };
}

export function packFromRow(row: {
  id: string;
  organization_id: string;
  repo_key: string;
  title: string;
  source_filename: string;
  source_hash: string;
  pack: Record<string, unknown>;
  reconciliation_state: string;
  current_phase_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  last_reconciled_at: string | null;
}): ScopePackContract {
  const body = row.pack;
  const claims = Array.isArray(body.foundationClaims) ? body.foundationClaims : [];
  return {
    packId: row.id,
    orgId: row.organization_id,
    repoKey: row.repo_key,
    title: row.title,
    sourceFilename: row.source_filename,
    sourceHash: row.source_hash,
    importedAt: typeof body.importedAt === 'string' ? body.importedAt : row.created_at,
    updatedAt: row.updated_at,
    historicalCheckpoint: typeof body.historicalCheckpoint === 'string' ? body.historicalCheckpoint : null,
    intent: typeof body.intent === 'string' ? body.intent : '',
    foundationClaims: claims.filter(isRecord).map((claim, index) => ({
      claimId: typeof claim.claimId === 'string' ? claim.claimId : `claim-${index + 1}`,
      claim: typeof claim.claim === 'string' ? claim.claim : '',
      state: (claim.state === 'CURRENT' || claim.state === 'STALE' || claim.state === 'CONFLICT' || claim.state === 'UNVERIFIED')
        ? claim.state
        : 'UNVERIFIED',
      evidenceRefs: Array.isArray(claim.evidenceRefs) ? claim.evidenceRefs.filter((ref): ref is string => typeof ref === 'string') : [],
      reconciliationSummary: typeof claim.reconciliationSummary === 'string' ? claim.reconciliationSummary : null,
    })),
    lockedRules: Array.isArray(body.lockedRules) ? body.lockedRules.filter((item): item is string => typeof item === 'string') : [],
    doNotTouch: Array.isArray(body.doNotTouch) ? body.doNotTouch.filter((item): item is string => typeof item === 'string') : [],
    roadmapPhases: Array.isArray(body.roadmapPhases)
      ? body.roadmapPhases.filter(isRecord).map((phase) => ({
          id: String(phase.id ?? ''),
          title: String(phase.title ?? ''),
          goal: String(phase.goal ?? ''),
          status: (phase.status === 'active' || phase.status === 'complete' || phase.status === 'blocked' || phase.status === 'deferred')
            ? phase.status
            : 'not-started',
          executionIntent: (phase.executionIntent === 'audit' || phase.executionIntent === 'verification' || phase.executionIntent === 'research')
            ? phase.executionIntent
            : inferPhaseExecutionIntent(String(phase.title ?? ''), String(phase.goal ?? '')),
        }))
      : [],
    currentPhaseId: row.current_phase_id,
    acceptanceCriteria: Array.isArray(body.acceptanceCriteria) ? body.acceptanceCriteria.filter((item): item is string => typeof item === 'string') : [],
    runtimeAcceptanceRequired: body.runtimeAcceptanceRequired === true,
    ownerDecisions: Array.isArray(body.ownerDecisions) ? body.ownerDecisions.filter((item): item is string => typeof item === 'string') : [],
    supersededDecisions: Array.isArray(body.supersededDecisions) ? body.supersededDecisions.filter((item): item is string => typeof item === 'string') : [],
    knownRisks: Array.isArray(body.knownRisks) ? body.knownRisks.filter((item): item is string => typeof item === 'string') : [],
    relatedAppAreas: Array.isArray(body.relatedAppAreas) ? body.relatedAppAreas.filter((item): item is string => typeof item === 'string') : [],
    reconciliationState: (row.reconciliation_state === 'current' || row.reconciliation_state === 'stale' || row.reconciliation_state === 'conflict')
      ? row.reconciliation_state
      : 'unverified',
    reconciliationSummary: typeof body.reconciliationSummary === 'string' ? body.reconciliationSummary : null,
    lastReconciledAt: row.last_reconciled_at,
    version: row.version,
  };
}

export interface ScopePackStore {
  findScopePackById(packId: string): Promise<ScopePackContract | null>;
  findScopePackBySourceHash(sourceHash: string): Promise<ScopePackContract | null>;
  findScopePackBySourceRequestId(sourceRequestId: string): Promise<ScopePackContract | null>;
  insertScopePack(pack: ScopePackContract, sourceRequestId: string): Promise<ScopePackContract>;
  updateScopePackReconciliation(pack: ScopePackContract): Promise<void>;
  updateScopePackCurrentPhase(packId: string, phaseId: string): Promise<void>;
}

export type FoundationReconciler = (input: {
  pack: ScopePackContract;
  phase: ScopePackPhase;
  repoPath: string;
}) => Promise<ClaimReconciliation[]>;
