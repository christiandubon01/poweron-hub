/**
 * Host-side Claude subscription parity probe.
 *
 * Launches the local Claude Code CLI with the same child environment the
 * Agent Host uses for Claude. The prompt is the tiny headless check. This
 * module never calls the Anthropic API and never records hidden reasoning.
 */
import path from 'node:path';

import { ProcessRunner, type LaunchDescriptor, type SpawnFn } from './processRunner.ts';

export const CLAUDE_SUBSCRIPTION_PROBE_PROMPT = 'Reply with exactly: CLAUDE_SUBSCRIPTION_OK';
export const CLAUDE_SUBSCRIPTION_PROBE_MARKER = 'CLAUDE_SUBSCRIPTION_OK';

export function claudeSubscriptionProbeLaunch(executable: string): LaunchDescriptor {
  const extension = path.extname(executable).toLowerCase();
  return {
    kind: extension === '.cmd' || extension === '.bat' ? 'cmd-wrapper' : 'native',
    executable,
    argv: ['-p'],
  };
}

export interface ClaudeSubscriptionProbeResult {
  matched: boolean;
  terminationReason: string;
  exitCode: number | null;
  /** Caller must not log this unless it equals the marker. */
  stdout: string;
}

export async function runClaudeSubscriptionProbe(options: {
  executable: string;
  workingDirectory: string;
  environmentSource: NodeJS.ProcessEnv;
  runner?: ProcessRunner;
  spawnFn?: SpawnFn;
  timeoutMs?: number;
}): Promise<ClaudeSubscriptionProbeResult> {
  const runner = options.runner ?? new ProcessRunner();
  const handle = runner.run({
    executionId: 'claude-subscription-probe',
    launch: claudeSubscriptionProbeLaunch(options.executable),
    workingDirectory: options.workingDirectory,
    allowedWorkingDirectory: options.workingDirectory,
    prompt: CLAUDE_SUBSCRIPTION_PROBE_PROMPT,
    environmentProfile: 'claude',
    environmentSource: options.environmentSource,
    spawnFn: options.spawnFn,
    timeouts: {
      overallTimeoutMs: options.timeoutMs ?? 120_000,
      startupTimeoutMs: 30_000,
      idleTimeoutMs: 90_000,
    },
  });
  const result = await handle.done;
  const stdout = result.stdoutTail.trim();
  return {
    matched: stdout === CLAUDE_SUBSCRIPTION_PROBE_MARKER,
    terminationReason: result.terminationReason,
    exitCode: result.exitCode,
    stdout,
  };
}
