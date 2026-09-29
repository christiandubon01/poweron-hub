/**
 * CT-REL-3 goal 1: responsive request scheduling.
 *
 * The pre-CT-REL-3 claim loop awaited each request (and, for approve_plan, the
 * whole Run drive) before it could claim anything else, so a cancel_run submitted
 * mid-run was not even claimed until the run finished. This scheduler decouples
 * CLAIMING from EXECUTING:
 *
 *   - `cancel_run` BYPASSES the queue and is handled inline, so it takes effect
 *     within one poll (~seconds) even while a Run is executing.
 *   - Every non-cancel request (create_plan / approve_plan / apply_candidate /
 *     import_scope_pack) runs in a SINGLE background slot — at most one at a time,
 *     so Runs and planning stay strictly serial (NO new concurrency). Additional
 *     non-cancel rows wait in an in-memory FIFO and dispatch in order after the
 *     active job finishes.
 *
 * Every claimed row is HELD from receipt (before any dispatch) and released only
 * when its handling finishes, exactly like the previous dispatchClaimedBatch, so
 * lost-claim recovery never mistakes a queued sibling for a lost claim, no matter
 * how long the active job runs. A row already failed by recovery (poisoned) is
 * dropped without ever being dispatched.
 *
 * A3: a background job can never produce an unhandled rejection — every throw is
 * caught, logged (safe message only), and the owning request is failed safely if
 * it is still claimed. On shutdown the loop stops offering; the active job is
 * drained through the executor shutdown path within a bound so the loop never
 * hangs.
 */

import type { HeldRequestTracker } from './lostClaims.ts';
import type { ClaimedControlRequest } from './supabaseControl.ts';

export interface ControlRequestSchedulerDeps {
  /** Shared held-request tracker (also read by lost-claim recovery). */
  held: HeldRequestTracker;
  /** Whether the Host is still running; a false value stops new jobs from starting. */
  isRunning: () => boolean;
  /** Safe logging sink for caught background-job failures (A3). */
  log: { error: (message: string) => void };
  /** Fast, inline handling for cancel_run (bypasses the FIFO). Owns its own completion/failure. */
  handleCancel: (request: ClaimedControlRequest) => Promise<void>;
  /** Long, single-slot handling for a non-cancel request. May throw; the scheduler fails it safely. */
  dispatchNonCancel: (request: ClaimedControlRequest) => Promise<void>;
  /** Fail a request safely (status-guarded) when a job threw and the row is still claimed. */
  failRequest: (id: string, error: string) => Promise<void>;
  /** A4: publish a factual queued status for a row that must wait behind the active job. */
  onQueued?: ((request: ClaimedControlRequest) => Promise<void>) | undefined;
}

const REQUEST_ERROR_LIMIT = 1_000;

export class ControlRequestScheduler {
  private readonly deps: ControlRequestSchedulerDeps;
  private readonly queue: ClaimedControlRequest[] = [];
  private activeJob: Promise<void> | null = null;

  constructor(deps: ControlRequestSchedulerDeps) {
    this.deps = deps;
  }

  /** True while a non-cancel background job is in flight. */
  isBusy(): boolean {
    return this.activeJob !== null;
  }

  /** Non-cancel rows waiting their turn behind the active job. */
  queueDepth(): number {
    return this.queue.length;
  }

  /**
   * Ingest a freshly claimed batch. Holds every row on receipt; routes cancel_run
   * inline (queue bypass) and enqueues every other type; then pumps the single job
   * slot. Only cancel handling is awaited here — background jobs run detached so
   * the claim loop stays responsive.
   */
  async offer(requests: readonly ClaimedControlRequest[]): Promise<void> {
    for (const request of requests) {
      this.deps.held.hold(request.id);
    }
    for (const request of requests) {
      if (this.deps.held.isPoisoned(request.id)) {
        // Recovery already failed this row remotely as HOST_CLAIM_LOST — never dispatch it.
        this.deps.held.release(request.id);
        continue;
      }
      if (request.request_type === 'cancel_run') {
        try {
          await this.deps.handleCancel(request);
        } catch (error) {
          this.deps.log.error(`cancel_run handling failed: ${safeMessage(error)}`);
          try {
            await this.deps.failRequest(request.id, `REQUEST_HANDLER_FAILED: ${safeMessage(error)}`.slice(0, REQUEST_ERROR_LIMIT));
          } catch {
            // The row stays claimed; the owner can submit a fresh cancel.
          }
        } finally {
          this.deps.held.release(request.id);
        }
        continue;
      }
      // A4: a row that must wait behind the active job (or ahead-of-it siblings)
      // gets a factual queued status so the browser shows it instead of a spinner.
      const willWait = this.activeJob !== null || this.queue.length > 0;
      this.queue.push(request);
      if (willWait && this.deps.onQueued) {
        try {
          await this.deps.onQueued(request);
        } catch {
          // Queued-status publishing is observational only.
        }
      }
    }
    this.pump();
  }

  /**
   * Start the next queued non-cancel job if the single slot is free and the Host
   * is still running. Called after offer() and whenever a job finishes.
   */
  private pump(): void {
    if (this.activeJob !== null || !this.deps.isRunning()) {
      return;
    }
    const next = this.queue.shift();
    if (!next) {
      return;
    }
    this.activeJob = this.runJob(next);
  }

  private async runJob(request: ClaimedControlRequest): Promise<void> {
    try {
      await this.deps.dispatchNonCancel(request);
    } catch (error) {
      // A3: a background job never escapes as an unhandled rejection.
      this.deps.log.error(`Background job (${request.request_type}) failed: ${safeMessage(error)}`);
      try {
        await this.deps.failRequest(
          request.id,
          `REQUEST_HANDLER_FAILED: ${safeMessage(error)}`.slice(0, REQUEST_ERROR_LIMIT),
        );
      } catch {
        // failRequest is status-guarded: a request already completed by its handler
        // is left untouched; a still-claimed row stays claimed for lost-claim recovery.
      }
    } finally {
      this.deps.held.release(request.id);
      this.activeJob = null;
      this.pump();
    }
  }

  /**
   * Wait for the active job to finish, bounded by timeoutMs. On shutdown the loop
   * stops offering and the executor shutdown aborts the in-flight Attempt, so the
   * active job settles; this bound guarantees the loop never hangs even if it does
   * not. Returns true iff the slot drained within the bound.
   */
  async drain(timeoutMs: number): Promise<boolean> {
    const active = this.activeJob;
    if (!active) {
      return true;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
      if (timer && typeof (timer as { unref?: () => void }).unref === 'function') {
        (timer as { unref: () => void }).unref();
      }
    });
    try {
      return await Promise.race([active.then(() => true, () => true), timeout]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
