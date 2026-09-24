/**
 * ATB-5: deterministic Markdown/text handoff parser.
 *
 * No model call. Browser FileReader supplies the text; only the structured
 * draft is returned. Unknown headings stay in the preview as unmapped names
 * and are not stored as raw section bodies.
 */

import { SCOPE_PACK_ALLOWED_EXTENSIONS, SCOPE_PACK_BOUNDS, SCOPE_PACK_MAX_SOURCE_BYTES } from './bounds'
import { isSha256Hex } from './hash'
import type {
  HandoffParseFailure,
  HandoffParseOutcome,
  HandoffParseWarning,
  ScopePackImportDraft,
  ScopePackPhaseIntent,
} from './types'

const HEADING_FAMILIES = {
  intent: ['product goal', 'goal', 'mission'],
  foundation: ['current foundation', 'completed foundation', 'already complete', 'current state'],
  lockedRules: ['locked product rules', 'locked rules', 'rules', 'non-negotiables'],
  doNotTouch: ['do not touch', 'safety boundaries', 'boundaries'],
  roadmap: ['roadmap', 'remaining roadmap', 'phases', 'next steps'],
  acceptance: ['testing philosophy', 'testing', 'acceptance'],
  definitionOfDone: ['definition of complete', 'definition of done'],
  ownerDecisions: ['owner decisions'],
  knownRisks: ['known risks'],
  checkpoint: ['historical checkpoint', 'checkpoint', 'baseline'],
} as const

type FamilyKey = keyof typeof HEADING_FAMILIES

const FAMILY_BY_ALIAS = new Map<string, FamilyKey>()
for (const [family, aliases] of Object.entries(HEADING_FAMILIES)) {
  for (const alias of aliases) {
    FAMILY_BY_ALIAS.set(alias, family as FamilyKey)
  }
}

const PHASE_LINE = /^(?:[-*+]|\d+[.)])\s+(?:`?([A-Z]{2,10}-\d+[A-Z0-9-]*)`?\s*[—–:-]\s*)?(.+)$/u
const PHASE_HEADING = /^(?:`?([A-Z]{2,10}-\d+[A-Z0-9-]*)`?\s*[—–:-]\s*)(.+)$/u
const CHECKPOINT_SHA = /\b([0-9a-f]{7,40})\b/iu
const LIST_ITEM = /^(?:[-*+]|\d+[.)])\s+(.+)$/u

export function normalizeHeading(raw: string): string {
  return raw
    .replace(/^#{1,6}\s+/u, '')
    .replace(/[:.]+$/u, '')
    .replace(/[*_`]/gu, '')
    .trim()
    .toLowerCase()
}

export function classifyHeading(raw: string): FamilyKey | null {
  const normalized = normalizeHeading(raw)
  return FAMILY_BY_ALIAS.get(normalized) ?? null
}

export function isSupportedScopePackFilename(filename: string): boolean {
  const lower = filename.trim().toLowerCase()
  return SCOPE_PACK_ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function rejectScopePackSource(input: {
  filename: string
  byteLength: number
}): HandoffParseFailure | null {
  const filename = input.filename.trim()
  if (!filename || filename.length > SCOPE_PACK_BOUNDS.filenameMaxChars) {
    return { ok: false, code: 'INVALID_FILENAME', message: 'Choose a .md or .txt handoff file with a short filename.' }
  }
  if (!isSupportedScopePackFilename(filename)) {
    return { ok: false, code: 'UNSUPPORTED_TYPE', message: 'Scope Packs currently accept .md and .txt files only.' }
  }
  if (input.byteLength > SCOPE_PACK_MAX_SOURCE_BYTES) {
    return {
      ok: false,
      code: 'FILE_TOO_LARGE',
      message: `Handoff files must be ${SCOPE_PACK_MAX_SOURCE_BYTES / 1024} KB or smaller.`,
    }
  }
  if (input.byteLength <= 0) {
    return { ok: false, code: 'EMPTY_SOURCE', message: 'The selected file is empty.' }
  }
  return null
}

interface Section {
  title: string
  family: FamilyKey | null
  body: string[]
}

function splitSections(text: string): Section[] {
  const lines = text.replace(/\r\n/gu, '\n').split('\n')
  const sections: Section[] = [{ title: 'preamble', family: null, body: [] }]
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const atx = line.match(/^(#{1,6})\s+(.+)$/u)
    const next = lines[i + 1] ?? ''
    const setext = next.match(/^(?:=+|-+)\s*$/u) && line.trim().length > 0 && !line.startsWith('#')
    if (atx) {
      sections.push({ title: atx[2].trim(), family: classifyHeading(atx[2]), body: [] })
      continue
    }
    if (setext) {
      sections.push({ title: line.trim(), family: classifyHeading(line), body: [] })
      i += 1
      continue
    }
    const labeled = line.match(/^([A-Za-z][A-Za-z0-9 /-]{1,80}):\s*$/u)
    if (labeled && classifyHeading(labeled[1])) {
      sections.push({ title: labeled[1].trim(), family: classifyHeading(labeled[1]), body: [] })
      continue
    }
    sections[sections.length - 1].body.push(line)
  }
  return sections
}

function trimBound(value: string, max: number, warnings: HandoffParseWarning[], section: string): string {
  const compact = value.replace(/\s+/gu, ' ').trim()
  if (compact.length <= max) return compact
  warnings.push({ code: 'TRUNCATED_STRING', message: `${section} exceeded ${max} characters and was truncated.`, section })
  return compact.slice(0, max)
}

function boundList(values: string[], maxItems: number, maxChars: number, warnings: HandoffParseWarning[], section: string): string[] {
  const out: string[] = []
  for (const value of values) {
    const trimmed = trimBound(value, maxChars, warnings, section)
    if (!trimmed) continue
    if (out.length >= maxItems) {
      warnings.push({ code: 'TRUNCATED_LIST', message: `${section} kept the first ${maxItems} items.`, section })
      break
    }
    out.push(trimmed)
  }
  return out
}

function extractListItems(body: string[]): string[] {
  const items: string[] = []
  let current: string | null = null
  for (const raw of body) {
    const line = raw.replace(/\t/gu, '  ')
    const match = line.match(LIST_ITEM)
    if (match) {
      if (current) items.push(current)
      current = match[1].trim()
      continue
    }
    if (current && /^\s{2,}\S/u.test(line)) {
      current = `${current} ${line.trim()}`
      continue
    }
    if (current && line.trim() === '') {
      items.push(current)
      current = null
    }
  }
  if (current) items.push(current)
  if (items.length === 0) {
    const paragraph = body.map((line) => line.trim()).filter(Boolean).join(' ')
    if (paragraph) items.push(paragraph)
  }
  return items.map((item) => item.replace(/^\[(?:x| )\]\s+/iu, '').replace(/^\*+|\*+$/gu, '').trim()).filter(Boolean)
}

function extractParagraph(body: string[]): string {
  return body.map((line) => line.trim()).filter((line) => line && !/^[-*_]{3,}$/u.test(line)).join(' ').trim()
}

function inferPhaseIntent(title: string, goal: string): ScopePackPhaseIntent {
  const haystack = `${title} ${goal}`.toLowerCase()
  if (/\bno implementation\b|\bread-?only\b|\btruth audit\b|\baudit\b/u.test(haystack)) return 'audit'
  if (/\bresearch\b|\binvestigat/u.test(haystack)) return 'research'
  if (/\bverif(?:y|ication|ier)\b/u.test(haystack) && !/\bimplement/u.test(haystack)) return 'verification'
  return 'implementation'
}

function slugPhaseId(raw: string, used: Set<string>, index: number): string {
  const explicit = raw.match(/^[A-Z]{2,10}-\d+[A-Z0-9-]*/u)?.[0]
  const base = (explicit ?? raw.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '')).slice(0, 64) || `phase-${index + 1}`
  let id = base
  let n = 2
  while (used.has(id)) {
    id = `${base}-${n}`
    n += 1
  }
  used.add(id)
  return id
}

function extractPhases(body: string[]): Array<{ id: string; title: string; goal: string; executionIntent: ScopePackPhaseIntent }> {
  const used = new Set<string>()
  const phases: Array<{ id: string; title: string; goal: string; executionIntent: ScopePackPhaseIntent }> = []
  let pending: { id: string; title: string; goalParts: string[] } | null = null

  const flush = () => {
    if (!pending) return
    const goal = pending.goalParts.join(' ').trim() || pending.title
    phases.push({
      id: pending.id,
      title: pending.title,
      goal,
      executionIntent: inferPhaseIntent(pending.title, goal),
    })
    pending = null
  }

  for (const raw of body) {
    const line = raw.trim()
    if (!line) continue
    const listed = line.match(PHASE_LINE)
    const headed = !listed ? line.match(PHASE_HEADING) : null
    if (listed || headed) {
      flush()
      const match = listed ?? headed
      const code = match?.[1]?.trim() ?? ''
      const rest = (match?.[2] ?? line).trim()
      const title = code ? `${code} — ${rest}` : rest
      pending = { id: slugPhaseId(code || rest, used, phases.length), title, goalParts: [] }
      continue
    }
    if (pending) pending.goalParts.push(line)
  }
  flush()
  return phases
}

function extractCheckpoint(body: string[]): string | null {
  const text = extractParagraph(body)
  const sha = text.match(CHECKPOINT_SHA)
  if (sha) return sha[1].toLowerCase()
  return text || null
}

function detectRuntimeAcceptance(text: string): boolean {
  return /runtime (?:acceptance|verification)|owner-visible runtime|must be verified at runtime/iu.test(text)
}

export function parseHandoffDocument(input: {
  filename: string
  sourceHash: string
  text: string
  byteLength: number
}): HandoffParseOutcome {
  const rejected = rejectScopePackSource({ filename: input.filename, byteLength: input.byteLength })
  if (rejected) return rejected
  if (!isSha256Hex(input.sourceHash)) {
    return { ok: false, code: 'INVALID_HASH', message: 'Source hash must be a SHA-256 hex digest.' }
  }
  if (!input.text.trim()) {
    return { ok: false, code: 'EMPTY_SOURCE', message: 'The selected file is empty.' }
  }

  const warnings: HandoffParseWarning[] = []
  const unmappedSectionNames: string[] = []
  const seenHeadings = new Set<string>()
  const sections = splitSections(input.text)

  const collected: Record<FamilyKey, string[]> = {
    intent: [],
    foundation: [],
    lockedRules: [],
    doNotTouch: [],
    roadmap: [],
    acceptance: [],
    definitionOfDone: [],
    ownerDecisions: [],
    knownRisks: [],
    checkpoint: [],
  }

  for (const section of sections) {
    if (section.title !== 'preamble') {
      const key = normalizeHeading(section.title)
      if (seenHeadings.has(key)) {
        warnings.push({ code: 'DUPLICATE_HEADING', message: `Duplicate heading "${section.title}" — later section is kept for preview only.`, section: section.title })
      }
      seenHeadings.add(key)
    }
    if (!section.family) {
      if (section.title !== 'preamble' && extractParagraph(section.body)) {
        const name = section.title.slice(0, SCOPE_PACK_BOUNDS.unmappedSectionNameMaxChars)
        if (unmappedSectionNames.length < SCOPE_PACK_BOUNDS.maxUnmappedSectionNames && !unmappedSectionNames.includes(name)) {
          unmappedSectionNames.push(name)
        }
        warnings.push({ code: 'UNMAPPED_SECTION', message: `Unmapped section "${section.title}" is preview-only and will not be stored.`, section: section.title })
      }
      continue
    }
    if (section.family === 'intent' || section.family === 'checkpoint') {
      collected[section.family] = [extractParagraph(section.body)]
    } else if (section.family === 'roadmap') {
      collected.roadmap = section.body
    } else {
      collected[section.family] = extractListItems(section.body)
    }
    if (collected[section.family].every((item) => !item.trim()) && section.family !== 'roadmap') {
      warnings.push({ code: 'EMPTY_SECTION', message: `Section "${section.title}" had no extractable items.`, section: section.title })
    }
  }

  const filename = input.filename.replace(/^.*[\\/]/u, '').slice(0, SCOPE_PACK_BOUNDS.filenameMaxChars)
  const titleFromName = filename.replace(/\.(md|txt)$/iu, '').replace(/[-_]+/gu, ' ').trim()
  const intent = trimBound(collected.intent[0] ?? '', SCOPE_PACK_BOUNDS.intentMaxChars, warnings, 'intent')
  const title = trimBound(titleFromName || intent.slice(0, 80) || 'Imported Scope Pack', SCOPE_PACK_BOUNDS.titleMaxChars, warnings, 'title')
  const checkpointRaw = extractCheckpoint(collected.checkpoint)
  const historicalCheckpoint = checkpointRaw
    ? trimBound(checkpointRaw, SCOPE_PACK_BOUNDS.checkpointMaxChars, warnings, 'checkpoint')
    : null

  const phases = extractPhases(collected.roadmap).slice(0, SCOPE_PACK_BOUNDS.maxRoadmapPhases)
  if (extractPhases(collected.roadmap).length > SCOPE_PACK_BOUNDS.maxRoadmapPhases) {
    warnings.push({ code: 'TRUNCATED_LIST', message: `Roadmap kept the first ${SCOPE_PACK_BOUNDS.maxRoadmapPhases} phases.`, section: 'roadmap' })
  }

  const acceptanceFromTesting = boundList(collected.acceptance, SCOPE_PACK_BOUNDS.maxAcceptanceCriteria, SCOPE_PACK_BOUNDS.acceptanceMaxChars, warnings, 'acceptance')
  const acceptanceFromDone = boundList(collected.definitionOfDone, SCOPE_PACK_BOUNDS.maxAcceptanceCriteria, SCOPE_PACK_BOUNDS.acceptanceMaxChars, warnings, 'definition-of-done')
  const acceptanceCriteria = [...acceptanceFromTesting]
  for (const item of acceptanceFromDone) {
    if (acceptanceCriteria.length >= SCOPE_PACK_BOUNDS.maxAcceptanceCriteria) break
    if (!acceptanceCriteria.includes(item)) acceptanceCriteria.push(item)
  }

  const allAcceptanceText = [...acceptanceCriteria, intent].join(' ')
  const draft: ScopePackImportDraft = {
    title,
    sourceFilename: filename,
    sourceHash: input.sourceHash,
    historicalCheckpoint,
    intent,
    foundationClaims: boundList(collected.foundation, SCOPE_PACK_BOUNDS.maxFoundationClaims, SCOPE_PACK_BOUNDS.claimMaxChars, warnings, 'foundation'),
    lockedRules: boundList(collected.lockedRules, SCOPE_PACK_BOUNDS.maxLockedRules, SCOPE_PACK_BOUNDS.ruleMaxChars, warnings, 'locked-rules'),
    doNotTouch: boundList(collected.doNotTouch, SCOPE_PACK_BOUNDS.maxDoNotTouch, SCOPE_PACK_BOUNDS.ruleMaxChars, warnings, 'do-not-touch'),
    roadmapPhases: phases.map((phase) => ({
      id: phase.id,
      title: trimBound(phase.title, SCOPE_PACK_BOUNDS.phaseTitleMaxChars, warnings, 'phase-title'),
      goal: trimBound(phase.goal, SCOPE_PACK_BOUNDS.phaseGoalMaxChars, warnings, 'phase-goal'),
      executionIntent: phase.executionIntent,
    })),
    currentPhaseId: phases[0]?.id ?? null,
    acceptanceCriteria,
    runtimeAcceptanceRequired: detectRuntimeAcceptance(allAcceptanceText),
    ownerDecisions: boundList(collected.ownerDecisions, SCOPE_PACK_BOUNDS.maxOwnerDecisions, SCOPE_PACK_BOUNDS.decisionMaxChars, warnings, 'owner-decisions'),
    supersededDecisions: [],
    knownRisks: boundList(collected.knownRisks, SCOPE_PACK_BOUNDS.maxKnownRisks, SCOPE_PACK_BOUNDS.riskMaxChars, warnings, 'known-risks'),
    relatedAppAreas: [],
  }

  return { ok: true, draft, unmappedSectionNames, warnings }
}

export const QBO_HANDOFF_FIXTURE = `# PowerOn QuickBooks Online — Owner Handoff

## Product Goal
PowerOn remains the operational and financial source of truth. QuickBooks remains the accounting destination. Nothing is created or updated in QuickBooks silently.

## Historical Checkpoint
Baseline commit 9f3c2ab on the Control Tower foundation. Do not treat this checkpoint as current checkout authority.

## Current Foundation
- PowerOn is the operational/financial source of truth
- QuickBooks is the accounting destination only
- No silent QuickBooks create/update
- No automatic customer creation or linking
- AI cannot silently alter financial fields
- Historical Payments is protected
- QuickBooks Batch Import remains a separate owner-driven path
- Owner-visible runtime verification is required

## Locked Product Rules
1. PowerOn remains operational/financial source of truth
2. QuickBooks remains accounting destination
3. No silent QuickBooks create/update
4. No automatic customer creation/linking
5. AI cannot silently alter financial fields
6. Historical Payments is protected
7. QuickBooks Batch Import remains separate

## Do Not Touch
- Historical Payments
- src/store/authStore.ts
- QuickBooks Batch Import owner flow
- Don't change authentication

## Remaining Roadmap
- QBO-4B0 — Open Estimates Truth Audit
  NO IMPLEMENTATION. Read-only audit of current estimate truth before any write work.
- QBO-4B1 — Mapping review
- QBO-4B2 — Owner-approved write preview

## Testing Philosophy
- Owner-visible runtime verification required
- Acceptance is not earned by unit tests alone

## Definition of Done
- Selected phase goal is met
- Runtime acceptance is demonstrated to the owner

## Owner Decisions
- Phased roadmap begins with a READ-ONLY truth audit before implementation

## Known Risks
- Historical handoff claims may have drifted from the current repository

## Secret Appendix
This unknown section must stay preview-only and must never be stored.
`
