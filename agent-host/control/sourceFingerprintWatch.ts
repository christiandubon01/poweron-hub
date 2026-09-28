/**
 * CT-REL-2 Part A (goal 2): periodic Agent Host source-fingerprint recheck.
 *
 * The Host rechecks the fingerprint of its own source on disk every
 * SOURCE_FINGERPRINT_RECHECK_MS (30s). A difference vs the startup fingerprint
 * means THIS process is running older code: the caller publishes
 * restartRequired + detection time through presence and refuses new
 * create_plan / approve_plan requests. Detection is sticky (the process cannot
 * un-load old code; only a restart clears it). Nothing here restarts or kills
 * the Host. A recheck that throws is reported and retried on the next tick —
 * it must never crash the worker.
 */

import { computeAgentHostSourceFingerprint } from '../hostSourceFingerprint.ts';

export const SOURCE_FINGERPRINT_RECHECK_MS = 30_000;

export interface SourceFingerprintDrift {
  detectedAt: string;
  currentFingerprint: string;
}

export interface SourceFingerprintWatch {
  stop(): void;
}

export function startSourceFingerprintWatch(options: {
  repoRoot: string;
  initialFingerprint: string;
  intervalMs?: number | undefined;
  compute?: ((repoRoot: string) => string) | undefined;
  now?: (() => Date) | undefined;
  onDrift: (drift: SourceFingerprintDrift) => void;
  onError?: ((error: unknown) => void) | undefined;
}): SourceFingerprintWatch {
  const compute = options.compute ?? computeAgentHostSourceFingerprint;
  const now = options.now ?? ((): Date => new Date());
  let stopped = false;
  let fired = false;

  const check = (): void => {
    if (stopped || fired) return;
    let current: string;
    try {
      current = compute(options.repoRoot);
    } catch (error) {
      options.onError?.(error);
      return;
    }
    if (current !== options.initialFingerprint) {
      fired = true;
      options.onDrift({ detectedAt: now().toISOString(), currentFingerprint: current });
    }
  };

  const timer = setInterval(check, options.intervalMs ?? SOURCE_FINGERPRINT_RECHECK_MS);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  return {
    stop(): void {
      stopped = true;
      clearInterval(timer);
    },
  };
}