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
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import type { ExecutionStreamCallbacks, ProcessExecutionResult, ProcessTerminationReason } from './types.ts';

const execFileAsync = promisify(execFile);

/* -------------------------------------------------------------------------- */
/* Tunable constants (documented defaults)                                    */
/* -------------------------------------------------------------------------- */

/** Startup timeout: from spawn until first stdout/stderr activity. */
export const STARTUP_TIMEOUT_MS = 30_000;
/** Idle timeout: no stdout/stderr activity for this long. Optional; disabled when undefined. */
export const IDLE_TIMEOUT_MS: number | undefined = 120_000;
/** Overall timeout default (10 minutes). */
export const OVERALL_TIMEOUT_DEFAULT_MS = 10 * 60_000;
/** Overall timeout minimum (60 seconds). */
export const OVERALL_TIMEOUT_MIN_MS = 60_000;
/** Overall timeout maximum (30 minutes). Prevents multi-hour accidental runs. */
export const OVERALL_TIMEOUT_MAX_MS = 30 * 60_000;
/** Cancel grace: time between cancel request and force tree kill. */
export const CANCEL_GRACE_MS = 5_000;

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
 * supply this; the defaults enforce the documented 60s–30min envelope. Tests
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
 * runs cannot occur. Behaviour is deterministic. Defaults enforce 60s–30min.
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
  /** Clamp bounds for overall timeout (test seam; defaults to 60s–30min). */
  timeoutBounds?: TimeoutBounds;
  /** Incremental stream callbacks. Throwing is fail-safe (see header). */
  callbacks?: ExecutionStreamCallbacks;
  /** Small environment overlay merged onto the current process env. Never returned/logged. */
  envOverlay?: Record<string, string>;
  /** Output caps. */
  limits?: Partial<OutputLimits>;
  /** Injectable kill (tests record calls without killing unrelated processes). */
  killProcessTree?: KillProcessTreeFn;
  /** Injectable spawn (tests). Always called as (command, argv, options). */
  spawnFn?: SpawnFn;
  /** Injectable clock for deterministic timestamps. */
  now?: () => Date;
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

    // Resolve + validate the working directory up front.
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
    };

    const limits: OutputLimits = {
      stdoutRetainedTailBytes: options.limits?.stdoutRetainedTailBytes ?? STDOUT_RETAINED_TAIL_BYTES,
      stderrRetainedTailBytes: options.limits?.stderrRetainedTailBytes ?? STDERR_RETAINED_TAIL_BYTES,
      absoluteOutputBytes: options.limits?.absoluteOutputBytes ?? ABSOLUTE_OUTPUT_LIMIT_BYTES,
    };

    // Environment: inherit current env + small overlay. Never returned/logged/persisted.
    const env = { ...process.env, ...(options.envOverlay ?? {}) };

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
    let firstActivity = false;

    let overallTimer: NodeJS.Timeout | undefined;
    let startupTimer: NodeJS.Timeout | undefined;
    let idleTimer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;

    let resolveDone!: (result: ProcessExecutionResult) => void;
    const done = new Promise<ProcessExecutionResult>((resolve) => {
      resolveDone = resolve;
    });

    let capturedPid: number | null = null;
    let child: ChildProcess | null = null;

    const clearTimer = (t: NodeJS.Timeout | undefined): void => {
      if (t) {
        clearTimeout(t);
      }
    };
    const clearAllTimers = (): void => {
      clearTimer(overallTimer);
      clearTimer(startupTimer);
      clearTimer(idleTimer);
      clearTimer(graceTimer);
      overallTimer = undefined;
      startupTimer = undefined;
      idleTimer = undefined;
      graceTimer = undefined;
    };

    const armIdle = (): void => {
      if (timeouts.idleTimeoutMs === undefined) {
        return;
      }
      clearTimer(idleTimer);
      idleTimer = setTimeout(() => terminate('timeout-idle'), timeouts.idleTimeoutMs);
    };

    const markActivity = (): void => {
      if (state === 'settled' || state === 'terminating') {
        return;
      }
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

    /**
     * Initiate termination for a non-exit reason. Cooperative step: close stdin
     * (EOF signal). After the cancel grace period, force tree-kill. The actual
     * settle happens on the child 'close' event so we capture exit facts. For
     * spawn-failed (no child / error), settle immediately.
     */
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
      overallTimer = undefined;
      startupTimer = undefined;
      idleTimer = undefined;

      // Cooperative: close stdin to signal EOF to the provider.
      try {
        child?.stdin?.end();
      } catch {
        /* ignore */
      }

      // Force tree-kill after the grace period.
      const pid = capturedPid;
      if (isValidKillPid(pid)) {
        graceTimer = setTimeout(() => {
          void killFn(pid).catch(() => {
            /* best-effort; close will still settle */
          });
        }, timeouts.cancelGraceMs);
      } else {
        // No valid PID (spawn failed). Settle immediately.
        settle(reason);
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
    overallTimer = setTimeout(() => terminate('timeout-overall'), timeouts.overallTimeoutMs);
    startupTimer = setTimeout(() => terminate('timeout-startup'), timeouts.startupTimeoutMs);

    // ---- Stdout ------------------------------------------------------------
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      stdoutTail.append(chunk);
      markActivity();
      if (stdoutBytes > limits.absoluteOutputBytes) {
        terminate('output-limit');
        return;
      }
      try {
        options.callbacks?.onStdoutChunk?.(chunk);
      } catch (err) {
        callbackErrorMessage = `stdout callback threw: ${err instanceof Error ? err.message : String(err)}`;
        terminate('callback-error');
      }
    });

    // ---- Stderr ------------------------------------------------------------
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      stderrTail.append(chunk);
      markActivity();
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
      // Natural exit: settle with pendingReason (if a terminate raced) else 'exited'.
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
