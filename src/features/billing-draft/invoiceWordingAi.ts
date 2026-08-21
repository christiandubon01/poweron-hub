/**
 * src/features/billing-draft/invoiceWordingAi.ts
 *
 * QBO-2E §8/§9/§10 — AI WORDING ASSISTANT for the Prepare Invoice description.
 *
 * This is the ONLY AI surface in the billing-draft feature. It reuses the
 * repository's EXISTING safe server-side AI text-generation mechanism
 * (`callClaude` / `extractText` in src/services/claudeProxy.ts → the
 * /.netlify/functions/claude Netlify proxy that holds ANTHROPIC_API_KEY
 * server-side). It adds NO new AI SDK, NO new dependency, and exposes NO AI
 * key to the browser (the proxy + Vite env-guard already enforce that).
 *
 * AI'S ONLY AUTHORITY = WORDING (QBO-2E §9/§11):
 *   - It may rewrite the customer-facing invoice DESCRIPTION only.
 *   - It may NOT alter the invoice amount, the Product/Service (unless the
 *     owner edits it), customer identity, Project/Service Value, Collected,
 *     Payment Balance, dates, payment truth, contract truth, or QuickBooks
 *     data. The function signature makes this structural: it does not RECEIVE
 *     any amount, collected, payment, KPI, token, or dashboard value, so it
 *     cannot return one. It returns ONLY a wording string.
 *   - It may NOT add a financial line (it returns text, not lines).
 *
 * AI MUST NOT INVENT WORK (QBO-2E §10): the prompt constrains the model to use
 * ONLY the supplied work-log facts, combine repetitive notes, remove internal
 * shorthand, preserve technical facts, and never claim an inspection passed
 * unless the supplied notes explicitly say so.
 *
 * MINIMUM CONTEXT (QBO-2E §8): the AI receives only the work-description context
 * needed for wording — the selected Project Log / Service Log facts (label,
 * description, date), the source kind, the Product/Service title (for tone
 * context only), and the owner's current description draft. It NEVER receives
 * payment history, collected values, KPIs, QuickBooks tokens, or financial
 * dashboard state. `buildWordingPrompt` is pure and unit-tested to prove the
 * prompt body carries no financial/payment/KPI values.
 *
 * No QuickBooks API call, no persistence, no payment/KPI mutation, no migration.
 */
import { callClaude, extractText } from '@/services/claudeProxy'

/** One work-log fact the AI is allowed to see. Never carries an amount. */
export interface WordingWorkFact {
  readonly label: string
  readonly description: string | null
  readonly date: string | null
}

/** Input to the wording assistant. Deliberately carries NO financial value. */
export interface PolishWordingInput {
  /** 'project' or 'service' — sets tone and how facts are framed. */
  readonly sourceKind: 'project' | 'service'
  /** Customer-facing Product/Service title — tone context only; AI must not change it. */
  readonly productOrService: string
  /** The owner's current description draft (may be empty). */
  readonly currentDescription: string
  /** Selected work-log facts (Project Log notes / Service Log work). */
  readonly workFacts: readonly WordingWorkFact[]
}

/** Result of the wording assistant — a single customer-facing description string. */
export interface PolishWordingResult {
  readonly wording: string
}

export const WORDING_SYSTEM_PROMPT = [
  'You are a customer-facing invoice wording assistant for an electrical contractor.',
  'You receive selected work-log facts and rewrite them into professional, customer-facing invoice description prose.',
  '',
  'STRICT RULES:',
  '- Use ONLY the supplied work facts. Do not invent labor, materials, scope, dates, or costs that are not present in the facts.',
  '- Do not claim an inspection passed unless the supplied notes explicitly state that it did.',
  '- Do not mention dollar amounts, prices, balances, payments, deposits, or any financial value.',
  '- Do not address the customer by name and do not add greetings or sign-offs.',
  '- Combine repetitive notes into clear prose. Remove internal shorthand while preserving important technical facts.',
  '- Output ONLY the polished description paragraph. No headings, no bullet lists, no preamble, no JSON, no quotation marks around the whole response.',
].join('\n')

/**
 * Build the exact AI input (system + user message) from the supplied work
 * context. PURE: no I/O, no network. The returned user message contains ONLY
 * work-description context — never amounts, collected, payment, KPI, tokens,
 * or dashboard state.
 */
export function buildWordingPrompt(input: PolishWordingInput): { system: string; userMessage: string } {
  const factLines: string[] = []
  for (const f of input.workFacts) {
    const parts: string[] = []
    if (f.label && f.label.trim()) parts.push(f.label.trim())
    if (f.description && f.description.trim()) parts.push(f.description.trim())
    if (f.date && f.date.trim()) parts.push(`(${f.date.trim()})`)
    if (parts.length > 0) factLines.push(`- ${parts.join(' — ')}`)
  }
  const factsBlock = factLines.length > 0 ? factLines.join('\n') : '(no work facts supplied)'

  const sourceLabel = input.sourceKind === 'service' ? 'Service Work' : 'Project Work'
  const titleLine = input.productOrService && input.productOrService.trim()
    ? `Product/Service (for tone only — do not echo or change it): ${input.productOrService.trim()}`
    : 'Product/Service: (none supplied)'
  const draftLine = input.currentDescription && input.currentDescription.trim()
    ? `Owner's current draft (improve on this):\n${input.currentDescription.trim()}`
    : "Owner's current draft: (empty)"

  const userMessage = [
    `Source: ${sourceLabel}`,
    titleLine,
    '',
    'Selected work facts (use ONLY these):',
    factsBlock,
    '',
    draftLine,
    '',
    'Write the polished customer-facing invoice description now. Output only the description prose.',
  ].join('\n')

  return { system: WORDING_SYSTEM_PROMPT, userMessage }
}

/**
 * Polish an invoice description via the existing server-side Claude proxy.
 * Returns ONLY a wording string — never an amount, never a line, never a
 * mutation. Throws on network/auth failure; the caller shows a clean error.
 */
export async function polishInvoiceDescription(
  input: PolishWordingInput,
  signal?: AbortSignal,
): Promise<PolishWordingResult> {
  const { system, userMessage } = buildWordingPrompt(input)
  const response = await callClaude({
    messages: [{ role: 'user', content: userMessage }],
    system,
    max_tokens: 400,
    signal,
  })
  const wording = extractText(response).trim()
  return { wording }
}