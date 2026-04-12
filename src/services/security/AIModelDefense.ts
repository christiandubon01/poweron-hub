/**
 * AIModelDefense.ts
 * SEC7 — AI Model Defense Layer for PowerOn Hub
 *
 * Defends all Claude API calls against:
 *  - Prompt injection attacks
 *  - System prompt extraction attempts
 *  - Output data leakage
 *  - Cross-agent boundary violations via user input
 *
 * Usage:
 *   const clean = sanitizeUserInput(rawInput);
 *   const safe  = validateOutput(claudeResponse);
 *
 * Drop-in: wrap every callClaude() / callNexus() at the call site:
 *   const response = await callClaude({ ..., messages: [{ role: 'user', content: sanitizeUserInput(userText) }] });
 *   const text     = validateOutput(extractText(response));
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type InjectionType =
  | 'INSTRUCTION_OVERRIDE'
  | 'SYSTEM_PROMPT_EXTRACTION'
  | 'ROLE_PLAY_ESCAPE'
  | 'NESTED_INJECTION'
  | 'BASE64_ENCODED'
  | 'UNICODE_OBFUSCATION'
  | 'MARKDOWN_INJECTION'
  | 'CROSS_AGENT_MANIPULATION'
  | 'OUTPUT_LEAKAGE';

export interface InjectionAttempt {
  id: string;
  timestamp: string;
  type: InjectionType;
  rawInput: string;
  sanitizedInput: string;
  patternMatched: string;
}

export interface OutputLeakage {
  id: string;
  timestamp: string;
  type: 'SYSTEM_PROMPT_FRAGMENT' | 'FILE_PATH' | 'API_KEY' | 'SUPABASE_URL' | 'ENV_VAR' | 'AGENT_ARCHITECTURE';
  rawOutput: string;
  redactedOutput: string;
  fragmentFound: string;
}

export interface InjectionStats {
  total: number;
  byType: Record<InjectionType, number>;
  recentWindow: InjectionAttempt[];      // last 50 attempts
  hourlyRate: number;                    // attempts per hour (rolling 1h window)
  patternFrequency: Record<string, number>;
}

export interface AgentScope {
  agent: AgentName;
  allowedDataDomains: string[];
  forbiddenCrossDomains: string[];
  description: string;
}

export type AgentName =
  | 'VAULT'
  | 'OHM'
  | 'LEDGER'
  | 'BLUEPRINT'
  | 'CHRONO'
  | 'SPARK'
  | 'ATLAS'
  | 'NEXUS'
  | 'PULSE'
  | 'SCOUT'
  | 'GUARDIAN'
  | 'HUNTER';

// ─── Constants ────────────────────────────────────────────────────────────────

const INJECTION_LOG_KEY = 'poweron_injection_audit';
const LEAKAGE_LOG_KEY   = 'poweron_output_leakage_audit';
const MAX_LOG_ENTRIES   = 500;

/** Agent scope definitions — each agent operates only in its declared domain. */
const AGENT_SCOPES: Record<AgentName, AgentScope> = {
  VAULT: {
    agent: 'VAULT',
    allowedDataDomains: ['estimates', 'pricing', 'margins', 'bids', 'price_book'],
    forbiddenCrossDomains: ['collections', 'invoices', 'scheduling', 'leads', 'compliance_codes'],
    description: 'Estimating and pricing only',
  },
  OHM: {
    agent: 'OHM',
    allowedDataDomains: ['electrical_code', 'nec', 'compliance', 'calculations'],
    forbiddenCrossDomains: ['financial_data', 'customer_data', 'scheduling', 'estimates'],
    description: 'Electrical code and compliance only',
  },
  LEDGER: {
    agent: 'LEDGER',
    allowedDataDomains: ['invoices', 'ar', 'collections', 'payments', 'cash_flow'],
    forbiddenCrossDomains: ['estimates', 'compliance_codes', 'scheduling', 'leads'],
    description: 'AR, invoicing, and collections only',
  },
  BLUEPRINT: {
    agent: 'BLUEPRINT',
    allowedDataDomains: ['project_documents', 'plans', 'rfis', 'coordination'],
    forbiddenCrossDomains: ['financial_data', 'compliance_codes', 'leads', 'scheduling'],
    description: 'Project documents and plans only',
  },
  CHRONO: {
    agent: 'CHRONO',
    allowedDataDomains: ['scheduling', 'crew_dispatch', 'calendar', 'capacity'],
    forbiddenCrossDomains: ['financial_data', 'compliance_codes', 'leads', 'estimates'],
    description: 'Scheduling and capacity only',
  },
  SPARK: {
    agent: 'SPARK',
    allowedDataDomains: ['leads', 'marketing', 'pipeline', 'call_scripts'],
    forbiddenCrossDomains: ['financial_data', 'compliance_codes', 'scheduling', 'estimates'],
    description: 'Leads and marketing only',
  },
  ATLAS: {
    agent: 'ATLAS',
    allowedDataDomains: ['location', 'travel', 'routing', 'geography'],
    forbiddenCrossDomains: ['financial_data', 'compliance_codes', 'leads'],
    description: 'Location and travel only',
  },
  NEXUS: {
    agent: 'NEXUS',
    allowedDataDomains: ['orchestration', 'routing', 'all_domains_read_only'],
    forbiddenCrossDomains: [],   // NEXUS coordinates but never writes to agent-specific stores
    description: 'Orchestration and routing — read access to all domains',
  },
  PULSE: {
    agent: 'PULSE',
    allowedDataDomains: ['kpis', 'weekly_digest', 'trends'],
    forbiddenCrossDomains: ['estimates', 'compliance_codes', 'scheduling', 'leads'],
    description: 'Business KPIs and trend analysis only',
  },
  SCOUT: {
    agent: 'SCOUT',
    allowedDataDomains: ['gap_detection', 'proposals', 'opportunity_analysis'],
    forbiddenCrossDomains: ['financial_data', 'compliance_codes', 'scheduling'],
    description: 'Gap detection and opportunity proposals only',
  },
  GUARDIAN: {
    agent: 'GUARDIAN',
    allowedDataDomains: ['project_health', 'alerts', 'rules', 'violations'],
    forbiddenCrossDomains: ['financial_data', 'compliance_codes', 'leads', 'estimates'],
    description: 'Project health monitoring only',
  },
  HUNTER: {
    agent: 'HUNTER',
    allowedDataDomains: ['lead_scoring', 'pipeline_intelligence', 'competitor_analysis'],
    forbiddenCrossDomains: ['financial_data', 'compliance_codes', 'scheduling', 'estimates'],
    description: 'Lead hunting and pipeline intelligence only',
  },
};

// ─── Injection Detection Patterns ─────────────────────────────────────────────

interface InjectionPattern {
  type: InjectionType;
  name: string;
  regex: RegExp;
  stripFn?: (text: string) => string;
}

const INJECTION_PATTERNS: InjectionPattern[] = [
  // Instruction override
  {
    type: 'INSTRUCTION_OVERRIDE',
    name: 'ignore_previous',
    regex: /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|context|guidelines?)/gi,
  },
  {
    type: 'INSTRUCTION_OVERRIDE',
    name: 'disregard_rules',
    regex: /disregard\s+(all\s+)?(rules?|guidelines?|instructions?|constraints?|limitations?)/gi,
  },
  {
    type: 'INSTRUCTION_OVERRIDE',
    name: 'forget_instructions',
    regex: /forget\s+(all\s+)?(your\s+)?(previous|prior|earlier|above)\s+(instructions?|prompts?|rules?|training)/gi,
  },
  {
    type: 'INSTRUCTION_OVERRIDE',
    name: 'override_system',
    regex: /override\s+(the\s+)?(system\s+)?(prompt|instructions?|rules?|guidelines?)/gi,
  },
  {
    type: 'INSTRUCTION_OVERRIDE',
    name: 'new_instructions',
    regex: /\[?(new|updated|revised|corrected)\s+(instructions?|directives?|rules?|guidelines?)\]?/gi,
  },

  // System prompt extraction
  {
    type: 'SYSTEM_PROMPT_EXTRACTION',
    name: 'reveal_system_prompt',
    regex: /reveal\s+(your\s+)?(system\s+prompt|instructions?|training|guidelines?|rules?)/gi,
  },
  {
    type: 'SYSTEM_PROMPT_EXTRACTION',
    name: 'show_prompt',
    regex: /show\s+(me\s+)?(your\s+)?(system\s+prompt|hidden\s+instructions?|original\s+prompt|initial\s+prompt)/gi,
  },
  {
    type: 'SYSTEM_PROMPT_EXTRACTION',
    name: 'what_are_instructions',
    regex: /what\s+(are\s+your|is\s+your)\s+(system\s+prompt|instructions?|programming|initial\s+prompt|hidden\s+instructions?)/gi,
  },
  {
    type: 'SYSTEM_PROMPT_EXTRACTION',
    name: 'print_instructions',
    regex: /print\s+(your\s+)?(system\s+prompt|instructions?|rules?|initial\s+message)/gi,
  },
  {
    type: 'SYSTEM_PROMPT_EXTRACTION',
    name: 'dump_prompt',
    regex: /dump\s+(your\s+)?(context|prompt|system\s+message|instructions?)/gi,
  },
  {
    type: 'SYSTEM_PROMPT_EXTRACTION',
    name: 'repeat_verbatim',
    regex: /repeat\s+(verbatim|exactly|word\s+for\s+word)\s+(your\s+)?(system\s+prompt|instructions?|initial\s+message)/gi,
  },

  // Role-play escape
  {
    type: 'ROLE_PLAY_ESCAPE',
    name: 'you_are_now',
    regex: /you\s+are\s+now\s+(a\s+|an\s+)?(different|new|other|unrestricted|free|uncensored|jailbroken)/gi,
  },
  {
    type: 'ROLE_PLAY_ESCAPE',
    name: 'act_as_if',
    regex: /act\s+as\s+(if|though)\s+(you\s+)?(are|were|have\s+no|don'?t\s+have)\s+(different|unrestricted|no\s+rules?|no\s+limits?)/gi,
  },
  {
    type: 'ROLE_PLAY_ESCAPE',
    name: 'pretend_you_are',
    regex: /pretend\s+(you\s+are|to\s+be)\s+(a\s+|an\s+)?(different|unrestricted|free|uncensored|jailbroken|rogue|evil|harmful)/gi,
  },
  {
    type: 'ROLE_PLAY_ESCAPE',
    name: 'pretend_no_rules',
    regex: /pretend\s+(you\s+)?(have\s+no|don'?t\s+have\s+any)\s+(rules?|limits?|guidelines?|restrictions?|constraints?)/gi,
  },
  {
    type: 'ROLE_PLAY_ESCAPE',
    name: 'simulate_unconstrained',
    regex: /simulate\s+(an?\s+)?(ai|assistant|model|bot)\s+(without|with\s+no)\s+(rules?|limits?|guidelines?|restrictions?|safety)/gi,
  },
  {
    type: 'ROLE_PLAY_ESCAPE',
    name: 'developer_mode',
    regex: /\b(developer|dev|jailbreak|DAN|STAN|DUDE|AIM|bypass)\s*(mode|enabled?|activated?|unlocked?)/gi,
  },

  // Nested injection — hidden instruction inside otherwise normal text
  {
    type: 'NESTED_INJECTION',
    name: 'hidden_instruction_brackets',
    regex: /\[INST\][\s\S]*?\[\/INST\]/gi,
  },
  {
    type: 'NESTED_INJECTION',
    name: 'system_tags',
    regex: /<\/?system>/gi,
  },
  {
    type: 'NESTED_INJECTION',
    name: 'hidden_human_assistant',
    regex: /\n(Human|Assistant|System|User|AI):\s/gi,
  },
  {
    type: 'NESTED_INJECTION',
    name: 'xml_instruction_tags',
    regex: /<(instructions?|prompt|context|rules?|directive|override)>[\s\S]*?<\/(instructions?|prompt|context|rules?|directive|override)>/gi,
  },

  // Markdown injection — using markdown to insert hidden instructions
  {
    type: 'MARKDOWN_INJECTION',
    name: 'html_comment_injection',
    regex: /<!--[\s\S]*?-->/g,
  },
  {
    type: 'MARKDOWN_INJECTION',
    name: 'zero_width_chars',
    regex: /[\u200B-\u200D\uFEFF\u2060\u00AD]/g,  // zero-width space, joiner, etc.
  },

  // Cross-agent manipulation
  {
    type: 'CROSS_AGENT_MANIPULATION',
    name: 'as_agent_access_other',
    regex: /as\s+(VAULT|OHM|LEDGER|BLUEPRINT|CHRONO|SPARK|ATLAS|NEXUS|PULSE|SCOUT|GUARDIAN|HUNTER)[,\s]+access\s+(VAULT|OHM|LEDGER|BLUEPRINT|CHRONO|SPARK|ATLAS|NEXUS|PULSE|SCOUT|GUARDIAN|HUNTER)/gi,
  },
  {
    type: 'CROSS_AGENT_MANIPULATION',
    name: 'switch_agent_identity',
    regex: /you\s+are\s+now\s+(VAULT|OHM|LEDGER|BLUEPRINT|CHRONO|SPARK|ATLAS|NEXUS|PULSE|SCOUT|GUARDIAN|HUNTER)/gi,
  },
  {
    type: 'CROSS_AGENT_MANIPULATION',
    name: 'agent_bypass_routing',
    regex: /bypass\s+(nexus|routing|classification|agent\s+selection)/gi,
  },
  {
    type: 'CROSS_AGENT_MANIPULATION',
    name: 'modify_scoring_weights',
    regex: /modify\s+(scoring|weights?|algorithm|hunter\s+score|lead\s+score)\s+(through|via|using)\s+(conversation|chat|message|prompt)/gi,
  },
];

// Base64 detection (separate — needs decode attempt)
const BASE64_PATTERN = /(?:[A-Za-z0-9+/]{4}){4,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?/g;

// Unicode homoglyph obfuscation — look-alike characters substituted into injection phrases
const UNICODE_OBFUSCATION_CHARS = /[\u0400-\u04FF\u0370-\u03FF\u0590-\u05FF]/g;

// ─── Output Leakage Patterns ──────────────────────────────────────────────────

interface LeakagePattern {
  type: OutputLeakage['type'];
  name: string;
  regex: RegExp;
  redact: string;
}

const LEAKAGE_PATTERNS: LeakagePattern[] = [
  // System prompt fragments
  {
    type: 'SYSTEM_PROMPT_FRAGMENT',
    name: 'system_prompt_label',
    regex: /\bsystem\s+prompt\s*[:=]/gi,
    redact: '[REDACTED: system config]',
  },
  {
    type: 'SYSTEM_PROMPT_FRAGMENT',
    name: 'initial_instructions',
    regex: /\b(initial|original|core|base)\s+instructions?\s*[:=]/gi,
    redact: '[REDACTED: system config]',
  },

  // Internal file paths
  {
    type: 'FILE_PATH',
    name: 'unix_src_path',
    regex: /\/src\/(agents|services|components|store|types|config|netlify)\b[^\s"']*/g,
    redact: '[REDACTED: internal path]',
  },
  {
    type: 'FILE_PATH',
    name: 'netlify_functions',
    regex: /\/netlify\/functions\/[^\s"']*/g,
    redact: '[REDACTED: internal path]',
  },
  {
    type: 'FILE_PATH',
    name: 'ts_file_names',
    regex: /\b(claudeProxy|claudeService|nexusPromptEngine|authStore|backupDataService|supabaseService)\.(ts|js)\b/g,
    redact: '[REDACTED: internal module]',
  },

  // API keys
  {
    type: 'API_KEY',
    name: 'anthropic_key',
    regex: /sk-ant-[A-Za-z0-9\-_]{20,}/g,
    redact: '[REDACTED: API key]',
  },
  {
    type: 'API_KEY',
    name: 'openai_key',
    regex: /sk-[A-Za-z0-9]{20,}/g,
    redact: '[REDACTED: API key]',
  },
  {
    type: 'API_KEY',
    name: 'elevenlabs_key',
    regex: /\b[a-f0-9]{32}\b/g,
    redact: '[REDACTED: API key]',
  },
  {
    type: 'API_KEY',
    name: 'bearer_token',
    regex: /Bearer\s+[A-Za-z0-9\-_\.]{20,}/g,
    redact: 'Bearer [REDACTED]',
  },

  // Supabase URLs
  {
    type: 'SUPABASE_URL',
    name: 'supabase_project_url',
    regex: /https:\/\/[a-z0-9]{20}\.supabase\.co\b/g,
    redact: '[REDACTED: Supabase URL]',
  },
  {
    type: 'SUPABASE_URL',
    name: 'supabase_anon_key',
    regex: /eyJ[A-Za-z0-9\-_]{50,}\.[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}/g,
    redact: '[REDACTED: Supabase key]',
  },

  // Environment variable names
  {
    type: 'ENV_VAR',
    name: 'vite_env_vars',
    regex: /\bVITE_(ANTHROPIC_API_KEY|ELEVENLABS_API_KEY|SUPABASE_URL|SUPABASE_ANON_KEY|OPENAI_API_KEY)\b/g,
    redact: '[REDACTED: env var]',
  },
  {
    type: 'ENV_VAR',
    name: 'process_env',
    regex: /process\.env\.[A-Z_]+/g,
    redact: '[REDACTED: env var]',
  },

  // Internal agent architecture details
  {
    type: 'AGENT_ARCHITECTURE',
    name: 'internal_function_names',
    regex: /\b(callClaude|callNexus|runNexusEngine|buildNexusPrompt|injectEchoContext|classifyQuery)\s*\(/g,
    redact: '[REDACTED: internal function](',
  },
  {
    type: 'AGENT_ARCHITECTURE',
    name: 'agent_route_targets',
    regex: /primaryTarget:\s*['"]?(VAULT|OHM|LEDGER|BLUEPRINT|CHRONO|SPARK|ATLAS|NEXUS|PULSE|SCOUT|GUARDIAN|HUNTER)['"]?/g,
    redact: 'primaryTarget: [REDACTED]',
  },
];

// ─── Persistent audit log helpers ─────────────────────────────────────────────

function readLog<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function writeLog<T>(key: string, entries: T[]): void {
  try {
    // Keep most recent MAX_LOG_ENTRIES entries
    const trimmed = entries.slice(-MAX_LOG_ENTRIES);
    localStorage.setItem(key, JSON.stringify(trimmed));
  } catch {
    // localStorage unavailable (SSR / quota) — fail silently; defense still runs
  }
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Base64 Detection ─────────────────────────────────────────────────────────

/**
 * Detect base64-encoded instruction payloads.
 * Finds base64 blobs, attempts to decode, checks for injection keywords.
 */
function detectBase64Injection(text: string): { detected: boolean; decoded: string } {
  const injectionKeywords = [
    'ignore', 'reveal', 'system prompt', 'pretend', 'act as', 'you are now',
    'disregard', 'forget', 'override', 'bypass', 'jailbreak',
  ];

  const matches = text.match(BASE64_PATTERN) ?? [];
  for (const candidate of matches) {
    if (candidate.length < 16) continue;
    try {
      const decoded = atob(candidate);
      const lower = decoded.toLowerCase();
      if (injectionKeywords.some(kw => lower.includes(kw))) {
        return { detected: true, decoded };
      }
    } catch {
      // Not valid base64
    }
  }
  return { detected: false, decoded: '' };
}

/**
 * Strip all detected base64 blobs that decode to injection content.
 */
function stripBase64Injections(text: string): string {
  const injectionKeywords = [
    'ignore', 'reveal', 'system prompt', 'pretend', 'act as', 'you are now',
    'disregard', 'forget', 'override', 'bypass', 'jailbreak',
  ];

  return text.replace(BASE64_PATTERN, (match) => {
    if (match.length < 16) return match;
    try {
      const decoded = atob(match);
      const lower = decoded.toLowerCase();
      if (injectionKeywords.some(kw => lower.includes(kw))) {
        return '[base64 content removed]';
      }
    } catch { /* not valid base64 */ }
    return match;
  });
}

// ─── Unicode Obfuscation Detection ────────────────────────────────────────────

/**
 * Detect Cyrillic / Greek / Hebrew homoglyphs used to obfuscate injection phrases.
 * Also strips zero-width characters.
 */
function detectUnicodeObfuscation(text: string): boolean {
  // Detect runs of mixed-script characters that look like Latin words
  return UNICODE_OBFUSCATION_CHARS.test(text) || /[\u200B-\u200D\uFEFF\u2060\u00AD]/.test(text);
}

function stripUnicodeObfuscation(text: string): string {
  // Remove zero-width characters
  let clean = text.replace(/[\u200B-\u200D\uFEFF\u2060\u00AD]/g, '');
  // Transliterate common Cyrillic/Greek homoglyphs to ASCII
  const homoglyphs: Record<string, string> = {
    '\u0430': 'a', '\u0435': 'e', '\u043E': 'o', '\u0440': 'r', '\u0441': 'c',
    '\u0445': 'x', '\u0456': 'i', '\u0443': 'y',
    '\u03B1': 'a', '\u03B5': 'e', '\u03BF': 'o', '\u03C1': 'r', '\u03C3': 's',
    '\u03BA': 'k', '\u03BD': 'n', '\u03C5': 'u', '\u03C7': 'x',
  };
  return clean.replace(/[^\u0000-\u007E]/g, (ch) => homoglyphs[ch] ?? ch);
}

// ─── Core: sanitizeUserInput ──────────────────────────────────────────────────

export interface SanitizeResult {
  sanitized: string;
  wasModified: boolean;
  detectedTypes: InjectionType[];
  detectedPatterns: string[];
}

/**
 * Sanitize user input before passing to any Claude API call.
 *
 * Strategy: strip injection payloads but PRESERVE the user's legitimate query.
 * This means we excise the injection fragment, not the entire message.
 *
 * @param text - raw user input
 * @returns SanitizeResult with the cleaned text and detection metadata
 */
export function sanitizeUserInput(text: string): SanitizeResult {
  if (!text || typeof text !== 'string') {
    return { sanitized: '', wasModified: false, detectedTypes: [], detectedPatterns: [] };
  }

  let working = text;
  const detectedTypes: InjectionType[] = [];
  const detectedPatterns: string[] = [];

  // 1. Unicode obfuscation — normalise first so downstream patterns work
  if (detectUnicodeObfuscation(working)) {
    const stripped = stripUnicodeObfuscation(working);
    if (stripped !== working) {
      detectedTypes.push('UNICODE_OBFUSCATION');
      detectedPatterns.push('unicode_homoglyphs_or_zero_width');
      working = stripped;
    }
  }

  // 2. Base64 encoded instructions
  const b64 = detectBase64Injection(working);
  if (b64.detected) {
    detectedTypes.push('BASE64_ENCODED');
    detectedPatterns.push('base64_encoded_instruction');
    working = stripBase64Injections(working);
  }

  // 3. Run all regex patterns — strip matched fragments
  for (const pattern of INJECTION_PATTERNS) {
    const before = working;
    working = working.replace(pattern.regex, (match) => {
      // Strip the injection fragment — keep surrounding legitimate text
      if (!detectedTypes.includes(pattern.type)) {
        detectedTypes.push(pattern.type);
      }
      detectedPatterns.push(pattern.name);
      return pattern.stripFn ? pattern.stripFn(match) : '';
    });
    // Reset regex lastIndex (safety for global regexes)
    pattern.regex.lastIndex = 0;
    if (working !== before) {
      // Pattern fired — already recorded above
    }
  }

  // 4. Clean up artefacts from stripping (double spaces, leading/trailing whitespace)
  working = working.replace(/\s{2,}/g, ' ').trim();

  const wasModified = working !== text;

  return {
    sanitized: working,
    wasModified,
    detectedTypes: [...new Set(detectedTypes)],
    detectedPatterns: [...new Set(detectedPatterns)],
  };
}

// ─── Logging ──────────────────────────────────────────────────────────────────

/**
 * Log a detected injection attempt to the persistent audit trail.
 * Called automatically by sanitizeUserInput when wasModified is true.
 */
export function logInjectionAttempt(
  type: InjectionType,
  rawInput: string,
  sanitizedInput: string,
  patternMatched: string = type,
): InjectionAttempt {
  const entry: InjectionAttempt = {
    id: uid(),
    timestamp: new Date().toISOString(),
    type,
    rawInput: rawInput.slice(0, 1000),       // cap stored length
    sanitizedInput: sanitizedInput.slice(0, 1000),
    patternMatched,
  };

  const log = readLog<InjectionAttempt>(INJECTION_LOG_KEY);
  log.push(entry);
  writeLog(INJECTION_LOG_KEY, log);

  // Console warn in dev; silent in production
  if (typeof window !== 'undefined' && (window as Window & { __POWERON_DEV__?: boolean }).__POWERON_DEV__) {
    console.warn(`[AIModelDefense] Injection attempt logged: type=${type} pattern=${patternMatched}`);
  }

  return entry;
}

/**
 * Sanitize input AND automatically log any detected attempts.
 * This is the primary public entry point for pre-call sanitization.
 */
export function sanitizeAndLog(text: string): string {
  const result = sanitizeUserInput(text);

  if (result.wasModified) {
    // Log one entry per detected type
    const uniqueTypes = [...new Set(result.detectedTypes)];
    uniqueTypes.forEach((type, i) => {
      logInjectionAttempt(
        type,
        text,
        result.sanitized,
        result.detectedPatterns[i] ?? type,
      );
    });
  }

  return result.sanitized;
}

// ─── Output Validation ────────────────────────────────────────────────────────

export interface ValidateOutputResult {
  output: string;
  wasRedacted: boolean;
  leakageTypes: OutputLeakage['type'][];
}

/**
 * Validate and redact Claude response output before returning to the UI.
 * Detects: system prompt fragments, file paths, API keys, Supabase URLs,
 * environment variable names, internal agent architecture details.
 */
export function validateOutput(rawOutput: string): ValidateOutputResult {
  if (!rawOutput || typeof rawOutput !== 'string') {
    return { output: '', wasRedacted: false, leakageTypes: [] };
  }

  let working = rawOutput;
  const leakageTypes: OutputLeakage['type'][] = [];

  for (const pattern of LEAKAGE_PATTERNS) {
    const before = working;
    working = working.replace(pattern.regex, (match) => {
      if (!leakageTypes.includes(pattern.type)) {
        leakageTypes.push(pattern.type);
      }
      // Log leakage event
      const entry: OutputLeakage = {
        id: uid(),
        timestamp: new Date().toISOString(),
        type: pattern.type,
        rawOutput: rawOutput.slice(0, 500),
        redactedOutput: working.slice(0, 500),
        fragmentFound: match.slice(0, 200),
      };
      const log = readLog<OutputLeakage>(LEAKAGE_LOG_KEY);
      log.push(entry);
      writeLog(LEAKAGE_LOG_KEY, log);
      return pattern.redact;
    });
    pattern.regex.lastIndex = 0;
    if (working !== before) {
      // Pattern fired — already recorded above
    }
  }

  return {
    output: working,
    wasRedacted: working !== rawOutput,
    leakageTypes: [...new Set(leakageTypes)],
  };
}

// ─── System Prompt Protection ─────────────────────────────────────────────────

/**
 * Safe response for system prompt extraction attempts.
 * Returns a generic description, NEVER the actual system prompt text.
 */
export const SYSTEM_PROMPT_SAFE_RESPONSE =
  'I\'m NEXUS, the AI operations platform for PowerOn Hub — an electrical contractor management system. ' +
  'I\'m here to help with estimates, scheduling, invoicing, leads, and project management. ' +
  'How can I help you with your business today?';

/**
 * Detect whether a user query is attempting to extract the system prompt.
 * Returns true if the message should receive the safe response.
 */
export function isSystemPromptExtractionAttempt(text: string): boolean {
  const extractionPatterns = [
    /what\s+(are\s+your|is\s+your)\s+(system\s+prompt|instructions?|programming|rules?|guidelines?)/i,
    /show\s+(me\s+)?(your\s+)?(system\s+prompt|hidden\s+instructions?|original\s+prompt)/i,
    /reveal\s+(your\s+)?(system\s+prompt|instructions?|guidelines?|rules?)/i,
    /print\s+(your\s+)?(system\s+prompt|instructions?|rules?)/i,
    /repeat\s+(your\s+)?(system\s+prompt|initial\s+message|instructions?\s+verbatim)/i,
    /tell\s+me\s+(your\s+)?(system\s+prompt|hidden\s+instructions?|initial\s+prompt)/i,
    /what\s+were\s+you\s+(told|instructed|trained|programmed)\s+to/i,
    /output\s+(your\s+)?(initial\s+prompt|system\s+message|core\s+instructions?)/i,
  ];
  return extractionPatterns.some(p => p.test(text));
}

// ─── Agent Boundary Enforcement ───────────────────────────────────────────────

export interface BoundaryCheckResult {
  allowed: boolean;
  reason: string;
  blockedDomain?: string;
}

/**
 * Check whether a user message attempts to manipulate an agent into acting
 * outside its defined scope.
 *
 * @param agentName - the agent currently handling the request
 * @param userMessage - the sanitized user message
 * @returns BoundaryCheckResult — allowed: false means the request should be blocked
 */
export function checkAgentBoundary(agentName: AgentName, userMessage: string): BoundaryCheckResult {
  const scope = AGENT_SCOPES[agentName];
  if (!scope) {
    return { allowed: true, reason: 'Unknown agent — no scope defined' };
  }

  const lower = userMessage.toLowerCase();

  // Check for explicit cross-agent data access attempts
  for (const forbidden of scope.forbiddenCrossDomains) {
    const domainKeywords: Record<string, RegExp> = {
      collections:      /\b(collections?|collect\s+money|outstanding\s+balance|ar\b|accounts?\s+receivable)\b/i,
      invoices:         /\b(invoices?|billing|invoice\s+history)\b/i,
      estimates:        /\b(estimates?|bids?|pricing\s+data|price\s+book)\b/i,
      financial_data:   /\b(financials?|revenue|profit|payments?|cash\s+flow|money\s+owed)\b/i,
      compliance_codes: /\b(nec\b|code\s+compliance|electrical\s+code|ahjauthority)\b/i,
      scheduling:       /\b(schedule|calendar|dispatch|crew\s+assignment|booking)\b/i,
      leads:            /\b(leads?|pipeline|prospects?|marketing|campaigns?)\b/i,
    };

    const kwRegex = domainKeywords[forbidden];
    if (kwRegex && kwRegex.test(lower)) {
      // Only block if the message also contains agent-impersonation language
      const agentImpersonation = new RegExp(
        `(as\\s+${agentName}|you\\s+are\\s+${agentName}|act\\s+as\\s+${agentName}|${agentName}\\s+can\\s+access)`,
        'i',
      );
      if (agentImpersonation.test(lower)) {
        return {
          allowed: false,
          reason: `${agentName} is not permitted to access ${forbidden} domain data.`,
          blockedDomain: forbidden,
        };
      }
    }
  }

  // HUNTER-specific: block attempts to modify scoring weights via conversation
  if (agentName === 'HUNTER') {
    const scoringTamper = /\b(modify|change|adjust|override|set|update)\s+(scoring|weights?|algorithm|lead\s+score|scoring\s+weight)\b/i;
    if (scoringTamper.test(lower)) {
      return {
        allowed: false,
        reason: 'HUNTER scoring weights cannot be modified through conversation. Use the admin settings panel.',
        blockedDomain: 'scoring_weights',
      };
    }
  }

  // NEXUS-specific: block attempts to bypass routing
  if (agentName === 'NEXUS') {
    const routingBypass = /\b(bypass|skip|ignore|override)\s+(nexus|routing|classification|agent\s+selection)\b/i;
    if (routingBypass.test(lower)) {
      return {
        allowed: false,
        reason: 'NEXUS routing cannot be bypassed through user messages.',
        blockedDomain: 'nexus_routing',
      };
    }
  }

  return { allowed: true, reason: 'Within agent scope' };
}

/**
 * Get the defined scope for an agent.
 */
export function getAgentScope(agentName: AgentName): AgentScope | undefined {
  return AGENT_SCOPES[agentName];
}

// ─── Injection Statistics ─────────────────────────────────────────────────────

/**
 * Return aggregated injection attempt statistics from the audit log.
 */
export function getInjectionStats(): InjectionStats {
  const log = readLog<InjectionAttempt>(INJECTION_LOG_KEY);

  const byType: Record<InjectionType, number> = {
    INSTRUCTION_OVERRIDE: 0,
    SYSTEM_PROMPT_EXTRACTION: 0,
    ROLE_PLAY_ESCAPE: 0,
    NESTED_INJECTION: 0,
    BASE64_ENCODED: 0,
    UNICODE_OBFUSCATION: 0,
    MARKDOWN_INJECTION: 0,
    CROSS_AGENT_MANIPULATION: 0,
    OUTPUT_LEAKAGE: 0,
  };

  const patternFrequency: Record<string, number> = {};
  const oneHourAgo = Date.now() - 3_600_000;
  let hourlyCount = 0;

  for (const entry of log) {
    byType[entry.type] = (byType[entry.type] ?? 0) + 1;
    patternFrequency[entry.patternMatched] = (patternFrequency[entry.patternMatched] ?? 0) + 1;
    if (new Date(entry.timestamp).getTime() > oneHourAgo) {
      hourlyCount++;
    }
  }

  return {
    total: log.length,
    byType,
    recentWindow: log.slice(-50),
    hourlyRate: hourlyCount,
    patternFrequency,
  };
}

/**
 * Alert callback — invoked when injection attempt frequency exceeds threshold.
 * Attach your notification logic here (toast, Supabase event, etc.).
 */
export function alertOnPattern(
  threshold: number,
  onAlert: (stats: InjectionStats) => void,
): void {
  const stats = getInjectionStats();
  if (stats.hourlyRate >= threshold) {
    onAlert(stats);
  }
}

/**
 * Clear the audit log (admin only — use with caution).
 */
export function clearInjectionLog(): void {
  try {
    localStorage.removeItem(INJECTION_LOG_KEY);
    localStorage.removeItem(LEAKAGE_LOG_KEY);
  } catch { /* ignore */ }
}

// ─── Convenience Wrapper ──────────────────────────────────────────────────────

/**
 * Full defense pipeline: sanitize input → (optionally) check agent boundary →
 * run Claude call → validate output.
 *
 * Usage:
 *   const result = await withDefense(
 *     rawUserText,
 *     'VAULT',
 *     async (clean) => callClaude({ messages: [{ role: 'user', content: clean }] }),
 *   );
 */
export async function withDefense<T extends string>(
  rawInput: string,
  agentName: AgentName,
  claudeCall: (sanitizedInput: string) => Promise<T>,
): Promise<{ output: string; blocked: boolean; blockReason?: string }> {
  // 1. Check for system prompt extraction
  if (isSystemPromptExtractionAttempt(rawInput)) {
    logInjectionAttempt('SYSTEM_PROMPT_EXTRACTION', rawInput, SYSTEM_PROMPT_SAFE_RESPONSE, 'extraction_attempt');
    return { output: SYSTEM_PROMPT_SAFE_RESPONSE, blocked: false };
  }

  // 2. Sanitize input
  const sanitized = sanitizeAndLog(rawInput);

  // 3. Check agent boundary
  const boundary = checkAgentBoundary(agentName, sanitized);
  if (!boundary.allowed) {
    return {
      output: `I'm not able to help with that request in this context. ${boundary.reason}`,
      blocked: true,
      blockReason: boundary.reason,
    };
  }

  // 4. Call Claude with sanitized input
  const raw = await claudeCall(sanitized);

  // 5. Validate output
  const { output } = validateOutput(raw);

  return { output, blocked: false };
}
