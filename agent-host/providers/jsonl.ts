/**
 * ORCH-3B: Streaming JSONL decoder.
 *
 * Provider CLIs (notably Codex) do NOT guarantee pure-JSONL stdout: a non-JSON
 * diagnostic line such as `SUCCESS` may appear, stderr may carry benign
 * ERROR-looking noise, and a single Node `data` chunk is NOT guaranteed to be
 * exactly one JSON object. This decoder handles all of that generically.
 *
 * Design rules:
 *   - Uses TextDecoder streaming mode so a UTF-8 multibyte sequence split
 *     across two chunks decodes correctly.
 *   - Buffers partial lines; a JSON object may span many chunks.
 *   - Emits multiple records per chunk when present.
 *   - Handles LF and CRLF; ignores blank lines.
 *   - Distinguishes: valid JSON  /  non-JSON diagnostic  /  malformed JSON
 *     (looks like JSON but parse fails)  /  oversized line.
 *   - Does NOT decide provider failure. It only reports what it saw. A concrete
 *     adapter decides whether a non-JSON/oversized line is terminal or merely
 *     diagnostic.
 *   - Retained diagnostic content is bounded in memory and never persisted.
 */

/** Metadata for a processed line. */
export interface JsonLineMeta {
  /** Sequential index among non-blank lines (0-based). */
  lineIndex: number;
  /** UTF-8 byte length of the line (excluding line terminators). */
  byteLength: number;
  /** Character length of the line (excluding line terminators). */
  charLength: number;
}

export type JsonlEventType = 'json' | 'non-json' | 'oversized' | 'error';

export interface JsonlEvent {
  type: JsonlEventType;
  /** Parsed value when type === 'json'. */
  value?: unknown;
  /** Bounded (truncated) raw line content for non-json/oversized/error. */
  line?: string;
  /** Parse error message when type === 'error'. */
  error?: { message: string };
  meta: JsonLineMeta;
}

export interface JsonlCallbacks {
  onJson?: (value: unknown, meta: JsonLineMeta) => void;
  onNonJson?: (line: string, meta: JsonLineMeta) => void;
  onOversized?: (line: string, meta: JsonLineMeta) => void;
  onError?: (error: { message: string }, meta: JsonLineMeta, rawLine: string) => void;
}

export interface JsonlDecoderOptions {
  /** Lines whose UTF-8 byte length exceeds this are reported as 'oversized' instead of parsed. */
  maxLineBytes?: number;
  /** Maximum number of retained diagnostic lines (non-json/oversized/error). */
  maxRetainedDiagnostics?: number;
  /** Maximum characters retained per diagnostic line. */
  maxRetainedLineChars?: number;
}

/** Default retained diagnostic line length (chars). */
const DEFAULT_RETAINED_LINE_CHARS = 512;
/** Default number of retained diagnostic lines. */
const DEFAULT_RETAINED_DIAGNOSTICS = 64;

function looksLikeJsonStart(line: string): boolean {
  // Trim leading whitespace only; trailing whitespace is irrelevant to detection.
  const t = line.trimStart();
  const first = t[0];
  if (first === undefined) {
    return false;
  }
  if (first === '{' || first === '[' || first === '"' || first === '-') {
    return true;
  }
  if (first >= '0' && first <= '9') {
    return true;
  }
  // bare keywords true/false/null (precise, so e.g. "noise" is NOT treated as JSON)
  if (first === 't') {
    return t.startsWith('true');
  }
  if (first === 'f') {
    return t.startsWith('false');
  }
  if (first === 'n') {
    return t.startsWith('null');
  }
  return false;
}

function truncate(line: string, maxChars: number): string {
  if (line.length <= maxChars) {
    return line;
  }
  return `${line.slice(0, maxChars)}…[truncated ${line.length - maxChars} chars]`;
}

function truncatePreview(prefix: string, totalChars: number, maxChars: number): string {
  if (totalChars <= maxChars) {
    return prefix;
  }
  return `${prefix.slice(0, maxChars)}…[truncated ${totalChars - maxChars} chars]`;
}

/**
 * Streaming JSONL decoder. Feed chunks via {@link push} and finalize with
 * {@link flush}. Events are returned from both methods AND dispatched to
 * optional callbacks supplied in the constructor.
 */
export class JsonlDecoder {
  private readonly decoder = new TextDecoder('utf-8', { fatal: false });
  private buffer = '';
  private bufferBytes = 0;
  private lineIndex = 0;
  private readonly maxLineBytes: number | undefined;
  private readonly maxRetainedDiagnostics: number;
  private readonly maxRetainedLineChars: number;
  private readonly callbacks?: JsonlCallbacks;
  private discardingOversizedLine = false;

  private nonJsonCount = 0;
  private malformedCount = 0;
  private oversizedCount = 0;
  private jsonCount = 0;
  private readonly retained: string[] = [];

  constructor(options: JsonlDecoderOptions = {}, callbacks?: JsonlCallbacks) {
    this.maxLineBytes = options.maxLineBytes;
    this.maxRetainedDiagnostics = options.maxRetainedDiagnostics ?? DEFAULT_RETAINED_DIAGNOSTICS;
    this.maxRetainedLineChars = options.maxRetainedLineChars ?? DEFAULT_RETAINED_LINE_CHARS;
    this.callbacks = callbacks;
  }

  /** Feed a chunk (Buffer/Uint8Array/string). Returns the events it produced. */
  push(chunk: Buffer | Uint8Array | string): JsonlEvent[] {
    const text = typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true });
    return this.drainText(text, false);
  }

  /** Finalize the decoder (flush trailing TextDecoder bytes + unterminated line). */
  flush(): JsonlEvent[] {
    const tail = this.decoder.decode();
    return this.drainText(tail, true);
  }

  /** Counts (for adapter heuristics; not a failure decision). */
  get counts(): { json: number; nonJson: number; malformed: number; oversized: number } {
    return {
      json: this.jsonCount,
      nonJson: this.nonJsonCount,
      malformed: this.malformedCount,
      oversized: this.oversizedCount,
    };
  }

  /** Bounded retained diagnostic lines (non-json/oversized/error), truncated. */
  getDiagnostics(): string[] {
    return this.retained.slice();
  }

  private drainText(text: string, final: boolean): JsonlEvent[] {
    const events: JsonlEvent[] = [];
    let idx = 0;
    while (idx < text.length) {
      const nl = text.indexOf('\n', idx);
      if (nl === -1) {
        this.consumeSegment(text.slice(idx), false, events);
        idx = text.length;
        continue;
      }
      const rawLine = text.slice(idx, nl);
      idx = nl + 1;
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      this.consumeSegment(line, true, events);
    }
    if (!final) {
      return events;
    }
    if (this.discardingOversizedLine) {
      this.discardingOversizedLine = false;
      this.buffer = '';
      this.bufferBytes = 0;
      return events;
    }
    if (this.buffer.length === 0) {
      return events;
    }
    const ev = this.classifyLine(this.buffer, this.bufferBytes);
    this.buffer = '';
    this.bufferBytes = 0;
    events.push(ev);
    this.dispatch(ev);
    return events;
  }

  private consumeSegment(segment: string, terminated: boolean, events: JsonlEvent[]): void {
    if (this.discardingOversizedLine) {
      if (terminated) {
        this.discardingOversizedLine = false;
      }
      return;
    }

    const segmentBytes = Buffer.byteLength(segment, 'utf8');
    const lineBytes = this.bufferBytes + segmentBytes;

    if (this.maxLineBytes !== undefined && lineBytes > this.maxLineBytes) {
      const totalChars = this.buffer.length + segment.length;
      const retainedPrefix =
        this.buffer.length >= this.maxRetainedLineChars
          ? this.buffer.slice(0, this.maxRetainedLineChars)
          : this.buffer + segment.slice(0, this.maxRetainedLineChars - this.buffer.length);
      const ev = this.makeOversizedEvent(retainedPrefix, lineBytes, totalChars);
      this.buffer = '';
      this.bufferBytes = 0;
      if (!terminated) {
        this.discardingOversizedLine = true;
      }
      events.push(ev);
      this.dispatch(ev);
      return;
    }

    if (!terminated) {
      if (segment.length > 0) {
        this.buffer += segment;
        this.bufferBytes = lineBytes;
      }
      return;
    }

    const line = this.buffer + segment;
    this.buffer = '';
    this.bufferBytes = 0;
    if (line.length === 0) {
      return;
    }
    const ev = this.classifyLine(line, lineBytes);
    events.push(ev);
    this.dispatch(ev);
  }

  private classifyLine(line: string, byteLength = Buffer.byteLength(line, 'utf8')): JsonlEvent {
    const meta: JsonLineMeta = {
      lineIndex: this.lineIndex,
      byteLength,
      charLength: line.length,
    };
    this.lineIndex += 1;

    if (this.maxLineBytes !== undefined && byteLength > this.maxLineBytes) {
      const retainedPrefix = line.slice(0, this.maxRetainedLineChars);
      return this.makeOversizedEvent(retainedPrefix, byteLength, line.length, meta);
    }

    if (!looksLikeJsonStart(line)) {
      this.nonJsonCount += 1;
      const truncated = truncate(line, this.maxRetainedLineChars);
      this.retain(truncated);
      return { type: 'non-json', line: truncated, meta };
    }

    try {
      const value = JSON.parse(line);
      this.jsonCount += 1;
      return { type: 'json', value, meta };
    } catch (err) {
      this.malformedCount += 1;
      const message = err instanceof Error ? err.message : String(err);
      const truncated = truncate(line, this.maxRetainedLineChars);
      this.retain(truncated);
      return { type: 'error', error: { message }, line: truncated, meta };
    }
  }

  private makeOversizedEvent(
    retainedPrefix: string,
    byteLength: number,
    charLength: number,
    meta?: JsonLineMeta,
  ): JsonlEvent {
    const resolvedMeta = meta ?? {
      lineIndex: this.lineIndex,
      byteLength,
      charLength,
    };
    if (meta === undefined) {
      this.lineIndex += 1;
    }
    this.oversizedCount += 1;
    const truncated = truncatePreview(retainedPrefix, charLength, this.maxRetainedLineChars);
    this.retain(truncated);
    return { type: 'oversized', line: truncated, meta: resolvedMeta };
  }

  private retain(line: string): void {
    this.retained.push(line);
    while (this.retained.length > this.maxRetainedDiagnostics) {
      this.retained.shift();
    }
  }

  private dispatch(ev: JsonlEvent): void {
    const cb = this.callbacks;
    if (!cb) {
      return;
    }
    try {
      switch (ev.type) {
        case 'json':
          cb.onJson?.(ev.value, ev.meta);
          break;
        case 'non-json':
          cb.onNonJson?.(ev.line ?? '', ev.meta);
          break;
        case 'oversized':
          cb.onOversized?.(ev.line ?? '', ev.meta);
          break;
        case 'error':
          cb.onError?.(ev.error ?? { message: 'parse error' }, ev.meta, ev.line ?? '');
          break;
      }
    } catch {
      // A consumer callback throwing must not break decoding of subsequent
      // chunks. Swallow here; the process runner owns fail-safe handling for
      // its own stdout/stderr callbacks.
    }
  }
}
