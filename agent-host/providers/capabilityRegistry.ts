/**
 * ATB-2: Provider / Model Capability Registry.
 *
 * The truthful authority for the future MODELS panel and role routing. It keeps
 * four concerns strictly separate — AGENT IDENTITY (routing.ts) vs PROVIDER /
 * EXECUTION ENVIRONMENT vs MODEL vs EFFORT — and never fabricates a capability
 * from branding. Every field is grounded in what the adapters/discovery actually
 * support (proven in claude.ts / codex.ts / executor.ts / discovery.ts):
 *
 *   claude (Claude Code 2.1.277): worker-capable; model selection via `--model`
 *     (wired ATB-2B); effort via `--effort` (native low|medium|high|xhigh|max);
 *     reports runtime model + usage tokens from the protocol; NO CLI model
 *     enumeration mechanism exists (no models subcommand / list flag) → model
 *     choices come only from allowlist / execution evidence.
 *   codex (Codex CLI 0.153.4): worker-capable; model selection via `-m`; effort via
 *     `-c model_reasoning_effort` (native low|medium|high|xhigh — "xhigh" proven
 *     by the local catalog's supported_reasoning_levels); usage tokens from
 *     protocol; reportedModel NOT emitted by `codex exec --json` (verified against
 *     the 0.153.4 protocol: no event carries a model field) → stays null; model
 *     enumeration via `codex debug models` (machine-readable JSON catalog).
 *   ollama (Ollama CLI 0.34.0): worker-capable via the Claude harness (requires a
 *     model); local model enumeration via `ollama list`; no genuine effort
 *     control for local models; LOCAL → no quota/reset.
 *   cursor-agent: discovered only — NO execution adapter is registered, so it is
 *     never presented as an autonomous coding agent.
 *   cursor-editor: DIAGNOSTIC only.
 *
 * Pure and deterministic given its inputs (discovery records + optional injected
 * enumeration / allowlist / observed-model evidence). No network, no side effects.
 */

import type { ProviderDiscoveryRecord } from '../types.ts';
import { isWorkerAvailable } from '../types.ts';
import type { ProviderId } from './types.ts';
import { supportedEffortLevels, type EffortLevel } from './effort.ts';

/* -------------------------------------------------------------------------- */
/* Contract                                                                    */
/* -------------------------------------------------------------------------- */

export type ProviderKind = 'provider' | 'diagnostic';

export type ModelAvailability = 'available' | 'configured-unverified' | 'unavailable';
export type ModelAvailabilitySource =
  | 'provider-enumeration'
  | 'local-runtime'
  | 'configured-allowlist'
  | 'execution-evidence'
  | 'unavailable';

export interface ModelUsageCapabilities {
  executionTokens: boolean;
  quotaRemaining: boolean;
  quotaPercent: boolean;
  resetAt: boolean;
}

export interface ModelCapability {
  modelId: string;
  modelDisplayName: string;
  availability: ModelAvailability;
  availabilitySource: ModelAvailabilitySource;
  effortLevels: EffortLevel[];
  defaultEffort: EffortLevel | null;
  reportedRuntimeModel: string | null;
  configuredModel: string | null;
  contextWindow: number | null;
  usageCapabilities: ModelUsageCapabilities;
}

export type ProviderAvailabilitySource = 'runtime-probe' | 'configured' | 'unavailable';

export interface ProviderCapability {
  providerId: string;
  providerDisplayName: string;
  providerKind: ProviderKind;
  providerLogoKey: string;
  installed: boolean;
  available: boolean;
  availabilitySource: ProviderAvailabilitySource;
  cliVersion: string | null;
  workerCapable: boolean;
  supportedRoles: Array<'architect' | 'implementer' | 'verifier'>;
  /** True only when a real, LOCAL runtime with no provider quota (Ollama). */
  local: boolean;
  models: ModelCapability[];
  lastRefreshedAt: string;
}

const ALL_ROLES: ProviderCapability['supportedRoles'] = ['architect', 'implementer', 'verifier'];

/* -------------------------------------------------------------------------- */
/* Static provider facts (grounded in the adapters, NOT branding)              */
/* -------------------------------------------------------------------------- */

interface ProviderStaticFacts {
  providerId: ProviderId;
  logoKey: string;
  /** An execution adapter is registered for this provider (createProviderRegistry). */
  hasExecutionAdapter: boolean;
  /** The provider adapter sends an explicit model-selection flag. */
  modelSelectable: boolean;
  /** The adapter reports the runtime model from the provider protocol. */
  reportsRuntimeModel: boolean;
  /** The adapter parses execution token usage from the provider protocol. */
  reportsUsageTokens: boolean;
  /** LOCAL runtime with no provider quota (affects usage/reset truth). */
  local: boolean;
}

/** Keyed by discovery toolId. Anything not listed is treated as unknown/generic. */
const PROVIDER_FACTS_BY_TOOL_ID: Record<string, ProviderStaticFacts> = {
  // ATB-2B: the Claude adapter now passes `--model` when a requested model is
  // present (CLI-verified on Claude Code 2.1.277) → modelSelectable: true.
  'claude-code': { providerId: 'claude', logoKey: 'claude', hasExecutionAdapter: true, modelSelectable: true, reportsRuntimeModel: true, reportsUsageTokens: true, local: false },
  'codex-cli': { providerId: 'codex', logoKey: 'codex', hasExecutionAdapter: true, modelSelectable: true, reportsRuntimeModel: false, reportsUsageTokens: true, local: false },
  'ollama-cli': { providerId: 'ollama', logoKey: 'ollama', hasExecutionAdapter: true, modelSelectable: true, reportsRuntimeModel: true, reportsUsageTokens: true, local: true },
  'cursor-agent': { providerId: 'cursor-agent', logoKey: 'cursor', hasExecutionAdapter: false, modelSelectable: false, reportsRuntimeModel: false, reportsUsageTokens: false, local: false },
};

const CURSOR_EDITOR_TOOL_ID = 'cursor-editor';

/* -------------------------------------------------------------------------- */
/* Inputs                                                                      */
/* -------------------------------------------------------------------------- */

export interface CapabilityRegistryInputs {
  discovery: readonly ProviderDiscoveryRecord[];
  /** Model enumeration by providerId (Ollama via `ollama list`; Codex via `codex debug models`). */
  enumeratedModels?: Partial<Record<ProviderId, string[]>> | undefined;
  /** Explicit repo/user configuration allowlist by providerId. */
  configuredModels?: Partial<Record<ProviderId, string[]>> | undefined;
  /** Model ids observed from REAL execution evidence by providerId. */
  observedModels?: Partial<Record<ProviderId, string[]>> | undefined;
  now?: (() => Date) | undefined;
}

/* -------------------------------------------------------------------------- */
/* Ollama local model enumeration (`ollama list`) — injectable                 */
/* -------------------------------------------------------------------------- */

/**
 * Parse `ollama list` table output into model ids. Tolerant of the header row
 * and blank lines; never throws. Example line: "llama3:8b   <id>   4.7 GB ...".
 */
export function parseOllamaModelList(stdout: string): string[] {
  const models: string[] = [];
  for (const rawLine of stdout.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    const first = line.split(/\s+/u)[0];
    if (!first || first.toUpperCase() === 'NAME') {
      continue;
    }
    if (!models.includes(first)) {
      models.push(first);
    }
  }
  return models;
}

/* -------------------------------------------------------------------------- */
/* Codex model catalog (`codex debug models`) — injectable                     */
/* -------------------------------------------------------------------------- */

/** Bounded so a corrupt/huge catalog can never bloat the published fleet. */
export const MAX_CODEX_CATALOG_MODELS = 64;

/**
 * ATB-2B: parse the machine-readable model catalog emitted by
 * `codex debug models` (Codex CLI ≥ 0.153) into selectable model slugs.
 * Only `visibility: "list"` entries are returned — hidden catalog entries are
 * not user-selectable. Tolerant of malformed output: any parse failure or
 * non-array models yields []. Never throws.
 */
export function parseCodexModelCatalog(stdout: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return [];
  }
  const models = (parsed as Record<string, unknown>).models;
  if (!Array.isArray(models)) {
    return [];
  }

  const slugs: string[] = [];
  for (const entry of models) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const slug = typeof record.slug === 'string' ? record.slug.trim() : '';
    if (slug.length === 0 || record.visibility !== 'list') {
      continue;
    }
    if (!slugs.includes(slug)) {
      slugs.push(slug);
    }
    if (slugs.length >= MAX_CODEX_CATALOG_MODELS) {
      break;
    }
  }
  return slugs;
}

/* -------------------------------------------------------------------------- */
/* Builder                                                                     */
/* -------------------------------------------------------------------------- */

export function buildProviderCapabilityRegistry(inputs: CapabilityRegistryInputs): ProviderCapability[] {
  const now = (inputs.now ?? (() => new Date()))().toISOString();
  const out: ProviderCapability[] = [];

  for (const record of inputs.discovery) {
    if (record.toolId === CURSOR_EDITOR_TOOL_ID) {
      out.push(buildDiagnosticCapability(record, now));
      continue;
    }
    const facts = PROVIDER_FACTS_BY_TOOL_ID[record.toolId];
    if (!facts) {
      out.push(buildUnknownProviderCapability(record, now));
      continue;
    }
    out.push(buildProviderCapability(record, facts, inputs, now));
  }

  return out;
}

function buildProviderCapability(
  record: ProviderDiscoveryRecord,
  facts: ProviderStaticFacts,
  inputs: CapabilityRegistryInputs,
  now: string,
): ProviderCapability {
  // Worker-capable ONLY when discovery says so AND a real execution adapter
  // exists. cursor-agent may be "installed" yet has no adapter → not runnable.
  const workerCapable = isWorkerAvailable(record) && facts.hasExecutionAdapter;
  const available = record.installed && facts.hasExecutionAdapter;
  const effortLevels = supportedEffortLevels(facts.providerId);

  const models = buildModels(facts, inputs, effortLevels);

  return {
    providerId: facts.providerId,
    providerDisplayName: record.displayName,
    providerKind: 'provider',
    providerLogoKey: facts.logoKey,
    installed: record.installed,
    available,
    availabilitySource: record.installed ? 'runtime-probe' : 'unavailable',
    cliVersion: record.cliVersion ?? null,
    workerCapable,
    // A provider with no execution adapter is never offered for any role.
    supportedRoles: workerCapable ? [...ALL_ROLES] : [],
    local: facts.local,
    models,
    lastRefreshedAt: now,
  };
}

function buildModels(
  facts: ProviderStaticFacts,
  inputs: CapabilityRegistryInputs,
  effortLevels: EffortLevel[],
): ModelCapability[] {
  const usageCapabilities: ModelUsageCapabilities = {
    executionTokens: facts.reportsUsageTokens,
    // No provider CLI exposes quota/percent/reset today (local Ollama has none at
    // all). These stay false everywhere — never fabricated.
    quotaRemaining: false,
    quotaPercent: false,
    resetAt: false,
  };

  const make = (modelId: string, availability: ModelAvailability, source: ModelAvailabilitySource): ModelCapability => ({
    modelId,
    modelDisplayName: modelId,
    availability,
    availabilitySource: source,
    effortLevels: [...effortLevels],
    defaultEffort: null,
    reportedRuntimeModel: null,
    configuredModel: facts.modelSelectable ? modelId : null,
    contextWindow: null,
    usageCapabilities,
  });

  const seen = new Set<string>();
  const models: ModelCapability[] = [];
  const add = (modelId: string, availability: ModelAvailability, source: ModelAvailabilitySource): void => {
    if (!modelId || seen.has(modelId)) {
      return;
    }
    seen.add(modelId);
    models.push(make(modelId, availability, source));
  };

  // Source order (§4): real enumeration → configured allowlist → execution
  // evidence. Enumeration is authoritative "available" (Ollama `ollama list`
  // local-runtime; Codex `codex debug models` provider-enumeration).
  for (const modelId of inputs.enumeratedModels?.[facts.providerId] ?? []) {
    add(modelId, 'available', facts.local ? 'local-runtime' : 'provider-enumeration');
  }
  for (const modelId of inputs.configuredModels?.[facts.providerId] ?? []) {
    add(modelId, 'configured-unverified', 'configured-allowlist');
  }
  for (const modelId of inputs.observedModels?.[facts.providerId] ?? []) {
    // Observed from a real run: mark as available with execution evidence.
    const existing = models.find((m) => m.modelId === modelId);
    if (existing) {
      existing.reportedRuntimeModel = modelId;
    } else {
      const model = make(modelId, 'available', 'execution-evidence');
      model.reportedRuntimeModel = modelId;
      seen.add(modelId);
      models.push(model);
    }
  }

  return models;
}

function buildDiagnosticCapability(record: ProviderDiscoveryRecord, now: string): ProviderCapability {
  return {
    providerId: record.toolId,
    providerDisplayName: record.displayName,
    providerKind: 'diagnostic',
    providerLogoKey: 'cursor',
    installed: record.installed,
    available: false, // diagnostic tools are never an execution provider
    availabilitySource: record.installed ? 'runtime-probe' : 'unavailable',
    cliVersion: record.cliVersion ?? null,
    workerCapable: false,
    supportedRoles: [],
    local: false,
    models: [],
    lastRefreshedAt: now,
  };
}

function buildUnknownProviderCapability(record: ProviderDiscoveryRecord, now: string): ProviderCapability {
  return {
    providerId: record.toolId,
    providerDisplayName: record.displayName,
    providerKind: record.kind === 'diagnostic' ? 'diagnostic' : 'provider',
    providerLogoKey: 'generic',
    installed: record.installed,
    available: false,
    availabilitySource: record.installed ? 'runtime-probe' : 'unavailable',
    cliVersion: record.cliVersion ?? null,
    workerCapable: false,
    supportedRoles: [],
    local: false,
    models: [],
    lastRefreshedAt: now,
  };
}

/* -------------------------------------------------------------------------- */
/* Safe publishing (§16 redaction)                                             */
/* -------------------------------------------------------------------------- */

/**
 * The browser-safe provider fleet published through the presence `providers`
 * jsonb. Whitelist only — NEVER executable/filesystem paths, tokens, env, or raw
 * CLI output. The registry already excludes those, but this is the explicit,
 * asserted redaction boundary.
 */
export function toSafeProviderFleet(registry: readonly ProviderCapability[]): ProviderCapability[] {
  return registry.map((provider) => ({
    providerId: provider.providerId,
    providerDisplayName: provider.providerDisplayName,
    providerKind: provider.providerKind,
    providerLogoKey: provider.providerLogoKey,
    installed: provider.installed,
    available: provider.available,
    availabilitySource: provider.availabilitySource,
    cliVersion: provider.cliVersion,
    workerCapable: provider.workerCapable,
    supportedRoles: [...provider.supportedRoles],
    local: provider.local,
    models: provider.models.map((model) => ({
      modelId: model.modelId,
      modelDisplayName: model.modelDisplayName,
      availability: model.availability,
      availabilitySource: model.availabilitySource,
      effortLevels: [...model.effortLevels],
      defaultEffort: model.defaultEffort,
      reportedRuntimeModel: model.reportedRuntimeModel,
      configuredModel: model.configuredModel,
      contextWindow: model.contextWindow,
      usageCapabilities: { ...model.usageCapabilities },
    })),
    lastRefreshedAt: provider.lastRefreshedAt,
  }));
}

/* -------------------------------------------------------------------------- */
/* Usage aggregation (§14) — token totals only; quota/reset never fabricated    */
/* -------------------------------------------------------------------------- */

export interface UsageAggregateEntry {
  providerId: string;
  modelId: string | null;
  totalTokens: number;
  executionCount: number;
  source: 'protocol-message' | 'mixed' | 'none';
}

interface TerminalUsageEvent {
  provider?: unknown;
  requestedModel?: unknown;
  reportedModel?: unknown;
  usage?: unknown;
}

/**
 * Aggregate execution token totals per provider/model from terminal execution
 * event payloads (execution.completed/failed/timed_out/cancelled). Only real
 * token counts are summed; quota/percent/reset are never derived. Pure.
 */
export function aggregateUsage(events: readonly { type: string; payload: unknown }[]): UsageAggregateEntry[] {
  const byKey = new Map<string, UsageAggregateEntry>();
  const sources = new Map<string, Set<string>>();

  for (const event of events) {
    if (!event.type.startsWith('execution.')) {
      continue;
    }
    const payload = (event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
      ? event.payload
      : null) as TerminalUsageEvent | null;
    if (!payload) {
      continue;
    }
    const providerId = typeof payload.provider === 'string' ? payload.provider : null;
    if (!providerId) {
      continue;
    }
    const modelId = typeof payload.reportedModel === 'string'
      ? payload.reportedModel
      : typeof payload.requestedModel === 'string'
        ? payload.requestedModel
        : null;
    const usage = (payload.usage && typeof payload.usage === 'object' && !Array.isArray(payload.usage)
      ? payload.usage
      : null) as { totalTokens?: unknown; source?: unknown } | null;
    const totalTokens = usage && typeof usage.totalTokens === 'number' && Number.isFinite(usage.totalTokens) ? usage.totalTokens : 0;
    const source = usage && typeof usage.source === 'string' ? usage.source : 'none';

    const key = `${providerId}::${modelId ?? ''}`;
    const entry = byKey.get(key) ?? { providerId, modelId, totalTokens: 0, executionCount: 0, source: 'none' };
    entry.totalTokens += totalTokens;
    entry.executionCount += 1;
    byKey.set(key, entry);

    const set = sources.get(key) ?? new Set<string>();
    if (source === 'protocol-message') {
      set.add('protocol-message');
    }
    sources.set(key, set);
  }

  for (const [key, entry] of byKey) {
    const set = sources.get(key) ?? new Set<string>();
    entry.source = set.size === 0 ? 'none' : set.size === 1 ? 'protocol-message' : 'mixed';
  }

  return [...byKey.values()];
}
