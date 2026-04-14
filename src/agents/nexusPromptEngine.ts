/**
 * src/agents/nexusPromptEngine.ts
 * NEXUS Prompt Engine — V3-19 | E16 / V3-31
 *
 * Orchestration brain for PowerOn Hub V3.
 * Handles query classification, ECHO context injection, disambiguation,
 * structured response formatting, and multi-agent orchestration.
 *
 * Public API:
 *   classifyQuery(query)                   → QueryClassification
 *   injectEchoContext(query, window)        → EchoInjection
 *   buildNexusPrompt(request)              → NexusPromptRequest → string
 *   runNexusEngine(request)                → Promise<NexusResponse>
 *   generateSessionDebrief(history)        → Promise<ConclusionItem[]>  [V3-31]
 *
 * V3-31 additions:
 *   SESSION OPEN  — getRelevantConclusions() injected into NEXUS system prompt
 *   SESSION CLOSE — generateSessionDebrief() extracts conclusions from conversation
 *   Feature flag: featureFlags.sessionConclusions (default OFF)
 *
 * V3-33 additions:
 *   SESSION OPEN  — owner-only handoff context injected before main prompt
 *   Handoff entries are read from katsuro_handoff (owner account only)
 *   and surfaced conversationally in the NEXUS opening brief.
 *   Feature flag: featureFlags.katsuroHandoff (default OFF)
 *   Security: gated by isOwnerWithDaSparkyHub() — non-owners are unaffected.
 *   Returned handoffIds in NexusResponse let callers drive markHandoffActioned /
 *   dismissHandoff on subsequent turns.
 */

import { buildDeepProjectContext } from '@/agents/nexus/nexusContextBuilder'
import { featureFlags } from '../config/featureFlags';
import {
  getRelevantConclusions,
  saveConclusions,
  type ConclusionItem,
  type SessionConclusion,
} from '../services/sessionConclusionService';
import {
  isOwnerWithDaSparkyHub,
  getUnreadHandoffs,
  markHandoffRead,
  markHandoffActioned,
  dismissHandoff,
  formatHandoffsForNexus,
  type HandoffEntry,
} from '../services/katsuroHandoffService';

// Re-export for callers that need to drive post-session handoff lifecycle
export { markHandoffActioned, dismissHandoff };

// ─── Agent Route Targets ──────────────────────────────────────────────────────

export type AgentTarget =
  | 'VAULT'      // pricing / estimating
  | 'OHM'        // compliance / electrical code
  | 'LEDGER'     // AR / invoicing / collections
  | 'BLUEPRINT'  // project documents / plans
  | 'CHRONO'     // scheduling / capacity
  | 'SPARK'      // leads / marketing
  | 'ATLAS'      // location / travel
  | 'SCOUT'      // material intelligence — price checks, supplier comparisons, alternatives
  | 'NEXUS'      // general conversation / strategy / direct
  | 'MULTI';     // multi-agent orchestration required

// ─── Display Component Types ──────────────────────────────────────────────────

export type DisplayComponentType =
  | 'metric_card'
  | 'alert'
  | 'chart'
  | 'action_item'
  | 'link';

export interface DisplayComponent {
  type: DisplayComponentType;
  title?: string;
  value?: string | number;
  label?: string;
  severity?: 'info' | 'warning' | 'critical';
  url?: string;
  data?: Record<string, unknown>;
}

// ─── Capture Items ────────────────────────────────────────────────────────────

export interface CaptureItem {
  type: 'entity' | 'decision' | 'task' | 'financial' | 'note';
  label: string;
  value: string;
  agentSource: AgentTarget;
  timestamp: string;
}

// ─── ECHO Context Window ──────────────────────────────────────────────────────

export interface EchoEntry {
  id: string;
  timestamp: string;         // ISO string — must be within 24h to be eligible
  content: string;           // text content of the memory entry
  agentSource: AgentTarget;
  tags?: string[];
}

export interface EchoInjection {
  injectedEntries: EchoEntry[];
  totalTokensInjected: number;
  skippedCount: number;
}

// ─── Query Classification ─────────────────────────────────────────────────────

export interface QueryClassification {
  primaryTarget: AgentTarget;
  secondaryTargets: AgentTarget[];
  confidence: number;         // 0.0–1.0
  requiresDisambiguation: boolean;
  disambiguationQuestion?: string;
  matchedKeywords: string[];
  isMultiAgent: boolean;
}

// ─── Nexus Engine I/O ─────────────────────────────────────────────────────────

export interface NexusRequest {
  query: string;
  userId?: string;
  orgId?: string;
  sessionId?: string;         // voice session ID — used for conclusion storage [V3-31]
  agentMode?: string;
  echoWindow?: EchoEntry[];   // 24-hour rolling window entries from ECHO
  sessionContext?: string;    // any extra session-level context string
}

// ─── Message Type (for session debrief) ──────────────────────────────────────

/** A single turn in a conversation, used by generateSessionDebrief [V3-31] */
export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

export interface NexusResponse {
  speak: string;
  display: DisplayComponent[];
  captures: CaptureItem[];
  routedTo: AgentTarget;
  echoInjection?: EchoInjection;
  clarificationRequired?: boolean;
  clarificationQuestion?: string;
  builtPrompt?: string;       // the final assembled prompt sent to Claude
  /**
   * V3-33: IDs of owner handoff entries surfaced in this session open.
   * Callers use these to call markHandoffActioned() or dismissHandoff()
   * on subsequent turns when the user engages with or dismisses the item.
   * Always empty for non-owner users.
   */
  surfacedHandoffIds?: string[];
}

// ─── Keyword Routing Tables ───────────────────────────────────────────────────

const VAULT_KEYWORDS = [
  'price', 'pricing', 'cost', 'estimate', 'quote', 'material', 'materials',
  'romex', 'conduit', 'wire', 'cable', 'panel', 'breaker', 'fixture',
  'per foot', 'per unit', 'markup', 'labor rate', 'bid', 'takeoff', 'mto',
  'how much does', "what's the price", 'how much for', 'cost of',
];

const OHM_KEYWORDS = [
  'nec', 'code', 'requirement', 'compliance', 'arc fault', 'afci', 'gfci',
  'permit', 'inspection', 'violation', 'title 24', 'article', 'section',
  'ahj', 'electrical code', 'receptacle requirement', 'kitchen receptacle',
  'bathroom outlet', 'load calculation', 'service size', 'grounding',
  'bonding', 'clearance', 'working space', 'disconnect', 'what does nec',
  'is it code', 'code compliant', 'required by code', 'nec requires',
];

const LEDGER_KEYWORDS = [
  'invoice', 'invoicing', 'ar', 'accounts receivable', 'collections',
  'unbilled', 'outstanding', 'overdue', 'payment', 'paid', 'billing',
  'owed', 'receivable', 'collected', 'revenue', 'cash flow', 'cashflow',
  'how much do i have', 'what do i have in', 'money owed', 'unpaid',
];

const BLUEPRINT_KEYWORDS = [
  'blueprint', 'blueprints', 'plans', 'drawings', 'submittal', 'spec',
  'specs', 'rfi', 'change order', 'scope of work', 'project document',
];

const CHRONO_KEYWORDS = [
  'schedule', 'scheduling', 'calendar', 'timeline', 'deadline',
  'capacity', 'availability', 'crew availability', 'book', 'slot',
  'rough-in date', 'start date', 'when can', 'next week', 'next tuesday',
  'next monday', 'next friday', 'this week', 'phase timing', 'milestone',
];

const SPARK_KEYWORDS = [
  'lead', 'leads', 'pipeline', 'prospect', 'marketing', 'follow up',
  'crm', 'contact', 'new customer', 'referral', 'close rate', 'conversion',
  'outreach', 'sales', 'proposal sent', 'quoted', 'won', 'lost',
];

const ATLAS_KEYWORDS = [
  'location', 'address', 'drive time', 'travel', 'directions', 'distance',
  'how far', 'route', 'map', 'site', 'job site address', 'nearby',
];

// ─── SCOUT Material Intelligence keywords ────────────────────────────────────
// Note: 'price' and 'cost' overlap with VAULT; SCOUT wins when combined with
// material-specific context words (cheaper, supplier, lead time, alternative, stock).
const SCOUT_KEYWORDS = [
  'cheaper', 'alternative', 'alternatives', 'lead time', 'lead times',
  'supplier', 'suppliers', 'distributor', 'distributors',
  'stock', 'in stock', 'out of stock', 'availability',
  'where can i get', 'how much is', 'best price', 'lowest price',
  'compare suppliers', 'which supplier', 'graybar', 'rexel', 'wesco',
  'home depot pro', 'local supplier', 'material price', 'material cost',
  'price check', 'price change', 'price alert', 'price alerts',
  'romex price', 'thhn price', 'breaker price', 'conduit price',
  'wire price', 'cable price',
];

// Keywords that often appear alone and signal a NEXUS direct response
const NEXUS_DIRECT_KEYWORDS = [
  'strategy', 'advice', 'should i', 'what do you think', 'help me think',
  'general', 'overview', 'summary', 'what is', 'tell me about', 'explain',
  'how do i grow', 'business', 'recommend', 'suggestion',
  'take on more work', 'take on another', 'more work', 'capacity decision',
  'is it worth', 'should i hire', 'should i expand', 'grow the business',
  'is it a good idea', 'right move', 'worth it',
];

// ─── Similarity Scoring (Lightweight TF-style) ────────────────────────────────

/**
 * Scores relevance of an EchoEntry to the current query.
 * Uses term overlap with normalization. Returns 0.0–1.0.
 * Scores above ECHO_RELEVANCE_THRESHOLD are injected.
 */
const ECHO_RELEVANCE_THRESHOLD = 0.6;

function scoreRelevance(query: string, entry: EchoEntry): number {
  const queryTerms = tokenize(query);
  const entryTerms = tokenize(entry.content);

  if (queryTerms.size === 0 || entryTerms.size === 0) return 0;

  const intersection = new Set([...queryTerms].filter(t => entryTerms.has(t)));

  // Jaccard similarity
  const union = new Set([...queryTerms, ...entryTerms]);
  const jaccard = intersection.size / union.size;

  // Boost if tags overlap
  const tagBoost = (entry.tags ?? []).some(tag =>
    query.toLowerCase().includes(tag.toLowerCase()),
  ) ? 0.15 : 0;

  return Math.min(1.0, jaccard + tagBoost);
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2),
  );
}

// ─── 24-Hour Window Filter ────────────────────────────────────────────────────

const ECHO_WINDOW_MS = 24 * 60 * 60 * 1000;

function isWithin24Hours(isoTimestamp: string): boolean {
  const entryTime = new Date(isoTimestamp).getTime();
  const now = Date.now();
  return now - entryTime <= ECHO_WINDOW_MS;
}

// ─── Token Estimation ─────────────────────────────────────────────────────────

/** Rough approximation: ~4 chars per token */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const MAX_ECHO_TOKENS = 4000;

// ─── classifyQuery ─────────────────────────────────────────────────────────────

/**
 * classifyQuery
 *
 * Analyzes the user's query string and classifies its intent.
 * Scores each agent target by keyword matches, normalizes scores,
 * and determines primary route, secondary routes, and whether
 * disambiguation is needed.
 *
 * Disambiguation triggers when:
 *   - The query mentions an entity like "the project" and entity confidence
 *     would fall below 0.7 in a real DB context (simulated by pronoun detection)
 *   - Multiple agents score equally high without a clear winner
 */
export function classifyQuery(query: string): QueryClassification {
  const lower = query.toLowerCase();

  // Score each target
  const scores: Record<AgentTarget, number> = {
    VAULT: 0,
    OHM: 0,
    LEDGER: 0,
    BLUEPRINT: 0,
    CHRONO: 0,
    SPARK: 0,
    ATLAS: 0,
    SCOUT: 0,
    NEXUS: 0,
    MULTI: 0,
  };

  const matched: string[] = [];

  function scoreKeywords(target: AgentTarget, keywords: string[]): void {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        scores[target] += 1;
        matched.push(kw);
      }
    }
  }

  scoreKeywords('VAULT', VAULT_KEYWORDS);
  scoreKeywords('OHM', OHM_KEYWORDS);
  scoreKeywords('LEDGER', LEDGER_KEYWORDS);
  scoreKeywords('BLUEPRINT', BLUEPRINT_KEYWORDS);
  scoreKeywords('CHRONO', CHRONO_KEYWORDS);
  scoreKeywords('SPARK', SPARK_KEYWORDS);
  scoreKeywords('ATLAS', ATLAS_KEYWORDS);
  scoreKeywords('SCOUT', SCOUT_KEYWORDS);
  scoreKeywords('NEXUS', NEXUS_DIRECT_KEYWORDS);

  // Find top two scores
  const sorted = (Object.entries(scores) as [AgentTarget, number][])
    .filter(([, s]) => s > 0)
    .sort(([, a], [, b]) => b - a);

  const topTwo = sorted.slice(0, 2);
  const [primaryEntry] = topTwo;
  const secondaryEntries = sorted.slice(1, 3);

  // Default to NEXUS if nothing matched
  let primaryTarget: AgentTarget = primaryEntry ? primaryEntry[0] : 'NEXUS';
  const primaryScore = primaryEntry ? primaryEntry[1] : 0;

  // Tiebreaker: when NEXUS ties with any other agent, NEXUS wins — it is the
  // orchestration brain and strategic questions should resolve there.
  if (
    topTwo.length === 2 &&
    topTwo[0][1] === topTwo[1][1] &&
    (topTwo[0][0] === 'NEXUS' || topTwo[1][0] === 'NEXUS')
  ) {
    primaryTarget = 'NEXUS';
  }

  // Total matched score for normalization
  const totalScore = sorted.reduce((sum, [, s]) => sum + s, 0) || 1;
  const confidence = Math.min(1.0, primaryScore / totalScore);

  // Multi-agent: BLUEPRINT + CHRONO often co-occur; also if 2+ agents score high
  const multiAgentPair =
    scores['BLUEPRINT'] > 0 && scores['CHRONO'] > 0;

  const isMultiAgent =
    multiAgentPair ||
    (topTwo.length === 2 && topTwo[0][1] === topTwo[1][1] && topTwo[0][1] > 0);

  const secondaryTargets = secondaryEntries.map(([t]) => t);

  // ─── Disambiguation detection ──────────────────────────────────────────────
  // Detect ambiguous entity references using pronoun/vague-noun patterns
  const vaguePronouns = /\b(the project|the job|the client|the invoice|that project|this job)\b/i;
  const requiresDisambiguation = vaguePronouns.test(query) && confidence < 0.85;

  let disambiguationQuestion: string | undefined;
  if (requiresDisambiguation) {
    if (vaguePronouns.test(query)) {
      disambiguationQuestion = 'Which project are you referring to? Could you give me the project name or address?';
    }
  }

  return {
    primaryTarget,
    secondaryTargets,
    confidence,
    requiresDisambiguation,
    disambiguationQuestion,
    matchedKeywords: [...new Set(matched)],
    isMultiAgent,
  };
}

// ─── injectEchoContext ────────────────────────────────────────────────────────

/**
 * injectEchoContext
 *
 * Filters the ECHO 24-hour rolling window to only entries:
 *   1. Within the 24-hour window
 *   2. Relevance score > ECHO_RELEVANCE_THRESHOLD (0.6)
 *   3. Sorted by relevance score descending
 *   4. Accumulated until MAX_ECHO_TOKENS (4,000) is reached
 *
 * Returns the injected entries, total tokens, and skipped count.
 */
export function injectEchoContext(
  query: string,
  echoWindow: EchoEntry[],
): EchoInjection {
  // Filter to 24-hour window
  const recent = echoWindow.filter(e => isWithin24Hours(e.timestamp));

  // Score all recent entries
  const scored = recent
    .map(e => ({ entry: e, score: scoreRelevance(query, e) }))
    .filter(({ score }) => score >= ECHO_RELEVANCE_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  // Accumulate until token budget exhausted
  const injected: EchoEntry[] = [];
  let totalTokens = 0;
  let skippedCount = 0;

  for (const { entry } of scored) {
    const tokens = estimateTokens(entry.content);
    if (totalTokens + tokens > MAX_ECHO_TOKENS) {
      skippedCount++;
      continue;
    }
    injected.push(entry);
    totalTokens += tokens;
  }

  // Count skipped due to threshold (not budget)
  skippedCount += recent.length - scored.length;

  return {
    injectedEntries: injected,
    totalTokensInjected: totalTokens,
    skippedCount,
  };
}

// ─── buildNexusPrompt ─────────────────────────────────────────────────────────

/**
 * buildNexusPrompt
 *
 * Assembles the final prompt string to send to Claude.
 * Injects ECHO context, agent routing instructions, session context,
 * (V3-31) active session conclusions for cold-open prevention, and
 * (V3-33) owner-only handoff context from the private personal system.
 *
 * @param request          — the NEXUS request object
 * @param priorConclusions — pre-fetched active conclusions (V3-31, optional)
 * @param ownerHandoffs    — pre-fetched unread handoff entries (V3-33, optional, owner only)
 */
export function buildNexusPrompt(
  request: NexusRequest,
  priorConclusions?: SessionConclusion[],
  ownerHandoffs?: HandoffEntry[],
): string {
  const classification = classifyQuery(request.query);
  const echoInjection = injectEchoContext(request.query, request.echoWindow ?? []);

  const sections: string[] = [];

  // ── System Identity Block ──────────────────────────────────────────────────
  sections.push(
    `You are NEXUS, the AI orchestration brain for PowerOn Hub — an intelligent business OS for electrical contractors. You are direct, confident, and highly practical. You know electrical contracting inside and out.`,
  );

  // ── Agent Routing Context ──────────────────────────────────────────────────
  const routingDesc: Record<AgentTarget, string> = {
    VAULT: 'Respond as VAULT — the pricing and estimating specialist. Focus on material costs, labor rates, markups, and takeoff accuracy.',
    OHM: 'Respond as OHM — the NEC compliance and code expert. Reference specific NEC articles, local AHJ requirements, and inspection readiness.',
    LEDGER: 'Respond as LEDGER — the AR, invoicing, and collections specialist. Focus on unbilled work, outstanding balances, cash flow, and collection strategy.',
    BLUEPRINT: 'Respond as BLUEPRINT — the project document and scope specialist. Focus on plan review, MTO extraction, and coordination items.',
    CHRONO: 'Respond as CHRONO — the scheduling and capacity specialist. Focus on crew availability, phase timelines, project sequencing, and scheduling conflicts.',
    SPARK: 'Respond as SPARK — the leads and marketing specialist. Focus on pipeline health, lead conversion, follow-up strategy, and revenue potential.',
    ATLAS: 'Respond as ATLAS — the location and travel intelligence specialist. Focus on site logistics, drive time, and geographic routing.',
    SCOUT: 'Respond as SCOUT — the material intelligence specialist. Focus on real-time pricing, supplier comparisons, alternative products, lead times, and stock availability across distributors (Graybar, Rexel, WESCO, Home Depot Pro, local suppliers).',
    NEXUS: 'Respond directly as NEXUS — the strategic orchestration brain. Give high-level business strategy, answer general questions, and synthesize across all domains.',
    MULTI: 'This query requires multiple agents. Respond in sequence: address each agent domain clearly, then synthesize a unified recommendation.',
  };

  sections.push(`ROUTING: ${routingDesc[classification.primaryTarget]}`);

  if (classification.isMultiAgent && classification.secondaryTargets.length > 0) {
    const secondaryDesc = classification.secondaryTargets
      .map(t => routingDesc[t])
      .join('\n');
    sections.push(`SECONDARY AGENTS ENGAGED:\n${secondaryDesc}`);
  }

  // ── ECHO Context Block ─────────────────────────────────────────────────────
  if (echoInjection.injectedEntries.length > 0) {
    const echoBlock = echoInjection.injectedEntries
      .map(e => `[${e.agentSource} @ ${e.timestamp}]: ${e.content}`)
      .join('\n');
    sections.push(
      `RECENT CONTEXT (from ECHO — last 24 hours, relevance-filtered):\n${echoBlock}`,
    );
  }

  // ── Prior Session Conclusions (V3-31) ─────────────────────────────────────
  // Injected when featureFlags.sessionConclusions is ON and conclusions exist.
  // NEXUS uses these to avoid cold opens on still-active topics.
  if (featureFlags.sessionConclusions && priorConclusions && priorConclusions.length > 0) {
    const conclusionLines = priorConclusions
      .map((c, i) => {
        const date = new Date(c.created_at).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        });
        const projectNote = c.project_id ? ` (project: ${c.project_id})` : '';
        return `${i + 1}. ${c.conclusion_text} [from ${date}${projectNote}]`;
      })
      .join('\n');

    sections.push(
      `PREVIOUS SESSION CONCLUSIONS STILL ACTIVE:\n${conclusionLines}\nThese should inform your response. If a conclusion has been resolved, note it.`,
    );
  }

  // ── Owner Handoff Context (V3-33) ─────────────────────────────────────────
  // Injected when featureFlags.katsuroHandoff is ON and unread handoffs exist.
  // These are notes from the owner's personal system, surfaced at session open.
  // CRITICAL: Do NOT mention the source system name or agent name in the prompt.
  // Reference only as "your notes" or "your personal system" in spoken output.
  if (featureFlags.katsuroHandoff && ownerHandoffs && ownerHandoffs.length > 0) {
    const handoffBlock = formatHandoffsForNexus(ownerHandoffs);
    sections.push(
      `NOTES FROM YOUR PERSONAL SYSTEM (owner-only, surface naturally in opening brief):
${handoffBlock}
Instructions for surfacing these notes:
- Weave them naturally into your opening — do not read them as a list unless there are 3 or more.
- Reference them as "your notes" or "from your personal system" — never use any branded name.
- For each item, offer to take action: "Want me to pull that up?" or "Should I factor that in?"
- When the user engages with one (asks a follow-up, opens the related project), that item is actioned.
- When the user says "I handled that", "skip that", or similar, that item is dismissed.`,
    );
  }

  // -- Live Project Context (from backupDataService via nexusContextBuilder)
  // Always injected so Claude has real project names, dollar amounts, and
  // field data rather than hallucinating or asking for clarification.
  try {
    const liveContext = buildDeepProjectContext()
    if (liveContext) {
      sections.push(`LIVE BUSINESS DATA:\n${liveContext}`)
    }
  } catch (ctxErr) {
    console.warn('[NEXUS] buildDeepProjectContext failed (non-critical):', ctxErr)
  }

  // ── Session Context ────────────────────────────────────────────────────────
  if (request.sessionContext) {
    sections.push(`SESSION CONTEXT:\n${request.sessionContext}`);
  }

  // ── Agent Mode ─────────────────────────────────────────────────────────────
  if (request.agentMode) {
    sections.push(`USER MODE: ${request.agentMode.toUpperCase()}`);
  }

  // ── Response Format Instructions ──────────────────────────────────────────
  sections.push(
    `RESPONSE FORMAT:
Return a JSON object with this exact structure:
{
  "speak": "<natural conversational text for voice output — 1-3 sentences, direct and actionable>",
  "display": [
    { "type": "<metric_card|alert|chart|action_item|link>", "title": "...", "value": "...", "label": "..." }
  ],
  "captures": [
    { "type": "<entity|decision|task|financial|note>", "label": "...", "value": "...", "agentSource": "...", "timestamp": "<ISO>" }
  ]
}
- speak: voice-ready text, no markdown, no lists, conversational
- display: 0–5 components relevant to the answer
- captures: any decisions, entities, or tasks worth remembering
Do not include markdown code fences in your response. Return raw JSON only.`,
  );

  // ── The Actual Query ───────────────────────────────────────────────────────
  sections.push(`USER QUERY: ${request.query}`);

  return sections.join('\n\n---\n\n');
}

// ─── runNexusEngine ───────────────────────────────────────────────────────────

/**
 * runNexusEngine
 *
 * Main entry point. Orchestrates the full NEXUS pipeline:
 *   1. Classify the query
 *   2. Check disambiguation threshold
 *   3. Inject ECHO context
 *   4. Build the prompt
 *   5. Call Claude via claudeService
 *   6. Parse and return structured NexusResponse
 *   7. Log AI decision to audit trail (V3-24)
 *
 * If clarification is required, returns early with clarificationRequired=true
 * and the clarification question — no Claude call is made.
 */
export async function runNexusEngine(request: NexusRequest): Promise<NexusResponse> {
  // Step 1: Classify
  const classification = classifyQuery(request.query);

  // Step 2: Disambiguation check — never guess; ask ONE question
  if (classification.requiresDisambiguation && classification.disambiguationQuestion) {
    return {
      speak: classification.disambiguationQuestion,
      display: [],
      captures: [],
      routedTo: classification.primaryTarget,
      clarificationRequired: true,
      clarificationQuestion: classification.disambiguationQuestion,
    };
  }

  // Step 3: ECHO context injection
  const echoInjection = injectEchoContext(request.query, request.echoWindow ?? []);

  // Step 3b: SESSION OPEN — fetch prior conclusions for cold-open prevention [V3-31]
  // Only runs when featureFlags.sessionConclusions is ON and a userId is present.
  let priorConclusions: SessionConclusion[] | undefined;
  if (featureFlags.sessionConclusions && request.userId) {
    try {
      priorConclusions = await getRelevantConclusions(request.userId, request.query);
    } catch (err) {
      console.error('[NEXUS] getRelevantConclusions failed — continuing without prior conclusions:', err);
    }
  }

  // Step 3c: SESSION OPEN — fetch owner handoffs for personal system integration [V3-33]
  // Only runs when:
  //   - featureFlags.katsuroHandoff is ON
  //   - userId is present
  //   - isOwnerWithDaSparkyHub(userId) returns true (second security guard layer)
  // Non-owner users: this block is completely skipped. Zero data leakage.
  let ownerHandoffs: HandoffEntry[] | undefined;
  const surfacedHandoffIds: string[] = [];

  if (featureFlags.katsuroHandoff && request.userId && isOwnerWithDaSparkyHub(request.userId)) {
    try {
      ownerHandoffs = await getUnreadHandoffs(request.userId);

      // Mark all fetched handoffs as read immediately (fire-and-forget).
      // read_at is set before Claude sees them — prevents re-surfacing on retry.
      if (ownerHandoffs.length > 0) {
        for (const handoff of ownerHandoffs) {
          surfacedHandoffIds.push(handoff.id);
          markHandoffRead(handoff.id).catch(() => {
            // Silent — never surface handoff infrastructure errors to the user
          });
        }
      }
    } catch {
      // Silent failure — never acknowledge handoff infrastructure in errors
      ownerHandoffs = undefined;
    }
  }

  // Step 4: Build prompt
  const builtPrompt = buildNexusPrompt(request, priorConclusions, ownerHandoffs);

  // Step 5: Call Claude via claudeService
  // Import is done inline to avoid circular dependency at module load time
  const { callClaude } = await import('../services/claudeService');

  let rawText = '';
  try {
    const claudeResponse = await callClaude({
      prompt: builtPrompt,
      context: request.sessionContext,
      agentMode: request.agentMode,
    });
    rawText = claudeResponse.text;
  } catch (err) {
    console.error('[NEXUS] claudeService call failed:', err);
    rawText = JSON.stringify({
      speak: 'I ran into an issue processing that request. Please try again.',
      display: [],
      captures: [],
    });
  }

  // Step 6: Parse structured response
  const parsed = parseNexusResponse(rawText);

  const finalResponse: NexusResponse = {
    ...parsed,
    routedTo: classification.isMultiAgent ? 'MULTI' : classification.primaryTarget,
    echoInjection,
    builtPrompt,
    // V3-33: owner handoff IDs surfaced this session — callers use these to drive
    // markHandoffActioned() / dismissHandoff() on subsequent turns.
    surfacedHandoffIds: surfacedHandoffIds.length > 0 ? surfacedHandoffIds : undefined,
  };

  // Step 7: Log AI decision to audit trail (V3-24)
  // Fire-and-forget — never block the UI on audit logging.
  if (request.userId) {
    import('../services/auditTrailService').then(({ logAIDecision }) => {
      logAIDecision({
        user_id: request.userId!,
        agent_name: finalResponse.routedTo,
        query: request.query,
        recommendation: finalResponse.speak,
        reasoning: finalResponse as unknown as Record<string, unknown>,
        confidence_score: classification.confidence,
      }).catch((err) => {
        console.error('[NEXUS] auditTrail logAIDecision failed:', err);
      });
    }).catch((err) => {
      console.error('[NEXUS] auditTrailService import failed:', err);
    });
  }

  return finalResponse;
}

// ─── parseNexusResponse ───────────────────────────────────────────────────────

/**
 * parseNexusResponse
 *
 * Attempts to parse the Claude response as structured JSON.
 * Falls back gracefully if the model returned plain text.
 */
function parseNexusResponse(rawText: string): Pick<NexusResponse, 'speak' | 'display' | 'captures'> {
  // Strip any markdown fences the model may have added despite instructions
  const stripped = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(stripped);
    return {
      speak: String(parsed.speak ?? stripped),
      display: Array.isArray(parsed.display) ? parsed.display : [],
      captures: Array.isArray(parsed.captures) ? parsed.captures : [],
    };
  } catch {
    // Plain text fallback — wrap in minimal structure
    return {
      speak: rawText.trim(),
      display: [],
      captures: [],
    };
  }
}

// ─── Session Debrief — V3-31 ──────────────────────────────────────────────────

/** Keywords that indicate the user is ending a session. */
const SESSION_CLOSE_PHRASES = [
  'goodbye', 'good bye', 'bye', 'thanks', 'thank you', 'that\'s all',
  'that is all', 'done for tonight', 'done for now', "i'm done", 'im done',
  'see you', 'see ya', 'talk later', 'catch you later', 'later',
  'all good', 'all set', 'wrap up', 'wrapping up', 'end session',
  'stop', 'exit', 'quit',
];

/**
 * isSessionCloseSignal
 *
 * Returns true when the user's message looks like a session-ending phrase.
 * Used by callers to decide when to trigger generateSessionDebrief().
 */
export function isSessionCloseSignal(userMessage: string): boolean {
  const lower = userMessage.toLowerCase().trim();
  return SESSION_CLOSE_PHRASES.some((phrase) => lower.includes(phrase));
}

/**
 * generateSessionDebrief
 *
 * SESSION CLOSE integration point [V3-31].
 *
 * Analyzes a conversation history and extracts:
 *   1. Key decisions made
 *   2. Action items the user committed to
 *   3. Unresolved questions that should be revisited
 *
 * Returns a ConclusionItem[] ready for saveConclusions().
 *
 * Triggered when:
 *   - User explicitly ends session (see isSessionCloseSignal)
 *   - OR after 3 minutes of inactivity (caller responsibility)
 *
 * Feature-flagged: only runs when featureFlags.sessionConclusions is ON.
 */
export async function generateSessionDebrief(
  conversationHistory: Message[],
  userId?: string,
  sessionId?: string,
): Promise<ConclusionItem[]> {
  if (!featureFlags.sessionConclusions) return [];
  if (!conversationHistory.length) return [];

  const historyText = conversationHistory
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n');

  const debriefPrompt = `Review this conversation and extract:
1. Key decisions made
2. Action items the user committed to
3. Unresolved questions that should be revisited

Return ONLY a JSON array of objects with this shape (no markdown, no explanation):
[{ "text": "<conclusion or action item>", "block": "<relevant block or null>", "projectId": "<project id or null>", "agentRefs": ["<AGENT_NAME>"] }]

If there is nothing worth saving, return an empty array: []

CONVERSATION:
${historyText}`;

  let conclusions: ConclusionItem[] = [];

  try {
    const { callClaude } = await import('../services/claudeService');

    const response = await callClaude({
      prompt: debriefPrompt,
      agentMode: 'standard',
    });

    const stripped = response.text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    const parsed = JSON.parse(stripped);
    if (Array.isArray(parsed)) {
      conclusions = parsed.map((item) => ({
        text: String(item.text ?? ''),
        block: item.block ?? undefined,
        projectId: item.projectId ?? undefined,
        agentRefs: Array.isArray(item.agentRefs) ? item.agentRefs : [],
      })).filter((c) => c.text.length > 0);
    }
  } catch (err) {
    console.error('[NEXUS] generateSessionDebrief failed:', err);
    return [];
  }

  // Persist conclusions if userId + sessionId provided
  if (conclusions.length > 0 && userId && sessionId) {
    saveConclusions(userId, sessionId, conclusions).catch((err) => {
      console.error('[NEXUS] saveConclusions failed in debrief:', err);
    });
  }

  return conclusions;
}

// ─── Test Harness ─────────────────────────────────────────────────────────────

/**
 * testNexusEngine
 *
 * Runs the 5 canonical test queries and logs classification + routing results.
 * Called as part of V3-19 validation. Does not make real Claude API calls —
 * only validates query classification and prompt construction.
 */
export async function testNexusEngine(): Promise<void> {
  const TEST_QUERIES = [
    {
      label: 'NEC kitchen receptacle (→ OHM)',
      query: "What's the NEC requirement for kitchen receptacles?",
      expectedTarget: 'OHM' as AgentTarget,
    },
    {
      label: 'Unbilled work total (→ LEDGER)',
      query: 'How much do I have in unbilled work?',
      expectedTarget: 'LEDGER' as AgentTarget,
    },
    {
      label: 'Schedule Surgery Center rough-in (→ CHRONO)',
      query: 'Schedule the Surgery Center rough-in for next Tuesday',
      expectedTarget: 'CHRONO' as AgentTarget,
    },
    {
      label: 'Pipeline strategy (→ NEXUS direct)',
      query: "My pipeline is at $66k, should I take on more work?",
      expectedTarget: 'NEXUS' as AgentTarget,
    },
    {
      label: 'Romex price lookup (→ VAULT)',
      query: "What's the price on 500ft of 12/2 Romex?",
      expectedTarget: 'VAULT' as AgentTarget,
    },
  ];

  console.log('\n══════════════════════════════════════════════════════');
  console.log('  NEXUS PROMPT ENGINE — Test Suite (V3-19 | E16)');
  console.log('══════════════════════════════════════════════════════\n');

  let passed = 0;
  let failed = 0;

  for (const test of TEST_QUERIES) {
    const classification = classifyQuery(test.query);
    const prompt = buildNexusPrompt({ query: test.query });
    const routeMatch = classification.primaryTarget === test.expectedTarget;

    const status = routeMatch ? '✅ PASS' : '❌ FAIL';
    if (routeMatch) passed++; else failed++;

    console.log(`${status}  [${test.label}]`);
    console.log(`         Query     : "${test.query}"`);
    console.log(`         Expected  : ${test.expectedTarget}`);
    console.log(`         Got       : ${classification.primaryTarget}`);
    console.log(`         Confidence: ${(classification.confidence * 100).toFixed(0)}%`);
    console.log(`         Keywords  : ${classification.matchedKeywords.join(', ') || '(none)'}`);
    console.log(`         Multi-Agent: ${classification.isMultiAgent}`);
    console.log(`         Disam.    : ${classification.requiresDisambiguation}`);
    console.log(`         Prompt len: ${prompt.length} chars (~${estimateTokens(prompt)} tokens)`);
    console.log('');
  }

  console.log('──────────────────────────────────────────────────────');
  console.log(`  Results: ${passed}/${TEST_QUERIES.length} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════\n');
}
