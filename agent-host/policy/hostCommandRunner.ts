/**
 * ATB-4B: the ONLY Host-owned command execution seam.
 *
 * This is NOT ProcessRunner and is NOT the provider CLI launch path. Claude /
 * Codex / Ollama internal tool/shell commands are OPAQUE to Agent Host and
 * must never be faked through this module.
 *
 * Host-controlled argv that an orchestrator might launch (validation, inspect,
 * or a later explicit Host action) go through {@link executeHostCommand} once:
 * classify → allow/deny/gate → injected runner or isolated real process.
 */

import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { buildCmdWrapperCommandLine, defaultKillProcessTree } from '../providers/processRunner.ts';
import { providerExecutionTimeouts } from '../providers/executionLimits.ts';
import { classifyHostCommand, parseValidationCommand } from './commandPolicy.ts';
import type { HostCommandClassification, PolicyDecision } from './types.ts';

export type HostCommandSignalCategory =
  | 'dependency-mutation'
  | 'db-mutation'
  | 'unknown-command'
  | 'policy-gate'
  | 'human-gate';

export interface HostCommandExecution {
  /** Existing fake seam. Real execution requires an isolated cwd. */
  run?: ((argv: readonly string[], env?: NodeJS.ProcessEnv) => Promise<unknown> | unknown) | undefined;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  timeoutSettlementMs?: number;
  killTree?: (pid: number) => Promise<{ killed: boolean }>;
  spawnFn?: typeof spawn;
}

export interface HostCommandResult {
  status: 'executed' | 'denied' | 'gated' | 'failed-closed';
  classification: HostCommandClassification | null;
  decision: PolicyDecision | null;
  launches: number;
  signalCategory: HostCommandSignalCategory | null;
  ownerActionRequired: boolean;
  command?: string;
  exitCode?: number | null;
  timedOut?: boolean;
  timedOutPossibleSurvivors?: boolean;
  durationMs?: number;
  boundedOutput?: string;
}

export const HOST_CHECK_TIMEOUT_MS = 300_000;
export const HOST_CHECK_TOTAL_BUDGET_MS = 900_000;
const OUTPUT_HEAD_BYTES = 8192;
const OUTPUT_TAIL_BYTES = 8192;

/** The check process receives only explicit OS plumbing, never provider credentials. */
export function buildHostCheckEnvironment(source: NodeJS.ProcessEnv = process.env, copyRoot?: string, npmCommand = true, canonicalRepoPath?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['SystemRoot', 'TEMP', 'TMP']) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  const systemRoot = source.SystemRoot ?? 'C:\\Windows';
  if (process.platform === 'win32') {
    const canonicalReal = canonicalRepoPath ? realpathSync(canonicalRepoPath).toLowerCase() : null;
    const gitDirs = (source.Path ?? source.PATH ?? '').split(';').filter((dir) => {
      if (!dir || !existsSync(path.join(dir, 'git.exe'))) return false;
      try {
        const resolved = realpathSync(dir).toLowerCase();
        return !canonicalReal || (resolved !== canonicalReal && !resolved.startsWith(`${canonicalReal}${path.sep}`));
      } catch { return false; }
    });
    env.Path = [...new Set([path.dirname(process.execPath), path.join(systemRoot, 'System32'), systemRoot, ...gitDirs])].join(';');
  }
  else env.PATH = [path.dirname(process.execPath), '/usr/bin', '/bin'].join(':');
  if (copyRoot) {
    env.TMP = path.join(copyRoot, '.host-check-tmp');
    env.TEMP = env.TMP;
    env.HOST_CHECK_CACHE_DIR = path.join(copyRoot, '.host-check-cache');
    if (npmCommand) {
      env.npm_config_cache = path.join(copyRoot, '.host-check-cache', 'npm');
      env.npm_config_userconfig = path.join(copyRoot, '.host-check-cache', 'user.npmrc');
      env.npm_config_globalconfig = path.join(copyRoot, '.host-check-cache', 'global.npmrc');
    }
    env.TSBUILDINFO = path.join(copyRoot, '.host-check-cache', 'tsbuildinfo');
  }
  return env;
}

async function runIsolated(argv: readonly string[], execution: HostCommandExecution): Promise<{ exitCode: number | null; timedOut: boolean; timedOutPossibleSurvivors: boolean; durationMs: number; boundedOutput: string }> {
  if (process.env.NODE_TEST_CONTEXT !== undefined && !execution.spawnFn) throw new Error('Real Host check processes are forbidden in tests.');
  if (!execution.cwd || !path.isAbsolute(execution.cwd) || !execution.env) throw new Error('Host checks require an isolated absolute cwd and explicit environment.');
  if (!parseValidationCommand(argv.join(' '))) throw new Error('Unsupported Host validation command.');
  const started = performance.now();
  const command = argv[0] ?? '';
  const args = argv.slice(1);
  const cmdWrapper = /\.cmd$/iu.test(command);
  const executable = cmdWrapper ? path.join(execution.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe') : command;
  const spawnArgs = cmdWrapper ? ['/d', '/s', '/c', buildCmdWrapperCommandLine({ kind: 'cmd-wrapper', executable: command, argv: args })] : args;
  let head = Buffer.alloc(0);
  let tail = Buffer.alloc(0);
  let outputBytes = 0;
  let timedOut = false;
  let killConfirmed = false;
  let childClosed = false;
  const maxMs = Math.min(Math.max(1, execution.timeoutMs ?? HOST_CHECK_TIMEOUT_MS), HOST_CHECK_TIMEOUT_MS, providerExecutionTimeouts().overallTimeoutMs);
  return await new Promise((resolve, reject) => {
    const child = (execution.spawnFn ?? spawn)(executable, spawnArgs, { cwd: execution.cwd, env: execution.env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const collect = (chunk: Buffer): void => {
      const bytes = Buffer.from(chunk);
      outputBytes += bytes.length;
      if (head.length < OUTPUT_HEAD_BYTES) head = Buffer.concat([head, bytes.subarray(0, OUTPUT_HEAD_BYTES - head.length)]);
      tail = Buffer.concat([tail, bytes]).subarray(Math.max(0, tail.length + bytes.length - OUTPUT_TAIL_BYTES));
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    let postKillTimer: ReturnType<typeof setTimeout> | null = null;
    const outputText = (): string => outputBytes <= OUTPUT_HEAD_BYTES + OUTPUT_TAIL_BYTES
      ? (outputBytes <= OUTPUT_HEAD_BYTES ? head : Buffer.concat([head, tail.subarray(OUTPUT_HEAD_BYTES - outputBytes)])).toString('utf8')
      : `${head.toString('utf8')}\n[output truncated]\n${tail.toString('utf8')}`;
    const finishTimeout = (): void => {
      if (killConfirmed && childClosed) return;
      child.unref();
      resolve({ exitCode: null, timedOut: true, timedOutPossibleSurvivors: true, durationMs: Math.round(performance.now() - started), boundedOutput: outputText() });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      postKillTimer = setTimeout(finishTimeout, execution.timeoutSettlementMs ?? 10_000);
      if (child.pid) void (execution.killTree ?? defaultKillProcessTree)(child.pid).then((result) => {
        killConfirmed = result.killed === true;
        if (!killConfirmed) child.kill();
        if (childClosed && killConfirmed) {
          if (postKillTimer) clearTimeout(postKillTimer);
          resolve({ exitCode: null, timedOut: true, timedOutPossibleSurvivors: false, durationMs: Math.round(performance.now() - started), boundedOutput: outputText() });
        }
      }).catch(() => child.kill());
      else child.kill();
    }, maxMs);
    child.once('error', (error) => { clearTimeout(timer); if (postKillTimer) clearTimeout(postKillTimer); reject(error); });
    child.once('close', (code) => {
      childClosed = true;
      clearTimeout(timer);
      if (timedOut && !killConfirmed) return;
      if (postKillTimer) clearTimeout(postKillTimer);
      resolve({ exitCode: timedOut ? null : code, timedOut, timedOutPossibleSurvivors: false, durationMs: Math.round(performance.now() - started), boundedOutput: outputText() });
    });
  });
}

export async function executeHostCommand(
  argv: readonly string[],
  execution: HostCommandExecution = {},
): Promise<HostCommandResult> {
  let classified: ReturnType<typeof classifyHostCommand>;
  try {
    classified = classifyHostCommand(argv);
  } catch {
    return {
      status: 'failed-closed',
      classification: null,
      decision: null,
      launches: 0,
      signalCategory: 'policy-gate',
      ownerActionRequired: false,
    };
  }

  const signalCategory = hostCommandSignalCategory(classified.decision);
  const ownerActionRequired = classified.decision.decision === 'require-human';

  if (classified.decision.decision === 'deny') {
    return {
      status: 'denied',
      classification: classified.classification,
      decision: classified.decision,
      launches: 0,
      signalCategory,
      ownerActionRequired: false,
    };
  }

  if (classified.decision.decision === 'require-human') {
    return {
      status: 'gated',
      classification: classified.classification,
      decision: classified.decision,
      launches: 0,
      signalCategory,
      ownerActionRequired: true,
    };
  }

  if (classified.classification !== 'VALIDATION' || (typeof execution.run !== 'function' && !execution.cwd)) {
    return {
      status: 'failed-closed',
      classification: classified.classification,
      decision: classified.decision,
      launches: 0,
      signalCategory: 'policy-gate',
      ownerActionRequired: false,
    };
  }

  const started = performance.now();
  const outcome = typeof execution.run === 'function'
    ? await execution.run(argv, execution.env)
    : await runIsolated(argv, execution);
  const details = outcome && typeof outcome === 'object' ? outcome as Partial<HostCommandResult> : {};
  return {
    status: 'executed',
    classification: classified.classification,
    decision: classified.decision,
    launches: 1,
    signalCategory: null,
    ownerActionRequired: false,
    command: argv.join(' '),
    exitCode: typeof details.exitCode === 'number' || details.exitCode === null ? details.exitCode : 0,
    timedOut: details.timedOut === true,
    timedOutPossibleSurvivors: details.timedOutPossibleSurvivors === true,
    durationMs: typeof details.durationMs === 'number' ? details.durationMs : Math.round(performance.now() - started),
    boundedOutput: typeof details.boundedOutput === 'string' ? details.boundedOutput : '',
  };
}

export function hostCommandSignalCategory(decision: PolicyDecision): HostCommandSignalCategory {
  if (decision.reasonCode === 'dependency-mutation') {
    return 'dependency-mutation';
  }
  if (decision.reasonCode === 'db-mutation') {
    return 'db-mutation';
  }
  if (decision.reasonCode === 'unknown-command') {
    return 'unknown-command';
  }
  if (decision.decision === 'require-human') {
    return 'human-gate';
  }
  return 'policy-gate';
}
