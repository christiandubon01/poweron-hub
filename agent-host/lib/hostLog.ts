/**
 * CT-REL-2 Part B (goal 8 + amendment 4): Host file logging.
 *
 * Daily files under %LOCALAPPDATA%\PowerOn\AgentHost\logs (the caller passes
 * statePaths.baseDir + 'logs') — NEVER inside the repo. Only the newest
 * HOST_LOG_RETENTION_FILES (14) daily files are kept; older ones are deleted
 * when a new day's file is first written.
 *
 * Amendment 4: never log environment values, tokens, keys, prompts, plan text,
 * or provider output. This module writes ONLY caller-provided message strings
 * that the caller has already sanitized (error.message from the control plane
 * is sanitized; prompts/provider output are never passed here). Repeated
 * identical ERROR messages are rate-limited to at most one line per distinct
 * message per minute; the duplicates are counted and reported on a
 * suppressed-count line when the window rolls over (or on flush).
 */

import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';

export const HOST_LOG_RETENTION_FILES = 14;
export const HOST_LOG_RATE_LIMIT_MS = 60_000;
const HOST_LOG_LINE_LIMIT = 512;
const DAILY_FILE_PATTERN = /^agent-host-\d{4}-\d{2}-\d{2}\.log$/u;

export interface HostLogOptions {
  dir: string;
  now?: (() => Date) | undefined;
  /** Echo each written line (default: stderr, so dev consoles keep visibility). */
  echo?: ((line: string) => void) | undefined;
  appendFile?: ((file: string, data: string) => void) | undefined;
  readFileNames?: ((dir: string) => string[]) | undefined;
  deleteFile?: ((file: string) => void) | undefined;
  ensureDir?: ((dir: string) => void) | undefined;
}

export interface HostLog {
  info(message: string): void;
  error(message: string): void;
  /** Emit any pending suppressed-count lines immediately (shutdown/tests). */
  flush(): void;
}

export function createHostLog(options: HostLogOptions): HostLog {
  const now = options.now ?? ((): Date => new Date());
  const echo = options.echo ?? ((line: string): void => {
    process.stderr.write(`${line}\n`);
  });
  const appendFile = options.appendFile ?? ((file: string, data: string): void => {
    appendFileSync(file, data);
  });
  const readFileNames = options.readFileNames ?? ((dir: string): string[] => readdirSync(dir));
  const deleteFile = options.deleteFile ?? ((file: string): void => {
    unlinkSync(file);
  });
  const ensureDir = options.ensureDir ?? ((dir: string): void => {
    mkdirSync(dir, { recursive: true });
  });

  let ensured = false;
  let retentionSweptFor: string | null = null;
  const suppressedCounts = new Map<string, number>();
  const lastEmittedAt = new Map<string, number>();

  const ensureReady = (): void => {
    if (ensured) return;
    ensureDir(options.dir);
    ensured = true;
  };

  const dailyFileFor = (date: Date): string =>
    path.join(options.dir, `agent-host-${date.toISOString().slice(0, 10)}.log`);

  /** Keep only the newest HOST_LOG_RETENTION_FILES daily files (amendment 1). */
  const sweepRetention = (activeFile: string): void => {
    if (retentionSweptFor === activeFile) return;
    retentionSweptFor = activeFile;
    ensureReady();
    const names = readFileNames(options.dir)
      .filter((name) => DAILY_FILE_PATTERN.test(name))
      .sort();
    // The sweep runs BEFORE the first append of the day, so the active file is
    // usually not on disk yet — reserve one of the retention slots for it.
    const capacity = names.includes(path.basename(activeFile))
      ? HOST_LOG_RETENTION_FILES
      : HOST_LOG_RETENTION_FILES - 1;
    const excess = names.length - capacity;
    for (let index = 0; index < excess; index += 1) {
      deleteFile(path.join(options.dir, names[index]!));
    }
  };

  const write = (level: 'info' | 'error', message: string): void => {
    const safe = message.length > HOST_LOG_LINE_LIMIT
      ? `${message.slice(0, HOST_LOG_LINE_LIMIT)}…`
      : message;
    const at = now();
    const file = dailyFileFor(at);
    ensureReady();
    sweepRetention(file);
    const line = `${at.toISOString()} ${level} ${safe}`;
    appendFile(file, `${line}\n`);
    echo(line);
  };

  /**
   * Rate-limited error write: at most one line per distinct message per minute
   * (amendment 4). Duplicates inside the window are counted; when the window
   * rolls over, the next write first reports the suppressed count.
   */
  const writeError = (message: string): void => {
    const nowMs = now().getTime();
    const last = lastEmittedAt.get(message) ?? Number.NEGATIVE_INFINITY;
    if (nowMs - last < HOST_LOG_RATE_LIMIT_MS) {
      suppressedCounts.set(message, (suppressedCounts.get(message) ?? 0) + 1);
      return;
    }
    const suppressed = suppressedCounts.get(message) ?? 0;
    suppressedCounts.set(message, 0);
    lastEmittedAt.set(message, nowMs);
    if (suppressed > 0) {
      write('error', `${message} [suppressed ${suppressed} duplicate line(s) in the last minute]`);
    }
    write('error', message);
  };

  return {
    info: (message: string): void => {
      write('info', message);
    },
    error: writeError,
    flush: (): void => {
      for (const [message, count] of suppressedCounts) {
        if (count > 0) {
          suppressedCounts.set(message, 0);
          write('error', `${message} [suppressed ${count} duplicate line(s) in the last minute]`);
        }
      }
    },
  };
}