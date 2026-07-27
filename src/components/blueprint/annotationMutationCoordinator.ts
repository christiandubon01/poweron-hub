/**
 * annotationMutationCoordinator.ts — BUG-ANNOTATION-DELETE-RESURRECT-1
 *
 * Pure, framework-free ordering coordinator for blueprint annotation mutations
 * (creates, updates AND deletes) that all share one serialized write queue in
 * OperationsBlueprintPdfViewer.
 *
 * Deleted annotations used to return because a create/update save that was still
 * in flight could resolve AFTER the same annotation's delete had been optimistically
 * applied, and its success handler unconditionally cleared the delete guard and then
 * reloaded from a backup the delete had not yet tombstoned. This coordinator makes
 * ordering authoritative:
 *
 *   - a monotonic ENQUEUE SEQUENCE (never a wall-clock timestamp, so a same-millisecond
 *     create→delete is still deterministic);
 *   - the newest delete sequence per id, so an older, still-in-flight save can never
 *     clear a newer delete's guard (resolveSaveSuccess);
 *   - the in-flight mutation count, so the single reconciling reload only runs once the
 *     WHOLE queue — including deletes — has drained (finish → drained);
 *   - the set of locally-deleted ("guarded") ids a reload must hide until the tombstone
 *     is durable (isDeleteGuarded).
 *
 * All React state, dirty-scope registration and storage I/O stay in the component; this
 * module is intentionally pure so the ordering rules can be unit-tested exhaustively.
 */

export interface AnnotationMutationFinishResult {
  /** True only when the in-flight count returned to zero (queue fully drained). */
  drained: boolean
}

export interface AnnotationMutationCoordinator {
  /**
   * Assign the next strict enqueue sequence and count one more in-flight mutation.
   * Called synchronously when a create/update/delete is queued.
   */
  begin(): number
  /** Decrement the in-flight count (never below zero) and report whether it drained. */
  finish(): AnnotationMutationFinishResult
  /** Number of mutations currently in flight. */
  pending(): number
  /**
   * Mark an id locally deleted at `sequence` (obtained from a preceding begin()): add
   * the guard and record it as the newest delete sequence for the id. Idempotent — a
   * later delete simply advances the recorded sequence.
   */
  markDeleted(id: string, sequence: number): void
  /**
   * Resolve a successful save. Clears the delete guard ONLY when this save is newer than
   * any recorded delete for the id — an older, still-in-flight save must never cancel a
   * later delete. Returns true when the guard was cleared (this save superseded any
   * prior delete), false when a newer delete still owns the guard.
   */
  resolveSaveSuccess(id: string, sequence: number): boolean
  /**
   * Drop a delete guard and its recorded sequence. Used for a genuinely failed delete
   * (explicit rollback) and for an explicit restore (undo/redo, batch compensation),
   * where the annotation is deliberately brought back.
   */
  clearDeleteGuard(id: string): void
  /** True while the id is locally deleted and must be hidden from reloads. */
  isDeleteGuarded(id: string): boolean
}

export function createAnnotationMutationCoordinator(): AnnotationMutationCoordinator {
  let sequence = 0
  let pendingCount = 0
  const deleteSequenceById = new Map<string, number>()
  const deleteGuardIds = new Set<string>()

  return {
    begin(): number {
      pendingCount += 1
      sequence += 1
      return sequence
    },
    finish(): AnnotationMutationFinishResult {
      pendingCount = Math.max(0, pendingCount - 1)
      return { drained: pendingCount === 0 }
    },
    pending(): number {
      return pendingCount
    },
    markDeleted(id: string, sequence: number): void {
      deleteGuardIds.add(id)
      const prior = deleteSequenceById.get(id)
      if (prior === undefined || sequence > prior) {
        deleteSequenceById.set(id, sequence)
      }
    },
    resolveSaveSuccess(id: string, sequence: number): boolean {
      const latestDelete = deleteSequenceById.get(id)
      if (latestDelete === undefined || sequence > latestDelete) {
        deleteGuardIds.delete(id)
        deleteSequenceById.delete(id)
        return true
      }
      return false
    },
    clearDeleteGuard(id: string): void {
      deleteGuardIds.delete(id)
      deleteSequenceById.delete(id)
    },
    isDeleteGuarded(id: string): boolean {
      return deleteGuardIds.has(id)
    },
  }
}
