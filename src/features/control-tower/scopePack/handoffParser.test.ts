import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SCOPE_PACK_BOUNDS, SCOPE_PACK_MAX_SOURCE_BYTES } from './bounds'
import { parseHandoffDocument, QBO_HANDOFF_FIXTURE, classifyHeading, rejectScopePackSource } from './handoffParser'
import { sha256Hex } from './hash'

function hashText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function parse(text: string, filename = 'handoff.md') {
  return parseHandoffDocument({
    filename,
    sourceHash: hashText(text),
    text,
    byteLength: new TextEncoder().encode(text).byteLength,
  })
}

describe('ATB-5 handoff parser', () => {
  it('maps heading aliases and extracts the QBO handoff contract', () => {
    expect(classifyHeading('Product Goal')).toBe('intent')
    expect(classifyHeading('Mission')).toBe('intent')
    expect(classifyHeading('Completed Foundation')).toBe('foundation')
    expect(classifyHeading('Already Complete')).toBe('foundation')
    expect(classifyHeading('Locked Rules')).toBe('lockedRules')
    expect(classifyHeading('Non-negotiables')).toBe('lockedRules')
    expect(classifyHeading('Safety Boundaries')).toBe('doNotTouch')
    expect(classifyHeading('Remaining Roadmap')).toBe('roadmap')
    expect(classifyHeading('Next Steps')).toBe('roadmap')
    expect(classifyHeading('Testing')).toBe('acceptance')
    expect(classifyHeading('Definition of Complete')).toBe('definitionOfDone')
    expect(classifyHeading('Baseline')).toBe('checkpoint')

    const result = parse(QBO_HANDOFF_FIXTURE, 'poweron-qbo-handoff.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.intent).toContain('PowerOn remains the operational and financial source of truth')
    expect(result.draft.historicalCheckpoint).toBe('9f3c2ab')
    expect(result.draft.foundationClaims.length).toBeGreaterThanOrEqual(6)
    expect(result.draft.lockedRules.some((rule) => /no silent QuickBooks create\/update/i.test(rule))).toBe(true)
    expect(result.draft.doNotTouch).toContain('src/store/authStore.ts')
    expect(result.draft.doNotTouch).toContain("Don't change authentication")
    expect(result.draft.roadmapPhases[0]?.id).toBe('QBO-4B0')
    expect(result.draft.roadmapPhases[0]?.title).toContain('Open Estimates Truth Audit')
    expect(result.draft.roadmapPhases[0]?.goal).toMatch(/NO IMPLEMENTATION/i)
    expect(result.draft.roadmapPhases[0]?.executionIntent).toBe('audit')
    expect(result.draft.acceptanceCriteria.length).toBeGreaterThan(0)
    expect(result.draft.runtimeAcceptanceRequired).toBe(true)
    expect(result.draft.ownerDecisions[0]).toMatch(/READ-ONLY truth audit/i)
    expect(result.unmappedSectionNames).toContain('Secret Appendix')
    expect(JSON.stringify(result.draft)).not.toContain('must never be stored')
    expect(JSON.stringify(result.draft)).not.toMatch(/C:\\\\|\/Users\//)
  })

  it('parses a plain-text fallback with labeled headings', () => {
    const text = [
      'Goal:',
      'Keep the books honest.',
      '',
      'Locked Rules:',
      '1. Do not invent customers',
      '2. Do not write money fields',
      '',
      'Phases:',
      '- AUDIT-1 — Read only inventory',
    ].join('\n')
    const result = parse(text, 'plain.txt')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.intent).toBe('Keep the books honest.')
    expect(result.draft.lockedRules).toEqual(['Do not invent customers', 'Do not write money fields'])
    expect(result.draft.roadmapPhases[0]?.id).toBe('AUDIT-1')
  })

  it('extracts historical checkpoint SHAs and numbered locked rules', () => {
    const text = `# Checkpoint\ncommit deadbeefcafebabe0123456789abcdef01234567\n\n# Rules\n1. First locked rule\n2. Second locked rule\n`
    const result = parse(text)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.historicalCheckpoint).toBe('deadbeefcafebabe0123456789abcdef01234567')
    expect(result.draft.lockedRules).toEqual(['First locked rule', 'Second locked rule'])
  })

  it('keeps duplicate headings as warnings and does not store unknown bodies', () => {
    const text = `# Goal\nFirst goal\n\n# Goal\nSecond goal\n\n# Mystery Notes\nprivate chain of thought that must stay preview-only\n`
    const result = parse(text)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings.some((warning) => warning.code === 'DUPLICATE_HEADING')).toBe(true)
    expect(result.unmappedSectionNames).toContain('Mystery Notes')
    expect(JSON.stringify(result.draft)).not.toContain('private chain of thought')
    expect(result.draft.intent).toBe('Second goal')
  })

  it('rejects unsupported types and oversized files', () => {
    expect(rejectScopePackSource({ filename: 'notes.pdf', byteLength: 12 })?.code).toBe('UNSUPPORTED_TYPE')
    expect(rejectScopePackSource({ filename: 'notes.docx', byteLength: 12 })?.code).toBe('UNSUPPORTED_TYPE')
    expect(rejectScopePackSource({ filename: 'notes.md', byteLength: SCOPE_PACK_MAX_SOURCE_BYTES + 1 })?.code).toBe('FILE_TOO_LARGE')
    const huge = parseHandoffDocument({
      filename: 'notes.md',
      sourceHash: 'a'.repeat(64),
      text: 'x',
      byteLength: SCOPE_PACK_MAX_SOURCE_BYTES + 1,
    })
    expect(huge.ok).toBe(false)
    if (huge.ok) return
    expect(huge.code).toBe('FILE_TOO_LARGE')
  })

  it('truncates oversized strings and lists', () => {
    const rules = Array.from({ length: SCOPE_PACK_BOUNDS.maxLockedRules + 5 }, (_, index) => `${index + 1}. ${'R'.repeat(SCOPE_PACK_BOUNDS.ruleMaxChars + 20)}`)
    const text = `# Locked Rules\n${rules.join('\n')}\n`
    const result = parse(text)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.lockedRules).toHaveLength(SCOPE_PACK_BOUNDS.maxLockedRules)
    expect(result.draft.lockedRules.every((rule) => rule.length <= SCOPE_PACK_BOUNDS.ruleMaxChars)).toBe(true)
    expect(result.warnings.some((warning) => warning.code === 'TRUNCATED_LIST')).toBe(true)
    expect(result.warnings.some((warning) => warning.code === 'TRUNCATED_STRING')).toBe(true)
  })

  it('computes a stable SHA-256 of the file bytes', async () => {
    const bytes = new TextEncoder().encode(QBO_HANDOFF_FIXTURE)
    const expected = createHash('sha256').update(bytes).digest('hex')
    await expect(sha256Hex(bytes)).resolves.toBe(expected)
    await expect(sha256Hex(bytes)).resolves.toBe(expected)
  })
})
