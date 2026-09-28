/**
 * CT-REL-2 Part B (goal 8): process-level guards.
 *
 *   - unhandledRejection: log (rate-limited through the Host log) and keep
 *     running. A rejected background promise must never take the Host down.
 *   - uncaughtException: log, then shut down. The process must exit NON-ZERO
 *     even when the graceful shutdown itself succeeds, so shutdown is invoked
 *     with a forced exit code of 1.
 *
 * Amendment 4: only sanitized summaries are logged — never environment values,
 * tokens, keys, prompts, plan text, or provider output.
 */

import type { HostLog } from '../lib/hostLog.ts';

const PROCESS_GUARD_MESSAGE_LIMIT = 256;

export function safeErrorSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > PROCESS_GUARD_MESSAGE_LIMIT
    ? `${message.slice(0, PROCESS_GUARD_MESSAGE_LIMIT)}…`
    : message;
}

/** unhandledRejection: log and continue running. */
export function handleUnhandledRejection(log: HostLog, reason: unknown): void {
  log.error(`unhandledRejection: ${safeErrorSummary(reason)}`);
}

/**
 * uncaughtException: log, then shut down with a FORCED non-zero exit code.
 * Returns the shutdown promise so the caller can await it.
 */
export async function handleUncaughtException(options: {
  log: HostLog;
  error: unknown;
  shutdown: (signal: string, forcedExitCode: number) => Promise<void> | void;
}): Promise<void> {
  options.log.error(`uncaughtException: ${safeErrorSummary(options.error)} — shutting down`);
  await options.shutdown('uncaughtException', 1);
}