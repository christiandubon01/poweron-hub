/**
 * ATB-2: One normalized, UI-facing effort model + honest per-provider mapping.
 *
 * The Control Tower exposes a single normalized EffortLevel. Whether a level is
 * valid, and what native provider value it maps to, is PROVIDER + capability
 * specific — never a silent global translation. A caller that requests an
 * unsupported level gets an explicit `supported: false` with a reason; nothing is
 * quietly downgraded (e.g. extra-high → high) unless a provider's mapping
 * explicitly defines it and reports the resulting native value.
 *
 * ATB-2B: capability truth re-proven against the LOCALLY INSTALLED CLIs
 * (2026-09-22):
 *   - Codex CLI 0.153.4 (`codex exec -c model_reasoning_effort=<value>`): the
 *     local model catalog (`codex debug models`) lists supported_reasoning_levels
 *     low | medium | high | xhigh | max | ultra per model — every visible model
 *     supports xhigh → normalized "extra-high" maps to native "xhigh".
 *   - Claude Code 2.1.277 (`claude --effort <level>`): the CLI locally validates
 *     and reports valid values "low, medium, high, xhigh, max" → effort IS
 *     controllable; normalized "extra-high" maps to native "xhigh".
 *   - Ollama 0.34.0 runs through the Claude-compatible harness and exposes no
 *     genuine effort control for local models → still NOT controllable.
 *   - cursor-* has no execution adapter → not applicable.
 */

import type { ProviderId } from './types.ts';

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'extra-high'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export function isEffortLevel(value: unknown): value is EffortLevel {
  return typeof value === 'string' && (EFFORT_LEVELS as readonly string[]).includes(value);
}

/**
 * The valid normalized levels each provider genuinely supports, and the native
 * value each maps to. A provider absent here (or with an empty map) supports no
 * effort control — the registry then reports `effortLevels: []` for its models.
 */
const PROVIDER_EFFORT_NATIVE: Partial<Record<ProviderId, Partial<Record<EffortLevel, string>>>> = {
  // Claude Code 2.1.277: `--effort <level>`, CLI-validated native values
  // low | medium | high | xhigh | max. The normalized set maps onto the first
  // four; "extra-high" → native "xhigh".
  claude: { low: 'low', medium: 'medium', high: 'high', 'extra-high': 'xhigh' },
  // Codex CLI 0.153.4: `-c model_reasoning_effort=<native>`. The local catalog
  // (`codex debug models`) shows xhigh supported on every visible model →
  // "extra-high" → native "xhigh".
  codex: { low: 'low', medium: 'medium', high: 'high', 'extra-high': 'xhigh' },
  // ollama: no genuine effort control for local models → intentionally omitted.
};

export interface EffortMappingSupported {
  supported: true;
  provider: ProviderId;
  normalized: EffortLevel;
  nativeValue: string;
}

export interface EffortMappingUnsupported {
  supported: false;
  provider: ProviderId;
  normalized: EffortLevel;
  reason: string;
}

export type EffortMapping = EffortMappingSupported | EffortMappingUnsupported;

/** Normalized levels a provider supports at all (order preserved from EFFORT_LEVELS). */
export function supportedEffortLevels(provider: ProviderId): EffortLevel[] {
  const native = PROVIDER_EFFORT_NATIVE[provider];
  if (!native) {
    return [];
  }
  return EFFORT_LEVELS.filter((level) => typeof native[level] === 'string');
}

/**
 * Map a normalized effort to its provider-native value. Never silently
 * substitutes: an unsupported level returns `supported: false` with a reason.
 */
export function mapNormalizedEffort(provider: ProviderId, effort: EffortLevel): EffortMapping {
  const native = PROVIDER_EFFORT_NATIVE[provider]?.[effort];
  if (typeof native === 'string') {
    return { supported: true, provider, normalized: effort, nativeValue: native };
  }
  const levels = supportedEffortLevels(provider);
  const reason = levels.length === 0
    ? `Provider ${provider} does not support reasoning-effort control.`
    : `Provider ${provider} does not support effort "${effort}" (supported: ${levels.join(', ')}).`;
  return { supported: false, provider, normalized: effort, reason };
}
