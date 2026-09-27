/**
 * Provider execution liveness.
 *
 * A fixed wall-clock budget is not evidence that a provider is dead. Claude,
 * Codex, and Ollama share ProcessRunner. Parsed events and isolated-workspace
 * file writes are liveness signals. Host heartbeats do not refresh the timer.
 *
 * The historical 10-minute task budget remains on task specs for compatibility.
 * It is not the kill clock.
 */

import type { ProcessTerminationReason, ProviderErrorCode } from './types.ts';

/** Previous fixed wall-clock kill. Active providers were stopped at this mark. */
export const LEGACY_FIXED_EXECUTION_LIMIT_MS = 10 * 60_000;

/**
 * No parsed event or workspace write for this long means the provider is unresponsive.
 */
export const PROVIDER_INACTIVITY_TIMEOUT_MS = 8 * 60_000;

/**
 * No parsed event or workspace write since spawn.
 */
export const PROVIDER_STARTUP_INACTIVITY_TIMEOUT_MS = 120_000;

/**
 * Absolute safety ceiling. An active provider may pass the legacy 10-minute
 * mark and must still stop here.
 */
export const PROVIDER_ABSOLUTE_SAFETY_CEILING_MS = 45 * 60_000;

export interface ProviderExecutionLimits {
  startupTimeoutMs: number;
  idleTimeoutMs: number;
  overallTimeoutMs: number;
}

const DEFAULT_LIMITS: ProviderExecutionLimits = {
  startupTimeoutMs: PROVIDER_STARTUP_INACTIVITY_TIMEOUT_MS,
  idleTimeoutMs: PROVIDER_INACTIVITY_TIMEOUT_MS,
  overallTimeoutMs: PROVIDER_ABSOLUTE_SAFETY_CEILING_MS,
};

let effectiveLimits: ProviderExecutionLimits = { ...DEFAULT_LIMITS };

/** Parse Host env once at startup; bad values are reported and replaced individually. */
export function configureProviderExecutionLimits(env: NodeJS.ProcessEnv, warn: (message: string) => void): ProviderExecutionLimits {
  const read = (name: string, fallback: number): number => {
    const raw = env[name];
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!/^\d+$/u.test(raw) || !Number.isSafeInteger(value) || value < 1_000 || value > 7_200_000) {
      warn(`Invalid ${name}; using default ${fallback}ms.`);
      return fallback;
    }
    return value;
  };
  effectiveLimits = {
    startupTimeoutMs: read('AGENT_HOST_PROVIDER_STARTUP_TIMEOUT_MS', DEFAULT_LIMITS.startupTimeoutMs),
    idleTimeoutMs: read('AGENT_HOST_PROVIDER_INACTIVITY_TIMEOUT_MS', DEFAULT_LIMITS.idleTimeoutMs),
    overallTimeoutMs: read('AGENT_HOST_PROVIDER_CEILING_MS', DEFAULT_LIMITS.overallTimeoutMs),
  };
  return { ...effectiveLimits };
}

export function isProviderTimeoutErrorCode(code: string | undefined): boolean {
  return code === 'EXECUTION_TIMEOUT'
    || code === 'PROVIDER_INACTIVITY_TIMEOUT'
    || code === 'PROVIDER_ABSOLUTE_TIMEOUT';
}

/** Timeouts passed to ProcessRunner for every Claude, Codex, and Ollama execution. */
export function providerExecutionTimeouts(): ProviderExecutionLimits {
  return { ...effectiveLimits };
}

/** Owner-facing duration. No percentages and no ETA. */
export function formatOwnerDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

export function inactivityFailureMessage(silentMs: number): string {
  return `Provider became unresponsive after ${formatOwnerDuration(silentMs)} without activity.`;
}

export function absoluteTimeoutMessage(): string {
  return 'Provider reached the absolute execution safety limit.';
}

export function processFailedMessage(): string {
  return 'Provider process failed before a terminal result arrived.';
}

export function classifyProcessTermination(processResult: {
  terminationReason: ProcessTerminationReason;
  exitCode: number | null;
}): { errorCode: ProviderErrorCode; errorMessage: string } | null {
  switch (processResult.terminationReason) {
    case 'timeout-idle':
      return {
        errorCode: 'PROVIDER_INACTIVITY_TIMEOUT',
        errorMessage: inactivityFailureMessage(effectiveLimits.idleTimeoutMs),
      };
    case 'timeout-startup':
      return {
        errorCode: 'PROVIDER_INACTIVITY_TIMEOUT',
        errorMessage: inactivityFailureMessage(effectiveLimits.startupTimeoutMs),
      };
    case 'timeout-overall':
      return {
        errorCode: 'PROVIDER_ABSOLUTE_TIMEOUT',
        errorMessage: absoluteTimeoutMessage(),
      };
    case 'exited':
      if (typeof processResult.exitCode === 'number' && processResult.exitCode !== 0) {
        return {
          errorCode: 'PROVIDER_PROCESS_FAILED',
          errorMessage: processFailedMessage(),
        };
      }
      return null;
    default:
      return null;
  }
}
