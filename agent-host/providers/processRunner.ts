/**
 * ORCH-3B: Generic, provider-neutral process runner.
 *
 * This module is the execution plumbing future adapters use. It knows nothing
 * about Claude/Codex/Ollama protocols. It only:
 *   - launches a child process safely on Windows (native .exe or .cmd wrapper,
 *     NEVER shell:true, NEVER user text in argv),
 *   - confines the child to a caller-supplied canonical allowed repo directory,
 *   - transports the prompt via stdin (arbitrary Unicode / multiline / large),
 *   - streams stdout/stderr incrementally with bounded retained tails,
 *   - enforces startup/idle/overall timeouts + a cancel-grace period,
 *   - cancels idempotently and force-kills the process tree via taskkill /T /F,
 *   - guards an absolute processed-byte safety limit,
 *   - resolves exactly once and cleans up timers/listeners on every terminal path,
 *   - never serializes/returns/logs/persists the process environment.
 *
 * It returns {@link ProcessExecutionResult} (process facts only). A provider
 * adapter later combines that with protocol state to form an
 * {@link ExecutionResult}. The two are intentionally not conflated.
 */

import { spawn, execFile } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { realpathSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import type { ExecutionStreamCallbacks, ProcessExecutionResult, ProcessTerminationReason } from './types.ts';
import { buildProviderEnvironment, claudeOverlayRequestsApiBilling, CLAUDE_API_BILLING_DISABLED_MESSAGE, type ProviderEnvironmentProfile } from './environmentPolicy.ts';
import {
  PROVIDER_ABSOLUTE_SAFETY_CEILING_MS,
  PROVIDER_INACTIVITY_TIMEOUT_MS,
  PROVIDER_STARTUP_INACTIVITY_TIMEOUT_MS,
} from './executionLimits.ts';

const execFileAsync = promisify(execFile);

/* -------------------------------------------------------------------------- */
/* Tunable constants (documented defaults)                                    */
/* -------------------------------------------------------------------------- */

/** Startup timeout: from spawn until first parsed event or workspace write. */
export const STARTUP_TIMEOUT_MS = PROVIDER_STARTUP_INACTIVITY_TIMEOUT_MS;
/** Idle timeout: no parsed event or workspace write. Optional when undefined. */
export const IDLE_TIMEOUT_MS: number | undefined = PROVIDER_INACTIVITY_TIMEOUT_MS;
/** Absolute safety ceiling. Active providers may run past the legacy 10-minute budget. */
export const OVERALL_TIMEOUT_DEFAULT_MS = PROVIDER_ABSOLUTE_SAFETY_CEILING_MS;
/** Overall timeout minimum for short operator diagnostics. */
export const OVERALL_TIMEOUT_MIN_MS = 1_000;
/** Absolute safety ceiling. Prevents multi-hour accidental runs. */
export const OVERALL_TIMEOUT_MAX_MS = 2 * 60 * 60_000;
/** Cancel grace: time between cancel request and force tree kill. */
export const CANCEL_GRACE_MS = 5_000;
/** Maximum wait for a killed process tree to emit the child's `close` event. */
export const POST_KILL_SETTLEMENT_MS = 3_000;
/** One bounded retry is allowed when exact-PID tree termination reports failure. */
export const TREE_KILL_RETRY_MS = 100;
export const WORKSPACE_POLL_MS = 1_000;

/** Retained stdout tail (last 64 KiB). Stream throughput is NOT capped by this. */
export const STDOUT_RETAINED_TAIL_BYTES = 64 * 1024;
/** Retained stderr tail (last 16 KiB). */
export const STDERR_RETAINED_TAIL_BYTES = 16 * 1024;
/**
 * Absolute processed-stdout safety limit (256 MiB). A broken child cannot
 * stream forever consuming CPU/disk while the overall timeout is very high.
 * Normal coding-CLI runs (JSONL) are well under this; when exceeded the run is
 * cancelled with terminationReason `'output-limit'` → OUTPUT_LIMIT_EXCEEDED.
 * Configurable per-run via {@link OutputLimits.absoluteOutputBytes}.
 */
export const ABSOLUTE_OUTPUT_LIMIT_BYTES = 256 * 1024 * 1024;

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

export class TimeoutValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutValidationError';
  }
}

export class WorkingDirectoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkingDirectoryError';
  }
}

export class UnsafeCmdWrapperArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeCmdWrapperArgumentError';
  }
}

/* -------------------------------------------------------------------------- */
/* Timeout validation                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Overrideable clamp bounds for the overall timeout. Production callers never
 * supply this; the defaults enforce a 1s–2h envelope. Tests
 * inject a narrower bound so the overall-timer mechanism can be exercised at
 * sub-minute scale without weakening the production floor.
 */
export interface TimeoutBounds {
  minMs: number;
  maxMs: number;
}

export const DEFAULT_TIMEOUT_BOUNDS: TimeoutBounds = {
  minMs: OVERALL_TIMEOUT_MIN_MS,
  maxMs: OVERALL_TIMEOUT_MAX_MS,
};

/**
 * Validate + clamp an owner-supplied overall timeout.
 *
 * NaN / non-number / 0 / negative / Infinity are REJECTED (explicit error,
 * never silently accepted). Finite positive values outside the supported
 * bounds are CLAMPED to [bounds.minMs, bounds.maxMs] so multi-hour accidental
 * runs cannot occur. Behaviour is deterministic. Defaults enforce 1s–2h.
 */
export function validateOverallTimeout(ms: unknown, bounds: TimeoutBounds = DEFAULT_TIMEOUT_BOUNDS): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) {
    throw new TimeoutValidationError(
      `overall timeout must be a positive finite number, got: ${JSON.stringify(ms)}`,
    );
  }
  if (ms < bounds.minMs) {
    return bounds.minMs;
  }
  if (ms > bounds.maxMs) {
    return bounds.maxMs;
  }
  return ms;
}

/* -------------------------------------------------------------------------- */
/* Working directory safety                                                   */
/* -------------------------------------------------------------------------- */

export type WorkingDirectoryResolution =
  | { ok: true; canonicalPath: string }
  | { ok: false; code: 'WORKING_DIRECTORY_INVALID'; message: string };

/**
 * Resolve both the requested working directory and the allowed/canonical repo
 * directory to their real (canonical) paths and require them to be the SAME
 * canonical directory. ORCH-3 supports only the main canonical repo — no
 * worktrees, no parent/child alternates. An outside path is NEVER normalized
 * into acceptance.
 */
export function resolveWorkingDirectory(
  workingDirectory: string,
  allowedWorkingDirectory: string,
): WorkingDirectoryResolution {
  if (typeof workingDirectory !== 'string' || workingDirectory.length === 0) {
    return { ok: false, code: 'WORKING_DIRECTORY_INVALID', message: 'workingDirectory is required' };
  }
  if (typeof allowedWorkingDirectory !== 'string' || allowedWorkingDirectory.length === 0) {
    return { ok: false, code: 'WORKING_DIRECTORY_INVALID', message: 'allowedWorkingDirectory is required' };
  }

  let workingCanonical: string;
  let allowedCanonical: string;
  try {
    workingCanonical = realpathSync(workingDirectory);
  } catch {
    return {
      ok: false,
      code: 'WORKING_DIRECTORY_INVALID',
      message: `workingDirectory does not resolve to an existing directory: ${workingDirectory}`,
    };
  }
  try {
    allowedCanonical = realpathSync(allowedWorkingDirectory);
  } catch {
    return {
      ok: false,
      code: 'WORKING_DIRECTORY_INVALID',
      message: `allowedWorkingDirectory does not resolve to an existing directory: ${allowedWorkingDirectory}`,
    };
  }

  if (!areSameCanonicalDirectory(workingCanonical, allowedCanonical)) {
    return {
      ok: false,
      code: 'WORKING_DIRECTORY_INVALID',
      message: `workingDirectory (${workingCanonical}) is not the allowed canonical repo directory (${allowedCanonical})`,
    };
  }

  return { ok: true, canonicalPath: workingCanonical };
}

function areSameCanonicalDirectory(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  // Windows is case-insensitive; compare lowercased as a fallback.
  if (process.platform === 'win32') {
    return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  }
  return path.resolve(a) === path.resolve(b);
}

/* -------------------------------------------------------------------------- */
/* Launch descriptor                                                          */
/* -------------------------------------------------------------------------- */

export type LaunchKind = 'native' | 'cmd-wrapper';

/**
 * Generic launch descriptor. `argv` MUST be provider-controlled flag values
 * only — NEVER user/prompt text. Prompts travel via stdin. The runner never
 * interpolates argv into a shell; for `.cmd` wrappers it validates argv for
 * cmd.exe metacharacters and builds a single `cmd /d /s /c` command line using
 * narrow quoting only for otherwise-safe space-containing arguments.
 */
export interface LaunchDescriptor {
  kind: LaunchKind;
  /** Resolved executable path (native) or .cmd wrapper path (cmd-wrapper). */
  executable: string;
  /** Literal argv. No user text. */
  argv: string[];
}

/**
 * Injectable spawn signature. The runner always calls spawn with three
 * arguments: (command, argv, options). Narrowing away Node's full overload
 * surface keeps injection + capture simple in tests.
 */
export type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

const UNSAFE_CMD_ARG_PATTERN = /["&|<>^()%!\r\n\0]/u;

export function assertSafeCmdWrapperArgument(arg: string, index: number): void {
  if (typeof arg !== 'string') {
    throw new UnsafeCmdWrapperArgumentError(`Unsafe argument for Windows command wrapper at argv index ${index}.`);
  }
  if (UNSAFE_CMD_ARG_PATTERN.test(arg)) {
    throw new UnsafeCmdWrapperArgumentError(`Unsafe argument for Windows command wrapper at argv index ${index}.`);
  }
}

function formatCmdWrapperArgument(arg: string, index: number): string {
  assertSafeCmdWrapperArgument(arg, index);
  if (arg.length === 0 || /[ \t]/u.test(arg)) {
    const escapedTrailingBackslashes = arg.replace(/(\\+)$/u, '$1$1');
    return `"${escapedTrailingBackslashes}"`;
  }
  return arg;
}

/**
 * Build the verbatim command-line argument string for a `.cmd` wrapper launch
 * through `%COMSPEC% /d /s /c`. Arguments are validated first so unsafe
 * dynamic values never cross the cmd.exe boundary.
 */
export function buildCmdWrapperCommandLine(descriptor: LaunchDescriptor): string {
  const formattedArgs = descriptor.argv.map((arg, index) => formatCmdWrapperArgument(arg, index));
  if (formattedArgs.length === 0) {
    return `""${descriptor.executable}""`;
  }
  return `""${descriptor.executable}" ${formattedArgs.join(' ')}"`;
}

/* -------------------------------------------------------------------------- */
/* Output limits                                                              */
/* -------------------------------------------------------------------------- */

export interface OutputLimits {
  stdoutRetainedTailBytes: number;
  stderrRetainedTailBytes: number;
  absoluteOutputBytes: number;
}

/* -------------------------------------------------------------------------- */
/* Kill abstraction                                                          */
/* -------------------------------------------------------------------------- */

export interface KillResult {
  killed: boolean;
  error?: string;
}

export type KillProcessTreeFn = (pid: number) => Promise<KillResult>;

/**
 * Validate a PID before any kill operation. Rejects non-integers, non-positive,
 * and NaN. The runner only ever feeds the PID it got from the spawned
 * ChildProcess; arbitrary caller PIDs are never accepted.
 */
export function isValidKillPid(pid: unknown): pid is number {
  return typeof pid === 'number' && Number.isInteger(pid) && pid > 0;
}

/**
 * Default Windows force tree kill: `taskkill.exe /PID <pid> /T /F` invoked via
 * execFile with an absolute SystemRoot path and shell:false — no shell
 * interpolation. PID is validated first. On non-Windows, falls back to
 * `process.kill(pid, 'SIGKILL')` (best-effort; this project targets Windows).
 */
export const defaultKillProcessTree: KillProcessTreeFn = async (pid: number): Promise<KillResult> => {
  if (!isValidKillPid(pid)) {
    return { killed: false, error: `invalid pid: ${String(pid)}` };
  }
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    const taskkillPath = path.join(systemRoot, 'System32', 'taskkill.exe');
    try {
      await execFileAsync(taskkillPath, ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 5000,
      });
      return { killed: true };
    } catch (err) {
      // If the process is already gone, taskkill returns non-zero; treat as killed.
      const message = err instanceof Error ? err.message : String(err);
      if (/not found|no such|not running/iu.test(message)) {
        return { killed: true };
      }
      return { killed: false, error: message };
    }
  }
  // Non-Windows fallback.
  try {
    process.kill(pid, 'SIGKILL');
    return { killed: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/ESRCH/u.test(message)) {
      return { killed: true };
    }
    return { killed: false, error: message };
  }
};

/* -------------------------------------------------------------------------- */
/* Bounded retained tail                                                      */
/* -------------------------------------------------------------------------- */

class BoundedTail {
  private chunks: Buffer[] = [];
  private total = 0;
  private readonly maxBytes: number;

  constructor(maxBytes: number) {
    this.maxBytes = maxBytes;
  }

  append(chunk: Buffer): void {
    if (chunk.length === 0) {
      return;
    }
    this.chunks.push(chunk);
    this.total += chunk.length;
    while (this.total > this.maxBytes && this.chunks.length > 0) {
      const first = this.chunks[0];
      const overflow = this.total - this.maxBytes;
      if (first.length <= overflow) {
        this.total -= first.length;
        this.chunks.shift();
      } else {
        this.chunks[0] = first.subarray(overflow);
        this.total -= overflow;
      }
    }
  }

  toString(): string {
    if (this.chunks.length === 0) {
      return '';
    }
    return Buffer.concat(this.chunks).toString('utf8');
  }

  get bytes(): number {
    return this.total;
  }
}

/* -------------------------------------------------------------------------- */
/* Run options + handle                                                       */
/* -------------------------------------------------------------------------- */

export interface TimeoutConfig {
  startupTimeoutMs: number;
  idleTimeoutMs: number | undefined;
  overallTimeoutMs: number;
  cancelGraceMs: number;
  /** Bounded observation window after force-killing the captured PID tree. */
  postKillSettlementMs: number;
}

/**
 * Test seam for deterministic liveness checks. Production uses the global timers.
 * Only parsed provider events and isolated-workspace writes refresh inactivity.
 */
export interface ProcessTimerControl {
  setTimeout(callback: () => void, ms: number): NodeJS.Timeout;
  clearTimeout(handle: NodeJS.Timeout): void;
}

export interface RunProcessOptions {
  executionId: string;
  launch: LaunchDescriptor;
  workingDirectory: string;
  allowedWorkingDirectory: string;
  /** Prompt text written to stdin, then stdin is closed. */
  prompt?: string;
  /** Override defaults; overallTimeoutMs is validated + clamped against bounds. */
  timeouts?: Partial<TimeoutConfig>;
  /** Clamp bounds for overall timeout (test seam; defaults to 1s–2h). */
  timeoutBounds?: TimeoutBounds;
  /** Incremental stream callbacks. Throwing is fail-safe (see header). */
  callbacks?: ExecutionStreamCallbacks;
  /** Isolated attempt workspace only; file metadata changes count as activity. */
  activityWorkspacePath?: string;
  /** Small environment overlay merged onto the current process env. Never returned/logged. */
  envOverlay?: Record<string, string>;
  /** Provider identity selects the narrowly allowed authentication variables. */
  environmentProfile?: ProviderEnvironmentProfile;
  /** Test seam; values are filtered identically to the real host environment. */
  environmentSource?: NodeJS.ProcessEnv;
  /** Output caps. */
  limits?: Partial<OutputLimits>;
  /** Injectable kill (tests record calls without killing unrelated processes). */
  killProcessTree?: KillProcessTreeFn;
  /** Injectable spawn (tests). Always called as (command, argv, options). */
  spawnFn?: SpawnFn;
  /** Injectable clock for deterministic timestamps. */
  now?: () => Date;
  /** Injectable timers. Production omits this and uses the global clock. */
  timers?: ProcessTimerControl;
}

export interface ProcessHandle {
  readonly executionId: string;
  readonly pid: number | null;
  readonly done: Promise<ProcessExecutionResult>;
  /** Idempotent cancellation. */
  cancel(): void;
}

/* -------------------------------------------------------------------------- */
/* Runner                                                                     */
/* -------------------------------------------------------------------------- */

type RunnerState = 'starting' | 'running' | 'terminating' | 'settled';

export class ProcessRunner {
  /**
   * Launch one child process and return a {@link ProcessHandle}. The handle's
   * `done` promise resolves EXACTLY once with process facts. Cancellation is
   * idempotent. All timers/listeners are cleaned up on every terminal path.
   */
  run(options: RunProcessOptions): ProcessHandle {
    const now = options.now ?? (() => new Date());
    const killFn = options.killProcessTree ?? defaultKillProcessTree;
    const spawnFn: SpawnFn = options.spawnFn ?? spawn;
    const scheduleTimeout = options.timers?.setTimeout ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
    const cancelTimeout = options.timers?.clearTimeout ?? ((handle: NodeJS.Timeout) => { clearTimeout(handle); });

    const dir = resolveWorkingDirectory(options.workingDirectory, options.allowedWorkingDirectory);
    if (!dir.ok) {
      const failed: ProcessExecutionResult = this.makeFailedResult(options.executionId, now, 'spawn-failed');
      return {
        executionId: options.executionId,
        pid: null,
        done: Promise.resolve(failed),
        cancel: () => undefined,
      };
    }
    const cwd = dir.canonicalPath;

    if ((options.environmentProfile ?? 'generic') === 'claude' && claudeOverlayRequestsApiBilling(options.envOverlay)) {
      const failed = this.makeFailedResult(
        options.executionId,
        now,
        'spawn-failed',
        CLAUDE_API_BILLING_DISABLED_MESSAGE,
      );
      return {
        executionId: options.executionId,
        pid: null,
        done: Promise.resolve(failed),
        cancel: () => undefined,
      };
    }

    // Validate + clamp overall timeout.
    const bounds = options.timeoutBounds ?? DEFAULT_TIMEOUT_BOUNDS;
    const overallTimeoutMs = validateOverallTimeout(
      options.timeouts?.overallTimeoutMs ?? OVERALL_TIMEOUT_DEFAULT_MS,
      bounds,
    );
    const timeouts: TimeoutConfig = {
      startupTimeoutMs: options.timeouts?.startupTimeoutMs ?? STARTUP_TIMEOUT_MS,
      idleTimeoutMs: options.timeouts?.idleTimeoutMs ?? IDLE_TIMEOUT_MS,
      overallTimeoutMs,
      cancelGraceMs: options.timeouts?.cancelGraceMs ?? CANCEL_GRACE_MS,
      postKillSettlementMs: options.timeouts?.postKillSettlementMs ?? POST_KILL_SETTLEMENT_MS,
    };

    const limits: OutputLimits = {
      stdoutRetainedTailBytes: options.limits?.stdoutRetainedTailBytes ?? STDOUT_RETAINED_TAIL_BYTES,
      stderrRetainedTailBytes: options.limits?.stderrRetainedTailBytes ?? STDERR_RETAINED_TAIL_BYTES,
      absoluteOutputBytes: options.limits?.absoluteOutputBytes ?? ABSOLUTE_OUTPUT_LIMIT_BYTES,
    };

    // Provider children receive a default-deny environment; overlays cannot
    // reintroduce application credentials because they are filtered as well.
    const env = buildProviderEnvironment(
      options.environmentProfile ?? 'generic',
      options.environmentSource ?? process.env,
      options.envOverlay,
    );

    let commandLine: string | undefined;
    if (options.launch.kind === 'cmd-wrapper') {
      try {
        commandLine = buildCmdWrapperCommandLine(options.launch);
      } catch (err) {
        const message =
          err instanceof UnsafeCmdWrapperArgumentError
            ? err.message
            : 'Unsafe argument for Windows command wrapper.';
        const failed = this.makeFailedResult(options.executionId, now, 'spawn-failed', message);
        return {
          executionId: options.executionId,
          pid: null,
          done: Promise.resolve(failed),
          cancel: () => undefined,
        };
      }
    }

    const stdoutTail = new BoundedTail(limits.stdoutRetainedTailBytes);
    const stderrTail = new BoundedTail(limits.stderrRetainedTailBytes);
    let stdoutBytes = 0;
    let stderrBytes = 0;

    let state: RunnerState = 'starting';
    let pendingReason: ProcessTerminationReason | null = null;
    let callbackErrorMessage: string | undefined;
    let lastExitCode: number | null = null;
    let lastSignal: string | null = null;
    let startedAt: string | null = null;
    let lastActivityAt: string | null = null;
    let firstActivity = false;

    let overallTimer: NodeJS.Timeout | undefined;
    let startupTimer: NodeJS.Timeout | undefined;
    let idleTimer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;
    let postKillTimer: NodeJS.Timeout | undefined;
    let treeKillRetryTimer: NodeJS.Timeout | undefined;
    let workspacePollTimer: NodeJS.Timeout | undefined;
    let workspaceFiles = options.activityWorkspacePath ? snapshotWorkspaceFiles(options.activityWorkspacePath) : null;
    let treeKillAttempts = 0;
    let postKillWaits = 0;
    let treeKillPending = false;
    let closeObserved = false;

    let resolveDone!: (result: ProcessExecutionResult) => void;
    const done = new Promise<ProcessExecutionResult>((resolve) => {
      resolveDone = resolve;
    });

    let capturedPid: number | null = null;
    let child: ChildProcess | null = null;

    const clearTimer = (t: NodeJS.Timeout | undefined): void => {
      if (t) {
        cancelTimeout(t);
      }
    };
    const clearAllTimers = (): void => {
      clearTimer(overallTimer);
      clearTimer(startupTimer);
      clearTimer(idleTimer);
      clearTimer(graceTimer);
      clearTimer(postKillTimer);
      clearTimer(treeKillRetryTimer);
      clearTimer(workspacePollTimer);
      overallTimer = undefined;
      startupTimer = undefined;
      idleTimer = undefined;
      graceTimer = undefined;
      postKillTimer = undefined;
      treeKillRetryTimer = undefined;
      workspacePollTimer = undefined;
    };

    const armIdle = (): void => {
      if (timeouts.idleTimeoutMs === undefined) {
        return;
      }
      clearTimer(idleTimer);
      idleTimer = scheduleTimeout(() => terminate('timeout-idle'), timeouts.idleTimeoutMs);
    };

    const markActivity = (): void => {
      if (state === 'settled' || state === 'terminating') {
        return;
      }
      lastActivityAt = now().toISOString();
      if (!firstActivity) {
        firstActivity = true;
        clearTimer(startupTimer);
        startupTimer = undefined;
        armIdle();
      } else {
        clearTimer(idleTimer);
        armIdle();
      }
    };

    const buildResult = (reason: ProcessTerminationReason): ProcessExecutionResult => {
      const endedAt = now().toISOString();
      return {
        pid: capturedPid,
        exitCode: lastExitCode,
        signal: lastSignal,
        spawned: capturedPid !== null,
        timedOut: reason === 'timeout-overall' || reason === 'timeout-startup' || reason === 'timeout-idle',
        cancelled: reason === 'cancelled',
        outputLimitExceeded: reason === 'output-limit',
        terminationReason: reason,
        callbackErrorMessage: reason === 'callback-error' ? callbackErrorMessage : undefined,
        startedAt,
        endedAt,
        lastActivityAt,
        limitFired: reason === 'timeout-startup' ? 'startup' : reason === 'timeout-idle' ? 'inactivity' : reason === 'timeout-overall' ? 'ceiling' : 'none',
        limitMs: reason === 'timeout-startup' ? timeouts.startupTimeoutMs : reason === 'timeout-idle' ? (timeouts.idleTimeoutMs ?? null) : reason === 'timeout-overall' ? timeouts.overallTimeoutMs : null,
        stdoutBytes,
        stderrBytes,
        stdoutTail: stdoutTail.toString(),
        stderrTail: stderrTail.toString(),
      };
    };

    const settle = (reason: ProcessTerminationReason): void => {
      if (state === 'settled') {
        return;
      }
      state = 'settled';
      clearAllTimers();
      removeListeners();
      const result = buildResult(reason);
      resolveDone(result);
    };

    const removeListeners = (): void => {
      if (child) {
        child.removeAllListeners();
        child.stdout?.removeAllListeners();
        child.stderr?.removeAllListeners();
        child.stdin?.removeAllListeners();
      }
    };

    const releaseProcessResources = (): void => {
      try {
        child?.stdin?.end();
      } catch {
        /* ignore */
      }
      try {
        child?.stdin?.destroy();
        child?.stdout?.destroy();
        child?.stderr?.destroy();
      } catch {
        /* ignore */
      }
      // This only releases our event-loop reference; it is not evidence that
      // Windows terminated the provider process tree.
      try {
        child?.unref();
      } catch {
        /* ignore */
      }
    };

    /** On Windows, kill the whole tree before EOF can let the parent exit. */
    const terminate = (reason: ProcessTerminationReason): void => {
      if (state === 'settled' || state === 'terminating') {
        return;
      }
      pendingReason = reason;
      state = 'terminating';

      // Stop the running clocks; the grace clock drives the rest.
      clearTimer(overallTimer);
      clearTimer(startupTimer);
      clearTimer(idleTimer);
      clearTimer(workspacePollTimer);
      overallTimer = undefined;
      startupTimer = undefined;
      idleTimer = undefined;

      const pid = capturedPid;
      if (isValidKillPid(pid)) {
        const forceKill = (): void => {
            if (state !== 'terminating') {
              return;
            }
            treeKillRetryTimer = undefined;
            treeKillAttempts += 1;
            treeKillPending = true;
            if (!postKillTimer) {
              const finishAfterKill = (): void => {
                if (state !== 'terminating') {
                  return;
                }
                if ((treeKillPending || treeKillRetryTimer) && postKillWaits++ < 4) {
                  postKillTimer = scheduleTimeout(finishAfterKill, timeouts.postKillSettlementMs);
                  return;
                }
                // The exact tree was targeted, but a descendant may retain a
                // pipe and indefinitely suppress `close`. Preserve the known
                // terminal reason while releasing local handles and settling.
                releaseProcessResources();
                settle(pendingReason ?? reason);
              };
              postKillTimer = scheduleTimeout(finishAfterKill, timeouts.postKillSettlementMs);
            }
            void killFn(pid)
              .then((result) => {
                treeKillPending = false;
                if (!result.killed && treeKillAttempts < 2 && state === 'terminating') {
                  treeKillRetryTimer = scheduleTimeout(forceKill, TREE_KILL_RETRY_MS);
                } else if (closeObserved && state === 'terminating') {
                  settle(pendingReason ?? reason);
                }
              })
              .catch(() => {
                treeKillPending = false;
                if (treeKillAttempts < 2 && state === 'terminating') {
                  treeKillRetryTimer = scheduleTimeout(forceKill, TREE_KILL_RETRY_MS);
                } else if (closeObserved && state === 'terminating') {
                  settle(pendingReason ?? reason);
                }
              });
          };
        if (process.platform === 'win32') {
          forceKill();
        } else {
          graceTimer = scheduleTimeout(forceKill, timeouts.cancelGraceMs);
        }
      } else {
        settle(reason);
      }

      try {
        child?.stdin?.end();
      } catch {
        /* ignore */
      }
    };

    const cancel = (): void => {
      terminate('cancelled');
    };

    // ---- Spawn -------------------------------------------------------------
    try {
      if (options.launch.kind === 'native') {
        child = spawnFn(options.launch.executable, options.launch.argv, {
          shell: false,
          cwd,
          windowsHide: true,
          env,
          stdio: ['pipe', 'pipe', 'pipe'] as SpawnOptions['stdio'],
        });
      } else {
        const comspec = env.COMSPEC ?? 'cmd.exe';
        child = spawnFn(comspec, ['/d', '/s', '/c', commandLine ?? buildCmdWrapperCommandLine(options.launch)], {
          shell: false,
          cwd,
          windowsHide: true,
          env,
          stdio: ['pipe', 'pipe', 'pipe'] as SpawnOptions['stdio'],
          windowsVerbatimArguments: true,
        });
      }
    } catch (err) {
      callbackErrorMessage = err instanceof Error ? err.message : String(err);
      const failed = this.makeFailedResult(options.executionId, now, 'spawn-failed');
      // Resolve on next tick to keep the async contract consistent.
      queueMicrotask(() => resolveDone(failed));
      return { executionId: options.executionId, pid: null, done, cancel: () => undefined };
    }

    capturedPid = typeof child.pid === 'number' ? child.pid : null;
    startedAt = now().toISOString();
    state = 'running';

    // ---- Timers ------------------------------------------------------------
    overallTimer = scheduleTimeout(() => terminate('timeout-overall'), timeouts.overallTimeoutMs);
    startupTimer = scheduleTimeout(() => terminate('timeout-startup'), timeouts.startupTimeoutMs);
    if (workspaceFiles) {
      const pollWorkspace = (): void => {
        if (state === 'settled' || state === 'terminating' || !options.activityWorkspacePath) return;
        const current = snapshotWorkspaceFiles(options.activityWorkspacePath);
        if (current && workspaceFiles && workspaceSnapshotChanged(workspaceFiles, current)) markActivity();
        if (current) workspaceFiles = current;
        workspacePollTimer = scheduleTimeout(pollWorkspace, WORKSPACE_POLL_MS);
      };
      workspacePollTimer = scheduleTimeout(pollWorkspace, WORKSPACE_POLL_MS);
    }

    // ---- Stdout ------------------------------------------------------------
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      stdoutTail.append(chunk);
      if (stdoutBytes > limits.absoluteOutputBytes) {
        terminate('output-limit');
        return;
      }
      try {
        if (options.callbacks?.onStdoutChunk?.(chunk) === true) markActivity();
      } catch (err) {
        callbackErrorMessage = `stdout callback threw: ${err instanceof Error ? err.message : String(err)}`;
        terminate('callback-error');
      }
    });

    // ---- Stderr ------------------------------------------------------------
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      stderrTail.append(chunk);
      // stderr non-empty is NOT failure; no semantic interpretation.
      try {
        options.callbacks?.onStderrChunk?.(chunk);
      } catch (err) {
        callbackErrorMessage = `stderr callback threw: ${err instanceof Error ? err.message : String(err)}`;
        terminate('callback-error');
      }
    });

    // ---- Exit + close ------------------------------------------------------
    child.on('exit', (code: number | null, signal: string | null) => {
      lastExitCode = code;
      lastSignal = signal;
    });

    child.on('close', () => {
      closeObserved = true;
      if (state === 'terminating' && (treeKillPending || graceTimer || treeKillRetryTimer)) return;
      const reason: ProcessTerminationReason = pendingReason ?? 'exited';
      settle(reason);
    });

    // ---- Spawn error (ENOENT/EACCES/etc.) ---------------------------------
    child.on('error', () => {
      if (state === 'settled') {
        return;
      }
      // A late error after exit is ignored; an early one is a spawn failure.
      if (capturedPid === null) {
        callbackErrorMessage = 'spawn error';
        settle('spawn-failed');
      } else {
        // Process existed then errored; let close settle normally.
        if (state !== 'terminating') {
          terminate('spawn-failed');
        }
      }
    });

    // ---- Stdin transport ---------------------------------------------------
    if (options.prompt !== undefined && child.stdin) {
      void writeStdin(child.stdin, options.prompt);
    } else if (child.stdin) {
      try {
        child.stdin.end();
      } catch {
        /* ignore */
      }
    }

    return { executionId: options.executionId, pid: capturedPid, done, cancel };
  }

  private makeFailedResult(
    executionId: string,
    now: () => Date,
    reason: ProcessTerminationReason,
    stderrTail = '',
  ): ProcessExecutionResult {
    const ts = now().toISOString();
    return {
      pid: null,
      exitCode: null,
      signal: null,
      spawned: false,
      timedOut: false,
      cancelled: false,
      outputLimitExceeded: false,
      terminationReason: reason,
      startedAt: null,
      endedAt: ts,
      stdoutBytes: 0,
      stderrBytes: 0,
      stdoutTail: '',
      stderrTail,
    };
  }
}

/** Metadata polling avoids platform-specific recursive watch behavior. Symlinks are ignored. */
function snapshotWorkspaceFiles(root: string): Map<string, string> | null {
  const files = new Map<string, string>();
  try {
    const pending = [root];
    while (pending.length > 0) {
      const directory = pending.pop()!;
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) pending.push(fullPath);
        else if (entry.isFile()) {
          const stat = statSync(fullPath);
          files.set(path.relative(root, fullPath), `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`);
        }
      }
    }
    return files;
  } catch {
    return null;
  }
}

function workspaceSnapshotChanged(previous: Map<string, string>, current: Map<string, string>): boolean {
  if (previous.size !== current.size) return true;
  for (const [name, metadata] of current) {
    if (previous.get(name) !== metadata) return true;
  }
  return false;
}

/**
 * Write prompt data to a child stdin stream and close it. Handles EPIPE / early
 * child exit safely: any write or stream error resolves silently (the 'close'
 * path settles the run). Supports arbitrary Unicode, multiline text, and large
 * prompts beyond Windows command-line limits.
 */
function writeStdin(stream: NodeJS.WritableStream, data: string): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    stream.on('error', finish); // EPIPE when child exits early
    const buf = Buffer.from(data, 'utf8');
    const ok = stream.write(buf);
    if (ok) {
      stream.end(finish);
    } else {
      stream.once('drain', () => {
        try {
          stream.end(finish);
        } catch {
          finish();
        }
      });
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Convenience                                                                */
/* -------------------------------------------------------------------------- */

const defaultRunner = new ProcessRunner();

/** Convenience: run a process and await its terminal result. */
export function runProcess(options: RunProcessOptions): ProcessHandle {
  return defaultRunner.run(options);
}
