import { describe, it, expect } from 'vitest'
import {
  createAnnotationMutationCoordinator,
  type AnnotationMutationCoordinator,
} from '../annotationMutationCoordinator'

/**
 * BUG-ANNOTATION-DELETE-RESURRECT-1 — regression tests.
 *
 * These exercise the REAL ordering coordinator that OperationsBlueprintPdfViewer uses. Each helper
 * below replays the exact sequence of coordinator calls the viewer makes for one queued mutation,
 * exposing a settle() the test resolves in a chosen order. That lets us drive overlapping
 * create/update/delete timing deterministically — the whole point of the fix is that ordering is
 * decided by enqueue sequence, never by a wall clock, so there is nothing time-based to fake.
 *
 * Mapping to the queued mutation flows in the viewer:
 *   persistAnnotation(id): begin() → [await storage] → on success resolveSaveSuccess(id, seq)
 *                          → finally finish()
 *   removeAnnotation(id):  begin() → markDeleted(id, seq) → [await storage]
 *                          → finally finish() (guard deliberately kept on success)
 */

interface QueuedMutation {
  sequence: number
  /** Resolve the (async) storage op. Returns the drain result the viewer's finally observes. */
  settle: (outcome?: 'success' | 'failure') => { drained: boolean }
}

function beginPersist(coord: AnnotationMutationCoordinator, id: string): QueuedMutation {
  const sequence = coord.begin()
  return {
    sequence,
    settle(outcome: 'success' | 'failure' = 'success') {
      // A failed save throws before resolveSaveSuccess, so it can never clear a delete guard.
      if (outcome === 'success') coord.resolveSaveSuccess(id, sequence)
      return coord.finish()
    },
  }
}

function beginDelete(coord: AnnotationMutationCoordinator, id: string): QueuedMutation {
  const sequence = coord.begin()
  coord.markDeleted(id, sequence)
  return {
    sequence,
    settle(outcome: 'success' | 'failure' = 'success') {
      // A genuinely failed delete rolls back the guard (removeAnnotation's catch); success keeps it.
      if (outcome === 'failure') coord.clearDeleteGuard(id)
      return coord.finish()
    },
  }
}

const ID = 'ann_hdmi_1'
const OTHER = 'ann_other_2'

describe('annotationMutationCoordinator — delete-resurrection ordering', () => {
  it('(1) a create queues a pending mutation', () => {
    const coord = createAnnotationMutationCoordinator()
    const create = beginPersist(coord, ID)
    expect(create.sequence).toBe(1)
    expect(coord.pending()).toBe(1)
    expect(coord.isDeleteGuarded(ID)).toBe(false)
  })

  it('(2) deleting before the create resolves guards the id with a newer sequence', () => {
    const coord = createAnnotationMutationCoordinator()
    const create = beginPersist(coord, ID)
    const del = beginDelete(coord, ID)
    expect(del.sequence).toBeGreaterThan(create.sequence)
    expect(coord.isDeleteGuarded(ID)).toBe(true)
    expect(coord.pending()).toBe(2)
  })

  it('(3) an older create completion does NOT clear the newer delete guard', () => {
    const coord = createAnnotationMutationCoordinator()
    const create = beginPersist(coord, ID)
    beginDelete(coord, ID)
    // The create resolves first (its ~1s remote round-trip finishing after the delete was queued).
    const clearedGuard = coord.resolveSaveSuccess(ID, create.sequence)
    expect(clearedGuard).toBe(false)
    expect(coord.isDeleteGuarded(ID)).toBe(true)
  })

  it('(4,5,6,7) the id stays deleted through create-resolves → delete-resolves → full drain', () => {
    const coord = createAnnotationMutationCoordinator()
    const create = beginPersist(coord, ID)
    const del = beginDelete(coord, ID)

    // (4) older create completes first
    const afterCreate = create.settle('success')
    expect(afterCreate.drained).toBe(false) // (19) delete still pending — no reconciling reload yet
    expect(coord.isDeleteGuarded(ID)).toBe(true)

    // (5) delete completes
    const afterDelete = del.settle('success')
    expect(afterDelete.drained).toBe(true) // (20) exactly one drain, at the end
    expect(coord.isDeleteGuarded(ID)).toBe(true) // (7) same id never un-guarded by the save

    // (6) queue fully drained, guard still held (tombstone is durable; loadAnnotations hides it)
    expect(coord.pending()).toBe(0)
    expect(coord.isDeleteGuarded(ID)).toBe(true)
  })

  it('(8) ordering is by strict enqueue sequence, independent of any clock', () => {
    const coord = createAnnotationMutationCoordinator()
    // Same-tick create then delete: sequences are strictly increasing regardless of timing.
    const s1 = coord.begin()
    const s2 = coord.begin()
    expect(s2).toBeGreaterThan(s1)
    coord.markDeleted(ID, s2)
    // The lower-sequence save can never win the guard even though both happened in the same tick.
    expect(coord.resolveSaveSuccess(ID, s1)).toBe(false)
    expect(coord.isDeleteGuarded(ID)).toBe(true)
  })

  it('(9) an in-flight UPDATE resolving after a delete cannot restore the annotation', () => {
    const coord = createAnnotationMutationCoordinator()
    const update = beginPersist(coord, ID) // e.g. a move/rotate/recolor save
    const del = beginDelete(coord, ID)
    update.settle('success') // older update resolves last
    del.settle('success')
    expect(coord.isDeleteGuarded(ID)).toBe(true)
  })

  it('(10) repeated deletes are idempotent and keep the guard with the newest sequence', () => {
    const coord = createAnnotationMutationCoordinator()
    const d1 = beginDelete(coord, ID)
    const d2 = beginDelete(coord, ID)
    expect(d2.sequence).toBeGreaterThan(d1.sequence)
    d1.settle('success')
    d2.settle('success')
    expect(coord.isDeleteGuarded(ID)).toBe(true)
    expect(coord.pending()).toBe(0)
    // A save older than the newest delete still cannot revive it.
    expect(coord.resolveSaveSuccess(ID, d1.sequence)).toBe(false)
    expect(coord.isDeleteGuarded(ID)).toBe(true)
  })

  it('(11) deleting one annotation never guards or restores an unrelated annotation', () => {
    const coord = createAnnotationMutationCoordinator()
    const other = beginPersist(coord, OTHER)
    beginDelete(coord, ID)
    // The unrelated annotation's save is unaffected by ID's guard.
    expect(coord.isDeleteGuarded(OTHER)).toBe(false)
    expect(coord.resolveSaveSuccess(OTHER, other.sequence)).toBe(true)
    expect(coord.isDeleteGuarded(OTHER)).toBe(false)
    // ID stays guarded.
    expect(coord.isDeleteGuarded(ID)).toBe(true)
  })

  it('(12,20) a bracketed multi-delete drains exactly once, not between deletes', () => {
    const coord = createAnnotationMutationCoordinator()
    // Outer bracket (removeAnnotationsAsSingleHistoryCommand) holds the counter above zero.
    const outer = { seq: coord.begin() }
    expect(outer.seq).toBeGreaterThan(0)

    const dA = beginDelete(coord, 'A')
    expect(dA.settle('success').drained).toBe(false) // outer still holds → no intermediate reload
    const dB = beginDelete(coord, 'B')
    expect(dB.settle('success').drained).toBe(false)

    const outerDrain = coord.finish()
    expect(outerDrain.drained).toBe(true) // single reconciling reload at the very end
    expect(coord.isDeleteGuarded('A')).toBe(true)
    expect(coord.isDeleteGuarded('B')).toBe(true)
  })

  it('(13) explicit Undo of a delete (a newer save) restores the annotation', () => {
    const coord = createAnnotationMutationCoordinator()
    const del = beginDelete(coord, ID)
    del.settle('success')
    expect(coord.isDeleteGuarded(ID)).toBe(true)

    // Undo replays a restore save that enqueues AFTER the delete, so its sequence is newer.
    const restore = beginPersist(coord, ID)
    expect(restore.sequence).toBeGreaterThan(del.sequence)
    const cleared = coord.resolveSaveSuccess(ID, restore.sequence)
    expect(cleared).toBe(true)
    expect(coord.isDeleteGuarded(ID)).toBe(false)
    restore.settle('success')
  })

  it('(14) Redo after an undo deletes the annotation again', () => {
    const coord = createAnnotationMutationCoordinator()
    beginDelete(coord, ID).settle('success')
    const restore = beginPersist(coord, ID)
    coord.resolveSaveSuccess(ID, restore.sequence)
    restore.settle('success')
    expect(coord.isDeleteGuarded(ID)).toBe(false)

    // Redo enqueues an even newer delete.
    const redo = beginDelete(coord, ID)
    expect(redo.sequence).toBeGreaterThan(restore.sequence)
    redo.settle('success')
    expect(coord.isDeleteGuarded(ID)).toBe(true)
  })

  it('(15,16) creation source is irrelevant — Quick Access and toolbar share identical semantics', () => {
    // The coordinator has no notion of "source"; both placement paths call the same begin()/
    // markDeleted()/resolveSaveSuccess()/finish() with the same ids, so deletion ordering is
    // provably identical for a Quick Access-created and a toolbar-created annotation.
    const quickAccess = createAnnotationMutationCoordinator()
    const toolbar = createAnnotationMutationCoordinator()
    for (const coord of [quickAccess, toolbar]) {
      const create = beginPersist(coord, ID)
      const del = beginDelete(coord, ID)
      create.settle('success') // create outlives delete
      del.settle('success')
      expect(coord.isDeleteGuarded(ID)).toBe(true)
    }
  })

  it('(17) a genuinely failed delete rolls back the guard and drains', () => {
    const coord = createAnnotationMutationCoordinator()
    const del = beginDelete(coord, ID)
    expect(coord.isDeleteGuarded(ID)).toBe(true)
    const result = del.settle('failure')
    expect(result.drained).toBe(true)
    expect(coord.isDeleteGuarded(ID)).toBe(false) // rolled back — annotation resurfaces on reload
  })

  it('(18,19) a queued delete keeps the counter non-zero so an older save cannot drain the reload', () => {
    const coord = createAnnotationMutationCoordinator()
    const create = beginPersist(coord, ID)
    beginDelete(coord, ID)
    expect(coord.pending()).toBe(2) // delete counts — scope stays dirty, refresh gated
    const afterCreate = create.settle('success')
    expect(afterCreate.drained).toBe(false) // reload deferred until the delete also drains
  })

  it('(fail-safe) a failed save never clears an existing delete guard', () => {
    const coord = createAnnotationMutationCoordinator()
    const create = beginPersist(coord, ID)
    beginDelete(coord, ID)
    create.settle('failure') // save failed → resolveSaveSuccess is skipped
    expect(coord.isDeleteGuarded(ID)).toBe(true)
  })

  it('(counter) finish never drives the in-flight count below zero', () => {
    const coord = createAnnotationMutationCoordinator()
    expect(coord.finish()).toEqual({ drained: true })
    expect(coord.pending()).toBe(0)
    expect(coord.finish()).toEqual({ drained: true })
    expect(coord.pending()).toBe(0)
  })

  it('(guard) a save with no prior delete clears nothing and reports it cleared', () => {
    const coord = createAnnotationMutationCoordinator()
    const create = beginPersist(coord, ID)
    // No delete recorded → the save legitimately owns the id.
    expect(coord.resolveSaveSuccess(ID, create.sequence)).toBe(true)
    expect(coord.isDeleteGuarded(ID)).toBe(false)
  })
})
