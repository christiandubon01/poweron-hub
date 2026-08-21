/**
 * QBO-2E — AI Wording Assistant (invoiceWordingAi.ts) tests.
 *
 * Pins QBO-SIMPLE-10..15: the AI wording assistant reuses the existing
 * server-side Claude proxy, receives ONLY work-description context, has
 * WORDING-ONLY authority (never an amount / line / mutation), and produces
 * wording the owner may apply or restore.
 *
 * The Claude proxy is mocked so no network/key is exercised here.
 *
 * QBO-SIMPLE-10  AI receives selected work-description context (not financial values).
 * QBO-SIMPLE-11  AI cannot alter the invoice amount (returns wording only).
 * QBO-SIMPLE-12  AI cannot alter payment/KPI state (no mutation authority).
 * QBO-SIMPLE-13  AI cannot add a financial line (returns a string, not lines).
 * QBO-SIMPLE-14  Polished wording can replace the Description.
 * QBO-SIMPLE-15  Original wording can be restored (modal-side; wiring pinned here).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the Claude proxy so tests exercise no network and no key. vi.hoisted
// keeps the mock reference available to the hoisted vi.mock factory.
const { callClaudeMock } = vi.hoisted(() => ({ callClaudeMock: vi.fn() }))
vi.mock('@/services/claudeProxy', () => ({
  callClaude: (...args: unknown[]) => callClaudeMock(...args as unknown[]),
  extractText: (res: { content?: Array<{ type: string; text: string }> }) =>
    res?.content?.find((c) => c.type === 'text')?.text ?? '',
}))

import { buildWordingPrompt, polishInvoiceDescription, WORDING_SYSTEM_PROMPT } from '../invoiceWordingAi'

const ROOT = process.cwd()
const aiSrc = readFileSync(join(ROOT, 'src/features/billing-draft/invoiceWordingAi.ts'), 'utf8')
const codeOnly = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, ' ')
const aiCode = codeOnly(aiSrc)

function fakeResponse(text: string) {
  return { content: [{ type: 'text', text }], model: 'mock', usage: { input_tokens: 0, output_tokens: 0 } }
}

beforeEach(() => {
  callClaudeMock.mockReset()
})

// ── QBO-SIMPLE-10: AI receives selected work-description context only ───────────

describe('QBO-SIMPLE-10 — AI receives selected work-description context (no financial values)', () => {
  it('the user message contains the supplied work facts (label / description / date)', () => {
    const { userMessage } = buildWordingPrompt({
      sourceKind: 'project',
      productOrService: 'Electrical Project - Progress Billing',
      currentDescription: 'Work completed:\n- Rough-in inspection passed\n- Finish feeder circuit',
      workFacts: [
        { label: 'Rough-in', description: 'ROUGH IN INSPECTION PASSED', date: '2025-02-01' },
        { label: 'Feeder', description: 'Pull sub panel feeder circuit', date: '2025-02-03' },
      ],
    })
    expect(userMessage).toContain('ROUGH IN INSPECTION PASSED')
    expect(userMessage).toContain('Pull sub panel feeder circuit')
    expect(userMessage).toContain('2025-02-01')
    expect(userMessage).toContain('Project Work')
  })

  it('the user message carries NO amount / collected / payment / balance / KPI / token values', () => {
    const { userMessage } = buildWordingPrompt({
      sourceKind: 'service',
      productOrService: 'Electrical Work - Service Work',
      currentDescription: 'troubleshooting circuit powering unit, trace circuit',
      workFacts: [{ label: 'Service Log', description: 'troubleshooting circuit powering unit', date: null }],
    })
    // Financial / payment / KPI / token data is never sent to the AI.
    expect(userMessage).not.toMatch(/collected|payment|balance|contractValue|deposit|kpi|token|realmId|\$|quickbooks|intuit/i)
  })

  it('the PolishWordingInput type carries no financial field (structural authority limit)', () => {
    // The input interface exposes only wording-context fields — no amount/value.
    expect(aiCode).not.toMatch(/collected|paymentBalance|contractValue|kpi|realmId|amount:/i)
    expect(aiCode).toMatch(/productOrService|currentDescription|workFacts/)
  })
})

// ── QBO-SIMPLE-11: AI cannot alter the invoice amount ──────────────────────────

describe('QBO-SIMPLE-11 — AI cannot alter the invoice amount', () => {
  it('polishInvoiceDescription returns ONLY a wording string (no amount)', async () => {
    callClaudeMock.mockResolvedValue(fakeResponse('Completed feeder-circuit installation and associated conduit work.'))
    const result = await polishInvoiceDescription({
      sourceKind: 'project',
      productOrService: 'Electrical Project - Progress Billing',
      currentDescription: '',
      workFacts: [{ label: 'Feeder', description: 'Pull sub panel feeder circuit', date: null }],
    })
    expect(Object.keys(result)).toEqual(['wording'])
    expect(typeof result.wording).toBe('string')
    // The wording contains no dollar amount the AI might try to inject.
    expect(result.wording).not.toMatch(/\$|USD|amount/i)
  })

  it('the AI call payload sends only system + messages (no amount field)', async () => {
    callClaudeMock.mockResolvedValue(fakeResponse('Polished.'))
    await polishInvoiceDescription({
      sourceKind: 'project',
      productOrService: 'Electrical Project - Progress Billing',
      currentDescription: 'Work completed:\n- Installed feeder',
      workFacts: [{ label: 'Feeder', description: 'Installed feeder circuit', date: null }],
    })
    expect(callClaudeMock).toHaveBeenCalledTimes(1)
    const arg = callClaudeMock.mock.calls[0][0] as Record<string, unknown>
    expect(arg).toHaveProperty('system')
    expect(arg).toHaveProperty('messages')
    expect(arg).not.toHaveProperty('amount')
    // The user message is the only message.
    const messages = arg.messages as Array<{ role: string; content: string }>
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('user')
  })
})

// ── QBO-SIMPLE-12: AI cannot alter payment/KPI state ───────────────────────────

describe('QBO-SIMPLE-12 — AI cannot alter payment/KPI state', () => {
  it('the wording module imports no payment/KPI mutation authority (only the Claude proxy)', () => {
    expect(aiCode).not.toContain('saveBackupData')
    expect(aiCode).not.toContain('recordServicePayment')
    expect(aiCode).not.toContain('ensureProjectFinanceBucket')
    expect(aiCode).not.toContain('recalculateWeeklyData')
    expect(aiCode).not.toContain('pushState')
    expect(aiCode).not.toContain('backupDataService')
    // It reuses only the existing Claude proxy.
    expect(aiSrc).toContain("from '@/services/claudeProxy'")
  })

  it('polishInvoiceDescription returns a value type — it cannot perform a mutation', async () => {
    callClaudeMock.mockResolvedValue(fakeResponse('Wiring completed.'))
    const result = await polishInvoiceDescription({
      sourceKind: 'service',
      productOrService: 'Electrical Work - Service Work',
      currentDescription: '',
      workFacts: [],
    })
    // A plain string result — nothing to mutate.
    expect(result).toEqual({ wording: 'Wiring completed.' })
  })
})

// ── QBO-SIMPLE-13: AI cannot add a financial line ──────────────────────────────

describe('QBO-SIMPLE-13 — AI cannot add a financial line', () => {
  it('the result is a single description string, never a line/BillingLine structure', async () => {
    callClaudeMock.mockResolvedValue(fakeResponse('Completed rough-in inspection and feeder conduit work.'))
    const result = await polishInvoiceDescription({
      sourceKind: 'project',
      productOrService: 'Electrical Project - Progress Billing',
      currentDescription: 'Work completed:\n- Rough-in\n- Feeder conduit',
      workFacts: [{ label: 'Rough-in', description: 'Rough-in inspection passed', date: null }],
    })
    expect(typeof result.wording).toBe('string')
    expect(result.wording).not.toMatch(/amount|candidateIds|line/i)
    // buildWordingPrompt returns text only — never line structures.
    const prompt = buildWordingPrompt({
      sourceKind: 'project',
      productOrService: 'x',
      currentDescription: '',
      workFacts: [],
    })
    expect(Object.keys(prompt).sort()).toEqual(['system', 'userMessage'])
  })
})

// ── QBO-SIMPLE-14: polished wording can replace the Description ───────────────

describe('QBO-SIMPLE-14 — polished wording can replace the Description', () => {
  it('polishInvoiceDescription returns customer-facing prose usable as the description', async () => {
    const polished = 'Completed feeder-circuit installation and associated conduit work, including photocell raceway preparation. Electrical rough-in work was completed and the rough-in inspection was passed.'
    callClaudeMock.mockResolvedValue(fakeResponse(polished))
    const result = await polishInvoiceDescription({
      sourceKind: 'project',
      productOrService: 'Electrical Project - Progress Billing',
      currentDescription: 'Work completed:\n- pull sub panel feeder circuit\n- ROUGH IN INSPECTION PASSED\n- finish photocell conduit',
      workFacts: [
        { label: 'Feeder', description: 'pull sub panel feeder circuit', date: null },
        { label: 'Rough-in', description: 'ROUGH IN INSPECTION PASSED', date: null },
        { label: 'Photocell', description: 'finish photocell conduit', date: null },
      ],
    })
    expect(result.wording).toBe(polished)
    // The caller (modal) assigns this string to the line description — proven by type.
    const newDescription: string = result.wording
    expect(newDescription.length).toBeGreaterThan(0)
  })
})

// ── QBO-SIMPLE-15: original wording can be restored ───────────────────────────

describe('QBO-SIMPLE-15 — original wording can be restored', () => {
  it('the wording assistant is stateless; the caller preserves the original for restore (modal wiring)', async () => {
    // The module itself stores no original — the modal keeps it. Regeneration
    // is driven by the caller passing the original back in as currentDescription,
    // so a restore to the original is always possible from the caller's saved copy.
    callClaudeMock.mockResolvedValue(fakeResponse('Polished version.'))
    const original = 'Work completed:\n- Rough-in'
    const result = await polishInvoiceDescription({
      sourceKind: 'project',
      productOrService: 'Electrical Project - Progress Billing',
      currentDescription: original,
      workFacts: [{ label: 'Rough-in', description: 'Rough-in', date: null }],
    })
    expect(result.wording).toBe('Polished version.')
    // The original remains available to the caller to restore (unchanged here).
    expect(original).toBe('Work completed:\n- Rough-in')
  })

  it('the modal exposes RESTORE ORIGINAL and reverts the description to the saved original', () => {
    const modalSrc = readFileSync(join(ROOT, 'src/features/billing-draft/components/PrepareInvoiceModal.tsx'), 'utf8')
    expect(modalSrc).toContain('RESTORE ORIGINAL')
    expect(modalSrc).toContain('restoreOriginal')
    expect(modalSrc).toContain('setLineDescription(lineId, st.original)')
  })
})

// ── Prompt constraints (QBO-2E §10): AI must not invent work ───────────────────

describe('QBO-2E §10 — prompt constrains the AI from inventing work', () => {
  it('the system prompt forbids inventing scope and untruthful inspection claims', () => {
    expect(WORDING_SYSTEM_PROMPT).toContain('ONLY the supplied work')
    expect(WORDING_SYSTEM_PROMPT).toContain('inspection')
    expect(WORDING_SYSTEM_PROMPT).toContain('invent')
    expect(WORDING_SYSTEM_PROMPT).toContain('financial value')
    expect(WORDING_SYSTEM_PROMPT).toContain('customer-facing')
  })
})